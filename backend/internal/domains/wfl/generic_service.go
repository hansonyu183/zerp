package wfl

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/hansonyu183/zerp/backend/internal/database/sqlc"
	"github.com/hansonyu183/zerp/backend/internal/platform/approval"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"go.starlark.net/starlark"
)

var definitionCodePattern = regexp.MustCompile(`^[a-z][a-z0-9-]{1,62}[a-z0-9]$`)
var workflowDiagnosticLocationPattern = regexp.MustCompile(`workflow\.star:(\d+):(\d+)`)

var reservedDefinitionCodes = map[string]bool{"process-definition": true, "process-instance": true}

func wflEnabledFilter(enabled *bool) int32 {
	if enabled == nil {
		return -1
	}
	if *enabled {
		return 1
	}
	return 0
}

func (s *Service) DefinitionQuery(ctx context.Context, input DefinitionQueryInput, actor approval.Actor) (Page[DefinitionListItem], error) {
	if input.Page < 1 || input.PageSize < 1 || input.PageSize > 200 {
		return Page[DefinitionListItem]{}, validation("invalid pagination", nil)
	}

	params := sqlc.CountCurrentWorkflowDefinitionsParams{
		Keyword:       strings.TrimSpace(input.Keyword),
		EnabledFilter: wflEnabledFilter(input.Enabled),
	}
	total, err := s.queries.CountCurrentWorkflowDefinitions(ctx, params)
	if err != nil {
		return Page[DefinitionListItem]{}, internal("count workflow definitions", err)
	}

	rows, err := s.queries.ListCurrentWorkflowDefinitions(ctx, sqlc.ListCurrentWorkflowDefinitionsParams{
		Keyword:       params.Keyword,
		EnabledFilter: params.EnabledFilter,
		PageOffset:    int32((input.Page - 1) * input.PageSize),
		PageSize:      int32(input.PageSize),
	})
	if err != nil {
		return Page[DefinitionListItem]{}, internal("list workflow definitions", err)
	}

	items := make([]DefinitionListItem, 0, len(rows))
	for _, row := range rows {
		if row.Code == nil {
			return Page[DefinitionListItem]{}, internal("workflow definition subject has no code", errors.New("missing DCL subject code"))
		}
		var compiled compiledScriptDefinition
		if err = json.Unmarshal(row.Compiled, &compiled); err != nil {
			return Page[DefinitionListItem]{}, internal("decode workflow definition", err)
		}
		root := compiledNodeByKey(compiled, compiled.RootKey)

		entryRow, eErr := s.queries.GetApprovalEntry(ctx, sqlc.GetApprovalEntryParams{
			ID:     row.ApprovalEntryID,
			Domain: "dcl",
			Entity: "wfl-process-definition",
		})
		if eErr != nil {
			return Page[DefinitionListItem]{}, internal("get approval entry", eErr)
		}

		items = append(items, DefinitionListItem{
			DefinitionID: row.DefinitionID,
			Code:         *row.Code,
			Name:         compiled.Name,
			Enabled:      row.Enabled,
			Approval:     workflowApprovalMetaFromEntry(entryRow),
			RootEntity:   root.Entity,
			NodeCount:    len(compiled.Nodes),
			UpdatedAt:    row.UpdatedAt.Time,
		})
	}
	return Page[DefinitionListItem]{Items: items, Total: total, Page: input.Page, PageSize: input.PageSize}, nil
}

// DefinitionGet returns the current latest APPROVED workflow definition by ID.
// WFL is read-only for current definitions; no candidate leakage.
func (s *Service) DefinitionGet(ctx context.Context, input DefinitionGetInput, _ approval.Actor) (DefinitionView, error) {
	if !validWorkflowID(input.DefinitionID) {
		return DefinitionView{}, validation("invalid definitionId", nil)
	}

	identity, err := s.queries.GetCurrentWorkflowDefinitionIdentity(ctx, input.DefinitionID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return DefinitionView{}, validation("process definition not found", nil)
		}
		return DefinitionView{}, internal("get workflow definition", err)
	}
	if identity.Code == nil {
		return DefinitionView{}, internal("get workflow definition", errors.New("workflow definition code is null"))
	}

	latest, err := s.queries.DclWflGetLatestApprovedPayload(ctx, input.DefinitionID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return DefinitionView{}, validation("process definition not found", nil)
		}
		return DefinitionView{}, internal("get latest approved version", err)
	}

	entryRow, err := s.queries.GetApprovalEntry(ctx, sqlc.GetApprovalEntryParams{
		ID:     latest.ApprovalEntryID,
		Domain: "dcl",
		Entity: "wfl-process-definition",
	})
	if err != nil {
		return DefinitionView{}, internal("get approval entry", err)
	}

	var compiled compiledScriptDefinition
	if err := json.Unmarshal(latest.Compiled, &compiled); err != nil {
		return DefinitionView{}, internal("decode workflow graph", err)
	}

	result := DefinitionView{
		DefinitionListItem: DefinitionListItem{
			DefinitionID: input.DefinitionID,
			Code:         *identity.Code,
			Name:         compiled.Name,
			Enabled:      identity.Enabled,
			Approval:     workflowApprovalMetaFromEntry(entryRow),
			RootEntity:   compiledNodeByKey(compiled, compiled.RootKey).Entity,
			NodeCount:    len(compiled.Nodes),
		},
		Script:      latest.Script,
		RootNodeKey: compiled.RootKey,
		Nodes:       []DefinitionNodeView{},
		Edges:       []DefinitionEdgeView{},
	}

	if latest.Diagnostic != nil {
		result.Diagnostic = workflowDiagnostic(*latest.Diagnostic)
	}

	depth := map[string]int{compiled.RootKey: 0}
	rowByDepth := map[int]int{}
	for _, edge := range compiled.Edges {
		depth[edge.TargetKey] = depth[edge.SourceKey] + 1
	}
	for _, node := range compiled.Nodes {
		level := depth[node.Key]
		line := rowByDepth[level]
		rowByDepth[level]++
		result.Nodes = append(result.Nodes, DefinitionNodeView{
			Key: node.Key, Name: node.Name, DocumentEntity: node.Entity,
			PositionX: 40 + level*280, PositionY: 80 + line*150,
		})
	}
	for _, edge := range compiled.Edges {
		result.Edges = append(result.Edges, DefinitionEdgeView{
			SourceNodeKey: edge.SourceKey, TargetNodeKey: edge.TargetKey,
			Action: edge.ActionName, Relation: edge.Relation,
		})
	}

	return result, nil
}

// DefinitionTrial is a WFL domain capability called by DCL maintenance process.
// It accepts a frozen DRAFT payload and records trial evidence through a narrow typed seam.
func (s *Service) DefinitionTrial(ctx context.Context, input DefinitionTrialInput, actor approval.Actor) (DefinitionTrialResult, error) {
	if !validWorkflowID(input.DefinitionID) || !validWorkflowID(input.ApprovalEntryID) || input.Revision < 1 || !validWorkflowID(input.Source.DocumentID) {
		return DefinitionTrialResult{}, validation("invalid definition trial", nil)
	}

	// Get the DRAFT version payload from DCL table
	version, err := s.queries.DclWflGetVersionPayload(ctx, sqlc.DclWflGetVersionPayloadParams{
		ApprovalEntryID: input.ApprovalEntryID,
		DefinitionID:    input.DefinitionID,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return DefinitionTrialResult{}, validation("process definition not found", nil)
		}
		return DefinitionTrialResult{}, internal("get workflow definition", err)
	}

	// Verify it's a DRAFT
	entryRow, err := s.queries.GetApprovalEntry(ctx, sqlc.GetApprovalEntryParams{
		ID:     input.ApprovalEntryID,
		Domain: "dcl",
		Entity: "wfl-process-definition",
	})
	if err != nil {
		return DefinitionTrialResult{}, internal("get approval entry", err)
	}
	if entryRow.Status != string(approval.StatusDraft) {
		return DefinitionTrialResult{}, conflict("only a draft process definition can be trialled", nil)
	}
	if entryRow.Revision != input.Revision {
		return DefinitionTrialResult{}, conflict("process definition changed", map[string]any{"revision": entryRow.Revision})
	}

	if version.Diagnostic != nil {
		return DefinitionTrialResult{}, workflowScriptValidation(errors.New(*version.Diagnostic))
	}

	compiled, err := CompileDefinitionScript(version.Script)
	if err != nil {
		return DefinitionTrialResult{}, workflowScriptValidation(err)
	}

	root := compiledNodeByKey(compiled, compiled.RootKey)
	if input.Source.Entity != root.Entity {
		return DefinitionTrialResult{}, validation("trial source entity does not match the workflow root", map[string]any{"expectedEntity": root.Entity})
	}

	source, err := s.runtime.LoadWorkflowSource(ctx, nil, input.Source.Entity, input.Source.DocumentID)
	if err != nil {
		return DefinitionTrialResult{}, err
	}

	actions := &trialActions{}
	execution, err := executeCompiledWorkflow(ctx, nil, compiled, compiled.RootKey, input.Source.DocumentID, source, actions, actor.RequestID(), "")
	if err != nil {
		return DefinitionTrialResult{}, err
	}

	// Record trial evidence through narrow typed seam (zero-write adapter)
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return DefinitionTrialResult{}, internal("begin workflow trial", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	rows, err := s.queries.WithTx(tx).DclWflRecordTrial(ctx, sqlc.DclWflRecordTrialParams{
		ApprovalEntryID:  input.ApprovalEntryID,
		ApprovalRevision: &input.Revision,
	})
	if err != nil {
		return DefinitionTrialResult{}, internal("record workflow trial", err)
	}
	if rows != 1 {
		return DefinitionTrialResult{}, conflict("process definition changed", nil)
	}

	if err = s.queries.WithTx(tx).RecordWorkflowTrialAudit(ctx, sqlc.RecordWorkflowTrialAuditParams{
		ID: newID(), DefinitionID: input.DefinitionID, DefinitionApprovalEntryID: input.ApprovalEntryID,
		DocumentID: workflowText(input.Source.DocumentID), ActorID: actor.ID(), RequestID: actor.RequestID(),
		Summary: mustJSON(map[string]any{"matched": execution.Matched}),
	}); err != nil {
		return DefinitionTrialResult{}, internal("audit workflow trial", err)
	}

	if err = tx.Commit(ctx); err != nil {
		return DefinitionTrialResult{}, internal("commit workflow trial", err)
	}

	return DefinitionTrialResult{
		DefinitionID: input.DefinitionID, ApprovalEntryID: input.ApprovalEntryID, Revision: input.Revision, Matched: execution.Matched,
		RootNodeKey: compiled.RootKey, Trace: execution.Trace, PlannedActions: actions.plans,
		UncoveredBranches: execution.UncoveredBranches,
	}, nil
}

func workflowScriptValidation(err error) error {
	return validation("流程脚本编译失败："+err.Error(), map[string]any{"diagnostic": workflowDiagnostic(err.Error())})
}

func workflowDiagnostic(message string) *DefinitionDiagnostic {
	diagnostic := &DefinitionDiagnostic{Message: message}
	match := workflowDiagnosticLocationPattern.FindStringSubmatch(message)
	if len(match) == 3 {
		diagnostic.Line, _ = strconv.Atoi(match[1])
		diagnostic.Column, _ = strconv.Atoi(match[2])
	}
	return diagnostic
}

func workflowApprovalMetaFromEntry(entry sqlc.ApprovalEntry) approval.VersionMeta {
	versionNo := int32(0)
	if entry.VersionNo != nil {
		versionNo = *entry.VersionNo
	}
	return approval.VersionMeta{
		ApprovalEntryID: entry.ID,
		VersionNo:       versionNo,
		Status:          approval.Status(entry.Status),
		Revision:        entry.Revision,
		CreatedBy:       entry.CreatedBy,
		CreatedAt:       entry.CreatedAt.Time,
		UpdatedBy:       entry.UpdatedBy,
		UpdatedAt:       entry.UpdatedAt.Time,
		SubmittedBy:     entry.SubmittedBy,
		SubmittedAt:     workflowTime(entry.SubmittedAt),
		ApprovedBy:      entry.ApprovedBy,
		ApprovedAt:      workflowTime(entry.ApprovedAt),
	}
}

func validWorkflowID(value string) bool { return len(strings.TrimSpace(value)) == 26 }

func mustJSON(value any) []byte {
	encoded, _ := json.Marshal(value)
	return encoded
}

func workflowText(value string) *string { return &value }

func workflowTime(value pgtype.Timestamptz) *time.Time {
	if !value.Valid {
		return nil
	}
	return &value.Time
}

func actionFingerprint(processID, sourceNodeID string, edge compiledScriptEdge, initial any) string {
	encoded := mustJSON(initial)
	hash := sha256.Sum256(append([]byte(processID+"\x00"+sourceNodeID+"\x00"+edge.TargetKey+"\x00"+edge.Relation+"\x00"+edge.ActionName+"\x00"), encoded...))
	return hex.EncodeToString(hash[:])
}
func (s *Service) InstanceQuery(ctx context.Context, input InstanceQueryInput) (Page[InstanceListItem], error) {
	if input.Page < 1 || input.PageSize < 1 || input.PageSize > 200 {
		return Page[InstanceListItem]{}, validation("invalid pagination", nil)
	}
	params := sqlc.CountDefinitionInstancesParams{
		Keyword: strings.TrimSpace(input.Keyword), DefinitionID: input.DefinitionID,
		PartyObjectID: strings.TrimSpace(input.PartyObjectID),
	}
	total, err := s.queries.CountDefinitionInstances(ctx, params)
	if err != nil {
		return Page[InstanceListItem]{}, internal("count workflow instances", err)
	}
	rows, err := s.queries.ListDefinitionInstances(ctx, sqlc.ListDefinitionInstancesParams{
		Keyword: params.Keyword, DefinitionID: params.DefinitionID, PartyObjectID: params.PartyObjectID,
		PageOffset: int32((input.Page - 1) * input.PageSize), PageSize: int32(input.PageSize),
	})
	if err != nil {
		return Page[InstanceListItem]{}, internal("list workflow instances", err)
	}
	items := make([]InstanceListItem, 0, len(rows))
	for _, row := range rows {
		items = append(items, InstanceListItem{
			ProcessID: row.ProcessID, DefinitionID: row.DefinitionID, ApprovalEntryID: row.DefinitionApprovalEntryID, DefinitionCode: row.DefinitionCode,
			DefinitionName: row.DefinitionName, Revision: row.Revision, RootDocumentID: row.RootDocumentID,
			RootDocumentNo: row.RootDocumentNo, RootEntity: row.RootEntity,
			PartyCode: row.PartyCode, PartyName: row.PartyName, UpdatedAt: row.UpdatedAt.Time,
		})
	}
	return Page[InstanceListItem]{Items: items, Total: total, Page: input.Page, PageSize: input.PageSize}, nil
}

func (s *Service) InstanceQueryByDefinitionCode(ctx context.Context, code string, input InstanceQueryInput) (Page[InstanceListItem], error) {
	definitionID, err := s.definitionIDByCode(ctx, code)
	if err != nil {
		return Page[InstanceListItem]{}, err
	}
	input.DefinitionID = definitionID
	return s.InstanceQuery(ctx, input)
}

func (s *Service) InstanceGet(ctx context.Context, input InstanceGetInput) (InstanceView, error) {
	if !validWorkflowID(input.ProcessID) {
		return InstanceView{}, validation("invalid processId", nil)
	}
	row, err := s.queries.GetDefinitionInstance(ctx, input.ProcessID)
	if errors.Is(err, pgx.ErrNoRows) {
		return InstanceView{}, validation("process instance not found", nil)
	}
	if err != nil {
		return InstanceView{}, internal("get workflow instance", err)
	}
	result := InstanceView{InstanceListItem: InstanceListItem{
		ProcessID: row.ProcessID, DefinitionID: row.DefinitionID, ApprovalEntryID: row.DefinitionApprovalEntryID, DefinitionCode: row.DefinitionCode,
		DefinitionName: row.DefinitionName, Revision: row.Revision, RootDocumentID: row.RootDocumentID,
		RootDocumentNo: row.RootDocumentNo, RootEntity: row.RootEntity, PartyCode: row.PartyCode,
		PartyName: row.PartyName, UpdatedAt: row.UpdatedAt.Time,
	}, Nodes: []NodeInstanceView{}, AvailableTargets: []AvailableChildTarget{}}
	rows, err := s.queries.ListWorkflowInstanceNodes(ctx, input.ProcessID)
	if err != nil {
		return InstanceView{}, internal("list workflow instance nodes", err)
	}
	for _, node := range rows {
		result.Nodes = append(result.Nodes, NodeInstanceView{
			NodeInstanceID: node.ID, ParentNodeInstanceID: node.ParentNodeInstanceID, NodeKey: node.NodeKey, NodeName: node.NodeName,
			DocumentID: node.DocumentID, DocumentNo: node.DocumentNo, DocumentEntity: node.DocumentEntity, DocumentStatus: node.DocumentStatus,
			DocumentRevision: node.DocumentRevision, BusinessDate: node.BusinessDate, BusinessParentEntity: node.BusinessParentEntity,
			BusinessParentDocumentID: node.BusinessParentDocumentID, Relation: node.RelationName, Trigger: node.TriggerEvent,
			Action: node.ActionName, EvaluatedAt: workflowTime(node.EvaluatedAt),
		})
	}
	definition, err := s.queries.DclWflGetVersionPayload(ctx, sqlc.DclWflGetVersionPayloadParams{DefinitionID: row.DefinitionID, ApprovalEntryID: row.DefinitionApprovalEntryID})
	if err != nil {
		return InstanceView{}, internal("get workflow instance definition", err)
	}
	var compiled compiledScriptDefinition
	err = json.Unmarshal(definition.Compiled, &compiled)
	if err != nil {
		return InstanceView{}, internal("decode workflow instance definition", err)
	}
	executed := map[string]bool{}
	executionRows, err := s.queries.ListCompletedWorkflowActionTargets(ctx, input.ProcessID)
	if err != nil {
		return InstanceView{}, internal("list workflow action executions", err)
	}
	for _, execution := range executionRows {
		executed[execution.SourceNodeInstanceID+"\x00"+execution.TargetNodeKey] = true
	}
	for _, node := range result.Nodes {
		if node.DocumentID == "" {
			continue
		}
		source, sourceErr := s.runtime.LoadWorkflowSource(ctx, nil, node.DocumentEntity, node.DocumentID)
		if sourceErr != nil {
			continue
		}
		sourceValue, sourceErr := workflowStarlarkValue(source)
		if sourceErr != nil {
			continue
		}
		thread := &starlark.Thread{Name: "wfl-targets"}
		thread.SetMaxExecutionSteps(maxWorkflowScriptSteps)
		for _, edge := range compiled.Edges {
			if edge.SourceKey != node.NodeKey || executed[node.NodeInstanceID+"\x00"+edge.TargetKey] {
				continue
			}
			matched := true
			if edge.when != nil {
				matched, sourceErr = callWorkflowCondition(thread, edge.when, sourceValue)
			}
			if sourceErr != nil || !matched {
				continue
			}
			target := compiledNodeByKey(compiled, edge.TargetKey)
			result.AvailableTargets = append(result.AvailableTargets, AvailableChildTarget{
				ParentNodeInstanceID: node.NodeInstanceID, TargetNodeKey: target.Key,
				TargetNodeName: target.Name, TargetEntity: target.Entity, Relation: edge.Relation,
			})
		}
	}
	return result, nil
}

func (s *Service) InstanceGetByDefinitionCode(ctx context.Context, code string, input InstanceGetInput) (InstanceView, error) {
	if _, err := s.definitionIDByCode(ctx, code); err != nil {
		return InstanceView{}, err
	}
	result, err := s.InstanceGet(ctx, input)
	if err == nil && result.DefinitionCode != code {
		return InstanceView{}, validation("process instance not found", nil)
	}
	return result, err
}

func (s *Service) InstanceHistory(ctx context.Context, input InstanceHistoryInput) (Page[RuntimeAuditView], error) {
	if !validWorkflowID(input.ProcessID) || input.Page < 1 || input.PageSize < 1 || input.PageSize > 200 {
		return Page[RuntimeAuditView]{}, validation("invalid history query", nil)
	}
	total, err := s.queries.CountWorkflowRuntimeAudits(ctx, workflowText(input.ProcessID))
	if err != nil {
		return Page[RuntimeAuditView]{}, internal("count workflow audit", err)
	}
	rows, err := s.queries.ListWorkflowRuntimeAudits(ctx, sqlc.ListWorkflowRuntimeAuditsParams{
		ProcessID: workflowText(input.ProcessID), PageSize: int32(input.PageSize), PageOffset: int32((input.Page - 1) * input.PageSize),
	})
	if err != nil {
		return Page[RuntimeAuditView]{}, internal("list workflow audit", err)
	}
	items := []RuntimeAuditView{}
	for _, row := range rows {
		items = append(items, RuntimeAuditView{ID: row.ID, EventType: row.EventType, NodeInstanceID: row.NodeInstanceID,
			DocumentID: row.DocumentID, DocumentNo: row.DocumentNo, ActorID: row.ActorID, RequestID: row.RequestID,
			Summary: row.Summary, OccurredAt: row.OccurredAt.Time})
	}
	return Page[RuntimeAuditView]{Items: items, Total: total, Page: input.Page, PageSize: input.PageSize}, nil
}

func (s *Service) InstanceHistoryByDefinitionCode(ctx context.Context, code string, input InstanceHistoryInput) (Page[RuntimeAuditView], error) {
	result, err := s.InstanceGetByDefinitionCode(ctx, code, InstanceGetInput{ProcessID: input.ProcessID})
	if err != nil || result.ProcessID == "" {
		return Page[RuntimeAuditView]{}, err
	}
	return s.InstanceHistory(ctx, input)
}

func (s *Service) definitionIDByCode(ctx context.Context, code string) (string, error) {
	if !definitionCodePattern.MatchString(code) || reservedDefinitionCodes[code] {
		return "", validation("process definition not found", nil)
	}
	definitionID, err := s.queries.GetWorkflowDefinitionIDByCode(ctx, &code)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", validation("process definition not found", nil)
	}
	return definitionID, err
}

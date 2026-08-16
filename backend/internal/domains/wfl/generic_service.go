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
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"go.starlark.net/starlark"
)

var definitionCodePattern = regexp.MustCompile(`^[a-z][a-z0-9-]{1,62}[a-z0-9]$`)
var workflowDiagnosticLocationPattern = regexp.MustCompile(`workflow\.star:(\d+):(\d+)`)

var reservedDefinitionCodes = map[string]bool{"process-definition": true, "process-instance": true}

func (s *Service) DefinitionQuery(ctx context.Context, input DefinitionQueryInput) (Page[DefinitionListItem], error) {
	if input.Page < 1 || input.PageSize < 1 || input.PageSize > 200 {
		return Page[DefinitionListItem]{}, validation("invalid pagination", nil)
	}
	allowed := map[string]bool{DefinitionDraft: true, DefinitionEnabled: true, DefinitionDisabled: true}
	for _, status := range input.Statuses {
		if !allowed[status] {
			return Page[DefinitionListItem]{}, validation("invalid definition status", nil)
		}
	}
	params := sqlc.CountWorkflowDefinitionsParams{Keyword: strings.TrimSpace(input.Keyword), Statuses: input.Statuses}
	total, err := s.queries.CountWorkflowDefinitions(ctx, params)
	if err != nil {
		return Page[DefinitionListItem]{}, internal("count workflow definitions", err)
	}
	rows, err := s.queries.ListWorkflowDefinitions(ctx, sqlc.ListWorkflowDefinitionsParams{
		Keyword: params.Keyword, Statuses: params.Statuses,
		PageOffset: int32((input.Page - 1) * input.PageSize), PageSize: int32(input.PageSize),
	})
	if err != nil {
		return Page[DefinitionListItem]{}, internal("list workflow definitions", err)
	}
	items := make([]DefinitionListItem, 0, len(rows))
	for _, row := range rows {
		var compiled compiledScriptDefinition
		if err = json.Unmarshal(row.DraftCompiled, &compiled); err != nil {
			return Page[DefinitionListItem]{}, internal("decode workflow definition", err)
		}
		root := compiledNodeByKey(compiled, compiled.RootKey)
		items = append(items, DefinitionListItem{
			DefinitionID: row.ID, Code: row.Code, Name: row.Name, Status: row.Status,
			Revision: row.Revision, PublishedRevision: row.PublishedRevision,
			RootEntity: root.Entity, NodeCount: len(compiled.Nodes), UpdatedAt: row.UpdatedAt.Time,
		})
	}
	return Page[DefinitionListItem]{Items: items, Total: total, Page: input.Page, PageSize: input.PageSize}, nil
}

func (s *Service) DefinitionGet(ctx context.Context, input DefinitionGetInput) (DefinitionView, error) {
	if !validWorkflowID(input.DefinitionID) {
		return DefinitionView{}, validation("invalid definitionId", nil)
	}
	row, err := s.queries.GetWorkflowDefinition(ctx, input.DefinitionID)
	if errors.Is(err, pgx.ErrNoRows) {
		return DefinitionView{}, validation("process definition not found", nil)
	}
	if err != nil {
		return DefinitionView{}, internal("get workflow definition", err)
	}
	return definitionView(row)
}

func definitionView(row sqlc.WflProcessDefinition) (DefinitionView, error) {
	var compiled compiledScriptDefinition
	if err := json.Unmarshal(row.DraftCompiled, &compiled); err != nil {
		return DefinitionView{}, internal("decode workflow graph", err)
	}
	result := DefinitionView{
		DefinitionListItem: DefinitionListItem{
			DefinitionID: row.ID, Code: row.Code, Name: row.Name, Status: row.Status,
			Revision: row.Revision, PublishedRevision: row.PublishedRevision,
			RootEntity: compiledNodeByKey(compiled, compiled.RootKey).Entity,
			NodeCount:  len(compiled.Nodes), UpdatedAt: row.UpdatedAt.Time,
		},
		Script: row.DraftScript, RootNodeKey: compiled.RootKey,
		Nodes: []DefinitionNodeView{}, Edges: []DefinitionEdgeView{},
	}
	if row.DraftDiagnostic != nil {
		result.Diagnostic = workflowDiagnostic(*row.DraftDiagnostic)
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

func compiledJSON(compiled compiledScriptDefinition) ([]byte, error) {
	return json.Marshal(compiled)
}

func (s *Service) DefinitionCreate(ctx context.Context, input DefinitionCreateInput, actorID string) (DefinitionView, error) {
	compiled, err := compileDefinitionScript(input.Script)
	if err != nil {
		return DefinitionView{}, workflowScriptValidation(err)
	}
	encoded, err := compiledJSON(compiled)
	if err != nil {
		return DefinitionView{}, internal("encode workflow graph", err)
	}
	id := newID()
	if err = s.queries.CreateWorkflowDefinition(ctx, sqlc.CreateWorkflowDefinitionParams{
		ID: id, Code: compiled.Code, Name: compiled.Name, DraftScript: input.Script,
		DraftCompiled: encoded, CreatedBy: actorID,
	}); err != nil {
		return DefinitionView{}, conflict("process definition code already exists", nil)
	}
	return s.DefinitionGet(ctx, DefinitionGetInput{DefinitionID: id})
}

func (s *Service) DefinitionSave(ctx context.Context, input DefinitionSaveInput, actorID string) (DefinitionView, error) {
	if !validWorkflowID(input.DefinitionID) || input.Revision < 1 {
		return DefinitionView{}, validation("invalid definition revision", nil)
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return DefinitionView{}, internal("begin save workflow definition", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	queries := s.queries.WithTx(tx)
	locked, err := queries.LockWorkflowDefinition(ctx, input.DefinitionID)
	if errors.Is(err, pgx.ErrNoRows) {
		return DefinitionView{}, validation("process definition not found", nil)
	}
	if err != nil {
		return DefinitionView{}, internal("lock workflow definition", err)
	}
	if locked.Revision != input.Revision {
		return DefinitionView{}, conflict("process definition changed", map[string]any{"revision": locked.Revision})
	}
	compiled, compileErr := compileDefinitionScript(input.Script)
	name, encoded := locked.Name, locked.DraftCompiled
	var diagnostic *string
	if compileErr != nil {
		message := compileErr.Error()
		diagnostic = &message
	} else {
		if compiled.Code != locked.Code {
			return DefinitionView{}, validation("process definition code is immutable", nil)
		}
		name = compiled.Name
		encoded, err = compiledJSON(compiled)
		if err != nil {
			return DefinitionView{}, internal("encode workflow graph", err)
		}
	}
	rows, err := queries.SaveWorkflowDefinition(ctx, sqlc.SaveWorkflowDefinitionParams{
		Name: name, DraftScript: input.Script, DraftDiagnostic: diagnostic,
		DraftCompiled: encoded, UpdatedBy: actorID, ID: input.DefinitionID, Revision: input.Revision,
	})
	if err != nil {
		return DefinitionView{}, internal("save workflow definition", err)
	}
	if rows != 1 {
		return DefinitionView{}, conflict("process definition changed", nil)
	}
	if err = tx.Commit(ctx); err != nil {
		return DefinitionView{}, internal("commit workflow definition", err)
	}
	return s.DefinitionGet(ctx, DefinitionGetInput{DefinitionID: input.DefinitionID})
}

func (s *Service) DefinitionTrial(ctx context.Context, input DefinitionTrialInput, actorID, requestID string) (DefinitionTrialResult, error) {
	if !validWorkflowID(input.DefinitionID) || input.Revision < 1 || !validWorkflowID(input.Source.DocumentID) {
		return DefinitionTrialResult{}, validation("invalid definition trial", nil)
	}
	definition, err := s.DefinitionGet(ctx, DefinitionGetInput{DefinitionID: input.DefinitionID})
	if err != nil {
		return DefinitionTrialResult{}, err
	}
	if definition.Revision != input.Revision {
		return DefinitionTrialResult{}, conflict("process definition changed", map[string]any{"revision": definition.Revision})
	}
	if definition.Diagnostic != nil {
		return DefinitionTrialResult{}, workflowScriptValidation(errors.New(definition.Diagnostic.Message))
	}
	compiled, err := compileDefinitionScript(definition.Script)
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
	execution, err := executeCompiledWorkflow(ctx, nil, compiled, compiled.RootKey, input.Source.DocumentID, source, actions, requestID, "")
	if err != nil {
		return DefinitionTrialResult{}, err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return DefinitionTrialResult{}, internal("begin workflow trial", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	rows, err := s.queries.WithTx(tx).RecordWorkflowDefinitionTrial(ctx, sqlc.RecordWorkflowDefinitionTrialParams{ID: input.DefinitionID, LastTrialRevision: &input.Revision})
	if err != nil {
		return DefinitionTrialResult{}, internal("record workflow trial", err)
	}
	if rows != 1 {
		return DefinitionTrialResult{}, conflict("process definition changed", nil)
	}
	if err = s.queries.WithTx(tx).RecordWorkflowTrialAudit(ctx, sqlc.RecordWorkflowTrialAuditParams{
		ID: newID(), DefinitionID: input.DefinitionID, DefinitionRevision: input.Revision,
		DocumentID: workflowText(input.Source.DocumentID), ActorID: actorID, RequestID: requestID,
		Summary: mustJSON(map[string]any{"matched": execution.Matched}),
	}); err != nil {
		return DefinitionTrialResult{}, internal("audit workflow trial", err)
	}
	if err = tx.Commit(ctx); err != nil {
		return DefinitionTrialResult{}, internal("commit workflow trial", err)
	}
	return DefinitionTrialResult{
		DefinitionID: input.DefinitionID, Revision: input.Revision, Matched: execution.Matched,
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

func (s *Service) DefinitionAction(ctx context.Context, action string, input DefinitionActionInput, actorID string) (any, error) {
	if !validWorkflowID(input.DefinitionID) || input.Revision < 1 {
		return nil, validation("invalid definition action", nil)
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, internal("begin workflow definition action", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	queries := s.queries.WithTx(tx)
	locked, err := queries.LockWorkflowDefinition(ctx, input.DefinitionID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, validation("process definition not found", nil)
	}
	if err != nil {
		return nil, internal("lock workflow definition", err)
	}
	if locked.Revision != input.Revision {
		return nil, conflict("process definition changed", map[string]any{"revision": locked.Revision})
	}
	switch action {
	case "publish":
		if locked.DraftDiagnostic != nil || locked.LastTrialRevision == nil || *locked.LastTrialRevision != locked.Revision {
			return nil, conflict("the current draft requires a successful document trial before publication", nil)
		}
		published, nextErr := queries.NextWorkflowPublishedRevision(ctx, input.DefinitionID)
		if nextErr != nil {
			return nil, internal("allocate workflow revision", nextErr)
		}
		publishedRevision := int64(published)
		if err = queries.PublishWorkflowDefinitionRevision(ctx, sqlc.PublishWorkflowDefinitionRevisionParams{
			DefinitionID: input.DefinitionID, Revision: publishedRevision,
			Script: locked.DraftScript, Compiled: locked.DraftCompiled, PublishedBy: actorID,
		}); err != nil {
			return nil, internal("publish workflow revision", err)
		}
		rows, updateErr := queries.SetWorkflowPublishedRevision(ctx, sqlc.SetWorkflowPublishedRevisionParams{
			PublishedRevision: &publishedRevision, UpdatedBy: actorID, ID: input.DefinitionID, Revision: input.Revision,
		})
		if updateErr != nil || rows != 1 {
			return nil, conflict("process definition changed", nil)
		}
	case "enable", "disable":
		if action == "enable" && locked.PublishedRevision == nil {
			return nil, conflict("publish the workflow before enabling it", nil)
		}
		status := DefinitionDisabled
		if action == "enable" {
			status = DefinitionEnabled
			if err = enableDefinitionPermissions(ctx, tx, locked.Code, locked.Name, actorID); err != nil {
				return nil, err
			}
		}
		rows, updateErr := queries.SetWorkflowDefinitionStatus(ctx, sqlc.SetWorkflowDefinitionStatusParams{
			Status: status, UpdatedBy: actorID, ID: input.DefinitionID, Revision: input.Revision,
		})
		if updateErr != nil || rows != 1 {
			return nil, conflict("process definition changed", nil)
		}
	case "delete":
		used, queryErr := queries.WorkflowDefinitionHasInstances(ctx, input.DefinitionID)
		if queryErr != nil {
			return nil, internal("check workflow definition use", err)
		}
		if used || locked.PublishedRevision != nil || locked.Status != DefinitionDraft {
			return nil, conflict("only unused draft definitions can be deleted", nil)
		}
		if err = queries.DeleteWorkflowDefinition(ctx, input.DefinitionID); err != nil {
			return nil, internal("delete workflow definition", err)
		}
	default:
		return nil, validation("invalid definition action", nil)
	}
	if err = tx.Commit(ctx); err != nil {
		return nil, internal("commit workflow definition action", err)
	}
	if action == "delete" {
		return map[string]any{"definitionId": input.DefinitionID}, nil
	}
	return s.DefinitionGet(ctx, DefinitionGetInput{DefinitionID: input.DefinitionID})
}

var definitionPermissionActions = []struct{ action, label string }{
	{action: "query", label: "查询"}, {action: "get", label: "读取"},
	{action: "audit-history", label: "查询审计"}, {action: "create-child", label: "创建下级"},
}

func enableDefinitionPermissions(ctx context.Context, tx pgx.Tx, code, name, actorID string) error {
	for _, permission := range definitionPermissionActions {
		path := "/wfl/" + code + "/" + permission.action
		err := sqlc.New(tx).UpsertWorkflowDefinitionPermission(ctx, sqlc.UpsertWorkflowDefinitionPermissionParams{
			ID: newID(), Path: path, Entity: code, Action: permission.action,
			Description: workflowText(permission.label + name + "流程"), ActorID: workflowText(actorID),
		})
		if err != nil {
			return internal("enable workflow permission", err)
		}
	}
	return nil
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
			ProcessID: row.ProcessID, DefinitionID: row.DefinitionID, DefinitionCode: row.DefinitionCode,
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
		ProcessID: row.ProcessID, DefinitionID: row.DefinitionID, DefinitionCode: row.DefinitionCode,
		DefinitionName: row.DefinitionName, Revision: row.Revision, RootDocumentID: row.RootDocumentID,
		RootDocumentNo: row.RootDocumentNo, RootEntity: row.RootEntity, PartyCode: row.PartyCode,
		PartyName: row.PartyName, UpdatedAt: row.UpdatedAt.Time,
	}, StartedDefinitionRevision: row.StartedDefinitionRevision, Nodes: []NodeInstanceView{}, AvailableTargets: []AvailableChildTarget{}}
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
	revision, err := s.queries.GetWorkflowPublishedRevision(ctx, sqlc.GetWorkflowPublishedRevisionParams{
		DefinitionID: row.DefinitionID, Revision: row.StartedDefinitionRevision,
	})
	if err != nil {
		return InstanceView{}, internal("get workflow instance revision", err)
	}
	compiled, err := compileDefinitionScript(revision.Script)
	if err != nil {
		return InstanceView{}, internal("compile published workflow revision", err)
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
	definitionID, err := s.queries.GetPublishedWorkflowDefinitionIDByCode(ctx, code)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", validation("process definition not found", nil)
	}
	return definitionID, err
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

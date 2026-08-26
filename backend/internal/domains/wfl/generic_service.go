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
	"github.com/hansonyu183/zerp/backend/internal/events/wflapproval"
	"github.com/hansonyu183/zerp/backend/internal/platform/approval"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"go.starlark.net/starlark"
)

var definitionCodePattern = regexp.MustCompile(`^[a-z][a-z0-9-]{1,62}[a-z0-9]$`)
var workflowDiagnosticLocationPattern = regexp.MustCompile(`workflow\.star:(\d+):(\d+)`)

var reservedDefinitionCodes = map[string]bool{"process-definition": true, "process-instance": true}

func (s *Service) DefinitionQuery(ctx context.Context, input DefinitionQueryInput, actor approval.Actor) (Page[DefinitionListItem], error) {
	if input.Page < 1 || input.PageSize < 1 || input.PageSize > 200 {
		return Page[DefinitionListItem]{}, validation("invalid pagination", nil)
	}
	for _, status := range input.ApprovalStatuses {
		if status != string(approval.StatusDraft) && status != string(approval.StatusPending) && status != string(approval.StatusApproved) {
			return Page[DefinitionListItem]{}, validation("invalid definition status", nil)
		}
	}
	if err := s.approval.Authorize(ctx, actor, "query"); err != nil {
		return Page[DefinitionListItem]{}, err
	}
	params := sqlc.CountWorkflowDefinitionsParams{Keyword: strings.TrimSpace(input.Keyword), ApprovalStatuses: input.ApprovalStatuses, Enabled: input.Enabled}
	total, err := s.queries.CountWorkflowDefinitions(ctx, params)
	if err != nil {
		return Page[DefinitionListItem]{}, internal("count workflow definitions", err)
	}
	rows, err := s.queries.ListWorkflowDefinitions(ctx, sqlc.ListWorkflowDefinitionsParams{
		Keyword: params.Keyword, ApprovalStatuses: params.ApprovalStatuses, Enabled: params.Enabled,
		PageOffset: int32((input.Page - 1) * input.PageSize), PageSize: int32(input.PageSize),
	})
	if err != nil {
		return Page[DefinitionListItem]{}, internal("list workflow definitions", err)
	}
	items := make([]DefinitionListItem, 0, len(rows))
	for _, row := range rows {
		var compiled compiledScriptDefinition
		if err = json.Unmarshal(row.Compiled, &compiled); err != nil {
			return Page[DefinitionListItem]{}, internal("decode workflow definition", err)
		}
		root := compiledNodeByKey(compiled, compiled.RootKey)
		items = append(items, DefinitionListItem{
			DefinitionID: row.ID, Code: row.Code, Name: row.Name, Enabled: row.Enabled, Revision: row.Revision,
			Approval:   workflowApprovalMeta(row.ApprovalEntryID, row.VersionNo, row.Status, row.ApprovalRevision, row.ApprovalCreatedBy, row.ApprovalCreatedAt, row.ApprovalUpdatedBy, row.ApprovalUpdatedAt, row.SubmittedBy, row.SubmittedAt, row.ApprovedBy, row.ApprovedAt),
			RootEntity: root.Entity, NodeCount: len(compiled.Nodes), UpdatedAt: row.UpdatedAt.Time,
		})
	}
	return Page[DefinitionListItem]{Items: items, Total: total, Page: input.Page, PageSize: input.PageSize}, nil
}

func (s *Service) DefinitionGet(ctx context.Context, input DefinitionGetInput, actor approval.Actor) (DefinitionView, error) {
	if !validWorkflowID(input.DefinitionID) {
		return DefinitionView{}, validation("invalid definitionId", nil)
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return DefinitionView{}, internal("begin get workflow definition", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	entryID := input.ApprovalEntryID
	if entryID == "" {
		open, openErr := s.approval.GetOpenVersion(ctx, tx, input.DefinitionID, actor)
		if openErr == nil {
			entryID = open.ID
		} else {
			latest, latestErr := s.approval.GetLatestApproved(ctx, tx, input.DefinitionID, actor)
			if latestErr != nil {
				return DefinitionView{}, latestErr
			}
			entryID = latest.ID
		}
	} else if _, err = s.approval.Get(ctx, tx, entryID, actor); err != nil {
		return DefinitionView{}, err
	}
	row, err := s.queries.WithTx(tx).GetWorkflowDefinitionVersion(ctx, sqlc.GetWorkflowDefinitionVersionParams{DefinitionID: input.DefinitionID, ApprovalEntryID: entryID})
	if errors.Is(err, pgx.ErrNoRows) {
		return DefinitionView{}, validation("process definition not found", nil)
	}
	if err != nil {
		return DefinitionView{}, internal("get workflow definition", err)
	}
	result, err := definitionView(row)
	if err != nil {
		return DefinitionView{}, err
	}
	if err = tx.Commit(ctx); err != nil {
		return DefinitionView{}, internal("commit get workflow definition", err)
	}
	return result, nil
}

// definitionGetExact loads the response for an action that has already
// authorized its own permission. It deliberately does not require the caller
// to also hold /get merely to receive the result of that action.
func (s *Service) definitionGetExact(ctx context.Context, definitionID, approvalEntryID string) (DefinitionView, error) {
	if !validWorkflowID(definitionID) || !validWorkflowID(approvalEntryID) {
		return DefinitionView{}, validation("invalid workflow definition version", nil)
	}
	row, err := s.queries.GetWorkflowDefinitionVersion(ctx, sqlc.GetWorkflowDefinitionVersionParams{
		DefinitionID:    definitionID,
		ApprovalEntryID: approvalEntryID,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return DefinitionView{}, validation("process definition not found", nil)
	}
	if err != nil {
		return DefinitionView{}, internal("get workflow definition", err)
	}
	return definitionView(row)
}

func workflowApprovalMeta(id string, versionNo *int32, status string, revision int64, createdBy string, createdAt pgtype.Timestamptz, updatedBy string, updatedAt pgtype.Timestamptz, submittedBy *string, submittedAt pgtype.Timestamptz, approvedBy *string, approvedAt pgtype.Timestamptz) approval.VersionMeta {
	version := int32(0)
	if versionNo != nil {
		version = *versionNo
	}
	return approval.VersionMeta{ApprovalEntryID: id, VersionNo: version, Status: approval.Status(status), Revision: revision, CreatedBy: createdBy, CreatedAt: createdAt.Time, UpdatedBy: updatedBy, UpdatedAt: updatedAt.Time, SubmittedBy: submittedBy, SubmittedAt: workflowTime(submittedAt), ApprovedBy: approvedBy, ApprovedAt: workflowTime(approvedAt)}
}

func definitionView(row sqlc.GetWorkflowDefinitionVersionRow) (DefinitionView, error) {
	var compiled compiledScriptDefinition
	if err := json.Unmarshal(row.Compiled, &compiled); err != nil {
		return DefinitionView{}, internal("decode workflow graph", err)
	}
	result := DefinitionView{
		DefinitionListItem: DefinitionListItem{
			DefinitionID: row.ID, Code: row.Code, Name: row.Name, Enabled: row.Enabled, Revision: row.Revision,
			Approval:   workflowApprovalMeta(row.ApprovalEntryID, row.VersionNo, row.Status, row.ApprovalRevision, row.ApprovalCreatedBy, row.ApprovalCreatedAt, row.ApprovalUpdatedBy, row.ApprovalUpdatedAt, row.SubmittedBy, row.SubmittedAt, row.ApprovedBy, row.ApprovedAt),
			RootEntity: compiledNodeByKey(compiled, compiled.RootKey).Entity,
			NodeCount:  len(compiled.Nodes), UpdatedAt: row.UpdatedAt.Time,
		},
		Script: row.Script, RootNodeKey: compiled.RootKey,
		Nodes: []DefinitionNodeView{}, Edges: []DefinitionEdgeView{},
	}
	if row.Diagnostic != nil {
		result.Diagnostic = workflowDiagnostic(*row.Diagnostic)
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

func (s *Service) DefinitionCreate(ctx context.Context, input DefinitionCreateInput, actor approval.Actor) (DefinitionView, error) {
	compiled, err := compileDefinitionScript(input.Script)
	if err != nil {
		return DefinitionView{}, workflowScriptValidation(err)
	}
	encoded, err := compiledJSON(compiled)
	if err != nil {
		return DefinitionView{}, internal("encode workflow graph", err)
	}
	id := newID()
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return DefinitionView{}, internal("begin create workflow definition", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	queries := s.queries.WithTx(tx)
	if err = queries.CreateWorkflowDefinition(ctx, sqlc.CreateWorkflowDefinitionParams{ID: id, Code: compiled.Code, Name: compiled.Name, CreatedBy: actor.ID()}); err != nil {
		return DefinitionView{}, conflict("process definition code already exists", nil)
	}
	payload := wflapproval.Payload{DefinitionID: id, Code: compiled.Code, Name: compiled.Name, Script: input.Script, Compiled: encoded}
	entry, err := s.approval.CreateFirstVersion(ctx, tx, id, actor, payload)
	if err != nil {
		return DefinitionView{}, err
	}
	if err = queries.CreateWorkflowDefinitionVersion(ctx, sqlc.CreateWorkflowDefinitionVersionParams{ApprovalEntryID: entry.ID, DefinitionID: id, Script: input.Script, Compiled: encoded, CreatedBy: actor.ID()}); err != nil {
		return DefinitionView{}, internal("create workflow definition version", err)
	}
	if err = tx.Commit(ctx); err != nil {
		return DefinitionView{}, internal("commit create workflow definition", err)
	}
	return s.definitionGetExact(ctx, id, entry.ID)
}

func (s *Service) DefinitionSave(ctx context.Context, input DefinitionSaveInput, actor approval.Actor) (DefinitionView, error) {
	if !validWorkflowID(input.DefinitionID) || !validWorkflowID(input.ApprovalEntryID) || input.Revision < 1 {
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
	current, err := queries.GetWorkflowDefinitionVersion(ctx, sqlc.GetWorkflowDefinitionVersionParams{DefinitionID: input.DefinitionID, ApprovalEntryID: input.ApprovalEntryID})
	if errors.Is(err, pgx.ErrNoRows) {
		return DefinitionView{}, validation("process definition version not found", nil)
	}
	if err != nil {
		return DefinitionView{}, internal("get workflow definition version", err)
	}
	compiled, compileErr := compileDefinitionScript(input.Script)
	name, encoded := locked.Name, current.Compiled
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
	payload := wflapproval.Payload{DefinitionID: input.DefinitionID, Code: locked.Code, Name: name, Enabled: locked.Enabled, Script: input.Script, Diagnostic: diagnostic, Compiled: encoded}
	entry, err := s.approval.SaveDraft(ctx, tx, input.ApprovalEntryID, input.Revision, actor, payload)
	if err != nil {
		return DefinitionView{}, err
	}
	rows, err := queries.SaveWorkflowDefinitionVersion(ctx, sqlc.SaveWorkflowDefinitionVersionParams{Script: input.Script, Diagnostic: diagnostic, Compiled: encoded, UpdatedBy: actor.ID(), ApprovalEntryID: entry.ID})
	if err != nil || rows != 1 {
		return DefinitionView{}, internal("save workflow definition version", err)
	}
	if err = tx.Commit(ctx); err != nil {
		return DefinitionView{}, internal("commit workflow definition", err)
	}
	return s.definitionGetExact(ctx, input.DefinitionID, entry.ID)
}

func (s *Service) DefinitionTrial(ctx context.Context, input DefinitionTrialInput, actor approval.Actor) (DefinitionTrialResult, error) {
	if !validWorkflowID(input.DefinitionID) || !validWorkflowID(input.ApprovalEntryID) || input.Revision < 1 || !validWorkflowID(input.Source.DocumentID) {
		return DefinitionTrialResult{}, validation("invalid definition trial", nil)
	}
	definition, err := s.definitionGetExact(ctx, input.DefinitionID, input.ApprovalEntryID)
	if err != nil {
		return DefinitionTrialResult{}, err
	}
	if definition.Approval.Revision != input.Revision {
		return DefinitionTrialResult{}, conflict("process definition changed", map[string]any{"revision": definition.Approval.Revision})
	}
	if definition.Approval.Status != approval.StatusDraft {
		return DefinitionTrialResult{}, conflict("only a draft process definition can be trialled", nil)
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
	execution, err := executeCompiledWorkflow(ctx, nil, compiled, compiled.RootKey, input.Source.DocumentID, source, actions, actor.RequestID(), "")
	if err != nil {
		return DefinitionTrialResult{}, err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return DefinitionTrialResult{}, internal("begin workflow trial", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	rows, err := s.queries.WithTx(tx).RecordWorkflowDefinitionTrial(ctx, sqlc.RecordWorkflowDefinitionTrialParams{ApprovalEntryID: input.ApprovalEntryID, LastTrialApprovalRevision: &input.Revision})
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

func (s *Service) DefinitionAction(ctx context.Context, action string, input DefinitionActionInput, actor approval.Actor) (any, error) {
	if !validWorkflowID(input.DefinitionID) || !validWorkflowID(input.ApprovalEntryID) || input.Revision < 1 {
		return nil, validation("invalid definition action", nil)
	}
	if (action == "reject" || action == "unapprove") && strings.TrimSpace(input.Reason) == "" {
		return nil, validation("approval reason is required", nil)
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, internal("begin workflow definition action", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	queries := s.queries.WithTx(tx)
	row, err := queries.GetWorkflowDefinitionVersion(ctx, sqlc.GetWorkflowDefinitionVersionParams{DefinitionID: input.DefinitionID, ApprovalEntryID: input.ApprovalEntryID})
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, validation("process definition version not found", nil)
	}
	if err != nil {
		return nil, internal("get workflow definition version", err)
	}
	payload := wflapproval.Payload{DefinitionID: row.ID, Code: row.Code, Name: row.Name, Enabled: row.Enabled, Script: row.Script, Diagnostic: row.Diagnostic, Compiled: row.Compiled, TrialApprovalRevision: row.LastTrialApprovalRevision}
	var entry approval.Entry
	switch action {
	case "submit":
		entry, err = s.approval.Submit(ctx, tx, input.ApprovalEntryID, input.Revision, actor, payload)
	case "unsubmit":
		entry, err = s.approval.Unsubmit(ctx, tx, input.ApprovalEntryID, input.Revision, actor, payload)
	case "reject":
		entry, err = s.approval.Reject(ctx, tx, input.ApprovalEntryID, input.Revision, actor, input.Reason, payload)
	case "approve":
		if row.Diagnostic != nil || row.LastTrialApprovalRevision == nil {
			return nil, conflict("the current draft requires a successful document trial before approval", nil)
		}
		entry, err = s.approval.Approve(ctx, tx, input.ApprovalEntryID, input.Revision, actor, payload)
	case "unapprove":
		entry, err = s.approval.Unapprove(ctx, tx, input.ApprovalEntryID, input.Revision, actor, input.Reason, payload)
	case "delete-version":
		used, queryErr := queries.WorkflowDefinitionHasInstances(ctx, input.DefinitionID)
		if queryErr != nil {
			return nil, internal("check workflow definition use", queryErr)
		}
		if err = s.approval.DeleteDraftVersion(ctx, tx, input.ApprovalEntryID, input.Revision, actor, payload); err != nil {
			return nil, err
		}
		if row.VersionNo != nil && *row.VersionNo == 1 {
			if used {
				return nil, conflict("an in-use process definition cannot be deleted", nil)
			}
			if err = queries.DeleteWorkflowDefinition(ctx, input.DefinitionID); err != nil {
				return nil, internal("delete workflow definition", err)
			}
		}
	default:
		return nil, validation("invalid definition action", nil)
	}
	if err != nil {
		return nil, err
	}
	if err = tx.Commit(ctx); err != nil {
		return nil, internal("commit workflow definition action", err)
	}
	if action == "delete-version" && row.VersionNo != nil && *row.VersionNo == 1 {
		return map[string]any{"definitionId": input.DefinitionID}, nil
	}
	return s.definitionGetExact(ctx, input.DefinitionID, entry.ID)
}

func (s *Service) DefinitionCreateVersion(ctx context.Context, input DefinitionVersionCreateInput, actor approval.Actor) (DefinitionView, error) {
	if !validWorkflowID(input.DefinitionID) {
		return DefinitionView{}, validation("invalid definitionId", nil)
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return DefinitionView{}, internal("begin create workflow version", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	queries := s.queries.WithTx(tx)
	definition, err := queries.LockWorkflowDefinition(ctx, input.DefinitionID)
	if errors.Is(err, pgx.ErrNoRows) {
		return DefinitionView{}, validation("process definition not found", nil)
	}
	if err != nil {
		return DefinitionView{}, internal("lock workflow definition", err)
	}
	approvedEntryID, err := queries.GetWorkflowLatestApprovedVersion(ctx, input.DefinitionID)
	if errors.Is(err, pgx.ErrNoRows) {
		return DefinitionView{}, conflict("an approved process definition version is required", nil)
	}
	if err != nil {
		return DefinitionView{}, internal("get approved workflow definition", err)
	}
	previous, err := queries.GetWorkflowDefinitionVersion(ctx, sqlc.GetWorkflowDefinitionVersionParams{DefinitionID: input.DefinitionID, ApprovalEntryID: approvedEntryID})
	if err != nil {
		return DefinitionView{}, internal("get approved workflow definition", err)
	}
	payload := wflapproval.Payload{DefinitionID: input.DefinitionID, Code: definition.Code, Name: definition.Name, Enabled: definition.Enabled, Script: previous.Script, Diagnostic: previous.Diagnostic, Compiled: previous.Compiled}
	entry, err := s.approval.CreateNextVersion(ctx, tx, input.DefinitionID, actor, payload)
	if err != nil {
		return DefinitionView{}, err
	}
	if err = queries.CreateWorkflowDefinitionVersion(ctx, sqlc.CreateWorkflowDefinitionVersionParams{ApprovalEntryID: entry.ID, DefinitionID: input.DefinitionID, Script: previous.Script, Diagnostic: previous.Diagnostic, Compiled: previous.Compiled, CreatedBy: actor.ID()}); err != nil {
		return DefinitionView{}, internal("create workflow definition version", err)
	}
	if err = tx.Commit(ctx); err != nil {
		return DefinitionView{}, internal("commit create workflow version", err)
	}
	return s.definitionGetExact(ctx, input.DefinitionID, entry.ID)
}

func (s *Service) DefinitionVersions(ctx context.Context, input DefinitionQueryInput, definitionID string, actor approval.Actor) (Page[DefinitionListItem], error) {
	if !validWorkflowID(definitionID) || input.Page < 1 || input.PageSize < 1 || input.PageSize > 200 {
		return Page[DefinitionListItem]{}, validation("invalid workflow version query", nil)
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return Page[DefinitionListItem]{}, internal("begin workflow version query", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	entries, err := s.approval.ListVersions(ctx, tx, definitionID, actor)
	if err != nil {
		return Page[DefinitionListItem]{}, err
	}
	items := make([]DefinitionListItem, 0, len(entries))
	for _, entry := range entries {
		row, getErr := s.queries.WithTx(tx).GetWorkflowDefinitionVersion(ctx, sqlc.GetWorkflowDefinitionVersionParams{DefinitionID: definitionID, ApprovalEntryID: entry.ID})
		if getErr != nil {
			return Page[DefinitionListItem]{}, internal("get workflow version", getErr)
		}
		view, viewErr := definitionView(row)
		if viewErr != nil {
			return Page[DefinitionListItem]{}, viewErr
		}
		items = append(items, view.DefinitionListItem)
	}
	if err = tx.Commit(ctx); err != nil {
		return Page[DefinitionListItem]{}, internal("commit workflow version query", err)
	}
	total := int64(len(items))
	start := (input.Page - 1) * input.PageSize
	if start >= len(items) {
		return Page[DefinitionListItem]{Items: []DefinitionListItem{}, Total: total, Page: input.Page, PageSize: input.PageSize}, nil
	}
	end := start + input.PageSize
	if end > len(items) {
		end = len(items)
	}
	return Page[DefinitionListItem]{Items: items[start:end], Total: total, Page: input.Page, PageSize: input.PageSize}, nil
}

func (s *Service) DefinitionToggle(ctx context.Context, enabled bool, input DefinitionToggleInput, actor approval.Actor) (DefinitionView, error) {
	if !validWorkflowID(input.DefinitionID) || input.Revision < 1 {
		return DefinitionView{}, validation("invalid definition enabled revision", nil)
	}
	if err := s.approval.Authorize(ctx, actor, map[bool]string{true: "enable", false: "disable"}[enabled]); err != nil {
		return DefinitionView{}, err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return DefinitionView{}, internal("begin set workflow enabled", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	queries := s.queries.WithTx(tx)
	definition, err := queries.LockWorkflowDefinition(ctx, input.DefinitionID)
	if errors.Is(err, pgx.ErrNoRows) {
		return DefinitionView{}, validation("process definition not found", nil)
	}
	if err != nil {
		return DefinitionView{}, internal("lock workflow definition", err)
	}
	if definition.Revision != input.Revision {
		return DefinitionView{}, conflict("process definition changed", map[string]any{"revision": definition.Revision})
	}
	approvedEntryID, err := queries.GetWorkflowLatestApprovedVersion(ctx, input.DefinitionID)
	if errors.Is(err, pgx.ErrNoRows) {
		return DefinitionView{}, conflict("an approved process definition version is required", nil)
	}
	if err != nil {
		return DefinitionView{}, internal("get approved workflow definition", err)
	}
	if enabled {
		if err = enableDefinitionPermissions(ctx, tx, definition.Code, definition.Name, actor.ID()); err != nil {
			return DefinitionView{}, err
		}
	}
	rows, err := queries.SetWorkflowDefinitionEnabled(ctx, sqlc.SetWorkflowDefinitionEnabledParams{Enabled: enabled, UpdatedBy: actor.ID(), ID: input.DefinitionID, Revision: input.Revision})
	if err != nil {
		return DefinitionView{}, internal("set workflow enabled", err)
	}
	if rows != 1 {
		return DefinitionView{}, conflict("process definition changed", nil)
	}
	if err = tx.Commit(ctx); err != nil {
		return DefinitionView{}, internal("commit set workflow enabled", err)
	}
	return s.definitionGetExact(ctx, input.DefinitionID, approvedEntryID)
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
	definition, err := s.queries.GetWorkflowDefinitionVersion(ctx, sqlc.GetWorkflowDefinitionVersionParams{DefinitionID: row.DefinitionID, ApprovalEntryID: row.DefinitionApprovalEntryID})
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
	var definitionID string
	err := s.pool.QueryRow(ctx, `SELECT id FROM wfl_process_definitions WHERE code=$1`, code).Scan(&definitionID)
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

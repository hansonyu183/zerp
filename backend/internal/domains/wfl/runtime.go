package wfl

import (
	"context"
	"errors"
	"strings"

	"github.com/hansonyu183/zerp/backend/internal/database/sqlc"
	voudomain "github.com/hansonyu183/zerp/backend/internal/domains/vou"
	"github.com/hansonyu183/zerp/backend/internal/platform/approval"
	"github.com/hansonyu183/zerp/backend/internal/platform/txevent"
	"github.com/jackc/pgx/v5"
	"go.starlark.net/starlark"
)

func (s *Service) registerSubscriptions(bus *txevent.Bus) error {
	for _, entity := range workflowDocumentEntities() {
		if err := voudomain.ApprovalTopic(entity).Subscribe(bus, "wfl-starlark-approved", s.handleApproval); err != nil {
			return err
		}
		if err := bus.Subscribe(voudomain.DocumentDeletedTopic(entity), "wfl-starlark-deleted", s.handleDeleted); err != nil {
			return err
		}
	}
	return nil
}

type workflowApprovalEvent struct {
	Entity, DocumentID, DocumentNo string
	Revision                       int64
	Snapshot                       voudomain.ApprovalPayload
	ActorID, RequestID             string
}

func workflowDocumentEntities() []string {
	seen := map[string]bool{}
	result := []string{}
	for _, pair := range workflowActionEntities {
		for _, entity := range pair {
			if !seen[entity] {
				seen[entity] = true
				result = append(result, entity)
			}
		}
	}
	return result
}

func (s *Service) handleApproval(ctx context.Context, tx pgx.Tx, source approval.Event[voudomain.ApprovalPayload]) error {
	if source.Action != approval.ActionApproved {
		return nil
	}
	snapshot := source.Payload
	if source.ToRevision == nil || source.ToStatus == nil || *source.ToStatus != approval.StatusApproved ||
		source.Entry.Domain != "vou" || snapshot.DocumentID != source.Entry.SubjectID ||
		snapshot.Entity != source.Entry.Entity {
		return txevent.Reject("invalid workflow approval event", nil)
	}
	event := workflowApprovalEvent{Entity: snapshot.Entity, DocumentID: snapshot.DocumentID,
		DocumentNo: snapshot.DocumentNo, Revision: *source.ToRevision, Snapshot: snapshot,
		ActorID: source.ActorID, RequestID: source.RequestID}
	runtimeSource, err := s.runtime.LoadWorkflowSource(ctx, tx, event.Entity, event.DocumentID)
	if err != nil {
		return err
	}
	if err := s.executeExistingNodes(ctx, tx, event, runtimeSource); err != nil {
		return err
	}
	hasExistingRoot, err := s.queries.WithTx(tx).WorkflowDocumentHasRootInstance(ctx, workflowText(event.DocumentID))
	if err != nil {
		return err
	}
	if hasExistingRoot {
		return nil
	}
	queries := s.queries.WithTx(tx)
	definitionIDs, err := queries.ListEnabledWorkflowDefinitionIDsForShare(ctx)
	if err != nil {
		return err
	}
	type candidate struct {
		id, code, name  string
		approvalEntryID string
		compiled        compiledScriptDefinition
	}
	candidates := []candidate{}
	for _, definitionID := range definitionIDs {
		if err = approval.LockVersionSubject(ctx, tx, "dcl", "wfl-process-definition", definitionID); err != nil {
			return err
		}
		row, currentErr := queries.GetEnabledWorkflowDefinitionForShare(ctx, definitionID)
		if errors.Is(currentErr, pgx.ErrNoRows) {
			continue
		}
		if currentErr != nil {
			return currentErr
		}
		if row.Code == nil {
			return errors.New("workflow definition subject has no code")
		}
		var item candidate
		item.id, item.code, item.approvalEntryID = row.ID, *row.Code, row.ApprovalEntryID
		if nameStr, ok := row.Name.(string); ok {
			item.name = nameStr
		}
		var revisionErr error
		item.compiled, revisionErr = CompileDefinitionScript(row.Script)
		if revisionErr != nil {
			return revisionErr
		}
		root := compiledNodeByKey(item.compiled, item.compiled.RootKey)
		if root.Entity != event.Entity {
			continue
		}
		matched, revisionErr := workflowStartMatches(item.compiled, runtimeSource)
		if revisionErr != nil {
			return txevent.Reject("workflow start condition failed", map[string]any{"definitionId": item.id, "error": revisionErr.Error()})
		}
		if matched {
			candidates = append(candidates, item)
		}
	}
	if len(candidates) > 1 {
		return txevent.Reject("multiple enabled workflows match this document", map[string]any{"entity": event.Entity})
	}
	if len(candidates) == 0 {
		return nil
	}
	selected := candidates[0]
	processID, nodeID, created, err := s.ensureRootInstance(ctx, tx, selected, event)
	if err != nil {
		return err
	}
	if !created {
		return nil
	}
	return s.executeNode(ctx, tx, selected.compiled, processID, nodeID, selected.compiled.RootKey,
		event.DocumentID, runtimeSource, event.ActorID, event.RequestID, "")
}

func workflowStartMatches(compiled compiledScriptDefinition, source any) (bool, error) {
	if compiled.when == nil {
		return true, nil
	}
	value, err := workflowStarlarkValue(source)
	if err != nil {
		return false, err
	}
	thread := &starlark.Thread{Name: "wfl-start"}
	thread.SetMaxExecutionSteps(maxWorkflowScriptSteps)
	return callWorkflowCondition(thread, compiled.when, value)
}

func (s *Service) ensureRootInstance(ctx context.Context, tx pgx.Tx, definition struct {
	id, code, name  string
	approvalEntryID string
	compiled        compiledScriptDefinition
}, event workflowApprovalEvent) (string, string, bool, error) {
	queries := s.queries.WithTx(tx)
	locked, err := queries.LockWorkflowRootInstance(ctx, sqlc.LockWorkflowRootInstanceParams{
		DefinitionID: definition.id, RootDocumentID: workflowText(event.DocumentID),
	})
	if err == nil {
		return locked.ProcessID, locked.NodeID, false, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return "", "", false, err
	}
	processID, nodeID := newID(), newID()
	root := compiledNodeByKey(definition.compiled, definition.compiled.RootKey)
	var counterparty *voudomain.ReferenceView
	for _, candidate := range []*voudomain.ReferenceView{event.Snapshot.Data.Customer, event.Snapshot.Data.Supplier, event.Snapshot.Data.Employee} {
		if candidate != nil {
			counterparty = candidate
			break
		}
	}
	var counterpartyEntity, counterpartyObjectID, counterpartyApprovalEntryID, counterpartyCode, counterpartyName string
	if counterparty != nil {
		counterpartyEntity, counterpartyObjectID, counterpartyApprovalEntryID = counterparty.Entity, counterparty.ObjectID, counterparty.ApprovalEntryID
		counterpartyCode, counterpartyName = counterparty.Code, counterparty.Name
	}
	if err = queries.CreateWorkflowDefinitionInstance(ctx, sqlc.CreateWorkflowDefinitionInstanceParams{
		ID: processID, DefinitionID: definition.id, RootDocumentID: workflowText(event.DocumentID), RootDocumentNo: event.DocumentNo,
		RootEntity: event.Entity, DefinitionCode: definition.code, DefinitionName: definition.name,
		CounterpartyEntity: nullableText(counterpartyEntity), CounterpartyObjectID: nullableText(counterpartyObjectID),
		CounterpartyApprovalEntryID: nullableText(counterpartyApprovalEntryID), CounterpartyCode: nullableText(counterpartyCode), CounterpartyName: nullableText(counterpartyName),
		DefinitionApprovalEntryID: definition.approvalEntryID, ActorID: event.ActorID,
	}); err != nil {
		return "", "", false, err
	}
	if err = queries.CreateWorkflowRootNodeInstance(ctx, sqlc.CreateWorkflowRootNodeInstanceParams{
		ID: nodeID, ProcessID: processID, NodeKey: root.Key, NodeName: root.Name,
		DocumentID: workflowText(event.DocumentID), DocumentNo: event.DocumentNo, DocumentEntity: event.Entity,
	}); err != nil {
		return "", "", false, err
	}
	if err = insertRuntimeAudit(ctx, tx, processID, definition.id, definition.approvalEntryID, "STARTED", nodeID,
		event.DocumentID, event.DocumentNo, event.ActorID, event.RequestID,
		map[string]any{"approvalEntryId": definition.approvalEntryID}); err != nil {
		return "", "", false, err
	}
	return processID, nodeID, true, nil
}

func (s *Service) executeExistingNodes(ctx context.Context, tx pgx.Tx, event workflowApprovalEvent, source any) error {
	rows, err := s.queries.WithTx(tx).LockWorkflowNodesForDocument(ctx, workflowText(event.DocumentID))
	if err != nil {
		return err
	}
	type node struct {
		id, processID, key, definitionID string
		approvalEntryID                  string
	}
	nodes := []node{}
	for _, row := range rows {
		nodes = append(nodes, node{id: row.ID, processID: row.ProcessID, key: row.NodeKey, definitionID: row.DefinitionID, approvalEntryID: row.DefinitionApprovalEntryID})
	}
	for _, item := range nodes {
		revision, revisionErr := s.queries.WithTx(tx).DclWflGetVersionPayload(ctx, sqlc.DclWflGetVersionPayloadParams{
			DefinitionID: item.definitionID, ApprovalEntryID: item.approvalEntryID,
		})
		if revisionErr != nil {
			return revisionErr
		}
		compiled, compileErr := CompileDefinitionScript(revision.Script)
		if compileErr != nil {
			return compileErr
		}
		if err = s.executeNode(ctx, tx, compiled, item.processID, item.id, item.key, event.DocumentID,
			source, event.ActorID, event.RequestID, ""); err != nil {
			return err
		}
	}
	return nil
}

func (s *Service) executeNode(
	ctx context.Context, tx pgx.Tx, compiled compiledScriptDefinition,
	processID, sourceNodeID, sourceNodeKey, sourceDocumentID string,
	source any, actorID, requestID, onlyTarget string,
) error {
	sourceDocumentEntity, err := s.queries.WithTx(tx).GetWorkflowNodeDocumentEntity(ctx, sourceNodeID)
	if err != nil {
		return err
	}
	sourceValue, err := workflowStarlarkValue(source)
	if err != nil {
		return err
	}
	thread := &starlark.Thread{Name: "wfl-runtime"}
	thread.SetMaxExecutionSteps(maxWorkflowScriptSteps)
	queries := s.queries.WithTx(tx)
	for _, edge := range compiled.Edges {
		if edge.SourceKey != sourceNodeKey || onlyTarget != "" && edge.TargetKey != onlyTarget {
			continue
		}
		matched := true
		if edge.when != nil {
			matched, err = callWorkflowCondition(thread, edge.when, sourceValue)
			if err != nil {
				return txevent.Reject("workflow branch condition failed", map[string]any{"targetNodeKey": edge.TargetKey})
			}
		}
		if !matched {
			continue
		}
		initial := edge.initial
		if callable, ok := initial.(starlark.Callable); ok {
			initial, err = starlark.Call(thread, callable, starlark.Tuple{sourceValue}, nil)
			if err != nil {
				return txevent.Reject("workflow action initial values failed", map[string]any{"targetNodeKey": edge.TargetKey})
			}
		}
		plain, err := workflowPlainValue(initial)
		if err != nil {
			return err
		}
		fingerprint := actionFingerprint(processID, sourceNodeID, edge, plain)
		lockedExecution, lockErr := queries.LockWorkflowActionExecution(ctx, sqlc.LockWorkflowActionExecutionParams{
			ProcessID: processID, SourceNodeInstanceID: sourceNodeID,
			TargetNodeKey: edge.TargetKey, RelationName: edge.Relation,
		})
		err = lockErr
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return err
		}
		if err == nil && lockedExecution.DocumentID != nil {
			continue
		}
		rebuilding := err == nil
		businessObject, err := executeTypedAction(ctx, tx, s.runtime, edge.ActionName, sourceDocumentID, requestID, initial)
		if err != nil {
			return err
		}
		if businessObject.DocumentID == "" {
			return txevent.Reject("workflow action did not create a document", map[string]any{"action": edge.ActionName})
		}
		target := compiledNodeByKey(compiled, edge.TargetKey)
		var targetNodeID, foundNodeKey, foundParentID, foundRelation string
		lockedNode, nodeErr := queries.LockWorkflowNodeByProcessAndDocument(ctx, sqlc.LockWorkflowNodeByProcessAndDocumentParams{
			ProcessID: processID, DocumentID: workflowText(businessObject.DocumentID),
		})
		err = nodeErr
		if err == nil {
			targetNodeID, foundNodeKey, foundParentID, foundRelation = lockedNode.ID, lockedNode.NodeKey, lockedNode.ParentNodeInstanceID, lockedNode.RelationName
		}
		if err == nil && (foundNodeKey != edge.TargetKey || foundParentID != sourceNodeID || foundRelation != edge.Relation) {
			return txevent.Reject("workflow action result is already registered at another position", map[string]any{
				"documentId": businessObject.DocumentID, "targetNodeKey": edge.TargetKey,
			})
		}
		if errors.Is(err, pgx.ErrNoRows) && rebuilding && lockedExecution.TargetNodeInstanceID != nil {
			targetNodeID = *lockedExecution.TargetNodeInstanceID
			err = queries.RestoreWorkflowNodeInstance(ctx, sqlc.RestoreWorkflowNodeInstanceParams{
				DocumentID: workflowText(businessObject.DocumentID), DocumentNo: businessObject.DocumentNo, DocumentEntity: businessObject.Entity,
				BusinessParentEntity: workflowText(sourceDocumentEntity), BusinessParentDocumentID: workflowText(sourceDocumentID),
				RelationName: workflowText(edge.Relation), ActionName: workflowText(edge.ActionName), ID: targetNodeID,
			})
		} else if errors.Is(err, pgx.ErrNoRows) {
			targetNodeID = newID()
			err = queries.CreateWorkflowActionNodeInstance(ctx, sqlc.CreateWorkflowActionNodeInstanceParams{
				ID: targetNodeID, ProcessID: processID, ParentNodeInstanceID: workflowText(sourceNodeID), NodeKey: target.Key, NodeName: target.Name,
				DocumentID: workflowText(businessObject.DocumentID), DocumentNo: businessObject.DocumentNo, DocumentEntity: businessObject.Entity,
				BusinessParentEntity: workflowText(sourceDocumentEntity), BusinessParentDocumentID: workflowText(sourceDocumentID),
				RelationName: workflowText(edge.Relation), ActionName: workflowText(edge.ActionName),
			})
		}
		if err != nil {
			return err
		}
		if rebuilding {
			if err = queries.RestoreWorkflowActionExecution(ctx, sqlc.RestoreWorkflowActionExecutionParams{
				TargetNodeInstanceID: workflowText(targetNodeID), ActionFingerprint: fingerprint,
				ID: lockedExecution.ID,
			}); err != nil {
				return err
			}
		} else {
			executionID := newID()
			if err = queries.CreateWorkflowActionExecution(ctx, sqlc.CreateWorkflowActionExecutionParams{
				ID: executionID, ProcessID: processID, SourceNodeInstanceID: sourceNodeID, TargetNodeKey: edge.TargetKey,
				RelationName: edge.Relation, ActionName: edge.ActionName, ActionFingerprint: fingerprint, TargetNodeInstanceID: workflowText(targetNodeID),
			}); err != nil {
				return err
			}
		}
		if err = insertRuntimeAudit(ctx, tx, processID, "", "", "ACTION_EXECUTED", targetNodeID,
			businessObject.DocumentID, businessObject.DocumentNo, actorID, requestID,
			map[string]any{"action": edge.ActionName, "relation": edge.Relation, "sourceNodeInstanceId": sourceNodeID}); err != nil {
			return err
		}
	}
	return queries.MarkWorkflowNodeEvaluated(ctx, sourceNodeID)
}

func (s *Service) CreateChildByDefinitionCode(ctx context.Context, code string, input CreateChildInput, actorID string) (BusinessObjectReference, error) {
	if !validWorkflowID(input.ProcessID) || !validWorkflowID(input.ParentNodeInstanceID) ||
		!validWorkflowID(actorID) || len(input.RequestKey) < 16 || len(input.RequestKey) > 64 ||
		strings.TrimSpace(input.TargetNodeKey) == "" {
		return BusinessObjectReference{}, validation("invalid create-child request", nil)
	}
	definitionID, err := s.definitionIDByCode(ctx, code)
	if err != nil {
		return BusinessObjectReference{}, err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return BusinessObjectReference{}, internal("begin create workflow child", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	queries := s.queries.WithTx(tx)
	if err = queries.AcquireWorkflowCreateChildLock(ctx, definitionID+"\x00"+input.RequestKey); err != nil {
		return BusinessObjectReference{}, err
	}
	existing, err := queries.LockWorkflowCreateChildRequest(ctx, sqlc.LockWorkflowCreateChildRequestParams{
		DefinitionID: definitionID, RequestKey: input.RequestKey,
	})
	if err == nil {
		if existing.ProcessID != input.ProcessID || existing.ParentNodeInstanceID != input.ParentNodeInstanceID || existing.TargetNodeKey != input.TargetNodeKey {
			return BusinessObjectReference{}, conflict("requestKey is already bound to another workflow intent", nil)
		}
		var result BusinessObjectReference
		if existing.ActionExecutionID != nil {
			row, resultErr := queries.GetWorkflowCreateChildExecutionResult(ctx, *existing.ActionExecutionID)
			err = resultErr
			result.Entity, result.DocumentID, result.DocumentNo = row.DocumentEntity, row.DocumentID, row.DocumentNo
			if err == nil && result.DocumentID != "" {
				return result, nil
			}
		}
		return BusinessObjectReference{}, conflict("the original create-child result is no longer available; use a new requestKey", nil)
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return BusinessObjectReference{}, err
	}
	sourceNode, err := queries.LockWorkflowCreateChildSourceNode(ctx, sqlc.LockWorkflowCreateChildSourceNodeParams{
		ProcessID: input.ProcessID, DefinitionID: definitionID, NodeID: input.ParentNodeInstanceID,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return BusinessObjectReference{}, validation("workflow parent node not found", nil)
	}
	if err != nil {
		return BusinessObjectReference{}, err
	}
	if err = queries.CreateWorkflowCreateChildRequest(ctx, sqlc.CreateWorkflowCreateChildRequestParams{
		DefinitionID: definitionID, RequestKey: input.RequestKey, ProcessID: input.ProcessID,
		ParentNodeInstanceID: input.ParentNodeInstanceID, TargetNodeKey: input.TargetNodeKey,
	}); err != nil {
		return BusinessObjectReference{}, err
	}
	sourceDocumentID := *sourceNode.DocumentID
	sourceSnapshot, err := s.runtime.LoadWorkflowSource(ctx, tx, sourceNode.DocumentEntity, sourceDocumentID)
	if err != nil {
		return BusinessObjectReference{}, err
	}
	revision, err := queries.DclWflGetVersionPayload(ctx, sqlc.DclWflGetVersionPayloadParams{
		DefinitionID: definitionID, ApprovalEntryID: sourceNode.DefinitionApprovalEntryID,
	})
	if err != nil {
		return BusinessObjectReference{}, err
	}
	compiled, err := CompileDefinitionScript(revision.Script)
	if err != nil {
		return BusinessObjectReference{}, err
	}
	if err = s.executeNode(ctx, tx, compiled, input.ProcessID, input.ParentNodeInstanceID, sourceNode.NodeKey,
		sourceDocumentID, sourceSnapshot, actorID, input.RequestKey, input.TargetNodeKey); err != nil {
		return BusinessObjectReference{}, err
	}
	execution, err := queries.GetWorkflowActionExecutionResult(ctx, sqlc.GetWorkflowActionExecutionResultParams{
		ProcessID: input.ProcessID, SourceNodeInstanceID: input.ParentNodeInstanceID, TargetNodeKey: input.TargetNodeKey,
	})
	result := BusinessObjectReference{Entity: execution.DocumentEntity, DocumentID: execution.DocumentID, DocumentNo: execution.DocumentNo}
	if errors.Is(err, pgx.ErrNoRows) {
		return BusinessObjectReference{}, conflict("the workflow target is no longer available", nil)
	}
	if err != nil {
		return BusinessObjectReference{}, err
	}
	if err = queries.SetWorkflowCreateChildRequestExecution(ctx, sqlc.SetWorkflowCreateChildRequestExecutionParams{
		ActionExecutionID: workflowText(execution.ID), DefinitionID: definitionID, RequestKey: input.RequestKey,
	}); err != nil {
		return BusinessObjectReference{}, err
	}
	if err = tx.Commit(ctx); err != nil {
		return BusinessObjectReference{}, internal("commit create workflow child", err)
	}
	return result, nil
}

func (s *Service) handleDeleted(ctx context.Context, tx pgx.Tx, raw txevent.Event) error {
	event, ok := raw.(voudomain.DocumentDeletedEvent)
	if !ok {
		return txevent.Reject("invalid workflow delete event", nil)
	}
	queries := s.queries.WithTx(tx)
	if err := queries.MarkWorkflowRootDocumentDeleted(ctx, sqlc.MarkWorkflowRootDocumentDeletedParams{
		ActorID: event.ActorID, DocumentID: workflowText(event.DocumentID),
	}); err != nil {
		return err
	}
	return queries.ClearWorkflowNodeDocument(ctx, workflowText(event.DocumentID))
}

func insertRuntimeAudit(
	ctx context.Context, tx pgx.Tx, processID, definitionID, definitionApprovalEntryID string,
	eventType, nodeID, documentID, documentNo, actorID, requestID string, summary map[string]any,
) error {
	if definitionID == "" && processID != "" {
		instance, err := sqlc.New(tx).GetWorkflowInstanceDefinition(ctx, processID)
		if err != nil {
			return err
		}
		definitionID, definitionApprovalEntryID = instance.DefinitionID, instance.DefinitionApprovalEntryID
	}
	return sqlc.New(tx).CreateWorkflowRuntimeAudit(ctx, sqlc.CreateWorkflowRuntimeAuditParams{
		ID: newID(), ProcessID: nullableText(processID), DefinitionID: definitionID, DefinitionApprovalEntryID: definitionApprovalEntryID,
		EventType: eventType, NodeInstanceID: nullableText(nodeID), DocumentID: nullableText(documentID), DocumentNo: nullableText(documentNo),
		ActorID: actorID, RequestID: requestID, Summary: mustJSON(summary),
	})
}

func nullableText(value string) *string {
	if value == "" {
		return nil
	}
	return &value
}

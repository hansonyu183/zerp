package wfl

import (
	"context"
	"errors"
	"strings"

	"github.com/hansonyu183/zerp/backend/internal/database/sqlc"
	voudomain "github.com/hansonyu183/zerp/backend/internal/domains/vou"
	"github.com/hansonyu183/zerp/backend/internal/platform/txevent"
	"github.com/jackc/pgx/v5"
	"go.starlark.net/starlark"
)

func (s *Service) registerSubscriptions(bus *txevent.Bus) error {
	for _, entity := range workflowDocumentEntities() {
		if err := bus.Subscribe(voudomain.DocumentApprovedTopic(entity), "wfl-starlark-approved", s.handleApproved); err != nil {
			return err
		}
		if err := bus.Subscribe(voudomain.DocumentDeletedTopic(entity), "wfl-starlark-deleted", s.handleDeleted); err != nil {
			return err
		}
	}
	return nil
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

func (s *Service) handleApproved(ctx context.Context, tx pgx.Tx, raw txevent.Event) error {
	event, ok := raw.(voudomain.DocumentApprovedEvent)
	if !ok {
		return txevent.Reject("invalid workflow approval event", nil)
	}
	source, err := s.runtime.LoadWorkflowSource(ctx, tx, event.Entity, event.DocumentID)
	if err != nil {
		return err
	}
	if err := s.executeExistingNodes(ctx, tx, event, source); err != nil {
		return err
	}
	hasExistingRoot, err := s.queries.WithTx(tx).WorkflowDocumentHasRootInstance(ctx, workflowText(event.DocumentID))
	if err != nil {
		return err
	}
	if hasExistingRoot {
		return nil
	}
	rows, err := s.queries.WithTx(tx).ListEnabledWorkflowDefinitionsForShare(ctx)
	if err != nil {
		return err
	}
	type candidate struct {
		id, code, name string
		revision       int64
		compiled       compiledScriptDefinition
	}
	candidates := []candidate{}
	for _, row := range rows {
		var item candidate
		item.id, item.code, item.name = row.ID, row.Code, row.Name
		item.revision = row.Revision
		var revisionErr error
		item.compiled, revisionErr = compileDefinitionScript(row.Script)
		if revisionErr != nil {
			return revisionErr
		}
		root := compiledNodeByKey(item.compiled, item.compiled.RootKey)
		if root.Entity != event.Entity {
			continue
		}
		matched, revisionErr := workflowStartMatches(item.compiled, source)
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
		event.DocumentID, source, event.ActorID, event.RequestID, "")
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
	id, code, name string
	revision       int64
	compiled       compiledScriptDefinition
}, event voudomain.DocumentApprovedEvent) (string, string, bool, error) {
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
	var partyObjectID, partyCode, partyName string
	for _, party := range []*voudomain.ReferenceView{event.Snapshot.Data.Customer, event.Snapshot.Data.Supplier, event.Snapshot.Data.Employee} {
		if party != nil {
			partyObjectID, partyCode, partyName = party.ObjectID, party.Code, party.Name
			break
		}
	}
	if err = queries.CreateWorkflowDefinitionInstance(ctx, sqlc.CreateWorkflowDefinitionInstanceParams{
		ID: processID, DefinitionID: definition.id, RootDocumentID: workflowText(event.DocumentID), RootDocumentNo: event.DocumentNo,
		RootEntity: event.Entity, DefinitionCode: definition.code, DefinitionName: definition.name,
		PartyObjectID: nullableText(partyObjectID), PartyCode: nullableText(partyCode), PartyName: nullableText(partyName),
		StartedDefinitionRevision: definition.revision, ActorID: event.ActorID,
	}); err != nil {
		return "", "", false, err
	}
	if err = queries.CreateWorkflowRootNodeInstance(ctx, sqlc.CreateWorkflowRootNodeInstanceParams{
		ID: nodeID, ProcessID: processID, NodeKey: root.Key, NodeName: root.Name,
		DocumentID: workflowText(event.DocumentID), DocumentNo: event.DocumentNo, DocumentEntity: event.Entity,
	}); err != nil {
		return "", "", false, err
	}
	if err = insertRuntimeAudit(ctx, tx, processID, definition.id, definition.revision, "STARTED", nodeID,
		event.DocumentID, event.DocumentNo, event.ActorID, event.RequestID,
		map[string]any{"definitionRevision": definition.revision}); err != nil {
		return "", "", false, err
	}
	return processID, nodeID, true, nil
}

func (s *Service) executeExistingNodes(ctx context.Context, tx pgx.Tx, event voudomain.DocumentApprovedEvent, source any) error {
	rows, err := s.queries.WithTx(tx).LockWorkflowNodesForDocument(ctx, workflowText(event.DocumentID))
	if err != nil {
		return err
	}
	type node struct {
		id, processID, key, definitionID string
		revision                         int64
	}
	nodes := []node{}
	for _, row := range rows {
		nodes = append(nodes, node{id: row.ID, processID: row.ProcessID, key: row.NodeKey, definitionID: row.DefinitionID, revision: row.StartedDefinitionRevision})
	}
	for _, item := range nodes {
		revision, revisionErr := s.queries.WithTx(tx).GetWorkflowPublishedRevision(ctx, sqlc.GetWorkflowPublishedRevisionParams{
			DefinitionID: item.definitionID, Revision: item.revision,
		})
		if revisionErr != nil {
			return revisionErr
		}
		compiled, compileErr := compileDefinitionScript(revision.Script)
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
		if err = insertRuntimeAudit(ctx, tx, processID, "", 0, "ACTION_EXECUTED", targetNodeID,
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
	revision, err := queries.GetWorkflowPublishedRevision(ctx, sqlc.GetWorkflowPublishedRevisionParams{
		DefinitionID: definitionID, Revision: sourceNode.StartedDefinitionRevision,
	})
	if err != nil {
		return BusinessObjectReference{}, err
	}
	compiled, err := compileDefinitionScript(revision.Script)
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
	ctx context.Context, tx pgx.Tx, processID, definitionID string, definitionRevision int64,
	eventType, nodeID, documentID, documentNo, actorID, requestID string, summary map[string]any,
) error {
	if definitionID == "" && processID != "" {
		instance, err := sqlc.New(tx).GetWorkflowInstanceDefinition(ctx, processID)
		if err != nil {
			return err
		}
		definitionID, definitionRevision = instance.DefinitionID, instance.StartedDefinitionRevision
	}
	return sqlc.New(tx).CreateWorkflowRuntimeAudit(ctx, sqlc.CreateWorkflowRuntimeAuditParams{
		ID: newID(), ProcessID: nullableText(processID), DefinitionID: definitionID, DefinitionRevision: definitionRevision,
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

package wfl

import (
	"context"
)

func (s *Service) rootAction(ctx context.Context, action string, input ActionInput, actorID, requestID string) (MutationResult, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return MutationResult{}, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	process, err := lockProcess(ctx, tx, input.ProcessID)
	if err = processConflict(err, process, input.ProcessRevision); err != nil {
		return MutationResult{}, err
	}
	document, err := lockDocument(ctx, tx, process.rootID)
	if err != nil {
		return MutationResult{}, err
	}
	fromProcess := process.status
	fromDocument := document.status
	transition, err := s.prepareRootTransition(ctx, tx, action, input.Reason, actorID, process, document)
	if err != nil {
		return MutationResult{}, err
	}
	toProcess, toDocument := transition.processStatus, transition.documentStatus
	reason, event := transition.reason, transition.event
	documentRevision := document.revision
	if toDocument != fromDocument {
		documentRevision, err = updateDocumentStatus(ctx, tx, document, toDocument, actorID)
		if err != nil {
			return MutationResult{}, err
		}
		if err = insertVouAudit(ctx, tx, document.id, document.entity, event, stringPtr(fromDocument),
			toDocument, actorID, requestID, reason, map[string]any{"revision": documentRevision}); err != nil {
			return MutationResult{}, err
		}
	}
	processRevision, err := updateProcessStatus(ctx, tx, process, toProcess, actorID)
	if err != nil {
		return MutationResult{}, err
	}
	if err = insertWFLAudit(ctx, tx, process.id, event, stringPtr(fromProcess), toProcess, StageCustomer,
		document.id, document.number, semanticStatus(StageCustomer, toDocument), actorID, requestID, reason,
		map[string]any{"processRevision": processRevision}); err != nil {
		return MutationResult{}, err
	}
	balances, err := loadBalances(ctx, tx, process.id, true)
	if err != nil {
		return MutationResult{}, err
	}
	if err = tx.Commit(ctx); err != nil {
		return MutationResult{}, err
	}
	return MutationResult{ProcessID: process.id, ProcessRevision: processRevision, WorkflowStatus: toProcess,
		DocumentID: document.id, DocumentNo: document.number, DocumentRevision: documentRevision,
		DocumentStatus: semanticStatus(StageCustomer, toDocument), Balances: &balances}, nil
}

package wfl

import (
	"context"
)

func (s *Service) stageAction(ctx context.Context, stage, action string, input ActionInput, actorID, requestID string) (MutationResult, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return MutationResult{}, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	process, err := lockProcess(ctx, tx, input.ProcessID)
	if err = processConflict(err, process, input.ProcessRevision); err != nil {
		return MutationResult{}, err
	}
	if process.status != StatusApproved && process.status != StatusCompleted {
		return MutationResult{}, conflict("process is not approved", nil)
	}
	document, err := s.applyStageAction(ctx, tx, process, stage, action, input, actorID, requestID)
	if err != nil {
		return MutationResult{}, err
	}
	if err = insertStageDocumentAudit(
		ctx, tx, stage, action, input.Reason, actorID, requestID, document,
	); err != nil {
		return MutationResult{}, err
	}
	processRevision, err := touchProcess(ctx, tx, process.id, process.revision, actorID, process.status)
	if err != nil {
		return MutationResult{}, err
	}
	if err = insertStageWorkflowAudit(
		ctx, tx, process, stage, action, input.Reason, actorID, requestID, document,
	); err != nil {
		return MutationResult{}, err
	}
	status, changed, err := maybeComplete(ctx, tx, process, actorID)
	if err != nil {
		return MutationResult{}, err
	}
	if changed {
		processRevision++
	}
	balances, err := loadBalances(ctx, tx, process.id, true)
	if err != nil {
		return MutationResult{}, err
	}
	if err = tx.Commit(ctx); err != nil {
		return MutationResult{}, err
	}
	result := MutationResult{ProcessID: process.id, ProcessRevision: processRevision, WorkflowStatus: status, Balances: &balances}
	if action != "delete" {
		result.DocumentID = document.id
		result.DocumentNo = document.number
		result.DocumentRevision = document.revision
		result.DocumentStatus = semanticStatus(stage, document.status)
		result.ParentDocumentID = document.parent
	}
	return result, nil
}

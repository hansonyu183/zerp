package bob

import (
	"context"
	"strings"

	"github.com/hansonyu183/zerp/backend/internal/events/bobapproval"
	"github.com/hansonyu183/zerp/backend/internal/platform/approval"
	"github.com/jackc/pgx/v5"
)

// approvalMutation deliberately builds the BOB response from the central entry.
// BOB payload tables are keyed by Entry.ID; they never own lifecycle columns.
func approvalMutation(objectID string, objectRevision int64, enabled bool, entry approval.Entry) MutationResult {
	return MutationResult{
		ObjectID: objectID, ObjectRevision: objectRevision, Enabled: enabled,
		Approval: approval.VersionMetaFromEntry(entry),
	}
}

func (s *Service) approvalPayload(objectID, entity, code string, enabled bool) bobapproval.Payload {
	return bobApprovalPayload(objectID, entity, code, enabled)
}

func (s *Service) createFirstApproval(ctx context.Context, tx pgx.Tx, entity, objectID, code string, enabled bool, actor approval.Actor) (approval.Entry, error) {
	coordinator, err := s.coordinator(entity)
	if err != nil {
		return approval.Entry{}, err
	}
	return coordinator.CreateFirstVersion(ctx, tx, objectID, actor, s.approvalPayload(objectID, entity, code, enabled))
}

func (s *Service) createNextApproval(ctx context.Context, tx pgx.Tx, entity, objectID, code string, enabled bool, actor approval.Actor) (approval.Entry, error) {
	coordinator, err := s.coordinator(entity)
	if err != nil {
		return approval.Entry{}, err
	}
	return coordinator.CreateNextVersion(ctx, tx, objectID, actor, s.approvalPayload(objectID, entity, code, enabled))
}

func (s *Service) transitionApproval(ctx context.Context, tx pgx.Tx, entity, objectID, code string, enabled bool, entryID string, revision int64, action approval.Action, reason string, actor approval.Actor) (approval.Entry, error) {
	coordinator, err := s.coordinator(entity)
	if err != nil {
		return approval.Entry{}, err
	}
	payload := s.approvalPayload(objectID, entity, code, enabled)
	switch action {
	case approval.ActionSaved:
		return coordinator.SaveDraft(ctx, tx, entryID, revision, actor, payload)
	case approval.ActionSubmitted:
		return coordinator.Submit(ctx, tx, entryID, revision, actor, payload)
	case approval.ActionUnsubmitted:
		return coordinator.Unsubmit(ctx, tx, entryID, revision, actor, payload)
	case approval.ActionApproved:
		return coordinator.Approve(ctx, tx, entryID, revision, actor, payload)
	case approval.ActionRejected:
		return coordinator.Reject(ctx, tx, entryID, revision, actor, strings.TrimSpace(reason), payload)
	case approval.ActionUnapproved:
		return coordinator.Unapprove(ctx, tx, entryID, revision, actor, strings.TrimSpace(reason), payload)
	default:
		return approval.Entry{}, domainError(ErrorValidation, "invalid approval action", nil, nil)
	}
}

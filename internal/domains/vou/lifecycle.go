package vou

import (
	"context"
	"errors"
	"fmt"

	dbsqlc "github.com/hansonyu183/zerp-back/internal/database/sqlc"
	"github.com/jackc/pgx/v5"
)

func (s *Service) Create(
	ctx context.Context,
	entity string,
	input CreateInput,
	actorID, requestID string,
) (MutationResult, error) {
	draft, err := validateDraft(entity, input.Data)
	if err != nil {
		return MutationResult{}, err
	}
	if !validID(actorID) {
		return MutationResult{}, domainError(ErrorValidation, "invalid actor", nil, nil)
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return MutationResult{}, s.internal("begin create", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	q := s.queries.WithTx(tx)

	counter, err := q.NextVouNumberCounter(ctx, dbsqlc.NextVouNumberCounterParams{
		Entity: entity, BusinessDate: dateValue(draft.BusinessDate),
	})
	if err != nil {
		return MutationResult{}, s.writeError("allocate document number", err)
	}
	documentID := newID()
	documentNo := fmt.Sprintf("%s-%s-%06d", entityPrefix(entity), draft.BusinessDate.Format("20060102"), counter)
	if err = q.InsertVouDocument(ctx, dbsqlc.InsertVouDocumentParams{
		ID: documentID, Entity: entity, DocumentNo: documentNo,
		BusinessDate: dateValue(draft.BusinessDate), Currency: draft.Currency,
		TotalAmountCents: draft.TotalAmount, Remark: draft.Remark, ActorID: actorID,
	}); err != nil {
		return MutationResult{}, s.writeError("insert document", err)
	}
	resolved, err := s.resolveDraft(ctx, tx, entity, draft, resolvedDraft{}, true)
	if err != nil {
		return MutationResult{}, err
	}
	if err = s.insertDetail(ctx, q, entity, documentID, draft, resolved); err != nil {
		return MutationResult{}, s.writeError("insert document detail", err)
	}
	if err = insertAudit(ctx, q, auditInput{
		DocumentID: documentID, Entity: entity, Event: "CREATED", To: StatusDraft,
		ActorID: actorID, RequestID: requestID,
		Summary: map[string]any{"documentNo": documentNo},
	}); err != nil {
		return MutationResult{}, s.writeError("audit create", err)
	}
	if err = tx.Commit(ctx); err != nil {
		return MutationResult{}, s.writeError("commit create", err)
	}
	return MutationResult{DocumentID: documentID, DocumentNo: documentNo, Status: StatusDraft, Revision: 1}, nil
}

func (s *Service) Save(
	ctx context.Context,
	entity string,
	input SaveInput,
	actorID, requestID string,
) (MutationResult, error) {
	if err := validateDocumentRevision(input.DocumentID, input.Revision); err != nil {
		return MutationResult{}, err
	}
	draft, err := validateDraft(entity, input.Data)
	if err != nil {
		return MutationResult{}, err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return MutationResult{}, s.internal("begin save", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	q := s.queries.WithTx(tx)
	document, err := q.LockVouDocument(ctx, dbsqlc.LockVouDocumentParams{ID: input.DocumentID, Entity: entity})
	if err = documentWriteConflict(err, document.Revision, input.Revision, document.Status, StatusDraft); err != nil {
		return MutationResult{}, err
	}
	preserved, err := s.loadPreservedPersonnel(ctx, q, entity, input.DocumentID)
	if err != nil {
		return MutationResult{}, err
	}
	resolved, err := s.resolveDraft(ctx, tx, entity, draft, preserved, false)
	if err != nil {
		return MutationResult{}, err
	}
	if err = s.updateDetail(ctx, q, entity, input.DocumentID, draft, resolved); err != nil {
		return MutationResult{}, s.writeError("update document detail", err)
	}
	revision, err := q.UpdateVouDraft(ctx, dbsqlc.UpdateVouDraftParams{
		BusinessDate: dateValue(draft.BusinessDate), Currency: draft.Currency,
		TotalAmountCents: draft.TotalAmount, Remark: draft.Remark, ActorID: actorID,
		ID: input.DocumentID, Entity: entity, Revision: input.Revision,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return MutationResult{}, domainError(ErrorConflict, "document changed", nil, err)
	}
	if err != nil {
		return MutationResult{}, s.writeError("update draft", err)
	}
	if err = insertAudit(ctx, q, auditInput{
		DocumentID: input.DocumentID, Entity: entity, Event: "SAVED",
		From: stringPtr(StatusDraft), To: StatusDraft, ActorID: actorID, RequestID: requestID,
		Summary: map[string]any{"revision": revision},
	}); err != nil {
		return MutationResult{}, s.writeError("audit save", err)
	}
	if err = tx.Commit(ctx); err != nil {
		return MutationResult{}, s.writeError("commit save", err)
	}
	return MutationResult{
		DocumentID: input.DocumentID, DocumentNo: document.DocumentNo, Status: StatusDraft, Revision: revision,
	}, nil
}

func (s *Service) Review(
	ctx context.Context, entity string, input DocumentRevisionInput, actorID, requestID string,
) (MutationResult, error) {
	if err := validateDocumentRevision(input.DocumentID, input.Revision); err != nil {
		return MutationResult{}, err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return MutationResult{}, s.internal("begin review", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	q := s.queries.WithTx(tx)
	document, err := q.LockVouDocument(ctx, dbsqlc.LockVouDocumentParams{ID: input.DocumentID, Entity: entity})
	if err = documentWriteConflict(err, document.Revision, input.Revision, document.Status, StatusDraft); err != nil {
		return MutationResult{}, err
	}
	if err = s.validateStoredAttributes(ctx, q, entity, input.DocumentID); err != nil {
		return MutationResult{}, err
	}
	pending, err := q.CountPendingVouAttachments(ctx, input.DocumentID)
	if err != nil {
		return MutationResult{}, s.internal("count pending attachments", err)
	}
	if pending != 0 {
		return MutationResult{}, domainError(ErrorConflict, "attachments are still uploading", nil, nil)
	}
	revision, err := q.ReviewVouDocument(ctx, dbsqlc.ReviewVouDocumentParams{
		ActorID: stringPtr(actorID), ID: input.DocumentID, Entity: entity, Revision: input.Revision,
	})
	if err != nil {
		return MutationResult{}, s.writeError("review document", err)
	}
	if err = insertAudit(ctx, q, auditInput{
		DocumentID: input.DocumentID, Entity: entity, Event: "REVIEWED",
		From: stringPtr(StatusDraft), To: StatusReviewed, ActorID: actorID, RequestID: requestID,
	}); err != nil {
		return MutationResult{}, s.writeError("audit review", err)
	}
	if err = tx.Commit(ctx); err != nil {
		return MutationResult{}, s.writeError("commit review", err)
	}
	return mutation(document, StatusReviewed, revision), nil
}

func (s *Service) Approve(
	ctx context.Context, entity string, input DocumentRevisionInput, actorID, requestID string,
) (MutationResult, error) {
	return s.forwardTransition(ctx, entity, input, actorID, requestID, StatusReviewed, StatusApproved)
}

func (s *Service) Unreview(
	ctx context.Context, entity string, input ReverseInput, actorID, requestID string,
) (MutationResult, error) {
	return s.reverseTransition(ctx, entity, input, actorID, requestID, StatusReviewed, StatusDraft)
}

func (s *Service) Unapprove(
	ctx context.Context, entity string, input ReverseInput, actorID, requestID string,
) (MutationResult, error) {
	return s.reverseTransition(ctx, entity, input, actorID, requestID, StatusApproved, StatusReviewed)
}

func (s *Service) forwardTransition(
	ctx context.Context,
	entity string,
	input DocumentRevisionInput,
	actorID, requestID, from, to string,
) (MutationResult, error) {
	if err := validateDocumentRevision(input.DocumentID, input.Revision); err != nil {
		return MutationResult{}, err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return MutationResult{}, s.internal("begin transition", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	q := s.queries.WithTx(tx)
	document, err := q.LockVouDocument(ctx, dbsqlc.LockVouDocumentParams{ID: input.DocumentID, Entity: entity})
	if err = documentWriteConflict(err, document.Revision, input.Revision, document.Status, from); err != nil {
		return MutationResult{}, err
	}
	if err = s.validateStoredAttributes(ctx, q, entity, input.DocumentID); err != nil {
		return MutationResult{}, err
	}
	var revision int64
	switch to {
	case StatusApproved:
		revision, err = q.ApproveVouDocument(ctx, dbsqlc.ApproveVouDocumentParams{
			ActorID: stringPtr(actorID), ID: input.DocumentID, Entity: entity, Revision: input.Revision,
		})
	default:
		return MutationResult{}, domainError(ErrorInternal, "unsupported transition", nil, nil)
	}
	if err != nil {
		return MutationResult{}, s.writeError("transition document", err)
	}
	event := map[string]string{StatusApproved: "APPROVED"}[to]
	if err = insertAudit(ctx, q, auditInput{
		DocumentID: input.DocumentID, Entity: entity, Event: event,
		From: &from, To: to, ActorID: actorID, RequestID: requestID,
	}); err != nil {
		return MutationResult{}, s.writeError("audit transition", err)
	}
	if err = tx.Commit(ctx); err != nil {
		return MutationResult{}, s.writeError("commit transition", err)
	}
	return mutation(document, to, revision), nil
}

func (s *Service) reverseTransition(
	ctx context.Context,
	entity string,
	input ReverseInput,
	actorID, requestID, from, to string,
) (MutationResult, error) {
	reason, err := validateReverse(input)
	if err != nil {
		return MutationResult{}, err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return MutationResult{}, s.internal("begin reverse transition", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	q := s.queries.WithTx(tx)
	document, err := q.LockVouDocument(ctx, dbsqlc.LockVouDocumentParams{ID: input.DocumentID, Entity: entity})
	if err = documentWriteConflict(err, document.Revision, input.Revision, document.Status, from); err != nil {
		return MutationResult{}, err
	}
	var revision int64
	var event string
	switch {
	case from == StatusReviewed && to == StatusDraft:
		revision, err = q.UnreviewVouDocument(ctx, dbsqlc.UnreviewVouDocumentParams{
			ActorID: actorID, ID: input.DocumentID, Entity: entity, Revision: input.Revision,
		})
		event = "UNREVIEWED"
	case from == StatusApproved && to == StatusReviewed:
		revision, err = q.UnapproveVouDocument(ctx, dbsqlc.UnapproveVouDocumentParams{
			ActorID: actorID, ID: input.DocumentID, Entity: entity, Revision: input.Revision,
		})
		event = "UNAPPROVED"
	default:
		return MutationResult{}, domainError(ErrorInternal, "unsupported reverse transition", nil, nil)
	}
	if err != nil {
		return MutationResult{}, s.writeError("reverse transition", err)
	}
	if err = insertAudit(ctx, q, auditInput{
		DocumentID: input.DocumentID, Entity: entity, Event: event,
		From: &from, To: to, ActorID: actorID, Reason: reason, RequestID: requestID,
	}); err != nil {
		return MutationResult{}, s.writeError("audit reverse transition", err)
	}
	if err = tx.Commit(ctx); err != nil {
		return MutationResult{}, s.writeError("commit reverse transition", err)
	}
	return mutation(document, to, revision), nil
}

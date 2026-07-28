package vou

import (
	"context"
	"errors"
	"fmt"

	dbsqlc "github.com/hansonyu183/zerp/backend/internal/database/sqlc"
	"github.com/jackc/pgx/v5"
)

func (s *Service) Create(
	ctx context.Context,
	entity string,
	input CreateInput,
	actorID, requestID string,
) (MutationResult, error) {
	if entity == EntityPurchaseInbound {
		parentEntity, parentDocumentID, err := validateParentInput(
			input.ParentEntity,
			input.ParentDocumentID,
		)
		if err != nil {
			return MutationResult{}, err
		}
		if parentEntity != EntityPurchaseOrder {
			return MutationResult{}, domainError(
				ErrorValidation,
				"purchase inbound parent must be a purchase order",
				nil,
				nil,
			)
		}
		input.Data.SourceDocumentID = parentDocumentID
		return s.CreatePurchaseInbound(ctx, input, actorID, requestID)
	}
	return s.createDocument(ctx, entity, input, actorID, requestID)
}

// CreateManagedSalesOrder is retained for internal callers while WFL
// composition moves to event subscriptions.
func (s *Service) CreateManagedSalesOrder(
	ctx context.Context,
	input CreateInput,
	actorID, requestID string,
) (MutationResult, error) {
	return s.Create(ctx, EntitySaleOrder, input, actorID, requestID)
}

// CreateManagedPurchaseOrder is retained for internal callers while WFL
// composition moves to event subscriptions.
func (s *Service) CreateManagedPurchaseOrder(
	ctx context.Context,
	input CreateInput,
	actorID, requestID string,
) (MutationResult, error) {
	return s.Create(ctx, EntityPurchaseOrder, input, actorID, requestID)
}

func (s *Service) createDocument(
	ctx context.Context,
	entity string,
	input CreateInput,
	actorID, requestID string,
) (MutationResult, error) {
	if isSalesChainEntity(entity) {
		return s.createSalesChain(ctx, entity, input, actorID, requestID)
	}
	draft, err := validateDraft(entity, input.Data)
	if err != nil {
		return MutationResult{}, err
	}
	if !validID(actorID) {
		return MutationResult{}, domainError(ErrorValidation, "invalid actor", nil, nil)
	}
	parentEntity, parentDocumentID, err := validateParentInput(input.ParentEntity, input.ParentDocumentID)
	if err != nil {
		return MutationResult{}, err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return MutationResult{}, s.internal("begin create", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	q := s.queries.WithTx(tx)
	if err = validateParentExists(ctx, tx, parentEntity, parentDocumentID); err != nil {
		return MutationResult{}, err
	}

	counter, err := q.NextVouNumberCounter(ctx, dbsqlc.NextVouNumberCounterParams{
		Entity: entity, BusinessDate: dateValue(draft.BusinessDate),
	})
	if err != nil {
		return MutationResult{}, s.writeError("allocate document number", err)
	}
	documentID := newID()
	documentNo := fmt.Sprintf("%s-%s-%06d", entityPrefix(entity), draft.BusinessDate.Format("20060102"), counter)
	resolved, err := s.resolveDraft(ctx, tx, entity, draft, resolvedDraft{}, true)
	if err != nil {
		return MutationResult{}, err
	}
	if err = applySettlementTerms(entity, &draft, resolved); err != nil {
		return MutationResult{}, err
	}
	err = q.InsertVouDocument(ctx, dbsqlc.InsertVouDocumentParams{
		ID: documentID, Entity: entity, DocumentNo: documentNo,
		BusinessDate: dateValue(draft.BusinessDate), Currency: draft.Currency,
		DueDate:          optionalDate(draft.DueDate),
		TotalAmountCents: draft.TotalAmount, Remark: draft.Remark,
		ParentEntity: nullableString(parentEntity), ParentDocumentID: nullableString(parentDocumentID),
		ActorID: actorID,
	})
	if err != nil {
		return MutationResult{}, s.writeError("insert document", err)
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
	if err = s.events.Publish(ctx, tx, DocumentCreatedEvent{
		Entity: entity, DocumentID: documentID, DocumentNo: documentNo, Revision: 1,
		ParentEntity: parentEntity, ParentDocumentID: parentDocumentID,
		ActorID: actorID, RequestID: requestID,
	}); err != nil {
		return MutationResult{}, s.writeError("publish document created", err)
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
	if isSalesChainEntity(entity) {
		return s.saveSalesChain(ctx, entity, input, actorID, requestID)
	}
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
	if err = s.validateManagedSalesParentStatus(ctx, tx, document, StatusChecked); err != nil {
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
	if err = applySettlementTerms(entity, &draft, resolved); err != nil {
		return MutationResult{}, err
	}
	if err = s.updateDetail(ctx, q, entity, input.DocumentID, draft, resolved); err != nil {
		return MutationResult{}, s.writeError("update document detail", err)
	}
	revision, err := q.UpdateVouDraft(ctx, dbsqlc.UpdateVouDraftParams{
		BusinessDate: dateValue(draft.BusinessDate), Currency: draft.Currency,
		DueDate:          optionalDate(draft.DueDate),
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
	if err = s.touchWorkflow(
		ctx, tx, document, "SAVED", StatusDraft, actorID, requestID,
		map[string]any{"revision": revision},
	); err != nil {
		return MutationResult{}, err
	}
	if err = s.events.Publish(ctx, tx, DocumentChangedEvent{
		Action: "SAVED", Entity: entity, DocumentID: document.ID,
		DocumentNo: document.DocumentNo, Status: StatusDraft, Revision: revision,
		ActorID: actorID, RequestID: requestID,
	}); err != nil {
		return MutationResult{}, err
	}
	if err = tx.Commit(ctx); err != nil {
		return MutationResult{}, s.writeError("commit save", err)
	}
	return MutationResult{
		DocumentID: input.DocumentID, DocumentNo: document.DocumentNo, Status: StatusDraft, Revision: revision,
	}, nil
}

func (s *Service) Check(
	ctx context.Context, entity string, input DocumentRevisionInput, actorID, requestID string,
) (MutationResult, error) {
	if err := validateDocumentRevision(input.DocumentID, input.Revision); err != nil {
		return MutationResult{}, err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return MutationResult{}, s.internal("begin check", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	q := s.queries.WithTx(tx)
	document, err := q.LockVouDocument(ctx, dbsqlc.LockVouDocumentParams{ID: input.DocumentID, Entity: entity})
	if err = documentWriteConflict(err, document.Revision, input.Revision, document.Status, StatusDraft); err != nil {
		return MutationResult{}, err
	}
	if err = s.validateManagedSalesParentStatus(ctx, tx, document, StatusChecked); err != nil {
		return MutationResult{}, err
	}
	if err = s.validateManagedSalesReady(ctx, tx, document); err != nil {
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
	revision, err := q.CheckVouDocument(ctx, dbsqlc.CheckVouDocumentParams{
		ActorID: stringPtr(actorID), ID: input.DocumentID, Entity: entity, Revision: input.Revision,
	})
	if err != nil {
		return MutationResult{}, s.writeError("check document", err)
	}
	if err = insertAudit(ctx, q, auditInput{
		DocumentID: input.DocumentID, Entity: entity, Event: "CHECKED",
		From: stringPtr(StatusDraft), To: StatusChecked, ActorID: actorID, RequestID: requestID,
	}); err != nil {
		return MutationResult{}, s.writeError("audit check", err)
	}
	if err = s.touchWorkflow(
		ctx, tx, document, "CHECKED", StatusChecked, actorID, requestID, nil,
	); err != nil {
		return MutationResult{}, err
	}
	if err = s.events.Publish(ctx, tx, DocumentChangedEvent{
		Action: "CHECKED", Entity: entity, DocumentID: document.ID,
		DocumentNo: document.DocumentNo, Status: StatusChecked, Revision: revision,
		ActorID: actorID, RequestID: requestID,
	}); err != nil {
		return MutationResult{}, err
	}
	if err = tx.Commit(ctx); err != nil {
		return MutationResult{}, s.writeError("commit check", err)
	}
	return mutation(document, StatusChecked, revision), nil
}

func (s *Service) Approve(
	ctx context.Context, entity string, input DocumentRevisionInput, actorID, requestID string,
) (MutationResult, error) {
	return s.forwardTransition(ctx, entity, input, actorID, requestID, StatusChecked, StatusApproved)
}

func (s *Service) Uncheck(
	ctx context.Context, entity string, input ReverseInput, actorID, requestID string,
) (MutationResult, error) {
	return s.reverseTransition(ctx, entity, input, actorID, requestID, StatusChecked, StatusDraft)
}

func (s *Service) Unapprove(
	ctx context.Context, entity string, input ReverseInput, actorID, requestID string,
) (MutationResult, error) {
	return s.reverseTransition(ctx, entity, input, actorID, requestID, StatusApproved, StatusChecked)
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
	if err = s.validateManagedSalesParentStatus(ctx, tx, document, to); err != nil {
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
	summary, err := s.onManagedSalesApproved(ctx, tx, document, actorID, requestID)
	if err != nil {
		return MutationResult{}, err
	}
	if err = s.touchWorkflow(
		ctx, tx, document, event, to, actorID, requestID, summary,
	); err != nil {
		return MutationResult{}, err
	}
	if err = s.events.Publish(ctx, tx, DocumentChangedEvent{
		Action: event, Entity: entity, DocumentID: document.ID,
		DocumentNo: document.DocumentNo, Status: to, Revision: revision,
		ActorID: actorID, RequestID: requestID,
	}); err != nil {
		return MutationResult{}, err
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
	if managedSalesDocument(document) && from == StatusApproved && to == StatusChecked {
		if err = s.removeUntouchedGeneratedChildren(ctx, tx, document.ID); err != nil {
			return MutationResult{}, err
		}
	} else if managedSalesDocument(document) {
		if err = s.validateManagedSalesChildrenAtMost(ctx, tx, document, to); err != nil {
			return MutationResult{}, err
		}
	}
	if managedPurchaseDocument(document) && document.Entity == EntityPurchaseOrder &&
		from == StatusApproved && to == StatusChecked {
		var children int64
		if err = tx.QueryRow(ctx, `SELECT count(*) FROM vou_purchase_inbound_details
			WHERE source_order_id=$1`, document.ID).Scan(&children); err != nil {
			return MutationResult{}, err
		}
		if children != 0 {
			return MutationResult{}, domainError(
				ErrorConflict, "purchase order has inbound documents", nil, nil,
			)
		}
	}
	var revision int64
	var event string
	switch {
	case from == StatusChecked && to == StatusDraft:
		revision, err = q.UncheckVouDocument(ctx, dbsqlc.UncheckVouDocumentParams{
			ActorID: actorID, ID: input.DocumentID, Entity: entity, Revision: input.Revision,
		})
		event = "UNCHECKED"
	case from == StatusApproved && to == StatusChecked:
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
	if err = s.touchWorkflow(
		ctx, tx, document, event, to, actorID, requestID, nil,
	); err != nil {
		return MutationResult{}, err
	}
	if err = s.events.Publish(ctx, tx, DocumentChangedEvent{
		Action: event, Entity: entity, DocumentID: document.ID,
		DocumentNo: document.DocumentNo, Status: to, Revision: revision,
		ActorID: actorID, RequestID: requestID, Reason: *reason,
	}); err != nil {
		return MutationResult{}, err
	}
	if err = tx.Commit(ctx); err != nil {
		return MutationResult{}, s.writeError("commit reverse transition", err)
	}
	return mutation(document, to, revision), nil
}

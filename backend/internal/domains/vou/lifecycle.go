package vou

import (
	"context"
	"errors"
	"fmt"

	dbsqlc "github.com/hansonyu183/zerp/backend/internal/database/sqlc"
	"github.com/hansonyu183/zerp/backend/internal/platform/approval"
	"github.com/jackc/pgx/v5"
)

func (s *Service) Create(
	ctx context.Context,
	entity string,
	input CreateInput,
	actor approval.Actor,
) (MutationResult, error) {
	if entity == EntityIntermediaryCalculation {
		return s.CreateIntermediaryCalculation(ctx, input, actor)
	}
	if isAssetEntity(entity) {
		return s.CreateAssetDocument(ctx, entity, input, actor)
	}
	if isProductionEntity(entity) {
		return s.CreateProduction(ctx, entity, input, actor)
	}
	if entity == EntitySaleReturn {
		return s.CreateSaleReturn(ctx, input, actor)
	}
	if entity == EntityPurchaseReturn {
		return s.CreatePurchaseReturn(ctx, input, actor)
	}
	return s.createDocument(ctx, entity, input, actor)
}

func (s *Service) createDocument(
	ctx context.Context,
	entity string,
	input CreateInput,
	actor approval.Actor,
) (MutationResult, error) {
	actorID, requestID := actor.ID(), actor.RequestID()
	if isSalesChainEntity(entity) {
		return s.createSalesChain(ctx, entity, input, actor)
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
		Entity: numberingEntity(entity), BusinessDate: dateValue(draft.BusinessDate),
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return MutationResult{}, domainError(ErrorConflict, "document number exhausted", nil, nil)
		}
		return MutationResult{}, s.writeError("allocate document number", err)
	}
	documentID := newID()
	documentNo := fmt.Sprintf("%s-%s-%04d", entityPrefix(entity), draft.BusinessDate.Format("20060102"), counter)
	coordinator, err := s.coordinator(entity)
	if err != nil {
		return MutationResult{}, err
	}
	entry, err := coordinator.CreateSubject(ctx, tx, documentID, actor, DocumentView{})
	if err != nil {
		return MutationResult{}, mapApprovalError(err)
	}
	resolved, err := s.resolveDraft(ctx, tx, entity, draft, resolvedDraft{}, true)
	if err != nil {
		return MutationResult{}, err
	}
	if err = applySettlementTerms(entity, &draft, resolved); err != nil {
		return MutationResult{}, err
	}
	if err = s.applyPriceReferences(ctx, q, entity, &draft, resolved); err != nil {
		return MutationResult{}, err
	}
	if entity == EntityBillPayment || entity == EntityBillDiscount {
		draft.TotalAmount, err = s.billPaymentTotal(ctx, q, draft.BillLines, draft.BusinessDate)
		if err != nil {
			return MutationResult{}, err
		}
	}
	if entity == EntityBillMaturity {
		draft.TotalAmount, err = s.billMaturityTotal(ctx, q, draft.BillLines, draft.BusinessDate)
		if err != nil {
			return MutationResult{}, err
		}
	}
	err = q.InsertVouDocument(ctx, dbsqlc.InsertVouDocumentParams{
		ID: documentID, Entity: entity, DocumentNo: documentNo, ApprovalEntryID: entry.ID,
		BusinessDate: dateValue(draft.BusinessDate), Currency: stringPtr(draft.Currency),
		DueDate:          optionalDate(draft.DueDate),
		TotalAmountCents: draft.TotalAmount, Remark: draft.Remark,
		ParentEntity: nullableString(parentEntity), ParentDocumentID: nullableString(parentDocumentID),
	})
	if err != nil {
		return MutationResult{}, s.writeError("insert document", err)
	}
	if err = s.insertDetail(ctx, q, entity, documentID, draft, resolved); err != nil {
		return MutationResult{}, s.writeError("insert document detail", err)
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
	return MutationResult{DocumentID: documentID, DocumentNo: documentNo, Approval: approval.MetaFromEntry(entry)}, nil
}

func (s *Service) Save(
	ctx context.Context,
	entity string,
	input SaveInput,
	actor approval.Actor,
) (MutationResult, error) {
	if entity == EntityIntermediaryCalculation {
		return s.SaveIntermediaryCalculation(ctx, input, actor)
	}
	if isAssetEntity(entity) {
		return s.SaveAssetDocument(ctx, entity, input, actor)
	}
	if isProductionEntity(entity) {
		return s.SaveProduction(ctx, entity, input, actor)
	}
	if isSalesChainEntity(entity) {
		return s.saveSalesChain(ctx, entity, input, actor)
	}
	if entity == EntitySaleReturn {
		return s.SaveSaleReturn(ctx, input, actor)
	}
	if entity == EntityPurchaseReturn {
		return s.SavePurchaseReturn(ctx, input, actor)
	}
	if entity == EntityExpensePayment {
		return s.SaveExpensePayment(ctx, input, actor)
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
	document, err := lockDocument(ctx, tx, input.DocumentID, entity)
	if err = documentWriteConflict(err, document.Revision, input.Revision, document.Status, StatusDraft); err != nil {
		return MutationResult{}, err
	}
	coordinator, err := s.coordinator(entity)
	if err != nil {
		return MutationResult{}, err
	}
	preparedApproval, err := coordinator.Prepare(ctx, tx, approval.ActionSaved, document.ApprovalEntryID, input.Revision, actor, "")
	if err != nil {
		return MutationResult{}, mapApprovalError(err)
	}
	if err = s.validateManagedSalesParentStatus(ctx, tx, document, StatusPending); err != nil {
		return MutationResult{}, err
	}
	preserved, err := s.loadPreservedReferences(ctx, q, document)
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
	if err = s.applyPriceReferences(ctx, q, entity, &draft, resolved); err != nil {
		return MutationResult{}, err
	}
	if err = s.updateDetail(ctx, q, entity, input.DocumentID, draft, resolved); err != nil {
		return MutationResult{}, s.writeError("update document detail", err)
	}
	if entity == EntityBillPayment || entity == EntityBillDiscount || entity == EntityBillMaturity {
		draft.TotalAmount, err = q.SumVouBillLineFaceAmounts(ctx, input.DocumentID)
		if err != nil {
			return MutationResult{}, s.writeError("sum bill payment amount", err)
		}
	}
	_, err = q.UpdateVouDraft(ctx, dbsqlc.UpdateVouDraftParams{
		BusinessDate: dateValue(draft.BusinessDate), Currency: stringPtr(draft.Currency),
		DueDate:          optionalDate(draft.DueDate),
		TotalAmountCents: draft.TotalAmount, Remark: draft.Remark,
		ID: input.DocumentID, Entity: entity,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return MutationResult{}, domainError(ErrorConflict, "document changed", nil, err)
	}
	if err != nil {
		return MutationResult{}, s.writeError("update draft", err)
	}
	document, err = scanDocument(tx.QueryRow(ctx, documentSelect, input.DocumentID, entity))
	if err != nil {
		return MutationResult{}, s.internal("read saved document", err)
	}
	entry, err := coordinator.CommitWithPayload(ctx, tx, preparedApproval, func(entry approval.Entry) (DocumentView, error) {
		return s.eventSnapshot(ctx, q, document.withApproval(entry))
	})
	if err != nil {
		return MutationResult{}, mapApprovalError(err)
	}
	if err = tx.Commit(ctx); err != nil {
		return MutationResult{}, s.writeError("commit save", err)
	}
	return MutationResult{DocumentID: input.DocumentID, DocumentNo: document.DocumentNo, Approval: approval.MetaFromEntry(entry)}, nil
}

func (s *Service) Submit(
	ctx context.Context, entity string, input DocumentRevisionInput, actor approval.Actor,
) (MutationResult, error) {
	if err := validateDocumentRevision(input.DocumentID, input.Revision); err != nil {
		return MutationResult{}, err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return MutationResult{}, s.internal("begin submit", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	q := s.queries.WithTx(tx)
	document, err := lockDocument(ctx, tx, input.DocumentID, entity)
	if err = documentWriteConflict(err, document.Revision, input.Revision, document.Status, StatusDraft); err != nil {
		return MutationResult{}, err
	}
	coordinator, err := s.coordinator(entity)
	if err != nil {
		return MutationResult{}, err
	}
	preparedApproval, err := coordinator.Prepare(ctx, tx, approval.ActionSubmitted, document.ApprovalEntryID, input.Revision, actor, "")
	if err != nil {
		return MutationResult{}, mapApprovalError(err)
	}
	if err = s.validateManagedSalesParentStatus(ctx, tx, document, StatusPending); err != nil {
		return MutationResult{}, err
	}
	if err = s.validateManagedSalesReady(ctx, tx, document); err != nil {
		return MutationResult{}, err
	}
	if err = s.validateStoredAttributes(ctx, q, entity, input.DocumentID); err != nil {
		return MutationResult{}, err
	}
	if entity == EntitySaleDelivery {
		if err = s.validateSaleDeliveryTransportCurrent(ctx, tx, input.DocumentID); err != nil {
			return MutationResult{}, err
		}
	}
	pending, err := q.CountPendingVouAttachments(ctx, input.DocumentID)
	if err != nil {
		return MutationResult{}, s.internal("count pending attachments", err)
	}
	if pending != 0 {
		return MutationResult{}, domainError(ErrorConflict, "attachments are still uploading", nil, nil)
	}
	entry, err := coordinator.CommitWithPayload(ctx, tx, preparedApproval, func(entry approval.Entry) (DocumentView, error) {
		return s.eventSnapshot(ctx, q, document.withApproval(entry))
	})
	if err != nil {
		return MutationResult{}, mapApprovalError(err)
	}
	if err = tx.Commit(ctx); err != nil {
		return MutationResult{}, s.writeError("commit submit", err)
	}
	return mutation(document, entry), nil
}

func (s *Service) Approve(
	ctx context.Context, entity string, input DocumentRevisionInput, actor approval.Actor,
) (MutationResult, error) {
	return s.forwardTransition(ctx, entity, input, actor)
}

func (s *Service) Unsubmit(
	ctx context.Context, entity string, input DocumentRevisionInput, actor approval.Actor,
) (MutationResult, error) {
	if err := validateDocumentRevision(input.DocumentID, input.Revision); err != nil {
		return MutationResult{}, err
	}
	return s.unsubmit(ctx, entity, input, actor)
}

func (s *Service) Unapprove(
	ctx context.Context, entity string, input ReverseInput, actor approval.Actor,
) (MutationResult, error) {
	reason, err := validateReverse(input)
	if err != nil {
		return MutationResult{}, err
	}
	return s.reverseTransition(ctx, entity, DocumentRevisionInput{
		DocumentID: input.DocumentID,
		Revision:   input.Revision,
	}, actor, *reason)
}

func (s *Service) forwardTransition(
	ctx context.Context,
	entity string,
	input DocumentRevisionInput,
	actor approval.Actor,
) (MutationResult, error) {
	actorID := actor.ID()
	from, to := StatusPending, StatusApproved
	if err := validateDocumentRevision(input.DocumentID, input.Revision); err != nil {
		return MutationResult{}, err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return MutationResult{}, s.internal("begin transition", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	q := s.queries.WithTx(tx)
	document, err := lockDocument(ctx, tx, input.DocumentID, entity)
	if err = documentWriteConflict(err, document.Revision, input.Revision, document.Status, from); err != nil {
		return MutationResult{}, err
	}
	coordinator, err := s.coordinator(entity)
	if err != nil {
		return MutationResult{}, err
	}
	preparedApproval, err := coordinator.Prepare(ctx, tx, approval.ActionApproved, document.ApprovalEntryID, input.Revision, actor, "")
	if err != nil {
		return MutationResult{}, mapApprovalError(err)
	}
	if err = s.validateManagedSalesParentStatus(ctx, tx, document, to); err != nil {
		return MutationResult{}, err
	}
	if err = s.validateStoredAttributes(ctx, q, entity, input.DocumentID); err != nil {
		return MutationResult{}, err
	}
	if entity == EntitySaleDelivery {
		if err = s.validateSaleDeliveryTransportCurrent(ctx, tx, input.DocumentID); err != nil {
			return MutationResult{}, err
		}
	}
	if entity == EntityIntermediaryCalculation {
		if err = s.validateIntermediarySalesContracts(ctx, q, input.DocumentID); err != nil {
			return MutationResult{}, err
		}
	}
	if err = s.validateOrderSettlement(ctx, tx, entity, input.DocumentID); err != nil {
		return MutationResult{}, err
	}
	switch entity {
	case EntityInventoryCount:
		_, err = s.prepareInventoryCountFinalization(ctx, tx, q, document)
	case EntitySaleOutbound, EntitySaleDelivery, EntitySaleSignoff:
		_, err = s.prepareSalesChainApproval(ctx, tx, document)
	}
	if err != nil {
		return MutationResult{}, err
	}
	if err = s.validateFulfillmentSettlement(ctx, tx, entity, input.DocumentID); err != nil {
		return MutationResult{}, err
	}
	entry, err := coordinator.CommitWithPayload(ctx, tx, preparedApproval, func(entry approval.Entry) (DocumentView, error) {
		return s.eventSnapshot(ctx, q, document.withApproval(entry))
	})
	if err != nil {
		return MutationResult{}, mapApprovalError(err)
	}
	if entity == EntitySaleSignoff {
		if err = s.refreshSaleOrderFulfillment(ctx, tx, input.DocumentID, actorID); err != nil {
			return MutationResult{}, err
		}
	}
	if entity == EntityPurchaseInbound || entity == EntityPurchaseReturn {
		if err = s.refreshPurchaseOrderFulfillment(ctx, tx, input.DocumentID, actorID); err != nil {
			return MutationResult{}, err
		}
	}
	if err = tx.Commit(ctx); err != nil {
		return MutationResult{}, s.writeError("commit transition", err)
	}
	return mutation(document, entry), nil
}

func (s *Service) unsubmit(
	ctx context.Context, entity string, input DocumentRevisionInput, actor approval.Actor,
) (MutationResult, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return MutationResult{}, s.internal("begin unsubmit", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	q := s.queries.WithTx(tx)
	document, err := lockDocument(ctx, tx, input.DocumentID, entity)
	if err = documentWriteConflict(err, document.Revision, input.Revision, document.Status, StatusPending); err != nil {
		return MutationResult{}, err
	}
	coordinator, err := s.coordinator(entity)
	if err != nil {
		return MutationResult{}, err
	}
	preparedApproval, err := coordinator.Prepare(ctx, tx, approval.ActionUnsubmitted, document.ApprovalEntryID, input.Revision, actor, "")
	if err != nil {
		return MutationResult{}, mapApprovalError(err)
	}
	if managedSalesDocument(document) {
		if err = s.validateManagedSalesChildrenAtMost(ctx, tx, document, StatusDraft); err != nil {
			return MutationResult{}, err
		}
	}
	entry, err := coordinator.CommitWithPayload(ctx, tx, preparedApproval, func(entry approval.Entry) (DocumentView, error) {
		return s.eventSnapshot(ctx, q, document.withApproval(entry))
	})
	if err != nil {
		return MutationResult{}, mapApprovalError(err)
	}
	if err = tx.Commit(ctx); err != nil {
		return MutationResult{}, s.writeError("commit unsubmit", err)
	}
	return mutation(document, entry), nil
}

func (s *Service) reverseTransition(
	ctx context.Context, entity string, input DocumentRevisionInput, actor approval.Actor, reason string,
) (MutationResult, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return MutationResult{}, s.internal("begin unapprove", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	q := s.queries.WithTx(tx)
	document, err := lockDocument(ctx, tx, input.DocumentID, entity)
	if err = documentWriteConflict(err, document.Revision, input.Revision, document.Status, StatusApproved); err != nil {
		return MutationResult{}, err
	}
	coordinator, err := s.coordinator(entity)
	if err != nil {
		return MutationResult{}, err
	}
	preparedApproval, err := coordinator.Prepare(ctx, tx, approval.ActionUnapproved, document.ApprovalEntryID, input.Revision, actor, reason)
	if err != nil {
		return MutationResult{}, mapApprovalError(err)
	}
	unapprovalSnapshot, err := s.eventSnapshot(ctx, q, document)
	if err != nil {
		return MutationResult{}, err
	}
	if err = s.prepareUnapproval(ctx, tx, document, actor.ID(), actor.RequestID()); err != nil {
		return MutationResult{}, err
	}
	if err = s.removeUntouchedGeneratedChildren(ctx, tx, document.ID); err != nil {
		return MutationResult{}, err
	}
	entry, err := coordinator.Commit(ctx, tx, preparedApproval, unapprovalSnapshot)
	if err != nil {
		return MutationResult{}, mapApprovalError(err)
	}
	if err = s.finishUnapproval(ctx, tx, document, actor.ID()); err != nil {
		return MutationResult{}, err
	}
	if entity == EntityInventoryCount {
		if err = q.ClearVouInventoryCountResults(ctx, input.DocumentID); err != nil {
			return MutationResult{}, s.writeError("clear inventory count result", err)
		}
	}
	if err = tx.Commit(ctx); err != nil {
		return MutationResult{}, s.writeError("commit unapprove", err)
	}
	return mutation(document, entry), nil
}

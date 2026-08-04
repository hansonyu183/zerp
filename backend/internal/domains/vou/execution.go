package vou

import (
	"context"
	"encoding/json"

	dbsqlc "github.com/hansonyu183/zerp/backend/internal/database/sqlc"
)

func (s *Service) Finalize(
	ctx context.Context, entity string, input FinalizeInput, actorID, requestID string,
) (MutationResult, error) {
	if !validEntity(entity) {
		return MutationResult{}, domainError(ErrorValidation, "invalid entity", nil, nil)
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return MutationResult{}, s.internal("begin finalize", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	q := s.queries.WithTx(tx)
	document, err := q.LockVouDocument(ctx, dbsqlc.LockVouDocumentParams{ID: input.DocumentID, Entity: entity})
	if err = documentWriteConflict(err, document.Revision, input.Revision, document.Status, StatusApproved); err != nil {
		return MutationResult{}, err
	}
	if err = s.validateManagedSalesParentStatus(ctx, tx, document, StatusFinalized); err != nil {
		return MutationResult{}, err
	}
	if err = s.validateStoredAttributes(ctx, q, entity, input.DocumentID); err != nil {
		return MutationResult{}, err
	}
	var summary map[string]any
	switch entity {
	case EntityInventoryCount:
		if err = validateFinancialExecution(input); err == nil {
			summary, err = s.prepareInventoryCountFinalization(ctx, tx, q, document)
		}
	case EntitySaleOutbound, EntitySaleDelivery, EntitySaleSignoff:
		if err = validateFinancialExecution(input); err == nil {
			summary, err = s.prepareSalesChainFinalization(ctx, tx, document)
		}
	default:
		if err = validateFinancialExecution(input); err == nil {
			summary = map[string]any{"confirmed": true}
		}
	}
	if err != nil {
		return MutationResult{}, err
	}
	revision, err := q.FinalizeVouDocument(ctx, dbsqlc.FinalizeVouDocumentParams{
		ActorID: stringPtr(actorID), ID: input.DocumentID, Entity: entity, Revision: input.Revision,
	})
	if err != nil {
		return MutationResult{}, s.writeError("finalize document", err)
	}
	if entity == EntitySaleSignoff {
		if err = s.adjustFulfillmentSettlement(ctx, tx, entity, input.DocumentID, false); err != nil {
			return MutationResult{}, s.writeError("release prepaid settlement reservation", err)
		}
		if err = s.refreshSaleOrderFulfillment(ctx, tx, input.DocumentID, actorID); err != nil {
			return MutationResult{}, err
		}
		if err = s.ensureRefusalReturnDraft(ctx, tx, input.DocumentID, actorID, requestID); err != nil {
			return MutationResult{}, s.writeError("create refusal return draft", err)
		}
	}
	if entity == EntityPurchaseInbound {
		if err = s.adjustFulfillmentSettlement(ctx, tx, entity, input.DocumentID, false); err != nil {
			return MutationResult{}, s.writeError("release prepaid settlement reservation", err)
		}
		if err = s.refreshPurchaseOrderFulfillment(ctx, tx, input.DocumentID, actorID); err != nil {
			return MutationResult{}, err
		}
	}
	if entity == EntityPurchaseReturn {
		if err = s.refreshPurchaseOrderFulfillment(ctx, tx, input.DocumentID, actorID); err != nil {
			return MutationResult{}, err
		}
	}
	if err = s.replenishManagedOutbound(ctx, tx, document, actorID, requestID); err != nil {
		return MutationResult{}, err
	}
	if err = insertAudit(ctx, q, auditInput{
		DocumentID: input.DocumentID, Entity: entity, Event: "FINALIZED",
		From: stringPtr(StatusApproved), To: StatusFinalized, ActorID: actorID,
		RequestID: requestID, Summary: summary,
	}); err != nil {
		return MutationResult{}, s.writeError("audit finalize", err)
	}
	if err = s.events.Publish(ctx, tx, DocumentFinalizedEvent{
		Entity: entity, DocumentID: input.DocumentID, DocumentNo: document.DocumentNo,
		Revision: revision, ActorID: actorID, RequestID: requestID,
	}); err != nil {
		return MutationResult{}, s.eventError("publish document finalized", err)
	}
	if err = s.touchWorkflow(
		ctx, tx, document, "FINALIZED", StatusFinalized, actorID, requestID, summary,
	); err != nil {
		return MutationResult{}, err
	}
	if err = tx.Commit(ctx); err != nil {
		return MutationResult{}, s.writeError("commit finalize", err)
	}
	return mutation(document, StatusFinalized, revision), nil
}

func (s *Service) Unfinalize(
	ctx context.Context, entity string, input ReverseInput, actorID, requestID string,
) (MutationResult, error) {
	reason, err := validateReverse(input)
	if err != nil {
		return MutationResult{}, err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return MutationResult{}, s.internal("begin unfinalize", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	q := s.queries.WithTx(tx)
	document, err := q.LockVouDocument(ctx, dbsqlc.LockVouDocumentParams{ID: input.DocumentID, Entity: entity})
	if err = documentWriteConflict(err, document.Revision, input.Revision, document.Status, StatusFinalized); err != nil {
		return MutationResult{}, err
	}
	if managedSalesDocument(document) {
		if entity == EntitySaleSignoff {
			if err = s.removeSignoffReturnDrafts(ctx, tx, document, actorID, requestID); err != nil {
				return MutationResult{}, err
			}
		}
		if err = s.validateManagedSalesChildrenAtMost(
			ctx, tx, document, StatusApproved,
		); err != nil {
			return MutationResult{}, err
		}
	} else {
		if err = s.ensureNoSalesChainChildren(ctx, tx, document); err != nil {
			return MutationResult{}, err
		}
	}
	if entity == EntityPurchaseInbound {
		var hasReturns bool
		if err = tx.QueryRow(ctx, `SELECT EXISTS(
			SELECT 1 FROM vou_purchase_return_lines WHERE source_inbound_id=$1
		)`, input.DocumentID).Scan(&hasReturns); err != nil {
			return MutationResult{}, err
		}
		if hasReturns {
			return MutationResult{}, domainError(ErrorConflict, "purchase inbound has return documents", nil, nil)
		}
	}
	if entity == EntityPurchaseReturn {
		var overbooked bool
		if err = tx.QueryRow(ctx, `SELECT EXISTS(
			SELECT 1 FROM vou_product_lines o
			WHERE o.document_id=$1 AND (
				SELECT COALESCE(sum(i.quantity_micros),0)
				FROM vou_purchase_inbound_lines i
				JOIN vou_purchase_inbound_details x ON x.document_id=i.document_id
				WHERE x.source_order_id=$1 AND i.source_order_line_id=o.id
			) - (
				SELECT COALESCE(sum(r.quantity_micros),0)
				FROM vou_purchase_return_lines r
				JOIN vou_documents d ON d.id=r.document_id
				WHERE r.source_order_line_id=o.id AND d.status='FINALIZED' AND r.document_id<>$2
			) > o.ordered_qty_micros
		)`, deref(document.ParentDocumentID), input.DocumentID).Scan(&overbooked); err != nil {
			return MutationResult{}, err
		}
		if overbooked {
			return MutationResult{}, domainError(ErrorConflict,
				"replacement inbound has consumed returned capacity", nil, nil)
		}
	}
	summary, err := s.finalizationSummary(ctx, q, entity, input.DocumentID)
	if err != nil {
		return MutationResult{}, s.internal("read execution for reversal", err)
	}
	revision, err := q.UnfinalizeVouDocument(ctx, dbsqlc.UnfinalizeVouDocumentParams{
		ActorID: actorID, ID: input.DocumentID, Entity: entity, Revision: input.Revision,
	})
	if err != nil {
		return MutationResult{}, s.writeError("unfinalize document", err)
	}
	if entity == EntitySaleSignoff {
		if err = s.refreshSaleOrderFulfillment(ctx, tx, input.DocumentID, actorID); err != nil {
			return MutationResult{}, err
		}
	}
	if entity == EntityPurchaseInbound {
		if err = s.refreshPurchaseOrderFulfillment(ctx, tx, input.DocumentID, actorID); err != nil {
			return MutationResult{}, err
		}
	}
	if entity == EntityPurchaseReturn {
		if err = s.refreshPurchaseOrderFulfillment(ctx, tx, input.DocumentID, actorID); err != nil {
			return MutationResult{}, err
		}
	}
	if err = insertAudit(ctx, q, auditInput{
		DocumentID: input.DocumentID, Entity: entity, Event: "UNFINALIZED",
		From: stringPtr(StatusFinalized), To: StatusApproved, ActorID: actorID,
		Reason: reason, RequestID: requestID, Summary: summary,
	}); err != nil {
		return MutationResult{}, s.writeError("audit unfinalize", err)
	}
	if err = s.events.Publish(ctx, tx, DocumentUnfinalizedEvent{
		Entity: entity, DocumentID: input.DocumentID, DocumentNo: document.DocumentNo,
		Revision: revision, ActorID: actorID, RequestID: requestID, Reason: *reason,
	}); err != nil {
		return MutationResult{}, s.eventError("publish document unfinalized", err)
	}
	if entity == EntitySaleSignoff || entity == EntityPurchaseInbound {
		if err = s.adjustFulfillmentSettlement(ctx, tx, entity, input.DocumentID, true); err != nil {
			return MutationResult{}, s.writeError("restore settlement reservation", err)
		}
	}
	if entity == EntityInventoryCount {
		if err = q.ClearVouInventoryCountResults(ctx, input.DocumentID); err != nil {
			return MutationResult{}, s.writeError("clear inventory count result", err)
		}
	}
	if err = s.touchWorkflow(
		ctx, tx, document, "UNFINALIZED", StatusApproved, actorID, requestID, summary,
	); err != nil {
		return MutationResult{}, err
	}
	if err = tx.Commit(ctx); err != nil {
		return MutationResult{}, s.writeError("commit unfinalize", err)
	}
	return mutation(document, StatusApproved, revision), nil
}

func (s *Service) finalizationSummary(
	ctx context.Context, q *dbsqlc.Queries, entity, documentID string,
) (map[string]any, error) {
	document, err := q.GetVouDocument(ctx, dbsqlc.GetVouDocumentParams{ID: documentID, Entity: entity})
	if err != nil {
		return nil, err
	}
	data, err := s.loadData(ctx, q, document)
	if err != nil {
		return nil, err
	}
	encoded, err := json.Marshal(data)
	if err != nil {
		return nil, err
	}
	var summary map[string]any
	if err = json.Unmarshal(encoded, &summary); err != nil {
		return nil, err
	}
	return summary, nil
}

type auditInput struct {
	DocumentID, Entity, Event, To, ActorID, RequestID string
	From, Reason                                      *string
	Summary                                           map[string]any
}

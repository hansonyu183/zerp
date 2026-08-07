package vou

import (
	"context"

	dbsqlc "github.com/hansonyu183/zerp/backend/internal/database/sqlc"
	"github.com/jackc/pgx/v5"
)

func (s *Service) prepareUnapproval(
	ctx context.Context,
	tx pgx.Tx,
	document dbsqlc.VouDocument,
	actorID string,
	requestID string,
) error {
	if document.Entity == EntityIntermediaryCalculation {
		q := s.queries.WithTx(tx)
		if _, err := q.LockLedControl(ctx); err != nil {
			return s.internal("lock ledger control for intermediary calculation reversal", err)
		}
		hasDependents, err := q.HasApprovedIntermediaryCalculationDependents(ctx, stringPtr(document.ID))
		if err != nil {
			return s.internal("read intermediary calculation dependents", err)
		}
		if hasDependents {
			return domainError(ErrorConflict, "later intermediary calculations must be reversed first", nil, nil)
		}
	}
	if document.Entity == EntitySaleSignoff {
		if err := s.removeSignoffReturnDrafts(ctx, tx, document, actorID, requestID); err != nil {
			return err
		}
	}
	if document.Entity == EntityPurchaseInbound {
		var hasReturns bool
		if err := tx.QueryRow(ctx, `SELECT EXISTS(
			SELECT 1 FROM vou_purchase_return_lines WHERE source_inbound_id=$1
		)`, document.ID).Scan(&hasReturns); err != nil {
			return err
		}
		if hasReturns {
			return domainError(ErrorConflict, "purchase inbound has return documents", nil, nil)
		}
	}
	if document.Entity == EntityPurchaseReturn {
		var overbooked bool
		if err := tx.QueryRow(ctx, `SELECT EXISTS(
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
				WHERE r.source_order_line_id=o.id
				  AND d.status IN ('APPROVED','FINALIZED') AND r.document_id<>$2
			) > o.ordered_qty_micros
		)`, deref(document.ParentDocumentID), document.ID).Scan(&overbooked); err != nil {
			return err
		}
		if overbooked {
			return domainError(ErrorConflict,
				"replacement inbound has consumed returned capacity", nil, nil)
		}
	}
	return nil
}

func (s *Service) finishUnapproval(
	ctx context.Context,
	tx pgx.Tx,
	document dbsqlc.VouDocument,
	actorID string,
) error {
	switch document.Entity {
	case EntitySaleSignoff:
		return s.refreshSaleOrderFulfillment(ctx, tx, document.ID, actorID)
	case EntityPurchaseInbound, EntityPurchaseReturn:
		return s.refreshPurchaseOrderFulfillment(ctx, tx, document.ID, actorID)
	default:
		return nil
	}
}

package vou

import (
	"context"

	"github.com/hansonyu183/zerp/backend/internal/platform/approval"
	"github.com/hansonyu183/zerp/backend/internal/platform/systemidentity"
	"github.com/jackc/pgx/v5"
)

func (s *Service) removeUntouchedGeneratedChildren(ctx context.Context, tx pgx.Tx, parentID string) error {
	rows, err := s.queries.WithTx(tx).ListGeneratedWorkflowChildrenForUpdate(ctx, &parentID)
	if err != nil {
		return err
	}
	type child struct {
		id, entity, status, createdBy string
		revision                      int64
		hasAttachments                bool
	}
	children := make([]child, 0)
	for _, row := range rows {
		children = append(children, child{
			id: row.ID, entity: row.Entity, status: row.Status, revision: row.Revision,
			createdBy: row.CreatedBy, hasAttachments: row.HasAttachments,
		})
	}
	for _, value := range children {
		if value.status != StatusDraft || value.revision != 1 || value.createdBy != systemidentity.UserID || value.hasAttachments {
			return domainError(ErrorConflict, "downstream workflow document has changed", map[string]any{"documentId": value.id, "entity": value.entity}, nil)
		}
		if err = s.deleteGeneratedWorkflowDocument(ctx, tx, value.id, value.entity); err != nil {
			return err
		}
	}
	return nil
}

func (s *Service) deleteGeneratedWorkflowDocument(ctx context.Context, tx pgx.Tx, documentID, entity string) error {
	q := s.queries.WithTx(tx)
	document, err := lockDocument(ctx, tx, documentID, entity)
	if err != nil {
		return err
	}
	switch entity {
	case EntitySaleOutbound:
		err = q.DeleteVouSaleOutboundLines(ctx, documentID)
		if err == nil {
			err = q.DeleteVouSaleOutboundDetails(ctx, documentID)
		}
	case EntitySaleDelivery:
		err = q.DeleteVouSaleDeliveryDetails(ctx, documentID)
	case EntitySaleSignoff:
		err = q.DeleteVouSaleSignoffLines(ctx, documentID)
		if err == nil {
			err = q.DeleteVouSaleSignoffDetails(ctx, documentID)
		}
	case EntitySaleReturn:
		err = q.DeleteVouSaleReturnLines(ctx, documentID)
		if err == nil {
			err = q.DeleteVouSaleReturnDetails(ctx, documentID)
		}
	case EntityPurchaseInbound:
		err = q.DeleteVouPurchaseInboundLines(ctx, documentID)
		if err == nil {
			err = q.DeleteVouPurchaseInboundDetails(ctx, documentID)
		}
	case EntityExpensePayment:
		err = q.DeleteVouExpensePaymentDetails(ctx, documentID)
	case EntityEmployeeLoanWriteoff:
		err = q.DeleteVouExpenseLines(ctx, documentID)
		if err == nil {
			err = q.DeleteVouEmployeeLoanWriteoffDetails(ctx, documentID)
		}
	case EntitySalesReceipt, EntityPurchaseRefund, EntityOtherReceipt, EntityEmployeeRepayment:
		err = q.DeleteVouReceiptDetails(ctx, documentID)
	case EntitySalesRefund, EntityPurchasePayment, EntityOtherPayment, EntityEmployeeLoan:
		err = q.DeleteVouPaymentDetails(ctx, documentID)
	default:
		return domainError(ErrorConflict, "downstream workflow document cannot be removed", map[string]any{"documentId": documentID, "entity": entity}, nil)
	}
	if err != nil {
		return err
	}
	if err = q.DeleteVouDocument(ctx, documentID); err != nil {
		return err
	}
	actor, err := approval.TrustedSystemActor("vou-workflow-cleanup-" + documentID)
	if err != nil {
		return err
	}
	coordinator, err := s.coordinator(entity)
	if err != nil {
		return err
	}
	if err = coordinator.DeleteSubject(ctx, tx, document.ApprovalEntryID, document.Revision, actor, DocumentView{}); err != nil {
		return mapApprovalError(err)
	}
	return nil
}

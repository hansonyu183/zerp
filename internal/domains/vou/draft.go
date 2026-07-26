package vou

import (
	"context"

	dbsqlc "github.com/hansonyu183/zerp-back/internal/database/sqlc"
	bobdomain "github.com/hansonyu183/zerp-back/internal/domains/bob"
	"github.com/jackc/pgx/v5"
)

type resolvedDraft struct {
	Customer, Supplier, Counterparty, Employee, FundAccount *bobdomain.EffectiveReference
	Salesperson, Purchaser, Handler, Warehouse              *bobdomain.EffectiveReference
	CustomerSettlement, SupplierSettlement                  *bobdomain.EffectiveReference
	Products                                                []bobdomain.EffectiveReference
}

func (s *Service) loadPreservedPersonnel(
	ctx context.Context, q *dbsqlc.Queries, entity, documentID string,
) (resolvedDraft, error) {
	var result resolvedDraft
	makeReference := func(
		objectID, versionID, code, name *string,
	) *bobdomain.EffectiveReference {
		if objectID == nil || versionID == nil || code == nil || name == nil {
			return nil
		}
		return &bobdomain.EffectiveReference{
			ObjectID: *objectID, Entity: bobdomain.EntityEmployee, Code: *code, VersionID: *versionID,
			Data: bobdomain.DetailView{Name: *name},
		}
	}
	switch entity {
	case EntitySaleOrder:
		detail, err := q.GetVouSaleOrderDetail(ctx, documentID)
		if err != nil {
			return result, s.internal("read sale order salesperson", err)
		}
		result.Salesperson = makeReference(
			detail.SalespersonObjectID, detail.SalespersonVersionID,
			detail.SalespersonCode, detail.SalespersonName,
		)
	case EntityPurchaseOrder:
		detail, err := q.GetVouPurchaseOrderDetail(ctx, documentID)
		if err != nil {
			return result, s.internal("read purchase order purchaser", err)
		}
		result.Purchaser = makeReference(
			detail.PurchaserObjectID, detail.PurchaserVersionID,
			detail.PurchaserCode, detail.PurchaserName,
		)
	case EntityIntermediarySaleOrder:
		detail, err := q.GetVouIntermediarySaleOrderDetail(ctx, documentID)
		if err != nil {
			return result, s.internal("read intermediary order personnel", err)
		}
		result.Salesperson = makeReference(
			detail.SalespersonObjectID, detail.SalespersonVersionID,
			detail.SalespersonCode, detail.SalespersonName,
		)
		result.Purchaser = makeReference(
			detail.PurchaserObjectID, detail.PurchaserVersionID,
			detail.PurchaserCode, detail.PurchaserName,
		)
	}
	return result, nil
}

func (s *Service) resolveDraft(
	ctx context.Context,
	tx pgx.Tx,
	entity string,
	draft validatedDraft,
	preserved resolvedDraft,
	allowPersonnelDefaults bool,
) (resolvedDraft, error) {
	var result resolvedDraft
	if err := s.resolveDraftParties(ctx, tx, draft, &result); err != nil {
		return result, err
	}
	if err := s.resolveDraftPersonnel(
		ctx, tx, entity, draft, preserved, allowPersonnelDefaults, &result,
	); err != nil {
		return result, err
	}
	if err := s.resolveDraftAccounts(ctx, tx, draft, &result); err != nil {
		return result, err
	}
	if err := s.resolveDraftSettlements(ctx, tx, entity, &result); err != nil {
		return result, err
	}
	if err := s.resolveDraftProducts(ctx, tx, draft, &result); err != nil {
		return result, err
	}
	return result, nil
}

func (s *Service) insertDetail(
	ctx context.Context, q *dbsqlc.Queries, entity, documentID string, draft validatedDraft, refs resolvedDraft,
) error {
	if err := s.writeDetail(ctx, q, entity, documentID, draft, refs, false); err != nil {
		return err
	}
	return s.replaceLines(ctx, q, entity, documentID, draft, refs)
}

func (s *Service) updateDetail(
	ctx context.Context, q *dbsqlc.Queries, entity, documentID string, draft validatedDraft, refs resolvedDraft,
) error {
	if err := s.writeDetail(ctx, q, entity, documentID, draft, refs, true); err != nil {
		return err
	}
	return s.replaceLines(ctx, q, entity, documentID, draft, refs)
}

func (s *Service) writeDetail(
	ctx context.Context, q *dbsqlc.Queries, entity, documentID string, draft validatedDraft, refs resolvedDraft, update bool,
) error {
	switch entity {
	case EntitySaleOrder:
		return s.writeSaleDetail(ctx, q, entity, documentID, draft, refs, update)
	case EntityPurchaseOrder:
		return s.writePurchaseDetail(ctx, q, entity, documentID, draft, refs, update)
	case EntityIntermediarySaleOrder:
		return s.writeIntermediaryDetail(ctx, q, entity, documentID, draft, refs, update)
	case EntityReceipt, EntityPayment:
		return s.writeCashDetail(ctx, q, entity, documentID, draft, refs, update)
	case EntityExpenseReimbursement:
		return s.writeExpenseDetail(ctx, q, entity, documentID, draft, refs, update)
	case EntityOtherIncome:
		return s.writeOtherIncomeDetail(ctx, q, entity, documentID, draft, refs, update)
	default:
		return domainError(ErrorValidation, "invalid entity", nil, nil)
	}
}

func (s *Service) replaceLines(
	ctx context.Context, q *dbsqlc.Queries, entity, documentID string, draft validatedDraft, refs resolvedDraft,
) error {
	if len(draft.ProductLines) > 0 {
		if err := q.DeleteVouProductLines(ctx, documentID); err != nil {
			return err
		}
		for index, line := range draft.ProductLines {
			ref := refs.Products[index]
			if err := q.InsertVouProductLine(ctx, dbsqlc.InsertVouProductLineParams{
				ID: newID(), DocumentID: documentID, DocumentEntity: entity, LineNo: int32(index + 1),
				ProductObjectID: ref.ObjectID, ProductVersionID: ref.VersionID,
				ProductCode: ref.Code, ProductName: ref.Data.Name, ProductUnit: ref.Data.Unit,
				OrderedQtyMicros: line.Quantity, UnitPriceCents: line.UnitPrice, LineAmountCents: line.LineAmount,
				PurchaseUnitPriceCents: line.PurchaseUnitPrice, Remark: line.Remark,
			}); err != nil {
				return err
			}
		}
	}
	if entity == EntityExpenseReimbursement {
		if err := q.DeleteVouExpenseLines(ctx, documentID); err != nil {
			return err
		}
		for index, line := range draft.ExpenseLines {
			if err := q.InsertVouExpenseLine(ctx, dbsqlc.InsertVouExpenseLineParams{
				ID: newID(), DocumentID: documentID, LineNo: int32(index + 1),
				Category: line.Category, Description: line.Description, AmountCents: line.Amount,
				Remark: line.Remark,
			}); err != nil {
				return err
			}
		}
	}
	return nil
}

func (s *Service) validateStoredAttributes(
	ctx context.Context, q *dbsqlc.Queries, entity, documentID string,
) error {
	missing := false
	switch entity {
	case EntitySaleOrder:
		detail, err := q.GetVouSaleOrderDetail(ctx, documentID)
		if err != nil {
			return s.internal("read sale order attributes", err)
		}
		missing = detail.SalespersonObjectID == nil || detail.WarehouseObjectID == nil ||
			detail.SettlementMethodObjectID == nil
	case EntityPurchaseOrder:
		detail, err := q.GetVouPurchaseOrderDetail(ctx, documentID)
		if err != nil {
			return s.internal("read purchase order attributes", err)
		}
		missing = detail.PurchaserObjectID == nil || detail.WarehouseObjectID == nil ||
			detail.SettlementMethodObjectID == nil
	case EntityIntermediarySaleOrder:
		detail, err := q.GetVouIntermediarySaleOrderDetail(ctx, documentID)
		if err != nil {
			return s.internal("read intermediary order attributes", err)
		}
		missing = detail.SalespersonObjectID == nil || detail.PurchaserObjectID == nil ||
			detail.CustomerSettlementMethodObjectID == nil ||
			detail.SupplierSettlementMethodObjectID == nil
		if !missing {
			lines, lineErr := q.ListVouProductLines(ctx, documentID)
			if lineErr != nil {
				return s.internal("read intermediary purchase prices", lineErr)
			}
			for _, line := range lines {
				if line.PurchaseUnitPriceCents == nil {
					missing = true
					break
				}
			}
		}
	case EntityReceipt:
		detail, err := q.GetVouReceiptDetail(ctx, documentID)
		if err != nil {
			return s.internal("read receipt attributes", err)
		}
		missing = detail.HandlerObjectID == nil
	case EntityPayment:
		detail, err := q.GetVouPaymentDetail(ctx, documentID)
		if err != nil {
			return s.internal("read payment attributes", err)
		}
		missing = detail.HandlerObjectID == nil
	case EntityOtherIncome:
		detail, err := q.GetVouOtherIncomeDetail(ctx, documentID)
		if err != nil {
			return s.internal("read other income attributes", err)
		}
		missing = detail.HandlerObjectID == nil
	case EntityExpenseReimbursement:
		return nil
	default:
		return domainError(ErrorValidation, "invalid entity", nil, nil)
	}
	if missing {
		return domainError(
			ErrorConflict,
			"document attributes are incomplete; return to draft and save before continuing",
			nil,
			nil,
		)
	}
	return nil
}

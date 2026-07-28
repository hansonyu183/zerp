package vou

import (
	"context"
	"math"
	"math/big"
	"time"

	dbsqlc "github.com/hansonyu183/zerp/backend/internal/database/sqlc"
	bobdomain "github.com/hansonyu183/zerp/backend/internal/domains/bob"
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

func applySettlementTerms(entity string, draft *validatedDraft, refs resolvedDraft) error {
	var settlement *bobdomain.EffectiveReference
	switch entity {
	case EntitySaleOrder:
		settlement = refs.CustomerSettlement
	case EntityPurchaseOrder:
		settlement = refs.SupplierSettlement
	default:
		return nil
	}
	if settlement == nil {
		return domainError(ErrorConflict, "settlement method is required", nil, nil)
	}
	dueDate, err := calculateDueDate(draft.BusinessDate, settlement.Data)
	if err != nil {
		return err
	}
	draft.DueDate = &dueDate
	defaultSurcharge := int64(0)
	if entity == EntitySaleOrder {
		defaultSurchargeValue := settlement.Data.DefaultSalesSurcharge
		if defaultSurchargeValue == "" {
			defaultSurchargeValue = "0.00"
		}
		defaultSurcharge, err = parseFixed(defaultSurchargeValue, 2, true)
		if err != nil {
			return domainError(ErrorConflict, "settlement surcharge is invalid", nil, err)
		}
	}
	var total int64
	for index := range draft.ProductLines {
		line := &draft.ProductLines[index]
		product := refs.Products[index].Data
		if entity != EntitySaleOrder || product.ProductKind == bobdomain.ProductKindPackaging {
			line.SettlementSurcharge = 0
		} else if !line.SurchargeProvided {
			line.SettlementSurcharge = defaultSurcharge
		}
		if line.BaseUnitPrice > math.MaxInt64-line.SettlementSurcharge {
			return domainError(ErrorValidation, "unit price is out of range", nil, nil)
		}
		line.UnitPrice = line.BaseUnitPrice + line.SettlementSurcharge
		pricingQuantity, quantityErr := pricingQuantityMicros(line.Quantity, product)
		if quantityErr != nil {
			return quantityErr
		}
		line.LineAmount, err = lineAmountCents(pricingQuantity, line.UnitPrice)
		if err != nil || total > math.MaxInt64-line.LineAmount {
			return domainError(ErrorValidation, "amount is out of range", nil, err)
		}
		total += line.LineAmount
	}
	draft.TotalAmount = total
	return nil
}

func pricingQuantityMicros(inventoryQuantity int64, product bobdomain.DetailView) (int64, error) {
	conversionValue := product.PricingQuantityPerInventoryUnit
	if conversionValue == "" {
		conversionValue = "1"
	}
	conversion, err := parseFixed(conversionValue, 6, false)
	if err != nil {
		return 0, domainError(ErrorConflict, "product pricing conversion is invalid", nil, err)
	}
	value := new(big.Int).Mul(big.NewInt(inventoryQuantity), big.NewInt(conversion))
	value.Quo(value, big.NewInt(1_000_000))
	if !value.IsInt64() || value.Sign() <= 0 {
		return 0, domainError(ErrorValidation, "pricing quantity is out of range", nil, nil)
	}
	return value.Int64(), nil
}

func calculateDueDate(businessDate time.Time, settlement bobdomain.DetailView) (time.Time, error) {
	switch settlement.RuleType {
	case "DUE_DAYS":
		return businessDate.AddDate(0, 0, int(settlement.DueDays)), nil
	case bobdomain.SettlementRuleRelativeDays:
		return businessDate.AddDate(0, 0, int(settlement.DayOffset)), nil
	case "MONTH_END":
		extraMonth := 0
		cutoffDay := settlement.CutoffDay
		if cutoffDay == 0 {
			cutoffDay = 31
		}
		if businessDate.Day() > int(cutoffDay) {
			extraMonth = 1
		}
		firstOfTargetMonth := time.Date(
			businessDate.Year(), businessDate.Month(), 1,
			0, 0, 0, 0, businessDate.Location(),
		).AddDate(0, int(settlement.MonthOffset)+extraMonth, 0)
		return firstOfTargetMonth.AddDate(0, 1, -1).AddDate(0, 0, int(settlement.DayOffset)), nil
	case bobdomain.SettlementRuleFixedDay:
		firstOfTargetMonth := time.Date(
			businessDate.Year(), businessDate.Month(), 1,
			0, 0, 0, 0, businessDate.Location(),
		).AddDate(0, int(settlement.MonthOffset), 0)
		lastDay := firstOfTargetMonth.AddDate(0, 1, -1).Day()
		day := int(*settlement.DayOfMonth)
		if day > lastDay {
			day = lastDay
		}
		return firstOfTargetMonth.AddDate(0, 0, day-1+int(settlement.DayOffset)), nil
	default:
		return time.Time{}, domainError(ErrorConflict, "unsupported settlement rule", nil, nil)
	}
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
				ProductKind:                           ref.Data.ProductKind,
				PricingQuantityPerInventoryUnitMicros: fixedMicrosOrOne(ref.Data.PricingQuantityPerInventoryUnit),
				OrderedQtyMicros:                      line.Quantity, BaseUnitPriceCents: line.BaseUnitPrice,
				SettlementSurchargeCents: line.SettlementSurcharge,
				UnitPriceCents:           line.UnitPrice, LineAmountCents: line.LineAmount,
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

func fixedMicrosOrOne(value string) int64 {
	parsed, err := parseFixed(value, 6, false)
	if err != nil {
		return 1_000_000
	}
	return parsed
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
		missing = detail.SalespersonObjectID == nil || detail.SettlementMethodObjectID == nil
	case EntitySaleOutbound, EntitySaleDelivery, EntitySaleSignoff:
		return s.validateSalesChainStored(ctx, entity, documentID)
	case EntityPurchaseOrder:
		detail, err := q.GetVouPurchaseOrderDetail(ctx, documentID)
		if err != nil {
			return s.internal("read purchase order attributes", err)
		}
		missing = detail.PurchaserObjectID == nil || detail.WarehouseObjectID == nil ||
			detail.SettlementMethodObjectID == nil
	case EntityPurchaseInbound:
		detail, err := q.GetVouPurchaseInboundDetail(ctx, documentID)
		if err != nil {
			return s.internal("read purchase inbound attributes", err)
		}
		lines, lineErr := q.ListVouPurchaseInboundLines(ctx, documentID)
		if lineErr != nil {
			return s.internal("read purchase inbound lines", lineErr)
		}
		missing = detail.WarehouseObjectID == "" || len(lines) == 0
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

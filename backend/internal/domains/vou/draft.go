package vou

import (
	"context"
	"errors"
	"math"
	"math/big"
	"time"

	dbsqlc "github.com/hansonyu183/zerp/backend/internal/database/sqlc"
	auxdomain "github.com/hansonyu183/zerp/backend/internal/domains/auxiliary"
	bobdomain "github.com/hansonyu183/zerp/backend/internal/domains/bob"
	"github.com/jackc/pgx/v5"
)

type resolvedDraft struct {
	Customer, Supplier, Counterparty, Employee, FundAccount, InterestParty *bobdomain.EffectiveReference
	Salesperson, Purchaser, Handler, Warehouse                             *bobdomain.EffectiveReference
	CustomerSettlement, SupplierSettlement                                 *bobdomain.EffectiveReference
	Settlement                                                             *bobdomain.EffectiveReference
	Products                                                               []bobdomain.EffectiveReference
	FormulaMaterials                                                       [][]bobdomain.EffectiveReference
	BillFunds                                                              []bobdomain.EffectiveReference
}

func (s *Service) loadPreservedReferences(
	ctx context.Context, q *dbsqlc.Queries, document documentRecord,
) (resolvedDraft, error) {
	data, err := s.loadData(ctx, q, document)
	if err != nil {
		return resolvedDraft{}, s.internal("read saved VOU reference snapshots", err)
	}
	fromView := func(view *ReferenceView) *bobdomain.EffectiveReference {
		if view == nil {
			return nil
		}
		return &bobdomain.EffectiveReference{ObjectID: view.ObjectID, ApprovalEntryID: view.ApprovalEntryID, Entity: view.Entity, Code: view.Code, Data: bobdomain.DetailView{Name: view.Name}}
	}
	fromSettlement := func(view *SettlementMethodSnapshotView) *bobdomain.EffectiveReference {
		if view == nil {
			return nil
		}
		return &bobdomain.EffectiveReference{ObjectID: view.ObjectID,
			Entity: auxdomain.EntitySettlementMethod, Code: view.Code, Data: bobdomain.DetailView{
				Name: view.Name, RuleType: view.RuleType, MonthOffset: view.MonthOffset, DayOfMonth: view.DayOfMonth,
				DayOffset: view.DayOffset, DueDays: view.DueDays, CutoffDay: view.CutoffDay,
				DefaultSalesSurcharge: view.DefaultSalesSurcharge, Description: view.Description,
			}}
	}
	result := resolvedDraft{
		Customer: fromView(data.Customer), Supplier: fromView(data.Supplier), Counterparty: fromView(data.Counterparty),
		Employee: fromView(data.Employee), Salesperson: fromView(data.Salesperson), Purchaser: fromView(data.Purchaser),
		Handler: fromView(data.Handler), Warehouse: fromView(data.Warehouse), FundAccount: fromView(data.FundAccount),
		InterestParty: fromView(data.InterestParty), Settlement: fromSettlement(data.SettlementMethod),
		CustomerSettlement: fromSettlement(data.CustomerSettlementMethod), SupplierSettlement: fromSettlement(data.SupplierSettlementMethod),
	}
	for _, line := range data.BillCashLines {
		result.BillFunds = append(result.BillFunds, *fromView(&line.FundAccount))
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
	if err := s.resolveDraftParties(ctx, tx, draft, preserved, allowPersonnelDefaults, &result); err != nil {
		return result, err
	}
	if err := s.resolveDraftPersonnel(
		ctx, tx, entity, draft, preserved, allowPersonnelDefaults, &result,
	); err != nil {
		return result, err
	}
	if err := s.resolveDraftAccounts(ctx, tx, draft, preserved, allowPersonnelDefaults, &result); err != nil {
		return result, err
	}
	if err := s.resolveDraftSettlements(ctx, tx, entity, preserved, &result); err != nil {
		return result, err
	}
	if err := s.resolveDraftProducts(ctx, tx, entity, draft, &result); err != nil {
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
	draft.DueDate = nil
	var err error
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
		if entity != EntitySaleOrder || product.BehaviorProfile == bobdomain.ProductBehaviorPackaging {
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

func pricingQuantityMicros(baseQuantity int64, product bobdomain.DetailView) (int64, error) {
	conversionValue := productConversionFactor(product, product.PricingUnitID)
	if conversionValue == "" {
		return 0, domainError(ErrorConflict, "product pricing unit conversion is missing", nil, nil)
	}
	conversion, err := parseFixed(conversionValue, 6, false)
	if err != nil {
		return 0, domainError(ErrorConflict, "product pricing conversion is invalid", nil, err)
	}
	value := new(big.Int).Mul(big.NewInt(baseQuantity), big.NewInt(1_000_000))
	value.Quo(value, big.NewInt(conversion))
	if !value.IsInt64() || value.Sign() <= 0 {
		return 0, domainError(ErrorValidation, "pricing quantity is out of range", nil, nil)
	}
	return value.Int64(), nil
}

func productConversionFactor(product bobdomain.DetailView, unitID string) string {
	for _, conversion := range product.UnitConversions {
		if conversion.Unit.ObjectID == unitID {
			return conversion.Factor
		}
	}
	return ""
}

func defaultUnitSymbol(product bobdomain.DetailView) string {
	for _, conversion := range product.UnitConversions {
		if conversion.Unit.ObjectID != product.DefaultInputUnitID {
			continue
		}
		if conversion.Unit.Symbol != "" {
			return conversion.Unit.Symbol
		}
		if conversion.Unit.Name != "" {
			return conversion.Unit.Name
		}
		return conversion.Unit.Code
	}
	return ""
}

func productUnitSnapshot(
	product bobdomain.DetailView, unitID string,
) (bobdomain.MeasurementUnitSnapshot, error) {
	for _, conversion := range product.UnitConversions {
		if conversion.Unit.ObjectID == unitID {
			return conversion.Unit, nil
		}
	}
	return bobdomain.MeasurementUnitSnapshot{}, domainError(
		ErrorConflict, "entered unit is not configured for product", nil, nil,
	)
}

func validateUnitQuantityScale(quantityMicros int64, unit bobdomain.MeasurementUnitSnapshot) error {
	if unit.QuantityScale < 0 || unit.QuantityScale > 6 {
		return domainError(ErrorConflict, "measurement unit quantity scale is unavailable", nil, nil)
	}
	divisors := [...]int64{1_000_000, 100_000, 10_000, 1_000, 100, 10, 1}
	if quantityMicros%divisors[unit.QuantityScale] != 0 {
		return domainError(ErrorValidation, "entered quantity exceeds measurement unit precision", nil, nil)
	}
	return nil
}

func defaultPackagingSpecSnapshot(product bobdomain.DetailView) (*int64, error) {
	if product.DefaultPackagingSpec == "" {
		return nil, nil
	}
	value, err := parseFixed(product.DefaultPackagingSpec, 6, false)
	if err != nil {
		return nil, domainError(ErrorConflict, "product default packaging specification is invalid", nil, err)
	}
	return &value, nil
}

func calculateDueDate(
	actualDate time.Time,
	settlement bobdomain.DetailView,
	monthlyClosingDay int32,
) (time.Time, error) {
	switch settlement.TermCode {
	case bobdomain.SettlementTermPrepaid, bobdomain.SettlementTermCashOnDelivery:
		return actualDate, nil
	case bobdomain.SettlementTermArrival3, bobdomain.SettlementTermArrival5,
		bobdomain.SettlementTermArrival7, bobdomain.SettlementTermArrival15,
		bobdomain.SettlementTermArrival30:
		return actualDate.AddDate(0, 0, int(settlement.DayOffset)), nil
	case bobdomain.SettlementTermMonthlyCurrent, bobdomain.SettlementTermMonthly30,
		bobdomain.SettlementTermMonthly60, bobdomain.SettlementTermMonthly90:
		if monthlyClosingDay < 1 || monthlyClosingDay > 31 {
			monthlyClosingDay = 31
		}
		statementOffset := 0
		if actualDate.Day() > int(monthlyClosingDay) {
			statementOffset = 1
		}
		firstOfStatementMonth := time.Date(
			actualDate.Year(), actualDate.Month(), 1,
			0, 0, 0, 0, actualDate.Location(),
		).AddDate(0, statementOffset, 0)
		return firstOfStatementMonth.AddDate(0, int(settlement.MonthOffset)+1, -1), nil
	}
	return time.Time{}, domainError(ErrorConflict, "unsupported settlement term", nil, nil)
}

func (s *Service) orderSettlementDueDate(
	ctx context.Context,
	tx pgx.Tx,
	orderEntity, orderID string,
	actualDate time.Time,
) (time.Time, error) {
	var termCode, ruleType string
	var monthOffset, dayOffset, cutoffDay int32
	var err error
	switch orderEntity {
	case EntitySaleOrder:
		err = tx.QueryRow(ctx, `SELECT settlement_term_code,COALESCE(settlement_rule_type,''),
			COALESCE(settlement_month_offset,0),COALESCE(settlement_day_offset,0),
			COALESCE(settlement_cutoff_day,31)
			FROM vou_sale_order_details WHERE document_id=$1`, orderID).
			Scan(&termCode, &ruleType, &monthOffset, &dayOffset, &cutoffDay)
	case EntityPurchaseOrder:
		err = tx.QueryRow(ctx, `SELECT settlement_term_code,COALESCE(settlement_rule_type,''),
			COALESCE(settlement_month_offset,0),COALESCE(settlement_day_offset,0),31
			FROM vou_purchase_order_details WHERE document_id=$1`, orderID).
			Scan(&termCode, &ruleType, &monthOffset, &dayOffset, &cutoffDay)
	default:
		return time.Time{}, domainError(ErrorValidation, "invalid settlement source order", nil, nil)
	}
	if err != nil {
		return time.Time{}, domainError(ErrorConflict, "order settlement snapshot is unavailable", nil, err)
	}
	if termCode == "" {
		termCode = legacySettlementTerm(ruleType, monthOffset, dayOffset)
	}
	return calculateDueDate(actualDate, bobdomain.DetailView{
		TermCode: termCode, RuleType: ruleType, MonthOffset: monthOffset, DayOffset: dayOffset,
	}, cutoffDay)
}

func legacySettlementTerm(ruleType string, monthOffset, dayOffset int32) string {
	if ruleType == "DUE_DAYS" || ruleType == bobdomain.SettlementRuleRelativeDays {
		if dayOffset <= 0 {
			return bobdomain.SettlementTermCashOnDelivery
		}
		candidates := []struct {
			term string
			days int32
		}{
			{bobdomain.SettlementTermArrival3, 3}, {bobdomain.SettlementTermArrival5, 5},
			{bobdomain.SettlementTermArrival7, 7}, {bobdomain.SettlementTermArrival15, 15},
			{bobdomain.SettlementTermArrival30, 30},
		}
		best := candidates[0]
		for _, candidate := range candidates[1:] {
			bestDistance := absInt32(best.days - dayOffset)
			candidateDistance := absInt32(candidate.days - dayOffset)
			if candidateDistance < bestDistance ||
				(candidateDistance == bestDistance && candidate.days > best.days) {
				best = candidate
			}
		}
		return best.term
	}
	switch monthOffset {
	case 0:
		return bobdomain.SettlementTermMonthlyCurrent
	case 1:
		return bobdomain.SettlementTermMonthly30
	case 2:
		return bobdomain.SettlementTermMonthly60
	default:
		return bobdomain.SettlementTermMonthly90
	}
}

func absInt32(value int32) int32 {
	if value < 0 {
		return -value
	}
	return value
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
	case EntitySalePricing:
		if update {
			return nil
		}
		return q.InsertVouSalePricingDetail(ctx, documentID)
	case EntityPurchaseInquiry:
		params := dbsqlc.InsertVouPurchaseInquiryDetailParams{
			DocumentID: documentID, SupplierObjectID: refs.Supplier.ObjectID,
			SupplierApprovalEntryID: refs.Supplier.ApprovalEntryID, SupplierCode: refs.Supplier.Code,
			SupplierName: refs.Supplier.Data.Name,
		}
		if !update {
			return q.InsertVouPurchaseInquiryDetail(ctx, params)
		}
		return oneRow(q.UpdateVouPurchaseInquiryDetail(ctx, dbsqlc.UpdateVouPurchaseInquiryDetailParams{
			DocumentID: params.DocumentID, SupplierObjectID: params.SupplierObjectID,
			SupplierApprovalEntryID: params.SupplierApprovalEntryID, SupplierCode: params.SupplierCode,
			SupplierName: params.SupplierName,
		}))
	case EntitySaleOrder:
		return s.writeSaleDetail(ctx, q, entity, documentID, draft, refs, update)
	case EntityPurchaseOrder:
		return s.writePurchaseDetail(ctx, q, entity, documentID, draft, refs, update)
	case EntitySalesReceipt, EntityPurchaseRefund, EntityOtherReceipt,
		EntitySalesRefund, EntityPurchasePayment, EntityOtherPayment, EntityEmployeeLoan, EntityEmployeeRepayment:
		return s.writeCashDetail(ctx, q, entity, documentID, draft, refs, update)
	case EntityExpenseReimbursement:
		return s.writeExpenseDetail(ctx, q, entity, documentID, draft, refs, update)
	case EntityEmployeeLoanWriteoff:
		return s.writeEmployeeLoanWriteoffDetail(ctx, q, documentID, refs, update)
	case EntityOtherIncome:
		return s.writeOtherIncomeDetail(ctx, q, entity, documentID, draft, refs, update)
	case EntityInventoryCount:
		params := dbsqlc.InsertVouInventoryCountDetailParams{
			DocumentID: documentID, WarehouseObjectID: refs.Warehouse.ObjectID,
			WarehouseApprovalEntryID: refs.Warehouse.ApprovalEntryID, WarehouseCode: refs.Warehouse.Code,
			WarehouseName: refs.Warehouse.Data.Name,
		}
		if !update {
			return q.InsertVouInventoryCountDetail(ctx, params)
		}
		return oneRow(q.UpdateVouInventoryCountDetail(ctx, dbsqlc.UpdateVouInventoryCountDetailParams{
			WarehouseObjectID: params.WarehouseObjectID, WarehouseApprovalEntryID: params.WarehouseApprovalEntryID,
			WarehouseCode: params.WarehouseCode, WarehouseName: params.WarehouseName,
			DocumentID: params.DocumentID,
		}))
	case EntityServiceContract:
		return s.writeServiceContractDetail(ctx, q, documentID, draft, refs, update)
	case EntityServiceAcceptance:
		return s.writeServiceAcceptanceDetail(ctx, q, documentID, draft, update)
	case EntityBillReceipt, EntityBillPayment, EntityBillIssue, EntityBillDiscount, EntityBillMaturity:
		return s.writeBillDetail(ctx, q, entity, documentID, draft, refs, update)
	default:
		return domainError(ErrorValidation, "invalid entity", nil, nil)
	}
}

func (s *Service) replaceLines(
	ctx context.Context, q *dbsqlc.Queries, entity, documentID string, draft validatedDraft, refs resolvedDraft,
) error {
	if entity == EntityInventoryCount {
		if err := q.DeleteVouInventoryCountLines(ctx, documentID); err != nil {
			return err
		}
		for index, line := range draft.InventoryCountLines {
			ref := refs.Products[index]
			unit, unitErr := productUnitSnapshot(ref.Data, line.EnteredUnitID)
			if unitErr != nil {
				return unitErr
			}
			if err := q.InsertVouInventoryCountLine(ctx, dbsqlc.InsertVouInventoryCountLineParams{
				ID: newID(), DocumentID: documentID, LineNo: int32(index + 1),
				ProductObjectID: ref.ObjectID, ProductApprovalEntryID: ref.ApprovalEntryID,
				ProductCode: ref.Code, ProductName: ref.Data.Name,
				EnteredQuantityMicros: line.EnteredQuantity, EnteredUnitObjectID: unit.ObjectID,
				EnteredUnitCode: unit.Code,
				EnteredUnitName: unit.Name, EnteredUnitSymbol: unit.Symbol,
				ActualBaseQuantityMicros: line.ActualQuantity, Remark: line.Remark,
			}); err != nil {
				return err
			}
		}
		return nil
	}
	if entity == EntityBillReceipt || entity == EntityBillPayment || entity == EntityBillIssue || entity == EntityBillDiscount || entity == EntityBillMaturity {
		return s.replaceBillLines(ctx, q, entity, documentID, draft, refs)
	}
	if entity == EntitySalePricing || entity == EntityPurchaseInquiry {
		if err := q.DeleteVouPriceLines(ctx, documentID); err != nil {
			return err
		}
		for index, line := range draft.PriceLines {
			ref := refs.Products[index]
			if err := q.InsertVouPriceLine(ctx, dbsqlc.InsertVouPriceLineParams{
				ID: newID(), DocumentID: documentID, DocumentEntity: entity, LineNo: int32(index + 1),
				ProductObjectID: ref.ObjectID, ProductApprovalEntryID: ref.ApprovalEntryID, ProductCode: ref.Code,
				ProductName: ref.Data.Name, DefaultInputUnitSymbol: defaultUnitSymbol(ref.Data),
				BehaviorProfile:     ref.Data.BehaviorProfile,
				ProductTypeObjectID: ref.Data.ProductTypeID,
				ProductTypeCode:     ref.Data.ProductTypeCode, ProductTypeName: ref.Data.ProductTypeName,
				UnitPriceCents: line.UnitPrice, Remark: line.Remark,
			}); err != nil {
				return err
			}
		}
		return nil
	}
	if len(draft.ProductLines) > 0 {
		if err := q.DeleteVouProductLines(ctx, documentID); err != nil {
			return err
		}
		for index, line := range draft.ProductLines {
			ref := refs.Products[index]
			lineID := newID()
			unit, unitErr := productUnitSnapshot(ref.Data, line.EnteredUnitID)
			if unitErr != nil {
				return unitErr
			}
			defaultPackagingSpec, packagingErr := defaultPackagingSpecSnapshot(ref.Data)
			if packagingErr != nil {
				return packagingErr
			}
			if err := q.InsertVouProductLine(ctx, dbsqlc.InsertVouProductLineParams{
				ID: lineID, DocumentID: documentID, DocumentEntity: entity, LineNo: int32(index + 1),
				ProductObjectID: ref.ObjectID, ProductApprovalEntryID: ref.ApprovalEntryID,
				ProductCode: ref.Code, ProductName: ref.Data.Name,
				EnteredQuantityMicros: line.EnteredQuantity, EnteredUnitObjectID: unit.ObjectID,
				EnteredUnitCode: unit.Code,
				EnteredUnitName: unit.Name, EnteredUnitSymbol: unit.Symbol,
				BaseQuantityMicros:  line.Quantity,
				ProductTypeObjectID: ref.Data.ProductTypeID,
				ProductTypeCode:     ref.Data.ProductTypeCode, ProductTypeName: ref.Data.ProductTypeName,
				BehaviorProfile: ref.Data.BehaviorProfile, DefaultPackagingSpecMicros: defaultPackagingSpec,
				BaseUnitPriceCents:       line.BaseUnitPrice,
				SettlementSurchargeCents: line.SettlementSurcharge,
				UnitPriceCents:           line.UnitPrice, LineAmountCents: line.LineAmount,
				PurchaseUnitPriceCents: line.PurchaseUnitPrice, Remark: line.Remark,
				ReferenceUnitPriceCents:   line.Reference.UnitPrice,
				ReferenceDocumentID:       nullableString(line.Reference.DocumentID),
				ReferenceDocumentNo:       nullableString(line.Reference.DocumentNo),
				ReferenceBusinessDate:     optionalDate(line.Reference.BusinessDate),
				ReferenceLineID:           nullableString(line.Reference.LineID),
				DeliverySpecificationType: line.DeliverySpecificationType,
			}); err != nil {
				return err
			}
			if entity == EntitySaleOrder && line.Formula != nil {
				outputUnit, outputUnitErr := productUnitSnapshot(ref.Data, line.Formula.Output.EnteredUnitID)
				if outputUnitErr != nil {
					return outputUnitErr
				}
				if err := q.InsertVouSaleOrderFormula(ctx, dbsqlc.InsertVouSaleOrderFormulaParams{
					ProductLineID: lineID, SourceType: line.Formula.SourceType,
					SourceDocumentID:            stringPointer(line.Formula.SourceDocumentID),
					SourceDocumentNo:            stringPointer(line.Formula.SourceDocumentNo),
					OutputEnteredQuantityMicros: line.Formula.Output.EnteredQuantity,
					OutputEnteredUnitObjectID:   outputUnit.ObjectID,
					OutputEnteredUnitCode:       outputUnit.Code, OutputEnteredUnitName: outputUnit.Name,
					OutputEnteredUnitSymbol:  outputUnit.Symbol,
					OutputBaseQuantityMicros: line.Formula.Output.BaseQuantity,
				}); err != nil {
					return err
				}
				for componentIndex, component := range line.Formula.Components {
					material := refs.FormulaMaterials[index][componentIndex]
					componentUnit, componentUnitErr := productUnitSnapshot(material.Data, component.Quantity.EnteredUnitID)
					if componentUnitErr != nil {
						return componentUnitErr
					}
					if err := q.InsertVouSaleOrderFormulaLine(
						ctx, dbsqlc.InsertVouSaleOrderFormulaLineParams{
							ProductLineID: lineID, LineNo: int32(componentIndex + 1),
							MaterialObjectID: material.ObjectID, MaterialApprovalEntryID: material.ApprovalEntryID,
							MaterialCode: material.Code, MaterialName: material.Data.Name,
							EnteredQuantityMicros: component.Quantity.EnteredQuantity,
							EnteredUnitObjectID:   componentUnit.ObjectID,
							EnteredUnitCode:       componentUnit.Code, EnteredUnitName: componentUnit.Name,
							EnteredUnitSymbol:  componentUnit.Symbol,
							BaseQuantityMicros: component.Quantity.BaseQuantity,
						},
					); err != nil {
						return err
					}
				}
			}
		}
	}
	if entity == EntityExpenseReimbursement || entity == EntityEmployeeLoanWriteoff {
		if err := q.DeleteVouExpenseLines(ctx, documentID); err != nil {
			return err
		}
		for index, line := range draft.ExpenseLines {
			if err := q.InsertVouExpenseLine(ctx, dbsqlc.InsertVouExpenseLineParams{
				ID: newID(), DocumentID: documentID, DocumentEntity: entity, LineNo: int32(index + 1),
				Category: line.Category, Description: line.Description, AmountCents: line.Amount,
				Remark: line.Remark,
			}); err != nil {
				return err
			}
		}
	}
	return nil
}

func stringPointer(value string) *string {
	if value == "" {
		return nil
	}
	return &value
}

func (s *Service) validateStoredAttributes(
	ctx context.Context, q *dbsqlc.Queries, entity, documentID string,
) error {
	missing := false
	switch entity {
	case EntityServiceContract:
		detail, err := q.GetVouServiceContractDetail(ctx, documentID)
		if err != nil {
			return s.internal("read service contract detail", err)
		}
		missing = detail.CounterpartyObjectID == "" || detail.CounterpartyApprovalEntryID == "" || detail.HandlerObjectID == "" || detail.HandlerApprovalEntryID == ""
		if detail.CounterpartyEntity == contractCounterpartyService {
			missing = missing || detail.SettlementMethodObjectID == nil
		} else if detail.CounterpartyEntity == contractCounterpartySales {
			missing = missing || len(detail.Capabilities) == 0 || !detail.ApplicableFrom.Valid
		} else {
			missing = true
		}
	case EntityServiceAcceptance:
		detail, err := q.GetVouServiceAcceptanceDetail(ctx, documentID)
		if err != nil {
			return s.internal("read service acceptance detail", err)
		}
		missing = detail.ContractDocumentID == "" || !detail.ServiceDate.Valid || !detail.AcceptanceDate.Valid || len(detail.ContractSnapshot) == 0
		if !missing {
			contract, lockErr := q.LockVouServiceAcceptanceContract(ctx, detail.ContractDocumentID)
			if errors.Is(lockErr, pgx.ErrNoRows) {
				return domainError(ErrorConflict, "service acceptance requires an approved service relationship contract", nil, nil)
			}
			if lockErr != nil {
				return s.internal("lock service acceptance contract", lockErr)
			}
			if contract.Status != StatusApproved || contract.CounterpartyEntity != contractCounterpartyService {
				return domainError(ErrorConflict, "service acceptance requires an approved service relationship contract", nil, nil)
			}
		}
	case EntityIntermediaryCalculation:
		return s.validateStoredIntermediaryCalculation(ctx, q, documentID)
	case EntityBillReceipt, EntityBillPayment, EntityBillIssue, EntityBillDiscount, EntityBillMaturity:
		detail, err := q.GetVouBillDetail(ctx, documentID)
		if err != nil {
			return s.internal("read bill detail", err)
		}
		lines, err := q.ListVouBillLines(ctx, documentID)
		if err != nil {
			return s.internal("read bill lines", err)
		}
		missing = len(lines) == 0
		if entity != EntityBillMaturity {
			missing = detail.CounterpartyObjectID == nil || detail.CounterpartyApprovalEntryID == nil || missing
		}
		if entity == EntityBillReceipt {
			missing = missing || detail.HandlerObjectID == nil || detail.HandlerApprovalEntryID == nil
		}
	case EntityAssetAcquisition:
		lines, err := q.ListVouAssetAcquisitionLines(ctx, documentID)
		if err != nil {
			return s.internal("read asset acquisition lines", err)
		}
		missing = len(lines) == 0
	case EntityAssetSale:
		lines, err := q.ListVouAssetSaleLines(ctx, documentID)
		if err != nil {
			return s.internal("read asset sale lines", err)
		}
		missing = len(lines) == 0
	case EntityAssetLiquidation:
		lines, err := q.ListVouAssetLiquidationLines(ctx, documentID)
		if err != nil {
			return s.internal("read asset liquidation lines", err)
		}
		missing = len(lines) == 0
	case EntitySalePricing, EntityPurchaseInquiry:
		lines, err := q.ListVouPriceLines(ctx, documentID)
		if err != nil {
			return s.internal("read price lines", err)
		}
		missing = len(lines) == 0
	case EntitySaleOrder:
		detail, err := q.GetVouSaleOrderDetail(ctx, documentID)
		if err != nil {
			return s.internal("read sale order attributes", err)
		}
		missing = detail.SalespersonObjectID == nil || detail.WarehouseObjectID == nil ||
			detail.SettlementMethodObjectID == nil
	case EntitySaleOutbound, EntitySaleDelivery, EntitySaleSignoff:
		return s.validateSalesChainStored(ctx, entity, documentID)
	case EntitySaleReturn, EntityPurchaseReturn:
		return nil
	case EntityOrderProduction, EntitySelfProduction:
		counts, err := q.CountVouProductionAttributes(ctx, documentID)
		if err != nil {
			return s.internal("read production attributes", err)
		}
		missing = counts.Outputs == 0 || counts.Materials == 0
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
	case EntitySalesReceipt, EntityPurchaseRefund, EntityOtherReceipt, EntityEmployeeRepayment:
		detail, err := q.GetVouReceiptDetail(ctx, documentID)
		if err != nil {
			return s.internal("read receipt attributes", err)
		}
		missing = detail.HandlerObjectID == nil
	case EntitySalesRefund, EntityPurchasePayment, EntityOtherPayment, EntityEmployeeLoan:
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
	case EntityEmployeeLoanWriteoff:
		detail, err := q.GetVouEmployeeLoanWriteoffDetail(ctx, documentID)
		if err != nil {
			return s.internal("read employee loan writeoff attributes", err)
		}
		lines, lineErr := q.ListVouExpenseLines(ctx, documentID)
		if lineErr != nil {
			return s.internal("read employee loan writeoff lines", lineErr)
		}
		missing = detail.EmployeeObjectID == "" || len(lines) == 0
	case EntityExpensePayment:
		detail, err := q.GetVouExpensePaymentDetail(ctx, documentID)
		if err != nil {
			return s.internal("read expense payment attributes", err)
		}
		missing = detail.FundAccountObjectID == "" || detail.EmployeeObjectID == ""
	case EntityInventoryCount:
		detail, err := q.GetVouInventoryCountDetail(ctx, documentID)
		if err != nil {
			return s.internal("read inventory count attributes", err)
		}
		lines, lineErr := q.ListVouInventoryCountLines(ctx, documentID)
		if lineErr != nil {
			return s.internal("read inventory count lines", lineErr)
		}
		missing = detail.WarehouseObjectID == "" || len(lines) == 0
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

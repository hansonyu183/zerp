package vou

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	dbsqlc "github.com/hansonyu183/zerp/backend/internal/database/sqlc"
	bobdomain "github.com/hansonyu183/zerp/backend/internal/domains/bob"
	"github.com/hansonyu183/zerp/backend/internal/platform/approval"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

func (s *Service) loadData(
	ctx context.Context, q *dbsqlc.Queries, document documentRecord,
) (DocumentDataView, error) {
	data := DocumentDataView{
		BusinessDate: formatDate(document.BusinessDate), Currency: deref(document.Currency), Remark: deref(document.Remark),
		DueDate: formatDate(document.DueDate),
	}
	switch document.Entity {
	case EntityServiceContract:
		detail, err := q.GetVouServiceContractDetail(ctx, document.ID)
		if err != nil {
			return data, err
		}
		data.ServiceContract = contractDetailView(detail)
		data.Counterparty = data.ServiceContract.Counterparty
		data.Handler = data.ServiceContract.Handler
		data.SettlementMethod = data.ServiceContract.SettlementMethod
		return data, nil
	case EntityServiceAcceptance:
		detail, err := q.GetVouServiceAcceptanceDetail(ctx, document.ID)
		if err != nil {
			return data, err
		}
		contract := &ServiceContractView{}
		if err = json.Unmarshal(detail.ContractSnapshot, contract); err != nil {
			return data, err
		}
		data.ServiceAcceptance = &ServiceAcceptanceView{
			ContractDocumentID: detail.ContractDocumentID, ServiceDate: formatDate(detail.ServiceDate),
			AcceptanceDate: formatDate(detail.AcceptanceDate), SettlementDirection: detail.SettlementDirection,
			FulfillmentFact: detail.FulfillmentFact, AcceptanceFact: detail.AcceptanceFact, Contract: contract,
		}
		data.Counterparty = contract.Counterparty
		return data, nil
	case EntityIntermediaryCalculation:
		detail, err := q.GetVouIntermediaryCalculationDetail(ctx, document.ID)
		if err != nil {
			return data, err
		}
		var source IntermediaryCalculationSource
		var result IntermediaryCalculationResult
		if err = json.Unmarshal(detail.SourceSnapshot, &source); err != nil {
			return data, err
		}
		if err = json.Unmarshal(detail.ResultSnapshot, &result); err != nil {
			return data, err
		}
		data.IntermediaryCalculation = &IntermediaryCalculationInput{
			Source: source, SourceHash: detail.SourceHash,
			Script: IntermediaryScriptSnapshot{ScriptID: detail.ScriptID, Revision: detail.ScriptRevision,
				Name: detail.ScriptName, Source: detail.ScriptSource, Hash: detail.ScriptHash},
			Result: result,
		}
		return data, nil
	case EntityBillReceipt, EntityBillPayment, EntityBillIssue, EntityBillDiscount, EntityBillMaturity:
		return s.loadBillData(ctx, q, document, data)
	case EntityAssetAcquisition, EntityAssetSale, EntityAssetLiquidation:
		return s.loadAssetData(ctx, q, document, data)
	case EntitySalePricing:
		lines, err := loadPriceLines(ctx, q, document.ID)
		data.PriceLines = lines
		return data, err
	case EntityPurchaseInquiry:
		detail, err := q.GetVouPurchaseInquiryDetail(ctx, document.ID)
		if err != nil {
			return data, err
		}
		data.Supplier = reference(detail.SupplierObjectID, detail.SupplierApprovalEntryID, "supplier",
			detail.SupplierCode, detail.SupplierName, "", "", "")
		data.PriceLines, err = loadPriceLines(ctx, q, document.ID)
		return data, err
	case EntityOrderProduction, EntitySelfProduction:
		return s.loadProductionData(ctx, document, data)
	case EntitySaleOrder:
		detail, err := q.GetVouSaleOrderDetail(ctx, document.ID)
		if err != nil {
			return data, err
		}
		data.Customer = reference(detail.CustomerObjectID, detail.CustomerApprovalEntryID, bobdomain.EntityCustomerAccount, detail.CustomerCode, detail.CustomerName, "", "", "")
		data.Salesperson = optionalReference(
			detail.SalespersonObjectID, detail.SalespersonApprovalEntryID, "employee",
			detail.SalespersonCode, detail.SalespersonName,
		)
		data.Warehouse = optionalReference(
			detail.WarehouseObjectID, detail.WarehouseApprovalEntryID, "warehouse",
			detail.WarehouseCode, detail.WarehouseName,
		)
		data.ContactName = deref(detail.ContactName)
		data.ContactPhone = deref(detail.ContactPhone)
		data.DeliveryAddress = deref(detail.DeliveryAddress)
		data.SettlementMethod = settlementView(
			detail.SettlementMethodObjectID, detail.SettlementMethodApprovalEntryID,
			detail.SettlementMethodCode, detail.SettlementMethodName, detail.SettlementRuleType,
			detail.SettlementMonthOffset, detail.SettlementDayOfMonth,
			detail.SettlementDayOffset, detail.SettlementDueDays,
			detail.SettlementCutoffDay, detail.SettlementDefaultSalesSurchargeCents,
			detail.SettlementDescription, true,
		)
		data.ProductLines, err = loadProductLines(ctx, q, document.ID)
		if err != nil {
			return data, err
		}
		data.FulfillmentStatus = detail.FulfillmentStatus
		data.SpecialApproval = detail.SpecialApproval
		if err = s.setSaleOrderBalances(ctx, document.ID, &data); err != nil {
			return data, err
		}
		return data, nil
	case EntitySaleOutbound, EntitySaleDelivery, EntitySaleSignoff:
		return s.loadSalesChainData(ctx, document, data)
	case EntitySaleReturn:
		return s.loadSaleReturnData(ctx, q, document, data)
	case EntityPurchaseReturn:
		return s.loadPurchaseReturnData(ctx, document, data)
	case EntityPurchaseOrder:
		detail, err := q.GetVouPurchaseOrderDetail(ctx, document.ID)
		if err != nil {
			return data, err
		}
		data.Supplier = reference(detail.SupplierObjectID, detail.SupplierApprovalEntryID, "supplier", detail.SupplierCode, detail.SupplierName, "", "", "")
		data.Purchaser = optionalReference(
			detail.PurchaserObjectID, detail.PurchaserApprovalEntryID, "employee",
			detail.PurchaserCode, detail.PurchaserName,
		)
		data.Warehouse = optionalReference(
			detail.WarehouseObjectID, detail.WarehouseApprovalEntryID, "warehouse",
			detail.WarehouseCode, detail.WarehouseName,
		)
		data.ContactName = deref(detail.ContactName)
		data.ContactPhone = deref(detail.ContactPhone)
		data.SettlementMethod = settlementView(
			detail.SettlementMethodObjectID, detail.SettlementMethodApprovalEntryID,
			detail.SettlementMethodCode, detail.SettlementMethodName, detail.SettlementRuleType,
			detail.SettlementMonthOffset, detail.SettlementDayOfMonth,
			detail.SettlementDayOffset, detail.SettlementDueDays,
			detail.SettlementCutoffDay, detail.SettlementDefaultSalesSurchargeCents,
			detail.SettlementDescription, false,
		)
		data.ProductLines, err = loadProductLines(ctx, q, document.ID)
		if err == nil {
			err = s.setPurchaseOrderBalances(ctx, document.ID, &data)
		}
		return data, err
	case EntityPurchaseInbound:
		detail, err := q.GetVouPurchaseInboundDetail(ctx, document.ID)
		if err != nil {
			return data, err
		}
		data.Supplier = reference(
			detail.SupplierObjectID, detail.SupplierApprovalEntryID, "supplier",
			detail.SupplierCode, detail.SupplierName, "", "", "",
		)
		data.Warehouse = reference(
			detail.WarehouseObjectID, detail.WarehouseApprovalEntryID, "warehouse",
			detail.WarehouseCode, detail.WarehouseName, "", "", "",
		)
		rows, err := q.ListVouPurchaseInboundLines(ctx, document.ID)
		if err != nil {
			return data, err
		}
		for _, row := range rows {
			var returned int64
			if err = s.pool.QueryRow(ctx, `SELECT COALESCE(sum(base_quantity_micros),0)
				FROM vou_purchase_return_lines WHERE source_inbound_line_id=$1`, row.ID).
				Scan(&returned); err != nil {
				return data, err
			}
			returnable := row.BaseQuantityMicros - returned
			if returnable < 0 {
				returnable = 0
			}
			data.ProductLines = append(data.ProductLines, ProductLineView{
				LineID: row.ID, LineNo: row.LineNo,
				SourceLineID: row.SourceOrderLineID,
				Product: *reference(
					row.ProductObjectID, row.ProductApprovalEntryID, "product",
					row.ProductCode, row.ProductName, row.EnteredUnitSymbol, "", "",
				),
				EnteredQuantity:        formatQuantity(row.BaseQuantityMicros),
				EnteredUnit:            UnitSnapshotView{Symbol: row.EnteredUnitSymbol},
				BaseQuantity:           formatQuantity(row.BaseQuantityMicros),
				UnitPrice:              formatMoney(row.UnitPriceCents),
				LineAmount:             formatMoney(row.LineAmountCents),
				Remark:                 deref(row.Remark),
				ReturnableBaseQuantity: formatQuantity(returnable),
			})
		}
		return data, nil
	case EntityInventoryCount:
		detail, err := q.GetVouInventoryCountDetail(ctx, document.ID)
		if err != nil {
			return data, err
		}
		data.Warehouse = reference(
			detail.WarehouseObjectID, detail.WarehouseApprovalEntryID, "warehouse",
			detail.WarehouseCode, detail.WarehouseName, "", "", "",
		)
		rows, err := q.ListVouInventoryCountLines(ctx, document.ID)
		if err != nil {
			return data, err
		}
		for _, row := range rows {
			item := InventoryCountLineView{
				LineID: row.ID, LineNo: row.LineNo,
				Product: *reference(row.ProductObjectID, row.ProductApprovalEntryID, "product",
					row.ProductCode, row.ProductName, row.EnteredUnitSymbol, "", ""),
				EnteredQuantity: formatQuantity(row.EnteredQuantityMicros),
				EnteredUnit: UnitSnapshotView{ObjectID: row.EnteredUnitObjectID, ApprovalEntryID: row.EnteredUnitApprovalEntryID,
					Code: row.EnteredUnitCode, Name: row.EnteredUnitName, Symbol: row.EnteredUnitSymbol},
				BaseQuantity: formatQuantity(row.ActualBaseQuantityMicros), Remark: deref(row.Remark),
			}
			if row.BookBaseQuantityMicros != nil {
				value := formatQuantity(*row.BookBaseQuantityMicros)
				item.BookBaseQuantity = &value
			}
			if row.DifferenceBaseQuantityMicros != nil {
				value := formatQuantity(*row.DifferenceBaseQuantityMicros)
				item.DifferenceBaseQuantity = &value
			}
			data.InventoryCountLines = append(data.InventoryCountLines, item)
		}
		return data, nil
	case EntitySalesReceipt, EntityPurchaseRefund, EntityOtherReceipt, EntityEmployeeRepayment:
		detail, err := q.GetVouReceiptDetail(ctx, document.ID)
		if err != nil {
			return data, err
		}
		data.Counterparty = reference(detail.CounterpartyObjectID, detail.CounterpartyApprovalEntryID, detail.CounterpartyEntity,
			detail.CounterpartyCode, detail.CounterpartyName, "", "", "")
		data.FundAccount = reference(detail.FundAccountObjectID, detail.FundAccountApprovalEntryID, "fund-account",
			detail.FundAccountCode, detail.FundAccountName, "", deref(document.Currency), "")
		data.Handler = optionalReference(
			detail.HandlerObjectID, detail.HandlerApprovalEntryID, "employee",
			detail.HandlerCode, detail.HandlerName,
		)
		data.OtherCategory = deref(detail.OtherCategory)
	case EntitySalesRefund, EntityPurchasePayment, EntityOtherPayment, EntityEmployeeLoan:
		detail, err := q.GetVouPaymentDetail(ctx, document.ID)
		if err != nil {
			return data, err
		}
		data.Counterparty = reference(detail.CounterpartyObjectID, detail.CounterpartyApprovalEntryID, detail.CounterpartyEntity,
			detail.CounterpartyCode, detail.CounterpartyName, "", "", "")
		data.FundAccount = reference(detail.FundAccountObjectID, detail.FundAccountApprovalEntryID, "fund-account",
			detail.FundAccountCode, detail.FundAccountName, "", deref(document.Currency), "")
		data.Handler = optionalReference(
			detail.HandlerObjectID, detail.HandlerApprovalEntryID, "employee",
			detail.HandlerCode, detail.HandlerName,
		)
		data.OtherCategory = deref(detail.OtherCategory)
	case EntityExpenseReimbursement:
		detail, err := q.GetVouExpenseReimbursementDetail(ctx, document.ID)
		if err != nil {
			return data, err
		}
		data.Employee = reference(detail.EmployeeObjectID, detail.EmployeeApprovalEntryID, "employee",
			detail.EmployeeCode, detail.EmployeeName, "", "", "")
		rows, err := q.ListVouExpenseLines(ctx, document.ID)
		if err != nil {
			return data, err
		}
		data.ExpenseLines = make([]ExpenseLineView, 0, len(rows))
		for _, row := range rows {
			data.ExpenseLines = append(data.ExpenseLines, ExpenseLineView{
				LineID: row.ID, LineNo: row.LineNo, Category: row.Category,
				Description: row.Description, Amount: formatMoney(row.AmountCents), Remark: deref(row.Remark),
			})
		}
	case EntityExpensePayment:
		detail, err := q.GetVouExpensePaymentDetail(ctx, document.ID)
		if err != nil {
			return data, err
		}
		data.Employee = reference(detail.EmployeeObjectID, detail.EmployeeApprovalEntryID, "employee",
			detail.EmployeeCode, detail.EmployeeName, "", "", "")
		data.FundAccount = reference(detail.FundAccountObjectID, detail.FundAccountApprovalEntryID, "fund-account",
			detail.FundAccountCode, detail.FundAccountName, "", deref(document.Currency), "")
	case EntityEmployeeLoanWriteoff:
		detail, err := q.GetVouEmployeeLoanWriteoffDetail(ctx, document.ID)
		if err != nil {
			return data, err
		}
		data.Employee = reference(detail.EmployeeObjectID, detail.EmployeeApprovalEntryID, "employee",
			detail.EmployeeCode, detail.EmployeeName, "", "", "")
		rows, err := q.ListVouExpenseLines(ctx, document.ID)
		if err != nil {
			return data, err
		}
		data.ExpenseLines = make([]ExpenseLineView, 0, len(rows))
		for _, row := range rows {
			data.ExpenseLines = append(data.ExpenseLines, ExpenseLineView{
				LineID: row.ID, LineNo: row.LineNo, Category: row.Category,
				Description: row.Description, Amount: formatMoney(row.AmountCents), Remark: deref(row.Remark),
			})
		}
	case EntityOtherIncome:
		detail, err := q.GetVouOtherIncomeDetail(ctx, document.ID)
		if err != nil {
			return data, err
		}
		data.SourceName = detail.SourceName
		if detail.CounterpartyObjectID != nil {
			data.Counterparty = reference(deref(detail.CounterpartyObjectID), deref(detail.CounterpartyApprovalEntryID),
				deref(detail.CounterpartyEntity), deref(detail.CounterpartyCode), deref(detail.CounterpartyName), "", "", "")
		}
		data.FundAccount = reference(detail.FundAccountObjectID, detail.FundAccountApprovalEntryID, "fund-account",
			detail.FundAccountCode, detail.FundAccountName, "", deref(document.Currency), "")
		data.Handler = optionalReference(
			detail.HandlerObjectID, detail.HandlerApprovalEntryID, "employee",
			detail.HandlerCode, detail.HandlerName,
		)
	}
	return data, nil
}

func loadProductLines(ctx context.Context, q *dbsqlc.Queries, documentID string) ([]ProductLineView, error) {
	rows, err := q.ListVouProductLines(ctx, documentID)
	if err != nil {
		return nil, err
	}
	items := make([]ProductLineView, 0, len(rows))
	for _, row := range rows {
		item := ProductLineView{
			LineID: row.ID, LineNo: row.LineNo,
			Product: *reference(row.ProductObjectID, row.ProductApprovalEntryID, "product",
				row.ProductCode, row.ProductName, row.EnteredUnitSymbol, "", ""),
			EnteredQuantity: formatQuantity(row.EnteredQuantityMicros),
			EnteredUnit: UnitSnapshotView{ObjectID: row.EnteredUnitObjectID, ApprovalEntryID: row.EnteredUnitApprovalEntryID,
				Code: row.EnteredUnitCode, Name: row.EnteredUnitName, Symbol: row.EnteredUnitSymbol},
			BaseQuantity:              formatQuantity(row.BaseQuantityMicros),
			UnitPrice:                 formatMoney(row.UnitPriceCents),
			BaseUnitPrice:             formatMoney(row.BaseUnitPriceCents),
			SettlementSurcharge:       formatMoney(row.SettlementSurchargeCents),
			LineAmount:                formatMoney(row.LineAmountCents),
			Remark:                    deref(row.Remark),
			ReferenceUnitPrice:        formatMoney(row.ReferenceUnitPriceCents),
			ReferenceDocumentID:       deref(row.ReferenceDocumentID),
			ReferenceDocumentNo:       deref(row.ReferenceDocumentNo),
			ReferenceBusinessDate:     formatDate(row.ReferenceBusinessDate),
			DeliverySpecificationType: row.DeliverySpecificationType,
		}
		item.Product.BehaviorProfile = row.BehaviorProfile
		item.Product.ProductTypeObjectID = row.ProductTypeObjectID
		item.Product.ProductTypeApprovalEntryID = row.ProductTypeApprovalEntryID
		item.Product.ProductTypeCode = row.ProductTypeCode
		item.Product.ProductTypeName = row.ProductTypeName
		if row.PurchaseUnitPriceCents != nil {
			item.PurchaseUnitPrice = formatMoney(*row.PurchaseUnitPriceCents)
		}
		item.OutboundBaseQuantity = formatOptionalQuantity(row.OutboundBaseQuantityMicros)
		item.SignedBaseQuantity = formatOptionalQuantity(row.SignedBaseQuantityMicros)
		item.RejectedBaseQuantity = formatOptionalQuantity(row.RejectedBaseQuantityMicros)
		item.LossBaseQuantity = formatOptionalQuantity(row.LossBaseQuantityMicros)
		item.InboundBaseQuantity = formatOptionalQuantity(row.InboundBaseQuantityMicros)
		item.Formula, err = loadSaleOrderFormula(ctx, q, row.ID)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, nil
}

func loadPriceLines(ctx context.Context, q *dbsqlc.Queries, documentID string) ([]PriceLineView, error) {
	rows, err := q.ListVouPriceLines(ctx, documentID)
	if err != nil {
		return nil, err
	}
	items := make([]PriceLineView, 0, len(rows))
	for _, row := range rows {
		product := *reference(row.ProductObjectID, row.ProductApprovalEntryID, bobdomain.EntityProduct,
			row.ProductCode, row.ProductName, row.DefaultInputUnitSymbol, "", "")
		product.BehaviorProfile = row.BehaviorProfile
		product.ProductTypeObjectID = row.ProductTypeObjectID
		product.ProductTypeApprovalEntryID = row.ProductTypeApprovalEntryID
		product.ProductTypeCode = row.ProductTypeCode
		product.ProductTypeName = row.ProductTypeName
		items = append(items, PriceLineView{LineID: row.ID, LineNo: row.LineNo, Product: product,
			UnitPrice: formatMoney(row.UnitPriceCents), Remark: deref(row.Remark)})
	}
	return items, nil
}

func loadSaleOrderFormula(
	ctx context.Context, q *dbsqlc.Queries, productLineID string,
) (*FormulaView, error) {
	header, err := q.GetVouSaleOrderFormula(ctx, productLineID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	rows, err := q.ListVouSaleOrderFormulaLines(ctx, productLineID)
	if err != nil {
		return nil, err
	}
	result := &FormulaView{
		Output: QuantitySnapshotView{
			EnteredQuantity: formatQuantity(header.OutputEnteredQuantityMicros),
			EnteredUnit: UnitSnapshotView{
				ObjectID: header.OutputEnteredUnitObjectID, ApprovalEntryID: header.OutputEnteredUnitApprovalEntryID,
				Code: header.OutputEnteredUnitCode, Name: header.OutputEnteredUnitName, Symbol: header.OutputEnteredUnitSymbol,
			},
			BaseQuantity: formatQuantity(header.OutputBaseQuantityMicros),
		},
		SourceType: header.SourceType, SourceDocumentID: deref(header.SourceDocumentID),
		SourceDocumentNo: deref(header.SourceDocumentNo),
		Components:       make([]FormulaComponentView, 0, len(rows)),
	}
	for _, row := range rows {
		material := *reference(
			row.MaterialObjectID, row.MaterialApprovalEntryID, bobdomain.EntityProduct,
			row.MaterialCode, row.MaterialName, row.EnteredUnitSymbol, "", "",
		)
		material.BehaviorProfile = bobdomain.ProductBehaviorRawMaterial
		result.Components = append(result.Components, FormulaComponentView{
			Material: material,
			Quantity: QuantitySnapshotView{
				EnteredQuantity: formatQuantity(row.EnteredQuantityMicros),
				EnteredUnit: UnitSnapshotView{
					ObjectID: row.EnteredUnitObjectID, ApprovalEntryID: row.EnteredUnitApprovalEntryID,
					Code: row.EnteredUnitCode, Name: row.EnteredUnitName, Symbol: row.EnteredUnitSymbol,
				},
				BaseQuantity: formatQuantity(row.BaseQuantityMicros),
			},
		})
	}
	return result, nil
}

func reference(objectID, versionID, entity, code, name, unit, currency, plate string) *ReferenceView {
	return &ReferenceView{
		ObjectID: objectID, ApprovalEntryID: versionID, Entity: entity, Code: code, Name: name,
		Unit: unit, Currency: currency, PlateNumber: plate,
	}
}

func optionalReference(
	objectID, versionID *string,
	entity string,
	code, name *string,
) *ReferenceView {
	if objectID == nil {
		return nil
	}
	return reference(
		deref(objectID), deref(versionID), entity, deref(code), deref(name), "", "", "",
	)
}

func settlementView(
	objectID, versionID, code, name, ruleType *string,
	monthOffset, dayOfMonth, dayOffset, dueDays, cutoffDay *int32,
	defaultSalesSurchargeCents int64,
	description *string,
	includeSalesSurcharge bool,
) *SettlementMethodSnapshotView {
	if objectID == nil {
		return nil
	}
	result := &SettlementMethodSnapshotView{
		ObjectID: deref(objectID), ApprovalEntryID: deref(versionID), Code: deref(code), Name: deref(name),
		RuleType: deref(ruleType), MonthOffset: derefInt32(monthOffset),
		DayOfMonth: dayOfMonth, DayOffset: derefInt32(dayOffset), Description: deref(description),
		DueDays: derefInt32(dueDays), CutoffDay: derefInt32(cutoffDay),
	}
	if includeSalesSurcharge {
		result.DefaultSalesSurcharge = formatMoney(defaultSalesSurchargeCents)
	}
	return result
}

func derefInt32(value *int32) int32 {
	if value == nil {
		return 0
	}
	return *value
}

func documentView(document documentRecord, data DocumentDataView, attachments []AttachmentView) DocumentView {
	return DocumentView{
		DocumentID: document.ID, Entity: document.Entity, DocumentNo: document.DocumentNo,
		Approval: approval.MetaFromEntry(document.approvalEntry()), Amount: documentAmount(document.Entity, document.TotalAmountCents),
		Data: data, Attachments: attachments,
	}
}

func attachmentViews(rows []dbsqlc.ListVouAttachmentsRow) []AttachmentView {
	items := make([]AttachmentView, 0, len(rows))
	for _, row := range rows {
		items = append(items, AttachmentView{
			FileID: row.ID, FileName: row.OriginalName, ContentType: row.ContentType,
			Size: row.DeclaredSize, SHA256: row.Sha256Hex, Status: row.Status,
			StoredAt: optionalTime(row.StoredAt), CreatedAt: row.CreatedAt.Time, CreatedBy: row.CreatedBy,
		})
	}
	return items
}

func optionalTime(value pgtype.Timestamptz) *time.Time {
	if !value.Valid {
		return nil
	}
	result := value.Time
	return &result
}

func formatOptionalQuantity(value *int64) string {
	if value == nil {
		return ""
	}
	return formatQuantity(*value)
}

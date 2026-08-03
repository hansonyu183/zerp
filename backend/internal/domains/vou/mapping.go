package vou

import (
	"context"
	"errors"
	"time"

	dbsqlc "github.com/hansonyu183/zerp/backend/internal/database/sqlc"
	bobdomain "github.com/hansonyu183/zerp/backend/internal/domains/bob"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

func (s *Service) loadData(
	ctx context.Context, q *dbsqlc.Queries, document dbsqlc.VouDocument,
) (DocumentDataView, error) {
	data := DocumentDataView{
		BusinessDate: formatDate(document.BusinessDate), Currency: deref(document.Currency), Remark: deref(document.Remark),
		DueDate: formatDate(document.DueDate),
	}
	switch document.Entity {
	case EntityAssetAcquisition, EntityAssetDepreciation, EntityAssetSale, EntityAssetLiquidation:
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
		data.Supplier = reference(detail.SupplierObjectID, detail.SupplierVersionID, "supplier",
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
		data.Customer = reference(detail.CustomerObjectID, detail.CustomerVersionID, "customer", detail.CustomerCode, detail.CustomerName, "", "", "")
		data.Salesperson = optionalReference(
			detail.SalespersonObjectID, detail.SalespersonVersionID, "employee",
			detail.SalespersonCode, detail.SalespersonName,
		)
		data.Warehouse = optionalReference(
			detail.WarehouseObjectID, detail.WarehouseVersionID, "warehouse",
			detail.WarehouseCode, detail.WarehouseName,
		)
		data.ContactName = deref(detail.ContactName)
		data.ContactPhone = deref(detail.ContactPhone)
		data.DeliveryAddress = deref(detail.DeliveryAddress)
		data.SettlementMethod = settlementView(
			detail.SettlementMethodObjectID, detail.SettlementMethodVersionID,
			detail.SettlementMethodCode, detail.SettlementMethodName, detail.SettlementRuleType,
			detail.SettlementMonthOffset, detail.SettlementDayOfMonth,
			detail.SettlementDayOffset, detail.SettlementDueDays,
			detail.SettlementCutoffDay, detail.SettlementDefaultSalesSurchargeCents,
			detail.SettlementDescription,
		)
		data.ProductLines, err = loadProductLines(ctx, q, document.ID)
		if err != nil {
			return data, err
		}
		data.FulfillmentStatus = detail.FulfillmentStatus
		data.ShortCloseRequestedBy = deref(detail.ShortCloseRequestedBy)
		data.ShortCloseReason = deref(detail.ShortCloseReason)
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
		data.Supplier = reference(detail.SupplierObjectID, detail.SupplierVersionID, "supplier", detail.SupplierCode, detail.SupplierName, "", "", "")
		data.Purchaser = optionalReference(
			detail.PurchaserObjectID, detail.PurchaserVersionID, "employee",
			detail.PurchaserCode, detail.PurchaserName,
		)
		data.Warehouse = optionalReference(
			detail.WarehouseObjectID, detail.WarehouseVersionID, "warehouse",
			detail.WarehouseCode, detail.WarehouseName,
		)
		data.ContactName = deref(detail.ContactName)
		data.ContactPhone = deref(detail.ContactPhone)
		data.SettlementMethod = settlementView(
			detail.SettlementMethodObjectID, detail.SettlementMethodVersionID,
			detail.SettlementMethodCode, detail.SettlementMethodName, detail.SettlementRuleType,
			detail.SettlementMonthOffset, detail.SettlementDayOfMonth,
			detail.SettlementDayOffset, detail.SettlementDueDays,
			detail.SettlementCutoffDay, detail.SettlementDefaultSalesSurchargeCents,
			detail.SettlementDescription,
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
			detail.SupplierObjectID, detail.SupplierVersionID, "supplier",
			detail.SupplierCode, detail.SupplierName, "", "", "",
		)
		data.Warehouse = reference(
			detail.WarehouseObjectID, detail.WarehouseVersionID, "warehouse",
			detail.WarehouseCode, detail.WarehouseName, "", "", "",
		)
		rows, err := q.ListVouPurchaseInboundLines(ctx, document.ID)
		if err != nil {
			return data, err
		}
		for _, row := range rows {
			var returned int64
			if err = s.pool.QueryRow(ctx, `SELECT COALESCE(sum(quantity_micros),0)
				FROM vou_purchase_return_lines WHERE source_inbound_line_id=$1`, row.ID).
				Scan(&returned); err != nil {
				return data, err
			}
			returnable := row.QuantityMicros - returned
			if returnable < 0 {
				returnable = 0
			}
			data.ProductLines = append(data.ProductLines, ProductLineView{
				LineID: row.ID, LineNo: row.LineNo,
				SourceLineID: row.SourceOrderLineID,
				Product: *reference(
					row.ProductObjectID, row.ProductVersionID, "product",
					row.ProductCode, row.ProductName, row.ProductUnit, "", "",
				),
				OrderedQuantity:    formatQuantity(row.QuantityMicros),
				UnitPrice:          formatMoney(row.UnitPriceCents),
				LineAmount:         formatMoney(row.LineAmountCents),
				Remark:             deref(row.Remark),
				ReturnableQuantity: formatQuantity(returnable),
			})
		}
		return data, nil
	case EntityInventoryCount:
		detail, err := q.GetVouInventoryCountDetail(ctx, document.ID)
		if err != nil {
			return data, err
		}
		data.Warehouse = reference(
			detail.WarehouseObjectID, detail.WarehouseVersionID, "warehouse",
			detail.WarehouseCode, detail.WarehouseName, "", "", "",
		)
		rows, err := q.ListVouInventoryCountLines(ctx, document.ID)
		if err != nil {
			return data, err
		}
		for _, row := range rows {
			item := InventoryCountLineView{
				LineID: row.ID, LineNo: row.LineNo,
				Product: *reference(row.ProductObjectID, row.ProductVersionID, "product",
					row.ProductCode, row.ProductName, row.ProductUnit, "", ""),
				ActualQuantity: formatQuantity(row.ActualQuantityMicros), Remark: deref(row.Remark),
			}
			if row.BookQuantityMicros != nil {
				value := formatQuantity(*row.BookQuantityMicros)
				item.BookQuantity = &value
			}
			if row.DifferenceQuantityMicros != nil {
				value := formatQuantity(*row.DifferenceQuantityMicros)
				item.DifferenceQuantity = &value
			}
			data.InventoryCountLines = append(data.InventoryCountLines, item)
		}
		return data, nil
	case EntityReceipt, EntityCustomerReceipt, EntitySupplierReceipt, EntityOtherReceipt:
		detail, err := q.GetVouReceiptDetail(ctx, document.ID)
		if err != nil {
			return data, err
		}
		data.Counterparty = reference(detail.CounterpartyObjectID, detail.CounterpartyVersionID, detail.CounterpartyEntity,
			detail.CounterpartyCode, detail.CounterpartyName, "", "", "")
		data.FundAccount = reference(detail.FundAccountObjectID, detail.FundAccountVersionID, "fund-account",
			detail.FundAccountCode, detail.FundAccountName, "", deref(document.Currency), "")
		data.Handler = optionalReference(
			detail.HandlerObjectID, detail.HandlerVersionID, "employee",
			detail.HandlerCode, detail.HandlerName,
		)
	case EntityPayment, EntityCustomerPayment, EntitySupplierPayment, EntityOtherPayment:
		detail, err := q.GetVouPaymentDetail(ctx, document.ID)
		if err != nil {
			return data, err
		}
		data.Counterparty = reference(detail.CounterpartyObjectID, detail.CounterpartyVersionID, detail.CounterpartyEntity,
			detail.CounterpartyCode, detail.CounterpartyName, "", "", "")
		data.FundAccount = reference(detail.FundAccountObjectID, detail.FundAccountVersionID, "fund-account",
			detail.FundAccountCode, detail.FundAccountName, "", deref(document.Currency), "")
		data.Handler = optionalReference(
			detail.HandlerObjectID, detail.HandlerVersionID, "employee",
			detail.HandlerCode, detail.HandlerName,
		)
	case EntityExpenseReimbursement:
		detail, err := q.GetVouExpenseReimbursementDetail(ctx, document.ID)
		if err != nil {
			return data, err
		}
		data.Employee = reference(detail.EmployeeObjectID, detail.EmployeeVersionID, "employee",
			detail.EmployeeCode, detail.EmployeeName, "", "", "")
		data.SettlementMode = detail.SettlementMode
		if detail.FundAccountObjectID != nil {
			data.FundAccount = reference(deref(detail.FundAccountObjectID), deref(detail.FundAccountVersionID), "fund-account",
				deref(detail.FundAccountCode), deref(detail.FundAccountName), "", deref(document.Currency), "")
		}
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
		data.Employee = reference(detail.EmployeeObjectID, detail.EmployeeVersionID, "employee",
			detail.EmployeeCode, detail.EmployeeName, "", "", "")
		data.FundAccount = reference(detail.FundAccountObjectID, detail.FundAccountVersionID, "fund-account",
			detail.FundAccountCode, detail.FundAccountName, "", deref(document.Currency), "")
	case EntityOtherIncome:
		detail, err := q.GetVouOtherIncomeDetail(ctx, document.ID)
		if err != nil {
			return data, err
		}
		data.SourceName = detail.SourceName
		if detail.CounterpartyObjectID != nil {
			data.Counterparty = reference(deref(detail.CounterpartyObjectID), deref(detail.CounterpartyVersionID),
				deref(detail.CounterpartyEntity), deref(detail.CounterpartyCode), deref(detail.CounterpartyName), "", "", "")
		}
		data.FundAccount = reference(detail.FundAccountObjectID, detail.FundAccountVersionID, "fund-account",
			detail.FundAccountCode, detail.FundAccountName, "", deref(document.Currency), "")
		data.Handler = optionalReference(
			detail.HandlerObjectID, detail.HandlerVersionID, "employee",
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
			Product: *reference(row.ProductObjectID, row.ProductVersionID, "product",
				row.ProductCode, row.ProductName, row.ProductUnit, "", ""),
			OrderedQuantity:       formatQuantity(row.OrderedQtyMicros),
			UnitPrice:             formatMoney(row.UnitPriceCents),
			BaseUnitPrice:         formatMoney(row.BaseUnitPriceCents),
			SettlementSurcharge:   formatMoney(row.SettlementSurchargeCents),
			LineAmount:            formatMoney(row.LineAmountCents),
			Remark:                deref(row.Remark),
			ReferenceUnitPrice:    formatMoney(row.ReferenceUnitPriceCents),
			ReferenceDocumentID:   deref(row.ReferenceDocumentID),
			ReferenceDocumentNo:   deref(row.ReferenceDocumentNo),
			ReferenceBusinessDate: formatDate(row.ReferenceBusinessDate),
		}
		item.Product.ProductKind = row.ProductKind
		item.Product.PricingQuantityPerInventoryUnit =
			formatQuantity(row.PricingQuantityPerInventoryUnitMicros)
		if row.PurchaseUnitPriceCents != nil {
			item.PurchaseUnitPrice = formatMoney(*row.PurchaseUnitPriceCents)
		}
		item.OutboundQuantity = formatOptionalQuantity(row.OutboundQtyMicros)
		item.SignedQuantity = formatOptionalQuantity(row.SignedQtyMicros)
		item.RejectedQuantity = formatOptionalQuantity(row.RejectedQtyMicros)
		item.LossQuantity = formatOptionalQuantity(row.LossQtyMicros)
		item.InboundQuantity = formatOptionalQuantity(row.InboundQtyMicros)
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
		product := *reference(row.ProductObjectID, row.ProductVersionID, bobdomain.EntityProduct,
			row.ProductCode, row.ProductName, row.ProductUnit, "", "")
		product.ProductKind = row.ProductKind
		product.PricingQuantityPerInventoryUnit = formatQuantity(row.PricingQuantityPerInventoryUnitMicros)
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
		BaseOutputQuantity: formatQuantity(header.BaseOutputQuantityMicros),
		SourceType:         header.SourceType, SourceDocumentID: deref(header.SourceDocumentID),
		SourceDocumentNo: deref(header.SourceDocumentNo),
		Components:       make([]FormulaComponentView, 0, len(rows)),
	}
	for _, row := range rows {
		material := *reference(
			row.MaterialObjectID, row.MaterialVersionID, bobdomain.EntityProduct,
			row.MaterialCode, row.MaterialName, row.MaterialUnit, "", "",
		)
		material.ProductKind = bobdomain.ProductKindRawMaterial
		result.Components = append(result.Components, FormulaComponentView{
			Material: material, Quantity: formatQuantity(row.QuantityMicros),
		})
	}
	return result, nil
}

func reference(objectID, versionID, entity, code, name, unit, currency, plate string) *ReferenceView {
	return &ReferenceView{
		ObjectID: objectID, VersionID: versionID, Entity: entity, Code: code, Name: name,
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
) *SettlementMethodSnapshotView {
	if objectID == nil {
		return nil
	}
	return &SettlementMethodSnapshotView{
		ObjectID: deref(objectID), VersionID: deref(versionID), Code: deref(code), Name: deref(name),
		RuleType: deref(ruleType), MonthOffset: derefInt32(monthOffset),
		DayOfMonth: dayOfMonth, DayOffset: derefInt32(dayOffset), Description: deref(description),
		DueDays: derefInt32(dueDays), CutoffDay: derefInt32(cutoffDay),
		DefaultSalesSurcharge: formatMoney(defaultSalesSurchargeCents),
	}
}

func derefInt32(value *int32) int32 {
	if value == nil {
		return 0
	}
	return *value
}

func documentView(document dbsqlc.VouDocument, data DocumentDataView, attachments []AttachmentView) DocumentView {
	return DocumentView{
		DocumentID: document.ID, Entity: document.Entity, DocumentNo: document.DocumentNo,
		Status: documentStatus(document.Entity, document.Status), Revision: document.Revision, Amount: formatMoney(document.TotalAmountCents),
		Data: data, Attachments: attachments,
		CreatedAt: document.CreatedAt.Time, CreatedBy: document.CreatedBy,
		UpdatedAt: document.UpdatedAt.Time, UpdatedBy: document.UpdatedBy,
		CheckedAt: optionalTime(document.ReviewedAt), CheckedBy: document.ReviewedBy,
		ApprovedAt: optionalTime(document.ApprovedAt), ApprovedBy: document.ApprovedBy,
		FinalizedAt: optionalTime(document.ExecutedAt), FinalizedBy: document.ExecutedBy,
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

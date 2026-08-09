package led

import (
	"context"

	dbsqlc "github.com/hansonyu183/zerp/backend/internal/database/sqlc"
	voudomain "github.com/hansonyu183/zerp/backend/internal/domains/vou"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

func requireEffectiveDate(posting postingContext, date pgtype.Date) (bool, error) {
	if !date.Valid {
		return false, domainError(
			ErrorConflict,
			"executed document is missing an effective date",
			map[string]any{"documentNo": posting.Document.DocumentNo},
			nil,
		)
	}
	before := date.Time.Before(posting.CutoverDate)
	if posting.Live && before {
		return false, domainError(
			ErrorConflict,
			"document effect predates ledger cutover",
			map[string]any{"documentNo": posting.Document.DocumentNo},
			nil,
		)
	}
	return !before, nil
}

func (s *Service) postSaleOutbound(
	ctx context.Context,
	tx pgx.Tx,
	q *dbsqlc.Queries,
	posting postingContext,
) error {
	doc := posting.Document
	include, err := requireEffectiveDate(posting, doc.BusinessDate)
	if err != nil {
		return err
	}
	if !include {
		return nil
	}
	var warehouseObjectID, warehouseVersionID, warehouseCode, warehouseName string
	err = tx.QueryRow(ctx, `SELECT warehouse_object_id,warehouse_version_id,warehouse_code,warehouse_name
		FROM vou_sale_outbound_details WHERE document_id=$1`, doc.ID).Scan(
		&warehouseObjectID, &warehouseVersionID, &warehouseCode, &warehouseName)
	if err != nil {
		return s.internal("read sale outbound ledger detail", err)
	}
	rows, err := tx.Query(ctx, `SELECT id,product_object_id,product_version_id,product_code,
		product_name,product_unit,quantity_micros,unit_price_cents,line_amount_cents,remark
		FROM vou_sale_outbound_lines WHERE document_id=$1`, doc.ID)
	if err != nil {
		return err
	}
	type outboundLine struct {
		id, productObjectID, productVersionID, productCode, productName, productUnit string
		quantity, price, amount                                                      int64
		remark                                                                       *string
	}
	lines := []outboundLine{}
	for rows.Next() {
		var line outboundLine
		if err = rows.Scan(&line.id, &line.productObjectID, &line.productVersionID, &line.productCode,
			&line.productName, &line.productUnit, &line.quantity, &line.price,
			&line.amount, &line.remark); err != nil {
			rows.Close()
			return err
		}
		lines = append(lines, line)
	}
	if err = rows.Err(); err != nil {
		rows.Close()
		return err
	}
	rows.Close()
	for _, line := range lines {
		if err = lockInventoryDimension(ctx, tx, warehouseObjectID, line.productObjectID); err != nil {
			return err
		}
		err = q.InsertLedInventoryEntry(ctx, dbsqlc.InsertLedInventoryEntryParams{
			ID: newID(), GenerationID: posting.GenerationID, EntryType: posting.EntryType,
			SourceEntity: doc.Entity, SourceDocumentID: doc.ID, SourceDocumentNo: doc.DocumentNo,
			SourceLineID: line.id, SourceRevision: posting.SourceRevision, EffectiveDate: doc.BusinessDate,
			OccurredAt: posting.OccurredAt, ActorID: posting.ActorID, RequestID: posting.RequestID,
			WarehouseObjectID: warehouseObjectID, WarehouseVersionID: warehouseVersionID,
			WarehouseCode: warehouseCode, WarehouseName: warehouseName,
			ProductObjectID: line.productObjectID, ProductVersionID: line.productVersionID,
			ProductCode: line.productCode, ProductName: line.productName, ProductUnit: line.productUnit,
			QuantityDeltaMicros: -line.quantity, Currency: doc.Currency,
			UnitPriceCents: &line.price, AmountCents: &line.amount,
			Remark: preferredRemark(line.remark, doc.Remark),
		})
		if err != nil {
			return s.writeError("post sale outbound inventory", err)
		}
	}
	return nil
}

func (s *Service) postSaleSignoff(
	ctx context.Context,
	tx pgx.Tx,
	q *dbsqlc.Queries,
	posting postingContext,
) error {
	doc := posting.Document
	include, err := requireEffectiveDate(posting, doc.BusinessDate)
	if err != nil || !include {
		return err
	}
	var customerObjectID, customerVersionID, customerCode, customerName string
	err = tx.QueryRow(ctx, `SELECT customer_object_id,customer_version_id,customer_code,customer_name,
		warehouse_object_id,warehouse_version_id,warehouse_code,warehouse_name
		FROM vou_sale_signoff_details WHERE document_id=$1`, doc.ID).Scan(
		&customerObjectID, &customerVersionID, &customerCode, &customerName,
		new(string), new(string), new(string), new(string))
	if err != nil {
		return s.internal("read sale signoff ledger detail", err)
	}
	rows, err := tx.Query(ctx, `SELECT id,product_object_id,product_version_id,product_code,
		product_name,product_unit,signed_qty_micros,rejected_qty_micros,line_amount_cents
		FROM vou_sale_signoff_lines WHERE document_id=$1`, doc.ID)
	if err != nil {
		return err
	}
	type signoffLine struct {
		id, productObjectID, productVersionID, productCode, productName, productUnit string
		signed, rejected, amount                                                     int64
	}
	lines := []signoffLine{}
	for rows.Next() {
		var line signoffLine
		if err = rows.Scan(&line.id, &line.productObjectID, &line.productVersionID, &line.productCode,
			&line.productName, &line.productUnit, &line.signed, &line.rejected, &line.amount); err != nil {
			rows.Close()
			return err
		}
		lines = append(lines, line)
	}
	if err = rows.Err(); err != nil {
		rows.Close()
		return err
	}
	rows.Close()
	for _, line := range lines {
		if line.signed > 0 && line.amount != 0 {
			err = q.InsertLedPartyEntry(ctx, partyParams(
				posting, doc, line.id, doc.BusinessDate,
				customerObjectID, customerVersionID, customerCode, customerName, "customer", line.amount,
			))
			if err != nil {
				return s.writeError("post sale signoff receivable", err)
			}
		}
	}
	return nil
}

func (s *Service) postSaleReturn(
	ctx context.Context,
	tx pgx.Tx,
	q *dbsqlc.Queries,
	posting postingContext,
) error {
	doc := posting.Document
	include, err := requireEffectiveDate(posting, doc.BusinessDate)
	if err != nil || !include {
		return err
	}
	var kind, customerObjectID, customerVersionID, customerCode, customerName string
	var warehouseObjectID, warehouseVersionID, warehouseCode, warehouseName string
	err = tx.QueryRow(ctx, `SELECT return_kind,customer_object_id,customer_version_id,
		customer_code,customer_name,warehouse_object_id,warehouse_version_id,
		warehouse_code,warehouse_name FROM vou_sale_return_details WHERE document_id=$1`,
		doc.ID).Scan(&kind, &customerObjectID, &customerVersionID, &customerCode, &customerName,
		&warehouseObjectID, &warehouseVersionID, &warehouseCode, &warehouseName)
	if err != nil {
		return s.internal("read sale return ledger detail", err)
	}
	rows, err := tx.Query(ctx, `SELECT id,product_object_id,product_version_id,product_code,
		product_name,product_unit,quantity_micros,unit_price_cents,line_amount_cents,remark
		FROM vou_sale_return_lines WHERE document_id=$1`, doc.ID)
	if err != nil {
		return err
	}
	type returnLine struct {
		id, productObjectID, productVersionID, productCode, productName, productUnit string
		quantity, price, amount                                                      int64
		remark                                                                       *string
	}
	lines := make([]returnLine, 0)
	for rows.Next() {
		var line returnLine
		if err = rows.Scan(&line.id, &line.productObjectID, &line.productVersionID, &line.productCode,
			&line.productName, &line.productUnit, &line.quantity, &line.price,
			&line.amount, &line.remark); err != nil {
			rows.Close()
			return err
		}
		lines = append(lines, line)
	}
	if err = rows.Err(); err != nil {
		rows.Close()
		return err
	}
	rows.Close()
	for _, line := range lines {
		if err = lockInventoryDimension(ctx, tx, warehouseObjectID, line.productObjectID); err != nil {
			return err
		}
		if err = q.InsertLedInventoryEntry(ctx, dbsqlc.InsertLedInventoryEntryParams{
			ID: newID(), GenerationID: posting.GenerationID, EntryType: posting.EntryType,
			SourceEntity: doc.Entity, SourceDocumentID: doc.ID, SourceDocumentNo: doc.DocumentNo,
			SourceLineID: line.id, SourceRevision: posting.SourceRevision, EffectiveDate: doc.BusinessDate,
			OccurredAt: posting.OccurredAt, ActorID: posting.ActorID, RequestID: posting.RequestID,
			WarehouseObjectID: warehouseObjectID, WarehouseVersionID: warehouseVersionID,
			WarehouseCode: warehouseCode, WarehouseName: warehouseName,
			ProductObjectID: line.productObjectID, ProductVersionID: line.productVersionID,
			ProductCode: line.productCode, ProductName: line.productName, ProductUnit: line.productUnit,
			QuantityDeltaMicros: line.quantity, Currency: doc.Currency,
			UnitPriceCents: &line.price, AmountCents: &line.amount,
			Remark: preferredRemark(line.remark, doc.Remark),
		}); err != nil {
			return s.writeError("post sale return inventory", err)
		}
		if kind == "AFTER_SALE" && line.amount != 0 {
			if err = q.InsertLedPartyEntry(ctx, partyParams(posting, doc, line.id, doc.BusinessDate,
				customerObjectID, customerVersionID, customerCode, customerName, "customer", -line.amount)); err != nil {
				return s.writeError("post sale return receivable", err)
			}
		}
	}
	return nil
}

func (s *Service) postPurchase(
	ctx context.Context,
	tx pgx.Tx,
	q *dbsqlc.Queries,
	posting postingContext,
) error {
	doc := posting.Document
	detail, err := q.GetVouPurchaseInboundDetail(ctx, doc.ID)
	if err != nil {
		return s.internal("read purchase ledger detail", err)
	}
	include, err := requireEffectiveDate(posting, doc.BusinessDate)
	if err != nil {
		return err
	}
	if !include {
		return nil
	}
	lines, err := q.ListVouPurchaseInboundLines(ctx, doc.ID)
	if err != nil {
		return s.internal("read purchase ledger lines", err)
	}
	for _, line := range lines {
		if err = lockInventoryDimension(ctx, tx, detail.WarehouseObjectID, line.ProductObjectID); err != nil {
			return s.internal("lock purchase inventory", err)
		}
		if err = q.InsertLedInventoryEntry(ctx, dbsqlc.InsertLedInventoryEntryParams{
			ID: newID(), GenerationID: posting.GenerationID, EntryType: posting.EntryType,
			SourceEntity: doc.Entity, SourceDocumentID: doc.ID, SourceDocumentNo: doc.DocumentNo,
			SourceLineID: line.ID, SourceRevision: posting.SourceRevision,
			EffectiveDate: doc.BusinessDate, OccurredAt: posting.OccurredAt,
			ActorID: posting.ActorID, RequestID: posting.RequestID,
			WarehouseObjectID: detail.WarehouseObjectID, WarehouseVersionID: detail.WarehouseVersionID,
			WarehouseCode: detail.WarehouseCode, WarehouseName: detail.WarehouseName,
			ProductObjectID: line.ProductObjectID, ProductVersionID: line.ProductVersionID,
			ProductCode: line.ProductCode, ProductName: line.ProductName, ProductUnit: line.ProductUnit,
			QuantityDeltaMicros: line.QuantityMicros, Currency: doc.Currency,
			UnitPriceCents: &line.UnitPriceCents, AmountCents: &line.LineAmountCents,
			Remark: preferredRemark(line.Remark, doc.Remark),
		}); err != nil {
			return s.writeError("post purchase inventory", err)
		}
		if line.LineAmountCents != 0 {
			if err = q.InsertLedPartyEntry(ctx, partyParams(
				posting, doc, line.ID, doc.BusinessDate,
				detail.SupplierObjectID, detail.SupplierVersionID,
				detail.SupplierCode, detail.SupplierName, "supplier", -line.LineAmountCents,
			)); err != nil {
				return s.writeError("post purchase payable", err)
			}
		}
	}
	return nil
}

func (s *Service) postPurchaseReturn(
	ctx context.Context,
	tx pgx.Tx,
	q *dbsqlc.Queries,
	posting postingContext,
) error {
	doc := posting.Document
	include, err := requireEffectiveDate(posting, doc.BusinessDate)
	if err != nil || !include {
		return err
	}
	var supplierID, supplierVersion, supplierCode, supplierName string
	var warehouseID, warehouseVersion, warehouseCode, warehouseName string
	err = tx.QueryRow(ctx, `SELECT supplier_object_id,supplier_version_id,supplier_code,supplier_name,
		warehouse_object_id,warehouse_version_id,warehouse_code,warehouse_name
		FROM vou_purchase_return_details WHERE document_id=$1`, doc.ID).Scan(
		&supplierID, &supplierVersion, &supplierCode, &supplierName,
		&warehouseID, &warehouseVersion, &warehouseCode, &warehouseName)
	if err != nil {
		return s.internal("read purchase return ledger detail", err)
	}
	rows, err := tx.Query(ctx, `SELECT id,product_object_id,product_version_id,product_code,
		product_name,product_unit,quantity_micros,unit_price_cents,line_amount_cents,remark
		FROM vou_purchase_return_lines WHERE document_id=$1`, doc.ID)
	if err != nil {
		return err
	}
	type purchaseReturnLine struct {
		id, productID, productVersion, productCode, productName, productUnit string
		quantity, price, amount                                              int64
		remark                                                               *string
	}
	lines := make([]purchaseReturnLine, 0)
	for rows.Next() {
		var line purchaseReturnLine
		if err = rows.Scan(&line.id, &line.productID, &line.productVersion, &line.productCode,
			&line.productName, &line.productUnit, &line.quantity, &line.price,
			&line.amount, &line.remark); err != nil {
			rows.Close()
			return err
		}
		lines = append(lines, line)
	}
	if err = rows.Err(); err != nil {
		rows.Close()
		return err
	}
	rows.Close()
	for _, line := range lines {
		if err = lockInventoryDimension(ctx, tx, warehouseID, line.productID); err != nil {
			return err
		}
		if err = q.InsertLedInventoryEntry(ctx, dbsqlc.InsertLedInventoryEntryParams{
			ID: newID(), GenerationID: posting.GenerationID, EntryType: posting.EntryType,
			SourceEntity: doc.Entity, SourceDocumentID: doc.ID, SourceDocumentNo: doc.DocumentNo,
			SourceLineID: line.id, SourceRevision: posting.SourceRevision, EffectiveDate: doc.BusinessDate,
			OccurredAt: posting.OccurredAt, ActorID: posting.ActorID, RequestID: posting.RequestID,
			WarehouseObjectID: warehouseID, WarehouseVersionID: warehouseVersion,
			WarehouseCode: warehouseCode, WarehouseName: warehouseName,
			ProductObjectID: line.productID, ProductVersionID: line.productVersion,
			ProductCode: line.productCode, ProductName: line.productName, ProductUnit: line.productUnit,
			QuantityDeltaMicros: -line.quantity, Currency: doc.Currency,
			UnitPriceCents: &line.price, AmountCents: &line.amount,
			Remark: preferredRemark(line.remark, doc.Remark),
		}); err != nil {
			return s.writeError("post purchase return inventory", err)
		}
		if line.amount != 0 {
			if err = q.InsertLedPartyEntry(ctx, partyParams(
				posting, doc, line.id, doc.BusinessDate, supplierID, supplierVersion,
				supplierCode, supplierName, "supplier", line.amount,
			)); err != nil {
				return s.writeError("post purchase return payable", err)
			}
		}
	}
	return nil
}

func (s *Service) postInventoryCount(
	ctx context.Context, tx pgx.Tx, q *dbsqlc.Queries, posting postingContext,
) error {
	doc := posting.Document
	include, err := requireEffectiveDate(posting, doc.BusinessDate)
	if err != nil || !include {
		return err
	}
	detail, err := q.GetVouInventoryCountDetail(ctx, doc.ID)
	if err != nil {
		return s.internal("read inventory count ledger detail", err)
	}
	lines, err := q.ListVouInventoryCountLines(ctx, doc.ID)
	if err != nil {
		return s.internal("read inventory count ledger lines", err)
	}
	for _, line := range lines {
		if line.DifferenceQuantityMicros == nil || line.BookQuantityMicros == nil {
			return domainError(ErrorConflict, "inventory count result is incomplete", nil, nil)
		}
		if *line.DifferenceQuantityMicros == 0 {
			continue
		}
		if err = lockInventoryDimension(ctx, tx, detail.WarehouseObjectID, line.ProductObjectID); err != nil {
			return s.internal("lock inventory count posting", err)
		}
		if err = q.InsertLedInventoryEntry(ctx, dbsqlc.InsertLedInventoryEntryParams{
			ID: newID(), GenerationID: posting.GenerationID, EntryType: posting.EntryType,
			SourceEntity: doc.Entity, SourceDocumentID: doc.ID, SourceDocumentNo: doc.DocumentNo,
			SourceLineID: line.ID, SourceRevision: posting.SourceRevision,
			EffectiveDate: doc.BusinessDate, OccurredAt: posting.OccurredAt,
			ActorID: posting.ActorID, RequestID: posting.RequestID,
			WarehouseObjectID: detail.WarehouseObjectID, WarehouseVersionID: detail.WarehouseVersionID,
			WarehouseCode: detail.WarehouseCode, WarehouseName: detail.WarehouseName,
			ProductObjectID: line.ProductObjectID, ProductVersionID: line.ProductVersionID,
			ProductCode: line.ProductCode, ProductName: line.ProductName, ProductUnit: line.ProductUnit,
			QuantityDeltaMicros: *line.DifferenceQuantityMicros, Currency: doc.Currency,
			Remark: preferredRemark(line.Remark, doc.Remark),
		}); err != nil {
			return s.writeError("post inventory count", err)
		}
	}
	return nil
}

func (s *Service) postReceipt(ctx context.Context, q *dbsqlc.Queries, posting postingContext) error {
	doc := posting.Document
	include, err := requireEffectiveDate(posting, doc.BusinessDate)
	if err != nil || !include {
		return err
	}
	detail, err := q.GetVouReceiptDetail(ctx, doc.ID)
	if err != nil {
		return s.internal("read receipt ledger detail", err)
	}
	if err = q.InsertLedFundEntry(ctx, fundParams(
		posting,
		doc,
		detail.FundAccountObjectID,
		detail.FundAccountVersionID,
		detail.FundAccountCode,
		detail.FundAccountName,
		doc.TotalAmountCents,
	)); err != nil {
		return s.writeError("post receipt fund", err)
	}
	if doc.Entity == voudomain.EntityOtherReceipt || doc.Entity == voudomain.EntityEmployeeRepayment {
		err = q.InsertLedOtherEntry(ctx, otherPartyParams(posting, doc, "", doc.BusinessDate,
			detail.CounterpartyObjectID, detail.CounterpartyVersionID, detail.CounterpartyCode,
			detail.CounterpartyName, detail.CounterpartyEntity, -doc.TotalAmountCents, detail.OtherCategory))
	} else {
		err = q.InsertLedPartyEntry(ctx, partyParams(posting, doc, "", doc.BusinessDate,
			detail.CounterpartyObjectID, detail.CounterpartyVersionID, detail.CounterpartyCode,
			detail.CounterpartyName, detail.CounterpartyEntity, -doc.TotalAmountCents))
	}
	if err != nil {
		return s.writeError("post receipt party", err)
	}
	return nil
}

func (s *Service) postPayment(ctx context.Context, q *dbsqlc.Queries, posting postingContext) error {
	doc := posting.Document
	include, err := requireEffectiveDate(posting, doc.BusinessDate)
	if err != nil || !include {
		return err
	}
	detail, err := q.GetVouPaymentDetail(ctx, doc.ID)
	if err != nil {
		return s.internal("read payment ledger detail", err)
	}
	if err = q.InsertLedFundEntry(ctx, fundParams(
		posting,
		doc,
		detail.FundAccountObjectID,
		detail.FundAccountVersionID,
		detail.FundAccountCode,
		detail.FundAccountName,
		-doc.TotalAmountCents,
	)); err != nil {
		return s.writeError("post payment fund", err)
	}
	if doc.Entity == voudomain.EntityOtherPayment || doc.Entity == voudomain.EntityEmployeeLoan {
		err = q.InsertLedOtherEntry(ctx, otherPartyParams(posting, doc, "", doc.BusinessDate,
			detail.CounterpartyObjectID, detail.CounterpartyVersionID, detail.CounterpartyCode,
			detail.CounterpartyName, detail.CounterpartyEntity, doc.TotalAmountCents, detail.OtherCategory))
	} else {
		err = q.InsertLedPartyEntry(ctx, partyParams(posting, doc, "", doc.BusinessDate,
			detail.CounterpartyObjectID, detail.CounterpartyVersionID, detail.CounterpartyCode,
			detail.CounterpartyName, detail.CounterpartyEntity, doc.TotalAmountCents))
	}
	if err != nil {
		return s.writeError("post payment party", err)
	}
	return nil
}

func (s *Service) postEmployeeLoanWriteoff(
	ctx context.Context, tx pgx.Tx, q *dbsqlc.Queries, posting postingContext,
) error {
	doc := posting.Document
	include, err := requireEffectiveDate(posting, doc.BusinessDate)
	if err != nil || !include {
		return err
	}
	detail, err := q.GetVouEmployeeLoanWriteoffDetail(ctx, doc.ID)
	if err != nil {
		return s.internal("read employee loan writeoff ledger detail", err)
	}
	currency := deref(doc.Currency)
	if err = lockPartyDimension(ctx, tx, "employee", detail.EmployeeObjectID, currency); err != nil {
		return s.writeError("lock employee loan balance", err)
	}
	balance, err := q.GetLedOtherBalanceAtDate(ctx, dbsqlc.GetLedOtherBalanceAtDateParams{
		GenerationID: posting.GenerationID, CounterpartyEntity: "employee",
		CounterpartyObjectID: detail.EmployeeObjectID, Currency: currency, AsOfDate: doc.BusinessDate,
	})
	if err != nil {
		return s.internal("read employee loan balance", err)
	}
	if balance < doc.TotalAmountCents {
		return domainError(ErrorConflict, "employee loan balance is insufficient for writeoff", map[string]any{
			"availableAmount": formatMoney(balance), "writeoffAmount": formatMoney(doc.TotalAmountCents),
		}, nil)
	}
	if err = q.InsertLedOtherEntry(ctx, otherPartyParams(
		posting, doc, "", doc.BusinessDate,
		detail.EmployeeObjectID, detail.EmployeeVersionID, detail.EmployeeCode, detail.EmployeeName,
		"employee", -doc.TotalAmountCents, nil,
	)); err != nil {
		return s.writeError("post employee loan writeoff", err)
	}
	return nil
}

func (s *Service) postExpense(ctx context.Context, q *dbsqlc.Queries, posting postingContext) error {
	doc := posting.Document
	include, err := requireEffectiveDate(posting, doc.BusinessDate)
	if err != nil || !include {
		return err
	}
	detail, err := q.GetVouExpenseReimbursementDetail(ctx, doc.ID)
	if err != nil {
		return s.internal("read expense ledger detail", err)
	}
	if detail.SettlementMode != "LEGACY_DIRECT" {
		return q.InsertLedOtherEntry(ctx, otherPartyParams(posting, doc, "", doc.BusinessDate,
			detail.EmployeeObjectID, detail.EmployeeVersionID, detail.EmployeeCode, detail.EmployeeName,
			"employee", -doc.TotalAmountCents, nil))
	}
	if detail.FundAccountObjectID == nil || detail.FundAccountVersionID == nil ||
		detail.FundAccountCode == nil || detail.FundAccountName == nil {
		return domainError(ErrorConflict, "legacy expense fund account is missing", nil, nil)
	}
	if err = q.InsertLedFundEntry(ctx, fundParams(
		posting,
		doc,
		*detail.FundAccountObjectID,
		*detail.FundAccountVersionID,
		*detail.FundAccountCode,
		*detail.FundAccountName,
		-doc.TotalAmountCents,
	)); err != nil {
		return s.writeError("post expense fund", err)
	}
	return nil
}

func (s *Service) postExpensePayment(ctx context.Context, q *dbsqlc.Queries, posting postingContext) error {
	doc := posting.Document
	include, err := requireEffectiveDate(posting, doc.BusinessDate)
	if err != nil || !include {
		return err
	}
	detail, err := q.GetVouExpensePaymentDetail(ctx, doc.ID)
	if err != nil {
		return s.internal("read expense payment ledger detail", err)
	}
	if err = q.InsertLedFundEntry(ctx, fundParams(
		posting, doc,
		detail.FundAccountObjectID, detail.FundAccountVersionID,
		detail.FundAccountCode, detail.FundAccountName,
		-doc.TotalAmountCents,
	)); err != nil {
		return s.writeError("post expense payment fund", err)
	}
	if err = q.InsertLedOtherEntry(ctx, otherPartyParams(posting, doc, "", doc.BusinessDate,
		detail.EmployeeObjectID, detail.EmployeeVersionID, detail.EmployeeCode, detail.EmployeeName,
		"employee", doc.TotalAmountCents, nil)); err != nil {
		return s.writeError("post expense payment party", err)
	}
	return nil
}

func (s *Service) postOtherIncome(ctx context.Context, q *dbsqlc.Queries, posting postingContext) error {
	doc := posting.Document
	include, err := requireEffectiveDate(posting, doc.BusinessDate)
	if err != nil || !include {
		return err
	}
	detail, err := q.GetVouOtherIncomeDetail(ctx, doc.ID)
	if err != nil {
		return s.internal("read other income ledger detail", err)
	}
	if err = q.InsertLedFundEntry(ctx, fundParams(
		posting,
		doc,
		detail.FundAccountObjectID,
		detail.FundAccountVersionID,
		detail.FundAccountCode,
		detail.FundAccountName,
		doc.TotalAmountCents,
	)); err != nil {
		return s.writeError("post other income fund", err)
	}
	return nil
}

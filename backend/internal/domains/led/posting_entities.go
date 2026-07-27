package led

import (
	"context"

	dbsqlc "github.com/hansonyu183/zerp/backend/internal/database/sqlc"
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
		product_name,product_unit,quantity_micros FROM vou_sale_outbound_lines WHERE document_id=$1`, doc.ID)
	if err != nil {
		return err
	}
	type outboundLine struct {
		id, productObjectID, productVersionID, productCode, productName, productUnit string
		quantity                                                                     int64
	}
	lines := []outboundLine{}
	for rows.Next() {
		var line outboundLine
		if err = rows.Scan(&line.id, &line.productObjectID, &line.productVersionID, &line.productCode,
			&line.productName, &line.productUnit, &line.quantity); err != nil {
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
			QuantityDeltaMicros: -line.quantity,
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
	var warehouseObjectID, warehouseVersionID, warehouseCode, warehouseName string
	err = tx.QueryRow(ctx, `SELECT customer_object_id,customer_version_id,customer_code,customer_name,
		warehouse_object_id,warehouse_version_id,warehouse_code,warehouse_name
		FROM vou_sale_signoff_details WHERE document_id=$1`, doc.ID).Scan(
		&customerObjectID, &customerVersionID, &customerCode, &customerName,
		&warehouseObjectID, &warehouseVersionID, &warehouseCode, &warehouseName)
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
		if line.rejected > 0 {
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
				QuantityDeltaMicros: line.rejected,
			})
			if err != nil {
				return s.writeError("post sale rejection inventory", err)
			}
		}
		if line.signed > 0 {
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

func (s *Service) postPurchase(
	ctx context.Context,
	tx pgx.Tx,
	q *dbsqlc.Queries,
	posting postingContext,
) error {
	doc := posting.Document
	detail, err := q.GetVouPurchaseOrderDetail(ctx, doc.ID)
	if err != nil {
		return s.internal("read purchase ledger detail", err)
	}
	includeInventory, err := requireEffectiveDate(posting, detail.InboundDate)
	if err != nil {
		return err
	}
	includeParty, err := requireEffectiveDate(posting, doc.BusinessDate)
	if err != nil {
		return err
	}
	lines, err := q.ListVouProductLines(ctx, doc.ID)
	if err != nil {
		return s.internal("read purchase ledger lines", err)
	}
	for _, line := range lines {
		if line.InboundQtyMicros == nil {
			return domainError(
				ErrorConflict,
				"executed purchase is missing inbound quantity",
				map[string]any{"documentNo": doc.DocumentNo},
				nil,
			)
		}
		if includeInventory {
			if detail.WarehouseObjectID == nil || detail.WarehouseVersionID == nil ||
				detail.WarehouseCode == nil || detail.WarehouseName == nil {
				return domainError(
					ErrorConflict,
					"executed purchase is missing warehouse data",
					map[string]any{"documentNo": doc.DocumentNo},
					nil,
				)
			}
			if err = lockInventoryDimension(ctx, tx, *detail.WarehouseObjectID, line.ProductObjectID); err != nil {
				return s.internal("lock purchase inventory", err)
			}
			if err = q.InsertLedInventoryEntry(ctx, inventoryParams(
				posting,
				doc,
				line,
				detail.InboundDate,
				*detail.WarehouseObjectID,
				*detail.WarehouseVersionID,
				*detail.WarehouseCode,
				*detail.WarehouseName,
				*line.InboundQtyMicros,
			)); err != nil {
				return s.writeError("post purchase inventory", err)
			}
		}
		if includeParty {
			amount, amountErr := lineAmountCents(*line.InboundQtyMicros, line.UnitPriceCents)
			if amountErr != nil {
				return domainError(
					ErrorConflict,
					"invalid purchase ledger amount",
					map[string]any{"documentNo": doc.DocumentNo},
					amountErr,
				)
			}
			if err = q.InsertLedPartyEntry(ctx, partyParams(
				posting,
				doc,
				line.ID,
				doc.BusinessDate,
				detail.SupplierObjectID,
				detail.SupplierVersionID,
				detail.SupplierCode,
				detail.SupplierName,
				"supplier",
				-amount,
			)); err != nil {
				return s.writeError("post purchase payable", err)
			}
		}
	}
	return nil
}

func (s *Service) postIntermediarySale(ctx context.Context, q *dbsqlc.Queries, posting postingContext) error {
	doc := posting.Document
	detail, err := q.GetVouIntermediarySaleOrderDetail(ctx, doc.ID)
	if err != nil {
		return s.internal("read intermediary ledger detail", err)
	}
	include, err := requireEffectiveDate(posting, doc.BusinessDate)
	if err != nil || !include {
		return err
	}
	lines, err := q.ListVouProductLines(ctx, doc.ID)
	if err != nil {
		return s.internal("read intermediary ledger lines", err)
	}
	for _, line := range lines {
		if line.SignedQtyMicros == nil || *line.SignedQtyMicros == 0 {
			continue
		}
		if line.PurchaseUnitPriceCents == nil {
			return domainError(
				ErrorConflict,
				"intermediary purchaseUnitPrice is missing",
				map[string]any{"documentNo": doc.DocumentNo},
				nil,
			)
		}
		saleAmount, amountErr := lineAmountCents(*line.SignedQtyMicros, line.UnitPriceCents)
		if amountErr != nil {
			return domainError(ErrorConflict, "invalid intermediary sale amount", nil, amountErr)
		}
		purchaseAmount, amountErr := lineAmountCents(*line.SignedQtyMicros, *line.PurchaseUnitPriceCents)
		if amountErr != nil {
			return domainError(ErrorConflict, "invalid intermediary purchase amount", nil, amountErr)
		}
		if err = q.InsertLedPartyEntry(ctx, partyParams(
			posting,
			doc,
			line.ID,
			doc.BusinessDate,
			detail.CustomerObjectID,
			detail.CustomerVersionID,
			detail.CustomerCode,
			detail.CustomerName,
			"customer",
			saleAmount,
		)); err != nil {
			return s.writeError("post intermediary receivable", err)
		}
		if err = q.InsertLedPartyEntry(ctx, partyParams(
			posting,
			doc,
			line.ID,
			doc.BusinessDate,
			detail.SupplierObjectID,
			detail.SupplierVersionID,
			detail.SupplierCode,
			detail.SupplierName,
			"supplier",
			-purchaseAmount,
		)); err != nil {
			return s.writeError("post intermediary payable", err)
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
	if err = q.InsertLedPartyEntry(ctx, partyParams(
		posting,
		doc,
		"",
		doc.BusinessDate,
		detail.CounterpartyObjectID,
		detail.CounterpartyVersionID,
		detail.CounterpartyCode,
		detail.CounterpartyName,
		detail.CounterpartyEntity,
		-doc.TotalAmountCents,
	)); err != nil {
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
	if err = q.InsertLedPartyEntry(ctx, partyParams(
		posting,
		doc,
		"",
		doc.BusinessDate,
		detail.CounterpartyObjectID,
		detail.CounterpartyVersionID,
		detail.CounterpartyCode,
		detail.CounterpartyName,
		detail.CounterpartyEntity,
		doc.TotalAmountCents,
	)); err != nil {
		return s.writeError("post payment party", err)
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
	if err = q.InsertLedFundEntry(ctx, fundParams(
		posting,
		doc,
		detail.FundAccountObjectID,
		detail.FundAccountVersionID,
		detail.FundAccountCode,
		detail.FundAccountName,
		-doc.TotalAmountCents,
	)); err != nil {
		return s.writeError("post expense fund", err)
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

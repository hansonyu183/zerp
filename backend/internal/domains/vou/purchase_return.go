package vou

import (
	"context"
	"errors"
	"fmt"
	"math"
	"time"

	dbsqlc "github.com/hansonyu183/zerp/backend/internal/database/sqlc"
	bobdomain "github.com/hansonyu183/zerp/backend/internal/domains/bob"
	"github.com/hansonyu183/zerp/backend/internal/platform/approval"
	"github.com/jackc/pgx/v5"
)

type fixedPurchaseReturnLine struct {
	sourceLineID, inboundID, orderLineID                             string
	productID, productVersion, productCode, productName, productUnit string
	quantity, price, amount                                          int64
	remark                                                           *string
}

type purchaseReturnSource struct {
	orderID, currency, supplierID, supplierVersion, supplierCode, supplierName string
	lines                                                                      []fixedPurchaseReturnLine
	total                                                                      int64
}

func (s *Service) resolvePurchaseReturnSource(
	ctx context.Context, tx pgx.Tx, replacingID string, date time.Time, inputs []ReturnLineInput,
) (purchaseReturnSource, error) {
	var result purchaseReturnSource
	if len(inputs) == 0 || len(inputs) > 200 {
		return result, domainError(ErrorValidation, "returnLines must contain 1 to 200 items", nil, nil)
	}
	seen := map[string]bool{}
	for _, input := range inputs {
		if !validID(input.SourceLineID) || seen[input.SourceLineID] {
			return result, domainError(ErrorValidation, "invalid sourceLineId", nil, nil)
		}
		qty, err := quantityMicros(input.BaseQuantity, false)
		if err != nil {
			return result, domainError(ErrorValidation, "invalid return quantity", nil, err)
		}
		remark, err := lineRemark(input.Remark)
		if err != nil {
			return result, err
		}
		var line fixedPurchaseReturnLine
		var orderID string
		var inboundStatus, orderStatus, fulfillment string
		var inboundDate time.Time
		err = tx.QueryRow(ctx, `SELECT l.document_id,x.source_order_id,l.source_order_line_id,
			da.status,d.business_date,oa.status,od.fulfillment_status,o.currency,
			x.supplier_object_id,x.supplier_approval_entry_id,x.supplier_code,x.supplier_name,
			l.product_object_id,l.product_approval_entry_id,l.product_code,l.product_name,l.entered_unit_symbol,
			l.base_quantity_micros,l.unit_price_cents
			FROM vou_purchase_inbound_lines l
			JOIN vou_purchase_inbound_details x ON x.document_id=l.document_id
			JOIN vou_documents d ON d.id=l.document_id
			JOIN approval_entries da ON da.id=d.approval_entry_id AND da.domain='vou'
				AND da.entity=d.entity AND da.subject_id=d.id
			JOIN vou_documents o ON o.id=x.source_order_id
			JOIN approval_entries oa ON oa.id=o.approval_entry_id AND oa.domain='vou'
				AND oa.entity=o.entity AND oa.subject_id=o.id
			JOIN vou_purchase_order_details od ON od.document_id=o.id
			WHERE l.id=$1 FOR UPDATE OF l,o,od`, input.SourceLineID).Scan(
			&line.inboundID, &orderID, &line.orderLineID,
			&inboundStatus, &inboundDate, &orderStatus, &fulfillment, &result.currency,
			&result.supplierID, &result.supplierVersion, &result.supplierCode, &result.supplierName,
			&line.productID, &line.productVersion, &line.productCode, &line.productName, &line.productUnit,
			&line.quantity, &line.price,
		)
		if errors.Is(err, pgx.ErrNoRows) {
			return result, domainError(ErrorValidation, "source inbound line not found", nil, nil)
		}
		if err != nil {
			return result, s.internal("lock purchase return source", err)
		}
		if inboundStatus != StatusApproved || date.Before(inboundDate) ||
			orderStatus != StatusApproved {
			return result, domainError(ErrorConflict, "source inbound is not returnable", nil, nil)
		}
		if result.orderID == "" {
			result.orderID = orderID
		} else if result.orderID != orderID {
			return result, domainError(ErrorValidation, "return lines must belong to one purchase fulfillment", nil, nil)
		}
		var occupied int64
		if err = tx.QueryRow(ctx, `SELECT COALESCE(sum(base_quantity_micros),0)
			FROM vou_purchase_return_lines
			WHERE source_inbound_line_id=$1
			  AND document_id<>COALESCE(NULLIF($2,''),'00000000000000000000000000')`,
			input.SourceLineID, replacingID).Scan(&occupied); err != nil {
			return result, err
		}
		var inboundQty int64
		if err = tx.QueryRow(ctx, `SELECT base_quantity_micros FROM vou_purchase_inbound_lines
			WHERE id=$1`, input.SourceLineID).Scan(&inboundQty); err != nil {
			return result, err
		}
		if qty > inboundQty-occupied {
			return result, domainError(ErrorConflict, "return quantity exceeds available inbound quantity",
				map[string]any{"sourceLineId": input.SourceLineID}, nil)
		}
		line.sourceLineID, line.quantity, line.remark = input.SourceLineID, qty, remark
		line.amount, err = lineAmountCents(qty, line.price)
		if err != nil || result.total > math.MaxInt64-line.amount {
			return result, domainError(ErrorValidation, "return amount is out of range", nil, err)
		}
		result.total += line.amount
		result.lines = append(result.lines, line)
		seen[input.SourceLineID] = true
	}
	return result, nil
}

func (s *Service) CreatePurchaseReturn(
	ctx context.Context, input CreateInput, actor approval.Actor,
) (MutationResult, error) {
	actorID, requestID := actor.ID(), actor.RequestID()
	if !validID(actorID) {
		return MutationResult{}, domainError(ErrorValidation, "invalid actor", nil, nil)
	}
	date, reason, err := validateReturnHeader(input.Data)
	if err != nil {
		return MutationResult{}, err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return MutationResult{}, s.internal("begin purchase return", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	source, err := s.resolvePurchaseReturnSource(ctx, tx, "", date, input.Data.ReturnLines)
	if err != nil {
		return MutationResult{}, err
	}
	warehouse, err := s.resolver.ResolveLatestApprovedReference(ctx, tx, bobdomain.EntityWarehouse, input.Data.Warehouse.ObjectID)
	if err != nil {
		return MutationResult{}, err
	}
	counter, err := s.queries.WithTx(tx).NextVouNumberCounter(ctx, dbsqlc.NextVouNumberCounterParams{
		Entity: EntityPurchaseReturn, BusinessDate: dateValue(date),
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return MutationResult{}, domainError(ErrorConflict, "document number exhausted", nil, nil)
		}
		return MutationResult{}, s.writeError("allocate purchase return number", err)
	}
	id, number := newID(), fmt.Sprintf("%s-%s-%04d", entityPrefix(EntityPurchaseReturn), date.Format("20060102"), counter)
	entry, err := s.createDocumentApproval(ctx, tx, EntityPurchaseReturn, id, actor)
	if err != nil {
		return MutationResult{}, err
	}
	if _, err = tx.Exec(ctx, `INSERT INTO vou_documents(
		id,entity,document_no,approval_entry_id,business_date,currency,total_amount_cents,remark,
		parent_entity,parent_document_id
	) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
		id, EntityPurchaseReturn, number, entry.ID, date, source.currency, source.total,
		optionalText(input.Data.Remark), EntityPurchaseOrder, source.orderID); err != nil {
		return MutationResult{}, s.writeError("insert purchase return", err)
	}
	if err = s.insertPurchaseReturnDetail(ctx, tx, id, reason, source, warehouse); err != nil {
		return MutationResult{}, err
	}
	if err = s.insertPurchaseReturnLines(ctx, tx, id, source.lines); err != nil {
		return MutationResult{}, err
	}
	if err = s.events.Publish(ctx, tx, DocumentCreatedEvent{Entity: EntityPurchaseReturn,
		DocumentID: id, DocumentNo: number, Revision: 1, ParentEntity: EntityPurchaseOrder,
		ParentDocumentID: source.orderID, ActorID: actorID, RequestID: requestID}); err != nil {
		return MutationResult{}, err
	}
	if err = tx.Commit(ctx); err != nil {
		return MutationResult{}, err
	}
	return MutationResult{DocumentID: id, DocumentNo: number, Approval: approval.MetaFromEntry(entry)}, nil
}

func (s *Service) SavePurchaseReturn(
	ctx context.Context, input SaveInput, actor approval.Actor,
) (MutationResult, error) {
	if err := validateDocumentRevision(input.DocumentID, input.Revision); err != nil {
		return MutationResult{}, err
	}
	date, reason, err := validateReturnHeader(input.Data)
	if err != nil {
		return MutationResult{}, err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return MutationResult{}, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	document, err := lockDocument(ctx, tx, input.DocumentID, EntityPurchaseReturn)
	if err = documentWriteConflict(err, document.Revision, input.Revision, document.Status, StatusDraft); err != nil {
		return MutationResult{}, err
	}
	coordinator, prepared, err := s.prepareDraftSave(ctx, tx, document, input.Revision, actor)
	if err != nil {
		return MutationResult{}, err
	}
	source, err := s.resolvePurchaseReturnSource(ctx, tx, input.DocumentID, date, input.Data.ReturnLines)
	if err != nil {
		return MutationResult{}, err
	}
	if document.ParentDocumentID == nil || source.orderID != *document.ParentDocumentID {
		return MutationResult{}, domainError(ErrorConflict, "purchase fulfillment cannot be changed", nil, nil)
	}
	var savedObjectID, savedEntryID string
	if err = tx.QueryRow(ctx, `SELECT warehouse_object_id,warehouse_approval_entry_id
		FROM vou_purchase_return_details WHERE document_id=$1`, input.DocumentID).Scan(&savedObjectID, &savedEntryID); err != nil {
		return MutationResult{}, err
	}
	selected, err := s.resolveSelectedReference(ctx, tx, bobdomain.EntityWarehouse, input.Data.Warehouse,
		&bobdomain.EffectiveReference{ObjectID: savedObjectID, ApprovalEntryID: savedEntryID}, false)
	if err != nil {
		return MutationResult{}, err
	}
	warehouse := *selected
	if _, err = tx.Exec(ctx, `DELETE FROM vou_purchase_return_lines WHERE document_id=$1`,
		input.DocumentID); err != nil {
		return MutationResult{}, err
	}
	if _, err = tx.Exec(ctx, `UPDATE vou_purchase_return_details SET return_reason=$1,
		warehouse_object_id=$2,warehouse_approval_entry_id=$3,warehouse_code=$4,warehouse_name=$5
		WHERE document_id=$6`, reason, warehouse.ObjectID, warehouse.ApprovalEntryID, warehouse.Code,
		warehouse.Data.Name, input.DocumentID); err != nil {
		return MutationResult{}, err
	}
	if err = s.insertPurchaseReturnLines(ctx, tx, input.DocumentID, source.lines); err != nil {
		return MutationResult{}, err
	}
	if _, err = tx.Exec(ctx, `UPDATE vou_documents SET business_date=$1,total_amount_cents=$2,
		remark=$3 WHERE id=$4`, date, source.total, optionalText(input.Data.Remark), input.DocumentID); err != nil {
		return MutationResult{}, s.writeError("save purchase return", err)
	}
	entry, err := s.commitDraftSave(ctx, tx, s.queries.WithTx(tx), document, coordinator, prepared)
	if err != nil {
		return MutationResult{}, err
	}
	if err = tx.Commit(ctx); err != nil {
		return MutationResult{}, err
	}
	return MutationResult{DocumentID: document.ID, DocumentNo: document.DocumentNo,
		Approval: approval.MetaFromEntry(entry)}, nil
}

func (s *Service) insertPurchaseReturnDetail(
	ctx context.Context, tx pgx.Tx, id, reason string, source purchaseReturnSource,
	warehouse bobdomain.EffectiveReference,
) error {
	_, err := tx.Exec(ctx, `INSERT INTO vou_purchase_return_details(
		document_id,source_order_id,return_reason,supplier_object_id,supplier_approval_entry_id,
		supplier_code,supplier_name,warehouse_object_id,warehouse_approval_entry_id,warehouse_code,warehouse_name
	) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, id, source.orderID, reason,
		source.supplierID, source.supplierVersion, source.supplierCode, source.supplierName,
		warehouse.ObjectID, warehouse.ApprovalEntryID, warehouse.Code, warehouse.Data.Name)
	return err
}

func (s *Service) insertPurchaseReturnLines(
	ctx context.Context, tx pgx.Tx, id string, lines []fixedPurchaseReturnLine,
) error {
	for index, line := range lines {
		if _, err := tx.Exec(ctx, `INSERT INTO vou_purchase_return_lines(
			id,document_id,source_inbound_line_id,source_inbound_id,source_order_line_id,line_no,
			product_object_id,product_approval_entry_id,product_code,product_name,entered_unit_symbol,
			base_quantity_micros,unit_price_cents,line_amount_cents,remark
		) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
			newID(), id, line.sourceLineID, line.inboundID, line.orderLineID, index+1,
			line.productID, line.productVersion, line.productCode, line.productName, line.productUnit,
			line.quantity, line.price, line.amount, line.remark); err != nil {
			return err
		}
	}
	return nil
}

func (s *Service) loadPurchaseReturnData(
	ctx context.Context, document documentRecord, data DocumentDataView,
) (DocumentDataView, error) {
	var supplierID, supplierVersion, supplierCode, supplierName string
	var warehouseID, warehouseVersion, warehouseCode, warehouseName string
	if err := s.pool.QueryRow(ctx, `SELECT return_reason,supplier_object_id,supplier_approval_entry_id,
		supplier_code,supplier_name,warehouse_object_id,warehouse_approval_entry_id,warehouse_code,warehouse_name
		FROM vou_purchase_return_details WHERE document_id=$1`, document.ID).Scan(
		&data.ReturnReason, &supplierID, &supplierVersion, &supplierCode, &supplierName,
		&warehouseID, &warehouseVersion, &warehouseCode, &warehouseName); err != nil {
		return data, err
	}
	data.Supplier = reference(supplierID, supplierVersion, "supplier", supplierCode, supplierName, "", "", "")
	data.Warehouse = reference(warehouseID, warehouseVersion, "warehouse", warehouseCode, warehouseName, "", "", "")
	rows, err := s.pool.Query(ctx, `SELECT l.id,l.source_inbound_line_id,l.source_inbound_id,
		s.document_no,l.line_no,l.product_object_id,l.product_approval_entry_id,l.product_code,l.product_name,
		l.entered_unit_symbol,l.base_quantity_micros,l.unit_price_cents,l.line_amount_cents,COALESCE(l.remark,'')
		FROM vou_purchase_return_lines l JOIN vou_documents s ON s.id=l.source_inbound_id
		WHERE l.document_id=$1 ORDER BY l.line_no`, document.ID)
	if err != nil {
		return data, err
	}
	defer rows.Close()
	for rows.Next() {
		var line ManagedLineView
		var productID, productVersion, productCode, productName, productUnit string
		var quantity, price, amount int64
		if err = rows.Scan(&line.LineID, &line.SourceLineID, &line.SourceDocumentID,
			&line.SourceDocumentNo, &line.LineNo, &productID, &productVersion, &productCode,
			&productName, &productUnit, &quantity, &price, &amount, &line.Remark); err != nil {
			return data, err
		}
		line.Product = reference(productID, productVersion, "product", productCode, productName, productUnit, "", "")
		line.EnteredQuantity = formatQuantity(quantity)
		line.EnteredUnit = &UnitSnapshotView{Symbol: productUnit}
		line.BaseQuantity, line.UnitPrice, line.LineAmount =
			formatQuantity(quantity), formatMoney(price), formatMoney(amount)
		data.Lines = append(data.Lines, line)
	}
	return data, rows.Err()
}

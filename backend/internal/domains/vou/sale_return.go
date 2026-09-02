package vou

import (
	"context"
	"errors"
	"fmt"
	"math"
	"strings"
	"time"
	"unicode/utf8"

	dbsqlc "github.com/hansonyu183/zerp/backend/internal/database/sqlc"
	bobdomain "github.com/hansonyu183/zerp/backend/internal/domains/bob"
	"github.com/hansonyu183/zerp/backend/internal/platform/approval"
	"github.com/hansonyu183/zerp/backend/internal/platform/systemidentity"
	"github.com/jackc/pgx/v5"
)

const (
	returnKindRefusal   = "REFUSAL"
	returnKindAfterSale = "AFTER_SALE"
)

type fixedReturnLine struct {
	sourceLineID, signoffID, productID, productVersion, productCode, productName, productUnit string
	quantity, price, amount                                                                   int64
	remark                                                                                    *string
	signoffDate                                                                               time.Time
}

type returnSource struct {
	orderID, currency, customerID, rootCustomerID, customerVersion, customerCode, customerName string
	lines                                                                                      []fixedReturnLine
	total                                                                                      int64
}

func validateReturnHeader(data DraftInput) (time.Time, string, error) {
	date, err := time.Parse(dateLayout, strings.TrimSpace(data.BusinessDate))
	if err != nil {
		return time.Time{}, "", domainError(ErrorValidation, "invalid businessDate", nil, nil)
	}
	reason := strings.TrimSpace(data.ReturnReason)
	if reason == "" || utf8.RuneCountInString(reason) > 1000 {
		return time.Time{}, "", domainError(ErrorValidation, "invalid returnReason", nil, nil)
	}
	if err = validateReference(data.Warehouse, "warehouse", true); err != nil {
		return time.Time{}, "", err
	}
	return date, reason, nil
}

func (s *Service) resolveReturnSource(
	ctx context.Context, tx pgx.Tx, replacingID string, date time.Time, inputs []ReturnLineInput,
) (returnSource, error) {
	var result returnSource
	if len(inputs) == 0 || len(inputs) > 200 {
		return result, domainError(ErrorValidation, "returnLines must contain 1 to 200 items", nil, nil)
	}
	seen := map[string]bool{}
	for _, input := range inputs {
		if !validID(input.SourceLineID) || seen[input.SourceLineID] {
			return result, domainError(ErrorValidation, "invalid sourceLineId", nil, nil)
		}
		quantity, err := quantityMicros(input.BaseQuantity, false)
		if err != nil {
			return result, domainError(ErrorValidation, "invalid return quantity", nil, err)
		}
		remark, err := lineRemark(input.Remark)
		if err != nil {
			return result, err
		}
		var line fixedReturnLine
		var signed int64
		var orderID, currency, customerID, rootCustomerID, customerVersion, customerCode, customerName, status string
		err = tx.QueryRow(ctx, `SELECT sl.document_id,sd.source_order_id,a.status,d.business_date,
			od.currency,sd.customer_object_id,sd.customer_id,sd.customer_approval_entry_id,sd.customer_code,sd.customer_name,
			sl.product_object_id,sl.product_approval_entry_id,sl.product_code,sl.product_name,sl.entered_unit_symbol,
			sl.signed_base_quantity_micros,sl.unit_price_cents
			FROM vou_sale_signoff_lines sl
			JOIN vou_sale_signoff_details sd ON sd.document_id=sl.document_id
			JOIN vou_documents d ON d.id=sl.document_id
			JOIN approval_entries a ON a.id=d.approval_entry_id AND a.domain='vou'
				AND a.entity=d.entity AND a.subject_id=d.id
			JOIN vou_documents od ON od.id=sd.source_order_id
			WHERE sl.id=$1 FOR UPDATE OF sl`, input.SourceLineID).Scan(
			&line.signoffID, &orderID, &status, &line.signoffDate,
			&currency, &customerID, &rootCustomerID, &customerVersion, &customerCode, &customerName,
			&line.productID, &line.productVersion, &line.productCode, &line.productName, &line.productUnit,
			&signed, &line.price,
		)
		if errors.Is(err, pgx.ErrNoRows) {
			return result, domainError(ErrorValidation, "source signoff line not found", nil, nil)
		}
		if err != nil {
			return result, s.internal("lock return source", err)
		}
		if status != StatusApproved || date.Before(line.signoffDate) {
			return result, domainError(ErrorConflict, "source signoff is not returnable", nil, nil)
		}
		if result.orderID == "" {
			result.orderID, result.currency = orderID, currency
			result.customerID, result.rootCustomerID, result.customerVersion = customerID, rootCustomerID, customerVersion
			result.customerCode, result.customerName = customerCode, customerName
		} else if result.orderID != orderID {
			return result, domainError(ErrorValidation, "return lines must belong to one sales fulfillment", nil, nil)
		}
		var occupied int64
		if err = tx.QueryRow(ctx, `SELECT COALESCE(sum(rl.base_quantity_micros),0)
			FROM vou_sale_return_lines rl
			JOIN vou_sale_return_details rd ON rd.document_id=rl.document_id
			WHERE rl.source_signoff_line_id=$1 AND rd.return_kind='AFTER_SALE'
			  AND rl.document_id<>COALESCE(NULLIF($2,''),'00000000000000000000000000')`,
			input.SourceLineID, replacingID).Scan(&occupied); err != nil {
			return result, err
		}
		if quantity > signed-occupied {
			return result, domainError(ErrorConflict, "return quantity exceeds available signed quantity",
				map[string]any{"sourceLineId": input.SourceLineID}, nil)
		}
		line.sourceLineID, line.quantity, line.remark = input.SourceLineID, quantity, remark
		line.amount, err = lineAmountCents(quantity, line.price)
		if err != nil || result.total > math.MaxInt64-line.amount {
			return result, domainError(ErrorValidation, "return amount is out of range", nil, err)
		}
		result.total += line.amount
		result.lines = append(result.lines, line)
		seen[input.SourceLineID] = true
	}
	return result, nil
}

func (s *Service) CreateSaleReturn(
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
		return MutationResult{}, s.internal("begin sale return", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	source, err := s.resolveReturnSource(ctx, tx, "", date, input.Data.ReturnLines)
	if err != nil {
		return MutationResult{}, err
	}
	warehouse, err := s.resolver.ResolveCurrentReference(ctx, tx, bobdomain.EntityWarehouse, input.Data.Warehouse.ObjectID)
	if err != nil {
		return MutationResult{}, err
	}
	counter, err := s.queries.WithTx(tx).NextVouNumberCounter(ctx, dbsqlc.NextVouNumberCounterParams{
		Entity: EntitySaleReturn, BusinessDate: dateValue(date),
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return MutationResult{}, domainError(ErrorConflict, "document number exhausted", nil, nil)
		}
		return MutationResult{}, s.writeError("allocate sale return number", err)
	}
	id, number := newID(), fmt.Sprintf("%s-%s-%04d", entityPrefix(EntitySaleReturn), date.Format("20060102"), counter)
	entry, err := s.createDocumentApproval(ctx, tx, EntitySaleReturn, id, actor)
	if err != nil {
		return MutationResult{}, err
	}
	if _, err = tx.Exec(ctx, `INSERT INTO vou_documents(
		id,entity,document_no,approval_entry_id,business_date,currency,total_amount_cents,remark,
		parent_entity,parent_document_id
	) VALUES($1,'sale-return',$2,$3,$4,$5,$6,$7,'sale-order',$8)`,
		id, number, entry.ID, date, source.currency, source.total, optionalText(input.Data.Remark),
		source.orderID); err != nil {
		return MutationResult{}, s.writeError("insert sale return", err)
	}
	if err = s.insertSaleReturnDetail(ctx, s.queries.WithTx(tx), id, returnKindAfterSale, "", reason, source, warehouse); err != nil {
		return MutationResult{}, err
	}
	if err = s.insertSaleReturnLines(ctx, s.queries.WithTx(tx), id, source.lines); err != nil {
		return MutationResult{}, err
	}
	if err = s.events.Publish(ctx, tx, DocumentCreatedEvent{Entity: EntitySaleReturn,
		DocumentID: id, DocumentNo: number, Revision: 1, ParentEntity: EntitySaleOrder,
		ParentDocumentID: source.orderID, ActorID: actorID, RequestID: requestID}); err != nil {
		return MutationResult{}, err
	}
	if err = tx.Commit(ctx); err != nil {
		return MutationResult{}, s.writeError("commit sale return", err)
	}
	return MutationResult{DocumentID: id, DocumentNo: number, Approval: approval.MetaFromEntry(entry)}, nil
}

func (s *Service) SaveSaleReturn(
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
	document, err := lockDocument(ctx, tx, input.DocumentID, EntitySaleReturn)
	if err = documentWriteConflict(err, document.Revision, input.Revision, document.Status, StatusDraft); err != nil {
		return MutationResult{}, err
	}
	var kind string
	if err = tx.QueryRow(ctx, `SELECT return_kind FROM vou_sale_return_details WHERE document_id=$1`,
		input.DocumentID).Scan(&kind); err != nil {
		return MutationResult{}, err
	}
	if kind == returnKindRefusal {
		return s.saveRefusalReturnHeader(ctx, tx, document, input, date, reason, actor)
	}
	source, err := s.resolveReturnSource(ctx, tx, input.DocumentID, date, input.Data.ReturnLines)
	if err != nil {
		return MutationResult{}, err
	}
	var savedObjectID, savedEntryID string
	if err := tx.QueryRow(ctx, `SELECT warehouse_object_id,warehouse_approval_entry_id
		FROM vou_sale_return_details WHERE document_id=$1`, input.DocumentID).Scan(&savedObjectID, &savedEntryID); err != nil {
		return MutationResult{}, err
	}
	selected, err := s.resolveSelectedReference(ctx, tx, bobdomain.EntityWarehouse, input.Data.Warehouse,
		&bobdomain.EffectiveReference{ObjectID: savedObjectID, ApprovalEntryID: savedEntryID}, false)
	if err != nil {
		return MutationResult{}, err
	}
	warehouse := *selected
	if source.orderID != *document.ParentDocumentID {
		return MutationResult{}, domainError(ErrorConflict, "sales fulfillment cannot be changed", nil, nil)
	}
	if _, err = tx.Exec(ctx, `DELETE FROM vou_sale_return_lines WHERE document_id=$1`, input.DocumentID); err != nil {
		return MutationResult{}, err
	}
	if _, err = tx.Exec(ctx, `UPDATE vou_sale_return_details SET return_reason=$1,
		warehouse_object_id=$2,warehouse_approval_entry_id=$3,warehouse_code=$4,warehouse_name=$5
		WHERE document_id=$6`, reason, warehouse.ObjectID, warehouse.ApprovalEntryID,
		warehouse.Code, warehouse.Data.Name, input.DocumentID); err != nil {
		return MutationResult{}, err
	}
	if err = s.insertSaleReturnLines(ctx, s.queries.WithTx(tx), input.DocumentID, source.lines); err != nil {
		return MutationResult{}, err
	}
	return s.finishReturnSave(ctx, tx, document, input, date, source.total, actor)
}

func (s *Service) saveRefusalReturnHeader(
	ctx context.Context, tx pgx.Tx, document documentRecord, input SaveInput,
	date time.Time, reason string, actor approval.Actor,
) (MutationResult, error) {
	if len(input.Data.ReturnLines) != 0 {
		return MutationResult{}, domainError(ErrorValidation, "workflow refusal lines cannot be changed", nil, nil)
	}
	var savedObjectID, savedEntryID string
	if err := tx.QueryRow(ctx, `SELECT warehouse_object_id,warehouse_approval_entry_id
		FROM vou_sale_return_details WHERE document_id=$1`, input.DocumentID).Scan(&savedObjectID, &savedEntryID); err != nil {
		return MutationResult{}, err
	}
	selected, err := s.resolveSelectedReference(ctx, tx, bobdomain.EntityWarehouse, input.Data.Warehouse,
		&bobdomain.EffectiveReference{ObjectID: savedObjectID, ApprovalEntryID: savedEntryID}, false)
	if err != nil {
		return MutationResult{}, err
	}
	warehouse := *selected
	var earliest time.Time
	if err = tx.QueryRow(ctx, `SELECT min(s.business_date)
		FROM vou_sale_return_lines l JOIN vou_documents s ON s.id=l.source_signoff_id
		WHERE l.document_id=$1`, input.DocumentID).Scan(&earliest); err != nil {
		return MutationResult{}, err
	}
	if date.Before(earliest) {
		return MutationResult{}, domainError(ErrorValidation, "return date precedes signoff", nil, nil)
	}
	if _, err = tx.Exec(ctx, `UPDATE vou_sale_return_details SET return_reason=$1,
		warehouse_object_id=$2,warehouse_approval_entry_id=$3,warehouse_code=$4,warehouse_name=$5
		WHERE document_id=$6`, reason, warehouse.ObjectID, warehouse.ApprovalEntryID,
		warehouse.Code, warehouse.Data.Name, input.DocumentID); err != nil {
		return MutationResult{}, err
	}
	return s.finishReturnSave(ctx, tx, document, input, date, document.TotalAmountCents, actor)
}

func (s *Service) finishReturnSave(
	ctx context.Context, tx pgx.Tx, document documentRecord, input SaveInput,
	date time.Time, total int64, actor approval.Actor,
) (MutationResult, error) {
	coordinator, prepared, err := s.prepareDraftSave(ctx, tx, document, input.Revision, actor)
	if err != nil {
		return MutationResult{}, err
	}
	_, err = tx.Exec(ctx, `UPDATE vou_documents SET business_date=$1,total_amount_cents=$2,
		remark=$3 WHERE id=$4`, date, total, optionalText(input.Data.Remark), input.DocumentID)
	if err != nil {
		return MutationResult{}, s.writeError("save sale return", err)
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

func (s *Service) insertSaleReturnDetail(
	ctx context.Context, q *dbsqlc.Queries, id, kind, signoffID, reason string,
	source returnSource, warehouse bobdomain.EffectiveReference,
) error {
	return q.InsertVouSaleReturnDetail(ctx, dbsqlc.InsertVouSaleReturnDetailParams{
		DocumentID: id, SourceOrderID: source.orderID, SourceSignoffID: optionalText(signoffID),
		ReturnKind: kind, ReturnReason: reason, CustomerObjectID: source.customerID,
		CustomerID:              source.rootCustomerID,
		CustomerApprovalEntryID: source.customerVersion, CustomerCode: source.customerCode,
		CustomerName: source.customerName, WarehouseObjectID: warehouse.ObjectID,
		WarehouseApprovalEntryID: warehouse.ApprovalEntryID, WarehouseCode: warehouse.Code,
		WarehouseName: warehouse.Data.Name,
	})
}

func (s *Service) insertSaleReturnLines(
	ctx context.Context, q *dbsqlc.Queries, id string, lines []fixedReturnLine,
) error {
	for index, line := range lines {
		if err := q.InsertVouSaleReturnLine(ctx, dbsqlc.InsertVouSaleReturnLineParams{
			ID: newID(), DocumentID: id, SourceSignoffLineID: line.sourceLineID,
			SourceSignoffID: line.signoffID, LineNo: int32(index + 1),
			ProductObjectID: line.productID, ProductApprovalEntryID: line.productVersion,
			ProductCode: line.productCode, ProductName: line.productName, EnteredUnitSymbol: line.productUnit,
			BaseQuantityMicros: line.quantity, UnitPriceCents: line.price, LineAmountCents: line.amount,
			Remark: line.remark,
		}); err != nil {
			return err
		}
	}
	return nil
}

func (s *Service) loadSaleReturnData(
	ctx context.Context, q *dbsqlc.Queries, document documentRecord, data DocumentDataView,
) (DocumentDataView, error) {
	var customerID, rootCustomerID, customerVersion, customerCode, customerName string
	var warehouseID, warehouseVersion, warehouseCode, warehouseName string
	if err := s.pool.QueryRow(ctx, `SELECT return_kind,return_reason,
		customer_object_id,customer_id,customer_approval_entry_id,customer_code,customer_name,
		warehouse_object_id,warehouse_approval_entry_id,warehouse_code,warehouse_name
		FROM vou_sale_return_details WHERE document_id=$1`, document.ID).Scan(
		&data.ReturnKind, &data.ReturnReason, &customerID, &rootCustomerID, &customerVersion, &customerCode, &customerName,
		&warehouseID, &warehouseVersion, &warehouseCode, &warehouseName); err != nil {
		return data, err
	}
	data.Customer = reference(customerID, customerVersion, bobdomain.EntityCustomerSubunit, customerCode, customerName, "", "", "")
	data.Customer.CustomerID = rootCustomerID
	data.Warehouse = reference(warehouseID, warehouseVersion, "warehouse", warehouseCode, warehouseName, "", "", "")
	rows, err := s.pool.Query(ctx, `SELECT l.id,l.source_signoff_line_id,l.source_signoff_id,
		s.document_no,l.line_no,l.product_object_id,l.product_approval_entry_id,l.product_code,
		l.product_name,l.entered_unit_symbol,l.base_quantity_micros,l.unit_price_cents,l.line_amount_cents,
		COALESCE(l.remark,'') FROM vou_sale_return_lines l
		JOIN vou_documents s ON s.id=l.source_signoff_id
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
		line.BaseQuantity, line.UnitPrice, line.LineAmount, line.ReturnKind =
			formatQuantity(quantity), formatMoney(price), formatMoney(amount), data.ReturnKind
		data.Lines = append(data.Lines, line)
	}
	return data, rows.Err()
}

func (s *Service) ensureRefusalReturnDraft(
	ctx context.Context, tx pgx.Tx, signoffID string, initial WorkflowSaleReturnInitial, requestID string,
) error {
	actorID := systemidentity.UserID
	actor, err := approval.TrustedSystemActor(requestID)
	if err != nil {
		return mapApprovalError(err)
	}
	date, err := parseBusinessDate(initial.BusinessDate)
	if err != nil {
		return err
	}
	reason := strings.TrimSpace(initial.Reason)
	if reason == "" || utf8.RuneCountInString(reason) > 1000 {
		return domainError(ErrorValidation, "invalid returnReason", nil, nil)
	}
	requested := make(map[string]int64, len(initial.Lines))
	for _, input := range initial.Lines {
		if !validID(input.SourceLineID) || requested[input.SourceLineID] != 0 {
			return domainError(ErrorValidation, "invalid sourceLineId", nil, nil)
		}
		quantity, parseErr := quantityMicros(input.BaseQuantity, false)
		if parseErr != nil {
			return domainError(ErrorValidation, "invalid return quantity", nil, parseErr)
		}
		requested[input.SourceLineID] = quantity
	}
	if len(requested) == 0 {
		return domainError(ErrorValidation, "returnLines must contain 1 to 200 items", nil, nil)
	}
	q := s.queries.WithTx(tx)
	_, err = q.FindVouRefusalReturnDocument(ctx, stringPtr(signoffID))
	if err == nil {
		return nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return err
	}
	var source returnSource
	var warehouse bobdomain.EffectiveReference
	sourceRow, err := q.LockVouRefusalReturnSource(ctx, signoffID)
	if err != nil {
		return err
	}
	source.orderID, source.currency = sourceRow.SourceOrderID, deref(sourceRow.Currency)
	source.customerID, source.rootCustomerID, source.customerVersion = sourceRow.CustomerObjectID, sourceRow.CustomerID, sourceRow.CustomerApprovalEntryID
	source.customerCode, source.customerName = sourceRow.CustomerCode, sourceRow.CustomerName
	warehouse.ObjectID, warehouse.ApprovalEntryID = sourceRow.WarehouseObjectID, sourceRow.WarehouseApprovalEntryID
	warehouse.Code, warehouse.Data.Name = sourceRow.WarehouseCode, sourceRow.WarehouseName
	if sourceRow.Status != StatusApproved || date.Before(sourceRow.BusinessDate.Time) {
		return domainError(ErrorConflict, "source signoff is not returnable", nil, nil)
	}
	rows, err := q.ListVouRefusalReturnSourceLines(ctx, signoffID)
	if err != nil {
		return err
	}
	for _, row := range rows {
		var line fixedReturnLine
		line.sourceLineID, line.productID, line.productVersion = row.ID, row.ProductObjectID, row.ProductApprovalEntryID
		line.productCode, line.productName, line.productUnit = row.ProductCode, row.ProductName, row.EnteredUnitSymbol
		line.quantity, line.price = row.RejectedBaseQuantityMicros, row.UnitPriceCents
		quantity, ok := requested[line.sourceLineID]
		if !ok || quantity != line.quantity {
			return domainError(ErrorValidation, "refusal return quantity must equal rejected quantity", nil, nil)
		}
		delete(requested, line.sourceLineID)
		line.signoffID, line.signoffDate, line.remark = signoffID, sourceRow.BusinessDate.Time, optionalText(row.Remark)
		line.amount, err = lineAmountCents(line.quantity, line.price)
		if err != nil || source.total > math.MaxInt64-line.amount {
			return domainError(ErrorValidation, "refusal return amount is out of range", nil, err)
		}
		source.total += line.amount
		source.lines = append(source.lines, line)
	}
	if len(source.lines) == 0 || len(requested) != 0 {
		return domainError(ErrorValidation, "refusal return lines must match rejected signoff lines", nil, nil)
	}
	counter, err := q.NextVouNumberCounter(ctx, dbsqlc.NextVouNumberCounterParams{
		Entity: EntitySaleReturn, BusinessDate: dateValue(date),
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domainError(ErrorConflict, "document number exhausted", nil, nil)
		}
		return err
	}
	id, number := newID(), fmt.Sprintf("%s-%s-%04d", entityPrefix(EntitySaleReturn), date.Format("20060102"), counter)
	entry, err := s.createDocumentApproval(ctx, tx, EntitySaleReturn, id, actor)
	if err != nil {
		return err
	}
	if err = q.InsertVouDocument(ctx, dbsqlc.InsertVouDocumentParams{
		ID: id, Entity: EntitySaleReturn, DocumentNo: number, ApprovalEntryID: entry.ID, BusinessDate: dateValue(date),
		Currency: stringPtr(source.currency), TotalAmountCents: source.total, Remark: stringPtr(reason),
		ParentEntity: stringPtr(EntitySaleOrder), ParentDocumentID: stringPtr(source.orderID),
	}); err != nil {
		return err
	}
	if err = s.insertSaleReturnDetail(ctx, q, id, returnKindRefusal, signoffID,
		reason, source, warehouse); err != nil {
		return err
	}
	if err = s.insertSaleReturnLines(ctx, q, id, source.lines); err != nil {
		return err
	}
	return s.events.Publish(ctx, tx, DocumentCreatedEvent{Entity: EntitySaleReturn,
		DocumentID: id, DocumentNo: number, Revision: 1, ParentEntity: EntitySaleOrder,
		ParentDocumentID: source.orderID, ActorID: actorID, RequestID: requestID})
}

func (s *Service) removeSignoffReturnDrafts(
	ctx context.Context, tx pgx.Tx, signoff documentRecord, _ string, requestID string,
) error {
	actorID := systemidentity.UserID
	rows, err := tx.Query(ctx, `SELECT d.id,d.document_no,a.status,a.revision,d.approval_entry_id,rd.return_kind,rd.source_order_id
		FROM vou_sale_return_details rd
		JOIN vou_documents d ON d.id=rd.document_id
		JOIN approval_entries a ON a.id=d.approval_entry_id AND a.domain='vou'
			AND a.entity=d.entity AND a.subject_id=d.id
		WHERE EXISTS (SELECT 1 FROM vou_sale_return_lines l
			WHERE l.document_id=rd.document_id AND l.source_signoff_id=$1)
		FOR UPDATE OF d`, signoff.ID)
	if err != nil {
		return err
	}
	type linked struct {
		id, number, status, approvalEntryID, kind, orderID string
		revision                                           int64
	}
	var items []linked
	for rows.Next() {
		var item linked
		if err = rows.Scan(&item.id, &item.number, &item.status, &item.revision, &item.approvalEntryID, &item.kind, &item.orderID); err != nil {
			rows.Close()
			return err
		}
		items = append(items, item)
	}
	if err = rows.Err(); err != nil {
		rows.Close()
		return err
	}
	rows.Close()
	for _, item := range items {
		if item.kind != returnKindRefusal || item.status != StatusDraft {
			return domainError(ErrorConflict, "signoff has return documents", nil, nil)
		}
		for _, statement := range []string{
			`DELETE FROM vou_sale_return_lines WHERE document_id=$1`,
			`DELETE FROM vou_sale_return_details WHERE document_id=$1`,
			`DELETE FROM vou_documents WHERE id=$1`,
		} {
			if _, err = tx.Exec(ctx, statement, item.id); err != nil {
				return err
			}
		}
		actor, actorErr := approval.TrustedSystemActor(requestID)
		if actorErr != nil {
			return mapApprovalError(actorErr)
		}
		coordinator, coordinatorErr := s.coordinator(EntitySaleReturn)
		if coordinatorErr != nil {
			return coordinatorErr
		}
		if err = coordinator.DeleteSubject(ctx, tx, item.approvalEntryID, item.revision, actor, ApprovalPayload{}); err != nil {
			return mapApprovalError(err)
		}
		if err = s.events.Publish(ctx, tx, DocumentDeletedEvent{Entity: EntitySaleReturn,
			DocumentID: item.id, DocumentNo: item.number, ParentDocumentID: item.orderID,
			ActorID: actorID, RequestID: requestID, Reason: "source signoff unapproved"}); err != nil {
			return err
		}
	}
	return nil
}

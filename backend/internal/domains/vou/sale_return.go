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
	orderID, currency, customerID, customerVersion, customerCode, customerName string
	lines                                                                      []fixedReturnLine
	total                                                                      int64
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
		quantity, err := quantityMicros(input.Quantity, false)
		if err != nil {
			return result, domainError(ErrorValidation, "invalid return quantity", nil, err)
		}
		remark, err := lineRemark(input.Remark)
		if err != nil {
			return result, err
		}
		var line fixedReturnLine
		var signed int64
		var orderID, currency, customerID, customerVersion, customerCode, customerName, status string
		err = tx.QueryRow(ctx, `SELECT sl.document_id,sd.source_order_id,d.status,d.business_date,
			od.currency,sd.customer_object_id,sd.customer_version_id,sd.customer_code,sd.customer_name,
			sl.product_object_id,sl.product_version_id,sl.product_code,sl.product_name,sl.product_unit,
			sl.signed_qty_micros,sl.unit_price_cents
			FROM vou_sale_signoff_lines sl
			JOIN vou_sale_signoff_details sd ON sd.document_id=sl.document_id
			JOIN vou_documents d ON d.id=sl.document_id
			JOIN vou_documents od ON od.id=sd.source_order_id
			WHERE sl.id=$1 FOR UPDATE OF sl`, input.SourceLineID).Scan(
			&line.signoffID, &orderID, &status, &line.signoffDate,
			&currency, &customerID, &customerVersion, &customerCode, &customerName,
			&line.productID, &line.productVersion, &line.productCode, &line.productName, &line.productUnit,
			&signed, &line.price,
		)
		if errors.Is(err, pgx.ErrNoRows) {
			return result, domainError(ErrorValidation, "source signoff line not found", nil, nil)
		}
		if err != nil {
			return result, s.internal("lock return source", err)
		}
		if status != StatusFinalized || date.Before(line.signoffDate) {
			return result, domainError(ErrorConflict, "source signoff is not returnable", nil, nil)
		}
		if result.orderID == "" {
			result.orderID, result.currency = orderID, currency
			result.customerID, result.customerVersion = customerID, customerVersion
			result.customerCode, result.customerName = customerCode, customerName
		} else if result.orderID != orderID {
			return result, domainError(ErrorValidation, "return lines must belong to one sales fulfillment", nil, nil)
		}
		var occupied int64
		if err = tx.QueryRow(ctx, `SELECT COALESCE(sum(rl.quantity_micros),0)
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
	ctx context.Context, input CreateInput, actorID, requestID string,
) (MutationResult, error) {
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
	warehouse, err := s.resolver.ResolveEffectiveReference(
		ctx, tx, bobdomain.EntityWarehouse, input.Data.Warehouse.ObjectID, input.Data.Warehouse.VersionID,
	)
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
	if _, err = tx.Exec(ctx, `INSERT INTO vou_documents(
		id,entity,document_no,business_date,currency,total_amount_cents,remark,
		parent_entity,parent_document_id,created_by,updated_by
	) VALUES($1,'sale-return',$2,$3,$4,$5,$6,'sale-order',$7,$8,$8)`,
		id, number, date, source.currency, source.total, optionalText(input.Data.Remark),
		source.orderID, actorID); err != nil {
		return MutationResult{}, s.writeError("insert sale return", err)
	}
	if err = s.insertSaleReturnDetail(ctx, tx, id, returnKindAfterSale, "", reason, source, warehouse); err != nil {
		return MutationResult{}, err
	}
	if err = s.insertSaleReturnLines(ctx, tx, id, source.lines); err != nil {
		return MutationResult{}, err
	}
	if err = s.linkSalesWorkflowDocument(ctx, tx, source.orderID, id, salesStageReturn); err != nil {
		return MutationResult{}, err
	}
	q := s.queries.WithTx(tx)
	if err = insertAudit(ctx, q, auditInput{DocumentID: id, Entity: EntitySaleReturn,
		Event: "CREATED", To: StatusDraft, ActorID: actorID, RequestID: requestID,
		Summary: map[string]any{"returnKind": returnKindAfterSale, "lineCount": len(source.lines)}}); err != nil {
		return MutationResult{}, err
	}
	document := dbsqlc.VouDocument{ID: id, Entity: EntitySaleReturn, DocumentNo: number}
	if err = s.touchWorkflow(ctx, tx, document, "RETURN_CREATED", StatusDraft, actorID, requestID, nil); err != nil {
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
	return MutationResult{DocumentID: id, DocumentNo: number, Status: StatusDraft, Revision: 1}, nil
}

func (s *Service) SaveSaleReturn(
	ctx context.Context, input SaveInput, actorID, requestID string,
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
	var document dbsqlc.VouDocument
	document, err = s.queries.WithTx(tx).LockVouDocument(ctx, dbsqlc.LockVouDocumentParams{
		ID: input.DocumentID, Entity: EntitySaleReturn,
	})
	if err = documentWriteConflict(err, document.Revision, input.Revision, document.Status, StatusDraft); err != nil {
		return MutationResult{}, err
	}
	var kind string
	if err = tx.QueryRow(ctx, `SELECT return_kind FROM vou_sale_return_details WHERE document_id=$1`,
		input.DocumentID).Scan(&kind); err != nil {
		return MutationResult{}, err
	}
	if kind == returnKindRefusal {
		return s.saveRefusalReturnHeader(ctx, tx, document, input, date, reason, actorID, requestID)
	}
	source, err := s.resolveReturnSource(ctx, tx, input.DocumentID, date, input.Data.ReturnLines)
	if err != nil {
		return MutationResult{}, err
	}
	warehouse, err := s.resolver.ResolveEffectiveReference(
		ctx, tx, bobdomain.EntityWarehouse, input.Data.Warehouse.ObjectID, input.Data.Warehouse.VersionID,
	)
	if err != nil {
		return MutationResult{}, err
	}
	if source.orderID != *document.ParentDocumentID {
		return MutationResult{}, domainError(ErrorConflict, "sales fulfillment cannot be changed", nil, nil)
	}
	if _, err = tx.Exec(ctx, `DELETE FROM vou_sale_return_lines WHERE document_id=$1`, input.DocumentID); err != nil {
		return MutationResult{}, err
	}
	if _, err = tx.Exec(ctx, `UPDATE vou_sale_return_details SET return_reason=$1,
		warehouse_object_id=$2,warehouse_version_id=$3,warehouse_code=$4,warehouse_name=$5
		WHERE document_id=$6`, reason, warehouse.ObjectID, warehouse.VersionID,
		warehouse.Code, warehouse.Data.Name, input.DocumentID); err != nil {
		return MutationResult{}, err
	}
	if err = s.insertSaleReturnLines(ctx, tx, input.DocumentID, source.lines); err != nil {
		return MutationResult{}, err
	}
	return s.finishReturnSave(ctx, tx, document, input, date, source.total, actorID, requestID)
}

func (s *Service) saveRefusalReturnHeader(
	ctx context.Context, tx pgx.Tx, document dbsqlc.VouDocument, input SaveInput,
	date time.Time, reason, actorID, requestID string,
) (MutationResult, error) {
	if len(input.Data.ReturnLines) != 0 {
		return MutationResult{}, domainError(ErrorValidation, "automatic refusal lines cannot be changed", nil, nil)
	}
	warehouse, err := s.resolver.ResolveEffectiveReference(
		ctx, tx, bobdomain.EntityWarehouse, input.Data.Warehouse.ObjectID, input.Data.Warehouse.VersionID,
	)
	if err != nil {
		return MutationResult{}, err
	}
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
		warehouse_object_id=$2,warehouse_version_id=$3,warehouse_code=$4,warehouse_name=$5
		WHERE document_id=$6`, reason, warehouse.ObjectID, warehouse.VersionID,
		warehouse.Code, warehouse.Data.Name, input.DocumentID); err != nil {
		return MutationResult{}, err
	}
	return s.finishReturnSave(ctx, tx, document, input, date, document.TotalAmountCents, actorID, requestID)
}

func (s *Service) finishReturnSave(
	ctx context.Context, tx pgx.Tx, document dbsqlc.VouDocument, input SaveInput,
	date time.Time, total int64, actorID, requestID string,
) (MutationResult, error) {
	var revision int64
	err := tx.QueryRow(ctx, `UPDATE vou_documents SET business_date=$1,total_amount_cents=$2,
		remark=$3,revision=revision+1,updated_at=now(),updated_by=$4
		WHERE id=$5 AND revision=$6 RETURNING revision`, date, total, optionalText(input.Data.Remark),
		actorID, input.DocumentID, input.Revision).Scan(&revision)
	if err != nil {
		return MutationResult{}, s.writeError("save sale return", err)
	}
	if err = insertAudit(ctx, s.queries.WithTx(tx), auditInput{DocumentID: document.ID,
		Entity: EntitySaleReturn, Event: "SAVED", From: stringPtr(StatusDraft), To: StatusDraft,
		ActorID: actorID, RequestID: requestID}); err != nil {
		return MutationResult{}, err
	}
	if err = s.touchWorkflow(ctx, tx, document, "SAVED", StatusDraft, actorID, requestID, nil); err != nil {
		return MutationResult{}, err
	}
	if err = tx.Commit(ctx); err != nil {
		return MutationResult{}, err
	}
	return MutationResult{DocumentID: document.ID, DocumentNo: document.DocumentNo,
		Status: StatusDraft, Revision: revision}, nil
}

func (s *Service) insertSaleReturnDetail(
	ctx context.Context, tx pgx.Tx, id, kind, signoffID, reason string,
	source returnSource, warehouse bobdomain.EffectiveReference,
) error {
	_, err := tx.Exec(ctx, `INSERT INTO vou_sale_return_details(
		document_id,source_order_id,source_signoff_id,return_kind,return_reason,
		customer_object_id,customer_version_id,customer_code,customer_name,
		warehouse_object_id,warehouse_version_id,warehouse_code,warehouse_name
	) VALUES($1,$2,NULLIF($3,''),$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
		id, source.orderID, signoffID, kind, reason, source.customerID, source.customerVersion,
		source.customerCode, source.customerName, warehouse.ObjectID, warehouse.VersionID,
		warehouse.Code, warehouse.Data.Name)
	return err
}

func (s *Service) insertSaleReturnLines(
	ctx context.Context, tx pgx.Tx, id string, lines []fixedReturnLine,
) error {
	for index, line := range lines {
		if _, err := tx.Exec(ctx, `INSERT INTO vou_sale_return_lines(
			id,document_id,source_signoff_line_id,source_signoff_id,line_no,
			product_object_id,product_version_id,product_code,product_name,product_unit,
			quantity_micros,unit_price_cents,line_amount_cents,remark
		) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
			newID(), id, line.sourceLineID, line.signoffID, index+1,
			line.productID, line.productVersion, line.productCode, line.productName, line.productUnit,
			line.quantity, line.price, line.amount, line.remark); err != nil {
			return err
		}
	}
	return nil
}

func (s *Service) loadSaleReturnData(
	ctx context.Context, q *dbsqlc.Queries, document dbsqlc.VouDocument, data DocumentDataView,
) (DocumentDataView, error) {
	var customerID, customerVersion, customerCode, customerName string
	var warehouseID, warehouseVersion, warehouseCode, warehouseName string
	if err := s.pool.QueryRow(ctx, `SELECT return_kind,return_reason,
		customer_object_id,customer_version_id,customer_code,customer_name,
		warehouse_object_id,warehouse_version_id,warehouse_code,warehouse_name
		FROM vou_sale_return_details WHERE document_id=$1`, document.ID).Scan(
		&data.ReturnKind, &data.ReturnReason, &customerID, &customerVersion, &customerCode, &customerName,
		&warehouseID, &warehouseVersion, &warehouseCode, &warehouseName); err != nil {
		return data, err
	}
	data.Customer = reference(customerID, customerVersion, "customer", customerCode, customerName, "", "", "")
	data.Warehouse = reference(warehouseID, warehouseVersion, "warehouse", warehouseCode, warehouseName, "", "", "")
	rows, err := s.pool.Query(ctx, `SELECT l.id,l.source_signoff_line_id,l.source_signoff_id,
		s.document_no,l.line_no,l.product_object_id,l.product_version_id,l.product_code,
		l.product_name,l.product_unit,l.quantity_micros,l.unit_price_cents,l.line_amount_cents,
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
		line.Quantity, line.UnitPrice, line.LineAmount, line.ReturnKind =
			formatQuantity(quantity), formatMoney(price), formatMoney(amount), data.ReturnKind
		data.Lines = append(data.Lines, line)
	}
	return data, rows.Err()
}

func (s *Service) ensureRefusalReturnDraft(
	ctx context.Context, tx pgx.Tx, signoffID, _ string, requestID string,
) error {
	actorID := systemidentity.UserID
	var existing string
	err := tx.QueryRow(ctx, `SELECT document_id FROM vou_sale_return_details
		WHERE source_signoff_id=$1 AND return_kind='REFUSAL'`, signoffID).Scan(&existing)
	if err == nil {
		return nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return err
	}
	var source returnSource
	var date time.Time
	var warehouse bobdomain.EffectiveReference
	err = tx.QueryRow(ctx, `SELECT sd.source_order_id,d.business_date,d.currency,
		sd.customer_object_id,sd.customer_version_id,sd.customer_code,sd.customer_name,
		sd.warehouse_object_id,sd.warehouse_version_id,sd.warehouse_code,sd.warehouse_name
		FROM vou_sale_signoff_details sd JOIN vou_documents d ON d.id=sd.document_id
		WHERE sd.document_id=$1`, signoffID).Scan(
		&source.orderID, &date, &source.currency, &source.customerID, &source.customerVersion,
		&source.customerCode, &source.customerName, &warehouse.ObjectID, &warehouse.VersionID,
		&warehouse.Code, &warehouse.Data.Name)
	if err != nil {
		return err
	}
	rows, err := tx.Query(ctx, `SELECT id,product_object_id,product_version_id,product_code,
		product_name,product_unit,rejected_qty_micros,unit_price_cents,COALESCE(remark,'')
		FROM vou_sale_signoff_lines WHERE document_id=$1 AND rejected_qty_micros>0 ORDER BY line_no`, signoffID)
	if err != nil {
		return err
	}
	for rows.Next() {
		var line fixedReturnLine
		var remark string
		if err = rows.Scan(&line.sourceLineID, &line.productID, &line.productVersion,
			&line.productCode, &line.productName, &line.productUnit, &line.quantity,
			&line.price, &remark); err != nil {
			rows.Close()
			return err
		}
		line.signoffID, line.signoffDate, line.remark = signoffID, date, optionalText(remark)
		line.amount, err = lineAmountCents(line.quantity, line.price)
		if err != nil || source.total > math.MaxInt64-line.amount {
			rows.Close()
			return domainError(ErrorValidation, "refusal return amount is out of range", nil, err)
		}
		source.total += line.amount
		source.lines = append(source.lines, line)
	}
	if err = rows.Err(); err != nil {
		rows.Close()
		return err
	}
	rows.Close()
	if len(source.lines) == 0 {
		return nil
	}
	counter, err := s.queries.WithTx(tx).NextVouNumberCounter(ctx, dbsqlc.NextVouNumberCounterParams{
		Entity: EntitySaleReturn, BusinessDate: dateValue(date),
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domainError(ErrorConflict, "document number exhausted", nil, nil)
		}
		return err
	}
	id, number := newID(), fmt.Sprintf("%s-%s-%04d", entityPrefix(EntitySaleReturn), date.Format("20060102"), counter)
	if _, err = tx.Exec(ctx, `INSERT INTO vou_documents(
		id,entity,document_no,business_date,currency,total_amount_cents,remark,
		parent_entity,parent_document_id,created_by,updated_by
	) VALUES($1,'sale-return',$2,$3,$4,$5,'客户拒收','sale-order',$6,$7,$7)`,
		id, number, date, source.currency, source.total, source.orderID, actorID); err != nil {
		return err
	}
	if err = s.insertSaleReturnDetail(ctx, tx, id, returnKindRefusal, signoffID,
		"客户拒收", source, warehouse); err != nil {
		return err
	}
	if err = s.insertSaleReturnLines(ctx, tx, id, source.lines); err != nil {
		return err
	}
	if err = s.linkSalesWorkflowDocument(ctx, tx, source.orderID, id, salesStageReturn); err != nil {
		return err
	}
	if err = insertAudit(ctx, s.queries.WithTx(tx), auditInput{DocumentID: id,
		Entity: EntitySaleReturn, Event: "CREATED", To: StatusDraft, ActorID: actorID,
		RequestID: requestID, Summary: map[string]any{"returnKind": returnKindRefusal,
			"sourceSignoffId": signoffID}}); err != nil {
		return err
	}
	return s.events.Publish(ctx, tx, DocumentCreatedEvent{Entity: EntitySaleReturn,
		DocumentID: id, DocumentNo: number, Revision: 1, ParentEntity: EntitySaleOrder,
		ParentDocumentID: source.orderID, ActorID: actorID, RequestID: requestID})
}

func (s *Service) removeSignoffReturnDrafts(
	ctx context.Context, tx pgx.Tx, signoff dbsqlc.VouDocument, _ string, requestID string,
) error {
	actorID := systemidentity.UserID
	rows, err := tx.Query(ctx, `SELECT d.id,d.document_no,d.status,rd.return_kind,rd.source_order_id
		FROM vou_sale_return_details rd
		JOIN vou_documents d ON d.id=rd.document_id
		WHERE EXISTS (SELECT 1 FROM vou_sale_return_lines l
			WHERE l.document_id=rd.document_id AND l.source_signoff_id=$1)
		FOR UPDATE OF d`, signoff.ID)
	if err != nil {
		return err
	}
	type linked struct{ id, number, status, kind, orderID string }
	var items []linked
	for rows.Next() {
		var item linked
		if err = rows.Scan(&item.id, &item.number, &item.status, &item.kind, &item.orderID); err != nil {
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
			`DELETE FROM wfl_process_documents WHERE document_id=$1`,
			`DELETE FROM vou_audit_events WHERE document_id=$1`,
			`DELETE FROM vou_sale_return_lines WHERE document_id=$1`,
			`DELETE FROM vou_sale_return_details WHERE document_id=$1`,
			`DELETE FROM vou_documents WHERE id=$1`,
		} {
			if _, err = tx.Exec(ctx, statement, item.id); err != nil {
				return err
			}
		}
		if err = s.events.Publish(ctx, tx, DocumentDeletedEvent{Entity: EntitySaleReturn,
			DocumentID: item.id, DocumentNo: item.number, ParentDocumentID: item.orderID,
			ActorID: actorID, RequestID: requestID, Reason: "source signoff unfinalized"}); err != nil {
			return err
		}
	}
	return nil
}

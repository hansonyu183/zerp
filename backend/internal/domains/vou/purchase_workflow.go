package vou

import (
	"context"
	"errors"
	"fmt"
	"math"
	"strings"
	"time"

	dbsqlc "github.com/hansonyu183/zerp/backend/internal/database/sqlc"
	bobdomain "github.com/hansonyu183/zerp/backend/internal/domains/bob"
	"github.com/hansonyu183/zerp/backend/internal/platform/approval"
	"github.com/jackc/pgx/v5"
)

func managedPurchaseDocument(document documentRecord) bool {
	return document.Entity == EntityPurchaseOrder || document.Entity == EntityPurchaseInbound ||
		document.Entity == EntityPurchaseReturn
}

func (s *Service) validateManagedPurchaseParentStatus(
	ctx context.Context,
	tx pgx.Tx,
	document documentRecord,
	targetStatus string,
) error {
	if document.Entity == EntityPurchaseOrder {
		return nil
	}
	if document.ParentDocumentID == nil {
		return domainError(ErrorConflict, "purchase document has no source order", nil, nil)
	}
	var status, fulfillment string
	err := tx.QueryRow(ctx, `SELECT approval.status,o.fulfillment_status
		FROM vou_documents d
		JOIN approval_entries approval ON approval.id=d.approval_entry_id
		JOIN vou_purchase_order_details o ON o.document_id=d.id
		WHERE d.id=$1 FOR SHARE OF d,approval,o`, *document.ParentDocumentID).
		Scan(&status, &fulfillment)
	if err != nil {
		return s.internal("read purchase order status", err)
	}
	parentReady := status == StatusApproved
	if document.Entity == EntityPurchaseReturn {
		if !parentReady {
			return domainError(ErrorConflict, "purchase order is not returnable", map[string]any{
				"status": status, "fulfillmentStatus": fulfillment, "targetStatus": targetStatus,
			}, nil)
		}
		return nil
	}
	if !parentReady || fulfillment != "OPEN" {
		return domainError(ErrorConflict, "purchase order is not open", map[string]any{
			"status": status, "fulfillmentStatus": fulfillment, "targetStatus": targetStatus,
		}, nil)
	}
	return nil
}

// CreatePurchaseInbound reserves quantities immediately, including while the
// inbound is still a draft. The root row lock serializes competing creations.
func (s *Service) CreatePurchaseInbound(
	ctx context.Context,
	input CreateInput,
	actor approval.Actor,
) (MutationResult, error) {
	actorID, requestID := actor.ID(), actor.RequestID()
	if !validID(actorID) || !validID(input.Data.SourceDocumentID) {
		return MutationResult{}, domainError(ErrorValidation, "invalid purchase inbound", nil, nil)
	}
	businessDate, err := parseBusinessDate(input.Data.BusinessDate)
	if err != nil {
		return MutationResult{}, err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return MutationResult{}, s.internal("begin purchase inbound", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	if err = s.guardVOUWrite(ctx, tx, businessDate); err != nil {
		return MutationResult{}, err
	}

	order, detail, err := s.lockPurchaseOrderForInbound(ctx, tx, input.Data.SourceDocumentID)
	if err != nil {
		return MutationResult{}, err
	}
	warehouse, err := s.resolveInboundWarehouse(ctx, tx, input.Data.Warehouse, detail, nil, true)
	if err != nil {
		return MutationResult{}, err
	}
	dueDate, err := s.orderSettlementDueDate(ctx, tx, EntityPurchaseOrder, order.ID, businessDate)
	if err != nil {
		return MutationResult{}, err
	}
	lines, total, err := s.validateAndReserveInboundLines(ctx, tx, order.ID, "", input.Data.SourceLines)
	if err != nil {
		return MutationResult{}, err
	}
	counter, err := s.queries.WithTx(tx).NextVouNumberCounter(ctx, dbsqlc.NextVouNumberCounterParams{
		Entity: EntityPurchaseInbound, BusinessDate: dateValue(businessDate),
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return MutationResult{}, domainError(ErrorConflict, "document number exhausted", nil, nil)
		}
		return MutationResult{}, s.writeError("allocate purchase inbound number", err)
	}
	id := newID()
	number := fmt.Sprintf("%s-%s-%04d", entityPrefix(EntityPurchaseInbound), businessDate.Format("20060102"), counter)
	entry, err := s.createDocumentApproval(ctx, tx, EntityPurchaseInbound, id, actor)
	if err != nil {
		return MutationResult{}, err
	}
	if _, err = tx.Exec(ctx, `INSERT INTO vou_documents(
		id,entity,document_no,approval_entry_id,business_date,currency,due_date,total_amount_cents,remark,
		parent_entity,parent_document_id
	) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
		id, EntityPurchaseInbound, number, entry.ID, businessDate, order.Currency, dueDate, total,
		optionalText(input.Data.Remark), EntityPurchaseOrder, order.ID); err != nil {
		return MutationResult{}, s.writeError("insert purchase inbound", err)
	}
	q := s.queries.WithTx(tx)
	if err = q.InsertVouPurchaseInboundDetail(ctx, dbsqlc.InsertVouPurchaseInboundDetailParams{
		DocumentID: id, SourceOrderID: order.ID,
		SupplierObjectID: detail.SupplierObjectID, SupplierApprovalEntryID: detail.SupplierApprovalEntryID,
		SupplierCode: detail.SupplierCode, SupplierName: detail.SupplierName,
		WarehouseObjectID: warehouse.ObjectID, WarehouseApprovalEntryID: warehouse.ApprovalEntryID,
		WarehouseCode: warehouse.Code, WarehouseName: warehouse.Data.Name,
	}); err != nil {
		return MutationResult{}, s.writeError("insert purchase inbound detail", err)
	}
	if err = s.insertPurchaseInboundLines(ctx, q, id, lines); err != nil {
		return MutationResult{}, err
	}
	if err = s.events.Publish(ctx, tx, DocumentCreatedEvent{
		Entity: EntityPurchaseInbound, DocumentID: id, DocumentNo: number, Revision: 1,
		ParentEntity: EntityPurchaseOrder, ParentDocumentID: order.ID,
		ActorID: actorID, RequestID: requestID,
	}); err != nil {
		return MutationResult{}, err
	}
	if err = tx.Commit(ctx); err != nil {
		return MutationResult{}, s.writeError("commit purchase inbound", err)
	}
	return MutationResult{DocumentID: id, DocumentNo: number, Approval: approval.MetaFromEntry(entry)}, nil
}

func (s *Service) SavePurchaseInbound(
	ctx context.Context,
	input SaveInput,
	actor approval.Actor,
) (MutationResult, error) {
	if err := validateDocumentRevision(input.DocumentID, input.Revision); err != nil {
		return MutationResult{}, err
	}
	businessDate, err := parseBusinessDate(input.Data.BusinessDate)
	if err != nil {
		return MutationResult{}, err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return MutationResult{}, s.internal("begin save purchase inbound", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	q := s.queries.WithTx(tx)
	document, err := s.lockDocumentForWriteDates(ctx, tx, input.DocumentID, EntityPurchaseInbound, businessDate)
	if err = documentWriteConflict(err, document.Revision, input.Revision, document.Status, StatusDraft); err != nil {
		return MutationResult{}, err
	}
	coordinator, prepared, err := s.prepareDraftSave(ctx, tx, document, input.Revision, actor)
	if err != nil {
		return MutationResult{}, err
	}
	detail, err := q.GetVouPurchaseInboundDetail(ctx, input.DocumentID)
	if err != nil {
		return MutationResult{}, err
	}
	order, orderDetail, err := s.lockPurchaseOrderForInbound(ctx, tx, detail.SourceOrderID)
	if err != nil {
		return MutationResult{}, err
	}
	savedWarehouse := &bobdomain.EffectiveReference{ObjectID: detail.WarehouseObjectID,
		ApprovalEntryID: detail.WarehouseApprovalEntryID, Entity: bobdomain.EntityWarehouse,
		Code: detail.WarehouseCode, Data: bobdomain.DetailView{Name: detail.WarehouseName}}
	warehouse, err := s.resolveInboundWarehouse(ctx, tx, input.Data.Warehouse, orderDetail, savedWarehouse, false)
	if err != nil {
		return MutationResult{}, err
	}
	dueDate, err := s.orderSettlementDueDate(ctx, tx, EntityPurchaseOrder, order.ID, businessDate)
	if err != nil {
		return MutationResult{}, err
	}
	lines, total, err := s.validateAndReserveInboundLines(
		ctx, tx, order.ID, input.DocumentID, input.Data.SourceLines,
	)
	if err != nil {
		return MutationResult{}, err
	}
	_, err = q.UpdateVouDraft(ctx, dbsqlc.UpdateVouDraftParams{
		BusinessDate: dateValue(businessDate), Currency: order.Currency,
		DueDate:          dateValue(dueDate),
		TotalAmountCents: total, Remark: optionalText(input.Data.Remark),
		ID: input.DocumentID, Entity: EntityPurchaseInbound,
	})
	if err != nil {
		return MutationResult{}, s.writeError("update purchase inbound", err)
	}
	rows, err := q.UpdateVouPurchaseInboundWarehouse(ctx, dbsqlc.UpdateVouPurchaseInboundWarehouseParams{
		WarehouseObjectID: warehouse.ObjectID, WarehouseApprovalEntryID: warehouse.ApprovalEntryID,
		WarehouseCode: warehouse.Code, WarehouseName: warehouse.Data.Name,
		DocumentID: input.DocumentID,
	})
	if err != nil || rows != 1 {
		return MutationResult{}, s.writeError("update purchase inbound warehouse", err)
	}
	if err = q.DeleteVouPurchaseInboundLines(ctx, input.DocumentID); err != nil {
		return MutationResult{}, err
	}
	if err = s.insertPurchaseInboundLines(ctx, q, input.DocumentID, lines); err != nil {
		return MutationResult{}, err
	}
	entry, err := s.commitDraftSave(ctx, tx, q, document, coordinator, prepared)
	if err != nil {
		return MutationResult{}, err
	}
	if err = tx.Commit(ctx); err != nil {
		return MutationResult{}, s.writeError("commit save purchase inbound", err)
	}
	return mutation(document, entry), nil
}

func (s *Service) DeletePurchaseInbound(
	ctx context.Context,
	input ReverseInput,
	actor approval.Actor,
) (MutationResult, error) {
	actorID, requestID := actor.ID(), actor.RequestID()
	reason, err := validateReverse(input)
	if err != nil {
		return MutationResult{}, err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return MutationResult{}, s.internal("begin delete purchase inbound", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	document, err := s.lockDocumentForWrite(ctx, tx, input.DocumentID, EntityPurchaseInbound)
	if err = documentWriteConflict(err, document.Revision, input.Revision, document.Status, StatusDraft); err != nil {
		return MutationResult{}, err
	}
	var attachmentCount int64
	if err = tx.QueryRow(ctx, `SELECT count(*) FROM vou_document_attachments WHERE document_id=$1`,
		input.DocumentID).Scan(&attachmentCount); err != nil {
		return MutationResult{}, err
	}
	if attachmentCount != 0 {
		return MutationResult{}, domainError(ErrorConflict,
			"purchase inbound with attachments cannot be deleted", nil, nil)
	}
	var hasReturns bool
	if err = tx.QueryRow(ctx, `SELECT EXISTS(
		SELECT 1 FROM vou_purchase_return_lines WHERE source_inbound_id=$1
	)`, input.DocumentID).Scan(&hasReturns); err != nil {
		return MutationResult{}, err
	}
	if hasReturns {
		return MutationResult{}, domainError(ErrorConflict,
			"purchase inbound has return documents", nil, nil)
	}
	coordinator, err := s.coordinator(EntityPurchaseInbound)
	if err != nil {
		return MutationResult{}, err
	}
	if err = s.events.Publish(ctx, tx, DocumentDeletedEvent{
		Entity: EntityPurchaseInbound, DocumentID: document.ID,
		DocumentNo: document.DocumentNo, ParentDocumentID: deref(document.ParentDocumentID),
		ActorID: actorID, RequestID: requestID, Reason: *reason,
	}); err != nil {
		return MutationResult{}, err
	}
	for _, statement := range []string{
		`DELETE FROM vou_purchase_inbound_lines WHERE document_id=$1`,
		`DELETE FROM vou_purchase_inbound_details WHERE document_id=$1`,
		`DELETE FROM vou_documents WHERE id=$1`,
	} {
		if _, err = tx.Exec(ctx, statement, input.DocumentID); err != nil {
			return MutationResult{}, s.writeError("delete purchase inbound", err)
		}
	}
	if err = coordinator.DeleteSubject(ctx, tx, document.ApprovalEntryID, input.Revision, actor, ApprovalPayload{}); err != nil {
		return MutationResult{}, mapApprovalError(err)
	}
	if err = tx.Commit(ctx); err != nil {
		return MutationResult{}, s.writeError("commit delete purchase inbound", err)
	}
	return MutationResult{
		DocumentID: document.ID, DocumentNo: document.DocumentNo,
		Approval: approval.MetaFromEntry(document.approvalEntry()),
	}, nil
}

type fixedInboundLine struct {
	source dbsqlc.VouProductLine
	qty    int64
	amount int64
	remark *string
}

func parseBusinessDate(value string) (timeValue, error) {
	return parseDateValue(value)
}

// timeValue is an alias kept local so purchase parsing follows the common date
// validation without exposing another API type.
type timeValue = time.Time

func parseDateValue(value string) (time.Time, error) {
	parsed, err := time.Parse(dateLayout, strings.TrimSpace(value))
	if err != nil {
		return time.Time{}, domainError(ErrorValidation, "invalid businessDate", nil, nil)
	}
	return parsed, nil
}

func (s *Service) lockPurchaseOrderForInbound(
	ctx context.Context, tx pgx.Tx, orderID string,
) (documentRecord, dbsqlc.VouPurchaseOrderDetail, error) {
	q := s.queries.WithTx(tx)
	order, err := lockDocument(ctx, tx, orderID, EntityPurchaseOrder)
	if err != nil {
		return order, dbsqlc.VouPurchaseOrderDetail{},
			domainError(ErrorValidation, "purchase order not found", nil, err)
	}
	detail, err := q.GetVouPurchaseOrderDetail(ctx, orderID)
	if err != nil {
		return order, detail, err
	}
	orderReady := order.Status == StatusApproved
	if !orderReady || detail.FulfillmentStatus != "OPEN" {
		return order, detail, domainError(ErrorConflict,
			"purchase order is not open for inbound", nil, nil)
	}
	return order, detail, nil
}

func (s *Service) resolveInboundWarehouse(
	ctx context.Context,
	tx pgx.Tx,
	input *ReferenceInput,
	detail dbsqlc.VouPurchaseOrderDetail,
	preserved *bobdomain.EffectiveReference,
	newDocument bool,
) (bobdomain.EffectiveReference, error) {
	if input == nil {
		if !newDocument && preserved != nil {
			input = &ReferenceInput{ObjectID: preserved.ObjectID, ApprovalEntryID: preserved.ApprovalEntryID}
		} else {
			input = &ReferenceInput{ObjectID: deref(detail.WarehouseObjectID), ApprovalEntryID: deref(detail.WarehouseApprovalEntryID)}
		}
	}
	if err := validateReference(input, "warehouse", true); err != nil {
		return bobdomain.EffectiveReference{}, err
	}
	resolved, err := s.resolveSelectedReference(ctx, tx, bobdomain.EntityWarehouse, input, preserved, newDocument)
	if err != nil {
		return bobdomain.EffectiveReference{}, domainError(ErrorConflict, "warehouse is not effective", nil, err)
	}
	return *resolved, nil
}

func (s *Service) validateAndReserveInboundLines(
	ctx context.Context,
	tx pgx.Tx,
	orderID, excludeInboundID string,
	input []SourceQuantityLineInput,
) ([]fixedInboundLine, int64, error) {
	if len(input) == 0 {
		return nil, 0, domainError(ErrorValidation, "sourceLines are required", nil, nil)
	}
	orderLines, err := s.queries.WithTx(tx).ListVouProductLines(ctx, orderID)
	if err != nil {
		return nil, 0, err
	}
	byID := make(map[string]dbsqlc.VouProductLine, len(orderLines))
	for _, line := range orderLines {
		byID[line.ID] = line
	}
	seen := map[string]bool{}
	result := make([]fixedInboundLine, 0, len(input))
	var total int64
	for _, raw := range input {
		source, ok := byID[raw.SourceLineID]
		if !ok || seen[raw.SourceLineID] {
			return nil, 0, domainError(ErrorValidation, "invalid sourceLineId", nil, nil)
		}
		seen[raw.SourceLineID] = true
		qty, parseErr := quantityMicros(raw.BaseQuantity, false)
		if parseErr != nil {
			return nil, 0, domainError(ErrorValidation, "invalid inbound quantity", nil, parseErr)
		}
		var reserved int64
		err = tx.QueryRow(ctx, `SELECT COALESCE(sum(l.base_quantity_micros),0) - COALESCE((
					SELECT sum(r.base_quantity_micros) FROM vou_purchase_return_lines r
					JOIN vou_documents d ON d.id=r.document_id
					JOIN approval_entries a ON a.id=d.approval_entry_id AND a.domain='vou'
						AND a.entity=d.entity AND a.subject_id=d.id
					WHERE r.source_order_line_id=$2 AND a.status = 'APPROVED'
			),0)
			FROM vou_purchase_inbound_lines l
			JOIN vou_purchase_inbound_details x ON x.document_id=l.document_id
			WHERE x.source_order_id=$1 AND l.source_order_line_id=$2
			  AND ($3='' OR l.document_id<>$3)`,
			orderID, source.ID, excludeInboundID).Scan(&reserved)
		if err != nil {
			return nil, 0, err
		}
		if reserved > source.BaseQuantityMicros-qty {
			return nil, 0, domainError(ErrorConflict,
				"purchase inbound quantity exceeds remaining quantity",
				map[string]any{"sourceLineId": source.ID}, nil)
		}
		amount, amountErr := lineAmountCents(qty, source.UnitPriceCents)
		if amountErr != nil || total > math.MaxInt64-amount {
			return nil, 0, domainError(ErrorValidation, "invalid inbound amount", nil, amountErr)
		}
		total += amount
		result = append(result, fixedInboundLine{
			source: source, qty: qty, amount: amount, remark: optionalText(raw.Remark),
		})
	}
	return result, total, nil
}

func (s *Service) insertPurchaseInboundLines(
	ctx context.Context, q *dbsqlc.Queries, documentID string, lines []fixedInboundLine,
) error {
	for index, line := range lines {
		if err := q.InsertVouPurchaseInboundLine(ctx, dbsqlc.InsertVouPurchaseInboundLineParams{
			ID: newID(), DocumentID: documentID, SourceOrderLineID: line.source.ID,
			LineNo: int32(index + 1), ProductObjectID: line.source.ProductObjectID,
			ProductApprovalEntryID: line.source.ProductApprovalEntryID, ProductCode: line.source.ProductCode,
			ProductName: line.source.ProductName, EnteredUnitSymbol: line.source.EnteredUnitSymbol,
			BaseQuantityMicros: line.qty, UnitPriceCents: line.source.UnitPriceCents,
			LineAmountCents: line.amount, Remark: line.remark,
		}); err != nil {
			return s.writeError("insert purchase inbound line", err)
		}
	}
	return nil
}

func (s *Service) setPurchaseOrderBalances(
	ctx context.Context, orderID string, data *DocumentDataView,
) error {
	rows, err := s.pool.Query(ctx, `SELECT order_line.id, order_line.base_quantity_micros,
		COALESCE(sum(inbound_line.base_quantity_micros), 0)::bigint - COALESCE((
			SELECT sum(return_line.base_quantity_micros)
			FROM vou_purchase_return_lines return_line
			JOIN vou_documents return_doc ON return_doc.id=return_line.document_id
			JOIN approval_entries return_approval ON return_approval.id=return_doc.approval_entry_id
				AND return_approval.domain='vou' AND return_approval.entity=return_doc.entity
				AND return_approval.subject_id=return_doc.id
			WHERE return_line.source_order_line_id=order_line.id
			  AND return_approval.status = 'APPROVED'
		),0)::bigint
		FROM vou_product_lines order_line
		LEFT JOIN vou_purchase_inbound_lines inbound_line
			ON inbound_line.source_order_line_id = order_line.id
		WHERE order_line.document_id = $1
		GROUP BY order_line.id, order_line.base_quantity_micros`, orderID)
	if err != nil {
		return err
	}
	defer rows.Close()
	available := make(map[string]int64)
	var totalRemaining int64
	for rows.Next() {
		var lineID string
		var ordered, reserved int64
		if err = rows.Scan(&lineID, &ordered, &reserved); err != nil {
			return err
		}
		remaining := ordered - reserved
		if remaining < 0 {
			remaining = 0
		}
		available[lineID] = remaining
		totalRemaining += remaining
	}
	if err = rows.Err(); err != nil {
		return err
	}
	for index := range data.ProductLines {
		data.ProductLines[index].AvailableBaseQuantity =
			formatQuantity(available[data.ProductLines[index].LineID])
	}
	data.RemainingBaseQuantity = formatQuantity(totalRemaining)
	return nil
}

func (s *Service) refreshPurchaseOrderFulfillment(
	ctx context.Context, tx pgx.Tx, documentID, _ string,
) error {
	var orderID string
	if err := tx.QueryRow(ctx, `SELECT source_order_id FROM (
		SELECT document_id,source_order_id FROM vou_purchase_inbound_details
		UNION ALL
		SELECT document_id,source_order_id FROM vou_purchase_return_details
	) source WHERE document_id=$1`, documentID).Scan(&orderID); err != nil {
		return err
	}
	var complete bool
	err := tx.QueryRow(ctx, `SELECT NOT EXISTS (
		SELECT 1 FROM vou_product_lines o
		WHERE o.document_id=$1 AND o.base_quantity_micros > COALESCE((
			SELECT sum(i.base_quantity_micros) - COALESCE((
				SELECT sum(r.base_quantity_micros)
				FROM vou_purchase_return_lines r
				JOIN vou_documents rd ON rd.id=r.document_id
				JOIN approval_entries ra ON ra.id=rd.approval_entry_id AND ra.domain='vou'
					AND ra.entity=rd.entity AND ra.subject_id=rd.id
				WHERE r.source_order_line_id=o.id AND ra.status = 'APPROVED'
			),0)
			FROM vou_purchase_inbound_lines i
			JOIN vou_documents d ON d.id=i.document_id
			JOIN approval_entries da ON da.id=d.approval_entry_id AND da.domain='vou'
				AND da.entity=d.entity AND da.subject_id=d.id
			JOIN vou_purchase_inbound_details x ON x.document_id=i.document_id
			WHERE x.source_order_id=$1 AND i.source_order_line_id=o.id
			  AND da.status = 'APPROVED'
		),0)
	)`, orderID).Scan(&complete)
	if err != nil {
		return err
	}
	status := "OPEN"
	if complete {
		status = "FULFILLED"
	}
	_, err = tx.Exec(ctx, `UPDATE vou_purchase_order_details SET fulfillment_status=$1
		WHERE document_id=$2`, status, orderID)
	return err
}

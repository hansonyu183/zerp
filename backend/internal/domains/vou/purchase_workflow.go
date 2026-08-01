package vou

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"strings"
	"time"

	dbsqlc "github.com/hansonyu183/zerp/backend/internal/database/sqlc"
	bobdomain "github.com/hansonyu183/zerp/backend/internal/domains/bob"
	"github.com/hansonyu183/zerp/backend/internal/platform/systemidentity"
	"github.com/jackc/pgx/v5"
)

const (
	purchaseWorkflowType = "PURCHASE_FULFILLMENT"
	purchaseStageOrder   = "PURCHASE_ORDER"
	purchaseStageInbound = "PURCHASE_INBOUND"
	purchaseStageReturn  = "PURCHASE_RETURN"
)

func managedPurchaseDocument(document dbsqlc.VouDocument) bool {
	return document.Entity == EntityPurchaseOrder || document.Entity == EntityPurchaseInbound ||
		document.Entity == EntityPurchaseReturn
}

func (s *Service) validateManagedPurchaseParentStatus(
	ctx context.Context,
	tx pgx.Tx,
	document dbsqlc.VouDocument,
	targetStatus string,
) error {
	if document.Entity == EntityPurchaseOrder {
		return nil
	}
	if document.ParentDocumentID == nil {
		return domainError(ErrorConflict, "purchase document has no source order", nil, nil)
	}
	var status, fulfillment string
	err := tx.QueryRow(ctx, `SELECT d.status,o.fulfillment_status
		FROM vou_documents d
		JOIN vou_purchase_order_details o ON o.document_id=d.id
		WHERE d.id=$1 FOR SHARE OF d,o`, *document.ParentDocumentID).
		Scan(&status, &fulfillment)
	if err != nil {
		return s.internal("read purchase order status", err)
	}
	if document.Entity == EntityPurchaseReturn {
		if status != StatusApproved || fulfillment == "SHORT_CLOSE_REQUESTED" {
			return domainError(ErrorConflict, "purchase order is not returnable", map[string]any{
				"status": status, "fulfillmentStatus": fulfillment, "targetStatus": targetStatus,
			}, nil)
		}
		return nil
	}
	if status != StatusApproved || fulfillment != "OPEN" {
		return domainError(ErrorConflict, "purchase order is not open", map[string]any{
			"status": status, "fulfillmentStatus": fulfillment, "targetStatus": targetStatus,
		}, nil)
	}
	return nil
}

func (s *Service) touchWorkflow(
	ctx context.Context,
	tx pgx.Tx,
	document dbsqlc.VouDocument,
	event, toStatus string,
	_ string,
	requestID string,
	summary map[string]any,
) error {
	actorID := systemidentity.UserID
	if managedPurchaseDocument(document) {
		return s.touchPurchaseWorkflow(
			ctx, tx, document, event, toStatus, actorID, requestID, summary,
		)
	}
	return s.touchSalesWorkflow(ctx, tx, document, event, toStatus, actorID, requestID, summary)
}

func (s *Service) touchPurchaseWorkflow(
	ctx context.Context,
	tx pgx.Tx,
	document dbsqlc.VouDocument,
	event, documentStatus, actorID, requestID string,
	summary map[string]any,
) error {
	var processID, previous string
	err := tx.QueryRow(ctx, `SELECT p.id,p.status
		FROM wfl_process_documents x
		JOIN wfl_process_instances p ON p.id=x.process_id
		WHERE x.document_id=$1 AND p.process_type=$2 FOR UPDATE OF p`,
		document.ID, purchaseWorkflowType).Scan(&processID, &previous)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil {
		return s.internal("lock purchase workflow", err)
	}
	next, err := s.purchaseWorkflowStatus(ctx, tx, processID)
	if err != nil {
		return err
	}
	if _, err = tx.Exec(ctx, `UPDATE wfl_process_instances SET
		status=$1::varchar,revision=revision+1,updated_at=now(),updated_by=$2,
		completed_at=CASE WHEN $1::varchar IN ('COMPLETED','SHORT_CLOSED') THEN now() ELSE NULL END
		WHERE id=$3`, next, actorID, processID); err != nil {
		return s.writeError("touch purchase workflow", err)
	}
	stage := purchaseStageOrder
	if document.Entity == EntityPurchaseInbound {
		stage = purchaseStageInbound
	} else if document.Entity == EntityPurchaseReturn {
		stage = purchaseStageReturn
	}
	return s.insertPurchaseWorkflowAudit(ctx, tx, processID, event, stringPtr(previous), next,
		stage, document.ID, document.DocumentNo, documentStatus, actorID, requestID, summary)
}

func (s *Service) purchaseWorkflowStatus(
	ctx context.Context, tx pgx.Tx, processID string,
) (string, error) {
	var status, fulfillment string
	err := tx.QueryRow(ctx, `SELECT d.status,o.fulfillment_status
		FROM wfl_process_instances p
		JOIN vou_documents d ON d.id=p.root_document_id
		JOIN vou_purchase_order_details o ON o.document_id=d.id
		WHERE p.id=$1`, processID).Scan(&status, &fulfillment)
	if err != nil {
		return "", s.internal("derive purchase workflow status", err)
	}
	var pendingReturns bool
	if err = tx.QueryRow(ctx, `SELECT EXISTS(
		SELECT 1 FROM vou_purchase_return_details r
		JOIN vou_documents d ON d.id=r.document_id
		WHERE r.source_order_id=(SELECT root_document_id FROM wfl_process_instances WHERE id=$1)
		  AND d.status<>'FINALIZED'
	)`, processID).Scan(&pendingReturns); err != nil {
		return "", err
	}
	if pendingReturns && (fulfillment == "FULFILLED" || fulfillment == "SHORT_CLOSED") {
		return StatusReturning, nil
	}
	switch fulfillment {
	case "FULFILLED":
		return StatusCompleted, nil
	case "SHORT_CLOSE_REQUESTED":
		return StatusShortCloseRequested, nil
	case "SHORT_CLOSED":
		return StatusShortClosed, nil
	}
	if status == StatusDraft || status == StatusChecked {
		return status, nil
	}
	return StatusApproved, nil
}

func (s *Service) insertPurchaseWorkflowAudit(
	ctx context.Context,
	tx pgx.Tx,
	processID, event string,
	from *string,
	to, stage, documentID, documentNo, documentStatus, actorID, requestID string,
	summary map[string]any,
) error {
	if summary == nil {
		summary = map[string]any{}
	}
	encoded, err := json.Marshal(summary)
	if err != nil {
		return err
	}
	_, err = tx.Exec(ctx, `INSERT INTO wfl_audit_events(
		id,process_id,event_type,from_status,to_status,stage,document_id,document_no,
		document_status,actor_id,request_id,summary
	) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
		newID(), processID, event, from, to, stage, documentID, documentNo,
		documentStatus, actorID, requestID, encoded)
	return err
}

func (s *Service) linkPurchaseWorkflowDocument(
	ctx context.Context, tx pgx.Tx, orderID, documentID, stage string,
) error {
	var processID string
	if err := tx.QueryRow(ctx, `SELECT process_id FROM wfl_process_documents
		WHERE document_id=$1`, orderID).Scan(&processID); errors.Is(err, pgx.ErrNoRows) {
		return nil
	} else if err != nil {
		return err
	}
	var sequence int32
	if err := tx.QueryRow(ctx, `SELECT COALESCE(max(sequence_no),0)+1
		FROM wfl_process_documents WHERE process_id=$1 AND stage=$2`,
		processID, stage).Scan(&sequence); err != nil {
		return err
	}
	_, err := tx.Exec(ctx, `INSERT INTO wfl_process_documents(
		process_id,document_id,stage,sequence_no
	) VALUES($1,$2,$3,$4)`, processID, documentID, stage, sequence)
	return err
}

// CreatePurchaseInbound reserves quantities immediately, including while the
// inbound is still a draft. The root row lock serializes competing creations.
func (s *Service) CreatePurchaseInbound(
	ctx context.Context,
	input CreateInput,
	actorID, requestID string,
) (MutationResult, error) {
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

	order, detail, err := s.lockPurchaseOrderForInbound(ctx, tx, input.Data.SourceDocumentID)
	if err != nil {
		return MutationResult{}, err
	}
	warehouse, err := s.resolveInboundWarehouse(ctx, tx, input.Data.Warehouse, detail)
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
	if _, err = tx.Exec(ctx, `INSERT INTO vou_documents(
		id,entity,document_no,business_date,currency,total_amount_cents,remark,
		parent_entity,parent_document_id,created_by,updated_by
	) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10)`,
		id, EntityPurchaseInbound, number, businessDate, order.Currency, total,
		optionalText(input.Data.Remark), EntityPurchaseOrder, order.ID, actorID); err != nil {
		return MutationResult{}, s.writeError("insert purchase inbound", err)
	}
	q := s.queries.WithTx(tx)
	if err = q.InsertVouPurchaseInboundDetail(ctx, dbsqlc.InsertVouPurchaseInboundDetailParams{
		DocumentID: id, SourceOrderID: order.ID,
		SupplierObjectID: detail.SupplierObjectID, SupplierVersionID: detail.SupplierVersionID,
		SupplierCode: detail.SupplierCode, SupplierName: detail.SupplierName,
		WarehouseObjectID: warehouse.ObjectID, WarehouseVersionID: warehouse.VersionID,
		WarehouseCode: warehouse.Code, WarehouseName: warehouse.Data.Name,
	}); err != nil {
		return MutationResult{}, s.writeError("insert purchase inbound detail", err)
	}
	if err = s.insertPurchaseInboundLines(ctx, q, id, lines); err != nil {
		return MutationResult{}, err
	}
	var processExists bool
	if err = tx.QueryRow(ctx, `SELECT EXISTS(
		SELECT 1 FROM wfl_process_instances WHERE id=$1 AND process_type=$2
	)`, order.ID, purchaseWorkflowType).Scan(&processExists); err != nil {
		return MutationResult{}, s.internal("check purchase workflow", err)
	}
	if processExists {
		var sequence int32
		if err = tx.QueryRow(ctx, `SELECT COALESCE(max(sequence_no),0)+1
			FROM wfl_process_documents WHERE process_id=$1 AND stage=$2`,
			order.ID, purchaseStageInbound).Scan(&sequence); err != nil {
			return MutationResult{}, err
		}
		if _, err = tx.Exec(ctx, `INSERT INTO wfl_process_documents(
			process_id,document_id,stage,sequence_no
		) VALUES($1,$2,$3,$4)`, order.ID, id, purchaseStageInbound, sequence); err != nil {
			return MutationResult{}, s.writeError("link purchase inbound", err)
		}
	}
	if err = insertAudit(ctx, q, auditInput{
		DocumentID: id, Entity: EntityPurchaseInbound, Event: "CREATED", To: StatusDraft,
		ActorID: actorID, RequestID: requestID, Summary: map[string]any{"sourceOrderId": order.ID},
	}); err != nil {
		return MutationResult{}, err
	}
	inbound := dbsqlc.VouDocument{
		ID: id, Entity: EntityPurchaseInbound, DocumentNo: number,
		ParentDocumentID: stringPtr(order.ID),
	}
	if err = s.touchPurchaseWorkflow(ctx, tx, inbound, "INBOUND_CREATED", StatusDraft,
		actorID, requestID, map[string]any{"lineCount": len(lines)}); err != nil {
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
	return MutationResult{DocumentID: id, DocumentNo: number, Status: StatusDraft, Revision: 1}, nil
}

func (s *Service) SavePurchaseInbound(
	ctx context.Context,
	input SaveInput,
	actorID, requestID string,
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
	document, err := q.LockVouDocument(ctx, dbsqlc.LockVouDocumentParams{
		ID: input.DocumentID, Entity: EntityPurchaseInbound,
	})
	if err = documentWriteConflict(err, document.Revision, input.Revision, document.Status, StatusDraft); err != nil {
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
	warehouse, err := s.resolveInboundWarehouse(ctx, tx, input.Data.Warehouse, orderDetail)
	if err != nil {
		return MutationResult{}, err
	}
	lines, total, err := s.validateAndReserveInboundLines(
		ctx, tx, order.ID, input.DocumentID, input.Data.SourceLines,
	)
	if err != nil {
		return MutationResult{}, err
	}
	revision, err := q.UpdateVouDraft(ctx, dbsqlc.UpdateVouDraftParams{
		BusinessDate: dateValue(businessDate), Currency: order.Currency,
		TotalAmountCents: total, Remark: optionalText(input.Data.Remark), ActorID: actorID,
		ID: input.DocumentID, Entity: EntityPurchaseInbound, Revision: input.Revision,
	})
	if err != nil {
		return MutationResult{}, s.writeError("update purchase inbound", err)
	}
	rows, err := q.UpdateVouPurchaseInboundWarehouse(ctx, dbsqlc.UpdateVouPurchaseInboundWarehouseParams{
		WarehouseObjectID: warehouse.ObjectID, WarehouseVersionID: warehouse.VersionID,
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
	if err = insertAudit(ctx, q, auditInput{
		DocumentID: input.DocumentID, Entity: EntityPurchaseInbound, Event: "SAVED",
		From: stringPtr(StatusDraft), To: StatusDraft, ActorID: actorID, RequestID: requestID,
		Summary: map[string]any{"lineCount": len(lines)},
	}); err != nil {
		return MutationResult{}, err
	}
	if err = s.touchPurchaseWorkflow(ctx, tx, document, "SAVED", StatusDraft,
		actorID, requestID, map[string]any{"lineCount": len(lines)}); err != nil {
		return MutationResult{}, err
	}
	if err = tx.Commit(ctx); err != nil {
		return MutationResult{}, s.writeError("commit save purchase inbound", err)
	}
	return mutation(document, StatusDraft, revision), nil
}

func (s *Service) DeletePurchaseInbound(
	ctx context.Context,
	input ReverseInput,
	actorID, requestID string,
) (MutationResult, error) {
	reason, err := validateReverse(input)
	if err != nil {
		return MutationResult{}, err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return MutationResult{}, s.internal("begin delete purchase inbound", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	q := s.queries.WithTx(tx)
	document, err := q.LockVouDocument(ctx, dbsqlc.LockVouDocumentParams{
		ID: input.DocumentID, Entity: EntityPurchaseInbound,
	})
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
	var processID string
	if err = tx.QueryRow(ctx, `SELECT process_id FROM wfl_process_documents
		WHERE document_id=$1`, input.DocumentID).Scan(&processID); errors.Is(err, pgx.ErrNoRows) {
		processID = ""
	} else if err != nil {
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
		`DELETE FROM vou_audit_events WHERE document_id=$1`,
		`DELETE FROM vou_purchase_inbound_lines WHERE document_id=$1`,
		`DELETE FROM vou_purchase_inbound_details WHERE document_id=$1`,
		`DELETE FROM vou_documents WHERE id=$1`,
	} {
		if _, err = tx.Exec(ctx, statement, input.DocumentID); err != nil {
			return MutationResult{}, s.writeError("delete purchase inbound", err)
		}
	}
	if processID != "" {
		workflowActorID := systemidentity.UserID
		if _, err = tx.Exec(ctx, `UPDATE wfl_process_instances SET revision=revision+1,
			updated_at=now(),updated_by=$1 WHERE id=$2`, workflowActorID, processID); err != nil {
			return MutationResult{}, err
		}
		if err = s.insertPurchaseWorkflowAudit(ctx, tx, processID, "INBOUND_DELETED",
			stringPtr(StatusApproved), StatusApproved, purchaseStageInbound,
			document.ID, document.DocumentNo, StatusDraft, workflowActorID, requestID,
			map[string]any{"reason": strings.TrimSpace(input.Reason)}); err != nil {
			return MutationResult{}, err
		}
	}
	if err = tx.Commit(ctx); err != nil {
		return MutationResult{}, s.writeError("commit delete purchase inbound", err)
	}
	return MutationResult{
		DocumentID: document.ID, DocumentNo: document.DocumentNo,
		Status: "DELETED", Revision: document.Revision,
	}, nil
}

func (s *Service) PurchaseShortCloseRequest(
	ctx context.Context, input ReverseInput, actorID, requestID string,
) (MutationResult, error) {
	return s.purchaseShortClose(ctx, "request", input.DocumentID, input.Revision,
		input.Reason, actorID, requestID)
}

func (s *Service) PurchaseShortCloseCancel(
	ctx context.Context, input ReverseInput, actorID, requestID string,
) (MutationResult, error) {
	return s.purchaseShortClose(ctx, "cancel", input.DocumentID, input.Revision,
		input.Reason, actorID, requestID)
}

func (s *Service) PurchaseShortCloseConfirm(
	ctx context.Context, input DocumentRevisionInput, actorID, requestID string,
) (MutationResult, error) {
	return s.purchaseShortClose(ctx, "confirm", input.DocumentID, input.Revision,
		"", actorID, requestID)
}

func (s *Service) PurchaseShortCloseUnconfirm(
	ctx context.Context, input ReverseInput, actorID, requestID string,
) (MutationResult, error) {
	return s.purchaseShortClose(ctx, "unconfirm", input.DocumentID, input.Revision,
		input.Reason, actorID, requestID)
}

func (s *Service) purchaseShortClose(
	ctx context.Context,
	operation, documentID string,
	revision int64,
	reason, actorID, requestID string,
) (MutationResult, error) {
	if err := validateDocumentRevision(documentID, revision); err != nil {
		return MutationResult{}, err
	}
	if !validID(actorID) {
		return MutationResult{}, domainError(ErrorValidation, "invalid actor", nil, nil)
	}
	if operation != "confirm" {
		if _, err := validateReverse(ReverseInput{
			DocumentID: documentID, Revision: revision, Reason: reason,
		}); err != nil {
			return MutationResult{}, err
		}
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return MutationResult{}, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	q := s.queries.WithTx(tx)
	document, err := q.LockVouDocument(ctx, dbsqlc.LockVouDocumentParams{
		ID: documentID, Entity: EntityPurchaseOrder,
	})
	if err != nil || document.Revision != revision || document.Status != StatusApproved {
		return MutationResult{}, domainError(ErrorConflict, "purchase order changed", nil, err)
	}
	detail, err := q.GetVouPurchaseOrderDetail(ctx, documentID)
	if err != nil {
		return MutationResult{}, err
	}
	if operation == "request" || operation == "confirm" {
		var unfinished bool
		err = tx.QueryRow(ctx, `SELECT EXISTS (
			SELECT 1
			FROM vou_purchase_inbound_details i
			JOIN vou_documents d ON d.id=i.document_id
			WHERE i.source_order_id=$1 AND d.status<>'FINALIZED'
		)`, documentID).Scan(&unfinished)
		if err != nil {
			return MutationResult{}, err
		}
		if unfinished {
			return MutationResult{}, domainError(
				ErrorConflict,
				"purchase order has unfinished inbound documents",
				nil,
				nil,
			)
		}
		var pendingReturns bool
		err = tx.QueryRow(ctx, `SELECT EXISTS (
			SELECT 1 FROM vou_purchase_return_details r
			JOIN vou_documents d ON d.id=r.document_id
			WHERE r.source_order_id=$1 AND d.status<>'FINALIZED'
		)`, documentID).Scan(&pendingReturns)
		if err != nil {
			return MutationResult{}, err
		}
		if pendingReturns {
			return MutationResult{}, domainError(
				ErrorConflict, "purchase order has unfinished return documents", nil, nil,
			)
		}
	}
	next := ""
	requestedBy := detail.ShortCloseRequestedBy
	shortReason := detail.ShortCloseReason
	switch operation {
	case "request":
		if detail.FulfillmentStatus != "OPEN" {
			return MutationResult{}, domainError(ErrorConflict, "purchase order cannot request short close", nil, nil)
		}
		var hasRemaining bool
		err = tx.QueryRow(ctx, `SELECT EXISTS (
			SELECT 1 FROM vou_product_lines o WHERE o.document_id=$1
			  AND o.ordered_qty_micros > COALESCE((
				SELECT sum(i.quantity_micros) - COALESCE((
					SELECT sum(r.quantity_micros) FROM vou_purchase_return_lines r
					JOIN vou_documents rd ON rd.id=r.document_id
					WHERE r.source_order_line_id=o.id AND rd.status='FINALIZED'
				),0) FROM vou_purchase_inbound_lines i
				JOIN vou_documents d ON d.id=i.document_id
				JOIN vou_purchase_inbound_details x ON x.document_id=i.document_id
				WHERE x.source_order_id=$1 AND i.source_order_line_id=o.id
				  AND d.status='FINALIZED'
			  ),0)
		)`, documentID).Scan(&hasRemaining)
		if err != nil || !hasRemaining {
			return MutationResult{}, domainError(ErrorConflict, "purchase order has no remaining quantity", nil, err)
		}
		next, requestedBy, shortReason = "SHORT_CLOSE_REQUESTED", stringPtr(actorID), optionalText(reason)
	case "cancel":
		if detail.FulfillmentStatus != "SHORT_CLOSE_REQUESTED" {
			return MutationResult{}, domainError(ErrorConflict, "short close is not requested", nil, nil)
		}
		next, requestedBy, shortReason = "OPEN", nil, nil
	case "confirm":
		if detail.FulfillmentStatus != "SHORT_CLOSE_REQUESTED" ||
			detail.ShortCloseRequestedBy == nil || *detail.ShortCloseRequestedBy == actorID {
			return MutationResult{}, domainError(ErrorConflict,
				"short close must be confirmed by another user", nil, nil)
		}
		next = "SHORT_CLOSED"
	case "unconfirm":
		if detail.FulfillmentStatus != "SHORT_CLOSED" {
			return MutationResult{}, domainError(ErrorConflict, "purchase order is not short closed", nil, nil)
		}
		next = "SHORT_CLOSE_REQUESTED"
	default:
		return MutationResult{}, domainError(ErrorInternal, "invalid short close operation", nil, nil)
	}
	var newRevision int64
	err = tx.QueryRow(ctx, `UPDATE vou_documents SET revision=revision+1,
		updated_at=now(),updated_by=$1 WHERE id=$2 AND revision=$3 RETURNING revision`,
		actorID, documentID, revision).Scan(&newRevision)
	if err != nil {
		return MutationResult{}, s.writeError("update purchase short close", err)
	}
	if _, err = tx.Exec(ctx, `UPDATE vou_purchase_order_details SET
		fulfillment_status=$1,short_close_requested_by=$2,short_close_reason=$3
		WHERE document_id=$4`, next, requestedBy, shortReason, documentID); err != nil {
		return MutationResult{}, err
	}
	processStatus := map[string]string{
		"OPEN": StatusApproved, "SHORT_CLOSE_REQUESTED": StatusShortCloseRequested,
		"SHORT_CLOSED": StatusShortClosed,
	}[next]
	workflowActorID := systemidentity.UserID
	if _, err = tx.Exec(ctx, `UPDATE wfl_process_instances SET status=$1,
		revision=revision+1,updated_at=now(),updated_by=$2,
		completed_at=CASE WHEN $1::varchar='SHORT_CLOSED' THEN now() ELSE NULL END
		WHERE root_document_id=$3 AND process_type=$4`,
		processStatus, workflowActorID, documentID, purchaseWorkflowType); err != nil {
		return MutationResult{}, err
	}
	var processExists bool
	if err = tx.QueryRow(ctx, `SELECT EXISTS(
		SELECT 1 FROM wfl_process_instances
		WHERE root_document_id=$1 AND process_type=$2
	)`, documentID, purchaseWorkflowType).Scan(&processExists); err != nil {
		return MutationResult{}, err
	}
	if processExists {
		if err = s.insertPurchaseWorkflowAudit(ctx, tx, documentID,
			"SHORT_CLOSE_"+strings.ToUpper(operation), stringPtr(detail.FulfillmentStatus),
			processStatus, purchaseStageOrder, document.ID, document.DocumentNo,
			document.Status, workflowActorID, requestID, map[string]any{"reason": reason}); err != nil {
			return MutationResult{}, err
		}
	}
	if err = tx.Commit(ctx); err != nil {
		return MutationResult{}, err
	}
	return MutationResult{
		DocumentID: document.ID, DocumentNo: document.DocumentNo,
		Status: processStatus, Revision: newRevision,
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
) (dbsqlc.VouDocument, dbsqlc.VouPurchaseOrderDetail, error) {
	q := s.queries.WithTx(tx)
	order, err := q.LockVouDocument(ctx, dbsqlc.LockVouDocumentParams{
		ID: orderID, Entity: EntityPurchaseOrder,
	})
	if err != nil {
		return order, dbsqlc.VouPurchaseOrderDetail{},
			domainError(ErrorValidation, "purchase order not found", nil, err)
	}
	detail, err := q.GetVouPurchaseOrderDetail(ctx, orderID)
	if err != nil {
		return order, detail, err
	}
	if order.Status != StatusApproved || detail.FulfillmentStatus != "OPEN" {
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
) (bobdomain.EffectiveReference, error) {
	if input == nil {
		input = &ReferenceInput{
			ObjectID: deref(detail.WarehouseObjectID), VersionID: deref(detail.WarehouseVersionID),
		}
	}
	if err := validateReference(input, "warehouse", true); err != nil {
		return bobdomain.EffectiveReference{}, err
	}
	ref, err := s.resolver.ResolveEffectiveReference(
		ctx, tx, bobdomain.EntityWarehouse, input.ObjectID, input.VersionID,
	)
	if err != nil {
		return ref, domainError(ErrorConflict, "warehouse is not effective", nil, err)
	}
	return ref, nil
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
		qty, parseErr := quantityMicros(raw.Quantity, false)
		if parseErr != nil {
			return nil, 0, domainError(ErrorValidation, "invalid inbound quantity", nil, parseErr)
		}
		var reserved int64
		err = tx.QueryRow(ctx, `SELECT COALESCE(sum(l.quantity_micros),0) - COALESCE((
				SELECT sum(r.quantity_micros) FROM vou_purchase_return_lines r
				JOIN vou_documents d ON d.id=r.document_id
				WHERE r.source_order_line_id=$2 AND d.status='FINALIZED'
			),0)
			FROM vou_purchase_inbound_lines l
			JOIN vou_purchase_inbound_details x ON x.document_id=l.document_id
			WHERE x.source_order_id=$1 AND l.source_order_line_id=$2
			  AND ($3='' OR l.document_id<>$3)`,
			orderID, source.ID, excludeInboundID).Scan(&reserved)
		if err != nil {
			return nil, 0, err
		}
		if reserved > source.OrderedQtyMicros-qty {
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
			ProductVersionID: line.source.ProductVersionID, ProductCode: line.source.ProductCode,
			ProductName: line.source.ProductName, ProductUnit: line.source.ProductUnit,
			QuantityMicros: line.qty, UnitPriceCents: line.source.UnitPriceCents,
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
	rows, err := s.pool.Query(ctx, `SELECT order_line.id, order_line.ordered_qty_micros,
		COALESCE(sum(inbound_line.quantity_micros), 0)::bigint - COALESCE((
			SELECT sum(return_line.quantity_micros)
			FROM vou_purchase_return_lines return_line
			JOIN vou_documents return_doc ON return_doc.id=return_line.document_id
			WHERE return_line.source_order_line_id=order_line.id
			  AND return_doc.status='FINALIZED'
		),0)::bigint
		FROM vou_product_lines order_line
		LEFT JOIN vou_purchase_inbound_lines inbound_line
			ON inbound_line.source_order_line_id = order_line.id
		WHERE order_line.document_id = $1
		GROUP BY order_line.id, order_line.ordered_qty_micros`, orderID)
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
		data.ProductLines[index].AvailableQuantity =
			formatQuantity(available[data.ProductLines[index].LineID])
	}
	data.RemainingQuantity = formatQuantity(totalRemaining)
	return nil
}

func (s *Service) refreshPurchaseOrderFulfillment(
	ctx context.Context, tx pgx.Tx, documentID, _ string,
) error {
	actorID := systemidentity.UserID
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
		WHERE o.document_id=$1 AND o.ordered_qty_micros > COALESCE((
			SELECT sum(i.quantity_micros) - COALESCE((
				SELECT sum(r.quantity_micros)
				FROM vou_purchase_return_lines r
				JOIN vou_documents rd ON rd.id=r.document_id
				WHERE r.source_order_line_id=o.id AND rd.status='FINALIZED'
			),0)
			FROM vou_purchase_inbound_lines i
			JOIN vou_documents d ON d.id=i.document_id
			JOIN vou_purchase_inbound_details x ON x.document_id=i.document_id
			WHERE x.source_order_id=$1 AND i.source_order_line_id=o.id
			  AND d.status='FINALIZED'
		),0)
	)`, orderID).Scan(&complete)
	if err != nil {
		return err
	}
	status := "OPEN"
	if complete {
		status = "FULFILLED"
	}
	_, err = tx.Exec(ctx, `UPDATE vou_purchase_order_details SET fulfillment_status=$1,
		short_close_requested_by=NULL,short_close_reason=NULL
		WHERE document_id=$2`, status, orderID)
	if err == nil {
		_, err = tx.Exec(ctx, `UPDATE wfl_process_instances SET
			status=CASE WHEN $1 THEN 'COMPLETED' ELSE 'APPROVED' END,
			revision=revision+1,updated_at=now(),updated_by=$2,
			completed_at=CASE WHEN $1 THEN now() ELSE NULL END
			WHERE root_document_id=$3 AND process_type=$4`,
			complete, actorID, orderID, purchaseWorkflowType)
	}
	return err
}

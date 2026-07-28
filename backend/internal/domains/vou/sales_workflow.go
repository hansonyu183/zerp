package vou

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"time"

	dbsqlc "github.com/hansonyu183/zerp/backend/internal/database/sqlc"
	"github.com/jackc/pgx/v5"
)

const (
	salesWorkflowType  = "SALES_FULFILLMENT"
	salesStageOrder    = "SALE_ORDER"
	salesStageOutbound = "OUTBOUND"
	salesStageDelivery = "DELIVERY"
	salesStageSignoff  = "SIGNOFF"
)

func managedSalesDocument(document dbsqlc.VouDocument) bool {
	return document.ControlDomain == "WFL" &&
		document.WorkflowVersion == 2 &&
		(document.Entity == EntitySaleOrder || isSalesChainEntity(document.Entity))
}

func (s *Service) validateManagedSalesParentStatus(
	ctx context.Context,
	tx pgx.Tx,
	document dbsqlc.VouDocument,
	targetStatus string,
) error {
	if managedPurchaseDocument(document) {
		return s.validateManagedPurchaseParentStatus(ctx, tx, document, targetStatus)
	}
	if !managedSalesDocument(document) || document.ParentDocumentID == nil {
		return nil
	}
	var parentStatus string
	if err := tx.QueryRow(ctx, `SELECT status FROM vou_documents
		WHERE id=$1 FOR SHARE`, *document.ParentDocumentID).Scan(&parentStatus); err != nil {
		return s.internal("read sales workflow parent status", err)
	}
	rank := map[string]int{
		StatusDraft: 0, StatusChecked: 1, StatusApproved: 2, StatusFinalized: 3,
	}
	required, ok := rank[targetStatus]
	if !ok || rank[parentStatus] < required {
		return domainError(
			ErrorConflict,
			"parent sales document has not reached the required status",
			map[string]any{
				"parentDocumentId": *document.ParentDocumentID,
				"parentStatus":     parentStatus,
				"requiredStatus":   targetStatus,
			},
			nil,
		)
	}
	return nil
}

func (s *Service) validateManagedSalesReady(
	ctx context.Context,
	tx pgx.Tx,
	document dbsqlc.VouDocument,
) error {
	if managedPurchaseDocument(document) {
		if document.Entity == EntityPurchaseOrder {
			return nil
		}
		var ready bool
		err := tx.QueryRow(ctx, `SELECT EXISTS (
			SELECT 1 FROM vou_purchase_inbound_lines WHERE document_id=$1
		)`, document.ID).Scan(&ready)
		if err != nil {
			return s.internal("validate purchase inbound readiness", err)
		}
		if !ready {
			return domainError(ErrorConflict, "purchase inbound has no lines", nil, nil)
		}
		return nil
	}
	if !managedSalesDocument(document) || document.Entity == EntitySaleOrder {
		return nil
	}
	var ready bool
	var err error
	switch document.Entity {
	case EntitySaleOutbound:
		err = tx.QueryRow(ctx, `SELECT
			x.warehouse_object_id IS NOT NULL
			AND x.warehouse_version_id IS NOT NULL
			AND EXISTS (
				SELECT 1 FROM vou_sale_outbound_lines l
				WHERE l.document_id=x.document_id AND l.quantity_micros > 0
			)
			FROM vou_sale_outbound_details x WHERE x.document_id=$1`,
			document.ID).Scan(&ready)
	case EntitySaleDelivery:
		err = tx.QueryRow(ctx, `SELECT
			x.platform_object_id IS NOT NULL
			AND x.platform_version_id IS NOT NULL
			AND x.vehicle_object_id IS NOT NULL
			AND x.vehicle_version_id IS NOT NULL
			FROM vou_sale_delivery_details x WHERE x.document_id=$1`,
			document.ID).Scan(&ready)
	case EntitySaleSignoff:
		err = tx.QueryRow(ctx, `SELECT EXISTS (
			SELECT 1 FROM vou_sale_signoff_lines l
			WHERE l.document_id=$1
			  AND l.signed_qty_micros + l.rejected_qty_micros >= 0
		)`, document.ID).Scan(&ready)
	default:
		return nil
	}
	if err != nil {
		return s.internal("validate generated sales draft", err)
	}
	if !ready {
		return domainError(
			ErrorValidation,
			"generated sales draft is missing required business data",
			map[string]any{"documentId": document.ID, "entity": document.Entity},
			nil,
		)
	}
	return nil
}

func (s *Service) validateManagedSalesChildrenAtMost(
	ctx context.Context,
	tx pgx.Tx,
	document dbsqlc.VouDocument,
	targetStatus string,
) error {
	if !managedSalesDocument(document) {
		return nil
	}
	targetRank := map[string]int{
		StatusDraft: 0, StatusChecked: 1, StatusApproved: 2, StatusFinalized: 3,
	}[targetStatus]
	rows, err := tx.Query(ctx, `SELECT id,status FROM vou_documents
		WHERE parent_document_id=$1 FOR SHARE`, document.ID)
	if err != nil {
		return s.internal("read sales workflow children", err)
	}
	defer rows.Close()
	for rows.Next() {
		var childID, status string
		if err = rows.Scan(&childID, &status); err != nil {
			return s.internal("scan sales workflow child", err)
		}
		childRank, ok := map[string]int{
			StatusDraft: 0, StatusChecked: 1, StatusApproved: 2, StatusFinalized: 3,
		}[status]
		if !ok || childRank > targetRank {
			return domainError(
				ErrorConflict,
				"downstream sales document blocks the reverse transition",
				map[string]any{
					"documentId":         childID,
					"status":             status,
					"parentTargetStatus": targetStatus,
				},
				nil,
			)
		}
	}
	if err = rows.Err(); err != nil {
		return s.internal("read sales workflow children", err)
	}
	return nil
}

func (s *Service) createSalesWorkflow(
	ctx context.Context,
	tx pgx.Tx,
	documentID, documentNo, actorID, requestID string,
) error {
	processID := newID()
	if _, err := tx.Exec(ctx, `INSERT INTO wfl_process_instances(
		id,process_type,definition_version,root_document_id,status,revision,created_by,updated_by
	) VALUES($1,$2,1,$3,'DRAFT',1,$4,$4)`,
		processID, salesWorkflowType, documentID, actorID); err != nil {
		return s.writeError("insert sales workflow", err)
	}
	if _, err := tx.Exec(ctx, `INSERT INTO wfl_process_documents(
		process_id,document_id,stage,sequence_no
	) VALUES($1,$2,$3,1)`, processID, documentID, salesStageOrder); err != nil {
		return s.writeError("link sales workflow root", err)
	}
	return s.insertSalesWorkflowAudit(
		ctx, tx, processID, "CREATED", nil, StatusDraft, salesStageOrder,
		documentID, documentNo, StatusDraft, actorID, requestID,
		map[string]any{"autoGenerated": false},
	)
}

func (s *Service) salesProcessForDocument(
	ctx context.Context, tx pgx.Tx, documentID string,
) (string, string, int64, error) {
	var processID, status string
	var revision int64
	err := tx.QueryRow(ctx, `SELECT p.id,p.status,p.revision
		FROM wfl_process_documents x
		JOIN wfl_process_instances p ON p.id=x.process_id
		WHERE x.document_id=$1 AND p.process_type=$2
		FOR UPDATE OF p`, documentID, salesWorkflowType).
		Scan(&processID, &status, &revision)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", "", 0, domainError(ErrorConflict, "sales workflow not found", nil, nil)
	}
	if err != nil {
		return "", "", 0, s.internal("lock sales workflow", err)
	}
	return processID, status, revision, nil
}

func (s *Service) salesWorkflowStatus(
	ctx context.Context, tx pgx.Tx, processID string,
) (string, error) {
	var documentStatus, fulfillment string
	err := tx.QueryRow(ctx, `SELECT d.status,o.fulfillment_status
		FROM wfl_process_instances p
		JOIN vou_documents d ON d.id=p.root_document_id
		JOIN vou_sale_order_details o ON o.document_id=d.id
		WHERE p.id=$1`, processID).Scan(&documentStatus, &fulfillment)
	if err != nil {
		return "", err
	}
	switch fulfillment {
	case "FULFILLED":
		return StatusCompleted, nil
	case "SHORT_CLOSE_REQUESTED":
		return StatusShortCloseRequested, nil
	case "SHORT_CLOSED":
		return StatusShortClosed, nil
	}
	switch documentStatus {
	case StatusDraft, StatusChecked:
		return documentStatus, nil
	default:
		return StatusApproved, nil
	}
}

func (s *Service) touchSalesWorkflow(
	ctx context.Context,
	tx pgx.Tx,
	document dbsqlc.VouDocument,
	event, toStatus, actorID, requestID string,
	summary map[string]any,
) error {
	if !managedSalesDocument(document) {
		return nil
	}
	processID, previous, _, err := s.salesProcessForDocument(ctx, tx, document.ID)
	if err != nil {
		return err
	}
	next, err := s.salesWorkflowStatus(ctx, tx, processID)
	if err != nil {
		return s.internal("derive sales workflow status", err)
	}
	if _, err = tx.Exec(ctx, `UPDATE wfl_process_instances SET
		status=$1::text,revision=revision+1,updated_at=now(),updated_by=$2,
		completed_at=CASE WHEN $1::text IN ('COMPLETED','SHORT_CLOSED') THEN now() ELSE NULL END
		WHERE id=$3`, next, actorID, processID); err != nil {
		return s.writeError("touch sales workflow", err)
	}
	stage := salesStage(document.Entity)
	return s.insertSalesWorkflowAudit(
		ctx, tx, processID, event, stringPtr(previous), next, stage,
		document.ID, document.DocumentNo, toStatus, actorID, requestID, summary,
	)
}

func (s *Service) insertSalesWorkflowAudit(
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

func salesStage(entity string) string {
	return map[string]string{
		EntitySaleOrder:    salesStageOrder,
		EntitySaleOutbound: salesStageOutbound,
		EntitySaleDelivery: salesStageDelivery,
		EntitySaleSignoff:  salesStageSignoff,
	}[entity]
}

func (s *Service) linkSalesWorkflowDocument(
	ctx context.Context, tx pgx.Tx, parentID, documentID, stage string,
) error {
	var processID string
	if err := tx.QueryRow(ctx, `SELECT process_id FROM wfl_process_documents
		WHERE document_id=$1`, parentID).Scan(&processID); err != nil {
		return s.internal("find parent sales workflow", err)
	}
	var sequence int32
	if err := tx.QueryRow(ctx, `SELECT COALESCE(max(sequence_no),0)+1
		FROM wfl_process_documents WHERE process_id=$1 AND stage=$2`,
		processID, stage).Scan(&sequence); err != nil {
		return s.internal("allocate sales workflow stage sequence", err)
	}
	if _, err := tx.Exec(ctx, `INSERT INTO wfl_process_documents(
		process_id,document_id,stage,sequence_no
	) VALUES($1,$2,$3,$4)`, processID, documentID, stage, sequence); err != nil {
		return s.writeError("link generated sales draft", err)
	}
	return nil
}

func (s *Service) onManagedSalesApproved(
	ctx context.Context,
	tx pgx.Tx,
	document dbsqlc.VouDocument,
	actorID, requestID string,
) (map[string]any, error) {
	if !managedSalesDocument(document) {
		return nil, nil
	}
	var generated MutationResult
	var err error
	switch document.Entity {
	case EntitySaleOrder:
		generated, err = s.ensureAutoOutboundDraft(ctx, tx, document.ID, actorID, requestID)
	case EntitySaleOutbound:
		generated, err = s.ensureAutoDeliveryDraft(ctx, tx, document.ID, actorID, requestID)
	case EntitySaleDelivery:
		generated, err = s.ensureAutoSignoffDraft(ctx, tx, document.ID, actorID, requestID)
	}
	if err != nil {
		return nil, err
	}
	if generated.DocumentID == "" {
		return map[string]any{"autoGenerated": false}, nil
	}
	generatedEntity := map[string]string{
		EntitySaleOrder:    EntitySaleOutbound,
		EntitySaleOutbound: EntitySaleDelivery,
		EntitySaleDelivery: EntitySaleSignoff,
	}[document.Entity]
	return map[string]any{
		"autoGenerated": true,
		"documentId":    generated.DocumentID,
		"documentNo":    generated.DocumentNo,
		"entity":        generatedEntity,
	}, nil
}

type autoOutboundLine struct {
	sourceLineID                                                             string
	productObjectID, productVersionID, productCode, productName, productUnit string
	quantity, price, amount                                                  int64
}

func (s *Service) ensureAutoOutboundDraft(
	ctx context.Context, tx pgx.Tx, orderID, actorID, requestID string,
) (MutationResult, error) {
	var existing MutationResult
	err := tx.QueryRow(ctx, `SELECT id,document_no,status,revision
		FROM vou_documents
		WHERE parent_document_id=$1 AND entity='sale-outbound'
		  AND control_domain='WFL' AND auto_generated AND status='DRAFT'
		FOR UPDATE`, orderID).
		Scan(&existing.DocumentID, &existing.DocumentNo, &existing.Status, &existing.Revision)
	if err == nil {
		return MutationResult{}, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return MutationResult{}, s.internal("find generated outbound draft", err)
	}
	var orderNumber, orderStatus, currency, customerID, customerVersion, customerCode, customerName string
	var date time.Time
	if err = tx.QueryRow(ctx, `SELECT d.document_no,d.status,d.business_date,d.currency,
		o.customer_object_id,o.customer_version_id,o.customer_code,o.customer_name
		FROM vou_documents d
		JOIN vou_sale_order_details o ON o.document_id=d.id
		WHERE d.id=$1 AND d.control_domain='WFL'
		FOR UPDATE OF d`, orderID).Scan(
		&orderNumber, &orderStatus, &date, &currency,
		&customerID, &customerVersion, &customerCode, &customerName,
	); err != nil {
		return MutationResult{}, s.internal("lock generated outbound source", err)
	}
	if orderStatus != StatusApproved && orderStatus != StatusFinalized {
		return MutationResult{}, nil
	}
	rows, err := tx.Query(ctx, `SELECT l.id,l.product_object_id,l.product_version_id,
		l.product_code,l.product_name,l.product_unit,l.unit_price_cents,
		GREATEST(l.ordered_qty_micros
			- COALESCE((SELECT sum(sl.signed_qty_micros)
				FROM vou_sale_signoff_lines sl
				JOIN vou_documents sd ON sd.id=sl.document_id AND sd.status='FINALIZED'
				WHERE sl.source_order_line_id=l.id),0)
			- COALESCE((SELECT sum(ol.quantity_micros)
				FROM vou_sale_outbound_lines ol
				JOIN vou_documents od ON od.id=ol.document_id AND od.status='FINALIZED'
				LEFT JOIN vou_sale_signoff_lines sl2 ON sl2.source_outbound_line_id=ol.id
				LEFT JOIN vou_documents sd2 ON sd2.id=sl2.document_id
				WHERE ol.source_order_line_id=l.id
				  AND (sd2.id IS NULL OR sd2.status<>'FINALIZED')),0),0)::bigint
		FROM vou_product_lines l WHERE l.document_id=$1 ORDER BY l.line_no`, orderID)
	if err != nil {
		return MutationResult{}, s.internal("read available outbound lines", err)
	}
	defer rows.Close()
	lines := make([]autoOutboundLine, 0)
	var total int64
	for rows.Next() {
		var line autoOutboundLine
		if err = rows.Scan(
			&line.sourceLineID, &line.productObjectID, &line.productVersionID,
			&line.productCode, &line.productName, &line.productUnit, &line.price, &line.quantity,
		); err != nil {
			return MutationResult{}, err
		}
		if line.quantity <= 0 {
			continue
		}
		line.amount, err = lineAmountCents(line.quantity, line.price)
		if err != nil || total > math.MaxInt64-line.amount {
			return MutationResult{}, domainError(ErrorConflict, "generated outbound amount out of range", nil, err)
		}
		total += line.amount
		lines = append(lines, line)
	}
	if err = rows.Err(); err != nil {
		return MutationResult{}, err
	}
	if len(lines) == 0 {
		return MutationResult{}, nil
	}
	id, number, err := s.insertAutoSalesDocument(
		ctx, tx, EntitySaleOutbound, orderID, date, currency, total, actorID,
	)
	if err != nil {
		return MutationResult{}, err
	}
	if _, err = tx.Exec(ctx, `INSERT INTO vou_sale_outbound_details(
		document_id,source_order_id,customer_object_id,customer_version_id,customer_code,customer_name
	) VALUES($1,$2,$3,$4,$5,$6)`,
		id, orderID, customerID, customerVersion, customerCode, customerName); err != nil {
		return MutationResult{}, s.writeError("insert generated outbound detail", err)
	}
	for index, line := range lines {
		if _, err = tx.Exec(ctx, `INSERT INTO vou_sale_outbound_lines(
			id,document_id,source_order_line_id,line_no,product_object_id,product_version_id,
			product_code,product_name,product_unit,quantity_micros,unit_price_cents,line_amount_cents
		) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
			newID(), id, line.sourceLineID, index+1,
			line.productObjectID, line.productVersionID, line.productCode, line.productName,
			line.productUnit, line.quantity, line.price, line.amount); err != nil {
			return MutationResult{}, s.writeError("insert generated outbound line", err)
		}
	}
	if err = s.finishAutoSalesDocument(
		ctx, tx, orderID, id, number, EntitySaleOutbound, actorID, requestID,
		map[string]any{"sourceDocumentId": orderID, "sourceDocumentNo": orderNumber},
	); err != nil {
		return MutationResult{}, err
	}
	return MutationResult{DocumentID: id, DocumentNo: number, Status: StatusDraft, Revision: 1}, nil
}

func (s *Service) insertAutoSalesDocument(
	ctx context.Context,
	tx pgx.Tx,
	entity, parentID string,
	date time.Time,
	currency string,
	total int64,
	actorID string,
) (string, string, error) {
	q := s.queries.WithTx(tx)
	counter, err := q.NextVouNumberCounter(ctx, dbsqlc.NextVouNumberCounterParams{
		Entity: entity, BusinessDate: dateValue(date),
	})
	if err != nil {
		return "", "", s.writeError("allocate generated sales number", err)
	}
	id := newID()
	number := fmt.Sprintf("%s-%s-%06d", entityPrefix(entity), date.Format("20060102"), counter)
	_, err = tx.Exec(ctx, `INSERT INTO vou_documents(
		id,entity,document_no,parent_document_id,business_date,currency,total_amount_cents,
		created_by,updated_by,workflow_version,control_domain,auto_generated
	) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$8,2,'WFL',true)`,
		id, entity, number, parentID, date, currency, total, actorID)
	if err != nil {
		return "", "", s.writeError("insert generated sales document", err)
	}
	return id, number, nil
}

func (s *Service) finishAutoSalesDocument(
	ctx context.Context,
	tx pgx.Tx,
	parentID, documentID, documentNo, entity, actorID, requestID string,
	summary map[string]any,
) error {
	if err := s.linkSalesWorkflowDocument(ctx, tx, parentID, documentID, salesStage(entity)); err != nil {
		return err
	}
	summary["autoGenerated"] = true
	return insertAudit(ctx, s.queries.WithTx(tx), auditInput{
		DocumentID: documentID, Entity: entity, Event: "CREATED", To: StatusDraft,
		ActorID: actorID, RequestID: requestID, Summary: summary,
	})
}

func (s *Service) ensureAutoDeliveryDraft(
	ctx context.Context, tx pgx.Tx, outboundID, actorID, requestID string,
) (MutationResult, error) {
	var count int64
	if err := tx.QueryRow(ctx, `SELECT count(*) FROM vou_documents
		WHERE parent_document_id=$1 AND entity='sale-delivery'`, outboundID).Scan(&count); err != nil {
		return MutationResult{}, err
	}
	if count != 0 {
		return MutationResult{}, nil
	}
	var sourceNumber, status, currency, customerID, customerVersion, customerCode, customerName string
	var date time.Time
	var total int64
	err := tx.QueryRow(ctx, `SELECT d.document_no,d.status,d.business_date,d.currency,d.total_amount_cents,
		x.customer_object_id,x.customer_version_id,x.customer_code,x.customer_name
		FROM vou_documents d JOIN vou_sale_outbound_details x ON x.document_id=d.id
		WHERE d.id=$1 AND d.control_domain='WFL' FOR UPDATE OF d`, outboundID).Scan(
		&sourceNumber, &status, &date, &currency, &total,
		&customerID, &customerVersion, &customerCode, &customerName,
	)
	if err != nil {
		return MutationResult{}, err
	}
	if status != StatusApproved && status != StatusFinalized {
		return MutationResult{}, nil
	}
	id, number, err := s.insertAutoSalesDocument(
		ctx, tx, EntitySaleDelivery, outboundID, date, currency, total, actorID,
	)
	if err != nil {
		return MutationResult{}, err
	}
	if _, err = tx.Exec(ctx, `INSERT INTO vou_sale_delivery_details(
		document_id,source_outbound_id,customer_object_id,customer_version_id,customer_code,customer_name
	) VALUES($1,$2,$3,$4,$5,$6)`,
		id, outboundID, customerID, customerVersion, customerCode, customerName); err != nil {
		return MutationResult{}, s.writeError("insert generated delivery detail", err)
	}
	if err = s.finishAutoSalesDocument(
		ctx, tx, outboundID, id, number, EntitySaleDelivery, actorID, requestID,
		map[string]any{"sourceDocumentId": outboundID, "sourceDocumentNo": sourceNumber},
	); err != nil {
		return MutationResult{}, err
	}
	return MutationResult{DocumentID: id, DocumentNo: number, Status: StatusDraft, Revision: 1}, nil
}

func (s *Service) ensureAutoSignoffDraft(
	ctx context.Context, tx pgx.Tx, deliveryID, actorID, requestID string,
) (MutationResult, error) {
	var count int64
	if err := tx.QueryRow(ctx, `SELECT count(*) FROM vou_documents
		WHERE parent_document_id=$1 AND entity='sale-signoff'`, deliveryID).Scan(&count); err != nil {
		return MutationResult{}, err
	}
	if count != 0 {
		return MutationResult{}, nil
	}
	var sourceNumber, status, currency, outboundID, orderID string
	var customerID, customerVersion, customerCode, customerName string
	var warehouseID, warehouseVersion, warehouseCode, warehouseName string
	var date time.Time
	err := tx.QueryRow(ctx, `SELECT d.document_no,d.status,d.business_date,d.currency,
		x.source_outbound_id,o.source_order_id,
		x.customer_object_id,x.customer_version_id,x.customer_code,x.customer_name,
		o.warehouse_object_id,o.warehouse_version_id,o.warehouse_code,o.warehouse_name
		FROM vou_documents d
		JOIN vou_sale_delivery_details x ON x.document_id=d.id
		JOIN vou_sale_outbound_details o ON o.document_id=x.source_outbound_id
		WHERE d.id=$1 AND d.control_domain='WFL' FOR UPDATE OF d`, deliveryID).Scan(
		&sourceNumber, &status, &date, &currency, &outboundID, &orderID,
		&customerID, &customerVersion, &customerCode, &customerName,
		&warehouseID, &warehouseVersion, &warehouseCode, &warehouseName,
	)
	if err != nil {
		return MutationResult{}, err
	}
	if status != StatusApproved && status != StatusFinalized {
		return MutationResult{}, nil
	}
	type sourceLine struct {
		id, orderLineID, productID, productVersion, code, name, unit string
		lineNo                                                       int32
		quantity, price, amount                                      int64
	}
	rows, err := tx.Query(ctx, `SELECT id,source_order_line_id,line_no,
		product_object_id,product_version_id,product_code,product_name,product_unit,
		quantity_micros,unit_price_cents,line_amount_cents
		FROM vou_sale_outbound_lines WHERE document_id=$1 ORDER BY line_no`, outboundID)
	if err != nil {
		return MutationResult{}, err
	}
	defer rows.Close()
	lines := make([]sourceLine, 0)
	var total int64
	for rows.Next() {
		var line sourceLine
		if err = rows.Scan(
			&line.id, &line.orderLineID, &line.lineNo, &line.productID, &line.productVersion,
			&line.code, &line.name, &line.unit, &line.quantity, &line.price, &line.amount,
		); err != nil {
			return MutationResult{}, err
		}
		total += line.amount
		lines = append(lines, line)
	}
	if err = rows.Err(); err != nil {
		return MutationResult{}, err
	}
	id, number, err := s.insertAutoSalesDocument(
		ctx, tx, EntitySaleSignoff, deliveryID, date, currency, total, actorID,
	)
	if err != nil {
		return MutationResult{}, err
	}
	if _, err = tx.Exec(ctx, `INSERT INTO vou_sale_signoff_details(
		document_id,source_delivery_id,source_outbound_id,source_order_id,
		customer_object_id,customer_version_id,customer_code,customer_name,
		warehouse_object_id,warehouse_version_id,warehouse_code,warehouse_name
	) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
		id, deliveryID, outboundID, orderID,
		customerID, customerVersion, customerCode, customerName,
		warehouseID, warehouseVersion, warehouseCode, warehouseName); err != nil {
		return MutationResult{}, s.writeError("insert generated signoff detail", err)
	}
	for _, line := range lines {
		if _, err = tx.Exec(ctx, `INSERT INTO vou_sale_signoff_lines(
			id,document_id,source_outbound_line_id,source_order_line_id,line_no,
			product_object_id,product_version_id,product_code,product_name,product_unit,
			signed_qty_micros,rejected_qty_micros,loss_qty_micros,unit_price_cents,line_amount_cents
		) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,0,0,$12,$13)`,
			newID(), id, line.id, line.orderLineID, line.lineNo,
			line.productID, line.productVersion, line.code, line.name, line.unit,
			line.quantity, line.price, line.amount); err != nil {
			return MutationResult{}, s.writeError("insert generated signoff line", err)
		}
	}
	if err = s.finishAutoSalesDocument(
		ctx, tx, deliveryID, id, number, EntitySaleSignoff, actorID, requestID,
		map[string]any{"sourceDocumentId": deliveryID, "sourceDocumentNo": sourceNumber},
	); err != nil {
		return MutationResult{}, err
	}
	return MutationResult{DocumentID: id, DocumentNo: number, Status: StatusDraft, Revision: 1}, nil
}

func (s *Service) removeUntouchedGeneratedChildren(
	ctx context.Context, tx pgx.Tx, parentID string,
) error {
	rows, err := tx.Query(ctx, `SELECT id,entity,status,revision,auto_generated
		FROM vou_documents WHERE parent_document_id=$1 FOR UPDATE`, parentID)
	if err != nil {
		return err
	}
	type child struct {
		id, entity, status string
		revision           int64
		generated          bool
	}
	children := make([]child, 0)
	for rows.Next() {
		var value child
		if err = rows.Scan(&value.id, &value.entity, &value.status, &value.revision, &value.generated); err != nil {
			rows.Close()
			return err
		}
		children = append(children, value)
	}
	rows.Close()
	for _, value := range children {
		if !value.generated || value.status != StatusDraft || value.revision != 1 {
			return domainError(ErrorConflict, "downstream sales document has changed", nil, nil)
		}
		if err = s.deleteGeneratedSalesDocument(ctx, tx, value.id, value.entity); err != nil {
			return err
		}
	}
	return nil
}

func (s *Service) deleteGeneratedSalesDocument(
	ctx context.Context, tx pgx.Tx, documentID, entity string,
) error {
	if _, err := tx.Exec(ctx, `DELETE FROM wfl_process_documents WHERE document_id=$1`, documentID); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `DELETE FROM vou_audit_events WHERE document_id=$1`, documentID); err != nil {
		return err
	}
	switch entity {
	case EntitySaleOutbound:
		if _, err := tx.Exec(ctx, `DELETE FROM vou_sale_outbound_lines WHERE document_id=$1`, documentID); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `DELETE FROM vou_sale_outbound_details WHERE document_id=$1`, documentID); err != nil {
			return err
		}
	case EntitySaleDelivery:
		if _, err := tx.Exec(ctx, `DELETE FROM vou_sale_delivery_details WHERE document_id=$1`, documentID); err != nil {
			return err
		}
	case EntitySaleSignoff:
		if _, err := tx.Exec(ctx, `DELETE FROM vou_sale_signoff_lines WHERE document_id=$1`, documentID); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `DELETE FROM vou_sale_signoff_details WHERE document_id=$1`, documentID); err != nil {
			return err
		}
	}
	_, err := tx.Exec(ctx, `DELETE FROM vou_documents WHERE id=$1`, documentID)
	return err
}

func (s *Service) replenishManagedOutbound(
	ctx context.Context,
	tx pgx.Tx,
	document dbsqlc.VouDocument,
	actorID, requestID string,
) error {
	if !managedSalesDocument(document) {
		return nil
	}
	var orderID string
	switch document.Entity {
	case EntitySaleOutbound:
		if err := tx.QueryRow(ctx, `SELECT source_order_id FROM vou_sale_outbound_details
			WHERE document_id=$1`, document.ID).Scan(&orderID); err != nil {
			return err
		}
	case EntitySaleSignoff:
		if err := tx.QueryRow(ctx, `SELECT source_order_id FROM vou_sale_signoff_details
			WHERE document_id=$1`, document.ID).Scan(&orderID); err != nil {
			return err
		}
	default:
		return nil
	}
	_, err := s.ensureAutoOutboundDraft(ctx, tx, orderID, actorID, requestID)
	return err
}

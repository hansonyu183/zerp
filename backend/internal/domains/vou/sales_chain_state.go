package vou

import (
	"context"

	dbsqlc "github.com/hansonyu183/zerp/backend/internal/database/sqlc"
	"github.com/jackc/pgx/v5"
)

func (s *Service) loadSalesChainData(
	ctx context.Context, document dbsqlc.VouDocument, data DocumentDataView,
) (DocumentDataView, error) {
	switch document.Entity {
	case EntitySaleOutbound:
		var sourceID, sourceNo string
		var customer ReferenceView
		var warehouse ReferenceView
		err := s.pool.QueryRow(ctx, `SELECT x.source_order_id,p.document_no,
			x.customer_object_id,x.customer_version_id,x.customer_code,x.customer_name,
			COALESCE(x.warehouse_object_id,''),COALESCE(x.warehouse_version_id,''),
			COALESCE(x.warehouse_code,''),COALESCE(x.warehouse_name,'')
			FROM vou_sale_outbound_details x JOIN vou_documents p ON p.id=x.source_order_id
			WHERE x.document_id=$1`, document.ID).Scan(
			&sourceID, &sourceNo,
			&customer.ObjectID, &customer.VersionID, &customer.Code, &customer.Name,
			&warehouse.ObjectID, &warehouse.VersionID, &warehouse.Code, &warehouse.Name)
		if err != nil {
			return data, err
		}
		customer.Entity, warehouse.Entity = "customer", "warehouse"
		data.Customer = &customer
		if warehouse.ObjectID != "" {
			data.Warehouse = &warehouse
		}
		rows, err := s.pool.Query(ctx, `SELECT id,source_order_line_id,line_no,
			product_object_id,product_version_id,product_code,product_name,product_unit,
			quantity_micros,unit_price_cents,line_amount_cents,remark
			FROM vou_sale_outbound_lines WHERE document_id=$1 ORDER BY line_no`, document.ID)
		if err != nil {
			return data, err
		}
		defer rows.Close()
		for rows.Next() {
			var line ProductLineView
			var quantity, price, amount int64
			var remark *string
			if err = rows.Scan(
				&line.LineID, &line.SourceLineID, &line.LineNo,
				&line.Product.ObjectID, &line.Product.VersionID, &line.Product.Code,
				&line.Product.Name, &line.Product.Unit, &quantity, &price, &amount, &remark,
			); err != nil {
				return data, err
			}
			line.Product.Entity = "product"
			line.Quantity = formatQuantity(quantity)
			line.OrderedQuantity = line.Quantity
			line.UnitPrice, line.LineAmount, line.Remark = formatMoney(price), formatMoney(amount), deref(remark)
			data.ProductLines = append(data.ProductLines, line)
		}
		return data, rows.Err()
	case EntitySaleDelivery:
		var sourceID, sourceNo string
		var customer ReferenceView
		var platform ReferenceView
		var vehicle ReferenceView
		err := s.pool.QueryRow(ctx, `SELECT x.source_outbound_id,p.document_no,
			x.customer_object_id,x.customer_version_id,x.customer_code,x.customer_name,
			COALESCE(x.platform_object_id,''),COALESCE(x.platform_version_id,''),
			COALESCE(x.platform_code,''),COALESCE(x.platform_name,''),
			COALESCE(x.vehicle_object_id,''),COALESCE(x.vehicle_version_id,''),
			COALESCE(x.vehicle_code,''),COALESCE(x.vehicle_name,''),
			COALESCE(x.vehicle_plate_number,'')
			FROM vou_sale_delivery_details x JOIN vou_documents p ON p.id=x.source_outbound_id
			WHERE x.document_id=$1`, document.ID).Scan(
			&sourceID, &sourceNo,
			&customer.ObjectID, &customer.VersionID, &customer.Code, &customer.Name,
			&platform.ObjectID, &platform.VersionID, &platform.Code, &platform.Name,
			&vehicle.ObjectID, &vehicle.VersionID, &vehicle.Code, &vehicle.Name, &vehicle.PlateNumber)
		if err != nil {
			return data, err
		}
		customer.Entity, platform.Entity, vehicle.Entity = "customer", "supplier", "vehicle"
		data.Customer = &customer
		if platform.ObjectID != "" {
			data.Platform = &platform
		}
		if vehicle.ObjectID != "" {
			data.Vehicle = &vehicle
		}
		rows, err := s.pool.Query(ctx, `SELECT id,source_order_line_id,line_no,
			product_object_id,product_version_id,product_code,product_name,product_unit,
			quantity_micros,unit_price_cents,line_amount_cents,remark
			FROM vou_sale_outbound_lines WHERE document_id=$1 ORDER BY line_no`, sourceID)
		if err != nil {
			return data, err
		}
		defer rows.Close()
		for rows.Next() {
			var line ProductLineView
			var quantity, price, amount int64
			var remark *string
			if err = rows.Scan(
				&line.LineID, &line.SourceLineID, &line.LineNo,
				&line.Product.ObjectID, &line.Product.VersionID, &line.Product.Code,
				&line.Product.Name, &line.Product.Unit, &quantity, &price, &amount, &remark,
			); err != nil {
				return data, err
			}
			line.Product.Entity = "product"
			line.Quantity, line.OrderedQuantity = formatQuantity(quantity), formatQuantity(quantity)
			line.UnitPrice, line.LineAmount, line.Remark = formatMoney(price), formatMoney(amount), deref(remark)
			data.ProductLines = append(data.ProductLines, line)
		}
		return data, rows.Err()
	case EntitySaleSignoff:
		var sourceID, sourceNo string
		var customer ReferenceView
		var warehouse ReferenceView
		err := s.pool.QueryRow(ctx, `SELECT x.source_delivery_id,p.document_no,
			x.customer_object_id,x.customer_version_id,x.customer_code,x.customer_name,
			x.warehouse_object_id,x.warehouse_version_id,x.warehouse_code,x.warehouse_name
			FROM vou_sale_signoff_details x JOIN vou_documents p ON p.id=x.source_delivery_id
			WHERE x.document_id=$1`, document.ID).Scan(
			&sourceID, &sourceNo,
			&customer.ObjectID, &customer.VersionID, &customer.Code, &customer.Name,
			&warehouse.ObjectID, &warehouse.VersionID, &warehouse.Code, &warehouse.Name)
		if err != nil {
			return data, err
		}
		customer.Entity, warehouse.Entity = "customer", "warehouse"
		data.Customer, data.Warehouse = &customer, &warehouse
		rows, err := s.pool.Query(ctx, `SELECT id,source_outbound_line_id,line_no,
			product_object_id,product_version_id,product_code,product_name,product_unit,
			signed_qty_micros,rejected_qty_micros,loss_qty_micros,unit_price_cents,line_amount_cents,remark,
			signed_qty_micros+rejected_qty_micros+loss_qty_micros
			FROM vou_sale_signoff_lines WHERE document_id=$1 ORDER BY line_no`, document.ID)
		if err != nil {
			return data, err
		}
		defer rows.Close()
		for rows.Next() {
			var line SaleSignoffLineView
			var signed, rejected, loss, price, amount, outbound int64
			var remark *string
			if err = rows.Scan(
				&line.LineID, &line.SourceLineID, &line.LineNo,
				&line.Product.ObjectID, &line.Product.VersionID, &line.Product.Code,
				&line.Product.Name, &line.Product.Unit, &signed, &rejected, &loss,
				&price, &amount, &remark, &outbound,
			); err != nil {
				return data, err
			}
			line.Product.Entity = "product"
			line.OutboundQuantity, line.SignedQuantity = formatQuantity(outbound), formatQuantity(signed)
			line.RejectedQuantity, line.LossQuantity = formatQuantity(rejected), formatQuantity(loss)
			line.UnitPrice, line.LineAmount, line.Remark = formatMoney(price), formatMoney(amount), deref(remark)
			data.SignoffLines = append(data.SignoffLines, line)
		}
		return data, rows.Err()
	default:
		return data, domainError(ErrorValidation, "invalid sales-chain entity", nil, nil)
	}
}

func (s *Service) setSaleOrderBalances(
	ctx context.Context, orderID string, data *DocumentDataView,
) error {
	rows, err := s.pool.Query(ctx, `SELECT l.id,l.ordered_qty_micros,
		COALESCE(sum(CASE WHEN sd.status='FINALIZED' THEN sl.signed_qty_micros ELSE 0 END),0)::bigint,
		COALESCE(sum(CASE WHEN od.status='FINALIZED' AND (sd.id IS NULL OR sd.status<>'FINALIZED')
			THEN ol.quantity_micros ELSE 0 END),0)::bigint
		FROM vou_product_lines l
		LEFT JOIN vou_sale_outbound_lines ol ON ol.source_order_line_id=l.id
		LEFT JOIN vou_documents od ON od.id=ol.document_id
		LEFT JOIN vou_sale_signoff_lines sl ON sl.source_outbound_line_id=ol.id
		LEFT JOIN vou_documents sd ON sd.id=sl.document_id
		WHERE l.document_id=$1 GROUP BY l.id,l.ordered_qty_micros`, orderID)
	if err != nil {
		return err
	}
	defer rows.Close()
	byID := map[string][3]int64{}
	var totalSigned, totalTransit, totalRemaining int64
	for rows.Next() {
		var id string
		var ordered, signed, transit int64
		if err = rows.Scan(&id, &ordered, &signed, &transit); err != nil {
			return err
		}
		remaining := ordered - signed - transit
		if remaining < 0 {
			remaining = 0
		}
		byID[id] = [3]int64{signed, transit, remaining}
		totalSigned += signed
		totalTransit += transit
		totalRemaining += remaining
	}
	if err = rows.Err(); err != nil {
		return err
	}
	for index := range data.ProductLines {
		balance := byID[data.ProductLines[index].LineID]
		data.ProductLines[index].SignedQuantity = formatQuantity(balance[0])
		data.ProductLines[index].OutboundQuantity = formatQuantity(balance[1])
		data.ProductLines[index].AvailableQuantity = formatQuantity(balance[2])
	}
	data.SignedQuantity = formatQuantity(totalSigned)
	data.InTransitQuantity = formatQuantity(totalTransit)
	data.RemainingQuantity = formatQuantity(totalRemaining)
	return nil
}

func (s *Service) validateSalesChainStored(
	ctx context.Context, entity, documentID string,
) error {
	var sourceStatus string
	var lineCount int64
	complete := false
	switch entity {
	case EntitySaleOutbound:
		err := s.pool.QueryRow(ctx, `SELECT p.status,
			(SELECT count(*) FROM vou_sale_outbound_lines WHERE document_id=x.document_id),
			x.warehouse_object_id IS NOT NULL
			FROM vou_sale_outbound_details x JOIN vou_documents p ON p.id=x.source_order_id
			WHERE x.document_id=$1`, documentID).
			Scan(&sourceStatus, &lineCount, &complete)
		if err != nil {
			return s.internal("validate sale outbound", err)
		}
	case EntitySaleDelivery:
		err := s.pool.QueryRow(ctx, `SELECT p.status,1,
			x.platform_object_id IS NOT NULL AND x.vehicle_object_id IS NOT NULL
			FROM vou_sale_delivery_details x
			JOIN vou_documents p ON p.id=x.source_outbound_id WHERE x.document_id=$1`,
			documentID).Scan(&sourceStatus, &lineCount, &complete)
		if err != nil {
			return s.internal("validate sale delivery", err)
		}
	case EntitySaleSignoff:
		err := s.pool.QueryRow(ctx, `SELECT p.status,
			(SELECT count(*) FROM vou_sale_signoff_lines WHERE document_id=x.document_id),true
			FROM vou_sale_signoff_details x JOIN vou_documents p ON p.id=x.source_delivery_id
			WHERE x.document_id=$1`, documentID).
			Scan(&sourceStatus, &lineCount, &complete)
		if err != nil {
			return s.internal("validate sale signoff", err)
		}
	}
	sourceReady := sourceStatus == StatusApproved || sourceStatus == StatusFinalized
	if !sourceReady || lineCount == 0 || !complete {
		return domainError(ErrorConflict, "sales-chain source is not ready", nil, nil)
	}
	return nil
}

func (s *Service) prepareSalesChainFinalization(
	ctx context.Context, tx pgx.Tx, document dbsqlc.VouDocument,
) (map[string]any, error) {
	if document.Entity == EntitySaleOutbound {
		var orderID, fulfillment string
		if err := tx.QueryRow(ctx, `SELECT x.source_order_id,o.fulfillment_status
			FROM vou_sale_outbound_details x JOIN vou_sale_order_details o ON o.document_id=x.source_order_id
			JOIN vou_documents d ON d.id=x.source_order_id
			WHERE x.document_id=$1 AND d.status='FINALIZED' FOR UPDATE OF d`,
			document.ID).Scan(&orderID, &fulfillment); err != nil {
			return nil, domainError(ErrorConflict, "sale order is not finalized", nil, err)
		}
		if fulfillment == "FULFILLED" || fulfillment == "SHORT_CLOSED" {
			return nil, domainError(ErrorConflict, "sale order is closed", nil, nil)
		}
		rows, err := tx.Query(ctx, `SELECT ol.source_order_line_id,ol.quantity_micros,l.ordered_qty_micros,
			COALESCE((SELECT sum(sl.signed_qty_micros) FROM vou_sale_signoff_lines sl
				JOIN vou_documents sd ON sd.id=sl.document_id AND sd.status='FINALIZED'
				WHERE sl.source_order_line_id=l.id),0)::bigint,
			COALESCE((SELECT sum(other.quantity_micros) FROM vou_sale_outbound_lines other
				JOIN vou_documents od ON od.id=other.document_id AND od.status='FINALIZED'
				LEFT JOIN vou_sale_signoff_lines sl2 ON sl2.source_outbound_line_id=other.id
				LEFT JOIN vou_documents sd2 ON sd2.id=sl2.document_id
				WHERE other.source_order_line_id=l.id
				AND (sd2.id IS NULL OR sd2.status<>'FINALIZED')),0)::bigint
			FROM vou_sale_outbound_lines ol JOIN vou_product_lines l ON l.id=ol.source_order_line_id
			WHERE ol.document_id=$1`, document.ID)
		if err != nil {
			return nil, err
		}
		defer rows.Close()
		for rows.Next() {
			var lineID string
			var quantity, ordered, signed, transit int64
			if err = rows.Scan(&lineID, &quantity, &ordered, &signed, &transit); err != nil {
				return nil, err
			}
			if quantity > ordered-signed-transit {
				return nil, domainError(ErrorConflict, "outbound quantity exceeds available order quantity",
					map[string]any{"sourceLineId": lineID}, nil)
			}
		}
		if err = rows.Err(); err != nil {
			return nil, err
		}
		return map[string]any{"parentDocumentId": orderID}, nil
	}
	var sourceStatus string
	if err := tx.QueryRow(ctx, `SELECT p.status FROM vou_documents d
		JOIN vou_documents p ON p.id=d.parent_document_id
		WHERE d.id=$1 FOR UPDATE OF p`, document.ID).Scan(&sourceStatus); err != nil ||
		sourceStatus != StatusFinalized {
		return nil, domainError(ErrorConflict, "sales-chain source is not finalized", nil, err)
	}
	return map[string]any{"parentDocumentId": document.ParentDocumentID}, nil
}

func (s *Service) ensureNoSalesChainChildren(
	ctx context.Context, tx pgx.Tx, document dbsqlc.VouDocument,
) error {
	if document.Entity != EntitySaleOrder && document.Entity != EntitySaleOutbound &&
		document.Entity != EntitySaleDelivery {
		return nil
	}
	var count int64
	if err := tx.QueryRow(ctx, `SELECT count(*) FROM vou_documents WHERE parent_document_id=$1`,
		document.ID).Scan(&count); err != nil {
		return err
	}
	if count != 0 {
		return domainError(ErrorConflict, "downstream sales document exists", nil, nil)
	}
	return nil
}

func (s *Service) refreshSaleOrderFulfillment(
	ctx context.Context, tx pgx.Tx, signoffID, actorID string,
) error {
	var orderID, current string
	if err := tx.QueryRow(ctx, `SELECT x.source_order_id,o.fulfillment_status
		FROM vou_sale_signoff_details x JOIN vou_sale_order_details o ON o.document_id=x.source_order_id
		WHERE x.document_id=$1 FOR UPDATE OF o`, signoffID).Scan(&orderID, &current); err != nil {
		return err
	}
	var remaining int64
	err := tx.QueryRow(ctx, `SELECT COALESCE(sum(GREATEST(l.ordered_qty_micros -
		COALESCE((SELECT sum(sl.signed_qty_micros) FROM vou_sale_signoff_lines sl
			JOIN vou_documents sd ON sd.id=sl.document_id AND sd.status='FINALIZED'
			WHERE sl.source_order_line_id=l.id),0),0)),0)::bigint
		FROM vou_product_lines l WHERE l.document_id=$1`, orderID).Scan(&remaining)
	if err != nil {
		return err
	}
	next := current
	if current == "OPEN" && remaining == 0 {
		next = "FULFILLED"
	}
	if current == "FULFILLED" && remaining > 0 {
		next = "OPEN"
	}
	if next != current {
		_, err = tx.Exec(ctx, `UPDATE vou_sale_order_details SET fulfillment_status=$1 WHERE document_id=$2`,
			next, orderID)
		if err == nil {
			_, err = tx.Exec(ctx, `UPDATE vou_documents SET revision=revision+1,updated_at=now(),updated_by=$1
				WHERE id=$2`, actorID, orderID)
		}
	}
	return err
}

func (s *Service) Delete(
	ctx context.Context, entity string, input DeleteInput, actorID, requestID string,
) (MutationResult, error) {
	if entity == EntityPurchaseInbound {
		return s.DeletePurchaseInbound(ctx, input, actorID, requestID)
	}
	if !validEntity(entity) {
		return MutationResult{}, domainError(ErrorValidation, "invalid entity", nil, nil)
	}
	reason, err := validateReverse(input)
	if err != nil {
		return MutationResult{}, err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return MutationResult{}, s.internal("begin delete draft", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	var number, status string
	var parentID *string
	var revision int64
	err = tx.QueryRow(ctx, `SELECT document_no,status,revision,parent_document_id
		FROM vou_documents WHERE id=$1 AND entity=$2 FOR UPDATE`,
		input.DocumentID, entity).Scan(&number, &status, &revision, &parentID)
	if err = documentWriteConflict(err, revision, input.Revision, status, StatusDraft); err != nil {
		return MutationResult{}, err
	}
	if entity == EntitySaleReturn {
		var kind string
		if err = tx.QueryRow(ctx, `SELECT return_kind FROM vou_sale_return_details
			WHERE document_id=$1`, input.DocumentID).Scan(&kind); err != nil {
			return MutationResult{}, err
		}
		if kind == returnKindRefusal {
			return MutationResult{}, domainError(ErrorConflict, "automatic refusal return cannot be deleted", nil, nil)
		}
	}
	var attachments, children int64
	if err = tx.QueryRow(ctx, `SELECT
		(SELECT count(*) FROM vou_document_attachments WHERE document_id=$1),
		(SELECT count(*) FROM vou_documents WHERE parent_document_id=$1)`,
		input.DocumentID).Scan(&attachments, &children); err != nil {
		return MutationResult{}, err
	}
	if attachments != 0 || children != 0 {
		return MutationResult{}, domainError(ErrorConflict, "draft has attachments or child documents", nil, nil)
	}
	parentDocumentID := ""
	if parentID != nil {
		parentDocumentID = *parentID
	}
	if err = s.events.Publish(ctx, tx, DocumentDeletedEvent{
		Entity: entity, DocumentID: input.DocumentID, DocumentNo: number,
		ParentDocumentID: parentDocumentID, ActorID: actorID,
		RequestID: requestID, Reason: *reason,
	}); err != nil {
		return MutationResult{}, err
	}
	if _, err = tx.Exec(ctx, `DELETE FROM vou_audit_events WHERE document_id=$1`, input.DocumentID); err != nil {
		return MutationResult{}, err
	}
	switch entity {
	case EntitySaleOrder:
		_, err = tx.Exec(ctx, `DELETE FROM vou_product_lines WHERE document_id=$1;
			DELETE FROM vou_sale_order_details WHERE document_id=$1`, input.DocumentID)
	case EntitySaleOutbound:
		_, err = tx.Exec(ctx, `DELETE FROM vou_sale_outbound_lines WHERE document_id=$1;
			DELETE FROM vou_sale_outbound_details WHERE document_id=$1`, input.DocumentID)
	case EntitySaleDelivery:
		_, err = tx.Exec(ctx, `DELETE FROM vou_sale_delivery_details WHERE document_id=$1`, input.DocumentID)
	case EntitySaleSignoff:
		_, err = tx.Exec(ctx, `DELETE FROM vou_sale_signoff_lines WHERE document_id=$1;
			DELETE FROM vou_sale_signoff_details WHERE document_id=$1`, input.DocumentID)
	case EntitySaleReturn:
		if _, err = tx.Exec(ctx, `DELETE FROM vou_sale_return_lines WHERE document_id=$1`,
			input.DocumentID); err == nil {
			_, err = tx.Exec(ctx, `DELETE FROM vou_sale_return_details WHERE document_id=$1`,
				input.DocumentID)
		}
	case EntityPurchaseOrder:
		_, err = tx.Exec(ctx, `DELETE FROM vou_product_lines WHERE document_id=$1;
			DELETE FROM vou_purchase_order_details WHERE document_id=$1`, input.DocumentID)
	case EntityReceipt:
		_, err = tx.Exec(ctx, `DELETE FROM vou_receipt_details WHERE document_id=$1`, input.DocumentID)
	case EntityPayment:
		_, err = tx.Exec(ctx, `DELETE FROM vou_payment_details WHERE document_id=$1`, input.DocumentID)
	case EntityExpenseReimbursement:
		_, err = tx.Exec(ctx, `DELETE FROM vou_expense_lines WHERE document_id=$1;
			DELETE FROM vou_expense_reimbursement_details WHERE document_id=$1`, input.DocumentID)
	case EntityOtherIncome:
		_, err = tx.Exec(ctx, `DELETE FROM vou_other_income_details WHERE document_id=$1`, input.DocumentID)
	}
	if err != nil {
		return MutationResult{}, err
	}
	if _, err = tx.Exec(ctx, `DELETE FROM vou_documents WHERE id=$1`, input.DocumentID); err != nil {
		return MutationResult{}, err
	}
	if parentID != nil {
		var parentEntity, parentStatus string
		if err = tx.QueryRow(ctx, `UPDATE vou_documents SET revision=revision+1,updated_at=now(),updated_by=$1
			WHERE id=$2 RETURNING entity,status`, actorID, *parentID).Scan(&parentEntity, &parentStatus); err != nil {
			return MutationResult{}, err
		}
		if err = insertAudit(ctx, s.queries.WithTx(tx), auditInput{
			DocumentID: *parentID, Entity: parentEntity, Event: "DELETED",
			From: &parentStatus, To: parentStatus, ActorID: actorID, Reason: reason, RequestID: requestID,
			Summary: map[string]any{"documentId": input.DocumentID, "documentNo": number, "entity": entity},
		}); err != nil {
			return MutationResult{}, err
		}
		if entity == EntitySaleReturn {
			root, loadErr := s.queries.WithTx(tx).GetVouDocument(
				ctx, dbsqlc.GetVouDocumentParams{ID: *parentID, Entity: EntitySaleOrder},
			)
			if loadErr != nil {
				return MutationResult{}, loadErr
			}
			if err = s.touchSalesWorkflow(
				ctx, tx, root, "RETURN_DELETED", root.Status, actorID, requestID, nil,
			); err != nil {
				return MutationResult{}, err
			}
		}
	}
	if err = tx.Commit(ctx); err != nil {
		return MutationResult{}, err
	}
	return MutationResult{
		DocumentID: input.DocumentID, DocumentNo: number, Status: "DELETED", Revision: revision + 1,
	}, nil
}

func (s *Service) shortCloseMutation(
	ctx context.Context,
	inputRevision DocumentRevisionInput,
	reason *string,
	actorID, requestID, expected, next, event string,
	requireDifferentActor bool,
) (MutationResult, error) {
	if err := validateDocumentRevision(inputRevision.DocumentID, inputRevision.Revision); err != nil {
		return MutationResult{}, err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return MutationResult{}, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	q := s.queries.WithTx(tx)
	document, err := q.LockVouDocument(ctx, dbsqlc.LockVouDocumentParams{
		ID: inputRevision.DocumentID, Entity: EntitySaleOrder,
	})
	if err = documentWriteConflict(
		err, document.Revision, inputRevision.Revision, document.Status, StatusFinalized,
	); err != nil {
		return MutationResult{}, err
	}
	var current, requestedBy string
	var currentReason *string
	if err = tx.QueryRow(ctx, `SELECT fulfillment_status,COALESCE(short_close_requested_by,''),short_close_reason
		FROM vou_sale_order_details WHERE document_id=$1 FOR UPDATE`, document.ID).
		Scan(&current, &requestedBy, &currentReason); err != nil {
		return MutationResult{}, err
	}
	if current != expected || (requireDifferentActor && requestedBy == actorID) {
		return MutationResult{}, domainError(ErrorConflict, "order cannot perform short-close action", nil, nil)
	}
	if event == "SHORT_CLOSE_REQUESTED" {
		var inTransit int64
		if err = tx.QueryRow(ctx, `SELECT COALESCE(sum(ol.quantity_micros),0)::bigint
			FROM vou_sale_outbound_lines ol
			JOIN vou_documents od ON od.id=ol.document_id AND od.status='FINALIZED'
			LEFT JOIN vou_sale_signoff_lines sl ON sl.source_outbound_line_id=ol.id
			LEFT JOIN vou_documents sd ON sd.id=sl.document_id
			WHERE ol.source_order_line_id IN (
				SELECT id FROM vou_product_lines WHERE document_id=$1)
			AND (sd.id IS NULL OR sd.status<>'FINALIZED')`, document.ID).Scan(&inTransit); err != nil {
			return MutationResult{}, err
		}
		if inTransit != 0 {
			return MutationResult{}, domainError(ErrorConflict, "order still has in-transit quantity", nil, nil)
		}
		var pendingReturns bool
		if err = tx.QueryRow(ctx, `SELECT EXISTS(
			SELECT 1 FROM vou_sale_return_details r
			JOIN vou_documents d ON d.id=r.document_id
			WHERE r.source_order_id=$1 AND d.status<>'FINALIZED'
		)`, document.ID).Scan(&pendingReturns); err != nil {
			return MutationResult{}, err
		}
		if pendingReturns {
			return MutationResult{}, domainError(ErrorConflict, "order has unfinished return documents", nil, nil)
		}
	}
	requester, storedReason := requestedBy, currentReason
	switch event {
	case "SHORT_CLOSE_REQUESTED":
		requester, storedReason = actorID, reason
	case "SHORT_CLOSE_CANCELLED", "SHORT_CLOSE_REOPENED":
		requester, storedReason = "", nil
	}
	var revision int64
	_, err = tx.Exec(ctx, `UPDATE vou_sale_order_details SET fulfillment_status=$1,
		short_close_requested_by=NULLIF($2,''),short_close_reason=$3 WHERE document_id=$4`,
		next, requester, storedReason, document.ID)
	if err == nil {
		err = tx.QueryRow(ctx, `UPDATE vou_documents SET revision=revision+1,updated_at=now(),updated_by=$1
			WHERE id=$2 RETURNING revision`, actorID, document.ID).Scan(&revision)
	}
	if err != nil {
		return MutationResult{}, err
	}
	if err = insertAudit(ctx, q, auditInput{
		DocumentID: document.ID, Entity: EntitySaleOrder, Event: event,
		From: stringPtr(StatusFinalized), To: StatusFinalized, ActorID: actorID,
		Reason: reason, RequestID: requestID,
		Summary: map[string]any{"fulfillmentStatus": next},
	}); err != nil {
		return MutationResult{}, err
	}
	if err = s.touchWorkflow(
		ctx, tx, document, event, StatusFinalized, actorID, requestID,
		map[string]any{"fulfillmentStatus": next},
	); err != nil {
		return MutationResult{}, err
	}
	if err = tx.Commit(ctx); err != nil {
		return MutationResult{}, err
	}
	return mutation(document, StatusFinalized, revision), nil
}

func (s *Service) ShortCloseRequest(
	ctx context.Context, input ReverseInput, actorID, requestID string,
) (MutationResult, error) {
	reason, err := validateReverse(input)
	if err != nil {
		return MutationResult{}, err
	}
	return s.shortCloseMutation(ctx, DocumentRevisionInput{
		DocumentID: input.DocumentID, Revision: input.Revision,
	}, reason, actorID, requestID, "OPEN", "SHORT_CLOSE_REQUESTED", "SHORT_CLOSE_REQUESTED", false)
}

func (s *Service) ShortCloseCancel(
	ctx context.Context, input ReverseInput, actorID, requestID string,
) (MutationResult, error) {
	reason, err := validateReverse(input)
	if err != nil {
		return MutationResult{}, err
	}
	return s.shortCloseMutation(ctx, DocumentRevisionInput{
		DocumentID: input.DocumentID, Revision: input.Revision,
	}, reason, actorID, requestID, "SHORT_CLOSE_REQUESTED", "OPEN", "SHORT_CLOSE_CANCELLED", false)
}

func (s *Service) ShortCloseConfirm(
	ctx context.Context, input DocumentRevisionInput, actorID, requestID string,
) (MutationResult, error) {
	return s.shortCloseMutation(
		ctx, input, nil, actorID, requestID,
		"SHORT_CLOSE_REQUESTED", "SHORT_CLOSED", "SHORT_CLOSED", true,
	)
}

func (s *Service) ShortCloseUnconfirm(
	ctx context.Context, input ReverseInput, actorID, requestID string,
) (MutationResult, error) {
	reason, err := validateReverse(input)
	if err != nil {
		return MutationResult{}, err
	}
	return s.shortCloseMutation(ctx, DocumentRevisionInput{
		DocumentID: input.DocumentID, Revision: input.Revision,
	}, reason, actorID, requestID, "SHORT_CLOSED", "OPEN", "SHORT_CLOSE_REOPENED", false)
}

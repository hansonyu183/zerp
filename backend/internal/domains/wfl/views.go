package wfl

import (
	"context"
	"errors"
	"time"

	voudomain "github.com/hansonyu183/zerp-back/internal/domains/vou"
	"github.com/jackc/pgx/v5"
)

type queryer interface {
	Query(context.Context, string, ...any) (pgx.Rows, error)
	QueryRow(context.Context, string, ...any) pgx.Row
}

func (s *Service) loadDocuments(ctx context.Context, processID string, permissions []string) ([]DocumentSummary, error) {
	rows, err := s.pool.Query(ctx, `SELECT d.id,d.document_no,d.entity,l.stage,d.status,d.revision,
		COALESCE(d.parent_document_id,''),d.business_date,d.currency,d.total_amount_cents,
		COALESCE(d.remark,''),d.created_at,d.created_by,d.reviewed_at,d.reviewed_by,d.approved_at,d.approved_by
		FROM wfl_process_documents l JOIN vou_documents d ON d.id=l.document_id
		WHERE l.process_id=$1 ORDER BY
		CASE l.stage WHEN 'CUSTOMER_ORDER' THEN 1 WHEN 'PROCUREMENT' THEN 2 WHEN 'RECEIPT' THEN 3
		WHEN 'DELIVERY' THEN 4 ELSE 5 END,l.sequence_no`, processID)
	if err != nil {
		return nil, internal("load workflow documents", err)
	}
	defer rows.Close()
	result := []DocumentSummary{}
	for rows.Next() {
		var item DocumentSummary
		var status string
		var businessDate time.Time
		var amount int64
		var remark string
		if err = rows.Scan(&item.DocumentID, &item.DocumentNo, &item.Entity, &item.Stage, &status,
			&item.Revision, &item.ParentDocumentID, &businessDate, &item.Currency, &amount, &remark, &item.CreatedAt,
			&item.CreatedBy, &item.ReviewedAt, &item.ReviewedBy, &item.ApprovedAt, &item.ApprovedBy); err != nil {
			return nil, err
		}
		item.Status = semanticStatus(item.Stage, status)
		item.BusinessDate = businessDate.Format("2006-01-02")
		item.Amount = formatFixed(amount, 2)
		if item.Stage != StageProcurement || hasPermission(permissions, "/wfl/intermediary-trade/procurement-get") {
			item.Data, item.Lines, err = loadDocumentBody(ctx, s.pool, item, remark)
			if err != nil {
				return nil, err
			}
			item.Attachments, err = loadAttachments(ctx, s.pool, item.DocumentID)
			if err != nil {
				return nil, err
			}
		} else {
			item.Attachments = []voudomain.AttachmentView{}
		}
		result = append(result, item)
	}
	return result, rows.Err()
}

func loadAttachments(ctx context.Context, q queryer, documentID string) ([]voudomain.AttachmentView, error) {
	rows, err := q.Query(ctx, `SELECT f.id,f.original_name,f.content_type,f.declared_size,
		f.sha256_hex,f.status,f.stored_at,a.created_at,a.created_by
		FROM vou_document_attachments a JOIN vou_files f ON f.id=a.file_id
		WHERE a.document_id=$1 ORDER BY a.created_at,f.id`, documentID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []voudomain.AttachmentView{}
	for rows.Next() {
		var item voudomain.AttachmentView
		if err = rows.Scan(&item.FileID, &item.FileName, &item.ContentType, &item.Size, &item.SHA256,
			&item.Status, &item.StoredAt, &item.CreatedAt, &item.CreatedBy); err != nil {
			return nil, err
		}
		result = append(result, item)
	}
	return result, rows.Err()
}

func loadDocumentBody(ctx context.Context, q queryer, item DocumentSummary, remark string) (any, any, error) {
	data := map[string]any{}
	lines := []map[string]any{}
	switch item.Entity {
	case voudomain.EntityCustomerOrder:
		var customerID, customerVersion, customerCode, customerName string
		var salespersonID, salespersonVersion, salespersonCode, salespersonName string
		var contact, phone, address *string
		var settlementID, settlementVersion, settlementCode, settlementName, rule string
		var monthOffset, dayOffset int32
		var dayOfMonth *int32
		err := q.QueryRow(ctx, `SELECT customer_object_id,customer_version_id,customer_code,customer_name,
			salesperson_object_id,salesperson_version_id,salesperson_code,salesperson_name,
			contact_name,contact_phone,delivery_address,settlement_object_id,settlement_version_id,
			settlement_code,settlement_name,settlement_rule_type,settlement_month_offset,
			settlement_day_of_month,settlement_day_offset FROM vou_customer_order_details WHERE document_id=$1`,
			item.DocumentID).Scan(&customerID, &customerVersion, &customerCode, &customerName,
			&salespersonID, &salespersonVersion, &salespersonCode, &salespersonName, &contact, &phone,
			&address, &settlementID, &settlementVersion, &settlementCode, &settlementName, &rule,
			&monthOffset, &dayOfMonth, &dayOffset)
		if err != nil {
			return nil, nil, err
		}
		data = map[string]any{
			"customer":    map[string]any{"objectId": customerID, "versionId": customerVersion, "code": customerCode, "name": customerName},
			"salesperson": map[string]any{"objectId": salespersonID, "versionId": salespersonVersion, "code": salespersonCode, "name": salespersonName},
			"contactName": contact, "contactPhone": phone, "deliveryAddress": address, "remark": remark,
			"settlementMethod": map[string]any{"objectId": settlementID, "versionId": settlementVersion, "code": settlementCode,
				"name": settlementName, "ruleType": rule, "monthOffset": monthOffset, "dayOfMonth": dayOfMonth, "dayOffset": dayOffset},
		}
		rows, queryErr := q.Query(ctx, `SELECT id,line_no,product_object_id,product_version_id,product_code,
			product_name,product_unit,ordered_qty_micros,sale_unit_price_cents,line_amount_cents,
			container_type,quantity_per_container_micros,remark FROM vou_customer_order_lines
			WHERE document_id=$1 ORDER BY line_no`, item.DocumentID)
		if queryErr != nil {
			return nil, nil, queryErr
		}
		defer rows.Close()
		for rows.Next() {
			var id, objectID, versionID, code, name, unit, kind string
			var lineNo int32
			var quantity, price, amount int64
			var per *int64
			var remark *string
			if err = rows.Scan(&id, &lineNo, &objectID, &versionID, &code, &name, &unit, &quantity,
				&price, &amount, &kind, &per, &remark); err != nil {
				return nil, nil, err
			}
			line := map[string]any{"lineId": id, "lineNo": lineNo,
				"product":         map[string]any{"objectId": objectID, "versionId": versionID, "code": code, "name": name, "unit": unit},
				"orderedQuantity": formatFixed(quantity, 6), "unitPrice": formatFixed(price, 2),
				"lineAmount": formatFixed(amount, 2), "containerType": kind, "remark": remark}
			if per != nil {
				line["quantityPerContainer"] = formatFixed(*per, 6)
			}
			lines = append(lines, line)
		}
		return data, lines, rows.Err()
	case voudomain.EntityProcurementOrder:
		var supplierID, supplierVersion, supplierCode, supplierName string
		var purchaserID, purchaserVersion, purchaserCode, purchaserName string
		var contact, phone *string
		var settlementID, settlementVersion, settlementCode, settlementName, rule string
		var monthOffset, dayOffset int32
		var dayOfMonth *int32
		err := q.QueryRow(ctx, `SELECT supplier_object_id,supplier_version_id,supplier_code,supplier_name,
			purchaser_object_id,purchaser_version_id,purchaser_code,purchaser_name,contact_name,contact_phone,
			settlement_object_id,settlement_version_id,settlement_code,settlement_name,settlement_rule_type,
			settlement_month_offset,settlement_day_of_month,settlement_day_offset
			FROM vou_procurement_order_details WHERE document_id=$1`, item.DocumentID).Scan(
			&supplierID, &supplierVersion, &supplierCode, &supplierName, &purchaserID, &purchaserVersion,
			&purchaserCode, &purchaserName, &contact, &phone, &settlementID, &settlementVersion,
			&settlementCode, &settlementName, &rule, &monthOffset, &dayOfMonth, &dayOffset)
		if err != nil {
			return nil, nil, err
		}
		data = map[string]any{
			"supplier":    map[string]any{"objectId": supplierID, "versionId": supplierVersion, "code": supplierCode, "name": supplierName},
			"purchaser":   map[string]any{"objectId": purchaserID, "versionId": purchaserVersion, "code": purchaserCode, "name": purchaserName},
			"contactName": contact, "contactPhone": phone, "remark": remark,
			"settlementMethod": map[string]any{"objectId": settlementID, "versionId": settlementVersion, "code": settlementCode,
				"name": settlementName, "ruleType": rule, "monthOffset": monthOffset, "dayOfMonth": dayOfMonth, "dayOffset": dayOffset},
		}
		rows, queryErr := q.Query(ctx, `SELECT id,source_customer_line_id,quantity_micros,
			unit_price_cents,line_amount_cents,remark FROM vou_procurement_order_lines WHERE document_id=$1`, item.DocumentID)
		if queryErr != nil {
			return nil, nil, queryErr
		}
		defer rows.Close()
		for rows.Next() {
			var id, source string
			var quantity int64
			var price, amount *int64
			var remark *string
			if err = rows.Scan(&id, &source, &quantity, &price, &amount, &remark); err != nil {
				return nil, nil, err
			}
			line := map[string]any{"lineId": id, "sourceLineId": source, "quantity": formatFixed(quantity, 6), "remark": remark}
			if price != nil {
				line["unitPrice"] = formatFixed(*price, 2)
			}
			if amount != nil {
				line["lineAmount"] = formatFixed(*amount, 2)
			}
			lines = append(lines, line)
		}
		return data, lines, rows.Err()
	case voudomain.EntityGoodsReceipt:
		return loadSimpleQuantityBody(ctx, q, item.DocumentID, remark, `SELECT id,source_procurement_line_id,
			quantity_micros,remark FROM vou_goods_receipt_lines WHERE document_id=$1`)
	case voudomain.EntityDeliveryNote:
		var platformID, platformVersion, platformCode, platformName string
		var vehicleID, vehicleVersion, vehicleCode, vehicleName, plate string
		var solvent, resin int64
		err := q.QueryRow(ctx, `SELECT platform_object_id,platform_version_id,platform_code,platform_name,
			vehicle_object_id,vehicle_version_id,vehicle_code,vehicle_name,vehicle_plate_number,
			expected_solvent_containers,expected_resin_containers FROM vou_delivery_note_details WHERE document_id=$1`,
			item.DocumentID).Scan(&platformID, &platformVersion, &platformCode, &platformName,
			&vehicleID, &vehicleVersion, &vehicleCode, &vehicleName, &plate, &solvent, &resin)
		if err != nil {
			return nil, nil, err
		}
		data = map[string]any{"platform": map[string]any{"objectId": platformID, "versionId": platformVersion, "code": platformCode, "name": platformName},
			"vehicle":                   map[string]any{"objectId": vehicleID, "versionId": vehicleVersion, "code": vehicleCode, "name": vehicleName, "plateNumber": plate},
			"expectedSolventContainers": solvent, "expectedResinContainers": resin, "remark": remark}
		_, linesAny, err := loadSimpleQuantityBody(ctx, q, item.DocumentID, remark, `SELECT id,source_customer_line_id,
			quantity_micros,remark FROM vou_delivery_note_lines WHERE document_id=$1`)
		return data, linesAny, err
	case voudomain.EntitySignoffNote:
		var solvent, resin int64
		var reason *string
		err := q.QueryRow(ctx, `SELECT returned_solvent_containers,returned_resin_containers,
			container_difference_reason FROM vou_signoff_note_details WHERE document_id=$1`,
			item.DocumentID).Scan(&solvent, &resin, &reason)
		if err != nil {
			return nil, nil, err
		}
		data = map[string]any{"returnedSolventContainers": solvent, "returnedResinContainers": resin,
			"containerDifferenceReason": reason, "remark": remark}
		rows, queryErr := q.Query(ctx, `SELECT id,source_delivery_line_id,signed_qty_micros,
			rejected_qty_micros,loss_qty_micros,remark FROM vou_signoff_note_lines WHERE document_id=$1`, item.DocumentID)
		if queryErr != nil {
			return nil, nil, queryErr
		}
		defer rows.Close()
		for rows.Next() {
			var id, source string
			var signed, rejected, loss int64
			var remark *string
			if err = rows.Scan(&id, &source, &signed, &rejected, &loss, &remark); err != nil {
				return nil, nil, err
			}
			lines = append(lines, map[string]any{"lineId": id, "sourceLineId": source,
				"signedQuantity": formatFixed(signed, 6), "rejectedQuantity": formatFixed(rejected, 6),
				"lossQuantity": formatFixed(loss, 6), "remark": remark})
		}
		return data, lines, rows.Err()
	}
	return data, lines, nil
}

func loadSimpleQuantityBody(ctx context.Context, q queryer, documentID, remark, sql string) (any, any, error) {
	rows, err := q.Query(ctx, sql, documentID)
	if err != nil {
		return nil, nil, err
	}
	defer rows.Close()
	lines := []map[string]any{}
	for rows.Next() {
		var id, source string
		var quantity int64
		var remark *string
		if err = rows.Scan(&id, &source, &quantity, &remark); err != nil {
			return nil, nil, err
		}
		lines = append(lines, map[string]any{"lineId": id, "sourceLineId": source,
			"quantity": formatFixed(quantity, 6), "remark": remark})
	}
	return map[string]any{"remark": remark}, lines, rows.Err()
}

func loadBalances(ctx context.Context, q queryer, processID string, includeProcurement bool) (Balances, error) {
	var rootID, customerID string
	err := q.QueryRow(ctx, `SELECT p.root_document_id,c.customer_object_id FROM wfl_process_instances p
		JOIN vou_customer_order_details c ON c.document_id=p.root_document_id WHERE p.id=$1`, processID).
		Scan(&rootID, &customerID)
	if err != nil {
		return Balances{}, err
	}
	rows, err := q.Query(ctx, `SELECT c.id,c.ordered_qty_micros,
		COALESCE((SELECT sum(p.quantity_micros) FROM vou_procurement_order_lines p
			JOIN vou_documents d ON d.id=p.document_id WHERE p.source_customer_line_id=c.id AND d.status='APPROVED'),0),
		COALESCE((SELECT sum(r.quantity_micros) FROM vou_goods_receipt_lines r
			JOIN vou_documents d ON d.id=r.document_id WHERE r.source_customer_line_id=c.id AND d.status='APPROVED'),0),
		COALESCE((SELECT sum(x.quantity_micros) FROM vou_delivery_note_lines x
			JOIN vou_documents d ON d.id=x.document_id WHERE x.source_customer_line_id=c.id AND d.status='APPROVED'),0),
		COALESCE((SELECT sum(s.signed_qty_micros) FROM vou_signoff_note_lines s
			JOIN vou_documents d ON d.id=s.document_id WHERE s.source_customer_line_id=c.id AND d.status='APPROVED'),0),
		COALESCE((SELECT sum(s.rejected_qty_micros) FROM vou_signoff_note_lines s
			JOIN vou_documents d ON d.id=s.document_id WHERE s.source_customer_line_id=c.id AND d.status='APPROVED'),0),
		COALESCE((SELECT sum(s.loss_qty_micros) FROM vou_signoff_note_lines s
			JOIN vou_documents d ON d.id=s.document_id WHERE s.source_customer_line_id=c.id AND d.status='APPROVED'),0)
		FROM vou_customer_order_lines c WHERE c.document_id=$1 ORDER BY c.line_no`, rootID)
	if err != nil {
		return Balances{}, err
	}
	result := Balances{Lines: []LineBalance{}}
	for rows.Next() {
		var id string
		var ordered, procured, received, delivered, signed, rejected, loss int64
		if err = rows.Scan(&id, &ordered, &procured, &received, &delivered, &signed, &rejected, &loss); err != nil {
			rows.Close()
			return Balances{}, err
		}
		item := LineBalance{CustomerLineID: id, OrderedQuantity: formatFixed(ordered, 6),
			ReceivedQuantity: formatFixed(received, 6), DeliveredQuantity: formatFixed(delivered, 6),
			SignedQuantity: formatFixed(signed, 6), RejectedQuantity: formatFixed(rejected, 6),
			LossQuantity: formatFixed(loss, 6), AvailableToDeliverQuantity: formatFixed(received-delivered+rejected, 6),
			RemainingToSignQuantity: formatFixed(ordered-signed, 6)}
		if includeProcurement {
			item.ProcurementQuantity = formatFixed(procured, 6)
		}
		result.Lines = append(result.Lines, item)
	}
	rows.Close()
	if err = q.QueryRow(ctx, `SELECT count(*)>0 FROM wfl_process_documents l JOIN vou_documents d ON d.id=l.document_id
		WHERE l.process_id=$1 AND l.stage<>'CUSTOMER_ORDER' AND d.status IN ('DRAFT','REVIEWED')`, processID).
		Scan(&result.HasUnfinishedDocuments); err != nil {
		return Balances{}, err
	}
	if err = q.QueryRow(ctx, `SELECT
		COALESCE(sum(quantity_delta) FILTER(WHERE container_type='SOLVENT'),0),
		COALESCE(sum(quantity_delta) FILTER(WHERE container_type='RESIN'),0)
		FROM led_container_entries e JOIN led_control c ON c.active_generation_id=e.generation_id
		WHERE c.singleton AND e.customer_object_id=$1`, customerID).
		Scan(&result.SolventContainers, &result.ResinContainers); err != nil {
		return Balances{}, err
	}
	return result, nil
}

func (s *Service) getStage(ctx context.Context, action string, input ActionInput) (DocumentSummary, error) {
	if !validID(input.ProcessID) || !validID(input.DocumentID) {
		return DocumentSummary{}, validation("invalid stage document", nil)
	}
	stage := map[string]string{"procurement-get": StageProcurement, "receipt-get": StageReceipt,
		"delivery-get": StageDelivery, "signoff-get": StageSignoff}[action]
	if stage == "" {
		return DocumentSummary{}, validation("invalid stage", nil)
	}
	permissions := []string{"/wfl/intermediary-trade/" + action}
	documents, err := s.loadDocuments(ctx, input.ProcessID, permissions)
	if err != nil {
		return DocumentSummary{}, err
	}
	for _, document := range documents {
		if document.DocumentID == input.DocumentID && document.Stage == stage {
			return document, nil
		}
	}
	return DocumentSummary{}, validation("stage document not found", nil)
}

var _ = errors.Is

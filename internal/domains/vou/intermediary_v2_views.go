package vou

import (
	"context"
	"errors"
	"slices"

	dbsqlc "github.com/hansonyu183/zerp-back/internal/database/sqlc"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

func (s *Service) getIntermediaryV2(
	ctx context.Context, document dbsqlc.VouDocument, permissions []string,
) (DocumentView, error) {
	var detail struct {
		customerObjectID, customerVersionID, customerCode, customerName                   string
		salesObjectID, salesVersionID, salesCode, salesName                               string
		contactName, contactPhone, address                                                string
		settlementObjectID, settlementVersionID, settlementCode, settlementName, ruleType string
		monthOffset, dayOffset                                                            int32
		dayOfMonth                                                                        *int32
	}
	err := s.pool.QueryRow(ctx, `
		SELECT customer_object_id,customer_version_id,customer_code,customer_name,
		  salesperson_object_id,salesperson_version_id,salesperson_code,salesperson_name,
		  COALESCE(contact_name,''),COALESCE(contact_phone,''),COALESCE(delivery_address,''),
		  settlement_object_id,settlement_version_id,settlement_code,settlement_name,
		  settlement_rule_type,settlement_month_offset,settlement_day_of_month,settlement_day_offset
		FROM vou_intermediary_v2_details WHERE document_id=$1`, document.ID).Scan(
		&detail.customerObjectID, &detail.customerVersionID, &detail.customerCode, &detail.customerName,
		&detail.salesObjectID, &detail.salesVersionID, &detail.salesCode, &detail.salesName,
		&detail.contactName, &detail.contactPhone, &detail.address, &detail.settlementObjectID,
		&detail.settlementVersionID, &detail.settlementCode, &detail.settlementName,
		&detail.ruleType, &detail.monthOffset, &detail.dayOfMonth, &detail.dayOffset)
	if err != nil {
		return DocumentView{}, s.internal("read V2 root detail", err)
	}
	rows, err := s.pool.Query(ctx, `SELECT id,line_no,product_object_id,product_version_id,
		product_code,product_name,product_unit,ordered_qty_micros,sale_unit_price_cents,
		line_amount_cents,container_type,quantity_per_container_micros,COALESCE(remark,'')
		FROM vou_intermediary_v2_lines WHERE document_id=$1 ORDER BY line_no`, document.ID)
	if err != nil {
		return DocumentView{}, err
	}
	lines := make([]ProductLineView, 0)
	for rows.Next() {
		var line ProductLineView
		var ordered, price, amount int64
		var per *int64
		if err = rows.Scan(&line.LineID, &line.LineNo, &line.Product.ObjectID, &line.Product.VersionID,
			&line.Product.Code, &line.Product.Name, &line.Product.Unit, &ordered, &price, &amount,
			&line.ContainerType, &per, &line.Remark); err != nil {
			rows.Close()
			return DocumentView{}, err
		}
		line.Product.Entity = "product"
		line.OrderedQuantity, line.UnitPrice, line.LineAmount =
			formatQuantity(ordered), formatMoney(price), formatMoney(amount)
		if per != nil {
			line.QuantityPerContainer = formatQuantity(*per)
		}
		lines = append(lines, line)
	}
	rows.Close()
	children, err := listV2Children(ctx, s.pool, document.ID)
	if err != nil {
		return DocumentView{}, err
	}
	includeProcurement := slices.Contains(permissions,
		"/vou/intermediary-sale-order/procurement-get")
	if !includeProcurement {
		filtered := children[:0]
		for _, child := range children {
			if child.Stage != stageProcurement {
				filtered = append(filtered, child)
			}
		}
		children = filtered
	}
	balances, err := loadV2Balances(ctx, s.pool, document.ID, includeProcurement)
	if err != nil {
		return DocumentView{}, err
	}
	attachments, err := s.queries.ListVouAttachments(ctx, document.ID)
	if err != nil {
		return DocumentView{}, err
	}
	view := DocumentView{
		DocumentID: document.ID, Entity: document.Entity, DocumentNo: document.DocumentNo,
		Status: document.Status, Revision: document.Revision, Amount: formatMoney(document.TotalAmountCents),
		WorkflowVersion: 2, WorkflowStatus: document.Status, RootRevision: document.Revision,
		Balances: &balances, Children: children, Attachments: attachmentViews(attachments),
		CreatedAt: document.CreatedAt.Time, CreatedBy: document.CreatedBy,
		UpdatedAt: document.UpdatedAt.Time, UpdatedBy: document.UpdatedBy,
		ApprovedAt: optionalTime(document.ApprovedAt), ApprovedBy: document.ApprovedBy,
		CheckedAt: optionalTime(document.CheckedAt), CheckedBy: document.CheckedBy,
		CompletedAt: optionalTime(document.CompletedAt),
		Data: DocumentDataView{
			BusinessDate: document.BusinessDate.Time.Format(dateLayout), Currency: document.Currency,
			Remark: deref(document.Remark),
			Customer: &ReferenceView{ObjectID: detail.customerObjectID, VersionID: detail.customerVersionID,
				Entity: "customer", Code: detail.customerCode, Name: detail.customerName},
			Salesperson: &ReferenceView{ObjectID: detail.salesObjectID, VersionID: detail.salesVersionID,
				Entity: "employee", Code: detail.salesCode, Name: detail.salesName},
			ContactName: detail.contactName, ContactPhone: detail.contactPhone,
			DeliveryAddress: detail.address, ProductLines: lines,
			CustomerSettlementMethod: &SettlementMethodSnapshotView{
				ObjectID: detail.settlementObjectID, VersionID: detail.settlementVersionID,
				Code: detail.settlementCode, Name: detail.settlementName, RuleType: detail.ruleType,
				MonthOffset: detail.monthOffset, DayOfMonth: detail.dayOfMonth, DayOffset: detail.dayOffset,
			},
		},
	}
	if includeProcurement {
		var supplier ReferenceView
		err = s.pool.QueryRow(ctx, `SELECT supplier_object_id,supplier_version_id,supplier_code,supplier_name
			FROM vou_intermediary_procurements p JOIN vou_intermediary_children c ON c.id=p.child_id
			WHERE c.document_id=$1 LIMIT 1`, document.ID).Scan(&supplier.ObjectID,
			&supplier.VersionID, &supplier.Code, &supplier.Name)
		if err == nil {
			supplier.Entity = "supplier"
			view.Data.Supplier = &supplier
		} else if !errors.Is(err, pgx.ErrNoRows) {
			return DocumentView{}, err
		}
	}
	return view, nil
}

func (s *Service) getV2Child(
	ctx context.Context, action string, input IntermediaryActionInput,
) (any, error) {
	if !validID(input.DocumentID) {
		return nil, domainError(ErrorValidation, "invalid document", nil, nil)
	}
	stage := map[string]string{
		"procurement-get": stageProcurement, "receipt-get": stageReceipt,
		"delivery-get": stageDelivery, "signoff-get": stageSignoff,
	}[action]
	if stage == "" {
		return nil, domainError(ErrorValidation, "invalid child get action", nil, nil)
	}
	childID := input.ChildID
	if stage == stageProcurement && childID == "" {
		err := s.pool.QueryRow(ctx, `SELECT id FROM vou_intermediary_children
			WHERE document_id=$1 AND stage='PROCUREMENT'`, input.DocumentID).Scan(&childID)
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, domainError(ErrorValidation, "procurement not found", nil, nil)
		}
		if err != nil {
			return nil, err
		}
	}
	if !validID(childID) {
		return nil, domainError(ErrorValidation, "invalid child", nil, nil)
	}
	var child IntermediaryChildSummary
	var checkedAt, finalAt pgtype.Timestamptz
	err := s.pool.QueryRow(ctx, `SELECT id,child_no,stage,status,revision,created_at,created_by,
		updated_at,updated_by,checked_at,checked_by,final_at,final_by
		FROM vou_intermediary_children WHERE id=$1 AND document_id=$2 AND stage=$3`,
		childID, input.DocumentID, stage).Scan(&child.ChildID, &child.ChildNo, &child.Stage,
		&child.Status, &child.Revision, &child.CreatedAt, &child.CreatedBy, &child.UpdatedAt,
		&child.UpdatedBy, &checkedAt, &child.CheckedBy, &finalAt, &child.FinalBy)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, domainError(ErrorValidation, "child not found", nil, nil)
	}
	if err != nil {
		return nil, err
	}
	child.CheckedAt, child.FinalAt = optionalTime(checkedAt), optionalTime(finalAt)
	data, lines, err := loadV2ChildData(ctx, s.pool, stage, childID)
	if err != nil {
		return nil, err
	}
	balances, err := loadV2Balances(ctx, s.pool, input.DocumentID, stage == stageProcurement)
	if err != nil {
		return nil, err
	}
	attachments, err := listV2ChildAttachments(ctx, s.pool, childID)
	if err != nil {
		return nil, err
	}
	return map[string]any{
		"documentId": input.DocumentID, "child": child, "data": data,
		"lines": lines, "balances": balances, "attachments": attachments,
	}, nil
}

func listV2ChildAttachments(
	ctx context.Context, q rowQuerier, childID string,
) ([]AttachmentView, error) {
	rows, err := q.Query(ctx, `SELECT f.id,f.original_name,f.content_type,f.declared_size,
		f.sha256_hex,f.status,f.stored_at,a.created_at,a.created_by
		FROM vou_intermediary_child_attachments a
		JOIN vou_files f ON f.id=a.file_id
		WHERE a.child_id=$1 ORDER BY a.created_at,f.id`, childID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := make([]AttachmentView, 0)
	for rows.Next() {
		var item AttachmentView
		var storedAt pgtype.Timestamptz
		if err = rows.Scan(&item.FileID, &item.FileName, &item.ContentType, &item.Size,
			&item.SHA256, &item.Status, &storedAt, &item.CreatedAt, &item.CreatedBy); err != nil {
			return nil, err
		}
		item.StoredAt = optionalTime(storedAt)
		result = append(result, item)
	}
	return result, rows.Err()
}

type rowQuerier interface {
	Query(context.Context, string, ...any) (pgx.Rows, error)
	QueryRow(context.Context, string, ...any) pgx.Row
}

func listV2Children(ctx context.Context, q rowQuerier, documentID string) ([]IntermediaryChildSummary, error) {
	rows, err := q.Query(ctx, `SELECT id,child_no,stage,status,revision,created_at,created_by,
		updated_at,updated_by,checked_at,checked_by,final_at,final_by
		FROM vou_intermediary_children WHERE document_id=$1 ORDER BY created_at,id`, documentID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := make([]IntermediaryChildSummary, 0)
	for rows.Next() {
		var item IntermediaryChildSummary
		var checkedAt, finalAt pgtype.Timestamptz
		if err = rows.Scan(&item.ChildID, &item.ChildNo, &item.Stage, &item.Status, &item.Revision,
			&item.CreatedAt, &item.CreatedBy, &item.UpdatedAt, &item.UpdatedBy,
			&checkedAt, &item.CheckedBy, &finalAt, &item.FinalBy); err != nil {
			return nil, err
		}
		item.CheckedAt, item.FinalAt = optionalTime(checkedAt), optionalTime(finalAt)
		result = append(result, item)
	}
	return result, rows.Err()
}

func loadV2Balances(
	ctx context.Context, q rowQuerier, documentID string, includeProcurement bool,
) (IntermediaryBalances, error) {
	rows, err := q.Query(ctx, `
		SELECT l.id,l.ordered_qty_micros,
		  COALESCE((SELECT sum(pl.quantity_micros) FROM vou_intermediary_procurement_lines pl
		    JOIN vou_intermediary_children pc ON pc.id=pl.child_id
		    WHERE pl.root_line_id=l.id AND pc.status='ORDERED'),0),
		  COALESCE((SELECT sum(rl.quantity_micros) FROM vou_intermediary_receipt_lines rl
		    JOIN vou_intermediary_children rc ON rc.id=rl.child_id
		    WHERE rl.root_line_id=l.id AND rc.status='CONFIRMED'),0),
		  COALESCE((SELECT sum(dl.quantity_micros) FROM vou_intermediary_delivery_lines dl
		    JOIN vou_intermediary_children dc ON dc.id=dl.child_id
		    WHERE dl.root_line_id=l.id AND dc.status='EXECUTED'),0),
		  COALESCE((SELECT sum(sl.signed_qty_micros) FROM vou_intermediary_signoff_lines sl
		    JOIN vou_intermediary_children sc ON sc.id=sl.child_id
		    WHERE sl.root_line_id=l.id AND sc.status='CONFIRMED'),0),
		  COALESCE((SELECT sum(sl.rejected_qty_micros) FROM vou_intermediary_signoff_lines sl
		    JOIN vou_intermediary_children sc ON sc.id=sl.child_id
		    WHERE sl.root_line_id=l.id AND sc.status='CONFIRMED'),0),
		  COALESCE((SELECT sum(sl.loss_qty_micros) FROM vou_intermediary_signoff_lines sl
		    JOIN vou_intermediary_children sc ON sc.id=sl.child_id
		    WHERE sl.root_line_id=l.id AND sc.status='CONFIRMED'),0)
		FROM vou_intermediary_v2_lines l WHERE l.document_id=$1 ORDER BY l.line_no`, documentID)
	if err != nil {
		return IntermediaryBalances{}, err
	}
	result := IntermediaryBalances{Lines: make([]IntermediaryLineBalance, 0)}
	for rows.Next() {
		var id string
		var ordered, procurement, receipt, delivery, signed, rejected, loss int64
		if err = rows.Scan(&id, &ordered, &procurement, &receipt, &delivery,
			&signed, &rejected, &loss); err != nil {
			rows.Close()
			return result, err
		}
		item := IntermediaryLineBalance{
			RootLineID: id, OrderedQuantity: formatQuantity(ordered),
			ConfirmedReceiptQuantity: formatQuantity(receipt),
			ExecutedDeliveryQuantity: formatQuantity(delivery),
			SignedQuantity:           formatQuantity(signed), RejectedQuantity: formatQuantity(rejected),
			LossQuantity:               formatQuantity(loss),
			AvailableToDeliverQuantity: formatQuantity(receipt - delivery + rejected),
			RemainingToSignQuantity:    formatQuantity(ordered - signed),
		}
		if includeProcurement {
			item.ProcurementQuantity = formatQuantity(procurement)
		}
		result.Lines = append(result.Lines, item)
	}
	if err = rows.Err(); err != nil {
		rows.Close()
		return result, err
	}
	rows.Close()
	var unfinished int64
	err = q.QueryRow(ctx, `SELECT count(*) FROM vou_intermediary_children
		WHERE document_id=$1 AND status IN ('DRAFT','CHECKED')`, documentID).Scan(&unfinished)
	if err != nil {
		return result, err
	}
	result.HasUnfinishedChildren = unfinished != 0
	var customerID string
	err = q.QueryRow(ctx, `SELECT customer_object_id FROM vou_intermediary_v2_details
		WHERE document_id=$1`, documentID).Scan(&customerID)
	if err != nil {
		return result, err
	}
	result.Containers = []IntermediaryContainerBalance{
		{ContainerType: "SOLVENT"}, {ContainerType: "RESIN"},
	}
	for index, kind := range []string{"SOLVENT", "RESIN"} {
		var quantity int64
		err = q.QueryRow(ctx, `SELECT COALESCE(sum(e.quantity_delta),0)
			FROM led_container_entries e JOIN led_control c ON c.active_generation_id=e.generation_id
			WHERE c.singleton AND c.status='ACTIVE' AND e.customer_object_id=$1 AND e.container_type=$2`,
			customerID, kind).Scan(&quantity)
		if err != nil {
			return result, err
		}
		result.Containers[index].Quantity = quantity
	}
	return result, nil
}

func loadV2ChildData(
	ctx context.Context, q rowQuerier, stage, childID string,
) (map[string]any, []map[string]any, error) {
	data := map[string]any{}
	switch stage {
	case stageProcurement:
		var date pgtype.Date
		var supplier, supplierVersion, supplierCode, supplierName string
		var purchaser, purchaserVersion, purchaserCode, purchaserName, remark string
		err := q.QueryRow(ctx, `SELECT supplier_object_id,supplier_version_id,supplier_code,supplier_name,
			purchaser_object_id,purchaser_version_id,purchaser_code,purchaser_name,purchase_date,COALESCE(remark,'')
			FROM vou_intermediary_procurements WHERE child_id=$1`, childID).Scan(
			&supplier, &supplierVersion, &supplierCode, &supplierName, &purchaser, &purchaserVersion,
			&purchaserCode, &purchaserName, &date, &remark)
		if err != nil {
			return nil, nil, err
		}
		data = map[string]any{
			"supplier": ReferenceView{ObjectID: supplier, VersionID: supplierVersion, Entity: "supplier",
				Code: supplierCode, Name: supplierName},
			"purchaser": ReferenceView{ObjectID: purchaser, VersionID: purchaserVersion, Entity: "employee",
				Code: purchaserCode, Name: purchaserName},
			"purchaseDate": date.Time.Format(dateLayout), "remark": remark,
		}
	case stageReceipt:
		var date pgtype.Date
		var remark string
		if err := q.QueryRow(ctx, `SELECT receipt_date,COALESCE(remark,'')
			FROM vou_intermediary_receipts WHERE child_id=$1`, childID).Scan(&date, &remark); err != nil {
			return nil, nil, err
		}
		data = map[string]any{"receiptDate": date.Time.Format(dateLayout), "remark": remark}
	case stageDelivery:
		var date pgtype.Date
		var platform, platformVersion, platformCode, platformName string
		var vehicle, vehicleVersion, vehicleCode, vehicleName, plate, remark string
		var solvent, resin int64
		if err := q.QueryRow(ctx, `SELECT delivery_date,platform_object_id,platform_version_id,
			platform_code,platform_name,vehicle_object_id,vehicle_version_id,vehicle_code,
			vehicle_name,vehicle_plate_number,expected_solvent_containers,
			expected_resin_containers,COALESCE(remark,'') FROM vou_intermediary_deliveries
			WHERE child_id=$1`, childID).Scan(&date, &platform, &platformVersion, &platformCode,
			&platformName, &vehicle, &vehicleVersion, &vehicleCode, &vehicleName, &plate,
			&solvent, &resin, &remark); err != nil {
			return nil, nil, err
		}
		data = map[string]any{
			"deliveryDate": date.Time.Format(dateLayout),
			"platform": ReferenceView{ObjectID: platform, VersionID: platformVersion, Entity: "supplier",
				Code: platformCode, Name: platformName},
			"vehicle": ReferenceView{ObjectID: vehicle, VersionID: vehicleVersion, Entity: "vehicle",
				Code: vehicleCode, Name: vehicleName, PlateNumber: plate},
			"expectedSolventContainers": solvent, "expectedResinContainers": resin, "remark": remark,
		}
	case stageSignoff:
		var date pgtype.Date
		var deliveryID, reason, remark string
		var solvent, resin int64
		if err := q.QueryRow(ctx, `SELECT delivery_child_id,signoff_date,returned_solvent_containers,
			returned_resin_containers,COALESCE(container_difference_reason,''),COALESCE(remark,'')
			FROM vou_intermediary_signoffs WHERE child_id=$1`, childID).Scan(&deliveryID, &date,
			&solvent, &resin, &reason, &remark); err != nil {
			return nil, nil, err
		}
		data = map[string]any{"deliveryChildId": deliveryID, "signoffDate": date.Time.Format(dateLayout),
			"returnedSolventContainers": solvent, "returnedResinContainers": resin,
			"containerDifferenceReason": reason, "remark": remark}
	}
	table := map[string]string{stageProcurement: "vou_intermediary_procurement_lines",
		stageReceipt: "vou_intermediary_receipt_lines", stageDelivery: "vou_intermediary_delivery_lines",
		stageSignoff: "vou_intermediary_signoff_lines"}[stage]
	selectColumns := "root_line_id"
	switch stage {
	case stageProcurement:
		selectColumns += ",quantity_micros,unit_price_cents,line_amount_cents,COALESCE(remark,'')"
	case stageReceipt, stageDelivery:
		selectColumns += ",quantity_micros,COALESCE(remark,'')"
	case stageSignoff:
		selectColumns += ",signed_qty_micros,rejected_qty_micros,loss_qty_micros,COALESCE(remark,'')"
	}
	rows, err := q.Query(ctx, "SELECT "+selectColumns+" FROM "+table+" WHERE child_id=$1 ORDER BY root_line_id", childID)
	if err != nil {
		return nil, nil, err
	}
	defer rows.Close()
	lines := make([]map[string]any, 0)
	for rows.Next() {
		item := map[string]any{}
		var rootID, remark string
		switch stage {
		case stageProcurement:
			var quantity int64
			var price, amount *int64
			err = rows.Scan(&rootID, &quantity, &price, &amount, &remark)
			item = map[string]any{"rootLineId": rootID, "quantity": formatQuantity(quantity), "remark": remark}
			if price != nil {
				item["unitPrice"], item["lineAmount"] = formatMoney(*price), formatMoney(*amount)
			}
		case stageReceipt, stageDelivery:
			var quantity int64
			err = rows.Scan(&rootID, &quantity, &remark)
			item = map[string]any{"rootLineId": rootID, "quantity": formatQuantity(quantity), "remark": remark}
		case stageSignoff:
			var signed, rejected, loss int64
			err = rows.Scan(&rootID, &signed, &rejected, &loss, &remark)
			item = map[string]any{"rootLineId": rootID, "signedQuantity": formatQuantity(signed),
				"rejectedQuantity": formatQuantity(rejected), "lossQuantity": formatQuantity(loss),
				"remark": remark}
		}
		if err != nil {
			return nil, nil, err
		}
		lines = append(lines, item)
	}
	return data, lines, rows.Err()
}

package wfl

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"time"

	bobdomain "github.com/hansonyu183/zerp-back/internal/domains/bob"
	voudomain "github.com/hansonyu183/zerp-back/internal/domains/vou"
	"github.com/jackc/pgx/v5"
)

func (s *Service) Action(ctx context.Context, action string, input ActionInput, actorID, requestID string) (any, error) {
	if strings.HasSuffix(action, "-get") {
		return s.getStage(ctx, action, input)
	}
	if !validID(input.ProcessID) || input.ProcessRevision < 1 || !validID(actorID) {
		return nil, validation("invalid workflow action", nil)
	}
	switch action {
	case "check", "uncheck", "approve", "unapprove", "short-close-request", "short-close-cancel",
		"short-close-confirm", "short-close-unconfirm":
		return s.rootAction(ctx, action, input, actorID, requestID)
	}
	parts := strings.SplitN(action, "-", 2)
	if len(parts) != 2 {
		return nil, validation("invalid workflow action", nil)
	}
	stage := map[string]string{"procurement": StageProcurement, "receipt": StageReceipt,
		"delivery": StageDelivery, "signoff": StageSignoff}[parts[0]]
	if stage == "" {
		return nil, validation("invalid workflow stage", nil)
	}
	return s.stageAction(ctx, stage, parts[1], input, actorID, requestID)
}

func (s *Service) rootAction(ctx context.Context, action string, input ActionInput, actorID, requestID string) (MutationResult, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return MutationResult{}, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	process, err := lockProcess(ctx, tx, input.ProcessID)
	if err = processConflict(err, process, input.ProcessRevision); err != nil {
		return MutationResult{}, err
	}
	document, err := lockDocument(ctx, tx, process.rootID)
	if err != nil {
		return MutationResult{}, err
	}
	fromProcess, toProcess := process.status, process.status
	fromDocument, toDocument := document.status, document.status
	var reason *string
	event := ""
	switch action {
	case "check":
		if process.status != StatusDraft || document.status != "DRAFT" {
			return MutationResult{}, conflict("customer order is not draft", nil)
		}
		if err = countPendingAttachments(ctx, tx, document.id); err != nil {
			return MutationResult{}, err
		}
		toProcess, toDocument, event = StatusChecked, "REVIEWED", "CHECKED"
	case "uncheck":
		if process.status != StatusChecked || document.status != "REVIEWED" {
			return MutationResult{}, conflict("customer order is not checked", nil)
		}
		reason, err = requiredReason(input.Reason)
		toProcess, toDocument, event = StatusDraft, "DRAFT", "UNCHECKED"
	case "approve":
		if process.status != StatusChecked || document.status != "REVIEWED" {
			return MutationResult{}, conflict("customer order is not checked", nil)
		}
		if document.reviewedBy != nil && *document.reviewedBy == actorID {
			return MutationResult{}, conflict("approver must differ from checker", nil)
		}
		toProcess, toDocument, event = StatusApproved, "APPROVED", "APPROVED"
	case "unapprove":
		if process.status != StatusApproved || document.status != "APPROVED" {
			return MutationResult{}, conflict("customer order is not approved", nil)
		}
		var children int64
		err = tx.QueryRow(ctx, `SELECT count(*) FROM wfl_process_documents WHERE process_id=$1 AND stage<>'CUSTOMER_ORDER'`, process.id).Scan(&children)
		if err == nil && children != 0 {
			err = conflict("downstream documents block unapprove", nil)
		}
		if err == nil {
			reason, err = requiredReason(input.Reason)
		}
		toProcess, toDocument, event = StatusChecked, "REVIEWED", "UNAPPROVED"
	case "short-close-request":
		if process.status != StatusApproved {
			return MutationResult{}, conflict("process is not approved", nil)
		}
		reason, err = requiredReason(input.Reason)
		if err == nil {
			err = validateShortClose(ctx, tx, process.id)
		}
		toProcess, event = StatusShortRequested, "SHORT_CLOSE_REQUESTED"
	case "short-close-cancel":
		if process.status != StatusShortRequested {
			return MutationResult{}, conflict("short close is not requested", nil)
		}
		reason, err = requiredReason(input.Reason)
		toProcess, event = StatusApproved, "SHORT_CLOSE_CANCELLED"
	case "short-close-confirm":
		if process.status != StatusShortRequested {
			return MutationResult{}, conflict("short close is not requested", nil)
		}
		var requester string
		err = tx.QueryRow(ctx, `SELECT actor_id FROM wfl_audit_events WHERE process_id=$1
			AND event_type='SHORT_CLOSE_REQUESTED' ORDER BY occurred_at DESC,id DESC LIMIT 1`, process.id).Scan(&requester)
		if err == nil && requester == actorID {
			err = conflict("short close confirmer must differ from requester", nil)
		}
		toProcess, event = StatusShortClosed, "SHORT_CLOSE_CONFIRMED"
	case "short-close-unconfirm":
		if process.status != StatusShortClosed {
			return MutationResult{}, conflict("process is not short closed", nil)
		}
		reason, err = requiredReason(input.Reason)
		toProcess, event = StatusShortRequested, "SHORT_CLOSE_UNCONFIRMED"
	}
	if err != nil {
		return MutationResult{}, err
	}
	documentRevision := document.revision
	if toDocument != fromDocument {
		documentRevision, err = updateDocumentStatus(ctx, tx, document, toDocument, actorID)
		if err != nil {
			return MutationResult{}, err
		}
		if err = insertVouAudit(ctx, tx, document.id, document.entity, event, stringPtr(fromDocument),
			toDocument, actorID, requestID, reason, map[string]any{"revision": documentRevision}); err != nil {
			return MutationResult{}, err
		}
	}
	processRevision, err := updateProcessStatus(ctx, tx, process, toProcess, actorID)
	if err != nil {
		return MutationResult{}, err
	}
	if err = insertWFLAudit(ctx, tx, process.id, event, stringPtr(fromProcess), toProcess, StageCustomer,
		document.id, document.number, semanticStatus(StageCustomer, toDocument), actorID, requestID, reason,
		map[string]any{"processRevision": processRevision}); err != nil {
		return MutationResult{}, err
	}
	balances, err := loadBalances(ctx, tx, process.id, true)
	if err != nil {
		return MutationResult{}, err
	}
	if err = tx.Commit(ctx); err != nil {
		return MutationResult{}, err
	}
	return MutationResult{ProcessID: process.id, ProcessRevision: processRevision, WorkflowStatus: toProcess,
		DocumentID: document.id, DocumentNo: document.number, DocumentRevision: documentRevision,
		DocumentStatus: semanticStatus(StageCustomer, toDocument), Balances: &balances}, nil
}

func (s *Service) stageAction(ctx context.Context, stage, action string, input ActionInput, actorID, requestID string) (MutationResult, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return MutationResult{}, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	process, err := lockProcess(ctx, tx, input.ProcessID)
	if err = processConflict(err, process, input.ProcessRevision); err != nil {
		return MutationResult{}, err
	}
	if process.status != StatusApproved && process.status != StatusCompleted {
		return MutationResult{}, conflict("process is not approved", nil)
	}
	var document documentRow
	if action == "create" {
		document, err = s.createStage(ctx, tx, process, stage, input.Data, actorID, "")
	} else {
		if !validID(input.DocumentID) || input.DocumentRevision < 1 {
			return MutationResult{}, validation("invalid stage document", nil)
		}
		document, err = lockDocument(ctx, tx, input.DocumentID)
		if err = documentConflict(err, document, input.DocumentRevision, ""); err == nil {
			var linked bool
			err = tx.QueryRow(ctx, `SELECT true FROM wfl_process_documents WHERE process_id=$1 AND document_id=$2 AND stage=$3`,
				process.id, document.id, stage).Scan(&linked)
		}
		if err == nil {
			switch action {
			case "save":
				err = s.saveStage(ctx, tx, process, stage, &document, input.Data, actorID)
			case "delete":
				err = s.deleteStage(ctx, tx, process, stage, document, input.Reason, actorID, requestID)
			case "check":
				err = checkDocument(ctx, tx, &document, actorID)
			case "uncheck":
				err = uncheckDocument(ctx, tx, &document, input.Reason, actorID)
			case "place", "confirm", "execute":
				err = s.finalizeDocument(ctx, tx, process, stage, &document, action, actorID, requestID)
			case "unplace", "unconfirm", "unexecute":
				err = s.reverseDocument(ctx, tx, process, stage, &document, action, input.Reason, actorID, requestID)
			default:
				err = validation("invalid stage action", nil)
			}
		}
	}
	if err != nil {
		return MutationResult{}, err
	}
	if action != "delete" {
		var from *string
		to := document.status
		switch action {
		case "save":
			from, to = stringPtr("DRAFT"), "DRAFT"
		case "check":
			from, to = stringPtr("DRAFT"), "REVIEWED"
		case "uncheck":
			from, to = stringPtr("REVIEWED"), "DRAFT"
		case "place", "confirm", "execute":
			from, to = stringPtr("REVIEWED"), "APPROVED"
		case "unplace", "unconfirm", "unexecute":
			from, to = stringPtr("APPROVED"), "REVIEWED"
		}
		auditEvent := map[string]string{"create": "CREATED", "save": "SAVED"}[action]
		if auditEvent == "" {
			auditEvent = strings.ToUpper(action)
		}
		if err = insertVouAudit(ctx, tx, document.id, document.entity, auditEvent,
			from, to, actorID, requestID, optional(strings.TrimSpace(input.Reason)),
			map[string]any{"revision": document.revision, "stage": stage}); err != nil {
			return MutationResult{}, err
		}
	}
	processRevision, err := touchProcess(ctx, tx, process.id, process.revision, actorID, process.status)
	if err != nil {
		return MutationResult{}, err
	}
	if action != "delete" {
		event := stage + "_" + strings.ToUpper(action)
		if err = insertWFLAudit(ctx, tx, process.id, event, nil, process.status, stage, document.id, document.number,
			semanticStatus(stage, document.status), actorID, requestID, optional(strings.TrimSpace(input.Reason)),
			map[string]any{"documentRevision": document.revision}); err != nil {
			return MutationResult{}, err
		}
	}
	status, changed, err := maybeComplete(ctx, tx, process, actorID)
	if err != nil {
		return MutationResult{}, err
	}
	if changed {
		processRevision++
	}
	balances, err := loadBalances(ctx, tx, process.id, true)
	if err != nil {
		return MutationResult{}, err
	}
	if err = tx.Commit(ctx); err != nil {
		return MutationResult{}, err
	}
	result := MutationResult{ProcessID: process.id, ProcessRevision: processRevision, WorkflowStatus: status, Balances: &balances}
	if action != "delete" {
		result.DocumentID = document.id
		result.DocumentNo = document.number
		result.DocumentRevision = document.revision
		result.DocumentStatus = semanticStatus(stage, document.status)
		result.ParentDocumentID = document.parent
	}
	return result, nil
}

func (s *Service) createStage(ctx context.Context, tx pgx.Tx, process processRow, stage string, raw json.RawMessage, actorID, replacingDocumentID string) (documentRow, error) {
	var result documentRow
	if len(raw) == 0 {
		return result, validation("stage data is required", nil)
	}
	switch stage {
	case StageProcurement:
		var count int64
		if err := tx.QueryRow(ctx, `SELECT count(*) FROM wfl_process_documents WHERE process_id=$1 AND stage='PROCUREMENT'`, process.id).Scan(&count); err != nil {
			return result, err
		}
		if count != 0 {
			return result, conflict("procurement already exists", nil)
		}
		var data ProcurementInput
		if err := decode(raw, &data); err != nil {
			return result, err
		}
		return s.insertProcurement(ctx, tx, process, data, actorID)
	case StageReceipt:
		var data ReceiptInput
		if err := decode(raw, &data); err != nil {
			return result, err
		}
		return s.insertReceipt(ctx, tx, process, data, actorID)
	case StageDelivery:
		var data DeliveryInput
		if err := decode(raw, &data); err != nil {
			return result, err
		}
		return s.insertDelivery(ctx, tx, process, data, actorID)
	case StageSignoff:
		var data SignoffInput
		if err := decode(raw, &data); err != nil {
			return result, err
		}
		return s.insertSignoff(ctx, tx, process, data, actorID, replacingDocumentID)
	default:
		return result, validation("invalid stage", nil)
	}
}

func (s *Service) insertProcurement(ctx context.Context, tx pgx.Tx, process processRow, data ProcurementInput, actorID string) (documentRow, error) {
	var result documentRow
	date, err := parseDate(data.BusinessDate)
	if err != nil {
		return result, err
	}
	var rootDate time.Time
	var currency string
	if err = tx.QueryRow(ctx, `SELECT business_date,currency FROM vou_documents WHERE id=$1`, process.rootID).Scan(&rootDate, &currency); err != nil {
		return result, err
	}
	if date.Before(rootDate) {
		return result, validation("procurement date precedes customer order", nil)
	}
	supplier, err := s.resolver.ResolveEffectiveReference(ctx, tx, bobdomain.EntitySupplier, data.Supplier.ObjectID, data.Supplier.VersionID)
	if err != nil {
		return result, referenceError("supplier", err)
	}
	if supplier.Data.SupplierType != bobdomain.SupplierTypeGeneral {
		return result, referenceError("supplier", nil)
	}
	var purchaser bobdomain.EffectiveReference
	if data.Purchaser != nil {
		purchaser, err = s.resolver.ResolveEffectiveReference(ctx, tx, bobdomain.EntityEmployee, data.Purchaser.ObjectID, data.Purchaser.VersionID)
	} else {
		purchaser, err = s.resolver.ResolveCurrentEffectiveReference(ctx, tx, bobdomain.EntityEmployee, supplier.Data.SalespersonEmployeeID)
	}
	if err != nil {
		return result, referenceError("purchaser", err)
	}
	settlement, err := s.resolver.ResolveEffectiveReference(ctx, tx, bobdomain.EntitySettlementMethod, supplier.Data.SettlementMethodID, supplier.Data.SettlementMethodVersionID)
	if err != nil {
		return result, referenceError("supplier settlement method", err)
	}
	type line struct {
		source   string
		quantity int64
		price    *int64
		amount   *int64
		remark   *string
	}
	lines := []line{}
	var total int64
	positive := false
	for _, raw := range data.Lines {
		quantity, qerr := fixedDecimal(raw.Quantity, 6, true)
		if qerr != nil {
			return result, validation("invalid procurement quantity", nil)
		}
		var ordered int64
		if err = tx.QueryRow(ctx, `SELECT ordered_qty_micros FROM vou_customer_order_lines WHERE id=$1 AND document_id=$2`, raw.SourceLineID, process.rootID).Scan(&ordered); err != nil {
			return result, validation("invalid customer line", nil)
		}
		if quantity > ordered {
			return result, validation("procurement exceeds customer order", nil)
		}
		var pricePtr, amountPtr *int64
		if quantity > 0 {
			price, perr := fixedDecimal(raw.UnitPrice, 2, false)
			if perr != nil {
				return result, validation("purchase price is required", nil)
			}
			amount, _ := lineAmount(quantity, price)
			pricePtr = &price
			amountPtr = &amount
			total += amount
			positive = true
		}
		remark, rerr := optionalRemark(raw.Remark)
		if rerr != nil {
			return result, rerr
		}
		lines = append(lines, line{raw.SourceLineID, quantity, pricePtr, amountPtr, remark})
	}
	if !positive {
		return result, validation("at least one procurement line must be positive", nil)
	}
	id, no, err := insertManagedDocument(ctx, tx, voudomain.EntityProcurementOrder, process.rootID, date, currency, total, optional(strings.TrimSpace(data.Remark)), actorID)
	if err != nil {
		return result, err
	}
	_, err = tx.Exec(ctx, `INSERT INTO vou_procurement_order_details(document_id,supplier_object_id,supplier_version_id,
		supplier_code,supplier_name,purchaser_object_id,purchaser_version_id,purchaser_code,purchaser_name,
		contact_name,contact_phone,settlement_object_id,settlement_version_id,settlement_code,settlement_name,
		settlement_rule_type,settlement_month_offset,settlement_day_of_month,settlement_day_offset)
		VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)`,
		id, supplier.ObjectID, supplier.VersionID, supplier.Code, supplier.Data.Name, purchaser.ObjectID, purchaser.VersionID,
		purchaser.Code, purchaser.Data.Name, nullable(supplier.Data.ContactName), nullable(supplier.Data.ContactPhone),
		settlement.ObjectID, settlement.VersionID, settlement.Code, settlement.Data.Name, settlement.Data.RuleType,
		settlement.Data.MonthOffset, settlement.Data.DayOfMonth, settlement.Data.DayOffset)
	if err != nil {
		return result, err
	}
	for _, line := range lines {
		_, err = tx.Exec(ctx, `INSERT INTO vou_procurement_order_lines(id,document_id,source_customer_line_id,
		quantity_micros,unit_price_cents,line_amount_cents,remark) VALUES($1,$2,$3,$4,$5,$6,$7)`,
			newID(), id, line.source, line.quantity, line.price, line.amount, line.remark)
		if err != nil {
			return result, err
		}
	}
	if err = linkStage(ctx, tx, process.id, id, stageSequence(ctx, tx, process.id, StageProcurement), StageProcurement); err != nil {
		return result, err
	}
	return documentRow{id: id, entity: voudomain.EntityProcurementOrder, number: no, status: "DRAFT", revision: 1, parent: process.rootID}, nil
}

func (s *Service) insertReceipt(ctx context.Context, tx pgx.Tx, process processRow, data ReceiptInput, actorID string) (documentRow, error) {
	var result documentRow
	date, err := parseDate(data.BusinessDate)
	if err != nil {
		return result, err
	}
	var procurementID, currency, supplierID, supplierVersion, supplierCode, supplierName string
	var procurementDate time.Time
	err = tx.QueryRow(ctx, `SELECT d.id,d.business_date,d.currency,p.supplier_object_id,p.supplier_version_id,
		p.supplier_code,p.supplier_name FROM wfl_process_documents l JOIN vou_documents d ON d.id=l.document_id
		JOIN vou_procurement_order_details p ON p.document_id=d.id WHERE l.process_id=$1 AND l.stage='PROCUREMENT'
		AND d.status='APPROVED'`, process.id).Scan(&procurementID, &procurementDate, &currency, &supplierID, &supplierVersion, &supplierCode, &supplierName)
	if err != nil {
		return result, conflict("ordered procurement is required", nil)
	}
	if date.Before(procurementDate) {
		return result, validation("receipt date precedes procurement", nil)
	}
	type line struct {
		procurement, customer   string
		quantity, price, amount int64
		remark                  *string
	}
	lines := []line{}
	var total int64
	positive := false
	for _, raw := range data.Lines {
		quantity, qerr := fixedDecimal(raw.Quantity, 6, true)
		if qerr != nil {
			return result, validation("invalid receipt quantity", nil)
		}
		var customer string
		var purchased, price int64
		err = tx.QueryRow(ctx, `SELECT source_customer_line_id,quantity_micros,unit_price_cents
			FROM vou_procurement_order_lines WHERE id=$1 AND document_id=$2`, raw.SourceLineID, procurementID).Scan(&customer, &purchased, &price)
		if err != nil {
			return result, validation("invalid procurement line", nil)
		}
		amount, _ := lineAmount(quantity, price)
		total += amount
		if quantity > 0 {
			positive = true
		}
		remark, rerr := optionalRemark(raw.Remark)
		if rerr != nil {
			return result, rerr
		}
		lines = append(lines, line{raw.SourceLineID, customer, quantity, price, amount, remark})
	}
	if !positive {
		return result, validation("at least one receipt line must be positive", nil)
	}
	id, no, err := insertManagedDocument(ctx, tx, voudomain.EntityGoodsReceipt, procurementID, date, currency, total, optional(strings.TrimSpace(data.Remark)), actorID)
	if err != nil {
		return result, err
	}
	_, err = tx.Exec(ctx, `INSERT INTO vou_goods_receipt_details(document_id,supplier_object_id,supplier_version_id,supplier_code,supplier_name)
		VALUES($1,$2,$3,$4,$5)`, id, supplierID, supplierVersion, supplierCode, supplierName)
	if err != nil {
		return result, err
	}
	for _, line := range lines {
		_, err = tx.Exec(ctx, `INSERT INTO vou_goods_receipt_lines(id,document_id,source_procurement_line_id,
		source_customer_line_id,quantity_micros,purchase_unit_price_cents,line_amount_cents,remark)
		VALUES($1,$2,$3,$4,$5,$6,$7,$8)`, newID(), id, line.procurement, line.customer, line.quantity, line.price, line.amount, line.remark)
		if err != nil {
			return result, err
		}
	}
	if err = linkStage(ctx, tx, process.id, id, stageSequence(ctx, tx, process.id, StageReceipt), StageReceipt); err != nil {
		return result, err
	}
	return documentRow{id: id, entity: voudomain.EntityGoodsReceipt, number: no, status: "DRAFT", revision: 1, parent: procurementID}, nil
}

func (s *Service) insertDelivery(ctx context.Context, tx pgx.Tx, process processRow, data DeliveryInput, actorID string) (documentRow, error) {
	var result documentRow
	date, err := parseDate(data.BusinessDate)
	if err != nil {
		return result, err
	}
	var rootDate time.Time
	var currency, customerID, customerVersion, customerCode, customerName string
	err = tx.QueryRow(ctx, `SELECT d.business_date,d.currency,c.customer_object_id,c.customer_version_id,c.customer_code,c.customer_name
		FROM vou_documents d JOIN vou_customer_order_details c ON c.document_id=d.id WHERE d.id=$1`,
		process.rootID).Scan(&rootDate, &currency, &customerID, &customerVersion, &customerCode, &customerName)
	if err != nil {
		return result, err
	}
	if date.Before(rootDate) {
		return result, validation("delivery date precedes customer order", nil)
	}
	platform, err := s.resolver.ResolveEffectiveReference(ctx, tx, bobdomain.EntitySupplier, data.Platform.ObjectID, data.Platform.VersionID)
	if err != nil {
		return result, referenceError("logistics platform", err)
	}
	if platform.Data.SupplierType != bobdomain.SupplierTypeLogisticsPlatform {
		return result, referenceError("logistics platform", nil)
	}
	vehicle, err := s.resolver.ResolveEffectiveReference(ctx, tx, bobdomain.EntityVehicle, data.Vehicle.ObjectID, data.Vehicle.VersionID)
	if err != nil || vehicle.Data.PlatformObjectID != platform.ObjectID {
		return result, validation("vehicle does not belong to platform", nil)
	}
	type line struct {
		customer                string
		quantity, price, amount int64
		remark                  *string
	}
	lines := []line{}
	var total, solvent, resin int64
	positive := false
	for _, raw := range data.Lines {
		quantity, qerr := fixedDecimal(raw.Quantity, 6, true)
		if qerr != nil {
			return result, validation("invalid delivery quantity", nil)
		}
		var price int64
		var kind string
		var per *int64
		if err = tx.QueryRow(ctx, `SELECT sale_unit_price_cents,container_type,quantity_per_container_micros
			FROM vou_customer_order_lines WHERE id=$1 AND document_id=$2`, raw.SourceLineID, process.rootID).Scan(&price, &kind, &per); err != nil {
			return result, validation("invalid customer line", nil)
		}
		amount, _ := lineAmount(quantity, price)
		total += amount
		if quantity > 0 {
			positive = true
		}
		if quantity > 0 && per != nil {
			count := (quantity + *per - 1) / *per
			if kind == "SOLVENT" {
				solvent += count
			} else if kind == "RESIN" {
				resin += count
			}
		}
		remark, rerr := optionalRemark(raw.Remark)
		if rerr != nil {
			return result, rerr
		}
		lines = append(lines, line{raw.SourceLineID, quantity, price, amount, remark})
	}
	if !positive {
		return result, validation("at least one delivery line must be positive", nil)
	}
	id, no, err := insertManagedDocument(ctx, tx, voudomain.EntityDeliveryNote, process.rootID, date, currency, total, optional(strings.TrimSpace(data.Remark)), actorID)
	if err != nil {
		return result, err
	}
	_, err = tx.Exec(ctx, `INSERT INTO vou_delivery_note_details(document_id,customer_object_id,customer_version_id,
		customer_code,customer_name,platform_object_id,platform_version_id,platform_code,platform_name,
		vehicle_object_id,vehicle_version_id,vehicle_code,vehicle_name,vehicle_plate_number,
		expected_solvent_containers,expected_resin_containers) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
		id, customerID, customerVersion, customerCode, customerName, platform.ObjectID, platform.VersionID, platform.Code,
		platform.Data.Name, vehicle.ObjectID, vehicle.VersionID, vehicle.Code, vehicle.Data.Name, vehicle.Data.PlateNumber, solvent, resin)
	if err != nil {
		return result, err
	}
	for _, line := range lines {
		_, err = tx.Exec(ctx, `INSERT INTO vou_delivery_note_lines(id,document_id,source_customer_line_id,
		quantity_micros,sale_unit_price_cents,line_amount_cents,remark) VALUES($1,$2,$3,$4,$5,$6,$7)`,
			newID(), id, line.customer, line.quantity, line.price, line.amount, line.remark)
		if err != nil {
			return result, err
		}
	}
	if err = linkStage(ctx, tx, process.id, id, stageSequence(ctx, tx, process.id, StageDelivery), StageDelivery); err != nil {
		return result, err
	}
	return documentRow{id: id, entity: voudomain.EntityDeliveryNote, number: no, status: "DRAFT", revision: 1, parent: process.rootID}, nil
}

func (s *Service) insertSignoff(ctx context.Context, tx pgx.Tx, process processRow, data SignoffInput, actorID, replacingDocumentID string) (documentRow, error) {
	var result documentRow
	date, err := parseDate(data.BusinessDate)
	if err != nil {
		return result, err
	}
	if data.ReturnedSolventContainers < 0 || data.ReturnedResinContainers < 0 {
		return result, validation("returned containers cannot be negative", nil)
	}
	if len(data.Lines) == 0 {
		return result, validation("signoff lines are required", nil)
	}
	var deliveryID, currency, customerID, customerVersion, customerCode, customerName string
	var deliveryDate time.Time
	err = tx.QueryRow(ctx, `SELECT d.id,d.business_date,d.currency,x.customer_object_id,x.customer_version_id,x.customer_code,x.customer_name
		FROM vou_documents d JOIN vou_delivery_note_details x ON x.document_id=d.id
		JOIN wfl_process_documents l ON l.document_id=d.id
		WHERE l.process_id=$1 AND d.id=(SELECT document_id FROM vou_delivery_note_lines WHERE id=$2)
		AND d.status='APPROVED'`, process.id, data.Lines[0].SourceLineID).Scan(&deliveryID, &deliveryDate, &currency, &customerID, &customerVersion, &customerCode, &customerName)
	if err != nil {
		return result, validation("executed delivery is required", nil)
	}
	if date.Before(deliveryDate) {
		return result, validation("signoff date precedes delivery", nil)
	}
	var existing, deliveryLineCount int64
	if err = tx.QueryRow(ctx, `SELECT count(*) FROM vou_documents WHERE parent_document_id=$1
		AND entity='signoff-note' AND id<>$2`, deliveryID, replacingDocumentID).Scan(&existing); err != nil {
		return result, err
	}
	if existing != 0 {
		return result, conflict("delivery already has a signoff document", nil)
	}
	if err = tx.QueryRow(ctx, `SELECT count(*) FROM vou_delivery_note_lines WHERE document_id=$1`,
		deliveryID).Scan(&deliveryLineCount); err != nil {
		return result, err
	}
	if int64(len(data.Lines)) != deliveryLineCount {
		return result, validation("signoff must include every delivery line", nil)
	}
	type line struct {
		delivery, customer                    string
		signed, rejected, loss, price, amount int64
		remark                                *string
	}
	lines := []line{}
	var total int64
	for _, raw := range data.Lines {
		signed, serr := fixedDecimal(raw.SignedQuantity, 6, true)
		rejected, rerr := fixedDecimal(raw.RejectedQuantity, 6, true)
		if serr != nil || rerr != nil {
			return result, validation("invalid signoff quantities", nil)
		}
		var customer string
		var delivered, price int64
		var lineDelivery string
		err = tx.QueryRow(ctx, `SELECT document_id,source_customer_line_id,quantity_micros,sale_unit_price_cents
			FROM vou_delivery_note_lines WHERE id=$1`, raw.SourceLineID).Scan(&lineDelivery, &customer, &delivered, &price)
		if err != nil || lineDelivery != deliveryID || signed+rejected > delivered {
			return result, validation("invalid delivery line quantities", nil)
		}
		loss := delivered - signed - rejected
		amount, _ := lineAmount(signed, price)
		total += amount
		remark, remarkErr := optionalRemark(raw.Remark)
		if remarkErr != nil {
			return result, remarkErr
		}
		lines = append(lines, line{raw.SourceLineID, customer, signed, rejected, loss, price, amount, remark})
	}
	var expectedSolvent, expectedResin int64
	if err = tx.QueryRow(ctx, `SELECT expected_solvent_containers,expected_resin_containers FROM vou_delivery_note_details WHERE document_id=$1`, deliveryID).Scan(&expectedSolvent, &expectedResin); err != nil {
		return result, err
	}
	if (data.ReturnedSolventContainers < expectedSolvent || data.ReturnedResinContainers < expectedResin) && strings.TrimSpace(data.ContainerDifferenceReason) == "" {
		return result, validation("container difference reason is required", nil)
	}
	id, no, err := insertManagedDocument(ctx, tx, voudomain.EntitySignoffNote, deliveryID, date, currency, total, optional(strings.TrimSpace(data.Remark)), actorID)
	if err != nil {
		return result, err
	}
	_, err = tx.Exec(ctx, `INSERT INTO vou_signoff_note_details(document_id,customer_object_id,customer_version_id,
		customer_code,customer_name,returned_solvent_containers,returned_resin_containers,container_difference_reason)
		VALUES($1,$2,$3,$4,$5,$6,$7,$8)`, id, customerID, customerVersion, customerCode, customerName,
		data.ReturnedSolventContainers, data.ReturnedResinContainers, nullable(data.ContainerDifferenceReason))
	if err != nil {
		return result, err
	}
	for _, line := range lines {
		_, err = tx.Exec(ctx, `INSERT INTO vou_signoff_note_lines(id,document_id,source_delivery_line_id,
		source_customer_line_id,signed_qty_micros,rejected_qty_micros,loss_qty_micros,sale_unit_price_cents,
		line_amount_cents,remark) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, newID(), id, line.delivery, line.customer,
			line.signed, line.rejected, line.loss, line.price, line.amount, line.remark)
		if err != nil {
			return result, err
		}
	}
	if err = linkStage(ctx, tx, process.id, id, stageSequence(ctx, tx, process.id, StageSignoff), StageSignoff); err != nil {
		return result, err
	}
	return documentRow{id: id, entity: voudomain.EntitySignoffNote, number: no, status: "DRAFT", revision: 1, parent: deliveryID}, nil
}

func (s *Service) saveStage(ctx context.Context, tx pgx.Tx, process processRow, stage string, document *documentRow, raw json.RawMessage, actorID string) error {
	if document.status != "DRAFT" {
		return conflict("only draft document can be saved", nil)
	}
	if len(raw) == 0 {
		return validation("stage data is required", nil)
	}
	var sequence int
	if err := tx.QueryRow(ctx, `DELETE FROM wfl_process_documents
		WHERE process_id=$1 AND document_id=$2 RETURNING sequence_no`,
		process.id, document.id).Scan(&sequence); err != nil {
		return err
	}
	replacement, err := s.createStage(ctx, tx, process, stage, raw, actorID, document.id)
	if err != nil {
		return err
	}
	if _, err = tx.Exec(ctx, `DELETE FROM wfl_process_documents WHERE document_id=$1`, replacement.id); err != nil {
		return err
	}
	deleteSQL := map[string]string{
		StageProcurement: `DELETE FROM vou_procurement_order_details WHERE document_id=$1`,
		StageReceipt:     `DELETE FROM vou_goods_receipt_details WHERE document_id=$1`,
		StageDelivery:    `DELETE FROM vou_delivery_note_details WHERE document_id=$1`,
		StageSignoff:     `DELETE FROM vou_signoff_note_details WHERE document_id=$1`,
	}[stage]
	copySQL := map[string]string{
		StageProcurement: `INSERT INTO vou_procurement_order_details SELECT $1,entity,supplier_object_id,supplier_version_id,
			supplier_code,supplier_name,purchaser_object_id,purchaser_version_id,purchaser_code,purchaser_name,
			contact_name,contact_phone,settlement_object_id,settlement_version_id,settlement_code,settlement_name,
			settlement_rule_type,settlement_month_offset,settlement_day_of_month,settlement_day_offset
			FROM vou_procurement_order_details WHERE document_id=$2;
			INSERT INTO vou_procurement_order_lines
			SELECT substring(md5(random()::text||id),1,26),$1,source_customer_line_id,quantity_micros,unit_price_cents,line_amount_cents,remark
			FROM vou_procurement_order_lines WHERE document_id=$2`,
		StageReceipt: `INSERT INTO vou_goods_receipt_details
			SELECT $1,entity,supplier_object_id,supplier_version_id,supplier_code,supplier_name
			FROM vou_goods_receipt_details WHERE document_id=$2;
			INSERT INTO vou_goods_receipt_lines
			SELECT substring(md5(random()::text||id),1,26),$1,source_procurement_line_id,source_customer_line_id,quantity_micros,
			purchase_unit_price_cents,line_amount_cents,remark
			FROM vou_goods_receipt_lines WHERE document_id=$2`,
		StageDelivery: `INSERT INTO vou_delivery_note_details
			SELECT $1,entity,customer_object_id,customer_version_id,customer_code,customer_name,
			platform_object_id,platform_version_id,platform_code,platform_name,vehicle_object_id,
			vehicle_version_id,vehicle_code,vehicle_name,vehicle_plate_number,
			expected_solvent_containers,expected_resin_containers
			FROM vou_delivery_note_details WHERE document_id=$2;
			INSERT INTO vou_delivery_note_lines
			SELECT substring(md5(random()::text||id),1,26),$1,source_customer_line_id,quantity_micros,sale_unit_price_cents,line_amount_cents,remark
			FROM vou_delivery_note_lines WHERE document_id=$2`,
		StageSignoff: `INSERT INTO vou_signoff_note_details
			SELECT $1,entity,customer_object_id,customer_version_id,customer_code,customer_name,
			returned_solvent_containers,returned_resin_containers,container_difference_reason
			FROM vou_signoff_note_details WHERE document_id=$2;
			INSERT INTO vou_signoff_note_lines
			SELECT substring(md5(random()::text||id),1,26),$1,source_delivery_line_id,source_customer_line_id,signed_qty_micros,
			rejected_qty_micros,loss_qty_micros,sale_unit_price_cents,line_amount_cents,remark
			FROM vou_signoff_note_lines WHERE document_id=$2`,
	}[stage]
	if deleteSQL == "" || copySQL == "" {
		return validation("invalid stage", nil)
	}
	if _, err = tx.Exec(ctx, deleteSQL, document.id); err != nil {
		return err
	}
	for _, statement := range strings.Split(copySQL, ";") {
		if strings.TrimSpace(statement) == "" {
			continue
		}
		if _, err = tx.Exec(ctx, statement, document.id, replacement.id); err != nil {
			return err
		}
	}
	err = tx.QueryRow(ctx, `UPDATE vou_documents original SET
		business_date=replacement.business_date,currency=replacement.currency,
		total_amount_cents=replacement.total_amount_cents,remark=replacement.remark,
		revision=original.revision+1,updated_at=now(),updated_by=$1
		FROM vou_documents replacement WHERE original.id=$2 AND replacement.id=$3
		RETURNING original.revision`, actorID, document.id, replacement.id).Scan(&document.revision)
	if err != nil {
		return err
	}
	if _, err = tx.Exec(ctx, `DELETE FROM vou_documents WHERE id=$1`, replacement.id); err != nil {
		return err
	}
	return linkStage(ctx, tx, process.id, document.id, sequence, stage)
}

func checkDocument(ctx context.Context, tx pgx.Tx, document *documentRow, actorID string) error {
	if document.status != "DRAFT" {
		return conflict("only draft document can be checked", nil)
	}
	if err := countPendingAttachments(ctx, tx, document.id); err != nil {
		return err
	}
	err := tx.QueryRow(ctx, `UPDATE vou_documents SET status='REVIEWED',reviewed_at=now(),reviewed_by=$1,
		revision=revision+1,updated_at=now(),updated_by=$1 WHERE id=$2 AND revision=$3 RETURNING revision`,
		actorID, document.id, document.revision).Scan(&document.revision)
	if err == nil {
		document.status = "REVIEWED"
		document.reviewedBy = &actorID
	}
	return err
}

func uncheckDocument(ctx context.Context, tx pgx.Tx, document *documentRow, reasonValue, actorID string) error {
	if document.status != "REVIEWED" {
		return conflict("only checked document can be unchecked", nil)
	}
	if _, err := requiredReason(reasonValue); err != nil {
		return err
	}
	err := tx.QueryRow(ctx, `UPDATE vou_documents SET status='DRAFT',reviewed_at=NULL,reviewed_by=NULL,
		revision=revision+1,updated_at=now(),updated_by=$1 WHERE id=$2 AND revision=$3 RETURNING revision`,
		actorID, document.id, document.revision).Scan(&document.revision)
	if err == nil {
		document.status = "DRAFT"
		document.reviewedBy = nil
	}
	return err
}

func (s *Service) finalizeDocument(ctx context.Context, tx pgx.Tx, process processRow, stage string, document *documentRow, action, actorID, requestID string) error {
	expected := map[string]string{StageProcurement: "place", StageReceipt: "confirm", StageDelivery: "execute", StageSignoff: "confirm"}[stage]
	if action != expected || document.status != "REVIEWED" || document.reviewedBy == nil {
		return conflict("document must be checked first", nil)
	}
	if *document.reviewedBy == actorID {
		return conflict("final actor must differ from checker", nil)
	}
	if err := s.validateFinal(ctx, tx, process, stage, *document); err != nil {
		return err
	}
	err := tx.QueryRow(ctx, `UPDATE vou_documents SET status='APPROVED',approved_at=now(),approved_by=$1,
		revision=revision+1,updated_at=now(),updated_by=$1 WHERE id=$2 AND revision=$3 RETURNING revision`,
		actorID, document.id, document.revision).Scan(&document.revision)
	if err != nil {
		return err
	}
	document.status = "APPROVED"
	if stage == StageReceipt || stage == StageSignoff {
		err = s.events.Publish(ctx, tx, voudomain.ManagedDocumentEvent{Action: "FINALIZED", Entity: document.entity,
			DocumentID: document.id, DocumentNo: document.number, Revision: document.revision, ActorID: actorID, RequestID: requestID})
	}
	return err
}

func (s *Service) reverseDocument(ctx context.Context, tx pgx.Tx, process processRow, stage string, document *documentRow, action, reasonValue, actorID, requestID string) error {
	expected := map[string]string{StageProcurement: "unplace", StageReceipt: "unconfirm", StageDelivery: "unexecute", StageSignoff: "unconfirm"}[stage]
	if action != expected || document.status != "APPROVED" {
		return conflict("document is not in final state", nil)
	}
	reason, err := requiredReason(reasonValue)
	if err != nil {
		return err
	}
	if process.status == StatusShortRequested || process.status == StatusShortClosed {
		return conflict("short close must be cancelled first", nil)
	}
	if err = s.validateReverse(ctx, tx, process, stage, *document); err != nil {
		return err
	}
	err = tx.QueryRow(ctx, `UPDATE vou_documents SET status='REVIEWED',approved_at=NULL,approved_by=NULL,
		revision=revision+1,updated_at=now(),updated_by=$1 WHERE id=$2 AND revision=$3 RETURNING revision`,
		actorID, document.id, document.revision).Scan(&document.revision)
	if err != nil {
		return err
	}
	document.status = "REVIEWED"
	if stage == StageReceipt || stage == StageSignoff {
		err = s.events.Publish(ctx, tx, voudomain.ManagedDocumentEvent{Action: "REVERSED", Entity: document.entity,
			DocumentID: document.id, DocumentNo: document.number, Revision: document.revision, ActorID: actorID,
			RequestID: requestID, Reason: *reason})
	}
	return err
}

func (s *Service) deleteStage(ctx context.Context, tx pgx.Tx, process processRow, stage string, document documentRow, reasonValue, actorID, requestID string) error {
	if document.status != "DRAFT" {
		return conflict("only draft document can be deleted", nil)
	}
	if _, err := requiredReason(reasonValue); err != nil {
		return err
	}
	var attachments, children int64
	if err := tx.QueryRow(ctx, `SELECT count(*) FROM vou_document_attachments WHERE document_id=$1`, document.id).Scan(&attachments); err != nil {
		return err
	}
	if attachments != 0 {
		return conflict("attachments must be removed first", nil)
	}
	if err := tx.QueryRow(ctx, `SELECT count(*) FROM vou_documents WHERE parent_document_id=$1`, document.id).Scan(&children); err != nil {
		return err
	}
	if children != 0 {
		return conflict("downstream documents block deletion", nil)
	}
	if err := insertWFLAudit(ctx, tx, process.id, stage+"_DELETED", nil, process.status, stage, document.id,
		document.number, "DRAFT", actorID, requestID, optional(reasonValue), map[string]any{"physicalDelete": true}); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `DELETE FROM vou_audit_events WHERE document_id=$1`, document.id); err != nil {
		return err
	}
	_, err := tx.Exec(ctx, `DELETE FROM vou_documents WHERE id=$1 AND status='DRAFT'`, document.id)
	return err
}

func (s *Service) validateFinal(ctx context.Context, tx pgx.Tx, process processRow, stage string, document documentRow) error {
	switch stage {
	case StageReceipt:
		var invalid int64
		err := tx.QueryRow(ctx, `SELECT count(*) FROM vou_goods_receipt_lines r JOIN vou_procurement_order_lines p
			ON p.id=r.source_procurement_line_id WHERE r.document_id=$1 AND
			r.quantity_micros + COALESCE((SELECT sum(r2.quantity_micros) FROM vou_goods_receipt_lines r2
			JOIN vou_documents d2 ON d2.id=r2.document_id WHERE r2.source_procurement_line_id=p.id
			AND d2.status='APPROVED'),0) > p.quantity_micros`, document.id).Scan(&invalid)
		if err != nil {
			return err
		}
		if invalid != 0 {
			return conflict("confirmed receipts exceed procurement", nil)
		}
	case StageDelivery:
		var invalid int64
		err := tx.QueryRow(ctx, `SELECT count(*) FROM vou_delivery_note_lines dl JOIN vou_documents d ON d.id=dl.document_id
			WHERE dl.document_id=$1 AND dl.quantity_micros >
			COALESCE((SELECT sum(r.quantity_micros) FROM vou_goods_receipt_lines r JOIN vou_documents rd ON rd.id=r.document_id
				WHERE r.source_customer_line_id=dl.source_customer_line_id AND rd.status='APPROVED' AND rd.business_date<=d.business_date),0)
			- COALESCE((SELECT sum(x.quantity_micros) FROM vou_delivery_note_lines x JOIN vou_documents xd ON xd.id=x.document_id
				WHERE x.source_customer_line_id=dl.source_customer_line_id AND xd.status='APPROVED' AND xd.business_date<=d.business_date),0)
			+ COALESCE((SELECT sum(s.rejected_qty_micros) FROM vou_signoff_note_lines s JOIN vou_documents sd ON sd.id=s.document_id
				WHERE s.source_customer_line_id=dl.source_customer_line_id AND sd.status='APPROVED' AND sd.business_date<=d.business_date),0)`,
			document.id).Scan(&invalid)
		if err != nil {
			return err
		}
		if invalid != 0 {
			return conflict("delivery exceeds date-aware available quantity", nil)
		}
	case StageSignoff:
		var invalid int64
		err := tx.QueryRow(ctx, `SELECT count(*) FROM vou_signoff_note_lines s JOIN vou_customer_order_lines c
			ON c.id=s.source_customer_line_id WHERE s.document_id=$1 AND s.signed_qty_micros+
			COALESCE((SELECT sum(s2.signed_qty_micros) FROM vou_signoff_note_lines s2 JOIN vou_documents d2 ON d2.id=s2.document_id
				WHERE s2.source_customer_line_id=c.id AND d2.status='APPROVED'),0)>c.ordered_qty_micros`, document.id).Scan(&invalid)
		if err != nil {
			return err
		}
		if invalid != 0 {
			return conflict("signed quantity exceeds customer order", nil)
		}
	}
	return nil
}

func (s *Service) validateReverse(ctx context.Context, tx pgx.Tx, process processRow, stage string, document documentRow) error {
	var count int64
	switch stage {
	case StageProcurement:
		err := tx.QueryRow(ctx, `SELECT count(*) FROM vou_documents WHERE parent_document_id=$1`, document.id).Scan(&count)
		if err != nil {
			return err
		}
		if count != 0 {
			return conflict("receipt documents block procurement reversal", nil)
		}
	case StageDelivery:
		err := tx.QueryRow(ctx, `SELECT count(*) FROM vou_documents WHERE parent_document_id=$1`, document.id).Scan(&count)
		if err != nil {
			return err
		}
		if count != 0 {
			return conflict("signoff documents block delivery reversal", nil)
		}
	case StageReceipt:
		var invalid int64
		err := tx.QueryRow(ctx, `SELECT count(*) FROM vou_customer_order_lines c WHERE c.document_id=$1 AND
			COALESCE((SELECT sum(r.quantity_micros) FROM vou_goods_receipt_lines r JOIN vou_documents rd ON rd.id=r.document_id
				JOIN wfl_process_documents rl ON rl.document_id=rd.id WHERE rl.process_id=$2 AND r.source_customer_line_id=c.id
				AND rd.status='APPROVED' AND rd.id<>$3),0)
			- COALESCE((SELECT sum(d.quantity_micros) FROM vou_delivery_note_lines d JOIN vou_documents dd ON dd.id=d.document_id
				JOIN wfl_process_documents dl ON dl.document_id=dd.id WHERE dl.process_id=$2 AND d.source_customer_line_id=c.id
				AND dd.status='APPROVED'),0)
			+ COALESCE((SELECT sum(s.rejected_qty_micros) FROM vou_signoff_note_lines s JOIN vou_documents sd ON sd.id=s.document_id
				JOIN wfl_process_documents sl ON sl.document_id=sd.id WHERE sl.process_id=$2 AND s.source_customer_line_id=c.id
				AND sd.status='APPROVED'),0)<0`, process.rootID, process.id, document.id).Scan(&invalid)
		if err != nil {
			return err
		}
		if invalid != 0 {
			return conflict("receipt reversal would make delivery pool negative", nil)
		}
	}
	return nil
}

func countPendingAttachments(ctx context.Context, tx pgx.Tx, documentID string) error {
	var count int64
	err := tx.QueryRow(ctx, `SELECT count(*) FROM vou_document_attachments a JOIN vou_files f ON f.id=a.file_id
		WHERE a.document_id=$1 AND f.status='PENDING'`, documentID).Scan(&count)
	if err != nil {
		return err
	}
	if count != 0 {
		return conflict("attachments are still uploading", nil)
	}
	return nil
}

func updateDocumentStatus(ctx context.Context, tx pgx.Tx, document documentRow, status, actorID string) (int64, error) {
	var revision int64
	var err error
	switch {
	case document.status == "DRAFT" && status == "REVIEWED":
		err = tx.QueryRow(ctx, `UPDATE vou_documents SET status='REVIEWED',reviewed_at=now(),reviewed_by=$1,
		revision=revision+1,updated_at=now(),updated_by=$1 WHERE id=$2 AND revision=$3 RETURNING revision`, actorID, document.id, document.revision).Scan(&revision)
	case document.status == "REVIEWED" && status == "DRAFT":
		err = tx.QueryRow(ctx, `UPDATE vou_documents SET status='DRAFT',reviewed_at=NULL,reviewed_by=NULL,
		revision=revision+1,updated_at=now(),updated_by=$1 WHERE id=$2 AND revision=$3 RETURNING revision`, actorID, document.id, document.revision).Scan(&revision)
	case document.status == "REVIEWED" && status == "APPROVED":
		err = tx.QueryRow(ctx, `UPDATE vou_documents SET status='APPROVED',approved_at=now(),approved_by=$1,
		revision=revision+1,updated_at=now(),updated_by=$1 WHERE id=$2 AND revision=$3 RETURNING revision`, actorID, document.id, document.revision).Scan(&revision)
	case document.status == "APPROVED" && status == "REVIEWED":
		err = tx.QueryRow(ctx, `UPDATE vou_documents SET status='REVIEWED',approved_at=NULL,approved_by=NULL,
		revision=revision+1,updated_at=now(),updated_by=$1 WHERE id=$2 AND revision=$3 RETURNING revision`, actorID, document.id, document.revision).Scan(&revision)
	}
	return revision, err
}

func updateProcessStatus(ctx context.Context, tx pgx.Tx, process processRow, status, actorID string) (int64, error) {
	var revision int64
	err := tx.QueryRow(ctx, `UPDATE wfl_process_instances SET status=$1::varchar,revision=revision+1,
		completed_at=CASE WHEN $1::varchar IN ('COMPLETED','SHORT_CLOSED') THEN now() ELSE NULL END,
		updated_at=now(),updated_by=$2 WHERE id=$3 AND revision=$4 RETURNING revision`,
		status, actorID, process.id, process.revision).Scan(&revision)
	return revision, err
}

func validateShortClose(ctx context.Context, tx pgx.Tx, processID string) error {
	var unfinished int64
	err := tx.QueryRow(ctx, `SELECT count(*) FROM wfl_process_documents l JOIN vou_documents d ON d.id=l.document_id
		WHERE l.process_id=$1 AND l.stage<>'CUSTOMER_ORDER' AND d.status IN ('DRAFT','REVIEWED')`, processID).Scan(&unfinished)
	if err != nil {
		return err
	}
	if unfinished != 0 {
		return conflict("unfinished documents block short close", nil)
	}
	var unsignedDelivery int64
	err = tx.QueryRow(ctx, `SELECT count(*) FROM wfl_process_documents l JOIN vou_documents d ON d.id=l.document_id
		WHERE l.process_id=$1 AND l.stage='DELIVERY' AND d.status='APPROVED'
		AND NOT EXISTS(SELECT 1 FROM vou_documents s WHERE s.parent_document_id=d.id AND s.entity='signoff-note' AND s.status='APPROVED')`, processID).Scan(&unsignedDelivery)
	if err != nil {
		return err
	}
	if unsignedDelivery != 0 {
		return conflict("unsigned deliveries block short close", nil)
	}
	return nil
}

func maybeComplete(ctx context.Context, tx pgx.Tx, process processRow, actorID string) (string, bool, error) {
	if process.status == StatusShortRequested || process.status == StatusShortClosed {
		return process.status, false, nil
	}
	var incomplete, unfinished, unsigned int64
	err := tx.QueryRow(ctx, `SELECT
		(SELECT count(*) FROM vou_customer_order_lines c WHERE c.document_id=$1 AND
		 COALESCE((SELECT sum(s.signed_qty_micros) FROM vou_signoff_note_lines s JOIN vou_documents d ON d.id=s.document_id
		 WHERE s.source_customer_line_id=c.id AND d.status='APPROVED'),0)<>c.ordered_qty_micros),
		(SELECT count(*) FROM wfl_process_documents l JOIN vou_documents d ON d.id=l.document_id
		 WHERE l.process_id=$2 AND l.stage<>'CUSTOMER_ORDER' AND d.status IN ('DRAFT','REVIEWED')),
		(SELECT count(*) FROM wfl_process_documents l JOIN vou_documents d ON d.id=l.document_id
		 WHERE l.process_id=$2 AND l.stage='DELIVERY' AND d.status='APPROVED'
		 AND NOT EXISTS(SELECT 1 FROM vou_documents s WHERE s.parent_document_id=d.id
		 AND s.entity='signoff-note' AND s.status='APPROVED'))`,
		process.rootID, process.id).Scan(&incomplete, &unfinished, &unsigned)
	if err != nil {
		return process.status, false, err
	}
	target := StatusApproved
	if incomplete == 0 && unfinished == 0 && unsigned == 0 {
		target = StatusCompleted
	}
	if target == process.status {
		return target, false, nil
	}
	_, err = tx.Exec(ctx, `UPDATE wfl_process_instances SET status=$1::varchar,revision=revision+1,
		completed_at=CASE WHEN $1::varchar='COMPLETED' THEN now() ELSE NULL END,updated_at=now(),updated_by=$2 WHERE id=$3`,
		target, actorID, process.id)
	return target, true, err
}

func requiredReason(value string) (*string, error) {
	value = strings.TrimSpace(value)
	if len([]rune(value)) < 1 || len([]rune(value)) > 1000 {
		return nil, validation("reason must contain 1 to 1000 characters", nil)
	}
	return &value, nil
}
func decode(raw json.RawMessage, target any) error {
	decoder := json.NewDecoder(strings.NewReader(string(raw)))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		return validation("invalid stage data", map[string]any{"cause": err.Error()})
	}
	return nil
}
func semanticStatus(stage, status string) string {
	if status == "DRAFT" {
		return "DRAFT"
	}
	if status == "REVIEWED" {
		return "CHECKED"
	}
	if status == "APPROVED" {
		return map[string]string{StageCustomer: "APPROVED", StageProcurement: "ORDERED", StageReceipt: "CONFIRMED", StageDelivery: "EXECUTED", StageSignoff: "CONFIRMED"}[stage]
	}
	return status
}
func stageSequence(ctx context.Context, tx pgx.Tx, processID, stage string) int {
	var next int
	_ = tx.QueryRow(ctx, `SELECT COALESCE(max(sequence_no),0)+1 FROM wfl_process_documents WHERE process_id=$1 AND stage=$2`, processID, stage).Scan(&next)
	return next
}
func linkStage(ctx context.Context, tx pgx.Tx, processID, documentID string, sequence int, stage string) error {
	_, err := tx.Exec(ctx, `INSERT INTO wfl_process_documents(process_id,document_id,stage,sequence_no) VALUES($1,$2,$3,$4)`, processID, documentID, stage, sequence)
	return err
}

var _ = errors.Is
var _ = time.Time{}

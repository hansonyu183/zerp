package vou

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"
	"unicode/utf8"

	bobdomain "github.com/hansonyu183/zerp-back/internal/domains/bob"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

func (s *Service) v2ChildAction(
	ctx context.Context, stage, action string, input IntermediaryActionInput,
	actorID, requestID string,
) (MutationResult, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return MutationResult{}, s.internal("begin V2 child action", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	root, err := lockV2Root(ctx, tx, input.DocumentID)
	if err = v2RootConflict(err, root, input.RootRevision, ""); err != nil {
		return MutationResult{}, err
	}
	if root.Status != StatusApproved && root.Status != StatusCompleted {
		return MutationResult{}, domainError(ErrorConflict, "root order is not approved", nil, nil)
	}

	var child v2Child
	if action == "create" {
		child, err = s.createV2Child(ctx, tx, root, stage, input.Data, actorID)
	} else {
		if !validID(input.ChildID) || input.ChildRevision < 1 {
			return MutationResult{}, domainError(ErrorValidation, "invalid child revision", nil, nil)
		}
		child, err = lockV2Child(ctx, tx, root.ID, stage, input.ChildID)
		if err == nil && child.Revision != input.ChildRevision {
			err = domainError(ErrorConflict, "child document changed", map[string]any{
				"childRevision": child.Revision, "childStatus": child.Status,
			}, nil)
		}
		if err == nil {
			switch action {
			case "save":
				err = s.saveV2Child(ctx, tx, root, &child, input.Data, actorID)
			case "delete":
				err = s.deleteV2Child(ctx, tx, root, child, input.Reason)
			case "check":
				err = checkV2Child(ctx, tx, &child, actorID)
			case "uncheck":
				err = reverseCheckV2Child(ctx, tx, &child, input.Reason, actorID)
			case "place", "confirm", "execute":
				err = s.finalizeV2Child(ctx, tx, root, &child, action, actorID, requestID)
			case "unplace", "unconfirm", "unexecute":
				err = s.reverseV2Child(ctx, tx, root, &child, action, input.Reason, actorID, requestID)
			default:
				err = domainError(ErrorValidation, "invalid child action", nil, nil)
			}
		}
	}
	if err != nil {
		return MutationResult{}, err
	}
	nextRoot, err := touchV2Root(ctx, tx, root.ID, root.Revision, actorID)
	if err != nil {
		return MutationResult{}, err
	}
	if action == "delete" {
		if err = insertV2Audit(ctx, tx, root.ID, stage+"_DELETED", stringPtr(StatusDraft), StatusDraft,
			actorID, requestID, stage, child.ID, child.ChildNo, StatusDraft,
			optionalText(input.Reason), map[string]any{"rootRevision": nextRoot}); err != nil {
			return MutationResult{}, err
		}
	} else {
		event := stage + "_" + strings.ToUpper(action)
		if err = insertV2Audit(ctx, tx, root.ID, event, nil, child.Status,
			actorID, requestID, stage, child.ID, child.ChildNo, child.Status,
			optionalText(input.Reason), map[string]any{
				"rootRevision": nextRoot, "childRevision": child.Revision,
			}); err != nil {
			return MutationResult{}, err
		}
	}
	status, err := maybeCompleteV2Root(ctx, tx, root.ID, root.Status, actorID)
	if err != nil {
		return MutationResult{}, err
	}
	if status != root.Status {
		nextRoot++
		root.Status = status
	}
	balances, err := loadV2Balances(ctx, tx, root.ID, true)
	if err != nil {
		return MutationResult{}, err
	}
	if err = tx.Commit(ctx); err != nil {
		return MutationResult{}, s.writeError("commit V2 child action", err)
	}
	root.Status = status
	if action == "delete" {
		return v2Mutation(root, nextRoot, status, nil, &balances), nil
	}
	return v2Mutation(root, nextRoot, status, &child, &balances), nil
}

func (s *Service) createV2Child(
	ctx context.Context, tx pgx.Tx, root v2Root, stage string, raw json.RawMessage, actorID string,
) (v2Child, error) {
	if root.Status != StatusApproved {
		return v2Child{}, domainError(ErrorConflict, "new children require APPROVED root", nil, nil)
	}
	if len(raw) == 0 {
		return v2Child{}, domainError(ErrorValidation, "child data is required", nil, nil)
	}
	child := v2Child{ID: newID(), DocumentID: root.ID, Stage: stage, Status: StatusDraft, Revision: 1}
	if stage == stageProcurement {
		child.ChildNo = root.DocumentNo + "-P01"
	} else {
		var number int32
		err := tx.QueryRow(ctx, `
			INSERT INTO vou_intermediary_child_counters(document_id,stage,last_value)
			VALUES($1,$2,1) ON CONFLICT(document_id,stage)
			DO UPDATE SET last_value=vou_intermediary_child_counters.last_value+1
			RETURNING last_value`, root.ID, stage).Scan(&number)
		if err != nil {
			return child, err
		}
		prefix := map[string]string{stageReceipt: "R", stageDelivery: "D", stageSignoff: "S"}[stage]
		child.ChildNo = fmt.Sprintf("%s-%s%03d", root.DocumentNo, prefix, number)
	}
	_, err := tx.Exec(ctx, `
		INSERT INTO vou_intermediary_children(
			id,document_id,stage,child_no,status,revision,created_by,updated_by
		) VALUES($1,$2,$3,$4,'DRAFT',1,$5,$5)`,
		child.ID, root.ID, stage, child.ChildNo, actorID)
	if err != nil {
		return child, s.writeError("insert V2 child", err)
	}
	if err = s.writeV2ChildData(ctx, tx, root, child, raw, false); err != nil {
		return child, err
	}
	return child, nil
}

func (s *Service) saveV2Child(
	ctx context.Context, tx pgx.Tx, root v2Root, child *v2Child, raw json.RawMessage, actorID string,
) error {
	if child.Status != StatusDraft {
		return domainError(ErrorConflict, "only draft child can be saved", nil, nil)
	}
	if err := s.writeV2ChildData(ctx, tx, root, *child, raw, true); err != nil {
		return err
	}
	err := tx.QueryRow(ctx, `
		UPDATE vou_intermediary_children SET revision=revision+1,updated_at=now(),updated_by=$1
		WHERE id=$2 AND revision=$3 AND status='DRAFT' RETURNING revision`,
		actorID, child.ID, child.Revision).Scan(&child.Revision)
	if err != nil {
		return domainError(ErrorConflict, "child document changed", nil, err)
	}
	return nil
}

func (s *Service) writeV2ChildData(
	ctx context.Context, tx pgx.Tx, root v2Root, child v2Child, raw json.RawMessage, replace bool,
) error {
	switch child.Stage {
	case stageProcurement:
		var data IntermediaryProcurementInput
		if err := decodeV2Data(raw, &data); err != nil {
			return err
		}
		return s.writeV2Procurement(ctx, tx, root, child, data, replace)
	case stageReceipt:
		var data IntermediaryReceiptInput
		if err := decodeV2Data(raw, &data); err != nil {
			return err
		}
		return writeV2Receipt(ctx, tx, root, child, data, replace)
	case stageDelivery:
		var data IntermediaryDeliveryInput
		if err := decodeV2Data(raw, &data); err != nil {
			return err
		}
		return s.writeV2Delivery(ctx, tx, root, child, data, replace)
	case stageSignoff:
		var data IntermediarySignoffInput
		if err := decodeV2Data(raw, &data); err != nil {
			return err
		}
		return writeV2Signoff(ctx, tx, child, data, replace)
	default:
		return domainError(ErrorValidation, "invalid child stage", nil, nil)
	}
}

func decodeV2Data(raw json.RawMessage, target any) error {
	decoder := json.NewDecoder(strings.NewReader(string(raw)))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		return domainError(ErrorValidation, "invalid child data", nil, err)
	}
	return nil
}

func (s *Service) writeV2Procurement(
	ctx context.Context, tx pgx.Tx, root v2Root, child v2Child,
	data IntermediaryProcurementInput, replace bool,
) error {
	purchaseDate, err := parseV2Date(data.PurchaseDate, "purchaseDate")
	if err != nil || purchaseDate.Before(root.BusinessDate) {
		return domainError(ErrorValidation, "purchase date cannot precede order date", nil, err)
	}
	if err = validateReference(&data.Supplier, "supplier", true); err != nil {
		return err
	}
	supplier, err := s.resolver.ResolveEffectiveReference(ctx, tx, bobdomain.EntitySupplier,
		data.Supplier.ObjectID, data.Supplier.VersionID)
	if err != nil || supplier.Data.SupplierType != bobdomain.SupplierTypeGeneral {
		return domainError(ErrorConflict, "supplier must be an effective general supplier", nil, err)
	}
	var purchaser bobdomain.EffectiveReference
	if data.Purchaser != nil {
		purchaser, err = s.resolver.ResolveEffectiveReference(ctx, tx, bobdomain.EntityEmployee,
			data.Purchaser.ObjectID, data.Purchaser.VersionID)
	} else {
		purchaser, err = s.resolver.ResolveCurrentEffectiveReference(ctx, tx, bobdomain.EntityEmployee,
			supplier.Data.SalespersonEmployeeID)
	}
	if err != nil {
		return domainError(ErrorConflict, "purchaser is not currently effective", nil, err)
	}
	if supplier.Data.SettlementMethodID == "" || supplier.Data.SettlementMethodVersionID == "" {
		return domainError(ErrorConflict, "supplier settlement method is not configured", nil, nil)
	}
	settlement, err := s.resolver.ResolveEffectiveReference(ctx, tx, bobdomain.EntitySettlementMethod,
		supplier.Data.SettlementMethodID, supplier.Data.SettlementMethodVersionID)
	if err != nil {
		return domainError(ErrorConflict, "supplier settlement method is not effective", nil, err)
	}
	lines, err := validateProcurementLines(ctx, tx, root.ID, data.Lines)
	if err != nil {
		return err
	}
	if replace {
		if _, err = tx.Exec(ctx, `DELETE FROM vou_intermediary_procurement_lines WHERE child_id=$1`, child.ID); err != nil {
			return err
		}
		if _, err = tx.Exec(ctx, `DELETE FROM vou_intermediary_procurements WHERE child_id=$1`, child.ID); err != nil {
			return err
		}
	}
	_, err = tx.Exec(ctx, `
		INSERT INTO vou_intermediary_procurements(
			child_id,supplier_object_id,supplier_version_id,supplier_code,supplier_name,
			purchaser_object_id,purchaser_version_id,purchaser_code,purchaser_name,purchase_date,
			contact_name,contact_phone,settlement_object_id,settlement_version_id,settlement_code,
			settlement_name,settlement_rule_type,settlement_month_offset,settlement_day_of_month,
			settlement_day_offset,remark
		) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NULLIF($11,''),NULLIF($12,''),
		  $13,$14,$15,$16,$17,$18,$19,$20,$21)`,
		child.ID, supplier.ObjectID, supplier.VersionID, supplier.Code, supplier.Data.Name,
		purchaser.ObjectID, purchaser.VersionID, purchaser.Code, purchaser.Data.Name, purchaseDate,
		supplier.Data.ContactName, supplier.Data.ContactPhone, settlement.ObjectID, settlement.VersionID,
		settlement.Code, settlement.Data.Name, settlement.Data.RuleType, settlement.Data.MonthOffset,
		settlement.Data.DayOfMonth, settlement.Data.DayOffset, optionalText(data.Remark))
	if err != nil {
		return err
	}
	for _, line := range lines {
		_, err = tx.Exec(ctx, `INSERT INTO vou_intermediary_procurement_lines(
			id,child_id,root_line_id,quantity_micros,unit_price_cents,line_amount_cents,remark
		) VALUES($1,$2,$3,$4,$5,$6,$7)`, newID(), child.ID, line.rootLineID,
			line.quantity, line.price, line.amount, line.remark)
		if err != nil {
			return err
		}
	}
	return nil
}

type fixedProcurementLine struct {
	rootLineID    string
	quantity      int64
	price, amount *int64
	remark        *string
}

func validateProcurementLines(
	ctx context.Context, tx pgx.Tx, documentID string, inputs []IntermediaryProcurementLineInput,
) ([]fixedProcurementLine, error) {
	rootLines, err := loadV2Lines(ctx, tx, documentID)
	if err != nil {
		return nil, err
	}
	if len(inputs) != len(rootLines) {
		return nil, domainError(ErrorValidation, "procurement must contain every root line", nil, nil)
	}
	seen, positive := map[string]bool{}, false
	result := make([]fixedProcurementLine, 0, len(inputs))
	for _, input := range inputs {
		rootLine, ok := rootLines[input.RootLineID]
		if !ok || seen[input.RootLineID] {
			return nil, domainError(ErrorValidation, "invalid procurement root line", nil, nil)
		}
		seen[input.RootLineID] = true
		quantity, parseErr := quantityMicros(input.Quantity, true)
		if parseErr != nil || quantity > rootLine.Ordered {
			return nil, domainError(ErrorValidation, "invalid procurement quantity", nil, parseErr)
		}
		item := fixedProcurementLine{rootLineID: input.RootLineID, quantity: quantity, remark: optionalText(input.Remark)}
		if quantity > 0 {
			positive = true
			price, priceErr := moneyCents(input.UnitPrice)
			if priceErr != nil {
				return nil, domainError(ErrorValidation, "purchase price is required", nil, priceErr)
			}
			amount, amountErr := lineAmountCents(quantity, price)
			if amountErr != nil {
				return nil, amountErr
			}
			item.price, item.amount = &price, &amount
		} else if strings.TrimSpace(input.UnitPrice) != "" {
			return nil, domainError(ErrorValidation, "zero procurement line cannot have a price", nil, nil)
		}
		result = append(result, item)
	}
	if !positive {
		return nil, domainError(ErrorValidation, "at least one procurement line must be positive", nil, nil)
	}
	return result, nil
}

func writeV2Receipt(
	ctx context.Context, tx pgx.Tx, root v2Root, child v2Child,
	data IntermediaryReceiptInput, replace bool,
) error {
	date, err := parseV2Date(data.ReceiptDate, "receiptDate")
	if err != nil {
		return err
	}
	var purchaseDate pgtype.Date
	err = tx.QueryRow(ctx, `
		SELECT p.purchase_date FROM vou_intermediary_procurements p
		JOIN vou_intermediary_children c ON c.id=p.child_id
		WHERE c.document_id=$1 AND c.status='ORDERED'`, root.ID).Scan(&purchaseDate)
	if err != nil {
		return domainError(ErrorConflict, "ordered procurement is required", nil, err)
	}
	if date.Before(purchaseDate.Time) {
		return domainError(ErrorValidation, "receipt date cannot precede purchase date", nil, nil)
	}
	lines, err := validateQuantityLines(ctx, tx, root.ID, data.Lines, true)
	if err != nil {
		return err
	}
	if replace {
		_, _ = tx.Exec(ctx, `DELETE FROM vou_intermediary_receipt_lines WHERE child_id=$1`, child.ID)
		_, _ = tx.Exec(ctx, `DELETE FROM vou_intermediary_receipts WHERE child_id=$1`, child.ID)
	}
	if _, err = tx.Exec(ctx, `INSERT INTO vou_intermediary_receipts(child_id,receipt_date,remark)
		VALUES($1,$2,$3)`, child.ID, date, optionalText(data.Remark)); err != nil {
		return err
	}
	for _, line := range lines {
		if _, err = tx.Exec(ctx, `INSERT INTO vou_intermediary_receipt_lines(
			id,child_id,root_line_id,quantity_micros,remark) VALUES($1,$2,$3,$4,$5)`,
			newID(), child.ID, line.rootLineID, line.quantity, line.remark); err != nil {
			return err
		}
	}
	return nil
}

func (s *Service) writeV2Delivery(
	ctx context.Context, tx pgx.Tx, root v2Root, child v2Child,
	data IntermediaryDeliveryInput, replace bool,
) error {
	date, err := parseV2Date(data.DeliveryDate, "deliveryDate")
	if err != nil || date.Before(root.BusinessDate) {
		return domainError(ErrorValidation, "delivery date cannot precede order date", nil, err)
	}
	lines, err := validateQuantityLines(ctx, tx, root.ID, data.Lines, true)
	if err != nil {
		return err
	}
	platform, err := s.resolver.ResolveEffectiveReference(ctx, tx, bobdomain.EntitySupplier,
		data.Platform.ObjectID, data.Platform.VersionID)
	if err != nil || platform.Data.SupplierType != bobdomain.SupplierTypeLogisticsPlatform {
		return domainError(ErrorConflict, "invalid logistics platform", nil, err)
	}
	vehicle, err := s.resolver.ResolveEffectiveReference(ctx, tx, bobdomain.EntityVehicle,
		data.Vehicle.ObjectID, data.Vehicle.VersionID)
	if err != nil || vehicle.Data.PlatformObjectID != platform.ObjectID {
		return domainError(ErrorConflict, "vehicle does not belong to logistics platform", nil, err)
	}
	expectedSolvent, expectedResin, err := expectedContainers(ctx, tx, lines)
	if err != nil {
		return err
	}
	if replace {
		_, _ = tx.Exec(ctx, `DELETE FROM vou_intermediary_delivery_lines WHERE child_id=$1`, child.ID)
		_, _ = tx.Exec(ctx, `DELETE FROM vou_intermediary_deliveries WHERE child_id=$1`, child.ID)
	}
	_, err = tx.Exec(ctx, `INSERT INTO vou_intermediary_deliveries(
		child_id,delivery_date,platform_object_id,platform_version_id,platform_code,platform_name,
		vehicle_object_id,vehicle_version_id,vehicle_code,vehicle_name,vehicle_plate_number,
		expected_solvent_containers,expected_resin_containers,remark
	) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
		child.ID, date, platform.ObjectID, platform.VersionID, platform.Code, platform.Data.Name,
		vehicle.ObjectID, vehicle.VersionID, vehicle.Code, vehicle.Data.Name, vehicle.Data.PlateNumber,
		expectedSolvent, expectedResin, optionalText(data.Remark))
	if err != nil {
		return err
	}
	for _, line := range lines {
		if _, err = tx.Exec(ctx, `INSERT INTO vou_intermediary_delivery_lines(
			id,child_id,root_line_id,quantity_micros,remark) VALUES($1,$2,$3,$4,$5)`,
			newID(), child.ID, line.rootLineID, line.quantity, line.remark); err != nil {
			return err
		}
	}
	return nil
}

func writeV2Signoff(
	ctx context.Context, tx pgx.Tx, child v2Child, data IntermediarySignoffInput, replace bool,
) error {
	date, err := parseV2Date(data.SignoffDate, "signoffDate")
	if err != nil || !validID(data.DeliveryChildID) ||
		data.ReturnedSolventContainers < 0 || data.ReturnedResinContainers < 0 {
		return domainError(ErrorValidation, "invalid signoff data", nil, err)
	}
	var deliveryDate pgtype.Date
	var expectedSolvent, expectedResin int64
	err = tx.QueryRow(ctx, `
		SELECT d.delivery_date,d.expected_solvent_containers,d.expected_resin_containers
		FROM vou_intermediary_deliveries d JOIN vou_intermediary_children c ON c.id=d.child_id
		WHERE d.child_id=$1 AND c.document_id=$2 AND c.status='EXECUTED'`,
		data.DeliveryChildID, child.DocumentID).Scan(&deliveryDate, &expectedSolvent, &expectedResin)
	if err != nil {
		return domainError(ErrorConflict, "executed delivery is required", nil, err)
	}
	if date.Before(deliveryDate.Time) {
		return domainError(ErrorValidation, "signoff date cannot precede delivery date", nil, nil)
	}
	if (data.ReturnedSolventContainers < expectedSolvent || data.ReturnedResinContainers < expectedResin) &&
		(strings.TrimSpace(data.ContainerDifferenceReason) == "" ||
			utf8.RuneCountInString(strings.TrimSpace(data.ContainerDifferenceReason)) > 1000) {
		return domainError(ErrorValidation, "container difference reason is required", nil, nil)
	}
	deliveryLines, err := loadDeliveryLineQuantities(ctx, tx, data.DeliveryChildID)
	if err != nil {
		return err
	}
	if len(data.Lines) != len(deliveryLines) {
		return domainError(ErrorValidation, "signoff must contain every delivery line", nil, nil)
	}
	type signoffLine struct {
		rootID                 string
		signed, rejected, loss int64
		remark                 *string
	}
	lines := make([]signoffLine, 0, len(data.Lines))
	seen := map[string]bool{}
	for _, input := range data.Lines {
		delivered, ok := deliveryLines[input.RootLineID]
		if !ok || seen[input.RootLineID] {
			return domainError(ErrorValidation, "invalid signoff root line", nil, nil)
		}
		seen[input.RootLineID] = true
		signed, signedErr := quantityMicros(input.SignedQuantity, true)
		rejected, rejectedErr := quantityMicros(input.RejectedQuantity, true)
		if signedErr != nil || rejectedErr != nil || signed+rejected > delivered {
			return domainError(ErrorValidation, "invalid signoff quantities", nil, nil)
		}
		lines = append(lines, signoffLine{input.RootLineID, signed, rejected,
			delivered - signed - rejected, optionalText(input.Remark)})
	}
	if replace {
		_, _ = tx.Exec(ctx, `DELETE FROM vou_intermediary_signoff_lines WHERE child_id=$1`, child.ID)
		_, _ = tx.Exec(ctx, `DELETE FROM vou_intermediary_signoffs WHERE child_id=$1`, child.ID)
	}
	_, err = tx.Exec(ctx, `INSERT INTO vou_intermediary_signoffs(
		child_id,delivery_child_id,signoff_date,returned_solvent_containers,
		returned_resin_containers,container_difference_reason,remark
	) VALUES($1,$2,$3,$4,$5,$6,$7)`, child.ID, data.DeliveryChildID, date,
		data.ReturnedSolventContainers, data.ReturnedResinContainers,
		optionalText(data.ContainerDifferenceReason), optionalText(data.Remark))
	if err != nil {
		return err
	}
	for _, line := range lines {
		if _, err = tx.Exec(ctx, `INSERT INTO vou_intermediary_signoff_lines(
			id,child_id,root_line_id,signed_qty_micros,rejected_qty_micros,loss_qty_micros,remark
		) VALUES($1,$2,$3,$4,$5,$6,$7)`, newID(), child.ID, line.rootID,
			line.signed, line.rejected, line.loss, line.remark); err != nil {
			return err
		}
	}
	return nil
}

type fixedQuantityLine struct {
	rootLineID string
	quantity   int64
	remark     *string
}

func validateQuantityLines(
	ctx context.Context, tx pgx.Tx, documentID string,
	inputs []IntermediaryLineQuantityInput, positive bool,
) ([]fixedQuantityLine, error) {
	rootLines, err := loadV2Lines(ctx, tx, documentID)
	if err != nil {
		return nil, err
	}
	if len(inputs) != len(rootLines) {
		return nil, domainError(ErrorValidation, "stage must contain every root line", nil, nil)
	}
	seen, hasPositive := map[string]bool{}, false
	result := make([]fixedQuantityLine, 0, len(inputs))
	for _, input := range inputs {
		if _, ok := rootLines[input.RootLineID]; !ok || seen[input.RootLineID] {
			return nil, domainError(ErrorValidation, "invalid stage root line", nil, nil)
		}
		seen[input.RootLineID] = true
		quantity, parseErr := quantityMicros(input.Quantity, true)
		if parseErr != nil {
			return nil, domainError(ErrorValidation, "invalid stage quantity", nil, parseErr)
		}
		hasPositive = hasPositive || quantity > 0
		result = append(result, fixedQuantityLine{input.RootLineID, quantity, optionalText(input.Remark)})
	}
	if positive && !hasPositive {
		return nil, domainError(ErrorValidation, "at least one line must be positive", nil, nil)
	}
	return result, nil
}

func checkV2Child(ctx context.Context, tx pgx.Tx, child *v2Child, actorID string) error {
	if child.Status != StatusDraft {
		return domainError(ErrorConflict, "only draft child can be checked", nil, nil)
	}
	var pending int64
	if err := tx.QueryRow(ctx, `SELECT count(*) FROM vou_intermediary_child_attachments a
		JOIN vou_files f ON f.id=a.file_id WHERE a.child_id=$1 AND f.status='PENDING'`,
		child.ID).Scan(&pending); err != nil {
		return err
	}
	if pending != 0 {
		return domainError(ErrorConflict, "attachments are still uploading", nil, nil)
	}
	err := tx.QueryRow(ctx, `UPDATE vou_intermediary_children
		SET status='CHECKED',checked_at=now(),checked_by=$1,revision=revision+1,
		    updated_at=now(),updated_by=$1 WHERE id=$2 AND revision=$3 RETURNING revision`,
		actorID, child.ID, child.Revision).Scan(&child.Revision)
	child.Status, child.CheckedBy = StatusChecked, &actorID
	return err
}

func reverseCheckV2Child(
	ctx context.Context, tx pgx.Tx, child *v2Child, reason, actorID string,
) error {
	if child.Status != StatusChecked {
		return domainError(ErrorConflict, "only checked child can be unchecked", nil, nil)
	}
	if _, err := v2Reason(reason); err != nil {
		return err
	}
	err := tx.QueryRow(ctx, `UPDATE vou_intermediary_children
		SET status='DRAFT',checked_at=NULL,checked_by=NULL,revision=revision+1,
		    updated_at=now(),updated_by=$1 WHERE id=$2 AND revision=$3 RETURNING revision`,
		actorID, child.ID, child.Revision).Scan(&child.Revision)
	child.Status, child.CheckedBy = StatusDraft, nil
	return err
}

func (s *Service) finalizeV2Child(
	ctx context.Context, tx pgx.Tx, root v2Root, child *v2Child,
	action, actorID, requestID string,
) error {
	if child.Status != StatusChecked || child.CheckedBy == nil {
		return domainError(ErrorConflict, "child must be checked first", nil, nil)
	}
	if *child.CheckedBy == actorID {
		return domainError(ErrorConflict, "final actor must differ from checker", nil, nil)
	}
	expectedAction := map[string]string{stageProcurement: "place", stageReceipt: "confirm",
		stageDelivery: "execute", stageSignoff: "confirm"}[child.Stage]
	if action != expectedAction {
		return domainError(ErrorValidation, "invalid final action for stage", nil, nil)
	}
	if err := validateV2FinalQuantities(ctx, tx, root, *child); err != nil {
		return err
	}
	status := map[string]string{stageProcurement: "ORDERED", stageReceipt: "CONFIRMED",
		stageDelivery: "EXECUTED", stageSignoff: "CONFIRMED"}[child.Stage]
	err := tx.QueryRow(ctx, `UPDATE vou_intermediary_children SET status=$1,final_at=now(),final_by=$2,
		revision=revision+1,updated_at=now(),updated_by=$2
		WHERE id=$3 AND revision=$4 RETURNING revision`, status, actorID, child.ID,
		child.Revision).Scan(&child.Revision)
	if err != nil {
		return err
	}
	child.Status, child.FinalBy = status, &actorID
	if child.Stage == stageReceipt || child.Stage == stageSignoff {
		if err = s.events.Publish(ctx, tx, IntermediaryStageEvent{
			Action: "CONFIRMED", Stage: child.Stage, DocumentID: root.ID,
			DocumentNo: root.DocumentNo, RootRevision: root.Revision + 1,
			ChildID: child.ID, ChildNo: child.ChildNo, ChildRevision: child.Revision,
			ActorID: actorID, RequestID: requestID,
		}); err != nil {
			return s.eventError("publish intermediary stage confirmed", err)
		}
	}
	return nil
}

func (s *Service) reverseV2Child(
	ctx context.Context, tx pgx.Tx, root v2Root, child *v2Child,
	action, reasonValue, actorID, requestID string,
) error {
	reason, err := v2Reason(reasonValue)
	if err != nil {
		return err
	}
	if root.Status == StatusShortCloseRequested || root.Status == StatusShortClosed {
		return domainError(ErrorConflict, "short close must be cancelled first", nil, nil)
	}
	expected := map[string]string{stageProcurement: "unplace", stageReceipt: "unconfirm",
		stageDelivery: "unexecute", stageSignoff: "unconfirm"}[child.Stage]
	finalStatus := map[string]string{stageProcurement: "ORDERED", stageReceipt: "CONFIRMED",
		stageDelivery: "EXECUTED", stageSignoff: "CONFIRMED"}[child.Stage]
	if action != expected || child.Status != finalStatus {
		return domainError(ErrorConflict, "invalid reverse action for stage", nil, nil)
	}
	switch child.Stage {
	case stageProcurement:
		var count int64
		err = tx.QueryRow(ctx, `SELECT count(*) FROM vou_intermediary_children
			WHERE document_id=$1 AND stage='RECEIPT'`, root.ID).Scan(&count)
		if err == nil && count != 0 {
			err = domainError(ErrorConflict, "receipt children block procurement reversal", nil, nil)
		}
	case stageReceipt:
		err = validateReceiptRemoval(ctx, tx, root.ID, child.ID)
	case stageDelivery:
		var count int64
		err = tx.QueryRow(ctx, `SELECT count(*) FROM vou_intermediary_signoffs WHERE delivery_child_id=$1`,
			child.ID).Scan(&count)
		if err == nil && count != 0 {
			err = domainError(ErrorConflict, "signoff child blocks delivery reversal", nil, nil)
		}
	}
	if err != nil {
		return err
	}
	err = tx.QueryRow(ctx, `UPDATE vou_intermediary_children SET status='CHECKED',
		final_at=NULL,final_by=NULL,revision=revision+1,updated_at=now(),updated_by=$1
		WHERE id=$2 AND revision=$3 RETURNING revision`, actorID, child.ID,
		child.Revision).Scan(&child.Revision)
	if err != nil {
		return err
	}
	child.Status, child.FinalBy = StatusChecked, nil
	if child.Stage == stageReceipt || child.Stage == stageSignoff {
		if err = s.events.Publish(ctx, tx, IntermediaryStageEvent{
			Action: "UNCONFIRMED", Stage: child.Stage, DocumentID: root.ID,
			DocumentNo: root.DocumentNo, RootRevision: root.Revision + 1,
			ChildID: child.ID, ChildNo: child.ChildNo, ChildRevision: child.Revision,
			ActorID: actorID, RequestID: requestID, Reason: *reason,
		}); err != nil {
			return s.eventError("publish intermediary stage unconfirmed", err)
		}
	}
	return nil
}

func (s *Service) deleteV2Child(
	ctx context.Context, tx pgx.Tx, root v2Root, child v2Child, reason string,
) error {
	if child.Status != StatusDraft {
		return domainError(ErrorConflict, "only draft child can be deleted", nil, nil)
	}
	if _, err := v2Reason(reason); err != nil {
		return err
	}
	var attachments int64
	if err := tx.QueryRow(ctx, `SELECT count(*) FROM vou_intermediary_child_attachments WHERE child_id=$1`,
		child.ID).Scan(&attachments); err != nil {
		return err
	}
	if attachments != 0 {
		return domainError(ErrorConflict, "child attachments must be removed first", nil, nil)
	}
	command, err := tx.Exec(ctx, `DELETE FROM vou_intermediary_children
		WHERE id=$1 AND document_id=$2 AND status='DRAFT' AND revision=$3`,
		child.ID, root.ID, child.Revision)
	if err != nil || command.RowsAffected() != 1 {
		return domainError(ErrorConflict, "child document changed", nil, err)
	}
	return nil
}

func validateV2FinalQuantities(ctx context.Context, tx pgx.Tx, root v2Root, child v2Child) error {
	switch child.Stage {
	case stageProcurement:
		return nil
	case stageReceipt:
		rows, err := tx.Query(ctx, `
			SELECT l.id,p.quantity_micros,
			  COALESCE((SELECT sum(rl.quantity_micros) FROM vou_intermediary_receipt_lines rl
			    JOIN vou_intermediary_children rc ON rc.id=rl.child_id
			    WHERE rl.root_line_id=l.id AND rc.status='CONFIRMED'),0),
			  COALESCE((SELECT quantity_micros FROM vou_intermediary_receipt_lines
			    WHERE child_id=$2 AND root_line_id=l.id),0)
			FROM vou_intermediary_v2_lines l
			JOIN vou_intermediary_procurement_lines p ON p.root_line_id=l.id
			WHERE l.document_id=$1`, root.ID, child.ID)
		if err != nil {
			return err
		}
		for rows.Next() {
			var id string
			var ordered, confirmed, current int64
			if err = rows.Scan(&id, &ordered, &confirmed, &current); err != nil {
				rows.Close()
				return err
			}
			if confirmed+current > ordered {
				rows.Close()
				return domainError(ErrorConflict, "confirmed receipts exceed procurement", nil, nil)
			}
		}
		err = rows.Err()
		rows.Close()
		return err
	case stageDelivery:
		return validateDeliveryExecution(ctx, tx, root.ID, child.ID)
	case stageSignoff:
		return validateSignoffTotals(ctx, tx, root.ID, child.ID)
	}
	return nil
}

func validateDeliveryExecution(ctx context.Context, tx pgx.Tx, documentID, childID string) error {
	rows, err := tx.Query(ctx, `
		SELECT dl.root_line_id,dl.quantity_micros,d.delivery_date
		FROM vou_intermediary_delivery_lines dl JOIN vou_intermediary_deliveries d ON d.child_id=dl.child_id
		WHERE dl.child_id=$1`, childID)
	if err != nil {
		return err
	}
	type deliveryLine struct {
		id       string
		quantity int64
		date     pgtype.Date
	}
	lines := make([]deliveryLine, 0)
	for rows.Next() {
		var line deliveryLine
		if err = rows.Scan(&line.id, &line.quantity, &line.date); err != nil {
			rows.Close()
			return err
		}
		lines = append(lines, line)
	}
	if err = rows.Err(); err != nil {
		rows.Close()
		return err
	}
	rows.Close()
	for _, line := range lines {
		var received, delivered, rejected int64
		err = tx.QueryRow(ctx, `
			SELECT
			  COALESCE((SELECT sum(rl.quantity_micros) FROM vou_intermediary_receipt_lines rl
			    JOIN vou_intermediary_receipts r ON r.child_id=rl.child_id
			    JOIN vou_intermediary_children c ON c.id=rl.child_id
			    WHERE rl.root_line_id=$1 AND c.status='CONFIRMED' AND r.receipt_date <= $2),0),
			  COALESCE((SELECT sum(dl2.quantity_micros) FROM vou_intermediary_delivery_lines dl2
			    JOIN vou_intermediary_deliveries d2 ON d2.child_id=dl2.child_id
			    JOIN vou_intermediary_children c2 ON c2.id=dl2.child_id
			    WHERE dl2.root_line_id=$1 AND c2.status='EXECUTED' AND d2.delivery_date <= $2),0),
			  COALESCE((SELECT sum(sl.rejected_qty_micros) FROM vou_intermediary_signoff_lines sl
			    JOIN vou_intermediary_signoffs s ON s.child_id=sl.child_id
			    JOIN vou_intermediary_children c3 ON c3.id=sl.child_id
			    WHERE sl.root_line_id=$1 AND c3.status='CONFIRMED' AND s.signoff_date <= $2),0)`,
			line.id, line.date).Scan(&received, &delivered, &rejected)
		if err != nil {
			return err
		}
		if received-delivered+rejected < line.quantity {
			return domainError(ErrorConflict, "delivery exceeds date-aware available quantity", nil, nil)
		}
	}
	return nil
}

func validateSignoffTotals(ctx context.Context, tx pgx.Tx, documentID, childID string) error {
	rows, err := tx.Query(ctx, `
		SELECT l.id,l.ordered_qty_micros,
		  COALESCE((SELECT sum(sl.signed_qty_micros) FROM vou_intermediary_signoff_lines sl
		    JOIN vou_intermediary_children c ON c.id=sl.child_id
		    WHERE sl.root_line_id=l.id AND c.status='CONFIRMED'),0),
		  COALESCE((SELECT signed_qty_micros FROM vou_intermediary_signoff_lines
		    WHERE child_id=$2 AND root_line_id=l.id),0)
		FROM vou_intermediary_v2_lines l WHERE l.document_id=$1`, documentID, childID)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var id string
		var ordered, signed, current int64
		if err = rows.Scan(&id, &ordered, &signed, &current); err != nil {
			return err
		}
		if signed+current > ordered {
			return domainError(ErrorConflict, "signed quantity exceeds customer order", nil, nil)
		}
	}
	return rows.Err()
}

func validateReceiptRemoval(ctx context.Context, tx pgx.Tx, documentID, removedChildID string) error {
	var invalid int64
	err := tx.QueryRow(ctx, `
		WITH dates AS (
		  SELECT delivery_date AS d FROM vou_intermediary_deliveries d
		  JOIN vou_intermediary_children c ON c.id=d.child_id
		  WHERE c.document_id=$1 AND c.status='EXECUTED'
		), lines AS (SELECT id FROM vou_intermediary_v2_lines WHERE document_id=$1)
		SELECT count(*) FROM dates CROSS JOIN lines l
		WHERE
		  COALESCE((SELECT sum(rl.quantity_micros) FROM vou_intermediary_receipt_lines rl
		    JOIN vou_intermediary_receipts r ON r.child_id=rl.child_id
		    JOIN vou_intermediary_children c ON c.id=rl.child_id
		    WHERE rl.root_line_id=l.id AND c.status='CONFIRMED' AND r.receipt_date<=dates.d
		      AND rl.child_id<>$2),0)
		  - COALESCE((SELECT sum(dl.quantity_micros) FROM vou_intermediary_delivery_lines dl
		    JOIN vou_intermediary_deliveries d ON d.child_id=dl.child_id
		    JOIN vou_intermediary_children c ON c.id=dl.child_id
		    WHERE dl.root_line_id=l.id AND c.status='EXECUTED' AND d.delivery_date<=dates.d),0)
		  + COALESCE((SELECT sum(sl.rejected_qty_micros) FROM vou_intermediary_signoff_lines sl
		    JOIN vou_intermediary_signoffs s ON s.child_id=sl.child_id
		    JOIN vou_intermediary_children c ON c.id=sl.child_id
		    WHERE sl.root_line_id=l.id AND c.status='CONFIRMED' AND s.signoff_date<=dates.d),0) < 0`,
		documentID, removedChildID).Scan(&invalid)
	if err != nil {
		return err
	}
	if invalid != 0 {
		return domainError(ErrorConflict, "receipt reversal would make delivery pool negative", nil, nil)
	}
	return nil
}

func lockV2Child(ctx context.Context, tx pgx.Tx, documentID, stage, childID string) (v2Child, error) {
	var child v2Child
	err := tx.QueryRow(ctx, `SELECT id,document_id,stage,child_no,status,revision,
		created_by,updated_by,checked_by,final_by FROM vou_intermediary_children
		WHERE id=$1 AND document_id=$2 AND stage=$3 FOR UPDATE`,
		childID, documentID, stage).Scan(&child.ID, &child.DocumentID, &child.Stage,
		&child.ChildNo, &child.Status, &child.Revision, &child.CreatedBy, &child.UpdatedBy,
		&child.CheckedBy, &child.FinalBy)
	if errors.Is(err, pgx.ErrNoRows) {
		return child, domainError(ErrorValidation, "child document not found", nil, nil)
	}
	return child, err
}

func touchV2Root(ctx context.Context, tx pgx.Tx, id string, revision int64, actorID string) (int64, error) {
	var next int64
	err := tx.QueryRow(ctx, `UPDATE vou_documents SET revision=revision+1,updated_at=now(),updated_by=$1
		WHERE id=$2 AND revision=$3 RETURNING revision`, actorID, id, revision).Scan(&next)
	if err != nil {
		return 0, domainError(ErrorConflict, "root document changed", nil, err)
	}
	return next, nil
}

func maybeCompleteV2Root(
	ctx context.Context, tx pgx.Tx, documentID, currentStatus, actorID string,
) (string, error) {
	if currentStatus == StatusShortCloseRequested || currentStatus == StatusShortClosed {
		return currentStatus, nil
	}
	var incompleteLines, unfinished int64
	err := tx.QueryRow(ctx, `
		SELECT
		  (SELECT count(*) FROM vou_intermediary_v2_lines l WHERE l.document_id=$1
		    AND COALESCE((SELECT sum(sl.signed_qty_micros) FROM vou_intermediary_signoff_lines sl
		      JOIN vou_intermediary_children c ON c.id=sl.child_id
		      WHERE sl.root_line_id=l.id AND c.status='CONFIRMED'),0) <> l.ordered_qty_micros),
		  (SELECT count(*) FROM vou_intermediary_children c WHERE c.document_id=$1
		    AND (c.status IN ('DRAFT','CHECKED') OR
		      (c.stage='DELIVERY' AND c.status='EXECUTED' AND NOT EXISTS(
		        SELECT 1 FROM vou_intermediary_signoffs s JOIN vou_intermediary_children sc ON sc.id=s.child_id
		        WHERE s.delivery_child_id=c.id AND sc.status='CONFIRMED'))))`,
		documentID).Scan(&incompleteLines, &unfinished)
	if err != nil {
		return currentStatus, err
	}
	target := StatusApproved
	if incompleteLines == 0 && unfinished == 0 {
		target = StatusCompleted
	}
	if target == currentStatus {
		return currentStatus, nil
	}
	if target == StatusCompleted {
		_, err = tx.Exec(ctx, `UPDATE vou_documents SET status='COMPLETED',completed_at=now(),
			revision=revision+1,updated_at=now(),updated_by=$1 WHERE id=$2`, actorID, documentID)
	} else if currentStatus == StatusCompleted {
		_, err = tx.Exec(ctx, `UPDATE vou_documents SET status='APPROVED',completed_at=NULL,
			revision=revision+1,updated_at=now(),updated_by=$1 WHERE id=$2`, actorID, documentID)
	} else {
		return currentStatus, nil
	}
	return target, err
}

func loadV2Lines(ctx context.Context, tx pgx.Tx, documentID string) (map[string]v2Line, error) {
	rows, err := tx.Query(ctx, `SELECT id,line_no,product_object_id,product_version_id,product_code,
		product_name,product_unit,ordered_qty_micros,sale_unit_price_cents,line_amount_cents,
		container_type,quantity_per_container_micros,COALESCE(remark,'')
		FROM vou_intermediary_v2_lines WHERE document_id=$1 ORDER BY line_no`, documentID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := map[string]v2Line{}
	for rows.Next() {
		var line v2Line
		if err = rows.Scan(&line.ID, &line.LineNo, &line.ProductObjectID, &line.ProductVersionID,
			&line.ProductCode, &line.ProductName, &line.ProductUnit, &line.Ordered, &line.SalePrice,
			&line.LineAmount, &line.ContainerType, &line.QuantityPerContainer, &line.Remark); err != nil {
			return nil, err
		}
		result[line.ID] = line
	}
	return result, rows.Err()
}

func loadDeliveryLineQuantities(ctx context.Context, tx pgx.Tx, childID string) (map[string]int64, error) {
	rows, err := tx.Query(ctx, `SELECT root_line_id,quantity_micros
		FROM vou_intermediary_delivery_lines WHERE child_id=$1`, childID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := map[string]int64{}
	for rows.Next() {
		var id string
		var quantity int64
		if err = rows.Scan(&id, &quantity); err != nil {
			return nil, err
		}
		result[id] = quantity
	}
	return result, rows.Err()
}

func expectedContainers(ctx context.Context, tx pgx.Tx, lines []fixedQuantityLine) (int64, int64, error) {
	var solvent, resin int64
	for _, line := range lines {
		var containerType string
		var per *int64
		if err := tx.QueryRow(ctx, `SELECT container_type,quantity_per_container_micros
			FROM vou_intermediary_v2_lines WHERE id=$1`, line.rootLineID).Scan(&containerType, &per); err != nil {
			return 0, 0, err
		}
		if per == nil || line.quantity == 0 {
			continue
		}
		count := (line.quantity + *per - 1) / *per
		if containerType == bobdomain.ContainerTypeSolvent {
			solvent += count
		} else if containerType == bobdomain.ContainerTypeResin {
			resin += count
		}
	}
	return solvent, resin, nil
}

func parseV2Date(value, field string) (time.Time, error) {
	parsed, err := time.Parse(dateLayout, strings.TrimSpace(value))
	if err != nil {
		return time.Time{}, domainError(ErrorValidation, "invalid "+field, nil, err)
	}
	return parsed, nil
}

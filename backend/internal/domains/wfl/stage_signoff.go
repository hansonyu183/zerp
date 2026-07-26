package wfl

import (
	"context"
	"strings"
	"time"

	voudomain "github.com/hansonyu183/zerp-back/internal/domains/vou"
	"github.com/jackc/pgx/v5"
)

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

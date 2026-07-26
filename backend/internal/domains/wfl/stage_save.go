package wfl

import (
	"context"
	"encoding/json"
	"strings"

	"github.com/jackc/pgx/v5"
)

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

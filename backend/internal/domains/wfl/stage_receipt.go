package wfl

import (
	"context"
	"strings"
	"time"

	voudomain "github.com/hansonyu183/zerp-back/internal/domains/vou"
	"github.com/jackc/pgx/v5"
)

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

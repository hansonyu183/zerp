package wfl

import (
	"context"
	"strings"
	"time"

	bobdomain "github.com/hansonyu183/zerp-back/internal/domains/bob"
	voudomain "github.com/hansonyu183/zerp-back/internal/domains/vou"
	"github.com/jackc/pgx/v5"
)

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

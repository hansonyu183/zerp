package wfl

import (
	"context"
	"strings"
	"time"

	bobdomain "github.com/hansonyu183/zerp-back/internal/domains/bob"
	voudomain "github.com/hansonyu183/zerp-back/internal/domains/vou"
	"github.com/jackc/pgx/v5"
)

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

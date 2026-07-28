package vou

import (
	"context"

	dbsqlc "github.com/hansonyu183/zerp/backend/internal/database/sqlc"
)

func (s *Service) loadManagedData(
	ctx context.Context,
	document dbsqlc.VouDocument,
	data DocumentDataView,
) (DocumentDataView, error) {
	switch document.Entity {
	case EntityCustomerOrder:
		var customerID, customerVersion, customerCode, customerName string
		var salespersonID, salespersonVersion, salespersonCode, salespersonName string
		var contact, phone, address *string
		var settlementID, settlementVersion, settlementCode, settlementName, rule string
		var monthOffset, dayOffset int32
		var dayOfMonth *int32
		err := s.pool.QueryRow(ctx, `SELECT customer_object_id,customer_version_id,customer_code,customer_name,
			salesperson_object_id,salesperson_version_id,salesperson_code,salesperson_name,
			contact_name,contact_phone,delivery_address,settlement_object_id,settlement_version_id,
			settlement_code,settlement_name,settlement_rule_type,settlement_month_offset,
			settlement_day_of_month,settlement_day_offset
			FROM vou_customer_order_details WHERE document_id=$1`, document.ID).
			Scan(&customerID, &customerVersion, &customerCode, &customerName,
				&salespersonID, &salespersonVersion, &salespersonCode, &salespersonName,
				&contact, &phone, &address, &settlementID, &settlementVersion,
				&settlementCode, &settlementName, &rule, &monthOffset, &dayOfMonth, &dayOffset)
		if err != nil {
			return data, err
		}
		data.Customer = reference(customerID, customerVersion, "customer", customerCode, customerName, "", "", "")
		data.Salesperson = reference(salespersonID, salespersonVersion, "employee", salespersonCode, salespersonName, "", "", "")
		data.ContactName, data.ContactPhone, data.DeliveryAddress = deref(contact), deref(phone), deref(address)
		data.SettlementMethod = &SettlementMethodSnapshotView{
			ObjectID: settlementID, VersionID: settlementVersion, Code: settlementCode, Name: settlementName,
			RuleType: rule, MonthOffset: monthOffset, DayOfMonth: dayOfMonth, DayOffset: dayOffset,
		}
		rows, err := s.pool.Query(ctx, `SELECT id,line_no,product_object_id,product_version_id,
			product_code,product_name,product_unit,ordered_qty_micros,sale_unit_price_cents,
			line_amount_cents,container_type,quantity_per_container_micros,remark
			FROM vou_customer_order_lines WHERE document_id=$1 ORDER BY line_no`, document.ID)
		if err != nil {
			return data, err
		}
		defer rows.Close()
		for rows.Next() {
			var line ManagedLineView
			var objectID, versionID, code, name, unit string
			var quantity, price, amount int64
			var perContainer *int64
			var remark *string
			if err = rows.Scan(&line.LineID, &line.LineNo, &objectID, &versionID, &code, &name, &unit,
				&quantity, &price, &amount, &line.ContainerType, &perContainer, &remark); err != nil {
				return data, err
			}
			line.Product = reference(objectID, versionID, "product", code, name, unit, "", "")
			line.OrderedQuantity, line.UnitPrice, line.LineAmount = formatQuantity(quantity), formatMoney(price), formatMoney(amount)
			if perContainer != nil {
				line.QuantityPerContainer = formatQuantity(*perContainer)
			}
			line.Remark = deref(remark)
			data.Lines = append(data.Lines, line)
		}
		return data, rows.Err()
	case EntityProcurementOrder:
		var supplierID, supplierVersion, supplierCode, supplierName string
		var purchaserID, purchaserVersion, purchaserCode, purchaserName string
		var contact, phone *string
		var settlementID, settlementVersion, settlementCode, settlementName, rule string
		var monthOffset, dayOffset int32
		var dayOfMonth *int32
		err := s.pool.QueryRow(ctx, `SELECT supplier_object_id,supplier_version_id,supplier_code,supplier_name,
			purchaser_object_id,purchaser_version_id,purchaser_code,purchaser_name,contact_name,contact_phone,
			settlement_object_id,settlement_version_id,settlement_code,settlement_name,settlement_rule_type,
			settlement_month_offset,settlement_day_of_month,settlement_day_offset
			FROM vou_procurement_order_details WHERE document_id=$1`, document.ID).
			Scan(&supplierID, &supplierVersion, &supplierCode, &supplierName,
				&purchaserID, &purchaserVersion, &purchaserCode, &purchaserName, &contact, &phone,
				&settlementID, &settlementVersion, &settlementCode, &settlementName, &rule,
				&monthOffset, &dayOfMonth, &dayOffset)
		if err != nil {
			return data, err
		}
		data.Supplier = reference(supplierID, supplierVersion, "supplier", supplierCode, supplierName, "", "", "")
		data.Purchaser = reference(purchaserID, purchaserVersion, "employee", purchaserCode, purchaserName, "", "", "")
		data.ContactName, data.ContactPhone = deref(contact), deref(phone)
		data.SettlementMethod = &SettlementMethodSnapshotView{
			ObjectID: settlementID, VersionID: settlementVersion, Code: settlementCode, Name: settlementName,
			RuleType: rule, MonthOffset: monthOffset, DayOfMonth: dayOfMonth, DayOffset: dayOffset,
		}
		return s.loadManagedQuantityLines(ctx, document.ID, data, `SELECT p.id,p.source_customer_line_id,
			c.product_object_id,c.product_version_id,c.product_code,c.product_name,c.product_unit,
			p.quantity_micros,p.unit_price_cents,p.line_amount_cents,p.remark
			FROM vou_procurement_order_lines p JOIN vou_customer_order_lines c ON c.id=p.source_customer_line_id
			WHERE p.document_id=$1 ORDER BY c.line_no`)
	case EntityGoodsReceipt:
		var supplierID, supplierVersion, supplierCode, supplierName string
		if err := s.pool.QueryRow(ctx, `SELECT supplier_object_id,supplier_version_id,supplier_code,supplier_name
			FROM vou_goods_receipt_details WHERE document_id=$1`, document.ID).
			Scan(&supplierID, &supplierVersion, &supplierCode, &supplierName); err != nil {
			return data, err
		}
		data.Supplier = reference(supplierID, supplierVersion, "supplier", supplierCode, supplierName, "", "", "")
		return s.loadManagedQuantityLines(ctx, document.ID, data, `SELECT r.id,r.source_procurement_line_id,
			c.product_object_id,c.product_version_id,c.product_code,c.product_name,c.product_unit,
			r.quantity_micros,r.purchase_unit_price_cents,r.line_amount_cents,r.remark
			FROM vou_goods_receipt_lines r
			JOIN vou_procurement_order_lines p ON p.id=r.source_procurement_line_id
			JOIN vou_customer_order_lines c ON c.id=p.source_customer_line_id
			WHERE r.document_id=$1 ORDER BY c.line_no`)
	case EntityDeliveryNote:
		var customerID, customerVersion, customerCode, customerName string
		var platformID, platformVersion, platformCode, platformName string
		var vehicleID, vehicleVersion, vehicleCode, vehicleName, plate string
		err := s.pool.QueryRow(ctx, `SELECT customer_object_id,customer_version_id,customer_code,customer_name,
			platform_object_id,platform_version_id,platform_code,platform_name,
			vehicle_object_id,vehicle_version_id,vehicle_code,vehicle_name,vehicle_plate_number,
			expected_solvent_containers,expected_resin_containers
			FROM vou_delivery_note_details WHERE document_id=$1`, document.ID).
			Scan(&customerID, &customerVersion, &customerCode, &customerName,
				&platformID, &platformVersion, &platformCode, &platformName,
				&vehicleID, &vehicleVersion, &vehicleCode, &vehicleName, &plate,
				&data.ExpectedSolventContainers, &data.ExpectedResinContainers)
		if err != nil {
			return data, err
		}
		data.Customer = reference(customerID, customerVersion, "customer", customerCode, customerName, "", "", "")
		data.Platform = reference(platformID, platformVersion, "supplier", platformCode, platformName, "", "", "")
		data.Vehicle = reference(vehicleID, vehicleVersion, "vehicle", vehicleCode, vehicleName, "", "", plate)
		return s.loadManagedQuantityLines(ctx, document.ID, data, `SELECT d.id,d.source_customer_line_id,
			c.product_object_id,c.product_version_id,c.product_code,c.product_name,c.product_unit,
			d.quantity_micros,d.sale_unit_price_cents,d.line_amount_cents,d.remark
			FROM vou_delivery_note_lines d JOIN vou_customer_order_lines c ON c.id=d.source_customer_line_id
			WHERE d.document_id=$1 ORDER BY c.line_no`)
	case EntitySignoffNote:
		var customerID, customerVersion, customerCode, customerName string
		var containerDifferenceReason *string
		if err := s.pool.QueryRow(ctx, `SELECT customer_object_id,customer_version_id,customer_code,customer_name,
			returned_solvent_containers,returned_resin_containers,container_difference_reason
			FROM vou_signoff_note_details WHERE document_id=$1`, document.ID).
			Scan(&customerID, &customerVersion, &customerCode, &customerName,
				&data.ReturnedSolventContainers, &data.ReturnedResinContainers,
				&containerDifferenceReason); err != nil {
			return data, err
		}
		data.ContainerDifferenceReason = deref(containerDifferenceReason)
		data.Customer = reference(customerID, customerVersion, "customer", customerCode, customerName, "", "", "")
		rows, err := s.pool.Query(ctx, `SELECT s.id,s.source_delivery_line_id,
			c.product_object_id,c.product_version_id,c.product_code,c.product_name,c.product_unit,
			s.signed_qty_micros,s.rejected_qty_micros,s.loss_qty_micros,
			s.sale_unit_price_cents,s.line_amount_cents,s.remark
			FROM vou_signoff_note_lines s
			JOIN vou_delivery_note_lines d ON d.id=s.source_delivery_line_id
			JOIN vou_customer_order_lines c ON c.id=d.source_customer_line_id
			WHERE s.document_id=$1 ORDER BY c.line_no`, document.ID)
		if err != nil {
			return data, err
		}
		defer rows.Close()
		for rows.Next() {
			var line ManagedLineView
			var objectID, versionID, code, name, unit string
			var signed, rejected, loss, price, amount int64
			var remark *string
			if err = rows.Scan(&line.LineID, &line.SourceLineID, &objectID, &versionID, &code, &name, &unit,
				&signed, &rejected, &loss, &price, &amount, &remark); err != nil {
				return data, err
			}
			line.Product = reference(objectID, versionID, "product", code, name, unit, "", "")
			line.SignedQuantity, line.RejectedQuantity, line.LossQuantity =
				formatQuantity(signed), formatQuantity(rejected), formatQuantity(loss)
			line.UnitPrice, line.LineAmount, line.Remark = formatMoney(price), formatMoney(amount), deref(remark)
			data.Lines = append(data.Lines, line)
		}
		return data, rows.Err()
	default:
		return data, nil
	}
}

func (s *Service) loadManagedQuantityLines(
	ctx context.Context,
	documentID string,
	data DocumentDataView,
	statement string,
) (DocumentDataView, error) {
	rows, err := s.pool.Query(ctx, statement, documentID)
	if err != nil {
		return data, err
	}
	defer rows.Close()
	for rows.Next() {
		var line ManagedLineView
		var objectID, versionID, code, name, unit string
		var quantity int64
		var price, amount *int64
		var remark *string
		if err = rows.Scan(&line.LineID, &line.SourceLineID, &objectID, &versionID, &code, &name, &unit,
			&quantity, &price, &amount, &remark); err != nil {
			return data, err
		}
		line.Product = reference(objectID, versionID, "product", code, name, unit, "", "")
		line.Quantity, line.Remark = formatQuantity(quantity), deref(remark)
		if price != nil {
			line.UnitPrice = formatMoney(*price)
		}
		if amount != nil {
			line.LineAmount = formatMoney(*amount)
		}
		data.Lines = append(data.Lines, line)
	}
	return data, rows.Err()
}

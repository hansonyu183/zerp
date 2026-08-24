package vou

import (
	"context"

	dbsqlc "github.com/hansonyu183/zerp/backend/internal/database/sqlc"
	bobdomain "github.com/hansonyu183/zerp/backend/internal/domains/bob"
	"github.com/hansonyu183/zerp/backend/internal/platform/systemidentity"
	"github.com/jackc/pgx/v5"
)

func (s *Service) loadSalesChainData(
	ctx context.Context, document dbsqlc.VouDocument, data DocumentDataView,
) (DocumentDataView, error) {
	switch document.Entity {
	case EntitySaleOutbound:
		var sourceID, sourceNo string
		var customer ReferenceView
		var warehouse ReferenceView
		err := s.pool.QueryRow(ctx, `SELECT x.source_order_id,p.document_no,
			x.customer_object_id,x.customer_version_id,x.customer_code,x.customer_name,
			COALESCE(x.warehouse_object_id,''),COALESCE(x.warehouse_version_id,''),
			COALESCE(x.warehouse_code,''),COALESCE(x.warehouse_name,'')
			FROM vou_sale_outbound_details x JOIN vou_documents p ON p.id=x.source_order_id
			WHERE x.document_id=$1`, document.ID).Scan(
			&sourceID, &sourceNo,
			&customer.ObjectID, &customer.VersionID, &customer.Code, &customer.Name,
			&warehouse.ObjectID, &warehouse.VersionID, &warehouse.Code, &warehouse.Name)
		if err != nil {
			return data, err
		}
		customer.Entity, warehouse.Entity = bobdomain.EntityCustomerAccount, "warehouse"
		data.Customer = &customer
		if warehouse.ObjectID != "" {
			data.Warehouse = &warehouse
		}
		rows, err := s.pool.Query(ctx, `SELECT id,source_order_line_id,line_no,
			product_object_id,product_version_id,product_code,product_name,entered_unit_symbol,
			base_quantity_micros,unit_price_cents,line_amount_cents,remark
			FROM vou_sale_outbound_lines WHERE document_id=$1 ORDER BY line_no`, document.ID)
		if err != nil {
			return data, err
		}
		defer rows.Close()
		for rows.Next() {
			var line ProductLineView
			var quantity, price, amount int64
			var remark *string
			if err = rows.Scan(
				&line.LineID, &line.SourceLineID, &line.LineNo,
				&line.Product.ObjectID, &line.Product.VersionID, &line.Product.Code,
				&line.Product.Name, &line.Product.Unit, &quantity, &price, &amount, &remark,
			); err != nil {
				return data, err
			}
			line.Product.Entity = "product"
			line.BaseQuantity = formatQuantity(quantity)
			line.EnteredQuantity = line.BaseQuantity
			line.EnteredUnit = UnitSnapshotView{Symbol: line.Product.Unit}
			line.UnitPrice, line.LineAmount, line.Remark = formatMoney(price), formatMoney(amount), deref(remark)
			data.ProductLines = append(data.ProductLines, line)
		}
		return data, rows.Err()
	case EntitySaleDelivery:
		var sourceID, sourceNo string
		var customer ReferenceView
		var carrierType string
		var operatingEntity ReferenceView
		var carrier ReferenceView
		var vehicle ReferenceView
		var vehicleBulkLiquidCapable bool
		err := s.pool.QueryRow(ctx, `SELECT x.source_outbound_id,p.document_no,
			x.customer_object_id,x.customer_version_id,x.customer_code,x.customer_name,
			x.carrier_type,
			COALESCE(x.carrier_operating_entity_object_id,''),COALESCE(x.carrier_operating_entity_version_id,''),
			COALESCE(x.carrier_operating_entity_code,''),COALESCE(x.carrier_operating_entity_name,''),
			COALESCE(x.carrier_service_relationship_object_id,''),COALESCE(x.carrier_service_relationship_version_id,''),
			COALESCE(x.carrier_service_relationship_code,''),COALESCE(x.carrier_service_relationship_name,''),
			COALESCE(x.vehicle_object_id,''),COALESCE(x.vehicle_version_id,''),
			COALESCE(x.vehicle_code,''),COALESCE(x.vehicle_name,''),
			COALESCE(x.vehicle_plate_number,''),x.vehicle_bulk_liquid_capable
			FROM vou_sale_delivery_details x JOIN vou_documents p ON p.id=x.source_outbound_id
			WHERE x.document_id=$1`, document.ID).Scan(
			&sourceID, &sourceNo,
			&customer.ObjectID, &customer.VersionID, &customer.Code, &customer.Name,
			&carrierType,
			&operatingEntity.ObjectID, &operatingEntity.VersionID, &operatingEntity.Code, &operatingEntity.Name,
			&carrier.ObjectID, &carrier.VersionID, &carrier.Code, &carrier.Name,
			&vehicle.ObjectID, &vehicle.VersionID, &vehicle.Code, &vehicle.Name, &vehicle.PlateNumber,
			&vehicleBulkLiquidCapable)
		if err != nil {
			return data, err
		}
		customer.Entity, operatingEntity.Entity, carrier.Entity, vehicle.Entity =
			bobdomain.EntityCustomerAccount, bobdomain.EntityOperatingEntity, bobdomain.EntityOtherUnit, bobdomain.EntityVehicle
		data.Customer = &customer
		data.CarrierType = carrierType
		if operatingEntity.ObjectID != "" {
			data.CarrierOperatingEntity = &operatingEntity
		}
		if carrier.ObjectID != "" {
			data.Carrier = &carrier
		}
		if vehicle.ObjectID != "" {
			data.Vehicle = &vehicle
			data.VehicleBulkLiquidCapable = vehicleBulkLiquidCapable
		}
		rows, err := s.pool.Query(ctx, `SELECT id,source_order_line_id,line_no,
			product_object_id,product_version_id,product_code,product_name,entered_unit_symbol,
			base_quantity_micros,unit_price_cents,line_amount_cents,remark
			FROM vou_sale_outbound_lines WHERE document_id=$1 ORDER BY line_no`, sourceID)
		if err != nil {
			return data, err
		}
		defer rows.Close()
		for rows.Next() {
			var line ProductLineView
			var quantity, price, amount int64
			var remark *string
			if err = rows.Scan(
				&line.LineID, &line.SourceLineID, &line.LineNo,
				&line.Product.ObjectID, &line.Product.VersionID, &line.Product.Code,
				&line.Product.Name, &line.Product.Unit, &quantity, &price, &amount, &remark,
			); err != nil {
				return data, err
			}
			line.Product.Entity = "product"
			line.BaseQuantity = formatQuantity(quantity)
			line.EnteredQuantity = line.BaseQuantity
			line.EnteredUnit = UnitSnapshotView{Symbol: line.Product.Unit}
			line.UnitPrice, line.LineAmount, line.Remark = formatMoney(price), formatMoney(amount), deref(remark)
			data.ProductLines = append(data.ProductLines, line)
		}
		return data, rows.Err()
	case EntitySaleSignoff:
		var sourceID, sourceNo string
		var customer ReferenceView
		var warehouse ReferenceView
		err := s.pool.QueryRow(ctx, `SELECT x.source_delivery_id,p.document_no,
			x.customer_object_id,x.customer_version_id,x.customer_code,x.customer_name,
			x.warehouse_object_id,x.warehouse_version_id,x.warehouse_code,x.warehouse_name
			FROM vou_sale_signoff_details x JOIN vou_documents p ON p.id=x.source_delivery_id
			WHERE x.document_id=$1`, document.ID).Scan(
			&sourceID, &sourceNo,
			&customer.ObjectID, &customer.VersionID, &customer.Code, &customer.Name,
			&warehouse.ObjectID, &warehouse.VersionID, &warehouse.Code, &warehouse.Name)
		if err != nil {
			return data, err
		}
		customer.Entity, warehouse.Entity = bobdomain.EntityCustomerAccount, "warehouse"
		data.Customer, data.Warehouse = &customer, &warehouse
		rows, err := s.pool.Query(ctx, `SELECT id,source_outbound_line_id,line_no,
			product_object_id,product_version_id,product_code,product_name,entered_unit_symbol,
			signed_base_quantity_micros,rejected_base_quantity_micros,loss_base_quantity_micros,unit_price_cents,line_amount_cents,remark,
			signed_base_quantity_micros+rejected_base_quantity_micros+loss_base_quantity_micros
			FROM vou_sale_signoff_lines WHERE document_id=$1 ORDER BY line_no`, document.ID)
		if err != nil {
			return data, err
		}
		defer rows.Close()
		for rows.Next() {
			var line SaleSignoffLineView
			var signed, rejected, loss, price, amount, outbound int64
			var remark *string
			if err = rows.Scan(
				&line.LineID, &line.SourceLineID, &line.LineNo,
				&line.Product.ObjectID, &line.Product.VersionID, &line.Product.Code,
				&line.Product.Name, &line.Product.Unit, &signed, &rejected, &loss,
				&price, &amount, &remark, &outbound,
			); err != nil {
				return data, err
			}
			line.Product.Entity = "product"
			line.EnteredQuantity = formatQuantity(outbound)
			line.EnteredUnit = UnitSnapshotView{Symbol: line.Product.Unit}
			line.OutboundBaseQuantity, line.SignedBaseQuantity = formatQuantity(outbound), formatQuantity(signed)
			line.RejectedBaseQuantity, line.LossBaseQuantity = formatQuantity(rejected), formatQuantity(loss)
			line.UnitPrice, line.LineAmount, line.Remark = formatMoney(price), formatMoney(amount), deref(remark)
			var returned int64
			if err = s.pool.QueryRow(ctx, `SELECT COALESCE(sum(l.base_quantity_micros),0)
				FROM vou_sale_return_lines l
				JOIN vou_sale_return_details d ON d.document_id=l.document_id
				WHERE l.source_signoff_line_id=$1 AND d.return_kind='AFTER_SALE'`, line.LineID).
				Scan(&returned); err != nil {
				return data, err
			}
			returnable := signed - returned
			if returnable < 0 {
				returnable = 0
			}
			line.ReturnableBaseQuantity = formatQuantity(returnable)
			data.SignoffLines = append(data.SignoffLines, line)
		}
		return data, rows.Err()
	default:
		return data, domainError(ErrorValidation, "invalid sales-chain entity", nil, nil)
	}
}

func (s *Service) setSaleOrderBalances(
	ctx context.Context, orderID string, data *DocumentDataView,
) error {
	rows, err := s.pool.Query(ctx, `SELECT l.id,l.base_quantity_micros,
		COALESCE(sum(CASE WHEN sd.status = 'APPROVED' THEN sl.signed_base_quantity_micros ELSE 0 END),0)::bigint,
		COALESCE(sum(CASE WHEN od.status = 'APPROVED' AND (sd.id IS NULL OR sd.status <> 'APPROVED')
			THEN ol.base_quantity_micros ELSE 0 END),0)::bigint
		FROM vou_product_lines l
		LEFT JOIN vou_sale_outbound_lines ol ON ol.source_order_line_id=l.id
		LEFT JOIN vou_documents od ON od.id=ol.document_id
		LEFT JOIN vou_sale_signoff_lines sl ON sl.source_outbound_line_id=ol.id
		LEFT JOIN vou_documents sd ON sd.id=sl.document_id
		WHERE l.document_id=$1 GROUP BY l.id,l.base_quantity_micros`, orderID)
	if err != nil {
		return err
	}
	defer rows.Close()
	byID := map[string][3]int64{}
	var totalSigned, totalTransit, totalRemaining int64
	for rows.Next() {
		var id string
		var ordered, signed, transit int64
		if err = rows.Scan(&id, &ordered, &signed, &transit); err != nil {
			return err
		}
		remaining := ordered - signed - transit
		if remaining < 0 {
			remaining = 0
		}
		byID[id] = [3]int64{signed, transit, remaining}
		totalSigned += signed
		totalTransit += transit
		totalRemaining += remaining
	}
	if err = rows.Err(); err != nil {
		return err
	}
	for index := range data.ProductLines {
		balance := byID[data.ProductLines[index].LineID]
		data.ProductLines[index].SignedBaseQuantity = formatQuantity(balance[0])
		data.ProductLines[index].OutboundBaseQuantity = formatQuantity(balance[1])
		data.ProductLines[index].AvailableBaseQuantity = formatQuantity(balance[2])
	}
	data.SignedBaseQuantity = formatQuantity(totalSigned)
	data.InTransitBaseQuantity = formatQuantity(totalTransit)
	data.RemainingBaseQuantity = formatQuantity(totalRemaining)
	return nil
}

func (s *Service) validateSalesChainStored(
	ctx context.Context, entity, documentID string,
) error {
	var sourceStatus string
	var lineCount int64
	complete := false
	switch entity {
	case EntitySaleOutbound:
		err := s.pool.QueryRow(ctx, `SELECT p.status,
			(SELECT count(*) FROM vou_sale_outbound_lines WHERE document_id=x.document_id),
			x.warehouse_object_id IS NOT NULL
			FROM vou_sale_outbound_details x JOIN vou_documents p ON p.id=x.source_order_id
			WHERE x.document_id=$1`, documentID).
			Scan(&sourceStatus, &lineCount, &complete)
		if err != nil {
			return s.internal("validate sale outbound", err)
		}
	case EntitySaleDelivery:
		err := s.pool.QueryRow(ctx, `SELECT p.status,1,
			x.carrier_type IS NOT NULL AND x.vehicle_object_id IS NOT NULL
			FROM vou_sale_delivery_details x
			JOIN vou_documents p ON p.id=x.source_outbound_id WHERE x.document_id=$1`,
			documentID).Scan(&sourceStatus, &lineCount, &complete)
		if err != nil {
			return s.internal("validate sale delivery", err)
		}
	case EntitySaleSignoff:
		err := s.pool.QueryRow(ctx, `SELECT p.status,
			(SELECT count(*) FROM vou_sale_signoff_lines WHERE document_id=x.document_id),true
			FROM vou_sale_signoff_details x JOIN vou_documents p ON p.id=x.source_delivery_id
			WHERE x.document_id=$1`, documentID).
			Scan(&sourceStatus, &lineCount, &complete)
		if err != nil {
			return s.internal("validate sale signoff", err)
		}
	}
	sourceReady := sourceStatus == StatusApproved
	if !sourceReady || lineCount == 0 || !complete {
		return domainError(ErrorConflict, "sales-chain source is not ready", nil, nil)
	}
	return nil
}

func (s *Service) prepareSalesChainApproval(
	ctx context.Context, tx pgx.Tx, document dbsqlc.VouDocument,
) (map[string]any, error) {
	if document.Entity == EntitySaleOutbound {
		var orderID, fulfillment string
		if err := tx.QueryRow(ctx, `SELECT x.source_order_id,o.fulfillment_status
			FROM vou_sale_outbound_details x JOIN vou_sale_order_details o ON o.document_id=x.source_order_id
			JOIN vou_documents d ON d.id=x.source_order_id
			WHERE x.document_id=$1 AND d.status = 'APPROVED' FOR UPDATE OF d`,
			document.ID).Scan(&orderID, &fulfillment); err != nil {
			return nil, domainError(ErrorConflict, "sale order is not approved", nil, err)
		}
		if fulfillment == "FULFILLED" {
			return nil, domainError(ErrorConflict, "sale order is closed", nil, nil)
		}
		rows, err := tx.Query(ctx, `SELECT ol.source_order_line_id,ol.base_quantity_micros,l.base_quantity_micros,
			COALESCE((SELECT sum(sl.signed_base_quantity_micros) FROM vou_sale_signoff_lines sl
				JOIN vou_documents sd ON sd.id=sl.document_id AND sd.status = 'APPROVED'
				WHERE sl.source_order_line_id=l.id),0)::bigint,
			COALESCE((SELECT sum(other.base_quantity_micros) FROM vou_sale_outbound_lines other
				JOIN vou_documents od ON od.id=other.document_id AND od.status = 'APPROVED'
				LEFT JOIN vou_sale_signoff_lines sl2 ON sl2.source_outbound_line_id=other.id
				LEFT JOIN vou_documents sd2 ON sd2.id=sl2.document_id
				WHERE other.source_order_line_id=l.id
				AND (sd2.id IS NULL OR sd2.status <> 'APPROVED')),0)::bigint
			FROM vou_sale_outbound_lines ol JOIN vou_product_lines l ON l.id=ol.source_order_line_id
			WHERE ol.document_id=$1`, document.ID)
		if err != nil {
			return nil, err
		}
		defer rows.Close()
		for rows.Next() {
			var lineID string
			var quantity, ordered, signed, transit int64
			if err = rows.Scan(&lineID, &quantity, &ordered, &signed, &transit); err != nil {
				return nil, err
			}
			if quantity > ordered-signed-transit {
				return nil, domainError(ErrorConflict, "outbound quantity exceeds available order quantity",
					map[string]any{"sourceLineId": lineID}, nil)
			}
		}
		if err = rows.Err(); err != nil {
			return nil, err
		}
		return map[string]any{"parentDocumentId": orderID}, nil
	}
	var sourceStatus string
	if err := tx.QueryRow(ctx, `SELECT p.status FROM vou_documents d
		JOIN vou_documents p ON p.id=d.parent_document_id
		WHERE d.id=$1 FOR UPDATE OF p`, document.ID).Scan(&sourceStatus); err != nil ||
		sourceStatus != StatusApproved {
		return nil, domainError(ErrorConflict, "sales-chain source is not approved", nil, err)
	}
	return map[string]any{"parentDocumentId": document.ParentDocumentID}, nil
}

func (s *Service) refreshSaleOrderFulfillment(
	ctx context.Context, tx pgx.Tx, signoffID, _ string,
) error {
	actorID := systemidentity.UserID
	var orderID, current string
	if err := tx.QueryRow(ctx, `SELECT x.source_order_id,o.fulfillment_status
		FROM vou_sale_signoff_details x JOIN vou_sale_order_details o ON o.document_id=x.source_order_id
		WHERE x.document_id=$1 FOR UPDATE OF o`, signoffID).Scan(&orderID, &current); err != nil {
		return err
	}
	var remaining int64
	err := tx.QueryRow(ctx, `SELECT COALESCE(sum(GREATEST(l.base_quantity_micros -
		COALESCE((SELECT sum(sl.signed_base_quantity_micros) FROM vou_sale_signoff_lines sl
			JOIN vou_documents sd ON sd.id=sl.document_id AND sd.status = 'APPROVED'
			WHERE sl.source_order_line_id=l.id),0),0)),0)::bigint
		FROM vou_product_lines l WHERE l.document_id=$1`, orderID).Scan(&remaining)
	if err != nil {
		return err
	}
	next := current
	if current == "OPEN" && remaining == 0 {
		next = "FULFILLED"
	}
	if current == "FULFILLED" && remaining > 0 {
		next = "OPEN"
	}
	if next != current {
		_, err = tx.Exec(ctx, `UPDATE vou_sale_order_details SET fulfillment_status=$1 WHERE document_id=$2`,
			next, orderID)
		if err == nil {
			_, err = tx.Exec(ctx, `UPDATE vou_documents SET revision=revision+1,updated_at=now(),updated_by=$1
				WHERE id=$2`, actorID, orderID)
		}
	}
	return err
}

func (s *Service) Delete(
	ctx context.Context, entity string, input DeleteInput, actorID, requestID string,
) (MutationResult, error) {
	if entity == EntityPurchaseInbound {
		return s.DeletePurchaseInbound(ctx, input, actorID, requestID)
	}
	if !validEntity(entity) {
		return MutationResult{}, domainError(ErrorValidation, "invalid entity", nil, nil)
	}
	reason, err := validateReverse(input)
	if err != nil {
		return MutationResult{}, err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return MutationResult{}, s.internal("begin delete draft", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	var number, status string
	var parentID *string
	var revision int64
	err = tx.QueryRow(ctx, `SELECT document_no,status,revision,parent_document_id
		FROM vou_documents WHERE id=$1 AND entity=$2 FOR UPDATE`,
		input.DocumentID, entity).Scan(&number, &status, &revision, &parentID)
	if err = documentWriteConflict(err, revision, input.Revision, status, StatusDraft); err != nil {
		return MutationResult{}, err
	}
	if entity == EntitySaleReturn {
		var kind string
		if err = tx.QueryRow(ctx, `SELECT return_kind FROM vou_sale_return_details
			WHERE document_id=$1`, input.DocumentID).Scan(&kind); err != nil {
			return MutationResult{}, err
		}
		if kind == returnKindRefusal {
			return MutationResult{}, domainError(ErrorConflict, "workflow refusal return cannot be deleted", nil, nil)
		}
	}
	if entity == EntityIntermediaryCalculation {
		q := s.queries.WithTx(tx)
		if err = s.requireNoIntermediaryCalculationDependents(ctx, q, input.DocumentID); err != nil {
			return MutationResult{}, err
		}
	}
	var attachments, children int64
	if err = tx.QueryRow(ctx, `SELECT
		(SELECT count(*) FROM vou_document_attachments WHERE document_id=$1),
		(SELECT count(*) FROM vou_documents WHERE parent_document_id=$1)`,
		input.DocumentID).Scan(&attachments, &children); err != nil {
		return MutationResult{}, err
	}
	if attachments != 0 || children != 0 {
		return MutationResult{}, domainError(ErrorConflict, "draft has attachments or child documents", nil, nil)
	}
	parentDocumentID := ""
	if parentID != nil {
		parentDocumentID = *parentID
	}
	if err = s.events.Publish(ctx, tx, DocumentDeletedEvent{
		Entity: entity, DocumentID: input.DocumentID, DocumentNo: number,
		ParentDocumentID: parentDocumentID, ActorID: actorID,
		RequestID: requestID, Reason: *reason,
	}); err != nil {
		return MutationResult{}, err
	}
	if _, err = tx.Exec(ctx, `DELETE FROM vou_audit_events WHERE document_id=$1`, input.DocumentID); err != nil {
		return MutationResult{}, err
	}
	switch entity {
	case EntityIntermediaryCalculation:
		_, err = tx.Exec(ctx, `DELETE FROM vou_intermediary_calculation_bill_allocations WHERE document_id=$1`, input.DocumentID)
		if err == nil {
			_, err = tx.Exec(ctx, `DELETE FROM vou_intermediary_calculation_lines WHERE document_id=$1`, input.DocumentID)
		}
		if err == nil {
			_, err = tx.Exec(ctx, `DELETE FROM vou_intermediary_calculation_summaries WHERE document_id=$1`, input.DocumentID)
		}
		if err == nil {
			_, err = tx.Exec(ctx, `DELETE FROM vou_intermediary_calculation_details WHERE document_id=$1`, input.DocumentID)
		}
	case EntitySalePricing:
		_, err = tx.Exec(ctx, `DELETE FROM vou_price_lines WHERE document_id=$1;
			DELETE FROM vou_sale_pricing_details WHERE document_id=$1`, input.DocumentID)
	case EntityPurchaseInquiry:
		_, err = tx.Exec(ctx, `DELETE FROM vou_price_lines WHERE document_id=$1;
			DELETE FROM vou_purchase_inquiry_details WHERE document_id=$1`, input.DocumentID)
	case EntityOrderProduction, EntitySelfProduction:
		_, err = tx.Exec(ctx, `DELETE FROM vou_production_material_lines
			WHERE output_line_id IN (
				SELECT id FROM vou_production_output_lines WHERE document_id=$1
			)`, input.DocumentID)
		if err == nil {
			_, err = tx.Exec(ctx, `DELETE FROM vou_production_output_lines WHERE document_id=$1`,
				input.DocumentID)
		}
		if err == nil {
			_, err = tx.Exec(ctx, `DELETE FROM vou_production_details WHERE document_id=$1`,
				input.DocumentID)
		}
	case EntitySaleOrder:
		_, err = tx.Exec(ctx, `DELETE FROM vou_product_lines WHERE document_id=$1`, input.DocumentID)
		if err == nil {
			_, err = tx.Exec(ctx, `DELETE FROM vou_sale_order_details WHERE document_id=$1`, input.DocumentID)
		}
	case EntitySaleOutbound:
		_, err = tx.Exec(ctx, `DELETE FROM vou_sale_outbound_lines WHERE document_id=$1;
			DELETE FROM vou_sale_outbound_details WHERE document_id=$1`, input.DocumentID)
	case EntitySaleDelivery:
		_, err = tx.Exec(ctx, `DELETE FROM vou_sale_delivery_details WHERE document_id=$1`, input.DocumentID)
	case EntitySaleSignoff:
		_, err = tx.Exec(ctx, `DELETE FROM vou_sale_signoff_lines WHERE document_id=$1;
			DELETE FROM vou_sale_signoff_details WHERE document_id=$1`, input.DocumentID)
	case EntitySaleReturn:
		if _, err = tx.Exec(ctx, `DELETE FROM vou_sale_return_lines WHERE document_id=$1`,
			input.DocumentID); err == nil {
			_, err = tx.Exec(ctx, `DELETE FROM vou_sale_return_details WHERE document_id=$1`,
				input.DocumentID)
		}
	case EntityPurchaseReturn:
		if _, err = tx.Exec(ctx, `DELETE FROM vou_purchase_return_lines WHERE document_id=$1`,
			input.DocumentID); err == nil {
			_, err = tx.Exec(ctx, `DELETE FROM vou_purchase_return_details WHERE document_id=$1`,
				input.DocumentID)
		}
	case EntityPurchaseOrder:
		_, err = tx.Exec(ctx, `DELETE FROM vou_product_lines WHERE document_id=$1;
			DELETE FROM vou_purchase_order_details WHERE document_id=$1`, input.DocumentID)
	case EntitySalesReceipt, EntityPurchaseRefund, EntityOtherReceipt, EntityEmployeeRepayment:
		_, err = tx.Exec(ctx, `DELETE FROM vou_receipt_details WHERE document_id=$1`, input.DocumentID)
	case EntitySalesRefund, EntityPurchasePayment, EntityOtherPayment, EntityEmployeeLoan:
		_, err = tx.Exec(ctx, `DELETE FROM vou_payment_details WHERE document_id=$1`, input.DocumentID)
	case EntityExpenseReimbursement:
		_, err = tx.Exec(ctx, `DELETE FROM vou_expense_lines WHERE document_id=$1;
			DELETE FROM vou_expense_reimbursement_details WHERE document_id=$1`, input.DocumentID)
	case EntityEmployeeLoanWriteoff:
		_, err = tx.Exec(ctx, `DELETE FROM vou_expense_lines WHERE document_id=$1;
			DELETE FROM vou_employee_loan_writeoff_details WHERE document_id=$1`, input.DocumentID)
	case EntityExpensePayment:
		_, err = tx.Exec(ctx, `DELETE FROM vou_expense_payment_details WHERE document_id=$1`, input.DocumentID)
	case EntityOtherIncome:
		_, err = tx.Exec(ctx, `DELETE FROM vou_other_income_details WHERE document_id=$1`, input.DocumentID)
	case EntityServiceContract:
		_, err = tx.Exec(ctx, `DELETE FROM vou_service_contract_details WHERE document_id=$1`, input.DocumentID)
	case EntityServiceAcceptance:
		_, err = tx.Exec(ctx, `DELETE FROM vou_service_acceptance_details WHERE document_id=$1`, input.DocumentID)
	case EntityAssetAcquisition:
		_, err = tx.Exec(ctx, `DELETE FROM vou_asset_acquisition_lines WHERE document_id=$1;
			DELETE FROM vou_asset_acquisition_details WHERE document_id=$1`, input.DocumentID)
	case EntityAssetSale:
		_, err = tx.Exec(ctx, `DELETE FROM vou_asset_sale_lines WHERE document_id=$1;
			DELETE FROM vou_asset_sale_details WHERE document_id=$1`, input.DocumentID)
	case EntityAssetLiquidation:
		_, err = tx.Exec(ctx, `DELETE FROM vou_asset_liquidation_lines WHERE document_id=$1;
			DELETE FROM vou_asset_liquidation_details WHERE document_id=$1`, input.DocumentID)
	case EntityBillReceipt, EntityBillPayment, EntityBillIssue, EntityBillDiscount, EntityBillMaturity:
		var hasAccountingHistory bool
		if entity == EntityBillReceipt || entity == EntityBillIssue {
			err = tx.QueryRow(ctx, `SELECT EXISTS(
				SELECT 1 FROM acc_bills WHERE source_document_id=$1
			)`, input.DocumentID).Scan(&hasAccountingHistory)
		}
		if err == nil && hasAccountingHistory {
			return MutationResult{}, domainError(
				ErrorConflict, "bill document with accounting history cannot be deleted", nil, nil,
			)
		}
		if err == nil {
			_, err = tx.Exec(ctx, `DELETE FROM vou_bill_cash_lines WHERE document_id=$1`, input.DocumentID)
		}
		if err == nil {
			_, err = tx.Exec(ctx, `DELETE FROM vou_bill_lines WHERE document_id=$1`, input.DocumentID)
		}
		if err == nil {
			_, err = tx.Exec(ctx, `DELETE FROM vou_bill_details WHERE document_id=$1`, input.DocumentID)
		}
	}
	if err != nil {
		return MutationResult{}, err
	}
	if _, err = tx.Exec(ctx, `DELETE FROM vou_documents WHERE id=$1`, input.DocumentID); err != nil {
		return MutationResult{}, err
	}
	if parentID != nil {
		derivedActorID := systemidentity.UserID
		var parentEntity, parentStatus string
		if err = tx.QueryRow(ctx, `UPDATE vou_documents SET revision=revision+1,updated_at=now(),updated_by=$1
			WHERE id=$2 RETURNING entity,status`, derivedActorID, *parentID).Scan(&parentEntity, &parentStatus); err != nil {
			return MutationResult{}, err
		}
		if err = insertAudit(ctx, s.queries.WithTx(tx), auditInput{
			DocumentID: *parentID, Entity: parentEntity, Event: "DELETED",
			From: &parentStatus, To: parentStatus, ActorID: derivedActorID, Reason: reason, RequestID: requestID,
			Summary: map[string]any{"documentId": input.DocumentID, "documentNo": number, "entity": entity},
		}); err != nil {
			return MutationResult{}, err
		}

	}
	if err = tx.Commit(ctx); err != nil {
		return MutationResult{}, err
	}
	return MutationResult{
		DocumentID: input.DocumentID, DocumentNo: number, Status: "DELETED", Revision: revision + 1,
	}, nil
}

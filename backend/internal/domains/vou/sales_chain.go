package vou

import (
	"context"
	"errors"
	"fmt"
	"math"
	"strings"
	"time"

	dbsqlc "github.com/hansonyu183/zerp/backend/internal/database/sqlc"
	bobdomain "github.com/hansonyu183/zerp/backend/internal/domains/bob"
	"github.com/jackc/pgx/v5"
)

type fixedSourceQuantityLine struct {
	SourceLineID string
	Quantity     int64
	Remark       *string
}

type fixedSignoffLine struct {
	SourceLineID     string
	Signed, Rejected int64
	Remark           *string
}

type salesSource struct {
	ID, Number, Entity, Status, Currency        string
	BusinessDate                                time.Time
	Total                                       int64
	CustomerObjectID, CustomerApprovalEntryID   string
	CustomerCode, CustomerName                  string
	WarehouseObjectID, WarehouseApprovalEntryID string
	WarehouseCode, WarehouseName                string
	OperatingEntityObjectID                     string
}

func validateChainHeader(data DraftInput) (time.Time, *string, error) {
	date, err := time.Parse(dateLayout, strings.TrimSpace(data.BusinessDate))
	if err != nil {
		return time.Time{}, nil, domainError(ErrorValidation, "invalid businessDate", nil, nil)
	}
	if !validID(strings.TrimSpace(data.SourceDocumentID)) {
		return time.Time{}, nil, domainError(ErrorValidation, "invalid parent document", nil, nil)
	}
	remark := optionalText(data.Remark)
	if remark != nil && len([]rune(*remark)) > 1000 {
		return time.Time{}, nil, domainError(ErrorValidation, "remark is too long", nil, nil)
	}
	return date, remark, nil
}

func validateSourceQuantityLines(lines []SourceQuantityLineInput) ([]fixedSourceQuantityLine, error) {
	if len(lines) == 0 || len(lines) > 200 {
		return nil, domainError(ErrorValidation, "sourceLines must contain 1 to 200 items", nil, nil)
	}
	result := make([]fixedSourceQuantityLine, 0, len(lines))
	seen := map[string]bool{}
	for _, line := range lines {
		if !validID(line.SourceLineID) || seen[line.SourceLineID] {
			return nil, domainError(ErrorValidation, "invalid sourceLineId", nil, nil)
		}
		quantity, err := quantityMicros(line.BaseQuantity, false)
		if err != nil {
			return nil, domainError(ErrorValidation, "invalid source quantity", nil, err)
		}
		remark, err := lineRemark(line.Remark)
		if err != nil {
			return nil, err
		}
		seen[line.SourceLineID] = true
		result = append(result, fixedSourceQuantityLine{
			SourceLineID: line.SourceLineID, Quantity: quantity, Remark: remark,
		})
	}
	return result, nil
}

func validateSignoffLines(lines []SaleSignoffLineInput) ([]fixedSignoffLine, error) {
	if len(lines) == 0 || len(lines) > 200 {
		return nil, domainError(ErrorValidation, "signoffLines must contain 1 to 200 items", nil, nil)
	}
	result := make([]fixedSignoffLine, 0, len(lines))
	seen := map[string]bool{}
	for _, line := range lines {
		if !validID(line.SourceLineID) || seen[line.SourceLineID] {
			return nil, domainError(ErrorValidation, "invalid sourceLineId", nil, nil)
		}
		signed, err := quantityMicros(line.SignedBaseQuantity, true)
		if err != nil {
			return nil, domainError(ErrorValidation, "invalid signedBaseQuantity", nil, err)
		}
		rejected, err := quantityMicros(line.RejectedBaseQuantity, true)
		if err != nil || signed > math.MaxInt64-rejected {
			return nil, domainError(ErrorValidation, "invalid rejectedBaseQuantity", nil, err)
		}
		remark, err := lineRemark(line.Remark)
		if err != nil {
			return nil, err
		}
		seen[line.SourceLineID] = true
		result = append(result, fixedSignoffLine{
			SourceLineID: line.SourceLineID, Signed: signed, Rejected: rejected, Remark: remark,
		})
	}
	return result, nil
}

func validateChainShape(entity string, data DraftInput) error {
	if data.Customer != nil || data.Supplier != nil || data.Counterparty != nil ||
		data.Employee != nil || data.Salesperson != nil || data.Purchaser != nil ||
		data.Handler != nil || data.FundAccount != nil || strings.TrimSpace(data.SourceName) != "" ||
		strings.TrimSpace(data.Amount) != "" || len(data.ProductLines) != 0 || len(data.ExpenseLines) != 0 {
		return domainError(ErrorValidation, "fields do not match sales-chain entity", nil, nil)
	}
	switch entity {
	case EntitySaleOutbound:
		if data.Warehouse == nil || data.Carrier != nil || data.Vehicle != nil ||
			len(data.SourceLines) == 0 || len(data.SignoffLines) != 0 {
			return domainError(ErrorValidation, "fields do not match sale-outbound", nil, nil)
		}
	case EntitySaleDelivery:
		if data.Warehouse != nil || data.Vehicle == nil ||
			len(data.SourceLines) != 0 || len(data.SignoffLines) != 0 {
			return domainError(ErrorValidation, "fields do not match sale-delivery", nil, nil)
		}
	case EntitySaleSignoff:
		if data.Warehouse != nil || data.Carrier != nil || data.Vehicle != nil ||
			len(data.SourceLines) != 0 || len(data.SignoffLines) == 0 {
			return domainError(ErrorValidation, "fields do not match sale-signoff", nil, nil)
		}
	}
	return nil
}

func (s *Service) createSalesChain(
	ctx context.Context, entity string, input CreateInput, actorID, requestID string,
) (MutationResult, error) {
	if !isSalesChainEntity(entity) || !validID(actorID) {
		return MutationResult{}, domainError(ErrorValidation, "invalid sales-chain create", nil, nil)
	}
	if err := validateChainShape(entity, input.Data); err != nil {
		return MutationResult{}, err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return MutationResult{}, s.internal("begin sales-chain create", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	result, err := s.writeSalesChainDraft(ctx, tx, entity, "", input.Data, actorID, requestID)
	if err != nil {
		return MutationResult{}, err
	}
	if err = tx.Commit(ctx); err != nil {
		return MutationResult{}, s.writeError("commit sales-chain create", err)
	}
	return result, nil
}

func (s *Service) saveSalesChain(
	ctx context.Context, entity string, input SaveInput, actorID, requestID string,
) (MutationResult, error) {
	if err := validateDocumentRevision(input.DocumentID, input.Revision); err != nil {
		return MutationResult{}, err
	}
	if !isSalesChainEntity(entity) {
		return MutationResult{}, domainError(ErrorValidation, "invalid sales-chain save", nil, nil)
	}
	if err := validateChainShape(entity, input.Data); err != nil {
		return MutationResult{}, err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return MutationResult{}, s.internal("begin sales-chain save", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	var status, parentID string
	var actualRevision int64
	if err = tx.QueryRow(ctx, `SELECT status,revision,parent_document_id
		FROM vou_documents WHERE id=$1 AND entity=$2 FOR UPDATE`,
		input.DocumentID, entity).Scan(&status, &actualRevision, &parentID); err != nil {
		return MutationResult{}, documentWriteConflict(err, actualRevision, input.Revision, status, StatusDraft)
	}
	if actualRevision != input.Revision || status != StatusDraft {
		return MutationResult{}, documentWriteConflict(nil, actualRevision, input.Revision, status, StatusDraft)
	}
	if parentID != strings.TrimSpace(input.Data.SourceDocumentID) {
		return MutationResult{}, domainError(ErrorConflict, "source document cannot be changed", nil, nil)
	}
	result, err := s.writeSalesChainDraft(ctx, tx, entity, input.DocumentID, input.Data, actorID, requestID)
	if err != nil {
		return MutationResult{}, err
	}
	if err = tx.Commit(ctx); err != nil {
		return MutationResult{}, s.writeError("commit sales-chain save", err)
	}
	return result, nil
}

func (s *Service) writeSalesChainDraft(
	ctx context.Context,
	tx pgx.Tx,
	entity, replacingID string,
	data DraftInput,
	actorID, requestID string,
) (MutationResult, error) {
	date, remark, err := validateChainHeader(data)
	if err != nil {
		return MutationResult{}, err
	}
	switch entity {
	case EntitySaleOutbound:
		return s.writeSaleOutbound(ctx, tx, replacingID, data, date, remark, actorID, requestID)
	case EntitySaleDelivery:
		return s.writeSaleDelivery(ctx, tx, replacingID, data, date, remark, actorID, requestID)
	case EntitySaleSignoff:
		return s.writeSaleSignoff(ctx, tx, replacingID, data, date, remark, actorID, requestID)
	default:
		return MutationResult{}, domainError(ErrorValidation, "invalid sales-chain entity", nil, nil)
	}
}

func (s *Service) lockSalesSource(
	ctx context.Context, tx pgx.Tx, id, entity string,
) (salesSource, error) {
	var source salesSource
	source.ID, source.Entity = id, entity
	var date time.Time
	var err error
	qtx := s.queries.WithTx(tx)
	switch entity {
	case EntitySaleOrder:
		err = tx.QueryRow(ctx, `SELECT d.document_no,d.status,d.business_date,d.currency,d.total_amount_cents,
			x.customer_object_id,x.customer_approval_entry_id,x.customer_code,x.customer_name,
			COALESCE(x.warehouse_object_id,''),COALESCE(x.warehouse_approval_entry_id,''),
			COALESCE(x.warehouse_code,''),COALESCE(x.warehouse_name,'')
			FROM vou_documents d JOIN vou_sale_order_details x ON x.document_id=d.id
			WHERE d.id=$1 AND d.entity='sale-order' FOR UPDATE`, id).
			Scan(&source.Number, &source.Status, &date, &source.Currency, &source.Total,
				&source.CustomerObjectID, &source.CustomerApprovalEntryID, &source.CustomerCode, &source.CustomerName,
				&source.WarehouseObjectID, &source.WarehouseApprovalEntryID, &source.WarehouseCode, &source.WarehouseName)
	case EntitySaleOutbound:
		var row dbsqlc.LockVouSaleOutboundSourceRow
		row, err = qtx.LockVouSaleOutboundSource(ctx, id)
		if err == nil {
			source.Number, source.Status, date, source.Currency, source.Total =
				row.DocumentNo, row.Status, row.BusinessDate.Time, row.Currency, row.TotalAmountCents
			source.CustomerObjectID, source.CustomerApprovalEntryID = row.CustomerObjectID, row.CustomerApprovalEntryID
			source.CustomerCode, source.CustomerName = row.CustomerCode, row.CustomerName
			source.WarehouseObjectID, source.WarehouseApprovalEntryID = deref(row.WarehouseObjectID), deref(row.WarehouseApprovalEntryID)
			source.WarehouseCode, source.WarehouseName = deref(row.WarehouseCode), deref(row.WarehouseName)
			source.OperatingEntityObjectID = row.OperatingEntityID
		}
	case EntitySaleDelivery:
		err = tx.QueryRow(ctx, `SELECT d.document_no,d.status,d.business_date,d.currency,d.total_amount_cents,
			x.customer_object_id,x.customer_approval_entry_id,x.customer_code,x.customer_name,
			o.warehouse_object_id,o.warehouse_approval_entry_id,o.warehouse_code,o.warehouse_name
			FROM vou_documents d JOIN vou_sale_delivery_details x ON x.document_id=d.id
			JOIN vou_sale_outbound_details o ON o.document_id=x.source_outbound_id
			WHERE d.id=$1 AND d.entity='sale-delivery' FOR UPDATE`, id).
			Scan(&source.Number, &source.Status, &date, &source.Currency, &source.Total,
				&source.CustomerObjectID, &source.CustomerApprovalEntryID, &source.CustomerCode, &source.CustomerName,
				&source.WarehouseObjectID, &source.WarehouseApprovalEntryID, &source.WarehouseCode, &source.WarehouseName)
	}
	if errors.Is(err, pgx.ErrNoRows) {
		return source, domainError(ErrorValidation, "source document not found", nil, nil)
	}
	if err != nil {
		return source, s.internal("lock sales source", err)
	}
	source.BusinessDate = date
	ready := source.Status == StatusApproved
	if !ready {
		return source, domainError(ErrorConflict, "source document is not approved", nil, nil)
	}
	return source, nil
}

func (s *Service) insertChainDocument(
	ctx context.Context,
	tx pgx.Tx,
	entity, parentID string,
	date time.Time,
	currency string,
	total int64,
	remark *string,
	actorID string,
) (string, string, error) {
	q := s.queries.WithTx(tx)
	counter, err := q.NextVouNumberCounter(ctx, dbsqlc.NextVouNumberCounterParams{
		Entity: entity, BusinessDate: dateValue(date),
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return "", "", domainError(ErrorConflict, "document number exhausted", nil, nil)
		}
		return "", "", s.writeError("allocate sales-chain number", err)
	}
	id := newID()
	number := fmt.Sprintf("%s-%s-%04d", entityPrefix(entity), date.Format("20060102"), counter)
	_, err = tx.Exec(ctx, `INSERT INTO vou_documents(
		id,entity,document_no,parent_entity,parent_document_id,business_date,currency,
		total_amount_cents,remark,created_by,updated_by
	) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10)`,
		id, entity, number, salesParentEntity(entity), parentID, date, currency, total, remark, actorID)
	if err != nil {
		return "", "", s.writeError("insert sales-chain document", err)
	}
	return id, number, nil
}

func (s *Service) updateChainDocument(
	ctx context.Context,
	tx pgx.Tx,
	id, entity string,
	date time.Time,
	currency string,
	total int64,
	remark *string,
	actorID string,
) (int64, error) {
	var revision int64
	err := tx.QueryRow(ctx, `UPDATE vou_documents SET business_date=$1,currency=$2,total_amount_cents=$3,
		remark=$4,revision=revision+1,updated_at=now(),updated_by=$5
		WHERE id=$6 AND entity=$7 AND status='DRAFT' RETURNING revision`,
		date, currency, total, remark, actorID, id, entity).Scan(&revision)
	if err != nil {
		return 0, s.writeError("update sales-chain draft", err)
	}
	return revision, nil
}

func (s *Service) writeSaleOutbound(
	ctx context.Context,
	tx pgx.Tx,
	replacingID string,
	data DraftInput,
	date time.Time,
	remark *string,
	actorID, requestID string,
) (MutationResult, error) {
	lines, err := validateSourceQuantityLines(data.SourceLines)
	if err != nil {
		return MutationResult{}, err
	}
	source, err := s.lockSalesSource(ctx, tx, data.SourceDocumentID, EntitySaleOrder)
	if err != nil {
		return MutationResult{}, err
	}
	if date.Before(source.BusinessDate) {
		return MutationResult{}, domainError(ErrorValidation, "outbound date precedes order date", nil, nil)
	}
	var fulfillment string
	if err = tx.QueryRow(ctx, `SELECT fulfillment_status FROM vou_sale_order_details WHERE document_id=$1`,
		source.ID).Scan(&fulfillment); err != nil {
		return MutationResult{}, s.internal("read order fulfillment", err)
	}
	if fulfillment == "FULFILLED" {
		return MutationResult{}, domainError(ErrorConflict, "order is closed for outbound", nil, nil)
	}
	if err = validateReference(data.Warehouse, "warehouse", true); err != nil {
		return MutationResult{}, err
	}
	warehouse, err := s.resolver.ResolveApprovedReference(
		ctx, tx, bobdomain.EntityWarehouse, data.Warehouse.ObjectID, data.Warehouse.ApprovalEntryID,
	)
	if err != nil {
		return MutationResult{}, domainError(ErrorConflict, "warehouse reference is not effective", nil, err)
	}
	if source.WarehouseObjectID != "" &&
		(source.WarehouseObjectID != warehouse.ObjectID || source.WarehouseApprovalEntryID != warehouse.ApprovalEntryID) {
		return MutationResult{}, domainError(ErrorConflict, "outbound warehouse must match sale order warehouse", nil, nil)
	}
	if source.WarehouseObjectID == "" {
		if _, err = tx.Exec(ctx, `UPDATE vou_sale_order_details SET
			warehouse_object_id=$1,warehouse_approval_entry_id=$2,warehouse_code=$3,warehouse_name=$4
			WHERE document_id=$5 AND warehouse_object_id IS NULL`, warehouse.ObjectID, warehouse.ApprovalEntryID,
			warehouse.Code, warehouse.Data.Name, source.ID); err != nil {
			return MutationResult{}, s.writeError("bind legacy sale order warehouse", err)
		}
	}
	type outboundLine struct {
		fixedSourceQuantityLine
		lineNo                                                                         int32
		productObjectID, productApprovalEntryID, productCode, productName, productUnit string
		price, amount                                                                  int64
	}
	resolved := make([]outboundLine, 0, len(lines))
	var total int64
	for index, line := range lines {
		var item outboundLine
		item.fixedSourceQuantityLine, item.lineNo = line, int32(index+1)
		var ordered int64
		err = tx.QueryRow(ctx, `SELECT product_object_id,product_approval_entry_id,product_code,product_name,
			entered_unit_symbol,base_quantity_micros,unit_price_cents FROM vou_product_lines
			WHERE id=$1 AND document_id=$2 AND document_entity='sale-order'`,
			line.SourceLineID, source.ID).Scan(
			&item.productObjectID, &item.productApprovalEntryID, &item.productCode, &item.productName,
			&item.productUnit, &ordered, &item.price)
		if err != nil || line.Quantity > ordered {
			return MutationResult{}, domainError(ErrorValidation, "invalid sale order source line", nil, err)
		}
		item.amount, err = lineAmountCents(line.Quantity, item.price)
		if err != nil || total > math.MaxInt64-item.amount {
			return MutationResult{}, domainError(ErrorValidation, "outbound amount out of range", nil, err)
		}
		total += item.amount
		resolved = append(resolved, item)
	}
	id, number, revision := replacingID, "", int64(1)
	if replacingID == "" {
		id, number, err = s.insertChainDocument(
			ctx, tx, EntitySaleOutbound, source.ID, date, source.Currency, total, remark, actorID,
		)
		if err != nil {
			return MutationResult{}, err
		}
		_, err = tx.Exec(ctx, `INSERT INTO vou_sale_outbound_details(
			document_id,source_order_id,customer_object_id,customer_approval_entry_id,customer_code,customer_name,
			warehouse_object_id,warehouse_approval_entry_id,warehouse_code,warehouse_name)
			VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
			id, source.ID, source.CustomerObjectID, source.CustomerApprovalEntryID, source.CustomerCode, source.CustomerName,
			warehouse.ObjectID, warehouse.ApprovalEntryID, warehouse.Code, warehouse.Data.Name)
	} else {
		err = tx.QueryRow(ctx, `SELECT document_no FROM vou_documents WHERE id=$1`, id).Scan(&number)
		if err == nil {
			revision, err = s.updateChainDocument(ctx, tx, id, EntitySaleOutbound, date, source.Currency, total, remark, actorID)
		}
		if err == nil {
			_, err = tx.Exec(ctx, `UPDATE vou_sale_outbound_details SET
				warehouse_object_id=$1,warehouse_approval_entry_id=$2,warehouse_code=$3,warehouse_name=$4
				WHERE document_id=$5`, warehouse.ObjectID, warehouse.ApprovalEntryID, warehouse.Code, warehouse.Data.Name, id)
		}
		if err == nil {
			_, err = tx.Exec(ctx, `DELETE FROM vou_sale_outbound_lines WHERE document_id=$1`, id)
		}
	}
	if err != nil {
		return MutationResult{}, s.writeError("write sale outbound detail", err)
	}
	for _, line := range resolved {
		_, err = tx.Exec(ctx, `INSERT INTO vou_sale_outbound_lines(
			id,document_id,source_order_line_id,line_no,product_object_id,product_approval_entry_id,
			product_code,product_name,entered_unit_symbol,base_quantity_micros,unit_price_cents,line_amount_cents,remark)
			VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
			newID(), id, line.SourceLineID, line.lineNo, line.productObjectID, line.productApprovalEntryID,
			line.productCode, line.productName, line.productUnit, line.Quantity, line.price, line.amount, line.Remark)
		if err != nil {
			return MutationResult{}, s.writeError("write sale outbound line", err)
		}
	}
	event := "CREATED"
	if replacingID != "" {
		event = "SAVED"
	}
	if err = insertAudit(ctx, s.queries.WithTx(tx), auditInput{
		DocumentID: id, Entity: EntitySaleOutbound, Event: event, From: stringPtr(StatusDraft),
		To: StatusDraft, ActorID: actorID, RequestID: requestID,
		Summary: map[string]any{"parentDocumentId": source.ID},
	}); err != nil {
		return MutationResult{}, err
	}
	return MutationResult{DocumentID: id, DocumentNo: number, Status: StatusDraft, Revision: revision}, nil
}

type saleDeliveryTransport struct {
	carrierType string
	operating   nullableReferenceSnapshot
	service     nullableReferenceSnapshot
	vehicle     bobdomain.EffectiveReference
}

type nullableReferenceSnapshot struct {
	objectID  *string
	versionID *string
	code      *string
	name      *string
}

func newNullableReferenceSnapshot(reference *bobdomain.EffectiveReference) nullableReferenceSnapshot {
	if reference == nil {
		return nullableReferenceSnapshot{}
	}
	return nullableReferenceSnapshot{
		objectID:  &reference.ObjectID,
		versionID: &reference.ApprovalEntryID,
		code:      &reference.Code,
		name:      &reference.Data.Name,
	}
}

func (s *Service) resolveSaleDeliveryTransport(
	ctx context.Context,
	tx pgx.Tx,
	source salesSource,
	carrier *ReferenceInput,
	vehicleInput ReferenceInput,
) (saleDeliveryTransport, error) {
	vehicle, err := s.resolver.ResolveApprovedReference(
		ctx, tx, bobdomain.EntityVehicle, vehicleInput.ObjectID, vehicleInput.ApprovalEntryID,
	)
	if err != nil || vehicle.Data.CarrierAffiliation == nil {
		return saleDeliveryTransport{}, domainError(ErrorConflict, "vehicle is not currently effective", nil, err)
	}
	var requiresBulkLiquidCapability bool
	qtx := s.queries.WithTx(tx)
	if requiresBulkLiquidCapability, err = qtx.VouSaleOutboundRequiresBulkLiquidVehicle(ctx, source.ID); err != nil {
		return saleDeliveryTransport{}, s.internal("check sale delivery vehicle capability", err)
	}
	if requiresBulkLiquidCapability && !vehicle.Data.BulkLiquidCapable {
		return saleDeliveryTransport{}, domainError(ErrorConflict, "bulk-liquid delivery requires a capable vehicle", nil, nil)
	}
	affiliation := vehicle.Data.CarrierAffiliation
	result := saleDeliveryTransport{carrierType: affiliation.Type, vehicle: vehicle}
	switch affiliation.Type {
	case "INTERNAL":
		if carrier != nil || affiliation.OperatingEntityID != source.OperatingEntityObjectID {
			return saleDeliveryTransport{}, domainError(ErrorConflict, "internal vehicle must belong to the sale order Operating Entity", nil, nil)
		}
		operating, resolveErr := s.resolver.ResolveLatestApprovedReference(
			ctx, tx, bobdomain.EntityOperatingEntity, affiliation.OperatingEntityID,
		)
		if resolveErr != nil {
			return saleDeliveryTransport{}, domainError(ErrorConflict, "vehicle Operating Entity is not currently effective", nil, resolveErr)
		}
		result.operating = newNullableReferenceSnapshot(&operating)
	case "EXTERNAL":
		if err = validateReference(carrier, "carrier", true); err != nil {
			return saleDeliveryTransport{}, err
		}
		service, resolveErr := s.resolver.ResolveApprovedReference(
			ctx, tx, bobdomain.EntityOtherUnit, carrier.ObjectID, carrier.ApprovalEntryID,
		)
		if resolveErr != nil {
			return saleDeliveryTransport{}, domainError(ErrorConflict, "carrier is not a current Service Relationship", nil, resolveErr)
		}
		if affiliation.ServiceRelationshipObjectID != service.ObjectID {
			return saleDeliveryTransport{}, domainError(ErrorConflict, "external vehicle does not belong to the selected carrier", nil, nil)
		}
		result.service = newNullableReferenceSnapshot(&service)
	default:
		return saleDeliveryTransport{}, domainError(ErrorConflict, "vehicle carrier affiliation is invalid", nil, nil)
	}
	return result, nil
}

func (s *Service) validateSaleDeliveryTransportCurrent(ctx context.Context, tx pgx.Tx, documentID string) error {
	qtx := s.queries.WithTx(tx)
	snapshot, err := qtx.LockVouSaleDeliveryCarrierSnapshot(ctx, documentID)
	if err != nil {
		return s.internal("read sale delivery carrier snapshot", err)
	}
	source, err := s.lockSalesSource(ctx, tx, snapshot.SourceOutboundID, EntitySaleOutbound)
	if err != nil {
		return err
	}
	var carrier *ReferenceInput
	if snapshot.CarrierServiceRelationshipObjectID != nil && snapshot.CarrierServiceRelationshipApprovalEntryID != nil {
		carrier = &ReferenceInput{ObjectID: *snapshot.CarrierServiceRelationshipObjectID, ApprovalEntryID: *snapshot.CarrierServiceRelationshipApprovalEntryID}
	}
	if snapshot.VehicleObjectID == nil || snapshot.VehicleApprovalEntryID == nil {
		return domainError(ErrorConflict, "sales-chain source is not ready", nil, nil)
	}
	transport, err := s.resolveSaleDeliveryTransport(ctx, tx, source, carrier, ReferenceInput{
		ObjectID: *snapshot.VehicleObjectID, ApprovalEntryID: *snapshot.VehicleApprovalEntryID,
	})
	if err != nil {
		return err
	}
	if transport.carrierType != snapshot.CarrierType {
		return domainError(ErrorConflict, "saved carrier type is no longer current", nil, nil)
	}
	if snapshot.CarrierType == "INTERNAL" {
		if snapshot.CarrierOperatingEntityObjectID == nil || snapshot.CarrierOperatingEntityApprovalEntryID == nil ||
			transport.operating.objectID == nil || transport.operating.versionID == nil ||
			*transport.operating.objectID != *snapshot.CarrierOperatingEntityObjectID ||
			*transport.operating.versionID != *snapshot.CarrierOperatingEntityApprovalEntryID {
			return domainError(ErrorConflict, "saved Operating Entity version is no longer current", nil, nil)
		}
	}
	return nil
}

func (s *Service) writeSaleDelivery(
	ctx context.Context,
	tx pgx.Tx,
	replacingID string,
	data DraftInput,
	date time.Time,
	remark *string,
	actorID, requestID string,
) (MutationResult, error) {
	if err := validateReference(data.Vehicle, "vehicle", true); err != nil {
		return MutationResult{}, err
	}
	source, err := s.lockSalesSource(ctx, tx, data.SourceDocumentID, EntitySaleOutbound)
	if err != nil {
		return MutationResult{}, err
	}
	if date.Before(source.BusinessDate) {
		return MutationResult{}, domainError(ErrorValidation, "delivery date precedes outbound date", nil, nil)
	}
	var existing int64
	if err = tx.QueryRow(ctx, `SELECT count(*) FROM vou_sale_delivery_details
		WHERE source_outbound_id=$1 AND document_id<>$2`, source.ID, replacingID).Scan(&existing); err != nil {
		return MutationResult{}, s.internal("check existing delivery", err)
	}
	if existing != 0 {
		return MutationResult{}, domainError(ErrorConflict, "outbound already has a delivery", nil, nil)
	}
	transport, err := s.resolveSaleDeliveryTransport(ctx, tx, source, data.Carrier, *data.Vehicle)
	if err != nil {
		return MutationResult{}, err
	}
	qtx := s.queries.WithTx(tx)
	detail := dbsqlc.InsertVouSaleDeliveryDetailParams{
		SourceOutboundID: source.ID,
		CustomerObjectID: source.CustomerObjectID, CustomerApprovalEntryID: source.CustomerApprovalEntryID,
		CustomerCode: source.CustomerCode, CustomerName: source.CustomerName,
		CarrierType:                               transport.carrierType,
		CarrierOperatingEntityObjectID:            transport.operating.objectID,
		CarrierOperatingEntityApprovalEntryID:     transport.operating.versionID,
		CarrierOperatingEntityCode:                transport.operating.code,
		CarrierOperatingEntityName:                transport.operating.name,
		CarrierServiceRelationshipObjectID:        transport.service.objectID,
		CarrierServiceRelationshipApprovalEntryID: transport.service.versionID,
		CarrierServiceRelationshipCode:            transport.service.code,
		CarrierServiceRelationshipName:            transport.service.name,
		VehicleObjectID:                           stringPtr(transport.vehicle.ObjectID), VehicleApprovalEntryID: stringPtr(transport.vehicle.ApprovalEntryID),
		VehicleCode: stringPtr(transport.vehicle.Code), VehicleName: stringPtr(transport.vehicle.Data.Name),
		VehiclePlateNumber:       stringPtr(transport.vehicle.Data.PlateNumber),
		VehicleBulkLiquidCapable: transport.vehicle.Data.BulkLiquidCapable,
	}
	id, number, revision := replacingID, "", int64(1)
	if replacingID == "" {
		id, number, err = s.insertChainDocument(
			ctx, tx, EntitySaleDelivery, source.ID, date, source.Currency, source.Total, remark, actorID,
		)
		if err == nil {
			detail.DocumentID = id
			err = qtx.InsertVouSaleDeliveryDetail(ctx, detail)
		}
	} else {
		err = tx.QueryRow(ctx, `SELECT document_no FROM vou_documents WHERE id=$1`, id).Scan(&number)
		if err == nil {
			revision, err = s.updateChainDocument(ctx, tx, id, EntitySaleDelivery, date, source.Currency, source.Total, remark, actorID)
		}
		if err == nil {
			_, err = qtx.UpdateVouSaleDeliveryCarrierSnapshot(ctx, dbsqlc.UpdateVouSaleDeliveryCarrierSnapshotParams{
				CarrierType:                               detail.CarrierType,
				CarrierOperatingEntityObjectID:            detail.CarrierOperatingEntityObjectID,
				CarrierOperatingEntityApprovalEntryID:     detail.CarrierOperatingEntityApprovalEntryID,
				CarrierOperatingEntityCode:                detail.CarrierOperatingEntityCode,
				CarrierOperatingEntityName:                detail.CarrierOperatingEntityName,
				CarrierServiceRelationshipObjectID:        detail.CarrierServiceRelationshipObjectID,
				CarrierServiceRelationshipApprovalEntryID: detail.CarrierServiceRelationshipApprovalEntryID,
				CarrierServiceRelationshipCode:            detail.CarrierServiceRelationshipCode,
				CarrierServiceRelationshipName:            detail.CarrierServiceRelationshipName,
				VehicleObjectID:                           detail.VehicleObjectID, VehicleApprovalEntryID: detail.VehicleApprovalEntryID,
				VehicleCode: detail.VehicleCode, VehicleName: detail.VehicleName,
				VehiclePlateNumber:       detail.VehiclePlateNumber,
				VehicleBulkLiquidCapable: detail.VehicleBulkLiquidCapable,
				DocumentID:               id,
			})
		}
	}
	if err != nil {
		return MutationResult{}, s.writeError("write sale delivery", err)
	}
	event := "CREATED"
	if replacingID != "" {
		event = "SAVED"
	}
	if err = insertAudit(ctx, s.queries.WithTx(tx), auditInput{
		DocumentID: id, Entity: EntitySaleDelivery, Event: event, From: stringPtr(StatusDraft),
		To: StatusDraft, ActorID: actorID, RequestID: requestID,
		Summary: map[string]any{"parentDocumentId": source.ID},
	}); err != nil {
		return MutationResult{}, err
	}
	return MutationResult{DocumentID: id, DocumentNo: number, Status: StatusDraft, Revision: revision}, nil
}

func (s *Service) writeSaleSignoff(
	ctx context.Context,
	tx pgx.Tx,
	replacingID string,
	data DraftInput,
	date time.Time,
	remark *string,
	actorID, requestID string,
) (MutationResult, error) {
	lines, err := validateSignoffLines(data.SignoffLines)
	if err != nil {
		return MutationResult{}, err
	}
	source, err := s.lockSalesSource(ctx, tx, data.SourceDocumentID, EntitySaleDelivery)
	if err != nil {
		return MutationResult{}, err
	}
	if date.Before(source.BusinessDate) {
		return MutationResult{}, domainError(ErrorValidation, "signoff date precedes delivery date", nil, nil)
	}
	var outboundID, orderID string
	if err = tx.QueryRow(ctx, `SELECT d.source_outbound_id,o.source_order_id
		FROM vou_sale_delivery_details d JOIN vou_sale_outbound_details o ON o.document_id=d.source_outbound_id
		WHERE d.document_id=$1`, source.ID).Scan(&outboundID, &orderID); err != nil {
		return MutationResult{}, s.internal("read signoff sources", err)
	}
	var existing int64
	if err = tx.QueryRow(ctx, `SELECT count(*) FROM vou_sale_signoff_details
		WHERE source_delivery_id=$1 AND document_id<>$2`, source.ID, replacingID).Scan(&existing); err != nil {
		return MutationResult{}, s.internal("check existing signoff", err)
	}
	if existing != 0 {
		return MutationResult{}, domainError(ErrorConflict, "delivery already has a signoff", nil, nil)
	}
	type signoffLine struct {
		fixedSignoffLine
		lineNo                                                                                      int32
		orderLineID, productObjectID, productApprovalEntryID, productCode, productName, productUnit string
		outbound, loss, price, amount                                                               int64
	}
	resolved := make([]signoffLine, 0, len(lines))
	var total int64
	for index, line := range lines {
		var item signoffLine
		item.fixedSignoffLine, item.lineNo = line, int32(index+1)
		err = tx.QueryRow(ctx, `SELECT source_order_line_id,product_object_id,product_approval_entry_id,
			product_code,product_name,entered_unit_symbol,base_quantity_micros,unit_price_cents
			FROM vou_sale_outbound_lines WHERE id=$1 AND document_id=$2`,
			line.SourceLineID, outboundID).Scan(
			&item.orderLineID, &item.productObjectID, &item.productApprovalEntryID,
			&item.productCode, &item.productName, &item.productUnit, &item.outbound, &item.price)
		if err != nil || line.Signed+line.Rejected > item.outbound {
			return MutationResult{}, domainError(ErrorValidation, "invalid outbound source line", nil, err)
		}
		item.loss = item.outbound - line.Signed - line.Rejected
		item.amount, err = lineAmountCents(line.Signed, item.price)
		if err != nil || total > math.MaxInt64-item.amount {
			return MutationResult{}, domainError(ErrorValidation, "signoff amount out of range", nil, err)
		}
		total += item.amount
		resolved = append(resolved, item)
	}
	var sourceLineCount int64
	if err = tx.QueryRow(ctx, `SELECT count(*) FROM vou_sale_outbound_lines WHERE document_id=$1`,
		outboundID).Scan(&sourceLineCount); err != nil || int64(len(resolved)) != sourceLineCount {
		return MutationResult{}, domainError(ErrorValidation, "signoff must include every outbound line", nil, err)
	}
	dueDate, err := s.orderSettlementDueDate(ctx, tx, EntitySaleOrder, orderID, date)
	if err != nil {
		return MutationResult{}, err
	}
	id, number, revision := replacingID, "", int64(1)
	if replacingID == "" {
		id, number, err = s.insertChainDocument(
			ctx, tx, EntitySaleSignoff, source.ID, date, source.Currency, total, remark, actorID,
		)
		if err == nil {
			_, err = tx.Exec(ctx, `INSERT INTO vou_sale_signoff_details(
				document_id,source_delivery_id,source_outbound_id,source_order_id,
				customer_object_id,customer_approval_entry_id,customer_code,customer_name,
				warehouse_object_id,warehouse_approval_entry_id,warehouse_code,warehouse_name)
				VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
				id, source.ID, outboundID, orderID,
				source.CustomerObjectID, source.CustomerApprovalEntryID, source.CustomerCode, source.CustomerName,
				source.WarehouseObjectID, source.WarehouseApprovalEntryID, source.WarehouseCode, source.WarehouseName)
		}
	} else {
		err = tx.QueryRow(ctx, `SELECT document_no FROM vou_documents WHERE id=$1`, id).Scan(&number)
		if err == nil {
			revision, err = s.updateChainDocument(ctx, tx, id, EntitySaleSignoff, date, source.Currency, total, remark, actorID)
		}
		if err == nil {
			_, err = tx.Exec(ctx, `DELETE FROM vou_sale_signoff_lines WHERE document_id=$1`, id)
		}
	}
	if err != nil {
		return MutationResult{}, s.writeError("write sale signoff", err)
	}
	if _, err = tx.Exec(ctx, `UPDATE vou_documents SET due_date=$1 WHERE id=$2`, dueDate, id); err != nil {
		return MutationResult{}, s.writeError("set sale signoff due date", err)
	}
	for _, line := range resolved {
		_, err = tx.Exec(ctx, `INSERT INTO vou_sale_signoff_lines(
			id,document_id,source_outbound_line_id,source_order_line_id,line_no,
			product_object_id,product_approval_entry_id,product_code,product_name,entered_unit_symbol,
			signed_base_quantity_micros,rejected_base_quantity_micros,loss_base_quantity_micros,unit_price_cents,line_amount_cents,remark)
			VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
			newID(), id, line.SourceLineID, line.orderLineID, line.lineNo,
			line.productObjectID, line.productApprovalEntryID, line.productCode, line.productName, line.productUnit,
			line.Signed, line.Rejected, line.loss, line.price, line.amount, line.Remark)
		if err != nil {
			return MutationResult{}, s.writeError("write sale signoff line", err)
		}
	}
	event := "CREATED"
	if replacingID != "" {
		event = "SAVED"
	}
	if err = insertAudit(ctx, s.queries.WithTx(tx), auditInput{
		DocumentID: id, Entity: EntitySaleSignoff, Event: event, From: stringPtr(StatusDraft),
		To: StatusDraft, ActorID: actorID, RequestID: requestID,
		Summary: map[string]any{"parentDocumentId": source.ID},
	}); err != nil {
		return MutationResult{}, err
	}
	return MutationResult{DocumentID: id, DocumentNo: number, Status: StatusDraft, Revision: revision}, nil
}

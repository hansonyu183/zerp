package led

import (
	"context"
	"sort"

	dbsqlc "github.com/hansonyu183/zerp/backend/internal/database/sqlc"
	"github.com/jackc/pgx/v5"
)

type productionInventoryPostingLine struct {
	id, warehouseObjectID, warehouseVersionID, warehouseCode, warehouseName  string
	productObjectID, productVersionID, productCode, productName, productUnit string
	quantity                                                                 int64
	remark                                                                   *string
}

func (s *Service) postProduction(
	ctx context.Context,
	tx pgx.Tx,
	q *dbsqlc.Queries,
	posting postingContext,
) error {
	doc := posting.Document
	include, err := requireEffectiveDate(posting, doc.BusinessDate)
	if err != nil || !include {
		return err
	}
	var materialWarehouseID, materialWarehouseVersion, materialWarehouseCode, materialWarehouseName string
	var finishedWarehouseID, finishedWarehouseVersion, finishedWarehouseCode, finishedWarehouseName string
	err = tx.QueryRow(ctx, `SELECT
		material_warehouse_object_id,material_warehouse_version_id,
		material_warehouse_code,material_warehouse_name,
		finished_warehouse_object_id,finished_warehouse_version_id,
		finished_warehouse_code,finished_warehouse_name
		FROM vou_production_details WHERE document_id=$1`, doc.ID).Scan(
		&materialWarehouseID, &materialWarehouseVersion,
		&materialWarehouseCode, &materialWarehouseName,
		&finishedWarehouseID, &finishedWarehouseVersion,
		&finishedWarehouseCode, &finishedWarehouseName,
	)
	if err != nil {
		return s.internal("read production ledger detail", err)
	}
	lines := make([]productionInventoryPostingLine, 0)
	rows, err := tx.Query(ctx, `SELECT material.id,
		material.actual_material_object_id,material.actual_material_version_id,
		material.actual_material_code,material.actual_material_name,
		material.actual_material_unit,material.actual_quantity_micros,
		material.adjustment_reason
		FROM vou_production_material_lines material
		JOIN vou_production_output_lines output ON output.id=material.output_line_id
		WHERE output.document_id=$1
		ORDER BY output.line_no,material.line_no`, doc.ID)
	if err != nil {
		return err
	}
	for rows.Next() {
		var line productionInventoryPostingLine
		line.warehouseObjectID = materialWarehouseID
		line.warehouseVersionID = materialWarehouseVersion
		line.warehouseCode = materialWarehouseCode
		line.warehouseName = materialWarehouseName
		if err = rows.Scan(
			&line.id, &line.productObjectID, &line.productVersionID,
			&line.productCode, &line.productName, &line.productUnit,
			&line.quantity, &line.remark,
		); err != nil {
			rows.Close()
			return err
		}
		line.quantity = -line.quantity
		lines = append(lines, line)
	}
	if err = rows.Err(); err != nil {
		rows.Close()
		return err
	}
	rows.Close()
	rows, err = tx.Query(ctx, `SELECT id,product_object_id,product_version_id,
		product_code,product_name,product_unit,output_quantity_micros,remark
		FROM vou_production_output_lines WHERE document_id=$1 ORDER BY line_no`, doc.ID)
	if err != nil {
		return err
	}
	for rows.Next() {
		var line productionInventoryPostingLine
		line.warehouseObjectID = finishedWarehouseID
		line.warehouseVersionID = finishedWarehouseVersion
		line.warehouseCode = finishedWarehouseCode
		line.warehouseName = finishedWarehouseName
		if err = rows.Scan(
			&line.id, &line.productObjectID, &line.productVersionID,
			&line.productCode, &line.productName, &line.productUnit,
			&line.quantity, &line.remark,
		); err != nil {
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

	lockKeys := make([]string, 0, len(lines))
	uniqueKeys := make(map[string]bool, len(lines))
	for _, line := range lines {
		key := line.warehouseObjectID + "/" + line.productObjectID
		if !uniqueKeys[key] {
			uniqueKeys[key] = true
			lockKeys = append(lockKeys, key)
		}
	}
	sort.Strings(lockKeys)
	for _, key := range lockKeys {
		if _, err = tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, key); err != nil {
			return err
		}
	}
	for _, line := range lines {
		if err = q.InsertLedInventoryEntry(ctx, dbsqlc.InsertLedInventoryEntryParams{
			ID: newID(), GenerationID: posting.GenerationID, EntryType: posting.EntryType,
			SourceEntity: doc.Entity, SourceDocumentID: doc.ID, SourceDocumentNo: doc.DocumentNo,
			SourceLineID: line.id, SourceRevision: posting.SourceRevision,
			EffectiveDate: doc.BusinessDate, OccurredAt: posting.OccurredAt,
			ActorID: posting.ActorID, RequestID: posting.RequestID,
			Remark:             preferredRemark(line.remark, doc.Remark),
			WarehouseObjectID:  line.warehouseObjectID,
			WarehouseVersionID: line.warehouseVersionID,
			WarehouseCode:      line.warehouseCode, WarehouseName: line.warehouseName,
			ProductObjectID: line.productObjectID, ProductVersionID: line.productVersionID,
			ProductCode: line.productCode, ProductName: line.productName,
			ProductUnit: line.productUnit, QuantityDeltaMicros: line.quantity,
			Currency: nil, UnitPriceCents: nil, AmountCents: nil,
		}); err != nil {
			return s.writeError("post production inventory", err)
		}
	}
	return nil
}

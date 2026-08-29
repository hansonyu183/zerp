package bob

import (
	"context"

	dbsqlc "github.com/hansonyu183/zerp/backend/internal/database/sqlc"
)

type WarehouseInventoryConflict struct {
	ProductObjectID string `json:"productObjectId"`
	ProductCode     string `json:"productCode"`
	ProductName     string `json:"productName"`
	Quantity        string `json:"quantity"`
}

type WarehouseDocumentConflict struct {
	DocumentID string `json:"documentId"`
	Entity     string `json:"entity"`
	DocumentNo string `json:"documentNo"`
	Status     string `json:"status,omitempty"`
}

type WarehouseDisableBlockers struct {
	Inventory  []WarehouseInventoryConflict `json:"inventory"`
	Documents  []WarehouseDocumentConflict  `json:"documents"`
	Sources    []WarehouseDocumentConflict  `json:"sources"`
	References []ActiveReferenceCount       `json:"references"`
}

func (result WarehouseDisableBlockers) HasConflicts() bool {
	return len(result.Inventory) != 0 || len(result.Documents) != 0 || len(result.Sources) != 0 || len(result.References) != 0
}

func (s *Service) warehouseDisableBlockers(ctx context.Context, q *dbsqlc.Queries, warehouseID string) (WarehouseDisableBlockers, error) {
	result := WarehouseDisableBlockers{
		Inventory: []WarehouseInventoryConflict{}, Documents: []WarehouseDocumentConflict{}, Sources: []WarehouseDocumentConflict{}, References: []ActiveReferenceCount{},
	}
	inventory, err := q.ListWarehouseDisableInventory(ctx, warehouseID)
	if err != nil {
		return result, s.internal("list warehouse inventory blockers", err)
	}
	for _, row := range inventory {
		result.Inventory = append(result.Inventory, WarehouseInventoryConflict{ProductObjectID: row.ProductID, ProductCode: stringValue(row.ProductCode),
			ProductName: row.ProductName, Quantity: formatMicros(row.QuantityMicros)})
	}
	inProgress, err := q.ListWarehouseDisableInProgressDocuments(ctx, warehouseID)
	if err != nil {
		return result, s.internal("list warehouse in-progress blockers", err)
	}
	for _, row := range inProgress {
		result.Documents = append(result.Documents, WarehouseDocumentConflict{DocumentID: row.DocumentID,
			Entity: row.Entity, DocumentNo: row.DocumentNo, Status: row.Status})
	}
	sources, err := q.ListWarehouseDisableExecutableSources(ctx, warehouseID)
	if err != nil {
		return result, s.internal("list warehouse executable source blockers", err)
	}
	for _, row := range sources {
		result.Sources = append(result.Sources, WarehouseDocumentConflict{DocumentID: row.DocumentID,
			Entity: row.Entity, DocumentNo: row.DocumentNo})
	}
	result.References, err = listActiveReferenceCounts(ctx, q, EntityWarehouse, warehouseID)
	if err != nil {
		return result, s.internal("scan direct references before warehouse disable", err)
	}
	return result, nil
}

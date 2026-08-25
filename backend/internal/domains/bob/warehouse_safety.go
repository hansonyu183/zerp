package bob

import (
	"context"
	"errors"

	dbsqlc "github.com/hansonyu183/zerp/backend/internal/database/sqlc"
	"github.com/hansonyu183/zerp/backend/internal/platform/approval"
	"github.com/jackc/pgx/v5"
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
		result.Inventory = append(result.Inventory, WarehouseInventoryConflict{ProductObjectID: row.ProductID, ProductCode: row.ProductCode,
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

func (s *Service) disableWarehouse(ctx context.Context, input ObjectRevisionInput, actor approval.Actor) (MutationResult, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return MutationResult{}, s.internal("begin warehouse disable", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	qtx := s.queries.WithTx(tx)
	object, err := qtx.LockBobObject(ctx, dbsqlc.LockBobObjectParams{ObjectID: input.ObjectID, Entity: EntityWarehouse})
	if errors.Is(err, pgx.ErrNoRows) {
		return MutationResult{}, domainError(ErrorValidation, "warehouse not found", nil, nil)
	}
	if err != nil {
		return MutationResult{}, s.internal("lock warehouse for disable", err)
	}
	if object.Revision != input.ObjectRevision || !object.Enabled {
		return MutationResult{}, domainError(ErrorConflict, "warehouse availability changed", map[string]any{"objectRevision": object.Revision, "enabled": object.Enabled}, nil)
	}
	latest, err := qtx.GetBobLatestApprovedEntry(ctx, dbsqlc.GetBobLatestApprovedEntryParams{Entity: EntityWarehouse, ObjectID: input.ObjectID})
	if errors.Is(err, pgx.ErrNoRows) {
		return MutationResult{}, domainError(ErrorConflict, "an approved warehouse version is required", nil, nil)
	}
	if err != nil {
		return MutationResult{}, s.internal("lock latest approved warehouse version", err)
	}
	if err = qtx.LockWarehouseDisableInventory(ctx, input.ObjectID); err != nil {
		return MutationResult{}, s.writeError("lock warehouse inventory", err)
	}
	if err = qtx.LockWarehouseDisableDocuments(ctx, input.ObjectID); err != nil {
		return MutationResult{}, s.writeError("lock warehouse documents", err)
	}
	conflicts, err := s.warehouseDisableBlockers(ctx, qtx, input.ObjectID)
	if err != nil {
		return MutationResult{}, err
	}
	if conflicts.HasConflicts() {
		return MutationResult{}, domainErrorWithKey(ErrorConflict, "warehouse_disable_blocked", "warehouse cannot be disabled", conflicts, nil)
	}
	rows, err := qtx.SetBobObjectEnabled(ctx, dbsqlc.SetBobObjectEnabledParams{Enabled: false, ActorID: actor.ID(),
		ObjectID: input.ObjectID, Entity: EntityWarehouse, ObjectRevision: input.ObjectRevision})
	if err != nil {
		return MutationResult{}, s.writeError("disable warehouse", err)
	}
	if rows != 1 {
		return MutationResult{}, domainError(ErrorConflict, "warehouse availability changed", nil, nil)
	}
	if err = tx.Commit(ctx); err != nil {
		return MutationResult{}, s.writeError("commit warehouse disable", err)
	}
	return MutationResult{ObjectID: object.ID, ObjectRevision: object.Revision + 1, Enabled: false, Approval: approvalMeta(latest)}, nil
}

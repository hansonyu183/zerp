package bob

import (
	"context"
	"errors"

	dbsqlc "github.com/hansonyu183/zerp/backend/internal/database/sqlc"
	"github.com/hansonyu183/zerp/backend/internal/platform/systemidentity"
	"github.com/jackc/pgx/v5"
)

type WarehouseDisablePrecheckInput struct {
	ObjectID string `json:"objectId"`
}

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

type WarehouseDisablePrecheckResult struct {
	Inventory           []WarehouseInventoryConflict `json:"inventory"`
	InProgressDocuments []WarehouseDocumentConflict  `json:"inProgressDocuments"`
	ExecutableSources   []WarehouseDocumentConflict  `json:"executableSources"`
}

func (result WarehouseDisablePrecheckResult) HasConflicts() bool {
	return len(result.Inventory) != 0 || len(result.InProgressDocuments) != 0 || len(result.ExecutableSources) != 0
}

func (s *Service) WarehouseDisablePrecheck(ctx context.Context, input WarehouseDisablePrecheckInput) (WarehouseDisablePrecheckResult, error) {
	if !validID(input.ObjectID) {
		return WarehouseDisablePrecheckResult{}, domainError(ErrorValidation, "invalid warehouse disable precheck", nil, nil)
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return WarehouseDisablePrecheckResult{}, s.internal("begin warehouse disable precheck", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	qtx := s.queries.WithTx(tx)
	object, err := qtx.LockBobObject(ctx, dbsqlc.LockBobObjectParams{ID: input.ObjectID, Entity: EntityWarehouse})
	if errors.Is(err, pgx.ErrNoRows) {
		return WarehouseDisablePrecheckResult{}, domainError(ErrorValidation, "warehouse not found", nil, nil)
	}
	if err != nil {
		return WarehouseDisablePrecheckResult{}, s.internal("read warehouse for disable precheck", err)
	}
	if !object.Enabled || object.EffectiveVersionID == nil {
		return WarehouseDisablePrecheckResult{}, domainError(ErrorConflict, "warehouse availability changed", nil, nil)
	}
	return s.warehouseDisableConflicts(ctx, qtx, input.ObjectID)
}

func (s *Service) warehouseDisableConflicts(ctx context.Context, q *dbsqlc.Queries, warehouseID string) (WarehouseDisablePrecheckResult, error) {
	result := WarehouseDisablePrecheckResult{
		Inventory: []WarehouseInventoryConflict{}, InProgressDocuments: []WarehouseDocumentConflict{}, ExecutableSources: []WarehouseDocumentConflict{},
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
		result.InProgressDocuments = append(result.InProgressDocuments, WarehouseDocumentConflict{DocumentID: row.DocumentID,
			Entity: row.Entity, DocumentNo: row.DocumentNo, Status: row.Status})
	}
	sources, err := q.ListWarehouseDisableExecutableSources(ctx, warehouseID)
	if err != nil {
		return result, s.internal("list warehouse executable source blockers", err)
	}
	for _, row := range sources {
		result.ExecutableSources = append(result.ExecutableSources, WarehouseDocumentConflict{DocumentID: row.DocumentID,
			Entity: row.Entity, DocumentNo: row.DocumentNo})
	}
	return result, nil
}

func (s *Service) disableWarehouse(ctx context.Context, input ObjectRevisionInput, actorID, requestID string) (MutationResult, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return MutationResult{}, s.internal("begin warehouse disable", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	qtx := s.queries.WithTx(tx)
	object, err := qtx.LockBobObject(ctx, dbsqlc.LockBobObjectParams{ID: input.ObjectID, Entity: EntityWarehouse})
	if errors.Is(err, pgx.ErrNoRows) {
		return MutationResult{}, domainError(ErrorValidation, "warehouse not found", nil, nil)
	}
	if err != nil {
		return MutationResult{}, s.internal("lock warehouse for disable", err)
	}
	if object.Revision != input.ObjectRevision || object.EffectiveVersionID == nil || !object.Enabled {
		return MutationResult{}, domainError(ErrorConflict, "warehouse availability changed", map[string]any{"objectRevision": object.Revision, "enabled": object.Enabled}, nil)
	}
	version, err := qtx.LockBobVersion(ctx, dbsqlc.LockBobVersionParams{ID: *object.EffectiveVersionID, ObjectID: input.ObjectID, Entity: EntityWarehouse})
	if err != nil || version.Status != StatusEffective {
		return MutationResult{}, s.internal("lock warehouse effective version", err)
	}
	if err = qtx.LockWarehouseDisableInventory(ctx, input.ObjectID); err != nil {
		return MutationResult{}, s.writeError("lock warehouse inventory", err)
	}
	if err = qtx.LockWarehouseDisableDocuments(ctx, input.ObjectID); err != nil {
		return MutationResult{}, s.writeError("lock warehouse documents", err)
	}
	conflicts, err := s.warehouseDisableConflicts(ctx, qtx, input.ObjectID)
	if err != nil {
		return MutationResult{}, err
	}
	if conflicts.HasConflicts() {
		return MutationResult{}, domainError(ErrorConflict, "warehouse cannot be disabled", conflicts, nil)
	}
	rows, err := qtx.SetBobObjectEnabled(ctx, dbsqlc.SetBobObjectEnabledParams{Enabled: false, ActorID: actorID,
		ID: input.ObjectID, Entity: EntityWarehouse, Revision: input.ObjectRevision})
	if err != nil {
		return MutationResult{}, s.writeError("disable warehouse", err)
	}
	if rows != 1 {
		return MutationResult{}, conflict(object, version, "warehouse availability changed")
	}
	from := StatusEffective
	if err = insertAudit(ctx, qtx, auditInput{ObjectID: input.ObjectID, VersionID: version.ID, Entity: EntityWarehouse,
		Event: "DISABLED", From: &from, To: StatusEffective, ActorID: actorID, RequestID: requestID,
		Summary: map[string]any{"enabled": false}}); err != nil {
		return MutationResult{}, s.writeError("audit warehouse disable", err)
	}
	if err = tx.Commit(ctx); err != nil {
		return MutationResult{}, s.writeError("commit warehouse disable", err)
	}
	result := mutation(object, version, StatusEffective, version.Revision)
	result.ObjectRevision++
	result.Enabled = false
	return result, nil
}

func (s *Service) clearWarehouseManagersForDisabledEmployee(ctx context.Context, qtx *dbsqlc.Queries, employeeID, actorID, requestID string) error {
	references, err := qtx.ListWarehouseManagerReferencesForEmployee(ctx, &employeeID)
	if err != nil {
		return s.internal("list warehouse manager references", err)
	}
	for _, reference := range references {
		warehouse, err := qtx.LockBobObject(ctx, dbsqlc.LockBobObjectParams{ID: reference.ObjectID, Entity: EntityWarehouse})
		if err != nil {
			return s.internal("lock warehouse manager reference", err)
		}
		if warehouse.EffectiveVersionID == nil || warehouse.CurrentVersionID != *warehouse.EffectiveVersionID {
			return domainError(ErrorConflict, "warehouse manager cleanup conflicts with an existing candidate", map[string]any{"warehouseObjectId": reference.ObjectID}, nil)
		}
		current, err := qtx.LockBobVersion(ctx, dbsqlc.LockBobVersionParams{ID: warehouse.CurrentVersionID, ObjectID: reference.ObjectID, Entity: EntityWarehouse})
		if err != nil || current.Status != StatusEffective {
			return s.internal("lock warehouse manager version", err)
		}
		candidateID := newID()
		if err = qtx.InsertBobVersion(ctx, dbsqlc.InsertBobVersionParams{ID: candidateID, ObjectID: reference.ObjectID,
			Entity: EntityWarehouse, VersionNo: warehouse.NextVersionNo, ActorID: actorID}); err != nil {
			return s.writeError("insert warehouse manager cleanup version", err)
		}
		if err = copyDetail(ctx, qtx, EntityWarehouse, candidateID, current.ID); err != nil {
			return s.writeError("copy warehouse manager cleanup version", err)
		}
		if err = qtx.ClearWarehouseManagerReference(ctx, candidateID); err != nil {
			return s.writeError("clear warehouse manager", err)
		}
		rows, err := qtx.InvalidateBobVersion(ctx, dbsqlc.InvalidateBobVersionParams{ActorID: actorID, ID: current.ID,
			ObjectID: reference.ObjectID, Entity: EntityWarehouse, Revision: current.Revision})
		if err != nil || rows != 1 {
			return s.writeError("freeze previous warehouse manager version", err)
		}
		systemActor := systemidentity.UserID
		rows, err = qtx.ActivateSystemManagedVersion(ctx, dbsqlc.ActivateSystemManagedVersionParams{SubmittedBy: &systemActor,
			ActorID: &actorID, VersionID: candidateID, ObjectID: reference.ObjectID, Entity: EntityWarehouse})
		if err != nil || rows != 1 {
			return s.writeError("activate warehouse manager cleanup version", err)
		}
		rows, err = qtx.SwitchSystemManagedObjectVersion(ctx, dbsqlc.SwitchSystemManagedObjectVersionParams{NewVersionID: candidateID,
			ActorID: actorID, ObjectID: reference.ObjectID, Entity: EntityWarehouse, Revision: warehouse.Revision, OldVersionID: current.ID})
		if err != nil || rows != 1 {
			return s.writeError("switch warehouse manager cleanup version", err)
		}
		from := StatusEffective
		if err = insertAudit(ctx, qtx, auditInput{ObjectID: reference.ObjectID, VersionID: candidateID, Entity: EntityWarehouse,
			Event: "WAREHOUSE_MANAGER_CLEARED", From: &from, To: StatusEffective, ActorID: actorID, RequestID: requestID,
			Summary: map[string]any{"managerEmployeeId": employeeID, "sourceVersionId": current.ID}}); err != nil {
			return s.writeError("audit warehouse manager cleanup", err)
		}
	}
	return nil
}

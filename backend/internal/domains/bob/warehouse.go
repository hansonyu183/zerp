package bob

import (
	"context"
	"errors"
	"fmt"
	"strings"

	dbsqlc "github.com/hansonyu183/zerp/backend/internal/database/sqlc"
	"github.com/hansonyu183/zerp/backend/internal/platform/approval"
	"github.com/jackc/pgx/v5"
)

// WarehouseData is the fixed declaration shape. Category is deliberately not
// exposed: legacy category snapshots are only retained by the cutover tables.
type WarehouseData struct {
	Name, Address, ContactName, ContactPhone, ManagerEmployeeID, Remark string
	ManagerEmployeeApprovalEntryID                                      string
}

type WarehouseIdentity struct {
	ObjectID, Code string
	ObjectRevision int64
}
type WarehouseCurrent struct {
	WarehouseIdentity
	SourceApprovalEntryID string
	Enabled               bool
	Data                  WarehouseData
}

func ValidateWarehouseData(input WarehouseData) (WarehouseData, error) {
	data, _, err := validateCreate(EntityWarehouse, CreateDetailInput{Name: strings.TrimSpace(input.Name), Address: strings.TrimSpace(input.Address), ContactName: strings.TrimSpace(input.ContactName), ContactPhone: strings.TrimSpace(input.ContactPhone), ManagerEmployeeID: strings.TrimSpace(input.ManagerEmployeeID), Remark: strings.TrimSpace(input.Remark)})
	if err != nil {
		return WarehouseData{}, err
	}
	managerApprovalEntryID := strings.TrimSpace(input.ManagerEmployeeApprovalEntryID)
	if data.ManagerEmployeeID == "" {
		managerApprovalEntryID = ""
	} else if managerApprovalEntryID != "" && !validID(managerApprovalEntryID) {
		return WarehouseData{}, domainError(ErrorValidation, "invalid warehouse manager approval snapshot", nil, nil)
	}
	return WarehouseData{Name: data.Name, Address: data.Address, ContactName: data.ContactName, ContactPhone: data.ContactPhone, ManagerEmployeeID: data.ManagerEmployeeID, ManagerEmployeeApprovalEntryID: managerApprovalEntryID, Remark: data.Remark}, nil
}

func (s *Service) ReserveWarehouseIdentity(ctx context.Context, tx pgx.Tx, actorID string) (WarehouseIdentity, error) {
	if tx == nil || !validID(actorID) {
		return WarehouseIdentity{}, domainError(ErrorValidation, "invalid warehouse identity request", nil, nil)
	}
	q := s.queries.WithTx(tx)
	counter, err := q.NextObjectNumberCounter(ctx, dbsqlc.NextObjectNumberCounterParams{Domain: "bob", Entity: EntityWarehouse})
	if errors.Is(err, pgx.ErrNoRows) {
		return WarehouseIdentity{}, domainError(ErrorConflict, "object number exhausted", nil, nil)
	}
	if err != nil {
		return WarehouseIdentity{}, s.writeError("allocate warehouse number", err)
	}
	identity := WarehouseIdentity{ObjectID: newID(), Code: fmt.Sprintf("WHS-%04d", counter), ObjectRevision: 1}
	if err = q.InsertBobObject(ctx, dbsqlc.InsertBobObjectParams{ID: identity.ObjectID, Entity: EntityWarehouse, Code: identity.Code, ActorID: actorID}); err != nil {
		return WarehouseIdentity{}, s.writeError("reserve warehouse identity", err)
	}
	return identity, nil
}

func (s *Service) GetWarehouseIdentity(ctx context.Context, tx pgx.Tx, objectID string) (WarehouseIdentity, error) {
	if tx == nil || !validID(objectID) {
		return WarehouseIdentity{}, domainError(ErrorValidation, "invalid warehouse identity request", nil, nil)
	}
	r, err := s.queries.WithTx(tx).LockBobObject(ctx, dbsqlc.LockBobObjectParams{ObjectID: objectID, Entity: EntityWarehouse})
	if errors.Is(err, pgx.ErrNoRows) {
		return WarehouseIdentity{}, domainError(ErrorValidation, "warehouse not found", nil, nil)
	}
	if err != nil {
		return WarehouseIdentity{}, s.internal("lock warehouse identity", err)
	}
	return WarehouseIdentity{ObjectID: r.ID, Code: r.Code, ObjectRevision: r.Revision}, nil
}

func (s *Service) ResolveWarehouseManager(ctx context.Context, tx pgx.Tx, data WarehouseData, exact bool) (WarehouseData, error) {
	if data.ManagerEmployeeID == "" {
		data.ManagerEmployeeApprovalEntryID = ""
		return data, nil
	}
	var ref EffectiveReference
	var err error
	if exact {
		if data.ManagerEmployeeApprovalEntryID == "" {
			return WarehouseData{}, domainError(ErrorConflict, "employee approval snapshot is missing", nil, nil)
		}
		ref, err = s.ValidateApprovedSnapshotReference(ctx, tx, EntityEmployee, data.ManagerEmployeeID, data.ManagerEmployeeApprovalEntryID)
	} else {
		ref, err = s.ResolveLatestApprovedReference(ctx, tx, EntityEmployee, data.ManagerEmployeeID)
	}
	if err != nil {
		return WarehouseData{}, err
	}
	data.ManagerEmployeeApprovalEntryID = ref.ApprovalEntryID
	return data, nil
}

func (s *Service) ApplyWarehouseCurrent(ctx context.Context, tx pgx.Tx, objectID, entryID string, enabled bool, data WarehouseData, actorID string) (WarehouseCurrent, error) {
	if tx == nil || !validID(objectID) || !validID(entryID) || !validID(actorID) {
		return WarehouseCurrent{}, domainError(ErrorValidation, "invalid warehouse current apply", nil, nil)
	}
	validated, err := ValidateWarehouseData(data)
	if err != nil {
		return WarehouseCurrent{}, err
	}
	q := s.queries.WithTx(tx)
	if err = q.UpsertBobWarehouseCurrent(ctx, dbsqlc.UpsertBobWarehouseCurrentParams{ObjectID: objectID, SourceApprovalEntryID: entryID, Name: validated.Name, Address: nilIfEmpty(validated.Address), ContactName: nilIfEmpty(validated.ContactName), ContactPhone: nilIfEmpty(validated.ContactPhone), ManagerEmployeeID: nilIfEmpty(validated.ManagerEmployeeID), ManagerEmployeeApprovalEntryID: nilIfEmpty(validated.ManagerEmployeeApprovalEntryID), Remark: nilIfEmpty(validated.Remark), Enabled: enabled, ActorID: actorID}); err != nil {
		return WarehouseCurrent{}, s.writeError("apply warehouse current data", err)
	}
	o, err := q.TouchBobObject(ctx, dbsqlc.TouchBobObjectParams{ActorID: actorID, ObjectID: objectID, Entity: EntityWarehouse})
	if err != nil {
		return WarehouseCurrent{}, s.writeError("touch warehouse current", err)
	}
	return WarehouseCurrent{WarehouseIdentity: WarehouseIdentity{ObjectID: o.ID, Code: o.Code, ObjectRevision: o.Revision}, SourceApprovalEntryID: entryID, Enabled: enabled, Data: validated}, nil
}

func (s *Service) RemoveWarehouseCurrent(ctx context.Context, tx pgx.Tx, objectID, actorID string) (WarehouseIdentity, error) {
	if tx == nil || !validID(objectID) || !validID(actorID) {
		return WarehouseIdentity{}, domainError(ErrorValidation, "invalid warehouse current removal", nil, nil)
	}
	q := s.queries.WithTx(tx)
	rows, err := q.DeleteBobWarehouseCurrent(ctx, objectID)
	if err != nil {
		return WarehouseIdentity{}, s.writeError("remove warehouse current", err)
	}
	if rows != 1 {
		return WarehouseIdentity{}, domainError(ErrorConflict, "warehouse current data changed", nil, nil)
	}
	o, err := q.TouchBobObject(ctx, dbsqlc.TouchBobObjectParams{ActorID: actorID, ObjectID: objectID, Entity: EntityWarehouse})
	if err != nil {
		return WarehouseIdentity{}, s.writeError("touch warehouse current removal", err)
	}
	return WarehouseIdentity{ObjectID: o.ID, Code: o.Code, ObjectRevision: o.Revision}, nil
}

func (s *Service) DeleteWarehouseIdentity(ctx context.Context, tx pgx.Tx, objectID string, revision int64) error {
	if tx == nil || !validID(objectID) || revision < 1 {
		return domainError(ErrorValidation, "invalid warehouse identity deletion", nil, nil)
	}
	rows, err := s.queries.WithTx(tx).DeleteBobObject(ctx, dbsqlc.DeleteBobObjectParams{ObjectID: objectID, Entity: EntityWarehouse, ObjectRevision: revision})
	if err != nil {
		return s.writeError("delete warehouse identity", err)
	}
	if rows != 1 {
		return domainError(ErrorConflict, "warehouse identity changed", nil, nil)
	}
	return nil
}

func (s *Service) EnsureWarehouseUnapproveAllowed(ctx context.Context, tx pgx.Tx, entryID string) error {
	if tx == nil || !validID(entryID) {
		return domainError(ErrorValidation, "invalid warehouse unapprove request", nil, nil)
	}
	return s.ensureUnapproveAllowed(ctx, s.queries.WithTx(tx), entryID)
}

func (s *Service) EnsureWarehouseDisableAllowed(ctx context.Context, tx pgx.Tx, warehouseID string) (WarehouseDisableBlockers, error) {
	q := s.queries.WithTx(tx)
	if err := q.LockWarehouseDisableInventory(ctx, warehouseID); err != nil {
		return WarehouseDisableBlockers{}, s.writeError("lock warehouse inventory", err)
	}
	if err := q.LockWarehouseDisableDocuments(ctx, warehouseID); err != nil {
		return WarehouseDisableBlockers{}, s.writeError("lock warehouse documents", err)
	}
	return s.warehouseDisableBlockers(ctx, q, warehouseID)
}

func warehouseDetail(data WarehouseData) DetailView {
	return DetailView{Name: data.Name, Address: data.Address, ContactName: data.ContactName, ContactPhone: data.ContactPhone, ManagerEmployeeID: data.ManagerEmployeeID, ManagerEmployeeApprovalEntryID: data.ManagerEmployeeApprovalEntryID, Remark: data.Remark}
}
func warehouseData(r dbsqlc.DclWarehouseVersion) WarehouseData {
	return WarehouseData{Name: r.Name, Address: deref(r.Address), ContactName: deref(r.ContactName), ContactPhone: deref(r.ContactPhone), ManagerEmployeeID: deref(r.ManagerEmployeeID), ManagerEmployeeApprovalEntryID: deref(r.ManagerEmployeeApprovalEntryID), Remark: deref(r.Remark)}
}

func (s *Service) getWarehouseCurrent(ctx context.Context, input GetInput) (ObjectView, error) {
	if !validID(input.ObjectID) || input.ApprovalEntryID != "" {
		return ObjectView{}, domainError(ErrorValidation, "invalid warehouse get request", nil, nil)
	}
	r, err := s.queries.GetBobWarehouseCurrent(ctx, input.ObjectID)
	if errors.Is(err, pgx.ErrNoRows) {
		return ObjectView{}, domainError(ErrorValidation, "warehouse not found", nil, nil)
	}
	if err != nil {
		return ObjectView{}, s.internal("get warehouse current", err)
	}
	entry := dbsqlc.ApprovalEntry{ID: r.ApprovalEntryID, Domain: r.Domain, Entity: EntityWarehouse, SubjectID: r.ObjectID, VersionNo: r.VersionNo, Status: r.Status, Revision: r.ApprovalRevision, CreatedBy: r.CreatedBy, CreatedAt: r.CreatedAt, UpdatedBy: r.UpdatedBy, UpdatedAt: r.ApprovalUpdatedAt, SubmittedBy: r.SubmittedBy, SubmittedAt: r.SubmittedAt, ApprovedBy: r.ApprovedBy, ApprovedAt: r.ApprovedAt}
	return ObjectView{ObjectID: r.ObjectID, Entity: r.Entity, Code: r.Code, ObjectRevision: r.ObjectRevision, Enabled: r.Enabled, SourceApprovalEntryID: entry.ID, SourceVersionNo: versionNumber(entry.VersionNo), Data: DetailView{Name: r.Name, Address: deref(r.Address), ContactName: deref(r.ContactName), ContactPhone: deref(r.ContactPhone), ManagerEmployeeID: deref(r.ManagerEmployeeID), ManagerEmployeeApprovalEntryID: deref(r.ManagerEmployeeApprovalEntryID), Remark: deref(r.Remark)}, UpdatedAt: r.UpdatedAt.Time}, nil
}

func (s *Service) queryWarehouses(ctx context.Context, input QueryInput) (Page[QueryItem], error) {
	offset, ok := pageOffset(input.Page, input.PageSize)
	if !ok || len(input.Sort) > 1 {
		return Page[QueryItem]{}, domainError(ErrorValidation, "invalid query", nil, nil)
	}
	filters, err := validateQueryFilters(EntityWarehouse, input.Filters)
	if err != nil {
		return Page[QueryItem]{}, err
	}
	sortField, sortOrder := "updatedAt", "desc"
	if len(input.Sort) == 1 {
		sortField, sortOrder = input.Sort[0].Field, strings.ToLower(input.Sort[0].Order)
		if !strings.Contains("updatedAt code name", sortField) || (sortOrder != "asc" && sortOrder != "desc") {
			return Page[QueryItem]{}, domainError(ErrorValidation, "invalid sort", nil, nil)
		}
	}
	enabled := int32(-1)
	if filters.Enabled != nil {
		if *filters.Enabled {
			enabled = 1
		} else {
			enabled = 0
		}
	}
	rows, err := s.queries.ListBobWarehouses(ctx, dbsqlc.ListBobWarehousesParams{Keyword: strings.TrimSpace(filters.Keyword), EnabledFilter: enabled, SortField: sortField, SortOrder: sortOrder, RowOffset: offset, RowLimit: int32(input.PageSize)})
	if err != nil {
		return Page[QueryItem]{}, s.internal("list warehouse current", err)
	}
	total, err := s.queries.CountBobWarehouses(ctx, dbsqlc.CountBobWarehousesParams{Keyword: strings.TrimSpace(filters.Keyword), EnabledFilter: enabled})
	if err != nil {
		return Page[QueryItem]{}, s.internal("count warehouse current", err)
	}
	items := make([]QueryItem, 0, len(rows))
	for _, r := range rows {
		v, e := s.getWarehouseCurrent(ctx, GetInput{ObjectID: r.ObjectID})
		if e != nil {
			return Page[QueryItem]{}, e
		}
		items = append(items, QueryItem{ObjectID: r.ObjectID, Entity: r.Entity, Code: r.Code, ObjectRevision: r.ObjectRevision, Enabled: r.Enabled, SourceApprovalEntryID: v.SourceApprovalEntryID, SourceVersionNo: v.SourceVersionNo, Data: v.Data, UpdatedAt: r.UpdatedAt.Time})
	}
	return Page[QueryItem]{Items: items, Total: total, Page: input.Page, PageSize: input.PageSize}, nil
}

func (s *Service) validateWarehouseSnapshotReference(ctx context.Context, q *dbsqlc.Queries, objectID, entryID string) (EffectiveReference, error) {
	entry, err := q.GetApprovalEntry(ctx, dbsqlc.GetApprovalEntryParams{ID: entryID, Domain: "dcl", Entity: EntityWarehouse})
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && (entry.SubjectID != objectID || entry.Status != string(approval.StatusApproved))) {
		return EffectiveReference{}, domainError(ErrorConflict, "BOB approval snapshot is unavailable", nil, nil)
	}
	if err != nil {
		return EffectiveReference{}, s.internal("validate DCL warehouse snapshot", err)
	}
	o, err := q.GetBobObject(ctx, dbsqlc.GetBobObjectParams{ObjectID: objectID, Entity: EntityWarehouse})
	if err != nil {
		return EffectiveReference{}, s.internal("load warehouse identity", err)
	}
	stored, err := q.GetDCLWarehouseVersion(ctx, entryID)
	if err != nil {
		return EffectiveReference{}, s.internal("load DCL warehouse snapshot", err)
	}
	return EffectiveReference{ObjectID: o.ID, Entity: o.Entity, Code: o.Code, ApprovalEntryID: entry.ID, Data: warehouseDetail(warehouseData(stored))}, nil
}
func (s *Service) resolveWarehouseCurrentReference(ctx context.Context, q *dbsqlc.Queries, objectID string) (EffectiveReference, error) {
	r, err := q.GetBobWarehouseCurrentReference(ctx, objectID)
	if errors.Is(err, pgx.ErrNoRows) {
		return EffectiveReference{}, domainError(ErrorConflict, "BOB reference has no latest approved version", nil, nil)
	}
	if err != nil {
		return EffectiveReference{}, s.internal("resolve warehouse current", err)
	}
	return EffectiveReference{ObjectID: r.ObjectID, Entity: r.Entity, Code: r.Code, ApprovalEntryID: r.ApprovalEntryID, Data: DetailView{Name: r.Name, Address: deref(r.Address), ContactName: deref(r.ContactName), ContactPhone: deref(r.ContactPhone), ManagerEmployeeID: deref(r.ManagerEmployeeID), ManagerEmployeeApprovalEntryID: deref(r.ManagerEmployeeApprovalEntryID), Remark: deref(r.Remark)}}, nil
}

package bob

import (
	"context"
	"errors"
	"strings"

	dbsqlc "github.com/hansonyu183/zerp/backend/internal/database/sqlc"
	"github.com/jackc/pgx/v5"
)

// WarehouseData is the fixed declaration shape. Category is deliberately not
// exposed: legacy category snapshots are only retained by the cutover tables.
type WarehouseData struct {
	Name, Address, ContactName, ContactPhone, ManagerEmployeeID, Remark string
	ManagerEmployeeApprovalEntryID                                      string
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
		ref, err = s.ValidateHistoricalReference(ctx, tx, EntityEmployee, data.ManagerEmployeeID, data.ManagerEmployeeApprovalEntryID)
	} else {
		ref, err = s.ResolveCurrentReference(ctx, tx, EntityEmployee, data.ManagerEmployeeID)
	}
	if err != nil {
		return WarehouseData{}, err
	}
	data.ManagerEmployeeApprovalEntryID = ref.ApprovalEntryID
	return data, nil
}

func (s *Service) EnsureWarehouseUnapproveAllowed(ctx context.Context, tx pgx.Tx, entryID string) error {
	return s.EnsureUnapproveAllowed(ctx, tx, entryID)
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
	if !validID(input.ObjectID) {
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
	return ObjectView{ObjectID: r.ObjectID, Entity: r.Entity, Code: deref(r.Code), Enabled: r.Enabled, SourceApprovalEntryID: entry.ID, SourceVersionNo: versionNumber(entry.VersionNo), Data: DetailView{Name: r.Name, Address: deref(r.Address), ContactName: deref(r.ContactName), ContactPhone: deref(r.ContactPhone), ManagerEmployeeID: deref(r.ManagerEmployeeID), ManagerEmployeeApprovalEntryID: deref(r.ManagerEmployeeApprovalEntryID), Remark: deref(r.Remark)}, UpdatedAt: r.UpdatedAt.Time}, nil
}

func (s *Service) queryWarehouses(ctx context.Context, q *dbsqlc.Queries, input QueryInput) (Page[QueryItem], error) {
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
		validField := sortField == "updatedAt" || sortField == "code" || sortField == "name"
		if !validField || (sortOrder != "asc" && sortOrder != "desc") {
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
	rows, err := q.ListBobWarehouses(ctx, dbsqlc.ListBobWarehousesParams{Keyword: strings.TrimSpace(filters.Keyword), EnabledFilter: enabled, SortField: sortField, SortOrder: sortOrder, RowOffset: offset, RowLimit: int32(input.PageSize)})
	if err != nil {
		return Page[QueryItem]{}, s.internal("list warehouse current", err)
	}
	total, err := q.CountBobWarehouses(ctx, dbsqlc.CountBobWarehousesParams{Keyword: strings.TrimSpace(filters.Keyword), EnabledFilter: enabled})
	if err != nil {
		return Page[QueryItem]{}, s.internal("count warehouse current", err)
	}
	items := make([]QueryItem, 0, len(rows))
	for _, r := range rows {
		items = append(items, QueryItem{ObjectID: r.ObjectID, Entity: r.Entity, Code: deref(r.Code), Enabled: r.Enabled, SourceApprovalEntryID: r.ApprovalEntryID, SourceVersionNo: versionNumber(r.VersionNo), Data: DetailView{Name: r.Name, Address: deref(r.Address), ContactName: deref(r.ContactName), ContactPhone: deref(r.ContactPhone), ManagerEmployeeID: deref(r.ManagerEmployeeID), ManagerEmployeeApprovalEntryID: deref(r.ManagerEmployeeApprovalEntryID), Remark: deref(r.Remark)}, UpdatedAt: r.UpdatedAt.Time})
	}
	return Page[QueryItem]{Items: items, Total: total, Page: input.Page, PageSize: input.PageSize}, nil
}

func (s *Service) validateWarehouseSnapshotReference(ctx context.Context, q *dbsqlc.Queries, objectID, entryID string) (EffectiveReference, error) {
	entry, err := s.requireHistoricalApprovalEntry(ctx, q, entryID, EntityWarehouse, objectID, "BOB approval snapshot is unavailable")
	if err != nil {
		return EffectiveReference{}, err
	}
	o, err := q.GetDCLSubject(ctx, dbsqlc.GetDCLSubjectParams{ID: objectID, Entity: EntityWarehouse})
	if err != nil {
		return EffectiveReference{}, s.internal("load warehouse identity", err)
	}
	stored, err := q.GetDCLWarehouseVersion(ctx, entryID)
	if err != nil {
		return EffectiveReference{}, s.internal("load DCL warehouse snapshot", err)
	}
	return EffectiveReference{ObjectID: o.ID, Entity: o.Entity, Code: deref(o.Code), ApprovalEntryID: entry.ID, VersionNo: versionNumber(entry.VersionNo), Data: warehouseDetail(warehouseData(stored))}, nil
}
func (s *Service) resolveWarehouseCurrentReference(ctx context.Context, q *dbsqlc.Queries, objectID string) (EffectiveReference, error) {
	r, err := q.GetBobWarehouseCurrentReference(ctx, objectID)
	if errors.Is(err, pgx.ErrNoRows) {
		return EffectiveReference{}, domainError(ErrorConflict, "BOB reference has no latest approved version", nil, nil)
	}
	if err != nil {
		return EffectiveReference{}, s.internal("resolve warehouse current", err)
	}
	return EffectiveReference{ObjectID: r.ObjectID, Entity: r.Entity, Code: deref(r.Code), ApprovalEntryID: r.ApprovalEntryID, VersionNo: versionNumber(r.VersionNo), Data: DetailView{Name: r.Name, Address: deref(r.Address), ContactName: deref(r.ContactName), ContactPhone: deref(r.ContactPhone), ManagerEmployeeID: deref(r.ManagerEmployeeID), ManagerEmployeeApprovalEntryID: deref(r.ManagerEmployeeApprovalEntryID), Remark: deref(r.Remark)}}, nil
}

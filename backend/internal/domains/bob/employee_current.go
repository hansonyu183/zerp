package bob

import (
	"context"
	"errors"
	"strings"

	dbsqlc "github.com/hansonyu183/zerp/backend/internal/database/sqlc"
	"github.com/jackc/pgx/v5"
)

// EmployeeReferenceSnapshot freezes the stable AUX identity and its adopted data.
type EmployeeReferenceSnapshot struct {
	ObjectID, Code, Name string
}

// EmployeeData is the Employee-owned declaration payload. Party identity and
// the immutable operating-entity relationship are deliberately absent.
type EmployeeData struct {
	EmployeeCategory               *EmployeeReferenceSnapshot
	Department                     *EmployeeReferenceSnapshot
	Position                       *EmployeeReferenceSnapshot
	Phone, Email, HireDate, Remark string
}

type EmployeeIdentity struct {
	ObjectID, Code, PartyID, OperatingEntityID string
}

type EmployeeCurrent struct {
	EmployeeIdentity
	SourceApprovalEntryID string
	Enabled               bool
}

func ValidateEmployeeData(input EmployeeData) (EmployeeData, error) {
	input.Phone = strings.TrimSpace(input.Phone)
	input.Email = strings.TrimSpace(input.Email)
	input.HireDate = strings.TrimSpace(input.HireDate)
	input.Remark = strings.TrimSpace(input.Remark)
	if err := validateLengthsAndFormats(DetailView{
		Phone: input.Phone, Email: input.Email, HireDate: input.HireDate, Remark: input.Remark,
	}); err != nil {
		return EmployeeData{}, err
	}
	for _, reference := range []*EmployeeReferenceSnapshot{input.EmployeeCategory, input.Department, input.Position} {
		if reference == nil {
			continue
		}
		reference.ObjectID = strings.TrimSpace(reference.ObjectID)
		reference.Code = strings.TrimSpace(reference.Code)
		reference.Name = strings.TrimSpace(reference.Name)
		if !validID(reference.ObjectID) {
			return EmployeeData{}, domainError(ErrorValidation, "invalid Employee auxiliary reference", nil, nil)
		}
	}
	return input, nil
}

func employeeAuxiliarySnapshot(reference AuxiliaryReference) (EmployeeReferenceSnapshot, error) {
	name, _ := reference.Data["name"].(string)
	snapshot := EmployeeReferenceSnapshot{
		ObjectID: reference.ObjectID,
		Code:     strings.TrimSpace(reference.Code), Name: strings.TrimSpace(name),
	}
	if !validID(snapshot.ObjectID) || snapshot.Code == "" || snapshot.Name == "" {
		return EmployeeReferenceSnapshot{}, domainError(ErrorConflict, "Employee auxiliary snapshot is incomplete", nil, nil)
	}
	return snapshot, nil
}

func (s *Service) ResolveEmployeeAuxiliaryReferences(ctx context.Context, tx pgx.Tx, data EmployeeData, exact bool) (EmployeeData, error) {
	validated, err := ValidateEmployeeData(data)
	if err != nil {
		return EmployeeData{}, err
	}
	targets := []struct {
		entity string
		value  **EmployeeReferenceSnapshot
	}{
		{entity: "employee-category", value: &validated.EmployeeCategory},
		{entity: "department", value: &validated.Department},
		{entity: "position", value: &validated.Position},
	}
	for _, target := range targets {
		if *target.value == nil {
			continue
		}
		input := **target.value
		if exact {
			if input.Code == "" || input.Name == "" {
				return EmployeeData{}, domainError(ErrorConflict, "Employee auxiliary snapshot is incomplete", nil, nil)
			}
			continue
		}
		var reference AuxiliaryReference
		reference, err = s.auxiliaryResolver.ResolveCurrentAuxiliaryReference(ctx, tx, target.entity, input.ObjectID)
		if err != nil {
			return EmployeeData{}, err
		}
		snapshot, snapshotErr := employeeAuxiliarySnapshot(reference)
		if snapshotErr != nil {
			return EmployeeData{}, snapshotErr
		}
		*target.value = &snapshot
	}
	return validated, nil
}

// ResolveEmployeeDraftAuxiliaryReferences preserves typed snapshots for stable
// AUX IDs already adopted by an existing DCL draft. A changed ID is a new
// selection and must resolve from an enabled current AUX object.
func (s *Service) ResolveEmployeeDraftAuxiliaryReferences(ctx context.Context, tx pgx.Tx, data, previous EmployeeData) (EmployeeData, error) {
	validated, err := ValidateEmployeeData(data)
	if err != nil {
		return EmployeeData{}, err
	}
	targets := []struct {
		entity   string
		value    **EmployeeReferenceSnapshot
		previous *EmployeeReferenceSnapshot
	}{
		{entity: "employee-category", value: &validated.EmployeeCategory, previous: previous.EmployeeCategory},
		{entity: "department", value: &validated.Department, previous: previous.Department},
		{entity: "position", value: &validated.Position, previous: previous.Position},
	}
	for _, target := range targets {
		if *target.value == nil {
			continue
		}
		if target.previous != nil && (*target.value).ObjectID == target.previous.ObjectID {
			snapshot := *target.previous
			*target.value = &snapshot
			continue
		}
		reference, resolveErr := s.auxiliaryResolver.ResolveCurrentAuxiliaryReference(ctx, tx, target.entity, (*target.value).ObjectID)
		if resolveErr != nil {
			return EmployeeData{}, resolveErr
		}
		snapshot, snapshotErr := employeeAuxiliarySnapshot(reference)
		if snapshotErr != nil {
			return EmployeeData{}, snapshotErr
		}
		*target.value = &snapshot
	}
	return validated, nil
}

func (s *Service) EnsureEmployeeUnapproveAllowed(ctx context.Context, tx pgx.Tx, entryID string) error {
	return s.EnsureUnapproveAllowed(ctx, tx, entryID)
}

func (s *Service) EnsureEmployeeDisableAllowed(ctx context.Context, tx pgx.Tx, objectID string) error {
	if tx == nil || !validID(objectID) {
		return domainError(ErrorValidation, "invalid Employee disable request", nil, nil)
	}
	counts, err := listActiveReferenceCounts(ctx, s.queries.WithTx(tx), EntityEmployee, objectID)
	if err != nil {
		return s.internal("scan current Employee references", err)
	}
	if len(counts) != 0 {
		return domainErrorWithKey(ErrorConflict, "bob_disable_blocked", "object is referenced by current BOB facts", ActiveReferenceBlockers{References: counts}, nil)
	}
	return nil
}

func employeeDetailFromCurrent(row dbsqlc.GetBobEmployeeCurrentRow) DetailView {
	return DetailView{
		Name: row.DisplayName, CategoryID: deref(row.EmployeeCategoryID),
		CategoryCode: deref(row.EmployeeCategoryCode), CategoryName: deref(row.EmployeeCategoryName),
		DepartmentID: deref(row.DepartmentID), DepartmentCode: deref(row.DepartmentCode), DepartmentName: deref(row.DepartmentName),
		PositionID: deref(row.PositionID), PositionCode: deref(row.PositionCode), PositionName: deref(row.PositionName),
		Phone: deref(row.Phone), Email: deref(row.Email), HireDate: dateString(row.HireDate), Remark: deref(row.Remark),
	}
}

func (s *Service) getEmployeeCurrent(ctx context.Context, input GetInput) (ObjectView, error) {
	if !validID(input.ObjectID) {
		return ObjectView{}, domainError(ErrorValidation, "invalid Employee get request", nil, nil)
	}
	row, err := s.queries.GetBobEmployeeCurrent(ctx, input.ObjectID)
	if errors.Is(err, pgx.ErrNoRows) {
		return ObjectView{}, domainError(ErrorValidation, "Employee not found", nil, nil)
	}
	if err != nil {
		return ObjectView{}, s.internal("get Employee current", err)
	}
	entry := dbsqlc.ApprovalEntry{ID: row.ApprovalEntryID, Domain: row.Domain, Entity: EntityEmployee, SubjectID: row.ObjectID, VersionNo: row.VersionNo, Status: row.Status, Revision: row.ApprovalRevision, CreatedBy: row.CreatedBy, CreatedAt: row.CreatedAt, UpdatedBy: row.UpdatedBy, UpdatedAt: row.ApprovalUpdatedAt, SubmittedBy: row.SubmittedBy, SubmittedAt: row.SubmittedAt, ApprovedBy: row.ApprovedBy, ApprovedAt: row.ApprovedAt}
	return ObjectView{
		ObjectID: row.ObjectID, Entity: row.Entity, Code: row.Code,
		Enabled: row.Enabled, SourceApprovalEntryID: entry.ID, SourceVersionNo: versionNumber(entry.VersionNo), Data: employeeDetailFromCurrent(row), UpdatedAt: row.UpdatedAt.Time,
		Relationship: &RelationshipIdentityView{PartyID: row.PartyID, PartyKind: row.PartyKind, PartyDisplayName: row.DisplayName, OperatingEntityID: row.OperatingEntityID, OperatingEntityCode: deref(row.OperatingEntityCode), OperatingEntityName: row.OperatingEntityName},
	}, nil
}

func (s *Service) queryEmploymentRelationships(ctx context.Context, q *dbsqlc.Queries, input QueryInput) (Page[QueryItem], error) {
	offset, ok := pageOffset(input.Page, input.PageSize)
	if !ok || len(input.Sort) > 1 {
		return Page[QueryItem]{}, domainError(ErrorValidation, "invalid Employee query", nil, nil)
	}
	filters, err := validateQueryFilters(EntityEmployee, input.Filters)
	if err != nil {
		return Page[QueryItem]{}, err
	}
	sortField, sortOrder := "updatedAt", "desc"
	if len(input.Sort) == 1 {
		sortField, sortOrder = input.Sort[0].Field, strings.ToLower(input.Sort[0].Order)
		validField := sortField == "updatedAt" || sortField == "code" || sortField == "name"
		if !validField || (sortOrder != "asc" && sortOrder != "desc") {
			return Page[QueryItem]{}, domainError(ErrorValidation, "invalid Employee sort", nil, nil)
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
	params := dbsqlc.ListBobEmployeesParams{Keyword: strings.TrimSpace(filters.Keyword), EnabledFilter: enabled, SortField: sortField, SortOrder: sortOrder, RowOffset: offset, RowLimit: int32(input.PageSize)}
	rows, err := q.ListBobEmployees(ctx, params)
	if err != nil {
		return Page[QueryItem]{}, s.internal("list Employee current", err)
	}
	total, err := q.CountBobEmployees(ctx, dbsqlc.CountBobEmployeesParams{Keyword: params.Keyword, EnabledFilter: enabled})
	if err != nil {
		return Page[QueryItem]{}, s.internal("count Employee current", err)
	}
	items := make([]QueryItem, 0, len(rows))
	for _, row := range rows {
		items = append(items, QueryItem{
			ObjectID: row.ObjectID, Entity: row.Entity, Code: row.Code, Enabled: row.Enabled,
			SourceApprovalEntryID: row.ApprovalEntryID, SourceVersionNo: versionNumber(row.VersionNo),
			Data: DetailView{
				Name: row.DisplayName, CategoryID: deref(row.EmployeeCategoryID), CategoryCode: deref(row.EmployeeCategoryCode), CategoryName: deref(row.EmployeeCategoryName),
				DepartmentID: deref(row.DepartmentID), DepartmentCode: deref(row.DepartmentCode), DepartmentName: deref(row.DepartmentName),
				PositionID: deref(row.PositionID), PositionCode: deref(row.PositionCode), PositionName: deref(row.PositionName),
				Phone: deref(row.Phone), Email: deref(row.Email), HireDate: dateString(row.HireDate), Remark: deref(row.Remark),
			},
			UpdatedAt:    row.UpdatedAt.Time,
			Relationship: &RelationshipIdentityView{PartyID: row.PartyID, PartyKind: row.PartyKind, PartyDisplayName: row.DisplayName, OperatingEntityID: row.OperatingEntityID, OperatingEntityCode: deref(row.OperatingEntityCode), OperatingEntityName: row.OperatingEntityName},
		})
	}
	return Page[QueryItem]{Items: items, Total: total, Page: input.Page, PageSize: input.PageSize}, nil
}

func (s *Service) validateEmployeeSnapshotReference(ctx context.Context, q *dbsqlc.Queries, objectID, entryID string) (EffectiveReference, error) {
	entry, err := s.requireHistoricalApprovalEntry(ctx, q, entryID, EntityEmployee, objectID, "Employee approval snapshot is unavailable")
	if err != nil {
		return EffectiveReference{}, err
	}
	row, err := q.GetDCLEmployeeVersion(ctx, entryID)
	if err != nil {
		return EffectiveReference{}, s.internal("load Employee snapshot", err)
	}
	object, err := q.GetDCLSubject(ctx, dbsqlc.GetDCLSubjectParams{ID: objectID, Entity: EntityEmployee})
	if err != nil {
		return EffectiveReference{}, s.internal("load Employee identity", err)
	}
	return EffectiveReference{ObjectID: object.ID, Entity: object.Entity, Code: deref(object.Code), ApprovalEntryID: entry.ID, VersionNo: versionNumber(entry.VersionNo), Data: DetailView{Name: row.DisplayName, CategoryID: deref(row.EmployeeCategoryID), CategoryCode: deref(row.EmployeeCategoryCode), CategoryName: deref(row.EmployeeCategoryName), DepartmentID: deref(row.DepartmentID), PositionID: deref(row.PositionID), Phone: deref(row.Phone), Email: deref(row.Email), HireDate: dateString(row.HireDate), Remark: deref(row.Remark)}}, nil
}

func (s *Service) resolveEmployeeCurrentReference(ctx context.Context, q *dbsqlc.Queries, objectID string) (EffectiveReference, error) {
	row, err := q.GetBobEmployeeCurrentReference(ctx, objectID)
	if errors.Is(err, pgx.ErrNoRows) {
		return EffectiveReference{}, domainError(ErrorConflict, "Employee reference has no enabled current version", nil, nil)
	}
	if err != nil {
		return EffectiveReference{}, s.internal("resolve Employee current", err)
	}
	return EffectiveReference{ObjectID: row.ObjectID, Entity: row.Entity, Code: row.Code, ApprovalEntryID: row.ApprovalEntryID, VersionNo: versionNumber(row.VersionNo), Data: DetailView{Name: row.DisplayName}}, nil
}

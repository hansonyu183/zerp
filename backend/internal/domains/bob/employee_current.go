package bob

import (
	"context"
	"errors"
	"strings"

	dbsqlc "github.com/hansonyu183/zerp/backend/internal/database/sqlc"
	"github.com/jackc/pgx/v5"
)

type EmployeeReferenceSnapshot struct{ ObjectID, Code, Name string }

// EmployeeData contains only the employee-owned AUX snapshots used while DCL
// writes the complete typed Employee declaration.
type EmployeeData struct {
	EmployeeCategory, Department, Position *EmployeeReferenceSnapshot
	Phone, Email, HireDate, Remark         string
}

func ValidateEmployeeData(input EmployeeData) (EmployeeData, error) {
	input.Phone, input.Email, input.HireDate, input.Remark = strings.TrimSpace(input.Phone), strings.TrimSpace(input.Email), strings.TrimSpace(input.HireDate), strings.TrimSpace(input.Remark)
	if err := validateLengthsAndFormats(DetailView{Phone: input.Phone, Email: input.Email, HireDate: input.HireDate, Remark: input.Remark}); err != nil {
		return EmployeeData{}, err
	}
	for _, reference := range []*EmployeeReferenceSnapshot{input.EmployeeCategory, input.Department, input.Position} {
		if reference != nil && !validID(reference.ObjectID) {
			return EmployeeData{}, domainError(ErrorValidation, "invalid Employee auxiliary reference", nil, nil)
		}
	}
	return input, nil
}

func employeeAuxiliarySnapshot(reference AuxiliaryReference) (EmployeeReferenceSnapshot, error) {
	if reference.ObjectID == "" || reference.Code == "" || mapString(reference.Data, "name") == "" {
		return EmployeeReferenceSnapshot{}, domainError(ErrorValidation, "invalid Employee auxiliary snapshot", nil, nil)
	}
	return EmployeeReferenceSnapshot{ObjectID: reference.ObjectID, Code: reference.Code, Name: mapString(reference.Data, "name")}, nil
}

func (s *Service) ResolveEmployeeAuxiliaryReferences(ctx context.Context, tx pgx.Tx, data EmployeeData, exact bool) (EmployeeData, error) {
	return s.resolveEmployeeAuxiliaryReferences(ctx, tx, data, nil, exact)
}

func (s *Service) ResolveEmployeeDraftAuxiliaryReferences(ctx context.Context, tx pgx.Tx, data, previous EmployeeData) (EmployeeData, error) {
	return s.resolveEmployeeAuxiliaryReferences(ctx, tx, data, &previous, false)
}

func (s *Service) resolveEmployeeAuxiliaryReferences(ctx context.Context, tx pgx.Tx, data EmployeeData, previous *EmployeeData, exact bool) (EmployeeData, error) {
	validated, err := ValidateEmployeeData(data)
	if err != nil {
		return EmployeeData{}, err
	}
	if exact {
		return validated, nil
	}
	targets := []struct {
		entity   string
		value    **EmployeeReferenceSnapshot
		previous *EmployeeReferenceSnapshot
	}{
		{entity: "employee-category", value: &validated.EmployeeCategory, previous: snapshotOrNil(previous, func(value *EmployeeData) *EmployeeReferenceSnapshot { return value.EmployeeCategory })},
		{entity: "department", value: &validated.Department, previous: snapshotOrNil(previous, func(value *EmployeeData) *EmployeeReferenceSnapshot { return value.Department })},
		{entity: "position", value: &validated.Position, previous: snapshotOrNil(previous, func(value *EmployeeData) *EmployeeReferenceSnapshot { return value.Position })},
	}
	for _, target := range targets {
		if *target.value == nil {
			continue
		}
		if target.previous != nil && (*target.value).ObjectID == target.previous.ObjectID && !exact {
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
		if exact && (target.previous == nil || snapshot != *target.previous) {
			return EmployeeData{}, domainError(ErrorConflict, "Employee auxiliary snapshot is stale", nil, nil)
		}
		*target.value = &snapshot
	}
	return validated, nil
}

func snapshotOrNil(data *EmployeeData, get func(*EmployeeData) *EmployeeReferenceSnapshot) *EmployeeReferenceSnapshot {
	if data == nil {
		return nil
	}
	return get(data)
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

func employeeDetailFromTyped(row dbsqlc.GetBobEmployeeCurrentTypedRow) DetailView {
	return DetailView{Kind: row.Kind, LegalName: row.LegalName, DisplayName: row.DisplayName, LegalIdentifier: deref(row.LegalIdentifier), Name: row.DisplayName, CurrentOperatingEntityID: row.CurrentOperatingEntityID, CurrentOperatingEntity: BusinessArchiveSnapshot{SourceObjectID: row.CurrentOperatingEntityID, ApprovalEntryID: row.CurrentOperatingEntityApprovalEntryID, Code: row.CurrentOperatingEntityCode, Name: row.CurrentOperatingEntityName}, CategoryID: deref(row.EmployeeCategoryID), CategoryCode: deref(row.EmployeeCategoryCode), CategoryName: deref(row.EmployeeCategoryName), DepartmentID: deref(row.DepartmentID), DepartmentCode: deref(row.DepartmentCode), DepartmentName: deref(row.DepartmentName), PositionID: deref(row.PositionID), PositionCode: deref(row.PositionCode), PositionName: deref(row.PositionName), Phone: deref(row.Phone), Email: deref(row.Email), HireDate: dateString(row.HireDate), Remark: deref(row.Remark)}
}

func (s *Service) getEmployeeCurrent(ctx context.Context, input GetInput) (ObjectView, error) {
	if !validID(input.ObjectID) {
		return ObjectView{}, domainError(ErrorValidation, "invalid Employee get request", nil, nil)
	}
	row, err := s.queries.GetBobEmployeeCurrentTyped(ctx, input.ObjectID)
	if errors.Is(err, pgx.ErrNoRows) {
		return ObjectView{}, domainError(ErrorValidation, "Employee not found", nil, nil)
	}
	if err != nil {
		return ObjectView{}, s.internal("get Employee current", err)
	}
	detail := employeeDetailFromTyped(row)
	code, err := requiredSubjectCode(row.Code)
	if err != nil {
		return ObjectView{}, err
	}
	return ObjectView{ObjectID: row.ObjectID, Entity: EntityEmployee, Code: code, Enabled: row.Enabled, SourceApprovalEntryID: row.ApprovalEntryID, SourceVersionNo: versionNumber(row.VersionNo), Data: detail, UpdatedAt: row.UpdatedAt.Time}, nil
}

func (s *Service) queryEmployeesCurrent(ctx context.Context, q *dbsqlc.Queries, input QueryInput) (Page[QueryItem], error) {
	offset, ok := pageOffset(input.Page, input.PageSize)
	if !ok || len(input.Sort) > 1 {
		return Page[QueryItem]{}, domainError(ErrorValidation, "invalid Employee query", nil, nil)
	}
	filters, err := validateQueryFilters(EntityEmployee, input.Filters)
	if err != nil {
		return Page[QueryItem]{}, err
	}
	if len(input.Sort) == 1 && (input.Sort[0].Field != "code" || strings.ToLower(input.Sort[0].Order) != "asc") {
		return Page[QueryItem]{}, domainError(ErrorValidation, "invalid Employee sort", nil, nil)
	}
	enabled := int32(-1)
	if filters.Enabled != nil {
		if *filters.Enabled {
			enabled = 1
		} else {
			enabled = 0
		}
	}
	rows, err := q.ListBobEmployeeCurrentsTyped(ctx, dbsqlc.ListBobEmployeeCurrentsTypedParams{Keyword: strings.TrimSpace(filters.Keyword), EnabledFilter: enabled, RowOffset: offset, RowLimit: int32(input.PageSize)})
	if err != nil {
		return Page[QueryItem]{}, s.internal("list Employee current", err)
	}
	total, err := q.CountBobEmployeeCurrentsTyped(ctx, dbsqlc.CountBobEmployeeCurrentsTypedParams{Keyword: strings.TrimSpace(filters.Keyword), EnabledFilter: enabled})
	if err != nil {
		return Page[QueryItem]{}, s.internal("count Employee current", err)
	}
	items := make([]QueryItem, 0, len(rows))
	for _, row := range rows {
		code, codeErr := requiredSubjectCode(row.Code)
		if codeErr != nil {
			return Page[QueryItem]{}, codeErr
		}
		items = append(items, QueryItem{ObjectID: row.ObjectID, Entity: EntityEmployee, Code: code, Enabled: row.Enabled, SourceApprovalEntryID: row.ApprovalEntryID, SourceVersionNo: versionNumber(row.VersionNo), Data: DetailView{Kind: row.Kind, LegalName: row.LegalName, DisplayName: row.DisplayName, LegalIdentifier: deref(row.LegalIdentifier), Name: row.DisplayName, CurrentOperatingEntityID: row.CurrentOperatingEntityID, CurrentOperatingEntity: BusinessArchiveSnapshot{SourceObjectID: row.CurrentOperatingEntityID, ApprovalEntryID: row.CurrentOperatingEntityApprovalEntryID, Code: row.CurrentOperatingEntityCode, Name: row.CurrentOperatingEntityName}, CategoryID: deref(row.EmployeeCategoryID), CategoryCode: deref(row.EmployeeCategoryCode), CategoryName: deref(row.EmployeeCategoryName), DepartmentID: deref(row.DepartmentID), DepartmentCode: deref(row.DepartmentCode), DepartmentName: deref(row.DepartmentName), PositionID: deref(row.PositionID), PositionCode: deref(row.PositionCode), PositionName: deref(row.PositionName), Phone: deref(row.Phone), Email: deref(row.Email), HireDate: dateString(row.HireDate), Remark: deref(row.Remark)}, UpdatedAt: row.UpdatedAt.Time})
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
	code, codeErr := requiredSubjectCode(object.Code)
	if codeErr != nil {
		return EffectiveReference{}, codeErr
	}
	return EffectiveReference{ObjectID: object.ID, Entity: object.Entity, Code: code, ApprovalEntryID: entry.ID, VersionNo: versionNumber(entry.VersionNo), Data: DetailView{Name: row.DisplayName, CategoryID: deref(row.EmployeeCategoryID), CategoryCode: deref(row.EmployeeCategoryCode), CategoryName: deref(row.EmployeeCategoryName), DepartmentID: deref(row.DepartmentID), PositionID: deref(row.PositionID), Phone: deref(row.Phone), Email: deref(row.Email), HireDate: dateString(row.HireDate), Remark: deref(row.Remark)}}, nil
}

func (s *Service) resolveEmployeeCurrentReference(ctx context.Context, q *dbsqlc.Queries, objectID string) (EffectiveReference, error) {
	row, err := q.GetBobEmployeeCurrentTypedReference(ctx, objectID)
	if errors.Is(err, pgx.ErrNoRows) {
		return EffectiveReference{}, domainError(ErrorConflict, "Employee reference has no enabled current version", nil, nil)
	}
	if err != nil {
		return EffectiveReference{}, s.internal("resolve Employee current", err)
	}
	code, err := requiredSubjectCode(row.Code)
	if err != nil {
		return EffectiveReference{}, err
	}
	return EffectiveReference{ObjectID: row.ObjectID, Entity: row.Entity, Code: code, ApprovalEntryID: row.ApprovalEntryID, VersionNo: versionNumber(row.VersionNo), Data: DetailView{Name: row.DisplayName}}, nil
}

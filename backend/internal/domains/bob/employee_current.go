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

// EmployeeReferenceSnapshot freezes both the stable AUX identity and the exact
// approved AUX version used by an Employee declaration.
type EmployeeReferenceSnapshot struct {
	ObjectID, ApprovalEntryID, Code, Name string
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
	ObjectRevision                             int64
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
		reference.ApprovalEntryID = strings.TrimSpace(reference.ApprovalEntryID)
		reference.Code = strings.TrimSpace(reference.Code)
		reference.Name = strings.TrimSpace(reference.Name)
		if !validID(reference.ObjectID) || (reference.ApprovalEntryID != "" && !validID(reference.ApprovalEntryID)) {
			return EmployeeData{}, domainError(ErrorValidation, "invalid Employee auxiliary reference", nil, nil)
		}
	}
	return input, nil
}

func employeeAuxiliarySnapshot(reference AuxiliaryReference) (EmployeeReferenceSnapshot, error) {
	name, _ := reference.Data["name"].(string)
	snapshot := EmployeeReferenceSnapshot{
		ObjectID: reference.ObjectID, ApprovalEntryID: reference.ApprovalEntryID,
		Code: strings.TrimSpace(reference.Code), Name: strings.TrimSpace(name),
	}
	if !validID(snapshot.ObjectID) || !validID(snapshot.ApprovalEntryID) || snapshot.Code == "" || snapshot.Name == "" {
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
		var reference AuxiliaryReference
		if exact {
			if input.ApprovalEntryID == "" {
				return EmployeeData{}, domainError(ErrorConflict, "Employee auxiliary approval snapshot is missing", nil, nil)
			}
			reference, err = s.auxiliaryResolver.ValidateApprovedAuxiliarySnapshotReference(ctx, tx, target.entity, input.ObjectID, input.ApprovalEntryID)
		} else {
			reference, err = s.auxiliaryResolver.ResolveLatestApprovedAuxiliaryReference(ctx, tx, target.entity, input.ObjectID)
		}
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

func (s *Service) ReserveEmployeeIdentity(ctx context.Context, tx pgx.Tx, partyID, operatingEntityID, actorID string) (EmployeeIdentity, error) {
	if tx == nil || !validID(partyID) || !validID(operatingEntityID) || !validID(actorID) {
		return EmployeeIdentity{}, domainError(ErrorValidation, "invalid Employee identity request", nil, nil)
	}
	q := s.queries.WithTx(tx)
	counter, err := q.NextObjectNumberCounter(ctx, dbsqlc.NextObjectNumberCounterParams{Domain: "bob", Entity: EntityEmployee})
	if errors.Is(err, pgx.ErrNoRows) {
		return EmployeeIdentity{}, domainError(ErrorConflict, "object number exhausted", nil, nil)
	}
	if err != nil {
		return EmployeeIdentity{}, s.writeError("allocate Employee number", err)
	}
	identity := EmployeeIdentity{
		ObjectID: newID(), Code: fmt.Sprintf("EMP-%04d", counter), ObjectRevision: 1,
		PartyID: partyID, OperatingEntityID: operatingEntityID,
	}
	if err = q.InsertBobObject(ctx, dbsqlc.InsertBobObjectParams{ID: identity.ObjectID, Entity: EntityEmployee, Code: identity.Code, ActorID: actorID}); err != nil {
		return EmployeeIdentity{}, s.writeError("reserve Employee identity", err)
	}
	if err = q.InsertBobEmployeeRelationship(ctx, dbsqlc.InsertBobEmployeeRelationshipParams{
		ObjectID: identity.ObjectID, PartyID: partyID, OperatingEntityID: operatingEntityID, ActorID: actorID,
	}); err != nil {
		return EmployeeIdentity{}, s.writeError("reserve Employee relationship", err)
	}
	return identity, nil
}

func (s *Service) GetEmployeeIdentity(ctx context.Context, tx pgx.Tx, objectID string) (EmployeeIdentity, error) {
	if tx == nil || !validID(objectID) {
		return EmployeeIdentity{}, domainError(ErrorValidation, "invalid Employee identity request", nil, nil)
	}
	q := s.queries.WithTx(tx)
	object, err := q.LockBobObject(ctx, dbsqlc.LockBobObjectParams{ObjectID: objectID, Entity: EntityEmployee})
	if errors.Is(err, pgx.ErrNoRows) {
		return EmployeeIdentity{}, domainError(ErrorValidation, "Employee not found", nil, nil)
	}
	if err != nil {
		return EmployeeIdentity{}, s.internal("lock Employee identity", err)
	}
	relationship, err := q.LockBobEmployeeRelationship(ctx, objectID)
	if err != nil || relationship.MergedIntoObjectID != nil {
		if errors.Is(err, pgx.ErrNoRows) || err == nil {
			return EmployeeIdentity{}, domainError(ErrorValidation, "Employee relationship not found", nil, err)
		}
		return EmployeeIdentity{}, s.internal("lock Employee relationship", err)
	}
	return EmployeeIdentity{ObjectID: object.ID, Code: object.Code, ObjectRevision: object.Revision, PartyID: relationship.PartyID, OperatingEntityID: relationship.OperatingEntityID}, nil
}

func (s *Service) ApplyEmployeeCurrent(ctx context.Context, tx pgx.Tx, objectID, entryID string, enabled bool, actorID string) (EmployeeCurrent, error) {
	if tx == nil || !validID(objectID) || !validID(entryID) || !validID(actorID) {
		return EmployeeCurrent{}, domainError(ErrorValidation, "invalid Employee current apply", nil, nil)
	}
	identity, err := s.GetEmployeeIdentity(ctx, tx, objectID)
	if err != nil {
		return EmployeeCurrent{}, err
	}
	q := s.queries.WithTx(tx)
	if err = q.UpsertBobEmployeeCurrent(ctx, dbsqlc.UpsertBobEmployeeCurrentParams{ObjectID: objectID, SourceApprovalEntryID: entryID, Enabled: enabled, ActorID: actorID}); err != nil {
		return EmployeeCurrent{}, s.writeError("apply Employee current", err)
	}
	object, err := q.TouchBobObject(ctx, dbsqlc.TouchBobObjectParams{ActorID: actorID, ObjectID: objectID, Entity: EntityEmployee})
	if err != nil {
		return EmployeeCurrent{}, s.writeError("touch Employee current", err)
	}
	identity.ObjectRevision = object.Revision
	return EmployeeCurrent{EmployeeIdentity: identity, SourceApprovalEntryID: entryID, Enabled: enabled}, nil
}

func (s *Service) RemoveEmployeeCurrent(ctx context.Context, tx pgx.Tx, objectID, actorID string) (EmployeeIdentity, error) {
	identity, err := s.GetEmployeeIdentity(ctx, tx, objectID)
	if err != nil {
		return EmployeeIdentity{}, err
	}
	q := s.queries.WithTx(tx)
	rows, err := q.DeleteBobEmployeeCurrent(ctx, objectID)
	if err != nil {
		return EmployeeIdentity{}, s.writeError("remove Employee current", err)
	}
	if rows != 1 {
		return EmployeeIdentity{}, domainError(ErrorConflict, "Employee current changed", nil, nil)
	}
	object, err := q.TouchBobObject(ctx, dbsqlc.TouchBobObjectParams{ActorID: actorID, ObjectID: objectID, Entity: EntityEmployee})
	if err != nil {
		return EmployeeIdentity{}, s.writeError("touch Employee current removal", err)
	}
	identity.ObjectRevision = object.Revision
	return identity, nil
}

func (s *Service) DeleteEmployeeIdentity(ctx context.Context, tx pgx.Tx, objectID string, revision int64) error {
	if tx == nil || !validID(objectID) || revision < 1 {
		return domainError(ErrorValidation, "invalid Employee identity deletion", nil, nil)
	}
	if _, err := tx.Exec(ctx, `DELETE FROM bob_employment_relationships WHERE object_id=$1 AND merged_into_object_id IS NULL`, objectID); err != nil {
		return s.writeError("delete Employee relationship", err)
	}
	rows, err := s.queries.WithTx(tx).DeleteBobObject(ctx, dbsqlc.DeleteBobObjectParams{ObjectID: objectID, Entity: EntityEmployee, ObjectRevision: revision})
	if err != nil {
		return s.writeError("delete Employee identity", err)
	}
	if rows != 1 {
		return domainError(ErrorConflict, "Employee identity changed", nil, nil)
	}
	return nil
}

func (s *Service) EnsureEmployeeUnapproveAllowed(ctx context.Context, tx pgx.Tx, entryID string) error {
	if tx == nil || !validID(entryID) {
		return domainError(ErrorValidation, "invalid Employee unapprove request", nil, nil)
	}
	return s.ensureUnapproveAllowed(ctx, s.queries.WithTx(tx), entryID)
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
		Name: row.DisplayName, CategoryID: deref(row.EmployeeCategoryID), CategoryApprovalEntryID: deref(row.EmployeeCategoryApprovalEntryID),
		CategoryCode: deref(row.EmployeeCategoryCode), CategoryName: deref(row.EmployeeCategoryName),
		DepartmentID: deref(row.DepartmentID), DepartmentApprovalEntryID: deref(row.DepartmentApprovalEntryID),
		PositionID: deref(row.PositionID), PositionApprovalEntryID: deref(row.PositionApprovalEntryID),
		Phone: deref(row.Phone), Email: deref(row.Email), HireDate: dateString(row.HireDate), Remark: deref(row.Remark),
	}
}

func (s *Service) getEmployeeCurrent(ctx context.Context, input GetInput) (ObjectView, error) {
	if !validID(input.ObjectID) || input.ApprovalEntryID != "" {
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
		ObjectID: row.ObjectID, Entity: row.Entity, Code: row.Code, ObjectRevision: row.ObjectRevision,
		Enabled: row.Enabled, Approval: approvalMeta(entry), Data: employeeDetailFromCurrent(row), UpdatedAt: row.UpdatedAt.Time,
		Relationship: &RelationshipIdentityView{PartyID: row.PartyID, PartyKind: row.PartyKind, PartyDisplayName: row.DisplayName, OperatingEntityID: row.OperatingEntityID, OperatingEntityCode: row.OperatingEntityCode, OperatingEntityName: row.OperatingEntityName},
	}, nil
}

func (s *Service) queryEmploymentRelationships(ctx context.Context, input QueryInput) (Page[QueryItem], error) {
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
		if !strings.Contains("updatedAt code name", sortField) || (sortOrder != "asc" && sortOrder != "desc") {
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
	rows, err := s.queries.ListBobEmployees(ctx, params)
	if err != nil {
		return Page[QueryItem]{}, s.internal("list Employee current", err)
	}
	total, err := s.queries.CountBobEmployees(ctx, dbsqlc.CountBobEmployeesParams{Keyword: params.Keyword, EnabledFilter: enabled})
	if err != nil {
		return Page[QueryItem]{}, s.internal("count Employee current", err)
	}
	items := make([]QueryItem, 0, len(rows))
	for _, row := range rows {
		view, getErr := s.getEmployeeCurrent(ctx, GetInput{ObjectID: row.ObjectID})
		if getErr != nil {
			return Page[QueryItem]{}, getErr
		}
		items = append(items, QueryItem{ObjectID: row.ObjectID, Entity: row.Entity, Code: row.Code, ObjectRevision: row.ObjectRevision, Enabled: row.Enabled, UpdatedAt: row.UpdatedAt.Time, LatestApproved: &VersionSummary{Approval: view.Approval, Summary: view.Data}})
	}
	return Page[QueryItem]{Items: items, Total: total, Page: input.Page, PageSize: input.PageSize}, nil
}

func (s *Service) validateEmployeeSnapshotReference(ctx context.Context, q *dbsqlc.Queries, objectID, entryID string) (EffectiveReference, error) {
	entry, err := q.GetApprovalEntry(ctx, dbsqlc.GetApprovalEntryParams{ID: entryID, Domain: "dcl", Entity: EntityEmployee})
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && (entry.SubjectID != objectID || entry.Status != string(approval.StatusApproved))) {
		return EffectiveReference{}, domainError(ErrorConflict, "Employee approval snapshot is unavailable", nil, nil)
	}
	if err != nil {
		return EffectiveReference{}, s.internal("validate Employee snapshot", err)
	}
	row, err := q.GetDCLEmployeeVersion(ctx, entryID)
	if err != nil {
		return EffectiveReference{}, s.internal("load Employee snapshot", err)
	}
	object, err := q.GetBobObject(ctx, dbsqlc.GetBobObjectParams{ObjectID: objectID, Entity: EntityEmployee})
	if err != nil {
		return EffectiveReference{}, s.internal("load Employee identity", err)
	}
	return EffectiveReference{ObjectID: object.ID, Entity: object.Entity, Code: object.Code, ApprovalEntryID: entry.ID, Data: DetailView{Name: row.DisplayName, CategoryID: deref(row.EmployeeCategoryID), CategoryApprovalEntryID: deref(row.EmployeeCategoryApprovalEntryID), CategoryCode: deref(row.EmployeeCategoryCode), CategoryName: deref(row.EmployeeCategoryName), DepartmentID: deref(row.DepartmentID), DepartmentApprovalEntryID: deref(row.DepartmentApprovalEntryID), PositionID: deref(row.PositionID), PositionApprovalEntryID: deref(row.PositionApprovalEntryID), Phone: deref(row.Phone), Email: deref(row.Email), HireDate: dateString(row.HireDate), Remark: deref(row.Remark)}}, nil
}

func (s *Service) resolveEmployeeCurrentReference(ctx context.Context, q *dbsqlc.Queries, objectID string) (EffectiveReference, error) {
	row, err := q.GetBobEmployeeCurrentReference(ctx, objectID)
	if errors.Is(err, pgx.ErrNoRows) {
		return EffectiveReference{}, domainError(ErrorConflict, "Employee reference has no enabled current version", nil, nil)
	}
	if err != nil {
		return EffectiveReference{}, s.internal("resolve Employee current", err)
	}
	return EffectiveReference{ObjectID: row.ObjectID, Entity: row.Entity, Code: row.Code, ApprovalEntryID: row.ApprovalEntryID, Data: DetailView{Name: row.DisplayName}}, nil
}

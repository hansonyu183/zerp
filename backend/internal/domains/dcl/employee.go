package dcl

import (
	"context"
	"errors"
	"strings"
	"time"

	dbsqlc "github.com/hansonyu183/zerp/backend/internal/database/sqlc"
	bobdomain "github.com/hansonyu183/zerp/backend/internal/domains/bob"
	"github.com/hansonyu183/zerp/backend/internal/events/dclapproval"
	"github.com/hansonyu183/zerp/backend/internal/platform/approval"
	"github.com/hansonyu183/zerp/backend/internal/platform/txevent"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

type employeeBusinessRules interface {
	ResolveEmployeeAuxiliaryReferences(context.Context, pgx.Tx, bobdomain.EmployeeData, bool) (bobdomain.EmployeeData, error)
	ResolveEmployeeDraftAuxiliaryReferences(context.Context, pgx.Tx, bobdomain.EmployeeData, bobdomain.EmployeeData) (bobdomain.EmployeeData, error)
	ResolveCurrentReference(context.Context, pgx.Tx, string, string) (bobdomain.EffectiveReference, error)
	EnsureEmployeeDisableAllowed(context.Context, pgx.Tx, string) error
	EnsureEmployeeUnapproveAllowed(context.Context, pgx.Tx, string) error
}

type EmployeeService struct {
	pool        *pgxpool.Pool
	queries     *dbsqlc.Queries
	rules       employeeBusinessRules
	coordinator *approval.Coordinator[dclapproval.EmployeePayload]
}

func NewEmployeeService(pool *pgxpool.Pool, rules employeeBusinessRules, authorizer approval.Authorizer, bus *txevent.Bus) *EmployeeService {
	if pool == nil || rules == nil || authorizer == nil || bus == nil {
		panic("dcl: Employee persistence, business rules, authorizer and event bus are required")
	}
	c, err := approval.NewCoordinator("dcl", EntityEmployee, authorizer, bus, dclapproval.EmployeeTopic)
	if err != nil {
		panic(err)
	}
	return &EmployeeService{pool: pool, queries: dbsqlc.New(pool), rules: rules, coordinator: c}
}

func employeePayload(id subjectIdentity, enabled bool) dclapproval.EmployeePayload {
	return dclapproval.EmployeePayload{SubjectID: id.ObjectID, Code: id.Code, Enabled: enabled}
}

func employeeMutation(id subjectIdentity, enabled bool, entry approval.Entry) EmployeeMutation {
	return EmployeeMutation{ObjectID: id.ObjectID, Enabled: enabled, Approval: approval.VersionMetaFromEntry(entry)}
}

func employeeVersionInput(input EmployeeReviewInput) EmployeeVersionInput {
	return EmployeeVersionInput{ObjectID: input.ObjectID, ApprovalEntryID: input.ApprovalEntryID, ApprovalRevision: input.ApprovalRevision}
}

func validateEmployeeInput(input EmployeeInput) (EmployeeInput, error) {
	input.Kind, input.LegalName, input.DisplayName = strings.TrimSpace(input.Kind), strings.TrimSpace(input.LegalName), strings.TrimSpace(input.DisplayName)
	if input.LegalIdentifier != "" {
		var err error
		input.LegalIdentifier, err = archiveLegalIdentifier(input.Kind, input.LegalIdentifier)
		if err != nil {
			return EmployeeInput{}, err
		}
	}
	if input.DisplayName == "" {
		input.DisplayName = input.LegalName
	}
	input.CurrentOperatingEntityID = strings.TrimSpace(input.CurrentOperatingEntityID)
	input.EmployeeCategoryID, input.DepartmentID, input.PositionID = strings.TrimSpace(input.EmployeeCategoryID), strings.TrimSpace(input.DepartmentID), strings.TrimSpace(input.PositionID)
	input.Phone, input.Email, input.HireDate, input.Remark = strings.TrimSpace(input.Phone), strings.TrimSpace(input.Email), strings.TrimSpace(input.HireDate), strings.TrimSpace(input.Remark)
	if (input.Kind != "PERSON" && input.Kind != "ORGANIZATION") || input.LegalName == "" || !runeLenAtMost(input.LegalName, 200) || !runeLenAtMost(input.DisplayName, 200) || !runeLenAtMost(input.LegalIdentifier, 100) || !runeLenAtMost(input.Phone, 32) || !runeLenAtMost(input.Email, 254) || !runeLenAtMost(input.HireDate, 10) || !runeLenAtMost(input.Remark, 1000) || !validID(input.CurrentOperatingEntityID) || (input.EmployeeCategoryID != "" && !validID(input.EmployeeCategoryID)) || (input.DepartmentID != "" && !validID(input.DepartmentID)) || (input.PositionID != "" && !validID(input.PositionID)) {
		return EmployeeInput{}, newError(ErrorValidation, "validation_failed", "invalid employee data", nil, nil)
	}
	if _, err := bobdomain.ValidateEmployeeData(employeeAuxiliaryData(input)); err != nil {
		return EmployeeInput{}, translateError(err)
	}
	return input, nil
}

func normalizeEmployeeIdentifier(value string) string {
	return strings.ToUpper(strings.TrimSpace(value))
}

func employeeAuxiliaryData(input EmployeeInput) bobdomain.EmployeeData {
	data := bobdomain.EmployeeData{Phone: input.Phone, Email: input.Email, HireDate: input.HireDate, Remark: input.Remark}
	if input.EmployeeCategoryID != "" {
		data.EmployeeCategory = &bobdomain.EmployeeReferenceSnapshot{ObjectID: input.EmployeeCategoryID}
	}
	if input.DepartmentID != "" {
		data.Department = &bobdomain.EmployeeReferenceSnapshot{ObjectID: input.DepartmentID}
	}
	if input.PositionID != "" {
		data.Position = &bobdomain.EmployeeReferenceSnapshot{ObjectID: input.PositionID}
	}
	return data
}

func employeeData(input EmployeeInput, operating bobdomain.EffectiveReference, auxiliary bobdomain.EmployeeData) EmployeeData {
	result := EmployeeData{Kind: input.Kind, LegalName: input.LegalName, DisplayName: input.DisplayName, LegalIdentifier: input.LegalIdentifier, Enabled: input.Enabled, CurrentOperatingEntityID: operating.ObjectID, CurrentOperatingEntity: EmployeeOperatingEntitySnapshot{SourceObjectID: operating.ObjectID, ApprovalEntryID: operating.ApprovalEntryID, Code: operating.Code, Name: operating.Data.Name}, Phone: auxiliary.Phone, Email: auxiliary.Email, HireDate: auxiliary.HireDate, Remark: auxiliary.Remark}
	if result.DisplayName == "" {
		result.DisplayName = result.LegalName
	}
	if auxiliary.EmployeeCategory != nil {
		result.EmployeeCategoryID, result.EmployeeCategoryCode, result.EmployeeCategoryName = auxiliary.EmployeeCategory.ObjectID, auxiliary.EmployeeCategory.Code, auxiliary.EmployeeCategory.Name
	}
	if auxiliary.Department != nil {
		result.DepartmentID, result.DepartmentCode, result.DepartmentName = auxiliary.Department.ObjectID, auxiliary.Department.Code, auxiliary.Department.Name
	}
	if auxiliary.Position != nil {
		result.PositionID, result.PositionCode, result.PositionName = auxiliary.Position.ObjectID, auxiliary.Position.Code, auxiliary.Position.Name
	}
	return result
}

func employeeAuxiliaryFromData(data EmployeeData) bobdomain.EmployeeData {
	result := bobdomain.EmployeeData{Phone: data.Phone, Email: data.Email, HireDate: data.HireDate, Remark: data.Remark}
	if data.EmployeeCategoryID != "" {
		result.EmployeeCategory = &bobdomain.EmployeeReferenceSnapshot{ObjectID: data.EmployeeCategoryID, Code: data.EmployeeCategoryCode, Name: data.EmployeeCategoryName}
	}
	if data.DepartmentID != "" {
		result.Department = &bobdomain.EmployeeReferenceSnapshot{ObjectID: data.DepartmentID, Code: data.DepartmentCode, Name: data.DepartmentName}
	}
	if data.PositionID != "" {
		result.Position = &bobdomain.EmployeeReferenceSnapshot{ObjectID: data.PositionID, Code: data.PositionCode, Name: data.PositionName}
	}
	return result
}

func (s *EmployeeService) resolveData(ctx context.Context, tx pgx.Tx, input EmployeeInput, previous *EmployeeData) (EmployeeData, error) {
	input, err := validateEmployeeInput(input)
	if err != nil {
		return EmployeeData{}, err
	}
	operating, err := s.rules.ResolveCurrentReference(ctx, tx, bobdomain.EntityOperatingEntity, input.CurrentOperatingEntityID)
	if err != nil {
		return EmployeeData{}, translateError(err)
	}
	auxiliary := employeeAuxiliaryData(input)
	if previous == nil {
		auxiliary, err = s.rules.ResolveEmployeeAuxiliaryReferences(ctx, tx, auxiliary, false)
	} else {
		auxiliary, err = s.rules.ResolveEmployeeDraftAuxiliaryReferences(ctx, tx, auxiliary, employeeAuxiliaryFromData(*previous))
	}
	if err != nil {
		return EmployeeData{}, translateError(err)
	}
	return employeeData(input, operating, auxiliary), nil
}

func (s *EmployeeService) Create(ctx context.Context, input EmployeeCreateInput, actor approval.Actor) (EmployeeMutation, error) {
	if !validActor(actor) {
		return EmployeeMutation{}, newError(ErrorValidation, "validation_failed", "invalid employee declaration create request", nil, nil)
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return EmployeeMutation{}, translateError(err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	data, err := s.resolveData(ctx, tx, input.Data, nil)
	if err != nil {
		return EmployeeMutation{}, err
	}
	id, err := reserveSubject(ctx, tx, EntityEmployee, "EMP", actor.ID())
	if err != nil {
		return EmployeeMutation{}, translateError(err)
	}
	entry, err := s.coordinator.CreateFirstVersion(ctx, tx, id.ObjectID, actor, employeePayload(id, data.Enabled))
	if err != nil {
		return EmployeeMutation{}, translateError(err)
	}
	if err = s.writeSnapshot(ctx, s.queries.WithTx(tx), id.ObjectID, entry.ID, data); err != nil {
		return EmployeeMutation{}, translateError(err)
	}
	if err = tx.Commit(ctx); err != nil {
		return EmployeeMutation{}, translateError(err)
	}
	return employeeMutation(id, data.Enabled, entry), nil
}

func (s *EmployeeService) Save(ctx context.Context, input EmployeeSaveInput, actor approval.Actor) (EmployeeMutation, error) {
	if !validVersionInput(input.ObjectID, input.ApprovalEntryID, input.ApprovalRevision, actor) {
		return EmployeeMutation{}, newError(ErrorValidation, "validation_failed", "invalid employee declaration save request", nil, nil)
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return EmployeeMutation{}, translateError(err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	if err = s.coordinator.LockVersionSubject(ctx, tx, input.ObjectID); err != nil {
		return EmployeeMutation{}, translateError(err)
	}
	q := s.queries.WithTx(tx)
	id, err := lockSubject(ctx, tx, EntityEmployee, input.ObjectID)
	if err != nil {
		return EmployeeMutation{}, translateError(err)
	}
	stored, err := q.GetApprovalEntry(ctx, dbsqlc.GetApprovalEntryParams{ID: input.ApprovalEntryID, Domain: "dcl", Entity: EntityEmployee})
	if err != nil || stored.SubjectID != input.ObjectID || stored.Revision != input.ApprovalRevision {
		if err == nil || errors.Is(err, pgx.ErrNoRows) {
			err = newError(ErrorConflict, "approval_stale_revision", "approval entry changed", nil, err)
		}
		return EmployeeMutation{}, translateError(err)
	}
	var entry approval.Entry
	var previous *EmployeeData
	switch approval.Status(stored.Status) {
	case approval.StatusApproved:
		entry, err = s.coordinator.CreateNextVersion(ctx, tx, input.ObjectID, actor, employeePayload(id, input.Data.Enabled))
		if err == nil {
			var count int64
			count, err = q.CopyDCLEmployeeVersion(ctx, dbsqlc.CopyDCLEmployeeVersionParams{NewApprovalEntryID: entry.ID, SourceApprovalEntryID: stored.ID})
			if err == nil && count != 1 {
				err = errors.New("approved employee snapshot is missing")
			}
		}
	case approval.StatusDraft:
		entry = approvalEntry(stored)
		loaded, loadErr := s.loadData(ctx, q, entry.ID)
		if loadErr != nil {
			err = loadErr
		} else {
			previous = &loaded
		}
	default:
		err = newError(ErrorConflict, "approval_invalid_transition", "only a draft or latest approved declaration can be saved", nil, nil)
	}
	if err != nil {
		return EmployeeMutation{}, translateError(err)
	}
	data, err := s.resolveData(ctx, tx, input.Data, previous)
	if err != nil {
		return EmployeeMutation{}, err
	}
	if err = s.updateSnapshot(ctx, q, entry.ID, data); err != nil {
		return EmployeeMutation{}, translateError(err)
	}
	if err = s.claimLegalIdentifier(ctx, q, id.ObjectID, entry.ID, data.LegalIdentifier); err != nil {
		return EmployeeMutation{}, translateError(err)
	}
	entry, err = s.coordinator.SaveDraft(ctx, tx, entry.ID, entry.Revision, actor, employeePayload(id, data.Enabled))
	if err != nil {
		return EmployeeMutation{}, translateError(err)
	}
	if err = tx.Commit(ctx); err != nil {
		return EmployeeMutation{}, translateError(err)
	}
	return employeeMutation(id, data.Enabled, entry), nil
}

func (s *EmployeeService) Submit(ctx context.Context, input EmployeeVersionInput, actor approval.Actor) (EmployeeMutation, error) {
	return s.transition(ctx, input, "", approval.ActionSubmitted, actor)
}
func (s *EmployeeService) Unsubmit(ctx context.Context, input EmployeeReviewInput, actor approval.Actor) (EmployeeMutation, error) {
	return s.transition(ctx, employeeVersionInput(input), "", approval.ActionUnsubmitted, actor)
}
func (s *EmployeeService) Reject(ctx context.Context, input EmployeeReviewInput, actor approval.Actor) (EmployeeMutation, error) {
	return s.transition(ctx, employeeVersionInput(input), strings.TrimSpace(input.Reason), approval.ActionRejected, actor)
}
func (s *EmployeeService) Approve(ctx context.Context, input EmployeeVersionInput, actor approval.Actor) (EmployeeMutation, error) {
	return s.transition(ctx, input, "", approval.ActionApproved, actor)
}
func (s *EmployeeService) Unapprove(ctx context.Context, input EmployeeReviewInput, actor approval.Actor) (EmployeeMutation, error) {
	return s.transition(ctx, employeeVersionInput(input), strings.TrimSpace(input.Reason), approval.ActionUnapproved, actor)
}

func (s *EmployeeService) transition(ctx context.Context, input EmployeeVersionInput, reason string, action approval.Action, actor approval.Actor) (EmployeeMutation, error) {
	if !validVersionInput(input.ObjectID, input.ApprovalEntryID, input.ApprovalRevision, actor) {
		return EmployeeMutation{}, newError(ErrorValidation, "validation_failed", "invalid employee declaration lifecycle request", nil, nil)
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return EmployeeMutation{}, translateError(err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	id, err := lockSubject(ctx, tx, EntityEmployee, input.ObjectID)
	if err != nil {
		return EmployeeMutation{}, translateError(err)
	}
	pending, err := s.coordinator.Prepare(ctx, tx, action, input.ApprovalEntryID, input.ApprovalRevision, actor, reason)
	if err != nil || pending.Entry().SubjectID != input.ObjectID {
		if err == nil {
			err = newError(ErrorValidation, "validation_failed", "approval entry does not belong to employee", nil, nil)
		}
		return EmployeeMutation{}, translateError(err)
	}
	q := s.queries.WithTx(tx)
	data, err := s.loadData(ctx, q, input.ApprovalEntryID)
	if err != nil {
		return EmployeeMutation{}, err
	}
	if action == approval.ActionSubmitted || action == approval.ActionApproved {
		if data.LegalIdentifier == "" {
			return EmployeeMutation{}, newError(ErrorValidation, "legal_identifier_required", "employee legal identifier is required", nil, nil)
		}
		if _, err = archiveLegalIdentifier(data.Kind, data.LegalIdentifier); err != nil {
			return EmployeeMutation{}, err
		}
		if action == approval.ActionSubmitted {
			if err = s.claimLegalIdentifier(ctx, q, input.ObjectID, input.ApprovalEntryID, data.LegalIdentifier); err != nil {
				return EmployeeMutation{}, translateError(err)
			}
		}
		operating, resolveErr := s.rules.ResolveCurrentReference(ctx, tx, bobdomain.EntityOperatingEntity, data.CurrentOperatingEntityID)
		if resolveErr != nil {
			return EmployeeMutation{}, translateError(resolveErr)
		}
		if operating.ApprovalEntryID != data.CurrentOperatingEntity.ApprovalEntryID {
			return EmployeeMutation{}, newError(ErrorConflict, "employee_current_operating_entity_stale", "employee current operating entity snapshot is stale", nil, nil)
		}
		if _, err = s.rules.ResolveEmployeeAuxiliaryReferences(ctx, tx, employeeAuxiliaryFromData(data), true); err != nil {
			return EmployeeMutation{}, translateError(err)
		}
	}
	if action == approval.ActionApproved && !data.Enabled {
		if err = s.rules.EnsureEmployeeDisableAllowed(ctx, tx, input.ObjectID); err != nil {
			return EmployeeMutation{}, translateError(err)
		}
	}
	if action == approval.ActionUnapproved {
		if err = s.rules.EnsureEmployeeUnapproveAllowed(ctx, tx, input.ApprovalEntryID); err != nil {
			return EmployeeMutation{}, translateError(err)
		}
		if err = s.ensureUnapproveFallbackAllowed(ctx, tx, input.ObjectID, input.ApprovalEntryID); err != nil {
			return EmployeeMutation{}, err
		}
		fallback, fallbackErr := q.GetLatestApprovedDCLEmployeeVersionExcluding(ctx, dbsqlc.GetLatestApprovedDCLEmployeeVersionExcludingParams{ObjectID: input.ObjectID, ExcludedApprovalEntryID: input.ApprovalEntryID})
		if fallbackErr == nil {
			fallbackData, loadErr := s.loadData(ctx, q, fallback.ID)
			if loadErr != nil {
				return EmployeeMutation{}, loadErr
			}
			if err = s.promoteLegalIdentifier(ctx, q, input.ObjectID, fallback.ID, fallbackData.LegalIdentifier); err != nil {
				return EmployeeMutation{}, translateError(err)
			}
		} else if !errors.Is(fallbackErr, pgx.ErrNoRows) {
			return EmployeeMutation{}, translateError(fallbackErr)
		}
	}
	if action == approval.ActionApproved {
		if latest, latestErr := q.GetLatestApprovedVersion(ctx, dbsqlc.GetLatestApprovedVersionParams{Domain: "dcl", Entity: EntityEmployee, SubjectID: input.ObjectID}); latestErr == nil && latest.ID != input.ApprovalEntryID {
			if err = q.DeleteDCLEmployeeLegalIdentifierClaimsForEntry(ctx, &latest.ID); err != nil {
				return EmployeeMutation{}, translateError(err)
			}
		} else if latestErr != nil && !errors.Is(latestErr, pgx.ErrNoRows) {
			return EmployeeMutation{}, translateError(latestErr)
		}
		if err = s.promoteLegalIdentifier(ctx, q, input.ObjectID, input.ApprovalEntryID, data.LegalIdentifier); err != nil {
			return EmployeeMutation{}, translateError(err)
		}
	}
	if action == approval.ActionUnapproved {
		if err = s.claimLegalIdentifier(ctx, q, input.ObjectID, input.ApprovalEntryID, data.LegalIdentifier); err != nil {
			return EmployeeMutation{}, translateError(err)
		}
	}
	entry, err := s.coordinator.Commit(ctx, tx, pending, employeePayload(id, data.Enabled))
	if err != nil {
		return EmployeeMutation{}, translateError(err)
	}
	if err = tx.Commit(ctx); err != nil {
		return EmployeeMutation{}, translateError(err)
	}
	return employeeMutation(id, data.Enabled, entry), nil
}

func (s *EmployeeService) ensureUnapproveFallbackAllowed(ctx context.Context, tx pgx.Tx, objectID, excludedEntryID string) error {
	fallback, err := s.queries.WithTx(tx).GetLatestApprovedDCLEmployeeVersionExcluding(ctx, dbsqlc.GetLatestApprovedDCLEmployeeVersionExcludingParams{ObjectID: objectID, ExcludedApprovalEntryID: excludedEntryID})
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return translateError(err)
	}
	if err == nil {
		data, loadErr := s.loadData(ctx, s.queries.WithTx(tx), fallback.ID)
		if loadErr != nil {
			return loadErr
		}
		if data.Enabled {
			return nil
		}
	}
	return translateError(s.rules.EnsureEmployeeDisableAllowed(ctx, tx, objectID))
}

func (s *EmployeeService) Delete(ctx context.Context, input EmployeeDeleteInput, actor approval.Actor) error {
	if !validVersionInput(input.ObjectID, input.ApprovalEntryID, input.ApprovalRevision, actor) {
		return newError(ErrorValidation, "validation_failed", "invalid employee declaration delete request", nil, nil)
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return translateError(err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	if err = s.coordinator.LockVersionSubject(ctx, tx, input.ObjectID); err != nil {
		return translateError(err)
	}
	id, err := lockSubject(ctx, tx, EntityEmployee, input.ObjectID)
	if err != nil {
		return translateError(err)
	}
	q := s.queries.WithTx(tx)
	stored, err := q.GetApprovalEntry(ctx, dbsqlc.GetApprovalEntryParams{ID: input.ApprovalEntryID, Domain: "dcl", Entity: EntityEmployee})
	if err != nil || stored.SubjectID != input.ObjectID {
		return translateError(newError(ErrorValidation, "validation_failed", "declaration not found", nil, err))
	}
	data, err := s.loadData(ctx, q, stored.ID)
	if err != nil {
		return err
	}
	if err = q.DeleteDCLEmployeeLegalIdentifierClaimsForEntry(ctx, &stored.ID); err != nil {
		return translateError(err)
	}
	if count, deleteErr := q.DeleteDCLEmployeeVersion(ctx, stored.ID); deleteErr != nil || count != 1 {
		if deleteErr == nil {
			deleteErr = errors.New("employee declaration snapshot changed")
		}
		return translateError(deleteErr)
	}
	if err = s.coordinator.DeleteDraftVersion(ctx, tx, stored.ID, input.ApprovalRevision, actor, employeePayload(id, data.Enabled)); err != nil {
		return translateError(err)
	}
	if _, latestErr := q.GetLatestApprovedVersion(ctx, dbsqlc.GetLatestApprovedVersionParams{Domain: "dcl", Entity: EntityEmployee, SubjectID: input.ObjectID}); errors.Is(latestErr, pgx.ErrNoRows) {
		if count, deleteErr := q.DeleteDCLSubject(ctx, dbsqlc.DeleteDCLSubjectParams{ID: input.ObjectID, Entity: EntityEmployee}); deleteErr != nil || count != 1 {
			if deleteErr == nil {
				deleteErr = errors.New("DCL employee subject changed")
			}
			return translateError(deleteErr)
		}
	} else if latestErr != nil {
		return translateError(latestErr)
	}
	return translateError(tx.Commit(ctx))
}

func (s *EmployeeService) writeSnapshot(ctx context.Context, q *dbsqlc.Queries, objectID, entryID string, data EmployeeData) error {
	if err := q.InsertDCLEmployeeVersion(ctx, employeeInsertParams(entryID, data)); err != nil {
		return err
	}
	return s.claimLegalIdentifier(ctx, q, objectID, entryID, data.LegalIdentifier)
}

func (s *EmployeeService) updateSnapshot(ctx context.Context, q *dbsqlc.Queries, entryID string, data EmployeeData) error {
	count, err := q.UpdateDCLEmployeeVersion(ctx, employeeUpdateParams(entryID, data))
	if err == nil && count != 1 {
		err = errors.New("employee declaration snapshot is missing")
	}
	return err
}

func employeeInsertParams(entryID string, data EmployeeData) dbsqlc.InsertDCLEmployeeVersionParams {
	return dbsqlc.InsertDCLEmployeeVersionParams{ApprovalEntryID: entryID, Kind: data.Kind, LegalName: data.LegalName, DisplayName: data.DisplayName, LegalIdentifier: nilIfEmpty(data.LegalIdentifier), EmployeeCategoryID: nilIfEmpty(data.EmployeeCategoryID), EmployeeCategoryCode: nilIfEmpty(data.EmployeeCategoryCode), EmployeeCategoryName: nilIfEmpty(data.EmployeeCategoryName), DepartmentID: nilIfEmpty(data.DepartmentID), DepartmentCode: nilIfEmpty(data.DepartmentCode), DepartmentName: nilIfEmpty(data.DepartmentName), PositionID: nilIfEmpty(data.PositionID), PositionCode: nilIfEmpty(data.PositionCode), PositionName: nilIfEmpty(data.PositionName), Phone: nilIfEmpty(data.Phone), Email: nilIfEmpty(data.Email), HireDate: employeeDateValue(data.HireDate), CurrentOperatingEntityID: data.CurrentOperatingEntity.SourceObjectID, CurrentOperatingEntityApprovalEntryID: data.CurrentOperatingEntity.ApprovalEntryID, CurrentOperatingEntityCode: data.CurrentOperatingEntity.Code, CurrentOperatingEntityName: data.CurrentOperatingEntity.Name, Remark: nilIfEmpty(data.Remark), Enabled: data.Enabled}
}

func employeeUpdateParams(entryID string, data EmployeeData) dbsqlc.UpdateDCLEmployeeVersionParams {
	return dbsqlc.UpdateDCLEmployeeVersionParams{Kind: data.Kind, LegalName: data.LegalName, DisplayName: data.DisplayName, LegalIdentifier: nilIfEmpty(data.LegalIdentifier), EmployeeCategoryID: nilIfEmpty(data.EmployeeCategoryID), EmployeeCategoryCode: nilIfEmpty(data.EmployeeCategoryCode), EmployeeCategoryName: nilIfEmpty(data.EmployeeCategoryName), DepartmentID: nilIfEmpty(data.DepartmentID), DepartmentCode: nilIfEmpty(data.DepartmentCode), DepartmentName: nilIfEmpty(data.DepartmentName), PositionID: nilIfEmpty(data.PositionID), PositionCode: nilIfEmpty(data.PositionCode), PositionName: nilIfEmpty(data.PositionName), Phone: nilIfEmpty(data.Phone), Email: nilIfEmpty(data.Email), HireDate: employeeDateValue(data.HireDate), CurrentOperatingEntityID: data.CurrentOperatingEntity.SourceObjectID, CurrentOperatingEntityApprovalEntryID: data.CurrentOperatingEntity.ApprovalEntryID, CurrentOperatingEntityCode: data.CurrentOperatingEntity.Code, CurrentOperatingEntityName: data.CurrentOperatingEntity.Name, Remark: nilIfEmpty(data.Remark), Enabled: data.Enabled, ApprovalEntryID: entryID}
}

func (s *EmployeeService) claimLegalIdentifier(ctx context.Context, q *dbsqlc.Queries, objectID, entryID, legalIdentifier string) error {
	return maintainLegalIdentifierClaim(ctx, employeeLegalIdentifierClaimStore{q: q}, objectID, entryID, normalizeEmployeeIdentifier(legalIdentifier), false, legalIdentifierClaimConflict{
		errorKey: "employee_legal_identifier_claimed",
		message:  "employee legal identifier is already occupied",
	})
}

func (s *EmployeeService) promoteLegalIdentifier(ctx context.Context, q *dbsqlc.Queries, objectID, entryID, legalIdentifier string) error {
	return maintainLegalIdentifierClaim(ctx, employeeLegalIdentifierClaimStore{q: q}, objectID, entryID, normalizeEmployeeIdentifier(legalIdentifier), true, legalIdentifierClaimConflict{
		errorKey: "employee_legal_identifier_claimed",
		message:  "employee legal identifier is already occupied",
	})
}

func (s *EmployeeService) loadData(ctx context.Context, q *dbsqlc.Queries, entryID string) (EmployeeData, error) {
	row, err := q.GetDCLEmployeeVersion(ctx, entryID)
	if err != nil {
		return EmployeeData{}, translateError(err)
	}
	data := EmployeeData{Kind: row.Kind, LegalName: row.LegalName, DisplayName: row.DisplayName, LegalIdentifier: stringValue(row.LegalIdentifier), Enabled: row.Enabled, CurrentOperatingEntityID: row.CurrentOperatingEntityID, CurrentOperatingEntity: EmployeeOperatingEntitySnapshot{SourceObjectID: row.CurrentOperatingEntityID, ApprovalEntryID: row.CurrentOperatingEntityApprovalEntryID, Code: row.CurrentOperatingEntityCode, Name: row.CurrentOperatingEntityName}, EmployeeCategoryID: stringValue(row.EmployeeCategoryID), EmployeeCategoryCode: stringValue(row.EmployeeCategoryCode), EmployeeCategoryName: stringValue(row.EmployeeCategoryName), DepartmentID: stringValue(row.DepartmentID), DepartmentCode: stringValue(row.DepartmentCode), DepartmentName: stringValue(row.DepartmentName), PositionID: stringValue(row.PositionID), PositionCode: stringValue(row.PositionCode), PositionName: stringValue(row.PositionName), Phone: stringValue(row.Phone), Email: stringValue(row.Email), HireDate: employeeDateString(row.HireDate), Remark: stringValue(row.Remark)}
	return data, nil
}

func employeeDateValue(value string) pgtype.Date {
	if value == "" {
		return pgtype.Date{}
	}
	parsed, err := time.Parse("2006-01-02", value)
	if err != nil {
		return pgtype.Date{}
	}
	return pgtype.Date{Time: parsed, Valid: true}
}

func employeeDateString(value pgtype.Date) string {
	if !value.Valid {
		return ""
	}
	return value.Time.Format("2006-01-02")
}

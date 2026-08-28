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

type employeeCurrentWriter interface {
	ReserveEmployeeIdentity(context.Context, pgx.Tx, string, string, string) (bobdomain.EmployeeIdentity, error)
	GetEmployeeIdentity(context.Context, pgx.Tx, string) (bobdomain.EmployeeIdentity, error)
	ResolveEmployeeAuxiliaryReferences(context.Context, pgx.Tx, bobdomain.EmployeeData, bool) (bobdomain.EmployeeData, error)
	ResolveLatestApprovedReference(context.Context, pgx.Tx, string, string) (bobdomain.EffectiveReference, error)
	ApplyEmployeeCurrent(context.Context, pgx.Tx, string, string, bool, string) (bobdomain.EmployeeCurrent, error)
	RemoveEmployeeCurrent(context.Context, pgx.Tx, string, string) (bobdomain.EmployeeIdentity, error)
	DeleteEmployeeIdentity(context.Context, pgx.Tx, string, int64) error
	EnsureEmployeeDisableAllowed(context.Context, pgx.Tx, string) error
	EnsureEmployeeUnapproveAllowed(context.Context, pgx.Tx, string) error
}

type employeePartyReader interface {
	ResolveForRelationship(context.Context, pgx.Tx, string) (bobdomain.PartyRelationshipResolved, error)
}

type EmployeeService struct {
	pool        *pgxpool.Pool
	queries     *dbsqlc.Queries
	current     employeeCurrentWriter
	parties     bobdomain.PartyDeclarationCreator
	partyReader employeePartyReader
	coordinator *approval.Coordinator[dclapproval.EmployeePayload]
}

func NewEmployeeService(pool *pgxpool.Pool, current employeeCurrentWriter, parties bobdomain.PartyDeclarationCreator, partyReader employeePartyReader, authorizer approval.Authorizer, bus *txevent.Bus) *EmployeeService {
	if pool == nil || current == nil || parties == nil || partyReader == nil || authorizer == nil || bus == nil {
		panic("dcl: Employee persistence, BOB current writer, Party ports, authorizer and event bus are required")
	}
	c, err := approval.NewCoordinator("dcl", EntityEmployee, authorizer, bus, dclapproval.EmployeeTopic)
	if err != nil {
		panic(err)
	}
	return &EmployeeService{pool: pool, queries: dbsqlc.New(pool), current: current, parties: parties, partyReader: partyReader, coordinator: c}
}

func employeeDeclarationData(data EmployeeInput) bobdomain.EmployeeData {
	result := bobdomain.EmployeeData{Phone: data.Phone, Email: data.Email, HireDate: data.HireDate, Remark: data.Remark}
	if data.EmployeeCategoryID != "" {
		result.EmployeeCategory = &bobdomain.EmployeeReferenceSnapshot{ObjectID: data.EmployeeCategoryID}
	}
	if data.DepartmentID != "" {
		result.Department = &bobdomain.EmployeeReferenceSnapshot{ObjectID: data.DepartmentID}
	}
	if data.PositionID != "" {
		result.Position = &bobdomain.EmployeeReferenceSnapshot{ObjectID: data.PositionID}
	}
	return result
}
func employeeDCLData(data bobdomain.EmployeeData) EmployeeData {
	result := EmployeeData{Phone: data.Phone, Email: data.Email, HireDate: data.HireDate, Remark: data.Remark}
	if data.EmployeeCategory != nil {
		result.EmployeeCategoryID, result.EmployeeCategoryApprovalEntryID = data.EmployeeCategory.ObjectID, data.EmployeeCategory.ApprovalEntryID
		result.EmployeeCategoryCode, result.EmployeeCategoryName = data.EmployeeCategory.Code, data.EmployeeCategory.Name
	}
	if data.Department != nil {
		result.DepartmentID, result.DepartmentApprovalEntryID = data.Department.ObjectID, data.Department.ApprovalEntryID
		result.DepartmentCode, result.DepartmentName = data.Department.Code, data.Department.Name
	}
	if data.Position != nil {
		result.PositionID, result.PositionApprovalEntryID = data.Position.ObjectID, data.Position.ApprovalEntryID
		result.PositionCode, result.PositionName = data.Position.Code, data.Position.Name
	}
	return result
}
func employeePayload(i bobdomain.EmployeeIdentity, enabled bool, data EmployeeData) dclapproval.EmployeePayload {
	return dclapproval.EmployeePayload{SubjectID: i.ObjectID, Code: i.Code, PartyID: i.PartyID, Enabled: enabled}
}
func employeeMutation(i bobdomain.EmployeeIdentity, enabled bool, e approval.Entry) EmployeeMutation {
	return EmployeeMutation{ObjectID: i.ObjectID, ObjectRevision: i.ObjectRevision, Enabled: enabled, Approval: approval.VersionMetaFromEntry(e)}
}
func employeeInput(i EmployeeReviewInput) EmployeeVersionInput {
	return EmployeeVersionInput{ObjectID: i.ObjectID, ApprovalEntryID: i.ApprovalEntryID, ApprovalRevision: i.ApprovalRevision}
}
func employeeVersionData(r dbsqlc.GetDCLEmployeeVersionRow) EmployeeData {
	return employeeDCLData(employeeStoredData(r))
}

func employeeStoredData(r dbsqlc.GetDCLEmployeeVersionRow) bobdomain.EmployeeData {
	result := bobdomain.EmployeeData{Phone: stringValue(r.Phone), Email: stringValue(r.Email), HireDate: employeeDateString(r.HireDate), Remark: stringValue(r.Remark)}
	if r.EmployeeCategoryID != nil {
		result.EmployeeCategory = &bobdomain.EmployeeReferenceSnapshot{ObjectID: *r.EmployeeCategoryID, ApprovalEntryID: stringValue(r.EmployeeCategoryApprovalEntryID), Code: stringValue(r.EmployeeCategoryCode), Name: stringValue(r.EmployeeCategoryName)}
	}
	if r.DepartmentID != nil {
		result.Department = &bobdomain.EmployeeReferenceSnapshot{ObjectID: *r.DepartmentID, ApprovalEntryID: stringValue(r.DepartmentApprovalEntryID), Code: stringValue(r.DepartmentCode), Name: stringValue(r.DepartmentName)}
	}
	if r.PositionID != nil {
		result.Position = &bobdomain.EmployeeReferenceSnapshot{ObjectID: *r.PositionID, ApprovalEntryID: stringValue(r.PositionApprovalEntryID), Code: stringValue(r.PositionCode), Name: stringValue(r.PositionName)}
	}
	return result
}

func (s *EmployeeService) Create(ctx context.Context, input EmployeeCreateInput, actor approval.Actor) (EmployeeMutation, error) {
	data, err := bobdomain.ValidateEmployeeData(employeeDeclarationData(input.Data))
	if err != nil || !validActor(actor) || !validID(input.OperatingEntityID) || (input.PartyID == "") == (input.NewParty == nil) || (input.PartyID != "" && !validID(input.PartyID)) {
		if err == nil {
			err = newError(ErrorValidation, "validation_failed", "invalid employee declaration create request", nil, nil)
		}
		return EmployeeMutation{}, translateError(err)
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return EmployeeMutation{}, translateError(err)
	}
	defer tx.Rollback(ctx)
	if _, err = s.current.ResolveLatestApprovedReference(ctx, tx, bobdomain.EntityOperatingEntity, input.OperatingEntityID); err != nil {
		return EmployeeMutation{}, translateError(err)
	}
	var party bobdomain.PartyRelationshipResolved
	if input.NewParty != nil {
		party, err = s.parties.CreateForRelationship(ctx, tx, *input.NewParty, actor, false)
	} else {
		party, err = s.partyReader.ResolveForRelationship(ctx, tx, input.PartyID)
	}
	if err != nil {
		return EmployeeMutation{}, translateError(err)
	}
	id, err := s.current.ReserveEmployeeIdentity(ctx, tx, party.ID, input.OperatingEntityID, actor.ID())
	if err != nil {
		return EmployeeMutation{}, translateError(err)
	}
	q := s.queries.WithTx(tx)
	data, err = s.current.ResolveEmployeeAuxiliaryReferences(ctx, tx, data, false)
	if err != nil {
		return EmployeeMutation{}, translateError(err)
	}
	if err = q.InsertDCLSubject(ctx, dbsqlc.InsertDCLSubjectParams{ID: id.ObjectID, Entity: EntityEmployee, ActorID: actor.ID()}); err != nil {
		return EmployeeMutation{}, translateError(err)
	}
	e, err := s.coordinator.CreateFirstVersion(ctx, tx, id.ObjectID, actor, employeePayload(id, true, employeeDCLData(data)))
	if err != nil {
		return EmployeeMutation{}, translateError(err)
	}
	if err = insertEmployeeVersion(ctx, q, e.ID, true, data); err != nil {
		return EmployeeMutation{}, translateError(err)
	}
	if err = tx.Commit(ctx); err != nil {
		return EmployeeMutation{}, translateError(err)
	}
	return employeeMutation(id, true, e), nil
}

func (s *EmployeeService) Save(ctx context.Context, input EmployeeSaveInput, actor approval.Actor) (EmployeeMutation, error) {
	data, err := bobdomain.ValidateEmployeeData(employeeDeclarationData(input.Data))
	if err != nil || !validVersionInput(input.ObjectID, input.ApprovalEntryID, input.ApprovalRevision, actor) {
		if err == nil {
			err = newError(ErrorValidation, "validation_failed", "invalid employee declaration save request", nil, nil)
		}
		return EmployeeMutation{}, translateError(err)
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return EmployeeMutation{}, translateError(err)
	}
	defer tx.Rollback(ctx)
	if err = s.coordinator.LockVersionSubject(ctx, tx, input.ObjectID); err != nil {
		return EmployeeMutation{}, translateError(err)
	}
	q := s.queries.WithTx(tx)
	stored, err := q.GetApprovalEntry(ctx, dbsqlc.GetApprovalEntryParams{ID: input.ApprovalEntryID, Domain: "dcl", Entity: EntityEmployee})
	if err != nil || stored.SubjectID != input.ObjectID || stored.Revision != input.ApprovalRevision {
		if err == nil || errors.Is(err, pgx.ErrNoRows) {
			err = newError(ErrorConflict, "approval_stale_revision", "approval entry changed", nil, err)
		}
		return EmployeeMutation{}, translateError(err)
	}
	id, err := s.current.GetEmployeeIdentity(ctx, tx, input.ObjectID)
	if err != nil {
		return EmployeeMutation{}, translateError(err)
	}
	var e approval.Entry
	if stored.Status == string(approval.StatusApproved) {
		e, err = s.coordinator.CreateNextVersion(ctx, tx, input.ObjectID, actor, employeePayload(id, input.Enabled, employeeDCLData(data)))
		if err == nil {
			var n int64
			n, err = q.CopyDCLEmployeeVersion(ctx, dbsqlc.CopyDCLEmployeeVersionParams{NewApprovalEntryID: e.ID, SourceApprovalEntryID: stored.ID})
			if err == nil && n != 1 {
				err = errors.New("approved employee snapshot is missing")
			}
		}
	} else if stored.Status == string(approval.StatusDraft) {
		e = approvalEntry(stored)
	} else {
		err = newError(ErrorConflict, "approval_invalid_transition", "only a draft or latest approved declaration can be saved", nil, nil)
	}
	if err != nil {
		return EmployeeMutation{}, translateError(err)
	}
	data, err = s.current.ResolveEmployeeAuxiliaryReferences(ctx, tx, data, false)
	if err != nil {
		return EmployeeMutation{}, translateError(err)
	}
	n, err := q.UpdateDCLEmployeeVersion(ctx, employeeUpdateParams(e.ID, input.Enabled, data))
	if err != nil || n != 1 {
		if err == nil {
			err = errors.New("employee declaration snapshot is missing")
		}
		return EmployeeMutation{}, translateError(err)
	}
	e, err = s.coordinator.SaveDraft(ctx, tx, e.ID, e.Revision, actor, employeePayload(id, input.Enabled, employeeDCLData(data)))
	if err != nil {
		return EmployeeMutation{}, translateError(err)
	}
	if err = tx.Commit(ctx); err != nil {
		return EmployeeMutation{}, translateError(err)
	}
	return employeeMutation(id, input.Enabled, e), nil
}

func (s *EmployeeService) Submit(ctx context.Context, i EmployeeVersionInput, a approval.Actor) (EmployeeMutation, error) {
	return s.transition(ctx, i, "", approval.ActionSubmitted, a)
}
func (s *EmployeeService) Unsubmit(ctx context.Context, i EmployeeReviewInput, a approval.Actor) (EmployeeMutation, error) {
	return s.transition(ctx, employeeInput(i), "", approval.ActionUnsubmitted, a)
}
func (s *EmployeeService) Reject(ctx context.Context, i EmployeeReviewInput, a approval.Actor) (EmployeeMutation, error) {
	return s.transition(ctx, employeeInput(i), strings.TrimSpace(i.Reason), approval.ActionRejected, a)
}
func (s *EmployeeService) Approve(ctx context.Context, i EmployeeVersionInput, a approval.Actor) (EmployeeMutation, error) {
	return s.transition(ctx, i, "", approval.ActionApproved, a)
}
func (s *EmployeeService) Unapprove(ctx context.Context, i EmployeeReviewInput, a approval.Actor) (EmployeeMutation, error) {
	return s.transition(ctx, employeeInput(i), strings.TrimSpace(i.Reason), approval.ActionUnapproved, a)
}

func (s *EmployeeService) transition(ctx context.Context, input EmployeeVersionInput, reason string, action approval.Action, actor approval.Actor) (EmployeeMutation, error) {
	if !validVersionInput(input.ObjectID, input.ApprovalEntryID, input.ApprovalRevision, actor) {
		return EmployeeMutation{}, newError(ErrorValidation, "validation_failed", "invalid employee declaration lifecycle request", nil, nil)
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return EmployeeMutation{}, translateError(err)
	}
	defer tx.Rollback(ctx)
	p, err := s.coordinator.Prepare(ctx, tx, action, input.ApprovalEntryID, input.ApprovalRevision, actor, reason)
	if err != nil || p.Entry().SubjectID != input.ObjectID {
		if err == nil {
			err = newError(ErrorValidation, "validation_failed", "approval entry does not belong to employee", nil, nil)
		}
		return EmployeeMutation{}, translateError(err)
	}
	id, err := s.current.GetEmployeeIdentity(ctx, tx, input.ObjectID)
	if err != nil {
		return EmployeeMutation{}, translateError(err)
	}
	stored, err := s.queries.WithTx(tx).GetDCLEmployeeVersion(ctx, input.ApprovalEntryID)
	if err != nil {
		return EmployeeMutation{}, translateError(err)
	}
	data, err := bobdomain.ValidateEmployeeData(employeeStoredData(stored))
	if err != nil {
		return EmployeeMutation{}, translateError(err)
	}
	if action == approval.ActionSubmitted || action == approval.ActionApproved {
		if _, err = s.partyReader.ResolveForRelationship(ctx, tx, id.PartyID); err == nil {
			_, err = s.current.ResolveLatestApprovedReference(ctx, tx, bobdomain.EntityOperatingEntity, id.OperatingEntityID)
		}
		if err == nil {
			data, err = s.current.ResolveEmployeeAuxiliaryReferences(ctx, tx, data, true)
		}
		if err != nil {
			return EmployeeMutation{}, translateError(err)
		}
	}
	if action == approval.ActionApproved && !stored.Enabled {
		if err = s.current.EnsureEmployeeDisableAllowed(ctx, tx, input.ObjectID); err != nil {
			return EmployeeMutation{}, translateError(err)
		}
	}
	if action == approval.ActionUnapproved {
		if err = s.current.EnsureEmployeeUnapproveAllowed(ctx, tx, input.ApprovalEntryID); err != nil {
			return EmployeeMutation{}, translateError(err)
		}
		if err = s.ensureEmployeeUnapproveFallbackAllowed(ctx, tx, input.ObjectID, input.ApprovalEntryID); err != nil {
			return EmployeeMutation{}, err
		}
	}
	e, err := s.coordinator.Commit(ctx, tx, p, employeePayload(id, stored.Enabled, employeeDCLData(data)))
	if err != nil {
		return EmployeeMutation{}, translateError(err)
	}
	resultID, resultEnabled := id, stored.Enabled
	if action == approval.ActionApproved {
		c, applyErr := s.current.ApplyEmployeeCurrent(ctx, tx, input.ObjectID, e.ID, stored.Enabled, actor.ID())
		if applyErr != nil {
			return EmployeeMutation{}, translateError(applyErr)
		}
		resultID, resultEnabled = c.EmployeeIdentity, c.Enabled
	}
	if action == approval.ActionUnapproved {
		resultID, resultEnabled, err = s.restoreLatestApproved(ctx, tx, id, actor.ID())
		if err != nil {
			return EmployeeMutation{}, err
		}
	}
	if err = tx.Commit(ctx); err != nil {
		return EmployeeMutation{}, translateError(err)
	}
	return employeeMutation(resultID, resultEnabled, e), nil
}

func (s *EmployeeService) ensureEmployeeUnapproveFallbackAllowed(
	ctx context.Context,
	tx pgx.Tx,
	objectID string,
	excludedApprovalEntryID string,
) error {
	fallback, err := s.queries.WithTx(tx).GetLatestApprovedDCLEmployeeVersionExcluding(ctx, dbsqlc.GetLatestApprovedDCLEmployeeVersionExcludingParams{
		ObjectID:                objectID,
		ExcludedApprovalEntryID: excludedApprovalEntryID,
	})
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return translateError(err)
	}
	if err == nil {
		version, loadErr := s.queries.WithTx(tx).GetDCLEmployeeVersion(ctx, fallback.ID)
		if loadErr != nil {
			return translateError(loadErr)
		}
		if version.Enabled {
			return nil
		}
	}
	return translateError(s.current.EnsureEmployeeDisableAllowed(ctx, tx, objectID))
}

func (s *EmployeeService) restoreLatestApproved(ctx context.Context, tx pgx.Tx, id bobdomain.EmployeeIdentity, actorID string) (bobdomain.EmployeeIdentity, bool, error) {
	latest, err := s.queries.WithTx(tx).GetLatestApprovedVersion(ctx, dbsqlc.GetLatestApprovedVersionParams{Domain: "dcl", Entity: EntityEmployee, SubjectID: id.ObjectID})
	if errors.Is(err, pgx.ErrNoRows) {
		r, e := s.current.RemoveEmployeeCurrent(ctx, tx, id.ObjectID, actorID)
		return r, false, translateError(e)
	}
	if err != nil {
		return bobdomain.EmployeeIdentity{}, false, translateError(err)
	}
	stored, err := s.queries.WithTx(tx).GetDCLEmployeeVersion(ctx, latest.ID)
	if err != nil {
		return bobdomain.EmployeeIdentity{}, false, translateError(err)
	}
	d, err := bobdomain.ValidateEmployeeData(employeeStoredData(stored))
	if err != nil {
		return bobdomain.EmployeeIdentity{}, false, translateError(err)
	}
	if _, err = s.partyReader.ResolveForRelationship(ctx, tx, id.PartyID); err == nil {
		_, err = s.current.ResolveLatestApprovedReference(ctx, tx, bobdomain.EntityOperatingEntity, id.OperatingEntityID)
	}
	if err == nil {
		_, err = s.current.ResolveEmployeeAuxiliaryReferences(ctx, tx, d, true)
	}
	if err != nil {
		return bobdomain.EmployeeIdentity{}, false, translateError(err)
	}
	c, err := s.current.ApplyEmployeeCurrent(ctx, tx, id.ObjectID, latest.ID, stored.Enabled, actorID)
	return c.EmployeeIdentity, c.Enabled, translateError(err)
}

func (s *EmployeeService) Delete(ctx context.Context, input EmployeeDeleteInput, actor approval.Actor) error {
	if !validVersionInput(input.ObjectID, input.ApprovalEntryID, input.ApprovalRevision, actor) {
		return newError(ErrorValidation, "validation_failed", "invalid employee declaration delete request", nil, nil)
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return translateError(err)
	}
	defer tx.Rollback(ctx)
	if err = s.coordinator.LockVersionSubject(ctx, tx, input.ObjectID); err != nil {
		return translateError(err)
	}
	id, err := s.current.GetEmployeeIdentity(ctx, tx, input.ObjectID)
	if err != nil {
		return translateError(err)
	}
	q := s.queries.WithTx(tx)
	e, err := q.GetApprovalEntry(ctx, dbsqlc.GetApprovalEntryParams{ID: input.ApprovalEntryID, Domain: "dcl", Entity: EntityEmployee})
	if err != nil || e.SubjectID != input.ObjectID {
		return translateError(newError(ErrorValidation, "validation_failed", "declaration not found", nil, err))
	}
	stored, err := q.GetDCLEmployeeVersion(ctx, e.ID)
	if err != nil {
		return translateError(err)
	}
	if n, er := q.DeleteDCLEmployeeVersion(ctx, e.ID); er != nil || n != 1 {
		if er == nil {
			er = errors.New("employee declaration snapshot changed")
		}
		return translateError(er)
	}
	d := employeeVersionData(stored)
	if err = s.coordinator.DeleteDraftVersion(ctx, tx, e.ID, input.ApprovalRevision, actor, employeePayload(id, stored.Enabled, d)); err != nil {
		return translateError(err)
	}
	_, latestErr := q.GetLatestApprovedVersion(ctx, dbsqlc.GetLatestApprovedVersionParams{Domain: "dcl", Entity: EntityEmployee, SubjectID: input.ObjectID})
	if errors.Is(latestErr, pgx.ErrNoRows) {
		if n, er := q.DeleteDCLSubject(ctx, dbsqlc.DeleteDCLSubjectParams{ID: input.ObjectID, Entity: EntityEmployee}); er != nil || n != 1 {
			if er == nil {
				er = errors.New("DCL subject changed")
			}
			return translateError(er)
		}
		if err = s.current.DeleteEmployeeIdentity(ctx, tx, input.ObjectID, id.ObjectRevision); err != nil {
			return translateError(err)
		}
	} else if latestErr != nil {
		return translateError(latestErr)
	}
	return translateError(tx.Commit(ctx))
}

func insertEmployeeVersion(ctx context.Context, q *dbsqlc.Queries, id string, enabled bool, d bobdomain.EmployeeData) error {
	p := dbsqlc.InsertDCLEmployeeVersionParams{ApprovalEntryID: id, Phone: nilIfEmpty(d.Phone), Email: nilIfEmpty(d.Email), HireDate: employeeDateValue(d.HireDate), Remark: nilIfEmpty(d.Remark), Enabled: enabled}
	setEmployeeInsertReferences(&p, d)
	return q.InsertDCLEmployeeVersion(ctx, p)
}
func employeeUpdateParams(id string, enabled bool, d bobdomain.EmployeeData) dbsqlc.UpdateDCLEmployeeVersionParams {
	p := dbsqlc.UpdateDCLEmployeeVersionParams{ApprovalEntryID: id, Phone: nilIfEmpty(d.Phone), Email: nilIfEmpty(d.Email), HireDate: employeeDateValue(d.HireDate), Remark: nilIfEmpty(d.Remark), Enabled: enabled}
	if d.EmployeeCategory != nil {
		p.EmployeeCategoryID, p.EmployeeCategoryApprovalEntryID, p.EmployeeCategoryCode, p.EmployeeCategoryName = &d.EmployeeCategory.ObjectID, &d.EmployeeCategory.ApprovalEntryID, &d.EmployeeCategory.Code, &d.EmployeeCategory.Name
	}
	if d.Department != nil {
		p.DepartmentID, p.DepartmentApprovalEntryID, p.DepartmentCode, p.DepartmentName = &d.Department.ObjectID, &d.Department.ApprovalEntryID, &d.Department.Code, &d.Department.Name
	}
	if d.Position != nil {
		p.PositionID, p.PositionApprovalEntryID, p.PositionCode, p.PositionName = &d.Position.ObjectID, &d.Position.ApprovalEntryID, &d.Position.Code, &d.Position.Name
	}
	return p
}

func setEmployeeInsertReferences(p *dbsqlc.InsertDCLEmployeeVersionParams, d bobdomain.EmployeeData) {
	if d.EmployeeCategory != nil {
		p.EmployeeCategoryID, p.EmployeeCategoryApprovalEntryID, p.EmployeeCategoryCode, p.EmployeeCategoryName = &d.EmployeeCategory.ObjectID, &d.EmployeeCategory.ApprovalEntryID, &d.EmployeeCategory.Code, &d.EmployeeCategory.Name
	}
	if d.Department != nil {
		p.DepartmentID, p.DepartmentApprovalEntryID, p.DepartmentCode, p.DepartmentName = &d.Department.ObjectID, &d.Department.ApprovalEntryID, &d.Department.Code, &d.Department.Name
	}
	if d.Position != nil {
		p.PositionID, p.PositionApprovalEntryID, p.PositionCode, p.PositionName = &d.Position.ObjectID, &d.Position.ApprovalEntryID, &d.Position.Code, &d.Position.Name
	}
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

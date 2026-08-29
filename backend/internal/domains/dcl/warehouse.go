package dcl

import (
	"context"
	"errors"
	"strings"

	dbsqlc "github.com/hansonyu183/zerp/backend/internal/database/sqlc"
	bobdomain "github.com/hansonyu183/zerp/backend/internal/domains/bob"
	"github.com/hansonyu183/zerp/backend/internal/events/dclapproval"
	"github.com/hansonyu183/zerp/backend/internal/platform/approval"
	"github.com/hansonyu183/zerp/backend/internal/platform/txevent"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type warehouseRules interface {
	ResolveWarehouseManager(context.Context, pgx.Tx, bobdomain.WarehouseData, bool) (bobdomain.WarehouseData, error)
	EnsureWarehouseUnapproveAllowed(context.Context, pgx.Tx, string) error
	EnsureWarehouseDisableAllowed(context.Context, pgx.Tx, string) (bobdomain.WarehouseDisableBlockers, error)
}

type WarehouseService struct {
	pool        *pgxpool.Pool
	queries     *dbsqlc.Queries
	rules       warehouseRules
	coordinator *approval.Coordinator[dclapproval.WarehousePayload]
}

func NewWarehouseService(pool *pgxpool.Pool, rules warehouseRules, authorizer approval.Authorizer, bus *txevent.Bus) *WarehouseService {
	if pool == nil || rules == nil || authorizer == nil || bus == nil {
		panic("dcl: persistence, business rules, authorizer and event bus are required")
	}
	c, err := approval.NewCoordinator("dcl", EntityWarehouse, authorizer, bus, dclapproval.WarehouseTopic)
	if err != nil {
		panic(err)
	}
	return &WarehouseService{pool: pool, queries: dbsqlc.New(pool), rules: rules, coordinator: c}
}

func warehouseDeclarationData(data WarehouseData) bobdomain.WarehouseData {
	return bobdomain.WarehouseData{Name: data.Name, Address: data.Address, ContactName: data.ContactName, ContactPhone: data.ContactPhone, ManagerEmployeeID: data.ManagerEmployeeID, Remark: data.Remark}
}
func warehouseDCLData(data bobdomain.WarehouseData) WarehouseData {
	return WarehouseData{Name: data.Name, Address: data.Address, ContactName: data.ContactName, ContactPhone: data.ContactPhone, ManagerEmployeeID: data.ManagerEmployeeID, Remark: data.Remark}
}
func warehousePayload(i subjectIdentity, enabled bool, data WarehouseData) dclapproval.WarehousePayload {
	return dclapproval.WarehousePayload{SubjectID: i.ObjectID, Code: i.Code, Enabled: enabled, Name: data.Name}
}
func warehouseMutation(i subjectIdentity, enabled bool, e approval.Entry) WarehouseMutation {
	return WarehouseMutation{ObjectID: i.ObjectID, Enabled: enabled, Approval: approval.VersionMetaFromEntry(e)}
}
func warehouseInput(i WarehouseReviewInput) WarehouseVersionInput {
	return WarehouseVersionInput{ObjectID: i.ObjectID, ApprovalEntryID: i.ApprovalEntryID, ApprovalRevision: i.ApprovalRevision}
}
func warehouseVersionData(r dbsqlc.DclWarehouseVersion) WarehouseData {
	return warehouseDCLData(warehouseStoredData(r))
}

func warehouseStoredData(r dbsqlc.DclWarehouseVersion) bobdomain.WarehouseData {
	return bobdomain.WarehouseData{
		Name:                           r.Name,
		Address:                        stringValue(r.Address),
		ContactName:                    stringValue(r.ContactName),
		ContactPhone:                   stringValue(r.ContactPhone),
		ManagerEmployeeID:              stringValue(r.ManagerEmployeeID),
		ManagerEmployeeApprovalEntryID: stringValue(r.ManagerEmployeeApprovalEntryID),
		Remark:                         stringValue(r.Remark),
	}
}

func (s *WarehouseService) Create(ctx context.Context, input WarehouseCreateInput, actor approval.Actor) (WarehouseMutation, error) {
	data, err := bobdomain.ValidateWarehouseData(warehouseDeclarationData(input.Data))
	if err != nil || !validActor(actor) {
		if err == nil {
			err = newError(ErrorValidation, "validation_failed", "invalid warehouse declaration create request", nil, nil)
		}
		return WarehouseMutation{}, translateError(err)
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return WarehouseMutation{}, translateError(err)
	}
	defer tx.Rollback(ctx)
	id, err := reserveSubject(ctx, tx, EntityWarehouse, "WHS", actor.ID())
	if err != nil {
		return WarehouseMutation{}, translateError(err)
	}
	q := s.queries.WithTx(tx)
	data, err = s.rules.ResolveWarehouseManager(ctx, tx, data, false)
	if err != nil {
		return WarehouseMutation{}, translateError(err)
	}
	e, err := s.coordinator.CreateFirstVersion(ctx, tx, id.ObjectID, actor, warehousePayload(id, true, warehouseDCLData(data)))
	if err != nil {
		return WarehouseMutation{}, translateError(err)
	}
	if err = insertWarehouseVersion(ctx, q, e.ID, true, data); err != nil {
		return WarehouseMutation{}, translateError(err)
	}
	if err = tx.Commit(ctx); err != nil {
		return WarehouseMutation{}, translateError(err)
	}
	return warehouseMutation(id, true, e), nil
}

func (s *WarehouseService) Save(ctx context.Context, input WarehouseSaveInput, actor approval.Actor) (WarehouseMutation, error) {
	data, err := bobdomain.ValidateWarehouseData(warehouseDeclarationData(input.Data))
	if err != nil || !validVersionInput(input.ObjectID, input.ApprovalEntryID, input.ApprovalRevision, actor) {
		if err == nil {
			err = newError(ErrorValidation, "validation_failed", "invalid warehouse declaration save request", nil, nil)
		}
		return WarehouseMutation{}, translateError(err)
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return WarehouseMutation{}, translateError(err)
	}
	defer tx.Rollback(ctx)
	if err = s.coordinator.LockVersionSubject(ctx, tx, input.ObjectID); err != nil {
		return WarehouseMutation{}, translateError(err)
	}
	q := s.queries.WithTx(tx)
	stored, err := q.GetApprovalEntry(ctx, dbsqlc.GetApprovalEntryParams{ID: input.ApprovalEntryID, Domain: "dcl", Entity: EntityWarehouse})
	if err != nil || stored.SubjectID != input.ObjectID || stored.Revision != input.ApprovalRevision {
		if err == nil || errors.Is(err, pgx.ErrNoRows) {
			err = newError(ErrorConflict, "approval_stale_revision", "approval entry changed", nil, err)
		}
		return WarehouseMutation{}, translateError(err)
	}
	id, err := lockSubject(ctx, tx, EntityWarehouse, input.ObjectID)
	if err != nil {
		return WarehouseMutation{}, translateError(err)
	}
	var e approval.Entry
	if stored.Status == string(approval.StatusApproved) {
		e, err = s.coordinator.CreateNextVersion(ctx, tx, input.ObjectID, actor, warehousePayload(id, input.Enabled, warehouseDCLData(data)))
		if err == nil {
			var n int64
			n, err = q.CopyDCLWarehouseVersion(ctx, dbsqlc.CopyDCLWarehouseVersionParams{NewApprovalEntryID: e.ID, SourceApprovalEntryID: stored.ID})
			if err == nil && n != 1 {
				err = errors.New("approved warehouse snapshot is missing")
			}
		}
	} else if stored.Status == string(approval.StatusDraft) {
		e = approvalEntry(stored)
	} else {
		err = newError(ErrorConflict, "approval_invalid_transition", "only a draft or latest approved declaration can be saved", nil, nil)
	}
	if err != nil {
		return WarehouseMutation{}, translateError(err)
	}
	data, err = s.rules.ResolveWarehouseManager(ctx, tx, data, false)
	if err != nil {
		return WarehouseMutation{}, translateError(err)
	}
	n, err := q.UpdateDCLWarehouseVersion(ctx, warehouseUpdateParams(e.ID, input.Enabled, data))
	if err != nil || n != 1 {
		if err == nil {
			err = errors.New("warehouse declaration snapshot is missing")
		}
		return WarehouseMutation{}, translateError(err)
	}
	e, err = s.coordinator.SaveDraft(ctx, tx, e.ID, e.Revision, actor, warehousePayload(id, input.Enabled, warehouseDCLData(data)))
	if err != nil {
		return WarehouseMutation{}, translateError(err)
	}
	if err = tx.Commit(ctx); err != nil {
		return WarehouseMutation{}, translateError(err)
	}
	return warehouseMutation(id, input.Enabled, e), nil
}

func (s *WarehouseService) Submit(ctx context.Context, i WarehouseVersionInput, a approval.Actor) (WarehouseMutation, error) {
	return s.transition(ctx, i, "", approval.ActionSubmitted, a)
}
func (s *WarehouseService) Unsubmit(ctx context.Context, i WarehouseReviewInput, a approval.Actor) (WarehouseMutation, error) {
	return s.transition(ctx, warehouseInput(i), "", approval.ActionUnsubmitted, a)
}
func (s *WarehouseService) Reject(ctx context.Context, i WarehouseReviewInput, a approval.Actor) (WarehouseMutation, error) {
	return s.transition(ctx, warehouseInput(i), strings.TrimSpace(i.Reason), approval.ActionRejected, a)
}
func (s *WarehouseService) Approve(ctx context.Context, i WarehouseVersionInput, a approval.Actor) (WarehouseMutation, error) {
	return s.transition(ctx, i, "", approval.ActionApproved, a)
}
func (s *WarehouseService) Unapprove(ctx context.Context, i WarehouseReviewInput, a approval.Actor) (WarehouseMutation, error) {
	return s.transition(ctx, warehouseInput(i), strings.TrimSpace(i.Reason), approval.ActionUnapproved, a)
}

func (s *WarehouseService) transition(ctx context.Context, input WarehouseVersionInput, reason string, action approval.Action, actor approval.Actor) (WarehouseMutation, error) {
	if !validVersionInput(input.ObjectID, input.ApprovalEntryID, input.ApprovalRevision, actor) {
		return WarehouseMutation{}, newError(ErrorValidation, "validation_failed", "invalid warehouse declaration lifecycle request", nil, nil)
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return WarehouseMutation{}, translateError(err)
	}
	defer tx.Rollback(ctx)
	p, err := s.coordinator.Prepare(ctx, tx, action, input.ApprovalEntryID, input.ApprovalRevision, actor, reason)
	if err != nil || p.Entry().SubjectID != input.ObjectID {
		if err == nil {
			err = newError(ErrorValidation, "validation_failed", "approval entry does not belong to warehouse", nil, nil)
		}
		return WarehouseMutation{}, translateError(err)
	}
	id, err := lockSubject(ctx, tx, EntityWarehouse, input.ObjectID)
	if err != nil {
		return WarehouseMutation{}, translateError(err)
	}
	stored, err := s.queries.WithTx(tx).GetDCLWarehouseVersion(ctx, input.ApprovalEntryID)
	if err != nil {
		return WarehouseMutation{}, translateError(err)
	}
	data, err := bobdomain.ValidateWarehouseData(warehouseStoredData(stored))
	if err != nil {
		return WarehouseMutation{}, translateError(err)
	}
	if action == approval.ActionSubmitted || action == approval.ActionApproved {
		data, err = s.rules.ResolveWarehouseManager(ctx, tx, data, true)
		if err != nil {
			return WarehouseMutation{}, translateError(err)
		}
	}
	if action == approval.ActionApproved && !stored.Enabled {
		blockers, blockErr := s.rules.EnsureWarehouseDisableAllowed(ctx, tx, input.ObjectID)
		if blockErr != nil {
			return WarehouseMutation{}, translateError(blockErr)
		}
		if blockers.HasConflicts() {
			return WarehouseMutation{}, newError(ErrorConflict, "warehouse_disable_blocked", "warehouse cannot be disabled", blockers, nil)
		}
	}
	if action == approval.ActionUnapproved {
		if err = s.rules.EnsureWarehouseUnapproveAllowed(ctx, tx, input.ApprovalEntryID); err != nil {
			return WarehouseMutation{}, translateError(err)
		}
		if err = s.ensureWarehouseUnapproveFallbackAllowed(ctx, tx, input.ObjectID, input.ApprovalEntryID); err != nil {
			return WarehouseMutation{}, err
		}
	}
	e, err := s.coordinator.Commit(ctx, tx, p, warehousePayload(id, stored.Enabled, warehouseDCLData(data)))
	if err != nil {
		return WarehouseMutation{}, translateError(err)
	}
	if err = tx.Commit(ctx); err != nil {
		return WarehouseMutation{}, translateError(err)
	}
	return warehouseMutation(id, stored.Enabled, e), nil
}

// ensureWarehouseUnapproveFallbackAllowed validates the effective latest
// approved snapshot that will remain after the requested version is revoked.
func (s *WarehouseService) ensureWarehouseUnapproveFallbackAllowed(
	ctx context.Context,
	tx pgx.Tx,
	objectID string,
	excludedApprovalEntryID string,
) error {
	fallback, err := s.queries.WithTx(tx).GetLatestApprovedDCLWarehouseVersionExcluding(ctx, dbsqlc.GetLatestApprovedDCLWarehouseVersionExcludingParams{
		ObjectID:                objectID,
		ExcludedApprovalEntryID: excludedApprovalEntryID,
	})
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return translateError(err)
	}
	if err == nil {
		version, loadErr := s.queries.WithTx(tx).GetDCLWarehouseVersion(ctx, fallback.ID)
		if loadErr != nil {
			return translateError(loadErr)
		}
		if version.Enabled {
			return nil
		}
	}
	blockers, blockerErr := s.rules.EnsureWarehouseDisableAllowed(ctx, tx, objectID)
	if blockerErr != nil {
		return translateError(blockerErr)
	}
	if blockers.HasConflicts() {
		return newError(ErrorConflict, "warehouse_disable_blocked", "warehouse cannot be disabled", blockers, nil)
	}
	return nil
}

func (s *WarehouseService) Delete(ctx context.Context, input WarehouseDeleteInput, actor approval.Actor) error {
	if !validVersionInput(input.ObjectID, input.ApprovalEntryID, input.ApprovalRevision, actor) {
		return newError(ErrorValidation, "validation_failed", "invalid warehouse declaration delete request", nil, nil)
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return translateError(err)
	}
	defer tx.Rollback(ctx)
	if err = s.coordinator.LockVersionSubject(ctx, tx, input.ObjectID); err != nil {
		return translateError(err)
	}
	id, err := lockSubject(ctx, tx, EntityWarehouse, input.ObjectID)
	if err != nil {
		return translateError(err)
	}
	q := s.queries.WithTx(tx)
	e, err := q.GetApprovalEntry(ctx, dbsqlc.GetApprovalEntryParams{ID: input.ApprovalEntryID, Domain: "dcl", Entity: EntityWarehouse})
	if err != nil || e.SubjectID != input.ObjectID {
		return translateError(newError(ErrorValidation, "validation_failed", "declaration not found", nil, err))
	}
	stored, err := q.GetDCLWarehouseVersion(ctx, e.ID)
	if err != nil {
		return translateError(err)
	}
	if n, er := q.DeleteDCLWarehouseVersion(ctx, e.ID); er != nil || n != 1 {
		if er == nil {
			er = errors.New("warehouse declaration snapshot changed")
		}
		return translateError(er)
	}
	d := warehouseVersionData(stored)
	if err = s.coordinator.DeleteDraftVersion(ctx, tx, e.ID, input.ApprovalRevision, actor, warehousePayload(id, stored.Enabled, d)); err != nil {
		return translateError(err)
	}
	_, latestErr := q.GetLatestApprovedVersion(ctx, dbsqlc.GetLatestApprovedVersionParams{Domain: "dcl", Entity: EntityWarehouse, SubjectID: input.ObjectID})
	if errors.Is(latestErr, pgx.ErrNoRows) {
		if n, er := q.DeleteDCLSubject(ctx, dbsqlc.DeleteDCLSubjectParams{ID: input.ObjectID, Entity: EntityWarehouse}); er != nil || n != 1 {
			if er == nil {
				er = errors.New("DCL subject changed")
			}
			return translateError(er)
		}
	} else if latestErr != nil {
		return translateError(latestErr)
	}
	return translateError(tx.Commit(ctx))
}

func insertWarehouseVersion(ctx context.Context, q *dbsqlc.Queries, id string, enabled bool, d bobdomain.WarehouseData) error {
	return q.InsertDCLWarehouseVersion(ctx, dbsqlc.InsertDCLWarehouseVersionParams{ApprovalEntryID: id, Name: d.Name, Address: nilIfEmpty(d.Address), ContactName: nilIfEmpty(d.ContactName), ContactPhone: nilIfEmpty(d.ContactPhone), ManagerEmployeeID: nilIfEmpty(d.ManagerEmployeeID), ManagerEmployeeApprovalEntryID: nilIfEmpty(d.ManagerEmployeeApprovalEntryID), Remark: nilIfEmpty(d.Remark), Enabled: enabled})
}
func warehouseUpdateParams(id string, enabled bool, d bobdomain.WarehouseData) dbsqlc.UpdateDCLWarehouseVersionParams {
	return dbsqlc.UpdateDCLWarehouseVersionParams{ApprovalEntryID: id, Name: d.Name, Address: nilIfEmpty(d.Address), ContactName: nilIfEmpty(d.ContactName), ContactPhone: nilIfEmpty(d.ContactPhone), ManagerEmployeeID: nilIfEmpty(d.ManagerEmployeeID), ManagerEmployeeApprovalEntryID: nilIfEmpty(d.ManagerEmployeeApprovalEntryID), Remark: nilIfEmpty(d.Remark), Enabled: enabled}
}

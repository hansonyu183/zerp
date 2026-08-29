package dcl

import (
	"context"
	"errors"
	"fmt"
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
	"github.com/oklog/ulid/v2"
)

type operatingEntityCurrentWriter interface {
	EnsureOperatingEntityUnapproveAllowed(context.Context, pgx.Tx, string) error
}

type OperatingEntityService struct {
	pool        *pgxpool.Pool
	queries     *dbsqlc.Queries
	current     operatingEntityCurrentWriter
	coordinator *approval.Coordinator[dclapproval.OperatingEntityPayload]
}

func NewOperatingEntityService(
	pool *pgxpool.Pool,
	current operatingEntityCurrentWriter,
	authorizer approval.Authorizer,
	bus *txevent.Bus,
) *OperatingEntityService {
	if pool == nil || current == nil || authorizer == nil || bus == nil {
		panic("dcl: persistence, BOB current writer, authorizer and event bus are required")
	}
	coordinator, err := approval.NewCoordinator("dcl", EntityOperatingEntity, authorizer, bus, dclapproval.OperatingEntityTopic)
	if err != nil {
		panic(err)
	}
	return &OperatingEntityService{pool: pool, queries: dbsqlc.New(pool), current: current, coordinator: coordinator}
}

func (s *OperatingEntityService) Create(ctx context.Context, input OperatingEntityCreateInput, actor approval.Actor) (OperatingEntityMutation, error) {
	data, err := bobdomain.ValidateOperatingEntityData(input.Data)
	if err != nil || !validActor(actor) {
		if err == nil {
			err = newError(ErrorValidation, "validation_failed", "invalid operating entity declaration create request", nil, nil)
		}
		return OperatingEntityMutation{}, translateError(err)
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return OperatingEntityMutation{}, translateError(fmt.Errorf("begin DCL operating entity create: %w", err))
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	identity, err := reserveSubject(ctx, tx, EntityOperatingEntity, "OPE", actor.ID())
	if err != nil {
		return OperatingEntityMutation{}, translateError(err)
	}
	q := s.queries.WithTx(tx)
	payload := declarationPayload(identity, true, data)
	entry, err := s.coordinator.CreateFirstVersion(ctx, tx, identity.ObjectID, actor, payload)
	if err != nil {
		return OperatingEntityMutation{}, translateError(err)
	}
	if err = insertOperatingEntityVersion(ctx, q, entry.ID, true, data); err != nil {
		return OperatingEntityMutation{}, translateError(fmt.Errorf("insert DCL operating entity snapshot: %w", err))
	}
	if err = tx.Commit(ctx); err != nil {
		return OperatingEntityMutation{}, translateError(fmt.Errorf("commit DCL operating entity create: %w", err))
	}
	return operatingEntityMutation(identity, true, entry), nil
}

func (s *OperatingEntityService) Save(ctx context.Context, input OperatingEntitySaveInput, actor approval.Actor) (OperatingEntityMutation, error) {
	data, err := bobdomain.ValidateOperatingEntityData(input.Data)
	if err != nil || !validVersionInput(input.ObjectID, input.ApprovalEntryID, input.ApprovalRevision, actor) {
		if err == nil {
			err = newError(ErrorValidation, "validation_failed", "invalid operating entity declaration save request", nil, nil)
		}
		return OperatingEntityMutation{}, translateError(err)
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return OperatingEntityMutation{}, translateError(fmt.Errorf("begin DCL operating entity save: %w", err))
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	if err = s.coordinator.LockVersionSubject(ctx, tx, input.ObjectID); err != nil {
		return OperatingEntityMutation{}, translateError(err)
	}
	q := s.queries.WithTx(tx)
	stored, err := q.GetApprovalEntry(ctx, dbsqlc.GetApprovalEntryParams{ID: input.ApprovalEntryID, Domain: "dcl", Entity: EntityOperatingEntity})
	if err != nil || stored.SubjectID != input.ObjectID || stored.Revision != input.ApprovalRevision {
		if errors.Is(err, pgx.ErrNoRows) || err == nil {
			err = newError(ErrorConflict, "approval_stale_revision", "approval entry changed", nil, err)
		}
		return OperatingEntityMutation{}, translateError(err)
	}
	identity, err := lockSubject(ctx, tx, EntityOperatingEntity, input.ObjectID)
	if err != nil {
		return OperatingEntityMutation{}, translateError(err)
	}
	entry := approval.Entry{}
	if stored.Status == string(approval.StatusApproved) {
		entry, err = s.coordinator.CreateNextVersion(ctx, tx, input.ObjectID, actor, declarationPayload(identity, input.Enabled, data))
		if err == nil {
			var copied int64
			copied, err = q.CopyDCLOperatingEntityVersion(ctx, dbsqlc.CopyDCLOperatingEntityVersionParams{
				NewApprovalEntryID: entry.ID, SourceApprovalEntryID: stored.ID,
			})
			if err == nil && copied != 1 {
				err = errors.New("approved operating entity snapshot is missing")
			}
		}
	} else if stored.Status == string(approval.StatusDraft) {
		entry = approvalEntry(stored)
	} else {
		err = newError(ErrorConflict, "approval_invalid_transition", "only a draft or latest approved declaration can be saved", nil, nil)
	}
	if err != nil {
		return OperatingEntityMutation{}, translateError(err)
	}
	updated, err := q.UpdateDCLOperatingEntityVersion(ctx, operatingEntityUpdateParams(entry.ID, input.Enabled, data))
	if err != nil || updated != 1 {
		if err == nil {
			err = errors.New("operating entity declaration snapshot is missing")
		}
		return OperatingEntityMutation{}, translateError(err)
	}
	entry, err = s.coordinator.SaveDraft(ctx, tx, entry.ID, entry.Revision, actor, declarationPayload(identity, input.Enabled, data))
	if err != nil {
		return OperatingEntityMutation{}, translateError(err)
	}
	if err = tx.Commit(ctx); err != nil {
		return OperatingEntityMutation{}, translateError(fmt.Errorf("commit DCL operating entity save: %w", err))
	}
	return operatingEntityMutation(identity, input.Enabled, entry), nil
}

func (s *OperatingEntityService) Submit(ctx context.Context, input OperatingEntityVersionInput, actor approval.Actor) (OperatingEntityMutation, error) {
	return s.transition(ctx, input, "", approval.ActionSubmitted, actor)
}

func (s *OperatingEntityService) Unsubmit(ctx context.Context, input OperatingEntityReviewInput, actor approval.Actor) (OperatingEntityMutation, error) {
	return s.transition(ctx, versionInput(input), "", approval.ActionUnsubmitted, actor)
}

func (s *OperatingEntityService) Reject(ctx context.Context, input OperatingEntityReviewInput, actor approval.Actor) (OperatingEntityMutation, error) {
	return s.transition(ctx, versionInput(input), strings.TrimSpace(input.Reason), approval.ActionRejected, actor)
}

func (s *OperatingEntityService) Approve(ctx context.Context, input OperatingEntityVersionInput, actor approval.Actor) (OperatingEntityMutation, error) {
	return s.transition(ctx, input, "", approval.ActionApproved, actor)
}

func (s *OperatingEntityService) Unapprove(ctx context.Context, input OperatingEntityReviewInput, actor approval.Actor) (OperatingEntityMutation, error) {
	return s.transition(ctx, versionInput(input), strings.TrimSpace(input.Reason), approval.ActionUnapproved, actor)
}

func (s *OperatingEntityService) transition(
	ctx context.Context,
	input OperatingEntityVersionInput,
	reason string,
	action approval.Action,
	actor approval.Actor,
) (OperatingEntityMutation, error) {
	if !validVersionInput(input.ObjectID, input.ApprovalEntryID, input.ApprovalRevision, actor) {
		return OperatingEntityMutation{}, newError(ErrorValidation, "validation_failed", "invalid operating entity declaration lifecycle request", nil, nil)
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return OperatingEntityMutation{}, translateError(fmt.Errorf("begin DCL operating entity lifecycle: %w", err))
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	prepared, err := s.coordinator.Prepare(ctx, tx, action, input.ApprovalEntryID, input.ApprovalRevision, actor, reason)
	if err != nil || prepared.Entry().SubjectID != input.ObjectID {
		if err == nil {
			err = newError(ErrorValidation, "validation_failed", "approval entry does not belong to operating entity", nil, nil)
		}
		return OperatingEntityMutation{}, translateError(err)
	}
	identity, err := lockSubject(ctx, tx, EntityOperatingEntity, input.ObjectID)
	if err != nil {
		return OperatingEntityMutation{}, translateError(err)
	}
	stored, err := s.queries.WithTx(tx).GetDCLOperatingEntityVersion(ctx, input.ApprovalEntryID)
	if err != nil {
		return OperatingEntityMutation{}, translateError(fmt.Errorf("load DCL operating entity snapshot: %w", err))
	}
	data, err := bobdomain.ValidateOperatingEntityData(operatingEntityData(stored))
	if err != nil {
		return OperatingEntityMutation{}, translateError(err)
	}
	if action == approval.ActionUnapproved {
		if err = s.current.EnsureOperatingEntityUnapproveAllowed(ctx, tx, input.ApprovalEntryID); err != nil {
			return OperatingEntityMutation{}, translateError(err)
		}
	}
	entry, err := s.coordinator.Commit(ctx, tx, prepared, declarationPayload(identity, stored.Enabled, data))
	if err != nil {
		return OperatingEntityMutation{}, translateError(err)
	}
	if err = tx.Commit(ctx); err != nil {
		return OperatingEntityMutation{}, translateError(fmt.Errorf("commit DCL operating entity lifecycle: %w", err))
	}
	return operatingEntityMutation(identity, stored.Enabled, entry), nil
}

func (s *OperatingEntityService) Delete(ctx context.Context, input OperatingEntityDeleteInput, actor approval.Actor) error {
	if !validVersionInput(input.ObjectID, input.ApprovalEntryID, input.ApprovalRevision, actor) {
		return newError(ErrorValidation, "validation_failed", "invalid operating entity declaration delete request", nil, nil)
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return translateError(err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	if err = s.coordinator.LockVersionSubject(ctx, tx, input.ObjectID); err != nil {
		return translateError(err)
	}
	identity, err := lockSubject(ctx, tx, EntityOperatingEntity, input.ObjectID)
	if err != nil {
		return translateError(err)
	}
	q := s.queries.WithTx(tx)
	entry, err := q.GetApprovalEntry(ctx, dbsqlc.GetApprovalEntryParams{ID: input.ApprovalEntryID, Domain: "dcl", Entity: EntityOperatingEntity})
	if err != nil || entry.SubjectID != input.ObjectID {
		return translateError(newError(ErrorValidation, "validation_failed", "declaration not found", nil, err))
	}
	stored, err := q.GetDCLOperatingEntityVersion(ctx, entry.ID)
	if err != nil {
		return translateError(err)
	}
	if rows, deleteErr := q.DeleteDCLOperatingEntityVersion(ctx, entry.ID); deleteErr != nil || rows != 1 {
		if deleteErr == nil {
			deleteErr = errors.New("declaration snapshot changed")
		}
		return translateError(deleteErr)
	}
	if err = s.coordinator.DeleteDraftVersion(ctx, tx, entry.ID, input.ApprovalRevision, actor,
		declarationPayload(identity, stored.Enabled, operatingEntityData(stored))); err != nil {
		return translateError(err)
	}
	_, latestErr := q.GetLatestApprovedVersion(ctx, dbsqlc.GetLatestApprovedVersionParams{Domain: "dcl", Entity: EntityOperatingEntity, SubjectID: input.ObjectID})
	if errors.Is(latestErr, pgx.ErrNoRows) {
		if rows, deleteErr := q.DeleteDCLSubject(ctx, dbsqlc.DeleteDCLSubjectParams{ID: input.ObjectID, Entity: EntityOperatingEntity}); deleteErr != nil || rows != 1 {
			if deleteErr == nil {
				deleteErr = errors.New("DCL subject changed")
			}
			return translateError(deleteErr)
		}
	} else if latestErr != nil {
		return translateError(latestErr)
	}
	return translateError(tx.Commit(ctx))
}

func (s *OperatingEntityService) Get(ctx context.Context, input OperatingEntityGetInput, actor approval.Actor) (OperatingEntityView, error) {
	if !validID(input.ObjectID) || (input.ApprovalEntryID != "" && !validID(input.ApprovalEntryID)) || !validActor(actor) {
		return OperatingEntityView{}, newError(ErrorValidation, "validation_failed", "invalid operating entity declaration get request", nil, nil)
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return OperatingEntityView{}, translateError(err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	entryID := input.ApprovalEntryID
	var entry approval.Entry
	if entryID == "" {
		entry, err = s.coordinator.GetOpenVersion(ctx, tx, input.ObjectID, actor)
		if approval.IsKey(err, "approval_version_not_found") {
			var latest dbsqlc.ApprovalEntry
			latest, err = s.queries.WithTx(tx).GetLatestApprovedVersion(ctx, dbsqlc.GetLatestApprovedVersionParams{
				Domain: "dcl", Entity: EntityOperatingEntity, SubjectID: input.ObjectID,
			})
			if err == nil {
				entryID = latest.ID
				entry, err = s.coordinator.Get(ctx, tx, entryID, actor)
			}
		} else if err == nil {
			entryID = entry.ID
		}
	} else {
		entry, err = s.coordinator.Get(ctx, tx, entryID, actor)
	}
	if err != nil || entry.SubjectID != input.ObjectID {
		if err == nil {
			err = newError(ErrorValidation, "validation_failed", "declaration not found", nil, nil)
		}
		return OperatingEntityView{}, translateError(err)
	}
	identity, err := s.queries.WithTx(tx).GetDCLSubject(ctx, dbsqlc.GetDCLSubjectParams{ID: input.ObjectID, Entity: EntityOperatingEntity})
	if err != nil {
		return OperatingEntityView{}, translateError(err)
	}
	stored, err := s.queries.WithTx(tx).GetDCLOperatingEntityVersion(ctx, entryID)
	if err != nil {
		return OperatingEntityView{}, translateError(err)
	}
	return OperatingEntityView{
		ObjectID: identity.ID, Entity: EntityOperatingEntity, Code: stringValue(identity.Code),
		Enabled:  stored.Enabled,
		Approval: approval.VersionMetaFromEntry(entry), Data: operatingEntityData(stored), UpdatedAt: entry.UpdatedAt,
	}, nil
}

func declarationPayload(identity subjectIdentity, enabled bool, data OperatingEntityData) dclapproval.OperatingEntityPayload {
	return dclapproval.OperatingEntityPayload{SubjectID: identity.ObjectID, Code: identity.Code, Enabled: enabled, Name: data.Name}
}

func operatingEntityMutation(identity subjectIdentity, enabled bool, entry approval.Entry) OperatingEntityMutation {
	return OperatingEntityMutation{ObjectID: identity.ObjectID, Enabled: enabled, Approval: approval.VersionMetaFromEntry(entry)}
}

func insertOperatingEntityVersion(ctx context.Context, q *dbsqlc.Queries, entryID string, enabled bool, data OperatingEntityData) error {
	return q.InsertDCLOperatingEntityVersion(ctx, dbsqlc.InsertDCLOperatingEntityVersionParams{
		ApprovalEntryID: entryID, LegalName: data.Name, ShortName: nilIfEmpty(data.ShortName),
		TaxNumber: nilIfEmpty(data.TaxNumber), Address: nilIfEmpty(data.Address),
		Phone: nilIfEmpty(data.Phone), Remark: nilIfEmpty(data.Remark), Enabled: enabled,
	})
}

func operatingEntityUpdateParams(entryID string, enabled bool, data OperatingEntityData) dbsqlc.UpdateDCLOperatingEntityVersionParams {
	return dbsqlc.UpdateDCLOperatingEntityVersionParams{
		ApprovalEntryID: entryID, LegalName: data.Name, ShortName: nilIfEmpty(data.ShortName),
		TaxNumber: nilIfEmpty(data.TaxNumber), Address: nilIfEmpty(data.Address),
		Phone: nilIfEmpty(data.Phone), Remark: nilIfEmpty(data.Remark), Enabled: enabled,
	}
}

func operatingEntityData(row dbsqlc.DclOperatingEntityVersion) OperatingEntityData {
	return OperatingEntityData{Name: row.LegalName, ShortName: stringValue(row.ShortName), TaxNumber: stringValue(row.TaxNumber), Address: stringValue(row.Address), Phone: stringValue(row.Phone), Remark: stringValue(row.Remark)}
}

func approvalEntry(row dbsqlc.ApprovalEntry) approval.Entry {
	return approval.Entry{
		EntryRef: approval.EntryRef{ID: row.ID, Domain: row.Domain, Entity: row.Entity, SubjectID: row.SubjectID, VersionNo: row.VersionNo},
		Status:   approval.Status(row.Status), Revision: row.Revision, CreatedBy: row.CreatedBy, CreatedAt: row.CreatedAt.Time,
		UpdatedBy: row.UpdatedBy, UpdatedAt: row.UpdatedAt.Time, SubmittedBy: row.SubmittedBy,
		SubmittedAt: timestampPointer(row.SubmittedAt), ApprovedBy: row.ApprovedBy, ApprovedAt: timestampPointer(row.ApprovedAt),
	}
}

func versionInput(input OperatingEntityReviewInput) OperatingEntityVersionInput {
	return OperatingEntityVersionInput{ObjectID: input.ObjectID, ApprovalEntryID: input.ApprovalEntryID, ApprovalRevision: input.ApprovalRevision}
}

func validVersionInput(objectID, entryID string, revision int64, actor approval.Actor) bool {
	return validID(objectID) && validID(entryID) && revision >= 1 && validActor(actor)
}

func validActor(actor approval.Actor) bool {
	return validID(actor.ID()) && strings.TrimSpace(actor.RequestID()) != ""
}

func validID(value string) bool {
	_, err := ulid.ParseStrict(strings.TrimSpace(value))
	return err == nil
}

func nilIfEmpty(value string) *string {
	if value == "" {
		return nil
	}
	return &value
}

func stringValue(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}

func timestampPointer(value pgtype.Timestamptz) *time.Time {
	if !value.Valid {
		return nil
	}
	result := value.Time
	return &result
}

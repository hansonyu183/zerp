package dcl

import (
	"context"
	"encoding/json"
	"errors"
	"strings"

	dbsqlc "github.com/hansonyu183/zerp/backend/internal/database/sqlc"
	"github.com/hansonyu183/zerp/backend/internal/events/dclapproval"
	"github.com/hansonyu183/zerp/backend/internal/platform/approval"
	"github.com/hansonyu183/zerp/backend/internal/platform/txevent"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/oklog/ulid/v2"
)

// accMappingApprovalHandler encapsulates the ACC-side side effects that happen
// inside the same transaction as a DCL acc-mapping approve or unapprove.
type accMappingApprovalHandler interface {
	CheckMappingAccess(ctx context.Context, tx pgx.Tx, bookID, actorID string, operate bool) (bool, error)
	ValidateMapping(ctx context.Context, tx pgx.Tx, bookID, vouEntity, defaultResult string, definition json.RawMessage) error
	ValidateAndRegisterMapping(ctx context.Context, tx pgx.Tx, approvalEntryID, bookID, vouEntity, defaultResult string, definition json.RawMessage) error
	ReleaseMappingUsages(ctx context.Context, tx pgx.Tx, approvalEntryID string) error
}

type AccMappingService struct {
	pool        *pgxpool.Pool
	queries     *dbsqlc.Queries
	acc         accMappingApprovalHandler
	coordinator *approval.Coordinator[dclapproval.AccMappingPayload]
}

func NewAccMappingService(pool *pgxpool.Pool, acc accMappingApprovalHandler, authorizer approval.Authorizer, bus *txevent.Bus) *AccMappingService {
	if pool == nil || acc == nil || authorizer == nil || bus == nil {
		panic("dcl: persistence, ACC approval handler, authorizer and event bus are required")
	}
	c, err := approval.NewCoordinator("dcl", EntityAccMapping, authorizer, bus, dclapproval.AccMappingTopic)
	if err != nil {
		panic(err)
	}
	return &AccMappingService{pool: pool, queries: dbsqlc.New(pool), acc: acc, coordinator: c}
}

func accMappingMutation(bookID, vouEntity string, e approval.Entry) AccMappingMutation {
	return AccMappingMutation{BookID: bookID, VouEntity: vouEntity, Approval: approval.VersionMetaFromEntry(e)}
}

func accMappingView(bookID, vouEntity, defaultResult string, definition []byte, e approval.Entry) AccMappingView {
	data := AccMappingData{DefaultResult: defaultResult, Definition: json.RawMessage(definition)}
	return AccMappingView{BookID: bookID, VouEntity: vouEntity, Approval: approval.VersionMetaFromEntry(e), Data: data}
}

func accMappingVersionData(r dbsqlc.DclAccMappingVersion) AccMappingData {
	return AccMappingData{DefaultResult: r.DefaultResult, Definition: json.RawMessage(r.Definition)}
}

func (s *AccMappingService) requireBookAccess(ctx context.Context, tx pgx.Tx, bookID string, actor approval.Actor, operate bool) error {
	if actor.Trusted() {
		return nil
	}
	allowed, err := s.acc.CheckMappingAccess(ctx, tx, bookID, actor.ID(), operate)
	if err != nil {
		return translateError(err)
	}
	if !allowed {
		return newError(ErrorForbidden, "accounting_book_access_denied", "没有该会计账簿的访问范围", nil, nil)
	}
	return nil
}

func (s *AccMappingService) resolveSubjectID(ctx context.Context, q *dbsqlc.Queries, bookID, vouEntity string) (string, error) {
	subject, err := q.GetDCLAccMappingSubject(ctx, dbsqlc.GetDCLAccMappingSubjectParams{BookID: bookID, VouEntity: vouEntity})
	if err != nil {
		return "", err
	}
	return subject.ID, nil
}

func (s *AccMappingService) Create(ctx context.Context, input AccMappingCreateInput, actor approval.Actor) (AccMappingMutation, error) {
	if !validActor(actor) || !validID(input.BookID) || input.VouEntity == "" {
		return AccMappingMutation{}, newError(ErrorValidation, "validation_failed", "invalid accounting mapping create request", nil, nil)
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return AccMappingMutation{}, translateError(err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	q := s.queries.WithTx(tx)
	if err = s.requireBookAccess(ctx, tx, input.BookID, actor, true); err != nil {
		return AccMappingMutation{}, err
	}
	if err = s.acc.ValidateMapping(ctx, tx, input.BookID, input.VouEntity, input.Data.DefaultResult, input.Data.Definition); err != nil {
		return AccMappingMutation{}, translateError(err)
	}
	if _, err = q.GetDCLAccMappingSubject(ctx, dbsqlc.GetDCLAccMappingSubjectParams{BookID: input.BookID, VouEntity: input.VouEntity}); err == nil {
		return AccMappingMutation{}, newError(ErrorConflict, "accounting_mapping_exists", "accounting mapping already exists for this book and VOU entity", nil, nil)
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return AccMappingMutation{}, translateError(err)
	}
	id := ulid.Make().String()
	if err = q.InsertDCLSubject(ctx, dbsqlc.InsertDCLSubjectParams{ID: id, Entity: EntityAccMapping, ActorID: actor.ID()}); err != nil {
		return AccMappingMutation{}, translateError(err)
	}
	if err = q.InsertDCLAccMappingSubject(ctx, dbsqlc.InsertDCLAccMappingSubjectParams{ID: id, BookID: input.BookID, VouEntity: input.VouEntity, ActorID: actor.ID()}); err != nil {
		return AccMappingMutation{}, translateError(err)
	}
	e, err := s.coordinator.CreateFirstVersion(ctx, tx, id, actor, dclapproval.AccMappingPayload{SubjectID: id, BookID: input.BookID, VouEntity: input.VouEntity})
	if err != nil {
		return AccMappingMutation{}, translateError(err)
	}
	if err = q.InsertDCLAccMappingVersion(ctx, dbsqlc.InsertDCLAccMappingVersionParams{ApprovalEntryID: e.ID, MappingID: id, DefaultResult: input.Data.DefaultResult, Definition: input.Data.Definition}); err != nil {
		return AccMappingMutation{}, translateError(err)
	}
	if err = tx.Commit(ctx); err != nil {
		return AccMappingMutation{}, translateError(err)
	}
	return accMappingMutation(input.BookID, input.VouEntity, e), nil
}

func (s *AccMappingService) Save(ctx context.Context, input AccMappingSaveInput, actor approval.Actor) (AccMappingMutation, error) {
	if !validVersionInput(input.BookID, input.ApprovalEntryID, input.ApprovalRevision, actor) || input.VouEntity == "" {
		return AccMappingMutation{}, newError(ErrorValidation, "validation_failed", "invalid accounting mapping save request", nil, nil)
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return AccMappingMutation{}, translateError(err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	q := s.queries.WithTx(tx)
	if err = s.requireBookAccess(ctx, tx, input.BookID, actor, true); err != nil {
		return AccMappingMutation{}, err
	}
	if err = s.acc.ValidateMapping(ctx, tx, input.BookID, input.VouEntity, input.Data.DefaultResult, input.Data.Definition); err != nil {
		return AccMappingMutation{}, translateError(err)
	}
	subjectID, err := s.resolveSubjectID(ctx, q, input.BookID, input.VouEntity)
	if err != nil {
		return AccMappingMutation{}, translateError(err)
	}
	if err = s.coordinator.LockVersionSubject(ctx, tx, subjectID); err != nil {
		return AccMappingMutation{}, translateError(err)
	}
	stored, err := q.GetApprovalEntry(ctx, dbsqlc.GetApprovalEntryParams{ID: input.ApprovalEntryID, Domain: "dcl", Entity: EntityAccMapping})
	if err != nil || stored.SubjectID != subjectID || stored.Revision != input.ApprovalRevision {
		if err == nil || errors.Is(err, pgx.ErrNoRows) {
			err = newError(ErrorConflict, "approval_stale_revision", "approval entry changed", nil, err)
		}
		return AccMappingMutation{}, translateError(err)
	}
	var e approval.Entry
	if stored.Status == string(approval.StatusApproved) {
		latest, latestErr := q.GetLatestApprovedVersion(ctx, dbsqlc.GetLatestApprovedVersionParams{Domain: "dcl", Entity: EntityAccMapping, SubjectID: subjectID})
		if latestErr != nil || latest.ID != stored.ID {
			if latestErr == nil || errors.Is(latestErr, pgx.ErrNoRows) {
				latestErr = newError(ErrorConflict, "approval_stale_revision", "latest approved accounting mapping changed", nil, latestErr)
			}
			return AccMappingMutation{}, translateError(latestErr)
		}
		e, err = s.coordinator.CreateNextVersion(ctx, tx, subjectID, actor, dclapproval.AccMappingPayload{SubjectID: subjectID, BookID: input.BookID, VouEntity: input.VouEntity})
		if err == nil {
			var n int64
			n, err = q.CopyDCLAccMappingVersion(ctx, dbsqlc.CopyDCLAccMappingVersionParams{NewApprovalEntryID: e.ID, SourceApprovalEntryID: stored.ID})
			if err == nil && n != 1 {
				err = errors.New("approved accounting mapping snapshot is missing")
			}
		}
	} else if stored.Status == string(approval.StatusDraft) {
		e = approvalEntry(stored)
	} else {
		err = newError(ErrorConflict, "approval_invalid_transition", "only a draft or latest approved declaration can be saved", nil, nil)
	}
	if err != nil {
		return AccMappingMutation{}, translateError(err)
	}
	n, err := q.UpdateDCLAccMappingVersion(ctx, dbsqlc.UpdateDCLAccMappingVersionParams{ApprovalEntryID: e.ID, DefaultResult: input.Data.DefaultResult, Definition: input.Data.Definition})
	if err != nil || n != 1 {
		if err == nil {
			err = errors.New("accounting mapping snapshot is missing")
		}
		return AccMappingMutation{}, translateError(err)
	}
	e, err = s.coordinator.SaveDraft(ctx, tx, e.ID, e.Revision, actor, dclapproval.AccMappingPayload{SubjectID: subjectID, BookID: input.BookID, VouEntity: input.VouEntity})
	if err != nil {
		return AccMappingMutation{}, translateError(err)
	}
	if err = tx.Commit(ctx); err != nil {
		return AccMappingMutation{}, translateError(err)
	}
	return accMappingMutation(input.BookID, input.VouEntity, e), nil
}

func (s *AccMappingService) Submit(ctx context.Context, i AccMappingVersionInput, a approval.Actor) (AccMappingMutation, error) {
	return s.transition(ctx, i, "", approval.ActionSubmitted, a)
}

func (s *AccMappingService) Unsubmit(ctx context.Context, i AccMappingVersionInput, a approval.Actor) (AccMappingMutation, error) {
	return s.transition(ctx, i, "", approval.ActionUnsubmitted, a)
}

func (s *AccMappingService) Reject(ctx context.Context, i AccMappingReviewInput, a approval.Actor) (AccMappingMutation, error) {
	return s.transition(ctx, accMappingVersionInput(i), strings.TrimSpace(i.Reason), approval.ActionRejected, a)
}

func (s *AccMappingService) Approve(ctx context.Context, i AccMappingVersionInput, a approval.Actor) (AccMappingMutation, error) {
	return s.transition(ctx, i, "", approval.ActionApproved, a)
}

func (s *AccMappingService) Unapprove(ctx context.Context, i AccMappingReviewInput, a approval.Actor) (AccMappingMutation, error) {
	return s.transition(ctx, accMappingVersionInput(i), strings.TrimSpace(i.Reason), approval.ActionUnapproved, a)
}

func accMappingVersionInput(i AccMappingReviewInput) AccMappingVersionInput {
	return AccMappingVersionInput{BookID: i.BookID, VouEntity: i.VouEntity, ApprovalEntryID: i.ApprovalEntryID, ApprovalRevision: i.ApprovalRevision}
}

func (s *AccMappingService) transition(ctx context.Context, input AccMappingVersionInput, reason string, action approval.Action, actor approval.Actor) (AccMappingMutation, error) {
	if !validVersionInput(input.BookID, input.ApprovalEntryID, input.ApprovalRevision, actor) || input.VouEntity == "" {
		return AccMappingMutation{}, newError(ErrorValidation, "validation_failed", "invalid accounting mapping lifecycle request", nil, nil)
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return AccMappingMutation{}, translateError(err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	q := s.queries.WithTx(tx)
	if err = s.requireBookAccess(ctx, tx, input.BookID, actor, true); err != nil {
		return AccMappingMutation{}, err
	}
	subjectID, err := s.resolveSubjectID(ctx, q, input.BookID, input.VouEntity)
	if err != nil {
		return AccMappingMutation{}, translateError(err)
	}
	p, err := s.coordinator.Prepare(ctx, tx, action, input.ApprovalEntryID, input.ApprovalRevision, actor, reason)
	if err != nil || p.Entry().SubjectID != subjectID {
		if err == nil {
			err = newError(ErrorValidation, "validation_failed", "approval entry does not belong to accounting mapping", nil, nil)
		}
		return AccMappingMutation{}, translateError(err)
	}
	stored, err := q.GetDCLAccMappingVersion(ctx, input.ApprovalEntryID)
	if err != nil {
		return AccMappingMutation{}, translateError(err)
	}
	if action == approval.ActionSubmitted {
		if err = s.acc.ValidateMapping(ctx, tx, input.BookID, input.VouEntity, stored.DefaultResult, stored.Definition); err != nil {
			return AccMappingMutation{}, translateError(err)
		}
	}
	if action == approval.ActionApproved {
		if err = s.acc.ValidateAndRegisterMapping(ctx, tx, input.ApprovalEntryID, input.BookID, input.VouEntity, stored.DefaultResult, stored.Definition); err != nil {
			return AccMappingMutation{}, translateError(err)
		}
	}
	if action == approval.ActionUnapproved {
		referenced, refErr := q.DCLAccMappingVersionReferenced(ctx, &input.ApprovalEntryID)
		if refErr != nil {
			return AccMappingMutation{}, translateError(refErr)
		}
		if referenced {
			return AccMappingMutation{}, newError(ErrorConflict, "accounting_mapping_voucher_blocked", "该版本已被会计凭证使用，不能反审核", nil, nil)
		}
		if err = s.acc.ReleaseMappingUsages(ctx, tx, input.ApprovalEntryID); err != nil {
			return AccMappingMutation{}, translateError(err)
		}
	}
	e, err := s.coordinator.Commit(ctx, tx, p, dclapproval.AccMappingPayload{SubjectID: subjectID, BookID: input.BookID, VouEntity: input.VouEntity})
	if err != nil {
		return AccMappingMutation{}, translateError(err)
	}
	if action == approval.ActionUnapproved {
		latest, latestErr := q.GetLatestApprovedVersion(ctx, dbsqlc.GetLatestApprovedVersionParams{Domain: "dcl", Entity: EntityAccMapping, SubjectID: subjectID})
		if latestErr == nil {
			prev, prevErr := q.GetDCLAccMappingVersion(ctx, latest.ID)
			if prevErr != nil {
				return AccMappingMutation{}, translateError(prevErr)
			}
			if regErr := s.acc.ValidateAndRegisterMapping(ctx, tx, latest.ID, input.BookID, input.VouEntity, prev.DefaultResult, prev.Definition); regErr != nil {
				return AccMappingMutation{}, translateError(regErr)
			}
		} else if !errors.Is(latestErr, pgx.ErrNoRows) {
			return AccMappingMutation{}, translateError(latestErr)
		}
	}
	if err = tx.Commit(ctx); err != nil {
		return AccMappingMutation{}, translateError(err)
	}
	return accMappingMutation(input.BookID, input.VouEntity, e), nil
}

func (s *AccMappingService) Delete(ctx context.Context, input AccMappingDeleteInput, actor approval.Actor) error {
	if !validVersionInput(input.BookID, input.ApprovalEntryID, input.ApprovalRevision, actor) || input.VouEntity == "" {
		return newError(ErrorValidation, "validation_failed", "invalid accounting mapping delete request", nil, nil)
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return translateError(err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	q := s.queries.WithTx(tx)
	if err = s.requireBookAccess(ctx, tx, input.BookID, actor, true); err != nil {
		return err
	}
	subjectID, err := s.resolveSubjectID(ctx, q, input.BookID, input.VouEntity)
	if err != nil {
		return translateError(err)
	}
	e, err := q.GetApprovalEntry(ctx, dbsqlc.GetApprovalEntryParams{ID: input.ApprovalEntryID, Domain: "dcl", Entity: EntityAccMapping})
	if err != nil || e.SubjectID != subjectID {
		return translateError(newError(ErrorValidation, "validation_failed", "accounting mapping version not found", nil, err))
	}
	if e.Status != string(approval.StatusDraft) {
		return newError(ErrorConflict, "accounting_mapping_not_draft", "only draft accounting mapping versions can be deleted", nil, nil)
	}
	if _, err = q.DeleteDCLAccMappingVersion(ctx, input.ApprovalEntryID); err != nil {
		return translateError(err)
	}
	if err = s.coordinator.DeleteDraftVersion(ctx, tx, input.ApprovalEntryID, input.ApprovalRevision, actor, dclapproval.AccMappingPayload{SubjectID: subjectID, BookID: input.BookID, VouEntity: input.VouEntity}); err != nil {
		return translateError(err)
	}
	remaining, err := q.GetLatestApprovedVersion(ctx, dbsqlc.GetLatestApprovedVersionParams{Domain: "dcl", Entity: EntityAccMapping, SubjectID: subjectID})
	if errors.Is(err, pgx.ErrNoRows) {
		openEntries, openErr := s.coordinator.ListVersions(ctx, tx, subjectID, actor)
		if openErr == nil && len(openEntries) == 0 {
			if _, delErr := q.DeleteDCLAccMappingSubjectIfEmpty(ctx, subjectID); delErr != nil {
				return translateError(delErr)
			}
			if _, delErr := q.DeleteDCLSubject(ctx, dbsqlc.DeleteDCLSubjectParams{ID: subjectID, Entity: EntityAccMapping}); delErr != nil {
				return translateError(delErr)
			}
		} else if openErr != nil {
			return translateError(openErr)
		}
	} else if err != nil {
		return translateError(err)
	}
	_ = remaining
	if err = tx.Commit(ctx); err != nil {
		return translateError(err)
	}
	return nil
}

func (s *AccMappingService) CreateNext(ctx context.Context, input AccMappingVersionInput, actor approval.Actor) (AccMappingMutation, error) {
	if !validVersionInput(input.BookID, input.ApprovalEntryID, input.ApprovalRevision, actor) || input.VouEntity == "" {
		return AccMappingMutation{}, newError(ErrorValidation, "validation_failed", "invalid accounting mapping create-next request", nil, nil)
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return AccMappingMutation{}, translateError(err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	q := s.queries.WithTx(tx)
	if err = s.requireBookAccess(ctx, tx, input.BookID, actor, true); err != nil {
		return AccMappingMutation{}, err
	}
	subjectID, err := s.resolveSubjectID(ctx, q, input.BookID, input.VouEntity)
	if err != nil {
		return AccMappingMutation{}, translateError(err)
	}
	if err = s.coordinator.LockVersionSubject(ctx, tx, subjectID); err != nil {
		return AccMappingMutation{}, translateError(err)
	}
	stored, err := q.GetApprovalEntry(ctx, dbsqlc.GetApprovalEntryParams{ID: input.ApprovalEntryID, Domain: "dcl", Entity: EntityAccMapping})
	if err != nil || stored.SubjectID != subjectID || stored.Revision != input.ApprovalRevision || stored.Status != string(approval.StatusApproved) {
		if err == nil || errors.Is(err, pgx.ErrNoRows) {
			err = newError(ErrorConflict, "approval_stale_revision", "latest approved accounting mapping changed", nil, err)
		}
		return AccMappingMutation{}, translateError(err)
	}
	latest, err := q.GetLatestApprovedVersion(ctx, dbsqlc.GetLatestApprovedVersionParams{Domain: "dcl", Entity: EntityAccMapping, SubjectID: subjectID})
	if err != nil || latest.ID != stored.ID {
		if err == nil || errors.Is(err, pgx.ErrNoRows) {
			err = newError(ErrorConflict, "approval_stale_revision", "latest approved accounting mapping changed", nil, err)
		}
		return AccMappingMutation{}, translateError(err)
	}
	e, err := s.coordinator.CreateNextVersion(ctx, tx, subjectID, actor, dclapproval.AccMappingPayload{SubjectID: subjectID, BookID: input.BookID, VouEntity: input.VouEntity})
	if err != nil {
		return AccMappingMutation{}, translateError(err)
	}
	var copied int64
	if copied, err = q.CopyDCLAccMappingVersion(ctx, dbsqlc.CopyDCLAccMappingVersionParams{NewApprovalEntryID: e.ID, SourceApprovalEntryID: input.ApprovalEntryID}); err != nil {
		return AccMappingMutation{}, translateError(err)
	}
	if copied != 1 {
		return AccMappingMutation{}, translateError(errors.New("approved accounting mapping snapshot is missing"))
	}
	if err = tx.Commit(ctx); err != nil {
		return AccMappingMutation{}, translateError(err)
	}
	return accMappingMutation(input.BookID, input.VouEntity, e), nil
}

func (s *AccMappingService) Get(ctx context.Context, input AccMappingGetInput, actor approval.Actor) (AccMappingView, error) {
	if !validID(input.BookID) || input.VouEntity == "" {
		return AccMappingView{}, newError(ErrorValidation, "validation_failed", "invalid accounting mapping get request", nil, nil)
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return AccMappingView{}, translateError(err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	q := s.queries.WithTx(tx)
	if err = s.requireBookAccess(ctx, tx, input.BookID, actor, false); err != nil {
		return AccMappingView{}, err
	}
	subjectID, err := s.resolveSubjectID(ctx, q, input.BookID, input.VouEntity)
	if err != nil {
		return AccMappingView{}, translateError(err)
	}
	entryID := input.ApprovalEntryID
	var entry approval.Entry
	if entryID == "" {
		entry, err = s.coordinator.GetOpenVersion(ctx, tx, subjectID, actor)
		if approval.IsKey(err, "approval_version_not_found") {
			var latest dbsqlc.ApprovalEntry
			latest, err = q.GetLatestApprovedVersion(ctx, dbsqlc.GetLatestApprovedVersionParams{Domain: "dcl", Entity: EntityAccMapping, SubjectID: subjectID})
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
	if err != nil || entry.SubjectID != subjectID {
		if err == nil {
			err = newError(ErrorValidation, "validation_failed", "accounting mapping not found", nil, nil)
		}
		return AccMappingView{}, translateError(err)
	}
	stored, err := q.GetDCLAccMappingVersion(ctx, entryID)
	if err != nil {
		return AccMappingView{}, translateError(err)
	}
	return accMappingView(input.BookID, input.VouEntity, stored.DefaultResult, stored.Definition, entry), nil
}

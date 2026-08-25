package approval

import (
	"context"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"time"

	"github.com/hansonyu183/zerp/backend/internal/api/authorization"
	dbsqlc "github.com/hansonyu183/zerp/backend/internal/database/sqlc"
	"github.com/hansonyu183/zerp/backend/internal/platform/txevent"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/oklog/ulid/v2"
)

var (
	domainPattern = regexp.MustCompile(`^[a-z][a-z0-9-]{0,31}$`)
	entityPattern = regexp.MustCompile(`^[a-z][a-z0-9-]{0,63}$`)
)

type Authorizer interface {
	RequirePermission(context.Context, authorization.Principal, string, string) error
}

type Coordinator[T any] struct {
	domain     string
	entity     string
	authorizer Authorizer
	bus        *txevent.Bus
	topic      Topic[T]
	now        func() time.Time
	newID      func() string
}

func NewCoordinator[T any](domain, entity string, authorizer Authorizer, bus *txevent.Bus, topic Topic[T]) (*Coordinator[T], error) {
	domain = strings.TrimSpace(domain)
	entity = strings.TrimSpace(entity)
	if !domainPattern.MatchString(domain) || !entityPattern.MatchString(entity) || authorizer == nil || bus == nil || topic.name == "" {
		return nil, newError(ErrorValidation, "approval_invalid_configuration", "invalid approval coordinator configuration", nil)
	}
	return &Coordinator[T]{
		domain: domain, entity: entity, authorizer: authorizer, bus: bus, topic: topic,
		now: time.Now, newID: func() string { return ulid.Make().String() },
	}, nil
}

func (c *Coordinator[T]) Get(ctx context.Context, tx pgx.Tx, entryID string, actor Actor) (Entry, error) {
	if err := c.authorize(ctx, actor, "get"); err != nil {
		return Entry{}, err
	}
	if err := validateCall(tx, entryID, actor); err != nil {
		return Entry{}, err
	}
	row, err := dbsqlc.New(tx).GetApprovalEntry(ctx, dbsqlc.GetApprovalEntryParams{ID: entryID, Domain: c.domain, Entity: c.entity})
	if errors.Is(err, pgx.ErrNoRows) {
		return Entry{}, newError(ErrorNotFound, "approval_not_found", "approval entry not found", err)
	}
	if err != nil {
		return Entry{}, c.databaseError("get approval entry", err)
	}
	return entryFromRow(row), nil
}

func (c *Coordinator[T]) Lock(ctx context.Context, tx pgx.Tx, entryID string, expectedRevision int64, actor Actor, action Action) (Entry, error) {
	permissionAction, ok := permissionAction(action)
	if !ok {
		return Entry{}, newError(ErrorValidation, "approval_invalid_action", "invalid approval action", nil)
	}
	if err := c.authorize(ctx, actor, permissionAction); err != nil {
		return Entry{}, err
	}
	if err := validateCall(tx, entryID, actor); err != nil || expectedRevision < 1 {
		if err != nil {
			return Entry{}, err
		}
		return Entry{}, newError(ErrorValidation, "approval_invalid_revision", "invalid approval revision", nil)
	}
	row, err := dbsqlc.New(tx).LockApprovalEntry(ctx, dbsqlc.LockApprovalEntryParams{ID: entryID, Domain: c.domain, Entity: c.entity})
	if errors.Is(err, pgx.ErrNoRows) {
		return Entry{}, newError(ErrorNotFound, "approval_not_found", "approval entry not found", err)
	}
	if err != nil {
		return Entry{}, c.databaseError("lock approval entry", err)
	}
	entry := entryFromRow(row)
	if entry.Revision != expectedRevision {
		return Entry{}, newError(ErrorConflict, "approval_stale_revision", "approval entry changed", nil)
	}
	return entry, nil
}

func (c *Coordinator[T]) CreateSubject(ctx context.Context, tx pgx.Tx, subjectID string, actor Actor, payload T) (Entry, error) {
	if err := c.authorize(ctx, actor, "create"); err != nil {
		return Entry{}, err
	}
	subjectID = strings.TrimSpace(subjectID)
	if err := validateCall(tx, subjectID, actor); err != nil || len(subjectID) > 128 {
		if err == nil {
			err = newError(ErrorValidation, "approval_invalid_request", "invalid approval request", nil)
		}
		return Entry{}, err
	}
	when := c.timestamp()
	row, err := dbsqlc.New(tx).CreateApprovalEntry(ctx, dbsqlc.CreateApprovalEntryParams{
		ID: c.newID(), Domain: c.domain, Entity: c.entity, SubjectID: subjectID,
		ActorID: actor.ID(), OccurredAt: timestamp(when),
	})
	if err != nil {
		return Entry{}, c.databaseError("create approval entry", err)
	}
	entry := entryFromRow(row)
	toStatus, toRevision := entry.Status, entry.Revision
	event := Event[T]{
		Entry: entry, Action: ActionCreated, ToStatus: &toStatus, ToRevision: &toRevision,
		ActorID: actor.ID(), RequestID: actor.RequestID(), Payload: payload,
	}
	if err = c.recordAndPublish(ctx, tx, event, when); err != nil {
		return Entry{}, err
	}
	return entry, nil
}

func (c *Coordinator[T]) CreateFirstVersion(ctx context.Context, tx pgx.Tx, subjectID string, actor Actor, payload T) (Entry, error) {
	if err := c.authorize(ctx, actor, "create"); err != nil {
		return Entry{}, err
	}
	subjectID = strings.TrimSpace(subjectID)
	if err := validateCall(tx, subjectID, actor); err != nil || len(subjectID) > 128 {
		if err == nil {
			err = newError(ErrorValidation, "approval_invalid_request", "invalid approval request", nil)
		}
		return Entry{}, err
	}
	exists, err := dbsqlc.New(tx).ApprovalVersionsExist(ctx, dbsqlc.ApprovalVersionsExistParams{
		Domain: c.domain, Entity: c.entity, SubjectID: subjectID,
	})
	if err != nil {
		return Entry{}, c.databaseError("check approval version history", err)
	}
	if exists {
		return Entry{}, newError(ErrorConflict, "approval_version_history_exists", "approval version history already exists", nil)
	}
	when := c.timestamp()
	row, err := dbsqlc.New(tx).CreateApprovalVersion(ctx, dbsqlc.CreateApprovalVersionParams{
		ID: c.newID(), Domain: c.domain, Entity: c.entity, SubjectID: subjectID, VersionNo: int32Pointer(1),
		ActorID: actor.ID(), OccurredAt: timestamp(when),
	})
	if err != nil {
		return Entry{}, c.databaseError("create first approval version", err)
	}
	entry := entryFromRow(row)
	toStatus, toRevision := entry.Status, entry.Revision
	event := Event[T]{
		Entry: entry, VersionNo: entry.VersionNo, Action: ActionCreated, ToStatus: &toStatus, ToRevision: &toRevision,
		ActorID: actor.ID(), RequestID: actor.RequestID(), Payload: payload,
	}
	if err = c.recordAndPublish(ctx, tx, event, when); err != nil {
		return Entry{}, err
	}
	return entry, nil
}

func (c *Coordinator[T]) CreateNextVersion(ctx context.Context, tx pgx.Tx, subjectID string, actor Actor, payload T) (Entry, error) {
	if err := c.authorize(ctx, actor, "save"); err != nil {
		return Entry{}, err
	}
	subjectID = strings.TrimSpace(subjectID)
	if err := validateCall(tx, subjectID, actor); err != nil || len(subjectID) > 128 {
		if err == nil {
			err = newError(ErrorValidation, "approval_invalid_request", "invalid approval request", nil)
		}
		return Entry{}, err
	}
	queries := dbsqlc.New(tx)
	if _, err := queries.GetOpenApprovalVersion(ctx, dbsqlc.GetOpenApprovalVersionParams{
		Domain: c.domain, Entity: c.entity, SubjectID: subjectID,
	}); err == nil {
		return Entry{}, newError(ErrorConflict, "approval_open_version_exists", "an open approval version already exists", nil)
	} else if !errors.Is(err, pgx.ErrNoRows) {
		return Entry{}, c.databaseError("get open approval version", err)
	}
	latest, err := queries.GetLatestApprovedVersion(ctx, dbsqlc.GetLatestApprovedVersionParams{
		Domain: c.domain, Entity: c.entity, SubjectID: subjectID,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return Entry{}, newError(ErrorConflict, "approval_no_approved_version", "an approved version is required", err)
	}
	if err != nil {
		return Entry{}, c.databaseError("get latest approved version", err)
	}
	when := c.timestamp()
	row, err := queries.CreateApprovalVersion(ctx, dbsqlc.CreateApprovalVersionParams{
		ID: c.newID(), Domain: c.domain, Entity: c.entity, SubjectID: subjectID,
		VersionNo: int32Pointer(*latest.VersionNo + 1), ActorID: actor.ID(), OccurredAt: timestamp(when),
	})
	if err != nil {
		return Entry{}, c.databaseError("create next approval version", err)
	}
	entry := entryFromRow(row)
	toStatus, toRevision := entry.Status, entry.Revision
	previousApprovedVersionID := stringPointer(latest.ID)
	currentApprovedVersionID := stringPointer(latest.ID)
	event := Event[T]{
		Entry: entry, VersionNo: entry.VersionNo, Action: ActionCreated, ToStatus: &toStatus, ToRevision: &toRevision,
		ActorID: actor.ID(), RequestID: actor.RequestID(), Payload: payload,
		PreviousApprovedVersionID: previousApprovedVersionID,
		CurrentApprovedVersionID:  currentApprovedVersionID,
	}
	if err = c.recordAndPublish(ctx, tx, event, when); err != nil {
		return Entry{}, err
	}
	return entry, nil
}

func (c *Coordinator[T]) GetLatestApproved(ctx context.Context, tx pgx.Tx, subjectID string, actor Actor) (Entry, error) {
	if err := c.authorize(ctx, actor, "get"); err != nil {
		return Entry{}, err
	}
	subjectID = strings.TrimSpace(subjectID)
	if err := validateCall(tx, subjectID, actor); err != nil || len(subjectID) > 128 {
		if err == nil {
			err = newError(ErrorValidation, "approval_invalid_request", "invalid approval request", nil)
		}
		return Entry{}, err
	}
	row, err := dbsqlc.New(tx).GetLatestApprovedVersion(ctx, dbsqlc.GetLatestApprovedVersionParams{
		Domain: c.domain, Entity: c.entity, SubjectID: subjectID,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return Entry{}, newError(ErrorNotFound, "approval_version_not_found", "approval version not found", err)
	}
	if err != nil {
		return Entry{}, c.databaseError("get latest approved version", err)
	}
	return entryFromRow(row), nil
}

func (c *Coordinator[T]) GetOpenVersion(ctx context.Context, tx pgx.Tx, subjectID string, actor Actor) (Entry, error) {
	if err := c.authorize(ctx, actor, "get"); err != nil {
		return Entry{}, err
	}
	subjectID = strings.TrimSpace(subjectID)
	if err := validateCall(tx, subjectID, actor); err != nil || len(subjectID) > 128 {
		if err == nil {
			err = newError(ErrorValidation, "approval_invalid_request", "invalid approval request", nil)
		}
		return Entry{}, err
	}
	row, err := dbsqlc.New(tx).GetOpenApprovalVersion(ctx, dbsqlc.GetOpenApprovalVersionParams{
		Domain: c.domain, Entity: c.entity, SubjectID: subjectID,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return Entry{}, newError(ErrorNotFound, "approval_version_not_found", "approval version not found", err)
	}
	if err != nil {
		return Entry{}, c.databaseError("get open approval version", err)
	}
	return entryFromRow(row), nil
}

func (c *Coordinator[T]) ListVersions(ctx context.Context, tx pgx.Tx, subjectID string, actor Actor) ([]Entry, error) {
	if err := c.authorize(ctx, actor, "versions"); err != nil {
		return nil, err
	}
	subjectID = strings.TrimSpace(subjectID)
	if err := validateCall(tx, subjectID, actor); err != nil || len(subjectID) > 128 {
		if err == nil {
			err = newError(ErrorValidation, "approval_invalid_request", "invalid approval request", nil)
		}
		return nil, err
	}
	rows, err := dbsqlc.New(tx).ListApprovalVersions(ctx, dbsqlc.ListApprovalVersionsParams{
		Domain: c.domain, Entity: c.entity, SubjectID: subjectID,
	})
	if err != nil {
		return nil, c.databaseError("list approval versions", err)
	}
	entries := make([]Entry, len(rows))
	for index := range rows {
		entries[index] = entryFromRow(rows[index])
	}
	return entries, nil
}

func (c *Coordinator[T]) Prepare(ctx context.Context, tx pgx.Tx, action Action, entryID string, expectedRevision int64, actor Actor, reason string) (Prepared, error) {
	entry, err := c.Lock(ctx, tx, entryID, expectedRevision, actor, action)
	if err != nil {
		return Prepared{}, err
	}
	reason = strings.TrimSpace(reason)
	if (action == ActionRejected || action == ActionUnapproved) && reason == "" {
		return Prepared{}, newError(ErrorValidation, "approval_reason_required", "approval reason is required", nil)
	}
	if action != ActionRejected && action != ActionUnapproved && reason != "" {
		return Prepared{}, newError(ErrorValidation, "approval_reason_not_allowed", "approval reason is not allowed", nil)
	}
	if !transitionAllowed(entry.Status, action) {
		return Prepared{}, newError(ErrorConflict, "approval_invalid_transition", "approval action is not allowed in the current status", nil)
	}
	if action == ActionApproved && entry.SubmittedBy != nil && *entry.SubmittedBy == actor.ID() {
		return Prepared{}, newError(ErrorForbidden, "approval_self_approval_forbidden", "submitter cannot approve the same entry", nil)
	}
	if action == ActionUnapproved && entry.VersionNo != nil {
		latest, latestErr := dbsqlc.New(tx).LockLatestApprovedVersion(ctx, dbsqlc.LockLatestApprovedVersionParams{
			Domain: c.domain, Entity: c.entity, SubjectID: entry.SubjectID,
		})
		if errors.Is(latestErr, pgx.ErrNoRows) || (latestErr == nil && latest.ID != entry.ID) {
			return Prepared{}, newError(ErrorConflict, "approval_not_latest_approved", "only the latest approved version can be unapproved", nil)
		}
		if latestErr != nil {
			return Prepared{}, c.databaseError("lock latest approved version", latestErr)
		}
	}
	prepared := Prepared{domain: c.domain, entity: c.entity, entry: entry, action: action, actor: actor}
	if reason != "" {
		prepared.reason = &reason
	}
	return prepared, nil
}

func (c *Coordinator[T]) Commit(ctx context.Context, tx pgx.Tx, prepared Prepared, payload T) (Entry, error) {
	if tx == nil || prepared.domain != c.domain || prepared.entity != c.entity || prepared.entry.ID == "" {
		return Entry{}, newError(ErrorValidation, "approval_invalid_preparation", "invalid prepared approval action", nil)
	}
	previousApprovedVersionID, err := c.latestApprovedVersionID(ctx, tx, prepared.entry)
	if err != nil {
		return Entry{}, err
	}
	when := c.timestamp()
	status, submittedBy, submittedAt, approvedBy, approvedAt := transitionMetadata(prepared, when)
	row, err := dbsqlc.New(tx).UpdateApprovalEntry(ctx, dbsqlc.UpdateApprovalEntryParams{
		Status: string(status), ActorID: prepared.actor.ID(), OccurredAt: timestamp(when),
		SubmittedBy: submittedBy, SubmittedAt: optionalTimestamp(submittedAt),
		ApprovedBy: approvedBy, ApprovedAt: optionalTimestamp(approvedAt),
		ID: prepared.entry.ID, Domain: c.domain, Entity: c.entity, ExpectedRevision: prepared.entry.Revision,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return Entry{}, newError(ErrorConflict, "approval_stale_revision", "approval entry changed", err)
	}
	if err != nil {
		return Entry{}, c.databaseError("commit approval entry", err)
	}
	entry := entryFromRow(row)
	currentApprovedVersionID, err := c.latestApprovedVersionID(ctx, tx, entry)
	if err != nil {
		return Entry{}, err
	}
	fromStatus, toStatus := prepared.entry.Status, entry.Status
	fromRevision, toRevision := prepared.entry.Revision, entry.Revision
	event := Event[T]{
		Entry: entry, VersionNo: entry.VersionNo, Action: prepared.action, FromStatus: &fromStatus, ToStatus: &toStatus,
		FromRevision: &fromRevision, ToRevision: &toRevision, ActorID: prepared.actor.ID(),
		RequestID: prepared.actor.RequestID(), Reason: prepared.reason, Payload: payload,
		SubmittedBy: entry.SubmittedBy, SubmittedAt: entry.SubmittedAt,
		ApprovedBy: entry.ApprovedBy, ApprovedAt: entry.ApprovedAt,
		PreviousApprovedVersionID: previousApprovedVersionID,
		CurrentApprovedVersionID:  currentApprovedVersionID,
	}
	if err = c.recordAndPublish(ctx, tx, event, when); err != nil {
		return Entry{}, err
	}
	return entry, nil
}

func (c *Coordinator[T]) latestApprovedVersionID(ctx context.Context, tx pgx.Tx, entry Entry) (*string, error) {
	if entry.VersionNo == nil {
		return nil, nil
	}
	row, err := dbsqlc.New(tx).GetLatestApprovedVersion(ctx, dbsqlc.GetLatestApprovedVersionParams{
		Domain: c.domain, Entity: c.entity, SubjectID: entry.SubjectID,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, c.databaseError("get latest approved version", err)
	}
	return stringPointer(row.ID), nil
}

func (c *Coordinator[T]) SaveDraft(ctx context.Context, tx pgx.Tx, entryID string, expectedRevision int64, actor Actor, payload T) (Entry, error) {
	return c.prepareAndCommit(ctx, tx, ActionSaved, entryID, expectedRevision, actor, "", payload)
}

func (c *Coordinator[T]) Submit(ctx context.Context, tx pgx.Tx, entryID string, expectedRevision int64, actor Actor, payload T) (Entry, error) {
	return c.prepareAndCommit(ctx, tx, ActionSubmitted, entryID, expectedRevision, actor, "", payload)
}

func (c *Coordinator[T]) Unsubmit(ctx context.Context, tx pgx.Tx, entryID string, expectedRevision int64, actor Actor, payload T) (Entry, error) {
	return c.prepareAndCommit(ctx, tx, ActionUnsubmitted, entryID, expectedRevision, actor, "", payload)
}

func (c *Coordinator[T]) Reject(ctx context.Context, tx pgx.Tx, entryID string, expectedRevision int64, actor Actor, reason string, payload T) (Entry, error) {
	return c.prepareAndCommit(ctx, tx, ActionRejected, entryID, expectedRevision, actor, reason, payload)
}

func (c *Coordinator[T]) Approve(ctx context.Context, tx pgx.Tx, entryID string, expectedRevision int64, actor Actor, payload T) (Entry, error) {
	return c.prepareAndCommit(ctx, tx, ActionApproved, entryID, expectedRevision, actor, "", payload)
}

func (c *Coordinator[T]) Unapprove(ctx context.Context, tx pgx.Tx, entryID string, expectedRevision int64, actor Actor, reason string, payload T) (Entry, error) {
	return c.prepareAndCommit(ctx, tx, ActionUnapproved, entryID, expectedRevision, actor, reason, payload)
}

func (c *Coordinator[T]) DeleteSubject(ctx context.Context, tx pgx.Tx, entryID string, expectedRevision int64, actor Actor, payload T) error {
	entry, err := c.Lock(ctx, tx, entryID, expectedRevision, actor, ActionDeleted)
	if err != nil {
		return err
	}
	if entry.VersionNo != nil {
		return newError(ErrorConflict, "approval_versioned_entry", "versioned approval entries must use version deletion", nil)
	}
	if entry.Status != StatusDraft {
		return newError(ErrorConflict, "approval_invalid_transition", "only a draft approval entry can be deleted", nil)
	}
	when := c.timestamp()
	deleted, err := dbsqlc.New(tx).DeleteApprovalEntry(ctx, dbsqlc.DeleteApprovalEntryParams{
		ID: entry.ID, Domain: c.domain, Entity: c.entity, ExpectedRevision: entry.Revision,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return newError(ErrorConflict, "approval_stale_revision", "approval entry changed", err)
	}
	if err != nil {
		return c.databaseError("delete approval entry", err)
	}
	deletedEntry := entryFromRow(deleted)
	fromStatus, fromRevision := deletedEntry.Status, deletedEntry.Revision
	event := Event[T]{
		Entry: deletedEntry, Action: ActionDeleted, FromStatus: &fromStatus, FromRevision: &fromRevision,
		ActorID: actor.ID(), RequestID: actor.RequestID(), Payload: payload,
	}
	return c.recordAndPublish(ctx, tx, event, when)
}

func (c *Coordinator[T]) DeleteDraftVersion(ctx context.Context, tx pgx.Tx, entryID string, expectedRevision int64, actor Actor, payload T) error {
	entry, err := c.Lock(ctx, tx, entryID, expectedRevision, actor, ActionDeleted)
	if err != nil {
		return err
	}
	if entry.VersionNo == nil {
		return newError(ErrorConflict, "approval_not_versioned", "approval entry is not versioned", nil)
	}
	if entry.Status != StatusDraft {
		return newError(ErrorConflict, "approval_invalid_transition", "only a draft approval version can be deleted", nil)
	}
	previousApprovedVersionID, err := c.latestApprovedVersionID(ctx, tx, entry)
	if err != nil {
		return err
	}
	when := c.timestamp()
	deleted, err := dbsqlc.New(tx).DeleteApprovalEntry(ctx, dbsqlc.DeleteApprovalEntryParams{
		ID: entry.ID, Domain: c.domain, Entity: c.entity, ExpectedRevision: entry.Revision,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return newError(ErrorConflict, "approval_stale_revision", "approval entry changed", err)
	}
	if err != nil {
		return c.databaseError("delete approval version", err)
	}
	deletedEntry := entryFromRow(deleted)
	currentApprovedVersionID, err := c.latestApprovedVersionID(ctx, tx, deletedEntry)
	if err != nil {
		return err
	}
	fromStatus, fromRevision := deletedEntry.Status, deletedEntry.Revision
	event := Event[T]{
		Entry: deletedEntry, VersionNo: deletedEntry.VersionNo, Action: ActionDeleted,
		FromStatus: &fromStatus, FromRevision: &fromRevision,
		ActorID: actor.ID(), RequestID: actor.RequestID(), Payload: payload,
		PreviousApprovedVersionID: previousApprovedVersionID,
		CurrentApprovedVersionID:  currentApprovedVersionID,
	}
	return c.recordAndPublish(ctx, tx, event, when)
}

func (c *Coordinator[T]) prepareAndCommit(ctx context.Context, tx pgx.Tx, action Action, entryID string, expectedRevision int64, actor Actor, reason string, payload T) (Entry, error) {
	prepared, err := c.Prepare(ctx, tx, action, entryID, expectedRevision, actor, reason)
	if err != nil {
		return Entry{}, err
	}
	return c.Commit(ctx, tx, prepared, payload)
}

func (c *Coordinator[T]) recordAndPublish(ctx context.Context, tx pgx.Tx, event Event[T], when time.Time) error {
	event.VersionNo = event.Entry.VersionNo
	params := dbsqlc.InsertApprovalEventParams{
		ID: c.newID(), EntryID: event.Entry.ID, Domain: event.Entry.Domain, Entity: event.Entry.Entity,
		SubjectID: event.Entry.SubjectID, VersionNo: event.Entry.VersionNo, Action: string(event.Action),
		FromStatus: statusString(event.FromStatus), ToStatus: statusString(event.ToStatus),
		FromRevision: event.FromRevision, ToRevision: event.ToRevision,
		ActorID: event.ActorID, Reason: event.Reason, RequestID: event.RequestID, CreatedAt: timestamp(when),
	}
	if err := dbsqlc.New(tx).InsertApprovalEvent(ctx, params); err != nil {
		return c.databaseError("record approval event", err)
	}
	if err := c.topic.Publish(ctx, c.bus, tx, event); err != nil {
		return newError(ErrorInternal, "approval_event_delivery_failed", "approval event delivery failed", err)
	}
	return nil
}

func (c *Coordinator[T]) authorize(ctx context.Context, actor Actor, action string) error {
	if strings.TrimSpace(actor.ID()) == "" || strings.TrimSpace(actor.RequestID()) == "" {
		return newError(ErrorValidation, "approval_invalid_actor", "invalid approval actor", nil)
	}
	if actor.Trusted() {
		return nil
	}
	path := fmt.Sprintf("/%s/%s/%s", c.domain, c.entity, action)
	if err := c.authorizer.RequirePermission(ctx, actor.principal, path, actor.RequestID()); err != nil {
		return newError(ErrorForbidden, "forbidden", "approval permission denied", err)
	}
	return nil
}

func (c *Coordinator[T]) timestamp() time.Time {
	return c.now().UTC().Truncate(time.Microsecond)
}

func (c *Coordinator[T]) databaseError(operation string, err error) error {
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && (pgErr.Code == "23505" || pgErr.Code == "23514" || pgErr.Code == "23P01") {
		if pgErr.ConstraintName == "approval_entries_open_version_unique" {
			return newError(ErrorConflict, "approval_open_version_exists", "an open approval version already exists", err)
		}
		if pgErr.ConstraintName == "approval_entries_version_unique" {
			return newError(ErrorConflict, "approval_version_number_conflict", "approval version number conflicts", err)
		}
		return newError(ErrorConflict, "approval_conflict", "approval data conflict", err)
	}
	return newError(ErrorInternal, "internal_error", "internal server error", fmt.Errorf("%s: %w", operation, err))
}

func validateCall(tx pgx.Tx, value string, actor Actor) error {
	if tx == nil || strings.TrimSpace(value) == "" || strings.TrimSpace(actor.ID()) == "" || strings.TrimSpace(actor.RequestID()) == "" {
		return newError(ErrorValidation, "approval_invalid_request", "invalid approval request", nil)
	}
	return nil
}

func permissionAction(action Action) (string, bool) {
	switch action {
	case ActionSaved:
		return "save", true
	case ActionSubmitted:
		return "submit", true
	case ActionUnsubmitted:
		return "unsubmit", true
	case ActionRejected:
		return "reject", true
	case ActionApproved:
		return "approve", true
	case ActionUnapproved:
		return "unapprove", true
	case ActionDeleted:
		return "delete", true
	default:
		return "", false
	}
}

func transitionAllowed(status Status, action Action) bool {
	switch action {
	case ActionSaved, ActionSubmitted:
		return status == StatusDraft
	case ActionUnsubmitted, ActionRejected, ActionApproved:
		return status == StatusPending
	case ActionUnapproved:
		return status == StatusApproved
	default:
		return false
	}
}

func transitionMetadata(prepared Prepared, when time.Time) (Status, *string, *time.Time, *string, *time.Time) {
	entry := prepared.entry
	status := entry.Status
	submittedBy, submittedAt := entry.SubmittedBy, entry.SubmittedAt
	approvedBy, approvedAt := entry.ApprovedBy, entry.ApprovedAt
	switch prepared.action {
	case ActionSaved:
	case ActionSubmitted:
		status = StatusPending
		submittedBy, submittedAt = stringPointer(prepared.actor.ID()), timePointer(when)
	case ActionUnsubmitted, ActionRejected:
		status = StatusDraft
		submittedBy, submittedAt, approvedBy, approvedAt = nil, nil, nil, nil
	case ActionApproved:
		status = StatusApproved
		approvedBy, approvedAt = stringPointer(prepared.actor.ID()), timePointer(when)
	case ActionUnapproved:
		status = StatusPending
		approvedBy, approvedAt = nil, nil
	}
	return status, submittedBy, submittedAt, approvedBy, approvedAt
}

func entryFromRow(row dbsqlc.ApprovalEntry) Entry {
	return Entry{
		EntryRef: EntryRef{ID: row.ID, Domain: row.Domain, Entity: row.Entity, SubjectID: row.SubjectID, VersionNo: row.VersionNo},
		Status:   Status(row.Status), Revision: row.Revision, CreatedBy: row.CreatedBy, CreatedAt: row.CreatedAt.Time,
		UpdatedBy: row.UpdatedBy, UpdatedAt: row.UpdatedAt.Time, SubmittedBy: row.SubmittedBy,
		SubmittedAt: timeFromTimestamp(row.SubmittedAt), ApprovedBy: row.ApprovedBy, ApprovedAt: timeFromTimestamp(row.ApprovedAt),
	}
}

func timestamp(value time.Time) pgtype.Timestamptz {
	return pgtype.Timestamptz{Time: value, Valid: true}
}

func optionalTimestamp(value *time.Time) pgtype.Timestamptz {
	if value == nil {
		return pgtype.Timestamptz{}
	}
	return timestamp(*value)
}

func timeFromTimestamp(value pgtype.Timestamptz) *time.Time {
	if !value.Valid {
		return nil
	}
	result := value.Time
	return &result
}

func statusString(value *Status) *string {
	if value == nil {
		return nil
	}
	result := string(*value)
	return &result
}

func stringPointer(value string) *string     { return &value }
func int32Pointer(value int32) *int32        { return &value }
func timePointer(value time.Time) *time.Time { return &value }

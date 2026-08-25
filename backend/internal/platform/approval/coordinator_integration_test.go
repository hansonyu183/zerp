//go:build integration

package approval

import (
	"context"
	"errors"
	"fmt"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/hansonyu183/zerp/backend/internal/api/authorization"
	"github.com/hansonyu183/zerp/backend/internal/platform/txevent"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/oklog/ulid/v2"
)

type fixturePayload struct {
	SubjectID string
	Name      string
	Failure   string
}

type integrationAuthorizer struct {
	deniedPath string
	paths      []string
}

func (a *integrationAuthorizer) RequirePermission(_ context.Context, _ authorization.Principal, path, _ string) error {
	a.paths = append(a.paths, path)
	if path == a.deniedPath {
		return authorization.NewError(authorization.ErrorForbidden, "forbidden", nil)
	}
	return nil
}

func approvalIntegrationPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	databaseURL := strings.TrimSpace(os.Getenv("TEST_DATABASE_URL"))
	databaseName := strings.TrimSpace(os.Getenv("TEST_POSTGRES_DB"))
	if databaseURL == "" || databaseName == "" || !strings.HasSuffix(databaseName, "_test") {
		t.Fatal("safe TEST_DATABASE_URL and TEST_POSTGRES_DB ending in _test are required")
	}
	pool, err := pgxpool.New(t.Context(), databaseURL)
	if err != nil {
		t.Fatalf("connect approval integration database: %v", err)
	}
	t.Cleanup(pool.Close)
	var currentDatabase string
	if err = pool.QueryRow(t.Context(), "select current_database()").Scan(&currentDatabase); err != nil {
		t.Fatalf("read current database: %v", err)
	}
	if currentDatabase != databaseName {
		t.Fatalf("connected database %q does not match %q", currentDatabase, databaseName)
	}
	return pool
}

func resetApprovalIntegrationData(t *testing.T, pool *pgxpool.Pool) {
	t.Helper()
	_, err := pool.Exec(t.Context(), `
		CREATE TABLE IF NOT EXISTS approval_fixture_subjects (
			id varchar(128) PRIMARY KEY,
			name varchar(200) NOT NULL
		);
		CREATE TABLE IF NOT EXISTS approval_fixture_effects (
			id varchar(26) PRIMARY KEY,
			subject_id varchar(128) NOT NULL,
			action varchar(16) NOT NULL
		);
		TRUNCATE approval_fixture_effects, approval_fixture_subjects, approval_events, approval_entries;
	`)
	if err != nil {
		t.Fatalf("reset approval integration data: %v", err)
	}
}

func integrationActor(t *testing.T, actorID, requestID string) Actor {
	t.Helper()
	actor, err := UserActor(authorization.Principal{ActorID: actorID}, requestID)
	if err != nil {
		t.Fatalf("create actor: %v", err)
	}
	return actor
}

func inTransaction(t *testing.T, pool *pgxpool.Pool, operation func(pgx.Tx) error) error {
	t.Helper()
	tx, err := pool.Begin(t.Context())
	if err != nil {
		t.Fatalf("begin transaction: %v", err)
	}
	defer func() { _ = tx.Rollback(context.Background()) }()
	if err = operation(tx); err != nil {
		return err
	}
	if err = tx.Commit(t.Context()); err != nil {
		t.Fatalf("commit transaction: %v", err)
	}
	return nil
}

func createFixtureSubject(
	t *testing.T,
	pool *pgxpool.Pool,
	coordinator *Coordinator[fixturePayload],
	subjectID string,
	actor Actor,
	payload fixturePayload,
) (Entry, error) {
	t.Helper()
	var entry Entry
	err := inTransaction(t, pool, func(tx pgx.Tx) error {
		if _, err := tx.Exec(t.Context(), `INSERT INTO approval_fixture_subjects(id, name) VALUES($1, $2)`, subjectID, payload.Name); err != nil {
			return err
		}
		var err error
		entry, err = coordinator.CreateSubject(t.Context(), tx, subjectID, actor, payload)
		return err
	})
	return entry, err
}

func mutateEntry(
	t *testing.T,
	pool *pgxpool.Pool,
	operation func(pgx.Tx) (Entry, error),
) (Entry, error) {
	t.Helper()
	var entry Entry
	err := inTransaction(t, pool, func(tx pgx.Tx) error {
		var err error
		entry, err = operation(tx)
		return err
	})
	return entry, err
}

func TestApprovalPersistenceLifecycleIntegration(t *testing.T) {
	pool := approvalIntegrationPool(t)
	resetApprovalIntegrationData(t, pool)

	authorizer := &integrationAuthorizer{}
	bus := txevent.NewBus()
	topic := MustTopic[fixturePayload]("approval.fixture-subject.lifecycle")
	coordinator, err := NewCoordinator("fixture", "subject", authorizer, bus, topic)
	if err != nil {
		t.Fatalf("new coordinator: %v", err)
	}
	currentTime := time.Date(2026, 8, 25, 1, 0, 0, 0, time.UTC)
	coordinator.now = func() time.Time {
		currentTime = currentTime.Add(time.Minute)
		return currentTime
	}

	if err = topic.Subscribe(bus, "fixture-effect", func(ctx context.Context, tx pgx.Tx, event Event[fixturePayload]) error {
		if event.Payload.Failure == "" {
			return nil
		}
		if _, writeErr := tx.Exec(ctx, `
			INSERT INTO approval_fixture_effects(id, subject_id, action)
			VALUES($1, $2, $3)
		`, ulid.Make().String(), event.Payload.SubjectID, event.Action); writeErr != nil {
			return writeErr
		}
		switch event.Payload.Failure {
		case "error":
			return errors.New("fixture subscriber rejected")
		case "panic":
			panic("fixture subscriber panic")
		default:
			return nil
		}
	}); err != nil {
		t.Fatalf("subscribe fixture effect: %v", err)
	}

	actorOneID, actorTwoID := ulid.Make().String(), ulid.Make().String()
	actorOne := func(request string) Actor { return integrationActor(t, actorOneID, request) }
	actorTwo := func(request string) Actor { return integrationActor(t, actorTwoID, request) }

	t.Run("lifecycle authorization revision metadata and audit", func(t *testing.T) {
		subjectID := ulid.Make().String()
		payload := fixturePayload{SubjectID: subjectID, Name: "Lifecycle subject"}
		entry, createErr := createFixtureSubject(t, pool, coordinator, subjectID, actorOne("create"), payload)
		if createErr != nil {
			t.Fatalf("create subject: %v", createErr)
		}
		if entry.Status != StatusDraft || entry.Revision != 1 || entry.VersionNo != nil || entry.CreatedBy != actorOneID || entry.UpdatedBy != actorOneID || !entry.CreatedAt.Equal(entry.UpdatedAt) {
			t.Fatalf("created entry = %+v", entry)
		}
		if getErr := inTransaction(t, pool, func(tx pgx.Tx) error {
			got, err := coordinator.Get(t.Context(), tx, entry.ID, actorOne("get"))
			if err == nil && (got.ID != entry.ID || got.Revision != entry.Revision) {
				return fmt.Errorf("get entry = %+v, want id=%s revision=%d", got, entry.ID, entry.Revision)
			}
			return err
		}); getErr != nil {
			t.Fatalf("get approval entry: %v", getErr)
		}

		entry, err = mutateEntry(t, pool, func(tx pgx.Tx) (Entry, error) {
			return coordinator.SaveDraft(t.Context(), tx, entry.ID, entry.Revision, actorOne("save"), payload)
		})
		if err != nil || entry.Revision != 2 || entry.Status != StatusDraft {
			t.Fatalf("save draft = %+v, err = %v", entry, err)
		}
		if _, staleErr := mutateEntry(t, pool, func(tx pgx.Tx) (Entry, error) {
			return coordinator.SaveDraft(t.Context(), tx, entry.ID, 1, actorOne("stale"), payload)
		}); !IsKey(staleErr, "approval_stale_revision") {
			t.Fatalf("stale revision error = %v", staleErr)
		}
		if _, invalidErr := mutateEntry(t, pool, func(tx pgx.Tx) (Entry, error) {
			return coordinator.Approve(t.Context(), tx, entry.ID, entry.Revision, actorTwo("approve-draft"), payload)
		}); !IsKey(invalidErr, "approval_invalid_transition") {
			t.Fatalf("approve draft error = %v", invalidErr)
		}

		entry, err = mutateEntry(t, pool, func(tx pgx.Tx) (Entry, error) {
			prepared, prepareErr := coordinator.Prepare(t.Context(), tx, ActionSubmitted, entry.ID, entry.Revision, actorOne("submit-1"), "")
			if prepareErr != nil {
				return Entry{}, prepareErr
			}
			if _, updateErr := tx.Exec(t.Context(), `UPDATE approval_fixture_subjects SET name=$2 WHERE id=$1`, subjectID, "Validated payload"); updateErr != nil {
				return Entry{}, updateErr
			}
			payload.Name = "Validated payload"
			return coordinator.Commit(t.Context(), tx, prepared, payload)
		})
		if err != nil || entry.Status != StatusPending || entry.Revision != 3 || entry.SubmittedBy == nil || *entry.SubmittedBy != actorOneID || entry.SubmittedAt == nil || !entry.SubmittedAt.Equal(entry.UpdatedAt) || entry.ApprovedBy != nil || entry.ApprovedAt != nil {
			t.Fatalf("submit entry = %+v, err = %v", entry, err)
		}
		if _, selfErr := mutateEntry(t, pool, func(tx pgx.Tx) (Entry, error) {
			return coordinator.Approve(t.Context(), tx, entry.ID, entry.Revision, actorOne("self-approve"), payload)
		}); !IsKey(selfErr, "approval_self_approval_forbidden") {
			t.Fatalf("self approval error = %v", selfErr)
		}
		if _, reasonErr := mutateEntry(t, pool, func(tx pgx.Tx) (Entry, error) {
			return coordinator.Reject(t.Context(), tx, entry.ID, entry.Revision, actorTwo("reject-no-reason"), "  ", payload)
		}); !IsKey(reasonErr, "approval_reason_required") {
			t.Fatalf("missing reject reason error = %v", reasonErr)
		}

		entry, err = mutateEntry(t, pool, func(tx pgx.Tx) (Entry, error) {
			return coordinator.Unsubmit(t.Context(), tx, entry.ID, entry.Revision, actorOne("unsubmit"), payload)
		})
		if err != nil || entry.Status != StatusDraft || entry.Revision != 4 || entry.SubmittedBy != nil || entry.SubmittedAt != nil {
			t.Fatalf("unsubmit entry = %+v, err = %v", entry, err)
		}
		entry, err = mutateEntry(t, pool, func(tx pgx.Tx) (Entry, error) {
			return coordinator.Submit(t.Context(), tx, entry.ID, entry.Revision, actorOne("submit-2"), payload)
		})
		if err != nil {
			t.Fatalf("second submit: %v", err)
		}
		entry, err = mutateEntry(t, pool, func(tx pgx.Tx) (Entry, error) {
			return coordinator.Reject(t.Context(), tx, entry.ID, entry.Revision, actorTwo("reject"), "needs correction", payload)
		})
		if err != nil || entry.Status != StatusDraft || entry.Revision != 6 || entry.SubmittedBy != nil {
			t.Fatalf("reject entry = %+v, err = %v", entry, err)
		}
		entry, err = mutateEntry(t, pool, func(tx pgx.Tx) (Entry, error) {
			return coordinator.Submit(t.Context(), tx, entry.ID, entry.Revision, actorOne("submit-3"), payload)
		})
		if err != nil {
			t.Fatalf("third submit: %v", err)
		}
		submittedAt := *entry.SubmittedAt
		entry, err = mutateEntry(t, pool, func(tx pgx.Tx) (Entry, error) {
			return coordinator.Approve(t.Context(), tx, entry.ID, entry.Revision, actorTwo("approve"), payload)
		})
		if err != nil || entry.Status != StatusApproved || entry.Revision != 8 || entry.ApprovedBy == nil || *entry.ApprovedBy != actorTwoID || entry.ApprovedAt == nil || !entry.ApprovedAt.Equal(entry.UpdatedAt) || entry.SubmittedAt == nil || !entry.SubmittedAt.Equal(submittedAt) {
			t.Fatalf("approve entry = %+v, err = %v", entry, err)
		}
		if _, reasonErr := mutateEntry(t, pool, func(tx pgx.Tx) (Entry, error) {
			return coordinator.Unapprove(t.Context(), tx, entry.ID, entry.Revision, actorOne("unapprove-no-reason"), "", payload)
		}); !IsKey(reasonErr, "approval_reason_required") {
			t.Fatalf("missing unapprove reason error = %v", reasonErr)
		}
		entry, err = mutateEntry(t, pool, func(tx pgx.Tx) (Entry, error) {
			return coordinator.Unapprove(t.Context(), tx, entry.ID, entry.Revision, actorOne("unapprove"), "business correction", payload)
		})
		if err != nil || entry.Status != StatusPending || entry.Revision != 9 || entry.ApprovedBy != nil || entry.ApprovedAt != nil || entry.SubmittedBy == nil || *entry.SubmittedBy != actorOneID || entry.SubmittedAt == nil || !entry.SubmittedAt.Equal(submittedAt) {
			t.Fatalf("unapprove entry = %+v, err = %v", entry, err)
		}

		authorizer.deniedPath = "/fixture/subject/approve"
		if _, deniedErr := mutateEntry(t, pool, func(tx pgx.Tx) (Entry, error) {
			return coordinator.Approve(t.Context(), tx, entry.ID, entry.Revision, actorTwo("denied"), payload)
		}); !IsKind(deniedErr, ErrorForbidden) || !IsKey(deniedErr, "forbidden") {
			t.Fatalf("permission error = %v", deniedErr)
		}
		authorizer.deniedPath = ""
		if got := authorizer.paths[len(authorizer.paths)-1]; got != "/fixture/subject/approve" {
			t.Fatalf("derived permission path = %q", got)
		}

		var actions []string
		rows, queryErr := pool.Query(t.Context(), `SELECT action FROM approval_events WHERE entry_id=$1 ORDER BY created_at, id`, entry.ID)
		if queryErr != nil {
			t.Fatalf("query audit events: %v", queryErr)
		}
		for rows.Next() {
			var action string
			if scanErr := rows.Scan(&action); scanErr != nil {
				t.Fatalf("scan audit action: %v", scanErr)
			}
			actions = append(actions, action)
		}
		rows.Close()
		if got, want := fmt.Sprint(actions), "[CREATED SAVED SUBMITTED UNSUBMITTED SUBMITTED REJECTED SUBMITTED APPROVED UNAPPROVED]"; got != want {
			t.Fatalf("audit actions = %s, want %s", got, want)
		}
		var rejectReason, unapproveReason string
		if queryErr = pool.QueryRow(t.Context(), `SELECT reason FROM approval_events WHERE entry_id=$1 AND action='REJECTED'`, entry.ID).Scan(&rejectReason); queryErr != nil || rejectReason != "needs correction" {
			t.Fatalf("reject audit reason = %q, err = %v", rejectReason, queryErr)
		}
		if queryErr = pool.QueryRow(t.Context(), `SELECT reason FROM approval_events WHERE entry_id=$1 AND action='UNAPPROVED'`, entry.ID).Scan(&unapproveReason); queryErr != nil || unapproveReason != "business correction" {
			t.Fatalf("unapprove audit reason = %q, err = %v", unapproveReason, queryErr)
		}
	})

	t.Run("approval-only uniqueness and trusted system invariants", func(t *testing.T) {
		subjectID := ulid.Make().String()
		payload := fixturePayload{SubjectID: subjectID, Name: "Unique subject"}
		entry, createErr := createFixtureSubject(t, pool, coordinator, subjectID, actorOne("unique-create"), payload)
		if createErr != nil {
			t.Fatalf("create unique subject: %v", createErr)
		}
		if _, duplicateErr := mutateEntry(t, pool, func(tx pgx.Tx) (Entry, error) {
			return coordinator.CreateSubject(t.Context(), tx, subjectID, actorOne("duplicate-create"), payload)
		}); !IsKey(duplicateErr, "approval_conflict") {
			t.Fatalf("approval-only uniqueness error = %v", duplicateErr)
		}
		var versionNo *int32
		if err = pool.QueryRow(t.Context(), `SELECT version_no FROM approval_entries WHERE id=$1`, entry.ID).Scan(&versionNo); err != nil || versionNo != nil {
			t.Fatalf("approval-only version_no = %v, err = %v", versionNo, err)
		}

		trusted, actorErr := TrustedSystemActor("system-save")
		if actorErr != nil {
			t.Fatalf("trusted actor: %v", actorErr)
		}
		authorizer.deniedPath = "/fixture/subject/save"
		entry, err = mutateEntry(t, pool, func(tx pgx.Tx) (Entry, error) {
			return coordinator.SaveDraft(t.Context(), tx, entry.ID, entry.Revision, trusted, payload)
		})
		authorizer.deniedPath = ""
		if err != nil || entry.Revision != 2 {
			t.Fatalf("trusted save = %+v, err = %v", entry, err)
		}
		if _, invalidErr := mutateEntry(t, pool, func(tx pgx.Tx) (Entry, error) {
			return coordinator.Approve(t.Context(), tx, entry.ID, entry.Revision, trusted, payload)
		}); !IsKey(invalidErr, "approval_invalid_transition") {
			t.Fatalf("trusted actor bypassed lifecycle: %v", invalidErr)
		}
	})

	t.Run("subscriber error and panic roll back approval and subscriber writes", func(t *testing.T) {
		for _, failure := range []string{"error", "panic"} {
			t.Run(failure, func(t *testing.T) {
				subjectID := ulid.Make().String()
				payload := fixturePayload{SubjectID: subjectID, Name: "Rollback " + failure}
				entry, createErr := createFixtureSubject(t, pool, coordinator, subjectID, actorOne("rollback-create-"+failure), payload)
				if createErr != nil {
					t.Fatalf("create rollback subject: %v", createErr)
				}
				entry, err = mutateEntry(t, pool, func(tx pgx.Tx) (Entry, error) {
					return coordinator.Submit(t.Context(), tx, entry.ID, entry.Revision, actorOne("rollback-submit-"+failure), payload)
				})
				if err != nil {
					t.Fatalf("submit rollback subject: %v", err)
				}
				failingPayload := payload
				failingPayload.Failure = failure
				if _, approvalErr := mutateEntry(t, pool, func(tx pgx.Tx) (Entry, error) {
					return coordinator.Approve(t.Context(), tx, entry.ID, entry.Revision, actorTwo("rollback-approve-"+failure), failingPayload)
				}); !IsKey(approvalErr, "approval_event_delivery_failed") {
					t.Fatalf("subscriber %s error = %v", failure, approvalErr)
				}
				var status string
				var revision, effects, approvals int64
				if err = pool.QueryRow(t.Context(), `SELECT status, revision FROM approval_entries WHERE id=$1`, entry.ID).Scan(&status, &revision); err != nil {
					t.Fatalf("read rolled back entry: %v", err)
				}
				if err = pool.QueryRow(t.Context(), `SELECT count(*) FROM approval_fixture_effects WHERE subject_id=$1`, subjectID).Scan(&effects); err != nil {
					t.Fatalf("count rolled back effects: %v", err)
				}
				if err = pool.QueryRow(t.Context(), `SELECT count(*) FROM approval_events WHERE entry_id=$1 AND action='APPROVED'`, entry.ID).Scan(&approvals); err != nil {
					t.Fatalf("count rolled back approvals: %v", err)
				}
				if status != "PENDING" || revision != entry.Revision || effects != 0 || approvals != 0 {
					t.Fatalf("rollback status=%s revision=%d effects=%d approvals=%d", status, revision, effects, approvals)
				}
			})
		}
	})

	t.Run("domain subject and entry create delete atomically without orphan", func(t *testing.T) {
		failedCreateID := ulid.Make().String()
		failedPayload := fixturePayload{SubjectID: failedCreateID, Name: "Failed create", Failure: "error"}
		if _, createErr := createFixtureSubject(t, pool, coordinator, failedCreateID, actorOne("atomic-create-failure"), failedPayload); !IsKey(createErr, "approval_event_delivery_failed") {
			t.Fatalf("atomic create failure = %v", createErr)
		}
		var subjects, entries, effects int64
		if err = pool.QueryRow(t.Context(), `SELECT count(*) FROM approval_fixture_subjects WHERE id=$1`, failedCreateID).Scan(&subjects); err != nil {
			t.Fatalf("count failed subjects: %v", err)
		}
		if err = pool.QueryRow(t.Context(), `SELECT count(*) FROM approval_entries WHERE domain='fixture' AND entity='subject' AND subject_id=$1`, failedCreateID).Scan(&entries); err != nil {
			t.Fatalf("count failed entries: %v", err)
		}
		if err = pool.QueryRow(t.Context(), `SELECT count(*) FROM approval_fixture_effects WHERE subject_id=$1`, failedCreateID).Scan(&effects); err != nil {
			t.Fatalf("count failed effects: %v", err)
		}
		if subjects != 0 || entries != 0 || effects != 0 {
			t.Fatalf("failed create left subjects=%d entries=%d effects=%d", subjects, entries, effects)
		}

		subjectID := ulid.Make().String()
		payload := fixturePayload{SubjectID: subjectID, Name: "Atomic delete"}
		entry, createErr := createFixtureSubject(t, pool, coordinator, subjectID, actorOne("atomic-create"), payload)
		if createErr != nil {
			t.Fatalf("create atomic subject: %v", createErr)
		}
		failingDelete := payload
		failingDelete.Failure = "error"
		deleteErr := inTransaction(t, pool, func(tx pgx.Tx) error {
			return coordinator.DeleteSubject(t.Context(), tx, entry.ID, entry.Revision, actorOne("atomic-delete-failure"), failingDelete)
		})
		if !IsKey(deleteErr, "approval_event_delivery_failed") {
			t.Fatalf("atomic delete failure = %v", deleteErr)
		}
		if err = pool.QueryRow(t.Context(), `SELECT count(*) FROM approval_fixture_subjects WHERE id=$1`, subjectID).Scan(&subjects); err != nil {
			t.Fatalf("count preserved subject: %v", err)
		}
		if err = pool.QueryRow(t.Context(), `SELECT count(*) FROM approval_entries WHERE id=$1`, entry.ID).Scan(&entries); err != nil {
			t.Fatalf("count preserved entry: %v", err)
		}
		if subjects != 1 || entries != 1 {
			t.Fatalf("failed delete preserved subjects=%d entries=%d", subjects, entries)
		}

		if deleteErr = inTransaction(t, pool, func(tx pgx.Tx) error {
			if err := coordinator.DeleteSubject(t.Context(), tx, entry.ID, entry.Revision, actorOne("atomic-delete"), payload); err != nil {
				return err
			}
			command, err := tx.Exec(t.Context(), `DELETE FROM approval_fixture_subjects WHERE id=$1`, subjectID)
			if err != nil {
				return err
			}
			if command.RowsAffected() != 1 {
				return errors.New("fixture subject changed before delete")
			}
			return nil
		}); deleteErr != nil {
			t.Fatalf("delete subject and entry: %v", deleteErr)
		}
		var orphans int64
		if err = pool.QueryRow(t.Context(), `
			SELECT count(*)
			FROM approval_entries entry
			LEFT JOIN approval_fixture_subjects subject ON subject.id=entry.subject_id
			WHERE entry.domain='fixture' AND entry.entity='subject' AND subject.id IS NULL
		`).Scan(&orphans); err != nil {
			t.Fatalf("count approval orphans: %v", err)
		}
		if orphans != 0 {
			t.Fatalf("approval orphan count = %d", orphans)
		}
		var deletedEvents int64
		if err = pool.QueryRow(t.Context(), `SELECT count(*) FROM approval_events WHERE entry_id=$1 AND action='DELETED'`, entry.ID).Scan(&deletedEvents); err != nil || deletedEvents != 1 {
			t.Fatalf("deleted audit events = %d, err = %v", deletedEvents, err)
		}
	})

	t.Run("first version becomes latest approved", func(t *testing.T) {
		subjectID := ulid.Make().String()
		payload := fixturePayload{SubjectID: subjectID, Name: "Versioned subject"}
		var events []Event[fixturePayload]
		versionBus := txevent.NewBus()
		versionTopic := MustTopic[fixturePayload]("approval.fixture-version.lifecycle")
		versionCoordinator, coordinatorErr := NewCoordinator("fixture", "version", authorizer, versionBus, versionTopic)
		if coordinatorErr != nil {
			t.Fatalf("new version coordinator: %v", coordinatorErr)
		}
		versionCoordinator.now = coordinator.now
		if subscribeErr := versionTopic.Subscribe(versionBus, "capture-version-events", func(_ context.Context, _ pgx.Tx, event Event[fixturePayload]) error {
			events = append(events, event)
			return nil
		}); subscribeErr != nil {
			t.Fatalf("subscribe version events: %v", subscribeErr)
		}

		var entry Entry
		createErr := inTransaction(t, pool, func(tx pgx.Tx) error {
			if _, insertErr := tx.Exec(t.Context(), `INSERT INTO approval_fixture_subjects(id, name) VALUES($1, $2)`, subjectID, payload.Name); insertErr != nil {
				return insertErr
			}
			var createVersionErr error
			entry, createVersionErr = versionCoordinator.CreateFirstVersion(t.Context(), tx, subjectID, actorOne("create-v1"), payload)
			return createVersionErr
		})
		if createErr != nil || entry.VersionNo == nil || *entry.VersionNo != 1 || entry.Status != StatusDraft {
			t.Fatalf("create first version = %+v, err = %v", entry, createErr)
		}

		entry, err = mutateEntry(t, pool, func(tx pgx.Tx) (Entry, error) {
			return versionCoordinator.Submit(t.Context(), tx, entry.ID, entry.Revision, actorOne("submit-v1"), payload)
		})
		if err != nil {
			t.Fatalf("submit first version: %v", err)
		}
		entry, err = mutateEntry(t, pool, func(tx pgx.Tx) (Entry, error) {
			return versionCoordinator.Approve(t.Context(), tx, entry.ID, entry.Revision, actorTwo("approve-v1"), payload)
		})
		if err != nil || entry.Status != StatusApproved {
			t.Fatalf("approve first version = %+v, err = %v", entry, err)
		}

		var latest Entry
		if latestErr := inTransaction(t, pool, func(tx pgx.Tx) error {
			var getErr error
			latest, getErr = versionCoordinator.GetLatestApproved(t.Context(), tx, subjectID, actorOne("latest-v1"))
			return getErr
		}); latestErr != nil || latest.ID != entry.ID {
			t.Fatalf("latest approved = %+v, err = %v", latest, latestErr)
		}
		approvedEvent := events[len(events)-1]
		if approvedEvent.VersionNo == nil || *approvedEvent.VersionNo != 1 || approvedEvent.PreviousApprovedVersionID != nil || approvedEvent.CurrentApprovedVersionID == nil || *approvedEvent.CurrentApprovedVersionID != entry.ID {
			t.Fatalf("approved version event = %+v", approvedEvent)
		}

		v1 := entry
		authorizer.deniedPath = "/fixture/version/save"
		if _, deniedErr := mutateEntry(t, pool, func(tx pgx.Tx) (Entry, error) {
			return versionCoordinator.CreateNextVersion(t.Context(), tx, subjectID, actorOne("denied-create-v2"), payload)
		}); !IsKind(deniedErr, ErrorForbidden) {
			t.Fatalf("create next version permission error = %v", deniedErr)
		}
		authorizer.deniedPath = ""
		var v2 Entry
		v2, err = mutateEntry(t, pool, func(tx pgx.Tx) (Entry, error) {
			return versionCoordinator.CreateNextVersion(t.Context(), tx, subjectID, actorOne("create-v2"), payload)
		})
		if err != nil || v2.VersionNo == nil || *v2.VersionNo != 2 || v2.Status != StatusDraft {
			t.Fatalf("create next version = %+v, err = %v", v2, err)
		}
		createdV2Event := events[len(events)-1]
		if createdV2Event.PreviousApprovedVersionID == nil || *createdV2Event.PreviousApprovedVersionID != v1.ID || createdV2Event.CurrentApprovedVersionID == nil || *createdV2Event.CurrentApprovedVersionID != v1.ID {
			t.Fatalf("created V2 event = %+v", createdV2Event)
		}

		var open Entry
		if openErr := inTransaction(t, pool, func(tx pgx.Tx) error {
			var getErr error
			open, getErr = versionCoordinator.GetOpenVersion(t.Context(), tx, subjectID, actorOne("open-v2"))
			return getErr
		}); openErr != nil || open.ID != v2.ID {
			t.Fatalf("open version = %+v, err = %v", open, openErr)
		}
		var versions []Entry
		if listErr := inTransaction(t, pool, func(tx pgx.Tx) error {
			var queryErr error
			versions, queryErr = versionCoordinator.ListVersions(t.Context(), tx, subjectID, actorOne("list-versions"))
			return queryErr
		}); listErr != nil || len(versions) != 2 || versions[0].ID != v2.ID || versions[1].ID != v1.ID {
			t.Fatalf("version history = %+v, err = %v", versions, listErr)
		}
		if got := authorizer.paths[len(authorizer.paths)-1]; got != "/fixture/version/versions" {
			t.Fatalf("version history permission path = %q", got)
		}

		if deleteErr := inTransaction(t, pool, func(tx pgx.Tx) error {
			return versionCoordinator.DeleteDraftVersion(t.Context(), tx, v2.ID, v2.Revision, actorOne("delete-v2"), payload)
		}); deleteErr != nil {
			t.Fatalf("delete V2 draft: %v", deleteErr)
		}
		v2, err = mutateEntry(t, pool, func(tx pgx.Tx) (Entry, error) {
			return versionCoordinator.CreateNextVersion(t.Context(), tx, subjectID, actorOne("reuse-v2"), payload)
		})
		if err != nil || v2.VersionNo == nil || *v2.VersionNo != 2 {
			t.Fatalf("reuse V2 = %+v, err = %v", v2, err)
		}

		if duplicateErr := inTransaction(t, pool, func(tx pgx.Tx) error {
			_, insertErr := tx.Exec(t.Context(), `
				INSERT INTO approval_entries(
					id, domain, entity, subject_id, version_no, status, revision,
					created_by, created_at, updated_by, updated_at
				) VALUES($1, 'fixture', 'version', $2, 2, 'DRAFT', 1, $3, now(), $3, now())
			`, ulid.Make().String(), subjectID, actorOneID)
			return insertErr
		}); duplicateErr == nil {
			t.Fatal("duplicate version number was accepted")
		}

		v2, err = mutateEntry(t, pool, func(tx pgx.Tx) (Entry, error) {
			return versionCoordinator.Submit(t.Context(), tx, v2.ID, v2.Revision, actorOne("submit-v2"), payload)
		})
		if err != nil {
			t.Fatalf("submit V2: %v", err)
		}
		v2, err = mutateEntry(t, pool, func(tx pgx.Tx) (Entry, error) {
			return versionCoordinator.Approve(t.Context(), tx, v2.ID, v2.Revision, actorTwo("approve-v2"), payload)
		})
		if err != nil {
			t.Fatalf("approve V2: %v", err)
		}
		if nonLatestErr := inTransaction(t, pool, func(tx pgx.Tx) error {
			_, unapproveErr := versionCoordinator.Unapprove(t.Context(), tx, v1.ID, v1.Revision, actorOne("unapprove-v1-too-early"), "not latest", payload)
			return unapproveErr
		}); !IsKey(nonLatestErr, "approval_not_latest_approved") {
			t.Fatalf("non-latest unapprove error = %v", nonLatestErr)
		}

		v2, err = mutateEntry(t, pool, func(tx pgx.Tx) (Entry, error) {
			return versionCoordinator.Unapprove(t.Context(), tx, v2.ID, v2.Revision, actorOne("unapprove-v2"), "return to V1", payload)
		})
		if err != nil || v2.Status != StatusPending {
			t.Fatalf("unapprove V2 = %+v, err = %v", v2, err)
		}
		unapprovedV2Event := events[len(events)-1]
		if unapprovedV2Event.PreviousApprovedVersionID == nil || *unapprovedV2Event.PreviousApprovedVersionID != v2.ID || unapprovedV2Event.CurrentApprovedVersionID == nil || *unapprovedV2Event.CurrentApprovedVersionID != v1.ID {
			t.Fatalf("unapproved V2 event = %+v", unapprovedV2Event)
		}
		if latestErr := inTransaction(t, pool, func(tx pgx.Tx) error {
			var getErr error
			latest, getErr = versionCoordinator.GetLatestApproved(t.Context(), tx, subjectID, actorOne("latest-v1-again"))
			return getErr
		}); latestErr != nil || latest.ID != v1.ID {
			t.Fatalf("fallback latest approved = %+v, err = %v", latest, latestErr)
		}

		v2, err = mutateEntry(t, pool, func(tx pgx.Tx) (Entry, error) {
			return versionCoordinator.Unsubmit(t.Context(), tx, v2.ID, v2.Revision, actorOne("unsubmit-v2"), payload)
		})
		if err != nil {
			t.Fatalf("unsubmit V2: %v", err)
		}
		if deleteErr := inTransaction(t, pool, func(tx pgx.Tx) error {
			return versionCoordinator.DeleteDraftVersion(t.Context(), tx, v2.ID, v2.Revision, actorOne("delete-v2-again"), payload)
		}); deleteErr != nil {
			t.Fatalf("delete V2 again: %v", deleteErr)
		}
		v1, err = mutateEntry(t, pool, func(tx pgx.Tx) (Entry, error) {
			return versionCoordinator.Unapprove(t.Context(), tx, v1.ID, v1.Revision, actorOne("unapprove-v1"), "no formal version", payload)
		})
		if err != nil || v1.Status != StatusPending {
			t.Fatalf("unapprove V1 = %+v, err = %v", v1, err)
		}
		unapprovedV1Event := events[len(events)-1]
		if unapprovedV1Event.PreviousApprovedVersionID == nil || *unapprovedV1Event.PreviousApprovedVersionID != v1.ID || unapprovedV1Event.CurrentApprovedVersionID != nil {
			t.Fatalf("unapproved V1 event = %+v", unapprovedV1Event)
		}
		if latestErr := inTransaction(t, pool, func(tx pgx.Tx) error {
			_, getErr := versionCoordinator.GetLatestApproved(t.Context(), tx, subjectID, actorOne("latest-none"))
			return getErr
		}); !IsKey(latestErr, "approval_version_not_found") {
			t.Fatalf("missing latest approved error = %v", latestErr)
		}
	})

	t.Run("concurrent candidates leave exactly one open version", func(t *testing.T) {
		subjectID := ulid.Make().String()
		payload := fixturePayload{SubjectID: subjectID, Name: "Concurrent versioned subject"}
		versionBus := txevent.NewBus()
		versionTopic := MustTopic[fixturePayload]("approval.concurrent-version.lifecycle")
		versionCoordinator, coordinatorErr := NewCoordinator("fixture", "concurrent-version", allowAuthorizer{}, versionBus, versionTopic)
		if coordinatorErr != nil {
			t.Fatalf("new concurrent version coordinator: %v", coordinatorErr)
		}
		var v1 Entry
		if createErr := inTransaction(t, pool, func(tx pgx.Tx) error {
			if _, insertErr := tx.Exec(t.Context(), `INSERT INTO approval_fixture_subjects(id, name) VALUES($1, $2)`, subjectID, payload.Name); insertErr != nil {
				return insertErr
			}
			var versionErr error
			v1, versionErr = versionCoordinator.CreateFirstVersion(t.Context(), tx, subjectID, actorOne("concurrent-create-v1"), payload)
			return versionErr
		}); createErr != nil {
			t.Fatalf("create concurrent V1: %v", createErr)
		}
		v1, err = mutateEntry(t, pool, func(tx pgx.Tx) (Entry, error) {
			return versionCoordinator.Submit(t.Context(), tx, v1.ID, v1.Revision, actorOne("concurrent-submit-v1"), payload)
		})
		if err != nil {
			t.Fatalf("submit concurrent V1: %v", err)
		}
		v1, err = mutateEntry(t, pool, func(tx pgx.Tx) (Entry, error) {
			return versionCoordinator.Approve(t.Context(), tx, v1.ID, v1.Revision, actorTwo("concurrent-approve-v1"), payload)
		})
		if err != nil {
			t.Fatalf("approve concurrent V1: %v", err)
		}

		start := make(chan struct{})
		results := make(chan error, 2)
		candidateActors := []Actor{
			integrationActor(t, ulid.Make().String(), "concurrent-v2-0"),
			integrationActor(t, ulid.Make().String(), "concurrent-v2-1"),
		}
		var wait sync.WaitGroup
		for candidate := 0; candidate < 2; candidate++ {
			wait.Add(1)
			go func(candidate int) {
				defer wait.Done()
				tx, beginErr := pool.Begin(context.Background())
				if beginErr != nil {
					results <- beginErr
					return
				}
				defer func() { _ = tx.Rollback(context.Background()) }()
				<-start
				_, createErr := versionCoordinator.CreateNextVersion(
					context.Background(), tx, subjectID, candidateActors[candidate], payload,
				)
				if createErr == nil {
					createErr = tx.Commit(context.Background())
				}
				results <- createErr
			}(candidate)
		}
		close(start)
		wait.Wait()
		close(results)
		successes, conflicts := 0, 0
		for resultErr := range results {
			switch {
			case resultErr == nil:
				successes++
			case IsKind(resultErr, ErrorConflict):
				conflicts++
			default:
				t.Fatalf("concurrent candidate error = %v", resultErr)
			}
		}
		var openVersions int64
		if err = pool.QueryRow(t.Context(), `
			SELECT count(*) FROM approval_entries
			WHERE domain='fixture' AND entity='concurrent-version' AND subject_id=$1
			  AND version_no IS NOT NULL AND status IN ('DRAFT', 'PENDING')
		`, subjectID).Scan(&openVersions); err != nil {
			t.Fatalf("count concurrent open versions: %v", err)
		}
		if successes != 1 || conflicts != 1 || openVersions != 1 {
			t.Fatalf("concurrent candidates successes=%d conflicts=%d open=%d", successes, conflicts, openVersions)
		}
	})

	t.Run("versioned subject and entry roll back and delete atomically without orphan", func(t *testing.T) {
		versionBus := txevent.NewBus()
		versionTopic := MustTopic[fixturePayload]("approval.atomic-version.lifecycle")
		versionCoordinator, coordinatorErr := NewCoordinator("fixture", "atomic-version", allowAuthorizer{}, versionBus, versionTopic)
		if coordinatorErr != nil {
			t.Fatalf("new atomic version coordinator: %v", coordinatorErr)
		}
		if subscribeErr := versionTopic.Subscribe(versionBus, "atomic-version-effect", func(ctx context.Context, tx pgx.Tx, event Event[fixturePayload]) error {
			if event.Payload.Failure == "" {
				return nil
			}
			if _, writeErr := tx.Exec(ctx, `
				INSERT INTO approval_fixture_effects(id, subject_id, action)
				VALUES($1, $2, $3)
			`, ulid.Make().String(), event.Payload.SubjectID, event.Action); writeErr != nil {
				return writeErr
			}
			if event.Payload.Failure == "panic" {
				panic("atomic version subscriber panic")
			}
			return errors.New("atomic version subscriber error")
		}); subscribeErr != nil {
			t.Fatalf("subscribe atomic version effect: %v", subscribeErr)
		}

		for _, failure := range []string{"error", "panic"} {
			subjectID := ulid.Make().String()
			payload := fixturePayload{SubjectID: subjectID, Name: "Failed version create", Failure: failure}
			createErr := inTransaction(t, pool, func(tx pgx.Tx) error {
				if _, insertErr := tx.Exec(t.Context(), `INSERT INTO approval_fixture_subjects(id, name) VALUES($1, $2)`, subjectID, payload.Name); insertErr != nil {
					return insertErr
				}
				_, versionErr := versionCoordinator.CreateFirstVersion(t.Context(), tx, subjectID, actorOne("atomic-version-create-"+failure), payload)
				return versionErr
			})
			if !IsKey(createErr, "approval_event_delivery_failed") {
				t.Fatalf("version create %s rollback error = %v", failure, createErr)
			}
			var subjects, entries, effects int64
			if err = pool.QueryRow(t.Context(), `SELECT count(*) FROM approval_fixture_subjects WHERE id=$1`, subjectID).Scan(&subjects); err != nil {
				t.Fatalf("count rolled back version subjects: %v", err)
			}
			if err = pool.QueryRow(t.Context(), `SELECT count(*) FROM approval_entries WHERE domain='fixture' AND entity='atomic-version' AND subject_id=$1`, subjectID).Scan(&entries); err != nil {
				t.Fatalf("count rolled back versions: %v", err)
			}
			if err = pool.QueryRow(t.Context(), `SELECT count(*) FROM approval_fixture_effects WHERE subject_id=$1`, subjectID).Scan(&effects); err != nil {
				t.Fatalf("count rolled back version effects: %v", err)
			}
			if subjects != 0 || entries != 0 || effects != 0 {
				t.Fatalf("version create %s left subjects=%d entries=%d effects=%d", failure, subjects, entries, effects)
			}
		}

		subjectID := ulid.Make().String()
		payload := fixturePayload{SubjectID: subjectID, Name: "Atomic version delete"}
		var entry Entry
		if createErr := inTransaction(t, pool, func(tx pgx.Tx) error {
			if _, insertErr := tx.Exec(t.Context(), `INSERT INTO approval_fixture_subjects(id, name) VALUES($1, $2)`, subjectID, payload.Name); insertErr != nil {
				return insertErr
			}
			var versionErr error
			entry, versionErr = versionCoordinator.CreateFirstVersion(t.Context(), tx, subjectID, actorOne("atomic-version-create"), payload)
			return versionErr
		}); createErr != nil {
			t.Fatalf("create atomic version: %v", createErr)
		}
		failingPayload := payload
		failingPayload.Failure = "error"
		deleteErr := inTransaction(t, pool, func(tx pgx.Tx) error {
			return versionCoordinator.DeleteDraftVersion(t.Context(), tx, entry.ID, entry.Revision, actorOne("atomic-version-delete-failure"), failingPayload)
		})
		if !IsKey(deleteErr, "approval_event_delivery_failed") {
			t.Fatalf("version delete rollback error = %v", deleteErr)
		}
		var preserved int64
		if err = pool.QueryRow(t.Context(), `SELECT count(*) FROM approval_entries WHERE id=$1`, entry.ID).Scan(&preserved); err != nil || preserved != 1 {
			t.Fatalf("preserved version entries=%d, err=%v", preserved, err)
		}

		if deleteErr = inTransaction(t, pool, func(tx pgx.Tx) error {
			if versionErr := versionCoordinator.DeleteDraftVersion(t.Context(), tx, entry.ID, entry.Revision, actorOne("atomic-version-delete"), payload); versionErr != nil {
				return versionErr
			}
			command, deleteSubjectErr := tx.Exec(t.Context(), `DELETE FROM approval_fixture_subjects WHERE id=$1`, subjectID)
			if deleteSubjectErr != nil {
				return deleteSubjectErr
			}
			if command.RowsAffected() != 1 {
				return errors.New("fixture version subject changed before delete")
			}
			return nil
		}); deleteErr != nil {
			t.Fatalf("delete version and subject: %v", deleteErr)
		}
		var orphans int64
		if err = pool.QueryRow(t.Context(), `
			SELECT count(*)
			FROM approval_entries entry
			LEFT JOIN approval_fixture_subjects subject ON subject.id=entry.subject_id
			WHERE entry.domain='fixture' AND entry.entity='atomic-version' AND subject.id IS NULL
		`).Scan(&orphans); err != nil {
			t.Fatalf("count version orphans: %v", err)
		}
		if orphans != 0 {
			t.Fatalf("version approval orphan count = %d", orphans)
		}
	})
}

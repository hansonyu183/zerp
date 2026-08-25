//go:build integration

package approval

import (
	"context"
	"errors"
	"fmt"
	"os"
	"strings"
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
}

//go:build integration

package vou

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"sync/atomic"
	"testing"

	auxdomain "github.com/hansonyu183/zerp/backend/internal/domains/auxiliary"
	bobdomain "github.com/hansonyu183/zerp/backend/internal/domains/bob"
	"github.com/hansonyu183/zerp/backend/internal/integrations/auxiliaryrefs"
	"github.com/hansonyu183/zerp/backend/internal/platform/txevent"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

func setupEventEffectsTable(t *testing.T, pool *pgxpool.Pool) {
	t.Helper()
	if _, err := pool.Exec(t.Context(), `
		CREATE TABLE IF NOT EXISTS txevent_vou_test_effects (
			id varchar(26) PRIMARY KEY,
			document_id varchar(26) NOT NULL,
			topic text NOT NULL
		);
		TRUNCATE txevent_vou_test_effects`); err != nil {
		t.Fatalf("prepare event effects table: %v", err)
	}
	t.Cleanup(func() {
		if _, err := pool.Exec(context.Background(), `DROP TABLE IF EXISTS txevent_vou_test_effects`); err != nil {
			t.Errorf("drop event effects table: %v", err)
		}
	})
}

func integrationServiceWithEvents(t *testing.T, pool *pgxpool.Pool, events eventPublisher) *Service {
	t.Helper()
	service, err := NewService(pool, bobdomain.NewService(pool), auxiliaryrefs.New(auxdomain.NewService(pool)), events, AttachmentOptions{Root: t.TempDir()},
		slog.New(slog.NewTextHandler(io.Discard, nil)))
	if err != nil {
		t.Fatalf("new VOU service: %v", err)
	}
	return service
}

func createApprovedReceipt(
	t *testing.T, service *Service, refs integrationReferences,
) (MutationResult, MutationResult) {
	t.Helper()
	created, reviewed := createCheckedReceipt(t, service, refs)
	approved, err := service.Approve(t.Context(), EntitySalesReceipt, DocumentRevisionInput{
		DocumentID: created.DocumentID, Revision: reviewed.Revision,
	}, integrationActorOne, "event-receipt-approve")
	if err != nil {
		t.Fatalf("approve receipt: %v", err)
	}
	return created, approved
}

func createCheckedReceipt(
	t *testing.T, service *Service, refs integrationReferences,
) (MutationResult, MutationResult) {
	t.Helper()
	created, err := service.Create(t.Context(), EntitySalesReceipt, CreateInput{Data: DraftInput{
		BusinessDate: "2026-07-24", Currency: "CNY",
		CounterpartyType: bobdomain.EntityCustomer, Counterparty: &refs.customer,
		FundAccount: &refs.fundAccount, Handler: &refs.employee, Amount: "100.00",
	}}, integrationActorOne, "event-receipt-create")
	if err != nil {
		t.Fatalf("create receipt: %v", err)
	}
	reviewed, err := service.Check(t.Context(), EntitySalesReceipt, DocumentRevisionInput{
		DocumentID: created.DocumentID, Revision: created.Revision,
	}, integrationActorOne, "event-receipt-review")
	if err != nil {
		t.Fatalf("review receipt: %v", err)
	}
	return created, reviewed
}

func documentState(t *testing.T, pool *pgxpool.Pool, documentID string) (string, int64) {
	t.Helper()
	var status string
	var revision int64
	if err := pool.QueryRow(t.Context(),
		`SELECT status, revision FROM vou_documents WHERE id = $1`, documentID,
	).Scan(&status, &revision); err != nil {
		t.Fatalf("read document state: %v", err)
	}
	return status, revision
}

func eventEffectCount(t *testing.T, pool *pgxpool.Pool, documentID string) int64 {
	t.Helper()
	var count int64
	if err := pool.QueryRow(t.Context(),
		`SELECT count(*) FROM txevent_vou_test_effects WHERE document_id = $1`, documentID,
	).Scan(&count); err != nil {
		t.Fatalf("count event effects: %v", err)
	}
	return count
}

func auditCount(t *testing.T, pool *pgxpool.Pool, documentID string) int64 {
	t.Helper()
	var count int64
	if err := pool.QueryRow(t.Context(),
		`SELECT count(*) FROM vou_audit_events WHERE document_id = $1`, documentID,
	).Scan(&count); err != nil {
		t.Fatalf("count audit events: %v", err)
	}
	return count
}

func TestVOUTransactionalEventsCommitAndRouteExactlyIntegration(t *testing.T) {
	pool := vouIntegrationPool(t)
	truncateVOU(t, pool)
	t.Cleanup(func() { truncateVOU(t, pool) })
	setupEventEffectsTable(t, pool)
	refs := prepareReferences(t, pool)
	bus := txevent.NewBus()
	var wrongTopicCalls atomic.Int32
	if err := bus.Subscribe(DocumentApprovedTopic(EntitySaleOrder), "wrong-document-type",
		func(context.Context, pgx.Tx, txevent.Event) error {
			wrongTopicCalls.Add(1)
			return nil
		}); err != nil {
		t.Fatalf("subscribe wrong document type: %v", err)
	}
	if err := bus.Subscribe(DocumentApprovedTopic(EntitySalesReceipt), "ledger",
		func(ctx context.Context, tx pgx.Tx, raw txevent.Event) error {
			event, ok := raw.(DocumentApprovedEvent)
			if !ok {
				return errors.New("unexpected approved event type")
			}
			var status string
			var revision, audits int64
			if err := tx.QueryRow(ctx, `
				SELECT status, revision,
					(SELECT count(*) FROM vou_audit_events WHERE document_id = d.id)
				FROM vou_documents d WHERE id = $1`, event.DocumentID,
			).Scan(&status, &revision, &audits); err != nil {
				return err
			}
			if status != StatusApproved || revision != event.Revision || audits != 3 {
				return errors.New("subscriber cannot see approved posting state")
			}
			_, err := tx.Exec(ctx, `
				INSERT INTO txevent_vou_test_effects (id, document_id, topic)
				VALUES ($1, $2, $3)`, newID(), event.DocumentID, event.Topic())
			return err
		}); err != nil {
		t.Fatalf("subscribe approval: %v", err)
	}
	if err := bus.Subscribe(DocumentUnapprovedTopic(EntitySalesReceipt), "ledger-reversal",
		func(ctx context.Context, tx pgx.Tx, raw txevent.Event) error {
			event, ok := raw.(DocumentUnapprovedEvent)
			if !ok || event.Reason != "冲销错误入账" {
				return errors.New("unexpected unapproved event")
			}
			var status string
			var revision, audits int64
			if err := tx.QueryRow(ctx, `
				SELECT status, revision,
					(SELECT count(*) FROM vou_audit_events WHERE document_id = d.id)
				FROM vou_documents d WHERE id = $1`, event.DocumentID,
			).Scan(&status, &revision, &audits); err != nil {
				return err
			}
			if status != StatusChecked || revision != event.Revision || audits != 4 {
				return errors.New("subscriber cannot see reversed posting state")
			}
			_, err := tx.Exec(ctx, `
				INSERT INTO txevent_vou_test_effects (id, document_id, topic)
				VALUES ($1, $2, $3)`, newID(), event.DocumentID, event.Topic())
			return err
		}); err != nil {
		t.Fatalf("subscribe unapproval: %v", err)
	}

	service := integrationServiceWithEvents(t, pool, bus)
	created, approved := createApprovedReceipt(t, service, refs)
	if count := eventEffectCount(t, pool, created.DocumentID); count != 1 {
		t.Fatalf("committed approval effects = %d, want 1", count)
	}
	if wrongTopicCalls.Load() != 0 {
		t.Fatalf("wrong document type subscriber calls = %d", wrongTopicCalls.Load())
	}

	unapproved, err := service.Unapprove(t.Context(), EntitySalesReceipt, ReverseInput{
		DocumentID: created.DocumentID, Revision: approved.Revision, Reason: "冲销错误入账",
	}, integrationActorOne, "event-receipt-unapprove")
	if err != nil {
		t.Fatalf("unapprove receipt: %v", err)
	}
	if unapproved.Status != StatusChecked {
		t.Fatalf("unapproved status = %s", unapproved.Status)
	}
	if count := eventEffectCount(t, pool, created.DocumentID); count != 2 {
		t.Fatalf("committed approval and unapproval effects = %d, want 2", count)
	}
}

func TestVOUApprovedSubscriberFailureRollsBackEverythingIntegration(t *testing.T) {
	pool := vouIntegrationPool(t)
	truncateVOU(t, pool)
	t.Cleanup(func() { truncateVOU(t, pool) })
	setupEventEffectsTable(t, pool)
	refs := prepareReferences(t, pool)
	bus := txevent.NewBus()
	var calls atomic.Int32
	if err := bus.Subscribe(DocumentApprovedTopic(EntitySalesReceipt), "first-writer",
		func(ctx context.Context, tx pgx.Tx, event txevent.Event) error {
			calls.Add(1)
			_, err := tx.Exec(ctx, `
				INSERT INTO txevent_vou_test_effects (id, document_id, topic)
				VALUES ($1, $2, $3)`, newID(), event.(DocumentApprovedEvent).DocumentID, event.Topic())
			return err
		}); err != nil {
		t.Fatalf("subscribe first writer: %v", err)
	}
	if err := bus.Subscribe(DocumentApprovedTopic(EntitySalesReceipt), "closed-period",
		func(context.Context, pgx.Tx, txevent.Event) error {
			calls.Add(1)
			return txevent.Reject("账簿期间已关闭", map[string]any{"period": "2026-07"})
		}); err != nil {
		t.Fatalf("subscribe rejector: %v", err)
	}
	if err := bus.Subscribe(DocumentApprovedTopic(EntitySalesReceipt), "must-not-run",
		func(context.Context, pgx.Tx, txevent.Event) error {
			calls.Add(1)
			return nil
		}); err != nil {
		t.Fatalf("subscribe trailing handler: %v", err)
	}

	service := integrationServiceWithEvents(t, pool, bus)
	created, reviewed := createCheckedReceipt(t, service, refs)
	_, err := service.Approve(t.Context(), EntitySalesReceipt, DocumentRevisionInput{
		DocumentID: created.DocumentID, Revision: reviewed.Revision,
	}, integrationActorOne, "event-rejected-approve")
	var domainErr *DomainError
	if !errors.As(err, &domainErr) || domainErr.Kind != ErrorConflict ||
		domainErr.Message != "账簿期间已关闭" {
		t.Fatalf("approval rejection = %#v", err)
	}
	data, ok := domainErr.Data.(map[string]any)
	if !ok || data["period"] != "2026-07" {
		t.Fatalf("approval rejection data = %#v", domainErr.Data)
	}
	if calls.Load() != 2 {
		t.Fatalf("subscriber calls = %d, want 2", calls.Load())
	}
	status, revision := documentState(t, pool, created.DocumentID)
	if status != StatusChecked || revision != reviewed.Revision {
		t.Fatalf("document state after rollback = %s/%d, want %s/%d",
			status, revision, StatusChecked, reviewed.Revision)
	}
	if count := auditCount(t, pool, created.DocumentID); count != 2 {
		t.Fatalf("audit count after rollback = %d, want 2", count)
	}
	if count := eventEffectCount(t, pool, created.DocumentID); count != 0 {
		t.Fatalf("subscriber effects after rollback = %d, want 0", count)
	}

	failingBus := txevent.NewBus()
	if subscribeErr := failingBus.Subscribe(DocumentApprovedTopic(EntitySalesReceipt), "database-failure",
		func(context.Context, pgx.Tx, txevent.Event) error {
			return errors.New("downstream database unavailable")
		}); subscribeErr != nil {
		t.Fatalf("subscribe ordinary failure: %v", subscribeErr)
	}
	service.events = failingBus
	_, err = service.Approve(t.Context(), EntitySalesReceipt, DocumentRevisionInput{
		DocumentID: created.DocumentID, Revision: reviewed.Revision,
	}, integrationActorOne, "event-failed-approve")
	if !errors.As(err, &domainErr) || domainErr.Kind != ErrorInternal ||
		domainErr.Message != "internal server error" {
		t.Fatalf("ordinary subscriber failure = %#v", err)
	}
	status, revision = documentState(t, pool, created.DocumentID)
	if status != StatusChecked || revision != reviewed.Revision {
		t.Fatalf("document state after ordinary failure = %s/%d", status, revision)
	}
}

func TestVOUUnapprovedSubscriberFailureRestoresDocumentIntegration(t *testing.T) {
	pool := vouIntegrationPool(t)
	truncateVOU(t, pool)
	t.Cleanup(func() { truncateVOU(t, pool) })
	setupEventEffectsTable(t, pool)
	refs := prepareReferences(t, pool)
	service := integrationServiceWithEvents(t, pool, txevent.NewBus())

	created, err := service.Create(t.Context(), EntitySalesReceipt, CreateInput{Data: DraftInput{
		BusinessDate: "2026-07-24", Currency: "CNY", CounterpartyType: "customer",
		Counterparty: &refs.customer, FundAccount: &refs.fundAccount,
		Handler: &refs.employee, Amount: "100.00",
	}}, integrationActorOne, "event-purchase-create")
	if err != nil {
		t.Fatalf("create purchase: %v", err)
	}
	reviewed, err := service.Check(t.Context(), EntitySalesReceipt, DocumentRevisionInput{
		DocumentID: created.DocumentID, Revision: created.Revision,
	}, integrationActorOne, "event-purchase-review")
	if err != nil {
		t.Fatalf("review purchase: %v", err)
	}
	approved, err := service.Approve(t.Context(), EntitySalesReceipt, DocumentRevisionInput{
		DocumentID: created.DocumentID, Revision: reviewed.Revision,
	}, integrationActorOne, "event-purchase-approve")
	if err != nil {
		t.Fatalf("approve purchase: %v", err)
	}
	bus := txevent.NewBus()
	if err = bus.Subscribe(DocumentUnapprovedTopic(EntitySalesReceipt), "reversal-writer",
		func(ctx context.Context, tx pgx.Tx, event txevent.Event) error {
			_, execErr := tx.Exec(ctx, `
				INSERT INTO txevent_vou_test_effects (id, document_id, topic)
				VALUES ($1, $2, $3)`, newID(), event.(DocumentUnapprovedEvent).DocumentID, event.Topic())
			return execErr
		}); err != nil {
		t.Fatalf("subscribe reversal writer: %v", err)
	}
	if err = bus.Subscribe(DocumentUnapprovedTopic(EntitySalesReceipt), "reversal-failure",
		func(context.Context, pgx.Tx, txevent.Event) error {
			return errors.New("cannot reverse ledger")
		}); err != nil {
		t.Fatalf("subscribe reversal failure: %v", err)
	}
	service.events = bus

	_, err = service.Unapprove(t.Context(), EntitySalesReceipt, ReverseInput{
		DocumentID: created.DocumentID, Revision: approved.Revision, Reason: "回滚测试",
	}, integrationActorOne, "event-purchase-unapprove")
	var domainErr *DomainError
	if !errors.As(err, &domainErr) || domainErr.Kind != ErrorInternal {
		t.Fatalf("unapprove failure = %#v", err)
	}
	status, revision := documentState(t, pool, created.DocumentID)
	if status != StatusApproved || revision != approved.Revision {
		t.Fatalf("document state after unapprove rollback = %s/%d, want %s/%d",
			status, revision, StatusApproved, approved.Revision)
	}
	if count := auditCount(t, pool, created.DocumentID); count != 3 {
		t.Fatalf("audit count after unapprove rollback = %d, want 3", count)
	}
	if count := eventEffectCount(t, pool, created.DocumentID); count != 0 {
		t.Fatalf("reversal subscriber effects after rollback = %d, want 0", count)
	}
}

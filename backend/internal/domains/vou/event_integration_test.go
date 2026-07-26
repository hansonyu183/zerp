//go:build integration

package vou

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"sync/atomic"
	"testing"

	bobdomain "github.com/hansonyu183/zerp-back/internal/domains/bob"
	"github.com/hansonyu183/zerp-back/internal/platform/txevent"
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
	service, err := NewService(pool, bobdomain.NewService(pool), events, AttachmentOptions{Root: t.TempDir()},
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
	created, err := service.Create(t.Context(), EntityReceipt, CreateInput{Data: DraftInput{
		BusinessDate: "2026-07-24", Currency: "CNY",
		CounterpartyType: bobdomain.EntityCustomer, Counterparty: &refs.customer,
		FundAccount: &refs.fundAccount, Handler: &refs.employee, Amount: "100.00",
	}}, integrationActorOne, "event-receipt-create")
	if err != nil {
		t.Fatalf("create receipt: %v", err)
	}
	reviewed, err := service.Review(t.Context(), EntityReceipt, DocumentRevisionInput{
		DocumentID: created.DocumentID, Revision: created.Revision,
	}, integrationActorOne, "event-receipt-review")
	if err != nil {
		t.Fatalf("review receipt: %v", err)
	}
	approved, err := service.Approve(t.Context(), EntityReceipt, DocumentRevisionInput{
		DocumentID: created.DocumentID, Revision: reviewed.Revision,
	}, integrationActorOne, "event-receipt-approve")
	if err != nil {
		t.Fatalf("approve receipt: %v", err)
	}
	return created, approved
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
	if err := bus.Subscribe(DocumentExecutedTopic(EntitySaleOrder), "wrong-document-type",
		func(context.Context, pgx.Tx, txevent.Event) error {
			wrongTopicCalls.Add(1)
			return nil
		}); err != nil {
		t.Fatalf("subscribe wrong document type: %v", err)
	}
	if err := bus.Subscribe(DocumentExecutedTopic(EntityReceipt), "ledger",
		func(ctx context.Context, tx pgx.Tx, raw txevent.Event) error {
			event, ok := raw.(DocumentExecutedEvent)
			if !ok {
				return errors.New("unexpected executed event type")
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
			if status != StatusExecuted || revision != event.Revision || audits != 4 {
				return errors.New("subscriber cannot see final executed state")
			}
			_, err := tx.Exec(ctx, `
				INSERT INTO txevent_vou_test_effects (id, document_id, topic)
				VALUES ($1, $2, $3)`, newID(), event.DocumentID, event.Topic())
			return err
		}); err != nil {
		t.Fatalf("subscribe execute: %v", err)
	}
	if err := bus.Subscribe(DocumentUnexecutedTopic(EntityReceipt), "ledger-reversal",
		func(ctx context.Context, tx pgx.Tx, raw txevent.Event) error {
			event, ok := raw.(DocumentUnexecutedEvent)
			if !ok || event.Reason != "冲销错误入账" {
				return errors.New("unexpected unexecuted event")
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
			if status != StatusApproved || revision != event.Revision || audits != 5 {
				return errors.New("subscriber cannot see final unexecuted state")
			}
			_, err := tx.Exec(ctx, `
				INSERT INTO txevent_vou_test_effects (id, document_id, topic)
				VALUES ($1, $2, $3)`, newID(), event.DocumentID, event.Topic())
			return err
		}); err != nil {
		t.Fatalf("subscribe unexecute: %v", err)
	}

	service := integrationServiceWithEvents(t, pool, bus)
	created, approved := createApprovedReceipt(t, service, refs)
	executed, err := service.Execute(t.Context(), EntityReceipt, ExecuteInput{
		DocumentID: created.DocumentID, Revision: approved.Revision,
	}, integrationActorOne, "event-receipt-execute")
	if err != nil {
		t.Fatalf("execute receipt: %v", err)
	}
	if count := eventEffectCount(t, pool, created.DocumentID); count != 1 {
		t.Fatalf("committed execute effects = %d, want 1", count)
	}
	if wrongTopicCalls.Load() != 0 {
		t.Fatalf("wrong document type subscriber calls = %d", wrongTopicCalls.Load())
	}

	unexecuted, err := service.Unexecute(t.Context(), EntityReceipt, ReverseInput{
		DocumentID: created.DocumentID, Revision: executed.Revision, Reason: "冲销错误入账",
	}, integrationActorOne, "event-receipt-unexecute")
	if err != nil {
		t.Fatalf("unexecute receipt: %v", err)
	}
	if unexecuted.Status != StatusApproved {
		t.Fatalf("unexecuted status = %s", unexecuted.Status)
	}
	if count := eventEffectCount(t, pool, created.DocumentID); count != 2 {
		t.Fatalf("committed execute and unexecute effects = %d, want 2", count)
	}
}

func TestVOUExecutedSubscriberFailureRollsBackEverythingIntegration(t *testing.T) {
	pool := vouIntegrationPool(t)
	truncateVOU(t, pool)
	t.Cleanup(func() { truncateVOU(t, pool) })
	setupEventEffectsTable(t, pool)
	refs := prepareReferences(t, pool)
	bus := txevent.NewBus()
	var calls atomic.Int32
	if err := bus.Subscribe(DocumentExecutedTopic(EntityReceipt), "first-writer",
		func(ctx context.Context, tx pgx.Tx, event txevent.Event) error {
			calls.Add(1)
			_, err := tx.Exec(ctx, `
				INSERT INTO txevent_vou_test_effects (id, document_id, topic)
				VALUES ($1, $2, $3)`, newID(), event.(DocumentExecutedEvent).DocumentID, event.Topic())
			return err
		}); err != nil {
		t.Fatalf("subscribe first writer: %v", err)
	}
	if err := bus.Subscribe(DocumentExecutedTopic(EntityReceipt), "closed-period",
		func(context.Context, pgx.Tx, txevent.Event) error {
			calls.Add(1)
			return txevent.Reject("账簿期间已关闭", map[string]any{"period": "2026-07"})
		}); err != nil {
		t.Fatalf("subscribe rejector: %v", err)
	}
	if err := bus.Subscribe(DocumentExecutedTopic(EntityReceipt), "must-not-run",
		func(context.Context, pgx.Tx, txevent.Event) error {
			calls.Add(1)
			return nil
		}); err != nil {
		t.Fatalf("subscribe trailing handler: %v", err)
	}

	service := integrationServiceWithEvents(t, pool, bus)
	created, approved := createApprovedReceipt(t, service, refs)
	_, err := service.Execute(t.Context(), EntityReceipt, ExecuteInput{
		DocumentID: created.DocumentID, Revision: approved.Revision,
	}, integrationActorOne, "event-rejected-execute")
	var domainErr *DomainError
	if !errors.As(err, &domainErr) || domainErr.Kind != ErrorConflict ||
		domainErr.Message != "账簿期间已关闭" {
		t.Fatalf("execute rejection = %#v", err)
	}
	data, ok := domainErr.Data.(map[string]any)
	if !ok || data["period"] != "2026-07" {
		t.Fatalf("execute rejection data = %#v", domainErr.Data)
	}
	if calls.Load() != 2 {
		t.Fatalf("subscriber calls = %d, want 2", calls.Load())
	}
	status, revision := documentState(t, pool, created.DocumentID)
	if status != StatusApproved || revision != approved.Revision {
		t.Fatalf("document state after rollback = %s/%d, want %s/%d",
			status, revision, StatusApproved, approved.Revision)
	}
	if count := auditCount(t, pool, created.DocumentID); count != 3 {
		t.Fatalf("audit count after rollback = %d, want 3", count)
	}
	if count := eventEffectCount(t, pool, created.DocumentID); count != 0 {
		t.Fatalf("subscriber effects after rollback = %d, want 0", count)
	}

	failingBus := txevent.NewBus()
	if subscribeErr := failingBus.Subscribe(DocumentExecutedTopic(EntityReceipt), "database-failure",
		func(context.Context, pgx.Tx, txevent.Event) error {
			return errors.New("downstream database unavailable")
		}); subscribeErr != nil {
		t.Fatalf("subscribe ordinary failure: %v", subscribeErr)
	}
	service.events = failingBus
	_, err = service.Execute(t.Context(), EntityReceipt, ExecuteInput{
		DocumentID: created.DocumentID, Revision: approved.Revision,
	}, integrationActorOne, "event-failed-execute")
	if !errors.As(err, &domainErr) || domainErr.Kind != ErrorInternal ||
		domainErr.Message != "internal server error" {
		t.Fatalf("ordinary subscriber failure = %#v", err)
	}
	status, revision = documentState(t, pool, created.DocumentID)
	if status != StatusApproved || revision != approved.Revision {
		t.Fatalf("document state after ordinary failure = %s/%d", status, revision)
	}
}

func TestVOUUnexecutedSubscriberFailureRestoresExecutionIntegration(t *testing.T) {
	pool := vouIntegrationPool(t)
	truncateVOU(t, pool)
	t.Cleanup(func() { truncateVOU(t, pool) })
	setupEventEffectsTable(t, pool)
	refs := prepareReferences(t, pool)
	service := integrationServiceWithEvents(t, pool, txevent.NewBus())

	created, err := service.Create(t.Context(), EntityPurchaseOrder, CreateInput{Data: DraftInput{
		BusinessDate: "2026-07-24", Currency: "CNY", Supplier: &refs.supplier,
		Purchaser: &refs.employee, Warehouse: &refs.warehouse,
		ProductLines: []ProductLineInput{{
			Product: refs.product, OrderedQuantity: "2", UnitPrice: "50.00",
		}},
	}}, integrationActorOne, "event-purchase-create")
	if err != nil {
		t.Fatalf("create purchase: %v", err)
	}
	reviewed, err := service.Review(t.Context(), EntityPurchaseOrder, DocumentRevisionInput{
		DocumentID: created.DocumentID, Revision: created.Revision,
	}, integrationActorOne, "event-purchase-review")
	if err != nil {
		t.Fatalf("review purchase: %v", err)
	}
	approved, err := service.Approve(t.Context(), EntityPurchaseOrder, DocumentRevisionInput{
		DocumentID: created.DocumentID, Revision: reviewed.Revision,
	}, integrationActorOne, "event-purchase-approve")
	if err != nil {
		t.Fatalf("approve purchase: %v", err)
	}
	view, err := service.Get(t.Context(), EntityPurchaseOrder, GetInput{DocumentID: created.DocumentID})
	if err != nil {
		t.Fatalf("get purchase: %v", err)
	}
	executed, err := service.Execute(t.Context(), EntityPurchaseOrder, ExecuteInput{
		DocumentID: created.DocumentID, Revision: approved.Revision, InboundDate: "2026-07-25",
		PurchaseLines: []PurchaseExecutionLineInput{{
			LineID: view.Data.ProductLines[0].LineID, InboundQuantity: "2",
		}},
	}, integrationActorOne, "event-purchase-execute")
	if err != nil {
		t.Fatalf("execute purchase: %v", err)
	}

	bus := txevent.NewBus()
	if err = bus.Subscribe(DocumentUnexecutedTopic(EntityPurchaseOrder), "reversal-writer",
		func(ctx context.Context, tx pgx.Tx, event txevent.Event) error {
			_, execErr := tx.Exec(ctx, `
				INSERT INTO txevent_vou_test_effects (id, document_id, topic)
				VALUES ($1, $2, $3)`, newID(), event.(DocumentUnexecutedEvent).DocumentID, event.Topic())
			return execErr
		}); err != nil {
		t.Fatalf("subscribe reversal writer: %v", err)
	}
	if err = bus.Subscribe(DocumentUnexecutedTopic(EntityPurchaseOrder), "reversal-failure",
		func(context.Context, pgx.Tx, txevent.Event) error {
			return errors.New("cannot reverse ledger")
		}); err != nil {
		t.Fatalf("subscribe reversal failure: %v", err)
	}
	service.events = bus

	_, err = service.Unexecute(t.Context(), EntityPurchaseOrder, ReverseInput{
		DocumentID: created.DocumentID, Revision: executed.Revision, Reason: "回滚测试",
	}, integrationActorOne, "event-purchase-unexecute")
	var domainErr *DomainError
	if !errors.As(err, &domainErr) || domainErr.Kind != ErrorInternal {
		t.Fatalf("unexecute failure = %#v", err)
	}
	status, revision := documentState(t, pool, created.DocumentID)
	if status != StatusExecuted || revision != executed.Revision {
		t.Fatalf("document state after unexecute rollback = %s/%d, want %s/%d",
			status, revision, StatusExecuted, executed.Revision)
	}
	var inbound *int64
	if err = pool.QueryRow(t.Context(),
		`SELECT inbound_qty_micros FROM vou_product_lines WHERE document_id = $1`, created.DocumentID,
	).Scan(&inbound); err != nil {
		t.Fatalf("read inbound quantity: %v", err)
	}
	if inbound == nil || *inbound != 2_000_000 {
		t.Fatalf("inbound quantity after rollback = %v", inbound)
	}
	if count := auditCount(t, pool, created.DocumentID); count != 4 {
		t.Fatalf("audit count after unexecute rollback = %d, want 4", count)
	}
	if count := eventEffectCount(t, pool, created.DocumentID); count != 0 {
		t.Fatalf("reversal subscriber effects after rollback = %d, want 0", count)
	}
}

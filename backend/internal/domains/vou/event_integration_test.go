//go:build integration

package vou

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"sync/atomic"
	"testing"

	"github.com/hansonyu183/zerp/backend/internal/api/authorization"
	auxdomain "github.com/hansonyu183/zerp/backend/internal/domains/auxiliary"
	"github.com/hansonyu183/zerp/backend/internal/integrations/auxiliaryrefs"
	"github.com/hansonyu183/zerp/backend/internal/platform/approval"
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

func integrationServiceWithEvents(t *testing.T, pool *pgxpool.Pool, events *txevent.Bus) *Service {
	t.Helper()
	service, err := NewService(
		pool,
		newBOBIntegrationService(pool),
		auxiliaryrefs.New(auxdomain.NewService(pool)),
		events,
		AttachmentOptions{Root: t.TempDir()},
		slog.New(slog.NewTextHandler(io.Discard, nil)),
		WithPeriodWriteControl(alwaysOpenPeriodWriteControl{}),
		WithApprovalAuthorizer(authorization.Func(nil)),
	)
	if err != nil {
		t.Fatalf("new VOU service: %v", err)
	}
	return service
}

func createApprovedReceipt(t *testing.T, service *Service, refs integrationReferences) (MutationResult, MutationResult) {
	t.Helper()
	created, submitted := createSubmittedReceipt(t, service, refs)
	approved, err := service.Approve(t.Context(), EntitySalesReceipt, DocumentRevisionInput{
		DocumentID: created.DocumentID, Revision: submitted.Approval.Revision,
	}, integrationApprovalActor(t, integrationActorTwo, "event-receipt-approve"))
	if err != nil {
		t.Fatalf("approve receipt: %v", err)
	}
	return created, approved
}

func createSubmittedReceipt(t *testing.T, service *Service, refs integrationReferences) (MutationResult, MutationResult) {
	t.Helper()
	created, err := service.Create(t.Context(), EntitySalesReceipt, CreateInput{Data: salesReceiptDraft(refs, "100.00")}, integrationApprovalActor(t, integrationActorOne, "event-receipt-create"))
	if err != nil {
		t.Fatalf("create receipt: %v", err)
	}
	submitted, err := service.Submit(t.Context(), EntitySalesReceipt, DocumentRevisionInput{
		DocumentID: created.DocumentID, Revision: created.Approval.Revision,
	}, integrationApprovalActor(t, integrationActorOne, "event-receipt-submit"))
	if err != nil {
		t.Fatalf("submit receipt: %v", err)
	}
	return created, submitted
}

func documentState(t *testing.T, pool *pgxpool.Pool, documentID string) (approval.Status, int64) {
	t.Helper()
	var status string
	var revision int64
	if err := pool.QueryRow(t.Context(), `
		SELECT entry.status, entry.revision
		FROM vou_documents document
		JOIN approval_entries entry ON entry.id = document.approval_entry_id
		WHERE document.id = $1 AND entry.domain = 'vou' AND entry.entity = document.entity`, documentID,
	).Scan(&status, &revision); err != nil {
		t.Fatalf("read document state: %v", err)
	}
	return approval.Status(status), revision
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

func approvalEventCount(t *testing.T, pool *pgxpool.Pool, documentID string) int64 {
	t.Helper()
	var count int64
	if err := pool.QueryRow(t.Context(), `
		SELECT count(*)
		FROM approval_events event
		JOIN approval_entries entry ON entry.id = event.entry_id
		WHERE entry.domain = 'vou' AND entry.subject_id = $1`, documentID,
	).Scan(&count); err != nil {
		t.Fatalf("count approval events: %v", err)
	}
	return count
}

func TestVOUApprovalEventsCommitAndRouteExactlyIntegration(t *testing.T) {
	pool := vouIntegrationPool(t)
	truncateVOU(t, pool)
	t.Cleanup(func() { truncateVOU(t, pool) })
	setupEventEffectsTable(t, pool)
	refs := prepareReferences(t, pool)
	bus := txevent.NewBus()
	var wrongTopicCalls atomic.Int32
	if err := ApprovalTopic(EntitySaleOrder).Subscribe(bus, "wrong-document-type",
		func(context.Context, pgx.Tx, approval.Event[ApprovalPayload]) error {
			wrongTopicCalls.Add(1)
			return nil
		}); err != nil {
		t.Fatalf("subscribe wrong document type: %v", err)
	}
	if err := ApprovalTopic(EntitySalesReceipt).Subscribe(bus, "ledger",
		func(ctx context.Context, tx pgx.Tx, event approval.Event[ApprovalPayload]) error {
			if event.Action != approval.ActionApproved {
				return nil
			}
			if event.Action != approval.ActionApproved || event.ToStatus == nil || *event.ToStatus != approval.StatusApproved ||
				event.ToRevision == nil || event.Payload.DocumentID != event.Entry.SubjectID ||
				event.Payload.Data.BusinessDate != "2026-07-24" || event.Payload.Data.FundAccount == nil ||
				event.Payload.Data.Customer == nil || event.Payload.Data.OperatingEntity == nil ||
				len(event.Payload.Data.SubunitAllocations) != 1 ||
				event.Payload.Data.SubunitAllocations[0].Subunit.CustomerID != refs.salesReceiptCustomer.ObjectID ||
				event.Payload.Amount != "100.00" {
				return errors.New("approved event does not carry the complete typed document snapshot")
			}
			var status string
			var revision, events int64
			if err := tx.QueryRow(ctx, `
				SELECT entry.status, entry.revision,
					(SELECT count(*) FROM approval_events WHERE entry_id = entry.id)
				FROM vou_documents document
				JOIN approval_entries entry ON entry.id = document.approval_entry_id
				WHERE document.id = $1`, event.Entry.SubjectID,
			).Scan(&status, &revision, &events); err != nil {
				return err
			}
			if status != string(approval.StatusApproved) || revision != *event.ToRevision || events != 3 {
				return errors.New("subscriber cannot see approved central Approval state")
			}
			_, err := tx.Exec(ctx, `
				INSERT INTO txevent_vou_test_effects (id, document_id, topic)
				VALUES ($1, $2, $3)`, newID(), event.Entry.SubjectID, ApprovalTopic(EntitySalesReceipt).Name())
			return err
		}); err != nil {
		t.Fatalf("subscribe approval: %v", err)
	}
	if err := ApprovalTopic(EntitySalesReceipt).Subscribe(bus, "ledger-reversal",
		func(ctx context.Context, tx pgx.Tx, event approval.Event[ApprovalPayload]) error {
			if event.Action != approval.ActionUnapproved {
				return nil
			}
			if event.Action != approval.ActionUnapproved || event.Reason == nil || *event.Reason != "冲销错误入账" ||
				event.FromStatus == nil || *event.FromStatus != approval.StatusApproved ||
				event.ToStatus == nil || *event.ToStatus != approval.StatusPending ||
				event.FromRevision == nil || event.ToRevision == nil || *event.FromRevision+1 != *event.ToRevision ||
				event.Payload.Data.FundAccount == nil {
				return errors.New("unexpected unapproved central Approval event")
			}
			_, err := tx.Exec(ctx, `
				INSERT INTO txevent_vou_test_effects (id, document_id, topic)
				VALUES ($1, $2, $3)`, newID(), event.Entry.SubjectID, ApprovalTopic(EntitySalesReceipt).Name())
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
		DocumentID: created.DocumentID, Revision: approved.Approval.Revision, Reason: "冲销错误入账",
	}, integrationApprovalActor(t, integrationActorTwo, "event-receipt-unapprove"))
	if err != nil {
		t.Fatalf("unapprove receipt: %v", err)
	}
	if unapproved.Approval.Status != approval.StatusPending {
		t.Fatalf("unapproved status = %s", unapproved.Approval.Status)
	}
	if count := eventEffectCount(t, pool, created.DocumentID); count != 2 {
		t.Fatalf("committed approval and unapproval effects = %d, want 2", count)
	}
}

func TestVOUApprovedSubscriberFailureAndPanicRollBackIntegration(t *testing.T) {
	pool := vouIntegrationPool(t)
	truncateVOU(t, pool)
	t.Cleanup(func() { truncateVOU(t, pool) })
	setupEventEffectsTable(t, pool)
	refs := prepareReferences(t, pool)
	bus := txevent.NewBus()
	var calls atomic.Int32
	if err := ApprovalTopic(EntitySalesReceipt).Subscribe(bus, "first-writer",
		func(ctx context.Context, tx pgx.Tx, event approval.Event[ApprovalPayload]) error {
			if event.Action != approval.ActionApproved {
				return nil
			}
			calls.Add(1)
			_, err := tx.Exec(ctx, `
				INSERT INTO txevent_vou_test_effects (id, document_id, topic)
				VALUES ($1, $2, $3)`, newID(), event.Entry.SubjectID, ApprovalTopic(EntitySalesReceipt).Name())
			return err
		}); err != nil {
		t.Fatalf("subscribe first writer: %v", err)
	}
	if err := ApprovalTopic(EntitySalesReceipt).Subscribe(bus, "closed-period",
		func(_ context.Context, _ pgx.Tx, event approval.Event[ApprovalPayload]) error {
			if event.Action != approval.ActionApproved {
				return nil
			}
			calls.Add(1)
			return txevent.Reject("账簿期间已关闭", map[string]any{"period": "2026-07"})
		}); err != nil {
		t.Fatalf("subscribe rejector: %v", err)
	}
	if err := ApprovalTopic(EntitySalesReceipt).Subscribe(bus, "must-not-run",
		func(_ context.Context, _ pgx.Tx, event approval.Event[ApprovalPayload]) error {
			if event.Action != approval.ActionApproved {
				return nil
			}
			calls.Add(1)
			return nil
		}); err != nil {
		t.Fatalf("subscribe trailing handler: %v", err)
	}

	service := integrationServiceWithEvents(t, pool, bus)
	created, submitted := createSubmittedReceipt(t, service, refs)
	_, err := service.Approve(t.Context(), EntitySalesReceipt, DocumentRevisionInput{
		DocumentID: created.DocumentID, Revision: submitted.Approval.Revision,
	}, integrationApprovalActor(t, integrationActorTwo, "event-rejected-approve"))
	var domainErr *DomainError
	if !errors.As(err, &domainErr) || domainErr.Kind != ErrorConflict || domainErr.Message != "账簿期间已关闭" {
		t.Fatalf("approval rejection = %#v", err)
	}
	data, ok := domainErr.Data.(map[string]any)
	if !ok || data["period"] != "2026-07" {
		t.Fatalf("approval rejection data = %#v", domainErr.Data)
	}
	if calls.Load() != 2 {
		t.Fatalf("subscriber calls = %d, want 2", calls.Load())
	}
	assertPendingApprovalRollback(t, pool, created.DocumentID, submitted.Approval.Revision)
	if count := eventEffectCount(t, pool, created.DocumentID); count != 0 {
		t.Fatalf("subscriber effects after rollback = %d, want 0", count)
	}

	failingBus := txevent.NewBus()
	if subscribeErr := ApprovalTopic(EntitySalesReceipt).Subscribe(failingBus, "database-failure",
		func(context.Context, pgx.Tx, approval.Event[ApprovalPayload]) error {
			return errors.New("downstream database unavailable")
		}); subscribeErr != nil {
		t.Fatalf("subscribe ordinary failure: %v", subscribeErr)
	}
	service = integrationServiceWithEvents(t, pool, failingBus)
	_, err = service.Approve(t.Context(), EntitySalesReceipt, DocumentRevisionInput{
		DocumentID: created.DocumentID, Revision: submitted.Approval.Revision,
	}, integrationApprovalActor(t, integrationActorTwo, "event-failed-approve"))
	if !errors.As(err, &domainErr) || domainErr.Kind != ErrorInternal ||
		domainErr.ErrorKey != "approval_event_delivery_failed" || domainErr.Message != "approval event delivery failed" {
		t.Fatalf("ordinary subscriber failure = %#v", err)
	}
	assertPendingApprovalRollback(t, pool, created.DocumentID, submitted.Approval.Revision)

	panicBus := txevent.NewBus()
	if subscribeErr := ApprovalTopic(EntitySalesReceipt).Subscribe(panicBus, "panicking-consumer",
		func(context.Context, pgx.Tx, approval.Event[ApprovalPayload]) error {
			panic("consumer invariant failed")
		}); subscribeErr != nil {
		t.Fatalf("subscribe panicking consumer: %v", subscribeErr)
	}
	service = integrationServiceWithEvents(t, pool, panicBus)
	_, err = service.Approve(t.Context(), EntitySalesReceipt, DocumentRevisionInput{
		DocumentID: created.DocumentID, Revision: submitted.Approval.Revision,
	}, integrationApprovalActor(t, integrationActorTwo, "event-panicked-approve"))
	if !errors.As(err, &domainErr) || domainErr.Kind != ErrorInternal {
		t.Fatalf("panicking subscriber failure = %#v", err)
	}
	assertPendingApprovalRollback(t, pool, created.DocumentID, submitted.Approval.Revision)
}

func subscribeRejectCreatedDocument(t *testing.T, bus *txevent.Bus, entity string) *string {
	t.Helper()
	createdDocumentID := new(string)
	if err := bus.Subscribe(DocumentCreatedTopic(entity), "reject-created-"+entity,
		func(_ context.Context, _ pgx.Tx, event txevent.Event) error {
			created, ok := event.(DocumentCreatedEvent)
			if !ok || created.Entity != entity {
				return errors.New("unexpected created event")
			}
			*createdDocumentID = created.DocumentID
			return errors.New("downstream creation failed")
		}); err != nil {
		t.Fatalf("subscribe created %s: %v", entity, err)
	}
	return createdDocumentID
}

func assertCreatedDocumentRolledBack(t *testing.T, pool *pgxpool.Pool, entity, documentID string) {
	t.Helper()
	if documentID == "" {
		t.Fatalf("created subscriber did not receive %s", entity)
	}
	var documents, details, approvals int64
	if err := pool.QueryRow(t.Context(), `SELECT
		(SELECT count(*) FROM vou_documents WHERE id=$1),
		(SELECT count(*) FROM vou_sale_outbound_details WHERE document_id=$1) +
		(SELECT count(*) FROM vou_purchase_inbound_details WHERE document_id=$1) +
		(SELECT count(*) FROM vou_expense_payment_details WHERE document_id=$1),
		(SELECT count(*) FROM approval_entries WHERE domain='vou' AND entity=$2 AND subject_id=$1)`,
		documentID, entity).Scan(&documents, &details, &approvals); err != nil {
		t.Fatalf("read rolled back %s: %v", entity, err)
	}
	if documents != 0 || details != 0 || approvals != 0 {
		t.Fatalf("rolled back %s facts = documents:%d details:%d approvals:%d", entity, documents, details, approvals)
	}
}

func approveEventTestDocument(t *testing.T, service *Service, entity string, draft DraftInput) (MutationResult, DocumentView) {
	t.Helper()
	created, err := service.Create(t.Context(), entity, CreateInput{Data: draft},
		integrationApprovalActor(t, integrationActorOne, "event-source-create"))
	if err != nil {
		t.Fatalf("create %s source: %v", entity, err)
	}
	submitted, err := service.Submit(t.Context(), entity, DocumentRevisionInput{
		DocumentID: created.DocumentID, Revision: created.Approval.Revision,
	}, integrationApprovalActor(t, integrationActorOne, "event-source-submit"))
	if err != nil {
		t.Fatalf("submit %s source: %v", entity, err)
	}
	approved, err := service.Approve(t.Context(), entity, DocumentRevisionInput{
		DocumentID: created.DocumentID, Revision: submitted.Approval.Revision,
	}, integrationApprovalActor(t, integrationActorOne, "event-source-approve"))
	if err != nil {
		t.Fatalf("approve %s source: %v", entity, err)
	}
	view, err := service.Get(t.Context(), entity, GetInput{DocumentID: created.DocumentID})
	if err != nil {
		t.Fatalf("get %s source: %v", entity, err)
	}
	return approved, view
}

func TestVOUSalesChainCreatedSubscriberFailureRollsBackDocumentIntegration(t *testing.T) {
	pool := vouIntegrationPool(t)
	truncateVOU(t, pool)
	t.Cleanup(func() { truncateVOU(t, pool) })
	refs := prepareReferences(t, pool)
	bus := txevent.NewBus()
	createdDocumentID := subscribeRejectCreatedDocument(t, bus, EntitySaleOutbound)
	service := integrationServiceWithEvents(t, pool, bus)
	order, orderView := approvedSalesOrder(t, service, refs, "2")

	_, err := service.Create(t.Context(), EntitySaleOutbound, CreateInput{Data: DraftInput{
		BusinessDate: "2026-07-25", SourceDocumentID: order.DocumentID, Warehouse: &refs.warehouse,
		SourceLines: []SourceQuantityLineInput{{
			SourceLineID: orderView.Data.ProductLines[0].LineID, BaseQuantity: "1",
		}},
	}}, integrationApprovalActor(t, integrationActorOne, "created-outbound-rollback"))
	if err == nil {
		t.Fatal("created subscriber failure did not reject sale outbound")
	}
	assertCreatedDocumentRolledBack(t, pool, EntitySaleOutbound, *createdDocumentID)
}

func TestVOUWorkflowSalesChainCreatedSubscriberFailureRollsBackDocumentIntegration(t *testing.T) {
	pool := vouIntegrationPool(t)
	truncateVOU(t, pool)
	t.Cleanup(func() { truncateVOU(t, pool) })
	refs := prepareReferences(t, pool)
	bus := txevent.NewBus()
	createdDocumentID := subscribeRejectCreatedDocument(t, bus, EntitySaleOutbound)
	service := integrationServiceWithEvents(t, pool, bus)
	order, orderView := approvedSalesOrder(t, service, refs, "2")
	tx, err := pool.Begin(t.Context())
	if err != nil {
		t.Fatalf("begin workflow transaction: %v", err)
	}
	defer tx.Rollback(t.Context()) //nolint:errcheck

	_, err = service.CreateWorkflowSaleOutbound(t.Context(), tx, order.DocumentID, WorkflowSaleOutboundInitial{
		BusinessDate: "2026-07-25", WarehouseObjectID: refs.warehouse.ObjectID,
		Lines: []SourceQuantityLineInput{{
			SourceLineID: orderView.Data.ProductLines[0].LineID, BaseQuantity: "1",
		}},
	}, "workflow-created-outbound-rollback")
	if err == nil {
		t.Fatal("workflow created subscriber failure did not reject sale outbound")
	}
	if rollbackErr := tx.Rollback(t.Context()); rollbackErr != nil {
		t.Fatalf("roll back failed workflow transaction: %v", rollbackErr)
	}
	assertCreatedDocumentRolledBack(t, pool, EntitySaleOutbound, *createdDocumentID)
}

func TestVOUWorkflowIndependentWriterSubscriberFailureRollsBackDocumentIntegration(t *testing.T) {
	t.Run(EntityPurchaseInbound, func(t *testing.T) {
		pool := vouIntegrationPool(t)
		truncateVOU(t, pool)
		t.Cleanup(func() { truncateVOU(t, pool) })
		refs := prepareReferences(t, pool)
		activateSettlementLedgerForParty(t, pool, "supplier", refs.supplier, 0, "2026-07-01")
		bus := txevent.NewBus()
		createdDocumentID := subscribeRejectCreatedDocument(t, bus, EntityPurchaseInbound)
		service := integrationServiceWithEvents(t, pool, bus)
		order, orderView := approveEventTestDocument(t, service, EntityPurchaseOrder, DraftInput{
			BusinessDate: "2026-07-28", Currency: "CNY",
			Supplier: &refs.supplier, Purchaser: &refs.employee, Warehouse: &refs.warehouse,
			ProductLines: []ProductLineInput{integrationProductLine(t, refs.product, "2", "12.00")},
		})
		tx, err := pool.Begin(t.Context())
		if err != nil {
			t.Fatalf("begin purchase-inbound workflow: %v", err)
		}
		defer tx.Rollback(t.Context()) //nolint:errcheck
		_, err = service.CreateWorkflowPurchaseInbound(t.Context(), tx, order.DocumentID, WorkflowPurchaseInboundInitial{
			BusinessDate: "2026-07-29", WarehouseObjectID: refs.warehouse.ObjectID,
			Lines: []SourceQuantityLineInput{{
				SourceLineID: orderView.Data.ProductLines[0].LineID, BaseQuantity: "1",
			}},
		}, "workflow-purchase-inbound-rollback")
		if err == nil {
			t.Fatal("created subscriber failure did not reject workflow purchase inbound")
		}
		if rollbackErr := tx.Rollback(t.Context()); rollbackErr != nil {
			t.Fatalf("roll back purchase-inbound workflow: %v", rollbackErr)
		}
		assertCreatedDocumentRolledBack(t, pool, EntityPurchaseInbound, *createdDocumentID)
	})

	t.Run(EntityExpensePayment, func(t *testing.T) {
		pool := vouIntegrationPool(t)
		truncateVOU(t, pool)
		t.Cleanup(func() { truncateVOU(t, pool) })
		refs := prepareReferences(t, pool)
		bus := txevent.NewBus()
		createdDocumentID := subscribeRejectCreatedDocument(t, bus, EntityExpensePayment)
		service := integrationServiceWithEvents(t, pool, bus)
		reimbursement, _ := approveEventTestDocument(t, service, EntityExpenseReimbursement, DraftInput{
			BusinessDate: "2026-07-24", Currency: "CNY", Employee: &refs.employee, FundAccount: &refs.fundAccount,
			ExpenseLines: []ExpenseLineInput{{Category: "交通", Description: "出租车", Amount: "20.00"}},
		})
		tx, err := pool.Begin(t.Context())
		if err != nil {
			t.Fatalf("begin expense-payment workflow: %v", err)
		}
		defer tx.Rollback(t.Context()) //nolint:errcheck
		_, err = service.CreateWorkflowExpensePayment(t.Context(), tx, reimbursement.DocumentID,
			WorkflowExpensePaymentInitial{FundAccountObjectID: refs.fundAccount.ObjectID},
			"workflow-expense-payment-rollback")
		if err == nil {
			t.Fatal("created subscriber failure did not reject workflow expense payment")
		}
		if rollbackErr := tx.Rollback(t.Context()); rollbackErr != nil {
			t.Fatalf("roll back expense-payment workflow: %v", rollbackErr)
		}
		assertCreatedDocumentRolledBack(t, pool, EntityExpensePayment, *createdDocumentID)
	})
}

func assertPendingApprovalRollback(t *testing.T, pool *pgxpool.Pool, documentID string, revision int64) {
	t.Helper()
	status, actualRevision := documentState(t, pool, documentID)
	if status != approval.StatusPending || actualRevision != revision {
		t.Fatalf("document state after rollback = %s/%d, want %s/%d", status, actualRevision, approval.StatusPending, revision)
	}
	if count := approvalEventCount(t, pool, documentID); count != 2 {
		t.Fatalf("approval event count after rollback = %d, want 2", count)
	}
}

func TestVOUUnapprovedSubscriberFailureRestoresApprovalIntegration(t *testing.T) {
	pool := vouIntegrationPool(t)
	truncateVOU(t, pool)
	t.Cleanup(func() { truncateVOU(t, pool) })
	setupEventEffectsTable(t, pool)
	refs := prepareReferences(t, pool)
	service := integrationServiceWithEvents(t, pool, txevent.NewBus())
	created, approved := createApprovedReceipt(t, service, refs)

	bus := txevent.NewBus()
	if err := ApprovalTopic(EntitySalesReceipt).Subscribe(bus, "reversal-writer",
		func(ctx context.Context, tx pgx.Tx, event approval.Event[ApprovalPayload]) error {
			if event.Action != approval.ActionUnapproved {
				return nil
			}
			_, execErr := tx.Exec(ctx, `
				INSERT INTO txevent_vou_test_effects (id, document_id, topic)
				VALUES ($1, $2, $3)`, newID(), event.Entry.SubjectID, ApprovalTopic(EntitySalesReceipt).Name())
			return execErr
		}); err != nil {
		t.Fatalf("subscribe reversal writer: %v", err)
	}
	if err := ApprovalTopic(EntitySalesReceipt).Subscribe(bus, "reversal-failure",
		func(_ context.Context, _ pgx.Tx, event approval.Event[ApprovalPayload]) error {
			if event.Action != approval.ActionUnapproved {
				return nil
			}
			return errors.New("cannot reverse ledger")
		}); err != nil {
		t.Fatalf("subscribe reversal failure: %v", err)
	}
	service = integrationServiceWithEvents(t, pool, bus)

	_, err := service.Unapprove(t.Context(), EntitySalesReceipt, ReverseInput{
		DocumentID: created.DocumentID, Revision: approved.Approval.Revision, Reason: "回滚测试",
	}, integrationApprovalActor(t, integrationActorTwo, "event-receipt-unapprove-rollback"))
	var domainErr *DomainError
	if !errors.As(err, &domainErr) || domainErr.Kind != ErrorInternal {
		t.Fatalf("unapprove failure = %#v", err)
	}
	status, revision := documentState(t, pool, created.DocumentID)
	if status != approval.StatusApproved || revision != approved.Approval.Revision {
		t.Fatalf("document state after unapprove rollback = %s/%d, want %s/%d",
			status, revision, approval.StatusApproved, approved.Approval.Revision)
	}
	if count := approvalEventCount(t, pool, created.DocumentID); count != 3 {
		t.Fatalf("approval event count after unapprove rollback = %d, want 3", count)
	}
	if count := eventEffectCount(t, pool, created.DocumentID); count != 0 {
		t.Fatalf("reversal subscriber effects after rollback = %d, want 0", count)
	}
}

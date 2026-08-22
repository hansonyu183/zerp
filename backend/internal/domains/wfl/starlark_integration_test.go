//go:build integration

package wfl

import (
	"context"
	"fmt"
	"io"
	"log/slog"
	"os"
	"strings"
	"testing"

	voudomain "github.com/hansonyu183/zerp/backend/internal/domains/vou"
	"github.com/hansonyu183/zerp/backend/internal/platform/txevent"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type integrationRuntime struct {
	trialActions
	source any
}

func (r *integrationRuntime) LoadWorkflowSource(context.Context, pgx.Tx, string, string) (any, error) {
	return r.source, nil
}

func workflowIntegrationPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	databaseURL := strings.TrimSpace(os.Getenv("TEST_DATABASE_URL"))
	expectedName := strings.TrimSpace(os.Getenv("TEST_POSTGRES_DB"))
	if databaseURL == "" || expectedName == "" || !strings.HasSuffix(expectedName, "_test") {
		t.Fatal("safe TEST_DATABASE_URL and TEST_POSTGRES_DB ending in _test are required")
	}
	pool, err := pgxpool.New(t.Context(), databaseURL)
	if err != nil {
		t.Fatalf("connect workflow integration database: %v", err)
	}
	t.Cleanup(pool.Close)
	return pool
}

func TestStarlarkDefinitionTrialPublishAndEnableIntegration(t *testing.T) {
	pool := workflowIntegrationPool(t)
	runtime := &integrationRuntime{source: map[string]any{"warehouseObjectId": "01J00000000000000000000001"}}
	service, err := NewService(pool, txevent.NewBus(), runtime, slog.New(slog.NewTextHandler(io.Discard, nil)))
	if err != nil {
		t.Fatalf("create workflow service: %v", err)
	}
	code := "integration-" + strings.ToLower(newID()[:8])
	script := `root = node(key="order", name="采购订单", entity="purchase-order")
child = node(key="inbound", name="采购入库", entity="purchase-inbound")
workflow(code="` + code + `", name="集成流程", root=root, edges=[
  edge(source=root, target=child, relation="inbound", action=purchase_inbound(initial={
    "warehouseObjectId": "01J00000000000000000000001",
    "businessDate": "2026-08-16",
    "lines": [{"sourceLineId": "01J00000000000000000000003", "baseQuantity": "1"}],
  })),
])`
	created, err := service.DefinitionCreate(t.Context(), DefinitionCreateInput{Script: script}, "01J00000000000000000000000")
	if err != nil {
		t.Fatalf("create definition: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM app_role_permissions WHERE permission_id IN (SELECT id FROM app_permissions WHERE domain='wfl' AND entity=$1)`, code)
		_, _ = pool.Exec(context.Background(), `DELETE FROM app_permissions WHERE domain='wfl' AND entity=$1`, code)
		_, _ = pool.Exec(context.Background(), `DELETE FROM wfl_definition_revisions WHERE definition_id=$1`, created.DefinitionID)
		_, _ = pool.Exec(context.Background(), `DELETE FROM wfl_process_definitions WHERE id=$1`, created.DefinitionID)
	})
	trial, err := service.DefinitionTrial(t.Context(), DefinitionTrialInput{
		DefinitionID: created.DefinitionID, Revision: created.Revision,
		Source: DefinitionTrialSource{Entity: "purchase-order", DocumentID: "01J00000000000000000000002"},
	}, "01J00000000000000000000000", "integration-trial")
	if err != nil || !trial.Matched || len(trial.PlannedActions) != 1 {
		t.Fatalf("trial = %+v, err=%v", trial, err)
	}
	publishedValue, err := service.DefinitionAction(t.Context(), "publish", DefinitionActionInput{
		DefinitionID: created.DefinitionID, Revision: created.Revision,
	}, "01J00000000000000000000000")
	if err != nil {
		t.Fatalf("publish definition: %v", err)
	}
	published := publishedValue.(DefinitionView)
	if published.PublishedRevision == nil {
		t.Fatal("published revision is missing")
	}
	enabledValue, err := service.DefinitionAction(t.Context(), "enable", DefinitionActionInput{
		DefinitionID: published.DefinitionID, Revision: published.Revision,
	}, "01J00000000000000000000000")
	if err != nil || enabledValue.(DefinitionView).Status != DefinitionEnabled {
		t.Fatalf("enable definition = %+v, err=%v", enabledValue, err)
	}
}

func TestApprovedExistingRootUsesStartedPublishedRevisionAcrossRootKeyChangeAndNewMatchIntegration(t *testing.T) {
	pool := workflowIntegrationPool(t)
	ctx := t.Context()
	actorID, definitionID, processID, rootNodeID := newID(), newID(), newID(), newID()
	rootDocumentID, oldDocumentID, newDocumentID, newPaymentSourceID := newID(), newID(), newID(), newID()
	rootDocumentNo, oldDocumentNo, newDocumentNo, newPaymentSourceNo := "EXR-20260816-9001", "EXP-20260816-9001", "EXP-20260816-9002", "EXR-20260816-9002"
	oldFundAccountID, newFundAccountID := newID(), newID()
	code := "fixed-revision-" + strings.ToLower(newID()[:8])
	secondCode := "fixed-match-" + strings.ToLower(newID()[:8])
	oldScript := workflowExpensePaymentScript(code, "expense", "old-payment", oldFundAccountID)
	newScript := workflowExpensePaymentScript(code, "replacement-expense", "new-payment", newFundAccountID)
	secondScript := workflowExpensePaymentScript(secondCode, "second-expense", "second-payment", newFundAccountID)
	oldCompiled, err := compileDefinitionScript(oldScript)
	if err != nil {
		t.Fatalf("compile started workflow revision: %v", err)
	}
	newCompiled, err := compileDefinitionScript(newScript)
	if err != nil {
		t.Fatalf("compile current workflow revision: %v", err)
	}
	secondCompiled, err := compileDefinitionScript(secondScript)
	if err != nil {
		t.Fatalf("compile second matching workflow: %v", err)
	}
	fixtureTx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatalf("begin workflow document fixture: %v", err)
	}
	defer fixtureTx.Rollback(ctx) //nolint:errcheck
	if _, err = fixtureTx.Exec(ctx, `
		INSERT INTO vou_documents(id,entity,document_no,status,business_date,currency,total_amount_cents,created_by,updated_by)
		VALUES
			($1,'expense-reimbursement',$2,'DRAFT',DATE '2026-08-16','CNY',1,$4,$4),
			($3,'expense-payment',$5,'DRAFT',DATE '2026-08-16','CNY',1,$4,$4),
			($6,'expense-payment',$7,'DRAFT',DATE '2026-08-16','CNY',1,$4,$4),
			($8,'expense-reimbursement',$9,'DRAFT',DATE '2026-08-16','CNY',1,$4,$4)
	`, rootDocumentID, rootDocumentNo, oldDocumentID, actorID, oldDocumentNo, newDocumentID, newDocumentNo, newPaymentSourceID, newPaymentSourceNo); err != nil {
		t.Fatalf("insert workflow documents: %v", err)
	}
	if _, err = fixtureTx.Exec(ctx, `
		INSERT INTO vou_expense_reimbursement_details(
			document_id,employee_object_id,employee_version_id,employee_code,employee_name
		) VALUES
			($1,$3,$4,'fixture-employee','测试员工'),
			($2,$3,$4,'fixture-employee','测试员工')
	`, rootDocumentID, newPaymentSourceID, actorID, newID()); err != nil {
		t.Fatalf("insert workflow reimbursement details: %v", err)
	}
	if _, err = fixtureTx.Exec(ctx, `
		INSERT INTO vou_expense_payment_details(
			document_id,source_reimbursement_id,
			employee_object_id,employee_version_id,employee_code,employee_name,
			fund_account_object_id,fund_account_version_id,fund_account_code,fund_account_name
		) VALUES
			($1,$3,$5,$6,'fixture-employee','测试员工',$7,$8,'fixture-fund','测试资金账户'),
			($2,$4,$5,$6,'fixture-employee','测试员工',$7,$8,'fixture-fund','测试资金账户')
	`, oldDocumentID, newDocumentID, rootDocumentID, newPaymentSourceID, actorID, newID(), oldFundAccountID, newID()); err != nil {
		t.Fatalf("insert workflow payment details: %v", err)
	}
	if err = fixtureTx.Commit(ctx); err != nil {
		t.Fatalf("commit workflow document fixture: %v", err)
	}
	if _, err = pool.Exec(ctx, `
		INSERT INTO wfl_process_definitions(
			id,code,name,status,revision,draft_script,draft_compiled,published_revision,created_by,updated_by
		) VALUES($1,$2,'固定修订流程','ENABLED',2,$3,$4,2,$5,$5)
	`, definitionID, code, newScript, mustJSON(newCompiled), actorID); err != nil {
		t.Fatalf("insert workflow definition: %v", err)
	}
	if _, err = pool.Exec(ctx, `
		INSERT INTO wfl_definition_revisions(definition_id,revision,script,compiled,published_by)
		VALUES($1,1,$2,$3,$4),($1,2,$5,$6,$4)
	`, definitionID, oldScript, mustJSON(oldCompiled), actorID, newScript, mustJSON(newCompiled)); err != nil {
		t.Fatalf("insert workflow revisions: %v", err)
	}
	if _, err = pool.Exec(ctx, `
		INSERT INTO wfl_process_definitions(
			id,code,name,status,revision,draft_script,draft_compiled,published_revision,created_by,updated_by
		) VALUES($1,$2,'另一匹配流程','ENABLED',1,$3,$4,1,$5,$5)
	`, newID(), secondCode, secondScript, mustJSON(secondCompiled), actorID); err != nil {
		t.Fatalf("insert second matching workflow definition: %v", err)
	}
	if _, err = pool.Exec(ctx, `
		INSERT INTO wfl_definition_revisions(definition_id,revision,script,compiled,published_by)
		SELECT id,1,$2,$3,$4 FROM wfl_process_definitions WHERE code=$1
	`, secondCode, secondScript, mustJSON(secondCompiled), actorID); err != nil {
		t.Fatalf("insert second matching workflow revision: %v", err)
	}
	if _, err = pool.Exec(ctx, `
		INSERT INTO wfl_definition_instances(
			id,definition_id,root_document_id,root_document_no,root_entity,definition_code,definition_name,started_definition_revision,created_by,updated_by
		) VALUES($1,$2,$3,$4,'expense-reimbursement',$5,'固定修订流程',1,$6,$6)
	`, processID, definitionID, rootDocumentID, rootDocumentNo, code, actorID); err != nil {
		t.Fatalf("insert workflow instance: %v", err)
	}
	if _, err = pool.Exec(ctx, `
		INSERT INTO wfl_node_instances(id,process_id,node_key,node_name,document_id,document_no,document_entity,trigger_event)
		VALUES($1,$2,'expense','费用报销',$3,$4,'expense-reimbursement','APPROVED')
	`, rootNodeID, processID, rootDocumentID, rootDocumentNo); err != nil {
		t.Fatalf("insert workflow root node: %v", err)
	}
	runtime := &fixedRevisionRuntime{
		source:           map[string]any{"amount": "1"},
		oldFundAccountID: oldFundAccountID,
		oldPayment:       BusinessObjectReference{Entity: "expense-payment", DocumentID: oldDocumentID, DocumentNo: oldDocumentNo},
		newPayment:       BusinessObjectReference{Entity: "expense-payment", DocumentID: newDocumentID, DocumentNo: newDocumentNo},
	}
	service, err := NewService(pool, txevent.NewBus(), runtime, slog.New(slog.NewTextHandler(io.Discard, nil)))
	if err != nil {
		t.Fatalf("create workflow service: %v", err)
	}
	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatalf("begin reapproval: %v", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	err = service.handleApproved(ctx, tx, voudomain.DocumentApprovedEvent{
		Entity: "expense-reimbursement", DocumentID: rootDocumentID, DocumentNo: rootDocumentNo,
		ActorID: actorID, RequestID: "fixed-revision-reapproval",
	})
	if err != nil {
		t.Fatalf("reapprove existing workflow root: %v", err)
	}
	if err = tx.Commit(ctx); err != nil {
		t.Fatalf("commit reapproval: %v", err)
	}
	if got := runtime.expensePaymentFundAccountIDs; len(got) != 1 || got[0] != oldFundAccountID {
		t.Fatalf("reapproval actions = %v, want only started revision fund account %q", got, oldFundAccountID)
	}
}

func workflowExpensePaymentScript(code, rootKey, targetKey, fundAccountID string) string {
	return `root = node(key="` + rootKey + `", name="费用报销", entity="expense-reimbursement")
payment = node(key="` + targetKey + `", name="费用付款", entity="expense-payment")
workflow(code="` + code + `", name="固定修订流程", root=root, edges=[
  edge(source=root, target=payment, relation="payment", action=expense_payment(initial={"fundAccountObjectId": "` + fundAccountID + `"})),
])`
}

type fixedRevisionRuntime struct {
	source                       any
	oldFundAccountID             string
	oldPayment, newPayment       BusinessObjectReference
	expensePaymentFundAccountIDs []string
}

func (r *fixedRevisionRuntime) LoadWorkflowSource(context.Context, pgx.Tx, string, string) (any, error) {
	return r.source, nil
}

func (r *fixedRevisionRuntime) CreateExpensePayment(_ context.Context, _ pgx.Tx, input WorkflowActionInput[ExpensePaymentInitial]) (BusinessObjectReference, error) {
	r.expensePaymentFundAccountIDs = append(r.expensePaymentFundAccountIDs, input.Initial.FundAccountObjectID)
	if input.Initial.FundAccountObjectID == r.oldFundAccountID {
		return r.oldPayment, nil
	}
	return r.newPayment, nil
}

func (*fixedRevisionRuntime) CreatePurchaseInbound(context.Context, pgx.Tx, WorkflowActionInput[PurchaseInboundInitial]) (BusinessObjectReference, error) {
	return BusinessObjectReference{}, fmt.Errorf("unexpected purchase_inbound action")
}

func (*fixedRevisionRuntime) CreateSaleOutbound(context.Context, pgx.Tx, WorkflowActionInput[SaleOutboundInitial]) (BusinessObjectReference, error) {
	return BusinessObjectReference{}, fmt.Errorf("unexpected sale_outbound action")
}

func (*fixedRevisionRuntime) CreateSaleDelivery(context.Context, pgx.Tx, WorkflowActionInput[SaleDeliveryInitial]) (BusinessObjectReference, error) {
	return BusinessObjectReference{}, fmt.Errorf("unexpected sale_delivery action")
}

func (*fixedRevisionRuntime) CreateSaleSignoff(context.Context, pgx.Tx, WorkflowActionInput[SaleSignoffInitial]) (BusinessObjectReference, error) {
	return BusinessObjectReference{}, fmt.Errorf("unexpected sale_signoff action")
}

func (*fixedRevisionRuntime) CreateSaleReturn(context.Context, pgx.Tx, WorkflowActionInput[SaleReturnInitial]) (BusinessObjectReference, error) {
	return BusinessObjectReference{}, fmt.Errorf("unexpected sale_return action")
}

var _ WorkflowRuntime = (*integrationRuntime)(nil)
var _ WorkflowRuntime = (*fixedRevisionRuntime)(nil)

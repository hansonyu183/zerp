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
	"github.com/hansonyu183/zerp/backend/internal/platform/approval"
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

func TestApprovedExistingRootUsesStoredApprovalEntryAcrossNewVersionAndNewMatchIntegration(t *testing.T) {
	pool := workflowIntegrationPool(t)
	ctx := t.Context()
	actorID, reviewerID, definitionID, processID, rootNodeID := newID(), newID(), newID(), newID(), newID()
	rootDocumentID, oldDocumentID, newDocumentID, newPaymentSourceID := newID(), newID(), newID(), newID()
	rootDocumentNo, oldDocumentNo, newDocumentNo, newPaymentSourceNo := "EXR-20260816-9001", "EXP-20260816-9001", "EXP-20260816-9002", "EXR-20260816-9002"
	oldFundAccountID, newFundAccountID := newID(), newID()
	code := "fixed-revision-" + strings.ToLower(newID()[:8])
	secondCode := "fixed-match-" + strings.ToLower(newID()[:8])
	oldScript := workflowExpensePaymentScript(code, "流程 V1", "expense", "old-payment", oldFundAccountID)
	newScript := workflowExpensePaymentScript(code, "流程 V2", "replacement-expense", "new-payment", newFundAccountID)
	secondScript := `root = node(key="purchase", name="采购订单", entity="purchase-order")
child = node(key="inbound", name="采购入库", entity="purchase-inbound")
workflow(code="` + secondCode + `", name="另一流程", root=root, edges=[
  edge(source=root, target=child, relation="inbound", action=purchase_inbound(initial={})),
])`
	oldCompiled, err := CompileDefinitionScript(oldScript)
	if err != nil {
		t.Fatalf("compile started workflow revision: %v", err)
	}
	newCompiled, err := CompileDefinitionScript(newScript)
	if err != nil {
		t.Fatalf("compile current workflow revision: %v", err)
	}
	secondCompiled, err := CompileDefinitionScript(secondScript)
	if err != nil {
		t.Fatalf("compile second matching workflow: %v", err)
	}
	fixtureTx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatalf("begin workflow document fixture: %v", err)
	}
	defer fixtureTx.Rollback(ctx) //nolint:errcheck
	rootApprovalID, oldApprovalID := newID(), newID()
	newApprovalID, sourceApprovalID := newID(), newID()
	if _, err = fixtureTx.Exec(ctx, `
		INSERT INTO approval_entries(id,domain,entity,subject_id,status,revision,created_by,created_at,updated_by,updated_at)
		VALUES
			($6,'vou','expense-reimbursement',$1,'DRAFT',1,$5,now(),$5,now()),
			($7,'vou','expense-payment',$2,'DRAFT',1,$5,now(),$5,now()),
			($8,'vou','expense-payment',$3,'DRAFT',1,$5,now(),$5,now()),
			($9,'vou','expense-reimbursement',$4,'DRAFT',1,$5,now(),$5,now())
	`, rootDocumentID, oldDocumentID, newDocumentID, newPaymentSourceID, actorID,
		rootApprovalID, oldApprovalID, newApprovalID, sourceApprovalID); err != nil {
		t.Fatalf("insert workflow approvals: %v", err)
	}
	if _, err = fixtureTx.Exec(ctx, `
		INSERT INTO vou_documents(id,entity,document_no,approval_entry_id,business_date,currency,total_amount_cents)
		VALUES
			($1,'expense-reimbursement',$2,$9,DATE '2026-08-16','CNY',1),
			($3,'expense-payment',$4,$10,DATE '2026-08-16','CNY',1),
			($5,'expense-payment',$6,$11,DATE '2026-08-16','CNY',1),
			($7,'expense-reimbursement',$8,$12,DATE '2026-08-16','CNY',1)
	`, rootDocumentID, rootDocumentNo, oldDocumentID, oldDocumentNo, newDocumentID,
		newDocumentNo, newPaymentSourceID, newPaymentSourceNo,
		rootApprovalID, oldApprovalID, newApprovalID, sourceApprovalID); err != nil {
		t.Fatalf("insert workflow documents: %v", err)
	}
	if _, err = fixtureTx.Exec(ctx, `
		INSERT INTO vou_expense_reimbursement_details(
			document_id,employee_object_id,employee_approval_entry_id,employee_code,employee_name
		) VALUES
			($1,$3,$4,'fixture-employee','测试员工'),
			($2,$3,$4,'fixture-employee','测试员工')
	`, rootDocumentID, newPaymentSourceID, actorID, newID()); err != nil {
		t.Fatalf("insert workflow reimbursement details: %v", err)
	}
	if _, err = fixtureTx.Exec(ctx, `
		INSERT INTO vou_expense_payment_details(
			document_id,source_reimbursement_id,
			employee_object_id,employee_approval_entry_id,employee_code,employee_name,
			fund_account_object_id,fund_account_approval_entry_id,fund_account_code,fund_account_name
		) VALUES
			($1,$3,$5,$6,'fixture-employee','测试员工',$7,$8,'fixture-fund','测试资金账户'),
			($2,$4,$5,$6,'fixture-employee','测试员工',$7,$8,'fixture-fund','测试资金账户')
	`, oldDocumentID, newDocumentID, rootDocumentID, newPaymentSourceID, actorID, newID(), oldFundAccountID, newID()); err != nil {
		t.Fatalf("insert workflow payment details: %v", err)
	}
	if err = fixtureTx.Commit(ctx); err != nil {
		t.Fatalf("commit workflow document fixture: %v", err)
	}
	oldDefinitionApprovalID, newDefinitionApprovalID, draftDefinitionApprovalID := newID(), newID(), newID()
	secondDefinitionID, secondDefinitionApprovalID := newID(), newID()
	if _, err = pool.Exec(ctx, `
		INSERT INTO dcl_subjects(id,entity,code,created_at,created_by)
		VALUES($1,'wfl-process-definition',$2,now(),$3),($4,'wfl-process-definition',$5,now(),$3)
	`, definitionID, code, actorID, secondDefinitionID, secondCode); err != nil {
		t.Fatalf("insert workflow subjects: %v", err)
	}
	if _, err = pool.Exec(ctx, `
		INSERT INTO wfl_definition_runtime_states(subject_id,enabled,updated_by)
		VALUES($1,true,$2),($3,true,$2)
	`, definitionID, actorID, secondDefinitionID); err != nil {
		t.Fatalf("insert workflow runtime states: %v", err)
	}
	if _, err = pool.Exec(ctx, `
		INSERT INTO approval_entries(id,domain,entity,subject_id,version_no,status,revision,created_by,created_at,updated_by,updated_at,submitted_by,submitted_at,approved_by,approved_at)
		VALUES
			($1,'dcl','wfl-process-definition',$2,1,'APPROVED',3,$5,now(),$6,now(),$5,now(),$6,now()),
			($3,'dcl','wfl-process-definition',$2,2,'APPROVED',3,$5,now(),$6,now(),$5,now(),$6,now()),
			($4,'dcl','wfl-process-definition',$7,1,'APPROVED',3,$5,now(),$6,now(),$5,now(),$6,now()),
			($8,'dcl','wfl-process-definition',$2,3,'DRAFT',1,$5,now(),$5,now(),NULL,NULL,NULL,NULL)
	`, oldDefinitionApprovalID, definitionID, newDefinitionApprovalID, secondDefinitionApprovalID, actorID, reviewerID, secondDefinitionID, draftDefinitionApprovalID); err != nil {
		t.Fatalf("insert workflow approval versions: %v", err)
	}
	if _, err = pool.Exec(ctx, `
		INSERT INTO dcl_wfl_process_definition_versions(approval_entry_id,definition_id,script,compiled,created_by,updated_by)
		VALUES($1,$2,$3,$4,$5,$5),($6,$2,$7,$8,$5,$5),($9,$10,$11,$12,$5,$5),($13,$2,$7,$8,$5,$5)
	`, oldDefinitionApprovalID, definitionID, oldScript, mustJSON(oldCompiled), actorID,
		newDefinitionApprovalID, newScript, mustJSON(newCompiled), secondDefinitionApprovalID, secondDefinitionID, secondScript, mustJSON(secondCompiled), draftDefinitionApprovalID); err != nil {
		t.Fatalf("insert workflow definition payloads: %v", err)
	}
	if _, err = pool.Exec(ctx, `
		INSERT INTO wfl_definition_instances(
			id,definition_id,root_document_id,root_document_no,root_entity,definition_code,definition_name,definition_approval_entry_id,created_by,updated_by
		) VALUES($1,$2,$3,$4,'expense-reimbursement',$5,'流程 V1',$6,$7,$7)
	`, processID, definitionID, rootDocumentID, rootDocumentNo, code, oldDefinitionApprovalID, actorID); err != nil {
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
	queryActor, err := approval.TrustedSystemActor("wfl-current-with-candidate")
	if err != nil {
		t.Fatalf("create query actor: %v", err)
	}
	current, err := service.DefinitionQuery(ctx, DefinitionQueryInput{Page: 1, PageSize: 20, Keyword: code}, queryActor)
	if err != nil {
		t.Fatalf("query current definition with candidate: %v", err)
	}
	if current.Total != 1 || len(current.Items) != 1 || current.Items[0].Approval.ApprovalEntryID != newDefinitionApprovalID {
		t.Fatalf("current query with candidate = %#v, want latest approved V2 only", current)
	}
	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatalf("begin reapproval: %v", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	approvedStatus := approval.StatusApproved
	pendingStatus := approval.StatusPending
	fromRevision, toRevision := int64(2), int64(3)
	err = service.handleApproval(ctx, tx, approval.Event[voudomain.ApprovalPayload]{
		Entry: approval.Entry{EntryRef: approval.EntryRef{
			ID: "01J00000000000000000042", Domain: "vou", Entity: "expense-reimbursement", SubjectID: rootDocumentID,
		}, Status: approvedStatus, Revision: toRevision},
		Action: approval.ActionApproved, FromStatus: &pendingStatus, ToStatus: &approvedStatus,
		FromRevision: &fromRevision, ToRevision: &toRevision, ActorID: actorID, RequestID: "fixed-revision-reapproval",
		Payload: voudomain.ApprovalPayload{DocumentID: rootDocumentID, DocumentNo: rootDocumentNo,
			Entity: "expense-reimbursement"},
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
	var historicalName, historicalEntry string
	if err = pool.QueryRow(ctx, `SELECT definition_name,definition_approval_entry_id FROM wfl_definition_instances WHERE id=$1`, processID).Scan(&historicalName, &historicalEntry); err != nil {
		t.Fatalf("read historical workflow instance: %v", err)
	}
	if historicalName != "流程 V1" || historicalEntry != oldDefinitionApprovalID {
		t.Fatalf("historical workflow instance = (%q,%q), want V1 snapshot", historicalName, historicalEntry)
	}
	tx, err = pool.Begin(ctx)
	if err != nil {
		t.Fatalf("begin new workflow root: %v", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	err = service.handleApproval(ctx, tx, approval.Event[voudomain.ApprovalPayload]{
		Entry:  approval.Entry{EntryRef: approval.EntryRef{ID: sourceApprovalID, Domain: "vou", Entity: "expense-reimbursement", SubjectID: newPaymentSourceID}, Status: approvedStatus, Revision: toRevision},
		Action: approval.ActionApproved, FromStatus: &pendingStatus, ToStatus: &approvedStatus,
		FromRevision: &fromRevision, ToRevision: &toRevision, ActorID: actorID, RequestID: "fixed-revision-new-root",
		Payload: voudomain.ApprovalPayload{DocumentID: newPaymentSourceID, DocumentNo: newPaymentSourceNo,
			Entity: "expense-reimbursement"},
	})
	if err != nil {
		t.Fatalf("start new workflow root from latest approved version: %v", err)
	}
	if err = tx.Commit(ctx); err != nil {
		t.Fatalf("commit new workflow root: %v", err)
	}
	var currentName, currentEntry string
	if err = pool.QueryRow(ctx, `SELECT definition_name,definition_approval_entry_id FROM wfl_definition_instances WHERE root_document_id=$1`, newPaymentSourceID).Scan(&currentName, &currentEntry); err != nil {
		t.Fatalf("read current workflow instance: %v", err)
	}
	if currentName != "流程 V2" || currentEntry != newDefinitionApprovalID {
		t.Fatalf("current workflow instance = (%q,%q), want latest V2 snapshot", currentName, currentEntry)
	}

	// Cleanup test definitions
	_, _ = pool.Exec(ctx, `DELETE FROM wfl_node_instances WHERE process_id=$1`, rootNodeID)
	_, _ = pool.Exec(ctx, `DELETE FROM wfl_definition_instances WHERE id=$1`, processID)
	_, _ = pool.Exec(ctx, `DELETE FROM dcl_wfl_process_definition_versions WHERE approval_entry_id IN ($1,$2,$3,$4)`, oldDefinitionApprovalID, newDefinitionApprovalID, secondDefinitionApprovalID, draftDefinitionApprovalID)
	_, _ = pool.Exec(ctx, `DELETE FROM approval_events WHERE domain='dcl' AND entity='wfl-process-definition' AND subject_id IN ($1,$2)`, definitionID, secondDefinitionID)
	_, _ = pool.Exec(ctx, `DELETE FROM approval_entries WHERE domain='dcl' AND entity='wfl-process-definition' AND subject_id IN ($1,$2)`, definitionID, secondDefinitionID)
	_, _ = pool.Exec(ctx, `DELETE FROM wfl_definition_runtime_states WHERE subject_id IN ($1,$2)`, definitionID, secondDefinitionID)
	_, _ = pool.Exec(ctx, `DELETE FROM dcl_subjects WHERE entity='wfl-process-definition' AND id IN ($1,$2)`, definitionID, secondDefinitionID)
}

func workflowExpensePaymentScript(code, name, rootKey, targetKey, fundAccountID string) string {
	return `root = node(key="` + rootKey + `", name="费用报销", entity="expense-reimbursement")
payment = node(key="` + targetKey + `", name="费用付款", entity="expense-payment")
workflow(code="` + code + `", name="` + name + `", root=root, edges=[
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

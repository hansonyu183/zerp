//go:build integration

package workflowactions

import (
	"context"
	"io"
	"log/slog"
	"os"
	"strings"
	"testing"

	auxdomain "github.com/hansonyu183/zerp/backend/internal/domains/auxiliary"
	bobdomain "github.com/hansonyu183/zerp/backend/internal/domains/bob"
	voudomain "github.com/hansonyu183/zerp/backend/internal/domains/vou"
	wfldomain "github.com/hansonyu183/zerp/backend/internal/domains/wfl"
	"github.com/hansonyu183/zerp/backend/internal/integrations/auxiliaryrefs"
	"github.com/hansonyu183/zerp/backend/internal/platform/txevent"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/oklog/ulid/v2"
)

func workflowActionIntegrationPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	databaseURL := strings.TrimSpace(os.Getenv("TEST_DATABASE_URL"))
	expectedName := strings.TrimSpace(os.Getenv("TEST_POSTGRES_DB"))
	if databaseURL == "" || expectedName == "" || !strings.HasSuffix(expectedName, "_test") {
		t.Fatal("safe TEST_DATABASE_URL and TEST_POSTGRES_DB ending in _test are required")
	}
	pool, err := pgxpool.New(t.Context(), databaseURL)
	if err != nil {
		t.Fatalf("connect workflow-action integration database: %v", err)
	}
	t.Cleanup(pool.Close)
	var actualName string
	if err = pool.QueryRow(t.Context(), `SELECT current_database()`).Scan(&actualName); err != nil || actualName != expectedName {
		t.Fatalf("integration database = %q, want %q, err=%v", actualName, expectedName, err)
	}
	return pool
}

func approveWorkflowReference(t *testing.T, service *bobdomain.Service, entity string, data bobdomain.CreateDetailInput, actorID string) voudomain.ReferenceInput {
	t.Helper()
	created, err := service.Create(t.Context(), entity, bobdomain.CreateInput{Data: data}, actorID, "wfl-reference-create")
	if err != nil {
		t.Fatalf("create %s: %v", entity, err)
	}
	submitted, err := service.Submit(t.Context(), entity, bobdomain.VersionRevisionInput{
		ObjectID: created.ObjectID, VersionID: created.VersionID, Revision: created.Revision,
	}, actorID, "wfl-reference-submit")
	if err != nil {
		t.Fatalf("submit %s: %v", entity, err)
	}
	approved, err := service.Approve(t.Context(), entity, bobdomain.ReviewInput{
		ObjectID: created.ObjectID, VersionID: created.VersionID, Revision: submitted.Revision,
	}, actorID, "wfl-reference-approve")
	if err != nil {
		t.Fatalf("approve %s: %v", entity, err)
	}
	return voudomain.ReferenceInput{ObjectID: approved.ObjectID, VersionID: approved.VersionID}
}

func createApprovedReimbursement(t *testing.T, service *voudomain.Service, employee voudomain.ReferenceInput, actorID, requestID string) voudomain.MutationResult {
	t.Helper()
	created, err := service.Create(t.Context(), voudomain.EntityExpenseReimbursement, voudomain.CreateInput{Data: voudomain.DraftInput{
		BusinessDate: "2026-08-16", Currency: "CNY", Employee: &employee,
		ExpenseLines: []voudomain.ExpenseLineInput{{Category: "交通", Description: "流程纵切", Amount: "20.00"}},
	}}, actorID, requestID+"-create")
	if err != nil {
		t.Fatalf("create reimbursement: %v", err)
	}
	checked, err := service.Check(t.Context(), voudomain.EntityExpenseReimbursement, voudomain.DocumentRevisionInput{
		DocumentID: created.DocumentID, Revision: created.Revision,
	}, actorID, requestID+"-check")
	if err != nil {
		t.Fatalf("check reimbursement: %v", err)
	}
	approved, err := service.Approve(t.Context(), voudomain.EntityExpenseReimbursement, voudomain.DocumentRevisionInput{
		DocumentID: created.DocumentID, Revision: checked.Revision,
	}, actorID, requestID+"-approve")
	if err != nil {
		t.Fatalf("approve reimbursement: %v", err)
	}
	return approved
}

func TestExpenseWorkflowRunsThroughRealVOUAdapterInOneApproval(t *testing.T) {
	pool := workflowActionIntegrationPool(t)
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	actorID := ulid.Make().String()
	suffix := strings.ToLower(ulid.Make().String()[:10])
	bobService := bobdomain.NewService(pool)
	employee := approveWorkflowReference(t, bobService, bobdomain.EntityEmployee, bobdomain.CreateDetailInput{
		Code: "WE" + suffix, Name: "流程员工",
	}, actorID)
	fund := approveWorkflowReference(t, bobService, bobdomain.EntityFundAccount, bobdomain.CreateDetailInput{
		Code: "WF" + suffix, Name: "流程资金账户", Currency: "CNY",
	}, actorID)
	bus := txevent.NewBus()
	vouService, err := voudomain.NewService(pool, bobService, auxiliaryrefs.New(auxdomain.NewService(pool)), bus,
		voudomain.AttachmentOptions{Root: t.TempDir()}, logger)
	if err != nil {
		t.Fatalf("create VOU service: %v", err)
	}
	wflService, err := wfldomain.NewService(pool, bus, New(vouService), logger)
	if err != nil {
		t.Fatalf("create WFL service: %v", err)
	}

	trialSource := createApprovedReimbursement(t, vouService, employee, actorID, "wfl-trial-source")
	code := "expense-" + suffix
	script := `root = node(key="reimbursement", name="费用报销", entity="expense-reimbursement")
payment = node(key="payment", name="费用付款", entity="expense-payment")
workflow(code="` + code + `", name="费用付款纵切", root=root, edges=[
  edge(source=root, target=payment, relation="payment", action=expense_payment(initial={"fundAccountObjectId":"` + fund.ObjectID + `"})),
])`
	definition, err := wflService.DefinitionCreate(t.Context(), wfldomain.DefinitionCreateInput{Script: script}, actorID)
	if err != nil {
		t.Fatalf("create definition: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM app_role_permissions WHERE permission_id IN (SELECT id FROM app_permissions WHERE domain='wfl' AND entity=$1)`, code)
		_, _ = pool.Exec(context.Background(), `DELETE FROM app_permissions WHERE domain='wfl' AND entity=$1`, code)
		_, _ = pool.Exec(context.Background(), `DELETE FROM wfl_runtime_audit_events WHERE definition_id=$1`, definition.DefinitionID)
		_, _ = pool.Exec(context.Background(), `DELETE FROM wfl_create_child_requests WHERE definition_id=$1`, definition.DefinitionID)
		_, _ = pool.Exec(context.Background(), `DELETE FROM wfl_action_executions WHERE process_id IN (SELECT id FROM wfl_definition_instances WHERE definition_id=$1)`, definition.DefinitionID)
		_, _ = pool.Exec(context.Background(), `DELETE FROM wfl_node_instances WHERE process_id IN (SELECT id FROM wfl_definition_instances WHERE definition_id=$1)`, definition.DefinitionID)
		_, _ = pool.Exec(context.Background(), `DELETE FROM wfl_definition_instances WHERE definition_id=$1`, definition.DefinitionID)
		_, _ = pool.Exec(context.Background(), `DELETE FROM wfl_definition_revisions WHERE definition_id=$1`, definition.DefinitionID)
		_, _ = pool.Exec(context.Background(), `DELETE FROM wfl_process_definitions WHERE id=$1`, definition.DefinitionID)
	})
	trial, err := wflService.DefinitionTrial(t.Context(), wfldomain.DefinitionTrialInput{
		DefinitionID: definition.DefinitionID, Revision: definition.Revision,
		Source: wfldomain.DefinitionTrialSource{Entity: voudomain.EntityExpenseReimbursement, DocumentID: trialSource.DocumentID},
	}, actorID, "wfl-real-trial")
	if err != nil || !trial.Matched || len(trial.PlannedActions) != 1 {
		t.Fatalf("real trial = %+v, err=%v", trial, err)
	}
	publishedValue, err := wflService.DefinitionAction(t.Context(), "publish", wfldomain.DefinitionActionInput{
		DefinitionID: definition.DefinitionID, Revision: definition.Revision,
	}, actorID)
	if err != nil {
		t.Fatalf("publish definition: %v", err)
	}
	published := publishedValue.(wfldomain.DefinitionView)
	if _, err = wflService.DefinitionAction(t.Context(), "enable", wfldomain.DefinitionActionInput{
		DefinitionID: definition.DefinitionID, Revision: published.Revision,
	}, actorID); err != nil {
		t.Fatalf("enable definition: %v", err)
	}

	approved := createApprovedReimbursement(t, vouService, employee, actorID, "wfl-formal-source")
	instances, err := wflService.InstanceQueryByDefinitionCode(t.Context(), code, wfldomain.InstanceQueryInput{Page: 1, PageSize: 20})
	if err != nil || instances.Total != 1 {
		t.Fatalf("instances = %+v, err=%v", instances, err)
	}
	instance, err := wflService.InstanceGetByDefinitionCode(t.Context(), code, wfldomain.InstanceGetInput{ProcessID: instances.Items[0].ProcessID})
	if err != nil || len(instance.Nodes) != 2 || instance.RootDocumentID != approved.DocumentID {
		t.Fatalf("instance = %+v, err=%v", instance, err)
	}
	var paymentID string
	if err = pool.QueryRow(t.Context(), `SELECT id FROM vou_documents
		WHERE parent_document_id=$1 AND entity='expense-payment' AND status='DRAFT'`, approved.DocumentID).Scan(&paymentID); err != nil {
		t.Fatalf("workflow payment draft: %v", err)
	}
	if instance.Nodes[1].DocumentID != paymentID || instance.Nodes[1].BusinessParentDocumentID != approved.DocumentID {
		t.Fatalf("payment node = %+v, paymentId=%s", instance.Nodes[1], paymentID)
	}
	originalProcessID := instance.ProcessID
	originalPaymentNodeID := instance.Nodes[1].NodeInstanceID
	reversed, err := vouService.Unapprove(t.Context(), voudomain.EntityExpenseReimbursement, voudomain.ReverseInput{
		DocumentID: approved.DocumentID, Revision: approved.Revision, Reason: "验证流程重建",
	}, actorID, "wfl-formal-unapprove")
	if err != nil {
		t.Fatalf("unapprove workflow source: %v", err)
	}
	reapproved, err := vouService.Approve(t.Context(), voudomain.EntityExpenseReimbursement, voudomain.DocumentRevisionInput{
		DocumentID: approved.DocumentID, Revision: reversed.Revision,
	}, actorID, "wfl-formal-reapprove")
	if err != nil || reapproved.Status != voudomain.StatusApproved {
		t.Fatalf("reapprove workflow source = %+v, err=%v", reapproved, err)
	}
	instance, err = wflService.InstanceGetByDefinitionCode(t.Context(), code, wfldomain.InstanceGetInput{ProcessID: originalProcessID})
	if err != nil || len(instance.Nodes) != 2 {
		t.Fatalf("rebuilt instance = %+v, err=%v", instance, err)
	}
	if instance.ProcessID != originalProcessID || instance.Nodes[1].NodeInstanceID != originalPaymentNodeID ||
		instance.Nodes[1].DocumentID == paymentID || instance.Nodes[1].DocumentID == "" {
		t.Fatalf("rebuilt payment node = %+v, originalPayment=%s", instance.Nodes[1], paymentID)
	}
}

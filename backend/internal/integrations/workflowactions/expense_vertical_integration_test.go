//go:build integration

package workflowactions

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"os"
	"strings"
	"testing"

	"github.com/hansonyu183/zerp/backend/internal/api/authorization"
	accdomain "github.com/hansonyu183/zerp/backend/internal/domains/acc"
	auxdomain "github.com/hansonyu183/zerp/backend/internal/domains/auxiliary"
	bobdomain "github.com/hansonyu183/zerp/backend/internal/domains/bob"
	dcldomain "github.com/hansonyu183/zerp/backend/internal/domains/dcl"
	voudomain "github.com/hansonyu183/zerp/backend/internal/domains/vou"
	wfldomain "github.com/hansonyu183/zerp/backend/internal/domains/wfl"
	"github.com/hansonyu183/zerp/backend/internal/integrations/auxiliaryrefs"
	"github.com/hansonyu183/zerp/backend/internal/platform/approval"
	"github.com/hansonyu183/zerp/backend/internal/platform/txevent"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/oklog/ulid/v2"
)

func workflowActor(t *testing.T, requestID string) approval.Actor {
	t.Helper()
	actorID := "01J00000000000000000000000"
	if strings.Contains(requestID, "approve") || strings.Contains(requestID, "reject") {
		actorID = "01J00000000000000000000001"
	}
	actor, err := approval.UserActor(authorization.Principal{ActorID: actorID}, requestID)
	if err != nil {
		t.Fatalf("create workflow integration actor: %v", err)
	}
	return actor
}

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

func approveWorkflowReference(t *testing.T, service *bobdomain.Service, entity string, data bobdomain.CreateDetailInput, submitterID, reviewerID string) voudomain.ReferenceInput {
	t.Helper()
	if entity == bobdomain.EntityOperatingEntity {
		declarations := dcldomain.NewOperatingEntityService(workflowActionIntegrationPool(t), service, authorization.Func(nil), txevent.NewBus())
		created, err := declarations.Create(t.Context(), dcldomain.OperatingEntityCreateInput{Data: dcldomain.OperatingEntityData{
			Name: data.Name, ShortName: data.ShortName, TaxNumber: data.TaxNumber,
			Address: data.Address, Phone: data.Phone, Remark: data.Remark,
		}}, workflowActor(t, "wfl-reference-create"))
		if err != nil {
			t.Fatalf("create operating entity: %v", err)
		}
		submitted, err := declarations.Submit(t.Context(), dcldomain.OperatingEntityVersionInput{
			ObjectID: created.ObjectID, ApprovalEntryID: created.Approval.ApprovalEntryID,
			ApprovalRevision: created.Approval.Revision,
		}, workflowActor(t, "wfl-reference-submit"))
		if err != nil {
			t.Fatalf("submit operating entity: %v", err)
		}
		approved, err := declarations.Approve(t.Context(), dcldomain.OperatingEntityVersionInput{
			ObjectID: submitted.ObjectID, ApprovalEntryID: submitted.Approval.ApprovalEntryID,
			ApprovalRevision: submitted.Approval.Revision,
		}, workflowActor(t, "wfl-reference-approve"))
		if err != nil {
			t.Fatalf("approve operating entity: %v", err)
		}
		return voudomain.ReferenceInput{ObjectID: approved.ObjectID, ApprovalEntryID: approved.Approval.ApprovalEntryID}
	}
	if entity == bobdomain.EntityFundAccount {
		declarations := dcldomain.NewFundAccountService(workflowActionIntegrationPool(t), service, authorization.Func(nil), txevent.NewBus())
		created, err := declarations.Create(t.Context(), dcldomain.FundAccountCreateInput{Data: dcldomain.FundAccountData{
			Name: data.Name, Currency: data.Currency, OperatingEntityID: data.OperatingEntityID,
			AccountName: data.AccountName, BankName: data.BankName, BankBranch: data.BankBranch,
			AccountNumber: data.AccountNumber, Remark: data.Remark,
		}}, workflowActor(t, "wfl-reference-create"))
		if err != nil {
			t.Fatalf("create fund account: %v", err)
		}
		submitted, err := declarations.Submit(t.Context(), dcldomain.FundAccountVersionInput{
			ObjectID: created.ObjectID, ApprovalEntryID: created.Approval.ApprovalEntryID,
			ApprovalRevision: created.Approval.Revision,
		}, workflowActor(t, "wfl-reference-submit"))
		if err != nil {
			t.Fatalf("submit fund account: %v", err)
		}
		approved, err := declarations.Approve(t.Context(), dcldomain.FundAccountVersionInput{
			ObjectID: submitted.ObjectID, ApprovalEntryID: submitted.Approval.ApprovalEntryID,
			ApprovalRevision: submitted.Approval.Revision,
		}, workflowActor(t, "wfl-reference-approve"))
		if err != nil {
			t.Fatalf("approve fund account: %v", err)
		}
		return voudomain.ReferenceInput{ObjectID: approved.ObjectID, ApprovalEntryID: approved.Approval.ApprovalEntryID}
	}
	t.Fatalf("unsupported workflow reference entity %q", entity)
	return voudomain.ReferenceInput{}
}

func createApprovedReimbursement(t *testing.T, service *voudomain.Service, employee voudomain.ReferenceInput, actorID, requestID string) voudomain.MutationResult {
	t.Helper()
	created, err := service.Create(t.Context(), voudomain.EntityExpenseReimbursement, voudomain.CreateInput{Data: voudomain.DraftInput{
		BusinessDate: "2026-08-16", Currency: "CNY", Employee: &employee,
		ExpenseLines: []voudomain.ExpenseLineInput{{Category: "交通", Description: "流程纵切", Amount: "20.00"}},
	}}, workflowActor(t, requestID+"-create"))
	if err != nil {
		t.Fatalf("create reimbursement: %v", err)
	}
	checked, err := service.Submit(t.Context(), voudomain.EntityExpenseReimbursement, voudomain.DocumentRevisionInput{
		DocumentID: created.DocumentID, Revision: created.Approval.Revision,
	}, workflowActor(t, requestID+"-submit"))
	if err != nil {
		t.Fatalf("check reimbursement: %v", err)
	}
	approved, err := service.Approve(t.Context(), voudomain.EntityExpenseReimbursement, voudomain.DocumentRevisionInput{
		DocumentID: created.DocumentID, Revision: checked.Approval.Revision,
	}, workflowActor(t, requestID+"-approve"))
	if err != nil {
		t.Fatalf("approve reimbursement: %v", err)
	}
	return approved
}

func approveWorkflowEmployee(t *testing.T, pool *pgxpool.Pool, business *bobdomain.Service, bus *txevent.Bus, operatingEntityID, name string) voudomain.ReferenceInput {
	t.Helper()
	employees := dcldomain.NewEmployeeService(pool, business, authorization.Func(nil), bus)
	created, err := employees.Create(t.Context(), dcldomain.EmployeeCreateInput{
		Data: dcldomain.EmployeeInput{Kind: "PERSON", LegalName: name, LegalIdentifier: "110105199001010029", Enabled: true, CurrentOperatingEntityID: operatingEntityID},
	}, workflowActor(t, "wfl-employee-create"))
	if err != nil {
		t.Fatalf("create employee declaration: %v", err)
	}
	if _, err = employees.Get(t.Context(), dcldomain.EmployeeGetInput{ObjectID: created.ObjectID}, workflowActor(t, "wfl-employee-get")); err != nil {
		t.Fatalf("get employee declaration: %v", err)
	}
	pending, err := employees.Submit(t.Context(), dcldomain.EmployeeVersionInput{ObjectID: created.ObjectID, ApprovalEntryID: created.Approval.ApprovalEntryID, ApprovalRevision: created.Approval.Revision}, workflowActor(t, "wfl-employee-submit"))
	if err != nil {
		t.Fatalf("submit employee declaration: %v", err)
	}
	approved, err := employees.Approve(t.Context(), dcldomain.EmployeeVersionInput{ObjectID: pending.ObjectID, ApprovalEntryID: pending.Approval.ApprovalEntryID, ApprovalRevision: pending.Approval.Revision}, workflowActor(t, "wfl-employee-approve"))
	if err != nil {
		t.Fatalf("approve employee declaration: %v", err)
	}
	return voudomain.ReferenceInput{ObjectID: approved.ObjectID, ApprovalEntryID: approved.Approval.ApprovalEntryID}
}

type testWflCompiler struct{}

func (testWflCompiler) Compile(script string) (string, *string, []byte, error) {
	definition, err := wfldomain.CompileDefinitionScript(script)
	if err != nil {
		message := err.Error()
		return "", &message, nil, err
	}
	encoded, jsonErr := json.Marshal(definition)
	if jsonErr != nil {
		return "", nil, nil, jsonErr
	}
	return definition.Code, nil, encoded, nil
}

func TestExpenseWorkflowRunsThroughRealVOUAdapterInOneApproval(t *testing.T) {
	pool := workflowActionIntegrationPool(t)
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	actorID := ulid.Make().String()
	submitterID := ulid.Make().String()
	suffix := strings.ToLower(ulid.Make().String()[:10])
	bus := txevent.NewBus()
	auxiliaryResolver := auxiliaryrefs.New(auxdomain.NewService(pool))
	bobService := bobdomain.NewService(pool, auxiliaryResolver)
	accounting := accdomain.NewService(pool, bobService, authorization.Func(nil), bus)
	operating := approveWorkflowReference(t, bobService, bobdomain.EntityOperatingEntity, bobdomain.CreateDetailInput{
		Name: "流程经营主体", TaxNumber: "TAX" + suffix,
	}, submitterID, actorID)
	employee := approveWorkflowEmployee(t, pool, bobService, bus, operating.ObjectID, "流程员工")
	fund := approveWorkflowReference(t, bobService, bobdomain.EntityFundAccount, bobdomain.CreateDetailInput{
		Code: "WF" + suffix, Name: "流程资金账户", Currency: "CNY", OperatingEntityID: operating.ObjectID,
	}, submitterID, actorID)
	vouService, err := voudomain.NewService(pool, bobService, auxiliaryResolver, bus,
		voudomain.AttachmentOptions{Root: t.TempDir()}, logger, voudomain.WithPeriodWriteControl(accounting), voudomain.WithApprovalAuthorizer(authorization.Func(nil)))
	if err != nil {
		t.Fatalf("create VOU service: %v", err)
	}
	wflService, err := wfldomain.NewService(pool, bus, New(vouService), logger)
	if err != nil {
		t.Fatalf("create WFL service: %v", err)
	}

	code := "expense-" + suffix
	script := `root = node(key="reimbursement", name="费用报销", entity="expense-reimbursement")
payment = node(key="payment", name="费用付款", entity="expense-payment")
workflow(code="` + code + `", name="费用付款纵切", root=root, edges=[
  edge(source=root, target=payment, relation="payment", action=expense_payment(initial={"fundAccountObjectId":"` + fund.ObjectID + `"})),
])`
	definitionActor := workflowActor(t, "wfl-definition-create")
	dclWflService := dcldomain.NewWflProcessDefinitionService(pool, testWflCompiler{}, authorization.Func(nil), bus)
	created, err := dclWflService.Create(t.Context(), dcldomain.WflProcessDefinitionCreateInput{Script: script}, definitionActor)
	if err != nil {
		t.Fatalf("create workflow definition: %v", err)
	}
	trialSource := createApprovedReimbursement(t, vouService, employee, actorID, "wfl-trial-source")
	trial, err := wflService.DefinitionTrial(t.Context(), wfldomain.DefinitionTrialInput{
		DefinitionID: created.DefinitionID, ApprovalEntryID: created.Approval.ApprovalEntryID, Revision: created.Approval.Revision,
		Source: wfldomain.DefinitionTrialSource{Entity: voudomain.EntityExpenseReimbursement, DocumentID: trialSource.DocumentID},
	}, definitionActor)
	if err != nil || !trial.Matched || len(trial.PlannedActions) != 1 {
		t.Fatalf("real trial = %+v, err=%v", trial, err)
	}
	submittedDef, err := dclWflService.Submit(t.Context(), dcldomain.WflProcessDefinitionVersionInput{
		Code: created.Code, ApprovalEntryID: created.Approval.ApprovalEntryID, ApprovalRevision: created.Approval.Revision,
	}, definitionActor)
	if err != nil {
		t.Fatalf("submit workflow definition: %v", err)
	}
	approvedDef, err := dclWflService.Approve(t.Context(), dcldomain.WflProcessDefinitionVersionInput{
		Code: submittedDef.Code, ApprovalEntryID: submittedDef.Approval.ApprovalEntryID, ApprovalRevision: submittedDef.Approval.Revision,
	}, workflowActor(t, "wfl-definition-approve"))
	if err != nil {
		t.Fatalf("approve workflow definition: %v", err)
	}
	enabled, err := dclWflService.Enable(t.Context(), dcldomain.WflProcessDefinitionEnableInput{
		Code: approvedDef.Code, ApprovalEntryID: approvedDef.Approval.ApprovalEntryID,
		ApprovalRevision: approvedDef.Approval.Revision,
	}, definitionActor)
	if err != nil {
		t.Fatalf("enable workflow definition: %v", err)
	}
	definitionID := enabled.DefinitionID
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM app_role_permissions WHERE permission_id IN (SELECT id FROM app_permissions WHERE domain='wfl' AND entity=$1)`, code)
		_, _ = pool.Exec(context.Background(), `DELETE FROM app_permissions WHERE domain='wfl' AND entity=$1`, code)
		_, _ = pool.Exec(context.Background(), `DELETE FROM wfl_runtime_audit_events WHERE definition_id=$1`, definitionID)
		_, _ = pool.Exec(context.Background(), `DELETE FROM wfl_create_child_requests WHERE definition_id=$1`, definitionID)
		_, _ = pool.Exec(context.Background(), `DELETE FROM wfl_action_executions WHERE process_id IN (SELECT id FROM wfl_definition_instances WHERE definition_id=$1)`, definitionID)
		_, _ = pool.Exec(context.Background(), `DELETE FROM wfl_node_instances WHERE process_id IN (SELECT id FROM wfl_definition_instances WHERE definition_id=$1)`, definitionID)
		_, _ = pool.Exec(context.Background(), `DELETE FROM wfl_definition_instances WHERE definition_id=$1`, definitionID)
		_, _ = pool.Exec(context.Background(), `DELETE FROM dcl_wfl_process_definition_versions WHERE definition_id=$1`, definitionID)
		_, _ = pool.Exec(context.Background(), `DELETE FROM approval_events WHERE domain='dcl' AND entity='wfl-process-definition' AND subject_id=$1`, definitionID)
		_, _ = pool.Exec(context.Background(), `DELETE FROM approval_entries WHERE domain='dcl' AND entity='wfl-process-definition' AND subject_id=$1`, definitionID)
		_, _ = pool.Exec(context.Background(), `DELETE FROM wfl_definition_runtime_states WHERE subject_id=$1`, definitionID)
		_, _ = pool.Exec(context.Background(), `DELETE FROM dcl_subjects WHERE entity='wfl-process-definition' AND id=$1`, definitionID)
	})
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
	if err = pool.QueryRow(t.Context(), `SELECT document.id FROM vou_documents document
		JOIN approval_entries entry ON entry.id=document.approval_entry_id
		WHERE document.parent_document_id=$1 AND document.entity='expense-payment' AND entry.status='DRAFT'`, approved.DocumentID).Scan(&paymentID); err != nil {
		t.Fatalf("workflow payment draft: %v", err)
	}
	if instance.Nodes[1].DocumentID != paymentID || instance.Nodes[1].BusinessParentDocumentID != approved.DocumentID {
		t.Fatalf("payment node = %+v, paymentId=%s", instance.Nodes[1], paymentID)
	}
	originalProcessID := instance.ProcessID
	originalPaymentNodeID := instance.Nodes[1].NodeInstanceID
	reversed, err := vouService.Unapprove(t.Context(), voudomain.EntityExpenseReimbursement, voudomain.ReverseInput{
		DocumentID: approved.DocumentID, Revision: approved.Approval.Revision, Reason: "验证流程重建",
	}, workflowActor(t, "wfl-formal-unapprove"))
	if err != nil {
		t.Fatalf("unapprove workflow source: %v", err)
	}
	reapproved, err := vouService.Approve(t.Context(), voudomain.EntityExpenseReimbursement, voudomain.DocumentRevisionInput{
		DocumentID: approved.DocumentID, Revision: reversed.Approval.Revision,
	}, workflowActor(t, "wfl-formal-reapprove"))
	if err != nil || reapproved.Approval.Status != approval.StatusApproved {
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

//go:build integration

package wfl

import (
	"io"
	"log/slog"
	"strings"
	"testing"

	voudomain "github.com/hansonyu183/zerp/backend/internal/domains/vou"
	"github.com/hansonyu183/zerp/backend/internal/platform/txevent"
)

func TestWorkflowInstanceStoresAndReadsTypedCounterpartySnapshotIntegration(t *testing.T) {
	pool := workflowIntegrationPool(t)
	ctx := t.Context()
	actorID, reviewerID, definitionID, definitionApprovalEntryID := newID(), newID(), newID(), newID()
	documentID, documentApprovalEntryID := newID(), newID()
	counterpartyObjectID, counterpartyApprovalEntryID := newID(), newID()
	code := "typed-counterparty-" + strings.ToLower(definitionID[len(definitionID)-8:])
	script := `root = node(key="reimbursement", name="费用报销", entity="expense-reimbursement")
workflow(code="` + code + `", name="类型化往来对象流程", root=root)`
	compiled, err := CompileDefinitionScript(script)
	if err != nil {
		t.Fatalf("compile workflow definition: %v", err)
	}

	if _, err = pool.Exec(ctx, `
		INSERT INTO dcl_subjects(id,entity,code,created_at,created_by)
		VALUES($1,'wfl-process-definition',$2,now(),$3)
	`, definitionID, code, actorID); err != nil {
		t.Fatalf("insert workflow subject: %v", err)
	}
	if _, err = pool.Exec(ctx, `
		INSERT INTO wfl_definition_runtime_states(subject_id,enabled,updated_by)
		VALUES($1,true,$2)
	`, definitionID, actorID); err != nil {
		t.Fatalf("insert workflow runtime state: %v", err)
	}
	if _, err = pool.Exec(ctx, `
		INSERT INTO approval_entries(id,domain,entity,subject_id,version_no,status,revision,created_by,created_at,updated_by,updated_at,submitted_by,submitted_at,approved_by,approved_at)
		VALUES($1,'dcl','wfl-process-definition',$2,1,'APPROVED',1,$3,now(),$3,now(),$3,now(),$6,now()),
		      ($4,'vou','expense-reimbursement',$5,1,'APPROVED',1,$3,now(),$3,now(),$3,now(),$6,now())
	`, definitionApprovalEntryID, definitionID, actorID, documentApprovalEntryID, documentID, reviewerID); err != nil {
		t.Fatalf("insert approval entries: %v", err)
	}
	if _, err = pool.Exec(ctx, `
		INSERT INTO dcl_wfl_process_definition_versions(approval_entry_id,definition_id,script,compiled,created_by,updated_by)
		VALUES($1,$2,$3,$4,$5,$5)
	`, definitionApprovalEntryID, definitionID, script, mustJSON(compiled), actorID); err != nil {
		t.Fatalf("insert workflow definition version: %v", err)
	}
	if _, err = pool.Exec(ctx, `
		WITH document AS (
			INSERT INTO vou_documents(id,entity,document_no,approval_entry_id,business_date,currency,total_amount_cents)
			VALUES($1,'expense-reimbursement','EXR-20260901-0001',$2,DATE '2026-09-01','CNY',1)
			RETURNING id
		)
		INSERT INTO vou_expense_reimbursement_details(document_id,employee_object_id,employee_approval_entry_id,employee_code,employee_name)
		SELECT id,$3,$4,'EMP-0001','报销员工' FROM document
	`, documentID, documentApprovalEntryID, counterpartyObjectID, counterpartyApprovalEntryID); err != nil {
		t.Fatalf("insert root document: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(ctx, `DELETE FROM wfl_runtime_audit_events WHERE process_id IN (SELECT id FROM wfl_definition_instances WHERE definition_id=$1)`, definitionID)
		_, _ = pool.Exec(ctx, `DELETE FROM wfl_node_instances WHERE process_id IN (SELECT id FROM wfl_definition_instances WHERE definition_id=$1)`, definitionID)
		_, _ = pool.Exec(ctx, `DELETE FROM wfl_definition_instances WHERE definition_id=$1`, definitionID)
		_, _ = pool.Exec(ctx, `DELETE FROM vou_documents WHERE id=$1`, documentID)
		_, _ = pool.Exec(ctx, `DELETE FROM dcl_wfl_process_definition_versions WHERE approval_entry_id=$1`, definitionApprovalEntryID)
		_, _ = pool.Exec(ctx, `DELETE FROM approval_entries WHERE id IN ($1,$2)`, definitionApprovalEntryID, documentApprovalEntryID)
		_, _ = pool.Exec(ctx, `DELETE FROM wfl_definition_runtime_states WHERE subject_id=$1`, definitionID)
		_, _ = pool.Exec(ctx, `DELETE FROM dcl_subjects WHERE id=$1`, definitionID)
	})

	service, err := NewService(pool, txevent.NewBus(), &integrationRuntime{}, slog.New(slog.NewTextHandler(io.Discard, nil)))
	if err != nil {
		t.Fatalf("create workflow service: %v", err)
	}
	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatalf("begin workflow instance: %v", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	processID, _, created, err := service.ensureRootInstance(ctx, tx, struct {
		id, code, name  string
		approvalEntryID string
		compiled        compiledScriptDefinition
	}{
		id: definitionID, code: code, name: "类型化往来对象流程", approvalEntryID: definitionApprovalEntryID, compiled: compiled,
	}, workflowApprovalEvent{
		Entity: "expense-reimbursement", DocumentID: documentID, DocumentNo: "EXR-20260901-0001", ActorID: actorID, RequestID: "typed-counterparty-snapshot",
		Snapshot: voudomain.ApprovalPayload{Data: voudomain.DocumentDataView{Employee: &voudomain.ReferenceView{
			Entity: "employee", ObjectID: counterpartyObjectID, ApprovalEntryID: counterpartyApprovalEntryID,
			Code: "EMP-0001", Name: "报销员工",
		}}},
	})
	if err != nil {
		t.Fatalf("store workflow instance: %v", err)
	}
	if !created {
		t.Fatal("workflow instance was not created")
	}
	if err = tx.Commit(ctx); err != nil {
		t.Fatalf("commit workflow instance: %v", err)
	}

	var entity, objectID, approvalEntryID, storedCode, name string
	if err = pool.QueryRow(ctx, `
		SELECT counterparty_entity,counterparty_object_id,counterparty_approval_entry_id,counterparty_code,counterparty_name
		FROM wfl_definition_instances WHERE id=$1
	`, processID).Scan(&entity, &objectID, &approvalEntryID, &storedCode, &name); err != nil {
		t.Fatalf("read stored counterparty snapshot: %v", err)
	}
	if entity != "employee" || objectID != counterpartyObjectID || approvalEntryID != counterpartyApprovalEntryID || storedCode != "EMP-0001" || name != "报销员工" {
		t.Fatalf("stored counterparty snapshot = (%q,%q,%q,%q,%q)", entity, objectID, approvalEntryID, storedCode, name)
	}

	page, err := service.InstanceQuery(ctx, InstanceQueryInput{Page: 1, PageSize: 20, CounterpartyObjectID: counterpartyObjectID})
	if err != nil {
		t.Fatalf("query workflow instance history: %v", err)
	}
	if page.Total != 1 || len(page.Items) != 1 || page.Items[0].Counterparty == nil || *page.Items[0].Counterparty != (CounterpartyReference{
		Entity: "employee", ObjectID: counterpartyObjectID, ApprovalEntryID: counterpartyApprovalEntryID, Code: "EMP-0001", Name: "报销员工",
	}) {
		t.Fatalf("workflow instance query counterparty = %#v", page)
	}
	detail, err := service.InstanceGet(ctx, InstanceGetInput{ProcessID: processID})
	if err != nil {
		t.Fatalf("get workflow instance history: %v", err)
	}
	if detail.Counterparty == nil || *detail.Counterparty != *page.Items[0].Counterparty {
		t.Fatalf("workflow instance detail counterparty = %#v, query counterparty = %#v", detail.Counterparty, page.Items[0].Counterparty)
	}
}

//go:build integration

package wfl

import (
	"errors"
	"testing"

	voudomain "github.com/hansonyu183/zerp/backend/internal/domains/vou"
)

func TestGenericExpensePaymentWorkflowIntegration(t *testing.T) {
	pool := workflowIntegrationPool(t)
	truncateWorkflowIntegration(t, pool)
	t.Cleanup(func() { truncateWorkflowIntegration(t, pool) })
	workflows, vouchers, refs := newWorkflowIntegrationServices(t, pool)

	var definitionID, paymentNodeID string
	if err := pool.QueryRow(t.Context(), `SELECT d.id,n.id
		FROM wfl_process_definitions d JOIN wfl_definition_nodes n ON n.definition_id=d.id
		WHERE d.code='expense-payment' AND n.document_entity='expense-payment'`).Scan(&definitionID, &paymentNodeID); err != nil {
		t.Fatalf("find expense workflow definition: %v", err)
	}
	if _, err := pool.Exec(t.Context(), `UPDATE wfl_definition_nodes SET defaults=jsonb_build_object('fundAccountObjectId',$1::text) WHERE id=$2`, refs.fundAccount.ObjectID, paymentNodeID); err != nil {
		t.Fatalf("enable expense workflow: %v", err)
	}
	if _, err := pool.Exec(t.Context(), `UPDATE wfl_process_definitions SET status='ENABLED',revision=revision+1 WHERE id=$1`, definitionID); err != nil {
		t.Fatalf("enable expense workflow status: %v", err)
	}
	defer func() {
		if _, err := pool.Exec(t.Context(), `UPDATE wfl_process_definitions SET status='DRAFT',revision=revision+1 WHERE id=$1`, definitionID); err != nil {
			t.Errorf("restore expense workflow: %v", err)
		}
		if _, err := pool.Exec(t.Context(), `UPDATE wfl_definition_nodes SET defaults='{}'::jsonb WHERE id=$1`, paymentNodeID); err != nil {
			t.Errorf("restore expense workflow defaults: %v", err)
		}
	}()

	createReimbursement := func(requestID string) voudomain.MutationResult {
		created, err := vouchers.Create(t.Context(), voudomain.EntityExpenseReimbursement, voudomain.CreateInput{Data: voudomain.DraftInput{
			BusinessDate: "2026-08-02", Currency: "CNY", Employee: &refs.employee,
			ExpenseLines: []voudomain.ExpenseLineInput{{Category: "交通", Description: "流程测试", Amount: "88.00"}},
		}}, workflowIntegrationActor, requestID+"-create")
		if err != nil {
			t.Fatalf("create reimbursement: %v", err)
		}
		checked, err := vouchers.Check(t.Context(), voudomain.EntityExpenseReimbursement, voudomain.DocumentRevisionInput{DocumentID: created.DocumentID, Revision: created.Revision}, workflowIntegrationActor, requestID+"-check")
		if err != nil {
			t.Fatalf("check reimbursement: %v", err)
		}
		approved, err := vouchers.Approve(t.Context(), voudomain.EntityExpenseReimbursement, voudomain.DocumentRevisionInput{DocumentID: created.DocumentID, Revision: checked.Revision}, workflowIntegrationActor, requestID+"-approve")
		if err != nil {
			t.Fatalf("approve reimbursement: %v (cause: %v)", err, errors.Unwrap(err))
		}
		return approved
	}

	approved := createReimbursement("expense-flow")
	var paymentID, processID string
	var paymentRevision int64
	if err := pool.QueryRow(t.Context(), `SELECT child.id,child.revision,instance.id
		FROM vou_documents child
		JOIN wfl_node_instances node ON node.document_id=child.id
		JOIN wfl_definition_instances instance ON instance.id=node.process_id
		WHERE child.parent_document_id=$1 AND child.entity='expense-payment'`, approved.DocumentID).Scan(&paymentID, &paymentRevision, &processID); err != nil {
		t.Fatalf("find generated expense payment: %v", err)
	}
	checked, err := vouchers.Check(t.Context(), voudomain.EntityExpensePayment, voudomain.DocumentRevisionInput{DocumentID: paymentID, Revision: paymentRevision}, workflowIntegrationActor, "expense-payment-check")
	if err != nil {
		t.Fatalf("check expense payment: %v", err)
	}
	approvedPayment, err := vouchers.Approve(t.Context(), voudomain.EntityExpensePayment, voudomain.DocumentRevisionInput{DocumentID: paymentID, Revision: checked.Revision}, workflowIntegrationActor, "expense-payment-approve")
	if err != nil {
		t.Fatalf("approve expense payment: %v", err)
	}
	finalized, err := vouchers.Finalize(t.Context(), voudomain.EntityExpensePayment, voudomain.FinalizeInput{DocumentID: paymentID, Revision: approvedPayment.Revision}, workflowIntegrationActor, "expense-payment-finalize")
	if err != nil {
		t.Fatalf("finalize expense payment: %v", err)
	}
	instance, err := workflows.InstanceGet(t.Context(), InstanceGetInput{ProcessID: processID})
	if err != nil || instance.Status != InstanceCompleted {
		t.Fatalf("completed instance = %+v, err=%v", instance, err)
	}
	if _, err = vouchers.Unfinalize(t.Context(), voudomain.EntityExpensePayment, voudomain.ReverseInput{DocumentID: paymentID, Revision: finalized.Revision, Reason: "重新处理"}, workflowIntegrationActor, "expense-payment-unfinalize"); err != nil {
		t.Fatalf("unfinalize expense payment: %v", err)
	}
	instance, err = workflows.InstanceGet(t.Context(), InstanceGetInput{ProcessID: processID})
	if err != nil || instance.Status != InstanceActive {
		t.Fatalf("reopened instance = %+v, err=%v", instance, err)
	}

	untouched := createReimbursement("expense-reverse")
	if _, err = vouchers.Unapprove(t.Context(), voudomain.EntityExpenseReimbursement, voudomain.ReverseInput{DocumentID: untouched.DocumentID, Revision: untouched.Revision, Reason: "撤销测试"}, workflowIntegrationActor, "expense-reverse-unapprove"); err != nil {
		t.Fatalf("unapprove reimbursement with untouched child: %v", err)
	}
	var children int
	if err = pool.QueryRow(t.Context(), `SELECT count(*) FROM vou_documents WHERE parent_document_id=$1`, untouched.DocumentID).Scan(&children); err != nil || children != 0 {
		t.Fatalf("children after unapprove = %d, err=%v", children, err)
	}
}

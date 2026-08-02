//go:build integration

package wfl

import (
	"encoding/json"
	"errors"
	"strings"
	"testing"

	voudomain "github.com/hansonyu183/zerp/backend/internal/domains/vou"
	"github.com/hansonyu183/zerp/backend/internal/platform/txevent"
	"github.com/oklog/ulid/v2"
)

func TestDefinitionPermissionLifecycleIntegration(t *testing.T) {
	pool := workflowIntegrationPool(t)
	workflows, err := NewService(pool, nil, txevent.NewBus(), nil)
	if err != nil {
		t.Fatalf("create workflow service: %v", err)
	}
	code := "permission-flow-" + strings.ToLower(ulid.Make().String()[:8])
	rootID := newID()
	input := DefinitionCreateInput{
		Code: code, Name: "权限流程", RootNodeID: rootID, StartCondition: json.RawMessage(`{}`),
		Nodes: []DefinitionNodeInput{{ID: rootID, Key: "root", Name: "销售订单", DocumentEntity: "sale-order", Defaults: json.RawMessage(`{}`)}},
	}
	created, err := workflows.DefinitionCreate(t.Context(), input, workflowIntegrationActor)
	if err != nil {
		t.Fatalf("create definition: %v", err)
	}
	roleID := newID()
	t.Cleanup(func() {
		_, _ = pool.Exec(t.Context(), `DELETE FROM app_role_permissions WHERE role_id=$1`, roleID)
		_, _ = pool.Exec(t.Context(), `DELETE FROM app_roles WHERE id=$1`, roleID)
		_, _ = pool.Exec(t.Context(), `DELETE FROM app_permissions WHERE entity=$1 AND domain='wfl'`, code)
		_, _ = pool.Exec(t.Context(), `DELETE FROM wfl_definition_edges WHERE definition_id=$1`, created.DefinitionID)
		_, _ = pool.Exec(t.Context(), `DELETE FROM wfl_definition_nodes WHERE definition_id=$1`, created.DefinitionID)
		_, _ = pool.Exec(t.Context(), `DELETE FROM wfl_process_definitions WHERE id=$1`, created.DefinitionID)
	})

	var count int
	if err = pool.QueryRow(t.Context(), `SELECT count(*) FROM app_permissions WHERE domain='wfl' AND entity=$1`, code).Scan(&count); err != nil || count != 0 {
		t.Fatalf("draft permissions = %d, err=%v", count, err)
	}
	enabledValue, err := workflows.DefinitionAction(t.Context(), "enable", DefinitionActionInput{DefinitionID: created.DefinitionID, Revision: created.Revision}, workflowIntegrationActor)
	if err != nil {
		t.Fatalf("enable definition: %v", err)
	}
	enabled := enabledValue.(DefinitionView)
	var queryPermissionID string
	if err = pool.QueryRow(t.Context(), `SELECT id FROM app_permissions WHERE path=$1 AND status='ENABLED'`, "/wfl/"+code+"/query").Scan(&queryPermissionID); err != nil {
		t.Fatalf("query permission: %v", err)
	}
	if err = pool.QueryRow(t.Context(), `SELECT count(*) FROM app_permissions WHERE domain='wfl' AND entity=$1 AND status='ENABLED'`, code).Scan(&count); err != nil || count != 3 {
		t.Fatalf("enabled permissions = %d, err=%v", count, err)
	}
	if _, err = pool.Exec(t.Context(), `INSERT INTO app_roles(id,code,name,status) VALUES($1,$2,$3,'ENABLED')`, roleID, code, "权限测试角色"); err != nil {
		t.Fatalf("create role: %v", err)
	}
	if _, err = pool.Exec(t.Context(), `INSERT INTO app_role_permissions(role_id,permission_id) VALUES($1,$2)`, roleID, queryPermissionID); err != nil {
		t.Fatalf("grant dynamic permission: %v", err)
	}
	disabledValue, err := workflows.DefinitionAction(t.Context(), "disable", DefinitionActionInput{DefinitionID: enabled.DefinitionID, Revision: enabled.Revision}, workflowIntegrationActor)
	if err != nil {
		t.Fatalf("disable definition: %v", err)
	}
	disabled := disabledValue.(DefinitionView)
	if err = pool.QueryRow(t.Context(), `SELECT count(*) FROM app_permissions WHERE domain='wfl' AND entity=$1 AND status='DISABLED'`, code).Scan(&count); err != nil || count != 3 {
		t.Fatalf("disabled permissions = %d, err=%v", count, err)
	}
	if err = pool.QueryRow(t.Context(), `SELECT count(*) FROM app_role_permissions WHERE role_id=$1 AND permission_id=$2`, roleID, queryPermissionID).Scan(&count); err != nil || count != 1 {
		t.Fatalf("retained role grant = %d, err=%v", count, err)
	}
	reenabledValue, err := workflows.DefinitionAction(t.Context(), "enable", DefinitionActionInput{DefinitionID: disabled.DefinitionID, Revision: disabled.Revision}, workflowIntegrationActor)
	if err != nil {
		t.Fatalf("reenable definition: %v", err)
	}
	reenabled := reenabledValue.(DefinitionView)
	var reenabledPermissionID string
	if err = pool.QueryRow(t.Context(), `SELECT id FROM app_permissions WHERE path=$1 AND status='ENABLED'`, "/wfl/"+code+"/query").Scan(&reenabledPermissionID); err != nil || reenabledPermissionID != queryPermissionID {
		t.Fatalf("reenabled permission = %q, want %q, err=%v", reenabledPermissionID, queryPermissionID, err)
	}
	input.Code = code + "-changed"
	_, err = workflows.DefinitionSave(t.Context(), DefinitionSaveInput{DefinitionCreateInput: input, DefinitionID: reenabled.DefinitionID, Revision: reenabled.Revision}, workflowIntegrationActor)
	if err == nil {
		t.Fatal("mutable definition code was accepted")
	}
	deleteInput := DefinitionCreateInput{
		Code: code + "-draft", Name: "待删除流程", RootNodeID: newID(), StartCondition: json.RawMessage(`{}`),
	}
	deleteInput.Nodes = []DefinitionNodeInput{{ID: deleteInput.RootNodeID, Key: "root", Name: "销售订单", DocumentEntity: "sale-order", Defaults: json.RawMessage(`{}`)}}
	deletable, err := workflows.DefinitionCreate(t.Context(), deleteInput, workflowIntegrationActor)
	if err != nil {
		t.Fatalf("create deletable definition: %v", err)
	}
	if _, err = workflows.DefinitionAction(t.Context(), "delete", DefinitionActionInput{DefinitionID: deletable.DefinitionID, Revision: deletable.Revision}, workflowIntegrationActor); err != nil {
		t.Fatalf("delete draft definition: %v", err)
	}
	if err = pool.QueryRow(t.Context(), `SELECT count(*) FROM wfl_process_definitions WHERE id=$1`, deletable.DefinitionID).Scan(&count); err != nil || count != 0 {
		t.Fatalf("deleted definition count = %d, err=%v", count, err)
	}
}

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
	page, err := workflows.InstanceQueryByDefinitionCode(t.Context(), "expense-payment", InstanceQueryInput{Page: 1, PageSize: 20})
	if err != nil || len(page.Items) != 1 || len(page.Items[0].CurrentNodes) != 1 || page.Items[0].CurrentNodes[0].DocumentID != paymentID {
		t.Fatalf("current payment node = %+v, err=%v", page.Items, err)
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
	page, err = workflows.InstanceQueryByDefinitionCode(t.Context(), "expense-payment", InstanceQueryInput{Page: 1, PageSize: 20})
	if err != nil || len(page.Items) != 1 || len(page.Items[0].CurrentNodes) != 0 {
		t.Fatalf("completed current nodes = %+v, err=%v", page.Items, err)
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

func TestDynamicWorkflowMultipleCurrentNodesAndIsolationIntegration(t *testing.T) {
	pool := workflowIntegrationPool(t)
	truncateWorkflowIntegration(t, pool)
	workflows, vouchers, refs := newWorkflowIntegrationServices(t, pool)
	code := "branch-flow-" + strings.ToLower(ulid.Make().String()[:8])
	rootID, leftID, rightID := newID(), newID(), newID()
	created, err := workflows.DefinitionCreate(t.Context(), DefinitionCreateInput{
		Code: code, Name: "双分支销售流程", RootNodeID: rootID, StartCondition: json.RawMessage(`{}`),
		Nodes: []DefinitionNodeInput{
			{ID: rootID, Key: "order", Name: "销售订单", DocumentEntity: "sale-order", Defaults: json.RawMessage(`{}`)},
			{ID: leftID, Key: "outbound-a", Name: "销售出库 A", DocumentEntity: "sale-outbound", Defaults: json.RawMessage(`{}`)},
			{ID: rightID, Key: "outbound-b", Name: "销售出库 B", DocumentEntity: "sale-outbound", Defaults: json.RawMessage(`{}`)},
		},
		Edges: []DefinitionEdgeInput{
			{ID: newID(), SourceNodeID: rootID, TargetNodeID: leftID, ConverterKey: "sale-order-to-outbound", Condition: json.RawMessage(`{}`)},
			{ID: newID(), SourceNodeID: rootID, TargetNodeID: rightID, ConverterKey: "sale-order-to-outbound", Condition: json.RawMessage(`{}`)},
		},
	}, workflowIntegrationActor)
	if err != nil {
		t.Fatalf("create branch definition: %v", err)
	}
	t.Cleanup(func() {
		truncateWorkflowIntegration(t, pool)
		_, _ = pool.Exec(t.Context(), `DELETE FROM app_permissions WHERE domain='wfl' AND entity=$1`, code)
		_, _ = pool.Exec(t.Context(), `DELETE FROM wfl_definition_edges WHERE definition_id=$1`, created.DefinitionID)
		_, _ = pool.Exec(t.Context(), `DELETE FROM wfl_definition_nodes WHERE definition_id=$1`, created.DefinitionID)
		_, _ = pool.Exec(t.Context(), `DELETE FROM wfl_process_definitions WHERE id=$1`, created.DefinitionID)
	})
	if _, err = workflows.DefinitionAction(t.Context(), "enable", DefinitionActionInput{DefinitionID: created.DefinitionID, Revision: created.Revision}, workflowIntegrationActor); err != nil {
		t.Fatalf("enable branch definition: %v", err)
	}

	order, _ := createWorkflowDocument(t, vouchers, voudomain.EntitySaleOrder, voudomain.DraftInput{
		BusinessDate: "2026-08-02", Currency: "CNY", Customer: &refs.customer,
		Warehouse:    &refs.warehouse,
		ProductLines: []voudomain.ProductLineInput{{Product: refs.products[0], OrderedQuantity: "2", UnitPrice: "10"}},
	}, false)
	checked, err := vouchers.Check(t.Context(), voudomain.EntitySaleOrder, voudomain.DocumentRevisionInput{DocumentID: order.DocumentID, Revision: order.Revision}, workflowIntegrationActor, "branch-check")
	if err != nil {
		t.Fatalf("check branch order: %v", err)
	}
	if _, err = vouchers.Approve(t.Context(), voudomain.EntitySaleOrder, voudomain.DocumentRevisionInput{DocumentID: order.DocumentID, Revision: checked.Revision}, workflowIntegrationActor, "branch-approve"); err != nil {
		t.Fatalf("approve branch order: %v", err)
	}
	page, err := workflows.InstanceQueryByDefinitionCode(t.Context(), code, InstanceQueryInput{Page: 1, PageSize: 20})
	if err != nil || len(page.Items) != 1 || len(page.Items[0].CurrentNodes) != 2 {
		t.Fatalf("branch current nodes = %+v, err=%v", page.Items, err)
	}
	if _, err = workflows.InstanceGetByDefinitionCode(t.Context(), "purchase-fulfillment", InstanceGetInput{ProcessID: page.Items[0].ProcessID}); err == nil {
		t.Fatal("cross-definition instance read was accepted")
	}
}

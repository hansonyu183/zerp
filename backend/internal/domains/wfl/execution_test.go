package wfl

import (
	"context"
	"testing"
)

func TestExecuteCompiledWorkflowPlansTypedActionsAndUncoveredBranches(t *testing.T) {
	t.Parallel()
	compiled, err := compileDefinitionScript(`
root = node(key="expense", name="费用报销", entity="expense-reimbursement")
payment = node(key="payment", name="费用付款", entity="expense-payment")
ignored = node(key="ignored", name="未命中付款", entity="expense-payment")
workflow(code="expense-flow", name="费用流程", root=root, edges=[
  edge(source=root, target=payment, relation="payment", action=expense_payment(initial=lambda source: {"fundAccountObjectId": source["fundAccountObjectId"]})),
  edge(source=root, target=ignored, relation="ignored", when=lambda source: False, action=expense_payment(initial={})),
])`)
	if err != nil {
		t.Fatalf("compile workflow: %v", err)
	}
	actions := &trialActions{}
	result, err := executeCompiledWorkflow(context.Background(), nil, compiled, "expense", "01J00000000000000000000000", map[string]any{
		"fundAccountObjectId": "01J00000000000000000000001",
	}, actions, "trial-request", "")
	if err != nil {
		t.Fatalf("execute trial workflow: %v", err)
	}
	if len(actions.plans) != 1 || actions.plans[0].Action != ActionExpensePayment {
		t.Fatalf("planned actions = %+v", actions.plans)
	}
	if len(result.Trace) != 1 || result.Trace[0].TargetNodeKey != "payment" || len(result.UncoveredBranches) != 1 || result.UncoveredBranches[0] != "ignored" {
		t.Fatalf("execution result = %+v", result)
	}
}

func TestTrialActionsRejectIncompleteTypedInitialValues(t *testing.T) {
	t.Parallel()
	actions := &trialActions{}
	if _, err := actions.CreatePurchaseInbound(context.Background(), nil, WorkflowActionInput[PurchaseInboundInitial]{}); err == nil {
		t.Fatal("incomplete purchase_inbound initial values were accepted")
	}
	if _, err := actions.CreateSaleDelivery(context.Background(), nil, WorkflowActionInput[SaleDeliveryInitial]{}); err == nil {
		t.Fatal("incomplete sale_delivery initial values were accepted")
	}
}

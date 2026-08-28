package wfl

import (
	"strings"
	"testing"
)

func TestCompileDefinitionScriptRejectsUnsafeOrAmbiguousPrograms(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name   string
		script string
		want   string
	}{
		{
			name:   "import",
			script: `load("remote.star", "workflow")`,
			want:   "imports are not allowed",
		},
		{
			name: "multiple nodes",
			script: `root = node(key="root", name="销售订单", entity="sale-order")
node(key="extra", name="采购订单", entity="purchase-order")
workflow(code="safe-flow", name="安全流程", root=root)`,
			want: "disconnected",
		},
		{
			name: "mutated root",
			script: `root = node(key="root", name="销售订单", entity="sale-order")
root["entity"] = "unknown-document"
workflow(code="safe-flow", name="安全流程", root=root)`,
			want: "node is invalid",
		},
		{
			name: "multiple parents",
			script: `root = node(key="root", name="销售订单", entity="sale-order")
second_source = node(key="second-source", name="第二销售订单", entity="sale-order")
target = node(key="outbound", name="销售出库", entity="sale-outbound")
workflow(
    code="safe-flow",
    name="安全流程",
    root=root,
    edges=[
        edge(source=root, target=target, relation="outbound", action=sale_outbound(initial={})),
        edge(source=second_source, target=target, relation="outbound", action=sale_outbound(initial={})),
    ],
)`,
			want: "multiple parents",
		},
		{
			name: "execution budget",
			script: `def burn():
    for value in range(1000000):
        pass
burn()`,
			want: "too many steps",
		},
		{
			name:   "source size",
			script: strings.Repeat("x", maxWorkflowScriptBytes+1),
			want:   "exceeds",
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			_, err := CompileDefinitionScript(test.script)
			if err == nil || !strings.Contains(err.Error(), test.want) {
				t.Fatalf("compile error = %v, want substring %q", err, test.want)
			}
		})
	}
}

func TestCompileDefinitionScriptProducesRootDefinition(t *testing.T) {
	t.Parallel()
	compiled, err := CompileDefinitionScript(`root = node(key="root", name="销售订单", entity="sale-order")
child = node(key="outbound", name="销售出库", entity="sale-outbound")
workflow(
    code="safe-flow",
    name="安全流程",
    root=root,
    edges=[edge(source=root, target=child, relation="outbound", action=sale_outbound(initial={}))],
)`)
	if err != nil {
		t.Fatalf("compile workflow: %v", err)
	}
	if compiled.Code != "safe-flow" || compiled.Name != "安全流程" {
		t.Fatalf("compiled workflow = %+v", compiled)
	}
	if compiled.RootKey != "root" || len(compiled.Nodes) != 2 || len(compiled.Edges) != 1 {
		t.Fatalf("compiled graph = %+v", compiled)
	}
}

func TestWorkflowDiagnosticIncludesScriptLocation(t *testing.T) {
	t.Parallel()
	_, err := CompileDefinitionScript("root = node(\n")
	if err == nil {
		t.Fatal("invalid workflow compiled")
	}
	diagnostic := workflowDiagnostic(err.Error())
	if diagnostic.Line == 0 || diagnostic.Column == 0 {
		t.Fatalf("diagnostic = %+v, want script location", diagnostic)
	}
}

func TestCompileDefinitionScriptUsesOnlyStaticWorkflowActions(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name           string
		source, target string
		action, want   string
	}{
		{name: "expense payment", source: "expense-reimbursement", target: "expense-payment", action: `expense_payment(initial={"fundAccountObjectId": "01J00000000000000000000000"})`, want: ActionExpensePayment},
		{name: "purchase inbound", source: "purchase-order", target: "purchase-inbound", action: `purchase_inbound(initial={})`, want: ActionPurchaseInbound},
		{name: "sale outbound", source: "sale-order", target: "sale-outbound", action: `sale_outbound(initial={})`, want: ActionSaleOutbound},
		{name: "sale delivery", source: "sale-outbound", target: "sale-delivery", action: `sale_delivery(initial={})`, want: ActionSaleDelivery},
		{name: "sale signoff", source: "sale-delivery", target: "sale-signoff", action: `sale_signoff(initial={})`, want: ActionSaleSignoff},
		{name: "sale return", source: "sale-signoff", target: "sale-return", action: `sale_return(initial={"reason": "拒收"})`, want: ActionSaleReturn},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			script := `root = node(key="root", name="来源", entity="` + test.source + `")
child = node(key="child", name="下级", entity="` + test.target + `")
workflow(code="typed-actions", name="类型化动作", root=root, edges=[
    edge(source=root, target=child, relation="generated", action=` + test.action + `),
])`
			compiled, err := CompileDefinitionScript(script)
			if err != nil {
				t.Fatalf("compile typed workflow action: %v", err)
			}
			if len(compiled.Edges) != 1 || compiled.Edges[0].ActionName != test.want || compiled.Edges[0].Relation != "generated" {
				t.Fatalf("compiled action = %+v, want %q", compiled.Edges, test.want)
			}
		})
	}

	_, err := CompileDefinitionScript(`root = node(key="root", name="来源", entity="expense-reimbursement")
child = node(key="child", name="下级", entity="expense-payment")
workflow(code="dynamic-action", name="动态动作", root=root, edges=[
    edge(source=root, target=child, relation="generated", action=call_action(name="expense_payment")),
])`)
	if err == nil || !strings.Contains(err.Error(), "undefined: call_action") {
		t.Fatalf("dynamic action binding error = %v", err)
	}
}

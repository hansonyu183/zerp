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
        edge(source=root, target=target, converter="sale-order-to-outbound"),
        edge(source=second_source, target=target, converter="sale-order-to-outbound"),
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
			_, err := compileDefinitionScript(test.script)
			if err == nil || !strings.Contains(err.Error(), test.want) {
				t.Fatalf("compile error = %v, want substring %q", err, test.want)
			}
		})
	}
}

func TestCompileDefinitionScriptProducesRootDefinition(t *testing.T) {
	t.Parallel()
	compiled, err := compileDefinitionScript(`root = node(key="root", name="销售订单", entity="sale-order")
child = node(key="outbound", name="销售出库", entity="sale-outbound")
workflow(
    code="safe-flow",
    name="安全流程",
    root=root,
    edges=[edge(source=root, target=child, converter="sale-order-to-outbound")],
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

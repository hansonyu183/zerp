package wfl

import (
	"bytes"
	"encoding/json"
	"fmt"
	"os"
	"reflect"
	"strings"
	"testing"

	"go.starlark.net/starlark"
)

type targetParityCase struct {
	Name    string          `json:"name"`
	Request targetParityReq `json:"request"`
	Source  json.RawMessage `json:"source"`
	Expect  struct {
		Error         string          `json:"error"`
		Graph         json.RawMessage `json:"graph"`
		Evaluation    json.RawMessage `json:"evaluation"`
		Deterministic bool            `json:"deterministic"`
	} `json:"expect"`
}

type targetParityReq struct {
	Operation     string          `json:"operation"`
	SourceNodeKey string          `json:"sourceNodeKey"`
	Input         json.RawMessage `json:"input"`
}

type targetParityEvaluation struct {
	RootMatched bool                 `json:"rootMatched"`
	Branches    []targetParityBranch `json:"branches"`
}

type targetParityBranch struct {
	TargetKey string `json:"targetKey"`
	Matched   bool   `json:"matched"`
	Initial   any    `json:"initial,omitempty"`
}

// TestTargetWflSharedCorpus runs the same machine-readable corpus used by the
// Node and Chromium runners through the current production compiler/evaluator.
// A target runtime therefore cannot pass by validating only its own behavior.
func TestTargetWflSharedCorpus(t *testing.T) {
	corpusData, err := os.ReadFile("../../../../packages/wfl-starlark/tests/corpus.json")
	if err != nil {
		t.Fatalf("read shared WFL corpus: %v", err)
	}
	var corpus []targetParityCase
	if err = json.Unmarshal(corpusData, &corpus); err != nil {
		t.Fatalf("decode shared WFL corpus: %v", err)
	}
	for _, item := range corpus {
		t.Run(item.Name, func(t *testing.T) {
			source := materializeTargetParitySource(t, item.Source)
			first, runErr := runCurrentWflParity(item.Request, source)
			if item.Expect.Error != "" {
				if runErr == nil || !strings.Contains(runErr.Error(), item.Expect.Error) {
					t.Fatalf("error = %v, want substring %q", runErr, item.Expect.Error)
				}
				return
			}
			if runErr != nil {
				t.Fatalf("run current WFL: %v", runErr)
			}
			expected := item.Expect.Graph
			if item.Request.Operation == "evaluate" {
				expected = item.Expect.Evaluation
			}
			assertTargetParityJSON(t, first, expected)
			if item.Expect.Deterministic {
				second, secondErr := runCurrentWflParity(item.Request, source)
				if secondErr != nil {
					t.Fatalf("repeat current WFL: %v", secondErr)
				}
				assertTargetParityJSON(t, second, first)
			}
		})
	}
}

func runCurrentWflParity(request targetParityReq, source string) (json.RawMessage, error) {
	compiled, err := CompileDefinitionScript(source)
	if err != nil {
		return nil, err
	}
	var result any = compiled
	if request.Operation == "evaluate" {
		var input any
		decoder := json.NewDecoder(bytes.NewReader(request.Input))
		decoder.UseNumber()
		if err = decoder.Decode(&input); err != nil {
			return nil, err
		}
		value, valueErr := workflowStarlarkValue(input)
		if valueErr != nil {
			return nil, valueErr
		}
		result, err = evaluateCurrentWfl(compiled, request.SourceNodeKey, value)
		if err != nil {
			return nil, err
		}
	} else if request.Operation != "compile" {
		return nil, fmt.Errorf("unsupported operation %q", request.Operation)
	}
	return json.Marshal(result)
}

func evaluateCurrentWfl(compiled compiledScriptDefinition, sourceNodeKey string, source starlark.Value) (targetParityEvaluation, error) {
	thread := &starlark.Thread{Name: "wfl-target-parity"}
	thread.SetMaxExecutionSteps(maxWorkflowScriptSteps)
	result := targetParityEvaluation{RootMatched: true, Branches: []targetParityBranch{}}
	if sourceNodeKey == compiled.RootKey && compiled.when != nil {
		matched, err := callWorkflowCondition(thread, compiled.when, source)
		if err != nil {
			return result, err
		}
		result.RootMatched = matched
		if !matched {
			return result, nil
		}
	}
	for _, edge := range compiled.Edges {
		if edge.SourceKey != sourceNodeKey {
			continue
		}
		matched := true
		var err error
		if edge.when != nil {
			matched, err = callWorkflowCondition(thread, edge.when, source)
			if err != nil {
				return result, err
			}
		}
		branch := targetParityBranch{TargetKey: edge.TargetKey, Matched: matched}
		if matched {
			initial := edge.initial
			if callable, ok := initial.(starlark.Callable); ok {
				initial, err = starlark.Call(thread, callable, starlark.Tuple{source}, nil)
				if err != nil {
					return result, err
				}
			}
			branch.Initial, err = workflowPlainValue(initial)
			if err != nil {
				return result, err
			}
		}
		result.Branches = append(result.Branches, branch)
	}
	return result, nil
}

func materializeTargetParitySource(t *testing.T, raw json.RawMessage) string {
	t.Helper()
	var source string
	if json.Unmarshal(raw, &source) == nil {
		return source
	}
	var template struct {
		Repeat *struct {
			Text  string `json:"text"`
			Count int    `json:"count"`
		} `json:"repeat"`
		Nodes int `json:"nodes"`
		Edges int `json:"edges"`
	}
	if err := json.Unmarshal(raw, &template); err != nil {
		t.Fatalf("decode source template: %v", err)
	}
	if template.Repeat != nil {
		return strings.Repeat(template.Repeat.Text, template.Repeat.Count)
	}
	if template.Nodes > 0 {
		var nodes strings.Builder
		for index := range template.Nodes {
			fmt.Fprintf(&nodes, "node(key=\"n%d\", name=\"节点%d\", entity=\"sale-order\")\n", index, index)
		}
		return nodes.String() + `workflow(code="node-limit", name="节点限制", root=node(key="root", name="根", entity="sale-order"))`
	}
	if template.Edges > 0 {
		return `root = node(key="root", name="销售订单", entity="sale-order")
child = node(key="child", name="销售出库", entity="sale-outbound")
workflow(code="edge-limit", name="边限制", root=root, edges=[` + strings.Repeat(`edge(source=root, target=child, relation="outbound", action=sale_outbound(initial={})),`, template.Edges) + `])`
	}
	t.Fatal("unknown source template")
	return ""
}

func assertTargetParityJSON(t *testing.T, actual, expected json.RawMessage) {
	t.Helper()
	var actualValue, expectedValue any
	if err := json.Unmarshal(actual, &actualValue); err != nil {
		t.Fatalf("decode actual JSON: %v", err)
	}
	if err := json.Unmarshal(expected, &expectedValue); err != nil {
		t.Fatalf("decode expected JSON: %v", err)
	}
	if !reflect.DeepEqual(actualValue, expectedValue) {
		t.Fatalf("JSON mismatch\nactual: %s\nexpected: %s", actual, expected)
	}
}

package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"syscall/js"

	"go.starlark.net/starlark"
	"go.starlark.net/syntax"
)

const (
	maxScriptBytes = 128 * 1024
	maxSteps       = 100_000
	maxNodes       = 100
	maxEdges       = 200
)

var codePattern = regexp.MustCompile(`^[a-z][a-z0-9-]{1,62}[a-z0-9]$`)

var actions = map[string][2]string{
	"expense_payment":  {"expense-reimbursement", "expense-payment"},
	"purchase_inbound": {"purchase-order", "purchase-inbound"},
	"sale_outbound":    {"sale-order", "sale-outbound"},
	"sale_delivery":    {"sale-outbound", "sale-delivery"},
	"sale_signoff":     {"sale-delivery", "sale-signoff"},
	"sale_return":      {"sale-signoff", "sale-return"},
}

type request struct {
	Source        string          `json:"source"`
	Operation     string          `json:"operation"`
	SourceNodeKey string          `json:"sourceNodeKey"`
	Input         json.RawMessage `json:"input"`
}

type node struct {
	Key    string `json:"key"`
	Name   string `json:"name"`
	Entity string `json:"entity"`
}
type edge struct {
	SourceKey  string `json:"sourceKey"`
	TargetKey  string `json:"targetKey"`
	ActionName string `json:"actionName"`
	Relation   string `json:"relation"`
	initial    starlark.Value
	when       starlark.Callable
}
type graph struct {
	Code    string `json:"code"`
	Name    string `json:"name"`
	RootKey string `json:"rootKey"`
	Nodes   []node `json:"nodes"`
	Edges   []edge `json:"edges"`
	when    starlark.Callable
}
type response struct {
	OK         bool        `json:"ok"`
	Error      string      `json:"error,omitempty"`
	Graph      *graph      `json:"graph,omitempty"`
	Evaluation *evaluation `json:"evaluation,omitempty"`
}
type evaluation struct {
	RootMatched bool     `json:"rootMatched"`
	Branches    []branch `json:"branches"`
}
type branch struct {
	TargetKey string `json:"targetKey"`
	Matched   bool   `json:"matched"`
	Initial   any    `json:"initial,omitempty"`
}

type compiler struct {
	definition *graph
	nodes      []*starlark.Dict
}

func main() {
	js.Global().Set("__zerpWflStarlarkRun", js.FuncOf(run))
	select {}
}

func run(_ js.Value, args []js.Value) any {
	if len(args) != 1 {
		return encode(response{Error: "one JSON request is required"})
	}
	var input request
	decoder := json.NewDecoder(strings.NewReader(args[0].String()))
	decoder.UseNumber()
	if err := decoder.Decode(&input); err != nil {
		return encode(response{Error: err.Error()})
	}
	definition, err := compile(input.Source)
	if err != nil {
		return encode(response{Error: err.Error()})
	}
	result := response{OK: true}
	switch input.Operation {
	case "compile":
		result.Graph = &definition
	case "evaluate":
		value, valueErr := frozenValue(input.Input)
		if valueErr != nil {
			result = response{Error: valueErr.Error()}
		} else if evaluated, evaluateErr := evaluate(definition, input.SourceNodeKey, value); evaluateErr != nil {
			result = response{Error: evaluateErr.Error()}
		} else {
			result.Evaluation = &evaluated
		}
	default:
		result = response{Error: "unsupported WFL Starlark operation"}
	}
	return encode(result)
}

func encode(result response) string { encoded, _ := json.Marshal(result); return string(encoded) }

func compile(source string) (graph, error) {
	if strings.TrimSpace(source) == "" {
		return graph{}, fmt.Errorf("workflow script is required")
	}
	if len(source) > maxScriptBytes {
		return graph{}, fmt.Errorf("workflow script exceeds %d bytes", maxScriptBytes)
	}
	c := &compiler{}
	thread := &starlark.Thread{Name: "wfl-definition-compile", Load: func(_ *starlark.Thread, module string) (starlark.StringDict, error) {
		return nil, fmt.Errorf("workflow imports are not allowed: %s", module)
	}}
	thread.SetMaxExecutionSteps(maxSteps)
	predeclared := starlark.StringDict{"node": starlark.NewBuiltin("node", c.node), "edge": starlark.NewBuiltin("edge", c.edge), "workflow": starlark.NewBuiltin("workflow", c.workflow)}
	for actionName := range actions {
		name := actionName
		predeclared[name] = starlark.NewBuiltin(name, actionBuiltin(name))
	}
	_, err := starlark.ExecFileOptions(&syntax.FileOptions{}, thread, "workflow.star", source, predeclared)
	if err != nil {
		var evaluationError *starlark.EvalError
		if errors.As(err, &evaluationError) {
			return graph{}, fmt.Errorf("compile workflow script: %s", evaluationError.Backtrace())
		}
		return graph{}, fmt.Errorf("compile workflow script: %s", err)
	}
	if c.definition == nil {
		return graph{}, fmt.Errorf("workflow script must declare exactly one workflow")
	}
	return *c.definition, nil
}

func actionBuiltin(name string) func(*starlark.Thread, *starlark.Builtin, starlark.Tuple, []starlark.Tuple) (starlark.Value, error) {
	return func(_ *starlark.Thread, fn *starlark.Builtin, args starlark.Tuple, kwargs []starlark.Tuple) (starlark.Value, error) {
		var initial starlark.Value = starlark.None
		if err := starlark.UnpackArgs(fn.Name(), args, kwargs, "initial?", &initial); err != nil {
			return nil, err
		}
		if initial != starlark.None {
			if _, ok := initial.(*starlark.Dict); !ok {
				if _, ok := initial.(starlark.Callable); !ok {
					return nil, fmt.Errorf("%s initial must be a dict or function", fn.Name())
				}
			}
		}
		return dictionary(map[string]starlark.Value{"name": starlark.String(name), "initial": initial})
	}
}

func (c *compiler) node(_ *starlark.Thread, fn *starlark.Builtin, args starlark.Tuple, kwargs []starlark.Tuple) (starlark.Value, error) {
	if len(c.nodes) >= maxNodes {
		return nil, fmt.Errorf("workflow exceeds %d nodes", maxNodes)
	}
	var key, name, entity string
	if err := starlark.UnpackArgs(fn.Name(), args, kwargs, "key", &key, "name", &name, "entity", &entity); err != nil {
		return nil, err
	}
	result, err := dictionary(map[string]starlark.Value{"key": starlark.String(key), "name": starlark.String(name), "entity": starlark.String(entity)})
	if err != nil {
		return nil, err
	}
	if _, err = nodeFrom(result); err != nil {
		return nil, err
	}
	c.nodes = append(c.nodes, result)
	return result, nil
}

func (c *compiler) edge(_ *starlark.Thread, fn *starlark.Builtin, args starlark.Tuple, kwargs []starlark.Tuple) (starlark.Value, error) {
	var source, target, action *starlark.Dict
	var relation string
	var when starlark.Callable
	if err := starlark.UnpackArgs(fn.Name(), args, kwargs, "source", &source, "target", &target, "relation", &relation, "action", &action, "when?", &when); err != nil {
		return nil, err
	}
	sourceNode, err := nodeFrom(source)
	if err != nil {
		return nil, err
	}
	targetNode, err := nodeFrom(target)
	if err != nil {
		return nil, err
	}
	actionName, err := textFrom(action, "name")
	if err != nil || !actionAllowed(actionName, sourceNode.Entity, targetNode.Entity) {
		return nil, fmt.Errorf("workflow edge uses an incompatible action")
	}
	relation = strings.TrimSpace(relation)
	if relation == "" || len(relation) > 64 {
		return nil, fmt.Errorf("workflow edge relation is invalid")
	}
	initial, found, err := action.Get(starlark.String("initial"))
	if err != nil || !found {
		return nil, fmt.Errorf("workflow action initial is missing")
	}
	result, err := dictionary(map[string]starlark.Value{"source": starlark.String(sourceNode.Key), "target": starlark.String(targetNode.Key), "action": starlark.String(actionName), "relation": starlark.String(relation), "initial": initial})
	if err != nil {
		return nil, err
	}
	if when != nil {
		if err = result.SetKey(starlark.String("when"), when); err != nil {
			return nil, err
		}
	}
	return result, nil
}

func (c *compiler) workflow(_ *starlark.Thread, fn *starlark.Builtin, args starlark.Tuple, kwargs []starlark.Tuple) (starlark.Value, error) {
	if c.definition != nil {
		return nil, fmt.Errorf("workflow script must declare exactly one workflow")
	}
	var code, name string
	var root *starlark.Dict
	var edgeList *starlark.List
	var when starlark.Callable
	if err := starlark.UnpackArgs(fn.Name(), args, kwargs, "code", &code, "name", &name, "root", &root, "edges?", &edgeList, "when?", &when); err != nil {
		return nil, err
	}
	code, name = strings.TrimSpace(code), strings.TrimSpace(name)
	if !codePattern.MatchString(code) || code == "process-definition" || code == "process-instance" || name == "" || len(name) > 100 {
		return nil, fmt.Errorf("invalid workflow identity")
	}
	rootNode, err := nodeFrom(root)
	if err != nil {
		return nil, err
	}
	nodes := make([]node, 0, len(c.nodes))
	for _, value := range c.nodes {
		item, itemErr := nodeFrom(value)
		if itemErr != nil {
			return nil, itemErr
		}
		nodes = append(nodes, item)
	}
	edges := []edge{}
	if edgeList != nil {
		if edgeList.Len() > maxEdges {
			return nil, fmt.Errorf("workflow exceeds %d edges", maxEdges)
		}
		for index := 0; index < edgeList.Len(); index++ {
			item, ok := edgeList.Index(index).(*starlark.Dict)
			if !ok {
				return nil, fmt.Errorf("workflow edge %d is invalid", index)
			}
			compiled, itemErr := edgeFrom(item)
			if itemErr != nil {
				return nil, itemErr
			}
			edges = append(edges, compiled)
		}
	}
	definition := graph{Code: code, Name: name, RootKey: rootNode.Key, Nodes: nodes, Edges: edges, when: when}
	if err = validate(definition); err != nil {
		return nil, err
	}
	c.definition = &definition
	return starlark.None, nil
}

func dictionary(values map[string]starlark.Value) (*starlark.Dict, error) {
	result := starlark.NewDict(len(values))
	for key, value := range values {
		if err := result.SetKey(starlark.String(key), value); err != nil {
			return nil, err
		}
	}
	return result, nil
}
func textFrom(value *starlark.Dict, key string) (string, error) {
	if value == nil {
		return "", fmt.Errorf("missing object")
	}
	item, found, err := value.Get(starlark.String(key))
	if err != nil || !found {
		return "", fmt.Errorf("missing %s", key)
	}
	text, ok := starlark.AsString(item)
	if !ok {
		return "", fmt.Errorf("invalid %s", key)
	}
	return text, nil
}
func nodeFrom(value *starlark.Dict) (node, error) {
	key, err := textFrom(value, "key")
	if err != nil {
		return node{}, fmt.Errorf("workflow node is invalid")
	}
	name, err := textFrom(value, "name")
	if err != nil {
		return node{}, fmt.Errorf("workflow node is invalid")
	}
	entity, err := textFrom(value, "entity")
	if err != nil {
		return node{}, fmt.Errorf("workflow node is invalid")
	}
	key, name, entity = strings.TrimSpace(key), strings.TrimSpace(name), strings.TrimSpace(entity)
	if key == "" || len(key) > 64 || name == "" || len(name) > 100 || !entityAllowed(entity) {
		return node{}, fmt.Errorf("workflow node is invalid")
	}
	return node{Key: key, Name: name, Entity: entity}, nil
}
func edgeFrom(value *starlark.Dict) (edge, error) {
	source, err := textFrom(value, "source")
	if err != nil {
		return edge{}, fmt.Errorf("workflow edge is invalid")
	}
	target, err := textFrom(value, "target")
	if err != nil {
		return edge{}, fmt.Errorf("workflow edge is invalid")
	}
	action, err := textFrom(value, "action")
	if err != nil {
		return edge{}, fmt.Errorf("workflow edge is invalid")
	}
	relation, err := textFrom(value, "relation")
	if err != nil {
		return edge{}, fmt.Errorf("workflow edge is invalid")
	}
	initial, found, err := value.Get(starlark.String("initial"))
	if err != nil || !found {
		return edge{}, fmt.Errorf("workflow edge is invalid")
	}
	whenValue, found, err := value.Get(starlark.String("when"))
	if err != nil {
		return edge{}, fmt.Errorf("workflow edge is invalid")
	}
	var when starlark.Callable
	if found {
		when, _ = whenValue.(starlark.Callable)
		if when == nil {
			return edge{}, fmt.Errorf("workflow edge condition is invalid")
		}
	}
	return edge{SourceKey: strings.TrimSpace(source), TargetKey: strings.TrimSpace(target), ActionName: strings.TrimSpace(action), Relation: strings.TrimSpace(relation), initial: initial, when: when}, nil
}
func entityAllowed(entity string) bool {
	for _, pair := range actions {
		if entity == pair[0] || entity == pair[1] {
			return true
		}
	}
	return false
}
func actionAllowed(name, source, target string) bool {
	pair, ok := actions[name]
	return ok && pair[0] == source && pair[1] == target
}

func validate(definition graph) error {
	if len(definition.Nodes) == 0 {
		return fmt.Errorf("workflow must declare at least one node")
	}
	nodes, indegree, adjacency, pairs := map[string]node{}, map[string]int{}, map[string][]string{}, map[string]bool{}
	for _, item := range definition.Nodes {
		if _, exists := nodes[item.Key]; exists {
			return fmt.Errorf("workflow node key %q is duplicated", item.Key)
		}
		nodes[item.Key] = item
	}
	if _, exists := nodes[definition.RootKey]; !exists {
		return fmt.Errorf("workflow root must be a declared node")
	}
	for _, item := range definition.Edges {
		source, sourceOK := nodes[item.SourceKey]
		target, targetOK := nodes[item.TargetKey]
		pair := item.SourceKey + "\x00" + item.TargetKey
		if !sourceOK || !targetOK || item.SourceKey == item.TargetKey || pairs[pair] || !actionAllowed(item.ActionName, source.Entity, target.Entity) || item.Relation == "" {
			return fmt.Errorf("workflow edge %q -> %q is invalid", item.SourceKey, item.TargetKey)
		}
		pairs[pair] = true
		indegree[item.TargetKey]++
		if indegree[item.TargetKey] > 1 {
			return fmt.Errorf("workflow node %q has multiple parents", item.TargetKey)
		}
		adjacency[item.SourceKey] = append(adjacency[item.SourceKey], item.TargetKey)
	}
	if indegree[definition.RootKey] != 0 {
		return fmt.Errorf("workflow root cannot have a parent")
	}
	for key := range nodes {
		if key != definition.RootKey && indegree[key] != 1 {
			return fmt.Errorf("workflow node %q is disconnected", key)
		}
	}
	seen, active := map[string]bool{}, map[string]bool{}
	var visit func(string) error
	visit = func(key string) error {
		if active[key] {
			return fmt.Errorf("workflow graph contains a cycle")
		}
		if seen[key] {
			return nil
		}
		active[key] = true
		for _, child := range adjacency[key] {
			if err := visit(child); err != nil {
				return err
			}
		}
		active[key] = false
		seen[key] = true
		return nil
	}
	if err := visit(definition.RootKey); err != nil {
		return err
	}
	if len(seen) != len(nodes) {
		return fmt.Errorf("workflow graph must be connected")
	}
	return nil
}

func frozenValue(raw json.RawMessage) (starlark.Value, error) {
	if len(raw) == 0 {
		raw = []byte("null")
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.UseNumber()
	var plain any
	if err := decoder.Decode(&plain); err != nil {
		return nil, err
	}
	value, err := valueFromPlain(plain)
	if err == nil {
		value.Freeze()
	}
	return value, err
}
func valueFromPlain(value any) (starlark.Value, error) {
	switch typed := value.(type) {
	case nil:
		return starlark.None, nil
	case bool:
		return starlark.Bool(typed), nil
	case string:
		return starlark.String(typed), nil
	case json.Number:
		if integer, err := typed.Int64(); err == nil {
			return starlark.MakeInt64(integer), nil
		}
		decimal, err := typed.Float64()
		return starlark.Float(decimal), err
	case []any:
		values := make([]starlark.Value, 0, len(typed))
		for _, item := range typed {
			converted, err := valueFromPlain(item)
			if err != nil {
				return nil, err
			}
			values = append(values, converted)
		}
		return starlark.NewList(values), nil
	case map[string]any:
		result := starlark.NewDict(len(typed))
		for key, item := range typed {
			converted, err := valueFromPlain(item)
			if err != nil {
				return nil, err
			}
			if err = result.SetKey(starlark.String(key), converted); err != nil {
				return nil, err
			}
		}
		return result, nil
	default:
		return nil, fmt.Errorf("unsupported workflow value %T", value)
	}
}
func plainValue(value starlark.Value) (any, error) {
	switch typed := value.(type) {
	case starlark.NoneType:
		return nil, nil
	case starlark.Bool:
		return bool(typed), nil
	case starlark.String:
		return string(typed), nil
	case starlark.Int:
		integer := typed.BigInt()
		if !integer.IsInt64() {
			return nil, fmt.Errorf("integer is out of range")
		}
		return integer.Int64(), nil
	case starlark.Float:
		return float64(typed), nil
	case *starlark.List:
		result := make([]any, 0, typed.Len())
		for index := 0; index < typed.Len(); index++ {
			item, err := plainValue(typed.Index(index))
			if err != nil {
				return nil, err
			}
			result = append(result, item)
		}
		return result, nil
	case *starlark.Dict:
		result := make(map[string]any, typed.Len())
		for _, item := range typed.Items() {
			key, ok := starlark.AsString(item[0])
			if !ok {
				return nil, fmt.Errorf("object key must be a string")
			}
			converted, err := plainValue(item[1])
			if err != nil {
				return nil, err
			}
			result[key] = converted
		}
		return result, nil
	default:
		return nil, fmt.Errorf("unsupported Starlark value %s", value.Type())
	}
}
func evaluate(definition graph, sourceNodeKey string, source starlark.Value) (evaluation, error) {
	thread := &starlark.Thread{Name: "wfl-evaluation"}
	thread.SetMaxExecutionSteps(maxSteps)
	result := evaluation{RootMatched: true, Branches: []branch{}}
	if sourceNodeKey == definition.RootKey && definition.when != nil {
		matched, err := condition(thread, definition.when, source)
		if err != nil {
			return result, err
		}
		result.RootMatched = matched
		if !matched {
			return result, nil
		}
	}
	for _, item := range definition.Edges {
		if item.SourceKey != sourceNodeKey {
			continue
		}
		matched := true
		var err error
		if item.when != nil {
			matched, err = condition(thread, item.when, source)
			if err != nil {
				return result, err
			}
		}
		itemResult := branch{TargetKey: item.TargetKey, Matched: matched}
		if matched {
			initial := item.initial
			if callable, ok := initial.(starlark.Callable); ok {
				initial, err = starlark.Call(thread, callable, starlark.Tuple{source}, nil)
				if err != nil {
					return result, fmt.Errorf("evaluate %s initial values: %w", item.ActionName, err)
				}
			}
			itemResult.Initial, err = plainValue(initial)
			if err != nil {
				return result, err
			}
		}
		result.Branches = append(result.Branches, itemResult)
	}
	return result, nil
}
func condition(thread *starlark.Thread, function starlark.Callable, source starlark.Value) (bool, error) {
	value, err := starlark.Call(thread, function, starlark.Tuple{source}, nil)
	if err != nil {
		return false, fmt.Errorf("evaluate workflow condition: %w", err)
	}
	matched, ok := value.(starlark.Bool)
	if !ok {
		return false, fmt.Errorf("workflow condition must return bool")
	}
	return bool(matched), nil
}

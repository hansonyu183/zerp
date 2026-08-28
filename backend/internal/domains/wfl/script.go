package wfl

import (
	"errors"
	"fmt"
	"strings"

	"go.starlark.net/starlark"
	"go.starlark.net/syntax"
)

const (
	maxWorkflowScriptBytes = 128 * 1024
	maxWorkflowScriptSteps = 100_000
	maxWorkflowNodes       = 100
	maxWorkflowEdges       = 200
)

type compiledScriptDefinition struct {
	Code    string               `json:"code"`
	Name    string               `json:"name"`
	RootKey string               `json:"rootKey"`
	Nodes   []compiledScriptNode `json:"nodes"`
	Edges   []compiledScriptEdge `json:"edges"`
	when    starlark.Callable
}

type compiledScriptNode struct {
	Key    string `json:"key"`
	Name   string `json:"name"`
	Entity string `json:"entity"`
}

type compiledScriptEdge struct {
	SourceKey  string `json:"sourceKey"`
	TargetKey  string `json:"targetKey"`
	ActionName string `json:"actionName"`
	Relation   string `json:"relation"`
	initial    starlark.Value
	when       starlark.Callable
}

const (
	ActionExpensePayment  = "expense_payment"
	ActionPurchaseInbound = "purchase_inbound"
	ActionSaleOutbound    = "sale_outbound"
	ActionSaleDelivery    = "sale_delivery"
	ActionSaleSignoff     = "sale_signoff"
	ActionSaleReturn      = "sale_return"
)

var workflowActionEntities = map[string][2]string{
	ActionExpensePayment:  {"expense-reimbursement", "expense-payment"},
	ActionPurchaseInbound: {"purchase-order", "purchase-inbound"},
	ActionSaleOutbound:    {"sale-order", "sale-outbound"},
	ActionSaleDelivery:    {"sale-outbound", "sale-delivery"},
	ActionSaleSignoff:     {"sale-delivery", "sale-signoff"},
	ActionSaleReturn:      {"sale-signoff", "sale-return"},
}

type scriptCompiler struct {
	definition *compiledScriptDefinition
	nodes      []*starlark.Dict
}

func CompileDefinitionScript(source string) (compiledScriptDefinition, error) {
	if strings.TrimSpace(source) == "" {
		return compiledScriptDefinition{}, fmt.Errorf("workflow script is required")
	}
	if len(source) > maxWorkflowScriptBytes {
		return compiledScriptDefinition{}, fmt.Errorf("workflow script exceeds %d bytes", maxWorkflowScriptBytes)
	}
	compiler := &scriptCompiler{}
	thread := &starlark.Thread{
		Name: "wfl-definition-compile",
		Load: func(_ *starlark.Thread, module string) (starlark.StringDict, error) {
			return nil, fmt.Errorf("workflow imports are not allowed: %s", module)
		},
	}
	thread.SetMaxExecutionSteps(maxWorkflowScriptSteps)
	predeclared := starlark.StringDict{
		"edge":     starlark.NewBuiltin("edge", compiler.edge),
		"node":     starlark.NewBuiltin("node", compiler.node),
		"workflow": starlark.NewBuiltin("workflow", compiler.workflow),
	}
	for actionName := range workflowActionEntities {
		name := actionName
		predeclared[name] = starlark.NewBuiltin(name, func(_ *starlark.Thread, fn *starlark.Builtin, args starlark.Tuple, kwargs []starlark.Tuple) (starlark.Value, error) {
			var initial starlark.Value = starlark.None
			if unpackErr := starlark.UnpackArgs(fn.Name(), args, kwargs, "initial?", &initial); unpackErr != nil {
				return nil, unpackErr
			}
			if initial != starlark.None {
				if _, ok := initial.(*starlark.Dict); !ok {
					if _, ok = initial.(starlark.Callable); !ok {
						return nil, fmt.Errorf("%s initial must be a dict or function", fn.Name())
					}
				}
			}
			descriptor := starlark.NewDict(2)
			if setErr := descriptor.SetKey(starlark.String("name"), starlark.String(name)); setErr != nil {
				return nil, setErr
			}
			if setErr := descriptor.SetKey(starlark.String("initial"), initial); setErr != nil {
				return nil, setErr
			}
			return descriptor, nil
		})
	}
	_, err := starlark.ExecFileOptions(&syntax.FileOptions{}, thread, "workflow.star", source, predeclared)
	if err != nil {
		diagnostic := err.Error()
		var evaluationError *starlark.EvalError
		if errors.As(err, &evaluationError) {
			diagnostic = evaluationError.Backtrace()
		}
		return compiledScriptDefinition{}, fmt.Errorf("compile workflow script: %s", diagnostic)
	}
	if compiler.definition == nil {
		return compiledScriptDefinition{}, fmt.Errorf("workflow script must declare exactly one workflow")
	}
	return *compiler.definition, nil
}

func (c *scriptCompiler) node(_ *starlark.Thread, fn *starlark.Builtin, args starlark.Tuple, kwargs []starlark.Tuple) (starlark.Value, error) {
	if len(c.nodes) >= maxWorkflowNodes {
		return nil, fmt.Errorf("workflow exceeds %d nodes", maxWorkflowNodes)
	}
	var key, name, entity string
	if err := starlark.UnpackArgs(fn.Name(), args, kwargs, "key", &key, "name", &name, "entity", &entity); err != nil {
		return nil, err
	}
	node := starlark.NewDict(3)
	for _, field := range []struct{ key, value string }{
		{key: "key", value: key},
		{key: "name", value: name},
		{key: "entity", value: entity},
	} {
		if err := node.SetKey(starlark.String(field.key), starlark.String(field.value)); err != nil {
			return nil, err
		}
	}
	if _, err := compiledNodeFromDict(node); err != nil {
		return nil, err
	}
	c.nodes = append(c.nodes, node)
	return node, nil
}

func (c *scriptCompiler) edge(_ *starlark.Thread, fn *starlark.Builtin, args starlark.Tuple, kwargs []starlark.Tuple) (starlark.Value, error) {
	var source, target *starlark.Dict
	var action *starlark.Dict
	var relation string
	var when starlark.Callable
	if err := starlark.UnpackArgs(fn.Name(), args, kwargs, "source", &source, "target", &target, "relation", &relation, "action", &action, "when?", &when); err != nil {
		return nil, err
	}
	sourceNode, err := compiledNodeFromDict(source)
	if err != nil {
		return nil, err
	}
	targetNode, err := compiledNodeFromDict(target)
	if err != nil {
		return nil, err
	}
	actionName, err := stringFromDict(action, "name")
	if err != nil || !workflowActionAllowed(actionName, sourceNode.Entity, targetNode.Entity) {
		return nil, fmt.Errorf("workflow edge uses an incompatible action")
	}
	relation = strings.TrimSpace(relation)
	if relation == "" || len(relation) > 64 {
		return nil, fmt.Errorf("workflow edge relation is invalid")
	}
	edge := starlark.NewDict(4)
	for _, field := range []struct{ key, value string }{
		{key: "source", value: sourceNode.Key},
		{key: "target", value: targetNode.Key},
		{key: "action", value: actionName},
		{key: "relation", value: relation},
	} {
		if err = edge.SetKey(starlark.String(field.key), starlark.String(field.value)); err != nil {
			return nil, err
		}
	}
	initial, found, err := action.Get(starlark.String("initial"))
	if err != nil || !found {
		return nil, fmt.Errorf("workflow action initial is missing")
	}
	if err = edge.SetKey(starlark.String("initial"), initial); err != nil {
		return nil, err
	}
	if when != nil {
		if err = edge.SetKey(starlark.String("when"), when); err != nil {
			return nil, err
		}
	}
	return edge, nil
}

func (c *scriptCompiler) workflow(_ *starlark.Thread, fn *starlark.Builtin, args starlark.Tuple, kwargs []starlark.Tuple) (starlark.Value, error) {
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
	code = strings.TrimSpace(code)
	name = strings.TrimSpace(name)
	if !definitionCodePattern.MatchString(code) || reservedDefinitionCodes[code] || name == "" || len(name) > 100 {
		return nil, fmt.Errorf("invalid workflow identity")
	}
	rootNode, err := compiledNodeFromDict(root)
	if err != nil {
		return nil, err
	}
	nodes := make([]compiledScriptNode, 0, len(c.nodes))
	for _, value := range c.nodes {
		node, nodeErr := compiledNodeFromDict(value)
		if nodeErr != nil {
			return nil, nodeErr
		}
		nodes = append(nodes, node)
	}
	edges := []compiledScriptEdge{}
	if edgeList != nil {
		if edgeList.Len() > maxWorkflowEdges {
			return nil, fmt.Errorf("workflow exceeds %d edges", maxWorkflowEdges)
		}
		edges = make([]compiledScriptEdge, 0, edgeList.Len())
		for index := 0; index < edgeList.Len(); index++ {
			value, ok := edgeList.Index(index).(*starlark.Dict)
			if !ok {
				return nil, fmt.Errorf("workflow edge %d is invalid", index)
			}
			edge, edgeErr := compiledEdgeFromDict(value)
			if edgeErr != nil {
				return nil, edgeErr
			}
			edges = append(edges, edge)
		}
	}
	definition := compiledScriptDefinition{Code: code, Name: name, RootKey: rootNode.Key, Nodes: nodes, Edges: edges, when: when}
	if err = validateCompiledScriptGraph(definition); err != nil {
		return nil, err
	}
	c.definition = &definition
	return starlark.None, nil
}

func compiledNodeFromDict(value *starlark.Dict) (compiledScriptNode, error) {
	key, err := stringFromDict(value, "key")
	if err != nil {
		return compiledScriptNode{}, fmt.Errorf("workflow node is invalid")
	}
	name, err := stringFromDict(value, "name")
	if err != nil {
		return compiledScriptNode{}, fmt.Errorf("workflow node is invalid")
	}
	entity, err := stringFromDict(value, "entity")
	if err != nil {
		return compiledScriptNode{}, fmt.Errorf("workflow node is invalid")
	}
	key = strings.TrimSpace(key)
	name = strings.TrimSpace(name)
	entity = strings.TrimSpace(entity)
	if key == "" || len(key) > 64 || name == "" || len(name) > 100 || !workflowEntityAllowed(entity) {
		return compiledScriptNode{}, fmt.Errorf("workflow node is invalid")
	}
	return compiledScriptNode{Key: key, Name: name, Entity: entity}, nil
}

func compiledEdgeFromDict(value *starlark.Dict) (compiledScriptEdge, error) {
	sourceKey, err := stringFromDict(value, "source")
	if err != nil {
		return compiledScriptEdge{}, fmt.Errorf("workflow edge is invalid")
	}
	targetKey, err := stringFromDict(value, "target")
	if err != nil {
		return compiledScriptEdge{}, fmt.Errorf("workflow edge is invalid")
	}
	actionName, err := stringFromDict(value, "action")
	if err != nil {
		return compiledScriptEdge{}, fmt.Errorf("workflow edge is invalid")
	}
	relation, err := stringFromDict(value, "relation")
	if err != nil {
		return compiledScriptEdge{}, fmt.Errorf("workflow edge is invalid")
	}
	initial, found, err := value.Get(starlark.String("initial"))
	if err != nil || !found {
		return compiledScriptEdge{}, fmt.Errorf("workflow edge is invalid")
	}
	var when starlark.Callable
	whenValue, found, err := value.Get(starlark.String("when"))
	if err != nil {
		return compiledScriptEdge{}, fmt.Errorf("workflow edge is invalid")
	}
	if found {
		when, _ = whenValue.(starlark.Callable)
		if when == nil {
			return compiledScriptEdge{}, fmt.Errorf("workflow edge condition is invalid")
		}
	}
	return compiledScriptEdge{
		SourceKey: strings.TrimSpace(sourceKey), TargetKey: strings.TrimSpace(targetKey),
		ActionName: strings.TrimSpace(actionName), Relation: strings.TrimSpace(relation), initial: initial, when: when,
	}, nil
}

func stringFromDict(value *starlark.Dict, field string) (string, error) {
	if value == nil {
		return "", fmt.Errorf("missing object")
	}
	item, found, err := value.Get(starlark.String(field))
	if err != nil || !found {
		return "", fmt.Errorf("missing %s", field)
	}
	text, ok := starlark.AsString(item)
	if !ok {
		return "", fmt.Errorf("invalid %s", field)
	}
	return text, nil
}

func validateCompiledScriptGraph(definition compiledScriptDefinition) error {
	if len(definition.Nodes) == 0 {
		return fmt.Errorf("workflow must declare at least one node")
	}
	nodes := make(map[string]compiledScriptNode, len(definition.Nodes))
	for _, node := range definition.Nodes {
		if _, exists := nodes[node.Key]; exists {
			return fmt.Errorf("workflow node key %q is duplicated", node.Key)
		}
		nodes[node.Key] = node
	}
	if _, exists := nodes[definition.RootKey]; !exists {
		return fmt.Errorf("workflow root must be a declared node")
	}
	indegree := make(map[string]int, len(nodes))
	adjacency := make(map[string][]string, len(nodes))
	pairs := make(map[string]bool, len(definition.Edges))
	for _, edge := range definition.Edges {
		source, sourceExists := nodes[edge.SourceKey]
		target, targetExists := nodes[edge.TargetKey]
		pair := edge.SourceKey + "\x00" + edge.TargetKey
		if !sourceExists || !targetExists || edge.SourceKey == edge.TargetKey || pairs[pair] ||
			!workflowActionAllowed(edge.ActionName, source.Entity, target.Entity) || edge.Relation == "" {
			return fmt.Errorf("workflow edge %q -> %q is invalid", edge.SourceKey, edge.TargetKey)
		}
		pairs[pair] = true
		indegree[edge.TargetKey]++
		if indegree[edge.TargetKey] > 1 {
			return fmt.Errorf("workflow node %q has multiple parents", edge.TargetKey)
		}
		adjacency[edge.SourceKey] = append(adjacency[edge.SourceKey], edge.TargetKey)
	}
	if indegree[definition.RootKey] != 0 {
		return fmt.Errorf("workflow root cannot have a parent")
	}
	for key := range nodes {
		if key != definition.RootKey && indegree[key] != 1 {
			return fmt.Errorf("workflow node %q is disconnected", key)
		}
	}
	seen := make(map[string]bool, len(nodes))
	active := make(map[string]bool, len(nodes))
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

func workflowEntityAllowed(entity string) bool {
	for _, entities := range workflowActionEntities {
		for _, candidate := range entities {
			if candidate == entity {
				return true
			}
		}
	}
	return false
}

func workflowActionAllowed(name, sourceEntity, targetEntity string) bool {
	entities, ok := workflowActionEntities[name]
	return ok && entities[0] == sourceEntity && entities[1] == targetEntity
}

func compiledNodeByKey(compiled compiledScriptDefinition, key string) compiledScriptNode {
	for _, node := range compiled.Nodes {
		if node.Key == key {
			return node
		}
	}
	return compiledScriptNode{}
}

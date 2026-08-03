package wfl

import (
	"encoding/json"
	"testing"
)

func TestValidateDefinitionInputSupportsOneToManyConditions(t *testing.T) {
	root := "01J00000000000000000000010"
	left := "01J00000000000000000000011"
	right := "01J00000000000000000000012"
	input := DefinitionCreateInput{
		Code: "sales-branches", Name: "销售分支", RootNodeID: root,
		StartCondition: json.RawMessage(`{"all":[{"field":"currency","operator":"EQ","value":"CNY"}]}`),
		Nodes: []DefinitionNodeInput{
			{ID: root, Key: "order", Name: "销售订单", DocumentEntity: "sale-order"},
			{ID: left, Key: "outbound-a", Name: "销售出库 A", DocumentEntity: "sale-outbound"},
			{ID: right, Key: "outbound-b", Name: "销售出库 B", DocumentEntity: "sale-outbound"},
		},
		Edges: []DefinitionEdgeInput{
			{ID: "01J00000000000000000000020", SourceNodeID: root, TargetNodeID: left, ConverterKey: "sale-order-to-outbound", Condition: json.RawMessage(`{"field":"amount","operator":"GTE","value":100}`)},
			{ID: "01J00000000000000000000021", SourceNodeID: root, TargetNodeID: right, ConverterKey: "sale-order-to-outbound", Condition: json.RawMessage(`{"lineAny":{"field":"productCode","operator":"CONTAINS","value":"A"}}`)},
		},
	}
	if err := validateDefinitionInput(input); err != nil {
		t.Fatalf("valid one-to-many definition rejected: %v", err)
	}
}

func TestValidateDefinitionInputRejectsExcludedEntitiesAndMalformedConditions(t *testing.T) {
	root := "01J00000000000000000000010"
	input := DefinitionCreateInput{
		Code: "invalid-flow", Name: "无效流程", RootNodeID: root,
		Nodes: []DefinitionNodeInput{{ID: root, Key: "root", Name: "销售定价", DocumentEntity: "sale-pricing"}},
	}
	if err := validateDefinitionInput(input); err == nil {
		t.Fatal("excluded pricing entity was accepted")
	}
	input.Nodes[0].DocumentEntity = "sale-order"
	input.StartCondition = json.RawMessage(`{"field":"amount","operator":"UNKNOWN","value":1}`)
	if err := validateDefinitionInput(input); err == nil {
		t.Fatal("malformed condition was accepted")
	}
}

func TestValidateDefinitionInputRejectsReservedRouteCodes(t *testing.T) {
	root := "01J00000000000000000000010"
	for _, code := range []string{"process-definition", "process-instance"} {
		input := DefinitionCreateInput{
			Code: code, Name: "保留流程", RootNodeID: root,
			Nodes: []DefinitionNodeInput{{ID: root, Key: "root", Name: "销售订单", DocumentEntity: "sale-order"}},
		}
		if err := validateDefinitionInput(input); err == nil {
			t.Fatalf("reserved definition code %q was accepted", code)
		}
	}
}

func TestValidateDefinitionInputRejectsDuplicateGraphIDs(t *testing.T) {
	root := "01J00000000000000000000010"
	child := "01J00000000000000000000011"
	input := DefinitionCreateInput{
		Code: "duplicate-graph", Name: "重复图", RootNodeID: root,
		Nodes: []DefinitionNodeInput{
			{ID: root, Key: "root", Name: "销售订单", DocumentEntity: "sale-order"},
			{ID: root, Key: "duplicate", Name: "重复节点", DocumentEntity: "sale-order"},
		},
	}
	if err := validateDefinitionInput(input); err == nil {
		t.Fatal("duplicate node ID was accepted")
	}
	input.Nodes = []DefinitionNodeInput{
		{ID: root, Key: "root", Name: "销售订单", DocumentEntity: "sale-order"},
		{ID: child, Key: "outbound", Name: "销售出库", DocumentEntity: "sale-outbound"},
	}
	edgeID := "01J00000000000000000000020"
	input.Edges = []DefinitionEdgeInput{
		{ID: edgeID, SourceNodeID: root, TargetNodeID: child, ConverterKey: "sale-order-to-outbound"},
		{ID: edgeID, SourceNodeID: root, TargetNodeID: child, ConverterKey: "sale-order-to-outbound"},
	}
	if err := validateDefinitionInput(input); err == nil {
		t.Fatal("duplicate edge ID was accepted")
	}
}

func TestValidateRequiredDefaults(t *testing.T) {
	nodes := []DefinitionNodeInput{{
		ID: "01J00000000000000000000011", DocumentEntity: "receipt", Defaults: json.RawMessage(`{"fundAccountObjectId":"fund"}`),
	}}
	edges := []DefinitionEdgeInput{{
		TargetNodeID: nodes[0].ID, ConverterKey: "sale-signoff-to-receipt",
	}}
	if err := validateRequiredDefaults(nodes, edges); err == nil {
		t.Fatal("missing handler default was accepted")
	}
	nodes[0].Defaults = json.RawMessage(`{"fundAccountObjectId":"fund","handlerObjectId":"handler"}`)
	if err := validateRequiredDefaults(nodes, edges); err != nil {
		t.Fatalf("complete defaults rejected: %v", err)
	}
}

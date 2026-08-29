package dcl

import "testing"

func TestDecodeWflGraphRejectsCorruptPayload(t *testing.T) {
	if _, _, err := decodeWflGraph([]byte(`{"nodes":`)); err == nil {
		t.Fatal("expected corrupt compiled workflow payload to fail")
	}
}

func TestDecodeWflGraphReturnsStoredNodesAndEdges(t *testing.T) {
	nodes, edges, err := decodeWflGraph([]byte(`{
  "nodes": [
    {"key":"order","name":"采购订单","entity":"purchase-order"},
    {"key":"inbound","name":"采购入库","entity":"purchase-inbound"}
  ],
  "edges": [
    {"sourceKey":"order","targetKey":"inbound","actionName":"purchase_inbound","relation":"inbound"}
  ]
}`))
	if err != nil {
		t.Fatalf("decode graph: %v", err)
	}
	if len(nodes) != 2 || nodes[1].DocumentEntity != "purchase-inbound" {
		t.Fatalf("nodes = %#v", nodes)
	}
	if len(edges) != 1 || edges[0].Action != "purchase_inbound" || edges[0].Relation != "inbound" {
		t.Fatalf("edges = %#v", edges)
	}
}

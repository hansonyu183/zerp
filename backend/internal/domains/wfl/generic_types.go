package wfl

import (
	"encoding/json"
	"time"
)

const (
	DefinitionDraft    = "DRAFT"
	DefinitionEnabled  = "ENABLED"
	DefinitionDisabled = "DISABLED"
	InstanceActive     = "ACTIVE"
	InstanceCompleted  = "COMPLETED"
)

type DefinitionQueryInput struct {
	Page     int      `json:"page"`
	PageSize int      `json:"pageSize"`
	Keyword  string   `json:"keyword,omitempty"`
	Statuses []string `json:"statuses,omitempty"`
}

type DefinitionGetInput struct {
	DefinitionID string `json:"definitionId"`
}

type DefinitionNodeInput struct {
	ID             string          `json:"id"`
	Key            string          `json:"key"`
	Name           string          `json:"name"`
	DocumentEntity string          `json:"documentEntity"`
	PositionX      int             `json:"positionX"`
	PositionY      int             `json:"positionY"`
	Defaults       json.RawMessage `json:"defaults"`
}

type DefinitionEdgeInput struct {
	ID           string          `json:"id"`
	SourceNodeID string          `json:"sourceNodeId"`
	TargetNodeID string          `json:"targetNodeId"`
	ConverterKey string          `json:"converterKey"`
	Condition    json.RawMessage `json:"condition"`
}

type DefinitionCreateInput struct {
	Code           string                `json:"code"`
	Name           string                `json:"name"`
	RootNodeID     string                `json:"rootNodeId"`
	StartCondition json.RawMessage       `json:"startCondition"`
	Nodes          []DefinitionNodeInput `json:"nodes"`
	Edges          []DefinitionEdgeInput `json:"edges"`
}

type DefinitionSaveInput struct {
	DefinitionCreateInput
	DefinitionID string `json:"definitionId"`
	Revision     int64  `json:"revision"`
}

type DefinitionActionInput struct {
	DefinitionID string `json:"definitionId"`
	Revision     int64  `json:"revision"`
}

type DefinitionListItem struct {
	DefinitionID string    `json:"definitionId"`
	Code         string    `json:"code"`
	Name         string    `json:"name"`
	Status       string    `json:"status"`
	Revision     int64     `json:"revision"`
	RootEntity   string    `json:"rootEntity"`
	NodeCount    int       `json:"nodeCount"`
	UpdatedAt    time.Time `json:"updatedAt"`
}

type DefinitionView struct {
	DefinitionID   string                `json:"definitionId"`
	Code           string                `json:"code"`
	Name           string                `json:"name"`
	Status         string                `json:"status"`
	Revision       int64                 `json:"revision"`
	RootNodeID     string                `json:"rootNodeId"`
	StartCondition json.RawMessage       `json:"startCondition"`
	Nodes          []DefinitionNodeInput `json:"nodes"`
	Edges          []DefinitionEdgeInput `json:"edges"`
	UpdatedAt      time.Time             `json:"updatedAt"`
}

type InstanceQueryInput struct {
	Page         int      `json:"page"`
	PageSize     int      `json:"pageSize"`
	Keyword      string   `json:"keyword,omitempty"`
	DefinitionID string   `json:"definitionId,omitempty"`
	Statuses     []string `json:"statuses,omitempty"`
}

type InstanceGetInput struct {
	ProcessID string `json:"processId"`
}

type InstanceHistoryInput struct {
	ProcessID string `json:"processId"`
	Page      int    `json:"page"`
	PageSize  int    `json:"pageSize"`
}

type InstanceListItem struct {
	ProcessID      string    `json:"processId"`
	DefinitionID   string    `json:"definitionId"`
	DefinitionCode string    `json:"definitionCode"`
	DefinitionName string    `json:"definitionName"`
	Status         string    `json:"status"`
	Revision       int64     `json:"revision"`
	RootDocumentID string    `json:"rootDocumentId"`
	RootDocumentNo string    `json:"rootDocumentNo"`
	RootEntity     string    `json:"rootEntity"`
	UpdatedAt      time.Time `json:"updatedAt"`
}

type NodeInstanceView struct {
	NodeInstanceID       string     `json:"nodeInstanceId"`
	DefinitionNodeID     *string    `json:"definitionNodeId,omitempty"`
	ParentNodeInstanceID *string    `json:"parentNodeInstanceId,omitempty"`
	NodeKey              string     `json:"nodeKey"`
	NodeName             string     `json:"nodeName"`
	DocumentID           string     `json:"documentId"`
	DocumentNo           string     `json:"documentNo"`
	DocumentEntity       string     `json:"documentEntity"`
	DocumentStatus       string     `json:"documentStatus"`
	DocumentRevision     int64      `json:"documentRevision"`
	BusinessDate         string     `json:"businessDate"`
	Legacy               bool       `json:"legacy"`
	EvaluatedRevision    *int64     `json:"evaluatedDefinitionRevision,omitempty"`
	EvaluatedAt          *time.Time `json:"evaluatedAt,omitempty"`
}

type InstanceView struct {
	InstanceListItem
	StartedDefinitionRevision int64              `json:"startedDefinitionRevision"`
	Nodes                     []NodeInstanceView `json:"nodes"`
}

type RuntimeAuditView struct {
	ID             string          `json:"id"`
	EventType      string          `json:"eventType"`
	NodeInstanceID *string         `json:"nodeInstanceId,omitempty"`
	DocumentID     *string         `json:"documentId,omitempty"`
	DocumentNo     *string         `json:"documentNo,omitempty"`
	ActorID        string          `json:"actorId"`
	RequestID      string          `json:"requestId"`
	Summary        json.RawMessage `json:"summary"`
	OccurredAt     time.Time       `json:"occurredAt"`
}

type CatalogNode struct {
	Entity string `json:"entity"`
	Name   string `json:"name"`
}

type CatalogConverter struct {
	Key              string   `json:"key"`
	SourceEntity     string   `json:"sourceEntity"`
	TargetEntity     string   `json:"targetEntity"`
	RequiredDefaults []string `json:"requiredDefaults"`
}

type DefinitionCatalog struct {
	Nodes      []CatalogNode      `json:"nodes"`
	Converters []CatalogConverter `json:"converters"`
	Operators  []string           `json:"operators"`
}

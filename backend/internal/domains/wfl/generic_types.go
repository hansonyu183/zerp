package wfl

import (
	"encoding/json"
	"time"

	"github.com/hansonyu183/zerp/backend/internal/platform/approval"
)

type DefinitionQueryInput struct {
	Page     int    `json:"page"`
	PageSize int    `json:"pageSize"`
	Keyword  string `json:"keyword,omitempty"`
	Enabled  *bool  `json:"enabled,omitempty"`
}
type DefinitionGetInput struct {
	DefinitionID string `json:"definitionId"`
}
type DefinitionDiagnostic struct {
	Message string `json:"message"`
	Line    int    `json:"line,omitempty"`
	Column  int    `json:"column,omitempty"`
}
type DefinitionNodeView struct {
	Key            string `json:"key"`
	Name           string `json:"name"`
	DocumentEntity string `json:"documentEntity"`
	PositionX      int    `json:"positionX"`
	PositionY      int    `json:"positionY"`
}
type DefinitionEdgeView struct {
	SourceNodeKey string `json:"sourceNodeKey"`
	TargetNodeKey string `json:"targetNodeKey"`
	Action        string `json:"action"`
	Relation      string `json:"relation"`
}
type DefinitionListItem struct {
	DefinitionID string               `json:"definitionId"`
	Code         string               `json:"code"`
	Name         string               `json:"name"`
	Enabled      bool                 `json:"enabled"`
	Approval     approval.VersionMeta `json:"approval"`
	RootEntity   string               `json:"rootEntity"`
	NodeCount    int                  `json:"nodeCount"`
	UpdatedAt    time.Time            `json:"updatedAt"`
}
type DefinitionView struct {
	DefinitionListItem
	Script      string                `json:"script"`
	Diagnostic  *DefinitionDiagnostic `json:"diagnostic,omitempty"`
	RootNodeKey string                `json:"rootNodeKey"`
	Nodes       []DefinitionNodeView  `json:"nodes"`
	Edges       []DefinitionEdgeView  `json:"edges"`
}
type DefinitionTrialInput struct {
	DefinitionID    string                `json:"definitionId"`
	ApprovalEntryID string                `json:"approvalEntryId"`
	Revision        int64                 `json:"revision"`
	Source          DefinitionTrialSource `json:"source"`
}
type DefinitionTrialSource struct {
	Entity     string `json:"entity"`
	DocumentID string `json:"documentId"`
}
type DefinitionTrialResult struct {
	DefinitionID      string                   `json:"definitionId"`
	ApprovalEntryID   string                   `json:"approvalEntryId"`
	Revision          int64                    `json:"revision"`
	Matched           bool                     `json:"matched"`
	RootNodeKey       string                   `json:"rootNodeKey"`
	Trace             []WorkflowExecutionTrace `json:"trace"`
	PlannedActions    []PlannedAction          `json:"plannedActions"`
	UncoveredBranches []string                 `json:"uncoveredBranches"`
}
type InstanceQueryInput struct {
	Page          int    `json:"page"`
	PageSize      int    `json:"pageSize"`
	Keyword       string `json:"keyword,omitempty"`
	DefinitionID  string `json:"definitionId,omitempty"`
	PartyObjectID string `json:"partyObjectId,omitempty"`
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
	ProcessID       string    `json:"processId"`
	DefinitionID    string    `json:"definitionId"`
	ApprovalEntryID string    `json:"approvalEntryId"`
	DefinitionCode  string    `json:"definitionCode"`
	DefinitionName  string    `json:"definitionName"`
	Revision        int64     `json:"revision"`
	RootDocumentID  string    `json:"rootDocumentId"`
	RootDocumentNo  string    `json:"rootDocumentNo"`
	RootEntity      string    `json:"rootEntity"`
	PartyCode       string    `json:"partyCode"`
	PartyName       string    `json:"partyName"`
	UpdatedAt       time.Time `json:"updatedAt"`
}
type NodeInstanceView struct {
	NodeInstanceID           string     `json:"nodeInstanceId"`
	ParentNodeInstanceID     *string    `json:"parentNodeInstanceId,omitempty"`
	NodeKey                  string     `json:"nodeKey"`
	NodeName                 string     `json:"nodeName"`
	DocumentID               string     `json:"documentId"`
	DocumentNo               string     `json:"documentNo"`
	DocumentEntity           string     `json:"documentEntity"`
	DocumentStatus           string     `json:"documentStatus"`
	DocumentRevision         int64      `json:"documentRevision"`
	BusinessDate             string     `json:"businessDate"`
	BusinessParentEntity     string     `json:"businessParentEntity,omitempty"`
	BusinessParentDocumentID string     `json:"businessParentDocumentId,omitempty"`
	Relation                 string     `json:"relation,omitempty"`
	Trigger                  string     `json:"trigger"`
	Action                   string     `json:"action,omitempty"`
	EvaluatedAt              *time.Time `json:"evaluatedAt,omitempty"`
}
type AvailableChildTarget struct {
	ParentNodeInstanceID string `json:"parentNodeInstanceId"`
	TargetNodeKey        string `json:"targetNodeKey"`
	TargetNodeName       string `json:"targetNodeName"`
	TargetEntity         string `json:"targetEntity"`
	Relation             string `json:"relation"`
}
type InstanceView struct {
	InstanceListItem
	Nodes            []NodeInstanceView     `json:"nodes"`
	AvailableTargets []AvailableChildTarget `json:"availableTargets"`
}
type CreateChildInput struct {
	ProcessID            string `json:"processId"`
	ParentNodeInstanceID string `json:"parentNodeInstanceId"`
	TargetNodeKey        string `json:"targetNodeKey"`
	RequestKey           string `json:"requestKey"`
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

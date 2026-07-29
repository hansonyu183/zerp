package wfl

import (
	"encoding/json"
	"time"

	voudomain "github.com/hansonyu183/zerp/backend/internal/domains/vou"
)

const (
	ProcessTypeSales     = "SALES_FULFILLMENT"
	ProcessTypePurchase  = "PURCHASE_FULFILLMENT"
	StatusDraft          = "DRAFT"
	StatusChecked        = "CHECKED"
	StatusApproved       = "APPROVED"
	StatusCompleted      = "COMPLETED"
	StatusShortRequested = "SHORT_CLOSE_REQUESTED"
	StatusShortClosed    = "SHORT_CLOSED"
	StatusReturning      = "RETURNING"

	StageSaleOrder       = "SALE_ORDER"
	StageProduction      = "PRODUCTION"
	StageOutbound        = "OUTBOUND"
	StageDelivery        = "DELIVERY"
	StageSignoff         = "SIGNOFF"
	StageReturn          = "RETURN"
	StagePurchaseOrder   = "PURCHASE_ORDER"
	StagePurchaseInbound = "PURCHASE_INBOUND"
)

type ErrorKind string

const (
	ErrorValidation ErrorKind = "VALIDATION"
	ErrorConflict   ErrorKind = "CONFLICT"
	ErrorInternal   ErrorKind = "INTERNAL"
)

type DomainError struct {
	Kind    ErrorKind
	Message string
	Data    any
	Cause   error
}

func (e *DomainError) Error() string { return e.Message }
func (e *DomainError) Unwrap() error { return e.Cause }

type SalesCreateInput struct {
	Data voudomain.DraftInput `json:"data"`
}

type SalesSaveInput struct {
	ProcessID        string               `json:"processId"`
	ProcessRevision  int64                `json:"processRevision"`
	DocumentID       string               `json:"documentId"`
	DocumentRevision int64                `json:"documentRevision"`
	Data             voudomain.DraftInput `json:"data"`
}

type ActionInput struct {
	ProcessID        string          `json:"processId"`
	ProcessRevision  int64           `json:"processRevision"`
	DocumentID       string          `json:"documentId,omitempty"`
	DocumentRevision int64           `json:"documentRevision,omitempty"`
	Data             json.RawMessage `json:"data,omitempty"`
	Reason           string          `json:"reason,omitempty"`
}

type QueryInput struct {
	Page     int      `json:"page"`
	PageSize int      `json:"pageSize"`
	Keyword  string   `json:"keyword,omitempty"`
	Statuses []string `json:"statuses,omitempty"`
}

type GetInput struct {
	ProcessID string `json:"processId"`
}

type HistoryInput struct {
	ProcessID string `json:"processId"`
	Page      int    `json:"page"`
	PageSize  int    `json:"pageSize"`
}

type DocumentSummary struct {
	DocumentID       string                     `json:"documentId"`
	DocumentNo       string                     `json:"documentNo"`
	Entity           string                     `json:"entity"`
	Stage            string                     `json:"stage"`
	Status           string                     `json:"status"`
	Revision         int64                      `json:"revision"`
	ParentEntity     string                     `json:"parentEntity,omitempty"`
	ParentDocumentID string                     `json:"parentDocumentId,omitempty"`
	ParentDocumentNo string                     `json:"parentDocumentNo,omitempty"`
	BusinessDate     string                     `json:"businessDate"`
	Currency         string                     `json:"currency"`
	Amount           string                     `json:"amount"`
	CreatedAt        time.Time                  `json:"createdAt"`
	CreatedBy        string                     `json:"createdBy"`
	ReviewedAt       *time.Time                 `json:"reviewedAt,omitempty"`
	ReviewedBy       *string                    `json:"reviewedBy,omitempty"`
	ApprovedAt       *time.Time                 `json:"approvedAt,omitempty"`
	ApprovedBy       *string                    `json:"approvedBy,omitempty"`
	Data             any                        `json:"data,omitempty"`
	Lines            any                        `json:"lines,omitempty"`
	Attachments      []voudomain.AttachmentView `json:"attachments"`
}

type LineBalance struct {
	CustomerLineID             string `json:"customerLineId"`
	OrderedQuantity            string `json:"orderedQuantity"`
	ProcurementQuantity        string `json:"procurementQuantity,omitempty"`
	ReceivedQuantity           string `json:"receivedQuantity"`
	DeliveredQuantity          string `json:"deliveredQuantity"`
	SignedQuantity             string `json:"signedQuantity"`
	RejectedQuantity           string `json:"rejectedQuantity"`
	LossQuantity               string `json:"lossQuantity"`
	AvailableToDeliverQuantity string `json:"availableToDeliverQuantity"`
	RemainingToSignQuantity    string `json:"remainingToSignQuantity"`
}

type Balances struct {
	Lines                  []LineBalance `json:"lines"`
	SolventContainers      int64         `json:"solventContainers"`
	ResinContainers        int64         `json:"resinContainers"`
	HasUnfinishedDocuments bool          `json:"hasUnfinishedDocuments"`
}

type ProcessView struct {
	ProcessID         string            `json:"processId"`
	ProcessType       string            `json:"processType"`
	DefinitionVersion int32             `json:"definitionVersion"`
	Status            string            `json:"status"`
	Revision          int64             `json:"revision"`
	RootDocumentID    string            `json:"rootDocumentId"`
	RootDocumentNo    string            `json:"rootDocumentNo"`
	CurrentStage      string            `json:"currentStage"`
	Documents         []DocumentSummary `json:"documents"`
	Balances          Balances          `json:"balances"`
	CreatedAt         time.Time         `json:"createdAt"`
	CreatedBy         string            `json:"createdBy"`
	UpdatedAt         time.Time         `json:"updatedAt"`
	UpdatedBy         string            `json:"updatedBy"`
}

type MutationResult struct {
	ProcessID        string    `json:"processId"`
	ProcessRevision  int64     `json:"processRevision"`
	WorkflowStatus   string    `json:"workflowStatus"`
	DocumentID       string    `json:"documentId,omitempty"`
	DocumentNo       string    `json:"documentNo,omitempty"`
	DocumentRevision int64     `json:"documentRevision,omitempty"`
	DocumentStatus   string    `json:"documentStatus,omitempty"`
	ParentDocumentID string    `json:"parentDocumentId,omitempty"`
	Balances         *Balances `json:"balances,omitempty"`
}

type Page[T any] struct {
	Items    []T   `json:"items"`
	Total    int64 `json:"total"`
	Page     int   `json:"page"`
	PageSize int   `json:"pageSize"`
}

type AuditView struct {
	ID             string          `json:"id"`
	EventType      string          `json:"eventType"`
	FromStatus     *string         `json:"fromStatus"`
	ToStatus       string          `json:"toStatus"`
	Stage          *string         `json:"stage,omitempty"`
	DocumentID     *string         `json:"documentId,omitempty"`
	DocumentNo     *string         `json:"documentNo,omitempty"`
	DocumentStatus *string         `json:"documentStatus,omitempty"`
	ActorID        string          `json:"actorId"`
	OccurredAt     time.Time       `json:"occurredAt"`
	Reason         *string         `json:"reason,omitempty"`
	RequestID      string          `json:"requestId"`
	Summary        json.RawMessage `json:"summary"`
}

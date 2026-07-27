package wfl

import (
	"encoding/json"
	"time"

	voudomain "github.com/hansonyu183/zerp/backend/internal/domains/vou"
)

const (
	ProcessTypeIntermediary = "INTERMEDIARY_TRADE"
	ProcessTypeSales        = "SALES_FULFILLMENT"
	StatusDraft             = "DRAFT"
	StatusChecked           = "CHECKED"
	StatusApproved          = "APPROVED"
	StatusCompleted         = "COMPLETED"
	StatusShortRequested    = "SHORT_CLOSE_REQUESTED"
	StatusShortClosed       = "SHORT_CLOSED"

	StageCustomer    = "CUSTOMER_ORDER"
	StageProcurement = "PROCUREMENT"
	StageReceipt     = "RECEIPT"
	StageDelivery    = "DELIVERY"
	StageSignoff     = "SIGNOFF"
	StageSaleOrder   = "SALE_ORDER"
	StageOutbound    = "OUTBOUND"
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

type ReferenceInput = voudomain.ReferenceInput

type CustomerLineInput struct {
	Product              ReferenceInput `json:"product"`
	OrderedQuantity      string         `json:"orderedQuantity"`
	UnitPrice            string         `json:"unitPrice"`
	ContainerType        *string        `json:"containerType,omitempty"`
	QuantityPerContainer *string        `json:"quantityPerContainer,omitempty"`
	Remark               string         `json:"remark,omitempty"`
}

type CustomerOrderInput struct {
	BusinessDate string              `json:"businessDate"`
	Currency     string              `json:"currency"`
	Remark       string              `json:"remark,omitempty"`
	Customer     ReferenceInput      `json:"customer"`
	Salesperson  *ReferenceInput     `json:"salesperson,omitempty"`
	Lines        []CustomerLineInput `json:"lines"`
}

type CreateInput struct {
	Data CustomerOrderInput `json:"data"`
}

type SaveInput struct {
	ProcessID        string             `json:"processId"`
	ProcessRevision  int64              `json:"processRevision"`
	DocumentID       string             `json:"documentId"`
	DocumentRevision int64              `json:"documentRevision"`
	Data             CustomerOrderInput `json:"data"`
}

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

type QuantityLineInput struct {
	SourceLineID string `json:"sourceLineId"`
	Quantity     string `json:"quantity"`
	Remark       string `json:"remark,omitempty"`
}

type ProcurementLineInput struct {
	SourceLineID string `json:"sourceLineId"`
	Quantity     string `json:"quantity"`
	UnitPrice    string `json:"unitPrice,omitempty"`
	Remark       string `json:"remark,omitempty"`
}

type ProcurementInput struct {
	Supplier     ReferenceInput         `json:"supplier"`
	Purchaser    *ReferenceInput        `json:"purchaser,omitempty"`
	BusinessDate string                 `json:"businessDate"`
	Lines        []ProcurementLineInput `json:"lines"`
	Remark       string                 `json:"remark,omitempty"`
}

type ReceiptInput struct {
	BusinessDate string              `json:"businessDate"`
	Lines        []QuantityLineInput `json:"lines"`
	Remark       string              `json:"remark,omitempty"`
}

type DeliveryInput struct {
	BusinessDate string              `json:"businessDate"`
	Platform     ReferenceInput      `json:"platform"`
	Vehicle      ReferenceInput      `json:"vehicle"`
	Lines        []QuantityLineInput `json:"lines"`
	Remark       string              `json:"remark,omitempty"`
}

type SignoffLineInput struct {
	SourceLineID     string `json:"sourceLineId"`
	SignedQuantity   string `json:"signedQuantity"`
	RejectedQuantity string `json:"rejectedQuantity"`
	Remark           string `json:"remark,omitempty"`
}

type SignoffInput struct {
	BusinessDate              string             `json:"businessDate"`
	Lines                     []SignoffLineInput `json:"lines"`
	ReturnedSolventContainers int64              `json:"returnedSolventContainers"`
	ReturnedResinContainers   int64              `json:"returnedResinContainers"`
	ContainerDifferenceReason string             `json:"containerDifferenceReason,omitempty"`
	Remark                    string             `json:"remark,omitempty"`
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

type AttachmentInitiateInput struct {
	ProcessID        string `json:"processId"`
	ProcessRevision  int64  `json:"processRevision"`
	DocumentID       string `json:"documentId"`
	DocumentRevision int64  `json:"documentRevision"`
	FileName         string `json:"fileName"`
	ContentType      string `json:"contentType"`
	Size             int64  `json:"size"`
	SHA256           string `json:"sha256"`
}

type AttachmentDownloadInput struct {
	ProcessID  string `json:"processId"`
	DocumentID string `json:"documentId"`
	FileID     string `json:"fileId"`
}

type AttachmentRemoveInput struct {
	ProcessID        string `json:"processId"`
	ProcessRevision  int64  `json:"processRevision"`
	DocumentID       string `json:"documentId"`
	DocumentRevision int64  `json:"documentRevision"`
	FileID           string `json:"fileId"`
}

type AttachmentInitiateResult struct {
	ProcessID        string    `json:"processId"`
	ProcessRevision  int64     `json:"processRevision"`
	DocumentID       string    `json:"documentId"`
	DocumentRevision int64     `json:"documentRevision"`
	FileID           string    `json:"fileId"`
	UploadURL        string    `json:"uploadUrl"`
	ExpiresAt        time.Time `json:"expiresAt"`
}

type AttachmentDownloadResult struct {
	DownloadURL string    `json:"downloadUrl"`
	ExpiresAt   time.Time `json:"expiresAt"`
}

type AttachmentRemoveResult struct {
	ProcessID        string `json:"processId"`
	ProcessRevision  int64  `json:"processRevision"`
	DocumentID       string `json:"documentId"`
	DocumentRevision int64  `json:"documentRevision"`
	DocumentStatus   string `json:"documentStatus"`
}

type DocumentSummary struct {
	DocumentID       string                     `json:"documentId"`
	DocumentNo       string                     `json:"documentNo"`
	Entity           string                     `json:"entity"`
	Stage            string                     `json:"stage"`
	Status           string                     `json:"status"`
	Revision         int64                      `json:"revision"`
	ParentDocumentID string                     `json:"parentDocumentId,omitempty"`
	SourceDocumentNo string                     `json:"sourceDocumentNo,omitempty"`
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

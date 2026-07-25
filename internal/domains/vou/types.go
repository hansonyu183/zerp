package vou

import (
	"encoding/json"
	"time"
)

const (
	EntitySaleOrder             = "sale-order"
	EntityPurchaseOrder         = "purchase-order"
	EntityIntermediarySaleOrder = "intermediary-sale-order"
	EntityReceipt               = "receipt"
	EntityPayment               = "payment"
	EntityExpenseReimbursement  = "expense-reimbursement"
	EntityOtherIncome           = "other-income"
	EntityCustomerOrder         = "customer-order"
	EntityProcurementOrder      = "procurement-order"
	EntityGoodsReceipt          = "goods-receipt"
	EntityDeliveryNote          = "delivery-note"
	EntitySignoffNote           = "signoff-note"

	StatusDraft               = "DRAFT"
	StatusReviewed            = "REVIEWED"
	StatusApproved            = "APPROVED"
	StatusExecuted            = "EXECUTED"
	StatusChecked             = "CHECKED"
	StatusCompleted           = "COMPLETED"
	StatusShortCloseRequested = "SHORT_CLOSE_REQUESTED"
	StatusShortClosed         = "SHORT_CLOSED"
)

var entities = [...]string{
	EntitySaleOrder,
	EntityPurchaseOrder,
	EntityIntermediarySaleOrder,
	EntityReceipt,
	EntityPayment,
	EntityExpenseReimbursement,
	EntityOtherIncome,
}

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

func domainError(kind ErrorKind, message string, data any, cause error) error {
	return &DomainError{Kind: kind, Message: message, Data: data, Cause: cause}
}

type ReferenceInput struct {
	ObjectID  string `json:"objectId"`
	VersionID string `json:"versionId"`
}

type ProductLineInput struct {
	Product              ReferenceInput `json:"product"`
	OrderedQuantity      string         `json:"orderedQuantity"`
	UnitPrice            string         `json:"unitPrice"`
	PurchaseUnitPrice    string         `json:"purchaseUnitPrice,omitempty"`
	Remark               string         `json:"remark,omitempty"`
	ContainerType        *string        `json:"containerType,omitempty"`
	QuantityPerContainer *string        `json:"quantityPerContainer,omitempty"`
}

type ExpenseLineInput struct {
	Category    string `json:"category"`
	Description string `json:"description"`
	Amount      string `json:"amount"`
	Remark      string `json:"remark,omitempty"`
}

type DraftInput struct {
	BusinessDate     string             `json:"businessDate"`
	Currency         string             `json:"currency"`
	Remark           string             `json:"remark,omitempty"`
	Customer         *ReferenceInput    `json:"customer,omitempty"`
	Supplier         *ReferenceInput    `json:"supplier,omitempty"`
	CounterpartyType string             `json:"counterpartyType,omitempty"`
	Counterparty     *ReferenceInput    `json:"counterparty,omitempty"`
	Employee         *ReferenceInput    `json:"employee,omitempty"`
	Salesperson      *ReferenceInput    `json:"salesperson,omitempty"`
	Purchaser        *ReferenceInput    `json:"purchaser,omitempty"`
	Handler          *ReferenceInput    `json:"handler,omitempty"`
	Warehouse        *ReferenceInput    `json:"warehouse,omitempty"`
	FundAccount      *ReferenceInput    `json:"fundAccount,omitempty"`
	SourceName       string             `json:"sourceName,omitempty"`
	Amount           string             `json:"amount,omitempty"`
	ProductLines     []ProductLineInput `json:"productLines,omitempty"`
	ExpenseLines     []ExpenseLineInput `json:"expenseLines,omitempty"`
}

type CreateInput struct {
	Data DraftInput `json:"data"`
}

type SaveInput struct {
	DocumentID string     `json:"documentId"`
	Revision   int64      `json:"revision"`
	Data       DraftInput `json:"data"`
}

type DocumentRevisionInput struct {
	DocumentID string `json:"documentId"`
	Revision   int64  `json:"revision"`
}

type ReverseInput struct {
	DocumentID string `json:"documentId"`
	Revision   int64  `json:"revision"`
	Reason     string `json:"reason"`
}

type SaleExecutionLineInput struct {
	LineID           string `json:"lineId"`
	OutboundQuantity string `json:"outboundQuantity"`
	SignedQuantity   string `json:"signedQuantity"`
	RejectedQuantity string `json:"rejectedQuantity"`
	LossQuantity     string `json:"lossQuantity"`
}

type PurchaseExecutionLineInput struct {
	LineID          string `json:"lineId"`
	InboundQuantity string `json:"inboundQuantity"`
}

type ExecuteInput struct {
	DocumentID       string                       `json:"documentId"`
	Revision         int64                        `json:"revision"`
	OutboundDate     string                       `json:"outboundDate,omitempty"`
	SignoffDate      string                       `json:"signoffDate,omitempty"`
	InboundDate      string                       `json:"inboundDate,omitempty"`
	Platform         *ReferenceInput              `json:"platform,omitempty"`
	Vehicle          *ReferenceInput              `json:"vehicle,omitempty"`
	DifferenceReason string                       `json:"differenceReason,omitempty"`
	SaleLines        []SaleExecutionLineInput     `json:"saleLines,omitempty"`
	PurchaseLines    []PurchaseExecutionLineInput `json:"purchaseLines,omitempty"`
}

type GetInput struct {
	DocumentID  string `json:"documentId"`
	permissions []string
}

type QueryFilters struct {
	Keyword       string   `json:"keyword,omitempty"`
	Status        []string `json:"status,omitempty"`
	DateFrom      string   `json:"dateFrom,omitempty"`
	DateTo        string   `json:"dateTo,omitempty"`
	PartyObjectID string   `json:"partyObjectId,omitempty"`
}

type SortInput struct {
	Field string `json:"field"`
	Order string `json:"order"`
}

type QueryInput struct {
	Page        int          `json:"page"`
	PageSize    int          `json:"pageSize"`
	Filters     QueryFilters `json:"filters"`
	Sort        []SortInput  `json:"sort"`
	permissions []string
}

type HistoryInput struct {
	DocumentID string `json:"documentId"`
	Page       int    `json:"page"`
	PageSize   int    `json:"pageSize"`
}

type AttachmentInitiateInput struct {
	DocumentID  string `json:"documentId"`
	Revision    int64  `json:"revision"`
	FileName    string `json:"fileName"`
	ContentType string `json:"contentType"`
	Size        int64  `json:"size"`
	SHA256      string `json:"sha256"`
}

type AttachmentDownloadInput struct {
	DocumentID string `json:"documentId"`
	FileID     string `json:"fileId"`
}

type AttachmentRemoveInput struct {
	DocumentID string `json:"documentId"`
	Revision   int64  `json:"revision"`
	FileID     string `json:"fileId"`
}

type ReferenceView struct {
	ObjectID    string `json:"objectId"`
	VersionID   string `json:"versionId"`
	Entity      string `json:"entity"`
	Code        string `json:"code"`
	Name        string `json:"name"`
	Unit        string `json:"unit,omitempty"`
	Currency    string `json:"currency,omitempty"`
	PlateNumber string `json:"plateNumber,omitempty"`
}

type ProductLineView struct {
	LineID               string        `json:"lineId"`
	LineNo               int32         `json:"lineNo"`
	Product              ReferenceView `json:"product"`
	OrderedQuantity      string        `json:"orderedQuantity"`
	UnitPrice            string        `json:"unitPrice"`
	PurchaseUnitPrice    string        `json:"purchaseUnitPrice,omitempty"`
	LineAmount           string        `json:"lineAmount"`
	Remark               string        `json:"remark,omitempty"`
	OutboundQuantity     string        `json:"outboundQuantity,omitempty"`
	SignedQuantity       string        `json:"signedQuantity,omitempty"`
	RejectedQuantity     string        `json:"rejectedQuantity,omitempty"`
	LossQuantity         string        `json:"lossQuantity,omitempty"`
	InboundQuantity      string        `json:"inboundQuantity,omitempty"`
	ContainerType        string        `json:"containerType,omitempty"`
	QuantityPerContainer string        `json:"quantityPerContainer,omitempty"`
}

type ExpenseLineView struct {
	LineID      string `json:"lineId"`
	LineNo      int32  `json:"lineNo"`
	Category    string `json:"category"`
	Description string `json:"description"`
	Amount      string `json:"amount"`
	Remark      string `json:"remark,omitempty"`
}

type SettlementMethodSnapshotView struct {
	ObjectID    string `json:"objectId"`
	VersionID   string `json:"versionId"`
	Code        string `json:"code"`
	Name        string `json:"name"`
	RuleType    string `json:"ruleType"`
	MonthOffset int32  `json:"monthOffset"`
	DayOfMonth  *int32 `json:"dayOfMonth,omitempty"`
	DayOffset   int32  `json:"dayOffset"`
	Description string `json:"description,omitempty"`
}

type AttachmentView struct {
	FileID      string     `json:"fileId"`
	FileName    string     `json:"fileName"`
	ContentType string     `json:"contentType"`
	Size        int64      `json:"size"`
	SHA256      string     `json:"sha256"`
	Status      string     `json:"status"`
	StoredAt    *time.Time `json:"storedAt,omitempty"`
	CreatedAt   time.Time  `json:"createdAt"`
	CreatedBy   string     `json:"createdBy"`
}

type DocumentDataView struct {
	BusinessDate             string                        `json:"businessDate"`
	Currency                 string                        `json:"currency"`
	Remark                   string                        `json:"remark,omitempty"`
	Customer                 *ReferenceView                `json:"customer,omitempty"`
	Supplier                 *ReferenceView                `json:"supplier,omitempty"`
	Counterparty             *ReferenceView                `json:"counterparty,omitempty"`
	Employee                 *ReferenceView                `json:"employee,omitempty"`
	Salesperson              *ReferenceView                `json:"salesperson,omitempty"`
	Purchaser                *ReferenceView                `json:"purchaser,omitempty"`
	Handler                  *ReferenceView                `json:"handler,omitempty"`
	Warehouse                *ReferenceView                `json:"warehouse,omitempty"`
	FundAccount              *ReferenceView                `json:"fundAccount,omitempty"`
	ContactName              string                        `json:"contactName,omitempty"`
	ContactPhone             string                        `json:"contactPhone,omitempty"`
	DeliveryAddress          string                        `json:"deliveryAddress,omitempty"`
	SettlementMethod         *SettlementMethodSnapshotView `json:"settlementMethod,omitempty"`
	CustomerSettlementMethod *SettlementMethodSnapshotView `json:"customerSettlementMethod,omitempty"`
	SupplierSettlementMethod *SettlementMethodSnapshotView `json:"supplierSettlementMethod,omitempty"`
	SourceName               string                        `json:"sourceName,omitempty"`
	ProductLines             []ProductLineView             `json:"productLines,omitempty"`
	ExpenseLines             []ExpenseLineView             `json:"expenseLines,omitempty"`
	OutboundDate             string                        `json:"outboundDate,omitempty"`
	SignoffDate              string                        `json:"signoffDate,omitempty"`
	InboundDate              string                        `json:"inboundDate,omitempty"`
	Platform                 *ReferenceView                `json:"platform,omitempty"`
	Vehicle                  *ReferenceView                `json:"vehicle,omitempty"`
	DifferenceReason         string                        `json:"differenceReason,omitempty"`
}

type DocumentView struct {
	DocumentID  string           `json:"documentId"`
	Entity      string           `json:"entity"`
	DocumentNo  string           `json:"documentNo"`
	Status      string           `json:"status"`
	Revision    int64            `json:"revision"`
	Amount      string           `json:"amount"`
	Data        DocumentDataView `json:"data"`
	Attachments []AttachmentView `json:"attachments"`
	CreatedAt   time.Time        `json:"createdAt"`
	CreatedBy   string           `json:"createdBy"`
	UpdatedAt   time.Time        `json:"updatedAt"`
	UpdatedBy   string           `json:"updatedBy"`
	ReviewedAt  *time.Time       `json:"reviewedAt,omitempty"`
	ReviewedBy  *string          `json:"reviewedBy,omitempty"`
	ApprovedAt  *time.Time       `json:"approvedAt,omitempty"`
	ApprovedBy  *string          `json:"approvedBy,omitempty"`
	ExecutedAt  *time.Time       `json:"executedAt,omitempty"`
	ExecutedBy  *string          `json:"executedBy,omitempty"`
}

type MutationResult struct {
	DocumentID string `json:"documentId"`
	DocumentNo string `json:"documentNo"`
	Status     string `json:"status"`
	Revision   int64  `json:"revision"`
}

type ListItem struct {
	DocumentID   string    `json:"documentId"`
	Entity       string    `json:"entity"`
	DocumentNo   string    `json:"documentNo"`
	Status       string    `json:"status"`
	Revision     int64     `json:"revision"`
	BusinessDate string    `json:"businessDate"`
	PartyName    string    `json:"partyName,omitempty"`
	Currency     string    `json:"currency"`
	Amount       string    `json:"amount"`
	UpdatedAt    time.Time `json:"updatedAt"`
}

type Page[T any] struct {
	Items    []T   `json:"items"`
	Total    int64 `json:"total"`
	Page     int   `json:"page"`
	PageSize int   `json:"pageSize"`
}

type AuditEventView struct {
	ID         string          `json:"id"`
	EventType  string          `json:"eventType"`
	FromStatus *string         `json:"fromStatus"`
	ToStatus   string          `json:"toStatus"`
	ActorID    string          `json:"actorId"`
	OccurredAt time.Time       `json:"occurredAt"`
	Reason     *string         `json:"reason"`
	RequestID  string          `json:"requestId"`
	Summary    json.RawMessage `json:"summary"`
}

type AttachmentInitiateResult struct {
	FileID    string    `json:"fileId"`
	UploadURL string    `json:"uploadUrl"`
	ExpiresAt time.Time `json:"expiresAt"`
	Revision  int64     `json:"revision"`
}

type AttachmentDownloadResult struct {
	DownloadURL string    `json:"downloadUrl"`
	ExpiresAt   time.Time `json:"expiresAt"`
}

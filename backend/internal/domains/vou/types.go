package vou

import (
	"encoding/json"
	"time"
)

const (
	EntitySalePricing          = "sale-pricing"
	EntitySaleOrder            = "sale-order"
	EntitySaleOutbound         = "sale-outbound"
	EntitySaleDelivery         = "sale-delivery"
	EntitySaleSignoff          = "sale-signoff"
	EntitySaleReturn           = "sale-return"
	EntityPurchaseOrder        = "purchase-order"
	EntityPurchaseInbound      = "purchase-inbound"
	EntityPurchaseReturn       = "purchase-return"
	EntityPurchaseInquiry      = "purchase-inquiry"
	EntityOrderProduction      = "order-production"
	EntitySelfProduction       = "self-production"
	EntityReceipt              = "receipt"
	EntityPayment              = "payment"
	EntityExpenseReimbursement = "expense-reimbursement"
	EntityExpensePayment       = "expense-payment"
	EntityOtherIncome          = "other-income"
	StatusDraft                = "DRAFT"
	StatusChecked              = "CHECKED"
	StatusApproved             = "APPROVED"
	StatusFinalized            = "FINALIZED"
	StatusCompleted            = "COMPLETED"
	StatusReturning            = "RETURNING"
	StatusShortCloseRequested  = "SHORT_CLOSE_REQUESTED"
	StatusShortClosed          = "SHORT_CLOSED"
)

var entities = [...]string{
	EntitySalePricing,
	EntitySaleOrder,
	EntitySaleOutbound,
	EntitySaleDelivery,
	EntitySaleSignoff,
	EntitySaleReturn,
	EntityPurchaseOrder,
	EntityPurchaseInbound,
	EntityPurchaseReturn,
	EntityPurchaseInquiry,
	EntityOrderProduction,
	EntitySelfProduction,
	EntityReceipt,
	EntityPayment,
	EntityExpenseReimbursement,
	EntityExpensePayment,
	EntityOtherIncome,
}

func publicCreateEntity(entity string) bool {
	switch entity {
	case EntitySalePricing, EntityPurchaseInquiry, EntitySaleOrder, EntityPurchaseOrder, EntityPurchaseInbound,
		EntitySaleReturn, EntityPurchaseReturn, EntityOrderProduction, EntitySelfProduction,
		EntityReceipt, EntityPayment, EntityExpenseReimbursement, EntityOtherIncome:
		return true
	default:
		return false
	}
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
	SettlementSurcharge  *string        `json:"settlementSurcharge,omitempty"`
	PurchaseUnitPrice    string         `json:"purchaseUnitPrice,omitempty"`
	Remark               string         `json:"remark,omitempty"`
	ContainerType        *string        `json:"containerType,omitempty"`
	QuantityPerContainer *string        `json:"quantityPerContainer,omitempty"`
	Formula              *FormulaInput  `json:"formula,omitempty"`
}

type PriceLineInput struct {
	Product   ReferenceInput `json:"product"`
	UnitPrice string         `json:"unitPrice"`
	Remark    string         `json:"remark,omitempty"`
}

type FormulaInput struct {
	BaseOutputQuantity string                  `json:"baseOutputQuantity"`
	SourceType         string                  `json:"sourceType,omitempty"`
	SourceDocumentID   string                  `json:"sourceDocumentId,omitempty"`
	SourceDocumentNo   string                  `json:"sourceDocumentNo,omitempty"`
	Components         []FormulaComponentInput `json:"components"`
}

type FormulaComponentInput struct {
	Material ReferenceInput `json:"material"`
	Quantity string         `json:"quantity"`
}

type FormulaDefaultInput struct {
	Customer *ReferenceInput `json:"customer,omitempty"`
	Product  ReferenceInput  `json:"product"`
}

type SourceQuantityLineInput struct {
	SourceLineID string `json:"sourceLineId"`
	Quantity     string `json:"quantity"`
	Remark       string `json:"remark,omitempty"`
}

type SaleSignoffLineInput struct {
	SourceLineID     string `json:"sourceLineId"`
	SignedQuantity   string `json:"signedQuantity"`
	RejectedQuantity string `json:"rejectedQuantity"`
	Remark           string `json:"remark,omitempty"`
}

type ReturnLineInput struct {
	SourceLineID string `json:"sourceLineId"`
	Quantity     string `json:"quantity"`
	Remark       string `json:"remark,omitempty"`
}

type ExpenseLineInput struct {
	Category    string `json:"category"`
	Description string `json:"description"`
	Amount      string `json:"amount"`
	Remark      string `json:"remark,omitempty"`
}

type ProductionMaterialInput struct {
	FormulaLineNo    int32          `json:"formulaLineNo"`
	ActualMaterial   ReferenceInput `json:"actualMaterial"`
	ActualQuantity   string         `json:"actualQuantity"`
	AdjustmentReason string         `json:"adjustmentReason,omitempty"`
}

type ProductionOutputInput struct {
	SourceOrderLineID string                    `json:"sourceOrderLineId,omitempty"`
	Product           *ReferenceInput           `json:"product,omitempty"`
	OutputQuantity    string                    `json:"outputQuantity"`
	LossRate          string                    `json:"lossRate"`
	Remark            string                    `json:"remark,omitempty"`
	Materials         []ProductionMaterialInput `json:"materials"`
}

type DraftInput struct {
	BusinessDate      string                    `json:"businessDate"`
	Currency          string                    `json:"currency"`
	Remark            string                    `json:"remark,omitempty"`
	ReturnReason      string                    `json:"returnReason,omitempty"`
	SourceDocumentID  string                    `json:"-"`
	Customer          *ReferenceInput           `json:"customer,omitempty"`
	Supplier          *ReferenceInput           `json:"supplier,omitempty"`
	CounterpartyType  string                    `json:"counterpartyType,omitempty"`
	Counterparty      *ReferenceInput           `json:"counterparty,omitempty"`
	Employee          *ReferenceInput           `json:"employee,omitempty"`
	Salesperson       *ReferenceInput           `json:"salesperson,omitempty"`
	Purchaser         *ReferenceInput           `json:"purchaser,omitempty"`
	Handler           *ReferenceInput           `json:"handler,omitempty"`
	Warehouse         *ReferenceInput           `json:"warehouse,omitempty"`
	MaterialWarehouse *ReferenceInput           `json:"materialWarehouse,omitempty"`
	FinishedWarehouse *ReferenceInput           `json:"finishedWarehouse,omitempty"`
	Platform          *ReferenceInput           `json:"platform,omitempty"`
	Vehicle           *ReferenceInput           `json:"vehicle,omitempty"`
	FundAccount       *ReferenceInput           `json:"fundAccount,omitempty"`
	SourceName        string                    `json:"sourceName,omitempty"`
	Amount            string                    `json:"amount,omitempty"`
	ProductLines      []ProductLineInput        `json:"productLines,omitempty"`
	PriceLines        []PriceLineInput          `json:"priceLines,omitempty"`
	ExpenseLines      []ExpenseLineInput        `json:"expenseLines,omitempty"`
	SourceLines       []SourceQuantityLineInput `json:"sourceLines,omitempty"`
	SignoffLines      []SaleSignoffLineInput    `json:"signoffLines,omitempty"`
	ReturnLines       []ReturnLineInput         `json:"returnLines,omitempty"`
	ProductionLines   []ProductionOutputInput   `json:"productionLines,omitempty"`
}

type CreateInput struct {
	ParentEntity     string     `json:"parentEntity,omitempty"`
	ParentDocumentID string     `json:"parentDocumentId,omitempty"`
	Data             DraftInput `json:"data"`
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

type FinalizeInput struct {
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

type DeleteInput = ReverseInput

type GetInput struct {
	DocumentID  string `json:"documentId"`
	permissions []string
}

type PriceReferenceInput struct {
	BusinessDate string           `json:"businessDate"`
	Currency     string           `json:"currency"`
	Supplier     *ReferenceInput  `json:"supplier,omitempty"`
	Products     []ReferenceInput `json:"products"`
}

type PriceReferenceLineView struct {
	ProductObjectID    string `json:"productObjectId"`
	UnitPrice          string `json:"unitPrice"`
	SourceDocumentID   string `json:"sourceDocumentId,omitempty"`
	SourceDocumentNo   string `json:"sourceDocumentNo,omitempty"`
	SourceBusinessDate string `json:"sourceBusinessDate,omitempty"`
}

type PriceReferenceView struct {
	Lines []PriceReferenceLineView `json:"lines"`
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
	ObjectID                        string `json:"objectId"`
	VersionID                       string `json:"versionId"`
	Entity                          string `json:"entity"`
	Code                            string `json:"code"`
	Name                            string `json:"name"`
	Unit                            string `json:"unit,omitempty"`
	Currency                        string `json:"currency,omitempty"`
	PlateNumber                     string `json:"plateNumber,omitempty"`
	ProductKind                     string `json:"productKind,omitempty"`
	PricingQuantityPerInventoryUnit string `json:"pricingQuantityPerInventoryUnit,omitempty"`
}

type ProductLineView struct {
	LineID                string        `json:"lineId"`
	LineNo                int32         `json:"lineNo"`
	Product               ReferenceView `json:"product"`
	OrderedQuantity       string        `json:"orderedQuantity"`
	UnitPrice             string        `json:"unitPrice"`
	BaseUnitPrice         string        `json:"baseUnitPrice"`
	SettlementSurcharge   string        `json:"settlementSurcharge"`
	PurchaseUnitPrice     string        `json:"purchaseUnitPrice,omitempty"`
	LineAmount            string        `json:"lineAmount"`
	Remark                string        `json:"remark,omitempty"`
	OutboundQuantity      string        `json:"outboundQuantity,omitempty"`
	SignedQuantity        string        `json:"signedQuantity,omitempty"`
	RejectedQuantity      string        `json:"rejectedQuantity,omitempty"`
	LossQuantity          string        `json:"lossQuantity,omitempty"`
	InboundQuantity       string        `json:"inboundQuantity,omitempty"`
	ContainerType         string        `json:"containerType,omitempty"`
	QuantityPerContainer  string        `json:"quantityPerContainer,omitempty"`
	SourceLineID          string        `json:"sourceLineId,omitempty"`
	Quantity              string        `json:"quantity,omitempty"`
	AvailableQuantity     string        `json:"availableQuantity,omitempty"`
	ReturnableQuantity    string        `json:"returnableQuantity,omitempty"`
	Formula               *FormulaView  `json:"formula,omitempty"`
	ReferenceUnitPrice    string        `json:"referenceUnitPrice"`
	ReferenceDocumentID   string        `json:"referenceDocumentId,omitempty"`
	ReferenceDocumentNo   string        `json:"referenceDocumentNo,omitempty"`
	ReferenceBusinessDate string        `json:"referenceBusinessDate,omitempty"`
}

type PriceLineView struct {
	LineID    string        `json:"lineId"`
	LineNo    int32         `json:"lineNo"`
	Product   ReferenceView `json:"product"`
	UnitPrice string        `json:"unitPrice"`
	Remark    string        `json:"remark,omitempty"`
}

type FormulaView struct {
	BaseOutputQuantity string                 `json:"baseOutputQuantity"`
	SourceType         string                 `json:"sourceType"`
	SourceDocumentID   string                 `json:"sourceDocumentId,omitempty"`
	SourceDocumentNo   string                 `json:"sourceDocumentNo,omitempty"`
	Components         []FormulaComponentView `json:"components"`
}

type FormulaComponentView struct {
	Material ReferenceView `json:"material"`
	Quantity string        `json:"quantity"`
}

type FormulaDefaultView struct {
	SourceType       string       `json:"sourceType"`
	SourceDocumentID string       `json:"sourceDocumentId,omitempty"`
	SourceDocumentNo string       `json:"sourceDocumentNo,omitempty"`
	Formula          *FormulaView `json:"formula,omitempty"`
}

type ProductionMaterialLineView struct {
	LineID            string        `json:"lineId"`
	LineNo            int32         `json:"lineNo"`
	FormulaMaterial   ReferenceView `json:"formulaMaterial"`
	FormulaQuantity   string        `json:"formulaQuantity"`
	SuggestedQuantity string        `json:"suggestedQuantity"`
	ActualMaterial    ReferenceView `json:"actualMaterial"`
	ActualQuantity    string        `json:"actualQuantity"`
	AdjustmentReason  string        `json:"adjustmentReason,omitempty"`
}

type ProductionOutputLineView struct {
	LineID                    string                       `json:"lineId"`
	LineNo                    int32                        `json:"lineNo"`
	SourceOrderLineID         string                       `json:"sourceOrderLineId,omitempty"`
	Product                   ReferenceView                `json:"product"`
	OutputQuantity            string                       `json:"outputQuantity"`
	LossRate                  string                       `json:"lossRate"`
	FormulaBaseOutputQuantity string                       `json:"formulaBaseOutputQuantity"`
	Remark                    string                       `json:"remark,omitempty"`
	Materials                 []ProductionMaterialLineView `json:"materials"`
}

type SaleSignoffLineView struct {
	LineID             string        `json:"lineId"`
	LineNo             int32         `json:"lineNo"`
	SourceLineID       string        `json:"sourceLineId"`
	Product            ReferenceView `json:"product"`
	OutboundQuantity   string        `json:"outboundQuantity"`
	SignedQuantity     string        `json:"signedQuantity"`
	RejectedQuantity   string        `json:"rejectedQuantity"`
	LossQuantity       string        `json:"lossQuantity"`
	UnitPrice          string        `json:"unitPrice"`
	LineAmount         string        `json:"lineAmount"`
	Remark             string        `json:"remark,omitempty"`
	ReturnableQuantity string        `json:"returnableQuantity,omitempty"`
}

type ManagedLineView struct {
	LineID               string         `json:"lineId"`
	LineNo               int32          `json:"lineNo,omitempty"`
	SourceLineID         string         `json:"sourceLineId,omitempty"`
	Product              *ReferenceView `json:"product,omitempty"`
	Quantity             string         `json:"quantity,omitempty"`
	OrderedQuantity      string         `json:"orderedQuantity,omitempty"`
	SignedQuantity       string         `json:"signedQuantity,omitempty"`
	RejectedQuantity     string         `json:"rejectedQuantity,omitempty"`
	LossQuantity         string         `json:"lossQuantity,omitempty"`
	UnitPrice            string         `json:"unitPrice,omitempty"`
	LineAmount           string         `json:"lineAmount,omitempty"`
	ContainerType        string         `json:"containerType,omitempty"`
	QuantityPerContainer string         `json:"quantityPerContainer,omitempty"`
	Remark               string         `json:"remark,omitempty"`
	SourceDocumentID     string         `json:"sourceDocumentId,omitempty"`
	SourceDocumentNo     string         `json:"sourceDocumentNo,omitempty"`
	ReturnKind           string         `json:"returnKind,omitempty"`
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
	ObjectID              string `json:"objectId"`
	VersionID             string `json:"versionId"`
	Code                  string `json:"code"`
	Name                  string `json:"name"`
	RuleType              string `json:"ruleType"`
	MonthOffset           int32  `json:"monthOffset"`
	DayOfMonth            *int32 `json:"dayOfMonth,omitempty"`
	DayOffset             int32  `json:"dayOffset"`
	DueDays               int32  `json:"dueDays,omitempty"`
	CutoffDay             int32  `json:"cutoffDay,omitempty"`
	DefaultSalesSurcharge string `json:"defaultSalesSurcharge"`
	Description           string `json:"description,omitempty"`
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
	BusinessDate              string                        `json:"businessDate"`
	DueDate                   string                        `json:"dueDate,omitempty"`
	Currency                  string                        `json:"currency"`
	Remark                    string                        `json:"remark,omitempty"`
	ReturnReason              string                        `json:"returnReason,omitempty"`
	ReturnKind                string                        `json:"returnKind,omitempty"`
	Customer                  *ReferenceView                `json:"customer,omitempty"`
	Supplier                  *ReferenceView                `json:"supplier,omitempty"`
	Counterparty              *ReferenceView                `json:"counterparty,omitempty"`
	Employee                  *ReferenceView                `json:"employee,omitempty"`
	Salesperson               *ReferenceView                `json:"salesperson,omitempty"`
	Purchaser                 *ReferenceView                `json:"purchaser,omitempty"`
	Handler                   *ReferenceView                `json:"handler,omitempty"`
	Warehouse                 *ReferenceView                `json:"warehouse,omitempty"`
	MaterialWarehouse         *ReferenceView                `json:"materialWarehouse,omitempty"`
	FinishedWarehouse         *ReferenceView                `json:"finishedWarehouse,omitempty"`
	FundAccount               *ReferenceView                `json:"fundAccount,omitempty"`
	ContactName               string                        `json:"contactName,omitempty"`
	ContactPhone              string                        `json:"contactPhone,omitempty"`
	DeliveryAddress           string                        `json:"deliveryAddress,omitempty"`
	SettlementMethod          *SettlementMethodSnapshotView `json:"settlementMethod,omitempty"`
	CustomerSettlementMethod  *SettlementMethodSnapshotView `json:"customerSettlementMethod,omitempty"`
	SupplierSettlementMethod  *SettlementMethodSnapshotView `json:"supplierSettlementMethod,omitempty"`
	SourceName                string                        `json:"sourceName,omitempty"`
	SettlementMode            string                        `json:"settlementMode,omitempty"`
	ProductLines              []ProductLineView             `json:"productLines,omitempty"`
	PriceLines                []PriceLineView               `json:"priceLines,omitempty"`
	ExpenseLines              []ExpenseLineView             `json:"expenseLines,omitempty"`
	OutboundDate              string                        `json:"outboundDate,omitempty"`
	SignoffDate               string                        `json:"signoffDate,omitempty"`
	InboundDate               string                        `json:"inboundDate,omitempty"`
	Platform                  *ReferenceView                `json:"platform,omitempty"`
	Vehicle                   *ReferenceView                `json:"vehicle,omitempty"`
	DifferenceReason          string                        `json:"differenceReason,omitempty"`
	SignoffLines              []SaleSignoffLineView         `json:"signoffLines,omitempty"`
	FulfillmentStatus         string                        `json:"fulfillmentStatus,omitempty"`
	SignedQuantity            string                        `json:"signedQuantity,omitempty"`
	InTransitQuantity         string                        `json:"inTransitQuantity,omitempty"`
	RemainingQuantity         string                        `json:"remainingQuantity,omitempty"`
	ShortCloseRequestedBy     string                        `json:"shortCloseRequestedBy,omitempty"`
	ShortCloseReason          string                        `json:"shortCloseReason,omitempty"`
	Lines                     []ManagedLineView             `json:"lines,omitempty"`
	ProductionLines           []ProductionOutputLineView    `json:"productionLines,omitempty"`
	ExpectedSolventContainers int64                         `json:"expectedSolventContainers,omitempty"`
	ExpectedResinContainers   int64                         `json:"expectedResinContainers,omitempty"`
	ReturnedSolventContainers int64                         `json:"returnedSolventContainers,omitempty"`
	ReturnedResinContainers   int64                         `json:"returnedResinContainers,omitempty"`
	ContainerDifferenceReason string                        `json:"containerDifferenceReason,omitempty"`
}

type DocumentView struct {
	DocumentID       string           `json:"documentId"`
	Entity           string           `json:"entity"`
	DocumentNo       string           `json:"documentNo"`
	Status           string           `json:"status"`
	Revision         int64            `json:"revision"`
	Amount           string           `json:"amount"`
	Data             DocumentDataView `json:"data"`
	Attachments      []AttachmentView `json:"attachments"`
	CreatedAt        time.Time        `json:"createdAt"`
	CreatedBy        string           `json:"createdBy"`
	UpdatedAt        time.Time        `json:"updatedAt"`
	UpdatedBy        string           `json:"updatedBy"`
	CheckedAt        *time.Time       `json:"checkedAt,omitempty"`
	CheckedBy        *string          `json:"checkedBy,omitempty"`
	ApprovedAt       *time.Time       `json:"approvedAt,omitempty"`
	ApprovedBy       *string          `json:"approvedBy,omitempty"`
	FinalizedAt      *time.Time       `json:"finalizedAt,omitempty"`
	FinalizedBy      *string          `json:"finalizedBy,omitempty"`
	ParentEntity     string           `json:"parentEntity,omitempty"`
	ParentDocumentID string           `json:"parentDocumentId,omitempty"`
	ParentDocumentNo string           `json:"parentDocumentNo,omitempty"`
}

type MutationResult struct {
	DocumentID string `json:"documentId"`
	DocumentNo string `json:"documentNo"`
	Status     string `json:"status"`
	Revision   int64  `json:"revision"`
}

type ListItem struct {
	DocumentID      string             `json:"documentId"`
	Entity          string             `json:"entity"`
	DocumentNo      string             `json:"documentNo"`
	Status          string             `json:"status"`
	Revision        int64              `json:"revision"`
	BusinessDate    string             `json:"businessDate"`
	PartyName       string             `json:"partyName,omitempty"`
	Currency        string             `json:"currency"`
	Amount          string             `json:"amount"`
	UpdatedAt       time.Time          `json:"updatedAt"`
	SalesSummary    *SalesKgSummary    `json:"salesSummary,omitempty"`
	PurchaseSummary *PurchaseKgSummary `json:"purchaseSummary,omitempty"`
}

type SalesKgSummary struct {
	Unit               string `json:"unit"`
	ExcludedPackaging  bool   `json:"excludedPackaging"`
	WarehouseAvailable bool   `json:"warehouseAvailable"`
	ShortageQuantity   string `json:"shortageQuantity,omitempty"`
	OrderedQuantity    string `json:"orderedQuantity"`
	OutboundQuantity   string `json:"outboundQuantity"`
	InTransitQuantity  string `json:"inTransitQuantity"`
	SignedQuantity     string `json:"signedQuantity"`
	NetSignedQuantity  string `json:"netSignedQuantity"`
}

type PurchaseKgSummary struct {
	Unit                     string `json:"unit"`
	ExcludedPackaging        bool   `json:"excludedPackaging"`
	OrderedQuantity          string `json:"orderedQuantity"`
	InboundQuantity          string `json:"inboundQuantity"`
	ReturnProcessingQuantity string `json:"returnProcessingQuantity"`
	NetInboundQuantity       string `json:"netInboundQuantity"`
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

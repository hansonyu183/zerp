package vou

import (
	"encoding/json"
	"time"
)

const (
	EntitySalePricing             = "sale-pricing"
	EntitySaleOrder               = "sale-order"
	EntitySaleOutbound            = "sale-outbound"
	EntitySaleDelivery            = "sale-delivery"
	EntitySaleSignoff             = "sale-signoff"
	EntitySaleReturn              = "sale-return"
	EntityPurchaseOrder           = "purchase-order"
	EntityPurchaseInbound         = "purchase-inbound"
	EntityPurchaseReturn          = "purchase-return"
	EntityPurchaseInquiry         = "purchase-inquiry"
	EntityOrderProduction         = "order-production"
	EntitySelfProduction          = "self-production"
	EntityInventoryCount          = "inventory-count"
	EntitySalesReceipt            = "sales-receipt"
	EntityPurchaseRefund          = "purchase-refund"
	EntityOtherReceipt            = "other-receipt"
	EntitySalesRefund             = "sales-refund"
	EntityPurchasePayment         = "purchase-payment"
	EntityOtherPayment            = "other-payment"
	EntityEmployeeLoan            = "employee-loan"
	EntityEmployeeRepayment       = "employee-repayment"
	EntityEmployeeLoanWriteoff    = "employee-loan-writeoff"
	EntityExpenseReimbursement    = "expense-reimbursement"
	EntityExpensePayment          = "expense-payment"
	EntityOtherIncome             = "other-income"
	EntityAssetAcquisition        = "asset-acquisition"
	EntityAssetSale               = "asset-sale"
	EntityAssetLiquidation        = "asset-liquidation"
	EntityBillReceipt             = "bill-receipt"
	EntityBillPayment             = "bill-payment"
	EntityBillIssue               = "bill-issue"
	EntityBillDiscount            = "bill-discount"
	EntityBillMaturity            = "bill-maturity"
	EntityIntermediaryCalculation = "intermediary-calculation"
	StatusDraft                   = "DRAFT"
	StatusChecked                 = "CHECKED"
	StatusApproved                = "APPROVED"
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
	EntityInventoryCount,
	EntitySalesReceipt,
	EntityPurchaseRefund,
	EntityOtherReceipt,
	EntitySalesRefund,
	EntityPurchasePayment,
	EntityOtherPayment,
	EntityEmployeeLoan,
	EntityEmployeeRepayment,
	EntityEmployeeLoanWriteoff,
	EntityExpenseReimbursement,
	EntityExpensePayment,
	EntityOtherIncome,
	EntityAssetAcquisition,
	EntityAssetSale,
	EntityAssetLiquidation,
	EntityBillReceipt,
	EntityBillPayment,
	EntityBillIssue,
	EntityBillDiscount,
	EntityBillMaturity,
	EntityIntermediaryCalculation,
}

func publicCreateEntity(entity string) bool {
	switch entity {
	case EntitySalePricing, EntityPurchaseInquiry, EntitySaleOrder, EntityPurchaseOrder,
		EntitySaleReturn, EntityPurchaseReturn, EntityOrderProduction, EntitySelfProduction,
		EntityInventoryCount,
		EntitySalesReceipt, EntityPurchaseRefund, EntityOtherReceipt,
		EntitySalesRefund, EntityPurchasePayment, EntityOtherPayment,
		EntityEmployeeLoan, EntityEmployeeRepayment, EntityEmployeeLoanWriteoff,
		EntityExpenseReimbursement, EntityOtherIncome,
		EntityAssetAcquisition, EntityAssetSale, EntityAssetLiquidation,
		EntityBillReceipt, EntityBillPayment, EntityBillIssue, EntityBillDiscount, EntityBillMaturity,
		EntityIntermediaryCalculation:
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

type InventoryCountLineInput struct {
	Product        ReferenceInput `json:"product"`
	ActualQuantity string         `json:"actualQuantity"`
	Remark         string         `json:"remark,omitempty"`
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

// BillLineInput is shared by all bill operations. Only bill-receipt is public
// in the first slice; CHANGE lines reserve a source bill for later operations.
type BillLineInput struct {
	BillID        string `json:"billId,omitempty"`
	PositionType  string `json:"positionType"`
	Direction     string `json:"direction"`
	Purpose       string `json:"purpose"`
	BillType      string `json:"billType"`
	BillNo        string `json:"billNo"`
	Medium        string `json:"medium"`
	Currency      string `json:"currency"`
	FaceAmount    string `json:"faceAmount"`
	IssueDate     string `json:"issueDate"`
	MaturityDate  string `json:"maturityDate"`
	Drawer        string `json:"drawer"`
	Acceptor      string `json:"acceptor"`
	Payee         string `json:"payee"`
	AnnualRateBps int32  `json:"annualRateBps"`
	Remark        string `json:"remark,omitempty"`
}

type BillCashLineInput struct {
	BillLineID  string         `json:"billLineId,omitempty"`
	FundAccount ReferenceInput `json:"fundAccount"`
	Direction   string         `json:"direction"`
	AmountType  string         `json:"amountType"`
	Amount      string         `json:"amount"`
	Remark      string         `json:"remark,omitempty"`
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

type AssetAcquisitionLineInput struct {
	AssetName        string          `json:"assetName"`
	Specification    string          `json:"specification,omitempty"`
	Category         ReferenceInput  `json:"category"`
	OriginalValue    string          `json:"originalValue"`
	UsefulLifeMonths int32           `json:"usefulLifeMonths"`
	ResidualRate     string          `json:"residualRate"`
	Department       ReferenceInput  `json:"department"`
	Custodian        *ReferenceInput `json:"custodian,omitempty"`
	Location         string          `json:"location,omitempty"`
	Remark           string          `json:"remark,omitempty"`
}

type AssetSaleLineInput struct {
	AssetID    string `json:"assetId"`
	SaleAmount string `json:"saleAmount"`
	Remark     string `json:"remark,omitempty"`
}

type AssetLiquidationLineInput struct {
	AssetID         string `json:"assetId"`
	Reason          string `json:"reason"`
	SalvageIncome   string `json:"salvageIncome"`
	DisposalExpense string `json:"disposalExpense"`
	Remark          string `json:"remark,omitempty"`
}

type DraftInput struct {
	BusinessDate            string                        `json:"businessDate"`
	Currency                string                        `json:"currency"`
	Remark                  string                        `json:"remark,omitempty"`
	ReturnReason            string                        `json:"returnReason,omitempty"`
	SourceDocumentID        string                        `json:"-"`
	Customer                *ReferenceInput               `json:"customer,omitempty"`
	Supplier                *ReferenceInput               `json:"supplier,omitempty"`
	CounterpartyType        string                        `json:"counterpartyType,omitempty"`
	OtherCategory           string                        `json:"otherCategory,omitempty"`
	Counterparty            *ReferenceInput               `json:"counterparty,omitempty"`
	Employee                *ReferenceInput               `json:"employee,omitempty"`
	Salesperson             *ReferenceInput               `json:"salesperson,omitempty"`
	Purchaser               *ReferenceInput               `json:"purchaser,omitempty"`
	Handler                 *ReferenceInput               `json:"handler,omitempty"`
	Warehouse               *ReferenceInput               `json:"warehouse,omitempty"`
	MaterialWarehouse       *ReferenceInput               `json:"materialWarehouse,omitempty"`
	FinishedWarehouse       *ReferenceInput               `json:"finishedWarehouse,omitempty"`
	Platform                *ReferenceInput               `json:"platform,omitempty"`
	Vehicle                 *ReferenceInput               `json:"vehicle,omitempty"`
	FundAccount             *ReferenceInput               `json:"fundAccount,omitempty"`
	SourceName              string                        `json:"sourceName,omitempty"`
	Amount                  string                        `json:"amount,omitempty"`
	ProductLines            []ProductLineInput            `json:"productLines,omitempty"`
	PriceLines              []PriceLineInput              `json:"priceLines,omitempty"`
	ExpenseLines            []ExpenseLineInput            `json:"expenseLines,omitempty"`
	SourceLines             []SourceQuantityLineInput     `json:"sourceLines,omitempty"`
	SignoffLines            []SaleSignoffLineInput        `json:"signoffLines,omitempty"`
	ReturnLines             []ReturnLineInput             `json:"returnLines,omitempty"`
	ProductionLines         []ProductionOutputInput       `json:"productionLines,omitempty"`
	InventoryCountLines     []InventoryCountLineInput     `json:"inventoryCountLines,omitempty"`
	AssetAcquisitionLines   []AssetAcquisitionLineInput   `json:"assetAcquisitionLines,omitempty"`
	AssetSaleLines          []AssetSaleLineInput          `json:"assetSaleLines,omitempty"`
	AssetLiquidationLines   []AssetLiquidationLineInput   `json:"assetLiquidationLines,omitempty"`
	BillLines               []BillLineInput               `json:"billLines,omitempty"`
	BillCashLines           []BillCashLineInput           `json:"billCashLines,omitempty"`
	InternalCostRateBps     int32                         `json:"internalCostRateBps,omitempty"`
	MaturityType            string                        `json:"maturityType,omitempty"`
	InterestMode            string                        `json:"interestMode,omitempty"`
	InterestParty           *ReferenceInput               `json:"interestParty,omitempty"`
	WithRecourse            bool                          `json:"withRecourse,omitempty"`
	SpecialApproval         bool                          `json:"specialApproval,omitempty"`
	IntermediaryCalculation *IntermediaryCalculationInput `json:"intermediaryCalculation,omitempty"`
}

type IntermediaryReference struct {
	ObjectID  string `json:"objectId"`
	VersionID string `json:"versionId"`
	Entity    string `json:"entity"`
	Code      string `json:"code"`
	Name      string `json:"name"`
}

type IntermediarySourceLine struct {
	sourceCalculationDocumentID  string
	SourceSignoffLineID          string                 `json:"sourceSignoffLineId"`
	SourceKind                   string                 `json:"sourceKind"`
	SignoffDocumentID            string                 `json:"signoffDocumentId"`
	SignoffDocumentNo            string                 `json:"signoffDocumentNo"`
	SignoffDate                  string                 `json:"signoffDate"`
	DueDate                      string                 `json:"dueDate"`
	CollectionDate               string                 `json:"collectionDate"`
	CollectionDelayDays          int                    `json:"collectionDelayDays"`
	OrderDocumentID              string                 `json:"orderDocumentId"`
	OrderDocumentNo              string                 `json:"orderDocumentNo"`
	OrderDate                    string                 `json:"orderDate"`
	Customer                     IntermediaryReference  `json:"customer"`
	Salesperson                  IntermediaryReference  `json:"salesperson"`
	Product                      IntermediaryReference  `json:"product"`
	Intermediary                 *IntermediaryReference `json:"intermediary,omitempty"`
	ProductKind                  string                 `json:"productKind"`
	SignedQuantity               string                 `json:"signedQuantity"`
	PricingQuantity              string                 `json:"pricingQuantity"`
	BarrelQuantity               string                 `json:"barrelQuantity"`
	UnitPrice                    string                 `json:"unitPrice"`
	ReferenceUnitPrice           string                 `json:"referenceUnitPrice"`
	SettlementSurcharge          string                 `json:"settlementSurcharge"`
	RebateUnitPrice              string                 `json:"rebateUnitPrice"`
	LineAmount                   string                 `json:"lineAmount"`
	SettlementTermCode           string                 `json:"settlementTermCode"`
	SpecialApproval              bool                   `json:"specialApproval"`
	ReturnDocumentNos            []string               `json:"returnDocumentNos,omitempty"`
	AdjustmentEmployeeAmount     string                 `json:"adjustmentEmployeeAmount"`
	AdjustmentIntermediaryAmount string                 `json:"adjustmentIntermediaryAmount"`
	AdjustmentRebateAmount       string                 `json:"adjustmentRebateAmount"`
}

type IntermediarySourceBill struct {
	BillLineID        string                `json:"billLineId"`
	ReceiptDocumentID string                `json:"receiptDocumentId"`
	ReceiptDocumentNo string                `json:"receiptDocumentNo"`
	ReceiptDate       string                `json:"receiptDate"`
	Customer          IntermediaryReference `json:"customer"`
	Salesperson       IntermediaryReference `json:"salesperson"`
	BillType          string                `json:"billType"`
	FaceAmount        string                `json:"faceAmount"`
	IssueDate         string                `json:"issueDate"`
	MaturityDate      string                `json:"maturityDate"`
	CostDays          int                   `json:"costDays"`
}

type IntermediaryCalculationSource struct {
	PeriodStart string                   `json:"periodStart"`
	PeriodEnd   string                   `json:"periodEnd"`
	Currency    string                   `json:"currency"`
	Lines       []IntermediarySourceLine `json:"lines"`
	Bills       []IntermediarySourceBill `json:"bills"`
}

type IntermediaryResultLine struct {
	SourceSignoffLineID      string   `json:"sourceSignoffLineId"`
	PremiumUnitPrice         string   `json:"premiumUnitPrice"`
	BarrelQuantity           string   `json:"barrelQuantity"`
	BaseCommission           string   `json:"baseCommission"`
	PremiumCommission        string   `json:"premiumCommission"`
	LowPriceCommission       string   `json:"lowPriceCommission"`
	MarketMaintenanceSubsidy string   `json:"marketMaintenanceSubsidy"`
	MarketDevelopmentSubsidy string   `json:"marketDevelopmentSubsidy"`
	BillCost                 string   `json:"billCost"`
	BillLineIDs              []string `json:"billLineIds"`
	EmployeeAmount           string   `json:"employeeAmount"`
	IntermediaryAmount       string   `json:"intermediaryAmount"`
	RebateAmount             string   `json:"rebateAmount"`
	Note                     *string  `json:"note,omitempty"`
}

type IntermediarySummary struct {
	Payee    IntermediaryReference `json:"payee"`
	Category string                `json:"category"`
	Amount   string                `json:"amount"`
}

type IntermediaryCalculationResult struct {
	Lines     []IntermediaryResultLine `json:"lines"`
	Summaries []IntermediarySummary    `json:"summaries"`
}

type IntermediaryScriptSnapshot struct {
	ScriptID string `json:"scriptId"`
	Revision int64  `json:"revision"`
	Name     string `json:"name"`
	Source   string `json:"source"`
	Hash     string `json:"hash"`
}

type IntermediaryCalculationInput struct {
	Source     IntermediaryCalculationSource `json:"source"`
	SourceHash string                        `json:"sourceHash"`
	Script     IntermediaryScriptSnapshot    `json:"script"`
	Result     IntermediaryCalculationResult `json:"result"`
}

type IntermediarySourceInput struct {
	BusinessDate string `json:"businessDate"`
}
type IntermediarySourceView struct {
	Source     IntermediaryCalculationSource `json:"source"`
	SourceHash string                        `json:"sourceHash"`
}
type IntermediaryScriptSaveInput struct {
	Revision int64  `json:"revision"`
	Name     string `json:"name"`
	Source   string `json:"source"`
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

type InventoryCountLineView struct {
	LineID             string        `json:"lineId"`
	LineNo             int32         `json:"lineNo"`
	Product            ReferenceView `json:"product"`
	ActualQuantity     string        `json:"actualQuantity"`
	BookQuantity       *string       `json:"bookQuantity,omitempty"`
	DifferenceQuantity *string       `json:"differenceQuantity,omitempty"`
	Remark             string        `json:"remark,omitempty"`
}

type InventoryCountBalanceInput struct {
	Page              int    `json:"page"`
	PageSize          int    `json:"pageSize"`
	WarehouseObjectID string `json:"warehouseObjectId"`
	AsOfDate          string `json:"asOfDate"`
}

type AvailableBillQueryInput struct {
	Page         int    `json:"page"`
	PageSize     int    `json:"pageSize"`
	PositionType string `json:"positionType"`
	BillNo       string `json:"billNo,omitempty"`
}

type AvailableAssetQueryInput struct {
	Page     int `json:"page"`
	PageSize int `json:"pageSize"`
}

type AvailableAssetItem struct {
	AssetID                 string `json:"assetId"`
	AssetNo                 string `json:"assetNo"`
	AssetName               string `json:"assetName"`
	OriginalValue           string `json:"originalValue"`
	AccumulatedDepreciation string `json:"accumulatedDepreciation"`
	NetValue                string `json:"netValue"`
}

type AvailableBillItem struct {
	BillID             string        `json:"billId"`
	PositionType       string        `json:"positionType"`
	BillType           string        `json:"billType"`
	BillNo             string        `json:"billNo"`
	Medium             string        `json:"medium"`
	Currency           string        `json:"currency"`
	FaceAmount         string        `json:"faceAmount"`
	IssueDate          string        `json:"issueDate"`
	MaturityDate       string        `json:"maturityDate"`
	Drawer             string        `json:"drawer"`
	Acceptor           string        `json:"acceptor"`
	Payee              string        `json:"payee"`
	AnnualRateBps      int32         `json:"annualRateBps"`
	InterestDays       int32         `json:"interestDays"`
	InterestAmount     string        `json:"interestAmount"`
	CustomerCostAmount string        `json:"customerCostAmount"`
	OriginatingParty   ReferenceView `json:"originatingParty"`
	SourceEntity       string        `json:"sourceEntity"`
	SourceDocumentNo   string        `json:"sourceDocumentNo"`
}

type InventoryCountBalanceItem struct {
	Product  ReferenceView `json:"product"`
	Quantity string        `json:"quantity"`
}

type AssetAcquisitionLineView struct {
	LineID           string         `json:"lineId"`
	LineNo           int32          `json:"lineNo"`
	AssetName        string         `json:"assetName"`
	Specification    string         `json:"specification,omitempty"`
	Category         ReferenceView  `json:"category"`
	OriginalValue    string         `json:"originalValue"`
	UsefulLifeMonths int32          `json:"usefulLifeMonths"`
	ResidualRate     string         `json:"residualRate"`
	Department       ReferenceView  `json:"department"`
	Custodian        *ReferenceView `json:"custodian,omitempty"`
	Location         string         `json:"location,omitempty"`
	Remark           string         `json:"remark,omitempty"`
}

type AssetSaleLineView struct {
	LineID     string `json:"lineId"`
	LineNo     int32  `json:"lineNo"`
	AssetID    string `json:"assetId"`
	AssetNo    string `json:"assetNo"`
	AssetName  string `json:"assetName"`
	SaleAmount string `json:"saleAmount"`
	Remark     string `json:"remark,omitempty"`
}

type AssetLiquidationLineView struct {
	LineID          string `json:"lineId"`
	LineNo          int32  `json:"lineNo"`
	AssetID         string `json:"assetId"`
	AssetNo         string `json:"assetNo"`
	AssetName       string `json:"assetName"`
	Reason          string `json:"reason"`
	SalvageIncome   string `json:"salvageIncome"`
	DisposalExpense string `json:"disposalExpense"`
	Remark          string `json:"remark,omitempty"`
}

type BillLineView struct {
	LineID             string `json:"lineId"`
	LineNo             int32  `json:"lineNo"`
	BillID             string `json:"billId"`
	PositionType       string `json:"positionType"`
	Direction          string `json:"direction"`
	Purpose            string `json:"purpose"`
	BillType           string `json:"billType"`
	BillNo             string `json:"billNo"`
	Medium             string `json:"medium"`
	Currency           string `json:"currency"`
	FaceAmount         string `json:"faceAmount"`
	IssueDate          string `json:"issueDate"`
	MaturityDate       string `json:"maturityDate"`
	Drawer             string `json:"drawer"`
	Acceptor           string `json:"acceptor"`
	Payee              string `json:"payee"`
	AnnualRateBps      int32  `json:"annualRateBps"`
	InterestDays       int32  `json:"interestDays"`
	InterestAmount     string `json:"interestAmount"`
	CustomerCostAmount string `json:"customerCostAmount"`
	Remark             string `json:"remark,omitempty"`
}
type BillCashLineView struct {
	LineID      string        `json:"lineId"`
	LineNo      int32         `json:"lineNo"`
	BillLineID  string        `json:"billLineId,omitempty"`
	FundAccount ReferenceView `json:"fundAccount"`
	Direction   string        `json:"direction"`
	AmountType  string        `json:"amountType"`
	Amount      string        `json:"amount"`
	Remark      string        `json:"remark,omitempty"`
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
	OtherCategory             string                        `json:"otherCategory,omitempty"`
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
	Lines                     []ManagedLineView             `json:"lines,omitempty"`
	ProductionLines           []ProductionOutputLineView    `json:"productionLines,omitempty"`
	InventoryCountLines       []InventoryCountLineView      `json:"inventoryCountLines,omitempty"`
	ExpectedSolventContainers int64                         `json:"expectedSolventContainers,omitempty"`
	ExpectedResinContainers   int64                         `json:"expectedResinContainers,omitempty"`
	ReturnedSolventContainers int64                         `json:"returnedSolventContainers,omitempty"`
	ReturnedResinContainers   int64                         `json:"returnedResinContainers,omitempty"`
	ContainerDifferenceReason string                        `json:"containerDifferenceReason,omitempty"`
	AssetAcquisitionLines     []AssetAcquisitionLineView    `json:"assetAcquisitionLines,omitempty"`
	AssetSaleLines            []AssetSaleLineView           `json:"assetSaleLines,omitempty"`
	AssetLiquidationLines     []AssetLiquidationLineView    `json:"assetLiquidationLines,omitempty"`
	BillLines                 []BillLineView                `json:"billLines,omitempty"`
	BillCashLines             []BillCashLineView            `json:"billCashLines,omitempty"`
	InternalCostRateBps       int32                         `json:"internalCostRateBps,omitempty"`
	MaturityType              string                        `json:"maturityType,omitempty"`
	InterestMode              string                        `json:"interestMode,omitempty"`
	InterestParty             *ReferenceView                `json:"interestParty,omitempty"`
	WithRecourse              bool                          `json:"withRecourse,omitempty"`
	SpecialApproval           bool                          `json:"specialApproval,omitempty"`
	IntermediaryCalculation   *IntermediaryCalculationInput `json:"intermediaryCalculation,omitempty"`
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

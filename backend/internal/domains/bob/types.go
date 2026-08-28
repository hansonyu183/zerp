package bob

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"time"

	"github.com/hansonyu183/zerp/backend/internal/platform/approval"
)

const (
	EntityCustomer        = "customer"
	EntityCustomerAccount = "customer-account"
	EntitySupplier        = "supplier"
	EntityOtherUnit       = "other-unit"
	EntityEmployee        = "employee"
	EntitySalesPartner    = "sales-partner"
	EntityProduct         = "product"
	EntityWarehouse       = "warehouse"
	EntityVehicle         = "vehicle"
	EntityFundAccount     = "fund-account"
	EntityOperatingEntity = "operating-entity"

	CustomerTypeEndUser             = "DIT-0001"
	SettlementRuleRelativeDays      = "RELATIVE_DAYS"
	SettlementRuleMonthEnd          = "MONTH_END"
	SettlementRuleFixedDay          = "FIXED_DAY"
	SettlementTermPrepaid           = "PREPAID"
	SettlementTermCashOnDelivery    = "CASH_ON_DELIVERY"
	SettlementTermArrival3          = "ARRIVAL_3"
	SettlementTermArrival5          = "ARRIVAL_5"
	SettlementTermArrival7          = "ARRIVAL_7"
	SettlementTermArrival15         = "ARRIVAL_15"
	SettlementTermArrival30         = "ARRIVAL_30"
	SettlementTermMonthlyCurrent    = "MONTHLY_CURRENT"
	SettlementTermMonthly30         = "MONTHLY_30"
	SettlementTermMonthly60         = "MONTHLY_60"
	SettlementTermMonthly90         = "MONTHLY_90"
	ProductBehaviorRawMaterial      = "RAW_MATERIAL"
	ProductBehaviorStandardFinished = "STANDARD_FINISHED"
	ProductBehaviorCustomFinished   = "CUSTOM_FINISHED"
	ProductBehaviorPackaging        = "PACKAGING"

	// These are the central approval wire values. BOB does not own an
	// additional lifecycle or any effective/invalid status.
	StatusDraft   = "DRAFT"
	StatusPending = "PENDING"

	SalesCapabilityExternalPartTime = "EXTERNAL_PART_TIME"
	SalesCapabilityChannelPartner   = "CHANNEL_PARTNER"
)

var entities = [...]string{
	EntityCustomer,
	EntityCustomerAccount,
	EntitySupplier,
	EntityOtherUnit,
	EntityEmployee,
	EntitySalesPartner,
	EntityProduct,
	EntityWarehouse,
	EntityVehicle,
	EntityFundAccount,
	EntityOperatingEntity,
}

var publicEntities = [...]string{
	EntityCustomer,
	EntitySupplier,
	EntityOtherUnit,
	EntityEmployee,
	EntitySalesPartner,
	EntityProduct,
	EntityWarehouse,
	EntityVehicle,
	EntityFundAccount,
	EntityOperatingEntity,
}

var publicApprovalEntities = [...]string{
	EntityCustomer,
	EntityCustomerAccount,
	EntitySupplier,
	EntityOtherUnit,
	EntitySalesPartner,
}

type ErrorKind int

const (
	ErrorValidation ErrorKind = iota + 1
	ErrorConflict
	ErrorInternal
)

type DomainError struct {
	Kind     ErrorKind
	ErrorKey string
	Message  string
	Data     any
	Cause    error
}

func (e *DomainError) Error() string { return e.Message }
func (e *DomainError) Unwrap() error { return e.Cause }

func domainError(kind ErrorKind, message string, data any, cause error) error {
	return domainErrorWithKey(kind, defaultErrorKey(kind), message, data, cause)
}

func domainErrorWithKey(kind ErrorKind, errorKey, message string, data any, cause error) error {
	return &DomainError{Kind: kind, ErrorKey: errorKey, Message: message, Data: data, Cause: cause}
}

func defaultErrorKey(kind ErrorKind) string {
	switch kind {
	case ErrorValidation:
		return "validation_failed"
	case ErrorConflict:
		return "conflict"
	default:
		return "internal_error"
	}
}

type DetailInput struct {
	Name                       string                   `json:"name"`
	Unit                       string                   `json:"unit,omitempty"`
	InventoryUnitID            OptionalString           `json:"inventoryUnitId,omitempty"`
	Currency                   string                   `json:"currency,omitempty"`
	CustomerType               *string                  `json:"customerType,omitempty"`
	PlateNumber                string                   `json:"plateNumber,omitempty"`
	VehicleType                string                   `json:"vehicleType,omitempty"`
	CarrierAffiliation         *CarrierAffiliation      `json:"carrierAffiliation,omitempty"`
	BulkLiquidCapable          bool                     `json:"bulkLiquidCapable,omitempty"`
	TargetEntity               *string                  `json:"targetEntity,omitempty"`
	ShortName                  OptionalString           `json:"shortName,omitempty"`
	CategoryID                 OptionalString           `json:"categoryId,omitempty"`
	TaxNumber                  OptionalString           `json:"taxNumber,omitempty"`
	ContactName                OptionalString           `json:"contactName,omitempty"`
	ContactPhone               OptionalString           `json:"contactPhone,omitempty"`
	Email                      OptionalString           `json:"email,omitempty"`
	Address                    OptionalString           `json:"address,omitempty"`
	Remark                     OptionalString           `json:"remark,omitempty"`
	DepartmentID               OptionalString           `json:"departmentId,omitempty"`
	PositionID                 OptionalString           `json:"positionId,omitempty"`
	Phone                      OptionalString           `json:"phone,omitempty"`
	HireDate                   OptionalString           `json:"hireDate,omitempty"`
	Specification              OptionalString           `json:"specification,omitempty"`
	Model                      OptionalString           `json:"model,omitempty"`
	Barcode                    OptionalString           `json:"barcode,omitempty"`
	Description                OptionalString           `json:"description,omitempty"`
	ManagerEmployeeID          OptionalString           `json:"managerEmployeeId,omitempty"`
	VIN                        OptionalString           `json:"vin,omitempty"`
	EngineNumber               OptionalString           `json:"engineNumber,omitempty"`
	LoadCapacityKG             OptionalString           `json:"loadCapacityKg,omitempty"`
	AccountName                OptionalString           `json:"accountName,omitempty"`
	BankName                   OptionalString           `json:"bankName,omitempty"`
	BankBranch                 OptionalString           `json:"bankBranch,omitempty"`
	AccountNumber              OptionalString           `json:"accountNumber,omitempty"`
	OperatingEntityID          OptionalString           `json:"operatingEntityId,omitempty"`
	ParentID                   OptionalString           `json:"parentId,omitempty"`
	SettlementMethodID         OptionalString           `json:"settlementMethodId,omitempty"`
	MonthlyClosingDay          *int32                   `json:"monthlyClosingDay,omitempty"`
	SalespersonEmployeeID      OptionalString           `json:"salespersonEmployeeId,omitempty"`
	DefaultPurchaserEmployeeID OptionalString           `json:"defaultPurchaserEmployeeId,omitempty"`
	RebateUnitPrice            *string                  `json:"rebateUnitPrice,omitempty"`
	RuleType                   string                   `json:"ruleType,omitempty"`
	MonthOffset                int32                    `json:"monthOffset,omitempty"`
	DayOfMonth                 *int32                   `json:"dayOfMonth,omitempty"`
	DayOffset                  int32                    `json:"dayOffset,omitempty"`
	ProductTypeID              OptionalString           `json:"productTypeId,omitempty"`
	DefaultInputUnitID         OptionalString           `json:"defaultInputUnitId,omitempty"`
	PricingUnitID              OptionalString           `json:"pricingUnitId,omitempty"`
	UnitConversions            *[]ProductUnitConversion `json:"unitConversions,omitempty"`
	Returnable                 *bool                    `json:"returnable,omitempty"`
	DefaultPackagingSpec       OptionalString           `json:"defaultPackagingSpec,omitempty"`
	Formula                    *ProductFormula          `json:"formula,omitempty"`
	DefaultSalesSurcharge      *string                  `json:"defaultSalesSurcharge,omitempty"`
}

type CreateDetailInput struct {
	// Code is retained for internal fixture labels only and is never accepted
	// from JSON or used as the persisted business-object code.
	Code                           string                  `json:"-"`
	Name                           string                  `json:"name"`
	Unit                           string                  `json:"unit,omitempty"`
	InventoryUnitID                string                  `json:"inventoryUnitId,omitempty"`
	Currency                       string                  `json:"currency,omitempty"`
	CustomerType                   *string                 `json:"customerType,omitempty"`
	PlateNumber                    string                  `json:"plateNumber,omitempty"`
	VehicleType                    string                  `json:"vehicleType,omitempty"`
	CarrierAffiliation             *CarrierAffiliation     `json:"carrierAffiliation,omitempty"`
	BulkLiquidCapable              bool                    `json:"bulkLiquidCapable,omitempty"`
	TargetEntity                   string                  `json:"targetEntity,omitempty"`
	ShortName                      string                  `json:"shortName,omitempty"`
	CategoryID                     string                  `json:"categoryId,omitempty"`
	TaxNumber                      string                  `json:"taxNumber,omitempty"`
	ContactName                    string                  `json:"contactName,omitempty"`
	ContactPhone                   string                  `json:"contactPhone,omitempty"`
	Email                          string                  `json:"email,omitempty"`
	Address                        string                  `json:"address,omitempty"`
	Remark                         string                  `json:"remark,omitempty"`
	DepartmentID                   string                  `json:"departmentId,omitempty"`
	PositionID                     string                  `json:"positionId,omitempty"`
	Phone                          string                  `json:"phone,omitempty"`
	HireDate                       string                  `json:"hireDate,omitempty"`
	Specification                  string                  `json:"specification,omitempty"`
	Model                          string                  `json:"model,omitempty"`
	Barcode                        string                  `json:"barcode,omitempty"`
	Description                    string                  `json:"description,omitempty"`
	ManagerEmployeeID              string                  `json:"managerEmployeeId,omitempty"`
	VIN                            string                  `json:"vin,omitempty"`
	EngineNumber                   string                  `json:"engineNumber,omitempty"`
	LoadCapacityKG                 string                  `json:"loadCapacityKg,omitempty"`
	AccountName                    string                  `json:"accountName,omitempty"`
	BankName                       string                  `json:"bankName,omitempty"`
	BankBranch                     string                  `json:"bankBranch,omitempty"`
	AccountNumber                  string                  `json:"accountNumber,omitempty"`
	OperatingEntityID              string                  `json:"operatingEntityId,omitempty"`
	OperatingEntityApprovalEntryID string                  `json:"-"`
	OperatingEntityCode            string                  `json:"-"`
	OperatingEntityName            string                  `json:"-"`
	ParentID                       string                  `json:"parentId,omitempty"`
	SettlementMethodID             string                  `json:"settlementMethodId,omitempty"`
	MonthlyClosingDay              int32                   `json:"monthlyClosingDay,omitempty"`
	SalespersonEmployeeID          string                  `json:"salespersonEmployeeId,omitempty"`
	DefaultPurchaserEmployeeID     string                  `json:"defaultPurchaserEmployeeId,omitempty"`
	RebateUnitPrice                string                  `json:"rebateUnitPrice,omitempty"`
	RuleType                       string                  `json:"ruleType,omitempty"`
	MonthOffset                    int32                   `json:"monthOffset,omitempty"`
	DayOfMonth                     *int32                  `json:"dayOfMonth,omitempty"`
	DayOffset                      int32                   `json:"dayOffset,omitempty"`
	ProductTypeID                  string                  `json:"productTypeId,omitempty"`
	DefaultInputUnitID             string                  `json:"defaultInputUnitId,omitempty"`
	PricingUnitID                  string                  `json:"pricingUnitId,omitempty"`
	UnitConversions                []ProductUnitConversion `json:"unitConversions,omitempty"`
	Returnable                     bool                    `json:"returnable,omitempty"`
	DefaultPackagingSpec           string                  `json:"defaultPackagingSpec,omitempty"`
	Formula                        *ProductFormula         `json:"formula,omitempty"`
	TermCode                       string                  `json:"termCode,omitempty"`
	DefaultSalesSurcharge          string                  `json:"defaultSalesSurcharge,omitempty"`
}

type ProductFormula struct {
	Output     QuantitySnapshot          `json:"output"`
	Components []ProductFormulaComponent `json:"components"`
}

type ProductFormulaComponent struct {
	Material             FormulaMaterialReference `json:"material"`
	Quantity             QuantitySnapshot         `json:"quantity"`
	ResolutionStatus     string                   `json:"resolutionStatus"`
	RequiresConfirmation bool                     `json:"requiresConfirmation"`
}

type FormulaMaterialReference struct {
	ObjectID        string `json:"objectId"`
	ApprovalEntryID string `json:"approvalEntryId"`
	Code            string `json:"code,omitempty"`
	Name            string `json:"name,omitempty"`
	BehaviorProfile string `json:"behaviorProfile,omitempty"`
}

type MeasurementUnitSnapshot struct {
	ObjectID        string `json:"objectId"`
	ApprovalEntryID string `json:"approvalEntryId,omitempty"`
	Code            string `json:"code,omitempty"`
	Name            string `json:"name,omitempty"`
	Symbol          string `json:"symbol,omitempty"`
}

type ProductUnitConversion struct {
	Unit   MeasurementUnitSnapshot `json:"unit"`
	Factor string                  `json:"factor"`
}

type QuantitySnapshot struct {
	EnteredQuantity string                  `json:"enteredQuantity"`
	EnteredUnit     MeasurementUnitSnapshot `json:"enteredUnit"`
	BaseQuantity    string                  `json:"baseQuantity"`
}

type CarrierAffiliation struct {
	Type                        string `json:"type"`
	OperatingEntityID           string `json:"operatingEntityId,omitempty"`
	ServiceRelationshipObjectID string `json:"serviceRelationshipObjectId,omitempty"`
	OperatingApprovalEntryID    string `json:"-"`
	ServiceApprovalEntryID      string `json:"-"`
}

// OptionalString distinguishes an omitted field from an explicit null or
// empty value. Save uses this to preserve fields unknown to older clients.
type OptionalString struct {
	Value string
	Set   bool
}

func (value *OptionalString) UnmarshalJSON(data []byte) error {
	value.Set = true
	if bytes.Equal(bytes.TrimSpace(data), []byte("null")) {
		value.Value = ""
		return nil
	}
	if err := json.Unmarshal(data, &value.Value); err != nil {
		return fmt.Errorf("optional string: %w", err)
	}
	return nil
}

func Optional(value string) OptionalString {
	return OptionalString{Value: value, Set: true}
}

type CreateInput struct {
	Data CreateDetailInput `json:"data"`
}

type SaveInput struct {
	ObjectID         string      `json:"objectId"`
	ApprovalEntryID  string      `json:"approvalEntryId"`
	ApprovalRevision int64       `json:"approvalRevision"`
	Data             DetailInput `json:"data"`
}

type ObjectRevisionInput struct {
	ObjectID       string `json:"objectId"`
	ObjectRevision int64  `json:"objectRevision"`
}

type ReverseInput struct {
	ObjectID         string `json:"objectId"`
	ApprovalEntryID  string `json:"approvalEntryId"`
	ApprovalRevision int64  `json:"approvalRevision"`
	Reason           string `json:"reason"`
}

type VersionRevisionInput struct {
	ObjectID         string `json:"objectId"`
	ApprovalEntryID  string `json:"approvalEntryId"`
	ApprovalRevision int64  `json:"approvalRevision"`
}

type DeleteInput struct {
	ObjectID         string `json:"objectId"`
	ObjectRevision   int64  `json:"objectRevision"`
	ApprovalEntryID  string `json:"approvalEntryId"`
	ApprovalRevision int64  `json:"approvalRevision"`
}

type ReviewInput struct {
	ObjectID         string  `json:"objectId"`
	ApprovalEntryID  string  `json:"approvalEntryId"`
	ApprovalRevision int64   `json:"approvalRevision"`
	Reason           *string `json:"reason"`
}

type GetInput struct {
	ObjectID        string `json:"objectId"`
	ApprovalEntryID string `json:"approvalEntryId,omitempty"`
}

type QueryFilters struct {
	Keyword                    string   `json:"keyword,omitempty"`
	PartyKind                  string   `json:"kind,omitempty"`
	Merged                     *bool    `json:"merged,omitempty"`
	Status                     []string `json:"status,omitempty"`
	Enabled                    *bool    `json:"enabled,omitempty"`
	CustomerType               string   `json:"customerType,omitempty"`
	OperatingEntityID          string   `json:"operatingEntityId,omitempty"`
	Capability                 string   `json:"capability,omitempty"`
	SalesAttributionType       string   `json:"salesAttributionType,omitempty"`
	SalesAttributionSubjectID  string   `json:"salesAttributionSubjectId,omitempty"`
	CategoryID                 string   `json:"categoryId,omitempty"`
	DepartmentID               string   `json:"departmentId,omitempty"`
	PositionID                 string   `json:"positionId,omitempty"`
	SalespersonEmployeeID      string   `json:"salespersonEmployeeId,omitempty"`
	DefaultPurchaserEmployeeID string   `json:"defaultPurchaserEmployeeId,omitempty"`
	Currency                   string   `json:"currency,omitempty"`
	ProductTypeID              string   `json:"productTypeId,omitempty"`
	TargetEntity               string   `json:"targetEntity,omitempty"`
	ParentID                   string   `json:"parentId,omitempty"`
	RootOnly                   bool     `json:"rootOnly,omitempty"`
	provided                   map[string]bool
}

func (filters *QueryFilters) UnmarshalJSON(data []byte) error {
	type queryFiltersAlias QueryFilters
	var decoded queryFiltersAlias
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&decoded); err != nil {
		return err
	}
	if err := decoder.Decode(&struct{}{}); err != io.EOF {
		if err == nil {
			return fmt.Errorf("query filters: multiple JSON values")
		}
		return err
	}
	var raw map[string]json.RawMessage
	if err := json.Unmarshal(data, &raw); err != nil {
		return err
	}
	*filters = QueryFilters(decoded)
	filters.provided = make(map[string]bool, len(raw))
	for field := range raw {
		filters.provided[field] = true
	}
	return nil
}

type SortItem struct {
	Field string `json:"field"`
	Order string `json:"order"`
}

type QueryInput struct {
	Page     int          `json:"page"`
	PageSize int          `json:"pageSize"`
	Filters  QueryFilters `json:"filters"`
	Sort     []SortItem   `json:"sort"`
}

type HistoryInput struct {
	ObjectID string `json:"objectId"`
	Page     int    `json:"page"`
	PageSize int    `json:"pageSize"`
}

type DetailView struct {
	// Enabled belongs to declaration snapshots for DCL-owned Product and is not
	// part of BOB's public product payload.
	Enabled                         bool                    `json:"-"`
	Name                            string                  `json:"name"`
	SalesCapabilities               []string                `json:"salesCapabilities,omitempty"`
	Unit                            string                  `json:"unit,omitempty"`
	InventoryUnitID                 string                  `json:"inventoryUnitId,omitempty"`
	Currency                        string                  `json:"currency,omitempty"`
	CustomerType                    string                  `json:"customerType,omitempty"`
	PlateNumber                     string                  `json:"plateNumber,omitempty"`
	VehicleType                     string                  `json:"vehicleType,omitempty"`
	CarrierAffiliation              *CarrierAffiliation     `json:"carrierAffiliation,omitempty"`
	BulkLiquidCapable               bool                    `json:"bulkLiquidCapable"`
	TargetEntity                    string                  `json:"targetEntity,omitempty"`
	ShortName                       string                  `json:"shortName,omitempty"`
	CategoryID                      string                  `json:"categoryId,omitempty"`
	CategoryApprovalEntryID         string                  `json:"-"`
	CategoryCode                    string                  `json:"-"`
	CategoryName                    string                  `json:"-"`
	TaxNumber                       string                  `json:"taxNumber,omitempty"`
	ContactName                     string                  `json:"contactName,omitempty"`
	ContactPhone                    string                  `json:"contactPhone,omitempty"`
	Email                           string                  `json:"email,omitempty"`
	Address                         string                  `json:"address,omitempty"`
	Remark                          string                  `json:"remark,omitempty"`
	DepartmentID                    string                  `json:"departmentId,omitempty"`
	DepartmentApprovalEntryID       string                  `json:"-"`
	PositionID                      string                  `json:"positionId,omitempty"`
	PositionApprovalEntryID         string                  `json:"-"`
	Phone                           string                  `json:"phone,omitempty"`
	HireDate                        string                  `json:"hireDate,omitempty"`
	Specification                   string                  `json:"specification,omitempty"`
	Model                           string                  `json:"model,omitempty"`
	Barcode                         string                  `json:"barcode,omitempty"`
	Description                     string                  `json:"description,omitempty"`
	ManagerEmployeeID               string                  `json:"managerEmployeeId,omitempty"`
	ManagerEmployeeApprovalEntryID  string                  `json:"-"`
	VIN                             string                  `json:"vin,omitempty"`
	EngineNumber                    string                  `json:"engineNumber,omitempty"`
	LoadCapacityKG                  string                  `json:"loadCapacityKg,omitempty"`
	AccountName                     string                  `json:"accountName,omitempty"`
	BankName                        string                  `json:"bankName,omitempty"`
	BankBranch                      string                  `json:"bankBranch,omitempty"`
	AccountNumber                   string                  `json:"accountNumber,omitempty"`
	OperatingEntityID               string                  `json:"operatingEntityId,omitempty"`
	OperatingEntityApprovalEntryID  string                  `json:"-"`
	OperatingEntityCode             string                  `json:"-"`
	OperatingEntityName             string                  `json:"-"`
	ParentID                        string                  `json:"parentId,omitempty"`
	SettlementMethodID              string                  `json:"settlementMethodId,omitempty"`
	MonthlyClosingDay               int32                   `json:"monthlyClosingDay,omitempty"`
	SalespersonEmployeeID           string                  `json:"salespersonEmployeeId,omitempty"`
	DefaultPurchaserEmployeeID      string                  `json:"defaultPurchaserEmployeeId,omitempty"`
	DefaultPurchaserApprovalEntryID string                  `json:"-"`
	RebateUnitPrice                 string                  `json:"rebateUnitPrice,omitempty"`
	SettlementMethodApprovalEntryID string                  `json:"-"`
	SettlementMethodCode            string                  `json:"-"`
	SettlementMethodName            string                  `json:"-"`
	RuleType                        string                  `json:"ruleType,omitempty"`
	MonthOffset                     int32                   `json:"monthOffset,omitempty"`
	DayOfMonth                      *int32                  `json:"dayOfMonth,omitempty"`
	DayOffset                       int32                   `json:"dayOffset,omitempty"`
	DueDays                         int32                   `json:"dueDays,omitempty"`
	CutoffDay                       int32                   `json:"cutoffDay,omitempty"`
	DefaultSalesSurcharge           string                  `json:"defaultSalesSurcharge,omitempty"`
	TermCode                        string                  `json:"termCode,omitempty"`
	ProductTypeID                   string                  `json:"productTypeId,omitempty"`
	ProductTypeApprovalEntryID      string                  `json:"-"`
	ProductTypeCode                 string                  `json:"productTypeCode,omitempty"`
	ProductTypeName                 string                  `json:"productTypeName,omitempty"`
	BehaviorProfile                 string                  `json:"behaviorProfile,omitempty"`
	DefaultInputUnitID              string                  `json:"defaultInputUnitId,omitempty"`
	DefaultInputUnitApprovalEntryID string                  `json:"-"`
	PricingUnitID                   string                  `json:"pricingUnitId,omitempty"`
	PricingUnitApprovalEntryID      string                  `json:"-"`
	UnitConversions                 []ProductUnitConversion `json:"unitConversions,omitempty"`
	Returnable                      bool                    `json:"returnable"`
	DefaultPackagingSpec            string                  `json:"defaultPackagingSpec,omitempty"`
	Formula                         *ProductFormula         `json:"formula,omitempty"`
}

type MutationResult struct {
	ObjectID       string               `json:"objectId"`
	ObjectRevision int64                `json:"objectRevision"`
	Enabled        bool                 `json:"enabled"`
	Approval       approval.VersionMeta `json:"approval"`
}

type VersionMeta = approval.VersionMeta

type VersionView struct {
	Approval approval.VersionMeta `json:"approval"`
	Data     DetailView           `json:"data"`
}

type ObjectView struct {
	ObjectID       string                    `json:"objectId"`
	Entity         string                    `json:"entity"`
	Code           string                    `json:"code"`
	ObjectRevision int64                     `json:"objectRevision"`
	Enabled        bool                      `json:"enabled"`
	Approval       approval.VersionMeta      `json:"approval"`
	Data           DetailView                `json:"data"`
	UpdatedAt      time.Time                 `json:"updatedAt"`
	Relationship   *RelationshipIdentityView `json:"relationship,omitempty"`
}

type RelationshipIdentityView struct {
	PartyID             string `json:"partyId"`
	PartyKind           string `json:"partyKind"`
	PartyDisplayName    string `json:"partyDisplayName"`
	OperatingEntityID   string `json:"operatingEntityId"`
	OperatingEntityCode string `json:"operatingEntityCode"`
	OperatingEntityName string `json:"operatingEntityName"`
}

type VersionSummary struct {
	Approval approval.VersionMeta `json:"approval"`
	Summary  DetailView           `json:"summary"`
}

type VersionHistoryItem struct {
	Approval approval.VersionMeta `json:"approval"`
	Summary  DetailView           `json:"summary"`
}

type QueryItem struct {
	ObjectID       string                    `json:"objectId"`
	Entity         string                    `json:"entity"`
	Code           string                    `json:"code"`
	ObjectRevision int64                     `json:"objectRevision"`
	Enabled        bool                      `json:"enabled"`
	LatestApproved *VersionSummary           `json:"latestApproved"`
	OpenVersion    *VersionSummary           `json:"openVersion"`
	UpdatedAt      time.Time                 `json:"updatedAt"`
	Relationship   *RelationshipIdentityView `json:"relationship,omitempty"`
}

type Page[T any] struct {
	Items    []T   `json:"items"`
	Total    int64 `json:"total"`
	Page     int   `json:"page"`
	PageSize int   `json:"pageSize"`
}

type AuditEventView = approval.EventView

type EffectiveReference struct {
	ObjectID        string     `json:"objectId"`
	Entity          string     `json:"entity"`
	Code            string     `json:"code"`
	ApprovalEntryID string     `json:"approvalEntryId"`
	Data            DetailView `json:"data"`
}

type AuxiliaryReference struct {
	ObjectID        string
	Entity          string
	Code            string
	ApprovalEntryID string
	Data            map[string]any
}

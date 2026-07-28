package bob

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"time"
)

const (
	EntityCustomer         = "customer"
	EntitySupplier         = "supplier"
	EntityEmployee         = "employee"
	EntityProduct          = "product"
	EntityService          = "service"
	EntityWarehouse        = "warehouse"
	EntityVehicle          = "vehicle"
	EntityFundAccount      = "fund-account"
	EntityCategory         = "category"
	EntityDepartment       = "department"
	EntityPosition         = "position"
	EntitySettlementMethod = "settlement-method"

	SupplierTypeGeneral           = "GENERAL"
	SupplierTypeLogisticsPlatform = "LOGISTICS_PLATFORM"
	CustomerTypeEndUser           = "END_USER"
	CustomerTypeDealer            = "DEALER"
	SettlementRuleRelativeDays    = "RELATIVE_DAYS"
	SettlementRuleMonthEnd        = "MONTH_END"
	SettlementRuleFixedDay        = "FIXED_DAY"
	ContainerTypeNone             = "NONE"
	ContainerTypeSolvent          = "SOLVENT"
	ContainerTypeResin            = "RESIN"
	ProductKindRawMaterial        = "RAW_MATERIAL"
	ProductKindStandardFinished   = "STANDARD_FINISHED"
	ProductKindCustomFinished     = "CUSTOM_FINISHED"
	ProductKindPackaging          = "PACKAGING"

	StatusDraft     = "DRAFT"
	StatusPending   = "PENDING"
	StatusRejected  = "REJECTED"
	StatusEffective = "EFFECTIVE"
	StatusInvalid   = "INVALID"
)

var entities = [...]string{
	EntityCustomer,
	EntitySupplier,
	EntityEmployee,
	EntityProduct,
	EntityService,
	EntityWarehouse,
	EntityVehicle,
	EntityFundAccount,
	EntityCategory,
	EntityDepartment,
	EntityPosition,
	EntitySettlementMethod,
}

var publicEntities = [...]string{
	EntityCustomer,
	EntitySupplier,
	EntityEmployee,
	EntityProduct,
	EntityService,
	EntityWarehouse,
	EntityVehicle,
	EntityFundAccount,
}

type ErrorKind int

const (
	ErrorValidation ErrorKind = iota + 1
	ErrorConflict
	ErrorInternal
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

type DetailInput struct {
	Name                            string                `json:"name"`
	Unit                            string                `json:"unit,omitempty"`
	Currency                        string                `json:"currency,omitempty"`
	SupplierType                    *string               `json:"supplierType,omitempty"`
	CustomerType                    *string               `json:"customerType,omitempty"`
	PlateNumber                     string                `json:"plateNumber,omitempty"`
	VehicleType                     string                `json:"vehicleType,omitempty"`
	PlatformObjectID                string                `json:"platformObjectId,omitempty"`
	TargetEntity                    *string               `json:"targetEntity,omitempty"`
	ShortName                       OptionalString        `json:"shortName,omitempty"`
	CategoryID                      OptionalString        `json:"categoryId,omitempty"`
	TaxNumber                       OptionalString        `json:"taxNumber,omitempty"`
	ContactName                     OptionalString        `json:"contactName,omitempty"`
	ContactPhone                    OptionalString        `json:"contactPhone,omitempty"`
	Email                           OptionalString        `json:"email,omitempty"`
	Address                         OptionalString        `json:"address,omitempty"`
	Remark                          OptionalString        `json:"remark,omitempty"`
	DepartmentID                    OptionalString        `json:"departmentId,omitempty"`
	PositionID                      OptionalString        `json:"positionId,omitempty"`
	Phone                           OptionalString        `json:"phone,omitempty"`
	HireDate                        OptionalString        `json:"hireDate,omitempty"`
	Specification                   OptionalString        `json:"specification,omitempty"`
	Model                           OptionalString        `json:"model,omitempty"`
	Barcode                         OptionalString        `json:"barcode,omitempty"`
	Description                     OptionalString        `json:"description,omitempty"`
	ManagerEmployeeID               OptionalString        `json:"managerEmployeeId,omitempty"`
	VIN                             OptionalString        `json:"vin,omitempty"`
	EngineNumber                    OptionalString        `json:"engineNumber,omitempty"`
	LoadCapacityKG                  OptionalString        `json:"loadCapacityKg,omitempty"`
	AccountName                     OptionalString        `json:"accountName,omitempty"`
	BankName                        OptionalString        `json:"bankName,omitempty"`
	BankBranch                      OptionalString        `json:"bankBranch,omitempty"`
	AccountNumber                   OptionalString        `json:"accountNumber,omitempty"`
	ParentID                        OptionalString        `json:"parentId,omitempty"`
	SettlementMethodID              OptionalString        `json:"settlementMethodId,omitempty"`
	SalespersonEmployeeID           OptionalString        `json:"salespersonEmployeeId,omitempty"`
	RuleType                        string                `json:"ruleType,omitempty"`
	MonthOffset                     int32                 `json:"monthOffset,omitempty"`
	DayOfMonth                      *int32                `json:"dayOfMonth,omitempty"`
	DayOffset                       int32                 `json:"dayOffset,omitempty"`
	ContainerType                   *string               `json:"containerType,omitempty"`
	QuantityPerContainer            OptionalString        `json:"quantityPerContainer,omitempty"`
	ProductKind                     *string               `json:"productKind,omitempty"`
	InventoryUnitID                 OptionalString        `json:"inventoryUnitId,omitempty"`
	PricingUnitID                   OptionalString        `json:"pricingUnitId,omitempty"`
	PricingQuantityPerInventoryUnit OptionalString        `json:"pricingQuantityPerInventoryUnit,omitempty"`
	Returnable                      *bool                 `json:"returnable,omitempty"`
	PackagingSpecs                  *[]PackagingSpecInput `json:"packagingSpecs,omitempty"`
}

type CreateDetailInput struct {
	Code                            string               `json:"code"`
	Name                            string               `json:"name"`
	Unit                            string               `json:"unit,omitempty"`
	Currency                        string               `json:"currency,omitempty"`
	SupplierType                    *string              `json:"supplierType,omitempty"`
	CustomerType                    *string              `json:"customerType,omitempty"`
	PlateNumber                     string               `json:"plateNumber,omitempty"`
	VehicleType                     string               `json:"vehicleType,omitempty"`
	PlatformObjectID                string               `json:"platformObjectId,omitempty"`
	TargetEntity                    string               `json:"targetEntity,omitempty"`
	ShortName                       string               `json:"shortName,omitempty"`
	CategoryID                      string               `json:"categoryId,omitempty"`
	TaxNumber                       string               `json:"taxNumber,omitempty"`
	ContactName                     string               `json:"contactName,omitempty"`
	ContactPhone                    string               `json:"contactPhone,omitempty"`
	Email                           string               `json:"email,omitempty"`
	Address                         string               `json:"address,omitempty"`
	Remark                          string               `json:"remark,omitempty"`
	DepartmentID                    string               `json:"departmentId,omitempty"`
	PositionID                      string               `json:"positionId,omitempty"`
	Phone                           string               `json:"phone,omitempty"`
	HireDate                        string               `json:"hireDate,omitempty"`
	Specification                   string               `json:"specification,omitempty"`
	Model                           string               `json:"model,omitempty"`
	Barcode                         string               `json:"barcode,omitempty"`
	Description                     string               `json:"description,omitempty"`
	ManagerEmployeeID               string               `json:"managerEmployeeId,omitempty"`
	VIN                             string               `json:"vin,omitempty"`
	EngineNumber                    string               `json:"engineNumber,omitempty"`
	LoadCapacityKG                  string               `json:"loadCapacityKg,omitempty"`
	AccountName                     string               `json:"accountName,omitempty"`
	BankName                        string               `json:"bankName,omitempty"`
	BankBranch                      string               `json:"bankBranch,omitempty"`
	AccountNumber                   string               `json:"accountNumber,omitempty"`
	ParentID                        string               `json:"parentId,omitempty"`
	SettlementMethodID              string               `json:"settlementMethodId,omitempty"`
	SalespersonEmployeeID           string               `json:"salespersonEmployeeId,omitempty"`
	RuleType                        string               `json:"ruleType,omitempty"`
	MonthOffset                     int32                `json:"monthOffset,omitempty"`
	DayOfMonth                      *int32               `json:"dayOfMonth,omitempty"`
	DayOffset                       int32                `json:"dayOffset,omitempty"`
	ContainerType                   string               `json:"containerType,omitempty"`
	QuantityPerContainer            string               `json:"quantityPerContainer,omitempty"`
	ProductKind                     string               `json:"productKind,omitempty"`
	InventoryUnitID                 string               `json:"inventoryUnitId,omitempty"`
	PricingUnitID                   string               `json:"pricingUnitId,omitempty"`
	PricingQuantityPerInventoryUnit string               `json:"pricingQuantityPerInventoryUnit,omitempty"`
	Returnable                      bool                 `json:"returnable,omitempty"`
	PackagingSpecs                  []PackagingSpecInput `json:"packagingSpecs,omitempty"`
}

type PackagingSpecInput struct {
	PackagingProductObjectID  string `json:"packagingProductObjectId"`
	PackagingProductVersionID string `json:"packagingProductVersionId"`
	PackagingProductCode      string `json:"packagingProductCode,omitempty"`
	PackagingProductName      string `json:"packagingProductName,omitempty"`
	ContentQuantity           string `json:"contentQuantity"`
	IsDefault                 bool   `json:"isDefault"`
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
	ObjectID  string      `json:"objectId"`
	VersionID string      `json:"versionId"`
	Revision  int64       `json:"revision"`
	Data      DetailInput `json:"data"`
}

type ObjectRevisionInput struct {
	ObjectID       string `json:"objectId"`
	ObjectRevision int64  `json:"objectRevision"`
}

type VersionRevisionInput struct {
	ObjectID  string `json:"objectId"`
	VersionID string `json:"versionId"`
	Revision  int64  `json:"revision"`
}

type DeleteInput struct {
	ObjectID       string `json:"objectId"`
	ObjectRevision int64  `json:"objectRevision"`
	VersionID      string `json:"versionId"`
	Revision       int64  `json:"revision"`
}

type ReviewInput struct {
	ObjectID  string  `json:"objectId"`
	VersionID string  `json:"versionId"`
	Revision  int64   `json:"revision"`
	Comment   *string `json:"comment"`
}

type GetInput struct {
	ObjectID  string `json:"objectId"`
	VersionID string `json:"versionId,omitempty"`
}

type QueryFilters struct {
	Keyword               string   `json:"keyword,omitempty"`
	Status                []string `json:"status,omitempty"`
	CustomerType          string   `json:"customerType,omitempty"`
	SupplierType          string   `json:"supplierType,omitempty"`
	CategoryID            string   `json:"categoryId,omitempty"`
	DepartmentID          string   `json:"departmentId,omitempty"`
	PositionID            string   `json:"positionId,omitempty"`
	SalespersonEmployeeID string   `json:"salespersonEmployeeId,omitempty"`
	Currency              string   `json:"currency,omitempty"`
	TargetEntity          string   `json:"targetEntity,omitempty"`
	ParentID              string   `json:"parentId,omitempty"`
	RootOnly              bool     `json:"rootOnly,omitempty"`
	provided              map[string]bool
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
	Name                            string               `json:"name"`
	Unit                            string               `json:"unit,omitempty"`
	Currency                        string               `json:"currency,omitempty"`
	SupplierType                    string               `json:"supplierType,omitempty"`
	CustomerType                    string               `json:"customerType,omitempty"`
	PlateNumber                     string               `json:"plateNumber,omitempty"`
	VehicleType                     string               `json:"vehicleType,omitempty"`
	PlatformObjectID                string               `json:"platformObjectId,omitempty"`
	TargetEntity                    string               `json:"targetEntity,omitempty"`
	ShortName                       string               `json:"shortName,omitempty"`
	CategoryID                      string               `json:"categoryId,omitempty"`
	TaxNumber                       string               `json:"taxNumber,omitempty"`
	ContactName                     string               `json:"contactName,omitempty"`
	ContactPhone                    string               `json:"contactPhone,omitempty"`
	Email                           string               `json:"email,omitempty"`
	Address                         string               `json:"address,omitempty"`
	Remark                          string               `json:"remark,omitempty"`
	DepartmentID                    string               `json:"departmentId,omitempty"`
	PositionID                      string               `json:"positionId,omitempty"`
	Phone                           string               `json:"phone,omitempty"`
	HireDate                        string               `json:"hireDate,omitempty"`
	Specification                   string               `json:"specification,omitempty"`
	Model                           string               `json:"model,omitempty"`
	Barcode                         string               `json:"barcode,omitempty"`
	Description                     string               `json:"description,omitempty"`
	ManagerEmployeeID               string               `json:"managerEmployeeId,omitempty"`
	VIN                             string               `json:"vin,omitempty"`
	EngineNumber                    string               `json:"engineNumber,omitempty"`
	LoadCapacityKG                  string               `json:"loadCapacityKg,omitempty"`
	AccountName                     string               `json:"accountName,omitempty"`
	BankName                        string               `json:"bankName,omitempty"`
	BankBranch                      string               `json:"bankBranch,omitempty"`
	AccountNumber                   string               `json:"accountNumber,omitempty"`
	ParentID                        string               `json:"parentId,omitempty"`
	SettlementMethodID              string               `json:"settlementMethodId,omitempty"`
	SalespersonEmployeeID           string               `json:"salespersonEmployeeId,omitempty"`
	SettlementMethodVersionID       string               `json:"-"`
	RuleType                        string               `json:"ruleType,omitempty"`
	MonthOffset                     int32                `json:"monthOffset,omitempty"`
	DayOfMonth                      *int32               `json:"dayOfMonth,omitempty"`
	DayOffset                       int32                `json:"dayOffset,omitempty"`
	DueDays                         int32                `json:"dueDays,omitempty"`
	CutoffDay                       int32                `json:"cutoffDay,omitempty"`
	DefaultSalesSurcharge           string               `json:"defaultSalesSurcharge,omitempty"`
	ContainerType                   string               `json:"containerType,omitempty"`
	QuantityPerContainer            string               `json:"quantityPerContainer,omitempty"`
	ProductKind                     string               `json:"productKind,omitempty"`
	InventoryUnitID                 string               `json:"inventoryUnitId,omitempty"`
	PricingUnitID                   string               `json:"pricingUnitId,omitempty"`
	PricingQuantityPerInventoryUnit string               `json:"pricingQuantityPerInventoryUnit,omitempty"`
	Returnable                      bool                 `json:"returnable,omitempty"`
	PackagingSpecs                  []PackagingSpecInput `json:"packagingSpecs,omitempty"`
}

type MutationResult struct {
	ObjectID       string `json:"objectId"`
	ObjectRevision int64  `json:"objectRevision"`
	VersionID      string `json:"versionId"`
	Version        int32  `json:"version"`
	Status         string `json:"status"`
	Revision       int64  `json:"revision"`
}

type VersionMeta struct {
	VersionID     string     `json:"versionId"`
	Version       int32      `json:"version"`
	Status        string     `json:"status"`
	Revision      int64      `json:"revision"`
	CreatedAt     time.Time  `json:"createdAt"`
	CreatedBy     string     `json:"createdBy"`
	UpdatedAt     time.Time  `json:"updatedAt"`
	UpdatedBy     string     `json:"updatedBy"`
	SubmittedAt   *time.Time `json:"submittedAt"`
	SubmittedBy   *string    `json:"submittedBy"`
	ReviewedAt    *time.Time `json:"reviewedAt"`
	ReviewedBy    *string    `json:"reviewedBy"`
	ReviewComment *string    `json:"reviewComment"`
}

type ObjectView struct {
	ObjectID           string      `json:"objectId"`
	Entity             string      `json:"entity"`
	Code               string      `json:"code"`
	ObjectRevision     int64       `json:"objectRevision"`
	CurrentVersionID   string      `json:"currentVersionId"`
	EffectiveVersionID *string     `json:"effectiveVersionId"`
	UpdatedAt          time.Time   `json:"updatedAt"`
	Version            VersionMeta `json:"version"`
	Data               DetailView  `json:"data"`
}

type VersionSummary struct {
	VersionID string     `json:"versionId"`
	Version   int32      `json:"version"`
	Status    string     `json:"status"`
	Revision  int64      `json:"revision"`
	Summary   DetailView `json:"summary"`
}

type VersionHistoryItem struct {
	VersionID     string     `json:"versionId"`
	Version       int32      `json:"version"`
	Status        string     `json:"status"`
	Revision      int64      `json:"revision"`
	CreatedAt     time.Time  `json:"createdAt"`
	CreatedBy     string     `json:"createdBy"`
	UpdatedAt     time.Time  `json:"updatedAt"`
	UpdatedBy     string     `json:"updatedBy"`
	SubmittedAt   *time.Time `json:"submittedAt"`
	SubmittedBy   *string    `json:"submittedBy"`
	ReviewedAt    *time.Time `json:"reviewedAt"`
	ReviewedBy    *string    `json:"reviewedBy"`
	ReviewComment *string    `json:"reviewComment"`
	Summary       DetailView `json:"summary"`
}

type QueryItem struct {
	ObjectID           string         `json:"objectId"`
	Entity             string         `json:"entity"`
	Code               string         `json:"code"`
	ObjectRevision     int64          `json:"objectRevision"`
	CurrentVersion     VersionSummary `json:"currentVersion"`
	EffectiveVersionID *string        `json:"effectiveVersionId"`
	UpdatedAt          time.Time      `json:"updatedAt"`
}

type Page[T any] struct {
	Items    []T   `json:"items"`
	Total    int64 `json:"total"`
	Page     int   `json:"page"`
	PageSize int   `json:"pageSize"`
}

type AuditEventView struct {
	ID         string          `json:"id"`
	ObjectID   string          `json:"objectId"`
	VersionID  string          `json:"versionId"`
	Entity     string          `json:"entity"`
	EventType  string          `json:"eventType"`
	FromStatus *string         `json:"fromStatus"`
	ToStatus   string          `json:"toStatus"`
	ActorID    string          `json:"actorId"`
	OccurredAt time.Time       `json:"occurredAt"`
	Comment    *string         `json:"comment"`
	RequestID  string          `json:"requestId"`
	Summary    json.RawMessage `json:"summary"`
}

type EffectiveReference struct {
	ObjectID  string     `json:"objectId"`
	Entity    string     `json:"entity"`
	Code      string     `json:"code"`
	VersionID string     `json:"versionId"`
	Data      DetailView `json:"data"`
}

type AuxiliaryReference struct {
	ObjectID  string
	Entity    string
	Code      string
	VersionID string
	Data      map[string]any
}

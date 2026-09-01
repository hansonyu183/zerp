package dcl

import (
	"encoding/json"
	"time"

	bobdomain "github.com/hansonyu183/zerp/backend/internal/domains/bob"
	"github.com/hansonyu183/zerp/backend/internal/platform/approval"
)

const (
	EntityOperatingEntity = "operating-entity"
	EntityWarehouse       = "warehouse"
	EntityVehicle         = "vehicle"
	EntityFundAccount     = "fund-account"
	EntityProduct         = "product"
	EntityEmployee        = "employee"
	EntityOtherUnit       = "other-unit"
	EntitySalesPartner    = "sales-partner"
	EntitySupplier        = "supplier"
	EntityCustomer        = "customer"
	EntityAccMapping      = "acc-mapping"
)

// BusinessArchiveSnapshot is the immutable approved operating-entity fact held
// by Other Unit and Sales Partner versions.
type BusinessArchiveSnapshot struct {
	SourceObjectID  string `json:"sourceObjectId"`
	ApprovalEntryID string `json:"approvalEntryId"`
	Code            string `json:"code"`
	Name            string `json:"name"`
}

type OtherUnitData struct {
	Kind                     string                    `json:"kind"`
	LegalName                string                    `json:"legalName"`
	DisplayName              string                    `json:"displayName,omitempty"`
	TaxNumber                string                    `json:"taxNumber,omitempty"`
	StrongIdentifiers        []BusinessIdentifierInput `json:"strongIdentifiers"`
	Enabled                  bool                      `json:"enabled"`
	OperatingEntityIDs       []string                  `json:"operatingEntityIds"`
	OperatingEntities        []BusinessArchiveSnapshot `json:"operatingEntities"`
	DefaultOperatingEntity   BusinessArchiveSnapshot   `json:"defaultOperatingEntity"`
	DefaultOperatingEntityID string                    `json:"defaultOperatingEntityId"`
	ContactName              string                    `json:"contactName,omitempty"`
	ContactPhone             string                    `json:"contactPhone,omitempty"`
	Email                    string                    `json:"email,omitempty"`
	Address                  string                    `json:"address,omitempty"`
	SettlementMethodID       string                    `json:"settlementMethodId,omitempty"`
	SettlementMethodCode     string                    `json:"settlementMethodCode,omitempty"`
	SettlementMethodName     string                    `json:"settlementMethodName,omitempty"`
	SettlementTermCode       string                    `json:"settlementTermCode,omitempty"`
	SettlementRuleType       string                    `json:"settlementRuleType,omitempty"`
	SettlementMonthOffset    int32                     `json:"settlementMonthOffset,omitempty"`
	SettlementDayOfMonth     int32                     `json:"settlementDayOfMonth,omitempty"`
	SettlementDayOffset      int32                     `json:"settlementDayOffset,omitempty"`
	Remark                   string                    `json:"remark,omitempty"`
}
type SalesPartnerData struct {
	Kind                     string                    `json:"kind"`
	LegalName                string                    `json:"legalName"`
	DisplayName              string                    `json:"displayName,omitempty"`
	TaxNumber                string                    `json:"taxNumber,omitempty"`
	StrongIdentifiers        []BusinessIdentifierInput `json:"strongIdentifiers"`
	Enabled                  bool                      `json:"enabled"`
	OperatingEntityIDs       []string                  `json:"operatingEntityIds"`
	OperatingEntities        []BusinessArchiveSnapshot `json:"operatingEntities"`
	DefaultOperatingEntity   BusinessArchiveSnapshot   `json:"defaultOperatingEntity"`
	DefaultOperatingEntityID string                    `json:"defaultOperatingEntityId"`
	Capabilities             []string                  `json:"capabilities"`
	ContactName              string                    `json:"contactName,omitempty"`
	ContactPhone             string                    `json:"contactPhone,omitempty"`
	Email                    string                    `json:"email,omitempty"`
	Address                  string                    `json:"address,omitempty"`
	Remark                   string                    `json:"remark,omitempty"`
}

// SupplierInput is the mutable Supplier declaration. Supplier owns its legal
// identity owned by the typed archive.
type SupplierInput struct {
	Kind                            string                    `json:"kind"`
	LegalName                       string                    `json:"legalName"`
	DisplayName                     string                    `json:"displayName,omitempty"`
	TaxNumber                       string                    `json:"taxNumber,omitempty"`
	StrongIdentifiers               []BusinessIdentifierInput `json:"strongIdentifiers"`
	Enabled                         bool                      `json:"enabled"`
	OperatingEntityIDs              []string                  `json:"operatingEntityIds"`
	DefaultOperatingEntityID        string                    `json:"defaultOperatingEntityId"`
	ShortName                       string                    `json:"shortName,omitempty"`
	ContactName                     string                    `json:"contactName,omitempty"`
	ContactPhone                    string                    `json:"contactPhone,omitempty"`
	Email                           string                    `json:"email,omitempty"`
	Address                         string                    `json:"address,omitempty"`
	Remark                          string                    `json:"remark,omitempty"`
	SettlementMethodID              string                    `json:"settlementMethodId,omitempty"`
	SettlementMethodCode            string                    `json:"-"`
	SettlementMethodName            string                    `json:"-"`
	SettlementTermCode              string                    `json:"-"`
	SettlementRuleType              string                    `json:"-"`
	SettlementMonthOffset           int32                     `json:"-"`
	SettlementDayOfMonth            int32                     `json:"-"`
	SettlementDayOffset             int32                     `json:"-"`
	DefaultPurchaserEmployeeID      string                    `json:"defaultPurchaserEmployeeId,omitempty"`
	DefaultPurchaserApprovalEntryID string                    `json:"-"`
	DefaultPurchaserCode            string                    `json:"-"`
	DefaultPurchaserName            string                    `json:"-"`
}
type SupplierData struct {
	SupplierInput
	OperatingEntities               []SupplierOperatingEntitySnapshot `json:"operatingEntities"`
	SettlementMethod                *SupplierSettlementMethodSnapshot `json:"settlementMethod"`
	DefaultPurchaser                *SupplierEmployeeSnapshot         `json:"defaultPurchaser"`
	SettlementMethodCode            string                            `json:"-"`
	SettlementMethodName            string                            `json:"-"`
	SettlementTermCode              string                            `json:"-"`
	SettlementRuleType              string                            `json:"-"`
	SettlementMonthOffset           int32                             `json:"-"`
	SettlementDayOfMonth            int32                             `json:"-"`
	SettlementDayOffset             int32                             `json:"-"`
	DefaultPurchaserApprovalEntryID string                            `json:"-"`
	DefaultPurchaserCode            string                            `json:"-"`
	DefaultPurchaserName            string                            `json:"-"`
}
type SupplierOperatingEntitySnapshot struct {
	SourceObjectID  string `json:"sourceObjectId"`
	ApprovalEntryID string `json:"approvalEntryId"`
	Code            string `json:"code"`
	Name            string `json:"name"`
}
type SupplierSettlementMethodSnapshot struct {
	SourceObjectID string `json:"sourceObjectId"`
	Code           string `json:"code"`
	Name           string `json:"name"`
	TermCode       string `json:"termCode"`
	RuleType       string `json:"ruleType"`
	MonthOffset    int32  `json:"monthOffset"`
	DayOfMonth     int32  `json:"dayOfMonth"`
	DayOffset      int32  `json:"dayOffset"`
}
type SupplierEmployeeSnapshot struct {
	SourceObjectID  string `json:"sourceObjectId"`
	ApprovalEntryID string `json:"approvalEntryId"`
	Code            string `json:"code"`
	Name            string `json:"name"`
}
type SupplierCreateInput struct {
	Data SupplierInput `json:"data"`
}
type SupplierSaveInput struct {
	ObjectID         string        `json:"objectId"`
	ApprovalEntryID  string        `json:"approvalEntryId"`
	ApprovalRevision int64         `json:"approvalRevision"`
	Data             SupplierInput `json:"data"`
}
type SupplierVersionInput struct {
	ObjectID         string `json:"objectId"`
	ApprovalEntryID  string `json:"approvalEntryId"`
	ApprovalRevision int64  `json:"approvalRevision"`
}
type SupplierReviewInput struct {
	ObjectID         string `json:"objectId"`
	ApprovalEntryID  string `json:"approvalEntryId"`
	ApprovalRevision int64  `json:"approvalRevision"`
	Reason           string `json:"reason"`
}
type SupplierDeleteInput = SupplierVersionInput
type SupplierGetInput struct {
	ObjectID        string `json:"objectId"`
	ApprovalEntryID string `json:"approvalEntryId,omitempty"`
}
type SupplierQueryFilters struct {
	Keyword                    string            `json:"keyword,omitempty"`
	Status                     []approval.Status `json:"status,omitempty"`
	Enabled                    *bool             `json:"enabled,omitempty"`
	DefaultPurchaserEmployeeID string            `json:"defaultPurchaserEmployeeId,omitempty"`
}
type SupplierQueryInput struct {
	Page     int                       `json:"page"`
	PageSize int                       `json:"pageSize"`
	Filters  SupplierQueryFilters      `json:"filters"`
	Sort     []OperatingEntitySortItem `json:"sort"`
}
type SupplierHistoryInput = OperatingEntityHistoryInput
type SupplierMutation struct {
	ObjectID string               `json:"objectId"`
	Enabled  bool                 `json:"enabled"`
	Approval approval.VersionMeta `json:"approval"`
}
type SupplierView struct {
	ObjectID                 string                     `json:"objectId"`
	Entity                   string                     `json:"entity"`
	Code                     string                     `json:"code"`
	Approval                 approval.VersionMeta       `json:"approval"`
	Data                     SupplierData               `json:"data"`
	UpdatedAt                time.Time                  `json:"updatedAt"`
	AvailableApprovalActions []approval.LifecycleAction `json:"availableApprovalActions"`
}
type SupplierVersionView struct {
	Approval approval.VersionMeta `json:"approval"`
	Data     SupplierData         `json:"data"`
}
type SupplierQueryItem struct {
	ObjectID                 string                          `json:"objectId"`
	Entity                   string                          `json:"entity"`
	Code                     string                          `json:"code"`
	DisplayName              string                          `json:"displayName"`
	DefaultOperatingEntity   SupplierOperatingEntitySnapshot `json:"defaultOperatingEntity"`
	LatestApproved           *SupplierVersionView            `json:"latestApproved"`
	OpenVersion              *SupplierVersionView            `json:"openVersion"`
	UpdatedAt                time.Time                       `json:"updatedAt"`
	AvailableApprovalActions []approval.LifecycleAction      `json:"availableApprovalActions"`
}
type OtherUnitCreateInput struct {
	Data OtherUnitData `json:"data"`
}
type SalesPartnerCreateInput struct {
	Data SalesPartnerData `json:"data"`
}
type OtherUnitSaveInput struct {
	ObjectID         string        `json:"objectId"`
	ApprovalEntryID  string        `json:"approvalEntryId"`
	ApprovalRevision int64         `json:"approvalRevision"`
	Data             OtherUnitData `json:"data"`
}
type SalesPartnerSaveInput struct {
	ObjectID         string           `json:"objectId"`
	ApprovalEntryID  string           `json:"approvalEntryId"`
	ApprovalRevision int64            `json:"approvalRevision"`
	Data             SalesPartnerData `json:"data"`
}
type TypedArchiveVersionInput struct {
	ObjectID         string `json:"objectId"`
	ApprovalEntryID  string `json:"approvalEntryId"`
	ApprovalRevision int64  `json:"approvalRevision"`
}
type TypedArchiveReviewInput struct {
	ObjectID         string `json:"objectId"`
	ApprovalEntryID  string `json:"approvalEntryId"`
	ApprovalRevision int64  `json:"approvalRevision"`
	Reason           string `json:"reason"`
}
type TypedArchiveMutation struct {
	ObjectID string               `json:"objectId"`
	Enabled  bool                 `json:"enabled"`
	Approval approval.VersionMeta `json:"approval"`
}
type TypedArchiveGetInput struct {
	ObjectID        string `json:"objectId"`
	ApprovalEntryID string `json:"approvalEntryId,omitempty"`
}
type TypedArchiveQueryInput struct {
	Page     int                      `json:"page"`
	PageSize int                      `json:"pageSize"`
	Filters  TypedArchiveQueryFilters `json:"filters"`
}
type TypedArchiveQueryFilters struct {
	Keyword           string            `json:"keyword,omitempty"`
	Status            []approval.Status `json:"status,omitempty"`
	Enabled           *bool             `json:"enabled,omitempty"`
	OperatingEntityID string            `json:"operatingEntityId,omitempty"`
}
type TypedArchiveHistoryInput struct {
	ObjectID string `json:"objectId"`
	Page     int    `json:"page"`
	PageSize int    `json:"pageSize"`
}
type OtherUnitView struct {
	ObjectID                 string                     `json:"objectId"`
	Entity                   string                     `json:"entity"`
	Code                     string                     `json:"code"`
	Approval                 approval.VersionMeta       `json:"approval"`
	Data                     OtherUnitData              `json:"data"`
	UpdatedAt                time.Time                  `json:"updatedAt"`
	AvailableApprovalActions []approval.LifecycleAction `json:"availableApprovalActions"`
}
type SalesPartnerView struct {
	ObjectID                 string                     `json:"objectId"`
	Entity                   string                     `json:"entity"`
	Code                     string                     `json:"code"`
	Approval                 approval.VersionMeta       `json:"approval"`
	Data                     SalesPartnerData           `json:"data"`
	UpdatedAt                time.Time                  `json:"updatedAt"`
	AvailableApprovalActions []approval.LifecycleAction `json:"availableApprovalActions"`
}
type OtherUnitVersionView struct {
	Approval approval.VersionMeta `json:"approval"`
	Data     OtherUnitData        `json:"data"`
}
type SalesPartnerVersionView struct {
	Approval approval.VersionMeta `json:"approval"`
	Data     SalesPartnerData     `json:"data"`
}
type OtherUnitQueryItem struct {
	ObjectID                 string                     `json:"objectId"`
	Entity                   string                     `json:"entity"`
	Code                     string                     `json:"code"`
	DisplayName              string                     `json:"displayName"`
	DefaultOperatingEntity   BusinessArchiveSnapshot    `json:"defaultOperatingEntity"`
	LatestApproved           *OtherUnitVersionView      `json:"latestApproved,omitempty"`
	OpenVersion              *OtherUnitVersionView      `json:"openVersion,omitempty"`
	UpdatedAt                time.Time                  `json:"updatedAt"`
	AvailableApprovalActions []approval.LifecycleAction `json:"availableApprovalActions"`
}
type SalesPartnerQueryItem struct {
	ObjectID                 string                     `json:"objectId"`
	Entity                   string                     `json:"entity"`
	Code                     string                     `json:"code"`
	DisplayName              string                     `json:"displayName"`
	DefaultOperatingEntity   BusinessArchiveSnapshot    `json:"defaultOperatingEntity"`
	LatestApproved           *SalesPartnerVersionView   `json:"latestApproved,omitempty"`
	OpenVersion              *SalesPartnerVersionView   `json:"openVersion,omitempty"`
	UpdatedAt                time.Time                  `json:"updatedAt"`
	AvailableApprovalActions []approval.LifecycleAction `json:"availableApprovalActions"`
}

type EmployeeInput struct {
	Kind                     string                    `json:"kind"`
	LegalName                string                    `json:"legalName"`
	DisplayName              string                    `json:"displayName,omitempty"`
	TaxNumber                string                    `json:"taxNumber,omitempty"`
	StrongIdentifiers        []BusinessIdentifierInput `json:"strongIdentifiers"`
	Enabled                  bool                      `json:"enabled"`
	CurrentOperatingEntityID string                    `json:"currentOperatingEntityId"`
	EmployeeCategoryID       string                    `json:"employeeCategoryId,omitempty"`
	DepartmentID             string                    `json:"departmentId,omitempty"`
	PositionID               string                    `json:"positionId,omitempty"`
	Phone                    string                    `json:"phone,omitempty"`
	Email                    string                    `json:"email,omitempty"`
	HireDate                 string                    `json:"hireDate,omitempty"`
	Remark                   string                    `json:"remark,omitempty"`
}

type EmployeeData struct {
	Kind                     string                          `json:"kind"`
	LegalName                string                          `json:"legalName"`
	DisplayName              string                          `json:"displayName"`
	TaxNumber                string                          `json:"taxNumber,omitempty"`
	StrongIdentifiers        []BusinessIdentifierInput       `json:"strongIdentifiers"`
	Enabled                  bool                            `json:"enabled"`
	CurrentOperatingEntityID string                          `json:"currentOperatingEntityId"`
	CurrentOperatingEntity   EmployeeOperatingEntitySnapshot `json:"currentOperatingEntity"`
	EmployeeCategoryID       string                          `json:"employeeCategoryId,omitempty"`
	EmployeeCategoryCode     string                          `json:"employeeCategoryCode,omitempty"`
	EmployeeCategoryName     string                          `json:"employeeCategoryName,omitempty"`
	DepartmentID             string                          `json:"departmentId,omitempty"`
	DepartmentCode           string                          `json:"departmentCode,omitempty"`
	DepartmentName           string                          `json:"departmentName,omitempty"`
	PositionID               string                          `json:"positionId,omitempty"`
	PositionCode             string                          `json:"positionCode,omitempty"`
	PositionName             string                          `json:"positionName,omitempty"`
	Phone                    string                          `json:"phone,omitempty"`
	Email                    string                          `json:"email,omitempty"`
	HireDate                 string                          `json:"hireDate,omitempty"`
	Remark                   string                          `json:"remark,omitempty"`
}

type EmployeeOperatingEntitySnapshot struct {
	SourceObjectID  string `json:"sourceObjectId"`
	ApprovalEntryID string `json:"approvalEntryId"`
	Code            string `json:"code"`
	Name            string `json:"name"`
}

type EmployeeCreateInput struct {
	Data EmployeeInput `json:"data"`
}
type EmployeeSaveInput struct {
	ObjectID         string        `json:"objectId"`
	ApprovalEntryID  string        `json:"approvalEntryId"`
	ApprovalRevision int64         `json:"approvalRevision"`
	Data             EmployeeInput `json:"data"`
}
type EmployeeVersionInput struct {
	ObjectID         string `json:"objectId"`
	ApprovalEntryID  string `json:"approvalEntryId"`
	ApprovalRevision int64  `json:"approvalRevision"`
}
type EmployeeReviewInput struct {
	ObjectID         string `json:"objectId"`
	ApprovalEntryID  string `json:"approvalEntryId"`
	ApprovalRevision int64  `json:"approvalRevision"`
	Reason           string `json:"reason"`
}
type EmployeeDeleteInput = EmployeeVersionInput
type EmployeeGetInput struct {
	ObjectID        string `json:"objectId"`
	ApprovalEntryID string `json:"approvalEntryId,omitempty"`
}
type EmployeeQueryFilters struct {
	Keyword            string            `json:"keyword,omitempty"`
	Status             []approval.Status `json:"status,omitempty"`
	Enabled            *bool             `json:"enabled,omitempty"`
	OperatingEntityID  string            `json:"operatingEntityId,omitempty"`
	EmployeeCategoryID string            `json:"employeeCategoryId,omitempty"`
	DepartmentID       string            `json:"departmentId,omitempty"`
	PositionID         string            `json:"positionId,omitempty"`
}
type EmployeeQueryInput struct {
	Page     int                       `json:"page"`
	PageSize int                       `json:"pageSize"`
	Filters  EmployeeQueryFilters      `json:"filters"`
	Sort     []OperatingEntitySortItem `json:"sort"`
}
type EmployeeHistoryInput = OperatingEntityHistoryInput
type EmployeeMutation struct {
	ObjectID string               `json:"objectId"`
	Enabled  bool                 `json:"enabled"`
	Approval approval.VersionMeta `json:"approval"`
}
type EmployeeView struct {
	ObjectID                 string                     `json:"objectId"`
	Entity                   string                     `json:"entity"`
	Code                     string                     `json:"code"`
	Approval                 approval.VersionMeta       `json:"approval"`
	Data                     EmployeeData               `json:"data"`
	UpdatedAt                time.Time                  `json:"updatedAt"`
	AvailableApprovalActions []approval.LifecycleAction `json:"availableApprovalActions"`
}
type EmployeeVersionView struct {
	Approval approval.VersionMeta `json:"approval"`
	Data     EmployeeData         `json:"data"`
}
type EmployeeQueryItem struct {
	ObjectID                 string                          `json:"objectId"`
	Entity                   string                          `json:"entity"`
	Code                     string                          `json:"code"`
	DisplayName              string                          `json:"displayName"`
	CurrentOperatingEntity   EmployeeOperatingEntitySnapshot `json:"currentOperatingEntity"`
	LatestApproved           *EmployeeVersionView            `json:"latestApproved"`
	OpenVersion              *EmployeeVersionView            `json:"openVersion"`
	UpdatedAt                time.Time                       `json:"updatedAt"`
	AvailableApprovalActions []approval.LifecycleAction      `json:"availableApprovalActions"`
}

// ProductInput is the complete, mutable product declaration. Snapshot fields
// are resolved by the service and are deliberately absent from the wire input.
type MeasurementUnitReferenceInput struct {
	ObjectID string `json:"objectId"`
}

type ProductUnitConversionInput struct {
	Unit   MeasurementUnitReferenceInput `json:"unit"`
	Factor string                        `json:"factor"`
}

type ProductQuantityInput struct {
	EnteredQuantity string                        `json:"enteredQuantity"`
	EnteredUnit     MeasurementUnitReferenceInput `json:"enteredUnit"`
	BaseQuantity    string                        `json:"baseQuantity"`
}

type ProductFormulaMaterialInput struct {
	ObjectID        string `json:"objectId"`
	ApprovalEntryID string `json:"approvalEntryId"`
}

type ProductFormulaComponentInput struct {
	Material             ProductFormulaMaterialInput `json:"material"`
	Quantity             ProductQuantityInput        `json:"quantity"`
	ResolutionStatus     string                      `json:"resolutionStatus"`
	RequiresConfirmation bool                        `json:"requiresConfirmation"`
}

type ProductFormulaInput struct {
	Output     ProductQuantityInput           `json:"output"`
	Components []ProductFormulaComponentInput `json:"components"`
}

type ProductInput struct {
	Name                 string                       `json:"name"`
	CategoryID           string                       `json:"categoryId"`
	Specification        string                       `json:"specification"`
	Model                string                       `json:"model"`
	Barcode              string                       `json:"barcode"`
	Remark               string                       `json:"remark"`
	ProductTypeID        string                       `json:"productTypeId"`
	DefaultInputUnitID   string                       `json:"defaultInputUnitId"`
	PricingUnitID        string                       `json:"pricingUnitId"`
	UnitConversions      []ProductUnitConversionInput `json:"unitConversions"`
	Returnable           bool                         `json:"returnable"`
	DefaultPackagingSpec string                       `json:"defaultPackagingSpec"`
	Formula              *ProductFormulaInput         `json:"formula"`
}

// ProductData is the DCL read snapshot. Keep it product-only: DCL owns the
// stable identity and version snapshot, while BOB exposes no unrelated fields
// such as bulkLiquidCapable through this declaration model.
type ProductData struct {
	Name                 string                            `json:"name"`
	CategoryID           string                            `json:"categoryId"`
	CategoryCode         string                            `json:"categoryCode"`
	CategoryName         string                            `json:"categoryName"`
	Specification        string                            `json:"specification"`
	Model                string                            `json:"model"`
	Barcode              string                            `json:"barcode"`
	Remark               string                            `json:"remark"`
	ProductTypeID        string                            `json:"productTypeId"`
	ProductTypeCode      string                            `json:"productTypeCode"`
	ProductTypeName      string                            `json:"productTypeName"`
	BehaviorProfile      string                            `json:"behaviorProfile"`
	DefaultInputUnitID   string                            `json:"defaultInputUnitId"`
	PricingUnitID        string                            `json:"pricingUnitId"`
	UnitConversions      []bobdomain.ProductUnitConversion `json:"unitConversions"`
	Returnable           bool                              `json:"returnable"`
	DefaultPackagingSpec string                            `json:"defaultPackagingSpec"`
	Formula              *bobdomain.ProductFormula         `json:"formula"`
}
type ProductCreateInput struct {
	Data ProductInput `json:"data"`
}
type ProductSaveInput struct {
	ObjectID         string       `json:"objectId"`
	ApprovalEntryID  string       `json:"approvalEntryId"`
	ApprovalRevision int64        `json:"approvalRevision"`
	Enabled          bool         `json:"enabled"`
	Data             ProductInput `json:"data"`
}
type ProductVersionInput struct {
	ObjectID         string `json:"objectId"`
	ApprovalEntryID  string `json:"approvalEntryId"`
	ApprovalRevision int64  `json:"approvalRevision"`
}
type ProductReviewInput struct {
	ObjectID         string `json:"objectId"`
	ApprovalEntryID  string `json:"approvalEntryId"`
	ApprovalRevision int64  `json:"approvalRevision"`
	Reason           string `json:"reason"`
}
type ProductDeleteInput = ProductVersionInput
type ProductGetInput struct {
	ObjectID        string `json:"objectId"`
	ApprovalEntryID string `json:"approvalEntryId,omitempty"`
}
type ProductQueryFilters struct {
	Keyword       string            `json:"keyword,omitempty"`
	Status        []approval.Status `json:"status,omitempty"`
	Enabled       *bool             `json:"enabled,omitempty"`
	ProductTypeID string            `json:"productTypeId,omitempty"`
	CategoryID    string            `json:"categoryId,omitempty"`
}

type ProductQueryInput struct {
	Page     int                       `json:"page"`
	PageSize int                       `json:"pageSize"`
	Filters  ProductQueryFilters       `json:"filters"`
	Sort     []OperatingEntitySortItem `json:"sort"`
}
type ProductHistoryInput = OperatingEntityHistoryInput
type ProductMutation = OperatingEntityMutation
type ProductView struct {
	ObjectID                 string                     `json:"objectId"`
	Entity                   string                     `json:"entity"`
	Code                     string                     `json:"code"`
	Enabled                  bool                       `json:"enabled"`
	Approval                 approval.VersionMeta       `json:"approval"`
	Data                     ProductData                `json:"data"`
	UpdatedAt                time.Time                  `json:"updatedAt"`
	AvailableApprovalActions []approval.LifecycleAction `json:"availableApprovalActions"`
}
type ProductVersionView struct {
	Approval approval.VersionMeta `json:"approval"`
	Data     ProductData          `json:"data"`
	Enabled  bool                 `json:"enabled"`
}
type ProductQueryItem struct {
	ObjectID                 string                     `json:"objectId"`
	Entity                   string                     `json:"entity"`
	Code                     string                     `json:"code"`
	Enabled                  bool                       `json:"enabled"`
	LatestApproved           *ProductVersionView        `json:"latestApproved"`
	OpenVersion              *ProductVersionView        `json:"openVersion"`
	UpdatedAt                time.Time                  `json:"updatedAt"`
	AvailableApprovalActions []approval.LifecycleAction `json:"availableApprovalActions"`
}

type FundAccountData struct {
	Name              string `json:"name"`
	Currency          string `json:"currency"`
	AccountName       string `json:"accountName,omitempty"`
	BankName          string `json:"bankName,omitempty"`
	BankBranch        string `json:"bankBranch,omitempty"`
	AccountNumber     string `json:"accountNumber,omitempty"`
	Remark            string `json:"remark,omitempty"`
	OperatingEntityID string `json:"operatingEntityId"`
}
type FundAccountCreateInput struct {
	Data FundAccountData `json:"data"`
}
type FundAccountSaveInput struct {
	ObjectID         string          `json:"objectId"`
	ApprovalEntryID  string          `json:"approvalEntryId"`
	ApprovalRevision int64           `json:"approvalRevision"`
	Enabled          bool            `json:"enabled"`
	Data             FundAccountData `json:"data"`
}
type FundAccountVersionInput struct {
	ObjectID         string `json:"objectId"`
	ApprovalEntryID  string `json:"approvalEntryId"`
	ApprovalRevision int64  `json:"approvalRevision"`
}
type FundAccountDeleteInput = FundAccountVersionInput
type FundAccountReviewInput struct {
	ObjectID         string `json:"objectId"`
	ApprovalEntryID  string `json:"approvalEntryId"`
	ApprovalRevision int64  `json:"approvalRevision"`
	Reason           string `json:"reason"`
}
type FundAccountGetInput struct {
	ObjectID        string `json:"objectId"`
	ApprovalEntryID string `json:"approvalEntryId,omitempty"`
}
type FundAccountQueryInput struct {
	Page     int                         `json:"page"`
	PageSize int                         `json:"pageSize"`
	Filters  OperatingEntityQueryFilters `json:"filters"`
	Sort     []OperatingEntitySortItem   `json:"sort"`
}
type FundAccountHistoryInput = OperatingEntityHistoryInput
type FundAccountMutation = OperatingEntityMutation
type FundAccountView struct {
	ObjectID                 string                     `json:"objectId"`
	Entity                   string                     `json:"entity"`
	Code                     string                     `json:"code"`
	Enabled                  bool                       `json:"enabled"`
	Approval                 approval.VersionMeta       `json:"approval"`
	Data                     FundAccountData            `json:"data"`
	UpdatedAt                time.Time                  `json:"updatedAt"`
	AvailableApprovalActions []approval.LifecycleAction `json:"availableApprovalActions"`
}
type FundAccountVersionView struct {
	Approval approval.VersionMeta `json:"approval"`
	Data     FundAccountData      `json:"data"`
	Enabled  bool                 `json:"enabled"`
}
type FundAccountQueryItem struct {
	ObjectID                 string                     `json:"objectId"`
	Entity                   string                     `json:"entity"`
	Code                     string                     `json:"code"`
	Enabled                  bool                       `json:"enabled"`
	LatestApproved           *FundAccountVersionView    `json:"latestApproved"`
	OpenVersion              *FundAccountVersionView    `json:"openVersion"`
	UpdatedAt                time.Time                  `json:"updatedAt"`
	AvailableApprovalActions []approval.LifecycleAction `json:"availableApprovalActions"`
}

type VehicleData struct {
	Name               string                        `json:"name"`
	PlateNumber        string                        `json:"plateNumber"`
	VehicleType        string                        `json:"vehicleType"`
	CarrierAffiliation *bobdomain.CarrierAffiliation `json:"carrierAffiliation"`
	BulkLiquidCapable  bool                          `json:"bulkLiquidCapable"`
	VIN                string                        `json:"vin,omitempty"`
	EngineNumber       string                        `json:"engineNumber,omitempty"`
	LoadCapacityKG     string                        `json:"loadCapacityKg,omitempty"`
	Remark             string                        `json:"remark,omitempty"`
}
type VehicleCreateInput struct {
	Data VehicleData `json:"data"`
}
type VehicleSaveInput struct {
	ObjectID         string      `json:"objectId"`
	ApprovalEntryID  string      `json:"approvalEntryId"`
	ApprovalRevision int64       `json:"approvalRevision"`
	Enabled          bool        `json:"enabled"`
	Data             VehicleData `json:"data"`
}
type VehicleVersionInput struct {
	ObjectID         string `json:"objectId"`
	ApprovalEntryID  string `json:"approvalEntryId"`
	ApprovalRevision int64  `json:"approvalRevision"`
}
type VehicleReviewInput struct {
	ObjectID         string `json:"objectId"`
	ApprovalEntryID  string `json:"approvalEntryId"`
	ApprovalRevision int64  `json:"approvalRevision"`
	Reason           string `json:"reason"`
}
type VehicleDeleteInput = VehicleVersionInput
type VehicleGetInput struct {
	ObjectID        string `json:"objectId"`
	ApprovalEntryID string `json:"approvalEntryId,omitempty"`
}
type VehicleQueryFilters = OperatingEntityQueryFilters
type VehicleSortItem = OperatingEntitySortItem
type VehicleQueryInput struct {
	Page     int                 `json:"page"`
	PageSize int                 `json:"pageSize"`
	Filters  VehicleQueryFilters `json:"filters"`
	Sort     []VehicleSortItem   `json:"sort"`
}
type VehicleHistoryInput = OperatingEntityHistoryInput
type VehicleMutation = WarehouseMutation
type VehicleView struct {
	ObjectID                 string                     `json:"objectId"`
	Entity                   string                     `json:"entity"`
	Code                     string                     `json:"code"`
	Enabled                  bool                       `json:"enabled"`
	Approval                 approval.VersionMeta       `json:"approval"`
	Data                     VehicleData                `json:"data"`
	UpdatedAt                time.Time                  `json:"updatedAt"`
	AvailableApprovalActions []approval.LifecycleAction `json:"availableApprovalActions"`
}
type VehicleVersionView struct {
	Approval approval.VersionMeta `json:"approval"`
	Data     VehicleData          `json:"data"`
	Enabled  bool                 `json:"enabled"`
}
type VehicleQueryItem struct {
	ObjectID                 string                     `json:"objectId"`
	Entity                   string                     `json:"entity"`
	Code                     string                     `json:"code"`
	Enabled                  bool                       `json:"enabled"`
	LatestApproved           *VehicleVersionView        `json:"latestApproved"`
	OpenVersion              *VehicleVersionView        `json:"openVersion"`
	UpdatedAt                time.Time                  `json:"updatedAt"`
	AvailableApprovalActions []approval.LifecycleAction `json:"availableApprovalActions"`
}

type WarehouseData struct {
	Name              string `json:"name"`
	Address           string `json:"address,omitempty"`
	ContactName       string `json:"contactName,omitempty"`
	ContactPhone      string `json:"contactPhone,omitempty"`
	ManagerEmployeeID string `json:"managerEmployeeId,omitempty"`
	Remark            string `json:"remark,omitempty"`
}

type WarehouseCreateInput struct {
	Data WarehouseData `json:"data"`
}
type WarehouseSaveInput struct {
	ObjectID         string        `json:"objectId"`
	ApprovalEntryID  string        `json:"approvalEntryId"`
	ApprovalRevision int64         `json:"approvalRevision"`
	Enabled          bool          `json:"enabled"`
	Data             WarehouseData `json:"data"`
}
type WarehouseVersionInput struct {
	ObjectID         string `json:"objectId"`
	ApprovalEntryID  string `json:"approvalEntryId"`
	ApprovalRevision int64  `json:"approvalRevision"`
}
type WarehouseReviewInput struct {
	ObjectID         string `json:"objectId"`
	ApprovalEntryID  string `json:"approvalEntryId"`
	ApprovalRevision int64  `json:"approvalRevision"`
	Reason           string `json:"reason"`
}
type WarehouseDeleteInput = WarehouseVersionInput
type WarehouseGetInput struct {
	ObjectID        string `json:"objectId"`
	ApprovalEntryID string `json:"approvalEntryId,omitempty"`
}
type WarehouseQueryFilters = OperatingEntityQueryFilters
type WarehouseSortItem = OperatingEntitySortItem
type WarehouseQueryInput struct {
	Page     int                   `json:"page"`
	PageSize int                   `json:"pageSize"`
	Filters  WarehouseQueryFilters `json:"filters"`
	Sort     []WarehouseSortItem   `json:"sort"`
}
type WarehouseHistoryInput = OperatingEntityHistoryInput
type WarehouseMutation struct {
	ObjectID string               `json:"objectId"`
	Enabled  bool                 `json:"enabled"`
	Approval approval.VersionMeta `json:"approval"`
}
type WarehouseView struct {
	ObjectID                 string                     `json:"objectId"`
	Entity                   string                     `json:"entity"`
	Code                     string                     `json:"code"`
	Enabled                  bool                       `json:"enabled"`
	Approval                 approval.VersionMeta       `json:"approval"`
	Data                     WarehouseData              `json:"data"`
	UpdatedAt                time.Time                  `json:"updatedAt"`
	AvailableApprovalActions []approval.LifecycleAction `json:"availableApprovalActions"`
}
type WarehouseVersionView struct {
	Approval approval.VersionMeta `json:"approval"`
	Data     WarehouseData        `json:"data"`
	Enabled  bool                 `json:"enabled"`
}
type WarehouseQueryItem struct {
	ObjectID                 string                     `json:"objectId"`
	Entity                   string                     `json:"entity"`
	Code                     string                     `json:"code"`
	Enabled                  bool                       `json:"enabled"`
	LatestApproved           *WarehouseVersionView      `json:"latestApproved"`
	OpenVersion              *WarehouseVersionView      `json:"openVersion"`
	UpdatedAt                time.Time                  `json:"updatedAt"`
	AvailableApprovalActions []approval.LifecycleAction `json:"availableApprovalActions"`
}

type OperatingEntityData = bobdomain.OperatingEntityData

type OperatingEntityCreateInput struct {
	Data OperatingEntityData `json:"data"`
}

type OperatingEntitySaveInput struct {
	ObjectID         string              `json:"objectId"`
	ApprovalEntryID  string              `json:"approvalEntryId"`
	ApprovalRevision int64               `json:"approvalRevision"`
	Enabled          bool                `json:"enabled"`
	Data             OperatingEntityData `json:"data"`
}

type OperatingEntityVersionInput struct {
	ObjectID         string `json:"objectId"`
	ApprovalEntryID  string `json:"approvalEntryId"`
	ApprovalRevision int64  `json:"approvalRevision"`
}

type OperatingEntityReviewInput struct {
	ObjectID         string `json:"objectId"`
	ApprovalEntryID  string `json:"approvalEntryId"`
	ApprovalRevision int64  `json:"approvalRevision"`
	Reason           string `json:"reason"`
}

type OperatingEntityDeleteInput = OperatingEntityVersionInput

type OperatingEntityGetInput struct {
	ObjectID        string `json:"objectId"`
	ApprovalEntryID string `json:"approvalEntryId,omitempty"`
}

type OperatingEntityQueryFilters struct {
	Keyword string            `json:"keyword,omitempty"`
	Status  []approval.Status `json:"status,omitempty"`
	Enabled *bool             `json:"enabled,omitempty"`
}

type OperatingEntitySortItem struct {
	Field string `json:"field"`
	Order string `json:"order"`
}

type OperatingEntityQueryInput struct {
	Page     int                         `json:"page"`
	PageSize int                         `json:"pageSize"`
	Filters  OperatingEntityQueryFilters `json:"filters"`
	Sort     []OperatingEntitySortItem   `json:"sort"`
}

type OperatingEntityHistoryInput struct {
	ObjectID string `json:"objectId"`
	Page     int    `json:"page"`
	PageSize int    `json:"pageSize"`
}

type OperatingEntityMutation struct {
	ObjectID string               `json:"objectId"`
	Enabled  bool                 `json:"enabled"`
	Approval approval.VersionMeta `json:"approval"`
}

type OperatingEntityView struct {
	ObjectID                 string                     `json:"objectId"`
	Entity                   string                     `json:"entity"`
	Code                     string                     `json:"code"`
	Enabled                  bool                       `json:"enabled"`
	Approval                 approval.VersionMeta       `json:"approval"`
	Data                     OperatingEntityData        `json:"data"`
	UpdatedAt                time.Time                  `json:"updatedAt"`
	AvailableApprovalActions []approval.LifecycleAction `json:"availableApprovalActions"`
}

type OperatingEntityVersionView struct {
	Approval approval.VersionMeta `json:"approval"`
	Data     OperatingEntityData  `json:"data"`
	Enabled  bool                 `json:"enabled"`
}

type OperatingEntityQueryItem struct {
	ObjectID                 string                      `json:"objectId"`
	Entity                   string                      `json:"entity"`
	Code                     string                      `json:"code"`
	Enabled                  bool                        `json:"enabled"`
	LatestApproved           *OperatingEntityVersionView `json:"latestApproved"`
	OpenVersion              *OperatingEntityVersionView `json:"openVersion"`
	UpdatedAt                time.Time                   `json:"updatedAt"`
	AvailableApprovalActions []approval.LifecycleAction  `json:"availableApprovalActions"`
}

type Page[T any] struct {
	Items    []T   `json:"items"`
	Total    int64 `json:"total"`
	Page     int   `json:"page"`
	PageSize int   `json:"pageSize"`
}

// AccMappingData is the DCL-owned accounting mapping snapshot. It reuses the
// ACC MappingDefinition wire shape so posting and validation stay identical.
type AccMappingData struct {
	DefaultResult string          `json:"defaultResult"`
	Definition    json.RawMessage `json:"definition"`
}

type AccMappingCreateInput struct {
	BookID    string         `json:"bookId"`
	VouEntity string         `json:"vouEntity"`
	Data      AccMappingData `json:"data"`
}

type AccMappingSaveInput struct {
	BookID           string         `json:"bookId"`
	VouEntity        string         `json:"vouEntity"`
	ApprovalEntryID  string         `json:"approvalEntryId"`
	ApprovalRevision int64          `json:"approvalRevision"`
	Data             AccMappingData `json:"data"`
}

type AccMappingVersionInput struct {
	BookID           string `json:"bookId"`
	VouEntity        string `json:"vouEntity"`
	ApprovalEntryID  string `json:"approvalEntryId"`
	ApprovalRevision int64  `json:"approvalRevision"`
}

type AccMappingReviewInput struct {
	BookID           string `json:"bookId"`
	VouEntity        string `json:"vouEntity"`
	ApprovalEntryID  string `json:"approvalEntryId"`
	ApprovalRevision int64  `json:"approvalRevision"`
	Reason           string `json:"reason"`
}

type AccMappingDeleteInput = AccMappingVersionInput

type AccMappingGetInput struct {
	BookID          string `json:"bookId"`
	VouEntity       string `json:"vouEntity"`
	ApprovalEntryID string `json:"approvalEntryId,omitempty"`
}

type AccMappingQueryFilters struct {
	VouEntity string            `json:"vouEntity,omitempty"`
	Status    []approval.Status `json:"status,omitempty"`
}

type AccMappingSortItem struct {
	Field string `json:"field"`
	Order string `json:"order"`
}

type AccMappingQueryInput struct {
	BookID   string                 `json:"bookId"`
	Page     int                    `json:"page"`
	PageSize int                    `json:"pageSize"`
	Filters  AccMappingQueryFilters `json:"filters"`
	Sort     []AccMappingSortItem   `json:"sort"`
}

type AccMappingHistoryInput struct {
	BookID    string `json:"bookId"`
	VouEntity string `json:"vouEntity"`
	Page      int    `json:"page"`
	PageSize  int    `json:"pageSize"`
}

type AccMappingMutation struct {
	BookID    string               `json:"bookId"`
	VouEntity string               `json:"vouEntity"`
	Approval  approval.VersionMeta `json:"approval"`
}

type AccMappingView struct {
	BookID                   string                     `json:"bookId"`
	VouEntity                string                     `json:"vouEntity"`
	Approval                 approval.VersionMeta       `json:"approval"`
	Data                     AccMappingData             `json:"data"`
	AvailableApprovalActions []approval.LifecycleAction `json:"availableApprovalActions"`
}

type AccMappingListItem struct {
	BookID                   string                     `json:"bookId"`
	VouEntity                string                     `json:"vouEntity"`
	Approval                 approval.VersionMeta       `json:"approval"`
	Data                     AccMappingData             `json:"data"`
	AvailableApprovalActions []approval.LifecycleAction `json:"availableApprovalActions"`
}

type AccMappingVersionView struct {
	BookID    string               `json:"bookId"`
	VouEntity string               `json:"vouEntity"`
	Approval  approval.VersionMeta `json:"approval"`
	Data      AccMappingData       `json:"data"`
}

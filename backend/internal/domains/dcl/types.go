package dcl

import (
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
	EntityParty           = "party"
	EntityEmployee        = "employee"
	EntityOtherUnit       = "other-unit"
	EntitySalesPartner    = "sales-partner"
	EntitySupplier        = "supplier"
	EntityCustomer        = "customer"
	EntityCustomerAccount = "customer-account"
)

// Customer is the DCL declaration for the immutable Party-to-operating-
// entity customer relationship.  Its commercial accounts are independent
// Customer Account approval subjects.
type CustomerCreateInput struct {
	PartyID           string                     `json:"partyId,omitempty"`
	NewParty          *bobdomain.PartyCreateData `json:"newParty,omitempty"`
	OperatingEntityID string                     `json:"operatingEntityId"`
	// DefaultAccount is required because Customer creation atomically establishes
	// the initial commercial account as its own DCL approval subject.
	DefaultAccount CustomerAccountDataInput `json:"defaultAccount"`
}
type CustomerSaveInput struct {
	ObjectID         string `json:"objectId"`
	ApprovalEntryID  string `json:"approvalEntryId"`
	ApprovalRevision int64  `json:"approvalRevision"`
	Enabled          bool   `json:"enabled"`
}
type CustomerVersionInput struct {
	ObjectID         string `json:"objectId"`
	ApprovalEntryID  string `json:"approvalEntryId"`
	ApprovalRevision int64  `json:"approvalRevision"`
}
type CustomerReviewInput struct {
	ObjectID         string `json:"objectId"`
	ApprovalEntryID  string `json:"approvalEntryId"`
	ApprovalRevision int64  `json:"approvalRevision"`
	Reason           string `json:"reason"`
}
type CustomerDeleteInput = CustomerVersionInput
type CustomerMutation struct {
	ObjectID       string               `json:"objectId"`
	ObjectRevision int64                `json:"objectRevision"`
	PartyID        string               `json:"partyId"`
	Enabled        bool                 `json:"enabled"`
	Approval       approval.VersionMeta `json:"approval"`
}

// Relationship declarations own mutable commercial data. The Party and
// operating-entity pair is reserved once in BOB and cannot change on save.
type OtherUnitData struct {
	ContactName                     string `json:"contactName,omitempty"`
	ContactPhone                    string `json:"contactPhone,omitempty"`
	Email                           string `json:"email,omitempty"`
	Address                         string `json:"address,omitempty"`
	SettlementMethodID              string `json:"settlementMethodId,omitempty"`
	SettlementMethodApprovalEntryID string `json:"settlementMethodApprovalEntryId,omitempty"`
	SettlementMethodCode            string `json:"settlementMethodCode,omitempty"`
	SettlementMethodName            string `json:"settlementMethodName,omitempty"`
	SettlementTermCode              string `json:"settlementTermCode,omitempty"`
	SettlementRuleType              string `json:"settlementRuleType,omitempty"`
	SettlementMonthOffset           int32  `json:"settlementMonthOffset,omitempty"`
	SettlementDayOfMonth            int32  `json:"settlementDayOfMonth,omitempty"`
	SettlementDayOffset             int32  `json:"settlementDayOffset,omitempty"`
	Remark                          string `json:"remark,omitempty"`
}
type SalesPartnerData struct {
	Capabilities []string `json:"capabilities"`
	ContactName  string   `json:"contactName,omitempty"`
	ContactPhone string   `json:"contactPhone,omitempty"`
	Email        string   `json:"email,omitempty"`
	Address      string   `json:"address,omitempty"`
	Remark       string   `json:"remark,omitempty"`
}

// SupplierData is the DCL-owned mutable supplier declaration. Party identity
// and the operating entity are immutable BOB relationship facts.
type SupplierData struct {
	ShortName        string                            `json:"shortName,omitempty"`
	TaxNumber        string                            `json:"taxNumber,omitempty"`
	ContactName      string                            `json:"contactName,omitempty"`
	ContactPhone     string                            `json:"contactPhone,omitempty"`
	Email            string                            `json:"email,omitempty"`
	Address          string                            `json:"address,omitempty"`
	Remark           string                            `json:"remark,omitempty"`
	SettlementMethod *SupplierSettlementMethodSnapshot `json:"settlementMethod,omitempty"`
	DefaultPurchaser *SupplierEmployeeSnapshot         `json:"defaultPurchaser,omitempty"`

	// Stable selection IDs are the input surface; nested fields are the exact
	// snapshots returned after resolution.
	SettlementMethodID              string `json:"settlementMethodId,omitempty"`
	SettlementMethodApprovalEntryID string `json:"-"`
	SettlementMethodCode            string `json:"-"`
	SettlementMethodName            string `json:"-"`
	SettlementTermCode              string `json:"-"`
	SettlementRuleType              string `json:"-"`
	SettlementMonthOffset           int32  `json:"-"`
	SettlementDayOfMonth            int32  `json:"-"`
	SettlementDayOffset             int32  `json:"-"`
	DefaultPurchaserEmployeeID      string `json:"defaultPurchaserEmployeeId,omitempty"`
	DefaultPurchaserApprovalEntryID string `json:"-"`
	DefaultPurchaserCode            string `json:"-"`
	DefaultPurchaserName            string `json:"-"`
}
type SupplierSettlementMethodSnapshot struct {
	SourceObjectID  string `json:"sourceObjectId"`
	ApprovalEntryID string `json:"approvalEntryId"`
	Code            string `json:"code"`
	Name            string `json:"name"`
	TermCode        string `json:"termCode"`
	RuleType        string `json:"ruleType"`
	MonthOffset     int32  `json:"monthOffset"`
	DayOfMonth      int32  `json:"dayOfMonth"`
	DayOffset       int32  `json:"dayOffset"`
}
type SupplierEmployeeSnapshot struct {
	SourceObjectID  string `json:"sourceObjectId"`
	ApprovalEntryID string `json:"approvalEntryId"`
	Code            string `json:"code"`
	Name            string `json:"name"`
}
type SupplierCreateInput struct {
	PartyID           string                     `json:"partyId,omitempty"`
	NewParty          *bobdomain.PartyCreateData `json:"newParty,omitempty"`
	OperatingEntityID string                     `json:"operatingEntityId"`
	Data              SupplierData               `json:"data"`
}
type SupplierSaveInput struct {
	ObjectID         string       `json:"objectId"`
	ApprovalEntryID  string       `json:"approvalEntryId"`
	ApprovalRevision int64        `json:"approvalRevision"`
	Enabled          bool         `json:"enabled"`
	Data             SupplierData `json:"data"`
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
	Keyword           string            `json:"keyword,omitempty"`
	Status            []approval.Status `json:"status,omitempty"`
	Enabled           *bool             `json:"enabled,omitempty"`
	OperatingEntityID string            `json:"operatingEntityId,omitempty"`
}
type SupplierQueryInput struct {
	Page     int                       `json:"page"`
	PageSize int                       `json:"pageSize"`
	Filters  SupplierQueryFilters      `json:"filters"`
	Sort     []OperatingEntitySortItem `json:"sort"`
}
type SupplierHistoryInput = OperatingEntityHistoryInput
type SupplierMutation struct {
	ObjectID       string               `json:"objectId"`
	ObjectRevision int64                `json:"objectRevision"`
	Enabled        bool                 `json:"enabled"`
	PartyID        string               `json:"partyId"`
	Approval       approval.VersionMeta `json:"approval"`
}
type SupplierView struct {
	RelationshipIdentityView
	OperatingEntityApprovalEntryID string       `json:"operatingEntityApprovalEntryId"`
	OperatingEntityCode            string       `json:"operatingEntityCode"`
	OperatingEntityName            string       `json:"operatingEntityName"`
	Data                           SupplierData `json:"data"`
	UpdatedAt                      time.Time    `json:"updatedAt"`
}
type SupplierVersionView struct {
	Approval approval.VersionMeta `json:"approval"`
	Enabled  bool                 `json:"enabled"`
	Data     SupplierData         `json:"data"`
}
type SupplierQueryItem struct {
	RelationshipIdentityView
	OperatingEntityCode string               `json:"operatingEntityCode"`
	OperatingEntityName string               `json:"operatingEntityName"`
	LatestApproved      *SupplierVersionView `json:"latestApproved,omitempty"`
	OpenVersion         *SupplierVersionView `json:"openVersion,omitempty"`
	UpdatedAt           time.Time            `json:"updatedAt"`
}
type OtherUnitCreateInput struct {
	PartyID           string                     `json:"partyId,omitempty"`
	NewParty          *bobdomain.PartyCreateData `json:"newParty,omitempty"`
	OperatingEntityID string                     `json:"operatingEntityId"`
	Data              OtherUnitData              `json:"data"`
}
type SalesPartnerCreateInput struct {
	PartyID           string                     `json:"partyId,omitempty"`
	NewParty          *bobdomain.PartyCreateData `json:"newParty,omitempty"`
	OperatingEntityID string                     `json:"operatingEntityId"`
	Data              SalesPartnerData           `json:"data"`
}
type OtherUnitSaveInput struct {
	ObjectID         string        `json:"objectId"`
	ApprovalEntryID  string        `json:"approvalEntryId"`
	ApprovalRevision int64         `json:"approvalRevision"`
	Enabled          bool          `json:"enabled"`
	Data             OtherUnitData `json:"data"`
}
type SalesPartnerSaveInput struct {
	ObjectID         string           `json:"objectId"`
	ApprovalEntryID  string           `json:"approvalEntryId"`
	ApprovalRevision int64            `json:"approvalRevision"`
	Enabled          bool             `json:"enabled"`
	Data             SalesPartnerData `json:"data"`
}
type RelationshipVersionInput struct {
	ObjectID         string `json:"objectId"`
	ApprovalEntryID  string `json:"approvalEntryId"`
	ApprovalRevision int64  `json:"approvalRevision"`
}
type RelationshipReviewInput struct {
	ObjectID         string `json:"objectId"`
	ApprovalEntryID  string `json:"approvalEntryId"`
	ApprovalRevision int64  `json:"approvalRevision"`
	Reason           string `json:"reason"`
}
type RelationshipMutation struct {
	ObjectID       string               `json:"objectId"`
	ObjectRevision int64                `json:"objectRevision"`
	Enabled        bool                 `json:"enabled"`
	PartyID        string               `json:"partyId"`
	Approval       approval.VersionMeta `json:"approval"`
}
type RelationshipGetInput struct {
	ObjectID        string `json:"objectId"`
	ApprovalEntryID string `json:"approvalEntryId,omitempty"`
}
type RelationshipQueryInput struct {
	Page     int               `json:"page"`
	PageSize int               `json:"pageSize"`
	Keyword  string            `json:"keyword,omitempty"`
	Status   []approval.Status `json:"status,omitempty"`
	Enabled  *bool             `json:"enabled,omitempty"`
}
type RelationshipHistoryInput struct {
	ObjectID string `json:"objectId"`
	Page     int    `json:"page"`
	PageSize int    `json:"pageSize"`
}
type RelationshipIdentityView struct {
	ObjectID          string               `json:"objectId"`
	Entity            string               `json:"entity"`
	Code              string               `json:"code"`
	ObjectRevision    int64                `json:"objectRevision"`
	PartyID           string               `json:"partyId"`
	PartyKind         string               `json:"partyKind"`
	PartyDisplayName  string               `json:"partyDisplayName"`
	OperatingEntityID string               `json:"operatingEntityId"`
	Enabled           bool                 `json:"enabled"`
	Approval          approval.VersionMeta `json:"approval"`
}
type OtherUnitView struct {
	RelationshipIdentityView
	Data OtherUnitData `json:"data"`
}
type SalesPartnerView struct {
	RelationshipIdentityView
	Data SalesPartnerData `json:"data"`
}
type OtherUnitVersionView struct {
	Approval approval.VersionMeta `json:"approval"`
	Enabled  bool                 `json:"enabled"`
	Data     OtherUnitData        `json:"data"`
}
type SalesPartnerVersionView struct {
	Approval approval.VersionMeta `json:"approval"`
	Enabled  bool                 `json:"enabled"`
	Data     SalesPartnerData     `json:"data"`
}
type OtherUnitQueryItem struct {
	RelationshipIdentityView
	LatestApproved *OtherUnitVersionView `json:"latestApproved,omitempty"`
	OpenVersion    *OtherUnitVersionView `json:"openVersion,omitempty"`
}
type SalesPartnerQueryItem struct {
	RelationshipIdentityView
	LatestApproved *SalesPartnerVersionView `json:"latestApproved,omitempty"`
	OpenVersion    *SalesPartnerVersionView `json:"openVersion,omitempty"`
}

// EmployeeInput contains only Employee-owned mutable attributes. Party identity
// and the immutable Party x operating-entity relationship are separate roots.
type EmployeeInput struct {
	EmployeeCategoryID string `json:"employeeCategoryId,omitempty"`
	DepartmentID       string `json:"departmentId,omitempty"`
	PositionID         string `json:"positionId,omitempty"`
	Phone              string `json:"phone,omitempty"`
	Email              string `json:"email,omitempty"`
	HireDate           string `json:"hireDate,omitempty"`
	Remark             string `json:"remark,omitempty"`
}

type EmployeeData struct {
	EmployeeCategoryID              string `json:"employeeCategoryId,omitempty"`
	EmployeeCategoryApprovalEntryID string `json:"employeeCategoryApprovalEntryId,omitempty"`
	EmployeeCategoryCode            string `json:"employeeCategoryCode,omitempty"`
	EmployeeCategoryName            string `json:"employeeCategoryName,omitempty"`
	DepartmentID                    string `json:"departmentId,omitempty"`
	DepartmentApprovalEntryID       string `json:"departmentApprovalEntryId,omitempty"`
	DepartmentCode                  string `json:"departmentCode,omitempty"`
	DepartmentName                  string `json:"departmentName,omitempty"`
	PositionID                      string `json:"positionId,omitempty"`
	PositionApprovalEntryID         string `json:"positionApprovalEntryId,omitempty"`
	PositionCode                    string `json:"positionCode,omitempty"`
	PositionName                    string `json:"positionName,omitempty"`
	Phone                           string `json:"phone,omitempty"`
	Email                           string `json:"email,omitempty"`
	HireDate                        string `json:"hireDate,omitempty"`
	Remark                          string `json:"remark,omitempty"`
}

type EmployeeCreateInput struct {
	PartyID           string                     `json:"partyId,omitempty"`
	NewParty          *bobdomain.PartyCreateData `json:"newParty,omitempty"`
	OperatingEntityID string                     `json:"operatingEntityId"`
	Data              EmployeeInput              `json:"data"`
}
type EmployeeSaveInput struct {
	ObjectID         string        `json:"objectId"`
	ApprovalEntryID  string        `json:"approvalEntryId"`
	ApprovalRevision int64         `json:"approvalRevision"`
	Enabled          bool          `json:"enabled"`
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
	ObjectID       string               `json:"objectId"`
	ObjectRevision int64                `json:"objectRevision"`
	Enabled        bool                 `json:"enabled"`
	Approval       approval.VersionMeta `json:"approval"`
}
type EmployeeView struct {
	ObjectID                       string               `json:"objectId"`
	Entity                         string               `json:"entity"`
	Code                           string               `json:"code"`
	ObjectRevision                 int64                `json:"objectRevision"`
	PartyID                        string               `json:"partyId"`
	PartyKind                      string               `json:"partyKind"`
	PartyDisplayName               string               `json:"partyDisplayName"`
	OperatingEntityID              string               `json:"operatingEntityId"`
	OperatingEntityApprovalEntryID string               `json:"operatingEntityApprovalEntryId"`
	OperatingEntityCode            string               `json:"operatingEntityCode"`
	OperatingEntityName            string               `json:"operatingEntityName"`
	Enabled                        bool                 `json:"enabled"`
	Approval                       approval.VersionMeta `json:"approval"`
	Data                           EmployeeData         `json:"data"`
	UpdatedAt                      time.Time            `json:"updatedAt"`
}
type EmployeeVersionView struct {
	Approval approval.VersionMeta `json:"approval"`
	Data     EmployeeData         `json:"data"`
	Enabled  bool                 `json:"enabled"`
}
type EmployeeQueryItem struct {
	ObjectID            string               `json:"objectId"`
	Entity              string               `json:"entity"`
	Code                string               `json:"code"`
	ObjectRevision      int64                `json:"objectRevision"`
	PartyID             string               `json:"partyId"`
	PartyKind           string               `json:"partyKind"`
	PartyDisplayName    string               `json:"partyDisplayName"`
	OperatingEntityID   string               `json:"operatingEntityId"`
	OperatingEntityCode string               `json:"operatingEntityCode"`
	OperatingEntityName string               `json:"operatingEntityName"`
	Enabled             bool                 `json:"enabled"`
	LatestApproved      *EmployeeVersionView `json:"latestApproved"`
	OpenVersion         *EmployeeVersionView `json:"openVersion"`
	UpdatedAt           time.Time            `json:"updatedAt"`
}

type PartyData = bobdomain.PartyCreateData
type PartyMutation struct {
	PartyID  string               `json:"partyId"`
	Approval approval.VersionMeta `json:"approval"`
}
type PartySaveInput struct {
	PartyID          string    `json:"partyId"`
	ApprovalEntryID  string    `json:"approvalEntryId"`
	ApprovalRevision int64     `json:"approvalRevision"`
	Data             PartyData `json:"data"`
}
type PartyGetInput struct {
	PartyID         string `json:"partyId"`
	ApprovalEntryID string `json:"approvalEntryId,omitempty"`
}
type PartyHistoryInput struct {
	PartyID  string `json:"partyId"`
	Page     int    `json:"page"`
	PageSize int    `json:"pageSize"`
}
type PartyVersionView struct {
	Approval approval.VersionMeta `json:"approval"`
	Data     PartyData            `json:"data"`
}
type PartyView struct {
	PartyID             string                            `json:"partyId"`
	Entity              string                            `json:"entity"`
	Approval            approval.VersionMeta              `json:"approval"`
	Data                PartyData                         `json:"data"`
	ImpactRelationships []bobdomain.PartyRelationshipCard `json:"impactRelationships"`
	UpdatedAt           time.Time                         `json:"updatedAt"`
}
type PartyListItem struct {
	PartyID        string            `json:"partyId"`
	Entity         string            `json:"entity"`
	LatestApproved *PartyVersionView `json:"latestApproved"`
	OpenVersion    *PartyVersionView `json:"openVersion"`
	UpdatedAt      time.Time         `json:"updatedAt"`
}
type PartyVersionInput struct {
	PartyID          string `json:"partyId"`
	ApprovalEntryID  string `json:"approvalEntryId"`
	ApprovalRevision int64  `json:"approvalRevision"`
}
type PartyReviewInput struct {
	PartyID          string `json:"partyId"`
	ApprovalEntryID  string `json:"approvalEntryId"`
	ApprovalRevision int64  `json:"approvalRevision"`
	Reason           string `json:"reason"`
}

// ProductInput is the complete, mutable product declaration. Snapshot fields
// are resolved by the service and are deliberately absent from the wire input.
type ProductInput struct {
	Name                 string                            `json:"name"`
	CategoryID           string                            `json:"categoryId"`
	Specification        string                            `json:"specification"`
	Model                string                            `json:"model"`
	Barcode              string                            `json:"barcode"`
	Remark               string                            `json:"remark"`
	ProductTypeID        string                            `json:"productTypeId"`
	DefaultInputUnitID   string                            `json:"defaultInputUnitId"`
	PricingUnitID        string                            `json:"pricingUnitId"`
	UnitConversions      []bobdomain.ProductUnitConversion `json:"unitConversions"`
	Returnable           bool                              `json:"returnable"`
	DefaultPackagingSpec string                            `json:"defaultPackagingSpec"`
	Formula              *bobdomain.ProductFormula         `json:"formula"`
}

// ProductData is the DCL read snapshot. Keep it product-only: BOB owns the
// stable identity/current projection, while DCL exposes no unrelated BOB
// DetailView fields such as bulkLiquidCapable.
type ProductData struct {
	Name                            string                            `json:"name"`
	CategoryID                      string                            `json:"categoryId"`
	CategoryApprovalEntryID         string                            `json:"categoryApprovalEntryId"`
	CategoryCode                    string                            `json:"categoryCode"`
	CategoryName                    string                            `json:"categoryName"`
	Specification                   string                            `json:"specification"`
	Model                           string                            `json:"model"`
	Barcode                         string                            `json:"barcode"`
	Remark                          string                            `json:"remark"`
	ProductTypeID                   string                            `json:"productTypeId"`
	ProductTypeApprovalEntryID      string                            `json:"productTypeApprovalEntryId"`
	ProductTypeCode                 string                            `json:"productTypeCode"`
	ProductTypeName                 string                            `json:"productTypeName"`
	BehaviorProfile                 string                            `json:"behaviorProfile"`
	DefaultInputUnitID              string                            `json:"defaultInputUnitId"`
	DefaultInputUnitApprovalEntryID string                            `json:"defaultInputUnitApprovalEntryId"`
	PricingUnitID                   string                            `json:"pricingUnitId"`
	PricingUnitApprovalEntryID      string                            `json:"pricingUnitApprovalEntryId"`
	UnitConversions                 []bobdomain.ProductUnitConversion `json:"unitConversions"`
	Returnable                      bool                              `json:"returnable"`
	DefaultPackagingSpec            string                            `json:"defaultPackagingSpec"`
	Formula                         *bobdomain.ProductFormula         `json:"formula"`
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
	ObjectID       string               `json:"objectId"`
	Entity         string               `json:"entity"`
	Code           string               `json:"code"`
	ObjectRevision int64                `json:"objectRevision"`
	Enabled        bool                 `json:"enabled"`
	Approval       approval.VersionMeta `json:"approval"`
	Data           ProductData          `json:"data"`
	UpdatedAt      time.Time            `json:"updatedAt"`
}
type ProductVersionView struct {
	Approval approval.VersionMeta `json:"approval"`
	Data     ProductData          `json:"data"`
	Enabled  bool                 `json:"enabled"`
}
type ProductQueryItem struct {
	ObjectID       string              `json:"objectId"`
	Entity         string              `json:"entity"`
	Code           string              `json:"code"`
	ObjectRevision int64               `json:"objectRevision"`
	Enabled        bool                `json:"enabled"`
	LatestApproved *ProductVersionView `json:"latestApproved"`
	OpenVersion    *ProductVersionView `json:"openVersion"`
	UpdatedAt      time.Time           `json:"updatedAt"`
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
	ObjectID       string               `json:"objectId"`
	Entity         string               `json:"entity"`
	Code           string               `json:"code"`
	ObjectRevision int64                `json:"objectRevision"`
	Enabled        bool                 `json:"enabled"`
	Approval       approval.VersionMeta `json:"approval"`
	Data           FundAccountData      `json:"data"`
	UpdatedAt      time.Time            `json:"updatedAt"`
}
type FundAccountVersionView struct {
	Approval approval.VersionMeta `json:"approval"`
	Data     FundAccountData      `json:"data"`
	Enabled  bool                 `json:"enabled"`
}
type FundAccountQueryItem struct {
	ObjectID       string                  `json:"objectId"`
	Entity         string                  `json:"entity"`
	Code           string                  `json:"code"`
	ObjectRevision int64                   `json:"objectRevision"`
	Enabled        bool                    `json:"enabled"`
	LatestApproved *FundAccountVersionView `json:"latestApproved"`
	OpenVersion    *FundAccountVersionView `json:"openVersion"`
	UpdatedAt      time.Time               `json:"updatedAt"`
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
	ObjectID       string               `json:"objectId"`
	Entity         string               `json:"entity"`
	Code           string               `json:"code"`
	ObjectRevision int64                `json:"objectRevision"`
	Enabled        bool                 `json:"enabled"`
	Approval       approval.VersionMeta `json:"approval"`
	Data           VehicleData          `json:"data"`
	UpdatedAt      time.Time            `json:"updatedAt"`
}
type VehicleVersionView struct {
	Approval approval.VersionMeta `json:"approval"`
	Data     VehicleData          `json:"data"`
	Enabled  bool                 `json:"enabled"`
}
type VehicleQueryItem struct {
	ObjectID       string              `json:"objectId"`
	Entity         string              `json:"entity"`
	Code           string              `json:"code"`
	ObjectRevision int64               `json:"objectRevision"`
	Enabled        bool                `json:"enabled"`
	LatestApproved *VehicleVersionView `json:"latestApproved"`
	OpenVersion    *VehicleVersionView `json:"openVersion"`
	UpdatedAt      time.Time           `json:"updatedAt"`
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
	ObjectID       string               `json:"objectId"`
	ObjectRevision int64                `json:"objectRevision"`
	Enabled        bool                 `json:"enabled"`
	Approval       approval.VersionMeta `json:"approval"`
}
type WarehouseView struct {
	ObjectID       string               `json:"objectId"`
	Entity         string               `json:"entity"`
	Code           string               `json:"code"`
	ObjectRevision int64                `json:"objectRevision"`
	Enabled        bool                 `json:"enabled"`
	Approval       approval.VersionMeta `json:"approval"`
	Data           WarehouseData        `json:"data"`
	UpdatedAt      time.Time            `json:"updatedAt"`
}
type WarehouseVersionView struct {
	Approval approval.VersionMeta `json:"approval"`
	Data     WarehouseData        `json:"data"`
	Enabled  bool                 `json:"enabled"`
}
type WarehouseQueryItem struct {
	ObjectID       string                `json:"objectId"`
	Entity         string                `json:"entity"`
	Code           string                `json:"code"`
	ObjectRevision int64                 `json:"objectRevision"`
	Enabled        bool                  `json:"enabled"`
	LatestApproved *WarehouseVersionView `json:"latestApproved"`
	OpenVersion    *WarehouseVersionView `json:"openVersion"`
	UpdatedAt      time.Time             `json:"updatedAt"`
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
	ObjectID       string               `json:"objectId"`
	ObjectRevision int64                `json:"objectRevision"`
	Enabled        bool                 `json:"enabled"`
	Approval       approval.VersionMeta `json:"approval"`
}

type OperatingEntityView struct {
	ObjectID       string               `json:"objectId"`
	Entity         string               `json:"entity"`
	Code           string               `json:"code"`
	ObjectRevision int64                `json:"objectRevision"`
	Enabled        bool                 `json:"enabled"`
	Approval       approval.VersionMeta `json:"approval"`
	Data           OperatingEntityData  `json:"data"`
	UpdatedAt      time.Time            `json:"updatedAt"`
}

type OperatingEntityVersionView struct {
	Approval approval.VersionMeta `json:"approval"`
	Data     OperatingEntityData  `json:"data"`
	Enabled  bool                 `json:"enabled"`
}

type OperatingEntityQueryItem struct {
	ObjectID       string                      `json:"objectId"`
	Entity         string                      `json:"entity"`
	Code           string                      `json:"code"`
	ObjectRevision int64                       `json:"objectRevision"`
	Enabled        bool                        `json:"enabled"`
	LatestApproved *OperatingEntityVersionView `json:"latestApproved"`
	OpenVersion    *OperatingEntityVersionView `json:"openVersion"`
	UpdatedAt      time.Time                   `json:"updatedAt"`
}

type Page[T any] struct {
	Items    []T   `json:"items"`
	Total    int64 `json:"total"`
	Page     int   `json:"page"`
	PageSize int   `json:"pageSize"`
}

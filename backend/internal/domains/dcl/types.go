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
)

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

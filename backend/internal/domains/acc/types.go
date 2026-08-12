package acc

type CreateBookInput struct {
	Name            string
	Description     string
	StartMonth      string
	BaseCurrency    string
	SubjectTemplate string
	QueryUserIDs    []string
	OperateUserIDs  []string
}

type SaveBookInput struct {
	BookID         string
	Name           string
	Description    string
	BaseCurrency   string
	Revision       int64
	QueryUserIDs   []string
	OperateUserIDs []string
}

type QueryBooksInput struct {
	Page     int
	PageSize int
	Keyword  string
}

type BookView struct {
	ID              string   `json:"bookId"`
	Code            string   `json:"code"`
	Name            string   `json:"name"`
	Description     string   `json:"description"`
	StartMonth      string   `json:"startMonth"`
	BaseCurrency    string   `json:"baseCurrency"`
	SubjectTemplate string   `json:"subjectTemplate"`
	ControlBook     bool     `json:"controlBook"`
	Revision        int64    `json:"revision"`
	QueryUserIDs    []string `json:"queryUserIds"`
	OperateUserIDs  []string `json:"operateUserIds"`
}

const (
	SubjectTemplateEnterprise    = "ENTERPRISE"
	SubjectTemplateSmallBusiness = "SMALL_BUSINESS"
	SubjectTemplateEmpty         = "EMPTY"

	BalanceDirectionDebit  = "DEBIT"
	BalanceDirectionCredit = "CREDIT"

	DimensionCustomer    = "CUSTOMER"
	DimensionSupplier    = "SUPPLIER"
	DimensionOtherParty  = "OTHER_PARTY"
	DimensionEmployee    = "EMPLOYEE"
	DimensionDepartment  = "DEPARTMENT"
	DimensionProduct     = "PRODUCT"
	DimensionWarehouse   = "WAREHOUSE"
	DimensionFundAccount = "FUND_ACCOUNT"
	DimensionAsset       = "ASSET"
	DimensionBill        = "BILL"

	SettlementPurposeNone           = "NONE"
	SettlementPurposeReceivable     = "RECEIVABLE"
	SettlementPurposePrepaid        = "PREPAID"
	SettlementPurposePayable        = "PAYABLE"
	SettlementPurposeAdvanceReceipt = "ADVANCE_RECEIPT"
	SettlementPurposeOther          = "OTHER"
)

type QuerySubjectsInput struct {
	BookID   string
	Page     int
	PageSize int
	Keyword  string
}

type CreateSubjectInput struct {
	BookID             string
	Code               string
	Name               string
	ParentSubjectID    *string
	BalanceDirection   string
	Enabled            bool
	RequiredDimensions []string
	InventoryQuantity  bool
	SettlementPurpose  string
}

type SaveSubjectInput struct {
	CreateSubjectInput
	SubjectID string
	Revision  int64
}

type SubjectView struct {
	ID                 string   `json:"subjectId"`
	BookID             string   `json:"bookId"`
	Code               string   `json:"code"`
	Name               string   `json:"name"`
	ParentSubjectID    *string  `json:"parentSubjectId"`
	BalanceDirection   string   `json:"balanceDirection"`
	Enabled            bool     `json:"enabled"`
	Leaf               bool     `json:"leaf"`
	RequiredDimensions []string `json:"requiredDimensions"`
	InventoryQuantity  bool     `json:"inventoryQuantity"`
	SettlementPurpose  string   `json:"settlementPurpose"`
	Referenced         bool     `json:"referenced"`
	Revision           int64    `json:"revision"`
}

type SubjectPage struct {
	Items    []SubjectView `json:"items"`
	Total    int64         `json:"total"`
	Page     int           `json:"page"`
	PageSize int           `json:"pageSize"`
}

type BookPage struct {
	Items    []BookView `json:"items"`
	Total    int64      `json:"total"`
	Page     int        `json:"page"`
	PageSize int        `json:"pageSize"`
}

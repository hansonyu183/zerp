package rpt

type ParameterType string

const (
	ParameterTypeText      ParameterType = "TEXT"
	ParameterTypeInteger   ParameterType = "INTEGER"
	ParameterTypeDecimal   ParameterType = "DECIMAL"
	ParameterTypeBoolean   ParameterType = "BOOLEAN"
	ParameterTypeDate      ParameterType = "DATE"
	ParameterTypeDateRange ParameterType = "DATE_RANGE"
	ParameterTypeEnum      ParameterType = "ENUM"
	ParameterTypeReference ParameterType = "REFERENCE"
)

type ReferenceType string

const (
	ReferenceTypeAccountingBook         ReferenceType = "ACCOUNTING_BOOK"
	ReferenceTypeAccountSubject         ReferenceType = "ACCOUNT_SUBJECT"
	ReferenceTypeCustomerAccount        ReferenceType = "CUSTOMER_ACCOUNT"
	ReferenceTypeSupplierRelationship   ReferenceType = "SUPPLIER_RELATIONSHIP"
	ReferenceTypeServiceRelationship    ReferenceType = "SERVICE_RELATIONSHIP"
	ReferenceTypeEmploymentRelationship ReferenceType = "EMPLOYMENT_RELATIONSHIP"
	ReferenceTypeSalesRelationship      ReferenceType = "SALES_RELATIONSHIP"
	ReferenceTypeDepartment             ReferenceType = "DEPARTMENT"
	ReferenceTypeProduct                ReferenceType = "PRODUCT"
	ReferenceTypeWarehouse              ReferenceType = "WAREHOUSE"
	ReferenceTypeFundAccount            ReferenceType = "FUND_ACCOUNT"
	ReferenceTypeAsset                  ReferenceType = "ASSET"
	ReferenceTypeBill                   ReferenceType = "BILL"
)

type ResultType string

const (
	ResultTypeText     ResultType = "TEXT"
	ResultTypeInteger  ResultType = "INTEGER"
	ResultTypeDecimal  ResultType = "DECIMAL"
	ResultTypeBoolean  ResultType = "BOOLEAN"
	ResultTypeDate     ResultType = "DATE"
	ResultTypeDateTime ResultType = "DATETIME"
	ResultTypeID       ResultType = "ID"
)

type Parameter struct {
	DefaultValue  any            `json:"defaultValue,omitempty"`
	EnumValues    *[]string      `json:"enumValues,omitempty"`
	Key           string         `json:"key"`
	Name          string         `json:"name"`
	ReferenceType *ReferenceType `json:"referenceType,omitempty"`
	Required      bool           `json:"required"`
	Type          ParameterType  `json:"type"`
}

type ResultColumn struct {
	Alias           string     `json:"alias"`
	DrilldownEntity *string    `json:"drilldownEntity,omitempty"`
	Format          *string    `json:"format,omitempty"`
	Name            string     `json:"name"`
	Order           int        `json:"order"`
	Type            ResultType `json:"type"`
	Visible         bool       `json:"visible"`
	Width           int        `json:"width"`
}

type VersionData struct {
	Columns    []ResultColumn `json:"columns"`
	Parameters []Parameter    `json:"parameters"`
	SQL        string         `json:"sql"`
}

type DefinitionCreateInput struct {
	Code        string
	Name        string
	Description *string
	Data        VersionData
}

type DefinitionQueryInput struct {
	IncludeDisabled bool
	Keyword         string
	Page            int
	PageSize        int
}

type DirectoryQueryInput struct {
	Page     int
	PageSize int
}

type DefinitionGetInput struct {
	Code      string
	VersionID string
}

type VersionCreateInput struct {
	Code string
	Data VersionData
}

type VersionSaveInput struct {
	Code        string
	VersionID   string
	Revision    int64
	Name        *string
	Description *string
	Data        VersionData
}

type VersionRevisionInput struct {
	Code                 string
	VersionID            string
	Revision             int64
	ValidationParameters map[string]any
}

type DefinitionRevisionInput struct {
	Code     string
	Revision int64
}

type ExecuteInput struct {
	Parameters map[string]any
	Page       *int
	PageSize   *int
}

type ReferenceQueryInput struct {
	ParameterKey string
	Keyword      string
	SelectedID   string
	Page         *int
	PageSize     *int
}

type Page struct {
	Items    any   `json:"items"`
	Total    int64 `json:"total"`
	Page     int   `json:"page"`
	PageSize int   `json:"pageSize"`
}

type DefinitionView struct {
	DefinitionID     string      `json:"definitionId"`
	Code             string      `json:"code"`
	Name             string      `json:"name"`
	Description      string      `json:"description"`
	Enabled          bool        `json:"enabled"`
	EverApproved     bool        `json:"everApproved"`
	CurrentVersionID string      `json:"currentVersionId,omitempty"`
	Revision         int64       `json:"revision"`
	VersionID        string      `json:"versionId,omitempty"`
	VersionNo        int32       `json:"versionNo,omitempty"`
	Status           string      `json:"status,omitempty"`
	Validity         string      `json:"validity,omitempty"`
	VersionRevision  int64       `json:"versionRevision,omitempty"`
	Data             VersionData `json:"data"`
}

type ReportMetadata struct {
	Code        string         `json:"code"`
	Name        string         `json:"name"`
	Description string         `json:"description"`
	Parameters  []Parameter    `json:"parameters"`
	Columns     []ResultColumn `json:"columns"`
	CanQuery    bool           `json:"canQuery"`
	CanExport   bool           `json:"canExport"`
}

type MutationResult struct {
	ID       string `json:"id"`
	Status   string `json:"status,omitempty"`
	Revision int64  `json:"revision"`
}

type QueryResult struct {
	Columns  []ResultColumn   `json:"columns"`
	Items    []map[string]any `json:"items"`
	Total    int64            `json:"total"`
	Page     int              `json:"page"`
	PageSize int              `json:"pageSize"`
}

type ReferenceItem struct {
	ID   string `json:"id"`
	Code string `json:"code"`
	Name string `json:"name"`
}

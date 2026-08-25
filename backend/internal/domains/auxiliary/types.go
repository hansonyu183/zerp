package aux

import (
	"bytes"
	"encoding/json"
	"io"
	"time"

	"github.com/hansonyu183/zerp/backend/internal/platform/approval"
)

const (
	EntityProductCategory  = "product-category"
	EntityProductType      = "product-type"
	EntityDepartment       = "department"
	EntityPosition         = "position"
	EntitySettlementMethod = "settlement-method"
	EntityPaymentMethod    = "payment-method"
	EntityDictionaryType   = "dictionary-type"
	EntityDictionaryItem   = "dictionary-item"
	EntityMeasurementUnit  = "measurement-unit"
	EntityIncomeExpense    = "income-expense-type"
	EntityAssetCategory    = "asset-category"
)

var entities = [...]string{
	EntityProductCategory,
	EntityProductType,
	EntityDepartment,
	EntityPosition,
	EntitySettlementMethod,
	EntityPaymentMethod,
	EntityDictionaryType,
	EntityDictionaryItem,
	EntityMeasurementUnit,
	EntityIncomeExpense,
	EntityAssetCategory,
}

type ProductBehaviorProfile string

const (
	ProductBehaviorRawMaterial      ProductBehaviorProfile = "RAW_MATERIAL"
	ProductBehaviorStandardFinished ProductBehaviorProfile = "STANDARD_FINISHED"
	ProductBehaviorCustomFinished   ProductBehaviorProfile = "CUSTOM_FINISHED"
	ProductBehaviorPackaging        ProductBehaviorProfile = "PACKAGING"
)

var productBehaviorProfiles = map[ProductBehaviorProfile]struct{}{
	ProductBehaviorRawMaterial:      {},
	ProductBehaviorStandardFinished: {},
	ProductBehaviorCustomFinished:   {},
	ProductBehaviorPackaging:        {},
}

type ErrorKind int

const (
	ErrorValidation ErrorKind = iota + 1
	ErrorConflict
	ErrorForbidden
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
	return &DomainError{Kind: kind, ErrorKey: defaultErrorKey(kind), Message: message, Data: data, Cause: cause}
}

func defaultErrorKey(kind ErrorKind) string {
	switch kind {
	case ErrorValidation:
		return "validation_failed"
	case ErrorConflict:
		return "conflict"
	case ErrorForbidden:
		return "forbidden"
	default:
		return "internal_error"
	}
}

type CreateData struct {
	Data map[string]any
}

func (d *CreateData) UnmarshalJSON(raw []byte) error {
	var values map[string]any
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.UseNumber()
	if err := decoder.Decode(&values); err != nil {
		return err
	}
	d.Data = values
	return nil
}

func (d CreateData) MarshalJSON() ([]byte, error) {
	values := cloneData(d.Data)
	return json.Marshal(values)
}

type CreateInput struct {
	Data CreateData `json:"data"`
}

type SaveInput struct {
	ObjectID         string         `json:"objectId"`
	ApprovalEntryID  string         `json:"approvalEntryId"`
	ApprovalRevision int64          `json:"approvalRevision"`
	Data             map[string]any `json:"data"`
}

type ApprovalRevisionInput struct {
	ObjectID         string `json:"objectId"`
	ApprovalEntryID  string `json:"approvalEntryId"`
	ApprovalRevision int64  `json:"approvalRevision"`
}

type ReviewInput struct {
	ApprovalRevisionInput
	Reason *string `json:"reason"`
}

type ObjectRevisionInput struct {
	ObjectID       string `json:"objectId"`
	ObjectRevision int64  `json:"objectRevision"`
}

type GetInput struct {
	ObjectID        string `json:"objectId"`
	ApprovalEntryID string `json:"approvalEntryId,omitempty"`
}

type DeleteInput = ApprovalRevisionInput

type QueryFilters struct {
	Keyword            string            `json:"keyword,omitempty"`
	Enabled            *bool             `json:"enabled,omitempty"`
	BehaviorProfile    string            `json:"behaviorProfile,omitempty"`
	ParentID           string            `json:"parentId,omitempty"`
	RootOnly           bool              `json:"rootOnly,omitempty"`
	DictionaryTypeCode string            `json:"dictionaryTypeCode,omitempty"`
	Direction          string            `json:"direction,omitempty"`
	Status             []approval.Status `json:"status,omitempty"`
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

func (input *QueryInput) UnmarshalJSON(raw []byte) error {
	type alias QueryInput
	var decoded alias
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&decoded); err != nil {
		return err
	}
	if err := decoder.Decode(&struct{}{}); err != io.EOF {
		if err == nil {
			return &json.SyntaxError{}
		}
		return err
	}
	*input = QueryInput(decoded)
	return nil
}

type HistoryInput struct {
	ObjectID string `json:"objectId"`
	Page     int    `json:"page"`
	PageSize int    `json:"pageSize"`
}

type VersionView struct {
	Approval approval.VersionMeta `json:"approval"`
	Data     map[string]any       `json:"data"`
}

type ObjectView struct {
	ObjectID       string       `json:"objectId"`
	Entity         string       `json:"entity"`
	Code           string       `json:"code"`
	Enabled        bool         `json:"enabled"`
	ObjectRevision int64        `json:"objectRevision"`
	LatestApproved *VersionView `json:"latestApproved"`
	OpenVersion    *VersionView `json:"openVersion"`
	UpdatedAt      time.Time    `json:"updatedAt"`
	UpdatedBy      string       `json:"updatedBy"`
}

type QueryItem = ObjectView

type MutationResult struct {
	ObjectID       string               `json:"objectId"`
	ObjectRevision int64                `json:"objectRevision"`
	Enabled        bool                 `json:"enabled"`
	Approval       approval.VersionMeta `json:"approval"`
}

type AuditEventView = approval.EventView

type Page[T any] struct {
	Items    []T   `json:"items"`
	Total    int64 `json:"total"`
	Page     int   `json:"page"`
	PageSize int   `json:"pageSize"`
}

type Reference struct {
	ObjectID        string
	ApprovalEntryID string
	Entity          string
	Code            string
	Data            map[string]any
}

type ReferenceQueryInput struct {
	Entity             string `json:"entity"`
	Keyword            string `json:"keyword"`
	DictionaryTypeCode string `json:"dictionaryTypeCode"`
}

type ReferenceCandidate struct {
	ObjectID        string `json:"objectId"`
	ApprovalEntryID string `json:"approvalEntryId"`
	Code            string `json:"code"`
	Name            string `json:"name"`
}

func cloneData(source map[string]any) map[string]any {
	result := make(map[string]any, len(source)+1)
	for key, value := range source {
		result[key] = value
	}
	return result
}

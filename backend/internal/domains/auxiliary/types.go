package aux

import (
	"bytes"
	"encoding/json"
	"io"
	"time"
)

const (
	EntityProductCategory  = "product-category"
	EntityDepartment       = "department"
	EntityPosition         = "position"
	EntitySettlementMethod = "settlement-method"
	EntityDictionaryType   = "dictionary-type"
	EntityDictionaryItem   = "dictionary-item"
	EntityMeasurementUnit  = "measurement-unit"
	EntityIncomeExpense    = "income-expense-type"
	EntityAccountSubject   = "account-subject"
	EntityAssetCategory    = "asset-category"
)

var entities = [...]string{
	EntityProductCategory,
	EntityDepartment,
	EntityPosition,
	EntityDictionaryType,
	EntityDictionaryItem,
	EntityMeasurementUnit,
	EntityIncomeExpense,
	EntityAccountSubject,
	EntityAssetCategory,
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
	ObjectID string         `json:"objectId"`
	Revision int64          `json:"revision"`
	Data     map[string]any `json:"data"`
}

type RevisionInput struct {
	ObjectID string `json:"objectId"`
	Revision int64  `json:"revision"`
}

type GetInput struct {
	ObjectID  string `json:"objectId"`
	VersionID string `json:"versionId,omitempty"`
}

type DeleteInput = RevisionInput

type QueryFilters struct {
	Keyword            string `json:"keyword,omitempty"`
	Enabled            *bool  `json:"enabled,omitempty"`
	ParentID           string `json:"parentId,omitempty"`
	RootOnly           bool   `json:"rootOnly,omitempty"`
	DictionaryTypeCode string `json:"dictionaryTypeCode,omitempty"`
	Direction          string `json:"direction,omitempty"`
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
	VersionID string         `json:"versionId"`
	Version   int32          `json:"version"`
	Data      map[string]any `json:"data"`
	CreatedAt time.Time      `json:"createdAt"`
	CreatedBy string         `json:"createdBy"`
}

type ObjectView struct {
	ObjectID       string      `json:"objectId"`
	Entity         string      `json:"entity"`
	Code           string      `json:"code"`
	Enabled        bool        `json:"enabled"`
	ObjectRevision int64       `json:"objectRevision"`
	CurrentVersion VersionView `json:"currentVersion"`
	UpdatedAt      time.Time   `json:"updatedAt"`
	UpdatedBy      string      `json:"updatedBy"`
}

type QueryItem = ObjectView

type MutationResult struct {
	ObjectID       string `json:"objectId"`
	ObjectRevision int64  `json:"objectRevision"`
	VersionID      string `json:"versionId"`
	Version        int32  `json:"version"`
	Enabled        bool   `json:"enabled"`
}

type AuditEventView struct {
	ID         string         `json:"id"`
	EventType  string         `json:"eventType"`
	VersionID  string         `json:"versionId"`
	ActorID    string         `json:"actorId"`
	OccurredAt time.Time      `json:"occurredAt"`
	RequestID  string         `json:"requestId"`
	Summary    map[string]any `json:"summary"`
}

type Page[T any] struct {
	Items    []T   `json:"items"`
	Total    int64 `json:"total"`
	Page     int   `json:"page"`
	PageSize int   `json:"pageSize"`
}

type Reference struct {
	ObjectID  string
	VersionID string
	Entity    string
	Code      string
	Data      map[string]any
}

func cloneData(source map[string]any) map[string]any {
	result := make(map[string]any, len(source)+1)
	for key, value := range source {
		result[key] = value
	}
	return result
}

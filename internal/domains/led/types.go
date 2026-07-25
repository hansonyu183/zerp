package led

import (
	"encoding/json"
	"time"
)

const (
	StatusDraft     = "DRAFT"
	StatusActive    = "ACTIVE"
	StatusReopening = "REOPENING"

	EntityOpening   = "opening"
	EntityInventory = "inventory"
	EntityFund      = "fund"
	EntityParty     = "party"
	EntityContainer = "container"
)

type ReferenceInput struct {
	ObjectID  string `json:"objectId"`
	VersionID string `json:"versionId"`
}

type ReferenceView struct {
	ObjectID  string `json:"objectId"`
	VersionID string `json:"versionId"`
	Entity    string `json:"entity"`
	Code      string `json:"code"`
	Name      string `json:"name"`
	Unit      string `json:"unit,omitempty"`
	Currency  string `json:"currency,omitempty"`
}

type InventoryOpeningInput struct {
	Warehouse ReferenceInput `json:"warehouse"`
	Product   ReferenceInput `json:"product"`
	Quantity  string         `json:"quantity"`
}

type FundOpeningInput struct {
	FundAccount ReferenceInput `json:"fundAccount"`
	BalanceType string         `json:"balanceType"`
	Amount      string         `json:"amount"`
}

type PartyOpeningInput struct {
	CounterpartyType string         `json:"counterpartyType"`
	Counterparty     ReferenceInput `json:"counterparty"`
	Currency         string         `json:"currency"`
	BalanceType      string         `json:"balanceType"`
	Amount           string         `json:"amount"`
}

type ContainerOpeningInput struct {
	Customer      ReferenceInput `json:"customer"`
	ContainerType string         `json:"containerType"`
	Quantity      int64          `json:"quantity"`
}

type OpeningSaveInput struct {
	Revision    int64                   `json:"revision"`
	CutoverDate string                  `json:"cutoverDate"`
	Inventory   []InventoryOpeningInput `json:"inventory"`
	Fund        []FundOpeningInput      `json:"fund"`
	Party       []PartyOpeningInput     `json:"party"`
	Container   []ContainerOpeningInput `json:"container"`
}

type RevisionInput struct {
	Revision int64 `json:"revision"`
}

type ReopenInput struct {
	Revision int64  `json:"revision"`
	Reason   string `json:"reason"`
}

type InventoryOpeningView struct {
	ID        string        `json:"id"`
	Warehouse ReferenceView `json:"warehouse"`
	Product   ReferenceView `json:"product"`
	Quantity  string        `json:"quantity"`
}

type FundOpeningView struct {
	ID          string        `json:"id"`
	FundAccount ReferenceView `json:"fundAccount"`
	BalanceType string        `json:"balanceType"`
	Amount      string        `json:"amount"`
}

type PartyOpeningView struct {
	ID               string        `json:"id"`
	CounterpartyType string        `json:"counterpartyType"`
	Counterparty     ReferenceView `json:"counterparty"`
	Currency         string        `json:"currency"`
	BalanceType      string        `json:"balanceType"`
	Amount           string        `json:"amount"`
}

type ContainerOpeningView struct {
	ID            string        `json:"id"`
	Customer      ReferenceView `json:"customer"`
	ContainerType string        `json:"containerType"`
	Quantity      int64         `json:"quantity"`
}

type OpeningView struct {
	Status             string                 `json:"status"`
	Revision           int64                  `json:"revision"`
	CutoverDate        string                 `json:"cutoverDate,omitempty"`
	ActiveGenerationID string                 `json:"activeGenerationId,omitempty"`
	Inventory          []InventoryOpeningView `json:"inventory"`
	Fund               []FundOpeningView      `json:"fund"`
	Party              []PartyOpeningView     `json:"party"`
	Container          []ContainerOpeningView `json:"container"`
}

type MutationResult struct {
	Status       string `json:"status"`
	Revision     int64  `json:"revision"`
	GenerationID string `json:"generationId,omitempty"`
}

type QueryFilters struct {
	DateFrom     string   `json:"dateFrom"`
	DateTo       string   `json:"dateTo"`
	ObjectID     string   `json:"objectId,omitempty"`
	SourceEntity string   `json:"sourceEntity,omitempty"`
	DocumentNo   string   `json:"documentNo,omitempty"`
	Direction    []string `json:"direction,omitempty"`
}

type SortInput struct {
	Field string `json:"field"`
	Order string `json:"order"`
}

type QueryInput struct {
	Page     int          `json:"page"`
	PageSize int          `json:"pageSize"`
	Filters  QueryFilters `json:"filters"`
	Sort     []SortInput  `json:"sort"`
}

type BalanceFilters struct {
	AsOfDate string `json:"asOfDate"`
	ObjectID string `json:"objectId,omitempty"`
}

type BalanceInput struct {
	Page     int            `json:"page"`
	PageSize int            `json:"pageSize"`
	Filters  BalanceFilters `json:"filters"`
}

type Page[T any] struct {
	Items    []T   `json:"items"`
	Total    int64 `json:"total"`
	Page     int   `json:"page"`
	PageSize int   `json:"pageSize"`
}

type InventoryEntryView struct {
	ID               string        `json:"id"`
	EntryType        string        `json:"entryType"`
	SourceEntity     string        `json:"sourceEntity"`
	SourceDocumentID string        `json:"sourceDocumentId,omitempty"`
	SourceDocumentNo string        `json:"sourceDocumentNo,omitempty"`
	SourceLineID     string        `json:"sourceLineId,omitempty"`
	SourceRevision   int64         `json:"sourceRevision,omitempty"`
	EffectiveDate    string        `json:"effectiveDate"`
	OccurredAt       time.Time     `json:"occurredAt"`
	Direction        string        `json:"direction"`
	Quantity         string        `json:"quantity"`
	Warehouse        ReferenceView `json:"warehouse"`
	Product          ReferenceView `json:"product"`
	Reason           string        `json:"reason,omitempty"`
}

type FundEntryView struct {
	ID               string        `json:"id"`
	EntryType        string        `json:"entryType"`
	SourceEntity     string        `json:"sourceEntity"`
	SourceDocumentID string        `json:"sourceDocumentId,omitempty"`
	SourceDocumentNo string        `json:"sourceDocumentNo,omitempty"`
	SourceRevision   int64         `json:"sourceRevision,omitempty"`
	EffectiveDate    string        `json:"effectiveDate"`
	OccurredAt       time.Time     `json:"occurredAt"`
	Direction        string        `json:"direction"`
	Amount           string        `json:"amount"`
	FundAccount      ReferenceView `json:"fundAccount"`
	Currency         string        `json:"currency"`
	Reason           string        `json:"reason,omitempty"`
}

type PartyEntryView struct {
	ID               string        `json:"id"`
	EntryType        string        `json:"entryType"`
	SourceEntity     string        `json:"sourceEntity"`
	SourceDocumentID string        `json:"sourceDocumentId,omitempty"`
	SourceDocumentNo string        `json:"sourceDocumentNo,omitempty"`
	SourceRevision   int64         `json:"sourceRevision,omitempty"`
	EffectiveDate    string        `json:"effectiveDate"`
	OccurredAt       time.Time     `json:"occurredAt"`
	Direction        string        `json:"direction"`
	Amount           string        `json:"amount"`
	CounterpartyType string        `json:"counterpartyType"`
	Counterparty     ReferenceView `json:"counterparty"`
	Currency         string        `json:"currency"`
	Reason           string        `json:"reason,omitempty"`
}

type ContainerEntryView struct {
	ID               string        `json:"id"`
	EntryType        string        `json:"entryType"`
	SourceEntity     string        `json:"sourceEntity"`
	SourceDocumentID string        `json:"sourceDocumentId,omitempty"`
	SourceDocumentNo string        `json:"sourceDocumentNo,omitempty"`
	RootDocumentID   string        `json:"rootDocumentId,omitempty"`
	RootDocumentNo   string        `json:"rootDocumentNo,omitempty"`
	SourceRevision   int64         `json:"sourceRevision,omitempty"`
	EffectiveDate    string        `json:"effectiveDate"`
	OccurredAt       time.Time     `json:"occurredAt"`
	Customer         ReferenceView `json:"customer"`
	ContainerType    string        `json:"containerType"`
	Quantity         int64         `json:"quantity"`
	Reason           string        `json:"reason,omitempty"`
}

type InventoryBalanceView struct {
	Warehouse ReferenceView `json:"warehouse"`
	Product   ReferenceView `json:"product"`
	Quantity  string        `json:"quantity"`
}

type FundBalanceView struct {
	FundAccount ReferenceView `json:"fundAccount"`
	Currency    string        `json:"currency"`
	BalanceType string        `json:"balanceType"`
	Amount      string        `json:"amount"`
}

type PartyBalanceView struct {
	CounterpartyType string        `json:"counterpartyType"`
	Counterparty     ReferenceView `json:"counterparty"`
	Currency         string        `json:"currency"`
	BalanceType      string        `json:"balanceType"`
	Amount           string        `json:"amount"`
}

type ContainerBalanceView struct {
	Customer      ReferenceView `json:"customer"`
	ContainerType string        `json:"containerType"`
	Quantity      int64         `json:"quantity"`
}

type HistoryInput struct {
	Page     int `json:"page"`
	PageSize int `json:"pageSize"`
}

type AuditEventView struct {
	ID           string          `json:"id"`
	EventType    string          `json:"eventType"`
	FromStatus   string          `json:"fromStatus,omitempty"`
	ToStatus     string          `json:"toStatus"`
	GenerationID string          `json:"generationId,omitempty"`
	Revision     int64           `json:"revision"`
	ActorID      string          `json:"actorId"`
	OccurredAt   time.Time       `json:"occurredAt"`
	Reason       string          `json:"reason,omitempty"`
	RequestID    string          `json:"requestId"`
	Summary      json.RawMessage `json:"summary"`
}

package bob

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"time"

	dbsqlc "github.com/hansonyu183/zerp/backend/internal/database/sqlc"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

const (
	SalesAttributionInternalEmployee = "INTERNAL_EMPLOYEE"
	SalesAttributionExternalPartTime = "EXTERNAL_PART_TIME"
	SalesAttributionDealer           = "CHANNEL_PARTNER"
)

type CustomerAttachmentView struct {
	FileID           string     `json:"fileId"`
	FileName         string     `json:"fileName"`
	ContentType      string     `json:"contentType"`
	Size             int64      `json:"size"`
	SHA256           string     `json:"sha256"`
	Status           string     `json:"status"`
	StoredAt         *time.Time `json:"storedAt,omitempty"`
	CategoryObjectID string     `json:"categoryObjectId"`
	CategoryCode     string     `json:"categoryCode"`
	CategoryName     string     `json:"categoryName"`
	CreatedAt        time.Time  `json:"createdAt"`
	CreatedBy        string     `json:"createdBy"`
}

func nullableTime(value pgtype.Timestamptz) *time.Time {
	if !value.Valid {
		return nil
	}
	result := value.Time
	return &result
}

func hasSalesCapability(values []string, expected string) bool {
	for _, value := range values {
		if value == expected {
			return true
		}
	}
	return false
}

type CustomerCurrentQueryInput struct {
	Page     int                         `json:"page"`
	PageSize int                         `json:"pageSize"`
	Filters  CustomerCurrentQueryFilters `json:"filters"`
	Sort     []SortItem                  `json:"sort"`
}

type CustomerCurrentQueryFilters struct {
	Keyword                  string `json:"keyword,omitempty"`
	Enabled                  *bool  `json:"enabled,omitempty"`
	DefaultOperatingEntityID string `json:"defaultOperatingEntityId,omitempty"`
}

type CustomerCurrentListItem struct {
	ObjectID                   string    `json:"objectId"`
	Code                       string    `json:"code"`
	DisplayName                string    `json:"displayName"`
	DefaultOperatingEntityCode string    `json:"defaultOperatingEntityCode"`
	DefaultOperatingEntityName string    `json:"defaultOperatingEntityName"`
	Enabled                    bool      `json:"enabled"`
	SourceApprovalEntryID      string    `json:"sourceApprovalEntryId"`
	SourceVersionNo            int32     `json:"sourceVersionNo"`
	UpdatedAt                  time.Time `json:"updatedAt"`
}

type CustomerCurrentView struct {
	ObjectID              string                   `json:"objectId"`
	Code                  string                   `json:"code"`
	SourceApprovalEntryID string                   `json:"sourceApprovalEntryId"`
	SourceVersionNo       int32                    `json:"sourceVersionNo"`
	Data                  json.RawMessage          `json:"data"`
	Attachments           []CustomerAttachmentView `json:"attachments"`
	UpdatedAt             time.Time                `json:"updatedAt"`
}

func currentPage(page, pageSize int, sort []SortItem) (int32, error) {
	if page < 1 || pageSize != 20 || len(sort) > 1 || (len(sort) == 1 && (sort[0].Field != "code" || strings.ToLower(sort[0].Order) != "asc")) {
		return 0, domainError(ErrorValidation, "invalid current customer query", nil, nil)
	}
	return int32((page - 1) * pageSize), nil
}

func currentEnabled(enabled *bool) int32 {
	if enabled == nil {
		return -1
	}
	if *enabled {
		return 1
	}
	return 0
}

func (s *Service) CustomerCurrentQuery(ctx context.Context, in CustomerCurrentQueryInput) (Page[CustomerCurrentListItem], error) {
	offset, err := currentPage(in.Page, in.PageSize, in.Sort)
	if err != nil {
		return Page[CustomerCurrentListItem]{}, err
	}
	operatingEntityID := strings.TrimSpace(in.Filters.DefaultOperatingEntityID)
	if operatingEntityID != "" && !validID(operatingEntityID) {
		return Page[CustomerCurrentListItem]{}, domainError(ErrorValidation, "invalid current customer filters", nil, nil)
	}
	keyword := strings.TrimSpace(in.Filters.Keyword)
	filter := currentEnabled(in.Filters.Enabled)
	total, err := s.queries.CountBobCustomerCurrents(ctx, dbsqlc.CountBobCustomerCurrentsParams{Keyword: keyword, EnabledFilter: filter, OperatingEntityID: operatingEntityID})
	if err != nil {
		return Page[CustomerCurrentListItem]{}, s.internal("count current customers", err)
	}
	rows, err := s.queries.ListBobCustomerCurrents(ctx, dbsqlc.ListBobCustomerCurrentsParams{Keyword: keyword, EnabledFilter: filter, OperatingEntityID: operatingEntityID, RowOffset: offset, RowLimit: 20})
	if err != nil {
		return Page[CustomerCurrentListItem]{}, s.internal("list current customers", err)
	}
	items := make([]CustomerCurrentListItem, 0, len(rows))
	for _, row := range rows {
		code, codeErr := requiredSubjectCode(row.Code)
		if codeErr != nil {
			return Page[CustomerCurrentListItem]{}, codeErr
		}
		items = append(items, CustomerCurrentListItem{ObjectID: row.ObjectID, Code: code, DisplayName: row.DisplayName, DefaultOperatingEntityCode: row.OperatingEntityCode, DefaultOperatingEntityName: row.OperatingEntityName, Enabled: row.Enabled, SourceApprovalEntryID: row.SourceApprovalEntryID, SourceVersionNo: row.SourceVersionNo, UpdatedAt: row.UpdatedAt.Time})
	}
	return Page[CustomerCurrentListItem]{Items: items, Total: total, Page: in.Page, PageSize: in.PageSize}, nil
}

func attachmentView(row dbsqlc.ListDCLCustomerAttachmentsRow) CustomerAttachmentView {
	return CustomerAttachmentView{FileID: row.FileID, FileName: row.OriginalName, ContentType: row.ContentType, Size: row.DeclaredSize, SHA256: row.Sha256Hex, Status: row.Status, StoredAt: nullableTime(row.StoredAt), CategoryObjectID: row.CategoryObjectID, CategoryCode: row.CategoryCode, CategoryName: row.CategoryName, CreatedAt: row.CreatedAt.Time, CreatedBy: row.CreatedBy}
}

func hydrateCustomerDataAttachments(raw []byte, rows []dbsqlc.ListDCLCustomerAttachmentsRow) (json.RawMessage, []CustomerAttachmentView, error) {
	var data map[string]any
	if err := json.Unmarshal(raw, &data); err != nil {
		return nil, nil, err
	}
	bySubunit := make(map[string][]CustomerAttachmentView)
	customerAttachments := make([]CustomerAttachmentView, 0)
	for _, row := range rows {
		view := attachmentView(row)
		if row.SubunitID == nil {
			customerAttachments = append(customerAttachments, view)
		} else {
			bySubunit[*row.SubunitID] = append(bySubunit[*row.SubunitID], view)
		}
	}
	data["implicitSubunitId"] = nil
	if subunits, ok := data["subunits"].([]any); ok {
		enabledSubunitIDs := make([]string, 0, 1)
		for _, item := range subunits {
			subunit, ok := item.(map[string]any)
			if !ok {
				continue
			}
			subunitID, _ := subunit["subunitId"].(string)
			attachments := bySubunit[subunitID]
			if attachments == nil {
				attachments = []CustomerAttachmentView{}
			}
			subunit["attachments"] = attachments
			if enabled, _ := subunit["enabled"].(bool); enabled && subunitID != "" {
				enabledSubunitIDs = append(enabledSubunitIDs, subunitID)
			}
		}
		if customerEnabled, _ := data["enabled"].(bool); customerEnabled && len(enabledSubunitIDs) == 1 {
			data["implicitSubunitId"] = enabledSubunitIDs[0]
		}
	}
	encoded, err := json.Marshal(data)
	return encoded, customerAttachments, err
}

func (s *Service) CustomerCurrentGet(ctx context.Context, objectID string) (CustomerCurrentView, error) {
	if !validID(objectID) {
		return CustomerCurrentView{}, domainError(ErrorValidation, "invalid current customer get", nil, nil)
	}
	row, err := s.queries.GetBobCustomerCurrent(ctx, objectID)
	if errors.Is(err, pgx.ErrNoRows) {
		return CustomerCurrentView{}, domainError(ErrorConflict, "customer current effective data is unavailable", nil, nil)
	}
	if err != nil {
		return CustomerCurrentView{}, s.internal("get current customer", err)
	}
	attachmentRows, err := s.queries.ListDCLCustomerAttachments(ctx, row.SourceApprovalEntryID)
	if err != nil {
		return CustomerCurrentView{}, s.internal("list current customer attachments", err)
	}
	data, attachments, err := hydrateCustomerDataAttachments(row.Data, attachmentRows)
	if err != nil {
		return CustomerCurrentView{}, s.internal("hydrate current customer", err)
	}
	code, err := requiredSubjectCode(row.Code)
	if err != nil {
		return CustomerCurrentView{}, err
	}
	return CustomerCurrentView{ObjectID: row.ObjectID, Code: code, SourceApprovalEntryID: row.SourceApprovalEntryID, SourceVersionNo: row.SourceVersionNo, Data: data, Attachments: attachments, UpdatedAt: row.UpdatedAt.Time}, nil
}

func customerReferenceDetail(raw []byte) (DetailView, error) {
	var data map[string]any
	if err := json.Unmarshal(raw, &data); err != nil {
		return DetailView{}, err
	}
	name := mapString(data, "displayName")
	if name == "" {
		name = mapString(data, "legalName")
	}
	return DetailView{
		Name: name, LegalIdentifier: mapString(data, "legalIdentifier"), Address: mapString(data, "address"), Phone: mapString(data, "phone"),
	}, nil
}

func (s *Service) resolveCustomerCurrentReference(ctx context.Context, q *dbsqlc.Queries, objectID string) (EffectiveReference, error) {
	row, err := q.GetBobCustomerCurrentReference(ctx, objectID)
	if errors.Is(err, pgx.ErrNoRows) {
		return EffectiveReference{}, domainError(ErrorConflict, "customer current effective data is unavailable", nil, nil)
	}
	if err != nil {
		return EffectiveReference{}, s.internal("get current customer reference", err)
	}
	detail, err := customerReferenceDetail(row.Data)
	if err != nil {
		return EffectiveReference{}, s.internal("decode current customer reference", err)
	}
	code, err := requiredSubjectCode(row.Code)
	if err != nil {
		return EffectiveReference{}, err
	}
	return EffectiveReference{ObjectID: row.ObjectID, Entity: EntityCustomer, Code: code, ApprovalEntryID: row.ApprovalEntryID, VersionNo: versionNumber(row.VersionNo), Data: detail}, nil
}

func (s *Service) validateCustomerSnapshotReference(ctx context.Context, q *dbsqlc.Queries, objectID, approvalEntryID string) (EffectiveReference, error) {
	row, err := q.GetBobCustomerHistoricalReference(ctx, dbsqlc.GetBobCustomerHistoricalReferenceParams{ApprovalEntryID: approvalEntryID, ObjectID: objectID})
	if errors.Is(err, pgx.ErrNoRows) {
		return EffectiveReference{}, domainError(ErrorConflict, "customer approval snapshot is unavailable", nil, nil)
	}
	if err != nil {
		return EffectiveReference{}, s.internal("get historical customer reference", err)
	}
	detail, err := customerReferenceDetail(row.Data)
	if err != nil {
		return EffectiveReference{}, s.internal("decode historical customer reference", err)
	}
	code, err := requiredSubjectCode(row.Code)
	if err != nil {
		return EffectiveReference{}, err
	}
	return EffectiveReference{ObjectID: row.ObjectID, Entity: EntityCustomer, Code: code, ApprovalEntryID: row.ApprovalEntryID, VersionNo: versionNumber(row.VersionNo), Data: detail}, nil
}

func nestedMap(value map[string]any, key string) map[string]any {
	result, _ := value[key].(map[string]any)
	return result
}

func embeddedCustomerSubunitDetail(subunitData, customerData []byte) (DetailView, error) {
	var subunit, customer map[string]any
	if err := json.Unmarshal(subunitData, &subunit); err != nil {
		return DetailView{}, err
	}
	if err := json.Unmarshal(customerData, &customer); err != nil {
		return DetailView{}, err
	}
	settlement := nestedMap(subunit, "settlementMethod")
	operating := nestedMap(customer, "defaultOperatingEntity")
	return DetailView{
		Enabled: subunit["enabled"] == true, Name: mapString(subunit, "name"), ShortName: mapString(subunit, "shortName"),
		CustomerType: mapString(subunit, "customerTypeId"), ContactName: mapString(subunit, "contactName"), ContactPhone: mapString(subunit, "contactPhone"), Email: mapString(subunit, "email"), Address: mapString(subunit, "address"),
		OperatingEntityID: mapString(operating, "sourceObjectId"), OperatingEntityApprovalEntryID: mapString(operating, "approvalEntryId"), OperatingEntityCode: mapString(operating, "code"), OperatingEntityName: mapString(operating, "name"),
		SettlementMethodID: mapString(subunit, "settlementMethodId"), SettlementMethodCode: mapString(settlement, "code"), SettlementMethodName: mapString(settlement, "name"), TermCode: mapString(settlement, "termCode"), RuleType: mapString(settlement, "ruleType"), DueDays: int32(mapInt(settlement, "dueDays")), MonthOffset: int32(mapInt(settlement, "monthOffset")), CutoffDay: int32(mapInt(settlement, "cutoffDay")), DefaultSalesSurcharge: mapString(settlement, "defaultSalesSurcharge"),
	}, nil
}

func (s *Service) resolveCustomerSubunitCurrentReference(ctx context.Context, q *dbsqlc.Queries, objectID string) (EffectiveReference, error) {
	row, err := q.GetBobEmbeddedCustomerSubunitCurrentReference(ctx, objectID)
	if errors.Is(err, pgx.ErrNoRows) {
		return EffectiveReference{}, domainError(ErrorConflict, "customer subunit current effective data is unavailable", nil, nil)
	}
	if err != nil {
		return EffectiveReference{}, s.internal("get current customer subunit reference", err)
	}
	detail, err := embeddedCustomerSubunitDetail(row.Data, row.CustomerData)
	if err != nil {
		return EffectiveReference{}, s.internal("decode current customer subunit reference", err)
	}
	return EffectiveReference{ObjectID: row.ObjectID, CustomerID: row.CustomerID, Entity: EntityCustomerSubunit, Code: row.Code, ApprovalEntryID: row.ApprovalEntryID, VersionNo: versionNumber(row.VersionNo), Data: detail}, nil
}

func (s *Service) validateCustomerSubunitSnapshotReference(ctx context.Context, q *dbsqlc.Queries, objectID, approvalEntryID string) (EffectiveReference, error) {
	row, err := q.GetBobEmbeddedCustomerSubunitHistoricalReference(ctx, dbsqlc.GetBobEmbeddedCustomerSubunitHistoricalReferenceParams{ApprovalEntryID: approvalEntryID, ObjectID: objectID})
	if errors.Is(err, pgx.ErrNoRows) {
		return EffectiveReference{}, domainError(ErrorConflict, "customer subunit approval snapshot is unavailable", nil, nil)
	}
	if err != nil {
		return EffectiveReference{}, s.internal("get historical customer subunit reference", err)
	}
	detail, err := embeddedCustomerSubunitDetail(row.Data, row.CustomerData)
	if err != nil {
		return EffectiveReference{}, s.internal("decode historical customer subunit reference", err)
	}
	return EffectiveReference{ObjectID: row.ObjectID, CustomerID: row.CustomerID, Entity: EntityCustomerSubunit, Code: row.Code, ApprovalEntryID: row.ApprovalEntryID, VersionNo: versionNumber(row.VersionNo), Data: detail}, nil
}

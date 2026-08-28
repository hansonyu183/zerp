package bob

import (
	"context"
	"encoding/json"
	"errors"
	"slices"
	"strings"
	"time"

	dbsqlc "github.com/hansonyu183/zerp/backend/internal/database/sqlc"
	"github.com/hansonyu183/zerp/backend/internal/platform/fixeddecimal"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

const (
	SalesAttributionInternalEmployee = "INTERNAL_EMPLOYEE"
	SalesAttributionExternalPartTime = "EXTERNAL_PART_TIME"
	SalesAttributionDealer           = "CHANNEL_PARTNER"
)

// CustomerAttachmentView remains the read DTO shared by BOB current views.
// Ownership and mutation live exclusively in DCL.
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

// CustomerSnapshot and CustomerAccountData are read-only wire shapes shared
// with the DCL customer-account declaration.  BOB hydrates them only from an
// approved DCL current projection; it owns no customer payload or lifecycle.
type CustomerSnapshot struct {
	SourceObjectID        string `json:"sourceObjectId"`
	ApprovalEntryID       string `json:"approvalEntryId"`
	Code                  string `json:"code"`
	Name                  string `json:"name"`
	TermCode              string `json:"termCode,omitempty"`
	RuleType              string `json:"ruleType,omitempty"`
	DueDays               int32  `json:"dueDays,omitempty"`
	MonthOffset           int32  `json:"monthOffset,omitempty"`
	CutoffDay             int32  `json:"cutoffDay,omitempty"`
	DefaultSalesSurcharge string `json:"defaultSalesSurcharge,omitempty"`
	TaxNumber             string `json:"taxNumber,omitempty"`
	Address               string `json:"address,omitempty"`
	Phone                 string `json:"phone,omitempty"`
}
type CustomerAuxiliarySnapshot struct {
	SourceObjectID        string `json:"sourceObjectId"`
	Code                  string `json:"code"`
	Name                  string `json:"name"`
	TermCode              string `json:"termCode,omitempty"`
	RuleType              string `json:"ruleType,omitempty"`
	DueDays               int32  `json:"dueDays,omitempty"`
	MonthOffset           int32  `json:"monthOffset,omitempty"`
	CutoffDay             int32  `json:"cutoffDay,omitempty"`
	DefaultSalesSurcharge string `json:"defaultSalesSurcharge,omitempty"`
}

type CustomerSalesAttributionInput struct {
	Type            string `json:"type"`
	SubjectObjectID string `json:"subjectObjectId"`
}

type CustomerSalesAttributionView struct {
	CustomerSalesAttributionInput
	SubjectApprovalEntryID string `json:"subjectApprovalEntryId"`
	SubjectCode            string `json:"subjectCode"`
	SubjectName            string `json:"subjectName"`
}

type CustomerCreditLimit struct {
	Currency string `json:"currency"`
	Amount   string `json:"amount"`
}

type CustomerAccountData struct {
	Name                       string                        `json:"name"`
	ShortName                  string                        `json:"shortName,omitempty"`
	CustomerTypeID             string                        `json:"customerTypeId"`
	ContactName                string                        `json:"contactName,omitempty"`
	ContactPhone               string                        `json:"contactPhone,omitempty"`
	Email                      string                        `json:"email,omitempty"`
	Address                    string                        `json:"address,omitempty"`
	OperatingEntityID          string                        `json:"operatingEntityId"`
	SettlementMethodID         string                        `json:"settlementMethodId,omitempty"`
	PaymentMethodID            string                        `json:"paymentMethodId,omitempty"`
	DefaultTransportMethodCode string                        `json:"defaultTransportMethodCode,omitempty"`
	DefaultTransportMethodName string                        `json:"defaultTransportMethodName,omitempty"`
	TransportSurcharge         string                        `json:"transportSurcharge,omitempty"`
	PricingPolicy              PricingPolicy                 `json:"pricingPolicy"`
	CreditLimits               []CustomerCreditLimit         `json:"creditLimits"`
	PrimarySalesAttribution    CustomerSalesAttributionInput `json:"primarySalesAttribution"`
	InternalReminder           string                        `json:"internalReminder,omitempty"`
	DefaultSalesOrderRemark    string                        `json:"defaultSalesOrderRemark,omitempty"`
	OperatingEntity            *CustomerSnapshot             `json:"operatingEntity,omitempty"`
	SettlementMethod           *CustomerAuxiliarySnapshot    `json:"settlementMethod,omitempty"`
	PaymentMethod              *CustomerAuxiliarySnapshot    `json:"paymentMethod,omitempty"`
	SalesAttribution           CustomerSalesAttributionView  `json:"-"`
}

func (data CustomerAccountData) MarshalJSON() ([]byte, error) {
	type alias CustomerAccountData
	return json.Marshal(struct {
		alias
		PrimarySalesAttribution CustomerSalesAttributionView `json:"primarySalesAttribution"`
	}{alias: alias(data), PrimarySalesAttribution: data.SalesAttribution})
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

// CustomerCurrentQueryInput is deliberately separate from the generic BOB
// query shape: Customer relationship and account declarations are DCL-owned,
// and BOB exposes only their approved current projections.
type CustomerCurrentQueryInput struct {
	Page     int                         `json:"page"`
	PageSize int                         `json:"pageSize"`
	Filters  CustomerCurrentQueryFilters `json:"filters"`
	Sort     []SortItem                  `json:"sort"`
}

type CustomerCurrentQueryFilters struct {
	Keyword           string `json:"keyword,omitempty"`
	Enabled           *bool  `json:"enabled,omitempty"`
	OperatingEntityID string `json:"operatingEntityId,omitempty"`
	PartyID           string `json:"partyId,omitempty"`
}

type CustomerAccountCurrentQueryInput struct {
	Page     int                                `json:"page"`
	PageSize int                                `json:"pageSize"`
	Filters  CustomerAccountCurrentQueryFilters `json:"filters"`
	Sort     []SortItem                         `json:"sort"`
}

type CustomerAccountCurrentQueryFilters struct {
	Keyword                   string `json:"keyword,omitempty"`
	Enabled                   *bool  `json:"enabled,omitempty"`
	CustomerType              string `json:"customerType,omitempty"`
	CustomerRelationshipID    string `json:"customerRelationshipId,omitempty"`
	OperatingEntityID         string `json:"operatingEntityId,omitempty"`
	SalesAttributionType      string `json:"salesAttributionType,omitempty"`
	SalesAttributionSubjectID string `json:"salesAttributionSubjectId,omitempty"`
}

type CustomerCurrentListItem struct {
	ObjectID              string    `json:"objectId"`
	Code                  string    `json:"code"`
	PartyDisplayName      string    `json:"partyDisplayName"`
	OperatingEntityCode   string    `json:"operatingEntityCode"`
	OperatingEntityName   string    `json:"operatingEntityName"`
	Enabled               bool      `json:"enabled"`
	SourceApprovalEntryID string    `json:"sourceApprovalEntryId"`
	SourceVersionNo       int32     `json:"sourceVersionNo"`
	UpdatedAt             time.Time `json:"updatedAt"`
}

type CustomerCurrentView struct {
	ObjectID                       string    `json:"objectId"`
	Code                           string    `json:"code"`
	PartyID                        string    `json:"partyId"`
	PartyKind                      string    `json:"partyKind"`
	PartyDisplayName               string    `json:"partyDisplayName"`
	OperatingEntityID              string    `json:"operatingEntityId"`
	OperatingEntityApprovalEntryID string    `json:"operatingEntityApprovalEntryId"`
	OperatingEntityCode            string    `json:"operatingEntityCode"`
	OperatingEntityName            string    `json:"operatingEntityName"`
	Enabled                        bool      `json:"enabled"`
	SourceApprovalEntryID          string    `json:"sourceApprovalEntryId"`
	SourceVersionNo                int32     `json:"sourceVersionNo"`
	UpdatedAt                      time.Time `json:"updatedAt"`
}

type CustomerAccountCurrentListItem struct {
	ObjectID                 string    `json:"objectId"`
	Code                     string    `json:"code"`
	CustomerRelationshipID   string    `json:"customerRelationshipId"`
	CustomerRelationshipCode string    `json:"customerRelationshipCode"`
	Name                     string    `json:"name"`
	CustomerTypeID           string    `json:"customerTypeId"`
	OperatingEntityCode      string    `json:"operatingEntityCode"`
	Enabled                  bool      `json:"enabled"`
	SourceApprovalEntryID    string    `json:"sourceApprovalEntryId"`
	SourceVersionNo          int32     `json:"sourceVersionNo"`
	UpdatedAt                time.Time `json:"updatedAt"`
}

type CustomerAccountCurrentView struct {
	ObjectID                 string                   `json:"objectId"`
	Code                     string                   `json:"code"`
	CustomerRelationshipID   string                   `json:"customerRelationshipId"`
	CustomerRelationshipCode string                   `json:"customerRelationshipCode"`
	Enabled                  bool                     `json:"enabled"`
	SourceApprovalEntryID    string                   `json:"sourceApprovalEntryId"`
	SourceVersionNo          int32                    `json:"sourceVersionNo"`
	Data                     CustomerAccountData      `json:"data"`
	Attachments              []CustomerAttachmentView `json:"attachments"`
	UpdatedAt                time.Time                `json:"updatedAt"`
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
	if err != nil || (in.Filters.OperatingEntityID != "" && !validID(in.Filters.OperatingEntityID)) || (in.Filters.PartyID != "" && !validID(in.Filters.PartyID)) {
		if err != nil {
			return Page[CustomerCurrentListItem]{}, err
		}
		return Page[CustomerCurrentListItem]{}, domainError(ErrorValidation, "invalid current customer filters", nil, nil)
	}
	p := dbsqlc.ListBobCustomerCurrentsParams{Keyword: strings.TrimSpace(in.Filters.Keyword), EnabledFilter: currentEnabled(in.Filters.Enabled), OperatingEntityID: strings.TrimSpace(in.Filters.OperatingEntityID), PartyID: strings.TrimSpace(in.Filters.PartyID), RowOffset: offset, RowLimit: 20}
	total, err := s.queries.CountBobCustomerCurrents(ctx, dbsqlc.CountBobCustomerCurrentsParams{Keyword: p.Keyword, EnabledFilter: p.EnabledFilter, OperatingEntityID: p.OperatingEntityID, PartyID: p.PartyID})
	if err != nil {
		return Page[CustomerCurrentListItem]{}, s.internal("count current customers", err)
	}
	rows, err := s.queries.ListBobCustomerCurrents(ctx, p)
	if err != nil {
		return Page[CustomerCurrentListItem]{}, s.internal("list current customers", err)
	}
	items := make([]CustomerCurrentListItem, 0, len(rows))
	for _, row := range rows {
		items = append(items, CustomerCurrentListItem{ObjectID: row.ObjectID, Code: row.Code, PartyDisplayName: row.DisplayName, OperatingEntityCode: row.OperatingEntityCode, OperatingEntityName: row.OperatingEntityName, Enabled: row.Enabled, SourceApprovalEntryID: row.SourceApprovalEntryID, SourceVersionNo: row.SourceVersionNo, UpdatedAt: row.UpdatedAt.Time})
	}
	return Page[CustomerCurrentListItem]{Items: items, Total: total, Page: in.Page, PageSize: in.PageSize}, nil
}

func (s *Service) CustomerCurrentGet(ctx context.Context, objectID string) (CustomerCurrentView, error) {
	if !validID(objectID) {
		return CustomerCurrentView{}, domainError(ErrorValidation, "invalid current customer get", nil, nil)
	}
	row, err := s.queries.GetBobCustomerCurrent(ctx, objectID)
	if errors.Is(err, pgx.ErrNoRows) {
		return CustomerCurrentView{}, domainError(ErrorConflict, "customer current projection is unavailable", nil, nil)
	}
	if err != nil {
		return CustomerCurrentView{}, s.internal("get current customer", err)
	}
	return CustomerCurrentView{ObjectID: row.ObjectID, Code: row.Code, PartyID: row.PartyID, PartyKind: row.PartyKind, PartyDisplayName: row.DisplayName, OperatingEntityID: row.OperatingEntityID, OperatingEntityApprovalEntryID: row.OperatingEntityApprovalEntryID, OperatingEntityCode: row.OperatingEntityCode, OperatingEntityName: row.OperatingEntityName, Enabled: row.Enabled, SourceApprovalEntryID: row.SourceApprovalEntryID, SourceVersionNo: row.SourceVersionNo, UpdatedAt: row.UpdatedAt.Time}, nil
}

func (s *Service) CustomerAccountCurrentQuery(ctx context.Context, in CustomerAccountCurrentQueryInput) (Page[CustomerAccountCurrentListItem], error) {
	offset, err := currentPage(in.Page, in.PageSize, in.Sort)
	if err != nil || (in.Filters.CustomerRelationshipID != "" && !validID(in.Filters.CustomerRelationshipID)) || (in.Filters.OperatingEntityID != "" && !validID(in.Filters.OperatingEntityID)) || (in.Filters.SalesAttributionSubjectID != "" && !validID(in.Filters.SalesAttributionSubjectID)) || (in.Filters.SalesAttributionType != "" && !slices.Contains([]string{SalesAttributionInternalEmployee, SalesAttributionExternalPartTime, SalesAttributionDealer}, in.Filters.SalesAttributionType)) {
		if err != nil {
			return Page[CustomerAccountCurrentListItem]{}, err
		}
		return Page[CustomerAccountCurrentListItem]{}, domainError(ErrorValidation, "invalid current customer account filters", nil, nil)
	}
	p := dbsqlc.ListBobCustomerAccountCurrentsParams{Keyword: strings.TrimSpace(in.Filters.Keyword), EnabledFilter: currentEnabled(in.Filters.Enabled), CustomerRelationshipID: strings.TrimSpace(in.Filters.CustomerRelationshipID), OperatingEntityID: strings.TrimSpace(in.Filters.OperatingEntityID), CustomerType: strings.TrimSpace(in.Filters.CustomerType), SalesAttributionType: strings.TrimSpace(in.Filters.SalesAttributionType), SalesAttributionSubjectID: strings.TrimSpace(in.Filters.SalesAttributionSubjectID), RowOffset: offset, RowLimit: 20}
	total, err := s.queries.CountBobCustomerAccountCurrents(ctx, dbsqlc.CountBobCustomerAccountCurrentsParams{Keyword: p.Keyword, EnabledFilter: p.EnabledFilter, CustomerRelationshipID: p.CustomerRelationshipID, OperatingEntityID: p.OperatingEntityID, CustomerType: p.CustomerType, SalesAttributionType: p.SalesAttributionType, SalesAttributionSubjectID: p.SalesAttributionSubjectID})
	if err != nil {
		return Page[CustomerAccountCurrentListItem]{}, s.internal("count current customer accounts", err)
	}
	rows, err := s.queries.ListBobCustomerAccountCurrents(ctx, p)
	if err != nil {
		return Page[CustomerAccountCurrentListItem]{}, s.internal("list current customer accounts", err)
	}
	items := make([]CustomerAccountCurrentListItem, 0, len(rows))
	for _, row := range rows {
		items = append(items, CustomerAccountCurrentListItem{ObjectID: row.ObjectID, Code: row.Code, CustomerRelationshipID: row.CustomerRelationshipID, CustomerRelationshipCode: row.CustomerRelationshipCode, Name: row.Name, CustomerTypeID: row.CustomerType, OperatingEntityCode: row.OperatingEntityCode, Enabled: row.Enabled, SourceApprovalEntryID: row.SourceApprovalEntryID, SourceVersionNo: row.SourceVersionNo, UpdatedAt: row.UpdatedAt.Time})
	}
	return Page[CustomerAccountCurrentListItem]{Items: items, Total: total, Page: in.Page, PageSize: in.PageSize}, nil
}

func (s *Service) CustomerAccountCurrentGet(ctx context.Context, objectID string) (CustomerAccountCurrentView, error) {
	if !validID(objectID) {
		return CustomerAccountCurrentView{}, domainError(ErrorValidation, "invalid current customer account get", nil, nil)
	}
	current, err := s.queries.GetBobCustomerAccountCurrent(ctx, objectID)
	if errors.Is(err, pgx.ErrNoRows) {
		return CustomerAccountCurrentView{}, domainError(ErrorConflict, "customer account current projection is unavailable", nil, nil)
	}
	if err != nil {
		return CustomerAccountCurrentView{}, s.internal("get current customer account", err)
	}
	payload, err := s.queries.GetDCLCustomerAccountVersion(ctx, current.SourceApprovalEntryID)
	if err != nil {
		return CustomerAccountCurrentView{}, s.internal("get current customer account payload", err)
	}
	data, err := bobCustomerAccountData(payload, s.queries, ctx)
	if err != nil {
		return CustomerAccountCurrentView{}, err
	}
	attachments, err := bobDCLCustomerAccountAttachments(ctx, s.queries, current.SourceApprovalEntryID)
	if err != nil {
		return CustomerAccountCurrentView{}, err
	}
	return CustomerAccountCurrentView{ObjectID: current.ObjectID, Code: current.Code, CustomerRelationshipID: current.CustomerRelationshipID, CustomerRelationshipCode: current.CustomerRelationshipCode, Enabled: current.Enabled, SourceApprovalEntryID: current.SourceApprovalEntryID, SourceVersionNo: current.SourceVersionNo, Data: data, Attachments: attachments, UpdatedAt: current.UpdatedAt.Time}, nil
}

func bobCustomerAccountData(row dbsqlc.DclCustomerAccountVersion, q *dbsqlc.Queries, ctx context.Context) (CustomerAccountData, error) {
	var policy PricingPolicy
	if err := json.Unmarshal(row.PricingPolicy, &policy); err != nil {
		return CustomerAccountData{}, domainError(ErrorInternal, "invalid customer account pricing snapshot", nil, err)
	}
	credits, err := q.ListDCLCustomerAccountCreditLimits(ctx, row.ApprovalEntryID)
	if err != nil {
		return CustomerAccountData{}, err
	}
	data := CustomerAccountData{Name: row.Name, ShortName: stringValue(row.ShortName), CustomerTypeID: row.CustomerType, ContactName: stringValue(row.ContactName), ContactPhone: stringValue(row.ContactPhone), Email: stringValue(row.Email), Address: stringValue(row.Address), OperatingEntityID: row.OperatingEntityID, SettlementMethodID: stringValue(row.SettlementMethodID), PaymentMethodID: stringValue(row.PaymentMethodID), DefaultTransportMethodCode: stringValue(row.DefaultTransportMethodCode), DefaultTransportMethodName: stringValue(row.DefaultTransportMethodName), TransportSurcharge: fixeddecimal.Format(row.TransportSurchargeCents, 2, false), PricingPolicy: policy, InternalReminder: stringValue(row.InternalReminder), DefaultSalesOrderRemark: stringValue(row.DefaultSalesOrderRemark), OperatingEntity: &CustomerSnapshot{SourceObjectID: row.OperatingEntityID, ApprovalEntryID: row.OperatingEntityApprovalEntryID, Code: row.OperatingEntityCode, Name: row.OperatingEntityName, TaxNumber: stringValue(row.OperatingEntityTaxNumber), Address: stringValue(row.OperatingEntityAddress), Phone: stringValue(row.OperatingEntityPhone)}, SalesAttribution: CustomerSalesAttributionView{CustomerSalesAttributionInput: CustomerSalesAttributionInput{Type: stringValue(row.PrimarySalesAttributionType), SubjectObjectID: stringValue(row.PrimarySalesSubjectID)}, SubjectApprovalEntryID: stringValue(row.PrimarySalesSubjectApprovalEntryID), SubjectCode: stringValue(row.PrimarySalesSubjectCode), SubjectName: stringValue(row.PrimarySalesSubjectName)}}
	if data.SettlementMethodID != "" {
		data.SettlementMethod = &CustomerAuxiliarySnapshot{SourceObjectID: data.SettlementMethodID, Code: stringValue(row.SettlementMethodCode), Name: stringValue(row.SettlementMethodName), TermCode: stringValue(row.SettlementTermCode), RuleType: stringValue(row.SettlementRuleType), DueDays: row.SettlementDueDays, MonthOffset: row.SettlementMonthOffset, CutoffDay: row.SettlementCutoffDay, DefaultSalesSurcharge: fixeddecimal.Format(row.SettlementSalesSurchargeCents, 2, false)}
	}
	if data.PaymentMethodID != "" {
		data.PaymentMethod = &CustomerAuxiliarySnapshot{SourceObjectID: data.PaymentMethodID, Code: stringValue(row.PaymentMethodCode), Name: stringValue(row.PaymentMethodName), DefaultSalesSurcharge: fixeddecimal.Format(row.PaymentSalesSurchargeCents, 2, false)}
	}
	data.CreditLimits = make([]CustomerCreditLimit, 0, len(credits))
	for _, credit := range credits {
		data.CreditLimits = append(data.CreditLimits, CustomerCreditLimit{Currency: credit.Currency, Amount: fixeddecimal.Format(credit.AmountCents, 2, false)})
	}
	return data, nil
}

func bobDCLCustomerAccountAttachments(ctx context.Context, q *dbsqlc.Queries, entryID string) ([]CustomerAttachmentView, error) {
	rows, err := q.ListDCLCustomerAccountAttachments(ctx, entryID)
	if err != nil {
		return nil, err
	}
	items := make([]CustomerAttachmentView, 0, len(rows))
	for _, row := range rows {
		items = append(items, CustomerAttachmentView{FileID: row.FileID, FileName: row.OriginalName, ContentType: row.ContentType, Size: row.DeclaredSize, SHA256: row.Sha256Hex, Status: row.Status, StoredAt: nullableTime(row.StoredAt), CategoryObjectID: row.CategoryObjectID, CategoryCode: row.CategoryCode, CategoryName: row.CategoryName, CreatedAt: row.CreatedAt.Time, CreatedBy: row.CreatedBy})
	}
	return items, nil
}

// resolveCustomerAccountCurrentReference is the sole path for new commercial
// work. It reads the BOB current projection and its exact approved DCL entry.
func (s *Service) resolveCustomerAccountCurrentReference(ctx context.Context, q *dbsqlc.Queries, objectID string) (EffectiveReference, error) {
	row, err := q.GetBobCustomerAccountCurrentReference(ctx, objectID)
	if errors.Is(err, pgx.ErrNoRows) {
		return EffectiveReference{}, domainError(ErrorConflict, "customer account current projection is unavailable", nil, nil)
	}
	if err != nil {
		return EffectiveReference{}, s.internal("get current customer account reference", err)
	}
	return s.customerAccountEffectiveReference(ctx, q, row.ObjectID, row.Code, row.ApprovalEntryID)
}

// validateCustomerAccountSnapshotReference intentionally does not require the
// entry to remain current: executed sales documents retain the exact approved
// customer-account declaration they recorded.
func (s *Service) validateCustomerAccountSnapshotReference(ctx context.Context, q *dbsqlc.Queries, objectID, approvalEntryID string) (EffectiveReference, error) {
	entry, err := q.GetApprovalEntry(ctx, dbsqlc.GetApprovalEntryParams{ID: approvalEntryID, Domain: "dcl", Entity: EntityCustomerAccount})
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && (entry.SubjectID != objectID || entry.Status != "APPROVED")) {
		return EffectiveReference{}, domainError(ErrorConflict, "customer account approval snapshot is unavailable", nil, nil)
	}
	if err != nil {
		return EffectiveReference{}, s.internal("get customer account approval snapshot", err)
	}
	identity, err := q.GetBobCustomerAccountCurrent(ctx, objectID)
	if err != nil {
		// A historical entry can remain valid after the current projection fell
		// back, so use the stable BOB object for code rather than current rows.
		object, objectErr := q.GetBobObject(ctx, dbsqlc.GetBobObjectParams{ObjectID: objectID, Entity: EntityCustomerAccount})
		if objectErr != nil {
			return EffectiveReference{}, s.internal("get customer account identity", objectErr)
		}
		return s.customerAccountEffectiveReference(ctx, q, object.ID, object.Code, approvalEntryID)
	}
	return s.customerAccountEffectiveReference(ctx, q, identity.ObjectID, identity.Code, approvalEntryID)
}

func (s *Service) customerAccountEffectiveReference(ctx context.Context, q *dbsqlc.Queries, objectID, code, approvalEntryID string) (EffectiveReference, error) {
	payload, err := q.GetDCLCustomerAccountVersion(ctx, approvalEntryID)
	if err != nil {
		return EffectiveReference{}, s.internal("get customer account snapshot", err)
	}
	data, err := bobCustomerAccountData(payload, q, ctx)
	if err != nil {
		return EffectiveReference{}, err
	}
	detail := DetailView{Name: data.Name, ShortName: data.ShortName, CustomerType: data.CustomerTypeID, ContactName: data.ContactName, ContactPhone: data.ContactPhone, Email: data.Email, Address: data.Address, OperatingEntityID: data.OperatingEntityID}
	if data.OperatingEntity != nil {
		detail.OperatingEntityApprovalEntryID, detail.OperatingEntityCode, detail.OperatingEntityName = data.OperatingEntity.ApprovalEntryID, data.OperatingEntity.Code, data.OperatingEntity.Name
	}
	if data.SettlementMethod != nil {
		detail.SettlementMethodID, detail.SettlementMethodCode, detail.SettlementMethodName = data.SettlementMethodID, data.SettlementMethod.Code, data.SettlementMethod.Name
		detail.TermCode, detail.RuleType, detail.DueDays, detail.MonthOffset, detail.CutoffDay, detail.DefaultSalesSurcharge = data.SettlementMethod.TermCode, data.SettlementMethod.RuleType, data.SettlementMethod.DueDays, data.SettlementMethod.MonthOffset, data.SettlementMethod.CutoffDay, data.SettlementMethod.DefaultSalesSurcharge
	}
	return EffectiveReference{ObjectID: objectID, Entity: EntityCustomerAccount, Code: code, ApprovalEntryID: approvalEntryID, Data: detail}, nil
}

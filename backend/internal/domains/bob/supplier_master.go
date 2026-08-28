package bob

import (
	"context"
	"errors"
	"slices"
	"strings"
	"time"

	dbsqlc "github.com/hansonyu183/zerp/backend/internal/database/sqlc"
	"github.com/hansonyu183/zerp/backend/internal/platform/approval"
	"github.com/jackc/pgx/v5"
)

type SupplierSettlementSnapshot struct {
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
type SupplierPurchaserSnapshot struct {
	SourceObjectID  string `json:"sourceObjectId"`
	ApprovalEntryID string `json:"approvalEntryId"`
	Code            string `json:"code"`
	Name            string `json:"name"`
}

type SupplierData struct {
	OperatingEntityID          string                      `json:"operatingEntityId,omitempty"`
	Name                       string                      `json:"-"`
	ShortName                  string                      `json:"-"`
	TaxNumber                  string                      `json:"-"`
	ContactName                string                      `json:"contactName,omitempty"`
	ContactPhone               string                      `json:"contactPhone,omitempty"`
	Email                      string                      `json:"email,omitempty"`
	Address                    string                      `json:"address,omitempty"`
	Remark                     string                      `json:"remark,omitempty"`
	SettlementMethodID         string                      `json:"settlementMethodId,omitempty"`
	DefaultPurchaserEmployeeID string                      `json:"defaultPurchaserEmployeeId,omitempty"`
	DefaultPurchaserApprovalID string                      `json:"-"`
	SettlementMethod           *SupplierSettlementSnapshot `json:"settlementMethod"`
	DefaultPurchaser           *SupplierPurchaserSnapshot  `json:"defaultPurchaser"`
}

type SupplierVersionView struct {
	Approval VersionMeta  `json:"approval"`
	Data     SupplierData `json:"data"`
}

type SupplierDetailView struct {
	ObjectID            string               `json:"objectId"`
	Code                string               `json:"code"`
	ObjectRevision      int64                `json:"objectRevision"`
	Enabled             bool                 `json:"enabled"`
	PartyID             string               `json:"partyId"`
	PartyKind           string               `json:"partyKind"`
	PartyDisplayName    string               `json:"partyDisplayName"`
	OperatingEntityID   string               `json:"operatingEntityId"`
	OperatingEntityCode string               `json:"operatingEntityCode"`
	OperatingEntityName string               `json:"operatingEntityName"`
	LatestApproved      *SupplierVersionView `json:"latestApproved"`
	OpenVersion         *SupplierVersionView `json:"openVersion"`
	UpdatedAt           time.Time            `json:"updatedAt"`
}

type SupplierListVersion struct {
	Approval             approval.VersionMeta `json:"approval"`
	DefaultPurchaserCode string               `json:"defaultPurchaserCode,omitempty"`
	DefaultPurchaserName string               `json:"defaultPurchaserName,omitempty"`
}

type SupplierListItem struct {
	ObjectID            string               `json:"objectId"`
	Code                string               `json:"code"`
	ObjectRevision      int64                `json:"objectRevision"`
	Enabled             bool                 `json:"enabled"`
	PartyID             string               `json:"partyId"`
	PartyKind           string               `json:"partyKind"`
	PartyDisplayName    string               `json:"partyDisplayName"`
	OperatingEntityID   string               `json:"operatingEntityId"`
	OperatingEntityCode string               `json:"operatingEntityCode"`
	OperatingEntityName string               `json:"operatingEntityName"`
	LatestApproved      *SupplierListVersion `json:"latestApproved"`
	OpenVersion         *SupplierListVersion `json:"openVersion"`
	UpdatedAt           time.Time            `json:"updatedAt"`
}

func (s *Service) SupplierQuery(ctx context.Context, input QueryInput) (Page[SupplierListItem], error) {
	if input.Page < 1 || input.PageSize != 20 || len(input.Sort) > 1 {
		return Page[SupplierListItem]{}, domainError(ErrorValidation, "invalid supplier query", nil, nil)
	}
	if len(input.Sort) == 1 && (input.Sort[0].Field != "code" || strings.ToLower(input.Sort[0].Order) != "asc") {
		return Page[SupplierListItem]{}, domainError(ErrorValidation, "invalid supplier sort", nil, nil)
	}
	statuses := uniqueStrings(input.Filters.Status)
	if statuses == nil {
		statuses = []string{}
	}
	for _, status := range statuses {
		if !validStatus(status) {
			return Page[SupplierListItem]{}, domainError(ErrorValidation, "invalid supplier status", nil, nil)
		}
	}
	if input.Filters.DefaultPurchaserEmployeeID != "" && !validID(input.Filters.DefaultPurchaserEmployeeID) {
		return Page[SupplierListItem]{}, domainError(ErrorValidation, "invalid default purchaser", nil, nil)
	}
	enabledFilter := int32(-1)
	if input.Filters.Enabled != nil {
		if *input.Filters.Enabled {
			enabledFilter = 1
		} else {
			enabledFilter = 0
		}
	}
	if len(statuses) > 0 && !slices.Contains(statuses, string(approval.StatusApproved)) {
		return Page[SupplierListItem]{Items: []SupplierListItem{}, Page: input.Page, PageSize: input.PageSize}, nil
	}
	params := dbsqlc.ListBobSuppliersCurrentParams{Keyword: strings.TrimSpace(input.Filters.Keyword), EnabledFilter: enabledFilter, DefaultPurchaserEmployeeID: input.Filters.DefaultPurchaserEmployeeID, RowOffset: int32((input.Page - 1) * input.PageSize), RowLimit: int32(input.PageSize)}
	total, err := s.queries.CountBobSuppliersCurrent(ctx, dbsqlc.CountBobSuppliersCurrentParams{Keyword: params.Keyword, EnabledFilter: params.EnabledFilter, DefaultPurchaserEmployeeID: params.DefaultPurchaserEmployeeID})
	if err != nil {
		return Page[SupplierListItem]{}, s.internal("count suppliers", err)
	}
	rows, err := s.queries.ListBobSuppliersCurrent(ctx, params)
	if err != nil {
		return Page[SupplierListItem]{}, s.internal("list suppliers", err)
	}
	items := make([]SupplierListItem, 0, len(rows))
	for _, row := range rows {
		item := SupplierListItem{ObjectID: row.ObjectID, Code: row.Code, ObjectRevision: row.ObjectRevision, Enabled: row.Enabled, UpdatedAt: row.UpdatedAt.Time}
		identity, identityErr := s.supplierIdentity(ctx, row.ObjectID)
		if identityErr != nil {
			return Page[SupplierListItem]{}, identityErr
		}
		item.PartyID, item.PartyKind, item.PartyDisplayName = identity.PartyID, identity.PartyKind, identity.PartyDisplayName
		item.OperatingEntityID = identity.OperatingEntityID
		owner, ownerErr := s.getOperatingEntityCurrent(ctx, GetInput{ObjectID: identity.OperatingEntityID})
		if ownerErr != nil {
			return Page[SupplierListItem]{}, ownerErr
		}
		item.OperatingEntityCode, item.OperatingEntityName = owner.Code, owner.Data.Name
		version, loadErr := s.loadSupplierVersion(ctx, row.ApprovalEntryID)
		if loadErr != nil {
			return Page[SupplierListItem]{}, loadErr
		}
		item.LatestApproved = &SupplierListVersion{Approval: version.Approval, DefaultPurchaserCode: stringValue(row.DefaultPurchaserEmployeeCode), DefaultPurchaserName: stringValue(row.DefaultPurchaserEmployeeName)}
		items = append(items, item)
	}
	return Page[SupplierListItem]{Items: items, Total: total, Page: input.Page, PageSize: input.PageSize}, nil
}

func (s *Service) SupplierGet(ctx context.Context, input GetInput) (SupplierDetailView, error) {
	if !validID(input.ObjectID) || input.ApprovalEntryID != "" {
		return SupplierDetailView{}, domainError(ErrorValidation, "invalid supplier", nil, nil)
	}
	current, err := s.getSupplierCurrent(ctx, input)
	if err != nil {
		return SupplierDetailView{}, err
	}
	version, err := s.loadSupplierVersion(ctx, current.Approval.ApprovalEntryID)
	if err != nil {
		return SupplierDetailView{}, err
	}
	result := SupplierDetailView{ObjectID: current.ObjectID, Code: current.Code, ObjectRevision: current.ObjectRevision, Enabled: current.Enabled, UpdatedAt: current.UpdatedAt, LatestApproved: &version}
	if current.Relationship != nil {
		result.PartyID, result.PartyKind, result.PartyDisplayName, result.OperatingEntityID = current.Relationship.PartyID, current.Relationship.PartyKind, current.Relationship.PartyDisplayName, current.Relationship.OperatingEntityID
	}
	owner, err := s.getOperatingEntityCurrent(ctx, GetInput{ObjectID: result.OperatingEntityID})
	if err != nil {
		return SupplierDetailView{}, err
	}
	result.OperatingEntityCode, result.OperatingEntityName = owner.Code, owner.Data.Name
	return result, nil
}

func (s *Service) loadSupplierVersion(ctx context.Context, entryID string) (SupplierVersionView, error) {
	result, err := loadSupplierVersionWithQueries(ctx, s.queries, entryID)
	if errors.Is(err, pgx.ErrNoRows) {
		return SupplierVersionView{}, domainError(ErrorValidation, "supplier version not found", nil, nil)
	}
	if err != nil {
		return SupplierVersionView{}, s.internal("load supplier version", err)
	}
	return result, nil
}

func loadSupplierVersionWithQueries(ctx context.Context, q *dbsqlc.Queries, entryID string) (SupplierVersionView, error) {
	entry, err := q.GetApprovalEntry(ctx, dbsqlc.GetApprovalEntryParams{ID: entryID, Domain: "dcl", Entity: EntitySupplier})
	if err != nil {
		return SupplierVersionView{}, err
	}
	payload, err := q.GetDCLSupplierVersion(ctx, entryID)
	if err != nil {
		return SupplierVersionView{}, err
	}
	data := SupplierData{ShortName: stringValue(payload.ShortName), TaxNumber: stringValue(payload.TaxNumber),
		ContactName: stringValue(payload.ContactName), ContactPhone: stringValue(payload.ContactPhone), Email: stringValue(payload.Email),
		Address: stringValue(payload.Address), Remark: stringValue(payload.Remark), SettlementMethodID: stringValue(payload.SettlementMethodID),
		DefaultPurchaserEmployeeID: stringValue(payload.DefaultPurchaserEmployeeID), DefaultPurchaserApprovalID: stringValue(payload.DefaultPurchaserEmployeeApprovalEntryID)}
	if data.DefaultPurchaserEmployeeID != "" {
		data.DefaultPurchaser = &SupplierPurchaserSnapshot{SourceObjectID: data.DefaultPurchaserEmployeeID, ApprovalEntryID: data.DefaultPurchaserApprovalID, Code: stringValue(payload.DefaultPurchaserEmployeeCode), Name: stringValue(payload.DefaultPurchaserEmployeeName)}
	}
	if data.SettlementMethodID != "" {
		data.SettlementMethod = &SupplierSettlementSnapshot{SourceObjectID: data.SettlementMethodID, ApprovalEntryID: stringValue(payload.SettlementMethodApprovalEntryID),
			Code: stringValue(payload.SettlementMethodCode), Name: stringValue(payload.SettlementMethodName), TermCode: stringValue(payload.SettlementTermCode),
			RuleType: stringValue(payload.SettlementRuleType), MonthOffset: payload.SettlementMonthOffset,
			DayOfMonth: payload.SettlementDayOfMonth, DayOffset: payload.SettlementDayOffset}
	}
	return SupplierVersionView{Approval: approvalMeta(entry), Data: data}, nil
}

func (s *Service) supplierIdentity(ctx context.Context, objectID string) (RelationshipIdentityView, error) {
	relationship, err := s.queries.GetBobSupplierRelationship(ctx, objectID)
	if err != nil {
		return RelationshipIdentityView{}, s.internal("get supplier relationship", err)
	}
	party, err := s.queries.GetBobParty(ctx, relationship.PartyID)
	if err != nil {
		return RelationshipIdentityView{}, s.internal("get supplier party", err)
	}
	return RelationshipIdentityView{PartyID: party.ID, PartyKind: party.Kind, PartyDisplayName: party.DisplayName, OperatingEntityID: relationship.OperatingEntityID}, nil
}

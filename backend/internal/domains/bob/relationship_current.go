package bob

import (
	"context"
	"errors"
	"strings"

	dbsqlc "github.com/hansonyu183/zerp/backend/internal/database/sqlc"
	"github.com/jackc/pgx/v5"
)

// RelationshipIdentity is the immutable Party-to-operating-entity root held
// by BOB. Mutable commercial data is declared and approved in DCL.
type RelationshipIdentity struct {
	ObjectID, Code, PartyID, OperatingEntityID string
}

func (s *Service) ResolveOtherUnitDeclaration(ctx context.Context, tx pgx.Tx, data DetailView, exact bool) (DetailView, error) {
	if data.SettlementMethodID == "" {
		return validateDetailData(EntityOtherUnit, data)
	}
	if exact {
		if data.SettlementMethodCode == "" || data.SettlementMethodName == "" {
			return DetailView{}, domainError(ErrorConflict, "settlement method snapshot is incomplete", nil, nil)
		}
		return validateDetailData(EntityOtherUnit, data)
	}
	resolved, err := s.resolveSettlementSnapshot(ctx, tx, data)
	if err != nil {
		return DetailView{}, err
	}
	resolved.DefaultSalesSurcharge = ""
	return validateDetailData(EntityOtherUnit, resolved)
}

func (s *Service) EnsureSupplierUnapproveAllowed(ctx context.Context, tx pgx.Tx, entryID string) error {
	if tx == nil || !validID(entryID) {
		return domainError(ErrorValidation, "invalid Supplier unapprove request", nil, nil)
	}
	return s.EnsureUnapproveAllowed(ctx, tx, entryID)
}

func (s *Service) EnsureCustomerUnapproveAllowed(ctx context.Context, tx pgx.Tx, entryID string) error {
	if tx == nil || !validID(entryID) {
		return domainError(ErrorValidation, "invalid Customer unapprove request", nil, nil)
	}
	return s.EnsureUnapproveAllowed(ctx, tx, entryID)
}

// ResolveCustomerAccountReferences resolves the exact commercial snapshots a
// DCL account must own. It is a BOB integration primitive, not an account
// declaration API: callers persist the returned immutable facts in DCL.
func (s *Service) ResolveCustomerAccountReferences(ctx context.Context, tx pgx.Tx, customerIdentifiers map[string]string, settlementID, paymentID, attributionType, attributionID string) (EffectiveReference, EffectiveReference, EffectiveReference, error) {
	if tx == nil || !validID(attributionID) {
		return EffectiveReference{}, EffectiveReference{}, EffectiveReference{}, domainError(ErrorValidation, "invalid Customer Account references", nil, nil)
	}
	var settlement, payment EffectiveReference
	var err error
	if settlementID != "" {
		r, e := s.resolveNamedAuxiliaryReference(ctx, tx, "settlement-method", settlementID)
		err = e
		settlement = EffectiveReference{ObjectID: r.ObjectID, Entity: r.Entity, Code: r.Code, ApprovalEntryID: r.ApprovalEntryID, Data: DetailView{Name: mapString(r.Data, "name"), TermCode: mapString(r.Data, "termCode"), RuleType: mapString(r.Data, "ruleType"), DueDays: int32(mapInt(r.Data, "dayOffset")), MonthOffset: int32(mapInt(r.Data, "monthOffset")), CutoffDay: int32(mapInt(r.Data, "dayOfMonth")), DefaultSalesSurcharge: mapString(r.Data, "defaultSalesSurcharge")}}
		if err != nil {
			return EffectiveReference{}, EffectiveReference{}, EffectiveReference{}, err
		}
	}
	if paymentID != "" {
		r, e := s.resolveNamedAuxiliaryReference(ctx, tx, "payment-method", paymentID)
		err = e
		payment = EffectiveReference{ObjectID: r.ObjectID, Entity: r.Entity, Code: r.Code, ApprovalEntryID: r.ApprovalEntryID, Data: DetailView{Name: mapString(r.Data, "name"), DefaultSalesSurcharge: mapString(r.Data, "defaultSalesSurcharge")}}
		if err != nil {
			return EffectiveReference{}, EffectiveReference{}, EffectiveReference{}, err
		}
	}
	entity := EntitySalesPartner
	if attributionType == "INTERNAL_EMPLOYEE" {
		entity = EntityEmployee
	}
	sales, err := s.ResolveCurrentReference(ctx, tx, entity, attributionID)
	if err != nil {
		return EffectiveReference{}, EffectiveReference{}, EffectiveReference{}, err
	}
	if entity == EntitySalesPartner {
		if err = s.ensureDifferentCustomerSalesIdentity(ctx, s.queries.WithTx(tx), customerIdentifiers, attributionID); err != nil {
			return EffectiveReference{}, EffectiveReference{}, EffectiveReference{}, err
		}
		required := SalesCapabilityExternalPartTime
		if attributionType == "CHANNEL_PARTNER" {
			required = SalesCapabilityChannelPartner
		}
		if !hasSalesCapability(sales.Data.SalesCapabilities, required) {
			return EffectiveReference{}, EffectiveReference{}, EffectiveReference{}, domainError(ErrorConflict, "sales-partner capability is unavailable", nil, nil)
		}
	}
	return settlement, payment, sales, nil
}

// ValidateCustomerAccountReferences proves a stored declaration still names
// exact approved snapshots before it can be submitted or approved.
func (s *Service) ValidateCustomerAccountReferences(ctx context.Context, tx pgx.Tx, customerIdentifiers map[string]string, attributionType, attributionID, attributionEntryID string) error {
	if tx == nil || !validID(attributionID) || !validID(attributionEntryID) {
		return domainError(ErrorValidation, "invalid Customer Account references", nil, nil)
	}
	entity := EntitySalesPartner
	if attributionType == "INTERNAL_EMPLOYEE" {
		entity = EntityEmployee
	}
	reference, err := s.ValidateHistoricalReference(ctx, tx, entity, attributionID, attributionEntryID)
	if err != nil {
		return err
	}
	if entity == EntitySalesPartner {
		if err = s.ensureDifferentCustomerSalesIdentity(ctx, s.queries.WithTx(tx), customerIdentifiers, attributionID); err != nil {
			return err
		}
		required := SalesCapabilityExternalPartTime
		if attributionType == "CHANNEL_PARTNER" {
			required = SalesCapabilityChannelPartner
		}
		if !hasSalesCapability(reference.Data.SalesCapabilities, required) {
			return domainError(ErrorConflict, "sales-partner capability is unavailable", nil, nil)
		}
	}
	return nil
}

func (s *Service) ensureDifferentCustomerSalesIdentity(ctx context.Context, q *dbsqlc.Queries, customerIdentifiers map[string]string, salesPartnerID string) error {
	relationship, err := q.GetBobSalesPartnerRelationship(ctx, salesPartnerID)
	if errors.Is(err, pgx.ErrNoRows) {
		return domainError(ErrorConflict, "sales-partner relationship is unavailable", nil, nil)
	}
	if err != nil {
		return s.internal("get sales-partner relationship", err)
	}
	identifiers, err := partyIdentifiers(ctx, q, relationship.PartyID)
	if err != nil {
		return s.internal("get sales-partner identifiers", err)
	}
	for _, identifier := range identifiers {
		customerValue := customerIdentifiers[identifier.Type]
		if customerValue != "" && normalizePartyIdentifier(customerValue) == normalizePartyIdentifier(identifier.Value) {
			return domainError(ErrorConflict, "customer cannot attribute sales to the same business identity", nil, nil)
		}
	}
	return nil
}

func (s *Service) EnsureOtherUnitUnapproveAllowed(ctx context.Context, tx pgx.Tx, entryID string) error {
	if tx == nil || !validID(entryID) {
		return domainError(ErrorValidation, "invalid Other Unit unapprove request", nil, nil)
	}
	return s.EnsureUnapproveAllowed(ctx, tx, entryID)
}
func (s *Service) EnsureSalesPartnerUnapproveAllowed(ctx context.Context, tx pgx.Tx, entryID string) error {
	if tx == nil || !validID(entryID) {
		return domainError(ErrorValidation, "invalid Sales Partner unapprove request", nil, nil)
	}
	return s.EnsureUnapproveAllowed(ctx, tx, entryID)
}

func otherUnitCurrentView(r dbsqlc.GetBobOtherUnitCurrentRow) ObjectView {
	e := struct {
		ID        string
		VersionNo int32
	}{ID: r.ApprovalEntryID, VersionNo: versionNumber(r.VersionNo)}
	return ObjectView{ObjectID: r.ObjectID, Entity: r.Entity, Code: r.Code, Enabled: r.Enabled, SourceApprovalEntryID: e.ID, SourceVersionNo: e.VersionNo, UpdatedAt: r.UpdatedAt.Time, Relationship: &RelationshipIdentityView{PartyID: r.PartyID, PartyKind: r.PartyKind, PartyDisplayName: r.DisplayName, OperatingEntityID: r.OperatingEntityID, OperatingEntityCode: deref(r.OperatingEntityCode), OperatingEntityName: r.OperatingEntityName}, Data: DetailView{ContactName: deref(r.ContactName), ContactPhone: deref(r.ContactPhone), Email: deref(r.Email), Address: deref(r.Address), Remark: deref(r.Remark), SettlementMethodID: deref(r.SettlementMethodID), SettlementMethodCode: deref(r.SettlementMethodCode), SettlementMethodName: deref(r.SettlementMethodName), TermCode: deref(r.SettlementTermCode), RuleType: deref(r.SettlementRuleType), MonthOffset: r.SettlementMonthOffset, DayOffset: r.SettlementDayOffset}}
}
func (s *Service) getOtherUnitCurrent(ctx context.Context, input GetInput) (ObjectView, error) {
	if !validID(input.ObjectID) {
		return ObjectView{}, domainError(ErrorValidation, "invalid Other Unit get request", nil, nil)
	}
	r, err := s.queries.GetBobOtherUnitCurrent(ctx, input.ObjectID)
	if errors.Is(err, pgx.ErrNoRows) {
		return ObjectView{}, domainError(ErrorValidation, "Other Unit not found", nil, nil)
	}
	if err != nil {
		return ObjectView{}, s.internal("get Other Unit current", err)
	}
	return otherUnitCurrentView(r), nil
}
func (s *Service) getSalesPartnerCurrent(ctx context.Context, input GetInput) (ObjectView, error) {
	if !validID(input.ObjectID) {
		return ObjectView{}, domainError(ErrorValidation, "invalid Sales Partner get request", nil, nil)
	}
	r, err := s.queries.GetBobSalesPartnerCurrent(ctx, input.ObjectID)
	if errors.Is(err, pgx.ErrNoRows) {
		return ObjectView{}, domainError(ErrorValidation, "Sales Partner not found", nil, nil)
	}
	if err != nil {
		return ObjectView{}, s.internal("get Sales Partner current", err)
	}
	e := struct {
		ID        string
		VersionNo int32
	}{ID: r.ApprovalEntryID, VersionNo: versionNumber(r.VersionNo)}
	return ObjectView{ObjectID: r.ObjectID, Entity: r.Entity, Code: r.Code, Enabled: r.Enabled, SourceApprovalEntryID: e.ID, SourceVersionNo: e.VersionNo, UpdatedAt: r.UpdatedAt.Time, Relationship: &RelationshipIdentityView{PartyID: r.PartyID, PartyKind: r.PartyKind, PartyDisplayName: r.DisplayName, OperatingEntityID: r.OperatingEntityID, OperatingEntityCode: deref(r.OperatingEntityCode), OperatingEntityName: r.OperatingEntityName}, Data: DetailView{SalesCapabilities: r.Capabilities, ContactName: deref(r.ContactName), ContactPhone: deref(r.ContactPhone), Email: deref(r.Email), Address: deref(r.Address), Remark: deref(r.Remark)}}, nil
}

func (s *Service) queryRelationshipCurrent(ctx context.Context, q *dbsqlc.Queries, entity string, input QueryInput) (Page[QueryItem], error) {
	offset, ok := pageOffset(input.Page, input.PageSize)
	if !ok || len(input.Sort) > 1 {
		return Page[QueryItem]{}, domainError(ErrorValidation, "invalid relationship query", nil, nil)
	}
	filters, err := validateQueryFilters(entity, input.Filters)
	if err != nil {
		return Page[QueryItem]{}, err
	}
	sortField, sortOrder := "updatedAt", "desc"
	if len(input.Sort) == 1 {
		sortField, sortOrder = input.Sort[0].Field, strings.ToLower(input.Sort[0].Order)
		if (sortField != "updatedAt" && sortField != "code" && sortField != "name") || (sortOrder != "asc" && sortOrder != "desc") {
			return Page[QueryItem]{}, domainError(ErrorValidation, "invalid relationship query sort", nil, nil)
		}
	}
	enabled := int32(-1)
	if filters.Enabled != nil {
		if *filters.Enabled {
			enabled = 1
		} else {
			enabled = 0
		}
	}
	params := dbsqlc.ListBobOtherUnitCurrentsParams{Keyword: filters.Keyword, EnabledFilter: enabled, SortField: sortField, SortOrder: sortOrder, RowOffset: offset, RowLimit: int32(input.PageSize)}
	if entity == EntityOtherUnit {
		rows, err := q.ListBobOtherUnitCurrents(ctx, params)
		if err != nil {
			return Page[QueryItem]{}, s.internal("list Other Unit current", err)
		}
		total, err := q.CountBobOtherUnitCurrents(ctx, dbsqlc.CountBobOtherUnitCurrentsParams{Keyword: filters.Keyword, EnabledFilter: enabled})
		if err != nil {
			return Page[QueryItem]{}, s.internal("count Other Unit current", err)
		}
		items := make([]QueryItem, 0, len(rows))
		for _, r := range rows {
			d := DetailView{ContactName: deref(r.ContactName), ContactPhone: deref(r.ContactPhone), Email: deref(r.Email), Address: deref(r.Address), Remark: deref(r.Remark), SettlementMethodID: deref(r.SettlementMethodID), SettlementMethodCode: deref(r.SettlementMethodCode), SettlementMethodName: deref(r.SettlementMethodName), TermCode: deref(r.SettlementTermCode), RuleType: deref(r.SettlementRuleType), MonthOffset: r.SettlementMonthOffset, DayOffset: r.SettlementDayOffset}
			if r.SettlementDayOfMonth != 0 {
				day := r.SettlementDayOfMonth
				d.DayOfMonth = &day
			}
			items = append(items, QueryItem{ObjectID: r.ObjectID, Entity: r.Entity, Code: r.Code, Enabled: r.Enabled, SourceApprovalEntryID: r.ApprovalEntryID, SourceVersionNo: versionNumber(r.VersionNo), Data: d, UpdatedAt: r.UpdatedAt.Time, Relationship: &RelationshipIdentityView{PartyID: r.PartyID, PartyKind: r.PartyKind, PartyDisplayName: r.DisplayName, OperatingEntityID: r.OperatingEntityID, OperatingEntityCode: deref(r.OperatingEntityCode), OperatingEntityName: r.OperatingEntityName}})
		}
		return Page[QueryItem]{Items: items, Total: total, Page: input.Page, PageSize: input.PageSize}, nil
	}
	rows, err := q.ListBobSalesPartnerCurrents(ctx, dbsqlc.ListBobSalesPartnerCurrentsParams{Keyword: filters.Keyword, EnabledFilter: enabled, SortField: sortField, SortOrder: sortOrder, RowOffset: offset, RowLimit: int32(input.PageSize)})
	if err != nil {
		return Page[QueryItem]{}, s.internal("list Sales Partner current", err)
	}
	total, err := q.CountBobSalesPartnerCurrents(ctx, dbsqlc.CountBobSalesPartnerCurrentsParams{Keyword: filters.Keyword, EnabledFilter: enabled})
	if err != nil {
		return Page[QueryItem]{}, s.internal("count Sales Partner current", err)
	}
	items := make([]QueryItem, 0, len(rows))
	for _, r := range rows {
		items = append(items, QueryItem{ObjectID: r.ObjectID, Entity: r.Entity, Code: r.Code, Enabled: r.Enabled, SourceApprovalEntryID: r.ApprovalEntryID, SourceVersionNo: versionNumber(r.VersionNo), Data: DetailView{SalesCapabilities: r.Capabilities, ContactName: deref(r.ContactName), ContactPhone: deref(r.ContactPhone), Email: deref(r.Email), Address: deref(r.Address), Remark: deref(r.Remark)}, UpdatedAt: r.UpdatedAt.Time, Relationship: &RelationshipIdentityView{PartyID: r.PartyID, PartyKind: r.PartyKind, PartyDisplayName: r.DisplayName, OperatingEntityID: r.OperatingEntityID, OperatingEntityCode: deref(r.OperatingEntityCode), OperatingEntityName: r.OperatingEntityName}})
	}
	return Page[QueryItem]{Items: items, Total: total, Page: input.Page, PageSize: input.PageSize}, nil
}
func (s *Service) validateOtherUnitSnapshotReference(ctx context.Context, q *dbsqlc.Queries, objectID, entryID string) (EffectiveReference, error) {
	entry, err := s.requireHistoricalApprovalEntry(ctx, q, entryID, EntityOtherUnit, objectID, "Other Unit approval snapshot is unavailable")
	if err != nil {
		return EffectiveReference{}, err
	}
	d, err := q.GetDCLOtherUnitVersion(ctx, entryID)
	if err != nil {
		return EffectiveReference{}, s.internal("load Other Unit snapshot", err)
	}
	o, err := q.GetDCLSubject(ctx, dbsqlc.GetDCLSubjectParams{ID: objectID, Entity: EntityOtherUnit})
	if err != nil {
		return EffectiveReference{}, s.internal("load Other Unit identity", err)
	}
	return EffectiveReference{ObjectID: o.ID, Entity: o.Entity, Code: deref(o.Code), ApprovalEntryID: entryID, VersionNo: versionNumber(entry.VersionNo), Data: otherUnitDetail(d)}, nil
}
func otherUnitDetail(d dbsqlc.DclOtherUnitVersion) DetailView {
	return DetailView{ContactName: deref(d.ContactName), ContactPhone: deref(d.ContactPhone), Email: deref(d.Email), Address: deref(d.Address), SettlementMethodID: deref(d.SettlementMethodID), SettlementMethodCode: deref(d.SettlementMethodCode), SettlementMethodName: deref(d.SettlementMethodName), TermCode: deref(d.SettlementTermCode), RuleType: deref(d.SettlementRuleType), MonthOffset: d.SettlementMonthOffset, DayOffset: d.SettlementDayOffset, Remark: deref(d.Remark)}
}
func (s *Service) validateSalesPartnerSnapshotReference(ctx context.Context, q *dbsqlc.Queries, objectID, entryID string) (EffectiveReference, error) {
	entry, err := s.requireHistoricalApprovalEntry(ctx, q, entryID, EntitySalesPartner, objectID, "Sales Partner approval snapshot is unavailable")
	if err != nil {
		return EffectiveReference{}, err
	}
	d, err := q.GetDCLSalesPartnerVersion(ctx, entryID)
	if err != nil {
		return EffectiveReference{}, s.internal("load Sales Partner snapshot", err)
	}
	o, err := q.GetDCLSubject(ctx, dbsqlc.GetDCLSubjectParams{ID: objectID, Entity: EntitySalesPartner})
	if err != nil {
		return EffectiveReference{}, s.internal("load Sales Partner identity", err)
	}
	return EffectiveReference{ObjectID: o.ID, Entity: o.Entity, Code: deref(o.Code), ApprovalEntryID: entryID, VersionNo: versionNumber(entry.VersionNo), Data: DetailView{SalesCapabilities: d.Capabilities, ContactName: deref(d.ContactName), ContactPhone: deref(d.ContactPhone), Email: deref(d.Email), Address: deref(d.Address), Remark: deref(d.Remark)}}, nil
}
func (s *Service) resolveOtherUnitCurrentReference(ctx context.Context, q *dbsqlc.Queries, objectID string) (EffectiveReference, error) {
	r, err := q.GetBobOtherUnitCurrentReference(ctx, objectID)
	if errors.Is(err, pgx.ErrNoRows) {
		return EffectiveReference{}, domainError(ErrorConflict, "Other Unit reference has no enabled current version", nil, nil)
	}
	if err != nil {
		return EffectiveReference{}, s.internal("resolve Other Unit current", err)
	}
	return EffectiveReference{ObjectID: r.ObjectID, Entity: r.Entity, Code: r.Code, ApprovalEntryID: r.ApprovalEntryID, VersionNo: versionNumber(r.VersionNo), Data: DetailView{Name: r.DisplayName}}, nil
}
func (s *Service) resolveSalesPartnerCurrentReference(ctx context.Context, q *dbsqlc.Queries, objectID string) (EffectiveReference, error) {
	r, err := q.GetBobSalesPartnerCurrentReference(ctx, objectID)
	if errors.Is(err, pgx.ErrNoRows) {
		return EffectiveReference{}, domainError(ErrorConflict, "Sales Partner reference has no enabled current version", nil, nil)
	}
	if err != nil {
		return EffectiveReference{}, s.internal("resolve Sales Partner current", err)
	}
	reference, err := s.validateSalesPartnerSnapshotReference(ctx, q, r.ObjectID, r.ApprovalEntryID)
	if err != nil {
		return EffectiveReference{}, err
	}
	reference.Data.Name = r.DisplayName
	return reference, nil
}

package bob

import (
	"context"
	"errors"
	"strings"

	dbsqlc "github.com/hansonyu183/zerp/backend/internal/database/sqlc"
	"github.com/jackc/pgx/v5"
)

// BOB exposes Suppliers strictly as currently effective approved data. DCL
// owns Supplier candidates and their historical snapshots.
func (s *Service) getSupplierCurrent(ctx context.Context, input GetInput) (ObjectView, error) {
	if !validID(input.ObjectID) {
		return ObjectView{}, domainError(ErrorValidation, "invalid Supplier get request", nil, nil)
	}
	r, err := s.queries.GetBobSupplierCurrent(ctx, input.ObjectID)
	if errors.Is(err, pgx.ErrNoRows) {
		return ObjectView{}, domainError(ErrorValidation, "Supplier not found", nil, nil)
	}
	if err != nil {
		return ObjectView{}, s.internal("get Supplier current", err)
	}
	e := struct {
		ID        string
		VersionNo int32
	}{ID: r.ApprovalEntryID, VersionNo: versionNumber(r.VersionNo)}
	d := DetailView{Name: r.DisplayName, ShortName: stringValue(r.ShortName), TaxNumber: stringValue(r.TaxNumber), ContactName: stringValue(r.ContactName), ContactPhone: stringValue(r.ContactPhone), Email: stringValue(r.Email), Address: stringValue(r.Address), Remark: stringValue(r.Remark), SettlementMethodID: stringValue(r.SettlementMethodID), SettlementMethodCode: stringValue(r.SettlementMethodCode), SettlementMethodName: stringValue(r.SettlementMethodName), TermCode: stringValue(r.SettlementTermCode), RuleType: stringValue(r.SettlementRuleType), MonthOffset: r.SettlementMonthOffset, DayOffset: r.SettlementDayOffset, DefaultPurchaserEmployeeID: stringValue(r.DefaultPurchaserEmployeeID), DefaultPurchaserApprovalEntryID: stringValue(r.DefaultPurchaserEmployeeApprovalEntryID), DefaultPurchaserCode: stringValue(r.DefaultPurchaserEmployeeCode), DefaultPurchaserName: stringValue(r.DefaultPurchaserEmployeeName)}
	if r.SettlementDayOfMonth != 0 {
		day := r.SettlementDayOfMonth
		d.DayOfMonth = &day
	}
	return ObjectView{ObjectID: r.ObjectID, Entity: r.Entity, Code: r.Code, Enabled: r.Enabled, SourceApprovalEntryID: e.ID, SourceVersionNo: e.VersionNo, Data: d, UpdatedAt: r.UpdatedAt.Time, Relationship: &RelationshipIdentityView{PartyID: r.PartyID, PartyKind: r.PartyKind, PartyDisplayName: r.DisplayName, OperatingEntityID: r.OperatingEntityID}}, nil
}

func (s *Service) querySuppliersCurrent(ctx context.Context, q *dbsqlc.Queries, input QueryInput) (Page[QueryItem], error) {
	if input.Page < 1 || input.PageSize != 20 || len(input.Sort) > 1 || (len(input.Sort) == 1 && (input.Sort[0].Field != "code" || strings.ToLower(input.Sort[0].Order) != "asc")) {
		return Page[QueryItem]{}, domainError(ErrorValidation, "invalid Supplier query", nil, nil)
	}
	filters, err := validateQueryFilters(EntitySupplier, input.Filters)
	if err != nil {
		return Page[QueryItem]{}, err
	}
	enabled := int32(-1)
	if filters.Enabled != nil {
		if *filters.Enabled {
			enabled = 1
		} else {
			enabled = 0
		}
	}
	p := dbsqlc.ListBobSuppliersCurrentParams{Keyword: filters.Keyword, EnabledFilter: enabled, DefaultPurchaserEmployeeID: filters.DefaultPurchaserEmployeeID, RowOffset: int32((input.Page - 1) * input.PageSize), RowLimit: int32(input.PageSize)}
	rows, err := q.ListBobSuppliersCurrent(ctx, p)
	if err != nil {
		return Page[QueryItem]{}, s.internal("list Supplier current", err)
	}
	total, err := q.CountBobSuppliersCurrent(ctx, dbsqlc.CountBobSuppliersCurrentParams{Keyword: p.Keyword, EnabledFilter: p.EnabledFilter, DefaultPurchaserEmployeeID: p.DefaultPurchaserEmployeeID})
	if err != nil {
		return Page[QueryItem]{}, s.internal("count Supplier current", err)
	}
	items := make([]QueryItem, 0, len(rows))
	for _, r := range rows {
		d := DetailView{Name: r.DisplayName, ShortName: stringValue(r.ShortName), TaxNumber: stringValue(r.TaxNumber), ContactName: stringValue(r.ContactName), ContactPhone: stringValue(r.ContactPhone), Email: stringValue(r.Email), Address: stringValue(r.Address), Remark: stringValue(r.Remark), SettlementMethodID: stringValue(r.SettlementMethodID), SettlementMethodCode: stringValue(r.SettlementMethodCode), SettlementMethodName: stringValue(r.SettlementMethodName), TermCode: stringValue(r.SettlementTermCode), RuleType: stringValue(r.SettlementRuleType), MonthOffset: r.SettlementMonthOffset, DayOffset: r.SettlementDayOffset, DefaultPurchaserEmployeeID: stringValue(r.DefaultPurchaserEmployeeID), DefaultPurchaserApprovalEntryID: stringValue(r.DefaultPurchaserEmployeeApprovalEntryID), DefaultPurchaserCode: stringValue(r.DefaultPurchaserEmployeeCode), DefaultPurchaserName: stringValue(r.DefaultPurchaserEmployeeName)}
		if r.SettlementDayOfMonth != 0 {
			day := r.SettlementDayOfMonth
			d.DayOfMonth = &day
		}
		items = append(items, QueryItem{ObjectID: r.ObjectID, Entity: r.Entity, Code: r.Code, Enabled: r.Enabled, SourceApprovalEntryID: r.ApprovalEntryID, SourceVersionNo: versionNumber(r.VersionNo), Data: d, UpdatedAt: r.UpdatedAt.Time, Relationship: &RelationshipIdentityView{PartyID: r.PartyID, PartyKind: r.PartyKind, PartyDisplayName: r.DisplayName, OperatingEntityID: r.OperatingEntityID}})
	}
	return Page[QueryItem]{Items: items, Total: total, Page: input.Page, PageSize: input.PageSize}, nil
}

func (s *Service) resolveSupplierCurrentReference(ctx context.Context, q *dbsqlc.Queries, objectID string) (EffectiveReference, error) {
	r, err := q.GetBobSupplierCurrentReference(ctx, objectID)
	if errors.Is(err, pgx.ErrNoRows) {
		return EffectiveReference{}, domainError(ErrorConflict, "Supplier reference has no enabled current version", nil, nil)
	}
	if err != nil {
		return EffectiveReference{}, s.internal("resolve Supplier current", err)
	}
	v, err := s.getSupplierCurrent(ctx, GetInput{ObjectID: objectID})
	if err != nil {
		return EffectiveReference{}, err
	}
	return EffectiveReference{ObjectID: r.ObjectID, Entity: r.Entity, Code: r.Code, ApprovalEntryID: r.ApprovalEntryID, VersionNo: versionNumber(r.VersionNo), Data: v.Data}, nil
}

func (s *Service) validateSupplierSnapshotReference(ctx context.Context, q *dbsqlc.Queries, objectID, entryID string) (EffectiveReference, error) {
	e, err := s.requireHistoricalApprovalEntry(ctx, q, entryID, EntitySupplier, objectID, "Supplier approval snapshot is unavailable")
	if err != nil {
		return EffectiveReference{}, err
	}
	payload, err := q.GetDCLSupplierVersion(ctx, entryID)
	if err != nil {
		return EffectiveReference{}, s.internal("load Supplier snapshot", err)
	}
	object, err := q.GetDCLSubject(ctx, dbsqlc.GetDCLSubjectParams{ID: objectID, Entity: EntitySupplier})
	if err != nil {
		return EffectiveReference{}, s.internal("load Supplier identity", err)
	}
	relationship, err := q.GetBobSupplierRelationship(ctx, objectID)
	if err != nil {
		return EffectiveReference{}, s.internal("load Supplier relationship", err)
	}
	party, err := q.GetBobParty(ctx, relationship.PartyID)
	if err != nil {
		return EffectiveReference{}, s.internal("load Supplier party", err)
	}
	d := DetailView{Name: party.DisplayName, ShortName: stringValue(payload.ShortName), TaxNumber: stringValue(payload.TaxNumber), ContactName: stringValue(payload.ContactName), ContactPhone: stringValue(payload.ContactPhone), Email: stringValue(payload.Email), Address: stringValue(payload.Address), Remark: stringValue(payload.Remark), SettlementMethodID: stringValue(payload.SettlementMethodID), SettlementMethodCode: stringValue(payload.SettlementMethodCode), SettlementMethodName: stringValue(payload.SettlementMethodName), TermCode: stringValue(payload.SettlementTermCode), RuleType: stringValue(payload.SettlementRuleType), MonthOffset: payload.SettlementMonthOffset, DayOffset: payload.SettlementDayOffset, DefaultPurchaserEmployeeID: stringValue(payload.DefaultPurchaserEmployeeID), DefaultPurchaserApprovalEntryID: stringValue(payload.DefaultPurchaserEmployeeApprovalEntryID)}
	if payload.SettlementDayOfMonth != 0 {
		day := payload.SettlementDayOfMonth
		d.DayOfMonth = &day
	}
	return EffectiveReference{ObjectID: object.ID, Entity: object.Entity, Code: deref(object.Code), ApprovalEntryID: entryID, VersionNo: versionNumber(e.VersionNo), Data: d}, nil
}

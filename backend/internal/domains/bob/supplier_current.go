package bob

import (
	"context"
	"errors"
	"strings"

	dbsqlc "github.com/hansonyu183/zerp/backend/internal/database/sqlc"
	"github.com/jackc/pgx/v5"
)

func supplierSettlement(id, code, name, term, rule string, month, day, offset int32) *SupplierSettlementSnapshot {
	if id == "" {
		return nil
	}
	return &SupplierSettlementSnapshot{SourceObjectID: id, Code: code, Name: name, TermCode: term, RuleType: rule, MonthOffset: month, DayOfMonth: day, DayOffset: offset}
}
func supplierPurchaser(id, entry, code, name string) *SupplierPurchaserSnapshot {
	if id == "" {
		return nil
	}
	return &SupplierPurchaserSnapshot{SourceObjectID: id, ApprovalEntryID: entry, Code: code, Name: name}
}
func supplierDetail(kind, legal, display string, legalIdentifier, short, contact, phone, email, address, remark, settlementID, settlementCode, settlementName, term, rule string, month, day, offset int32, defaultID, defaultEntry, defaultCode, defaultName, purchaserID, purchaserEntry, purchaserCode, purchaserName string) DetailView {
	return DetailView{Kind: kind, LegalName: legal, DisplayName: display, LegalIdentifier: legalIdentifier, Name: display, ShortName: short, ContactName: contact, ContactPhone: phone, Email: email, Address: address, Remark: remark, DefaultOperatingEntityID: defaultID, SettlementMethodID: settlementID, SettlementMethodCode: settlementCode, SettlementMethodName: settlementName, TermCode: term, RuleType: rule, MonthOffset: month, DayOffset: offset, DefaultPurchaserEmployeeID: purchaserID, DefaultPurchaserApprovalEntryID: purchaserEntry, DefaultPurchaserCode: purchaserCode, DefaultPurchaserName: purchaserName, SettlementMethod: supplierSettlement(settlementID, settlementCode, settlementName, term, rule, month, day, offset), DefaultPurchaser: supplierPurchaser(purchaserID, purchaserEntry, purchaserCode, purchaserName), OperatingEntityID: defaultID, OperatingEntityApprovalEntryID: defaultEntry, OperatingEntityCode: defaultCode, OperatingEntityName: defaultName}
}
func supplierTypedDetail(row dbsqlc.GetBobSupplierCurrentTypedRow) DetailView {
	return supplierDetail(row.Kind, row.LegalName, row.DisplayName, deref(row.LegalIdentifier), deref(row.ShortName), deref(row.ContactName), deref(row.ContactPhone), deref(row.Email), deref(row.Address), deref(row.Remark), deref(row.SettlementMethodID), deref(row.SettlementMethodCode), deref(row.SettlementMethodName), deref(row.SettlementTermCode), deref(row.SettlementRuleType), row.SettlementMonthOffset, row.SettlementDayOfMonth, row.SettlementDayOffset, row.DefaultOperatingEntityID, row.DefaultOperatingEntityApprovalEntryID, row.DefaultOperatingEntityCode, row.DefaultOperatingEntityName, deref(row.DefaultPurchaserEmployeeID), deref(row.DefaultPurchaserEmployeeApprovalEntryID), deref(row.DefaultPurchaserEmployeeCode), deref(row.DefaultPurchaserEmployeeName))
}

// BOB exposes only the highest APPROVED typed Supplier snapshot. It never
// reads the Supplier typed snapshot directly.
func (s *Service) getSupplierCurrent(ctx context.Context, input GetInput) (ObjectView, error) {
	if !validID(input.ObjectID) {
		return ObjectView{}, domainError(ErrorValidation, "invalid Supplier get request", nil, nil)
	}
	row, err := s.queries.GetBobSupplierCurrentTyped(ctx, input.ObjectID)
	if errors.Is(err, pgx.ErrNoRows) {
		return ObjectView{}, domainError(ErrorValidation, "Supplier not found", nil, nil)
	}
	if err != nil {
		return ObjectView{}, s.internal("get Supplier current", err)
	}
	d := supplierTypedDetail(row)
	operating, err := s.queries.ListDCLSupplierVersionOperatingEntities(ctx, row.ApprovalEntryID)
	if err != nil {
		return ObjectView{}, s.internal("list Supplier operating entities", err)
	}
	d.OperatingEntities = make([]BusinessArchiveSnapshot, 0, len(operating))
	d.OperatingEntityIDs = make([]string, 0, len(operating))
	for _, value := range operating {
		d.OperatingEntityIDs = append(d.OperatingEntityIDs, value.OperatingEntityID)
		d.OperatingEntities = append(d.OperatingEntities, BusinessArchiveSnapshot{SourceObjectID: value.OperatingEntityID, ApprovalEntryID: value.OperatingEntityApprovalEntryID, Code: value.OperatingEntityCode, Name: value.OperatingEntityName})
	}
	return ObjectView{ObjectID: row.ObjectID, Entity: EntitySupplier, Code: row.Code, Enabled: row.Enabled, SourceApprovalEntryID: row.ApprovalEntryID, SourceVersionNo: versionNumber(row.VersionNo), Data: d, UpdatedAt: row.UpdatedAt.Time}, nil
}
func supplierListDetail(row dbsqlc.ListBobSupplierCurrentsTypedRow) DetailView {
	return supplierDetail(row.Kind, row.LegalName, row.DisplayName, deref(row.LegalIdentifier), deref(row.ShortName), deref(row.ContactName), deref(row.ContactPhone), deref(row.Email), deref(row.Address), deref(row.Remark), deref(row.SettlementMethodID), deref(row.SettlementMethodCode), deref(row.SettlementMethodName), deref(row.SettlementTermCode), deref(row.SettlementRuleType), row.SettlementMonthOffset, row.SettlementDayOfMonth, row.SettlementDayOffset, row.DefaultOperatingEntityID, row.DefaultOperatingEntityApprovalEntryID, row.DefaultOperatingEntityCode, row.DefaultOperatingEntityName, deref(row.DefaultPurchaserEmployeeID), deref(row.DefaultPurchaserEmployeeApprovalEntryID), deref(row.DefaultPurchaserEmployeeCode), deref(row.DefaultPurchaserEmployeeName))
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
	params := dbsqlc.ListBobSupplierCurrentsTypedParams{Keyword: strings.TrimSpace(filters.Keyword), EnabledFilter: enabled, OperatingEntityID: filters.OperatingEntityID, RowOffset: int32((input.Page - 1) * input.PageSize), RowLimit: int32(input.PageSize)}
	rows, err := q.ListBobSupplierCurrentsTyped(ctx, params)
	if err != nil {
		return Page[QueryItem]{}, s.internal("list Supplier current", err)
	}
	total, err := q.CountBobSupplierCurrentsTyped(ctx, dbsqlc.CountBobSupplierCurrentsTypedParams{Keyword: params.Keyword, EnabledFilter: enabled, OperatingEntityID: params.OperatingEntityID})
	if err != nil {
		return Page[QueryItem]{}, s.internal("count Supplier current", err)
	}
	items := make([]QueryItem, 0, len(rows))
	for _, row := range rows {
		items = append(items, QueryItem{ObjectID: row.ObjectID, Entity: EntitySupplier, Code: row.Code, Enabled: row.Enabled, SourceApprovalEntryID: row.ApprovalEntryID, SourceVersionNo: versionNumber(row.VersionNo), Data: supplierListDetail(row), UpdatedAt: row.UpdatedAt.Time})
	}
	return Page[QueryItem]{Items: items, Total: total, Page: input.Page, PageSize: input.PageSize}, nil
}
func (s *Service) resolveSupplierCurrentReference(ctx context.Context, q *dbsqlc.Queries, objectID string) (EffectiveReference, error) {
	row, err := q.GetBobSupplierCurrentTyped(ctx, objectID)
	if errors.Is(err, pgx.ErrNoRows) {
		return EffectiveReference{}, domainError(ErrorConflict, "Supplier reference has no enabled current version", nil, nil)
	}
	if err != nil {
		return EffectiveReference{}, s.internal("resolve Supplier current", err)
	}
	if !row.Enabled {
		return EffectiveReference{}, domainError(ErrorConflict, "Supplier reference has no enabled current version", nil, nil)
	}
	return EffectiveReference{ObjectID: row.ObjectID, Entity: row.Entity, Code: row.Code, ApprovalEntryID: row.ApprovalEntryID, VersionNo: versionNumber(row.VersionNo), Data: supplierTypedDetail(row)}, nil
}
func (s *Service) validateSupplierSnapshotReference(ctx context.Context, q *dbsqlc.Queries, objectID, entryID string) (EffectiveReference, error) {
	entry, err := s.requireHistoricalApprovalEntry(ctx, q, entryID, EntitySupplier, objectID, "Supplier approval snapshot is unavailable")
	if err != nil {
		return EffectiveReference{}, err
	}
	row, err := q.GetDCLSupplierVersion(ctx, entryID)
	if err != nil {
		return EffectiveReference{}, s.internal("load Supplier snapshot", err)
	}
	object, err := q.GetDCLSubject(ctx, dbsqlc.GetDCLSubjectParams{ID: objectID, Entity: EntitySupplier})
	if err != nil {
		return EffectiveReference{}, s.internal("load Supplier identity", err)
	}
	return EffectiveReference{ObjectID: object.ID, Entity: object.Entity, Code: deref(object.Code), ApprovalEntryID: entry.ID, VersionNo: versionNumber(entry.VersionNo), Data: supplierDetail(row.Kind, row.LegalName, row.DisplayName, deref(row.LegalIdentifier), deref(row.ShortName), deref(row.ContactName), deref(row.ContactPhone), deref(row.Email), deref(row.Address), deref(row.Remark), deref(row.SettlementMethodID), deref(row.SettlementMethodCode), deref(row.SettlementMethodName), deref(row.SettlementTermCode), deref(row.SettlementRuleType), row.SettlementMonthOffset, row.SettlementDayOfMonth, row.SettlementDayOffset, row.DefaultOperatingEntityID, row.DefaultOperatingEntityApprovalEntryID, row.DefaultOperatingEntityCode, row.DefaultOperatingEntityName, deref(row.DefaultPurchaserEmployeeID), deref(row.DefaultPurchaserEmployeeApprovalEntryID), deref(row.DefaultPurchaserEmployeeCode), deref(row.DefaultPurchaserEmployeeName))}, nil
}

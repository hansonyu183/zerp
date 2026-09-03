package bob

import (
	"context"
	"errors"
	"strings"

	dbsqlc "github.com/hansonyu183/zerp/backend/internal/database/sqlc"
	"github.com/jackc/pgx/v5"
)

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

func (s *Service) ResolveCustomerSubunitReferences(ctx context.Context, tx pgx.Tx, customerKind, customerLegalIdentifier, settlementID, paymentID, attributionType, attributionID string) (EffectiveReference, EffectiveReference, EffectiveReference, error) {
	if tx == nil || !validID(attributionID) {
		return EffectiveReference{}, EffectiveReference{}, EffectiveReference{}, domainError(ErrorValidation, "invalid Customer Subunit references", nil, nil)
	}
	var settlement, payment EffectiveReference
	var err error
	if settlementID != "" {
		r, e := s.resolveNamedAuxiliaryReference(ctx, tx, "settlement-method", settlementID)
		err = e
		if err == nil {
			settlement = EffectiveReference{ObjectID: r.ObjectID, Entity: r.Entity, Code: r.Code, ApprovalEntryID: r.ApprovalEntryID, Data: DetailView{Name: mapString(r.Data, "name"), TermCode: mapString(r.Data, "termCode"), RuleType: mapString(r.Data, "ruleType"), DueDays: int32(mapInt(r.Data, "dayOffset")), MonthOffset: int32(mapInt(r.Data, "monthOffset")), CutoffDay: int32(mapInt(r.Data, "dayOfMonth")), DefaultSalesSurcharge: mapString(r.Data, "defaultSalesSurcharge")}}
		}
		if err != nil {
			return EffectiveReference{}, EffectiveReference{}, EffectiveReference{}, err
		}
	}
	if paymentID != "" {
		r, e := s.resolveNamedAuxiliaryReference(ctx, tx, "payment-method", paymentID)
		err = e
		if err == nil {
			payment = EffectiveReference{ObjectID: r.ObjectID, Entity: r.Entity, Code: r.Code, ApprovalEntryID: r.ApprovalEntryID, Data: DetailView{Name: mapString(r.Data, "name"), DefaultSalesSurcharge: mapString(r.Data, "defaultSalesSurcharge")}}
		}
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
		if err = s.ensureDifferentCustomerSalesIdentity(ctx, s.queries.WithTx(tx), customerKind, customerLegalIdentifier, attributionID); err != nil {
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
func (s *Service) ValidateCustomerSubunitReferences(ctx context.Context, tx pgx.Tx, customerKind, customerLegalIdentifier, attributionType, attributionID, attributionEntryID string) error {
	if tx == nil || !validID(attributionID) || !validID(attributionEntryID) {
		return domainError(ErrorValidation, "invalid Customer Subunit references", nil, nil)
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
		if err = s.ensureDifferentCustomerSalesIdentity(ctx, s.queries.WithTx(tx), customerKind, customerLegalIdentifier, attributionID); err != nil {
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
func (s *Service) ensureDifferentCustomerSalesIdentity(ctx context.Context, q *dbsqlc.Queries, customerKind, customerLegalIdentifier, salesPartnerID string) error {
	if customerKind == "OTHER" || customerLegalIdentifier == "" {
		return nil
	}
	entry, err := q.GetLatestApprovedVersion(ctx, dbsqlc.GetLatestApprovedVersionParams{Domain: "dcl", Entity: EntitySalesPartner, SubjectID: salesPartnerID})
	if errors.Is(err, pgx.ErrNoRows) {
		return domainError(ErrorConflict, "sales-partner has no approved typed version", nil, nil)
	}
	if err != nil {
		return s.internal("get sales-partner approved version", err)
	}
	sales, err := q.GetDCLSalesPartnerVersion(ctx, entry.ID)
	if err != nil {
		return s.internal("get sales-partner legal identifier", err)
	}
	comparableKind := ""
	switch customerKind {
	case "MAINLAND_INDIVIDUAL":
		comparableKind = "PERSON"
	case "MAINLAND_ENTERPRISE":
		comparableKind = "ORGANIZATION"
	}
	if sales.Kind != comparableKind {
		return nil
	}
	if customerLegalIdentifier != "" && strings.EqualFold(strings.TrimSpace(customerLegalIdentifier), deref(sales.LegalIdentifier)) {
		return domainError(ErrorConflict, "customer cannot attribute sales to the same business identity", nil, nil)
	}
	return nil
}

func archiveSnapshot(id, entry, code, name string) BusinessArchiveSnapshot {
	return BusinessArchiveSnapshot{SourceObjectID: id, ApprovalEntryID: entry, Code: code, Name: name}
}
func (s *Service) otherData(ctx context.Context, q *dbsqlc.Queries, row dbsqlc.GetBobOtherUnitCurrentTypedRow) (DetailView, error) {
	operating, err := q.ListDCLOtherUnitVersionOperatingEntities(ctx, row.ApprovalEntryID)
	if err != nil {
		return DetailView{}, err
	}
	data := DetailView{Name: row.DisplayName, Kind: row.Kind, LegalName: row.LegalName, DisplayName: row.DisplayName, LegalIdentifier: deref(row.LegalIdentifier), OperatingEntityIDs: make([]string, 0, len(operating)), OperatingEntities: make([]BusinessArchiveSnapshot, 0, len(operating)), DefaultOperatingEntityID: row.DefaultOperatingEntityID, ContactName: deref(row.ContactName), ContactPhone: deref(row.ContactPhone), Email: deref(row.Email), Address: deref(row.Address), Remark: deref(row.Remark), SettlementMethodID: deref(row.SettlementMethodID), SettlementMethodCode: deref(row.SettlementMethodCode), SettlementMethodName: deref(row.SettlementMethodName), TermCode: deref(row.SettlementTermCode), RuleType: deref(row.SettlementRuleType), MonthOffset: row.SettlementMonthOffset, DayOffset: row.SettlementDayOffset}
	for _, value := range operating {
		data.OperatingEntityIDs = append(data.OperatingEntityIDs, value.OperatingEntityID)
		data.OperatingEntities = append(data.OperatingEntities, archiveSnapshot(value.OperatingEntityID, value.OperatingEntityApprovalEntryID, value.OperatingEntityCode, value.OperatingEntityName))
	}
	if row.SettlementDayOfMonth != 0 {
		day := row.SettlementDayOfMonth
		data.DayOfMonth = &day
	}
	return data, nil
}
func (s *Service) salesData(ctx context.Context, q *dbsqlc.Queries, row dbsqlc.GetBobSalesPartnerCurrentTypedRow) (DetailView, error) {
	operating, err := q.ListDCLSalesPartnerVersionOperatingEntities(ctx, row.ApprovalEntryID)
	if err != nil {
		return DetailView{}, err
	}
	data := DetailView{Name: row.DisplayName, Kind: row.Kind, LegalName: row.LegalName, DisplayName: row.DisplayName, LegalIdentifier: deref(row.LegalIdentifier), OperatingEntityIDs: make([]string, 0, len(operating)), OperatingEntities: make([]BusinessArchiveSnapshot, 0, len(operating)), DefaultOperatingEntityID: row.DefaultOperatingEntityID, SalesCapabilities: row.Capabilities, ContactName: deref(row.ContactName), ContactPhone: deref(row.ContactPhone), Email: deref(row.Email), Address: deref(row.Address), Remark: deref(row.Remark)}
	for _, value := range operating {
		data.OperatingEntityIDs = append(data.OperatingEntityIDs, value.OperatingEntityID)
		data.OperatingEntities = append(data.OperatingEntities, archiveSnapshot(value.OperatingEntityID, value.OperatingEntityApprovalEntryID, value.OperatingEntityCode, value.OperatingEntityName))
	}
	return data, nil
}
func (s *Service) getOtherUnitCurrent(ctx context.Context, input GetInput) (ObjectView, error) {
	if !validID(input.ObjectID) {
		return ObjectView{}, domainError(ErrorValidation, "invalid Other Unit get request", nil, nil)
	}
	row, err := s.queries.GetBobOtherUnitCurrentTyped(ctx, input.ObjectID)
	if errors.Is(err, pgx.ErrNoRows) {
		return ObjectView{}, domainError(ErrorValidation, "Other Unit not found", nil, nil)
	}
	if err != nil {
		return ObjectView{}, s.internal("get Other Unit current", err)
	}
	data, err := s.otherData(ctx, s.queries, row)
	if err != nil {
		return ObjectView{}, s.internal("get Other Unit typed details", err)
	}
	code, err := requiredSubjectCode(row.Code)
	if err != nil {
		return ObjectView{}, err
	}
	return ObjectView{ObjectID: row.ObjectID, Entity: row.Entity, Code: code, Enabled: row.Enabled, SourceApprovalEntryID: row.ApprovalEntryID, SourceVersionNo: versionNumber(row.VersionNo), Data: data, UpdatedAt: row.UpdatedAt.Time}, nil
}
func (s *Service) getSalesPartnerCurrent(ctx context.Context, input GetInput) (ObjectView, error) {
	if !validID(input.ObjectID) {
		return ObjectView{}, domainError(ErrorValidation, "invalid Sales Partner get request", nil, nil)
	}
	row, err := s.queries.GetBobSalesPartnerCurrentTyped(ctx, input.ObjectID)
	if errors.Is(err, pgx.ErrNoRows) {
		return ObjectView{}, domainError(ErrorValidation, "Sales Partner not found", nil, nil)
	}
	if err != nil {
		return ObjectView{}, s.internal("get Sales Partner current", err)
	}
	data, err := s.salesData(ctx, s.queries, row)
	if err != nil {
		return ObjectView{}, s.internal("get Sales Partner typed details", err)
	}
	code, err := requiredSubjectCode(row.Code)
	if err != nil {
		return ObjectView{}, err
	}
	return ObjectView{ObjectID: row.ObjectID, Entity: row.Entity, Code: code, Enabled: row.Enabled, SourceApprovalEntryID: row.ApprovalEntryID, SourceVersionNo: versionNumber(row.VersionNo), Data: data, UpdatedAt: row.UpdatedAt.Time}, nil
}

func typedOtherListData(row dbsqlc.ListBobOtherUnitCurrentsTypedRow) DetailView {
	return DetailView{Name: row.DisplayName, Kind: row.Kind, LegalName: row.LegalName, DisplayName: row.DisplayName, LegalIdentifier: deref(row.LegalIdentifier), DefaultOperatingEntityID: row.DefaultOperatingEntityID, OperatingEntities: []BusinessArchiveSnapshot{archiveSnapshot(row.DefaultOperatingEntityID, row.DefaultOperatingEntityApprovalEntryID, row.DefaultOperatingEntityCode, row.DefaultOperatingEntityName)}, ContactName: deref(row.ContactName), ContactPhone: deref(row.ContactPhone), Email: deref(row.Email), Address: deref(row.Address), Remark: deref(row.Remark)}
}
func typedSalesListData(row dbsqlc.ListBobSalesPartnerCurrentsTypedRow) DetailView {
	return DetailView{Name: row.DisplayName, Kind: row.Kind, LegalName: row.LegalName, DisplayName: row.DisplayName, LegalIdentifier: deref(row.LegalIdentifier), DefaultOperatingEntityID: row.DefaultOperatingEntityID, OperatingEntities: []BusinessArchiveSnapshot{archiveSnapshot(row.DefaultOperatingEntityID, row.DefaultOperatingEntityApprovalEntryID, row.DefaultOperatingEntityCode, row.DefaultOperatingEntityName)}, SalesCapabilities: row.Capabilities, ContactName: deref(row.ContactName), ContactPhone: deref(row.ContactPhone), Email: deref(row.Email), Address: deref(row.Address), Remark: deref(row.Remark)}
}
func (s *Service) queryTypedArchiveCurrent(ctx context.Context, q *dbsqlc.Queries, entity string, input QueryInput) (Page[QueryItem], error) {
	offset, ok := pageOffset(input.Page, input.PageSize)
	if !ok || len(input.Sort) > 1 {
		return Page[QueryItem]{}, domainError(ErrorValidation, "invalid business archive query", nil, nil)
	}
	if len(input.Sort) == 1 && (input.Sort[0].Field != "code" || strings.ToLower(input.Sort[0].Order) != "asc") {
		return Page[QueryItem]{}, domainError(ErrorValidation, "invalid business archive query sort", nil, nil)
	}
	filters, err := validateQueryFilters(entity, input.Filters)
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
	if entity == EntityOtherUnit {
		params := dbsqlc.ListBobOtherUnitCurrentsTypedParams{Keyword: strings.TrimSpace(filters.Keyword), EnabledFilter: enabled, OperatingEntityID: filters.OperatingEntityID, RowOffset: offset, RowLimit: int32(input.PageSize)}
		rows, err := q.ListBobOtherUnitCurrentsTyped(ctx, params)
		if err != nil {
			return Page[QueryItem]{}, s.internal("list Other Unit current", err)
		}
		total, err := q.CountBobOtherUnitCurrentsTyped(ctx, dbsqlc.CountBobOtherUnitCurrentsTypedParams{Keyword: params.Keyword, EnabledFilter: enabled, OperatingEntityID: params.OperatingEntityID})
		if err != nil {
			return Page[QueryItem]{}, s.internal("count Other Unit current", err)
		}
		items := make([]QueryItem, 0, len(rows))
		for _, row := range rows {
			code, codeErr := requiredSubjectCode(row.Code)
			if codeErr != nil {
				return Page[QueryItem]{}, codeErr
			}
			items = append(items, QueryItem{ObjectID: row.ObjectID, Entity: EntityOtherUnit, Code: code, Enabled: row.Enabled, SourceApprovalEntryID: row.ApprovalEntryID, SourceVersionNo: versionNumber(row.VersionNo), Data: typedOtherListData(row), UpdatedAt: row.UpdatedAt.Time})
		}
		return Page[QueryItem]{Items: items, Total: total, Page: input.Page, PageSize: input.PageSize}, nil
	}
	params := dbsqlc.ListBobSalesPartnerCurrentsTypedParams{Keyword: strings.TrimSpace(filters.Keyword), EnabledFilter: enabled, OperatingEntityID: filters.OperatingEntityID, RowOffset: offset, RowLimit: int32(input.PageSize)}
	rows, err := q.ListBobSalesPartnerCurrentsTyped(ctx, params)
	if err != nil {
		return Page[QueryItem]{}, s.internal("list Sales Partner current", err)
	}
	total, err := q.CountBobSalesPartnerCurrentsTyped(ctx, dbsqlc.CountBobSalesPartnerCurrentsTypedParams{Keyword: params.Keyword, EnabledFilter: enabled, OperatingEntityID: params.OperatingEntityID})
	if err != nil {
		return Page[QueryItem]{}, s.internal("count Sales Partner current", err)
	}
	items := make([]QueryItem, 0, len(rows))
	for _, row := range rows {
		code, codeErr := requiredSubjectCode(row.Code)
		if codeErr != nil {
			return Page[QueryItem]{}, codeErr
		}
		items = append(items, QueryItem{ObjectID: row.ObjectID, Entity: EntitySalesPartner, Code: code, Enabled: row.Enabled, SourceApprovalEntryID: row.ApprovalEntryID, SourceVersionNo: versionNumber(row.VersionNo), Data: typedSalesListData(row), UpdatedAt: row.UpdatedAt.Time})
	}
	return Page[QueryItem]{Items: items, Total: total, Page: input.Page, PageSize: input.PageSize}, nil
}

func (s *Service) validateOtherUnitSnapshotReference(ctx context.Context, q *dbsqlc.Queries, objectID, entryID string) (EffectiveReference, error) {
	entry, err := s.requireHistoricalApprovalEntry(ctx, q, entryID, EntityOtherUnit, objectID, "Other Unit approval snapshot is unavailable")
	if err != nil {
		return EffectiveReference{}, err
	}
	row, err := q.GetDCLOtherUnitVersion(ctx, entryID)
	if err != nil {
		return EffectiveReference{}, s.internal("load Other Unit snapshot", err)
	}
	object, err := q.GetDCLSubject(ctx, dbsqlc.GetDCLSubjectParams{ID: objectID, Entity: EntityOtherUnit})
	if err != nil {
		return EffectiveReference{}, s.internal("load Other Unit identity", err)
	}
	code, codeErr := requiredSubjectCode(object.Code)
	if codeErr != nil {
		return EffectiveReference{}, codeErr
	}
	return EffectiveReference{ObjectID: object.ID, Entity: object.Entity, Code: code, ApprovalEntryID: entry.ID, VersionNo: versionNumber(entry.VersionNo), Data: DetailView{Name: row.DisplayName, Kind: row.Kind, LegalName: row.LegalName, DisplayName: row.DisplayName}}, nil
}
func (s *Service) validateSalesPartnerSnapshotReference(ctx context.Context, q *dbsqlc.Queries, objectID, entryID string) (EffectiveReference, error) {
	entry, err := s.requireHistoricalApprovalEntry(ctx, q, entryID, EntitySalesPartner, objectID, "Sales Partner approval snapshot is unavailable")
	if err != nil {
		return EffectiveReference{}, err
	}
	row, err := q.GetDCLSalesPartnerVersion(ctx, entryID)
	if err != nil {
		return EffectiveReference{}, s.internal("load Sales Partner snapshot", err)
	}
	object, err := q.GetDCLSubject(ctx, dbsqlc.GetDCLSubjectParams{ID: objectID, Entity: EntitySalesPartner})
	if err != nil {
		return EffectiveReference{}, s.internal("load Sales Partner identity", err)
	}
	code, codeErr := requiredSubjectCode(object.Code)
	if codeErr != nil {
		return EffectiveReference{}, codeErr
	}
	return EffectiveReference{ObjectID: object.ID, Entity: object.Entity, Code: code, ApprovalEntryID: entry.ID, VersionNo: versionNumber(entry.VersionNo), Data: DetailView{Name: row.DisplayName, Kind: row.Kind, LegalName: row.LegalName, DisplayName: row.DisplayName, SalesCapabilities: row.Capabilities}}, nil
}
func (s *Service) resolveOtherUnitCurrentReference(ctx context.Context, q *dbsqlc.Queries, objectID string) (EffectiveReference, error) {
	row, err := q.GetBobOtherUnitCurrentTyped(ctx, objectID)
	if errors.Is(err, pgx.ErrNoRows) {
		return EffectiveReference{}, domainError(ErrorConflict, "Other Unit reference has no enabled current version", nil, nil)
	}
	if err != nil {
		return EffectiveReference{}, s.internal("resolve Other Unit current", err)
	}
	if !row.Enabled {
		return EffectiveReference{}, domainError(ErrorConflict, "Other Unit reference has no enabled current version", nil, nil)
	}
	data, err := s.otherData(ctx, q, row)
	if err != nil {
		return EffectiveReference{}, s.internal("resolve Other Unit current details", err)
	}
	code, err := requiredSubjectCode(row.Code)
	if err != nil {
		return EffectiveReference{}, err
	}
	return EffectiveReference{ObjectID: row.ObjectID, Entity: row.Entity, Code: code, ApprovalEntryID: row.ApprovalEntryID, VersionNo: versionNumber(row.VersionNo), Data: data}, nil
}
func (s *Service) resolveSalesPartnerCurrentReference(ctx context.Context, q *dbsqlc.Queries, objectID string) (EffectiveReference, error) {
	row, err := q.GetBobSalesPartnerCurrentTypedReference(ctx, dbsqlc.GetBobSalesPartnerCurrentTypedReferenceParams{ObjectID: objectID})
	if errors.Is(err, pgx.ErrNoRows) {
		return EffectiveReference{}, domainError(ErrorConflict, "Sales Partner reference has no enabled current version", nil, nil)
	}
	if err != nil {
		return EffectiveReference{}, s.internal("resolve Sales Partner current", err)
	}
	reference, err := s.validateSalesPartnerSnapshotReference(ctx, q, row.ObjectID, row.ApprovalEntryID)
	if err != nil {
		return EffectiveReference{}, err
	}
	code, err := requiredSubjectCode(row.Code)
	if err != nil {
		return EffectiveReference{}, err
	}
	reference.Code, reference.Data.Name, reference.Data.DisplayName = code, row.DisplayName, row.DisplayName
	return reference, nil
}

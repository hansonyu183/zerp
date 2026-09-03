package dcl

import (
	"context"
	"errors"
	"strings"

	dbsqlc "github.com/hansonyu183/zerp/backend/internal/database/sqlc"
	"github.com/hansonyu183/zerp/backend/internal/platform/approval"
	"github.com/jackc/pgx/v5"
)

func archivePage(input TypedArchiveQueryInput) (int32, int32, []string, error) {
	offset, ok := dclPageOffset(input.Page, input.PageSize)
	if !ok {
		return 0, 0, nil, newError(ErrorValidation, "validation_failed", "invalid business archive query", nil, nil)
	}
	statuses := make([]string, 0, len(input.Filters.Status))
	for _, status := range input.Filters.Status {
		if status != approval.StatusDraft && status != approval.StatusPending && status != approval.StatusApproved {
			return 0, 0, nil, newError(ErrorValidation, "validation_failed", "invalid business archive status", nil, nil)
		}
		statuses = append(statuses, string(status))
	}
	enabled := int32(-1)
	if input.Filters.Enabled != nil {
		if *input.Filters.Enabled {
			enabled = 1
		} else {
			enabled = 0
		}
	}
	return offset, enabled, statuses, nil
}

func archiveDefault(row dbsqlc.ListDCLTypedArchivesRow) BusinessArchiveSnapshot {
	return BusinessArchiveSnapshot{SourceObjectID: row.DefaultOperatingEntityID, ApprovalEntryID: row.DefaultOperatingEntityApprovalEntryID, Code: row.DefaultOperatingEntityCode, Name: row.DefaultOperatingEntityName}
}

func (s *TypedArchiveService) QueryOtherUnits(ctx context.Context, input TypedArchiveQueryInput, actor approval.Actor) (Page[OtherUnitQueryItem], error) {
	offset, enabled, statuses, err := archivePage(input)
	if err != nil {
		return Page[OtherUnitQueryItem]{}, err
	}
	if err = s.other.Authorize(ctx, actor, "query"); err != nil {
		return Page[OtherUnitQueryItem]{}, translateError(err)
	}
	params := dbsqlc.ListDCLTypedArchivesParams{Entity: EntityOtherUnit, Keyword: strings.TrimSpace(input.Filters.Keyword), OperatingEntityID: strings.TrimSpace(input.Filters.OperatingEntityID), EnabledFilter: enabled, StatusFilter: statuses, RowOffset: offset, RowLimit: int32(input.PageSize)}
	rows, err := s.queries.ListDCLTypedArchives(ctx, params)
	if err != nil {
		return Page[OtherUnitQueryItem]{}, translateError(err)
	}
	total, err := s.queries.CountDCLTypedArchives(ctx, dbsqlc.CountDCLTypedArchivesParams{Entity: params.Entity, Keyword: params.Keyword, OperatingEntityID: params.OperatingEntityID, EnabledFilter: params.EnabledFilter, StatusFilter: params.StatusFilter})
	if err != nil {
		return Page[OtherUnitQueryItem]{}, translateError(err)
	}
	items := make([]OtherUnitQueryItem, 0, len(rows))
	for _, row := range rows {
		code, codeErr := requiredSubjectCode(row.Code)
		if codeErr != nil {
			return Page[OtherUnitQueryItem]{}, codeErr
		}
		item := OtherUnitQueryItem{ObjectID: row.ObjectID, Entity: EntityOtherUnit, Code: code, DisplayName: row.DisplayName, DefaultOperatingEntity: archiveDefault(row), UpdatedAt: row.UpdatedAt.Time}
		if row.ApprovedEntryID != "" {
			version, e := s.otherVersion(ctx, row.ApprovedEntryID, row.ObjectID)
			if e != nil {
				return Page[OtherUnitQueryItem]{}, e
			}
			item.LatestApproved = &version
		}
		if row.OpenEntryID != "" {
			version, e := s.otherVersion(ctx, row.OpenEntryID, row.ObjectID)
			if e != nil {
				return Page[OtherUnitQueryItem]{}, e
			}
			item.OpenVersion = &version
		}
		entry, ok, e := dclActiveEntry(ctx, s.queries, EntityOtherUnit, row.OpenEntryID, row.ApprovedEntryID)
		if e != nil {
			return Page[OtherUnitQueryItem]{}, e
		}
		if ok {
			item.AvailableApprovalActions = s.other.LifecycleActions(entry, actor)
		}
		items = append(items, item)
	}
	return Page[OtherUnitQueryItem]{Items: items, Total: total, Page: input.Page, PageSize: input.PageSize}, nil
}

func (s *TypedArchiveService) QuerySalesPartners(ctx context.Context, input TypedArchiveQueryInput, actor approval.Actor) (Page[SalesPartnerQueryItem], error) {
	offset, enabled, statuses, err := archivePage(input)
	if err != nil {
		return Page[SalesPartnerQueryItem]{}, err
	}
	if err = s.sales.Authorize(ctx, actor, "query"); err != nil {
		return Page[SalesPartnerQueryItem]{}, translateError(err)
	}
	params := dbsqlc.ListDCLTypedArchivesParams{Entity: EntitySalesPartner, Keyword: strings.TrimSpace(input.Filters.Keyword), OperatingEntityID: strings.TrimSpace(input.Filters.OperatingEntityID), EnabledFilter: enabled, StatusFilter: statuses, RowOffset: offset, RowLimit: int32(input.PageSize)}
	rows, err := s.queries.ListDCLTypedArchives(ctx, params)
	if err != nil {
		return Page[SalesPartnerQueryItem]{}, translateError(err)
	}
	total, err := s.queries.CountDCLTypedArchives(ctx, dbsqlc.CountDCLTypedArchivesParams{Entity: params.Entity, Keyword: params.Keyword, OperatingEntityID: params.OperatingEntityID, EnabledFilter: params.EnabledFilter, StatusFilter: params.StatusFilter})
	if err != nil {
		return Page[SalesPartnerQueryItem]{}, translateError(err)
	}
	items := make([]SalesPartnerQueryItem, 0, len(rows))
	for _, row := range rows {
		code, codeErr := requiredSubjectCode(row.Code)
		if codeErr != nil {
			return Page[SalesPartnerQueryItem]{}, codeErr
		}
		item := SalesPartnerQueryItem{ObjectID: row.ObjectID, Entity: EntitySalesPartner, Code: code, DisplayName: row.DisplayName, DefaultOperatingEntity: archiveDefault(row), UpdatedAt: row.UpdatedAt.Time}
		if row.ApprovedEntryID != "" {
			version, e := s.salesVersion(ctx, row.ApprovedEntryID, row.ObjectID)
			if e != nil {
				return Page[SalesPartnerQueryItem]{}, e
			}
			item.LatestApproved = &version
		}
		if row.OpenEntryID != "" {
			version, e := s.salesVersion(ctx, row.OpenEntryID, row.ObjectID)
			if e != nil {
				return Page[SalesPartnerQueryItem]{}, e
			}
			item.OpenVersion = &version
		}
		entry, ok, e := dclActiveEntry(ctx, s.queries, EntitySalesPartner, row.OpenEntryID, row.ApprovedEntryID)
		if e != nil {
			return Page[SalesPartnerQueryItem]{}, e
		}
		if ok {
			item.AvailableApprovalActions = s.sales.LifecycleActions(entry, actor)
		}
		items = append(items, item)
	}
	return Page[SalesPartnerQueryItem]{Items: items, Total: total, Page: input.Page, PageSize: input.PageSize}, nil
}

func (s *TypedArchiveService) otherVersion(ctx context.Context, entryID, objectID string) (OtherUnitVersionView, error) {
	entry, err := s.queries.GetApprovalEntry(ctx, dbsqlc.GetApprovalEntryParams{ID: entryID, Domain: "dcl", Entity: EntityOtherUnit})
	if err != nil {
		return OtherUnitVersionView{}, translateError(err)
	}
	if entry.SubjectID != objectID {
		return OtherUnitVersionView{}, newError(ErrorValidation, "validation_failed", "Other Unit version does not belong to subject", nil, nil)
	}
	data, err := s.loadOther(ctx, s.queries, entryID)
	if err != nil {
		return OtherUnitVersionView{}, err
	}
	return OtherUnitVersionView{Approval: approval.VersionMetaFromEntry(approvalEntry(entry)), Data: data}, nil
}
func (s *TypedArchiveService) salesVersion(ctx context.Context, entryID, objectID string) (SalesPartnerVersionView, error) {
	entry, err := s.queries.GetApprovalEntry(ctx, dbsqlc.GetApprovalEntryParams{ID: entryID, Domain: "dcl", Entity: EntitySalesPartner})
	if err != nil {
		return SalesPartnerVersionView{}, translateError(err)
	}
	if entry.SubjectID != objectID {
		return SalesPartnerVersionView{}, newError(ErrorValidation, "validation_failed", "Sales Partner version does not belong to subject", nil, nil)
	}
	data, err := s.loadSales(ctx, s.queries, entryID)
	if err != nil {
		return SalesPartnerVersionView{}, err
	}
	return SalesPartnerVersionView{Approval: approval.VersionMetaFromEntry(approvalEntry(entry)), Data: data}, nil
}

func (s *TypedArchiveService) GetOtherUnit(ctx context.Context, input TypedArchiveGetInput, actor approval.Actor) (OtherUnitView, error) {
	if !validID(input.ObjectID) || !validActor(actor) {
		return OtherUnitView{}, newError(ErrorValidation, "validation_failed", "invalid Other Unit get", nil, nil)
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return OtherUnitView{}, translateError(err)
	}
	defer tx.Rollback(ctx)
	entry, err := s.other.GetOpenVersion(ctx, tx, input.ObjectID, actor)
	if errors.Is(err, pgx.ErrNoRows) {
		row, e := s.queries.WithTx(tx).GetLatestApprovedVersion(ctx, dbsqlc.GetLatestApprovedVersionParams{Domain: "dcl", Entity: EntityOtherUnit, SubjectID: input.ObjectID})
		err = e
		if e == nil {
			entry, err = s.other.Get(ctx, tx, row.ID, actor)
		}
	}
	if err != nil || (input.ApprovalEntryID != "" && entry.ID != input.ApprovalEntryID) {
		if input.ApprovalEntryID != "" {
			entry, err = s.other.Get(ctx, tx, input.ApprovalEntryID, actor)
		}
		if err != nil || entry.SubjectID != input.ObjectID {
			return OtherUnitView{}, translateError(err)
		}
	}
	id, err := lockSubject(ctx, tx, EntityOtherUnit, input.ObjectID)
	if err != nil {
		return OtherUnitView{}, translateError(err)
	}
	data, err := s.loadOther(ctx, s.queries.WithTx(tx), entry.ID)
	if err != nil {
		return OtherUnitView{}, err
	}
	return OtherUnitView{ObjectID: id.ObjectID, Entity: EntityOtherUnit, Code: id.Code, Approval: approval.VersionMetaFromEntry(entry), Data: data, UpdatedAt: entry.UpdatedAt, AvailableApprovalActions: s.other.LifecycleActions(entry, actor)}, nil
}
func (s *TypedArchiveService) GetSalesPartner(ctx context.Context, input TypedArchiveGetInput, actor approval.Actor) (SalesPartnerView, error) {
	if !validID(input.ObjectID) || !validActor(actor) {
		return SalesPartnerView{}, newError(ErrorValidation, "validation_failed", "invalid Sales Partner get", nil, nil)
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return SalesPartnerView{}, translateError(err)
	}
	defer tx.Rollback(ctx)
	entry, err := s.sales.GetOpenVersion(ctx, tx, input.ObjectID, actor)
	if errors.Is(err, pgx.ErrNoRows) {
		row, e := s.queries.WithTx(tx).GetLatestApprovedVersion(ctx, dbsqlc.GetLatestApprovedVersionParams{Domain: "dcl", Entity: EntitySalesPartner, SubjectID: input.ObjectID})
		err = e
		if e == nil {
			entry, err = s.sales.Get(ctx, tx, row.ID, actor)
		}
	}
	if err != nil || (input.ApprovalEntryID != "" && entry.ID != input.ApprovalEntryID) {
		if input.ApprovalEntryID != "" {
			entry, err = s.sales.Get(ctx, tx, input.ApprovalEntryID, actor)
		}
		if err != nil || entry.SubjectID != input.ObjectID {
			return SalesPartnerView{}, translateError(err)
		}
	}
	id, err := lockSubject(ctx, tx, EntitySalesPartner, input.ObjectID)
	if err != nil {
		return SalesPartnerView{}, translateError(err)
	}
	data, err := s.loadSales(ctx, s.queries.WithTx(tx), entry.ID)
	if err != nil {
		return SalesPartnerView{}, err
	}
	return SalesPartnerView{ObjectID: id.ObjectID, Entity: EntitySalesPartner, Code: id.Code, Approval: approval.VersionMetaFromEntry(entry), Data: data, UpdatedAt: entry.UpdatedAt, AvailableApprovalActions: s.sales.LifecycleActions(entry, actor)}, nil
}

func (s *TypedArchiveService) OtherUnitVersions(ctx context.Context, input TypedArchiveHistoryInput, actor approval.Actor) (Page[OtherUnitVersionView], error) {
	return s.otherVersions(ctx, input, actor)
}
func (s *TypedArchiveService) otherVersions(ctx context.Context, input TypedArchiveHistoryInput, actor approval.Actor) (Page[OtherUnitVersionView], error) {
	if _, ok := dclPageOffset(input.Page, input.PageSize); !ok || !validID(input.ObjectID) {
		return Page[OtherUnitVersionView]{}, newError(ErrorValidation, "validation_failed", "invalid Other Unit history", nil, nil)
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return Page[OtherUnitVersionView]{}, translateError(err)
	}
	defer tx.Rollback(ctx)
	entries, err := s.other.ListVersions(ctx, tx, input.ObjectID, actor)
	if err != nil {
		return Page[OtherUnitVersionView]{}, translateError(err)
	}
	items := make([]OtherUnitVersionView, 0, len(entries))
	for _, entry := range entries {
		item, e := s.otherVersion(ctx, entry.ID, input.ObjectID)
		if e != nil {
			return Page[OtherUnitVersionView]{}, e
		}
		items = append(items, item)
	}
	return Page[OtherUnitVersionView]{Items: items, Total: int64(len(items)), Page: input.Page, PageSize: input.PageSize}, nil
}
func (s *TypedArchiveService) SalesPartnerVersions(ctx context.Context, input TypedArchiveHistoryInput, actor approval.Actor) (Page[SalesPartnerVersionView], error) {
	if _, ok := dclPageOffset(input.Page, input.PageSize); !ok || !validID(input.ObjectID) {
		return Page[SalesPartnerVersionView]{}, newError(ErrorValidation, "validation_failed", "invalid Sales Partner history", nil, nil)
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return Page[SalesPartnerVersionView]{}, translateError(err)
	}
	defer tx.Rollback(ctx)
	entries, err := s.sales.ListVersions(ctx, tx, input.ObjectID, actor)
	if err != nil {
		return Page[SalesPartnerVersionView]{}, translateError(err)
	}
	items := make([]SalesPartnerVersionView, 0, len(entries))
	for _, entry := range entries {
		item, e := s.salesVersion(ctx, entry.ID, input.ObjectID)
		if e != nil {
			return Page[SalesPartnerVersionView]{}, e
		}
		items = append(items, item)
	}
	return Page[SalesPartnerVersionView]{Items: items, Total: int64(len(items)), Page: input.Page, PageSize: input.PageSize}, nil
}
func (s *TypedArchiveService) OtherUnitAuditHistory(ctx context.Context, input TypedArchiveHistoryInput, actor approval.Actor) (Page[approval.EventView], error) {
	return s.archiveAudit(ctx, EntityOtherUnit, input, actor)
}
func (s *TypedArchiveService) SalesPartnerAuditHistory(ctx context.Context, input TypedArchiveHistoryInput, actor approval.Actor) (Page[approval.EventView], error) {
	return s.archiveAudit(ctx, EntitySalesPartner, input, actor)
}
func (s *TypedArchiveService) archiveAudit(ctx context.Context, entity string, input TypedArchiveHistoryInput, actor approval.Actor) (Page[approval.EventView], error) {
	offset, ok := dclPageOffset(input.Page, input.PageSize)
	if !ok || !validID(input.ObjectID) {
		return Page[approval.EventView]{}, newError(ErrorValidation, "validation_failed", "invalid business archive audit", nil, nil)
	}
	var err error
	if entity == EntityOtherUnit {
		err = s.other.Authorize(ctx, actor, "audit-history")
	} else {
		err = s.sales.Authorize(ctx, actor, "audit-history")
	}
	if err != nil {
		return Page[approval.EventView]{}, translateError(err)
	}
	rows, err := s.queries.ListDCLTypedArchiveApprovalEvents(ctx, dbsqlc.ListDCLTypedArchiveApprovalEventsParams{Entity: entity, ObjectID: input.ObjectID, RowOffset: offset, RowLimit: int32(input.PageSize)})
	if err != nil {
		return Page[approval.EventView]{}, translateError(err)
	}
	total, err := s.queries.CountDCLTypedArchiveApprovalEvents(ctx, dbsqlc.CountDCLTypedArchiveApprovalEventsParams{Entity: entity, ObjectID: input.ObjectID})
	if err != nil {
		return Page[approval.EventView]{}, translateError(err)
	}
	items := make([]approval.EventView, 0, len(rows))
	for _, row := range rows {
		items = append(items, approvalEventView(row))
	}
	return Page[approval.EventView]{Items: items, Total: total, Page: input.Page, PageSize: input.PageSize}, nil
}

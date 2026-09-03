package dcl

import (
	"context"
	"errors"
	dbsqlc "github.com/hansonyu183/zerp/backend/internal/database/sqlc"
	"github.com/hansonyu183/zerp/backend/internal/platform/approval"
	"github.com/jackc/pgx/v5"
	"slices"
	"strings"
)

func (s *SupplierService) Query(ctx context.Context, in SupplierQueryInput, a approval.Actor) (Page[SupplierQueryItem], error) {
	off, ok := dclPageOffset(in.Page, in.PageSize)
	if !ok || !validActor(a) || len(in.Sort) > 1 {
		return Page[SupplierQueryItem]{}, newError(ErrorValidation, "validation_failed", "invalid supplier query", nil, nil)
	}
	if e := s.coordinator.Authorize(ctx, a, "query"); e != nil {
		return Page[SupplierQueryItem]{}, translateError(e)
	}
	statuses := make([]string, 0, len(in.Filters.Status))
	for _, x := range in.Filters.Status {
		if !slices.Contains([]approval.Status{approval.StatusDraft, approval.StatusPending, approval.StatusApproved}, x) || slices.Contains(statuses, string(x)) {
			return Page[SupplierQueryItem]{}, newError(ErrorValidation, "validation_failed", "invalid supplier status", nil, nil)
		}
		statuses = append(statuses, string(x))
	}
	field, order := "updatedAt", "desc"
	if len(in.Sort) == 1 {
		field, order = in.Sort[0].Field, strings.ToLower(in.Sort[0].Order)
		if !slices.Contains([]string{"updatedAt", "code", "name"}, field) || !slices.Contains([]string{"asc", "desc"}, order) {
			return Page[SupplierQueryItem]{}, newError(ErrorValidation, "validation_failed", "invalid supplier sort", nil, nil)
		}
	}
	enabled := int32(-1)
	if in.Filters.Enabled != nil {
		if *in.Filters.Enabled {
			enabled = 1
		} else {
			enabled = 0
		}
	}
	p := dbsqlc.ListDCLSuppliersParams{Keyword: strings.TrimSpace(in.Filters.Keyword), EnabledFilter: enabled, StatusFilter: statuses, SortField: field, SortOrder: order, RowOffset: off, RowLimit: int32(in.PageSize)}
	rows, e := s.queries.ListDCLSuppliers(ctx, p)
	if e != nil {
		return Page[SupplierQueryItem]{}, translateError(e)
	}
	total, e := s.queries.CountDCLSuppliers(ctx, dbsqlc.CountDCLSuppliersParams{Keyword: p.Keyword, EnabledFilter: p.EnabledFilter, StatusFilter: p.StatusFilter})
	if e != nil {
		return Page[SupplierQueryItem]{}, translateError(e)
	}
	items := make([]SupplierQueryItem, 0, len(rows))
	for _, r := range rows {
		code, codeErr := requiredSubjectCode(r.Code)
		if codeErr != nil {
			return Page[SupplierQueryItem]{}, codeErr
		}
		i := SupplierQueryItem{ObjectID: r.ObjectID, Entity: EntitySupplier, Code: code, DisplayName: r.DisplayName, DefaultOperatingEntity: SupplierOperatingEntitySnapshot{SourceObjectID: r.DefaultOperatingEntityID, ApprovalEntryID: r.DefaultOperatingEntityApprovalEntryID, Code: r.DefaultOperatingEntityCode, Name: r.DefaultOperatingEntityName}, UpdatedAt: r.UpdatedAt.Time}
		if r.LatestApprovedEntryID != "" {
			v, x := s.version(ctx, s.queries, r.LatestApprovedEntryID, r.ObjectID)
			if x != nil {
				return Page[SupplierQueryItem]{}, x
			}
			i.LatestApproved = &v
		}
		if r.OpenEntryID != "" {
			v, x := s.version(ctx, s.queries, r.OpenEntryID, r.ObjectID)
			if x != nil {
				return Page[SupplierQueryItem]{}, x
			}
			i.OpenVersion = &v
		}
		entry, found, x := dclActiveEntry(ctx, s.queries, EntitySupplier, r.OpenEntryID, r.LatestApprovedEntryID)
		if x != nil {
			return Page[SupplierQueryItem]{}, x
		}
		if found {
			i.AvailableApprovalActions = s.coordinator.LifecycleActions(entry, a)
		}
		items = append(items, i)
	}
	return Page[SupplierQueryItem]{Items: items, Total: total, Page: in.Page, PageSize: in.PageSize}, nil
}
func (s *SupplierService) Get(ctx context.Context, in SupplierGetInput, a approval.Actor) (SupplierView, error) {
	if !validID(in.ObjectID) || (in.ApprovalEntryID != "" && !validID(in.ApprovalEntryID)) || !validActor(a) {
		return SupplierView{}, newError(ErrorValidation, "validation_failed", "invalid supplier get", nil, nil)
	}
	tx, e := s.pool.Begin(ctx)
	if e != nil {
		return SupplierView{}, translateError(e)
	}
	defer tx.Rollback(ctx)
	id := in.ApprovalEntryID
	var entry approval.Entry
	if id == "" {
		entry, e = s.coordinator.GetOpenVersion(ctx, tx, in.ObjectID, a)
		if approval.IsKey(e, "approval_version_not_found") {
			r, x := s.queries.WithTx(tx).GetLatestApprovedVersion(ctx, dbsqlc.GetLatestApprovedVersionParams{Domain: "dcl", Entity: EntitySupplier, SubjectID: in.ObjectID})
			e = x
			if x == nil {
				id = r.ID
				entry, e = s.coordinator.Get(ctx, tx, id, a)
			}
		} else if e == nil {
			id = entry.ID
		}
	} else {
		entry, e = s.coordinator.Get(ctx, tx, id, a)
	}
	if e != nil || entry.SubjectID != in.ObjectID {
		if e == nil {
			e = newError(ErrorValidation, "validation_failed", "supplier declaration not found", nil, nil)
		}
		return SupplierView{}, translateError(e)
	}
	identity, e := lockSubject(ctx, tx, EntitySupplier, in.ObjectID)
	if e != nil {
		return SupplierView{}, translateError(e)
	}
	d, e := s.loadData(ctx, s.queries.WithTx(tx), id)
	if e != nil {
		return SupplierView{}, e
	}
	return SupplierView{ObjectID: identity.ObjectID, Entity: EntitySupplier, Code: identity.Code, Approval: approval.VersionMetaFromEntry(entry), Data: d, UpdatedAt: entry.UpdatedAt, AvailableApprovalActions: s.coordinator.LifecycleActions(entry, a)}, nil
}
func (s *SupplierService) Versions(ctx context.Context, in SupplierHistoryInput, a approval.Actor) (Page[SupplierVersionView], error) {
	if _, ok := dclPageOffset(in.Page, in.PageSize); !ok || !validID(in.ObjectID) || !validActor(a) {
		return Page[SupplierVersionView]{}, newError(ErrorValidation, "validation_failed", "invalid supplier history", nil, nil)
	}
	tx, e := s.pool.Begin(ctx)
	if e != nil {
		return Page[SupplierVersionView]{}, translateError(e)
	}
	defer tx.Rollback(ctx)
	entries, e := s.coordinator.ListVersions(ctx, tx, in.ObjectID, a)
	if e != nil {
		return Page[SupplierVersionView]{}, translateError(e)
	}
	start := (in.Page - 1) * in.PageSize
	if start > len(entries) {
		start = len(entries)
	}
	end := min(start+in.PageSize, len(entries))
	items := make([]SupplierVersionView, 0, end-start)
	q := s.queries.WithTx(tx)
	for _, entry := range entries[start:end] {
		v, x := s.version(ctx, q, entry.ID, in.ObjectID)
		if x != nil {
			return Page[SupplierVersionView]{}, x
		}
		items = append(items, v)
	}
	return Page[SupplierVersionView]{Items: items, Total: int64(len(entries)), Page: in.Page, PageSize: in.PageSize}, nil
}
func (s *SupplierService) AuditHistory(ctx context.Context, in SupplierHistoryInput, a approval.Actor) (Page[approval.EventView], error) {
	off, ok := dclPageOffset(in.Page, in.PageSize)
	if !ok || !validID(in.ObjectID) || !validActor(a) {
		return Page[approval.EventView]{}, newError(ErrorValidation, "validation_failed", "invalid supplier audit history", nil, nil)
	}
	if e := s.coordinator.Authorize(ctx, a, "audit-history"); e != nil {
		return Page[approval.EventView]{}, translateError(e)
	}
	if _, e := s.queries.GetDCLSubject(ctx, dbsqlc.GetDCLSubjectParams{ID: in.ObjectID, Entity: EntitySupplier}); e != nil {
		if errors.Is(e, pgx.ErrNoRows) {
			return Page[approval.EventView]{}, newError(ErrorValidation, "validation_failed", "supplier declaration not found", nil, e)
		}
		return Page[approval.EventView]{}, translateError(e)
	}
	rows, e := s.queries.ListDCLSupplierApprovalEvents(ctx, dbsqlc.ListDCLSupplierApprovalEventsParams{ObjectID: in.ObjectID, RowOffset: off, RowLimit: int32(in.PageSize)})
	if e != nil {
		return Page[approval.EventView]{}, translateError(e)
	}
	total, e := s.queries.CountDCLSupplierApprovalEvents(ctx, in.ObjectID)
	if e != nil {
		return Page[approval.EventView]{}, translateError(e)
	}
	items := make([]approval.EventView, 0, len(rows))
	for _, r := range rows {
		items = append(items, approvalEventView(r))
	}
	return Page[approval.EventView]{Items: items, Total: total, Page: in.Page, PageSize: in.PageSize}, nil
}
func (s *SupplierService) version(ctx context.Context, q *dbsqlc.Queries, id, objectID string) (SupplierVersionView, error) {
	r, e := q.GetApprovalEntry(ctx, dbsqlc.GetApprovalEntryParams{ID: id, Domain: "dcl", Entity: EntitySupplier})
	if e != nil {
		return SupplierVersionView{}, translateError(e)
	}
	if r.SubjectID != objectID {
		return SupplierVersionView{}, newError(ErrorValidation, "validation_failed", "supplier version does not belong to subject", nil, nil)
	}
	d, e := s.loadData(ctx, q, id)
	if e != nil {
		return SupplierVersionView{}, e
	}
	return SupplierVersionView{Approval: approval.VersionMetaFromEntry(approvalEntry(r)), Data: d}, nil
}

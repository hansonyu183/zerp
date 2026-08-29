package dcl

import (
	"context"
	"errors"
	"slices"
	"strings"

	dbsqlc "github.com/hansonyu183/zerp/backend/internal/database/sqlc"
	"github.com/hansonyu183/zerp/backend/internal/platform/approval"
	"github.com/jackc/pgx/v5"
)

func (s *SupplierService) Query(ctx context.Context, in SupplierQueryInput, actor approval.Actor) (Page[SupplierQueryItem], error) {
	offset, ok := dclPageOffset(in.Page, in.PageSize)
	if !ok || !validActor(actor) || len(in.Sort) > 1 {
		return Page[SupplierQueryItem]{}, newError(ErrorValidation, "validation_failed", "invalid supplier query", nil, nil)
	}
	if err := s.coordinator.Authorize(ctx, actor, "query"); err != nil {
		return Page[SupplierQueryItem]{}, translateError(err)
	}
	statuses := make([]string, 0, len(in.Filters.Status))
	for _, status := range in.Filters.Status {
		if !slices.Contains([]approval.Status{approval.StatusDraft, approval.StatusPending, approval.StatusApproved}, status) || slices.Contains(statuses, string(status)) {
			return Page[SupplierQueryItem]{}, newError(ErrorValidation, "validation_failed", "invalid supplier status", nil, nil)
		}
		statuses = append(statuses, string(status))
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
	p := dbsqlc.ListDCLSuppliersParams{Keyword: strings.TrimSpace(in.Filters.Keyword), EnabledFilter: enabled, OperatingEntityID: strings.TrimSpace(in.Filters.OperatingEntityID), StatusFilter: statuses, SortField: field, SortOrder: order, RowOffset: offset, RowLimit: int32(in.PageSize)}
	rows, err := s.queries.ListDCLSuppliers(ctx, p)
	if err != nil {
		return Page[SupplierQueryItem]{}, translateError(err)
	}
	total, err := s.queries.CountDCLSuppliers(ctx, dbsqlc.CountDCLSuppliersParams{Keyword: p.Keyword, EnabledFilter: p.EnabledFilter, OperatingEntityID: p.OperatingEntityID, StatusFilter: p.StatusFilter})
	if err != nil {
		return Page[SupplierQueryItem]{}, translateError(err)
	}
	items := make([]SupplierQueryItem, 0, len(rows))
	for _, r := range rows {
		item := SupplierQueryItem{RelationshipIdentityView: RelationshipIdentityView{ObjectID: r.ObjectID, Entity: EntitySupplier, Code: r.Code, ObjectRevision: r.ObjectRevision, PartyID: r.PartyID, PartyKind: r.PartyKind, PartyDisplayName: r.DisplayName, OperatingEntityID: r.OperatingEntityID, Enabled: r.Enabled}, OperatingEntityCode: stringValue(r.OperatingEntityCode), OperatingEntityName: r.OperatingEntityName, UpdatedAt: r.UpdatedAt.Time}
		if r.LatestApprovedEntryID != "" {
			v, e := s.version(ctx, s.queries, r.LatestApprovedEntryID, r.ObjectID)
			if e != nil {
				return Page[SupplierQueryItem]{}, e
			}
			item.LatestApproved = &v
		}
		if r.OpenEntryID != "" {
			v, e := s.version(ctx, s.queries, r.OpenEntryID, r.ObjectID)
			if e != nil {
				return Page[SupplierQueryItem]{}, e
			}
			item.OpenVersion = &v
		}
		items = append(items, item)
	}
	return Page[SupplierQueryItem]{Items: items, Total: total, Page: in.Page, PageSize: in.PageSize}, nil
}
func (s *SupplierService) Get(ctx context.Context, in SupplierGetInput, actor approval.Actor) (SupplierView, error) {
	if !validID(in.ObjectID) || (in.ApprovalEntryID != "" && !validID(in.ApprovalEntryID)) || !validActor(actor) {
		return SupplierView{}, newError(ErrorValidation, "validation_failed", "invalid supplier get", nil, nil)
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return SupplierView{}, translateError(err)
	}
	defer tx.Rollback(ctx)
	entryID := in.ApprovalEntryID
	var e approval.Entry
	if entryID == "" {
		e, err = s.coordinator.GetOpenVersion(ctx, tx, in.ObjectID, actor)
		if approval.IsKey(err, "approval_version_not_found") {
			row, x := s.queries.WithTx(tx).GetLatestApprovedVersion(ctx, dbsqlc.GetLatestApprovedVersionParams{Domain: "dcl", Entity: EntitySupplier, SubjectID: in.ObjectID})
			err = x
			if x == nil {
				entryID = row.ID
				e, err = s.coordinator.Get(ctx, tx, entryID, actor)
			}
		} else if err == nil {
			entryID = e.ID
		}
	} else {
		e, err = s.coordinator.Get(ctx, tx, entryID, actor)
	}
	if err != nil || e.SubjectID != in.ObjectID {
		if err == nil {
			err = newError(ErrorValidation, "validation_failed", "supplier declaration not found", nil, nil)
		}
		return SupplierView{}, translateError(err)
	}
	id, err := s.current.GetSupplierIdentity(ctx, tx, in.ObjectID)
	if err != nil {
		return SupplierView{}, translateError(err)
	}
	stored, err := s.queries.WithTx(tx).GetDCLSupplierVersion(ctx, entryID)
	if err != nil {
		return SupplierView{}, translateError(err)
	}
	operating, err := s.current.ResolveLatestApprovedReference(ctx, tx, EntityOperatingEntity, id.OperatingEntityID)
	if err != nil {
		return SupplierView{}, translateError(err)
	}
	return SupplierView{RelationshipIdentityView: RelationshipIdentityView{ObjectID: id.ObjectID, Entity: EntitySupplier, Code: id.Code, ObjectRevision: id.ObjectRevision, PartyID: id.PartyID, PartyKind: stored.PartyKind, PartyDisplayName: stored.DisplayName, OperatingEntityID: id.OperatingEntityID, Enabled: stored.Enabled, Approval: approval.VersionMetaFromEntry(e)}, OperatingEntityApprovalEntryID: operating.ApprovalEntryID, OperatingEntityCode: operating.Code, OperatingEntityName: operating.Data.Name, Data: supplierStored(stored), UpdatedAt: e.UpdatedAt}, nil
}
func (s *SupplierService) Versions(ctx context.Context, in SupplierHistoryInput, actor approval.Actor) (Page[SupplierVersionView], error) {
	if _, ok := dclPageOffset(in.Page, in.PageSize); !ok || !validID(in.ObjectID) || !validActor(actor) {
		return Page[SupplierVersionView]{}, newError(ErrorValidation, "validation_failed", "invalid supplier history", nil, nil)
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return Page[SupplierVersionView]{}, translateError(err)
	}
	defer tx.Rollback(ctx)
	entries, err := s.coordinator.ListVersions(ctx, tx, in.ObjectID, actor)
	if err != nil {
		return Page[SupplierVersionView]{}, translateError(err)
	}
	start := (in.Page - 1) * in.PageSize
	if start > len(entries) {
		start = len(entries)
	}
	end := min(start+in.PageSize, len(entries))
	items := make([]SupplierVersionView, 0, end-start)
	for _, e := range entries[start:end] {
		v, x := s.version(ctx, s.queries, e.ID, in.ObjectID)
		if x != nil {
			return Page[SupplierVersionView]{}, x
		}
		items = append(items, v)
	}
	return Page[SupplierVersionView]{Items: items, Total: int64(len(entries)), Page: in.Page, PageSize: in.PageSize}, nil
}
func (s *SupplierService) AuditHistory(ctx context.Context, in SupplierHistoryInput, actor approval.Actor) (Page[approval.EventView], error) {
	offset, ok := dclPageOffset(in.Page, in.PageSize)
	if !ok || !validID(in.ObjectID) || !validActor(actor) {
		return Page[approval.EventView]{}, newError(ErrorValidation, "validation_failed", "invalid supplier audit history", nil, nil)
	}
	if err := s.coordinator.Authorize(ctx, actor, "audit-history"); err != nil {
		return Page[approval.EventView]{}, translateError(err)
	}
	if _, err := s.queries.GetDCLSubject(ctx, dbsqlc.GetDCLSubjectParams{ID: in.ObjectID, Entity: EntitySupplier}); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Page[approval.EventView]{}, newError(ErrorValidation, "validation_failed", "supplier declaration not found", nil, err)
		}
		return Page[approval.EventView]{}, translateError(err)
	}
	rows, err := s.queries.ListDCLSupplierApprovalEvents(ctx, dbsqlc.ListDCLSupplierApprovalEventsParams{ObjectID: in.ObjectID, RowOffset: offset, RowLimit: int32(in.PageSize)})
	if err != nil {
		return Page[approval.EventView]{}, translateError(err)
	}
	total, err := s.queries.CountDCLSupplierApprovalEvents(ctx, in.ObjectID)
	if err != nil {
		return Page[approval.EventView]{}, translateError(err)
	}
	items := make([]approval.EventView, 0, len(rows))
	for _, r := range rows {
		items = append(items, approvalEventView(r))
	}
	return Page[approval.EventView]{Items: items, Total: total, Page: in.Page, PageSize: in.PageSize}, nil
}
func (s *SupplierService) version(ctx context.Context, q *dbsqlc.Queries, entryID, objectID string) (SupplierVersionView, error) {
	e, err := q.GetApprovalEntry(ctx, dbsqlc.GetApprovalEntryParams{ID: entryID, Domain: "dcl", Entity: EntitySupplier})
	if err != nil {
		return SupplierVersionView{}, translateError(err)
	}
	if e.SubjectID != objectID {
		return SupplierVersionView{}, newError(ErrorValidation, "validation_failed", "supplier version does not belong to subject", nil, nil)
	}
	r, err := q.GetDCLSupplierVersion(ctx, entryID)
	if err != nil {
		return SupplierVersionView{}, translateError(err)
	}
	return SupplierVersionView{Approval: approval.VersionMetaFromEntry(approvalEntry(e)), Enabled: r.Enabled, Data: supplierStored(r)}, nil
}

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

func (s *WarehouseService) Query(ctx context.Context, input WarehouseQueryInput, actor approval.Actor) (Page[WarehouseQueryItem], error) {
	offset, ok := dclPageOffset(input.Page, input.PageSize)
	if !ok || !validActor(actor) || len(input.Sort) > 1 {
		return Page[WarehouseQueryItem]{}, newError(ErrorValidation, "validation_failed", "invalid warehouse declaration query", nil, nil)
	}
	if err := s.coordinator.Authorize(ctx, actor, "query"); err != nil {
		return Page[WarehouseQueryItem]{}, translateError(err)
	}
	statuses := make([]string, 0, len(input.Filters.Status))
	for _, status := range input.Filters.Status {
		if !slices.Contains([]approval.Status{approval.StatusDraft, approval.StatusPending, approval.StatusApproved}, status) || slices.Contains(statuses, string(status)) {
			return Page[WarehouseQueryItem]{}, newError(ErrorValidation, "validation_failed", "invalid warehouse declaration status filter", nil, nil)
		}
		statuses = append(statuses, string(status))
	}
	field, order := "updatedAt", "desc"
	if len(input.Sort) == 1 {
		field, order = input.Sort[0].Field, strings.ToLower(input.Sort[0].Order)
		if !slices.Contains([]string{"updatedAt", "code", "name", "status", "version"}, field) || !slices.Contains([]string{"asc", "desc"}, order) {
			return Page[WarehouseQueryItem]{}, newError(ErrorValidation, "validation_failed", "invalid warehouse declaration sort", nil, nil)
		}
	}
	enabled := int32(-1)
	if input.Filters.Enabled != nil {
		if *input.Filters.Enabled {
			enabled = 1
		} else {
			enabled = 0
		}
	}
	params := dbsqlc.ListDCLWarehousesParams{Keyword: strings.TrimSpace(input.Filters.Keyword), EnabledFilter: enabled, StatusFilter: statuses, SortField: field, SortOrder: order, RowOffset: offset, RowLimit: int32(input.PageSize)}
	rows, err := s.queries.ListDCLWarehouses(ctx, params)
	if err != nil {
		return Page[WarehouseQueryItem]{}, translateError(err)
	}
	total, err := s.queries.CountDCLWarehouses(ctx, dbsqlc.CountDCLWarehousesParams{Keyword: params.Keyword, EnabledFilter: params.EnabledFilter, StatusFilter: params.StatusFilter})
	if err != nil {
		return Page[WarehouseQueryItem]{}, translateError(err)
	}
	items := make([]WarehouseQueryItem, 0, len(rows))
	for _, r := range rows {
		item := WarehouseQueryItem{ObjectID: r.ObjectID, Entity: EntityWarehouse, Code: stringValue(r.Code), ObjectRevision: r.ObjectRevision, Enabled: r.Enabled, UpdatedAt: r.UpdatedAt.Time}
		if r.ApprovedEntryID != "" {
			v, e := s.loadVersionView(ctx, s.queries, r.ApprovedEntryID, r.ObjectID)
			if e != nil {
				return Page[WarehouseQueryItem]{}, e
			}
			item.LatestApproved = &v
		}
		if r.OpenEntryID != "" {
			v, e := s.loadVersionView(ctx, s.queries, r.OpenEntryID, r.ObjectID)
			if e != nil {
				return Page[WarehouseQueryItem]{}, e
			}
			item.OpenVersion = &v
		}
		items = append(items, item)
	}
	return Page[WarehouseQueryItem]{Items: items, Total: total, Page: input.Page, PageSize: input.PageSize}, nil
}

func (s *WarehouseService) Get(ctx context.Context, input WarehouseGetInput, actor approval.Actor) (WarehouseView, error) {
	if !validID(input.ObjectID) || (input.ApprovalEntryID != "" && !validID(input.ApprovalEntryID)) || !validActor(actor) {
		return WarehouseView{}, newError(ErrorValidation, "validation_failed", "invalid warehouse declaration get request", nil, nil)
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return WarehouseView{}, translateError(err)
	}
	defer tx.Rollback(ctx)
	id := input.ApprovalEntryID
	var entry approval.Entry
	if id == "" {
		entry, err = s.coordinator.GetOpenVersion(ctx, tx, input.ObjectID, actor)
		if approval.IsKey(err, "approval_version_not_found") {
			r, e := s.queries.WithTx(tx).GetLatestApprovedVersion(ctx, dbsqlc.GetLatestApprovedVersionParams{Domain: "dcl", Entity: EntityWarehouse, SubjectID: input.ObjectID})
			err = e
			if e == nil {
				id = r.ID
				entry, err = s.coordinator.Get(ctx, tx, id, actor)
			}
		} else if err == nil {
			id = entry.ID
		}
	} else {
		entry, err = s.coordinator.Get(ctx, tx, id, actor)
	}
	if err != nil || entry.SubjectID != input.ObjectID {
		if err == nil {
			err = newError(ErrorValidation, "validation_failed", "declaration not found", nil, nil)
		}
		return WarehouseView{}, translateError(err)
	}
	identity, err := s.queries.WithTx(tx).GetDCLSubject(ctx, dbsqlc.GetDCLSubjectParams{ID: input.ObjectID, Entity: EntityWarehouse})
	if err != nil {
		return WarehouseView{}, translateError(err)
	}
	stored, err := s.queries.WithTx(tx).GetDCLWarehouseVersion(ctx, id)
	if err != nil {
		return WarehouseView{}, translateError(err)
	}
	return WarehouseView{ObjectID: identity.ID, Entity: EntityWarehouse, Code: stringValue(identity.Code), Enabled: stored.Enabled, Approval: approval.VersionMetaFromEntry(entry), Data: warehouseVersionData(stored), UpdatedAt: entry.UpdatedAt}, nil
}

func (s *WarehouseService) Versions(ctx context.Context, input WarehouseHistoryInput, actor approval.Actor) (Page[WarehouseVersionView], error) {
	if _, ok := dclPageOffset(input.Page, input.PageSize); !ok || !validID(input.ObjectID) || !validActor(actor) {
		return Page[WarehouseVersionView]{}, newError(ErrorValidation, "validation_failed", "invalid warehouse declaration history", nil, nil)
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return Page[WarehouseVersionView]{}, translateError(err)
	}
	defer tx.Rollback(ctx)
	entries, err := s.coordinator.ListVersions(ctx, tx, input.ObjectID, actor)
	if err != nil {
		return Page[WarehouseVersionView]{}, translateError(err)
	}
	start := (input.Page - 1) * input.PageSize
	if start > len(entries) {
		start = len(entries)
	}
	end := min(start+input.PageSize, len(entries))
	q := s.queries.WithTx(tx)
	items := make([]WarehouseVersionView, 0, end-start)
	for _, e := range entries[start:end] {
		v, er := s.loadVersionViewFromEntry(ctx, q, e, input.ObjectID)
		if er != nil {
			return Page[WarehouseVersionView]{}, er
		}
		items = append(items, v)
	}
	return Page[WarehouseVersionView]{Items: items, Total: int64(len(entries)), Page: input.Page, PageSize: input.PageSize}, nil
}

func (s *WarehouseService) AuditHistory(ctx context.Context, input WarehouseHistoryInput, actor approval.Actor) (Page[approval.EventView], error) {
	offset, ok := dclPageOffset(input.Page, input.PageSize)
	if !ok || !validID(input.ObjectID) || !validActor(actor) {
		return Page[approval.EventView]{}, newError(ErrorValidation, "validation_failed", "invalid warehouse declaration audit history", nil, nil)
	}
	if err := s.coordinator.Authorize(ctx, actor, "audit-history"); err != nil {
		return Page[approval.EventView]{}, translateError(err)
	}
	if _, err := s.queries.GetDCLSubject(ctx, dbsqlc.GetDCLSubjectParams{ID: input.ObjectID, Entity: EntityWarehouse}); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Page[approval.EventView]{}, newError(ErrorValidation, "validation_failed", "warehouse declaration not found", nil, err)
		}
		return Page[approval.EventView]{}, translateError(err)
	}
	rows, err := s.queries.ListDCLWarehouseApprovalEvents(ctx, dbsqlc.ListDCLWarehouseApprovalEventsParams{ObjectID: input.ObjectID, RowOffset: offset, RowLimit: int32(input.PageSize)})
	if err != nil {
		return Page[approval.EventView]{}, translateError(err)
	}
	total, err := s.queries.CountDCLWarehouseApprovalEvents(ctx, input.ObjectID)
	if err != nil {
		return Page[approval.EventView]{}, translateError(err)
	}
	items := make([]approval.EventView, 0, len(rows))
	for _, r := range rows {
		items = append(items, approvalEventView(r))
	}
	return Page[approval.EventView]{Items: items, Total: total, Page: input.Page, PageSize: input.PageSize}, nil
}

func (s *WarehouseService) loadVersionView(ctx context.Context, q *dbsqlc.Queries, entryID, objectID string) (WarehouseVersionView, error) {
	r, err := q.GetApprovalEntry(ctx, dbsqlc.GetApprovalEntryParams{ID: entryID, Domain: "dcl", Entity: EntityWarehouse})
	if err != nil {
		return WarehouseVersionView{}, translateError(err)
	}
	return s.loadVersionViewFromEntry(ctx, q, approvalEntry(r), objectID)
}
func (s *WarehouseService) loadVersionViewFromEntry(ctx context.Context, q *dbsqlc.Queries, e approval.Entry, objectID string) (WarehouseVersionView, error) {
	if e.SubjectID != objectID {
		return WarehouseVersionView{}, newError(ErrorValidation, "validation_failed", "declaration version does not belong to subject", nil, nil)
	}
	r, err := q.GetDCLWarehouseVersion(ctx, e.ID)
	if err != nil {
		return WarehouseVersionView{}, translateError(err)
	}
	return WarehouseVersionView{Approval: approval.VersionMetaFromEntry(e), Data: warehouseVersionData(r), Enabled: r.Enabled}, nil
}

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

func (s *OperatingEntityService) Query(
	ctx context.Context,
	input OperatingEntityQueryInput,
	actor approval.Actor,
) (Page[OperatingEntityQueryItem], error) {
	offset, ok := dclPageOffset(input.Page, input.PageSize)
	if !ok || !validActor(actor) || len(input.Sort) > 1 {
		return Page[OperatingEntityQueryItem]{}, newError(ErrorValidation, "validation_failed", "invalid operating entity declaration query", nil, nil)
	}
	if err := s.coordinator.Authorize(ctx, actor, "query"); err != nil {
		return Page[OperatingEntityQueryItem]{}, translateError(err)
	}
	statusFilter := make([]string, 0, len(input.Filters.Status))
	for _, status := range input.Filters.Status {
		if !slices.Contains([]approval.Status{approval.StatusDraft, approval.StatusPending, approval.StatusApproved}, status) || slices.Contains(statusFilter, string(status)) {
			return Page[OperatingEntityQueryItem]{}, newError(ErrorValidation, "validation_failed", "invalid operating entity declaration status filter", nil, nil)
		}
		statusFilter = append(statusFilter, string(status))
	}
	sortField, sortOrder := "updatedAt", "desc"
	if len(input.Sort) == 1 {
		sortField, sortOrder = input.Sort[0].Field, strings.ToLower(input.Sort[0].Order)
		if !slices.Contains([]string{"updatedAt", "code", "name", "status", "version"}, sortField) ||
			!slices.Contains([]string{"asc", "desc"}, sortOrder) {
			return Page[OperatingEntityQueryItem]{}, newError(ErrorValidation, "validation_failed", "invalid operating entity declaration sort", nil, nil)
		}
	}
	enabledFilter := int32(-1)
	if input.Filters.Enabled != nil {
		if *input.Filters.Enabled {
			enabledFilter = 1
		} else {
			enabledFilter = 0
		}
	}
	params := dbsqlc.ListDCLOperatingEntitiesParams{
		Keyword: strings.TrimSpace(input.Filters.Keyword), EnabledFilter: enabledFilter, StatusFilter: statusFilter,
		SortField: sortField, SortOrder: sortOrder, RowOffset: offset, RowLimit: int32(input.PageSize),
	}
	rows, err := s.queries.ListDCLOperatingEntities(ctx, params)
	if err != nil {
		return Page[OperatingEntityQueryItem]{}, translateError(err)
	}
	total, err := s.queries.CountDCLOperatingEntities(ctx, dbsqlc.CountDCLOperatingEntitiesParams{
		Keyword: params.Keyword, EnabledFilter: params.EnabledFilter, StatusFilter: params.StatusFilter,
	})
	if err != nil {
		return Page[OperatingEntityQueryItem]{}, translateError(err)
	}
	items := make([]OperatingEntityQueryItem, 0, len(rows))
	for _, row := range rows {
		item := OperatingEntityQueryItem{
			ObjectID: row.ObjectID, Entity: EntityOperatingEntity, Code: stringValue(row.Code),
			ObjectRevision: row.ObjectRevision, Enabled: row.Enabled, UpdatedAt: row.UpdatedAt.Time,
		}
		if row.ApprovedEntryID != "" {
			view, loadErr := s.loadVersionView(ctx, s.queries, row.ApprovedEntryID, row.ObjectID)
			if loadErr != nil {
				return Page[OperatingEntityQueryItem]{}, loadErr
			}
			item.LatestApproved = &view
		}
		if row.OpenEntryID != "" {
			view, loadErr := s.loadVersionView(ctx, s.queries, row.OpenEntryID, row.ObjectID)
			if loadErr != nil {
				return Page[OperatingEntityQueryItem]{}, loadErr
			}
			item.OpenVersion = &view
		}
		items = append(items, item)
	}
	return Page[OperatingEntityQueryItem]{Items: items, Total: total, Page: input.Page, PageSize: input.PageSize}, nil
}

func (s *OperatingEntityService) Versions(
	ctx context.Context,
	input OperatingEntityHistoryInput,
	actor approval.Actor,
) (Page[OperatingEntityVersionView], error) {
	if _, ok := dclPageOffset(input.Page, input.PageSize); !ok || !validID(input.ObjectID) || !validActor(actor) {
		return Page[OperatingEntityVersionView]{}, newError(ErrorValidation, "validation_failed", "invalid operating entity declaration history", nil, nil)
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return Page[OperatingEntityVersionView]{}, translateError(err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	entries, err := s.coordinator.ListVersions(ctx, tx, input.ObjectID, actor)
	if err != nil {
		return Page[OperatingEntityVersionView]{}, translateError(err)
	}
	start := (input.Page - 1) * input.PageSize
	if start > len(entries) {
		start = len(entries)
	}
	end := min(start+input.PageSize, len(entries))
	q := s.queries.WithTx(tx)
	items := make([]OperatingEntityVersionView, 0, end-start)
	for _, entry := range entries[start:end] {
		view, loadErr := s.loadVersionViewFromEntry(ctx, q, entry, input.ObjectID)
		if loadErr != nil {
			return Page[OperatingEntityVersionView]{}, loadErr
		}
		items = append(items, view)
	}
	return Page[OperatingEntityVersionView]{Items: items, Total: int64(len(entries)), Page: input.Page, PageSize: input.PageSize}, nil
}

func (s *OperatingEntityService) AuditHistory(
	ctx context.Context,
	input OperatingEntityHistoryInput,
	actor approval.Actor,
) (Page[approval.EventView], error) {
	offset, ok := dclPageOffset(input.Page, input.PageSize)
	if !ok || !validID(input.ObjectID) || !validActor(actor) {
		return Page[approval.EventView]{}, newError(ErrorValidation, "validation_failed", "invalid operating entity declaration audit history", nil, nil)
	}
	if err := s.coordinator.Authorize(ctx, actor, "audit-history"); err != nil {
		return Page[approval.EventView]{}, translateError(err)
	}
	if _, err := s.queries.GetDCLSubject(ctx, dbsqlc.GetDCLSubjectParams{ID: input.ObjectID, Entity: EntityOperatingEntity}); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Page[approval.EventView]{}, newError(ErrorValidation, "validation_failed", "operating entity declaration not found", nil, err)
		}
		return Page[approval.EventView]{}, translateError(err)
	}
	rows, err := s.queries.ListDCLOperatingEntityApprovalEvents(ctx, dbsqlc.ListDCLOperatingEntityApprovalEventsParams{
		ObjectID: input.ObjectID, RowOffset: offset, RowLimit: int32(input.PageSize),
	})
	if err != nil {
		return Page[approval.EventView]{}, translateError(err)
	}
	total, err := s.queries.CountDCLOperatingEntityApprovalEvents(ctx, input.ObjectID)
	if err != nil {
		return Page[approval.EventView]{}, translateError(err)
	}
	items := make([]approval.EventView, 0, len(rows))
	for _, row := range rows {
		items = append(items, approvalEventView(row))
	}
	return Page[approval.EventView]{Items: items, Total: total, Page: input.Page, PageSize: input.PageSize}, nil
}

func (s *OperatingEntityService) loadVersionView(ctx context.Context, q *dbsqlc.Queries, entryID, objectID string) (OperatingEntityVersionView, error) {
	row, err := q.GetApprovalEntry(ctx, dbsqlc.GetApprovalEntryParams{ID: entryID, Domain: "dcl", Entity: EntityOperatingEntity})
	if err != nil {
		return OperatingEntityVersionView{}, translateError(err)
	}
	if row.SubjectID != objectID {
		return OperatingEntityVersionView{}, newError(ErrorValidation, "validation_failed", "declaration version does not belong to subject", nil, nil)
	}
	return s.loadVersionViewFromEntry(ctx, q, approvalEntry(row), objectID)
}

func (s *OperatingEntityService) loadVersionViewFromEntry(ctx context.Context, q *dbsqlc.Queries, entry approval.Entry, objectID string) (OperatingEntityVersionView, error) {
	if entry.SubjectID != objectID {
		return OperatingEntityVersionView{}, newError(ErrorValidation, "validation_failed", "declaration version does not belong to subject", nil, nil)
	}
	stored, err := q.GetDCLOperatingEntityVersion(ctx, entry.ID)
	if err != nil {
		return OperatingEntityVersionView{}, translateError(err)
	}
	return OperatingEntityVersionView{
		Approval: approval.VersionMetaFromEntry(entry), Data: operatingEntityData(stored), Enabled: stored.Enabled,
	}, nil
}

func dclPageOffset(page, pageSize int) (int32, bool) {
	if page < 1 || pageSize < 1 || pageSize > 100 {
		return 0, false
	}
	offset := int64(page-1) * int64(pageSize)
	if offset > int64(1<<31-1) {
		return 0, false
	}
	return int32(offset), true
}

func approvalEventView(row dbsqlc.ApprovalEvent) approval.EventView {
	var from, to *approval.Status
	if row.FromStatus != nil {
		value := approval.Status(*row.FromStatus)
		from = &value
	}
	if row.ToStatus != nil {
		value := approval.Status(*row.ToStatus)
		to = &value
	}
	return approval.EventView{
		ID: row.ID, ApprovalEntryID: row.EntryID, Action: approval.Action(row.Action),
		FromStatus: from, ToStatus: to, FromRevision: row.FromRevision, ToRevision: row.ToRevision,
		ActorID: row.ActorID, Reason: row.Reason, RequestID: row.RequestID, CreatedAt: row.CreatedAt.Time,
	}
}

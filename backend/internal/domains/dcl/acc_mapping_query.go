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

func (s *AccMappingService) Query(ctx context.Context, input AccMappingQueryInput, actor approval.Actor) (Page[AccMappingListItem], error) {
	offset, ok := dclPageOffset(input.Page, input.PageSize)
	if !ok || !validID(input.BookID) || !validActor(actor) || len(input.Sort) > 1 {
		return Page[AccMappingListItem]{}, newError(ErrorValidation, "validation_failed", "invalid accounting mapping query", nil, nil)
	}
	statuses := make([]string, 0, len(input.Filters.Status))
	for _, status := range input.Filters.Status {
		if !slices.Contains([]approval.Status{approval.StatusDraft, approval.StatusPending, approval.StatusApproved}, status) || slices.Contains(statuses, string(status)) {
			return Page[AccMappingListItem]{}, newError(ErrorValidation, "validation_failed", "invalid accounting mapping status filter", nil, nil)
		}
		statuses = append(statuses, string(status))
	}
	field, order := "updatedAt", "desc"
	if len(input.Sort) == 1 {
		field, order = input.Sort[0].Field, strings.ToLower(input.Sort[0].Order)
		if !slices.Contains([]string{"updatedAt", "vouEntity", "status", "version"}, field) || !slices.Contains([]string{"asc", "desc"}, order) {
			return Page[AccMappingListItem]{}, newError(ErrorValidation, "validation_failed", "invalid accounting mapping sort", nil, nil)
		}
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return Page[AccMappingListItem]{}, translateError(err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	if err = s.requireBookAccess(ctx, tx, input.BookID, actor, false); err != nil {
		return Page[AccMappingListItem]{}, err
	}
	q := s.queries.WithTx(tx)
	params := dbsqlc.ListDCLAccMappingsParams{BookID: input.BookID, VouEntity: input.Filters.VouEntity, StatusFilter: statuses, SortField: field, SortOrder: order, RowOffset: offset, RowLimit: int32(input.PageSize)}
	rows, err := q.ListDCLAccMappings(ctx, params)
	if err != nil {
		return Page[AccMappingListItem]{}, translateError(err)
	}
	total, err := q.CountDCLAccMappings(ctx, dbsqlc.CountDCLAccMappingsParams{BookID: input.BookID, VouEntity: input.Filters.VouEntity, StatusFilter: statuses})
	if err != nil {
		return Page[AccMappingListItem]{}, translateError(err)
	}
	items := make([]AccMappingListItem, 0, len(rows))
	for _, r := range rows {
		entryID := r.OpenEntryID
		if entryID == "" {
			entryID = r.ApprovedEntryID
		}
		if entryID == "" {
			continue
		}
		entry, err := s.coordinator.Get(ctx, tx, entryID, actor)
		if err != nil {
			return Page[AccMappingListItem]{}, translateError(err)
		}
		stored, err := q.GetDCLAccMappingVersion(ctx, entryID)
		if err != nil {
			return Page[AccMappingListItem]{}, translateError(err)
		}
		items = append(items, AccMappingListItem{BookID: r.BookID, VouEntity: r.VouEntity, Approval: approval.VersionMetaFromEntry(entry), Data: accMappingVersionData(stored), AvailableApprovalActions: s.coordinator.LifecycleActions(entry, actor)})
	}
	if err = tx.Commit(ctx); err != nil {
		return Page[AccMappingListItem]{}, translateError(err)
	}
	return Page[AccMappingListItem]{Items: items, Total: total, Page: input.Page, PageSize: input.PageSize}, nil
}

func (s *AccMappingService) Versions(ctx context.Context, input AccMappingHistoryInput, actor approval.Actor) (Page[AccMappingVersionView], error) {
	_, ok := dclPageOffset(input.Page, input.PageSize)
	if !ok || !validID(input.BookID) || input.VouEntity == "" || !validActor(actor) {
		return Page[AccMappingVersionView]{}, newError(ErrorValidation, "validation_failed", "invalid accounting mapping versions request", nil, nil)
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return Page[AccMappingVersionView]{}, translateError(err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	q := s.queries.WithTx(tx)
	if err = s.requireBookAccess(ctx, tx, input.BookID, actor, false); err != nil {
		return Page[AccMappingVersionView]{}, err
	}
	subjectID, err := s.resolveSubjectID(ctx, q, input.BookID, input.VouEntity)
	if err != nil {
		return Page[AccMappingVersionView]{}, translateError(err)
	}
	entries, err := s.coordinator.ListVersions(ctx, tx, subjectID, actor)
	if err != nil {
		return Page[AccMappingVersionView]{}, translateError(err)
	}
	total := len(entries)
	start := int((input.Page - 1) * input.PageSize)
	if start > total {
		start = total
	}
	end := min(start+input.PageSize, total)
	items := make([]AccMappingVersionView, 0, end-start)
	for _, entry := range entries[start:end] {
		stored, err := q.GetDCLAccMappingVersion(ctx, entry.ID)
		if err != nil {
			return Page[AccMappingVersionView]{}, translateError(err)
		}
		items = append(items, AccMappingVersionView{BookID: input.BookID, VouEntity: input.VouEntity, Approval: approval.VersionMetaFromEntry(entry), Data: accMappingVersionData(stored)})
	}
	if err = tx.Commit(ctx); err != nil {
		return Page[AccMappingVersionView]{}, translateError(err)
	}
	return Page[AccMappingVersionView]{Items: items, Total: int64(total), Page: input.Page, PageSize: input.PageSize}, nil
}

func (s *AccMappingService) AuditHistory(ctx context.Context, input AccMappingHistoryInput, actor approval.Actor) (Page[approval.EventView], error) {
	offset, ok := dclPageOffset(input.Page, input.PageSize)
	if !ok || !validID(input.BookID) || input.VouEntity == "" || !validActor(actor) {
		return Page[approval.EventView]{}, newError(ErrorValidation, "validation_failed", "invalid accounting mapping audit history", nil, nil)
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return Page[approval.EventView]{}, translateError(err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	if err = s.requireBookAccess(ctx, tx, input.BookID, actor, false); err != nil {
		return Page[approval.EventView]{}, err
	}
	q := s.queries.WithTx(tx)
	subject, err := q.GetDCLAccMappingSubject(ctx, dbsqlc.GetDCLAccMappingSubjectParams{BookID: input.BookID, VouEntity: input.VouEntity})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Page[approval.EventView]{}, newError(ErrorValidation, "validation_failed", "accounting mapping not found", nil, err)
		}
		return Page[approval.EventView]{}, translateError(err)
	}
	rows, err := q.ListDCLAccMappingApprovalEvents(ctx, dbsqlc.ListDCLAccMappingApprovalEventsParams{SubjectID: subject.ID, RowOffset: offset, RowLimit: int32(input.PageSize)})
	if err != nil {
		return Page[approval.EventView]{}, translateError(err)
	}
	total, err := q.CountDCLAccMappingApprovalEvents(ctx, subject.ID)
	if err != nil {
		return Page[approval.EventView]{}, translateError(err)
	}
	items := make([]approval.EventView, 0, len(rows))
	for _, r := range rows {
		items = append(items, approvalEventView(r))
	}
	if err = tx.Commit(ctx); err != nil {
		return Page[approval.EventView]{}, translateError(err)
	}
	return Page[approval.EventView]{Items: items, Total: total, Page: input.Page, PageSize: input.PageSize}, nil
}

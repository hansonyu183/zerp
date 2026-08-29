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

func (s *FundAccountService) Query(ctx context.Context, input FundAccountQueryInput, actor approval.Actor) (Page[FundAccountQueryItem], error) {
	offset, ok := dclPageOffset(input.Page, input.PageSize)
	if !ok || !validActor(actor) || len(input.Sort) > 1 {
		return Page[FundAccountQueryItem]{}, newError(ErrorValidation, "validation_failed", "invalid fundAccount declaration query", nil, nil)
	}
	if err := s.coordinator.Authorize(ctx, actor, "query"); err != nil {
		return Page[FundAccountQueryItem]{}, translateError(err)
	}
	statuses := make([]string, 0, len(input.Filters.Status))
	for _, status := range input.Filters.Status {
		if !slices.Contains([]approval.Status{approval.StatusDraft, approval.StatusPending, approval.StatusApproved}, status) || slices.Contains(statuses, string(status)) {
			return Page[FundAccountQueryItem]{}, newError(ErrorValidation, "validation_failed", "invalid fundAccount declaration status filter", nil, nil)
		}
		statuses = append(statuses, string(status))
	}
	field, order := "updatedAt", "desc"
	if len(input.Sort) == 1 {
		field, order = input.Sort[0].Field, strings.ToLower(input.Sort[0].Order)
		if !slices.Contains([]string{"updatedAt", "code", "name", "status", "version"}, field) || !slices.Contains([]string{"asc", "desc"}, order) {
			return Page[FundAccountQueryItem]{}, newError(ErrorValidation, "validation_failed", "invalid fundAccount declaration sort", nil, nil)
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
	params := dbsqlc.ListDCLFundAccountsParams{Keyword: strings.TrimSpace(input.Filters.Keyword), EnabledFilter: enabled, StatusFilter: statuses, SortField: field, SortOrder: order, RowOffset: offset, RowLimit: int32(input.PageSize)}
	rows, err := s.queries.ListDCLFundAccounts(ctx, params)
	if err != nil {
		return Page[FundAccountQueryItem]{}, translateError(err)
	}
	total, err := s.queries.CountDCLFundAccounts(ctx, dbsqlc.CountDCLFundAccountsParams{Keyword: params.Keyword, EnabledFilter: params.EnabledFilter, StatusFilter: params.StatusFilter})
	if err != nil {
		return Page[FundAccountQueryItem]{}, translateError(err)
	}
	items := make([]FundAccountQueryItem, 0, len(rows))
	for _, r := range rows {
		item := FundAccountQueryItem{ObjectID: r.ObjectID, Entity: EntityFundAccount, Code: stringValue(r.Code), Enabled: r.Enabled, UpdatedAt: r.UpdatedAt.Time}
		if r.ApprovedEntryID != "" {
			v, e := s.loadVersionView(ctx, s.queries, r.ApprovedEntryID, r.ObjectID)
			if e != nil {
				return Page[FundAccountQueryItem]{}, e
			}
			item.LatestApproved = &v
		}
		if r.OpenEntryID != "" {
			v, e := s.loadVersionView(ctx, s.queries, r.OpenEntryID, r.ObjectID)
			if e != nil {
				return Page[FundAccountQueryItem]{}, e
			}
			item.OpenVersion = &v
		}
		items = append(items, item)
	}
	return Page[FundAccountQueryItem]{Items: items, Total: total, Page: input.Page, PageSize: input.PageSize}, nil
}

func (s *FundAccountService) Get(ctx context.Context, input FundAccountGetInput, actor approval.Actor) (FundAccountView, error) {
	if !validID(input.ObjectID) || (input.ApprovalEntryID != "" && !validID(input.ApprovalEntryID)) || !validActor(actor) {
		return FundAccountView{}, newError(ErrorValidation, "validation_failed", "invalid fundAccount declaration get request", nil, nil)
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return FundAccountView{}, translateError(err)
	}
	defer tx.Rollback(ctx)
	id := input.ApprovalEntryID
	var entry approval.Entry
	if id == "" {
		entry, err = s.coordinator.GetOpenVersion(ctx, tx, input.ObjectID, actor)
		if approval.IsKey(err, "approval_version_not_found") {
			r, e := s.queries.WithTx(tx).GetLatestApprovedVersion(ctx, dbsqlc.GetLatestApprovedVersionParams{Domain: "dcl", Entity: EntityFundAccount, SubjectID: input.ObjectID})
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
		return FundAccountView{}, translateError(err)
	}
	identity, err := s.queries.WithTx(tx).GetDCLSubject(ctx, dbsqlc.GetDCLSubjectParams{ID: input.ObjectID, Entity: EntityFundAccount})
	if err != nil {
		return FundAccountView{}, translateError(err)
	}
	stored, err := s.queries.WithTx(tx).GetDCLFundAccountVersion(ctx, id)
	if err != nil {
		return FundAccountView{}, translateError(err)
	}
	return FundAccountView{ObjectID: identity.ID, Entity: EntityFundAccount, Code: stringValue(identity.Code), Enabled: stored.Enabled, Approval: approval.VersionMetaFromEntry(entry), Data: fundAccountVersionData(stored), UpdatedAt: entry.UpdatedAt}, nil
}

func (s *FundAccountService) Versions(ctx context.Context, input FundAccountHistoryInput, actor approval.Actor) (Page[FundAccountVersionView], error) {
	if _, ok := dclPageOffset(input.Page, input.PageSize); !ok || !validID(input.ObjectID) || !validActor(actor) {
		return Page[FundAccountVersionView]{}, newError(ErrorValidation, "validation_failed", "invalid fundAccount declaration history", nil, nil)
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return Page[FundAccountVersionView]{}, translateError(err)
	}
	defer tx.Rollback(ctx)
	entries, err := s.coordinator.ListVersions(ctx, tx, input.ObjectID, actor)
	if err != nil {
		return Page[FundAccountVersionView]{}, translateError(err)
	}
	start := (input.Page - 1) * input.PageSize
	if start > len(entries) {
		start = len(entries)
	}
	end := min(start+input.PageSize, len(entries))
	q := s.queries.WithTx(tx)
	items := make([]FundAccountVersionView, 0, end-start)
	for _, e := range entries[start:end] {
		v, er := s.loadVersionViewFromEntry(ctx, q, e, input.ObjectID)
		if er != nil {
			return Page[FundAccountVersionView]{}, er
		}
		items = append(items, v)
	}
	return Page[FundAccountVersionView]{Items: items, Total: int64(len(entries)), Page: input.Page, PageSize: input.PageSize}, nil
}

func (s *FundAccountService) AuditHistory(ctx context.Context, input FundAccountHistoryInput, actor approval.Actor) (Page[approval.EventView], error) {
	offset, ok := dclPageOffset(input.Page, input.PageSize)
	if !ok || !validID(input.ObjectID) || !validActor(actor) {
		return Page[approval.EventView]{}, newError(ErrorValidation, "validation_failed", "invalid fundAccount declaration audit history", nil, nil)
	}
	if err := s.coordinator.Authorize(ctx, actor, "audit-history"); err != nil {
		return Page[approval.EventView]{}, translateError(err)
	}
	if _, err := s.queries.GetDCLSubject(ctx, dbsqlc.GetDCLSubjectParams{ID: input.ObjectID, Entity: EntityFundAccount}); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Page[approval.EventView]{}, newError(ErrorValidation, "validation_failed", "fundAccount declaration not found", nil, err)
		}
		return Page[approval.EventView]{}, translateError(err)
	}
	rows, err := s.queries.ListDCLFundAccountApprovalEvents(ctx, dbsqlc.ListDCLFundAccountApprovalEventsParams{ObjectID: input.ObjectID, RowOffset: offset, RowLimit: int32(input.PageSize)})
	if err != nil {
		return Page[approval.EventView]{}, translateError(err)
	}
	total, err := s.queries.CountDCLFundAccountApprovalEvents(ctx, input.ObjectID)
	if err != nil {
		return Page[approval.EventView]{}, translateError(err)
	}
	items := make([]approval.EventView, 0, len(rows))
	for _, r := range rows {
		items = append(items, approvalEventView(r))
	}
	return Page[approval.EventView]{Items: items, Total: total, Page: input.Page, PageSize: input.PageSize}, nil
}

func (s *FundAccountService) loadVersionView(ctx context.Context, q *dbsqlc.Queries, entryID, objectID string) (FundAccountVersionView, error) {
	r, err := q.GetApprovalEntry(ctx, dbsqlc.GetApprovalEntryParams{ID: entryID, Domain: "dcl", Entity: EntityFundAccount})
	if err != nil {
		return FundAccountVersionView{}, translateError(err)
	}
	return s.loadVersionViewFromEntry(ctx, q, approvalEntry(r), objectID)
}
func (s *FundAccountService) loadVersionViewFromEntry(ctx context.Context, q *dbsqlc.Queries, e approval.Entry, objectID string) (FundAccountVersionView, error) {
	if e.SubjectID != objectID {
		return FundAccountVersionView{}, newError(ErrorValidation, "validation_failed", "declaration version does not belong to subject", nil, nil)
	}
	r, err := q.GetDCLFundAccountVersion(ctx, e.ID)
	if err != nil {
		return FundAccountVersionView{}, translateError(err)
	}
	return FundAccountVersionView{Approval: approval.VersionMetaFromEntry(e), Data: fundAccountVersionData(r), Enabled: r.Enabled}, nil
}

package dcl

import (
	"context"
	"errors"
	"slices"
	"strings"

	dbsqlc "github.com/hansonyu183/zerp/backend/internal/database/sqlc"
	bobdomain "github.com/hansonyu183/zerp/backend/internal/domains/bob"
	"github.com/hansonyu183/zerp/backend/internal/platform/approval"
	"github.com/jackc/pgx/v5"
)

func (s *ProductService) Query(ctx context.Context, input ProductQueryInput, actor approval.Actor) (Page[ProductQueryItem], error) {
	offset, ok := dclPageOffset(input.Page, input.PageSize)
	if !ok || !validActor(actor) || len(input.Sort) > 1 {
		return Page[ProductQueryItem]{}, newError(ErrorValidation, "validation_failed", "invalid product declaration query", nil, nil)
	}
	if err := s.coordinator.Authorize(ctx, actor, "query"); err != nil {
		return Page[ProductQueryItem]{}, translateError(err)
	}
	statuses := make([]string, 0, len(input.Filters.Status))
	for _, status := range input.Filters.Status {
		if !slices.Contains([]approval.Status{approval.StatusDraft, approval.StatusPending, approval.StatusApproved}, status) || slices.Contains(statuses, string(status)) {
			return Page[ProductQueryItem]{}, newError(ErrorValidation, "validation_failed", "invalid product declaration status filter", nil, nil)
		}
		statuses = append(statuses, string(status))
	}
	field, order := "updatedAt", "desc"
	if len(input.Sort) == 1 {
		field, order = input.Sort[0].Field, strings.ToLower(input.Sort[0].Order)
		if !slices.Contains([]string{"updatedAt", "code", "name", "status", "version"}, field) || !slices.Contains([]string{"asc", "desc"}, order) {
			return Page[ProductQueryItem]{}, newError(ErrorValidation, "validation_failed", "invalid product declaration sort", nil, nil)
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
	params := dbsqlc.ListDCLProductsParams{Keyword: strings.TrimSpace(input.Filters.Keyword), EnabledFilter: enabled, StatusFilter: statuses, ProductTypeID: strings.TrimSpace(input.Filters.ProductTypeID), CategoryID: strings.TrimSpace(input.Filters.CategoryID), SortField: field, SortOrder: order, RowOffset: offset, RowLimit: int32(input.PageSize)}
	rows, err := s.queries.ListDCLProducts(ctx, params)
	if err != nil {
		return Page[ProductQueryItem]{}, translateError(err)
	}
	total, err := s.queries.CountDCLProducts(ctx, dbsqlc.CountDCLProductsParams{Keyword: params.Keyword, EnabledFilter: params.EnabledFilter, StatusFilter: params.StatusFilter, ProductTypeID: params.ProductTypeID, CategoryID: params.CategoryID})
	if err != nil {
		return Page[ProductQueryItem]{}, translateError(err)
	}
	items := make([]ProductQueryItem, 0, len(rows))
	for _, r := range rows {
		code, codeErr := requiredSubjectCode(r.Code)
		if codeErr != nil {
			return Page[ProductQueryItem]{}, codeErr
		}
		item := ProductQueryItem{ObjectID: r.ObjectID, Entity: EntityProduct, Code: code, Enabled: r.Enabled, UpdatedAt: r.UpdatedAt.Time}
		if r.ApprovedEntryID != "" {
			v, e := s.loadVersionView(ctx, s.queries, r.ApprovedEntryID, r.ObjectID)
			if e != nil {
				return Page[ProductQueryItem]{}, e
			}
			item.LatestApproved = &v
		}
		if r.OpenEntryID != "" {
			v, e := s.loadVersionView(ctx, s.queries, r.OpenEntryID, r.ObjectID)
			if e != nil {
				return Page[ProductQueryItem]{}, e
			}
			item.OpenVersion = &v
		}
		entry, ok, entryErr := dclActiveEntry(ctx, s.queries, EntityProduct, r.OpenEntryID, r.ApprovedEntryID)
		if entryErr != nil {
			return Page[ProductQueryItem]{}, entryErr
		}
		if ok {
			item.AvailableApprovalActions = s.coordinator.LifecycleActions(entry, actor)
		}
		items = append(items, item)
	}
	return Page[ProductQueryItem]{Items: items, Total: total, Page: input.Page, PageSize: input.PageSize}, nil
}

func (s *ProductService) Get(ctx context.Context, input ProductGetInput, actor approval.Actor) (ProductView, error) {
	if !validID(input.ObjectID) || (input.ApprovalEntryID != "" && !validID(input.ApprovalEntryID)) || !validActor(actor) {
		return ProductView{}, newError(ErrorValidation, "validation_failed", "invalid product declaration get request", nil, nil)
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return ProductView{}, translateError(err)
	}
	defer tx.Rollback(ctx)
	id := input.ApprovalEntryID
	var entry approval.Entry
	if id == "" {
		entry, err = s.coordinator.GetOpenVersion(ctx, tx, input.ObjectID, actor)
		if approval.IsKey(err, "approval_version_not_found") {
			r, e := s.queries.WithTx(tx).GetLatestApprovedVersion(ctx, dbsqlc.GetLatestApprovedVersionParams{Domain: "dcl", Entity: EntityProduct, SubjectID: input.ObjectID})
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
		return ProductView{}, translateError(err)
	}
	identity, err := s.queries.WithTx(tx).GetDCLSubject(ctx, dbsqlc.GetDCLSubjectParams{ID: input.ObjectID, Entity: EntityProduct})
	if err != nil {
		return ProductView{}, translateError(err)
	}
	stored, err := bobdomain.LoadDCLProductSnapshot(ctx, s.queries.WithTx(tx), id)
	if err != nil {
		return ProductView{}, translateError(err)
	}
	code, err := requiredSubjectCode(identity.Code)
	if err != nil {
		return ProductView{}, err
	}
	return ProductView{ObjectID: identity.ID, Entity: EntityProduct, Code: code, Enabled: stored.Enabled, Approval: approval.VersionMetaFromEntry(entry), Data: productVersionData(stored), UpdatedAt: entry.UpdatedAt, AvailableApprovalActions: s.coordinator.LifecycleActions(entry, actor)}, nil
}

func (s *ProductService) Versions(ctx context.Context, input ProductHistoryInput, actor approval.Actor) (Page[ProductVersionView], error) {
	if _, ok := dclPageOffset(input.Page, input.PageSize); !ok || !validID(input.ObjectID) || !validActor(actor) {
		return Page[ProductVersionView]{}, newError(ErrorValidation, "validation_failed", "invalid product declaration history", nil, nil)
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return Page[ProductVersionView]{}, translateError(err)
	}
	defer tx.Rollback(ctx)
	entries, err := s.coordinator.ListVersions(ctx, tx, input.ObjectID, actor)
	if err != nil {
		return Page[ProductVersionView]{}, translateError(err)
	}
	start := (input.Page - 1) * input.PageSize
	if start > len(entries) {
		start = len(entries)
	}
	end := min(start+input.PageSize, len(entries))
	q := s.queries.WithTx(tx)
	items := make([]ProductVersionView, 0, end-start)
	for _, e := range entries[start:end] {
		v, er := s.loadVersionViewFromEntry(ctx, q, e, input.ObjectID)
		if er != nil {
			return Page[ProductVersionView]{}, er
		}
		items = append(items, v)
	}
	return Page[ProductVersionView]{Items: items, Total: int64(len(entries)), Page: input.Page, PageSize: input.PageSize}, nil
}

func (s *ProductService) AuditHistory(ctx context.Context, input ProductHistoryInput, actor approval.Actor) (Page[approval.EventView], error) {
	offset, ok := dclPageOffset(input.Page, input.PageSize)
	if !ok || !validID(input.ObjectID) || !validActor(actor) {
		return Page[approval.EventView]{}, newError(ErrorValidation, "validation_failed", "invalid product declaration audit history", nil, nil)
	}
	if err := s.coordinator.Authorize(ctx, actor, "audit-history"); err != nil {
		return Page[approval.EventView]{}, translateError(err)
	}
	if _, err := s.queries.GetDCLSubject(ctx, dbsqlc.GetDCLSubjectParams{ID: input.ObjectID, Entity: EntityProduct}); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Page[approval.EventView]{}, newError(ErrorValidation, "validation_failed", "product declaration not found", nil, err)
		}
		return Page[approval.EventView]{}, translateError(err)
	}
	rows, err := s.queries.ListDCLProductApprovalEvents(ctx, dbsqlc.ListDCLProductApprovalEventsParams{ObjectID: input.ObjectID, RowOffset: offset, RowLimit: int32(input.PageSize)})
	if err != nil {
		return Page[approval.EventView]{}, translateError(err)
	}
	total, err := s.queries.CountDCLProductApprovalEvents(ctx, input.ObjectID)
	if err != nil {
		return Page[approval.EventView]{}, translateError(err)
	}
	items := make([]approval.EventView, 0, len(rows))
	for _, r := range rows {
		items = append(items, approvalEventView(r))
	}
	return Page[approval.EventView]{Items: items, Total: total, Page: input.Page, PageSize: input.PageSize}, nil
}

func (s *ProductService) loadVersionView(ctx context.Context, q *dbsqlc.Queries, entryID, objectID string) (ProductVersionView, error) {
	r, err := q.GetApprovalEntry(ctx, dbsqlc.GetApprovalEntryParams{ID: entryID, Domain: "dcl", Entity: EntityProduct})
	if err != nil {
		return ProductVersionView{}, translateError(err)
	}
	return s.loadVersionViewFromEntry(ctx, q, approvalEntry(r), objectID)
}
func (s *ProductService) loadVersionViewFromEntry(ctx context.Context, q *dbsqlc.Queries, e approval.Entry, objectID string) (ProductVersionView, error) {
	if e.SubjectID != objectID {
		return ProductVersionView{}, newError(ErrorValidation, "validation_failed", "declaration version does not belong to subject", nil, nil)
	}
	r, err := bobdomain.LoadDCLProductSnapshot(ctx, q, e.ID)
	if err != nil {
		return ProductVersionView{}, translateError(err)
	}
	return ProductVersionView{Approval: approval.VersionMetaFromEntry(e), Data: productVersionData(r), Enabled: r.Enabled}, nil
}

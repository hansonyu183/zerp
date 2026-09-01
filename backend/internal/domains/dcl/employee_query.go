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

func (s *EmployeeService) Query(ctx context.Context, input EmployeeQueryInput, actor approval.Actor) (Page[EmployeeQueryItem], error) {
	offset, ok := dclPageOffset(input.Page, input.PageSize)
	if !ok || !validActor(actor) || len(input.Sort) > 1 {
		return Page[EmployeeQueryItem]{}, newError(ErrorValidation, "validation_failed", "invalid employee declaration query", nil, nil)
	}
	if err := s.coordinator.Authorize(ctx, actor, "query"); err != nil {
		return Page[EmployeeQueryItem]{}, translateError(err)
	}
	statuses := make([]string, 0, len(input.Filters.Status))
	for _, status := range input.Filters.Status {
		if !slices.Contains([]approval.Status{approval.StatusDraft, approval.StatusPending, approval.StatusApproved}, status) || slices.Contains(statuses, string(status)) {
			return Page[EmployeeQueryItem]{}, newError(ErrorValidation, "validation_failed", "invalid employee declaration status filter", nil, nil)
		}
		statuses = append(statuses, string(status))
	}
	field, order := "updatedAt", "desc"
	if len(input.Sort) == 1 {
		field, order = input.Sort[0].Field, strings.ToLower(input.Sort[0].Order)
		if !slices.Contains([]string{"updatedAt", "code", "name", "status", "version"}, field) || !slices.Contains([]string{"asc", "desc"}, order) {
			return Page[EmployeeQueryItem]{}, newError(ErrorValidation, "validation_failed", "invalid employee declaration sort", nil, nil)
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
	operatingEntityID := strings.TrimSpace(input.Filters.OperatingEntityID)
	if operatingEntityID != "" && !validID(operatingEntityID) {
		return Page[EmployeeQueryItem]{}, newError(ErrorValidation, "validation_failed", "invalid employee current operating entity filter", nil, nil)
	}
	params := dbsqlc.ListDCLEmployeesParams{Keyword: strings.TrimSpace(input.Filters.Keyword), EnabledFilter: enabled, OperatingEntityID: operatingEntityID, EmployeeCategoryID: strings.TrimSpace(input.Filters.EmployeeCategoryID), DepartmentID: strings.TrimSpace(input.Filters.DepartmentID), PositionID: strings.TrimSpace(input.Filters.PositionID), StatusFilter: statuses, SortField: field, SortOrder: order, RowOffset: offset, RowLimit: int32(input.PageSize)}
	rows, err := s.queries.ListDCLEmployees(ctx, params)
	if err != nil {
		return Page[EmployeeQueryItem]{}, translateError(err)
	}
	total, err := s.queries.CountDCLEmployees(ctx, dbsqlc.CountDCLEmployeesParams{Keyword: params.Keyword, EnabledFilter: params.EnabledFilter, OperatingEntityID: params.OperatingEntityID, EmployeeCategoryID: params.EmployeeCategoryID, DepartmentID: params.DepartmentID, PositionID: params.PositionID, StatusFilter: params.StatusFilter})
	if err != nil {
		return Page[EmployeeQueryItem]{}, translateError(err)
	}
	return s.employeeQueryPage(ctx, rows, total, input, actor)
}

func (s *EmployeeService) employeeQueryPage(ctx context.Context, rows []dbsqlc.ListDCLEmployeesRow, total int64, input EmployeeQueryInput, actor approval.Actor) (Page[EmployeeQueryItem], error) {
	items := make([]EmployeeQueryItem, 0, len(rows))
	for _, r := range rows {
		item := EmployeeQueryItem{ObjectID: r.ObjectID, Entity: EntityEmployee, Code: r.Code, DisplayName: r.DisplayName, CurrentOperatingEntity: EmployeeOperatingEntitySnapshot{SourceObjectID: r.CurrentOperatingEntityID, ApprovalEntryID: r.CurrentOperatingEntityApprovalEntryID, Code: r.CurrentOperatingEntityCode, Name: r.CurrentOperatingEntityName}, UpdatedAt: r.UpdatedAt.Time}
		if r.LatestApprovedEntryID != "" {
			v, e := s.loadVersionView(ctx, s.queries, r.LatestApprovedEntryID, r.ObjectID)
			if e != nil {
				return Page[EmployeeQueryItem]{}, e
			}
			item.LatestApproved = &v
		}
		if r.OpenEntryID != "" {
			v, e := s.loadVersionView(ctx, s.queries, r.OpenEntryID, r.ObjectID)
			if e != nil {
				return Page[EmployeeQueryItem]{}, e
			}
			item.OpenVersion = &v
		}
		entry, ok, entryErr := dclActiveEntry(ctx, s.queries, EntityEmployee, r.OpenEntryID, r.LatestApprovedEntryID)
		if entryErr != nil {
			return Page[EmployeeQueryItem]{}, entryErr
		}
		if ok {
			item.AvailableApprovalActions = s.coordinator.LifecycleActions(entry, actor)
		}
		items = append(items, item)
	}
	return Page[EmployeeQueryItem]{Items: items, Total: total, Page: input.Page, PageSize: input.PageSize}, nil
}

func (s *EmployeeService) Get(ctx context.Context, input EmployeeGetInput, actor approval.Actor) (EmployeeView, error) {
	if !validID(input.ObjectID) || (input.ApprovalEntryID != "" && !validID(input.ApprovalEntryID)) || !validActor(actor) {
		return EmployeeView{}, newError(ErrorValidation, "validation_failed", "invalid employee declaration get request", nil, nil)
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return EmployeeView{}, translateError(err)
	}
	defer tx.Rollback(ctx)
	id := input.ApprovalEntryID
	var entry approval.Entry
	if id == "" {
		entry, err = s.coordinator.GetOpenVersion(ctx, tx, input.ObjectID, actor)
		if approval.IsKey(err, "approval_version_not_found") {
			r, e := s.queries.WithTx(tx).GetLatestApprovedVersion(ctx, dbsqlc.GetLatestApprovedVersionParams{Domain: "dcl", Entity: EntityEmployee, SubjectID: input.ObjectID})
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
		return EmployeeView{}, translateError(err)
	}
	identity, err := lockSubject(ctx, tx, EntityEmployee, input.ObjectID)
	if err != nil {
		return EmployeeView{}, translateError(err)
	}
	data, err := s.loadData(ctx, s.queries.WithTx(tx), id)
	if err != nil {
		return EmployeeView{}, err
	}
	return EmployeeView{ObjectID: identity.ObjectID, Entity: EntityEmployee, Code: identity.Code, Approval: approval.VersionMetaFromEntry(entry), Data: data, UpdatedAt: entry.UpdatedAt, AvailableApprovalActions: s.coordinator.LifecycleActions(entry, actor)}, nil
}

func (s *EmployeeService) Versions(ctx context.Context, input EmployeeHistoryInput, actor approval.Actor) (Page[EmployeeVersionView], error) {
	if _, ok := dclPageOffset(input.Page, input.PageSize); !ok || !validID(input.ObjectID) || !validActor(actor) {
		return Page[EmployeeVersionView]{}, newError(ErrorValidation, "validation_failed", "invalid employee declaration history", nil, nil)
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return Page[EmployeeVersionView]{}, translateError(err)
	}
	defer tx.Rollback(ctx)
	entries, err := s.coordinator.ListVersions(ctx, tx, input.ObjectID, actor)
	if err != nil {
		return Page[EmployeeVersionView]{}, translateError(err)
	}
	start := (input.Page - 1) * input.PageSize
	if start > len(entries) {
		start = len(entries)
	}
	end := min(start+input.PageSize, len(entries))
	q := s.queries.WithTx(tx)
	items := make([]EmployeeVersionView, 0, end-start)
	for _, e := range entries[start:end] {
		v, er := s.loadVersionViewFromEntry(ctx, q, e, input.ObjectID)
		if er != nil {
			return Page[EmployeeVersionView]{}, er
		}
		items = append(items, v)
	}
	return Page[EmployeeVersionView]{Items: items, Total: int64(len(entries)), Page: input.Page, PageSize: input.PageSize}, nil
}

func (s *EmployeeService) AuditHistory(ctx context.Context, input EmployeeHistoryInput, actor approval.Actor) (Page[approval.EventView], error) {
	offset, ok := dclPageOffset(input.Page, input.PageSize)
	if !ok || !validID(input.ObjectID) || !validActor(actor) {
		return Page[approval.EventView]{}, newError(ErrorValidation, "validation_failed", "invalid employee declaration audit history", nil, nil)
	}
	if err := s.coordinator.Authorize(ctx, actor, "audit-history"); err != nil {
		return Page[approval.EventView]{}, translateError(err)
	}
	if _, err := s.queries.GetDCLSubject(ctx, dbsqlc.GetDCLSubjectParams{ID: input.ObjectID, Entity: EntityEmployee}); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Page[approval.EventView]{}, newError(ErrorValidation, "validation_failed", "employee declaration not found", nil, err)
		}
		return Page[approval.EventView]{}, translateError(err)
	}
	rows, err := s.queries.ListDCLEmployeeApprovalEvents(ctx, dbsqlc.ListDCLEmployeeApprovalEventsParams{ObjectID: input.ObjectID, RowOffset: offset, RowLimit: int32(input.PageSize)})
	if err != nil {
		return Page[approval.EventView]{}, translateError(err)
	}
	total, err := s.queries.CountDCLEmployeeApprovalEvents(ctx, input.ObjectID)
	if err != nil {
		return Page[approval.EventView]{}, translateError(err)
	}
	items := make([]approval.EventView, 0, len(rows))
	for _, r := range rows {
		items = append(items, approvalEventView(r))
	}
	return Page[approval.EventView]{Items: items, Total: total, Page: input.Page, PageSize: input.PageSize}, nil
}

func (s *EmployeeService) loadVersionView(ctx context.Context, q *dbsqlc.Queries, entryID, objectID string) (EmployeeVersionView, error) {
	r, err := q.GetApprovalEntry(ctx, dbsqlc.GetApprovalEntryParams{ID: entryID, Domain: "dcl", Entity: EntityEmployee})
	if err != nil {
		return EmployeeVersionView{}, translateError(err)
	}
	return s.loadVersionViewFromEntry(ctx, q, approvalEntry(r), objectID)
}
func (s *EmployeeService) loadVersionViewFromEntry(ctx context.Context, q *dbsqlc.Queries, e approval.Entry, objectID string) (EmployeeVersionView, error) {
	if e.SubjectID != objectID {
		return EmployeeVersionView{}, newError(ErrorValidation, "validation_failed", "declaration version does not belong to subject", nil, nil)
	}
	data, err := s.loadData(ctx, q, e.ID)
	if err != nil {
		return EmployeeVersionView{}, err
	}
	return EmployeeVersionView{Approval: approval.VersionMetaFromEntry(e), Data: data}, nil
}

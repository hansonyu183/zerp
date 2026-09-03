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

func (s *VehicleService) Query(ctx context.Context, input VehicleQueryInput, actor approval.Actor) (Page[VehicleQueryItem], error) {
	offset, ok := dclPageOffset(input.Page, input.PageSize)
	if !ok || !validActor(actor) || len(input.Sort) > 1 {
		return Page[VehicleQueryItem]{}, newError(ErrorValidation, "validation_failed", "invalid vehicle declaration query", nil, nil)
	}
	if err := s.coordinator.Authorize(ctx, actor, "query"); err != nil {
		return Page[VehicleQueryItem]{}, translateError(err)
	}
	statuses := make([]string, 0, len(input.Filters.Status))
	for _, status := range input.Filters.Status {
		if !slices.Contains([]approval.Status{approval.StatusDraft, approval.StatusPending, approval.StatusApproved}, status) || slices.Contains(statuses, string(status)) {
			return Page[VehicleQueryItem]{}, newError(ErrorValidation, "validation_failed", "invalid vehicle declaration status filter", nil, nil)
		}
		statuses = append(statuses, string(status))
	}
	field, order := "updatedAt", "desc"
	if len(input.Sort) == 1 {
		field, order = input.Sort[0].Field, strings.ToLower(input.Sort[0].Order)
		if !slices.Contains([]string{"updatedAt", "code", "name", "status", "version"}, field) || !slices.Contains([]string{"asc", "desc"}, order) {
			return Page[VehicleQueryItem]{}, newError(ErrorValidation, "validation_failed", "invalid vehicle declaration sort", nil, nil)
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
	params := dbsqlc.ListDCLVehiclesParams{Keyword: strings.TrimSpace(input.Filters.Keyword), EnabledFilter: enabled, StatusFilter: statuses, SortField: field, SortOrder: order, RowOffset: offset, RowLimit: int32(input.PageSize)}
	rows, err := s.queries.ListDCLVehicles(ctx, params)
	if err != nil {
		return Page[VehicleQueryItem]{}, translateError(err)
	}
	total, err := s.queries.CountDCLVehicles(ctx, dbsqlc.CountDCLVehiclesParams{Keyword: params.Keyword, EnabledFilter: params.EnabledFilter, StatusFilter: params.StatusFilter})
	if err != nil {
		return Page[VehicleQueryItem]{}, translateError(err)
	}
	items := make([]VehicleQueryItem, 0, len(rows))
	for _, row := range rows {
		code, codeErr := requiredSubjectCode(row.Code)
		if codeErr != nil {
			return Page[VehicleQueryItem]{}, codeErr
		}
		item := VehicleQueryItem{ObjectID: row.ObjectID, Entity: EntityVehicle, Code: code, Enabled: row.Enabled, UpdatedAt: row.UpdatedAt.Time}
		if row.ApprovedEntryID != "" {
			view, viewErr := s.loadVehicleVersionView(ctx, s.queries, row.ApprovedEntryID, row.ObjectID)
			if viewErr != nil {
				return Page[VehicleQueryItem]{}, viewErr
			}
			item.LatestApproved = &view
		}
		if row.OpenEntryID != "" {
			view, viewErr := s.loadVehicleVersionView(ctx, s.queries, row.OpenEntryID, row.ObjectID)
			if viewErr != nil {
				return Page[VehicleQueryItem]{}, viewErr
			}
			item.OpenVersion = &view
		}
		entry, ok, entryErr := dclActiveEntry(ctx, s.queries, EntityVehicle, row.OpenEntryID, row.ApprovedEntryID)
		if entryErr != nil {
			return Page[VehicleQueryItem]{}, entryErr
		}
		if ok {
			item.AvailableApprovalActions = s.coordinator.LifecycleActions(entry, actor)
		}
		items = append(items, item)
	}
	return Page[VehicleQueryItem]{Items: items, Total: total, Page: input.Page, PageSize: input.PageSize}, nil
}

func (s *VehicleService) Get(ctx context.Context, input VehicleGetInput, actor approval.Actor) (VehicleView, error) {
	if !validID(input.ObjectID) || (input.ApprovalEntryID != "" && !validID(input.ApprovalEntryID)) || !validActor(actor) {
		return VehicleView{}, newError(ErrorValidation, "validation_failed", "invalid vehicle declaration get request", nil, nil)
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return VehicleView{}, translateError(err)
	}
	defer tx.Rollback(ctx)
	id := input.ApprovalEntryID
	var entry approval.Entry
	if id == "" {
		entry, err = s.coordinator.GetOpenVersion(ctx, tx, input.ObjectID, actor)
		if approval.IsKey(err, "approval_version_not_found") {
			latest, latestErr := s.queries.WithTx(tx).GetLatestApprovedVersion(ctx, dbsqlc.GetLatestApprovedVersionParams{Domain: "dcl", Entity: EntityVehicle, SubjectID: input.ObjectID})
			err = latestErr
			if latestErr == nil {
				id = latest.ID
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
		return VehicleView{}, translateError(err)
	}
	identity, err := s.queries.WithTx(tx).GetDCLSubject(ctx, dbsqlc.GetDCLSubjectParams{ID: input.ObjectID, Entity: EntityVehicle})
	if err != nil {
		return VehicleView{}, translateError(err)
	}
	stored, err := s.queries.WithTx(tx).GetDCLVehicleVersion(ctx, id)
	if err != nil {
		return VehicleView{}, translateError(err)
	}
	code, err := requiredSubjectCode(identity.Code)
	if err != nil {
		return VehicleView{}, err
	}
	return VehicleView{ObjectID: identity.ID, Entity: EntityVehicle, Code: code, Enabled: stored.Enabled, Approval: approval.VersionMetaFromEntry(entry), Data: vehicleDCLData(vehicleStoredData(stored)), UpdatedAt: entry.UpdatedAt, AvailableApprovalActions: s.coordinator.LifecycleActions(entry, actor)}, nil
}

func (s *VehicleService) Versions(ctx context.Context, input VehicleHistoryInput, actor approval.Actor) (Page[VehicleVersionView], error) {
	if _, ok := dclPageOffset(input.Page, input.PageSize); !ok || !validID(input.ObjectID) || !validActor(actor) {
		return Page[VehicleVersionView]{}, newError(ErrorValidation, "validation_failed", "invalid vehicle declaration history", nil, nil)
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return Page[VehicleVersionView]{}, translateError(err)
	}
	defer tx.Rollback(ctx)
	entries, err := s.coordinator.ListVersions(ctx, tx, input.ObjectID, actor)
	if err != nil {
		return Page[VehicleVersionView]{}, translateError(err)
	}
	start := min((input.Page-1)*input.PageSize, len(entries))
	end := min(start+input.PageSize, len(entries))
	q := s.queries.WithTx(tx)
	items := make([]VehicleVersionView, 0, end-start)
	for _, entry := range entries[start:end] {
		view, viewErr := s.loadVehicleVersionViewFromEntry(ctx, q, entry, input.ObjectID)
		if viewErr != nil {
			return Page[VehicleVersionView]{}, viewErr
		}
		items = append(items, view)
	}
	return Page[VehicleVersionView]{Items: items, Total: int64(len(entries)), Page: input.Page, PageSize: input.PageSize}, nil
}

func (s *VehicleService) AuditHistory(ctx context.Context, input VehicleHistoryInput, actor approval.Actor) (Page[approval.EventView], error) {
	offset, ok := dclPageOffset(input.Page, input.PageSize)
	if !ok || !validID(input.ObjectID) || !validActor(actor) {
		return Page[approval.EventView]{}, newError(ErrorValidation, "validation_failed", "invalid vehicle declaration audit history", nil, nil)
	}
	if err := s.coordinator.Authorize(ctx, actor, "audit-history"); err != nil {
		return Page[approval.EventView]{}, translateError(err)
	}
	if _, err := s.queries.GetDCLSubject(ctx, dbsqlc.GetDCLSubjectParams{ID: input.ObjectID, Entity: EntityVehicle}); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Page[approval.EventView]{}, newError(ErrorValidation, "validation_failed", "vehicle declaration not found", nil, err)
		}
		return Page[approval.EventView]{}, translateError(err)
	}
	rows, err := s.queries.ListDCLVehicleApprovalEvents(ctx, dbsqlc.ListDCLVehicleApprovalEventsParams{ObjectID: input.ObjectID, RowOffset: offset, RowLimit: int32(input.PageSize)})
	if err != nil {
		return Page[approval.EventView]{}, translateError(err)
	}
	total, err := s.queries.CountDCLVehicleApprovalEvents(ctx, input.ObjectID)
	if err != nil {
		return Page[approval.EventView]{}, translateError(err)
	}
	items := make([]approval.EventView, 0, len(rows))
	for _, row := range rows {
		items = append(items, approvalEventView(row))
	}
	return Page[approval.EventView]{Items: items, Total: total, Page: input.Page, PageSize: input.PageSize}, nil
}

func (s *VehicleService) loadVehicleVersionView(ctx context.Context, q *dbsqlc.Queries, entryID, objectID string) (VehicleVersionView, error) {
	entry, err := q.GetApprovalEntry(ctx, dbsqlc.GetApprovalEntryParams{ID: entryID, Domain: "dcl", Entity: EntityVehicle})
	if err != nil {
		return VehicleVersionView{}, translateError(err)
	}
	return s.loadVehicleVersionViewFromEntry(ctx, q, approvalEntry(entry), objectID)
}

func (s *VehicleService) loadVehicleVersionViewFromEntry(ctx context.Context, q *dbsqlc.Queries, entry approval.Entry, objectID string) (VehicleVersionView, error) {
	if entry.SubjectID != objectID {
		return VehicleVersionView{}, newError(ErrorValidation, "validation_failed", "declaration version does not belong to subject", nil, nil)
	}
	stored, err := q.GetDCLVehicleVersion(ctx, entry.ID)
	if err != nil {
		return VehicleVersionView{}, translateError(err)
	}
	return VehicleVersionView{Approval: approval.VersionMetaFromEntry(entry), Data: vehicleDCLData(vehicleStoredData(stored)), Enabled: stored.Enabled}, nil
}

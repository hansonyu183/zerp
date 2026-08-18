package app

import (
	"context"
	"errors"

	dbsqlc "github.com/hansonyu183/zerp/backend/internal/database/sqlc"
	"github.com/jackc/pgx/v5"
)

func (s *Service) QueryPermissions(ctx context.Context, request PageRequest, principal Principal) (Page[PermissionView], error) {
	spec, err := validateFixedPage(request, "path", "asc")
	if err != nil {
		return Page[PermissionView]{}, err
	}
	if err = validateFilterKeys(request.Filters, "domain", "entity", "status"); err != nil {
		return Page[PermissionView]{}, err
	}
	status, err := optionalStatus(request.Filters["status"])
	if err != nil {
		return Page[PermissionView]{}, err
	}
	domain, err := optionalSegment(request.Filters["domain"])
	if err != nil {
		return Page[PermissionView]{}, err
	}
	entity, err := optionalSegment(request.Filters["entity"])
	if err != nil {
		return Page[PermissionView]{}, err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return Page[PermissionView]{}, s.internal("begin permission query", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	qtx := s.queries.WithTx(tx)
	if err = qtx.AcquireAppAuthorizationLock(ctx); err != nil {
		return Page[PermissionView]{}, s.internal("lock permission query", err)
	}
	actor, err := s.currentActorAuthorization(ctx, qtx, principal)
	if err != nil {
		return Page[PermissionView]{}, err
	}
	if err = actor.require("/app/permission/query"); err != nil {
		return Page[PermissionView]{}, err
	}
	total, err := qtx.CountAppPermissions(ctx, dbsqlc.CountAppPermissionsParams{Domain: domain, Entity: entity, Status: status})
	if err != nil {
		return Page[PermissionView]{}, s.internal("count permissions", err)
	}
	rows, err := qtx.ListAppPermissions(ctx, dbsqlc.ListAppPermissionsParams{Domain: domain, Entity: entity, Status: status, SortOrder: spec.SortOrder, PageOffset: spec.Offset, PageSize: int32(spec.PageSize)})
	if err != nil {
		return Page[PermissionView]{}, s.internal("list permissions", err)
	}
	items := make([]PermissionView, 0, len(rows))
	for _, row := range rows {
		view := permissionView(row)
		view.Assignable = row.Status == StatusEnabled && actor.permissionIDs[row.ID]
		items = append(items, view)
	}
	if err = tx.Commit(ctx); err != nil {
		return Page[PermissionView]{}, s.internal("commit permission query", err)
	}
	return Page[PermissionView]{Items: items, Total: total, Page: spec.Page, PageSize: spec.PageSize}, nil
}

func (s *Service) GetPermission(ctx context.Context, id string, principal Principal) (PermissionDetail, error) {
	if !validPermissionID(id) {
		return PermissionDetail{}, domainError(ErrorValidation, "invalid permission id", nil)
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return PermissionDetail{}, s.internal("begin permission detail", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	qtx := s.queries.WithTx(tx)
	if err = qtx.AcquireAppAuthorizationLock(ctx); err != nil {
		return PermissionDetail{}, s.internal("lock permission detail", err)
	}
	actor, err := s.currentActorAuthorization(ctx, qtx, principal)
	if err != nil {
		return PermissionDetail{}, err
	}
	if err = actor.require("/app/permission/get"); err != nil {
		return PermissionDetail{}, err
	}
	permission, err := qtx.GetAppPermissionByID(ctx, id)
	if errors.Is(err, pgx.ErrNoRows) {
		return PermissionDetail{}, domainError(ErrorNotFound, "permission not found", nil)
	}
	if err != nil {
		return PermissionDetail{}, s.internal("get permission", err)
	}
	count, err := qtx.CountAppRolesUsingPermission(ctx, id)
	if err != nil {
		return PermissionDetail{}, s.internal("count permission references", err)
	}
	view := PermissionDetail{
		Path: permission.Path, Domain: permission.Domain,
		Entity: permission.Entity, Action: permission.Action, Description: permission.Description,
		Status: permission.Status, RoleCount: count,
	}
	if err = tx.Commit(ctx); err != nil {
		return PermissionDetail{}, s.internal("commit permission detail", err)
	}
	return view, nil
}

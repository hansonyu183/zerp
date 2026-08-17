package app

import (
	"context"
	"errors"

	dbsqlc "github.com/hansonyu183/zerp/backend/internal/database/sqlc"
	"github.com/jackc/pgx/v5"
)

func (s *Service) QueryPermissions(ctx context.Context, request PageRequest) (Page[PermissionView], error) {
	spec, err := validatePage(request, map[string]bool{"path": true}, "path", "asc")
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
	total, err := s.queries.CountAppPermissions(ctx, dbsqlc.CountAppPermissionsParams{Domain: domain, Entity: entity, Status: status})
	if err != nil {
		return Page[PermissionView]{}, s.internal("count permissions", err)
	}
	rows, err := s.queries.ListAppPermissions(ctx, dbsqlc.ListAppPermissionsParams{Domain: domain, Entity: entity, Status: status, SortOrder: spec.SortOrder, PageOffset: spec.Offset, PageSize: int32(spec.PageSize)})
	if err != nil {
		return Page[PermissionView]{}, s.internal("list permissions", err)
	}
	items := make([]PermissionView, 0, len(rows))
	for _, row := range rows {
		items = append(items, permissionView(row))
	}
	return Page[PermissionView]{Items: items, Total: total, Page: spec.Page, PageSize: spec.PageSize}, nil
}

func (s *Service) GetPermission(ctx context.Context, id string) (PermissionView, error) {
	if !validPermissionID(id) {
		return PermissionView{}, domainError(ErrorValidation, "invalid permission id", nil)
	}
	permission, err := s.queries.GetAppPermissionByID(ctx, id)
	if errors.Is(err, pgx.ErrNoRows) {
		return PermissionView{}, domainError(ErrorNotFound, "permission not found", nil)
	}
	if err != nil {
		return PermissionView{}, s.internal("get permission", err)
	}
	count, err := s.queries.CountAppRolesUsingPermission(ctx, id)
	if err != nil {
		return PermissionView{}, s.internal("count permission references", err)
	}
	view := permissionView(permission)
	view.RoleCount = &count
	return view, nil
}

func (s *Service) QueryPermissionsAs(ctx context.Context, request PageRequest, principal Principal) (Page[PermissionView], error) {
	spec, err := validatePage(request, map[string]bool{"path": true}, "path", "asc")
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

func (s *Service) GetPermissionAs(ctx context.Context, id string, principal Principal) (PermissionView, error) {
	if !validPermissionID(id) {
		return PermissionView{}, domainError(ErrorValidation, "invalid permission id", nil)
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return PermissionView{}, s.internal("begin permission detail", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	qtx := s.queries.WithTx(tx)
	if err = qtx.AcquireAppAuthorizationLock(ctx); err != nil {
		return PermissionView{}, s.internal("lock permission detail", err)
	}
	actor, err := s.currentActorAuthorization(ctx, qtx, principal)
	if err != nil {
		return PermissionView{}, err
	}
	if err = actor.require("/app/permission/get"); err != nil {
		return PermissionView{}, err
	}
	permission, err := qtx.GetAppPermissionByID(ctx, id)
	if errors.Is(err, pgx.ErrNoRows) {
		return PermissionView{}, domainError(ErrorNotFound, "permission not found", nil)
	}
	if err != nil {
		return PermissionView{}, s.internal("get permission", err)
	}
	count, err := qtx.CountAppRolesUsingPermission(ctx, id)
	if err != nil {
		return PermissionView{}, s.internal("count permission references", err)
	}
	view := permissionView(permission)
	view.RoleCount = &count
	view.Assignable = permission.Status == StatusEnabled && actor.permissionIDs[permission.ID]
	if err = tx.Commit(ctx); err != nil {
		return PermissionView{}, s.internal("commit permission detail", err)
	}
	return view, nil
}

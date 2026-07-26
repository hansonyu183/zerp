package app

import (
	"context"
	"errors"
	"strings"

	dbsqlc "github.com/hansonyu183/zerp-back/internal/database/sqlc"
	"github.com/jackc/pgx/v5"
)

func (s *Service) QueryRoles(ctx context.Context, request PageRequest) (Page[RoleView], error) {
	spec, err := validatePage(request, map[string]bool{"createdAt": true, "code": true, "name": true}, "createdAt", "desc")
	if err != nil {
		return Page[RoleView]{}, err
	}
	if err = validateFilterKeys(request.Filters, "status", "search"); err != nil {
		return Page[RoleView]{}, err
	}
	status, err := optionalStatus(request.Filters["status"])
	if err != nil {
		return Page[RoleView]{}, err
	}
	search, err := optionalSearch(request.Filters["search"])
	if err != nil {
		return Page[RoleView]{}, err
	}
	total, err := s.queries.CountAppRoles(ctx, dbsqlc.CountAppRolesParams{Status: status, Search: search})
	if err != nil {
		return Page[RoleView]{}, s.internal("count roles", err)
	}
	rows, err := s.queries.ListAppRoles(ctx, dbsqlc.ListAppRolesParams{Status: status, Search: search, SortField: spec.SortField, SortOrder: spec.SortOrder, PageOffset: spec.Offset, PageSize: int32(spec.PageSize)})
	if err != nil {
		return Page[RoleView]{}, s.internal("list roles", err)
	}
	items := make([]RoleView, 0, len(rows))
	for _, row := range rows {
		items = append(items, roleView(row))
	}
	return Page[RoleView]{Items: items, Total: total, Page: spec.Page, PageSize: spec.PageSize}, nil
}

func (s *Service) GetRole(ctx context.Context, id string) (RoleView, error) {
	if !validID(id) {
		return RoleView{}, domainError(ErrorValidation, "invalid role id", nil)
	}
	role, err := s.queries.GetAppRoleByID(ctx, id)
	if errors.Is(err, pgx.ErrNoRows) {
		return RoleView{}, domainError(ErrorNotFound, "role not found", nil)
	}
	if err != nil {
		return RoleView{}, s.internal("get role", err)
	}
	var permissions []string
	if role.Code == superadminRoleCode {
		permissions, err = s.queries.ListAllEnabledAppPermissionIDs(ctx)
	} else {
		permissions, err = s.queries.GetAppRolePermissionIDs(ctx, id)
	}
	if err != nil {
		return RoleView{}, s.internal("get role permissions", err)
	}
	view := roleView(role)
	view.PermissionIDs = permissions
	return view, nil
}

func (s *Service) CreateRole(ctx context.Context, input CreateRoleInput, actorID, requestID string) (RoleView, error) {
	input.Code = strings.ToLower(strings.TrimSpace(input.Code))
	input.Name = strings.TrimSpace(input.Name)
	input.PermissionIDs = uniqueStrings(input.PermissionIDs)
	if !validSegment(input.Code) || len(input.Code) > 64 || !runeLengthBetween(input.Name, 1, 128) || !validPermissionIDs(input.PermissionIDs) {
		return RoleView{}, domainError(ErrorValidation, "invalid role fields", nil)
	}
	if input.Code == superadminRoleCode {
		return RoleView{}, domainError(ErrorValidation, "role code is reserved", nil)
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return RoleView{}, s.internal("begin create role", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	qtx := s.queries.WithTx(tx)
	if err = qtx.AcquireAppAuthorizationLock(ctx); err != nil {
		return RoleView{}, s.internal("lock role authorization update", err)
	}
	if err = validatePermissions(ctx, qtx, input.PermissionIDs); err != nil {
		return RoleView{}, err
	}
	id := newID()
	if err = qtx.InsertAppRole(ctx, dbsqlc.InsertAppRoleParams{ID: id, Code: input.Code, Name: input.Name, Description: trimOptional(input.Description), ActorID: &actorID}); err != nil {
		return RoleView{}, s.writeError("create role", err)
	}
	if err = replaceRolePermissions(ctx, qtx, id, input.PermissionIDs, actorID); err != nil {
		return RoleView{}, err
	}
	if err = s.audit(ctx, qtx, "ROLE_CREATE", &actorID, "role", &id, "SUCCESS", requestID, map[string]any{"permissionCount": len(input.PermissionIDs)}); err != nil {
		return RoleView{}, s.internal("audit create role", err)
	}
	if err = tx.Commit(ctx); err != nil {
		return RoleView{}, s.internal("commit create role", err)
	}
	return s.GetRole(ctx, id)
}

func (s *Service) SaveRole(ctx context.Context, input SaveRoleInput, actorID, requestID string) (RoleView, error) {
	input.Name = strings.TrimSpace(input.Name)
	input.PermissionIDs = uniqueStrings(input.PermissionIDs)
	if !validID(input.ID) || input.Revision < 1 || !runeLengthBetween(input.Name, 1, 128) {
		return RoleView{}, domainError(ErrorValidation, "invalid role fields", nil)
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return RoleView{}, s.internal("begin save role", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	qtx := s.queries.WithTx(tx)
	if err = qtx.AcquireAppAuthorizationLock(ctx); err != nil {
		return RoleView{}, s.internal("lock role authorization update", err)
	}
	role, err := qtx.GetAppRoleByID(ctx, input.ID)
	if errors.Is(err, pgx.ErrNoRows) {
		return RoleView{}, domainError(ErrorNotFound, "role not found", nil)
	}
	if err != nil {
		return RoleView{}, s.internal("get role for save", err)
	}
	if role.Code != superadminRoleCode {
		if !validPermissionIDs(input.PermissionIDs) {
			return RoleView{}, domainError(ErrorValidation, "invalid role fields", nil)
		}
		if err = validatePermissions(ctx, qtx, input.PermissionIDs); err != nil {
			return RoleView{}, err
		}
	}
	rows, err := qtx.UpdateAppRole(ctx, dbsqlc.UpdateAppRoleParams{ID: input.ID, Name: input.Name, Description: trimOptional(input.Description), Revision: input.Revision, ActorID: &actorID})
	if err != nil {
		return RoleView{}, s.writeError("save role", err)
	}
	if rows != 1 {
		return RoleView{}, classifyRoleWriteMiss(ctx, qtx, input.ID, input.Revision, "")
	}
	if role.Code == superadminRoleCode {
		if err = qtx.DeleteAppRolePermissions(ctx, input.ID); err != nil {
			return RoleView{}, s.internal("clear superadmin role permissions", err)
		}
	} else {
		if err = replaceRolePermissions(ctx, qtx, input.ID, input.PermissionIDs, actorID); err != nil {
			return RoleView{}, err
		}
	}
	if err = ensureGlobalAuthorizationSafety(ctx, qtx); err != nil {
		return RoleView{}, err
	}
	summary := map[string]any{"permissionCount": len(input.PermissionIDs)}
	if role.Code == superadminRoleCode {
		summary = map[string]any{"permissionMode": "wildcard"}
	}
	if err = s.audit(ctx, qtx, "ROLE_SAVE", &actorID, "role", &input.ID, "SUCCESS", requestID, summary); err != nil {
		return RoleView{}, s.internal("audit save role", err)
	}
	if err = tx.Commit(ctx); err != nil {
		return RoleView{}, s.internal("commit save role", err)
	}
	return s.GetRole(ctx, input.ID)
}

func (s *Service) SetRoleStatus(ctx context.Context, id string, revision int64, status, actorID, requestID string) (RoleView, error) {
	if !validID(id) || revision < 1 || (status != StatusEnabled && status != StatusDisabled) {
		return RoleView{}, domainError(ErrorValidation, "invalid status request", nil)
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return RoleView{}, s.internal("begin role status", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	qtx := s.queries.WithTx(tx)
	if err = qtx.AcquireAppAuthorizationLock(ctx); err != nil {
		return RoleView{}, s.internal("lock role status update", err)
	}
	if status == StatusDisabled {
		remaining, countErr := qtx.CountEnabledUsersWithPermissionExcludingRole(ctx, dbsqlc.CountEnabledUsersWithPermissionExcludingRoleParams{ExcludedRoleID: id, Path: "/app/role/save"})
		if countErr != nil {
			return RoleView{}, s.internal("check role authorization lockout", countErr)
		}
		if remaining == 0 {
			return RoleView{}, domainError(ErrorConflict, "cannot disable the last authorization administrator role", nil)
		}
	}
	rows, err := qtx.SetAppRoleStatus(ctx, dbsqlc.SetAppRoleStatusParams{ID: id, Revision: revision, Status: status, ActorID: &actorID})
	if err != nil {
		return RoleView{}, s.writeError("set role status", err)
	}
	if rows != 1 {
		return RoleView{}, classifyRoleWriteMiss(ctx, qtx, id, revision, status)
	}
	if err = ensureGlobalAuthorizationSafety(ctx, qtx); err != nil {
		return RoleView{}, err
	}
	if err = s.audit(ctx, qtx, "ROLE_"+status, &actorID, "role", &id, "SUCCESS", requestID, nil); err != nil {
		return RoleView{}, s.internal("audit role status", err)
	}
	if err = tx.Commit(ctx); err != nil {
		return RoleView{}, s.internal("commit role status", err)
	}
	return s.GetRole(ctx, id)
}

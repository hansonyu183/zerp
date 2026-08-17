package app

import (
	"context"
	"errors"
	"strings"

	dbsqlc "github.com/hansonyu183/zerp/backend/internal/database/sqlc"
	"github.com/jackc/pgx/v5"
)

func validateRoleQuery(request PageRequest) (pageSpec, *string, *string, error) {
	if request.Page < 1 || request.PageSize != 20 || len(request.Sort) != 1 || request.Sort[0].Field != "code" || strings.ToLower(request.Sort[0].Order) != "asc" {
		return pageSpec{}, nil, nil, domainError(ErrorValidation, "invalid role query pagination or sort", nil)
	}
	if err := validateFilterKeys(request.Filters, "status", "search"); err != nil {
		return pageSpec{}, nil, nil, err
	}
	status, err := optionalStatus(request.Filters["status"])
	if err != nil {
		return pageSpec{}, nil, nil, err
	}
	search, err := optionalSearch(request.Filters["search"])
	if err != nil {
		return pageSpec{}, nil, nil, err
	}
	spec, err := validatePage(request, map[string]bool{"code": true}, "code", "asc")
	return spec, status, search, err
}

func (s *Service) QueryRoles(ctx context.Context, request PageRequest, principal Principal) (Page[RoleListItem], error) {
	spec, status, search, err := validateRoleQuery(request)
	if err != nil {
		return Page[RoleListItem]{}, err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return Page[RoleListItem]{}, s.internal("begin role query", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	qtx := s.queries.WithTx(tx)
	if err = qtx.AcquireAppAuthorizationLock(ctx); err != nil {
		return Page[RoleListItem]{}, s.internal("lock role query", err)
	}
	actor, err := s.currentActorAuthorization(ctx, qtx, principal)
	if err != nil {
		return Page[RoleListItem]{}, err
	}
	if err = actor.require("/app/role/query"); err != nil {
		return Page[RoleListItem]{}, err
	}
	total, err := qtx.CountAppRoles(ctx, dbsqlc.CountAppRolesParams{Status: status, Search: search})
	if err != nil {
		return Page[RoleListItem]{}, s.internal("count roles", err)
	}
	rows, err := qtx.ListAppRoles(ctx, dbsqlc.ListAppRolesParams{Status: status, Search: search, SortField: spec.SortField, SortOrder: spec.SortOrder, PageOffset: spec.Offset, PageSize: int32(spec.PageSize)})
	if err != nil {
		return Page[RoleListItem]{}, s.internal("list roles", err)
	}
	items := make([]RoleListItem, 0, len(rows))
	for _, role := range rows {
		item, itemErr := s.roleListItem(ctx, qtx, role, actor)
		if itemErr != nil {
			return Page[RoleListItem]{}, itemErr
		}
		items = append(items, item)
	}
	if err = tx.Commit(ctx); err != nil {
		return Page[RoleListItem]{}, s.internal("commit role query", err)
	}
	return Page[RoleListItem]{Items: items, Total: total, Page: spec.Page, PageSize: spec.PageSize}, nil
}

func (s *Service) GetRole(ctx context.Context, id string, principal Principal) (RoleDetail, error) {
	if !validID(id) {
		return RoleDetail{}, domainError(ErrorValidation, "invalid role id", nil)
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return RoleDetail{}, s.internal("begin role detail", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	qtx := s.queries.WithTx(tx)
	if err = qtx.AcquireAppAuthorizationLock(ctx); err != nil {
		return RoleDetail{}, s.internal("lock role detail", err)
	}
	actor, err := s.currentActorAuthorization(ctx, qtx, principal)
	if err != nil {
		return RoleDetail{}, err
	}
	if err = actor.require("/app/role/get"); err != nil {
		return RoleDetail{}, err
	}
	role, err := qtx.GetAppRoleByID(ctx, id)
	if errors.Is(err, pgx.ErrNoRows) {
		return RoleDetail{}, domainError(ErrorNotFound, "role not found", nil)
	}
	if err != nil {
		return RoleDetail{}, s.internal("get role", err)
	}
	detail, err := s.roleDetail(ctx, qtx, role, actor)
	if err != nil {
		return RoleDetail{}, err
	}
	if err = tx.Commit(ctx); err != nil {
		return RoleDetail{}, s.internal("commit role detail", err)
	}
	return detail, nil
}

func (s *Service) CreateRole(ctx context.Context, input CreateRoleInput, principal Principal, requestID string) (RoleDetail, error) {
	input.Name = strings.TrimSpace(input.Name)
	input.PermissionIDs = uniqueStrings(input.PermissionIDs)
	if strings.TrimSpace(input.Code) != "" {
		return RoleDetail{}, domainError(ErrorValidation, "role code is server assigned", nil)
	}
	if !runeLengthBetween(input.Name, 1, 128) || !validPermissionIDs(input.PermissionIDs) {
		return RoleDetail{}, domainError(ErrorValidation, "invalid role fields", nil)
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return RoleDetail{}, s.internal("begin create role", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	qtx := s.queries.WithTx(tx)
	if err = qtx.AcquireAppAuthorizationLock(ctx); err != nil {
		return RoleDetail{}, s.internal("lock role authorization update", err)
	}
	actor, err := s.currentActorAuthorization(ctx, qtx, principal)
	if err != nil {
		return RoleDetail{}, err
	}
	if err = actor.require("/app/role/create"); err != nil {
		return RoleDetail{}, err
	}
	if err = actor.require("/app/permission/query"); err != nil {
		return RoleDetail{}, err
	}
	if err = ensureRoleNameUnique(ctx, qtx, input.Name, ""); err != nil {
		return RoleDetail{}, err
	}
	if err = validatePermissions(ctx, qtx, input.PermissionIDs); err != nil {
		return RoleDetail{}, err
	}
	if !withinActorCeiling(input.PermissionIDs, actor) {
		return RoleDetail{}, domainError(ErrorForbidden, "requested permissions exceed authorization ceiling", nil)
	}
	code, err := qtx.NextAppRoleCode(ctx)
	if err != nil {
		return RoleDetail{}, domainError(ErrorConflict, "role code capacity exhausted", nil)
	}
	id := newID()
	if err = qtx.InsertAppRole(ctx, dbsqlc.InsertAppRoleParams{ID: id, Code: code, Name: input.Name, Description: trimOptional(input.Description), ActorID: &actor.id}); err != nil {
		return RoleDetail{}, s.writeError("create role", err)
	}
	if err = replaceRolePermissions(ctx, qtx, id, input.PermissionIDs, actor.id); err != nil {
		return RoleDetail{}, err
	}
	if err = s.audit(ctx, qtx, "ROLE_CREATE", &actor.id, "role", &id, "SUCCESS", requestID, map[string]any{"permissionCount": len(input.PermissionIDs)}); err != nil {
		return RoleDetail{}, s.internal("audit create role", err)
	}
	if err = tx.Commit(ctx); err != nil {
		return RoleDetail{}, s.internal("commit create role", err)
	}
	return s.GetRole(ctx, id, principal)
}

func (s *Service) SaveRole(ctx context.Context, input SaveRoleInput, principal Principal, requestID string) (RoleDetail, error) {
	input.Name = strings.TrimSpace(input.Name)
	input.PermissionIDs = uniqueStrings(input.PermissionIDs)
	if !validID(input.ID) || input.Revision < 1 || !runeLengthBetween(input.Name, 1, 128) || !validPermissionIDs(input.PermissionIDs) {
		return RoleDetail{}, domainError(ErrorValidation, "invalid role fields", nil)
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return RoleDetail{}, s.internal("begin save role", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	qtx := s.queries.WithTx(tx)
	if err = qtx.AcquireAppAuthorizationLock(ctx); err != nil {
		return RoleDetail{}, s.internal("lock role authorization update", err)
	}
	actor, err := s.currentActorAuthorization(ctx, qtx, principal)
	if err != nil {
		return RoleDetail{}, err
	}
	if err = actor.require("/app/role/save"); err != nil {
		return RoleDetail{}, err
	}
	if err = actor.require("/app/permission/query"); err != nil {
		return RoleDetail{}, err
	}
	role, err := qtx.GetAppRoleByIDForUpdate(ctx, input.ID)
	if errors.Is(err, pgx.ErrNoRows) {
		return RoleDetail{}, domainError(ErrorNotFound, "role not found", nil)
	}
	if err != nil {
		return RoleDetail{}, s.internal("get role for save", err)
	}
	manageable, err := s.roleManageable(ctx, qtx, role, actor)
	if err != nil {
		return RoleDetail{}, err
	}
	if !manageable {
		return RoleDetail{}, domainError(ErrorForbidden, "role cannot be maintained", nil)
	}
	if err = ensureRoleNameUnique(ctx, qtx, input.Name, input.ID); err != nil {
		return RoleDetail{}, err
	}
	if err = validatePermissions(ctx, qtx, input.PermissionIDs); err != nil {
		return RoleDetail{}, err
	}
	if !withinActorCeiling(input.PermissionIDs, actor) {
		return RoleDetail{}, domainError(ErrorForbidden, "requested permissions exceed authorization ceiling", nil)
	}
	rows, err := qtx.UpdateAppRole(ctx, dbsqlc.UpdateAppRoleParams{ID: input.ID, Name: input.Name, Description: trimOptional(input.Description), Revision: input.Revision, ActorID: &actor.id})
	if err != nil {
		return RoleDetail{}, s.writeError("save role", err)
	}
	if rows != 1 {
		return RoleDetail{}, classifyRoleWriteMiss(ctx, qtx, input.ID, input.Revision, "")
	}
	if err = replaceRolePermissions(ctx, qtx, input.ID, input.PermissionIDs, actor.id); err != nil {
		return RoleDetail{}, err
	}
	if err = ensureGlobalAuthorizationSafety(ctx, qtx); err != nil {
		return RoleDetail{}, err
	}
	if err = s.audit(ctx, qtx, "ROLE_SAVE", &actor.id, "role", &input.ID, "SUCCESS", requestID, map[string]any{"permissionCount": len(input.PermissionIDs)}); err != nil {
		return RoleDetail{}, s.internal("audit save role", err)
	}
	if err = tx.Commit(ctx); err != nil {
		return RoleDetail{}, s.internal("commit save role", err)
	}
	return s.GetRole(ctx, input.ID, principal)
}

func (s *Service) SetRoleStatus(ctx context.Context, id string, revision int64, status string, principal Principal, requestID string) (RoleDetail, error) {
	if !validID(id) || revision < 1 || (status != StatusEnabled && status != StatusDisabled) {
		return RoleDetail{}, domainError(ErrorValidation, "invalid status request", nil)
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return RoleDetail{}, s.internal("begin role status", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	qtx := s.queries.WithTx(tx)
	if err = qtx.AcquireAppAuthorizationLock(ctx); err != nil {
		return RoleDetail{}, s.internal("lock role status update", err)
	}
	actor, err := s.currentActorAuthorization(ctx, qtx, principal)
	if err != nil {
		return RoleDetail{}, err
	}
	path := "/app/role/enable"
	if status == StatusDisabled {
		path = "/app/role/disable"
	}
	if err = actor.require(path); err != nil {
		return RoleDetail{}, err
	}
	role, err := qtx.GetAppRoleByIDForUpdate(ctx, id)
	if errors.Is(err, pgx.ErrNoRows) {
		return RoleDetail{}, domainError(ErrorNotFound, "role not found", nil)
	}
	if err != nil {
		return RoleDetail{}, s.internal("get role for status", err)
	}
	manageable, err := s.roleManageable(ctx, qtx, role, actor)
	if err != nil {
		return RoleDetail{}, err
	}
	if !manageable {
		return RoleDetail{}, domainError(ErrorForbidden, "role cannot be maintained", nil)
	}
	rows, err := qtx.SetAppRoleStatus(ctx, dbsqlc.SetAppRoleStatusParams{ID: id, Revision: revision, Status: status, ActorID: &actor.id})
	if err != nil {
		return RoleDetail{}, s.writeError("set role status", err)
	}
	if rows != 1 {
		return RoleDetail{}, classifyRoleWriteMiss(ctx, qtx, id, revision, status)
	}
	if err = ensureGlobalAuthorizationSafety(ctx, qtx); err != nil {
		return RoleDetail{}, err
	}
	if err = s.audit(ctx, qtx, "ROLE_"+status, &actor.id, "role", &id, "SUCCESS", requestID, nil); err != nil {
		return RoleDetail{}, s.internal("audit role status", err)
	}
	if err = tx.Commit(ctx); err != nil {
		return RoleDetail{}, s.internal("commit role status", err)
	}
	return s.GetRole(ctx, id, principal)
}

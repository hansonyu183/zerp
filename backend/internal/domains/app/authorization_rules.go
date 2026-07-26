package app

import (
	"context"
	"errors"
	"fmt"
	"slices"
	"strings"

	dbsqlc "github.com/hansonyu183/zerp-back/internal/database/sqlc"
	"github.com/jackc/pgx/v5"
)

func validateRoles(ctx context.Context, q *dbsqlc.Queries, ids []string) error {
	count, err := q.CountEnabledAppRolesByIDs(ctx, ids)
	if err != nil {
		return domainError(ErrorInternal, "internal server error", err)
	}
	if count != int64(len(ids)) {
		return domainError(ErrorValidation, "one or more roles do not exist or are disabled", nil)
	}
	return nil
}

func replaceUserRoles(ctx context.Context, q *dbsqlc.Queries, userID string, roleIDs []string, actorID string) error {
	if err := q.DeleteAppUserRoles(ctx, userID); err != nil {
		return domainError(ErrorInternal, "internal server error", err)
	}
	for _, roleID := range roleIDs {
		if err := q.InsertAppUserRole(ctx, dbsqlc.InsertAppUserRoleParams{UserID: userID, RoleID: roleID, ActorID: &actorID}); err != nil {
			return domainError(ErrorInternal, "internal server error", err)
		}
	}
	return nil
}

func ensureSafeSignout(ctx context.Context, q *dbsqlc.Queries, userID string) error {
	paths, err := q.GetAppUserPermissions(ctx, userID)
	if err != nil {
		return domainError(ErrorInternal, "internal server error", err)
	}
	if !slices.Contains(paths, signoutPath) {
		return domainError(ErrorValidation, "assigned roles must grant /app/user/signout", nil)
	}
	return nil
}

func ensureGlobalAuthorizationSafety(ctx context.Context, q *dbsqlc.Queries) error {
	admins, err := q.CountEnabledUsersWithPermission(ctx, "/app/role/save")
	if err != nil {
		return domainError(ErrorInternal, "internal server error", err)
	}
	if admins == 0 {
		return domainError(ErrorConflict, "change would remove the last authorization administrator", nil)
	}
	missingSignout, err := q.CountEnabledUsersMissingPermission(ctx, signoutPath)
	if err != nil {
		return domainError(ErrorInternal, "internal server error", err)
	}
	if missingSignout != 0 {
		return domainError(ErrorConflict, "every enabled user must retain /app/user/signout", nil)
	}
	return nil
}

func validatePermissions(ctx context.Context, q *dbsqlc.Queries, ids []string) error {
	count, err := q.CountEnabledAppPermissionsByIDs(ctx, ids)
	if err != nil {
		return domainError(ErrorInternal, "internal server error", err)
	}
	if count != int64(len(ids)) {
		return domainError(ErrorValidation, "one or more permissions do not exist or are disabled", nil)
	}
	paths, err := q.ListAppPermissionPathsByIDs(ctx, ids)
	if err != nil {
		return domainError(ErrorInternal, "internal server error", err)
	}
	pathSet := make(map[string]bool, len(paths))
	for _, path := range paths {
		pathSet[path] = true
	}
	for _, path := range paths {
		parts := strings.Split(strings.TrimPrefix(path, "/"), "/")
		if len(parts) != 3 || path == signoutPath ||
			path == "/app/user/profile" || path == "/app/user/change-password" {
			continue
		}
		readAction := "query"
		if parts[0] == "led" && parts[1] == "opening" {
			readAction = "get"
		}
		if parts[2] == readAction {
			continue
		}
		readPath := "/" + parts[0] + "/" + parts[1] + "/" + readAction
		if !pathSet[readPath] {
			return domainError(ErrorValidation, fmt.Sprintf("permission %s requires %s", path, readPath), nil)
		}
	}
	return nil
}

func replaceRolePermissions(ctx context.Context, q *dbsqlc.Queries, roleID string, permissionIDs []string, actorID string) error {
	if err := q.DeleteAppRolePermissions(ctx, roleID); err != nil {
		return domainError(ErrorInternal, "internal server error", err)
	}
	for _, permissionID := range permissionIDs {
		if err := q.InsertAppRolePermission(ctx, dbsqlc.InsertAppRolePermissionParams{RoleID: roleID, PermissionID: permissionID, ActorID: &actorID}); err != nil {
			return domainError(ErrorInternal, "internal server error", err)
		}
	}
	return nil
}

func classifyUserWriteMiss(ctx context.Context, q *dbsqlc.Queries, id string, revision int64, desiredStatus string) error {
	user, err := q.GetAppUserByID(ctx, id)
	if errors.Is(err, pgx.ErrNoRows) {
		return domainError(ErrorNotFound, "user not found", nil)
	}
	if err != nil {
		return domainError(ErrorInternal, "internal server error", err)
	}
	if user.Revision != revision {
		return domainError(ErrorConflict, "user revision conflict", nil)
	}
	if desiredStatus != "" && user.Status == desiredStatus {
		return domainError(ErrorConflict, "user status unchanged", nil)
	}
	return domainError(ErrorConflict, "user changed concurrently", nil)
}

func classifyRoleWriteMiss(ctx context.Context, q *dbsqlc.Queries, id string, revision int64, desiredStatus string) error {
	role, err := q.GetAppRoleByID(ctx, id)
	if errors.Is(err, pgx.ErrNoRows) {
		return domainError(ErrorNotFound, "role not found", nil)
	}
	if err != nil {
		return domainError(ErrorInternal, "internal server error", err)
	}
	if role.Revision != revision {
		return domainError(ErrorConflict, "role revision conflict", nil)
	}
	if desiredStatus != "" && role.Status == desiredStatus {
		return domainError(ErrorConflict, "role status unchanged", nil)
	}
	return domainError(ErrorConflict, "role changed concurrently", nil)
}

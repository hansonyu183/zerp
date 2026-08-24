package app

import (
	"context"
	"errors"

	dbsqlc "github.com/hansonyu183/zerp/backend/internal/database/sqlc"
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

func ensureGlobalAuthorizationSafety(ctx context.Context, q *dbsqlc.Queries) error {
	admins, err := q.CountEnabledUsersWithPermission(ctx, "/app/role/save")
	if err != nil {
		return domainError(ErrorInternal, "internal server error", err)
	}
	if admins == 0 {
		return domainError(ErrorConflict, "change would remove the last authorization administrator", nil)
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
		return domainErrorWithKey(ErrorConflict, "user_changed", "user revision conflict", nil)
	}
	if desiredStatus != "" && user.Status == desiredStatus {
		return domainError(ErrorConflict, "user status unchanged", nil)
	}
	return domainErrorWithKey(ErrorConflict, "user_changed", "user changed concurrently", nil)
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
		return domainErrorWithKey(ErrorConflict, "role_changed", "role revision conflict", nil)
	}
	if desiredStatus != "" && role.Status == desiredStatus {
		return domainError(ErrorConflict, "role status unchanged", nil)
	}
	return domainErrorWithKey(ErrorConflict, "role_changed", "role changed concurrently", nil)
}

package app

import (
	"context"
	"errors"

	dbsqlc "github.com/hansonyu183/zerp/backend/internal/database/sqlc"
	"github.com/jackc/pgx/v5"
)

func (s *Service) userManageable(ctx context.Context, q *dbsqlc.Queries, user UserView, actor actorAuthorization) (bool, error) {
	if user.System {
		return false, nil
	}
	if user.ID == actor.id {
		return true, nil
	}
	targetSuperadmin, err := q.UserHoldsSuperadminRole(ctx, user.ID)
	if err != nil {
		return false, domainError(ErrorInternal, "internal server error", err)
	}
	ids, err := q.ListEnabledAppPermissionIDsForUser(ctx, user.ID)
	if err != nil {
		return false, domainError(ErrorInternal, "internal server error", err)
	}
	return targetWithinActorCeiling(ids, targetSuperadmin, actor), nil
}

func targetWithinActorCeiling(permissionIDs []string, targetSuperadmin bool, actor actorAuthorization) bool {
	if targetSuperadmin && !actor.superadmin {
		return false
	}
	return withinActorCeiling(permissionIDs, actor)
}

func (s *Service) userRoleSummaries(ctx context.Context, q *dbsqlc.Queries, userID string, actor actorAuthorization) ([]UserRoleSummary, error) {
	rows, err := q.ListAppUserRoleSummaries(ctx, userID)
	if err != nil {
		return nil, domainError(ErrorInternal, "internal server error", err)
	}
	roles := make([]UserRoleSummary, 0, len(rows))
	for _, row := range rows {
		role, err := q.GetAppRoleByID(ctx, row.ID)
		if err != nil {
			return nil, domainError(ErrorInternal, "internal server error", err)
		}
		assignable, err := s.roleAssignable(ctx, q, role, actor)
		if err != nil {
			return nil, err
		}
		roles = append(roles, UserRoleSummary{ID: row.ID, Code: row.Code, Name: row.Name, Status: row.Status, Type: roleType(role), Assignable: assignable})
	}
	return roles, nil
}

func roleAssignmentEditable(userID string, manageable bool, actor actorAuthorization) bool {
	return manageable && userID != actor.id && actor.paths["/app/user/save"] && actor.paths["/app/role/query"]
}

func (s *Service) userDetailAs(ctx context.Context, q *dbsqlc.Queries, user UserView, actor actorAuthorization) (UserDetail, error) {
	manageable, err := s.userManageable(ctx, q, user, actor)
	if err != nil {
		return UserDetail{}, err
	}
	roles, err := s.userRoleSummaries(ctx, q, user.ID, actor)
	if err != nil {
		return UserDetail{}, err
	}
	item := userListItem(user)
	item.Manageable = manageable
	return UserDetail{UserListItem: item, PasswordChangedAt: user.PasswordChangedAt, Roles: roles,
		RoleAssignmentEditable: roleAssignmentEditable(user.ID, manageable, actor)}, nil
}

func (s *Service) requestedRolesAssignable(ctx context.Context, q *dbsqlc.Queries, roleIDs []string, actor actorAuthorization) error {
	if err := validateRoles(ctx, q, roleIDs); err != nil {
		return err
	}
	for _, id := range roleIDs {
		role, err := q.GetAppRoleByID(ctx, id)
		if errors.Is(err, pgx.ErrNoRows) {
			return domainError(ErrorValidation, "one or more roles do not exist or are disabled", nil)
		}
		if err != nil {
			return domainError(ErrorInternal, "internal server error", err)
		}
		assignable, err := s.roleAssignable(ctx, q, role, actor)
		if err != nil {
			return err
		}
		if !assignable {
			return domainError(ErrorForbidden, "one or more roles exceed authorization ceiling", nil)
		}
	}
	return nil
}

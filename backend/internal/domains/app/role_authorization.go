package app

import (
	"bytes"
	"context"
	"errors"
	"time"

	dbsqlc "github.com/hansonyu183/zerp/backend/internal/database/sqlc"
	"github.com/hansonyu183/zerp/backend/internal/platform/systemidentity"
	"github.com/jackc/pgx/v5"
)

type actorAuthorization struct {
	id            string
	superadmin    bool
	paths         map[string]bool
	permissionIDs map[string]bool
}

func (s *Service) currentActorAuthorization(ctx context.Context, q *dbsqlc.Queries, principal Principal) (actorAuthorization, error) {
	if !validID(principal.User.ID) {
		return actorAuthorization{}, domainError(ErrorUnauthenticated, "session expired", nil)
	}
	if principal.SessionID != "" {
		session, err := q.GetAppSessionAuthorizationState(ctx, principal.SessionID)
		if errors.Is(err, pgx.ErrNoRows) || (err == nil && (session.UserID != principal.User.ID || session.RevokedAt.Valid || !session.IdleExpiresAt.Valid || !session.AbsoluteExpiresAt.Valid || !session.IdleExpiresAt.Time.After(time.Now().UTC()) || !session.AbsoluteExpiresAt.Time.After(time.Now().UTC()) || !bytes.Equal(session.CsrfTokenHash, principal.CSRFHash))) {
			return actorAuthorization{}, domainError(ErrorUnauthenticated, "session expired", nil)
		}
		if err != nil {
			return actorAuthorization{}, domainError(ErrorInternal, "internal server error", err)
		}
	}
	user, err := q.GetAppUserByID(ctx, principal.User.ID)
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && user.Status != StatusEnabled) {
		return actorAuthorization{}, domainError(ErrorUnauthenticated, "session expired", nil)
	}
	if err != nil {
		return actorAuthorization{}, domainError(ErrorInternal, "internal server error", err)
	}
	paths, err := q.GetAppUserPermissions(ctx, principal.User.ID)
	if err != nil {
		return actorAuthorization{}, domainError(ErrorInternal, "internal server error", err)
	}
	ids, err := q.ListEnabledAppPermissionIDsForUser(ctx, principal.User.ID)
	if err != nil {
		return actorAuthorization{}, domainError(ErrorInternal, "internal server error", err)
	}
	superadmin, err := q.ActorHasEnabledSuperadminRole(ctx, principal.User.ID)
	if err != nil {
		return actorAuthorization{}, domainError(ErrorInternal, "internal server error", err)
	}
	facts := actorAuthorization{id: principal.User.ID, superadmin: superadmin, paths: map[string]bool{}, permissionIDs: map[string]bool{}}
	for _, path := range paths {
		facts.paths[path] = true
	}
	for _, id := range ids {
		facts.permissionIDs[id] = true
	}
	return facts, nil
}

func (a actorAuthorization) require(path string) error {
	if !a.paths[path] {
		return domainError(ErrorForbidden, "permission denied", nil)
	}
	return nil
}

func roleType(role dbsqlc.AppRole) RoleType {
	switch {
	case role.Code == superadminRoleCode:
		return RoleTypeSuperadmin
	case role.Code == systemidentity.RoleCode || systemidentity.IsRole(role.ID):
		return RoleTypeSystem
	default:
		return RoleTypeNormal
	}
}

func (s *Service) effectiveRolePermissionIDs(ctx context.Context, q *dbsqlc.Queries, role dbsqlc.AppRole) ([]string, error) {
	if role.Code == superadminRoleCode {
		return q.ListAllEnabledAppPermissionIDs(ctx)
	}
	return q.ListEnabledAppRolePermissionIDs(ctx, role.ID)
}

func withinActorCeiling(ids []string, actor actorAuthorization) bool {
	if actor.superadmin {
		return true
	}
	for _, id := range ids {
		if !actor.permissionIDs[id] {
			return false
		}
	}
	return true
}

func (s *Service) roleManageable(ctx context.Context, q *dbsqlc.Queries, role dbsqlc.AppRole, actor actorAuthorization) (bool, error) {
	if roleType(role) != RoleTypeNormal {
		return false, nil
	}
	held, err := q.ActorHoldsAppRole(ctx, dbsqlc.ActorHoldsAppRoleParams{UserID: actor.id, RoleID: role.ID})
	if err != nil {
		return false, domainError(ErrorInternal, "internal server error", err)
	}
	if held {
		return false, nil
	}
	ids, err := s.effectiveRolePermissionIDs(ctx, q, role)
	if err != nil {
		return false, domainError(ErrorInternal, "internal server error", err)
	}
	return withinActorCeiling(ids, actor), nil
}

func (s *Service) roleAssignable(ctx context.Context, q *dbsqlc.Queries, role dbsqlc.AppRole, actor actorAuthorization) (bool, error) {
	if role.Status != StatusEnabled || roleType(role) == RoleTypeSystem {
		return false, nil
	}
	if roleType(role) == RoleTypeSuperadmin {
		return actor.superadmin, nil
	}
	ids, err := s.effectiveRolePermissionIDs(ctx, q, role)
	if err != nil {
		return false, domainError(ErrorInternal, "internal server error", err)
	}
	return withinActorCeiling(ids, actor), nil
}

func (s *Service) roleActions(ctx context.Context, q *dbsqlc.Queries, role dbsqlc.AppRole, actor actorAuthorization) ([]RoleAction, bool, error) {
	assignable, err := s.roleAssignable(ctx, q, role, actor)
	if err != nil {
		return nil, false, err
	}
	actions := make([]RoleAction, 0, 4)
	if actor.paths["/app/role/get"] {
		actions = append(actions, RoleActionView)
	}
	manageable, err := s.roleManageable(ctx, q, role, actor)
	if err != nil {
		return nil, false, err
	}
	if manageable && actor.paths["/app/role/save"] {
		actions = append(actions, RoleActionEdit)
	}
	if manageable && role.Status == StatusDisabled && actor.paths["/app/role/enable"] {
		actions = append(actions, RoleActionEnable)
	}
	if manageable && role.Status == StatusEnabled && actor.paths["/app/role/disable"] {
		actions = append(actions, RoleActionDisable)
	}
	return actions, assignable, nil
}

func rolePermission(id, path, domain, entity, action string, description *string, status string) RolePermission {
	return RolePermission{
		ID: id, Path: path, Domain: domain, Entity: entity,
		Action: action, Description: description, Status: status,
	}
}

func (s *Service) rolePermissionDetails(ctx context.Context, q *dbsqlc.Queries, role dbsqlc.AppRole) ([]RolePermission, error) {
	if role.Code == superadminRoleCode {
		rows, err := q.ListAllEnabledAppPermissionDetails(ctx)
		if err != nil {
			return nil, domainError(ErrorInternal, "internal server error", err)
		}
		items := make([]RolePermission, 0, len(rows))
		for _, p := range rows {
			items = append(items, rolePermission(p.ID, p.Path, p.Domain, p.Entity, p.Action, p.Description, p.Status))
		}
		return items, nil
	}
	rows, err := q.GetAppRolePermissionDetails(ctx, role.ID)
	if err != nil {
		return nil, domainError(ErrorInternal, "internal server error", err)
	}
	items := make([]RolePermission, 0, len(rows))
	for _, p := range rows {
		items = append(items, rolePermission(p.ID, p.Path, p.Domain, p.Entity, p.Action, p.Description, p.Status))
	}
	return items, nil
}

func (s *Service) roleListItem(ctx context.Context, q *dbsqlc.Queries, role dbsqlc.AppRole, actor actorAuthorization) (RoleListItem, error) {
	actions, assignable, err := s.roleActions(ctx, q, role, actor)
	if err != nil {
		return RoleListItem{}, err
	}
	return RoleListItem{ID: role.ID, Code: role.Code, Name: role.Name, Description: role.Description, Status: role.Status, Type: roleType(role), Assignable: assignable, AvailableActions: actions, CreatedAt: role.CreatedAt.Time, UpdatedAt: role.UpdatedAt.Time, Revision: role.Revision}, nil
}

func (s *Service) roleDetail(ctx context.Context, q *dbsqlc.Queries, role dbsqlc.AppRole, actor actorAuthorization) (RoleDetail, error) {
	item, err := s.roleListItem(ctx, q, role, actor)
	if err != nil {
		return RoleDetail{}, err
	}
	permissions, err := s.rolePermissionDetails(ctx, q, role)
	if err != nil {
		return RoleDetail{}, err
	}
	return RoleDetail{RoleListItem: item, Permissions: permissions}, nil
}

func ensureRoleNameUnique(ctx context.Context, q *dbsqlc.Queries, name, excludedID string) error {
	_, err := q.FindAppRoleIDByNormalizedNameExcludingID(ctx, dbsqlc.FindAppRoleIDByNormalizedNameExcludingIDParams{Name: name, ExcludedID: excludedID})
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil {
		return domainError(ErrorInternal, "internal server error", err)
	}
	return domainError(ErrorConflict, "role name already exists", nil)
}

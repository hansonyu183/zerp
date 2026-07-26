package app

import (
	"context"
	"errors"
	"strings"

	dbsqlc "github.com/hansonyu183/zerp-back/internal/database/sqlc"
	"github.com/jackc/pgx/v5"
)

func (s *Service) QueryUsers(ctx context.Context, request PageRequest) (Page[UserView], error) {
	spec, err := validatePage(request, map[string]bool{"createdAt": true, "username": true, "displayName": true}, "createdAt", "desc")
	if err != nil {
		return Page[UserView]{}, err
	}
	if err = validateFilterKeys(request.Filters, "status", "search"); err != nil {
		return Page[UserView]{}, err
	}
	status, err := optionalStatus(request.Filters["status"])
	if err != nil {
		return Page[UserView]{}, err
	}
	search, err := optionalSearch(request.Filters["search"])
	if err != nil {
		return Page[UserView]{}, err
	}
	total, err := s.queries.CountAppUsers(ctx, dbsqlc.CountAppUsersParams{Status: status, Search: search})
	if err != nil {
		return Page[UserView]{}, s.internal("count users", err)
	}
	rows, err := s.queries.ListAppUsers(ctx, dbsqlc.ListAppUsersParams{Status: status, Search: search, SortField: spec.SortField, SortOrder: spec.SortOrder, PageOffset: spec.Offset, PageSize: int32(spec.PageSize)})
	if err != nil {
		return Page[UserView]{}, s.internal("list users", err)
	}
	items := make([]UserView, 0, len(rows))
	for _, row := range rows {
		items = append(items, userListView(row))
	}
	return Page[UserView]{Items: items, Total: total, Page: spec.Page, PageSize: spec.PageSize}, nil
}

func (s *Service) GetUser(ctx context.Context, id string) (UserView, error) {
	if !validID(id) {
		return UserView{}, domainError(ErrorValidation, "invalid user id", nil)
	}
	user, err := s.queries.GetAppUserByID(ctx, id)
	if errors.Is(err, pgx.ErrNoRows) {
		return UserView{}, domainError(ErrorNotFound, "user not found", nil)
	}
	if err != nil {
		return UserView{}, s.internal("get user", err)
	}
	roles, err := s.queries.GetAppUserRoleIDs(ctx, id)
	if err != nil {
		return UserView{}, s.internal("get user roles", err)
	}
	view := userView(user)
	view.RoleIDs = roles
	return view, nil
}

func (s *Service) CreateUser(ctx context.Context, input CreateUserInput, actorID, requestID string) (UserView, error) {
	input.Username = normalizeUsername(input.Username)
	input.DisplayName = strings.TrimSpace(input.DisplayName)
	input.RoleIDs = uniqueStrings(input.RoleIDs)
	if !runeLengthBetween(input.Username, 3, 64) || !runeLengthBetween(input.DisplayName, 1, 128) || !validRoleIDs(input.RoleIDs) {
		return UserView{}, domainError(ErrorValidation, "invalid user fields", nil)
	}
	if err := validatePassword(input.Password, s.cfg.PasswordMinLength); err != nil {
		return UserView{}, domainError(ErrorValidation, err.Error(), nil)
	}
	passwordHash, err := hashPassword(input.Password)
	if err != nil {
		return UserView{}, s.internal("hash password", err)
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return UserView{}, s.internal("begin create user", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	qtx := s.queries.WithTx(tx)
	if err = qtx.AcquireAppAuthorizationLock(ctx); err != nil {
		return UserView{}, s.internal("lock user authorization update", err)
	}
	if err = validateRoles(ctx, qtx, input.RoleIDs); err != nil {
		return UserView{}, err
	}
	id := newID()
	if err = qtx.InsertAppUser(ctx, dbsqlc.InsertAppUserParams{ID: id, Username: input.Username, DisplayName: input.DisplayName, PasswordHash: passwordHash, ActorID: &actorID}); err != nil {
		return UserView{}, s.writeError("create user", err)
	}
	if err = replaceUserRoles(ctx, qtx, id, input.RoleIDs, actorID); err != nil {
		return UserView{}, err
	}
	if err = ensureSafeSignout(ctx, qtx, id); err != nil {
		return UserView{}, err
	}
	if err = s.audit(ctx, qtx, "USER_CREATE", &actorID, "user", &id, "SUCCESS", requestID, map[string]any{"roleCount": len(input.RoleIDs)}); err != nil {
		return UserView{}, s.internal("audit create user", err)
	}
	if err = tx.Commit(ctx); err != nil {
		return UserView{}, s.internal("commit create user", err)
	}
	return s.GetUser(ctx, id)
}

func (s *Service) SaveUser(ctx context.Context, input SaveUserInput, actorID, requestID string) (UserView, error) {
	input.DisplayName = strings.TrimSpace(input.DisplayName)
	input.RoleIDs = uniqueStrings(input.RoleIDs)
	if !validID(input.ID) || input.Revision < 1 || !runeLengthBetween(input.DisplayName, 1, 128) || !validRoleIDs(input.RoleIDs) {
		return UserView{}, domainError(ErrorValidation, "invalid user fields", nil)
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return UserView{}, s.internal("begin save user", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	qtx := s.queries.WithTx(tx)
	if err = qtx.AcquireAppAuthorizationLock(ctx); err != nil {
		return UserView{}, s.internal("lock user authorization update", err)
	}
	if err = validateRoles(ctx, qtx, input.RoleIDs); err != nil {
		return UserView{}, err
	}
	rows, err := qtx.UpdateAppUser(ctx, dbsqlc.UpdateAppUserParams{ID: input.ID, DisplayName: input.DisplayName, Revision: input.Revision, ActorID: &actorID})
	if err != nil {
		return UserView{}, s.writeError("save user", err)
	}
	if rows != 1 {
		return UserView{}, classifyUserWriteMiss(ctx, qtx, input.ID, input.Revision, "")
	}
	if err = replaceUserRoles(ctx, qtx, input.ID, input.RoleIDs, actorID); err != nil {
		return UserView{}, err
	}
	if err = ensureSafeSignout(ctx, qtx, input.ID); err != nil {
		return UserView{}, err
	}
	if err = ensureGlobalAuthorizationSafety(ctx, qtx); err != nil {
		return UserView{}, err
	}
	if err = s.audit(ctx, qtx, "USER_SAVE", &actorID, "user", &input.ID, "SUCCESS", requestID, map[string]any{"roleCount": len(input.RoleIDs)}); err != nil {
		return UserView{}, s.internal("audit save user", err)
	}
	if err = tx.Commit(ctx); err != nil {
		return UserView{}, s.internal("commit save user", err)
	}
	return s.GetUser(ctx, input.ID)
}

func (s *Service) SetUserStatus(ctx context.Context, id string, revision int64, status, actorID, requestID string) (UserView, error) {
	if !validID(id) || revision < 1 || (status != StatusEnabled && status != StatusDisabled) {
		return UserView{}, domainError(ErrorValidation, "invalid status request", nil)
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return UserView{}, s.internal("begin user status", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	qtx := s.queries.WithTx(tx)
	if err = qtx.AcquireAppAuthorizationLock(ctx); err != nil {
		return UserView{}, s.internal("lock user status update", err)
	}
	if status == StatusDisabled {
		remaining, countErr := qtx.CountOtherEnabledUsersWithPermission(ctx, dbsqlc.CountOtherEnabledUsersWithPermissionParams{ExcludedUserID: id, Path: "/app/role/save"})
		if countErr != nil {
			return UserView{}, s.internal("check authorization lockout", countErr)
		}
		if remaining == 0 {
			return UserView{}, domainError(ErrorConflict, "cannot disable the last authorization administrator", nil)
		}
	}
	if status == StatusEnabled {
		if err = ensureSafeSignout(ctx, qtx, id); err != nil {
			return UserView{}, err
		}
	}
	rows, err := qtx.SetAppUserStatus(ctx, dbsqlc.SetAppUserStatusParams{ID: id, Revision: revision, Status: status, ActorID: &actorID})
	if err != nil {
		return UserView{}, s.writeError("set user status", err)
	}
	if rows != 1 {
		return UserView{}, classifyUserWriteMiss(ctx, qtx, id, revision, status)
	}
	if status == StatusDisabled {
		if err = qtx.RevokeAppUserSessions(ctx, dbsqlc.RevokeAppUserSessionsParams{UserID: id, Reason: stringPointer("user_disabled")}); err != nil {
			return UserView{}, s.internal("revoke disabled user sessions", err)
		}
	}
	if err = s.audit(ctx, qtx, "USER_"+status, &actorID, "user", &id, "SUCCESS", requestID, nil); err != nil {
		return UserView{}, s.internal("audit user status", err)
	}
	if err = tx.Commit(ctx); err != nil {
		return UserView{}, s.internal("commit user status", err)
	}
	return s.GetUser(ctx, id)
}

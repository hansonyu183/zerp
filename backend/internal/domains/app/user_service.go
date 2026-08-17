package app

import (
	"context"
	"crypto/rand"
	"errors"
	"fmt"
	"math/big"
	"slices"
	"strings"

	dbsqlc "github.com/hansonyu183/zerp/backend/internal/database/sqlc"
	"github.com/hansonyu183/zerp/backend/internal/platform/systemidentity"
	"github.com/jackc/pgx/v5"
)

func (s *Service) QueryUsers(ctx context.Context, request PageRequest) (Page[UserView], error) {
	if request.Page < 1 || request.PageSize != 20 || len(request.Sort) != 1 ||
		request.Sort[0].Field != "username" || strings.ToLower(request.Sort[0].Order) != "asc" {
		return Page[UserView]{}, domainError(ErrorValidation, "invalid user query pagination or sort", nil)
	}
	spec, err := validatePage(request, map[string]bool{"username": true}, "username", "asc")
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
	roleRows, err := s.queries.ListAppUserRoleSummaries(ctx, id)
	if err != nil {
		return UserView{}, s.internal("get user role summaries", err)
	}
	view.Roles = make([]UserRoleSummary, 0, len(roleRows))
	for _, role := range roleRows {
		view.Roles = append(view.Roles, UserRoleSummary{ID: role.ID, Code: role.Code, Name: role.Name, Status: role.Status})
	}
	return view, nil
}

func (s *Service) CreateUser(ctx context.Context, input CreateUserInput, actorID, requestID string) (UserView, error) {
	input.Username = normalizeUsername(input.Username)
	input.DisplayName = strings.TrimSpace(input.DisplayName)
	input.RoleIDs = uniqueStrings(input.RoleIDs)
	if input.Username == systemidentity.Username || slices.Contains(input.RoleIDs, systemidentity.RoleID) {
		return UserView{}, domainError(ErrorConflict, "system identity is managed internally", nil)
	}
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
	if systemidentity.IsUser(input.ID) {
		return UserView{}, domainError(ErrorConflict, "system identity is managed internally", nil)
	}
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
	_, err = qtx.GetAppUserByIDForUpdate(ctx, input.ID)
	if errors.Is(err, pgx.ErrNoRows) {
		return UserView{}, domainError(ErrorNotFound, "user not found", nil)
	}
	if err != nil {
		return UserView{}, s.internal("lock user for save", err)
	}
	if actorID == input.ID {
		currentRoles, roleErr := qtx.GetAppUserRoleIDs(ctx, input.ID)
		if roleErr != nil {
			return UserView{}, s.internal("get current user roles", roleErr)
		}
		slices.Sort(currentRoles)
		if !slices.Equal(currentRoles, input.RoleIDs) {
			return UserView{}, domainError(ErrorForbidden, "cannot change own roles", nil)
		}
	} else if slices.Contains(input.RoleIDs, systemidentity.RoleID) {
		return UserView{}, domainError(ErrorConflict, "system identity is managed internally", nil)
	} else if err = validateRoles(ctx, qtx, input.RoleIDs); err != nil {
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
	if systemidentity.IsUser(id) {
		return UserView{}, domainError(ErrorConflict, "system identity is managed internally", nil)
	}
	if id == actorID {
		return UserView{}, domainError(ErrorConflict, "cannot change current user status", nil)
	}
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

func (s *Service) ResetUserPassword(ctx context.Context, input ResetPasswordInput, actorID, requestID string) (ResetPasswordResult, error) {
	if !validID(input.ID) || input.Revision < 1 {
		return ResetPasswordResult{}, domainError(ErrorValidation, "invalid password reset request", nil)
	}
	if input.ID == actorID || systemidentity.IsUser(input.ID) {
		return ResetPasswordResult{}, domainError(ErrorForbidden, "cannot reset this user password", nil)
	}
	temporaryPassword, err := generateTemporaryPassword(s.cfg.PasswordMinLength)
	if err != nil {
		return ResetPasswordResult{}, s.internal("generate temporary password", err)
	}
	passwordHash, err := hashPassword(temporaryPassword)
	if err != nil {
		return ResetPasswordResult{}, s.internal("hash temporary password", err)
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return ResetPasswordResult{}, s.internal("begin password reset", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	qtx := s.queries.WithTx(tx)
	locked, err := qtx.GetAppUserByIDForUpdate(ctx, input.ID)
	if errors.Is(err, pgx.ErrNoRows) {
		return ResetPasswordResult{}, domainError(ErrorNotFound, "user not found", nil)
	}
	if err != nil {
		return ResetPasswordResult{}, s.internal("lock password reset user", err)
	}
	if locked.Status != StatusEnabled {
		return ResetPasswordResult{}, domainError(ErrorConflict, "user is not enabled", nil)
	}
	if locked.Revision != input.Revision {
		return ResetPasswordResult{}, domainError(ErrorConflict, "user revision conflict", nil)
	}
	rows, err := qtx.ResetAppUserPassword(ctx, dbsqlc.ResetAppUserPasswordParams{
		ID: input.ID, Revision: input.Revision, PasswordHash: passwordHash, ActorID: &actorID,
	})
	if err != nil {
		return ResetPasswordResult{}, s.writeError("reset user password", err)
	}
	if rows != 1 {
		return ResetPasswordResult{}, domainError(ErrorConflict, "user changed concurrently", nil)
	}
	if err = qtx.RevokeAppUserSessions(ctx, dbsqlc.RevokeAppUserSessionsParams{UserID: input.ID, Reason: stringPointer("password_reset")}); err != nil {
		return ResetPasswordResult{}, s.internal("revoke reset user sessions", err)
	}
	if err = s.audit(ctx, qtx, "USER_RESET_PASSWORD", &actorID, "user", &input.ID, "SUCCESS", requestID, nil); err != nil {
		return ResetPasswordResult{}, s.internal("audit password reset", err)
	}
	if err = tx.Commit(ctx); err != nil {
		return ResetPasswordResult{}, s.internal("commit password reset", err)
	}
	return ResetPasswordResult{TemporaryPassword: temporaryPassword}, nil
}

func generateTemporaryPassword(minimum int) (string, error) {
	length := max(minimum, 16)
	if length > 256 {
		return "", fmt.Errorf("invalid password policy")
	}
	alphabets := []string{"abcdefghijkmnopqrstuvwxyz", "ABCDEFGHJKLMNPQRSTUVWXYZ", "23456789", "!@#$%^&*-_"}
	characters := make([]byte, 0, length)
	for _, alphabet := range alphabets {
		index, err := rand.Int(rand.Reader, big.NewInt(int64(len(alphabet))))
		if err != nil {
			return "", err
		}
		characters = append(characters, alphabet[index.Int64()])
	}
	temporaryPasswordAlphabet := "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789!@#$%^&*-_"
	for len(characters) < length {
		index, err := rand.Int(rand.Reader, big.NewInt(int64(len(temporaryPasswordAlphabet))))
		if err != nil {
			return "", err
		}
		characters = append(characters, temporaryPasswordAlphabet[index.Int64()])
	}
	for i := len(characters) - 1; i > 0; i-- {
		index, err := rand.Int(rand.Reader, big.NewInt(int64(i+1)))
		if err != nil {
			return "", err
		}
		characters[i], characters[index.Int64()] = characters[index.Int64()], characters[i]
	}
	return string(characters), nil
}

func (s *Service) GetUserDetail(ctx context.Context, id string, principal Principal) (UserDetail, error) {
	if !validID(id) {
		return UserDetail{}, domainError(ErrorValidation, "invalid user id", nil)
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return UserDetail{}, s.internal("begin user detail", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	qtx := s.queries.WithTx(tx)
	if err = qtx.AcquireAppAuthorizationLock(ctx); err != nil {
		return UserDetail{}, s.internal("lock user detail", err)
	}
	actor, err := s.currentActorAuthorization(ctx, qtx, principal)
	if err != nil {
		return UserDetail{}, err
	}
	if err = actor.require("/app/user/get"); err != nil {
		return UserDetail{}, err
	}
	row, err := qtx.GetAppUserByID(ctx, id)
	if errors.Is(err, pgx.ErrNoRows) {
		return UserDetail{}, domainError(ErrorNotFound, "user not found", nil)
	}
	if err != nil {
		return UserDetail{}, s.internal("get user", err)
	}
	detail, err := s.userDetailAs(ctx, qtx, userView(row), actor)
	if err != nil {
		return UserDetail{}, err
	}
	if err = tx.Commit(ctx); err != nil {
		return UserDetail{}, s.internal("commit user detail", err)
	}
	return detail, nil
}

func (s *Service) CreateUserAs(ctx context.Context, input CreateUserInput, principal Principal, requestID string) (UserDetail, error) {
	input.Username = normalizeUsername(input.Username)
	input.DisplayName = strings.TrimSpace(input.DisplayName)
	input.RoleIDs = uniqueStrings(input.RoleIDs)
	if input.Username == systemidentity.Username || slices.Contains(input.RoleIDs, systemidentity.RoleID) {
		return UserDetail{}, domainError(ErrorConflict, "system identity is managed internally", nil)
	}
	if !runeLengthBetween(input.Username, 3, 64) || !runeLengthBetween(input.DisplayName, 1, 128) || !validRoleIDs(input.RoleIDs) {
		return UserDetail{}, domainError(ErrorValidation, "invalid user fields", nil)
	}
	if err := validatePassword(input.Password, s.cfg.PasswordMinLength); err != nil {
		return UserDetail{}, domainError(ErrorValidation, err.Error(), nil)
	}
	passwordHash, err := hashPassword(input.Password)
	if err != nil {
		return UserDetail{}, s.internal("hash password", err)
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return UserDetail{}, s.internal("begin create user", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	qtx := s.queries.WithTx(tx)
	if err = qtx.AcquireAppAuthorizationLock(ctx); err != nil {
		return UserDetail{}, s.internal("lock user authorization update", err)
	}
	actor, err := s.currentActorAuthorization(ctx, qtx, principal)
	if err != nil {
		return UserDetail{}, err
	}
	if err = actor.require("/app/user/create"); err != nil {
		return UserDetail{}, err
	}
	if err = actor.require("/app/role/query"); err != nil {
		return UserDetail{}, err
	}
	if err = s.requestedRolesAssignable(ctx, qtx, input.RoleIDs, actor); err != nil {
		return UserDetail{}, err
	}
	id := newID()
	if err = qtx.InsertAppUser(ctx, dbsqlc.InsertAppUserParams{ID: id, Username: input.Username, DisplayName: input.DisplayName, PasswordHash: passwordHash, ActorID: &actor.id}); err != nil {
		return UserDetail{}, s.writeError("create user", err)
	}
	if err = replaceUserRoles(ctx, qtx, id, input.RoleIDs, actor.id); err != nil {
		return UserDetail{}, err
	}
	if err = s.audit(ctx, qtx, "USER_CREATE", &actor.id, "user", &id, "SUCCESS", requestID, map[string]any{"roleCount": len(input.RoleIDs)}); err != nil {
		return UserDetail{}, s.internal("audit create user", err)
	}
	if err = tx.Commit(ctx); err != nil {
		return UserDetail{}, s.internal("commit create user", err)
	}
	return s.GetUserDetail(ctx, id, principal)
}

func (s *Service) SaveUserAs(ctx context.Context, input SaveUserInput, principal Principal, requestID string) (UserDetail, error) {
	input.DisplayName = strings.TrimSpace(input.DisplayName)
	input.RoleIDs = uniqueStrings(input.RoleIDs)
	if systemidentity.IsUser(input.ID) {
		return UserDetail{}, domainError(ErrorConflict, "system identity is managed internally", nil)
	}
	if !validID(input.ID) || input.Revision < 1 || !runeLengthBetween(input.DisplayName, 1, 128) || !validRoleIDs(input.RoleIDs) {
		return UserDetail{}, domainError(ErrorValidation, "invalid user fields", nil)
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return UserDetail{}, s.internal("begin save user", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	qtx := s.queries.WithTx(tx)
	if err = qtx.AcquireAppAuthorizationLock(ctx); err != nil {
		return UserDetail{}, s.internal("lock user authorization update", err)
	}
	actor, err := s.currentActorAuthorization(ctx, qtx, principal)
	if err != nil {
		return UserDetail{}, err
	}
	if err = actor.require("/app/user/save"); err != nil {
		return UserDetail{}, err
	}
	locked, err := qtx.GetAppUserByIDForUpdate(ctx, input.ID)
	if errors.Is(err, pgx.ErrNoRows) {
		return UserDetail{}, domainError(ErrorNotFound, "user not found", nil)
	}
	if err != nil {
		return UserDetail{}, s.internal("lock user for save", err)
	}
	user := userView(locked)
	if input.ID == actor.id {
		current, roleErr := qtx.GetAppUserRoleIDs(ctx, input.ID)
		if roleErr != nil {
			return UserDetail{}, s.internal("get current user roles", roleErr)
		}
		slices.Sort(current)
		if !slices.Equal(current, input.RoleIDs) {
			return UserDetail{}, domainError(ErrorForbidden, "cannot change own roles", nil)
		}
	} else {
		manageable, manageErr := s.userManageable(ctx, qtx, user, actor)
		if manageErr != nil {
			return UserDetail{}, manageErr
		}
		if !manageable {
			return UserDetail{}, domainError(ErrorForbidden, "user cannot be maintained", nil)
		}
		if err = actor.require("/app/role/query"); err != nil {
			return UserDetail{}, err
		}
		if err = s.requestedRolesAssignable(ctx, qtx, input.RoleIDs, actor); err != nil {
			return UserDetail{}, err
		}
	}
	rows, err := qtx.UpdateAppUser(ctx, dbsqlc.UpdateAppUserParams{ID: input.ID, DisplayName: input.DisplayName, Revision: input.Revision, ActorID: &actor.id})
	if err != nil {
		return UserDetail{}, s.writeError("save user", err)
	}
	if rows != 1 {
		return UserDetail{}, classifyUserWriteMiss(ctx, qtx, input.ID, input.Revision, "")
	}
	if err = replaceUserRoles(ctx, qtx, input.ID, input.RoleIDs, actor.id); err != nil {
		return UserDetail{}, err
	}
	if err = ensureGlobalAuthorizationSafety(ctx, qtx); err != nil {
		return UserDetail{}, err
	}
	if err = s.audit(ctx, qtx, "USER_SAVE", &actor.id, "user", &input.ID, "SUCCESS", requestID, map[string]any{"roleCount": len(input.RoleIDs)}); err != nil {
		return UserDetail{}, s.internal("audit save user", err)
	}
	if err = tx.Commit(ctx); err != nil {
		return UserDetail{}, s.internal("commit save user", err)
	}
	return s.GetUserDetail(ctx, input.ID, principal)
}

func (s *Service) SetUserStatusAs(ctx context.Context, id string, revision int64, status string, principal Principal, requestID string) (UserDetail, error) {
	if !validID(id) || revision < 1 || (status != StatusEnabled && status != StatusDisabled) {
		return UserDetail{}, domainError(ErrorValidation, "invalid status request", nil)
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return UserDetail{}, s.internal("begin user status", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	qtx := s.queries.WithTx(tx)
	if err = qtx.AcquireAppAuthorizationLock(ctx); err != nil {
		return UserDetail{}, s.internal("lock user authorization update", err)
	}
	actor, err := s.currentActorAuthorization(ctx, qtx, principal)
	if err != nil {
		return UserDetail{}, err
	}
	path := "/app/user/enable"
	if status == StatusDisabled {
		path = "/app/user/disable"
	}
	if err = actor.require(path); err != nil {
		return UserDetail{}, err
	}
	locked, err := qtx.GetAppUserByIDForUpdate(ctx, id)
	if errors.Is(err, pgx.ErrNoRows) {
		return UserDetail{}, domainError(ErrorNotFound, "user not found", nil)
	}
	if err != nil {
		return UserDetail{}, s.internal("lock user for status", err)
	}
	user := userView(locked)
	manageable, err := s.userManageable(ctx, qtx, user, actor)
	if err != nil {
		return UserDetail{}, err
	}
	if !manageable {
		return UserDetail{}, domainError(ErrorForbidden, "user cannot be maintained", nil)
	}
	rows, err := qtx.SetAppUserStatus(ctx, dbsqlc.SetAppUserStatusParams{ID: id, Revision: revision, Status: status, ActorID: &actor.id})
	if err != nil {
		return UserDetail{}, s.writeError("set user status", err)
	}
	if rows != 1 {
		return UserDetail{}, classifyUserWriteMiss(ctx, qtx, id, revision, status)
	}
	if status == StatusDisabled {
		if err = qtx.RevokeAppUserSessions(ctx, dbsqlc.RevokeAppUserSessionsParams{UserID: id, Reason: stringPointer("user_disabled")}); err != nil {
			return UserDetail{}, s.internal("revoke disabled user sessions", err)
		}
	}
	if err = ensureGlobalAuthorizationSafety(ctx, qtx); err != nil {
		return UserDetail{}, err
	}
	if err = s.audit(ctx, qtx, "USER_"+status, &actor.id, "user", &id, "SUCCESS", requestID, nil); err != nil {
		return UserDetail{}, s.internal("audit user status", err)
	}
	if err = tx.Commit(ctx); err != nil {
		return UserDetail{}, s.internal("commit user status", err)
	}
	return s.GetUserDetail(ctx, id, principal)
}

func (s *Service) ResetUserPasswordAs(ctx context.Context, input ResetPasswordInput, principal Principal, requestID string) (ResetPasswordResult, error) {
	if !validID(input.ID) || input.Revision < 1 {
		return ResetPasswordResult{}, domainError(ErrorValidation, "invalid password reset request", nil)
	}
	temporaryPassword, err := generateTemporaryPassword(s.cfg.PasswordMinLength)
	if err != nil {
		return ResetPasswordResult{}, s.internal("generate temporary password", err)
	}
	passwordHash, err := hashPassword(temporaryPassword)
	if err != nil {
		return ResetPasswordResult{}, s.internal("hash temporary password", err)
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return ResetPasswordResult{}, s.internal("begin password reset", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	qtx := s.queries.WithTx(tx)
	if err = qtx.AcquireAppAuthorizationLock(ctx); err != nil {
		return ResetPasswordResult{}, s.internal("lock user authorization update", err)
	}
	actor, err := s.currentActorAuthorization(ctx, qtx, principal)
	if err != nil {
		return ResetPasswordResult{}, err
	}
	if err = actor.require("/app/user/reset-password"); err != nil {
		return ResetPasswordResult{}, err
	}
	locked, err := qtx.GetAppUserByIDForUpdate(ctx, input.ID)
	if errors.Is(err, pgx.ErrNoRows) {
		return ResetPasswordResult{}, domainError(ErrorNotFound, "user not found", nil)
	}
	if err != nil {
		return ResetPasswordResult{}, s.internal("lock password reset user", err)
	}
	user := userView(locked)
	manageable, err := s.userManageable(ctx, qtx, user, actor)
	if err != nil {
		return ResetPasswordResult{}, err
	}
	if !manageable {
		return ResetPasswordResult{}, domainError(ErrorForbidden, "user cannot be maintained", nil)
	}
	if locked.Status != StatusEnabled {
		return ResetPasswordResult{}, domainError(ErrorConflict, "user is not enabled", nil)
	}
	if locked.Revision != input.Revision {
		return ResetPasswordResult{}, domainError(ErrorConflict, "user revision conflict", nil)
	}
	rows, err := qtx.ResetAppUserPassword(ctx, dbsqlc.ResetAppUserPasswordParams{ID: input.ID, Revision: input.Revision, PasswordHash: passwordHash, ActorID: &actor.id})
	if err != nil {
		return ResetPasswordResult{}, s.writeError("reset user password", err)
	}
	if rows != 1 {
		return ResetPasswordResult{}, domainError(ErrorConflict, "user changed concurrently", nil)
	}
	if err = qtx.RevokeAppUserSessions(ctx, dbsqlc.RevokeAppUserSessionsParams{UserID: input.ID, Reason: stringPointer("password_reset")}); err != nil {
		return ResetPasswordResult{}, s.internal("revoke reset user sessions", err)
	}
	if err = s.audit(ctx, qtx, "USER_RESET_PASSWORD", &actor.id, "user", &input.ID, "SUCCESS", requestID, nil); err != nil {
		return ResetPasswordResult{}, s.internal("audit password reset", err)
	}
	if err = tx.Commit(ctx); err != nil {
		return ResetPasswordResult{}, s.internal("commit password reset", err)
	}
	return ResetPasswordResult{TemporaryPassword: temporaryPassword}, nil
}

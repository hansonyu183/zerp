package app

import (
	"context"
	"strings"

	dbsqlc "github.com/hansonyu183/zerp-back/internal/database/sqlc"
)

// BootstrapAdmin creates the first user and a superadmin role. It refuses to run
// once any user exists so it cannot become a general-purpose privilege bypass.
func (s *Service) BootstrapAdmin(ctx context.Context, username, displayName, password string) (UserView, error) {
	username = normalizeUsername(username)
	displayName = strings.TrimSpace(displayName)
	if !runeLengthBetween(username, 3, 64) || !runeLengthBetween(displayName, 1, 128) {
		return UserView{}, domainError(ErrorValidation, "invalid bootstrap user fields", nil)
	}
	if err := validatePassword(password, s.cfg.PasswordMinLength); err != nil {
		return UserView{}, domainError(ErrorValidation, err.Error(), nil)
	}
	passwordHash, err := hashPassword(password)
	if err != nil {
		return UserView{}, s.internal("hash bootstrap password", err)
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return UserView{}, s.internal("begin bootstrap", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	qtx := s.queries.WithTx(tx)
	count, err := qtx.CountAllAppUsers(ctx)
	if err != nil {
		return UserView{}, s.internal("count bootstrap users", err)
	}
	if count != 0 {
		return UserView{}, domainError(ErrorConflict, "bootstrap is disabled after the first user exists", nil)
	}
	permissionIDs, err := qtx.ListAllEnabledAppPermissionIDs(ctx)
	if err != nil {
		return UserView{}, s.internal("list bootstrap permissions", err)
	}
	if len(permissionIDs) == 0 {
		return UserView{}, domainError(ErrorConflict, "permission catalog is empty", nil)
	}
	roleID, userID := newID(), newID()
	if err = qtx.InsertAppRole(ctx, dbsqlc.InsertAppRoleParams{ID: roleID, Code: "superadmin", Name: "Super Administrator", Description: stringPointer("Initial system administrator"), ActorID: &userID}); err != nil {
		return UserView{}, s.writeError("create bootstrap role", err)
	}
	if err = qtx.InsertAppUser(ctx, dbsqlc.InsertAppUserParams{ID: userID, Username: username, DisplayName: displayName, PasswordHash: passwordHash, ActorID: &userID}); err != nil {
		return UserView{}, s.writeError("create bootstrap user", err)
	}
	if err = replaceUserRoles(ctx, qtx, userID, []string{roleID}, userID); err != nil {
		return UserView{}, err
	}
	if err = ensureSafeSignout(ctx, qtx, userID); err != nil {
		return UserView{}, err
	}
	if err = s.audit(ctx, qtx, "SYSTEM_BOOTSTRAP", &userID, "user", &userID, "SUCCESS", "bootstrap-admin", map[string]any{"roleId": roleID}); err != nil {
		return UserView{}, s.internal("audit bootstrap", err)
	}
	if err = tx.Commit(ctx); err != nil {
		return UserView{}, s.internal("commit bootstrap", err)
	}
	return s.GetUser(ctx, userID)
}

package app

import (
	"context"
	"errors"
	"fmt"
	"slices"
	"strings"
	"time"

	dbsqlc "github.com/hansonyu183/zerp/backend/internal/database/sqlc"
	"github.com/hansonyu183/zerp/backend/internal/platform/systemidentity"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

func (s *Service) Signin(ctx context.Context, username, password, requestID string) (SessionResult, error) {
	username = normalizeUsername(username)
	if !runeLengthBetween(username, 3, 64) || password == "" || len(password) > 1024 {
		_ = verifyPassword(s.dummyPassword, password)
		return SessionResult{}, domainErrorWithKey(ErrorUnauthenticated, "invalid_credentials", "用户名或密码错误。", nil)
	}

	user, err := s.queries.GetAppUserByUsername(ctx, username)
	if errors.Is(err, pgx.ErrNoRows) {
		_ = verifyPassword(s.dummyPassword, password)
		_ = s.audit(ctx, s.queries, "USER_SIGNIN", nil, "user", nil, "FAILURE", requestID, map[string]any{"reason": "unknown_or_invalid"})
		return SessionResult{}, domainError(ErrorUnauthenticated, "用户名或密码错误。", nil)
	}
	if err != nil {
		return SessionResult{}, s.internal("read signin user", err)
	}
	if systemidentity.IsUser(user.ID) {
		_ = verifyPassword(s.dummyPassword, password)
		return SessionResult{}, domainError(ErrorUnauthenticated, "用户名或密码错误。", nil)
	}

	passwordOK := verifyPassword(user.PasswordHash, password)
	now := time.Now().UTC()
	locked := user.LockedUntil.Valid && user.LockedUntil.Time.After(now)
	if !passwordOK || user.Status != StatusEnabled || locked {
		message := "用户名或密码错误。"
		errorKey := "invalid_credentials"
		if user.Status != StatusEnabled {
			message = "账号已停用，请联系管理员。"
			errorKey = "account_disabled"
		} else if locked {
			message = "账号已临时锁定，请稍后重试。"
			errorKey = "account_locked"
		}
		tx, beginErr := s.pool.Begin(ctx)
		if beginErr == nil {
			qtx := s.queries.WithTx(tx)
			if !passwordOK && user.Status == StatusEnabled && !locked {
				failedUser, recordErr := qtx.RecordSigninFailure(ctx, dbsqlc.RecordSigninFailureParams{
					ID: user.ID, LockThreshold: int32(s.cfg.SigninLockThreshold),
					LockDuration: pgtype.Interval{Microseconds: s.cfg.SigninLockDuration.Microseconds(), Valid: true},
				})
				if recordErr == nil {
					remaining := max(s.cfg.SigninLockThreshold-int(failedUser.FailedSigninCount), 0)
					message = fmt.Sprintf("密码错误，剩余重试次数 %d。", remaining)
					if remaining == 0 {
						message += "账号已临时锁定，请稍后重试。"
						errorKey = "account_locked"
					}
				}
			}
			if auditErr := s.audit(ctx, qtx, "USER_SIGNIN", &user.ID, "user", &user.ID, "FAILURE", requestID, map[string]any{"reason": "unknown_or_invalid"}); auditErr == nil {
				_ = tx.Commit(ctx)
			}
		}
		return SessionResult{}, domainErrorWithKey(ErrorUnauthenticated, errorKey, message, nil)
	}

	sessionToken, err := newRawToken()
	if err != nil {
		return SessionResult{}, s.internal("generate session token", err)
	}
	csrfToken, err := newRawToken()
	if err != nil {
		return SessionResult{}, s.internal("generate csrf token", err)
	}
	idleEnds := now.Add(s.cfg.SessionIdleTimeout)
	absoluteEnds := now.Add(s.cfg.SessionAbsoluteTimeout)

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return SessionResult{}, s.internal("begin signin transaction", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	qtx := s.queries.WithTx(tx)
	permissions, err := qtx.GetAppUserPermissions(ctx, user.ID)
	if err != nil {
		return SessionResult{}, s.internal("load signin permissions", err)
	}
	avatarURL, err := qtx.GetAppUserAvatarURL(ctx, user.ID)
	if err != nil {
		return SessionResult{}, s.internal("load signin profile", err)
	}
	if err = qtx.ResetSigninFailures(ctx, user.ID); err != nil {
		return SessionResult{}, s.internal("reset signin failures", err)
	}
	if err = qtx.CreateAppSession(ctx, dbsqlc.CreateAppSessionParams{
		ID: newID(), UserID: user.ID, TokenHash: tokenHash(sessionToken), CsrfTokenHash: tokenHash(csrfToken),
		IdleExpiresAt: timestamptz(idleEnds), AbsoluteExpiresAt: timestamptz(absoluteEnds),
	}); err != nil {
		return SessionResult{}, s.internal("create session", err)
	}
	if err = s.audit(ctx, qtx, "USER_SIGNIN", &user.ID, "user", &user.ID, "SUCCESS", requestID, nil); err != nil {
		return SessionResult{}, s.internal("audit signin", err)
	}
	if err = tx.Commit(ctx); err != nil {
		return SessionResult{}, s.internal("commit signin", err)
	}
	return SessionResult{
		Data: SessionData{User: userSummary(user, avatarURL), CSRFToken: csrfToken, Permissions: permissions,
			PasswordChangeRequired: user.PasswordChangeRequired, PasswordMinLength: s.cfg.PasswordMinLength},
		SessionToken: sessionToken, ExpiresAt: absoluteEnds,
	}, nil
}

func (s *Service) RestoreSession(ctx context.Context, principal Principal) (SessionResult, error) {
	csrfToken, err := newRawToken()
	if err != nil {
		return SessionResult{}, s.internal("generate csrf token", err)
	}
	idleEnds := time.Now().UTC().Add(s.cfg.SessionIdleTimeout)
	rows, err := s.queries.RotateAppSessionCSRF(ctx, dbsqlc.RotateAppSessionCSRFParams{
		ID: principal.SessionID, CsrfTokenHash: tokenHash(csrfToken), IdleExpiresAt: timestamptz(idleEnds),
	})
	if err != nil {
		return SessionResult{}, s.internal("rotate csrf token", err)
	}
	if rows != 1 {
		return SessionResult{}, domainError(ErrorUnauthenticated, "session expired", nil)
	}
	return SessionResult{Data: SessionData{User: principal.User, CSRFToken: csrfToken, Permissions: principal.Permissions,
		PasswordChangeRequired: principal.PasswordChangeRequired, PasswordMinLength: s.cfg.PasswordMinLength}, ExpiresAt: principal.AbsoluteEnds}, nil
}

func (s *Service) AuthenticateSession(ctx context.Context, rawToken, csrfToken, path, requestID string) (Principal, error) {
	principal, err := s.loadPrincipal(ctx, rawToken)
	if err != nil {
		return Principal{}, err
	}
	if path != "/app/user/session" && (csrfToken == "" || !constantTimeHashEqual(principal.CSRFHash, csrfToken)) {
		s.auditAuthorizationDenied(ctx, principal, path, requestID, "csrf")
		return Principal{}, domainError(ErrorForbidden, "csrf validation failed", nil)
	}
	if err = s.enforceRestrictedSessionPath(ctx, principal, path, requestID); err != nil {
		return Principal{}, err
	}
	if path != "/app/user/session" {
		idleEnds := time.Now().UTC().Add(s.cfg.SessionIdleTimeout)
		if err = s.queries.TouchAppSession(ctx, dbsqlc.TouchAppSessionParams{ID: principal.SessionID, IdleExpiresAt: timestamptz(idleEnds)}); err != nil {
			return Principal{}, s.internal("touch session", err)
		}
	}
	return principal, nil
}

func (s *Service) RequirePermission(ctx context.Context, principal Principal, path, requestID string) error {
	if permissionAllowsPath(principal.Permissions, path) {
		return nil
	}
	s.auditAuthorizationDenied(ctx, principal, path, requestID, "permission")
	return domainError(ErrorForbidden, "permission denied", nil)
}

func passwordChangeSessionAllows(path string) bool {
	return path == "/app/user/session" || isSessionSelfServicePath(path)
}

func (s *Service) enforceRestrictedSessionPath(
	ctx context.Context,
	principal Principal,
	path, requestID string,
) error {
	if !principal.PasswordChangeRequired || passwordChangeSessionAllows(path) {
		return nil
	}
	s.auditAuthorizationDenied(ctx, principal, path, requestID, "password_change_required")
	return domainError(ErrorForbidden, "password change is required", nil)
}

func isSessionSelfServicePath(path string) bool {
	return path == signoutPath || path == changePasswordPath
}

func permissionAllowsPath(permissions []string, path string) bool {
	if slices.Contains(permissions, path) {
		return true
	}
	if path != "/rpt/directory/query" {
		return false
	}
	for _, permission := range permissions {
		parts := strings.Split(strings.Trim(permission, "/"), "/")
		if len(parts) == 3 && parts[0] == "rpt" && parts[1] != "definition" && parts[1] != "directory" && (parts[2] == "query" || parts[2] == "export") {
			return true
		}
	}
	return false
}

func (s *Service) loadPrincipal(ctx context.Context, rawToken string) (Principal, error) {
	if rawToken == "" || len(rawToken) > 256 {
		return Principal{}, domainError(ErrorUnauthenticated, "session expired", nil)
	}
	session, err := s.queries.GetAppSessionByTokenHash(ctx, tokenHash(rawToken))
	if errors.Is(err, pgx.ErrNoRows) {
		return Principal{}, domainError(ErrorUnauthenticated, "session expired", nil)
	}
	if err != nil {
		return Principal{}, s.internal("read session", err)
	}
	now := time.Now().UTC()
	if session.RevokedAt.Valid || !session.IdleExpiresAt.Valid || !session.AbsoluteExpiresAt.Valid ||
		!session.IdleExpiresAt.Time.After(now) || !session.AbsoluteExpiresAt.Time.After(now) || session.UserStatus != StatusEnabled {
		return Principal{}, domainError(ErrorUnauthenticated, "session expired", nil)
	}
	permissions, err := s.queries.GetAppUserPermissions(ctx, session.UserID)
	if err != nil {
		return Principal{}, s.internal("load current permissions", err)
	}
	return Principal{
		SessionID: session.ID, User: UserSummary{
			ID: session.UserID, Username: session.Username,
			DisplayName: session.DisplayName, AvatarURL: session.AvatarUrl,
		},
		CSRFHash: session.CsrfTokenHash, Permissions: permissions, PasswordChangeRequired: session.PasswordChangeRequired,
		IdleExpires: session.IdleExpiresAt.Time, AbsoluteEnds: session.AbsoluteExpiresAt.Time,
	}, nil
}

func (s *Service) Signout(ctx context.Context, principal Principal, requestID string) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return s.internal("begin signout", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	qtx := s.queries.WithTx(tx)
	if err = qtx.RevokeAppSession(ctx, dbsqlc.RevokeAppSessionParams{ID: principal.SessionID, Reason: stringPointer("signout")}); err != nil {
		return s.internal("revoke session", err)
	}
	if err = s.audit(ctx, qtx, "USER_SIGNOUT", &principal.User.ID, "session", &principal.SessionID, "SUCCESS", requestID, nil); err != nil {
		return s.internal("audit signout", err)
	}
	if err = tx.Commit(ctx); err != nil {
		return s.internal("commit signout", err)
	}
	return nil
}

func (s *Service) GetProfile(ctx context.Context, userID string) (ProfileView, error) {
	user, err := s.queries.GetAppUserByID(ctx, userID)
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && user.Status != StatusEnabled) {
		return ProfileView{}, domainError(ErrorUnauthenticated, "session expired", nil)
	}
	if err != nil {
		return ProfileView{}, s.internal("get current user profile", err)
	}
	avatarURL, err := s.queries.GetAppUserAvatarURL(ctx, userID)
	if err != nil {
		return ProfileView{}, s.internal("get current user avatar", err)
	}
	return profileView(user, avatarURL), nil
}

func (s *Service) SaveProfile(
	ctx context.Context,
	userID string,
	input SaveProfileInput,
	requestID string,
) (ProfileView, error) {
	if !validID(userID) {
		return ProfileView{}, domainError(ErrorUnauthenticated, "session expired", nil)
	}
	input, err := validateSaveProfile(input)
	if err != nil {
		return ProfileView{}, err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return ProfileView{}, s.internal("begin profile save", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	qtx := s.queries.WithTx(tx)
	locked, err := qtx.GetAppUserByIDForUpdate(ctx, userID)
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && locked.Status != StatusEnabled) {
		return ProfileView{}, domainError(ErrorUnauthenticated, "session expired", nil)
	}
	if err != nil {
		return ProfileView{}, s.internal("lock profile user", err)
	}
	currentAvatarURL, err := qtx.GetAppUserAvatarURL(ctx, userID)
	if err != nil {
		return ProfileView{}, s.internal("get locked user avatar", err)
	}
	displayNameChanged := locked.DisplayName != input.DisplayName
	avatarChanged := !optionalStringEqual(currentAvatarURL, input.AvatarURL)
	if !displayNameChanged && !avatarChanged {
		return profileView(locked, currentAvatarURL), nil
	}
	updated, err := qtx.UpdateCurrentAppUserProfile(ctx, dbsqlc.UpdateCurrentAppUserProfileParams{
		ID: userID, DisplayName: input.DisplayName, ActorID: &userID,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return ProfileView{}, domainError(ErrorUnauthenticated, "session expired", nil)
	}
	if err != nil {
		return ProfileView{}, s.writeError("update current user profile", err)
	}
	if input.AvatarURL == nil {
		if err = qtx.DeleteAppUserProfileAvatar(ctx, userID); err != nil {
			return ProfileView{}, s.writeError("clear current user avatar", err)
		}
	} else if err = qtx.UpsertAppUserProfileAvatar(ctx, dbsqlc.UpsertAppUserProfileAvatarParams{
		UserID: userID, AvatarUrl: *input.AvatarURL, ActorID: &userID,
	}); err != nil {
		return ProfileView{}, s.writeError("save current user avatar", err)
	}
	if err = s.audit(
		ctx, qtx, "USER_PROFILE_SAVE", &userID, "user", &userID, "SUCCESS", requestID,
		map[string]any{"displayNameChanged": displayNameChanged, "avatarChanged": avatarChanged},
	); err != nil {
		return ProfileView{}, s.internal("audit profile save", err)
	}
	if err = tx.Commit(ctx); err != nil {
		return ProfileView{}, s.internal("commit profile save", err)
	}
	return profileView(updated, input.AvatarURL), nil
}

func (s *Service) ChangePassword(ctx context.Context, principal Principal, input ChangePasswordInput, requestID string) error {
	if input.CurrentPassword == "" || len(input.CurrentPassword) > 1024 {
		return domainErrorWithKey(ErrorValidation, "invalid_current_password", "current password is incorrect", nil)
	}
	if err := validatePassword(input.NewPassword, s.cfg.PasswordMinLength); err != nil {
		return domainError(ErrorValidation, err.Error(), nil)
	}

	current, err := s.queries.GetAppUserByID(ctx, principal.User.ID)
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && current.Status != StatusEnabled) {
		return domainError(ErrorUnauthenticated, "session expired", nil)
	}
	if err != nil {
		return s.internal("read password user", err)
	}
	if !verifyPassword(current.PasswordHash, input.CurrentPassword) {
		_ = s.audit(ctx, s.queries, "USER_CHANGE_PASSWORD", &current.ID, "user", &current.ID, "FAILURE", requestID, map[string]any{"reason": "invalid_current_password"})
		return domainErrorWithKey(ErrorValidation, "invalid_current_password", "current password is incorrect", nil)
	}
	if verifyPassword(current.PasswordHash, input.NewPassword) {
		return domainError(ErrorValidation, "new password must differ from current password", nil)
	}
	newHash, err := hashPassword(input.NewPassword)
	if err != nil {
		return s.internal("hash new password", err)
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return s.internal("begin password change", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	qtx := s.queries.WithTx(tx)
	locked, err := qtx.GetAppUserByIDForUpdate(ctx, current.ID)
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && locked.Status != StatusEnabled) {
		return domainError(ErrorUnauthenticated, "session expired", nil)
	}
	if err != nil {
		return s.internal("lock password user", err)
	}
	if locked.Revision != current.Revision || locked.PasswordHash != current.PasswordHash {
		return domainErrorWithKey(ErrorConflict, "user_changed", "user changed concurrently; retry with the current password", nil)
	}
	rows, err := qtx.UpdateAppUserPassword(ctx, dbsqlc.UpdateAppUserPasswordParams{
		ID: locked.ID, Revision: locked.Revision, PasswordHash: newHash, ActorID: &locked.ID,
	})
	if err != nil {
		return s.writeError("update password", err)
	}
	if rows != 1 {
		return domainErrorWithKey(ErrorConflict, "user_changed", "user changed concurrently", nil)
	}
	if err = qtx.RevokeAppUserSessions(ctx, dbsqlc.RevokeAppUserSessionsParams{UserID: locked.ID, Reason: stringPointer("password_changed")}); err != nil {
		return s.internal("revoke sessions after password change", err)
	}
	if err = s.audit(ctx, qtx, "USER_CHANGE_PASSWORD", &locked.ID, "user", &locked.ID, "SUCCESS", requestID, nil); err != nil {
		return s.internal("audit password change", err)
	}
	if err = tx.Commit(ctx); err != nil {
		return s.internal("commit password change", err)
	}
	return nil
}

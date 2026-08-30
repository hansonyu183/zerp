package httpserver

import (
	"context"
	"errors"
	"net/http"
	"time"

	"github.com/hansonyu183/zerp/backend/internal/api/authorization"
	"github.com/hansonyu183/zerp/backend/internal/config"
	appdomain "github.com/hansonyu183/zerp/backend/internal/domains/app"
)

type appAuthorizationService interface {
	AuthenticateSession(context.Context, string, string, string, string) (appdomain.Principal, error)
	RequirePermission(context.Context, appdomain.Principal, string, string) error
}

type appAuthorizer struct {
	service appAuthorizationService
	cfg     config.Config
}

func (a appAuthorizer) AuthenticateSession(ctx context.Context, request *http.Request, path, requestID string) (authorization.Principal, error) {
	cookie, err := request.Cookie(a.cfg.SessionCookieName)
	if errors.Is(err, http.ErrNoCookie) {
		return authorization.Principal{}, authorization.NewError(authorization.ErrorUnauthenticated, "session expired", nil)
	}
	if err != nil {
		return authorization.Principal{}, authorization.NewError(authorization.ErrorInternal, "authorization failed", err)
	}
	principal, err := a.service.AuthenticateSession(ctx, cookie.Value, request.Header.Get("X-CSRF-Token"), path, requestID)
	if err != nil {
		return authorization.Principal{}, mapAuthorizationError(err)
	}
	return authorization.Principal{
		SessionID: principal.SessionID, ActorID: principal.User.ID,
		Username: principal.User.Username, DisplayName: principal.User.DisplayName, AvatarURL: principal.User.AvatarURL,
		CSRFToken: principal.CSRFToken, CSRFHash: principal.CSRFHash, Permissions: principal.Permissions,
		PasswordChangeRequired: principal.PasswordChangeRequired,
		IdleExpires:            principal.IdleExpires, AbsoluteEnds: principal.AbsoluteEnds,
	}, nil
}

func (a appAuthorizer) RequirePermission(ctx context.Context, principal authorization.Principal, path, requestID string) error {
	err := a.service.RequirePermission(ctx, appdomain.Principal{
		SessionID: principal.SessionID,
		User: appdomain.UserSummary{
			ID: principal.ActorID, Username: principal.Username,
			DisplayName: principal.DisplayName, AvatarURL: principal.AvatarURL,
		},
		CSRFToken: principal.CSRFToken, CSRFHash: principal.CSRFHash, Permissions: principal.Permissions,
		PasswordChangeRequired: principal.PasswordChangeRequired,
		IdleExpires:            principal.IdleExpires, AbsoluteEnds: principal.AbsoluteEnds,
	}, path, requestID)
	if err != nil {
		return mapAuthorizationError(err)
	}
	return nil
}

func (a appAuthorizer) ClearSessionCookie(writer http.ResponseWriter) {
	http.SetCookie(writer, &http.Cookie{
		Name: a.cfg.SessionCookieName, Value: "", Path: "/", Expires: time.Unix(1, 0),
		MaxAge: -1, HttpOnly: true, Secure: a.cfg.SessionCookieSecure, SameSite: cookieSameSite(a.cfg.SessionCookieSameSite),
	})
}

func cookieSameSite(value string) http.SameSite {
	switch value {
	case "strict":
		return http.SameSiteStrictMode
	case "none":
		return http.SameSiteNoneMode
	default:
		return http.SameSiteLaxMode
	}
}

func mapAuthorizationError(err error) error {
	var appErr *appdomain.DomainError
	if !errors.As(err, &appErr) {
		return authorization.NewError(authorization.ErrorInternal, "authorization failed", err)
	}
	switch appErr.Kind {
	case appdomain.ErrorUnauthenticated:
		return authorization.NewError(authorization.ErrorUnauthenticated, appErr.Message, err)
	case appdomain.ErrorForbidden:
		return authorization.NewError(authorization.ErrorForbidden, appErr.Message, err)
	default:
		return authorization.NewError(authorization.ErrorInternal, "authorization failed", err)
	}
}

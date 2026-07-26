package httpserver

import (
	"context"
	"errors"
	"net/http"

	"github.com/hansonyu183/zerp/backend/internal/api/authorization"
	"github.com/hansonyu183/zerp/backend/internal/config"
	appdomain "github.com/hansonyu183/zerp/backend/internal/domains/app"
)

type appAuthorizationService interface {
	Authorize(context.Context, string, string, string, string) (appdomain.Principal, error)
}

type appAuthorizer struct {
	service appAuthorizationService
	cfg     config.Config
}

func (a appAuthorizer) Authorize(ctx context.Context, request *http.Request, path, requestID string) (authorization.Principal, error) {
	cookie, err := request.Cookie(a.cfg.SessionCookieName)
	if errors.Is(err, http.ErrNoCookie) {
		return authorization.Principal{}, authorization.NewError(authorization.ErrorUnauthenticated, "session expired", nil)
	}
	if err != nil {
		return authorization.Principal{}, authorization.NewError(authorization.ErrorInternal, "authorization failed", err)
	}
	principal, err := a.service.Authorize(ctx, cookie.Value, request.Header.Get("X-CSRF-Token"), path, requestID)
	if err != nil {
		var appErr *appdomain.DomainError
		if !errors.As(err, &appErr) {
			return authorization.Principal{}, authorization.NewError(authorization.ErrorInternal, "authorization failed", err)
		}
		switch appErr.Kind {
		case appdomain.ErrorUnauthenticated:
			return authorization.Principal{}, authorization.NewError(authorization.ErrorUnauthenticated, appErr.Message, err)
		case appdomain.ErrorForbidden:
			return authorization.Principal{}, authorization.NewError(authorization.ErrorForbidden, appErr.Message, err)
		default:
			return authorization.Principal{}, authorization.NewError(authorization.ErrorInternal, "authorization failed", err)
		}
	}
	return authorization.Principal{ActorID: principal.User.ID, Permissions: principal.Permissions}, nil
}

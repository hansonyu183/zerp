package httpserver

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/hansonyu183/zerp/backend/internal/api/authorization"
	"github.com/hansonyu183/zerp/backend/internal/config"
	appdomain "github.com/hansonyu183/zerp/backend/internal/domains/app"
)

type appAuthorizationStub struct {
	principal appdomain.Principal
	err       error
	path      string
	csrf      string
	requestID string
}

func (s *appAuthorizationStub) AuthenticateSession(_ context.Context, _, csrf, path, requestID string) (appdomain.Principal, error) {
	s.path = path
	s.csrf = csrf
	s.requestID = requestID
	return s.principal, s.err
}

func (s *appAuthorizationStub) RequirePermission(_ context.Context, _ appdomain.Principal, path, requestID string) error {
	s.path = path
	s.requestID = requestID
	return s.err
}

func TestAppAuthorizerAdaptsPrincipalAndCredentials(t *testing.T) {
	stub := &appAuthorizationStub{principal: appdomain.Principal{User: appdomain.UserSummary{ID: "01J00000000000000000000000"}}}
	authorizer := appAuthorizer{service: stub, cfg: config.Config{SessionCookieName: "session"}}
	request := httptest.NewRequest(http.MethodPost, "/bob/customer/query", nil)
	request.AddCookie(&http.Cookie{Name: "session", Value: "session-token"})
	request.Header.Set("X-CSRF-Token", "csrf-token")

	principal, err := authorizer.AuthenticateSession(t.Context(), request, "/bob/customer/query", "request-1")
	if err != nil {
		t.Fatalf("authorize: %v", err)
	}
	if principal.ActorID != stub.principal.User.ID || stub.path != "/bob/customer/query" || stub.csrf != "csrf-token" || stub.requestID != "request-1" {
		t.Fatalf("principal=%+v path=%q csrf=%q requestID=%q", principal, stub.path, stub.csrf, stub.requestID)
	}
}

func TestAppAuthorizerMapsMissingCookieAndForbidden(t *testing.T) {
	authorizer := appAuthorizer{service: &appAuthorizationStub{}, cfg: config.Config{SessionCookieName: "session"}}
	request := httptest.NewRequest(http.MethodPost, "/bob/customer/query", nil)
	if _, err := authorizer.AuthenticateSession(t.Context(), request, "/bob/customer/query", "request-1"); !authorization.IsKind(err, authorization.ErrorUnauthenticated) {
		t.Fatalf("missing cookie error = %v", err)
	}

	stub := &appAuthorizationStub{err: &appdomain.DomainError{Kind: appdomain.ErrorForbidden, Message: "permission denied", Cause: errors.New("denied")}}
	authorizer.service = stub
	request.AddCookie(&http.Cookie{Name: "session", Value: "session-token"})
	if _, err := authorizer.AuthenticateSession(t.Context(), request, "/bob/customer/query", "request-1"); !authorization.IsKind(err, authorization.ErrorForbidden) {
		t.Fatalf("forbidden error = %v", err)
	}
}

func TestAppAuthorizerChecksPermissionFromExistingPrincipal(t *testing.T) {
	stub := &appAuthorizationStub{}
	authorizer := appAuthorizer{service: stub, cfg: config.Config{SessionCookieName: "session"}}
	err := authorizer.RequirePermission(t.Context(), authorization.Principal{ActorID: "user-1", Permissions: []string{"/bob/customer/query"}}, "/bob/customer/query", "request-1")
	if err != nil || stub.path != "/bob/customer/query" || stub.requestID != "request-1" {
		t.Fatalf("error=%v path=%q requestID=%q", err, stub.path, stub.requestID)
	}
}

func TestAppAuthorizerClearsConfiguredSessionCookie(t *testing.T) {
	authorizer := appAuthorizer{cfg: config.Config{SessionCookieName: "session", SessionCookieSecure: true, SessionCookieSameSite: "none"}}
	recorder := httptest.NewRecorder()
	authorizer.ClearSessionCookie(recorder)
	cookies := recorder.Result().Cookies()
	if len(cookies) != 1 || cookies[0].Name != "session" || cookies[0].MaxAge >= 0 || !cookies[0].Secure || cookies[0].SameSite != http.SameSiteNoneMode {
		t.Fatalf("cookies = %#v", cookies)
	}
}

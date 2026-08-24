package authmiddleware

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/hansonyu183/zerp/backend/internal/api/authorization"
)

type recordingAuthorizer struct {
	authenticateCalls int
	permissionCalls   int
	clearCalls        int
	authenticateErr   error
	permissionErr     error
}

func (a *recordingAuthorizer) AuthenticateSession(context.Context, *http.Request, string, string) (authorization.Principal, error) {
	a.authenticateCalls++
	if a.authenticateErr != nil {
		return authorization.Principal{}, a.authenticateErr
	}
	return authorization.Principal{ActorID: "actor-1"}, nil
}

func (a *recordingAuthorizer) RequirePermission(context.Context, authorization.Principal, string, string) error {
	a.permissionCalls++
	return a.permissionErr
}

func (a *recordingAuthorizer) ClearSessionCookie(http.ResponseWriter) {
	a.clearCalls++
}

func TestRequirePermission(t *testing.T) {
	tests := []struct {
		name          string
		authorizer    authorization.Authorizer
		wantCalled    bool
		wantActor     string
		wantErrorKind authorization.ErrorKind
	}{
		{
			name: "success",
			authorizer: authorization.Func(func(
				_ context.Context,
				_ *http.Request,
				path string,
				requestID string,
			) (authorization.Principal, error) {
				if path != "/test/path" {
					t.Fatalf("path = %q", path)
				}
				if requestID != "request-123" {
					t.Fatalf("requestID = %q", requestID)
				}
				return authorization.Principal{ActorID: "actor-1"}, nil
			}),
			wantCalled: true,
			wantActor:  "actor-1",
		},
		{
			name: "authorization error",
			authorizer: authorization.Func(func(
				context.Context,
				*http.Request,
				string,
				string,
			) (authorization.Principal, error) {
				return authorization.Principal{}, authorization.NewError(
					authorization.ErrorForbidden,
					"forbidden",
					errors.New("denied"),
				)
			}),
			wantErrorKind: authorization.ErrorForbidden,
		},
		{
			name: "internal authorization error",
			authorizer: authorization.Func(func(
				context.Context,
				*http.Request,
				string,
				string,
			) (authorization.Principal, error) {
				return authorization.Principal{}, authorization.NewError(
					authorization.ErrorInternal,
					"authorization failed",
					errors.New("database unavailable"),
				)
			}),
			wantErrorKind: authorization.ErrorInternal,
		},
		{
			name: "empty actor",
			authorizer: authorization.Func(func(
				context.Context,
				*http.Request,
				string,
				string,
			) (authorization.Principal, error) {
				return authorization.Principal{}, nil
			}),
			wantErrorKind: authorization.ErrorUnauthenticated,
		},
		{
			name:          "nil authorizer",
			wantErrorKind: authorization.ErrorUnauthenticated,
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			gin.SetMode(gin.TestMode)
			router := gin.New()
			var gotError error
			var gotActor string
			called := false
			router.Use(func(c *gin.Context) {
				c.Set("requestId", "request-123")
			})
			router.POST(
				"/test/path",
				RequirePermission(test.authorizer, "/test/path", func(_ *gin.Context, err error) {
					gotError = err
				}),
				func(c *gin.Context) {
					called = true
					gotActor = Principal(c).ActorID
				},
			)

			request := httptest.NewRequest(http.MethodPost, "/test/path", nil)
			recorder := httptest.NewRecorder()
			router.ServeHTTP(recorder, request)

			if called != test.wantCalled {
				t.Fatalf("handler called = %t, want %t", called, test.wantCalled)
			}
			if gotActor != test.wantActor {
				t.Fatalf("actor = %q, want %q", gotActor, test.wantActor)
			}
			if test.wantErrorKind == 0 {
				if gotError != nil {
					t.Fatalf("error = %v", gotError)
				}
				return
			}
			if !authorization.IsKind(gotError, test.wantErrorKind) {
				t.Fatalf("error = %v, want kind %d", gotError, test.wantErrorKind)
			}
		})
	}
}

func TestRequirePermissionAuthenticatesOnceThenChecksPermission(t *testing.T) {
	authorizer := &recordingAuthorizer{}
	router := gin.New()
	router.POST("/test/path", RequirePermission(authorizer, "/test/path", func(*gin.Context, error) {}), func(c *gin.Context) {
		if Principal(c).ActorID != "actor-1" {
			t.Fatalf("principal = %+v", Principal(c))
		}
	})
	router.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(http.MethodPost, "/test/path", nil))
	if authorizer.authenticateCalls != 1 || authorizer.permissionCalls != 1 {
		t.Fatalf("calls: authenticate=%d permission=%d", authorizer.authenticateCalls, authorizer.permissionCalls)
	}
}

func TestRequireSessionClearsInvalidSessionCookie(t *testing.T) {
	authorizer := &recordingAuthorizer{authenticateErr: authorization.NewError(authorization.ErrorUnauthenticated, "session expired", nil)}
	router := gin.New()
	router.POST("/test/path", RequireSession(authorizer, "/test/path", func(*gin.Context, error) {}), func(*gin.Context) {
		t.Fatal("handler must not run")
	})
	router.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(http.MethodPost, "/test/path", nil))
	if authorizer.authenticateCalls != 1 || authorizer.permissionCalls != 0 || authorizer.clearCalls != 1 {
		t.Fatalf("calls: authenticate=%d permission=%d clear=%d", authorizer.authenticateCalls, authorizer.permissionCalls, authorizer.clearCalls)
	}
}

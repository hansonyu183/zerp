package authmiddleware

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/hansonyu183/zerp-back/internal/api/authorization"
)

func TestRequire(t *testing.T) {
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
				Require(test.authorizer, "/test/path", "principal", func(_ *gin.Context, err error) {
					gotError = err
				}),
				func(c *gin.Context) {
					called = true
					principal, ok := c.MustGet("principal").(authorization.Principal)
					if !ok {
						t.Fatal("principal has unexpected type")
					}
					gotActor = principal.ActorID
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

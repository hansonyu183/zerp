package wfl

import (
	"context"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/hansonyu183/zerp/backend/internal/api/authorization"
)

type handlerStub struct{}

func TestHandlerRegistersTypedWorkflowPermissions(t *testing.T) {
	gin.SetMode(gin.TestMode)
	router := gin.New()
	NewHandler(&handlerStub{}, authorization.FailClosed{},
		slog.New(slog.NewTextHandler(io.Discard, nil))).Register(router)
	routes := map[string]string{}
	for _, route := range router.Routes() {
		routes[route.Path] = route.Method
	}
	// WFL now only has read-only definition routes (query/get/trial) and instance routes
	// Lifecycle routes (create/save/submit/approve/etc) are now under /dcl/wfl-process-definition
	if len(routes) != 10 {
		t.Fatalf("route count = %d, want 10", len(routes))
	}
	for _, path := range []string{
		"/wfl/process-definition/query",
		"/wfl/process-definition/get",
		"/wfl/process-definition/trial",
		"/wfl/process-instance/query",
		"/wfl/process-instance/get",
		"/wfl/process-instance/audit-history",
		"/wfl/:processName/query",
		"/wfl/:processName/get",
		"/wfl/:processName/audit-history",
		"/wfl/:processName/create-child",
	} {
		if routes[path] != http.MethodPost {
			t.Fatalf("missing POST %s", path)
		}
	}
	// Verify lifecycle routes are NOT registered in WFL (they're in DCL now)
	for _, path := range []string{
		"/wfl/process-definition/create",
		"/wfl/process-definition/save",
		"/wfl/process-definition/create-version",
		"/wfl/process-definition/versions",
		"/wfl/process-definition/enable",
		"/wfl/process-definition/disable",
		"/wfl/process-definition/submit",
		"/wfl/process-definition/unsubmit",
		"/wfl/process-definition/reject",
		"/wfl/process-definition/approve",
		"/wfl/process-definition/unapprove",
		"/wfl/process-definition/delete-version",
		"/wfl/process-definition/delete",
	} {
		if _, exists := routes[path]; exists {
			t.Fatalf("lifecycle route should not be registered in WFL: %s", path)
		}
	}
}

func TestDynamicWorkflowAuthorizesExactDefinitionPath(t *testing.T) {
	gin.SetMode(gin.TestMode)
	router := gin.New()
	var authorizedPath string
	authorizer := authorization.Func(func(
		_ context.Context,
		_ *http.Request,
		path string,
		_ string,
	) (authorization.Principal, error) {
		authorizedPath = path
		return authorization.Principal{ActorID: "actor-1"}, nil
	})
	NewHandler(&handlerStub{}, authorizer,
		slog.New(slog.NewTextHandler(io.Discard, nil))).Register(router)

	request := httptest.NewRequest(http.MethodPost, "/wfl/customer-onboarding/query", strings.NewReader(`{}`))
	request.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)

	if authorizedPath != "/wfl/customer-onboarding/query" {
		t.Fatalf("authorized path = %q", authorizedPath)
	}
}

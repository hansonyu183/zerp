package wfl

import (
	"io"
	"log/slog"
	"net/http"
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
	if len(routes) != 14 {
		t.Fatalf("route count = %d, want 14", len(routes))
	}
	for _, path := range []string{
		"/wfl/sales-fulfillment/query",
		"/wfl/sales-fulfillment/get",
		"/wfl/sales-fulfillment/audit-history",
		"/wfl/sales-fulfillment/short-close-request",
		"/wfl/purchase-fulfillment/query",
		"/wfl/purchase-fulfillment/get",
		"/wfl/purchase-fulfillment/audit-history",
		"/wfl/purchase-fulfillment/short-close-confirm",
	} {
		if routes[path] != http.MethodPost {
			t.Fatalf("missing POST %s", path)
		}
	}
	for _, path := range []string{
		"/wfl/intermediary-trade/query",
		"/wfl/sales-fulfillment/create",
		"/wfl/sales-fulfillment/outbound-save",
		"/wfl/purchase-fulfillment/create",
		"/wfl/purchase-fulfillment/inbound-create",
	} {
		if _, exists := routes[path]; exists {
			t.Fatalf("removed workflow route is still registered: %s", path)
		}
	}
}

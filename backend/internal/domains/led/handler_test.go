package led

import (
	"log/slog"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/hansonyu183/zerp-back/internal/api/authorization"
)

func TestHandlerRegistersAllLEDRoutes(t *testing.T) {
	t.Parallel()
	gin.SetMode(gin.TestMode)
	router := gin.New()
	NewHandler(nil, authorization.FailClosed{}, slog.Default()).Register(router)
	got := make(map[string]bool)
	for _, route := range router.Routes() {
		got[route.Method+" "+route.Path] = true
	}
	expected := []string{
		"/led/opening/get", "/led/opening/save", "/led/opening/activate",
		"/led/opening/reopen", "/led/opening/cancel-reopen", "/led/opening/audit-history",
		"/led/inventory/query", "/led/inventory/balance",
		"/led/fund/query", "/led/fund/balance",
		"/led/party/query", "/led/party/balance",
	}
	for _, path := range expected {
		if !got["POST "+path] {
			t.Fatalf("route %s is not registered", path)
		}
	}
}

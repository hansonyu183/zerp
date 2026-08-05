package led

import (
	"log/slog"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/hansonyu183/zerp/backend/internal/api/authorization"
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
		"/led/closing/get", "/led/closing/close",
		"/led/closing/unclose", "/led/closing/history",
		"/led/inventory/query", "/led/inventory/balance",
		"/led/fund/query", "/led/fund/balance",
		"/led/customer/query", "/led/customer/balance",
		"/led/supplier/query", "/led/supplier/balance",
		"/led/other/query", "/led/other/balance",
		"/led/employee/query", "/led/employee/balance",
		"/led/container/query", "/led/container/balance",
		"/led/bill/query",
	}
	for _, path := range expected {
		if !got["POST "+path] {
			t.Fatalf("route %s is not registered", path)
		}
	}
}

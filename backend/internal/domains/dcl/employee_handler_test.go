package dcl

import (
	"net/http"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/hansonyu183/zerp/backend/internal/api/authorization"
)

func TestEmployeeHandlerRegistersOnlyTypedDCLRoutes(t *testing.T) {
	gin.SetMode(gin.TestMode)
	router := gin.New()
	NewEmployeeHandler(nil, authorization.FailClosed{}, nil).Register(router)

	want := map[string]bool{}
	for _, action := range []string{
		"create", "save", "submit", "unsubmit", "reject", "approve",
		"unapprove", "delete", "get", "query", "versions", "audit-history",
	} {
		want["/dcl/employee/"+action] = false
	}
	for _, route := range router.Routes() {
		if route.Method != http.MethodPost {
			t.Fatalf("employee route %s uses %s", route.Path, route.Method)
		}
		if _, ok := want[route.Path]; !ok {
			t.Fatalf("unexpected employee route %s", route.Path)
		}
		want[route.Path] = true
	}
	for path, found := range want {
		if !found {
			t.Errorf("employee route %s is not registered", path)
		}
	}
}

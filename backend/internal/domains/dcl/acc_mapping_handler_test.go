package dcl

import (
	"net/http"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/hansonyu183/zerp/backend/internal/api/authorization"
)

func TestAccMappingHandlerRegistersOnlyTypedDCLRoutes(t *testing.T) {
	gin.SetMode(gin.TestMode)
	router := gin.New()
	NewAccMappingHandler(nil, authorization.FailClosed{}, nil).Register(router)

	want := map[string]bool{}
	for _, action := range []string{
		"create", "save", "submit", "unsubmit", "reject", "approve", "unapprove",
		"delete-version", "create-next", "get", "query", "versions", "audit-history",
	} {
		want["/dcl/acc-mapping/"+action] = false
	}
	for _, route := range router.Routes() {
		if route.Method != http.MethodPost {
			t.Fatalf("acc-mapping route %s uses %s", route.Path, route.Method)
		}
		if _, ok := want[route.Path]; !ok {
			t.Fatalf("unexpected acc-mapping route %s", route.Path)
		}
		want[route.Path] = true
	}
	for path, found := range want {
		if !found {
			t.Errorf("acc-mapping route %s is not registered", path)
		}
	}
}

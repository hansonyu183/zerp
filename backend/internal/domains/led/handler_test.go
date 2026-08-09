package led

import (
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/hansonyu183/zerp/backend/internal/api/authorization"
	"github.com/hansonyu183/zerp/backend/internal/api/requestbody"
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
		"/led/container/query", "/led/container/balance",
		"/led/bill/query",
	}
	for _, path := range expected {
		if !got["POST "+path] {
			t.Fatalf("route %s is not registered", path)
		}
	}
}

func TestCounterpartyTypeOnlyAcceptedByOtherBalance(t *testing.T) {
	t.Parallel()
	const body = `{"page":1,"pageSize":20,"filters":{"asOfDate":"2059-01-31","counterpartyType":"employee"}}`

	decode := func(target any) error {
		recorder := httptest.NewRecorder()
		context, _ := gin.CreateTestContext(recorder)
		context.Request = httptest.NewRequest(http.MethodPost, "/", strings.NewReader(body))
		context.Request.Header.Set("Content-Type", "application/json")
		return requestbody.DecodeJSON(context, target)
	}

	if err := decode(&BalanceInput{}); err == nil {
		t.Fatal("shared balance request accepted counterpartyType")
	}
	var input OtherBalanceInput
	if err := decode(&input); err != nil {
		t.Fatalf("other balance request rejected counterpartyType: %v", err)
	}
	if input.Filters.CounterpartyType != "employee" {
		t.Fatalf("counterpartyType = %q, want employee", input.Filters.CounterpartyType)
	}
}

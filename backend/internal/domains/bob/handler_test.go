package bob

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/hansonyu183/zerp/backend/internal/api/authorization"
	"github.com/hansonyu183/zerp/backend/internal/api/middleware"
	"github.com/hansonyu183/zerp/backend/internal/api/response"
)

type serviceStub struct {
	queryCalls int
	entity     string
	actions    []string
}

func (s *serviceStub) record(action, entity string) {
	s.entity = entity
	s.actions = append(s.actions, action)
}

func (s *serviceStub) Query(_ context.Context, entity string, input QueryInput) (Page[QueryItem], error) {
	s.queryCalls++
	s.record("query", entity)
	return Page[QueryItem]{Items: []QueryItem{}, Page: input.Page, PageSize: input.PageSize}, nil
}

func (s *serviceStub) Get(_ context.Context, entity string, _ GetInput) (ObjectView, error) {
	s.record("get", entity)
	return ObjectView{}, nil
}

func (s *serviceStub) CustomerCurrentQuery(_ context.Context, input CustomerCurrentQueryInput) (Page[CustomerCurrentListItem], error) {
	s.record("query", EntityCustomer)
	return Page[CustomerCurrentListItem]{Items: []CustomerCurrentListItem{}, Page: input.Page, PageSize: input.PageSize}, nil
}

func (s *serviceStub) CustomerCurrentGet(_ context.Context, _ string) (CustomerCurrentView, error) {
	s.record("get", EntityCustomer)
	return CustomerCurrentView{}, nil
}

func (s *serviceStub) CustomerAccountCurrentQuery(_ context.Context, input CustomerAccountCurrentQueryInput) (Page[CustomerAccountCurrentListItem], error) {
	s.record("query", EntityCustomerAccount)
	return Page[CustomerAccountCurrentListItem]{Items: []CustomerAccountCurrentListItem{}, Page: input.Page, PageSize: input.PageSize}, nil
}

func (s *serviceStub) CustomerAccountCurrentGet(_ context.Context, _ string) (CustomerAccountCurrentView, error) {
	s.record("get", EntityCustomerAccount)
	return CustomerAccountCurrentView{}, nil
}

func (s *serviceStub) QueryReferenceCandidates(_ context.Context, _ ReferenceQueryInput) ([]ReferenceCandidate, error) {
	s.record("query", "reference")
	return []ReferenceCandidate{}, nil
}

func (s *serviceStub) PartyQuery(_ context.Context, input QueryInput) (Page[PartyListItem], error) {
	s.record("query", "party")
	return Page[PartyListItem]{Items: []PartyListItem{}, Page: input.Page, PageSize: input.PageSize}, nil
}

func (s *serviceStub) PartyGet(_ context.Context, _ PartyGetInput, _ PartyRelationshipVisibility) (PartyView, error) {
	s.record("get", "party")
	return PartyView{}, nil
}

func testBOBLogger() *slog.Logger {
	return slog.New(slog.NewTextHandler(io.Discard, nil))
}

func newBOBTestRouter(service applicationService, authorizer authorization.Authorizer) *gin.Engine {
	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.Use(middleware.RequestID())
	NewHandler(service, authorizer, testBOBLogger()).Register(router)
	return router
}

func TestHandlerRegistersReadRoutesButNoDCLLifecycleAliases(t *testing.T) {
	router := newBOBTestRouter(&serviceStub{}, authorization.FailClosed{})
	routes := router.Routes()
	expectedEntities := []string{"customer", "customer-account"}
	expectedActions := []string{"query", "get"}
	wanted := make(map[string]bool, len(expectedEntities)*len(expectedActions))
	for _, entity := range expectedEntities {
		for _, action := range expectedActions {
			wanted["/bob/"+entity+"/"+action] = false
		}
	}
	wanted["/bob/operating-entity/query"] = false
	wanted["/bob/operating-entity/get"] = false
	wanted["/bob/warehouse/query"] = false
	wanted["/bob/warehouse/get"] = false
	wanted["/bob/vehicle/query"] = false
	wanted["/bob/vehicle/get"] = false
	wanted["/bob/fund-account/query"] = false
	wanted["/bob/fund-account/get"] = false
	wanted["/bob/employee/query"] = false
	wanted["/bob/employee/get"] = false
	wanted["/bob/supplier/query"] = false
	wanted["/bob/supplier/get"] = false
	for _, path := range []string{
		"/bob/party/query", "/bob/party/get",
		"/bob/other-unit/query", "/bob/other-unit/get",
		"/bob/sales-partner/query", "/bob/sales-partner/get",
	} {
		wanted[path] = false
	}
	for _, route := range routes {
		if strings.HasPrefix(route.Path, "/bob/operating-entity/") &&
			route.Path != "/bob/operating-entity/query" && route.Path != "/bob/operating-entity/get" {
			t.Fatalf("DCL-owned operating entity lifecycle alias remains registered: %s", route.Path)
		}
		if strings.HasPrefix(route.Path, "/bob/warehouse/") &&
			route.Path != "/bob/warehouse/query" && route.Path != "/bob/warehouse/get" {
			t.Fatalf("DCL-owned warehouse lifecycle alias remains registered: %s", route.Path)
		}
		if strings.HasPrefix(route.Path, "/bob/vehicle/") &&
			route.Path != "/bob/vehicle/query" && route.Path != "/bob/vehicle/get" {
			t.Fatalf("DCL-owned vehicle lifecycle alias remains registered: %s", route.Path)
		}
		if strings.HasPrefix(route.Path, "/bob/fund-account/") &&
			route.Path != "/bob/fund-account/query" && route.Path != "/bob/fund-account/get" {
			t.Fatalf("DCL-owned fund account lifecycle alias remains registered: %s", route.Path)
		}
		if strings.HasPrefix(route.Path, "/bob/product/") &&
			route.Path != "/bob/product/query" && route.Path != "/bob/product/get" {
			t.Fatalf("DCL-owned product lifecycle alias remains registered: %s", route.Path)
		}
		if strings.HasPrefix(route.Path, "/bob/employee/") &&
			route.Path != "/bob/employee/query" && route.Path != "/bob/employee/get" {
			t.Fatalf("DCL-owned employee lifecycle alias remains registered: %s", route.Path)
		}
		if strings.HasPrefix(route.Path, "/bob/supplier/") &&
			route.Path != "/bob/supplier/query" && route.Path != "/bob/supplier/get" {
			t.Fatalf("DCL-owned supplier lifecycle alias remains registered: %s", route.Path)
		}
		if strings.HasPrefix(route.Path, "/bob/other-unit/") &&
			route.Path != "/bob/other-unit/query" && route.Path != "/bob/other-unit/get" {
			t.Fatalf("DCL-owned other-unit lifecycle alias remains registered: %s", route.Path)
		}
		if strings.HasPrefix(route.Path, "/bob/sales-partner/") &&
			route.Path != "/bob/sales-partner/query" && route.Path != "/bob/sales-partner/get" {
			t.Fatalf("DCL-owned sales-partner lifecycle alias remains registered: %s", route.Path)
		}
		if strings.HasPrefix(route.Path, "/bob/service/") {
			t.Fatalf("obsolete standalone service route remains registered: %s", route.Path)
		}
		if strings.HasPrefix(route.Path, "/bob/other-party/") {
			t.Fatalf("obsolete route remains registered: %s", route.Path)
		}
		if _, exists := wanted[route.Path]; exists && route.Method == http.MethodPost {
			wanted[route.Path] = true
		}
	}
	for path, found := range wanted {
		if !found {
			t.Errorf("route %s is not registered", path)
		}
	}
	for _, route := range routes {
		if strings.HasPrefix(route.Path, "/bob/customer/") && route.Path != "/bob/customer/query" && route.Path != "/bob/customer/get" {
			t.Fatalf("legacy Customer write route remains registered: %s", route.Path)
		}
		if strings.HasPrefix(route.Path, "/bob/customer-account/") && route.Path != "/bob/customer-account/query" && route.Path != "/bob/customer-account/get" {
			t.Fatalf("legacy Customer Account write route remains registered: %s", route.Path)
		}
	}
}

func TestHandlerDoesNotRegisterLegacyTaxMatchRoutes(t *testing.T) {
	router := newBOBTestRouter(&serviceStub{}, authorization.FailClosed{})
	for _, route := range router.Routes() {
		if route.Path == "/bob/customer/tax-match" || route.Path == "/bob/supplier/tax-match" {
			t.Fatalf("legacy route remains reachable: %s", route.Path)
		}
	}
}

func TestHandlerDispatchesWarehouseCurrentReadActionsOnly(t *testing.T) {
	const objectID = "01J00000000000000000000010"
	tests := []struct {
		action string
		body   string
	}{
		{"query", `{"page":1,"pageSize":20,"filters":{},"sort":[]}`},
		{"get", `{"objectId":"` + objectID + `"}`},
	}
	authorizer := authorization.Func(func(_ context.Context, _ *http.Request, _, _ string) (authorization.Principal, error) {
		return authorization.Principal{ActorID: "01J00000000000000000000000"}, nil
	})
	for _, test := range tests {
		t.Run(test.action, func(t *testing.T) {
			service := &serviceStub{}
			router := newBOBTestRouter(service, authorizer)
			request := httptest.NewRequest(http.MethodPost, "/bob/warehouse/"+test.action, strings.NewReader(test.body))
			request.Header.Set("Content-Type", "application/json")
			recorder := httptest.NewRecorder()
			router.ServeHTTP(recorder, request)

			if recorder.Code != http.StatusOK {
				t.Fatalf("status = %d, want %d", recorder.Code, http.StatusOK)
			}
			if len(service.actions) != 1 || service.actions[0] != test.action || service.entity != EntityWarehouse {
				t.Fatalf("calls = %v, entity = %q", service.actions, service.entity)
			}
		})
	}
	for _, action := range []string{"create", "save", "delete", "submit", "unsubmit", "approve", "unapprove", "reject", "enable", "disable", "versions", "audit-history"} {
		t.Run("no legacy "+action, func(t *testing.T) {
			router := newBOBTestRouter(&serviceStub{}, authorizer)
			request := httptest.NewRequest(http.MethodPost, "/bob/warehouse/"+action, strings.NewReader(`{}`))
			request.Header.Set("Content-Type", "application/json")
			recorder := httptest.NewRecorder()
			router.ServeHTTP(recorder, request)
			if recorder.Code != http.StatusNotFound {
				t.Fatalf("status = %d, want %d", recorder.Code, http.StatusNotFound)
			}
		})
	}
}

func TestHandlerReturnsNotFoundForEveryLegacyBOBWritePath(t *testing.T) {
	authorizer := authorization.Func(func(_ context.Context, _ *http.Request, _, _ string) (authorization.Principal, error) {
		return authorization.Principal{ActorID: "01J00000000000000000000000"}, nil
	})
	entities := []string{
		"party", "customer", "customer-account", "supplier", "employee",
		"other-unit", "sales-partner", "product", "warehouse", "vehicle",
		"fund-account", "operating-entity",
	}
	actions := []string{
		"create", "save", "submit", "unsubmit", "reject", "approve",
		"unapprove", "delete", "enable", "disable", "versions", "audit-history",
	}
	for _, entity := range entities {
		for _, action := range actions {
			t.Run(entity+"/"+action, func(t *testing.T) {
				router := newBOBTestRouter(&serviceStub{}, authorizer)
				request := httptest.NewRequest(http.MethodPost, "/bob/"+entity+"/"+action, strings.NewReader(`{}`))
				request.Header.Set("Content-Type", "application/json")
				recorder := httptest.NewRecorder()
				router.ServeHTTP(recorder, request)
				if recorder.Code != http.StatusNotFound {
					t.Fatalf("status = %d, want %d", recorder.Code, http.StatusNotFound)
				}
			})
		}
	}
}

func TestHandlerDoesNotRegisterCustomerWritePaths(t *testing.T) {
	router := newBOBTestRouter(&serviceStub{}, authorization.FailClosed{})
	for _, path := range []string{
		"/bob/customer/create", "/bob/customer/save", "/bob/customer/submit", "/bob/customer/attachment-initiate",
		"/bob/customer-account/create", "/bob/customer-account/save", "/bob/customer-account/approve",
	} {
		recorder := httptest.NewRecorder()
		request := httptest.NewRequest(http.MethodPost, path, strings.NewReader(`{}`))
		router.ServeHTTP(recorder, request)
		if recorder.Code != http.StatusNotFound {
			t.Fatalf("%s status=%d, want 404", path, recorder.Code)
		}
	}
}

func TestCurrentObjectViewExposesDCLSource(t *testing.T) {
	view := ObjectView{
		SourceApprovalEntryID: "01J00000000000000000000010",
		SourceVersionNo:       7,
	}
	payload, err := json.Marshal(view)
	if err != nil {
		t.Fatal(err)
	}
	var fields map[string]any
	if err := json.Unmarshal(payload, &fields); err != nil {
		t.Fatal(err)
	}
	if fields["sourceApprovalEntryId"] != "01J00000000000000000000010" {
		t.Fatalf("sourceApprovalEntryId = %#v", fields["sourceApprovalEntryId"])
	}
	if fields["sourceVersionNo"] != float64(7) {
		t.Fatalf("sourceVersionNo = %#v", fields["sourceVersionNo"])
	}
}

func TestCurrentQueryItemExposesDCLSourceInsteadOfApprovalSummary(t *testing.T) {
	item := QueryItem{
		SourceApprovalEntryID: "01J00000000000000000000010",
		SourceVersionNo:       7,
	}
	payload, err := json.Marshal(item)
	if err != nil {
		t.Fatal(err)
	}
	var fields map[string]any
	if err := json.Unmarshal(payload, &fields); err != nil {
		t.Fatal(err)
	}
	if fields["sourceApprovalEntryId"] != "01J00000000000000000000010" || fields["sourceVersionNo"] != float64(7) {
		t.Fatalf("current source = %#v", fields)
	}
	if _, exists := fields["latestApproved"]; exists {
		t.Fatalf("legacy approval summary is public: %#v", fields)
	}
}

func TestPartyCurrentResponsesExposeDCLSource(t *testing.T) {
	values := []any{
		PartyListItem{SourceApprovalEntryID: "01J00000000000000000000010", SourceVersionNo: 7},
		PartyView{SourceApprovalEntryID: "01J00000000000000000000010", SourceVersionNo: 7},
		PartyRelationshipCard{SourceApprovalEntryID: "01J00000000000000000000010", SourceVersionNo: 7},
	}
	for _, value := range values {
		payload, err := json.Marshal(value)
		if err != nil {
			t.Fatal(err)
		}
		var fields map[string]any
		if err = json.Unmarshal(payload, &fields); err != nil {
			t.Fatal(err)
		}
		if fields["sourceApprovalEntryId"] != "01J00000000000000000000010" || fields["sourceVersionNo"] != float64(7) {
			t.Fatalf("Party current source = %#v", fields)
		}
		if _, exists := fields["approval"]; exists {
			t.Fatalf("legacy approval metadata is public: %#v", fields)
		}
	}
}

func TestHandlerUsesExactPermissionPathAndPrincipal(t *testing.T) {
	service := &serviceStub{}
	var permission string
	authorizer := authorization.Func(func(_ context.Context, _ *http.Request, path, requestID string) (authorization.Principal, error) {
		permission = path
		if requestID == "" {
			t.Fatal("requestId was not forwarded")
		}
		return authorization.Principal{ActorID: "01J00000000000000000000000"}, nil
	})
	router := newBOBTestRouter(service, authorizer)
	request := httptest.NewRequest(
		http.MethodPost,
		"/bob/vehicle/query",
		strings.NewReader(`{"page":1,"pageSize":20,"filters":{},"sort":[]}`),
	)
	request.Header.Set("Content-Type", "application/json")
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", recorder.Code, http.StatusOK)
	}
	if permission != "/bob/vehicle/query" {
		t.Fatalf("permission = %q", permission)
	}
	if len(service.actions) != 1 || service.actions[0] != "query" || service.entity != EntityVehicle {
		t.Fatalf("actions = %v, entity = %q", service.actions, service.entity)
	}
}

func TestHandlerFailsClosedWithoutAuthorizer(t *testing.T) {
	router := newBOBTestRouter(&serviceStub{}, nil)
	request := httptest.NewRequest(http.MethodPost, "/bob/customer/query", strings.NewReader(`{"page":1,"pageSize":20,"filters":{},"sort":[]}`))
	request.Header.Set("Content-Type", "application/json")
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, request)

	var envelope response.Envelope
	if err := json.Unmarshal(recorder.Body.Bytes(), &envelope); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if envelope.Code != response.CodeUnauthenticated {
		t.Fatalf("code = %d, want %d", envelope.Code, response.CodeUnauthenticated)
	}
}

func TestHandlerDoesNotReadGuessedIDWithoutPermission(t *testing.T) {
	service := &serviceStub{}
	authorizer := authorization.Func(func(_ context.Context, _ *http.Request, _, _ string) (authorization.Principal, error) {
		return authorization.Principal{}, authorization.NewError(authorization.ErrorForbidden, "permission denied", nil)
	})
	router := newBOBTestRouter(service, authorizer)
	request := httptest.NewRequest(
		http.MethodPost,
		"/bob/customer/get",
		strings.NewReader(`{"objectId":"01J00000000000000000000010"}`),
	)
	request.Header.Set("Content-Type", "application/json")
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, request)

	var envelope response.Envelope
	if err := json.Unmarshal(recorder.Body.Bytes(), &envelope); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if envelope.Code != response.CodeForbidden {
		t.Fatalf("code = %d, want %d", envelope.Code, response.CodeForbidden)
	}
	if len(service.actions) != 0 {
		t.Fatalf("service calls = %v", service.actions)
	}
}

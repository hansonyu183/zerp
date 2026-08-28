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
	"github.com/hansonyu183/zerp/backend/internal/platform/approval"
)

type splitAuthorizationStub struct {
	authenticate func(context.Context, *http.Request, string, string) (authorization.Principal, error)
	permission   func(context.Context, authorization.Principal, string, string) error
}

func (s splitAuthorizationStub) AuthenticateSession(ctx context.Context, request *http.Request, path, requestID string) (authorization.Principal, error) {
	return s.authenticate(ctx, request, path, requestID)
}

func (s splitAuthorizationStub) RequirePermission(ctx context.Context, principal authorization.Principal, path, requestID string) error {
	return s.permission(ctx, principal, path, requestID)
}

func (splitAuthorizationStub) ClearSessionCookie(http.ResponseWriter) {}

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

func (s *serviceStub) Create(_ context.Context, entity string, _ CreateInput, _ approval.Actor) (MutationResult, error) {
	s.record("create", entity)
	return MutationResult{}, nil
}

func (s *serviceStub) Unsubmit(_ context.Context, entity string, _ ReverseInput, _ approval.Actor) (MutationResult, error) {
	s.record("unsubmit", entity)
	return MutationResult{}, nil
}

func (s *serviceStub) Save(_ context.Context, entity string, _ SaveInput, _ approval.Actor) (MutationResult, error) {
	s.record("save", entity)
	return MutationResult{}, nil
}

func (s *serviceStub) Delete(_ context.Context, entity string, _ DeleteInput, _ approval.Actor) error {
	s.record("delete", entity)
	return nil
}

func (s *serviceStub) Submit(_ context.Context, entity string, _ VersionRevisionInput, _ approval.Actor) (MutationResult, error) {
	s.record("submit", entity)
	return MutationResult{}, nil
}

func (s *serviceStub) Approve(_ context.Context, entity string, _ ReviewInput, _ approval.Actor) (MutationResult, error) {
	s.record("approve", entity)
	return MutationResult{}, nil
}

func (s *serviceStub) Unapprove(_ context.Context, entity string, _ ReverseInput, _ approval.Actor) (MutationResult, error) {
	s.record("unapprove", entity)
	return MutationResult{}, nil
}

func (s *serviceStub) Reject(_ context.Context, entity string, _ ReviewInput, _ approval.Actor) (MutationResult, error) {
	s.record("reject", entity)
	return MutationResult{}, nil
}

func (s *serviceStub) Enable(_ context.Context, entity string, _ ObjectRevisionInput, _ approval.Actor) (MutationResult, error) {
	s.record("enable", entity)
	return MutationResult{}, nil
}

func (s *serviceStub) Disable(_ context.Context, entity string, _ ObjectRevisionInput, _ approval.Actor) (MutationResult, error) {
	s.record("disable", entity)
	return MutationResult{}, nil
}

func (s *serviceStub) Versions(_ context.Context, entity string, _ HistoryInput) (Page[VersionHistoryItem], error) {
	s.record("versions", entity)
	return Page[VersionHistoryItem]{Items: []VersionHistoryItem{}}, nil
}

func (s *serviceStub) AuditHistory(_ context.Context, entity string, _ HistoryInput) (Page[AuditEventView], error) {
	s.record("audit-history", entity)
	return Page[AuditEventView]{Items: []AuditEventView{}}, nil
}

func (s *serviceStub) CustomerQuery(_ context.Context, input QueryInput) (Page[CustomerListItem], error) {
	s.record("query", EntityCustomer)
	return Page[CustomerListItem]{Items: []CustomerListItem{}, Page: input.Page, PageSize: input.PageSize}, nil
}

func (s *serviceStub) CustomerGet(_ context.Context, _ GetInput) (CustomerDetailView, error) {
	s.record("get", EntityCustomer)
	return CustomerDetailView{}, nil
}

func (s *serviceStub) CustomerCreate(_ context.Context, _ CustomerCreateInput, _ approval.Actor, _ bool) (CustomerCreateResult, error) {
	s.record("create", EntityCustomer)
	return CustomerCreateResult{}, nil
}

func (s *serviceStub) CustomerAccountAdd(_ context.Context, _ CustomerAccountAddInput, _ approval.Actor) (CustomerAccountView, error) {
	return CustomerAccountView{}, nil
}

func (s *serviceStub) CustomerAccountDelete(_ context.Context, _ DeleteInput, _ approval.Actor) error {
	return nil
}

func (s *serviceStub) CustomerSave(_ context.Context, _ CustomerSaveInput, _ approval.Actor) (MutationResult, error) {
	s.record("save", EntityCustomer)
	return MutationResult{}, nil
}

func (s *serviceStub) SupplierQuery(_ context.Context, input QueryInput) (Page[SupplierListItem], error) {
	s.record("query", EntitySupplier)
	return Page[SupplierListItem]{Items: []SupplierListItem{}, Page: input.Page, PageSize: input.PageSize}, nil
}

func (s *serviceStub) SupplierGet(_ context.Context, _ GetInput) (SupplierDetailView, error) {
	s.record("get", EntitySupplier)
	return SupplierDetailView{}, nil
}

func (s *serviceStub) SupplierCreate(_ context.Context, _ SupplierCreateInput, _ approval.Actor, _ bool) (SupplierCreateResult, error) {
	s.record("create", EntitySupplier)
	return SupplierCreateResult{}, nil
}

func (s *serviceStub) SupplierSave(_ context.Context, _ SupplierSaveInput, _ approval.Actor) (MutationResult, error) {
	s.record("save", EntitySupplier)
	return MutationResult{}, nil
}

func (s *serviceStub) SalesPartnerQuery(_ context.Context, input QueryInput) (Page[SalesPartnerListItem], error) {
	s.record("query", EntitySalesPartner)
	return Page[SalesPartnerListItem]{Items: []SalesPartnerListItem{}, Page: input.Page, PageSize: input.PageSize}, nil
}

func (s *serviceStub) SalesPartnerGet(_ context.Context, _ GetInput) (SalesPartnerDetailView, error) {
	s.record("get", EntitySalesPartner)
	return SalesPartnerDetailView{}, nil
}

func (s *serviceStub) SalesPartnerCreate(_ context.Context, _ SalesPartnerCreateInput, _ approval.Actor, _ bool) (SalesPartnerCreateResult, error) {
	s.record("create", EntitySalesPartner)
	return SalesPartnerCreateResult{}, nil
}

func (s *serviceStub) SalesPartnerSave(_ context.Context, _ SalesPartnerSaveInput, _ approval.Actor) (MutationResult, error) {
	s.record("save", EntitySalesPartner)
	return MutationResult{}, nil
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

func (s *serviceStub) OtherUnitQuery(_ context.Context, input QueryInput) (Page[OtherUnitView], error) {
	s.record("query", EntityOtherUnit)
	return Page[OtherUnitView]{Items: []OtherUnitView{}, Page: input.Page, PageSize: input.PageSize}, nil
}

func (s *serviceStub) OtherUnitGet(_ context.Context, _ GetInput) (OtherUnitView, error) {
	s.record("get", EntityOtherUnit)
	return OtherUnitView{}, nil
}

func (s *serviceStub) OtherUnitCreate(_ context.Context, _ OtherUnitCreateInput, _ approval.Actor, _ bool) (OtherUnitCreateResult, error) {
	s.record("create", EntityOtherUnit)
	return OtherUnitCreateResult{}, nil
}

func (s *serviceStub) OtherUnitSave(_ context.Context, _ OtherUnitSaveInput, _ approval.Actor) (MutationResult, error) {
	s.record("save", EntityOtherUnit)
	return MutationResult{}, nil
}

func (s *serviceStub) OtherUnitVersions(_ context.Context, input HistoryInput) (Page[VersionHistoryItem], error) {
	s.record("versions", EntityOtherUnit)
	return Page[VersionHistoryItem]{Items: []VersionHistoryItem{}, Page: input.Page, PageSize: input.PageSize}, nil
}

func testBOBLogger() *slog.Logger {
	return slog.New(slog.NewTextHandler(io.Discard, nil))
}

func newBOBTestRouter(service applicationService, authorizer authorization.Authorizer) *gin.Engine {
	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.Use(middleware.RequestID())
	NewHandler(service, nil, authorizer, testBOBLogger()).Register(router)
	return router
}

func TestHandlerRegistersOperatingEntityReadRoutesButNoDCLLifecycleAliases(t *testing.T) {
	router := newBOBTestRouter(&serviceStub{}, authorization.FailClosed{})
	routes := router.Routes()
	expectedEntities := []string{"customer", "supplier", "sales-partner"}
	expectedActions := []string{
		"query", "get", "create", "save", "delete", "submit", "unsubmit",
		"approve", "unapprove", "reject", "enable", "disable", "versions", "audit-history",
	}
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
	for _, path := range []string{
		"/bob/party/query", "/bob/party/get",
		"/bob/other-unit/query", "/bob/other-unit/get", "/bob/other-unit/create", "/bob/other-unit/save",
		"/bob/other-unit/delete", "/bob/other-unit/submit", "/bob/other-unit/unsubmit",
		"/bob/other-unit/approve", "/bob/other-unit/reject", "/bob/other-unit/unapprove", "/bob/other-unit/enable",
		"/bob/other-unit/disable", "/bob/other-unit/versions", "/bob/other-unit/audit-history",
		"/bob/customer-account/submit", "/bob/customer-account/unsubmit",
		"/bob/customer-account/approve", "/bob/customer-account/reject", "/bob/customer-account/unapprove",
		"/bob/customer-account/enable", "/bob/customer-account/disable",
		"/bob/customer-account/versions", "/bob/customer-account/audit-history",
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
	const entitySpecificRoutes = 10
	if len(routes) != len(wanted)+entitySpecificRoutes {
		t.Fatalf("registered route count = %d, want %d", len(routes), len(wanted)+entitySpecificRoutes)
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

func TestOtherUnitCreateRequiresMatchingPartyPermission(t *testing.T) {
	tests := []struct {
		name          string
		body          string
		partyPathWant string
	}{
		{
			name:          "new Party",
			body:          `{"newParty":{"kind":"ORGANIZATION","legalName":"测试机构","strongIdentifiers":[]},"data":{"operatingEntityId":"01J00000000000000000000010"}}`,
			partyPathWant: "/dcl/party/create",
		},
		{
			name:          "existing Party",
			body:          `{"partyId":"01J00000000000000000000011","data":{"operatingEntityId":"01J00000000000000000000010"}}`,
			partyPathWant: "/bob/party/get",
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			var paths []string
			authorizer := splitAuthorizationStub{
				authenticate: func(_ context.Context, _ *http.Request, path, _ string) (authorization.Principal, error) {
					paths = append(paths, path)
					return authorization.Principal{
						ActorID:     "01J00000000000000000000000",
						Permissions: []string{"/bob/party/get", "/bob/other-unit/get"},
					}, nil
				},
				permission: func(_ context.Context, _ authorization.Principal, path, _ string) error {
					paths = append(paths, path)
					return nil
				},
			}
			service := &serviceStub{}
			router := newBOBTestRouter(service, authorizer)
			request := httptest.NewRequest(http.MethodPost, "/bob/other-unit/create", strings.NewReader(test.body))
			request.Header.Set("Content-Type", "application/json")
			recorder := httptest.NewRecorder()

			router.ServeHTTP(recorder, request)

			if recorder.Code != http.StatusOK {
				t.Fatalf("status = %d, body = %s", recorder.Code, recorder.Body.String())
			}
			if len(paths) != 3 || paths[0] != "/bob/other-unit/create" || paths[1] != "/bob/other-unit/create" || paths[2] != test.partyPathWant {
				t.Fatalf("authorization paths = %v", paths)
			}
		})
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

func TestHandlerRejectsLegacySalespersonField(t *testing.T) {
	service := &serviceStub{}
	authorizer := authorization.Func(func(
		_ context.Context, _ *http.Request, _, _ string,
	) (authorization.Principal, error) {
		return authorization.Principal{ActorID: "01J00000000000000000000000"}, nil
	})
	router := newBOBTestRouter(service, authorizer)
	request := httptest.NewRequest(
		http.MethodPost,
		"/bob/customer/create",
		strings.NewReader(`{"data":{"name":"Customer","salespersonId":"01J00000000000000000000010"}}`),
	)
	request.Header.Set("Content-Type", "application/json")
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, request)

	var envelope response.Envelope
	if err := json.Unmarshal(recorder.Body.Bytes(), &envelope); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if envelope.Code != response.CodeValidation {
		t.Fatalf("code = %d, want %d", envelope.Code, response.CodeValidation)
	}
	if len(service.actions) != 0 {
		t.Fatalf("service calls = %v", service.actions)
	}
}

func TestHandlerRejectsClientSuppliedCode(t *testing.T) {
	service := &serviceStub{}
	authorizer := authorization.Func(func(
		_ context.Context, _ *http.Request, _, _ string,
	) (authorization.Principal, error) {
		return authorization.Principal{ActorID: "01J00000000000000000000000"}, nil
	})
	router := newBOBTestRouter(service, authorizer)
	request := httptest.NewRequest(
		http.MethodPost,
		"/bob/customer/create",
		strings.NewReader(`{"data":{"code":"CUS-9999","name":"Customer"}}`),
	)
	request.Header.Set("Content-Type", "application/json")
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, request)

	var envelope response.Envelope
	if err := json.Unmarshal(recorder.Body.Bytes(), &envelope); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if envelope.Code != response.CodeValidation {
		t.Fatalf("code = %d, want %d", envelope.Code, response.CodeValidation)
	}
	if len(service.actions) != 0 {
		t.Fatalf("service calls = %v", service.actions)
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

func TestDeleteAuthorizationFailuresDoNotCallService(t *testing.T) {
	tests := []struct {
		name string
		err  error
		code int
	}{
		{
			name: "session expired",
			err:  authorization.NewError(authorization.ErrorUnauthenticated, "session expired", nil),
			code: response.CodeUnauthenticated,
		},
		{
			name: "permission denied",
			err:  authorization.NewError(authorization.ErrorForbidden, "permission denied", nil),
			code: response.CodeForbidden,
		},
		{
			name: "csrf rejected",
			err:  authorization.NewError(authorization.ErrorForbidden, "csrf validation failed", nil),
			code: response.CodeForbidden,
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			service := &serviceStub{}
			authorizer := authorization.Func(func(_ context.Context, _ *http.Request, _, _ string) (authorization.Principal, error) {
				return authorization.Principal{}, test.err
			})
			router := newBOBTestRouter(service, authorizer)
			request := httptest.NewRequest(
				http.MethodPost,
				"/bob/customer/delete",
				strings.NewReader(`{"objectId":"01J00000000000000000000010","objectRevision":1,"approvalEntryId":"01J00000000000000000000011","approvalRevision":1}`),
			)
			request.Header.Set("Content-Type", "application/json")
			recorder := httptest.NewRecorder()
			router.ServeHTTP(recorder, request)

			var envelope response.Envelope
			if err := json.Unmarshal(recorder.Body.Bytes(), &envelope); err != nil {
				t.Fatalf("decode response: %v", err)
			}
			if envelope.Code != test.code {
				t.Fatalf("code = %d, want %d", envelope.Code, test.code)
			}
			if len(service.actions) != 0 {
				t.Fatalf("service calls = %v", service.actions)
			}
		})
	}
}

func TestDeleteRejectsUnknownJSONFields(t *testing.T) {
	service := &serviceStub{}
	authorizer := authorization.Func(func(_ context.Context, _ *http.Request, _, _ string) (authorization.Principal, error) {
		return authorization.Principal{ActorID: "01J00000000000000000000000"}, nil
	})
	router := newBOBTestRouter(service, authorizer)
	request := httptest.NewRequest(
		http.MethodPost,
		"/bob/customer/delete",
		strings.NewReader(`{"objectId":"01J00000000000000000000010","objectRevision":1,"approvalEntryId":"01J00000000000000000000011","approvalRevision":1,"unknown":true}`),
	)
	request.Header.Set("Content-Type", "application/json")
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, request)

	var envelope response.Envelope
	if err := json.Unmarshal(recorder.Body.Bytes(), &envelope); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if envelope.Code != response.CodeValidation {
		t.Fatalf("code = %d, want %d", envelope.Code, response.CodeValidation)
	}
	if len(service.actions) != 0 {
		t.Fatalf("service calls = %v", service.actions)
	}
}

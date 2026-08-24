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

func (s *serviceStub) Create(_ context.Context, entity string, _ CreateInput, _, _ string) (MutationResult, error) {
	s.record("create", entity)
	return MutationResult{}, nil
}

func (s *serviceStub) Unsubmit(_ context.Context, entity string, _ ReverseInput, _, _ string) (MutationResult, error) {
	s.record("unsubmit", entity)
	return MutationResult{}, nil
}

func (s *serviceStub) Save(_ context.Context, entity string, _ SaveInput, _, _ string) (MutationResult, error) {
	s.record("save", entity)
	return MutationResult{}, nil
}

func (s *serviceStub) Delete(_ context.Context, entity string, _ DeleteInput) error {
	s.record("delete", entity)
	return nil
}

func (s *serviceStub) Submit(_ context.Context, entity string, _ VersionRevisionInput, _, _ string) (MutationResult, error) {
	s.record("submit", entity)
	return MutationResult{}, nil
}

func (s *serviceStub) Approve(_ context.Context, entity string, _ ReviewInput, _, _ string) (MutationResult, error) {
	s.record("approve", entity)
	return MutationResult{}, nil
}

func (s *serviceStub) Unapprove(_ context.Context, entity string, _ ReverseInput, _, _ string) (MutationResult, error) {
	s.record("unapprove", entity)
	return MutationResult{}, nil
}

func (s *serviceStub) Reject(_ context.Context, entity string, _ ReviewInput, _, _ string) (MutationResult, error) {
	s.record("reject", entity)
	return MutationResult{}, nil
}

func (s *serviceStub) Enable(_ context.Context, entity string, _ ObjectRevisionInput, _, _ string) (MutationResult, error) {
	s.record("enable", entity)
	return MutationResult{}, nil
}

func (s *serviceStub) Disable(_ context.Context, entity string, _ ObjectRevisionInput, _, _ string) (MutationResult, error) {
	s.record("disable", entity)
	return MutationResult{}, nil
}

func (s *serviceStub) WarehouseDisablePrecheck(_ context.Context, _ WarehouseDisablePrecheckInput) (WarehouseDisablePrecheckResult, error) {
	s.record("disable-precheck", EntityWarehouse)
	return WarehouseDisablePrecheckResult{}, nil
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

func (s *serviceStub) CustomerCreate(_ context.Context, _ CustomerCreateInput, _, _ string, _ bool) (CustomerCreateResult, error) {
	s.record("create", EntityCustomer)
	return CustomerCreateResult{}, nil
}

func (s *serviceStub) CustomerAccountAdd(_ context.Context, _ CustomerAccountAddInput, _, _ string) (CustomerAccountView, error) {
	return CustomerAccountView{}, nil
}

func (s *serviceStub) CustomerAccountDelete(_ context.Context, _ DeleteInput) error { return nil }

func (s *serviceStub) CustomerSave(_ context.Context, _ CustomerSaveInput, _, _ string) (MutationResult, error) {
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

func (s *serviceStub) SupplierCreate(_ context.Context, _ SupplierCreateInput, _, _ string, _ bool) (SupplierCreateResult, error) {
	s.record("create", EntitySupplier)
	return SupplierCreateResult{}, nil
}

func (s *serviceStub) SupplierSave(_ context.Context, _ SupplierSaveInput, _, _ string) (MutationResult, error) {
	s.record("save", EntitySupplier)
	return MutationResult{}, nil
}

func (s *serviceStub) EmploymentCreate(_ context.Context, _ EmploymentCreateInput, _, _ string, _ bool) (EmploymentCreateResult, error) {
	s.record("create", EntityEmployee)
	return EmploymentCreateResult{}, nil
}

func (s *serviceStub) SalesPartnerQuery(_ context.Context, input QueryInput) (Page[SalesPartnerListItem], error) {
	s.record("query", EntitySalesPartner)
	return Page[SalesPartnerListItem]{Items: []SalesPartnerListItem{}, Page: input.Page, PageSize: input.PageSize}, nil
}

func (s *serviceStub) SalesPartnerGet(_ context.Context, _ GetInput) (SalesPartnerDetailView, error) {
	s.record("get", EntitySalesPartner)
	return SalesPartnerDetailView{}, nil
}

func (s *serviceStub) SalesPartnerCreate(_ context.Context, _ SalesPartnerCreateInput, _, _ string, _ bool) (SalesPartnerCreateResult, error) {
	s.record("create", EntitySalesPartner)
	return SalesPartnerCreateResult{}, nil
}

func (s *serviceStub) SalesPartnerSave(_ context.Context, _ SalesPartnerSaveInput, _, _ string) (MutationResult, error) {
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

func (s *serviceStub) PartySave(_ context.Context, _ PartySaveInput, _, _ string) (PartyView, error) {
	s.record("save", "party")
	return PartyView{}, nil
}

func (s *serviceStub) PartyMergePreflight(_ context.Context, _ PartyMergePreflightInput, _ PartyRelationshipVisibility, _, _ string) (PartyMergePreflightResult, error) {
	s.record("merge-preflight", "party")
	return PartyMergePreflightResult{}, nil
}

func (s *serviceStub) PartyMergeConfirm(_ context.Context, _ PartyMergeConfirmInput, _ PartyRelationshipVisibility, _, _ string) (PartyMergeResult, error) {
	s.record("merge-confirm", "party")
	return PartyMergeResult{}, nil
}

func (s *serviceStub) OtherUnitQuery(_ context.Context, input QueryInput) (Page[OtherUnitView], error) {
	s.record("query", EntityOtherUnit)
	return Page[OtherUnitView]{Items: []OtherUnitView{}, Page: input.Page, PageSize: input.PageSize}, nil
}

func (s *serviceStub) OtherUnitGet(_ context.Context, _ GetInput) (OtherUnitView, error) {
	s.record("get", EntityOtherUnit)
	return OtherUnitView{}, nil
}

func (s *serviceStub) OtherUnitCreate(_ context.Context, _ OtherUnitCreateInput, _, _ string, _ bool) (OtherUnitCreateResult, error) {
	s.record("create", EntityOtherUnit)
	return OtherUnitCreateResult{}, nil
}

func (s *serviceStub) OtherUnitSave(_ context.Context, _ OtherUnitSaveInput, _, _ string) (MutationResult, error) {
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

func TestHandlerRegistersEveryEntityAction(t *testing.T) {
	router := newBOBTestRouter(&serviceStub{}, authorization.FailClosed{})
	routes := router.Routes()
	expectedEntities := []string{
		"customer", "supplier", "employee", "sales-partner", "product", "warehouse",
		"vehicle", "fund-account", "operating-entity",
	}
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
	for _, path := range []string{
		"/bob/warehouse/disable-precheck",
		"/bob/party/query", "/bob/party/get", "/bob/party/save",
		"/bob/other-unit/query", "/bob/other-unit/get", "/bob/other-unit/create", "/bob/other-unit/save",
		"/bob/other-unit/delete", "/bob/other-unit/submit", "/bob/other-unit/unsubmit",
		"/bob/other-unit/approve", "/bob/other-unit/reject", "/bob/other-unit/enable",
		"/bob/other-unit/disable", "/bob/other-unit/versions", "/bob/other-unit/audit-history",
		"/bob/customer-account/submit", "/bob/customer-account/unsubmit",
		"/bob/customer-account/approve", "/bob/customer-account/reject",
		"/bob/customer-account/enable", "/bob/customer-account/disable",
		"/bob/customer-account/versions", "/bob/customer-account/audit-history",
	} {
		wanted[path] = false
	}
	for _, route := range routes {
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
			partyPathWant: "/bob/party/create",
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
			authorizer := authorization.Func(func(_ context.Context, _ *http.Request, path, _ string) (authorization.Principal, error) {
				paths = append(paths, path)
				return authorization.Principal{
					ActorID:     "01J00000000000000000000000",
					Permissions: []string{"/bob/party/get", "/bob/other-unit/get"},
				}, nil
			})
			service := &serviceStub{}
			router := newBOBTestRouter(service, authorizer)
			request := httptest.NewRequest(http.MethodPost, "/bob/other-unit/create", strings.NewReader(test.body))
			request.Header.Set("Content-Type", "application/json")
			recorder := httptest.NewRecorder()

			router.ServeHTTP(recorder, request)

			if recorder.Code != http.StatusOK {
				t.Fatalf("status = %d, body = %s", recorder.Code, recorder.Body.String())
			}
			if len(paths) != 2 || paths[0] != "/bob/other-unit/create" || paths[1] != test.partyPathWant {
				t.Fatalf("authorization paths = %v", paths)
			}
		})
	}
}

func TestHandlerDispatchesEveryAction(t *testing.T) {
	const objectID = "01J00000000000000000000010"
	const versionID = "01J00000000000000000000011"
	tests := []struct {
		action string
		body   string
	}{
		{"query", `{"page":1,"pageSize":20,"filters":{},"sort":[]}`},
		{"get", `{"objectId":"` + objectID + `"}`},
		{"create", `{"data":{"name":"Customer"}}`},
		{"save", `{"objectId":"` + objectID + `","versionId":"` + versionID + `","revision":1,"data":{"name":"Customer"}}`},
		{"delete", `{"objectId":"` + objectID + `","objectRevision":1,"versionId":"` + versionID + `","revision":1}`},
		{"submit", `{"objectId":"` + objectID + `","versionId":"` + versionID + `","revision":1}`},
		{"unsubmit", `{"objectId":"` + objectID + `","objectRevision":1,"versionId":"` + versionID + `","revision":1,"reason":"fix"}`},
		{"approve", `{"objectId":"` + objectID + `","versionId":"` + versionID + `","revision":1}`},
		{"unapprove", `{"objectId":"` + objectID + `","objectRevision":1,"versionId":"` + versionID + `","revision":1,"reason":"fix"}`},
		{"reject", `{"objectId":"` + objectID + `","versionId":"` + versionID + `","revision":1,"comment":"fix"}`},
		{"enable", `{"objectId":"` + objectID + `","objectRevision":1}`},
		{"disable", `{"objectId":"` + objectID + `","objectRevision":1}`},
		{"versions", `{"objectId":"` + objectID + `","page":1,"pageSize":20}`},
		{"audit-history", `{"objectId":"` + objectID + `","page":1,"pageSize":20}`},
	}
	authorizer := authorization.Func(func(_ context.Context, _ *http.Request, _, _ string) (authorization.Principal, error) {
		return authorization.Principal{ActorID: "01J00000000000000000000000"}, nil
	})
	for _, test := range tests {
		t.Run(test.action, func(t *testing.T) {
			service := &serviceStub{}
			router := newBOBTestRouter(service, authorizer)
			request := httptest.NewRequest(http.MethodPost, "/bob/customer/"+test.action, strings.NewReader(test.body))
			request.Header.Set("Content-Type", "application/json")
			recorder := httptest.NewRecorder()
			router.ServeHTTP(recorder, request)

			if recorder.Code != http.StatusOK {
				t.Fatalf("status = %d, want %d", recorder.Code, http.StatusOK)
			}
			if len(service.actions) != 1 || service.actions[0] != test.action || service.entity != EntityCustomer {
				t.Fatalf("calls = %v, entity = %q", service.actions, service.entity)
			}
			if test.action == "delete" {
				var envelope response.Envelope
				if err := json.Unmarshal(recorder.Body.Bytes(), &envelope); err != nil {
					t.Fatalf("decode delete response: %v", err)
				}
				if envelope.Code != response.CodeOK || envelope.Data != nil {
					t.Fatalf("delete envelope = %+v, want data null", envelope)
				}
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
		"/bob/vehicle/delete",
		strings.NewReader(`{"objectId":"01J00000000000000000000010","objectRevision":1,"versionId":"01J00000000000000000000011","revision":1}`),
	)
	request.Header.Set("Content-Type", "application/json")
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", recorder.Code, http.StatusOK)
	}
	if permission != "/bob/vehicle/delete" {
		t.Fatalf("permission = %q", permission)
	}
	if len(service.actions) != 1 || service.actions[0] != "delete" || service.entity != EntityVehicle {
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
				strings.NewReader(`{"objectId":"01J00000000000000000000010","objectRevision":1,"versionId":"01J00000000000000000000011","revision":1}`),
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
		strings.NewReader(`{"objectId":"01J00000000000000000000010","objectRevision":1,"versionId":"01J00000000000000000000011","revision":1,"unknown":true}`),
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

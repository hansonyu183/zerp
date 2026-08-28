package app

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/hansonyu183/zerp/backend/internal/api/authorization"
	"github.com/hansonyu183/zerp/backend/internal/api/middleware"
	"github.com/hansonyu183/zerp/backend/internal/api/response"
	"github.com/hansonyu183/zerp/backend/internal/config"
)

type handlerServiceStub struct {
	applicationService
	signinCalls           int
	signinResult          SessionResult
	restoreResult         SessionResult
	restoredPrincipal     Principal
	authorizeResult       Principal
	authorizeError        error
	authorizedPath        string
	sessionAuthorizedPath string
	profileResult         ProfileView
	savedProfile          SaveProfileInput
	savedProfileUserID    string
	changedPassword       ChangePasswordInput
	resetPassword         ResetPasswordInput
	resetPasswordResult   ResetPasswordResult
	queryUsersResult      Page[UserListItem]
	workbenchInput        WorkbenchQueryInput
}

func (stub *handlerServiceStub) Signin(context.Context, string, string, string) (SessionResult, error) {
	stub.signinCalls++
	return stub.signinResult, nil
}

func (stub *handlerServiceStub) RestoreSession(_ context.Context, principal Principal) (SessionResult, error) {
	stub.restoredPrincipal = principal
	return stub.restoreResult, nil
}

type handlerAuthorizer struct{ stub *handlerServiceStub }

func (a handlerAuthorizer) AuthenticateSession(_ context.Context, _ *http.Request, path, _ string) (authorization.Principal, error) {
	a.stub.sessionAuthorizedPath = path
	if errorIsKind(a.stub.authorizeError, ErrorUnauthenticated) ||
		(errorIsKind(a.stub.authorizeError, ErrorForbidden) && (path == "/app/user/profile" || path == changePasswordPath || path == signoutPath)) {
		return authorization.Principal{}, a.stub.authorizeError
	}
	principal := a.stub.authorizeResult
	if principal.User.ID == "" {
		principal.User.ID = "actor-1"
	}
	return authorization.Principal{
		SessionID: principal.SessionID, ActorID: principal.User.ID,
		Username: principal.User.Username, DisplayName: principal.User.DisplayName, AvatarURL: principal.User.AvatarURL,
		CSRFHash: principal.CSRFHash, Permissions: principal.Permissions,
		PasswordChangeRequired: principal.PasswordChangeRequired,
		IdleExpires:            principal.IdleExpires, AbsoluteEnds: principal.AbsoluteEnds,
	}, nil
}

func (a handlerAuthorizer) RequirePermission(_ context.Context, _ authorization.Principal, path, _ string) error {
	a.stub.authorizedPath = path
	return a.stub.authorizeError
}

func (handlerAuthorizer) ClearSessionCookie(http.ResponseWriter) {}

func (stub *handlerServiceStub) QueryUsers(context.Context, PageRequest, Principal) (Page[UserListItem], error) {
	if stub.queryUsersResult.Items != nil {
		return stub.queryUsersResult, nil
	}
	return Page[UserListItem]{Items: []UserListItem{}, Page: 1, PageSize: 20}, nil
}

func (stub *handlerServiceStub) ResetUserPassword(_ context.Context, input ResetPasswordInput, _ Principal, _ string) (ResetPasswordResult, error) {
	stub.resetPassword = input
	return stub.resetPasswordResult, nil
}

func (stub *handlerServiceStub) QueryWorkbench(
	_ context.Context,
	_ Principal,
	input WorkbenchQueryInput,
) (Page[WorkbenchItem], error) {
	stub.workbenchInput = input
	return Page[WorkbenchItem]{Items: []WorkbenchItem{}, Page: 1, PageSize: 20}, nil
}

func (stub *handlerServiceStub) GetMenu(context.Context, Principal) (MenuGetData, error) {
	return MenuGetData{
		Mode: MenuModeDefault, Revision: 1,
		DefaultMenu:     MenuTree{Items: []MenuItemView{}},
		BusinessMenu:    MenuTree{Items: []MenuItemView{}},
		Navigation:      MenuTree{Items: []MenuItemView{}},
		AvailableRoutes: []MenuRouteOption{},
	}, nil
}

func (stub *handlerServiceStub) GetProfile(context.Context, string) (ProfileView, error) {
	return stub.profileResult, nil
}

func (stub *handlerServiceStub) SaveProfile(
	_ context.Context,
	userID string,
	input SaveProfileInput,
	_ string,
) (ProfileView, error) {
	stub.savedProfileUserID = userID
	stub.savedProfile = input
	return stub.profileResult, nil
}

func (stub *handlerServiceStub) ChangePassword(_ context.Context, _ Principal, input ChangePasswordInput, _ string) error {
	stub.changedPassword = input
	return nil
}

func testRouter(stub *handlerServiceStub) *gin.Engine {
	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.Use(middleware.RequestID())
	NewHandler(stub, handlerAuthorizer{stub: stub}, config.Config{SessionCookieName: "zerp_session", SessionCookieSecure: true}, slog.New(slog.NewTextHandler(io.Discard, nil))).Register(router)
	return router
}

func TestHandlerRegistersCompleteAPIRouteSet(t *testing.T) {
	router := testRouter(&handlerServiceStub{})
	expected := []string{
		"/app/user/signin", "/app/user/session", "/app/user/signout",
		"/app/user/profile", "/app/user/change-password", "/app/user/query",
		"/app/user/get", "/app/user/create", "/app/user/save", "/app/user/enable", "/app/user/disable", "/app/user/reset-password",
		"/app/role/query", "/app/role/get", "/app/role/create", "/app/role/save", "/app/role/enable", "/app/role/disable",
		"/app/permission/query", "/app/permission/get",
		"/app/system-parameter/query", "/app/system-parameter/get",
		"/app/system-parameter/save", "/app/system-parameter/reset",
		"/app/menu/get", "/app/menu/save-business",
		"/app/menu/activate", "/app/menu/reset-business",
		"/app/workbench/query",
	}
	found := make(map[string]bool, len(expected))
	for _, path := range expected {
		found[path] = false
	}
	for _, route := range router.Routes() {
		if route.Method == http.MethodPost {
			if _, exists := found[route.Path]; exists {
				found[route.Path] = true
			}
		}
	}
	for path, registered := range found {
		if !registered {
			t.Errorf("route %s is not registered", path)
		}
	}
	if len(router.Routes()) != len(expected) {
		t.Fatalf("route count = %d, want %d", len(router.Routes()), len(expected))
	}
}

func TestWorkbenchUsesSessionAuthorizationAndCurrentPermissions(t *testing.T) {
	stub := &handlerServiceStub{authorizeResult: Principal{
		User:        UserSummary{ID: "user-1"},
		Permissions: []string{"/dcl/customer/query", "/dcl/customer/submit"},
	}}
	request := httptest.NewRequest(
		http.MethodPost,
		"/app/workbench/query",
		strings.NewReader(`{"category":"BOB","entities":["customer"],"pendingStages":["APPROVE"],"page":1,"pageSize":20}`),
	)
	request.Header.Set("Content-Type", "application/json")
	request.AddCookie(&http.Cookie{Name: "zerp_session", Value: "token"})
	responseRecorder := httptest.NewRecorder()

	testRouter(stub).ServeHTTP(responseRecorder, request)

	if responseRecorder.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", responseRecorder.Code, responseRecorder.Body.String())
	}
	if stub.sessionAuthorizedPath != "/app/workbench/query" || stub.authorizedPath != "" {
		t.Fatalf("authorization paths: session=%q permission=%q", stub.sessionAuthorizedPath, stub.authorizedPath)
	}
	if stub.workbenchInput.Category != WorkbenchCategoryBob {
		t.Fatalf("workbench category = %q", stub.workbenchInput.Category)
	}
	if len(stub.workbenchInput.Entities) != 1 || stub.workbenchInput.Entities[0] != "customer" ||
		len(stub.workbenchInput.PendingStages) != 1 || stub.workbenchInput.PendingStages[0] != "APPROVE" {
		t.Fatalf("workbench filters = entities %v, stages %v", stub.workbenchInput.Entities, stub.workbenchInput.PendingStages)
	}
}

func TestMenuReadUsesSessionAuthorizationWithoutPathPermission(t *testing.T) {
	stub := &handlerServiceStub{authorizeResult: Principal{User: UserSummary{ID: "user-1"}}}
	request := httptest.NewRequest(http.MethodPost, "/app/menu/get", strings.NewReader(`{}`))
	request.Header.Set("Content-Type", "application/json")
	request.AddCookie(&http.Cookie{Name: "zerp_session", Value: "session"})
	recorder := httptest.NewRecorder()
	testRouter(stub).ServeHTTP(recorder, request)

	if stub.sessionAuthorizedPath != "/app/menu/get" || stub.authorizedPath != "" {
		t.Fatalf("authorization paths: session=%q permission=%q", stub.sessionAuthorizedPath, stub.authorizedPath)
	}
	var envelope response.Envelope
	if err := json.Unmarshal(recorder.Body.Bytes(), &envelope); err != nil {
		t.Fatalf("decode envelope: %v", err)
	}
	if envelope.Code != response.CodeOK {
		t.Fatalf("code = %d, want 0", envelope.Code)
	}
}

func TestSigninSetsHardenedCookieAndEnvelope(t *testing.T) {
	stub := &handlerServiceStub{signinResult: SessionResult{
		Data:         SessionData{User: UserSummary{ID: "user-1", Username: "alice", DisplayName: "Alice"}, CSRFToken: "csrf", Permissions: []string{}},
		SessionToken: "session-token", ExpiresAt: time.Now().Add(time.Hour),
	}}
	request := httptest.NewRequest(http.MethodPost, "/app/user/signin", strings.NewReader(`{"username":"alice","password":"Strong-password-1!"}`))
	request.Header.Set("Content-Type", "application/json")
	recorder := httptest.NewRecorder()
	testRouter(stub).ServeHTTP(recorder, request)

	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", recorder.Code)
	}
	cookies := recorder.Result().Cookies()
	if len(cookies) != 1 || !cookies[0].HttpOnly || !cookies[0].Secure || cookies[0].SameSite != http.SameSiteLaxMode || cookies[0].Path != "/" {
		t.Fatalf("cookie = %#v, want HttpOnly Secure SameSite=Lax Path=/", cookies)
	}
	var envelope response.Envelope
	if err := json.Unmarshal(recorder.Body.Bytes(), &envelope); err != nil {
		t.Fatalf("decode envelope: %v", err)
	}
	if envelope.Code != response.CodeOK || envelope.RequestID == "" {
		t.Fatalf("envelope = %#v", envelope)
	}
}

func TestSessionRestoreUsesAuthenticatedPrincipalWithoutPermissionCheck(t *testing.T) {
	stub := &handlerServiceStub{
		authorizeResult: Principal{SessionID: "session-1", User: UserSummary{ID: "user-1"}},
		restoreResult:   SessionResult{Data: SessionData{User: UserSummary{ID: "user-1"}, CSRFToken: "new-csrf"}},
	}
	request := httptest.NewRequest(http.MethodPost, "/app/user/session", strings.NewReader(`{}`))
	request.Header.Set("Content-Type", "application/json")
	request.AddCookie(&http.Cookie{Name: "zerp_session", Value: "session"})
	recorder := httptest.NewRecorder()
	testRouter(stub).ServeHTTP(recorder, request)
	if recorder.Code != http.StatusOK || stub.sessionAuthorizedPath != "/app/user/session" || stub.authorizedPath != "" ||
		stub.restoredPrincipal.SessionID != "session-1" || stub.restoredPrincipal.User.ID != "user-1" {
		t.Fatalf("status=%d sessionPath=%q permissionPath=%q principal=%+v body=%s", recorder.Code, stub.sessionAuthorizedPath, stub.authorizedPath, stub.restoredPrincipal, recorder.Body.String())
	}
}

func TestProtectedRouteAuthorizesExactPath(t *testing.T) {
	stub := &handlerServiceStub{authorizeResult: Principal{User: UserSummary{ID: "user-1"}}}
	request := httptest.NewRequest(http.MethodPost, "/app/user/query", strings.NewReader(`{"page":1,"pageSize":20}`))
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("X-CSRF-Token", "csrf")
	request.AddCookie(&http.Cookie{Name: "zerp_session", Value: "session"})
	recorder := httptest.NewRecorder()
	testRouter(stub).ServeHTTP(recorder, request)

	if stub.authorizedPath != "/app/user/query" {
		t.Fatalf("authorized path = %q", stub.authorizedPath)
	}
	var envelope response.Envelope
	if err := json.Unmarshal(recorder.Body.Bytes(), &envelope); err != nil {
		t.Fatalf("decode envelope: %v", err)
	}
	if envelope.Code != response.CodeOK {
		t.Fatalf("code = %d, want 0", envelope.Code)
	}
}

func TestUserQueryReturnsOnlyListContractFields(t *testing.T) {
	stub := &handlerServiceStub{queryUsersResult: Page[UserListItem]{
		Items: []UserListItem{{ID: "user-1", Username: "alice", DisplayName: "Alice", Status: StatusEnabled, System: false,
			Revision: 3, Manageable: true}},
		Page: 1, PageSize: 20, Total: 1,
	}}
	request := httptest.NewRequest(http.MethodPost, "/app/user/query", strings.NewReader(`{"page":1,"pageSize":20,"sort":[{"field":"username","order":"asc"}]}`))
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("X-CSRF-Token", "csrf")
	request.AddCookie(&http.Cookie{Name: "zerp_session", Value: "session"})
	recorder := httptest.NewRecorder()
	testRouter(stub).ServeHTTP(recorder, request)
	if strings.Contains(recorder.Body.String(), "failedSigninCount") || strings.Contains(recorder.Body.String(), "roleIds") || strings.Contains(recorder.Body.String(), "passwordChangedAt") {
		t.Fatalf("sensitive/non-list fields leaked: %s", recorder.Body.String())
	}
}

func TestResetPasswordUsesExactPathAndReturnsOnlyTemporaryResult(t *testing.T) {
	stub := &handlerServiceStub{authorizeResult: Principal{User: UserSummary{ID: "actor-1"}}, resetPasswordResult: ResetPasswordResult{TemporaryPassword: "temporary"}}
	request := httptest.NewRequest(http.MethodPost, "/app/user/reset-password", strings.NewReader(`{"id":"01J00000000000000000000000","revision":2}`))
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("X-CSRF-Token", "csrf")
	request.AddCookie(&http.Cookie{Name: "zerp_session", Value: "session"})
	recorder := httptest.NewRecorder()
	testRouter(stub).ServeHTTP(recorder, request)
	if stub.authorizedPath != "/app/user/reset-password" || stub.resetPassword.Revision != 2 || !strings.Contains(recorder.Body.String(), "temporaryPassword") {
		t.Fatalf("reset dispatch path=%q input=%+v body=%s", stub.authorizedPath, stub.resetPassword, recorder.Body.String())
	}
}

func TestProtectedRouteDistinguishesAuthenticationAndPermissionErrors(t *testing.T) {
	for _, test := range []struct {
		name string
		err  error
		code int
	}{
		{name: "unauthenticated", err: domainError(ErrorUnauthenticated, "session expired", nil), code: response.CodeUnauthenticated},
		{name: "forbidden", err: domainError(ErrorForbidden, "permission denied", nil), code: response.CodeForbidden},
	} {
		t.Run(test.name, func(t *testing.T) {
			stub := &handlerServiceStub{authorizeError: test.err}
			request := httptest.NewRequest(http.MethodPost, "/app/user/query", strings.NewReader(`{}`))
			request.Header.Set("Content-Type", "application/json")
			recorder := httptest.NewRecorder()
			testRouter(stub).ServeHTTP(recorder, request)
			var envelope response.Envelope
			if err := json.Unmarshal(recorder.Body.Bytes(), &envelope); err != nil {
				t.Fatalf("decode envelope: %v", err)
			}
			if envelope.Code != test.code {
				t.Fatalf("code = %d, want %d", envelope.Code, test.code)
			}
		})
	}
}

func TestRequestRejectsUnknownFields(t *testing.T) {
	stub := &handlerServiceStub{}
	request := httptest.NewRequest(http.MethodPost, "/app/user/signin", strings.NewReader(`{"username":"alice","password":"secret","unexpected":true}`))
	request.Header.Set("Content-Type", "application/json")
	recorder := httptest.NewRecorder()
	testRouter(stub).ServeHTTP(recorder, request)
	var envelope response.Envelope
	if err := json.Unmarshal(recorder.Body.Bytes(), &envelope); err != nil {
		t.Fatalf("decode envelope: %v", err)
	}
	if envelope.Code != response.CodeValidation {
		t.Fatalf("code = %d, want %d", envelope.Code, response.CodeValidation)
	}
}

func TestSigninDelegatesEveryValidRequestToThePersistentLoginPolicy(t *testing.T) {
	stub := &handlerServiceStub{signinResult: SessionResult{
		Data: SessionData{CSRFToken: "csrf"}, SessionToken: "session", ExpiresAt: time.Now().Add(time.Hour),
	}}
	router := testRouter(stub)
	for attempt := 0; attempt < 31; attempt++ {
		request := httptest.NewRequest(http.MethodPost, "/app/user/signin", strings.NewReader(`{"username":"alice","password":"Strong-password-1!"}`))
		request.Header.Set("Content-Type", "application/json")
		recorder := httptest.NewRecorder()
		router.ServeHTTP(recorder, request)
	}
	if stub.signinCalls != 31 {
		t.Fatalf("persistent signin calls = %d, want 31", stub.signinCalls)
	}
}

func TestProfileUsesCurrentSessionPrincipal(t *testing.T) {
	stub := &handlerServiceStub{
		authorizeResult: Principal{User: UserSummary{ID: "user-1"}},
		profileResult:   ProfileView{ID: "user-1", Username: "alice", DisplayName: "Alice"},
	}
	request := httptest.NewRequest(http.MethodPost, "/app/user/profile", strings.NewReader(`{}`))
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("X-CSRF-Token", "csrf")
	request.AddCookie(&http.Cookie{Name: "zerp_session", Value: "session"})
	recorder := httptest.NewRecorder()
	testRouter(stub).ServeHTTP(recorder, request)

	if stub.sessionAuthorizedPath != "/app/user/profile" || stub.authorizedPath != "" {
		t.Fatalf("authorization paths: session=%q permission=%q", stub.sessionAuthorizedPath, stub.authorizedPath)
	}
	var envelope response.Envelope
	if err := json.Unmarshal(recorder.Body.Bytes(), &envelope); err != nil {
		t.Fatalf("decode envelope: %v", err)
	}
	if envelope.Code != response.CodeOK {
		t.Fatalf("code = %d, want 0", envelope.Code)
	}
}

func TestProfileSaveUsesCurrentSessionPrincipal(t *testing.T) {
	avatarURL := "https://images.example.com/alice.png"
	stub := &handlerServiceStub{
		authorizeResult: Principal{User: UserSummary{ID: "user-1"}},
		profileResult: ProfileView{
			ID: "user-1", Username: "alice", DisplayName: "新名称", AvatarURL: &avatarURL,
		},
	}
	request := httptest.NewRequest(
		http.MethodPost,
		"/app/user/profile",
		strings.NewReader(`{"displayName":"新名称","avatarUrl":"https://images.example.com/alice.png"}`),
	)
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("X-CSRF-Token", "csrf")
	request.AddCookie(&http.Cookie{Name: "zerp_session", Value: "session"})
	recorder := httptest.NewRecorder()
	testRouter(stub).ServeHTTP(recorder, request)

	if stub.sessionAuthorizedPath != "/app/user/profile" || stub.authorizedPath != "" || stub.savedProfileUserID != "user-1" ||
		stub.savedProfile.DisplayName != "新名称" || stub.savedProfile.AvatarURL == nil ||
		*stub.savedProfile.AvatarURL != avatarURL {
		t.Fatalf(
			"profile save dispatch path=%q user=%q input=%#v",
			stub.sessionAuthorizedPath, stub.savedProfileUserID, stub.savedProfile,
		)
	}
	var envelope response.Envelope
	if err := json.Unmarshal(recorder.Body.Bytes(), &envelope); err != nil {
		t.Fatalf("decode envelope: %v", err)
	}
	if envelope.Code != response.CodeOK {
		t.Fatalf("code = %d, want 0", envelope.Code)
	}
}

func TestProfileSaveRejectsInvalidShapes(t *testing.T) {
	for _, body := range []string{
		`{"displayName":null}`,
		`{"avatarUrl":"https://images.example.com/alice.png"}`,
		`{"displayName":"Alice","revision":1}`,
	} {
		t.Run(body, func(t *testing.T) {
			stub := &handlerServiceStub{
				authorizeResult: Principal{User: UserSummary{ID: "user-1"}},
			}
			request := httptest.NewRequest(http.MethodPost, "/app/user/profile", strings.NewReader(body))
			request.Header.Set("Content-Type", "application/json")
			request.Header.Set("X-CSRF-Token", "csrf")
			request.AddCookie(&http.Cookie{Name: "zerp_session", Value: "session"})
			recorder := httptest.NewRecorder()
			testRouter(stub).ServeHTTP(recorder, request)
			var envelope response.Envelope
			if err := json.Unmarshal(recorder.Body.Bytes(), &envelope); err != nil {
				t.Fatalf("decode envelope: %v", err)
			}
			if envelope.Code != response.CodeValidation || stub.savedProfileUserID != "" {
				t.Fatalf("envelope=%#v savedUser=%q", envelope, stub.savedProfileUserID)
			}
		})
	}
}

func TestProfileSavePreservesAuthorizationErrors(t *testing.T) {
	for _, test := range []struct {
		name string
		err  error
		code int
	}{
		{
			name: "unauthenticated",
			err:  domainError(ErrorUnauthenticated, "session expired", nil),
			code: response.CodeUnauthenticated,
		},
		{
			name: "csrf or permission forbidden",
			err:  domainError(ErrorForbidden, "permission denied", nil),
			code: response.CodeForbidden,
		},
	} {
		t.Run(test.name, func(t *testing.T) {
			stub := &handlerServiceStub{authorizeError: test.err}
			request := httptest.NewRequest(
				http.MethodPost,
				"/app/user/profile",
				strings.NewReader(`{"displayName":"Alice"}`),
			)
			request.Header.Set("Content-Type", "application/json")
			request.AddCookie(&http.Cookie{Name: "zerp_session", Value: "session"})
			recorder := httptest.NewRecorder()
			testRouter(stub).ServeHTTP(recorder, request)
			var envelope response.Envelope
			if err := json.Unmarshal(recorder.Body.Bytes(), &envelope); err != nil {
				t.Fatalf("decode envelope: %v", err)
			}
			if envelope.Code != test.code || stub.savedProfileUserID != "" {
				t.Fatalf("envelope=%#v savedUser=%q", envelope, stub.savedProfileUserID)
			}
		})
	}
}

func TestChangePasswordClearsSessionCookie(t *testing.T) {
	stub := &handlerServiceStub{authorizeResult: Principal{User: UserSummary{ID: "user-1"}}}
	request := httptest.NewRequest(http.MethodPost, "/app/user/change-password", strings.NewReader(`{"currentPassword":"Current-password-1!","newPassword":"New-password-2!"}`))
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("X-CSRF-Token", "csrf")
	request.AddCookie(&http.Cookie{Name: "zerp_session", Value: "session"})
	recorder := httptest.NewRecorder()
	testRouter(stub).ServeHTTP(recorder, request)

	if stub.sessionAuthorizedPath != "/app/user/change-password" || stub.authorizedPath != "" || stub.changedPassword.NewPassword != "New-password-2!" {
		t.Fatalf("change password was not dispatched correctly: session=%q permission=%q input=%#v", stub.sessionAuthorizedPath, stub.authorizedPath, stub.changedPassword)
	}
	cookies := recorder.Result().Cookies()
	if len(cookies) != 1 || cookies[0].MaxAge >= 0 {
		t.Fatalf("cookies = %#v, want expired session cookie", cookies)
	}
}

func TestSigninSupportsSameSiteNone(t *testing.T) {
	stub := &handlerServiceStub{signinResult: SessionResult{
		Data: SessionData{User: UserSummary{ID: "user-1"}}, SessionToken: "session-token", ExpiresAt: time.Now().Add(time.Hour),
	}}
	router := gin.New()
	router.Use(middleware.RequestID())
	NewHandler(stub, authorization.FailClosed{}, config.Config{SessionCookieName: "zerp_session", SessionCookieSecure: true, SessionCookieSameSite: "none"}, slog.New(slog.NewTextHandler(io.Discard, nil))).Register(router)
	request := httptest.NewRequest(http.MethodPost, "/app/user/signin", strings.NewReader(`{"username":"alice","password":"Strong-password-1!"}`))
	request.Header.Set("Content-Type", "application/json")
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, request)
	cookies := recorder.Result().Cookies()
	if len(cookies) != 1 || cookies[0].SameSite != http.SameSiteNoneMode || !cookies[0].Secure {
		t.Fatalf("cookie = %#v, want Secure SameSite=None", cookies)
	}
}

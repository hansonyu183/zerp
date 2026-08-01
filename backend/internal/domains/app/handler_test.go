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
	"github.com/hansonyu183/zerp/backend/internal/api/middleware"
	"github.com/hansonyu183/zerp/backend/internal/api/response"
	"github.com/hansonyu183/zerp/backend/internal/config"
)

type handlerServiceStub struct {
	applicationService
	signinResult          SessionResult
	authorizeResult       Principal
	authorizeError        error
	authorizedPath        string
	sessionAuthorizedPath string
	profileResult         ProfileView
	savedProfile          SaveProfileInput
	savedProfileUserID    string
	changedPassword       ChangePasswordInput
	createdFeedback       CreateFeedbackInput
	workbenchInput        WorkbenchQueryInput
}

func (stub *handlerServiceStub) AuthorizeSession(_ context.Context, _, _, path, _ string) (Principal, error) {
	stub.sessionAuthorizedPath = path
	return stub.authorizeResult, stub.authorizeError
}

func (stub *handlerServiceStub) Signin(context.Context, string, string, string) (SessionResult, error) {
	return stub.signinResult, nil
}

func (stub *handlerServiceStub) Authorize(_ context.Context, _, _, path, _ string) (Principal, error) {
	stub.authorizedPath = path
	return stub.authorizeResult, stub.authorizeError
}

func (stub *handlerServiceStub) QueryUsers(context.Context, PageRequest) (Page[UserView], error) {
	return Page[UserView]{Items: []UserView{}, Page: 1, PageSize: 20}, nil
}

func (stub *handlerServiceStub) QueryWorkbench(
	_ context.Context,
	_ Principal,
	input WorkbenchQueryInput,
) (Page[WorkbenchItem], error) {
	stub.workbenchInput = input
	return Page[WorkbenchItem]{Items: []WorkbenchItem{}, Page: 1, PageSize: 20}, nil
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

func (stub *handlerServiceStub) CreateFeedback(_ context.Context, input CreateFeedbackInput, _ string) (FeedbackCreatedView, error) {
	stub.createdFeedback = input
	return FeedbackCreatedView{FeedbackID: "01JAPPFEEDBACK00000000000", Status: FeedbackStatusPending}, nil
}

func testRouter(stub *handlerServiceStub) *gin.Engine {
	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.Use(middleware.RequestID())
	NewHandler(stub, config.Config{SessionCookieName: "zerp_session", SessionCookieSecure: true}, slog.New(slog.NewTextHandler(io.Discard, nil))).Register(router)
	return router
}

func TestHandlerRegistersCompleteAPIRouteSet(t *testing.T) {
	router := testRouter(&handlerServiceStub{})
	expected := []string{
		"/app/user/signin", "/app/user/session", "/app/user/signout",
		"/app/user/profile", "/app/user/change-password", "/app/user/query",
		"/app/user/get", "/app/user/create", "/app/user/save", "/app/user/enable", "/app/user/disable",
		"/app/role/query", "/app/role/get", "/app/role/create", "/app/role/save", "/app/role/enable", "/app/role/disable",
		"/app/permission/query", "/app/permission/get",
		"/app/workbench/query",
		"/app/feedback/attachment-initiate", "/app/feedback/attachment-remove",
		"/app/feedback/create", "/app/feedback/get",
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
	uploadRegistered := false
	for _, route := range router.Routes() {
		if route.Method == http.MethodPut && route.Path == "/files/feedback/attachments/upload/:token" {
			uploadRegistered = true
		}
	}
	if !uploadRegistered {
		t.Error("feedback attachment upload route is not registered")
	}
	if len(router.Routes()) != len(expected)+1 {
		t.Fatalf("route count = %d, want %d", len(router.Routes()), len(expected)+1)
	}
}

func TestWorkbenchUsesSessionAuthorizationAndCurrentPermissions(t *testing.T) {
	stub := &handlerServiceStub{authorizeResult: Principal{
		User:        UserSummary{ID: "user-1"},
		Permissions: []string{"/bob/customer/query", "/bob/customer/submit"},
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

func TestFeedbackUsesSessionAuthorizationWithoutPathPermission(t *testing.T) {
	stub := &handlerServiceStub{authorizeResult: Principal{User: UserSummary{ID: "user-1"}}}
	request := httptest.NewRequest(http.MethodPost, "/app/feedback/create", strings.NewReader(
		`{"category":"BUG","title":"页面异常","content":"保存失败"}`,
	))
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("X-CSRF-Token", "csrf")
	request.AddCookie(&http.Cookie{Name: "zerp_session", Value: "session"})
	recorder := httptest.NewRecorder()
	testRouter(stub).ServeHTTP(recorder, request)

	if stub.sessionAuthorizedPath != "/app/feedback/create" {
		t.Fatalf("session authorized path = %q", stub.sessionAuthorizedPath)
	}
	if stub.authorizedPath != "" {
		t.Fatalf("permission authorizer was called for feedback path %q", stub.authorizedPath)
	}
	if stub.createdFeedback.Title != "页面异常" {
		t.Fatalf("feedback input = %#v", stub.createdFeedback)
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
		Data:         SessionData{User: UserSummary{ID: "user-1", Username: "alice", DisplayName: "Alice"}, CSRFToken: "csrf", Permissions: []string{signoutPath}},
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

func TestProfileUsesCurrentPrincipalAndExactPermission(t *testing.T) {
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

	if stub.authorizedPath != "/app/user/profile" {
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

func TestProfileSaveUsesCurrentPrincipalAndExistingPermission(t *testing.T) {
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

	if stub.authorizedPath != "/app/user/profile" || stub.savedProfileUserID != "user-1" ||
		stub.savedProfile.DisplayName != "新名称" || stub.savedProfile.AvatarURL == nil ||
		*stub.savedProfile.AvatarURL != avatarURL {
		t.Fatalf(
			"profile save dispatch path=%q user=%q input=%#v",
			stub.authorizedPath, stub.savedProfileUserID, stub.savedProfile,
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

	if stub.authorizedPath != "/app/user/change-password" || stub.changedPassword.NewPassword != "New-password-2!" {
		t.Fatalf("change password was not dispatched correctly: path=%q input=%#v", stub.authorizedPath, stub.changedPassword)
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
	NewHandler(stub, config.Config{SessionCookieName: "zerp_session", SessionCookieSecure: true, SessionCookieSameSite: "none"}, slog.New(slog.NewTextHandler(io.Discard, nil))).Register(router)
	request := httptest.NewRequest(http.MethodPost, "/app/user/signin", strings.NewReader(`{"username":"alice","password":"Strong-password-1!"}`))
	request.Header.Set("Content-Type", "application/json")
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, request)
	cookies := recorder.Result().Cookies()
	if len(cookies) != 1 || cookies[0].SameSite != http.SameSiteNoneMode || !cookies[0].Secure {
		t.Fatalf("cookie = %#v, want Secure SameSite=None", cookies)
	}
}

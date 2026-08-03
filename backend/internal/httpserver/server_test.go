package httpserver

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"regexp"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/hansonyu183/zerp/backend/internal/api/generated"
	"github.com/hansonyu183/zerp/backend/internal/api/requestbody"
	"github.com/hansonyu183/zerp/backend/internal/api/response"
	"github.com/hansonyu183/zerp/backend/internal/config"
	appdomain "github.com/hansonyu183/zerp/backend/internal/domains/app"
	auxdomain "github.com/hansonyu183/zerp/backend/internal/domains/auxiliary"
	bobdomain "github.com/hansonyu183/zerp/backend/internal/domains/bob"
	leddomain "github.com/hansonyu183/zerp/backend/internal/domains/led"
	voudomain "github.com/hansonyu183/zerp/backend/internal/domains/vou"
	wfldomain "github.com/hansonyu183/zerp/backend/internal/domains/wfl"
)

type pingerStub struct {
	err error
}

type countingReader struct {
	remaining int64
	read      int64
}

func (reader *countingReader) Read(buffer []byte) (int, error) {
	if reader.remaining == 0 {
		return 0, io.EOF
	}
	if int64(len(buffer)) > reader.remaining {
		buffer = buffer[:reader.remaining]
	}
	for index := range buffer {
		buffer[index] = 'x'
	}
	count := len(buffer)
	reader.remaining -= int64(count)
	reader.read += int64(count)
	return count, nil
}

func (stub pingerStub) Ping(context.Context) error {
	return stub.err
}

func testConfig() config.Config {
	return config.Config{
		Environment:           config.EnvironmentTest,
		CORSAllowedOrigins:    []string{"https://erp.example.com"},
		DatabaseHealthTimeout: time.Second,
	}
}

func testLogger() *slog.Logger {
	return slog.New(slog.NewTextHandler(io.Discard, nil))
}

func TestHealthAndReadiness(t *testing.T) {
	router := newRouter(testConfig(), pingerStub{}, testLogger(), nil)

	for _, path := range []string{"/healthz", "/readyz"} {
		request := httptest.NewRequest(http.MethodGet, path, nil)
		responseRecorder := httptest.NewRecorder()
		router.ServeHTTP(responseRecorder, request)

		if responseRecorder.Code != http.StatusOK {
			t.Fatalf("GET %s status = %d, want %d", path, responseRecorder.Code, http.StatusOK)
		}
		if responseRecorder.Header().Get("X-Request-ID") == "" {
			t.Fatalf("GET %s did not return X-Request-ID", path)
		}
	}
}

func TestReadinessFailsWhenDatabaseIsUnavailable(t *testing.T) {
	router := newRouter(testConfig(), pingerStub{err: errors.New("unavailable")}, testLogger(), nil)
	request := httptest.NewRequest(http.MethodGet, "/readyz", nil)
	responseRecorder := httptest.NewRecorder()
	router.ServeHTTP(responseRecorder, request)

	if responseRecorder.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want %d", responseRecorder.Code, http.StatusServiceUnavailable)
	}
}

func TestCORSAllowsOnlyConfiguredOrigin(t *testing.T) {
	router := newRouter(testConfig(), pingerStub{}, testLogger(), nil)

	allowedRequest := httptest.NewRequest(http.MethodOptions, "/readyz", nil)
	allowedRequest.Header.Set("Origin", "https://erp.example.com")
	allowedResponse := httptest.NewRecorder()
	router.ServeHTTP(allowedResponse, allowedRequest)

	if allowedResponse.Code != http.StatusNoContent {
		t.Fatalf("allowed status = %d, want %d", allowedResponse.Code, http.StatusNoContent)
	}
	if got := allowedResponse.Header().Get("Access-Control-Allow-Origin"); got != "https://erp.example.com" {
		t.Fatalf("Access-Control-Allow-Origin = %q", got)
	}

	deniedRequest := httptest.NewRequest(http.MethodOptions, "/readyz", nil)
	deniedRequest.Header.Set("Origin", "https://attacker.example.com")
	deniedResponse := httptest.NewRecorder()
	router.ServeHTTP(deniedResponse, deniedRequest)

	if deniedResponse.Code != http.StatusForbidden {
		t.Fatalf("denied status = %d, want %d", deniedResponse.Code, http.StatusForbidden)
	}
}

func TestRecoveryUsesBusinessEnvelope(t *testing.T) {
	router := newRouter(testConfig(), pingerStub{}, testLogger(), func(router *gin.Engine) {
		router.POST("/app/user/session", func(*gin.Context) {
			panic("test panic")
		})
	})

	request := httptest.NewRequest(http.MethodPost, "/app/user/session", strings.NewReader(`{}`))
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("X-Request-ID", "test-request-id")
	responseRecorder := httptest.NewRecorder()
	router.ServeHTTP(responseRecorder, request)

	if responseRecorder.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", responseRecorder.Code, http.StatusOK)
	}

	var envelope response.Envelope
	if err := json.Unmarshal(responseRecorder.Body.Bytes(), &envelope); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if envelope.Code != response.CodeInternal {
		t.Fatalf("code = %d, want %d", envelope.Code, response.CodeInternal)
	}
	if envelope.RequestID != "test-request-id" {
		t.Fatalf("requestId = %q, want %q", envelope.RequestID, "test-request-id")
	}
}

func TestOpenAPIContractCoversEveryRegisteredRoute(t *testing.T) {
	router := newRouter(testConfig(), pingerStub{}, testLogger(), func(router *gin.Engine) {
		appdomain.NewHandler(nil, testConfig(), testLogger()).Register(router)
		auxdomain.NewHandler(nil, nil, testLogger()).Register(router)
		bobdomain.NewHandler(nil, nil, testLogger()).Register(router)
		voudomain.NewHandler(nil, nil, testLogger()).Register(router)
		wfldomain.NewHandler(nil, nil, testLogger()).Register(router)
		leddomain.NewHandler(nil, nil, testLogger()).Register(router)
	})
	swagger, err := generated.GetSpec()
	if err != nil {
		t.Fatalf("load OpenAPI contract: %v", err)
	}
	ginParameter := regexp.MustCompile(`:([^/]+)`)
	registered := make(map[string]bool)
	for _, route := range router.Routes() {
		contractPath := ginParameter.ReplaceAllString(route.Path, `{$1}`)
		segments := strings.Split(contractPath, "/")
		if len(segments) > 3 && (segments[1] == "aux" || segments[1] == "bob" || segments[1] == "vou") {
			segments[2] = "{entity}"
			contractPath = strings.Join(segments, "/")
		}
		registered[route.Method+" "+contractPath] = true
		pathItem := swagger.Paths.Value(contractPath)
		if pathItem == nil {
			t.Errorf("%s %s is missing from OpenAPI", route.Method, contractPath)
			continue
		}
		if pathItem.GetOperation(strings.ToUpper(route.Method)) == nil {
			t.Errorf("%s %s has no matching OpenAPI operation", route.Method, contractPath)
		}
	}
	for contractPath, pathItem := range swagger.Paths.Map() {
		for method := range pathItem.Operations() {
			key := strings.ToUpper(method) + " " + contractPath
			if !registered[key] {
				t.Errorf("OpenAPI operation %s is not registered by Gin", key)
			}
		}
	}
}

func TestOpenAPISecurityMatchesBusinessBoundary(t *testing.T) {
	swagger, err := generated.GetSpec()
	if err != nil {
		t.Fatalf("load OpenAPI contract: %v", err)
	}
	public := map[string]bool{
		"POST /app/user/signin":  true,
		"POST /app/user/session": true,
	}
	for contractPath, pathItem := range swagger.Paths.Map() {
		if !strings.HasPrefix(contractPath, "/app/") &&
			!strings.HasPrefix(contractPath, "/aux/") &&
			!strings.HasPrefix(contractPath, "/bob/") &&
			!strings.HasPrefix(contractPath, "/vou/") &&
			!strings.HasPrefix(contractPath, "/wfl/") &&
			!strings.HasPrefix(contractPath, "/led/") {
			continue
		}
		for method, operation := range pathItem.Operations() {
			key := strings.ToUpper(method) + " " + contractPath
			if public[key] {
				if operation.Security == nil || len(*operation.Security) != 0 {
					t.Errorf("%s must explicitly be public", key)
				}
				continue
			}
			if operation.Security == nil || len(*operation.Security) == 0 {
				t.Errorf("%s must require session and CSRF security", key)
			}
		}
	}
}

func TestOpenAPIValidatorRejectsInvalidBusinessRequest(t *testing.T) {
	router := newRouter(testConfig(), pingerStub{}, testLogger(), func(router *gin.Engine) {
		appdomain.NewHandler(nil, testConfig(), testLogger()).Register(router)
	})
	request := httptest.NewRequest(
		http.MethodPost,
		"/app/user/signin",
		strings.NewReader(`{"username":"user","password":"secret","unexpected":true}`),
	)
	request.Header.Set("Content-Type", "application/json")
	responseRecorder := httptest.NewRecorder()
	router.ServeHTTP(responseRecorder, request)

	if responseRecorder.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", responseRecorder.Code, http.StatusOK)
	}
	var envelope response.Envelope
	if err := json.Unmarshal(responseRecorder.Body.Bytes(), &envelope); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if envelope.Code != response.CodeValidation {
		t.Fatalf("code = %d, want %d", envelope.Code, response.CodeValidation)
	}
}

func TestOpenAPIValidatorRejectsInvalidBusinessResponse(t *testing.T) {
	var logs bytes.Buffer
	logger := slog.New(slog.NewJSONHandler(&logs, nil))
	router := newRouter(testConfig(), pingerStub{}, logger, func(router *gin.Engine) {
		router.POST("/app/workbench/query", func(context *gin.Context) {
			response.OK(context, gin.H{})
		})
	})
	request := httptest.NewRequest(
		http.MethodPost,
		"/app/workbench/query",
		strings.NewReader(`{"category":"BOB","page":1,"pageSize":20}`),
	)
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("X-Request-ID", "invalid-response-request-id")
	responseRecorder := httptest.NewRecorder()
	router.ServeHTTP(responseRecorder, request)

	if responseRecorder.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", responseRecorder.Code, http.StatusOK)
	}
	var envelope response.Envelope
	if err := json.Unmarshal(responseRecorder.Body.Bytes(), &envelope); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if envelope.Code != response.CodeInternal {
		t.Fatalf("code = %d, want %d", envelope.Code, response.CodeInternal)
	}
	if envelope.RequestID != "invalid-response-request-id" {
		t.Fatalf("requestId = %q, want %q", envelope.RequestID, "invalid-response-request-id")
	}
	if logOutput := logs.String(); !strings.Contains(logOutput, `"error":`) ||
		!strings.Contains(logOutput, "response body doesn't match schema") {
		t.Fatalf("validation error log = %q", logOutput)
	}
}

func TestOpenAPIValidatorPreservesValidBusinessResponse(t *testing.T) {
	router := newRouter(testConfig(), pingerStub{}, testLogger(), func(router *gin.Engine) {
		router.POST("/app/workbench/query", func(context *gin.Context) {
			response.OK(context, gin.H{
				"items":    []any{},
				"total":    0,
				"page":     1,
				"pageSize": 20,
			})
		})
	})
	request := httptest.NewRequest(
		http.MethodPost,
		"/app/workbench/query",
		strings.NewReader(`{"category":"BOB","page":1,"pageSize":20}`),
	)
	request.Header.Set("Content-Type", "application/json")
	responseRecorder := httptest.NewRecorder()
	router.ServeHTTP(responseRecorder, request)

	if responseRecorder.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", responseRecorder.Code, http.StatusOK)
	}
	var envelope response.Envelope
	if err := json.Unmarshal(responseRecorder.Body.Bytes(), &envelope); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if envelope.Code != response.CodeOK {
		t.Fatalf("code = %d, want %d", envelope.Code, response.CodeOK)
	}
}

func TestOpenAPIValidatorPreservesPreciseEndpointBusinessError(t *testing.T) {
	router := newRouter(testConfig(), pingerStub{}, testLogger(), func(router *gin.Engine) {
		router.POST("/app/workbench/query", func(context *gin.Context) {
			response.BusinessError(context, response.CodeConflict, "workbench conflict", nil)
		})
	})
	request := httptest.NewRequest(
		http.MethodPost,
		"/app/workbench/query",
		strings.NewReader(`{"category":"BOB","page":1,"pageSize":20}`),
	)
	request.Header.Set("Content-Type", "application/json")
	responseRecorder := httptest.NewRecorder()
	router.ServeHTTP(responseRecorder, request)

	var envelope response.Envelope
	if err := json.Unmarshal(responseRecorder.Body.Bytes(), &envelope); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if envelope.Code != response.CodeConflict || envelope.Message != "workbench conflict" {
		t.Fatalf("envelope = %#v", envelope)
	}
}

func TestOpenAPIValidatorPreservesTechnicalNotFoundResponse(t *testing.T) {
	router := newRouter(testConfig(), pingerStub{}, testLogger(), nil)
	request := httptest.NewRequest(http.MethodGet, "/missing", nil)
	request.Header.Set("X-Request-ID", "missing-request-id")
	responseRecorder := httptest.NewRecorder()
	router.ServeHTTP(responseRecorder, request)

	if responseRecorder.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want %d", responseRecorder.Code, http.StatusNotFound)
	}
	var payload struct {
		Error     string `json:"error"`
		RequestID string `json:"requestId"`
	}
	if err := json.Unmarshal(responseRecorder.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if payload.Error != "route not found" || payload.RequestID != "missing-request-id" {
		t.Fatalf("payload = %#v", payload)
	}
}

func TestOpenAPIValidatorLimitsRequestBodiesBeforeReading(t *testing.T) {
	tests := []struct {
		name        string
		path        string
		method      string
		contentType string
		limit       int64
		wantStatus  int
	}{
		{
			name:        "business JSON",
			path:        "/app/user/signin",
			method:      http.MethodPost,
			contentType: "application/json",
			limit:       requestbody.MaxJSONBodyBytes,
			wantStatus:  http.StatusOK,
		},
		{
			name:        "file upload",
			path:        "/files/attachments/upload/token",
			method:      http.MethodPut,
			contentType: "application/octet-stream",
			limit:       maxFileRequestBodyBytes,
			wantStatus:  http.StatusBadRequest,
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			source := &countingReader{remaining: test.limit * 2}
			router := newRouter(testConfig(), pingerStub{}, testLogger(), nil)
			request := httptest.NewRequest(test.method, test.path, source)
			request.Header.Set("Content-Type", test.contentType)
			responseRecorder := httptest.NewRecorder()
			router.ServeHTTP(responseRecorder, request)

			if responseRecorder.Code != test.wantStatus {
				t.Fatalf("status = %d, want %d", responseRecorder.Code, test.wantStatus)
			}
			if source.read > test.limit+1 {
				t.Fatalf("validator read %d bytes, limit = %d", source.read, test.limit)
			}
		})
	}
}

func TestProductionServerRequiresFeedbackPublisher(t *testing.T) {
	cfg := testConfig()
	cfg.Environment = config.EnvironmentProduction
	if err := validateFeedbackRuntimeConfig(cfg); err == nil {
		t.Fatal("production runtime accepted disabled feedback publisher")
	}
	cfg.FeedbackGitHubEnabled = true
	if err := validateFeedbackRuntimeConfig(cfg); err != nil {
		t.Fatalf("production runtime rejected enabled feedback publisher: %v", err)
	}
}

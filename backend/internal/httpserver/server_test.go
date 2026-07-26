package httpserver

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/hansonyu183/zerp/backend/internal/api/response"
	"github.com/hansonyu183/zerp/backend/internal/config"
)

type pingerStub struct {
	err error
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
	router := newRouter(testConfig(), pingerStub{}, testLogger(), nil)
	router.POST("/test/panic/action", func(*gin.Context) {
		panic("test panic")
	})

	request := httptest.NewRequest(http.MethodPost, "/test/panic/action", nil)
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

package githubissues

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func testClient(t *testing.T, handler http.HandlerFunc) *Client {
	t.Helper()
	server := httptest.NewServer(handler)
	t.Cleanup(server.Close)
	client, err := New("hansonyu183/zerp-back", "secret-token")
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}
	client.apiBase = server.URL
	client.httpClient = server.Client()
	return client
}

func TestCreateIssueUsesLeastDataAndLabels(t *testing.T) {
	client := testClient(t, func(writer http.ResponseWriter, request *http.Request) {
		if request.Method != http.MethodPost || request.URL.Path != "/repos/hansonyu183/zerp-back/issues" {
			t.Fatalf("request = %s %s", request.Method, request.URL.Path)
		}
		if request.Header.Get("Authorization") != "Bearer secret-token" {
			t.Fatalf("authorization header = %q", request.Header.Get("Authorization"))
		}
		var payload struct {
			Title  string   `json:"title"`
			Body   string   `json:"body"`
			Labels []string `json:"labels"`
		}
		if err := json.NewDecoder(request.Body).Decode(&payload); err != nil {
			t.Fatalf("decode payload: %v", err)
		}
		if payload.Title != "title" || payload.Body != "body" ||
			len(payload.Labels) != 1 || payload.Labels[0] != "automation:blocked" {
			t.Fatalf("payload = %#v", payload)
		}
		writer.Header().Set("Content-Type", "application/json")
		_, _ = writer.Write([]byte(`{"number":17,"html_url":"https://github.com/hansonyu183/zerp-back/issues/17"}`))
	})
	issue, err := client.Create(context.Background(), "title", "body", []string{"automation:blocked"})
	if err != nil || issue.Number != 17 {
		t.Fatalf("issue = %#v, error = %v", issue, err)
	}
}

func TestFindByMarkerScopesSearchToRepository(t *testing.T) {
	client := testClient(t, func(writer http.ResponseWriter, request *http.Request) {
		if request.URL.Path != "/search/issues" {
			t.Fatalf("path = %q", request.URL.Path)
		}
		query := request.URL.Query().Get("q")
		if !strings.Contains(query, "repo:hansonyu183/zerp-back") ||
			!strings.Contains(query, "zerp-feedback:01J00000000000000000000000") {
			t.Fatalf("query = %q", query)
		}
		writer.Header().Set("Content-Type", "application/json")
		_, _ = writer.Write([]byte(`{"items":[]}`))
	})
	_, exists, err := client.FindByMarker(context.Background(), "<!-- zerp-feedback:01J00000000000000000000000 -->")
	if err != nil || exists {
		t.Fatalf("exists = %t, error = %v", exists, err)
	}
}

func TestRateLimitErrorIsRetryable(t *testing.T) {
	client := testClient(t, func(writer http.ResponseWriter, _ *http.Request) {
		writer.Header().Set("Retry-After", "120")
		writer.WriteHeader(http.StatusTooManyRequests)
	})
	_, err := client.Create(context.Background(), "title", "body", nil)
	var apiErr *APIError
	if !errors.As(err, &apiErr) || !apiErr.Retryable() ||
		apiErr.RetryAfter().Seconds() != 120 || apiErr.ErrorCode() != "rate_limit" {
		t.Fatalf("error = %#v", err)
	}
}

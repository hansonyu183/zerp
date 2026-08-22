package main

import (
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

func TestE2EHandlerServesSPAAssetsAndHealth(t *testing.T) {
	root := t.TempDir()
	mustWrite(t, filepath.Join(root, "index.html"), "spa-index")
	mustWrite(t, filepath.Join(root, "assets", "app.js"), "asset")

	backend := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		_, _ = writer.Write([]byte(request.URL.Path))
	}))
	defer backend.Close()

	handler, err := newE2EHandler(root, backend.URL)
	if err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(handler)
	defer server.Close()

	assertResponse(t, server.URL+"/healthz", http.StatusOK, "ok\n")
	assertResponse(t, server.URL+"/business/customer/1", http.StatusOK, "spa-index")
	response := assertResponse(t, server.URL+"/assets/app.js", http.StatusOK, "asset")
	if got := response.Header.Get("Cache-Control"); got != "public, max-age=31536000, immutable" {
		t.Fatalf("unexpected asset cache header: %q", got)
	}
	assertResponse(t, server.URL+"/assets/missing.js", http.StatusNotFound, "404 page not found\n")
	assertResponse(t, server.URL+"/api/app/user/profile", http.StatusOK, "/app/user/profile")
	assertResponse(t, server.URL+"/files/attachment/1", http.StatusOK, "/files/attachment/1")
}

func TestE2EHandlerRejectsMissingIndex(t *testing.T) {
	if _, err := newE2EHandler(t.TempDir(), "http://127.0.0.1:18081"); err == nil {
		t.Fatal("expected missing index error")
	}
}

func mustWrite(t *testing.T, path, contents string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(contents), 0o644); err != nil {
		t.Fatal(err)
	}
}

func assertResponse(t *testing.T, url string, status int, body string) *http.Response {
	t.Helper()
	response, err := http.Get(url) //nolint:gosec // test server URL
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = response.Body.Close() })
	contents, err := io.ReadAll(response.Body)
	if err != nil {
		t.Fatal(err)
	}
	if response.StatusCode != status || string(contents) != body {
		t.Fatalf("unexpected response: status=%d body=%q", response.StatusCode, contents)
	}
	return response
}

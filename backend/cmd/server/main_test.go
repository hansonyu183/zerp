package main

import (
	"net/http"
	"testing"
	"time"

	"github.com/hansonyu183/zerp/backend/internal/config"
)

func TestNewHTTPServerAppliesTimeouts(t *testing.T) {
	handler := http.HandlerFunc(func(http.ResponseWriter, *http.Request) {})
	cfg := config.Config{
		HTTPAddress:       ":9090",
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       2 * time.Minute,
		WriteTimeout:      3 * time.Minute,
		IdleTimeout:       time.Minute,
	}

	server := newHTTPServer(cfg, handler)

	if server.Addr != cfg.HTTPAddress || server.Handler == nil {
		t.Fatalf("server address/handler = %q/%v", server.Addr, server.Handler)
	}
	if server.ReadHeaderTimeout != cfg.ReadHeaderTimeout ||
		server.ReadTimeout != cfg.ReadTimeout ||
		server.WriteTimeout != cfg.WriteTimeout ||
		server.IdleTimeout != cfg.IdleTimeout {
		t.Fatalf(
			"server timeouts = header:%s read:%s write:%s idle:%s",
			server.ReadHeaderTimeout,
			server.ReadTimeout,
			server.WriteTimeout,
			server.IdleTimeout,
		)
	}
}

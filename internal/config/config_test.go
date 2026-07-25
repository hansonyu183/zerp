package config

import (
	"reflect"
	"testing"
	"time"
)

func TestLoadDefaults(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://example")
	t.Setenv("APP_ENV", "")
	t.Setenv("HTTP_ADDRESS", "")
	t.Setenv("CORS_ALLOWED_ORIGINS", " https://erp.example.com,https://erp.example.com, https://preview.example.com ")
	t.Setenv("DATABASE_CONNECT_TIMEOUT", "")
	t.Setenv("DATABASE_HEALTH_TIMEOUT", "")
	t.Setenv("HTTP_READ_HEADER_TIMEOUT", "")
	t.Setenv("SHUTDOWN_TIMEOUT", "")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}

	if cfg.Environment != EnvironmentDevelopment {
		t.Fatalf("Environment = %q, want %q", cfg.Environment, EnvironmentDevelopment)
	}
	if cfg.HTTPAddress != ":8080" {
		t.Fatalf("HTTPAddress = %q, want %q", cfg.HTTPAddress, ":8080")
	}
	if cfg.DatabaseConnectTimeout != 5*time.Second {
		t.Fatalf("DatabaseConnectTimeout = %s, want 5s", cfg.DatabaseConnectTimeout)
	}
	if cfg.AttachmentStorageRoot != "./var/attachments" ||
		cfg.AttachmentUploadTTL != 15*time.Minute || cfg.AttachmentDownloadTTL != 5*time.Minute {
		t.Fatalf("attachment defaults = root:%q upload:%s download:%s",
			cfg.AttachmentStorageRoot, cfg.AttachmentUploadTTL, cfg.AttachmentDownloadTTL)
	}
	if cfg.FeedbackGitHubEnabled || cfg.FeedbackGitHubRepository != "hansonyu183/zerp-back" {
		t.Fatalf("feedback defaults = enabled:%t repository:%q",
			cfg.FeedbackGitHubEnabled, cfg.FeedbackGitHubRepository)
	}
	wantOrigins := []string{"https://erp.example.com", "https://preview.example.com"}
	if !reflect.DeepEqual(cfg.CORSAllowedOrigins, wantOrigins) {
		t.Fatalf("CORSAllowedOrigins = %#v, want %#v", cfg.CORSAllowedOrigins, wantOrigins)
	}
}

func TestLoadRequiresAbsoluteAttachmentRootInProduction(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://example")
	t.Setenv("APP_ENV", EnvironmentProduction)
	t.Setenv("FEEDBACK_GITHUB_ENABLED", "true")
	t.Setenv("FEEDBACK_GITHUB_TOKEN", "test-token")
	t.Setenv("ATTACHMENT_STORAGE_ROOT", "")
	if _, err := Load(); err == nil {
		t.Fatal("Load() accepted missing production attachment root")
	}
	t.Setenv("ATTACHMENT_STORAGE_ROOT", "relative/attachments")
	if _, err := Load(); err == nil {
		t.Fatal("Load() accepted relative production attachment root")
	}
	t.Setenv("ATTACHMENT_STORAGE_ROOT", "/var/lib/zerp/attachments")
	if _, err := Load(); err != nil {
		t.Fatalf("Load() rejected absolute production attachment root: %v", err)
	}
}

func TestLoadRequiresFeedbackTokenWhenEnabled(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://example")
	t.Setenv("APP_ENV", EnvironmentDevelopment)
	t.Setenv("FEEDBACK_GITHUB_ENABLED", "true")
	t.Setenv("FEEDBACK_GITHUB_TOKEN", "")
	if _, err := Load(); err == nil {
		t.Fatal("Load() accepted enabled feedback publishing without a token")
	}

	t.Setenv("FEEDBACK_GITHUB_TOKEN", "test-token")
	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load() rejected valid feedback configuration: %v", err)
	}
	if !cfg.FeedbackGitHubEnabled {
		t.Fatal("FeedbackGitHubEnabled = false, want true")
	}
}

func TestLoadRequiresFeedbackPublishingInProduction(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://example")
	t.Setenv("APP_ENV", EnvironmentProduction)
	t.Setenv("ATTACHMENT_STORAGE_ROOT", "/var/lib/zerp/attachments")
	t.Setenv("FEEDBACK_GITHUB_ENABLED", "false")
	t.Setenv("FEEDBACK_GITHUB_TOKEN", "")

	if _, err := Load(); err == nil {
		t.Fatal("Load() accepted disabled feedback publishing in production")
	}
}

func TestLoadRequiresDatabaseURL(t *testing.T) {
	t.Setenv("DATABASE_URL", "")

	if _, err := Load(); err == nil {
		t.Fatal("Load() error = nil, want an error")
	}
}

func TestLoadRejectsInvalidDuration(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://example")
	t.Setenv("SHUTDOWN_TIMEOUT", "later")

	if _, err := Load(); err == nil {
		t.Fatal("Load() error = nil, want an error")
	}
}

func TestLoadRejectsUnsafeCookieName(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://example")
	t.Setenv("APP_SESSION_COOKIE_NAME", "bad;cookie")

	if _, err := Load(); err == nil {
		t.Fatal("Load() error = nil, want an error")
	}
}

func TestLoadValidatesCookieSameSite(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://example")
	t.Setenv("APP_ENV", EnvironmentDevelopment)
	t.Setenv("APP_SESSION_COOKIE_SAME_SITE", "none")
	t.Setenv("APP_SESSION_COOKIE_SECURE", "false")
	if _, err := Load(); err == nil {
		t.Fatal("Load() accepted SameSite=None without a Secure cookie")
	}

	t.Setenv("APP_SESSION_COOKIE_SECURE", "true")
	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	if cfg.SessionCookieSameSite != "none" {
		t.Fatalf("SessionCookieSameSite = %q, want none", cfg.SessionCookieSameSite)
	}
}

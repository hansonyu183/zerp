package config

import (
	"reflect"
	"testing"
	"time"
)

func TestLoadDefaults(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://example")
	t.Setenv("CORS_ALLOWED_ORIGINS", " https://erp.example.com,https://erp.example.com, https://preview.example.com ")
	for _, key := range []string{
		"APP_ENV",
		"HTTP_ADDRESS",
		"DATABASE_CONNECT_TIMEOUT",
		"DATABASE_HEALTH_TIMEOUT",
		"HTTP_READ_HEADER_TIMEOUT",
		"HTTP_READ_TIMEOUT",
		"HTTP_WRITE_TIMEOUT",
		"HTTP_IDLE_TIMEOUT",
		"SHUTDOWN_TIMEOUT",
		"APP_SESSION_COOKIE_NAME",
		"APP_SESSION_COOKIE_SECURE",
		"APP_SESSION_COOKIE_SAME_SITE",
		"APP_SESSION_IDLE_TIMEOUT",
		"APP_SESSION_ABSOLUTE_TIMEOUT",
		"APP_SIGNIN_LOCK_THRESHOLD",
		"APP_SIGNIN_LOCK_DURATION",
		"APP_PASSWORD_MIN_LENGTH",
		"ATTACHMENT_STORAGE_ROOT",
		"ATTACHMENT_UPLOAD_TOKEN_TTL",
		"ATTACHMENT_DOWNLOAD_TOKEN_TTL",
		"FEEDBACK_ATTACHMENT_ORPHAN_TTL",
		"FEEDBACK_GITHUB_ENABLED",
		"FEEDBACK_GITHUB_REPOSITORY",
		"FEEDBACK_GITHUB_TOKEN",
	} {
		t.Setenv(key, "")
	}

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
	if cfg.ReadHeaderTimeout != 5*time.Second || cfg.ReadTimeout != 2*time.Minute ||
		cfg.WriteTimeout != 2*time.Minute || cfg.IdleTimeout != time.Minute {
		t.Fatalf(
			"HTTP timeouts = header:%s read:%s write:%s idle:%s",
			cfg.ReadHeaderTimeout,
			cfg.ReadTimeout,
			cfg.WriteTimeout,
			cfg.IdleTimeout,
		)
	}
	if cfg.AttachmentStorageRoot != "./var/attachments" ||
		cfg.AttachmentUploadTTL != 15*time.Minute || cfg.AttachmentDownloadTTL != 5*time.Minute ||
		cfg.FeedbackAttachmentOrphanTTL != 24*time.Hour {
		t.Fatalf("attachment defaults = root:%q upload:%s download:%s feedbackOrphan:%s",
			cfg.AttachmentStorageRoot, cfg.AttachmentUploadTTL, cfg.AttachmentDownloadTTL,
			cfg.FeedbackAttachmentOrphanTTL)
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
	for _, key := range []string{
		"HTTP_READ_HEADER_TIMEOUT",
		"HTTP_READ_TIMEOUT",
		"HTTP_WRITE_TIMEOUT",
		"HTTP_IDLE_TIMEOUT",
		"SHUTDOWN_TIMEOUT",
	} {
		t.Run(key, func(t *testing.T) {
			t.Setenv("DATABASE_URL", "postgres://example")
			t.Setenv(key, "later")

			if _, err := Load(); err == nil {
				t.Fatalf("Load() accepted invalid %s", key)
			}
		})
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

func TestLoadRequiresSecureCookieInProduction(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://example")
	t.Setenv("APP_ENV", EnvironmentProduction)
	t.Setenv("ATTACHMENT_STORAGE_ROOT", "/var/lib/zerp/attachments")
	t.Setenv("APP_SESSION_COOKIE_SECURE", "false")
	t.Setenv("APP_SESSION_COOKIE_SAME_SITE", "lax")
	t.Setenv("FEEDBACK_GITHUB_ENABLED", "false")
	t.Setenv("FEEDBACK_GITHUB_TOKEN", "")
	if _, err := Load(); err == nil {
		t.Fatal("Load() accepted an insecure production session cookie")
	}

	t.Setenv("APP_ENV", EnvironmentDevelopment)
	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load() rejected an insecure development session cookie: %v", err)
	}
	if cfg.SessionCookieSecure {
		t.Fatal("SessionCookieSecure = true, want false for explicit development override")
	}
}

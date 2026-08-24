package config

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
)

const (
	EnvironmentDevelopment = "development"
	EnvironmentTest        = "test"
	EnvironmentProduction  = "production"
)

type Config struct {
	Environment            string
	HTTPAddress            string
	DatabaseURL            string
	CORSAllowedOrigins     []string
	DatabaseConnectTimeout time.Duration
	DatabaseHealthTimeout  time.Duration
	ReadHeaderTimeout      time.Duration
	ReadTimeout            time.Duration
	WriteTimeout           time.Duration
	IdleTimeout            time.Duration
	ShutdownTimeout        time.Duration
	SessionCookieName      string
	SessionCookieSecure    bool
	SessionCookieSameSite  string
	SessionIdleTimeout     time.Duration
	SessionAbsoluteTimeout time.Duration
	SigninLockThreshold    int
	SigninLockDuration     time.Duration
	PasswordMinLength      int
	AttachmentStorageRoot  string
	AttachmentUploadTTL    time.Duration
	AttachmentDownloadTTL  time.Duration
}

func Load() (Config, error) {
	cfg := Config{
		Environment:           valueOrDefault("APP_ENV", EnvironmentDevelopment),
		HTTPAddress:           valueOrDefault("HTTP_ADDRESS", ":8080"),
		DatabaseURL:           strings.TrimSpace(os.Getenv("DATABASE_URL")),
		CORSAllowedOrigins:    splitAndTrim(os.Getenv("CORS_ALLOWED_ORIGINS")),
		SessionCookieName:     valueOrDefault("APP_SESSION_COOKIE_NAME", "zerp_session"),
		SessionCookieSameSite: strings.ToLower(valueOrDefault("APP_SESSION_COOKIE_SAME_SITE", "lax")),
		AttachmentStorageRoot: strings.TrimSpace(os.Getenv("ATTACHMENT_STORAGE_ROOT")),
	}

	if cfg.DatabaseURL == "" {
		return Config{}, errors.New("DATABASE_URL is required")
	}
	if !validCookieName(cfg.SessionCookieName) {
		return Config{}, errors.New("APP_SESSION_COOKIE_NAME must contain only letters, numbers, underscore, or hyphen")
	}

	if cfg.Environment != EnvironmentDevelopment && cfg.Environment != EnvironmentTest && cfg.Environment != EnvironmentProduction {
		return Config{}, fmt.Errorf("APP_ENV must be one of %q, %q, or %q", EnvironmentDevelopment, EnvironmentTest, EnvironmentProduction)
	}
	if cfg.AttachmentStorageRoot == "" {
		if cfg.Environment == EnvironmentProduction {
			return Config{}, errors.New("ATTACHMENT_STORAGE_ROOT is required in production")
		}
		cfg.AttachmentStorageRoot = "./var/attachments"
	}
	if cfg.Environment == EnvironmentProduction && !filepath.IsAbs(cfg.AttachmentStorageRoot) {
		return Config{}, errors.New("ATTACHMENT_STORAGE_ROOT must be absolute in production")
	}

	var err error
	if cfg.DatabaseConnectTimeout, err = durationOrDefault("DATABASE_CONNECT_TIMEOUT", 5*time.Second); err != nil {
		return Config{}, err
	}
	if cfg.DatabaseHealthTimeout, err = durationOrDefault("DATABASE_HEALTH_TIMEOUT", 2*time.Second); err != nil {
		return Config{}, err
	}
	if cfg.ReadHeaderTimeout, err = durationOrDefault("HTTP_READ_HEADER_TIMEOUT", 5*time.Second); err != nil {
		return Config{}, err
	}
	if cfg.ReadTimeout, err = durationOrDefault("HTTP_READ_TIMEOUT", 2*time.Minute); err != nil {
		return Config{}, err
	}
	if cfg.WriteTimeout, err = durationOrDefault("HTTP_WRITE_TIMEOUT", 2*time.Minute); err != nil {
		return Config{}, err
	}
	if cfg.IdleTimeout, err = durationOrDefault("HTTP_IDLE_TIMEOUT", time.Minute); err != nil {
		return Config{}, err
	}
	if cfg.ShutdownTimeout, err = durationOrDefault("SHUTDOWN_TIMEOUT", 10*time.Second); err != nil {
		return Config{}, err
	}
	if cfg.SessionIdleTimeout, err = durationOrDefault("APP_SESSION_IDLE_TIMEOUT", 30*time.Minute); err != nil {
		return Config{}, err
	}
	if cfg.SessionAbsoluteTimeout, err = durationOrDefault("APP_SESSION_ABSOLUTE_TIMEOUT", 12*time.Hour); err != nil {
		return Config{}, err
	}
	if cfg.SessionAbsoluteTimeout < cfg.SessionIdleTimeout {
		return Config{}, errors.New("APP_SESSION_ABSOLUTE_TIMEOUT must be greater than or equal to APP_SESSION_IDLE_TIMEOUT")
	}
	if cfg.SigninLockDuration, err = durationOrDefault("APP_SIGNIN_LOCK_DURATION", 15*time.Minute); err != nil {
		return Config{}, err
	}
	if cfg.SessionCookieSecure, err = boolOrDefault("APP_SESSION_COOKIE_SECURE", true); err != nil {
		return Config{}, err
	}
	if cfg.Environment == EnvironmentProduction && !cfg.SessionCookieSecure {
		return Config{}, errors.New("APP_SESSION_COOKIE_SECURE must be true in production")
	}
	if cfg.SessionCookieSameSite != "lax" && cfg.SessionCookieSameSite != "strict" && cfg.SessionCookieSameSite != "none" {
		return Config{}, errors.New("APP_SESSION_COOKIE_SAME_SITE must be one of lax, strict, or none")
	}
	if cfg.SessionCookieSameSite == "none" && !cfg.SessionCookieSecure {
		return Config{}, errors.New("APP_SESSION_COOKIE_SECURE must be true when APP_SESSION_COOKIE_SAME_SITE is none")
	}
	if cfg.SigninLockThreshold, err = intOrDefault("APP_SIGNIN_LOCK_THRESHOLD", 5, 1, 100); err != nil {
		return Config{}, err
	}
	if cfg.PasswordMinLength, err = intOrDefault("APP_PASSWORD_MIN_LENGTH", 12, 8, 128); err != nil {
		return Config{}, err
	}
	if cfg.AttachmentUploadTTL, err = durationOrDefault("ATTACHMENT_UPLOAD_TOKEN_TTL", 15*time.Minute); err != nil {
		return Config{}, err
	}
	if cfg.AttachmentDownloadTTL, err = durationOrDefault("ATTACHMENT_DOWNLOAD_TOKEN_TTL", 5*time.Minute); err != nil {
		return Config{}, err
	}

	return cfg, nil
}

func validCookieName(value string) bool {
	if value == "" || len(value) > 128 {
		return false
	}
	for _, character := range value {
		if (character < 'a' || character > 'z') && (character < 'A' || character > 'Z') &&
			(character < '0' || character > '9') && character != '_' && character != '-' {
			return false
		}
	}
	return true
}

func boolOrDefault(key string, fallback bool) (bool, error) {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return fallback, nil
	}
	switch strings.ToLower(value) {
	case "true", "1", "yes":
		return true, nil
	case "false", "0", "no":
		return false, nil
	default:
		return false, fmt.Errorf("%s must be true or false", key)
	}
}

func intOrDefault(key string, fallback, minimum, maximum int) (int, error) {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return fallback, nil
	}
	var parsed int
	if _, err := fmt.Sscanf(value, "%d", &parsed); err != nil || fmt.Sprintf("%d", parsed) != value {
		return 0, fmt.Errorf("%s must be an integer", key)
	}
	if parsed < minimum || parsed > maximum {
		return 0, fmt.Errorf("%s must be between %d and %d", key, minimum, maximum)
	}
	return parsed, nil
}

func valueOrDefault(key, fallback string) string {
	if value := strings.TrimSpace(os.Getenv(key)); value != "" {
		return value
	}
	return fallback
}

func durationOrDefault(key string, fallback time.Duration) (time.Duration, error) {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return fallback, nil
	}

	duration, err := time.ParseDuration(value)
	if err != nil {
		return 0, fmt.Errorf("parse %s: %w", key, err)
	}
	if duration <= 0 {
		return 0, fmt.Errorf("%s must be greater than zero", key)
	}
	return duration, nil
}

func splitAndTrim(value string) []string {
	if strings.TrimSpace(value) == "" {
		return nil
	}

	parts := strings.Split(value, ",")
	result := make([]string, 0, len(parts))
	seen := make(map[string]struct{}, len(parts))
	for _, part := range parts {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}
		if _, exists := seen[part]; exists {
			continue
		}
		seen[part] = struct{}{}
		result = append(result, part)
	}
	return result
}

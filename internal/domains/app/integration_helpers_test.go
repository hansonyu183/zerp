//go:build integration

package app

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"os"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/hansonyu183/zerp-back/internal/config"
	"github.com/jackc/pgx/v5/pgxpool"
)

const (
	integrationAdminPassword = "Admin-password-1!"
	integrationUserPassword  = "User-password-1!"
)

func appIntegrationPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	databaseURL := strings.TrimSpace(os.Getenv("TEST_DATABASE_URL"))
	databaseName := strings.TrimSpace(os.Getenv("TEST_POSTGRES_DB"))
	if databaseURL == "" || databaseName == "" {
		t.Fatal("TEST_DATABASE_URL and TEST_POSTGRES_DB are required")
	}
	if !strings.HasSuffix(databaseName, "_test") {
		t.Fatalf("TEST_POSTGRES_DB %q must end with _test", databaseName)
	}
	pool, err := pgxpool.New(t.Context(), databaseURL)
	if err != nil {
		t.Fatalf("connect integration database: %v", err)
	}
	t.Cleanup(pool.Close)
	var currentDatabase string
	if err = pool.QueryRow(t.Context(), "select current_database()").Scan(&currentDatabase); err != nil {
		t.Fatalf("read current database: %v", err)
	}
	if currentDatabase != databaseName {
		t.Fatalf("connected database %q does not match %q", currentDatabase, databaseName)
	}
	return pool
}

func resetAPPIntegrationData(t *testing.T, pool *pgxpool.Pool) {
	t.Helper()
	_, err := pool.Exec(t.Context(), `
		TRUNCATE app_feedback_attachments, app_feedback_files, app_feedback, app_audit_events, app_sessions,
			app_user_roles, app_role_permissions, app_roles, app_users;
		UPDATE app_permissions SET status = 'ENABLED', revision = 1, updated_at = now(), updated_by = NULL;
	`)
	if err != nil {
		t.Fatalf("reset APP integration data: %v", err)
	}
}

func appIntegrationConfig(t *testing.T) config.Config {
	t.Helper()
	return config.Config{
		SessionIdleTimeout:          30 * time.Minute,
		SessionAbsoluteTimeout:      12 * time.Hour,
		SigninLockThreshold:         2,
		SigninLockDuration:          15 * time.Minute,
		PasswordMinLength:           12,
		FeedbackGitHubEnabled:       true,
		AttachmentStorageRoot:       t.TempDir(),
		AttachmentUploadTTL:         15 * time.Minute,
		FeedbackAttachmentOrphanTTL: 24 * time.Hour,
	}
}

func appIntegrationService(t *testing.T) (*Service, *pgxpool.Pool, UserView) {
	t.Helper()
	pool := appIntegrationPool(t)
	resetAPPIntegrationData(t, pool)
	service := NewService(pool, appIntegrationConfig(t), slog.New(slog.NewTextHandler(io.Discard, nil)))
	admin, err := service.BootstrapAdmin(t.Context(), "admin", "系统管理员", integrationAdminPassword)
	if err != nil {
		t.Fatalf("bootstrap admin: %v", err)
	}
	return service, pool, admin
}

func permissionIDsByPath(t *testing.T, pool *pgxpool.Pool, paths ...string) []string {
	t.Helper()
	rows, err := pool.Query(t.Context(), `SELECT id, path FROM app_permissions WHERE path = ANY($1::text[])`, paths)
	if err != nil {
		t.Fatalf("query permission ids: %v", err)
	}
	defer rows.Close()
	byPath := make(map[string]string, len(paths))
	for rows.Next() {
		var id, path string
		if err = rows.Scan(&id, &path); err != nil {
			t.Fatalf("scan permission: %v", err)
		}
		byPath[path] = id
	}
	result := make([]string, 0, len(paths))
	for _, path := range paths {
		id := byPath[path]
		if id == "" {
			t.Fatalf("permission %s is not seeded", path)
		}
		result = append(result, id)
	}
	return result
}

type integrationIssueClient struct {
	mu     sync.Mutex
	title  string
	body   string
	labels []string
}

type integrationExistingIssueClient struct {
	createCalls int
}

func (*integrationExistingIssueClient) FindByMarker(context.Context, string) (FeedbackIssue, bool, error) {
	return FeedbackIssue{Number: 18, URL: "https://github.com/hansonyu183/zerp-back/issues/18"}, true, nil
}

func (client *integrationExistingIssueClient) Create(
	context.Context, string, string, []string,
) (FeedbackIssue, error) {
	client.createCalls++
	return FeedbackIssue{}, errors.New("create must not be called after marker reconciliation")
}

type integrationPublishFailure struct {
	retryable bool
}

func (failure integrationPublishFailure) Error() string             { return "publish failed" }
func (failure integrationPublishFailure) Retryable() bool           { return failure.retryable }
func (failure integrationPublishFailure) RetryAfter() time.Duration { return 0 }
func (failure integrationPublishFailure) ErrorCode() string         { return "test_failure" }

type integrationFailingIssueClient struct {
	err error
}

func (client integrationFailingIssueClient) FindByMarker(context.Context, string) (FeedbackIssue, bool, error) {
	return FeedbackIssue{}, false, client.err
}

func (client integrationFailingIssueClient) Create(
	context.Context, string, string, []string,
) (FeedbackIssue, error) {
	return FeedbackIssue{}, client.err
}

func (*integrationIssueClient) FindByMarker(context.Context, string) (FeedbackIssue, bool, error) {
	return FeedbackIssue{}, false, nil
}

func (client *integrationIssueClient) Create(
	_ context.Context, title, body string, labels []string,
) (FeedbackIssue, error) {
	client.mu.Lock()
	defer client.mu.Unlock()
	client.title, client.body, client.labels = title, body, slices.Clone(labels)
	return FeedbackIssue{Number: 17, URL: "https://github.com/hansonyu183/zerp-back/issues/17"}, nil
}

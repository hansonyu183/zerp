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

	"github.com/hansonyu183/zerp/backend/internal/config"
	"github.com/hansonyu183/zerp/backend/internal/platform/systemidentity"
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
		TRUNCATE acc_period_balances, acc_inventory_cost_allocations,
			acc_opening_containers, acc_opening_bills, acc_opening_assets,
			acc_container_entries, acc_bill_book_values, acc_bills, acc_asset_book_values, acc_assets, acc_register_events,
			acc_periods, acc_inventory_entries, acc_voucher_lines, acc_opening_lines, acc_openings, acc_vouchers, acc_mapping_versions,
			acc_subject_usages, acc_subject_dimensions, acc_subjects,
			acc_book_user_scopes, acc_books, vou_intermediary_scripts,
			app_system_parameter_runtime_adoptions, app_system_parameter_runtime_scopes,
			app_business_menu_items, app_system_parameters, app_feedback_attachments, app_feedback_files, app_feedback, app_audit_events, app_sessions,
			app_user_profiles,
			app_user_roles, app_role_permissions, app_roles, app_users,
			app_role_code_counters CASCADE;
		INSERT INTO app_role_code_counters(counter_key, next_value) VALUES ('default', 0);
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

func integrationPrincipal(userID string) Principal {
	return Principal{User: UserSummary{ID: userID}}
}

func rolePermissionIDs(detail RoleDetail) []string {
	ids := make([]string, 0, len(detail.Permissions))
	for _, permission := range detail.Permissions {
		ids = append(ids, permission.ID)
	}
	return ids
}

func userRoleIDs(detail UserDetail) []string {
	ids := make([]string, 0, len(detail.Roles))
	for _, role := range detail.Roles {
		ids = append(ids, role.ID)
	}
	return ids
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
	if _, err = pool.Exec(t.Context(), `
		INSERT INTO app_system_parameters (
			parameter_key, name, description, value_type, configured_value,
			default_value, safe_to_expose, editable, constraints, effect_mode, running_value,
			running_revision, restart_pending, created_by, updated_by
		) VALUES (
			'app.menu.mode', '当前菜单方式', '菜单服务专用', 'STRING',
			'DEFAULT', 'DEFAULT', true, false, NULL, 'IMMEDIATE', 'DEFAULT', 1, false, $1, $1
		)
	`, admin.ID); err != nil {
		t.Fatalf("seed APP system parameters: %v", err)
	}
	return service, pool, admin
}

func restoreAPPSystemIdentity(t *testing.T, pool *pgxpool.Pool) {
	t.Helper()
	if _, err := pool.Exec(t.Context(), `
		INSERT INTO app_roles(id, code, name, status, created_by, updated_by)
		VALUES($1, $2, $3, 'ENABLED', $4, $4)
	`, systemidentity.RoleID, systemidentity.RoleCode, systemidentity.RoleName, systemidentity.UserID); err != nil {
		t.Fatalf("seed APP system role: %v", err)
	}
	if _, err := pool.Exec(t.Context(), `
		INSERT INTO app_users(
			id, username, display_name, password_hash, status,
			password_change_required, password_changed_at, created_by, updated_by
		) VALUES($1, $2, $3, '!system-login-disabled!', 'DISABLED', false, now(), $1, $1)
	`, systemidentity.UserID, systemidentity.Username, systemidentity.UserDisplayName); err != nil {
		t.Fatalf("seed APP system user: %v", err)
	}
	if _, err := pool.Exec(t.Context(), `
		INSERT INTO app_user_roles(user_id, role_id, created_by)
		VALUES($1, $2, $1)
	`, systemidentity.UserID, systemidentity.RoleID); err != nil {
		t.Fatalf("restore APP system identity: %v", err)
	}
}

func completeRequiredPasswordChange(
	t *testing.T,
	service *Service,
	signin SessionResult,
	currentPassword string,
	newPassword string,
) SessionResult {
	t.Helper()
	principal, err := service.Authorize(
		t.Context(), signin.SessionToken, signin.Data.CSRFToken,
		changePasswordPath, "integration-required-password-change",
	)
	if err != nil {
		t.Fatalf("authorize required password change: %v", err)
	}
	if err = service.ChangePassword(t.Context(), principal, ChangePasswordInput{
		CurrentPassword: currentPassword,
		NewPassword:     newPassword,
	}, "integration-required-password-change"); err != nil {
		t.Fatalf("complete required password change: %v", err)
	}
	changed, err := service.Signin(t.Context(), signin.Data.User.Username, newPassword, "integration-signin-after-password-change")
	if err != nil {
		t.Fatalf("signin after required password change: %v", err)
	}
	if changed.Data.PasswordChangeRequired {
		t.Fatal("password change remained required")
	}
	return changed
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
	return FeedbackIssue{Number: 18, URL: "https://github.com/hansonyu183/zerp/issues/18"}, true, nil
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
	return FeedbackIssue{Number: 17, URL: "https://github.com/hansonyu183/zerp/issues/17"}, nil
}

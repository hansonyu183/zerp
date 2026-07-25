//go:build integration

package app

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
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
	"github.com/jackc/pgx/v5"
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

func TestAuthenticationAndSessionIntegration(t *testing.T) {
	service, pool, _ := appIntegrationService(t)
	signin, err := service.Signin(t.Context(), " ADMIN ", integrationAdminPassword, "signin-success")
	if err != nil {
		t.Fatalf("signin: %v", err)
	}
	if signin.SessionToken == "" || signin.Data.CSRFToken == "" || !slices.Contains(signin.Data.Permissions, signoutPath) {
		t.Fatalf("signin result = %+v", signin)
	}
	restored, err := service.RestoreSession(t.Context(), signin.SessionToken)
	if err != nil {
		t.Fatalf("restore: %v", err)
	}
	if restored.Data.CSRFToken == signin.Data.CSRFToken {
		t.Fatal("session restore did not rotate CSRF")
	}
	if _, err = service.Authorize(t.Context(), signin.SessionToken, signin.Data.CSRFToken, "/app/user/profile", "old-csrf"); !errorIsKind(err, ErrorForbidden) {
		t.Fatalf("old CSRF error = %v", err)
	}
	principal, err := service.Authorize(t.Context(), signin.SessionToken, restored.Data.CSRFToken, signoutPath, "signout-authorize")
	if err != nil {
		t.Fatalf("authorize signout: %v", err)
	}
	if err = service.Signout(t.Context(), principal, "signout"); err != nil {
		t.Fatalf("signout: %v", err)
	}
	if _, err = service.RestoreSession(t.Context(), signin.SessionToken); !errorIsKind(err, ErrorUnauthenticated) {
		t.Fatalf("revoked session error = %v", err)
	}
	expiring, err := service.Signin(t.Context(), "admin", integrationAdminPassword, "expiring-session")
	if err != nil {
		t.Fatalf("signin expiring session: %v", err)
	}
	if _, err = pool.Exec(t.Context(), `
		UPDATE app_sessions SET idle_expires_at = now() - interval '1 second'
		WHERE token_hash = $1
	`, tokenHash(expiring.SessionToken)); err != nil {
		t.Fatalf("expire session: %v", err)
	}
	if _, err = service.RestoreSession(t.Context(), expiring.SessionToken); !errorIsKind(err, ErrorUnauthenticated) {
		t.Fatalf("expired session error = %v", err)
	}
	var path, reason, requestID string
	err = pool.QueryRow(t.Context(), `
		SELECT summary->>'path', summary->>'reason', request_id
		FROM app_audit_events WHERE event_type = 'AUTHORIZATION_DENIED'
		ORDER BY created_at DESC LIMIT 1
	`).Scan(&path, &reason, &requestID)
	if err != nil || path != "/app/user/profile" || reason != "csrf" || requestID != "old-csrf" {
		t.Fatalf("authorization audit path=%q reason=%q requestID=%q err=%v", path, reason, requestID, err)
	}
}

func TestSuperadminWildcardIntegration(t *testing.T) {
	service, pool, admin := appIntegrationService(t)
	if len(admin.RoleIDs) != 1 {
		t.Fatalf("bootstrap admin roles = %v, want one superadmin role", admin.RoleIDs)
	}
	superadminRoleID := admin.RoleIDs[0]

	var storedGrantCount int64
	if err := pool.QueryRow(t.Context(), `
		SELECT count(*) FROM app_role_permissions WHERE role_id = $1
	`, superadminRoleID).Scan(&storedGrantCount); err != nil {
		t.Fatalf("count stored superadmin grants: %v", err)
	}
	if storedGrantCount != 0 {
		t.Fatalf("stored superadmin grants = %d, want 0", storedGrantCount)
	}

	role, err := service.GetRole(t.Context(), superadminRoleID)
	if err != nil {
		t.Fatalf("get superadmin role: %v", err)
	}
	var enabledPermissionCount int
	if err = pool.QueryRow(t.Context(), `
		SELECT count(*) FROM app_permissions WHERE status = 'ENABLED'
	`).Scan(&enabledPermissionCount); err != nil {
		t.Fatalf("count enabled permissions: %v", err)
	}
	if len(role.PermissionIDs) != enabledPermissionCount {
		t.Fatalf("superadmin role permissions = %d, want %d", len(role.PermissionIDs), enabledPermissionCount)
	}

	signin, err := service.Signin(t.Context(), "admin", integrationAdminPassword, "wildcard-signin")
	if err != nil {
		t.Fatalf("signin superadmin: %v", err)
	}
	if len(signin.Data.Permissions) != enabledPermissionCount || slices.Contains(signin.Data.Permissions, "*") {
		t.Fatalf("expanded signin permissions = %v, want %d paths without wildcard", signin.Data.Permissions, enabledPermissionCount)
	}

	dynamicPermissionID := newID()
	dynamicPermissionPath := "/test/widget/query"
	if _, err = pool.Exec(t.Context(), `
		INSERT INTO app_permissions (id, path, domain, entity, action, description, status)
		VALUES ($1, $2, 'test', 'widget', 'query', 'integration wildcard permission', 'ENABLED')
	`, dynamicPermissionID, dynamicPermissionPath); err != nil {
		t.Fatalf("insert dynamic permission: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM app_permissions WHERE id = $1`, dynamicPermissionID)
	})

	restored, err := service.RestoreSession(t.Context(), signin.SessionToken)
	if err != nil {
		t.Fatalf("restore superadmin after permission insert: %v", err)
	}
	if !slices.Contains(restored.Data.Permissions, dynamicPermissionPath) {
		t.Fatalf("superadmin permissions do not include new catalog path: %v", restored.Data.Permissions)
	}
	if _, err = service.Authorize(t.Context(), signin.SessionToken, restored.Data.CSRFToken, dynamicPermissionPath, "wildcard-authorize"); err != nil {
		t.Fatalf("authorize dynamic permission: %v", err)
	}

	ordinaryRole, err := service.CreateRole(t.Context(), CreateRoleInput{
		Code: "ordinary", Name: "普通角色",
		PermissionIDs: permissionIDsByPath(t, pool, signoutPath),
	}, admin.ID, "create-ordinary-role")
	if err != nil {
		t.Fatalf("create ordinary role: %v", err)
	}
	if _, err = service.CreateRole(t.Context(), CreateRoleInput{
		Code: superadminRoleCode, Name: "重复超级管理员",
		PermissionIDs: permissionIDsByPath(t, pool, signoutPath),
	}, admin.ID, "create-reserved-role"); !errorIsKind(err, ErrorValidation) {
		t.Fatalf("reserved superadmin code error = %v", err)
	}
	_, err = service.CreateUser(t.Context(), CreateUserInput{
		Username: "ordinary-user", DisplayName: "普通用户", Password: integrationUserPassword, RoleIDs: []string{ordinaryRole.ID},
	}, admin.ID, "create-ordinary-user")
	if err != nil {
		t.Fatalf("create ordinary user: %v", err)
	}
	ordinarySignin, err := service.Signin(t.Context(), "ordinary-user", integrationUserPassword, "ordinary-signin")
	if err != nil {
		t.Fatalf("signin ordinary user: %v", err)
	}
	if slices.Contains(ordinarySignin.Data.Permissions, dynamicPermissionPath) {
		t.Fatalf("ordinary role unexpectedly received dynamic permission: %v", ordinarySignin.Data.Permissions)
	}

	if _, err = pool.Exec(t.Context(), `
		UPDATE app_permissions SET status = 'DISABLED', revision = revision + 1 WHERE id = $1
	`, dynamicPermissionID); err != nil {
		t.Fatalf("disable dynamic permission: %v", err)
	}
	refreshed, err := service.RestoreSession(t.Context(), signin.SessionToken)
	if err != nil {
		t.Fatalf("restore superadmin after permission disable: %v", err)
	}
	if slices.Contains(refreshed.Data.Permissions, dynamicPermissionPath) {
		t.Fatalf("disabled permission remained in superadmin permissions: %v", refreshed.Data.Permissions)
	}
	if _, err = service.Authorize(t.Context(), signin.SessionToken, refreshed.Data.CSRFToken, dynamicPermissionPath, "disabled-wildcard"); !errorIsKind(err, ErrorForbidden) {
		t.Fatalf("disabled permission authorization error = %v", err)
	}

	savedRole, err := service.SaveRole(t.Context(), SaveRoleInput{
		ID: superadminRoleID, Name: "Super Administrator", PermissionIDs: nil, Revision: role.Revision,
	}, admin.ID, "save-superadmin")
	if err != nil {
		t.Fatalf("save superadmin without permission IDs: %v", err)
	}
	if len(savedRole.PermissionIDs) != enabledPermissionCount {
		t.Fatalf("saved superadmin permissions = %d, want %d", len(savedRole.PermissionIDs), enabledPermissionCount)
	}
	if err = pool.QueryRow(t.Context(), `
		SELECT count(*) FROM app_role_permissions WHERE role_id = $1
	`, superadminRoleID).Scan(&storedGrantCount); err != nil {
		t.Fatalf("count saved superadmin grants: %v", err)
	}
	if storedGrantCount != 0 {
		t.Fatalf("stored grants after superadmin save = %d, want 0", storedGrantCount)
	}

	if _, err = pool.Exec(t.Context(), `
		UPDATE app_roles SET status = 'DISABLED', revision = revision + 1 WHERE id = $1
	`, superadminRoleID); err != nil {
		t.Fatalf("disable superadmin role directly: %v", err)
	}
	paths, err := service.queries.GetAppUserPermissions(t.Context(), admin.ID)
	if err != nil {
		t.Fatalf("query permissions after superadmin disable: %v", err)
	}
	if len(paths) != 0 {
		t.Fatalf("disabled superadmin role retained permissions: %v", paths)
	}
}

func TestFeedbackSubmissionAndPublishingIntegration(t *testing.T) {
	service, pool, admin := appIntegrationService(t)
	role, err := service.CreateRole(t.Context(), CreateRoleInput{
		Code: "feedback-user", Name: "反馈用户",
		PermissionIDs: permissionIDsByPath(t, pool, signoutPath),
	}, admin.ID, "feedback-role")
	if err != nil {
		t.Fatalf("create feedback role: %v", err)
	}
	user, err := service.CreateUser(t.Context(), CreateUserInput{
		Username: "feedback-user", DisplayName: "反馈用户",
		Password: integrationUserPassword, RoleIDs: []string{role.ID},
	}, admin.ID, "feedback-user")
	if err != nil {
		t.Fatalf("create feedback user: %v", err)
	}
	signin, err := service.Signin(t.Context(), user.Username, integrationUserPassword, "feedback-signin")
	if err != nil {
		t.Fatalf("signin feedback user: %v", err)
	}
	principal, err := service.AuthorizeSession(
		t.Context(), signin.SessionToken, signin.Data.CSRFToken,
		"/app/feedback/create", "feedback-authorize",
	)
	if err != nil {
		t.Fatalf("session-only feedback authorization: %v", err)
	}
	if _, err = service.Authorize(
		t.Context(), signin.SessionToken, signin.Data.CSRFToken,
		"/app/feedback/create", "feedback-permission-check",
	); !errorIsKind(err, ErrorForbidden) {
		t.Fatalf("permission authorization error = %v, want forbidden", err)
	}
	png := append([]byte{0x89, 'P', 'N', 'G', '\r', '\n', 0x1a, '\n'}, []byte("feedback screenshot")...)
	digest := sha256.Sum256(png)
	initiated, err := service.InitiateFeedbackAttachment(t.Context(), FeedbackAttachmentInitiateInput{
		FileName: "截图.png", ContentType: "image/png", Size: int64(len(png)),
		SHA256: hex.EncodeToString(digest[:]),
	}, principal.User.ID)
	if err != nil {
		t.Fatalf("initiate feedback attachment: %v", err)
	}
	uploadToken := strings.TrimPrefix(initiated.UploadURL, "/files/feedback/attachments/upload/")
	if err = service.UploadFeedbackAttachment(
		t.Context(), uploadToken, bytes.NewReader(png), int64(len(png)), "image/png",
	); err != nil {
		t.Fatalf("upload feedback attachment: %v", err)
	}
	created, err := service.CreateFeedback(t.Context(), CreateFeedbackInput{
		Category: FeedbackCategoryBug, Title: "保存失败",
		Content:  "Authorization: Bearer abcdefghijklmnopqrstuvwxyz",
		PagePath: "/vou/sale-order", ClientVersion: "1.0.0",
		AttachmentIDs: []string{initiated.FileID},
	}, principal.User.ID)
	if err != nil {
		t.Fatalf("create feedback: %v", err)
	}
	if created.Status != FeedbackStatusPending || !validID(created.FeedbackID) {
		t.Fatalf("created feedback = %#v", created)
	}
	if err = service.RemoveFeedbackAttachment(t.Context(), initiated.FileID, principal.User.ID); !errorIsKind(err, ErrorConflict) {
		t.Fatalf("remove submitted feedback attachment error = %v, want conflict", err)
	}
	view, err := service.GetFeedback(t.Context(), created.FeedbackID, principal.User.ID)
	if err != nil || view.Status != FeedbackStatusPending || view.IssueURL != nil {
		t.Fatalf("pending feedback = %#v, error = %v", view, err)
	}
	if _, err = service.GetFeedback(t.Context(), created.FeedbackID, admin.ID); !errorIsKind(err, ErrorNotFound) {
		t.Fatalf("other owner error = %v", err)
	}

	client := &integrationIssueClient{}
	publisher := NewFeedbackPublisher(pool, client, slog.New(slog.NewTextHandler(io.Discard, nil)))
	processed, err := publisher.publishOne(t.Context())
	if err != nil || !processed {
		t.Fatalf("publishOne() processed=%t error=%v", processed, err)
	}
	view, err = service.GetFeedback(t.Context(), created.FeedbackID, principal.User.ID)
	if err != nil || view.Status != FeedbackStatusPublished || view.IssueURL == nil ||
		*view.IssueURL != "https://github.com/hansonyu183/zerp-back/issues/17" {
		t.Fatalf("published feedback = %#v, error = %v", view, err)
	}
	if !strings.Contains(client.body, "截图.png") ||
		strings.Contains(client.body, "abcdefghijklmnopqrstuvwxyz") ||
		strings.Contains(client.body, principal.User.ID) {
		t.Fatalf("published issue body = %s", client.body)
	}
	if len(client.labels) < 1 || client.labels[0] != "automation:blocked" {
		t.Fatalf("published labels = %#v", client.labels)
	}
}

func TestFeedbackAttachmentLimitsRemovalAndCleanupIntegration(t *testing.T) {
	service, pool, admin := appIntegrationService(t)
	content := append([]byte{0x89, 'P', 'N', 'G', '\r', '\n', 0x1a, '\n'}, []byte("cleanup")...)
	digest := sha256.Sum256(content)
	initiate := func(name string) FeedbackAttachmentInitiateResult {
		t.Helper()
		result, err := service.InitiateFeedbackAttachment(t.Context(), FeedbackAttachmentInitiateInput{
			FileName: name, ContentType: "image/png", Size: int64(len(content)),
			SHA256: hex.EncodeToString(digest[:]),
		}, admin.ID)
		if err != nil {
			t.Fatalf("initiate %s: %v", name, err)
		}
		return result
	}
	first := initiate("first.png")
	second := initiate("second.png")
	third := initiate("third.png")
	if _, err := service.InitiateFeedbackAttachment(t.Context(), FeedbackAttachmentInitiateInput{
		FileName: "fourth.png", ContentType: "image/png", Size: int64(len(content)),
		SHA256: hex.EncodeToString(digest[:]),
	}, admin.ID); !errorIsKind(err, ErrorConflict) {
		t.Fatalf("fourth active attachment error=%v, want conflict", err)
	}
	if err := service.RemoveFeedbackAttachment(t.Context(), first.FileID, admin.ID); err != nil {
		t.Fatalf("remove pending attachment: %v", err)
	}
	fourth := initiate("fourth.png")
	secondToken := strings.TrimPrefix(second.UploadURL, "/files/feedback/attachments/upload/")
	if err := service.UploadFeedbackAttachment(
		t.Context(), secondToken, bytes.NewReader(content), int64(len(content)), "image/jpeg",
	); !errorIsKind(err, ErrorValidation) {
		t.Fatalf("wrong upload content type error=%v, want validation", err)
	}
	if err := service.UploadFeedbackAttachment(
		t.Context(), secondToken, bytes.NewReader(content), int64(len(content)), "image/png",
	); err != nil {
		t.Fatalf("upload after rejected headers: %v", err)
	}
	if err := service.RemoveFeedbackAttachment(t.Context(), second.FileID, admin.ID); err != nil {
		t.Fatalf("remove ready attachment: %v", err)
	}
	if err := service.RemoveFeedbackAttachment(t.Context(), third.FileID, "01J00000000000000000000001"); !errorIsKind(err, ErrorConflict) {
		t.Fatalf("other owner removal error=%v, want conflict", err)
	}
	if _, err := pool.Exec(t.Context(), `
		UPDATE app_feedback_files
		SET upload_expires_at = now() - interval '1 hour'
		WHERE id = $1
	`, third.FileID); err != nil {
		t.Fatalf("expire pending feedback attachment: %v", err)
	}
	if _, err := pool.Exec(t.Context(), `
		UPDATE app_feedback_files
		SET status = 'READY', stored_at = now(), created_at = now() - interval '25 hours'
		WHERE id = $1
	`, fourth.FileID); err != nil {
		t.Fatalf("age ready feedback attachment: %v", err)
	}
	if _, err := pool.Exec(t.Context(), `
		UPDATE app_feedback_files
		SET removed_at = now() - interval '25 hours'
		WHERE id = ANY($1::text[])
	`, []string{first.FileID, second.FileID}); err != nil {
		t.Fatalf("age deleted feedback attachments: %v", err)
	}
	removed, err := service.CleanupFeedbackAttachments(t.Context(), 10)
	if err != nil || removed != 4 {
		t.Fatalf("cleanup removed=%d error=%v, want 4", removed, err)
	}
	var remaining int
	if err = pool.QueryRow(t.Context(), "SELECT count(*) FROM app_feedback_files").Scan(&remaining); err != nil {
		t.Fatalf("count remaining feedback files: %v", err)
	}
	if remaining != 0 {
		t.Fatalf("remaining feedback files=%d, want 0", remaining)
	}
}

func TestFeedbackRollingDayLimitIntegration(t *testing.T) {
	service, pool, admin := appIntegrationService(t)
	const attempts = 25
	var group sync.WaitGroup
	errorsChannel := make(chan error, attempts)
	for range attempts {
		group.Add(1)
		go func() {
			defer group.Done()
			_, err := service.CreateFeedback(context.Background(), CreateFeedbackInput{
				Category: FeedbackCategoryOther, Title: "反馈", Content: "并发提交",
			}, admin.ID)
			errorsChannel <- err
		}()
	}
	group.Wait()
	close(errorsChannel)
	successes, limited := 0, 0
	for err := range errorsChannel {
		switch {
		case err == nil:
			successes++
		case errorIsKind(err, ErrorValidation):
			limited++
		default:
			t.Fatalf("unexpected feedback error: %v", err)
		}
	}
	if successes != maxFeedbackPerRollingDay || limited != attempts-maxFeedbackPerRollingDay {
		t.Fatalf("feedback results successes=%d limited=%d", successes, limited)
	}
	var stored int
	if err := pool.QueryRow(t.Context(), "SELECT count(*) FROM app_feedback WHERE user_id = $1", admin.ID).Scan(&stored); err != nil {
		t.Fatalf("count feedback: %v", err)
	}
	if stored != maxFeedbackPerRollingDay {
		t.Fatalf("stored feedback = %d, want %d", stored, maxFeedbackPerRollingDay)
	}
}

func TestFeedbackPublishingRecoveryAndFailureIntegration(t *testing.T) {
	service, pool, admin := appIntegrationService(t)
	create := func(title string) FeedbackCreatedView {
		t.Helper()
		result, err := service.CreateFeedback(t.Context(), CreateFeedbackInput{
			Category: FeedbackCategoryOther, Title: title, Content: "发布状态测试",
		}, admin.ID)
		if err != nil {
			t.Fatalf("create %s feedback: %v", title, err)
		}
		return result
	}

	recovered := create("对账恢复")
	existingClient := &integrationExistingIssueClient{}
	publisher := NewFeedbackPublisher(pool, existingClient, slog.New(slog.NewTextHandler(io.Discard, nil)))
	if processed, err := publisher.publishOne(t.Context()); err != nil || !processed {
		t.Fatalf("reconcile publish processed=%t error=%v", processed, err)
	}
	recoveredView, err := service.GetFeedback(t.Context(), recovered.FeedbackID, admin.ID)
	if err != nil || recoveredView.Status != FeedbackStatusPublished ||
		recoveredView.IssueURL == nil || !strings.HasSuffix(*recoveredView.IssueURL, "/18") ||
		existingClient.createCalls != 0 {
		t.Fatalf("recovered feedback=%#v createCalls=%d error=%v", recoveredView, existingClient.createCalls, err)
	}

	permanent := create("永久失败")
	publisher = NewFeedbackPublisher(pool, integrationFailingIssueClient{
		err: integrationPublishFailure{retryable: false},
	}, slog.New(slog.NewTextHandler(io.Discard, nil)))
	if processed, err := publisher.publishOne(t.Context()); err != nil || !processed {
		t.Fatalf("permanent failure processed=%t error=%v", processed, err)
	}
	permanentView, err := service.GetFeedback(t.Context(), permanent.FeedbackID, admin.ID)
	if err != nil || permanentView.Status != FeedbackStatusFailed {
		t.Fatalf("permanent feedback=%#v error=%v", permanentView, err)
	}

	retrying := create("暂时失败")
	publisher = NewFeedbackPublisher(pool, integrationFailingIssueClient{
		err: integrationPublishFailure{retryable: true},
	}, slog.New(slog.NewTextHandler(io.Discard, nil)))
	if processed, err := publisher.publishOne(t.Context()); err != nil || !processed {
		t.Fatalf("retrying failure processed=%t error=%v", processed, err)
	}
	retryingView, err := service.GetFeedback(t.Context(), retrying.FeedbackID, admin.ID)
	if err != nil || retryingView.Status != FeedbackStatusPending {
		t.Fatalf("retrying feedback=%#v error=%v", retryingView, err)
	}

	exhausted := create("重试耗尽")
	if _, err = pool.Exec(t.Context(), "UPDATE app_feedback SET attempt_count = 9 WHERE id = $1", exhausted.FeedbackID); err != nil {
		t.Fatalf("prepare exhausted feedback: %v", err)
	}
	publisher = NewFeedbackPublisher(pool, integrationFailingIssueClient{
		err: integrationPublishFailure{retryable: true},
	}, slog.New(slog.NewTextHandler(io.Discard, nil)))
	if processed, err := publisher.publishOne(t.Context()); err != nil || !processed {
		t.Fatalf("exhausted failure processed=%t error=%v", processed, err)
	}
	exhaustedView, err := service.GetFeedback(t.Context(), exhausted.FeedbackID, admin.ID)
	if err != nil || exhaustedView.Status != FeedbackStatusFailed {
		t.Fatalf("exhausted feedback=%#v error=%v", exhaustedView, err)
	}
}

func TestSigninLockAndPasswordRevocationIntegration(t *testing.T) {
	service, _, _ := appIntegrationService(t)
	for attempt := 0; attempt < 2; attempt++ {
		if _, err := service.Signin(t.Context(), "admin", "Wrong-password-1!", "wrong"); !errorIsKind(err, ErrorUnauthenticated) {
			t.Fatalf("wrong password attempt %d: %v", attempt+1, err)
		}
	}
	if _, err := service.Signin(t.Context(), "admin", integrationAdminPassword, "locked"); !errorIsKind(err, ErrorUnauthenticated) {
		t.Fatalf("locked account signin error = %v", err)
	}

	service, _, _ = appIntegrationService(t)
	first, err := service.Signin(t.Context(), "admin", integrationAdminPassword, "first")
	if err != nil {
		t.Fatalf("first signin: %v", err)
	}
	second, err := service.Signin(t.Context(), "admin", integrationAdminPassword, "second")
	if err != nil {
		t.Fatalf("second signin: %v", err)
	}
	principal, err := service.Authorize(t.Context(), first.SessionToken, first.Data.CSRFToken, "/app/user/change-password", "password-authorize")
	if err != nil {
		t.Fatalf("authorize password change: %v", err)
	}
	if err = service.ChangePassword(t.Context(), principal, ChangePasswordInput{
		CurrentPassword: integrationAdminPassword,
		NewPassword:     "Changed-password-2!",
	}, "password-change"); err != nil {
		t.Fatalf("change password: %v", err)
	}
	for _, token := range []string{first.SessionToken, second.SessionToken} {
		if _, err = service.RestoreSession(t.Context(), token); !errorIsKind(err, ErrorUnauthenticated) {
			t.Fatalf("old session remained valid: %v", err)
		}
	}
	if _, err = service.Signin(t.Context(), "admin", integrationAdminPassword, "old-password"); !errorIsKind(err, ErrorUnauthenticated) {
		t.Fatalf("old password error = %v", err)
	}
	if _, err = service.Signin(t.Context(), "admin", "Changed-password-2!", "new-password"); err != nil {
		t.Fatalf("new password signin: %v", err)
	}
}

func TestAuthorizationChangesAreImmediateIntegration(t *testing.T) {
	service, pool, admin := appIntegrationService(t)
	pathsA := []string{signoutPath, "/bob/customer/query"}
	pathsB := []string{signoutPath, "/bob/supplier/query"}
	roleA, err := service.CreateRole(t.Context(), CreateRoleInput{
		Code: "customer-reader", Name: "客户查看", PermissionIDs: permissionIDsByPath(t, pool, pathsA...),
	}, admin.ID, "role-a")
	if err != nil {
		t.Fatalf("create role A: %v", err)
	}
	roleB, err := service.CreateRole(t.Context(), CreateRoleInput{
		Code: "supplier-reader", Name: "供应商查看", PermissionIDs: permissionIDsByPath(t, pool, pathsB...),
	}, admin.ID, "role-b")
	if err != nil {
		t.Fatalf("create role B: %v", err)
	}
	user, err := service.CreateUser(t.Context(), CreateUserInput{
		Username: "reader", DisplayName: strings.Repeat("中", 128), Password: integrationUserPassword,
		RoleIDs: []string{roleA.ID, roleB.ID},
	}, admin.ID, "create-reader")
	if err != nil {
		t.Fatalf("create reader: %v", err)
	}
	signin, err := service.Signin(t.Context(), "reader", integrationUserPassword, "reader-signin")
	if err != nil {
		t.Fatalf("reader signin: %v", err)
	}
	for _, path := range append(pathsA, pathsB...) {
		if !slices.Contains(signin.Data.Permissions, path) {
			t.Fatalf("permissions %v missing %s", signin.Data.Permissions, path)
		}
	}
	if _, err = service.SetRoleStatus(t.Context(), roleA.ID, roleA.Revision, StatusDisabled, admin.ID, "disable-role-a"); err != nil {
		t.Fatalf("disable role A: %v", err)
	}
	if _, err = service.Authorize(t.Context(), signin.SessionToken, signin.Data.CSRFToken, "/bob/customer/query", "revoked-permission"); !errorIsKind(err, ErrorForbidden) {
		t.Fatalf("revoked permission error = %v", err)
	}
	if _, err = service.Authorize(t.Context(), signin.SessionToken, signin.Data.CSRFToken, "/bob/supplier/query", "retained-permission"); err != nil {
		t.Fatalf("retained permission: %v", err)
	}
	if _, err = service.SetUserStatus(t.Context(), user.ID, user.Revision, StatusDisabled, admin.ID, "disable-reader"); err != nil {
		t.Fatalf("disable reader: %v", err)
	}
	if _, err = service.RestoreSession(t.Context(), signin.SessionToken); !errorIsKind(err, ErrorUnauthenticated) {
		t.Fatalf("disabled user session error = %v", err)
	}
}

func TestManagementContractsIntegration(t *testing.T) {
	service, pool, admin := appIntegrationService(t)
	if _, err := service.SetUserStatus(t.Context(), admin.ID, admin.Revision, StatusDisabled, admin.ID, "disable-last-admin"); !errorIsKind(err, ErrorConflict) {
		t.Fatalf("disable last admin error = %v", err)
	}
	if _, err := service.CreateRole(t.Context(), CreateRoleInput{
		Code: "missing-query", Name: "缺少查询权限",
		PermissionIDs: permissionIDsByPath(t, pool, signoutPath, "/app/user/get"),
	}, admin.ID, "reject-role-without-query"); !errorIsKind(err, ErrorValidation) {
		t.Fatalf("missing companion query error = %v", err)
	}
	if _, err := service.CreateRole(t.Context(), CreateRoleInput{
		Code: "missing-opening-get", Name: "缺少账簿期初查看权限",
		PermissionIDs: permissionIDsByPath(t, pool, signoutPath, "/led/opening/activate"),
	}, admin.ID, "reject-led-role-without-opening-get"); !errorIsKind(err, ErrorValidation) {
		t.Fatalf("missing LED opening get error = %v", err)
	}
	role := RoleView{}
	role, err := service.CreateRole(t.Context(), CreateRoleInput{
		Code: "user-reader", Name: "用户查看",
		PermissionIDs: permissionIDsByPath(
			t, pool, signoutPath, "/app/user/query", "/app/user/get",
			"/led/opening/get", "/led/opening/activate",
		),
	}, admin.ID, "create-role")
	if err != nil {
		t.Fatalf("create role: %v", err)
	}
	expectedPermissionIDs := permissionIDsByPath(
		t, pool, "/app/user/get", "/app/user/query", signoutPath,
		"/led/opening/activate", "/led/opening/get",
	)
	gotRole, err := service.GetRole(t.Context(), role.ID)
	if err != nil || !slices.Equal(gotRole.PermissionIDs, expectedPermissionIDs) {
		t.Fatalf("role permissions = %v, want %v, err=%v", gotRole.PermissionIDs, expectedPermissionIDs, err)
	}
	role, err = service.SaveRole(t.Context(), SaveRoleInput{
		ID: role.ID, Name: "用户与账簿查看", PermissionIDs: expectedPermissionIDs, Revision: gotRole.Revision,
	}, admin.ID, "save-role-with-led-permission")
	if err != nil {
		t.Fatalf("save role with LED permission: %v", err)
	}
	user, err := service.CreateUser(t.Context(), CreateUserInput{
		Username: "managed", DisplayName: "初始名称", Password: integrationUserPassword, RoleIDs: []string{role.ID},
	}, admin.ID, "create-managed")
	if err != nil {
		t.Fatalf("create user: %v", err)
	}

	start := make(chan struct{})
	results := make(chan error, 2)
	var wait sync.WaitGroup
	for _, name := range []string{"并发修改一", "并发修改二"} {
		wait.Add(1)
		go func(displayName string) {
			defer wait.Done()
			<-start
			_, saveErr := service.SaveUser(t.Context(), SaveUserInput{
				ID: user.ID, DisplayName: displayName, RoleIDs: []string{role.ID}, Revision: user.Revision,
			}, admin.ID, "concurrent-save")
			results <- saveErr
		}(name)
	}
	close(start)
	wait.Wait()
	close(results)
	successes, conflicts := 0, 0
	for result := range results {
		switch {
		case result == nil:
			successes++
		case errorIsKind(result, ErrorConflict):
			conflicts++
		default:
			t.Fatalf("unexpected concurrent result: %v", result)
		}
	}
	if successes != 1 || conflicts != 1 {
		t.Fatalf("concurrent results: successes=%d conflicts=%d", successes, conflicts)
	}

	current, err := service.GetUser(t.Context(), user.ID)
	if err != nil {
		t.Fatalf("get current user: %v", err)
	}
	_, err = service.SaveUser(t.Context(), SaveUserInput{
		ID: user.ID, DisplayName: "不应提交", RoleIDs: []string{newID()}, Revision: current.Revision,
	}, admin.ID, "rollback-invalid-role")
	if !errorIsKind(err, ErrorValidation) {
		t.Fatalf("invalid role error = %v", err)
	}
	after, _ := service.GetUser(t.Context(), user.ID)
	if after.DisplayName != current.DisplayName || after.Revision != current.Revision {
		t.Fatalf("failed save changed user: before=%+v after=%+v", current, after)
	}
	roleBefore, err := service.GetRole(t.Context(), role.ID)
	if err != nil {
		t.Fatalf("get role before rollback: %v", err)
	}
	_, err = service.SaveRole(t.Context(), SaveRoleInput{
		ID: role.ID, Name: "不应提交", PermissionIDs: []string{newID()}, Revision: roleBefore.Revision,
	}, admin.ID, "rollback-invalid-permission")
	if !errorIsKind(err, ErrorValidation) {
		t.Fatalf("invalid permission error = %v", err)
	}
	roleAfter, _ := service.GetRole(t.Context(), role.ID)
	if roleAfter.Name != roleBefore.Name || roleAfter.Revision != roleBefore.Revision || !slices.Equal(roleAfter.PermissionIDs, roleBefore.PermissionIDs) {
		t.Fatalf("failed save changed role: before=%+v after=%+v", roleBefore, roleAfter)
	}
	unsafeRole, err := service.CreateRole(t.Context(), CreateRoleInput{
		Code: "unsafe-reader", Name: "不安全角色",
		PermissionIDs: permissionIDsByPath(t, pool, "/app/user/query"),
	}, admin.ID, "create-unsafe-role")
	if err != nil {
		t.Fatalf("create unsafe role: %v", err)
	}
	if _, err = service.CreateUser(t.Context(), CreateUserInput{
		Username: "unsafe-user", DisplayName: "无法退出", Password: integrationUserPassword, RoleIDs: []string{unsafeRole.ID},
	}, admin.ID, "reject-unsafe-user"); !errorIsKind(err, ErrorValidation) {
		t.Fatalf("unsafe user error = %v", err)
	}
	unsafePage, err := service.QueryUsers(t.Context(), PageRequest{Filters: map[string]string{"search": "unsafe-user"}})
	if err != nil || len(unsafePage.Items) != 0 {
		t.Fatalf("unsafe user transaction was not rolled back: items=%v err=%v", unsafePage.Items, err)
	}
	missing := newID()
	_, err = service.SaveUser(t.Context(), SaveUserInput{
		ID: missing, DisplayName: "Missing", RoleIDs: []string{role.ID}, Revision: 1,
	}, admin.ID, "missing-user")
	if !errorIsKind(err, ErrorNotFound) {
		t.Fatalf("missing user error = %v", err)
	}
	if _, err = service.SetRoleStatus(t.Context(), role.ID, role.Revision, StatusEnabled, admin.ID, "unchanged-role"); !errorIsKind(err, ErrorConflict) {
		t.Fatalf("unchanged role status error = %v", err)
	}
}

func TestQueryAndPermissionCatalogIntegration(t *testing.T) {
	service, pool, _ := appIntegrationService(t)
	if _, err := service.QueryUsers(t.Context(), PageRequest{Filters: map[string]string{"unknown": "value"}}); !errorIsKind(err, ErrorValidation) {
		t.Fatalf("unknown user filter error = %v", err)
	}
	if _, err := service.QueryRoles(t.Context(), PageRequest{Page: int(^uint(0) >> 1), PageSize: 200}); !errorIsKind(err, ErrorValidation) {
		t.Fatalf("overflow pagination error = %v", err)
	}
	page, err := service.QueryPermissions(t.Context(), PageRequest{
		Page: 1, PageSize: 200, Filters: map[string]string{"domain": "app"},
		Sort: []SortItem{{Field: "path", Order: "desc"}},
	})
	if err != nil {
		t.Fatalf("query permissions: %v", err)
	}
	if len(page.Items) < 2 || page.Items[0].Path < page.Items[1].Path {
		t.Fatalf("permissions are not descending: %+v", page.Items)
	}
	expectedProtected := []string{
		"/app/permission/get", "/app/permission/query",
		"/app/role/create", "/app/role/disable", "/app/role/enable", "/app/role/get", "/app/role/query", "/app/role/save",
		"/app/user/change-password", "/app/user/create", "/app/user/disable", "/app/user/enable", "/app/user/get",
		"/app/user/profile", "/app/user/query", "/app/user/save", "/app/user/signout",
	}
	rows, err := pool.Query(t.Context(), `SELECT path FROM app_permissions WHERE domain = 'app' ORDER BY path`)
	if err != nil {
		t.Fatalf("query APP permission catalog: %v", err)
	}
	defer rows.Close()
	actual := make([]string, 0, len(expectedProtected))
	for rows.Next() {
		var path string
		if err = rows.Scan(&path); err != nil {
			t.Fatalf("scan permission path: %v", err)
		}
		actual = append(actual, path)
	}
	if !slices.Equal(actual, expectedProtected) {
		t.Fatalf("APP permission catalog = %v, want %v", actual, expectedProtected)
	}
	ledPermissionID := permissionIDsByPath(t, pool, "/led/opening/get")[0]
	ledPermission, err := service.GetPermission(t.Context(), ledPermissionID)
	if err != nil || ledPermission.ID != ledPermissionID || ledPermission.Path != "/led/opening/get" {
		t.Fatalf("get LED permission = %+v, err=%v", ledPermission, err)
	}
}

func TestDatabaseRejectsInvalidAPPRelations(t *testing.T) {
	_, pool, _ := appIntegrationService(t)
	_, err := pool.Exec(t.Context(), `
		INSERT INTO app_user_roles (user_id, role_id)
		VALUES ('01J00000000000000000000000', '01J00000000000000000000001')
	`)
	if err == nil || errors.Is(err, pgx.ErrNoRows) {
		t.Fatalf("invalid relation error = %v", err)
	}
}

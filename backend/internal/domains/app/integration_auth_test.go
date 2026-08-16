//go:build integration

package app

import (
	"context"
	"slices"
	"strings"
	"testing"
)

func TestAuthenticationAndSessionIntegration(t *testing.T) {
	service, pool, _ := appIntegrationService(t)
	signin, err := service.Signin(t.Context(), " ADMIN ", integrationAdminPassword, "signin-success")
	if err != nil {
		t.Fatalf("signin: %v", err)
	}
	if signin.SessionToken == "" || signin.Data.CSRFToken == "" {
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

func TestPasswordChangeRequiredSessionIntegration(t *testing.T) {
	service, pool, admin := appIntegrationService(t)
	role, err := service.CreateRole(t.Context(), CreateRoleInput{
		Code: "restricted-reader", Name: "受限读取", PermissionIDs: permissionIDsByPath(t, pool, "/bob/customer/query"),
	}, admin.ID, "create-restricted-reader")
	if err != nil {
		t.Fatalf("create role: %v", err)
	}
	user, err := service.CreateUser(t.Context(), CreateUserInput{
		Username: "restricted-user", DisplayName: "受限用户", Password: integrationUserPassword, RoleIDs: []string{role.ID},
	}, admin.ID, "create-restricted-user")
	if err != nil {
		t.Fatalf("create user: %v", err)
	}
	signin, err := service.Signin(t.Context(), user.Username, integrationUserPassword, "restricted-signin")
	if err != nil || !signin.Data.PasswordChangeRequired {
		t.Fatalf("restricted signin=%+v err=%v", signin.Data, err)
	}
	if _, err = service.Authorize(t.Context(), signin.SessionToken, signin.Data.CSRFToken, "/bob/customer/query", "restricted-business"); !errorIsKind(err, ErrorForbidden) {
		t.Fatalf("restricted business authorization error = %v", err)
	}
	principal, err := service.Authorize(t.Context(), signin.SessionToken, signin.Data.CSRFToken, changePasswordPath, "restricted-change-password")
	if err != nil {
		t.Fatalf("restricted change password authorization: %v", err)
	}
	if err = service.ChangePassword(t.Context(), principal, ChangePasswordInput{CurrentPassword: integrationUserPassword, NewPassword: "Changed-password-3!"}, "restricted-change"); err != nil {
		t.Fatalf("change restricted password: %v", err)
	}
	if _, err = service.RestoreSession(t.Context(), signin.SessionToken); !errorIsKind(err, ErrorUnauthenticated) {
		t.Fatalf("changed restricted session must be revoked: %v", err)
	}
	newSignin, err := service.Signin(t.Context(), user.Username, "Changed-password-3!", "restricted-new-signin")
	if err != nil || newSignin.Data.PasswordChangeRequired {
		t.Fatalf("new restricted signin=%+v err=%v", newSignin.Data, err)
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
		PermissionIDs: permissionIDsByPath(t, pool, "/bob/customer/query"),
	}, admin.ID, "create-ordinary-role")
	if err != nil {
		t.Fatalf("create ordinary role: %v", err)
	}
	if _, err = service.CreateRole(t.Context(), CreateRoleInput{
		Code: superadminRoleCode, Name: "重复超级管理员",
		PermissionIDs: permissionIDsByPath(t, pool, "/bob/customer/query"),
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

func TestSigninLockAndPasswordRevocationIntegration(t *testing.T) {
	service, _, _ := appIntegrationService(t)
	if _, err := service.Signin(t.Context(), "admin", "Wrong-password-1!", "wrong-1"); !errorIsKind(err, ErrorUnauthenticated) || err.Error() != "密码错误，剩余重试次数 1。" {
		t.Fatalf("first wrong password error = %v", err)
	}
	if _, err := service.Signin(t.Context(), "admin", "Wrong-password-1!", "wrong-2"); !errorIsKind(err, ErrorUnauthenticated) || err.Error() != "密码错误，剩余重试次数 0。账号已临时锁定，请稍后重试。" {
		t.Fatalf("second wrong password error = %v", err)
	}
	if _, err := service.Signin(t.Context(), "admin", integrationAdminPassword, "locked"); !errorIsKind(err, ErrorUnauthenticated) || err.Error() != "账号已临时锁定，请稍后重试。" {
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
	pathsA := []string{"/bob/customer/query"}
	pathsB := []string{"/bob/supplier/query"}
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
	signin = completeRequiredPasswordChange(t, service, signin, integrationUserPassword, "Reader-password-2!")
	user, err = service.GetUser(t.Context(), user.ID)
	if err != nil {
		t.Fatalf("refresh reader after password change: %v", err)
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

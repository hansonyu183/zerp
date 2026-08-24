//go:build integration

package app

import (
	"errors"
	"slices"
	"strings"
	"sync"
	"testing"

	"github.com/hansonyu183/zerp/backend/internal/platform/systemidentity"
	"github.com/jackc/pgx/v5"
)

func TestManagementContractsIntegration(t *testing.T) {
	service, pool, admin := appIntegrationService(t)
	if _, err := service.SetUserStatus(t.Context(), admin.ID, admin.Revision, StatusDisabled, integrationPrincipal(admin.ID), "disable-last-admin"); !errorIsKind(err, ErrorConflict) {
		t.Fatalf("disable last admin error = %v", err)
	}
	catalogPermissionIDs := permissionIDsByPath(
		t, pool,
		"/bob/customer/query", "/bob/customer/get",
		"/bob/customer/unapprove", "/bob/customer/enable", "/bob/customer/disable",
		"/aux/department/query", "/aux/asset-category/query",
		"/vou/sale-order/query", "/vou/sale-order/get",
		"/wfl/process-instance/query", "/wfl/process-instance/get",
	)
	slices.Sort(catalogPermissionIDs)
	catalogRole, catalogErr := service.CreateRole(t.Context(), CreateRoleInput{Name: "VOU WFL 查看",
		PermissionIDs: catalogPermissionIDs,
	}, integrationPrincipal(admin.ID), "create-role-with-seeded-permissions")
	if catalogErr != nil {
		t.Fatalf("create role with VOU/WFL seeded permissions: %v", catalogErr)
	}
	catalogRolePermissionIDs := rolePermissionIDs(catalogRole)
	slices.Sort(catalogRolePermissionIDs)
	if !slices.Equal(catalogRolePermissionIDs, catalogPermissionIDs) {
		t.Fatalf("catalog role permissions = %v, want %v", catalogRolePermissionIDs, catalogPermissionIDs)
	}
	if _, err := service.CreateRole(t.Context(), CreateRoleInput{Name: "独立查看权限",
		PermissionIDs: permissionIDsByPath(t, pool, "/app/user/get"),
	}, integrationPrincipal(admin.ID), "allow-role-without-query"); err != nil {
		t.Fatalf("independent get permission error = %v", err)
	}
	if _, err := service.CreateRole(t.Context(), CreateRoleInput{Name: "独立结账权限",
		PermissionIDs: permissionIDsByPath(t, pool, "/acc/period/lock"),
	}, integrationPrincipal(admin.ID), "allow-led-role-without-get"); err != nil {
		t.Fatalf("independent close permission error = %v", err)
	}
	role, err := service.CreateRole(t.Context(), CreateRoleInput{Name: "用户查看",
		PermissionIDs: permissionIDsByPath(
			t, pool, "/app/user/query", "/app/user/get",
			"/acc/book/get", "/acc/period/lock",
		),
	}, integrationPrincipal(admin.ID), "create-role")
	if err != nil {
		t.Fatalf("create role: %v", err)
	}
	expectedPermissionIDs := permissionIDsByPath(
		t, pool, "/app/user/get", "/app/user/query",
		"/acc/book/get", "/acc/period/lock",
	)
	gotRole, err := service.GetRole(t.Context(), role.ID, integrationPrincipal(admin.ID))
	slices.Sort(expectedPermissionIDs)
	gotRolePermissionIDs := rolePermissionIDs(gotRole)
	slices.Sort(gotRolePermissionIDs)
	if err != nil || !slices.Equal(gotRolePermissionIDs, expectedPermissionIDs) {
		t.Fatalf("role permissions = %v, want %v, err=%v", gotRolePermissionIDs, expectedPermissionIDs, err)
	}
	role, err = service.SaveRole(t.Context(), SaveRoleInput{
		ID: role.ID, Name: "用户与账簿查看", PermissionIDs: expectedPermissionIDs, Revision: gotRole.Revision,
	}, integrationPrincipal(admin.ID), "save-role-with-acc-permission")
	if err != nil {
		t.Fatalf("save role with ACC permission: %v", err)
	}
	user, err := service.CreateUser(t.Context(), CreateUserInput{
		Username: "managed", DisplayName: "初始名称", Password: integrationUserPassword, RoleIDs: []string{role.ID},
	}, integrationPrincipal(admin.ID), "create-managed")
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
			}, integrationPrincipal(admin.ID), "concurrent-save")
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

	current, err := service.GetUserDetail(t.Context(), user.ID, integrationPrincipal(admin.ID))
	if err != nil {
		t.Fatalf("get current user: %v", err)
	}
	_, err = service.SaveUser(t.Context(), SaveUserInput{
		ID: user.ID, DisplayName: "不应提交", RoleIDs: []string{newID()}, Revision: current.Revision,
	}, integrationPrincipal(admin.ID), "rollback-invalid-role")
	if !errorIsKind(err, ErrorValidation) {
		t.Fatalf("invalid role error = %v", err)
	}
	after, _ := service.GetUserDetail(t.Context(), user.ID, integrationPrincipal(admin.ID))
	if after.DisplayName != current.DisplayName || after.Revision != current.Revision {
		t.Fatalf("failed save changed user: before=%+v after=%+v", current, after)
	}
	roleBefore, err := service.GetRole(t.Context(), role.ID, integrationPrincipal(admin.ID))
	if err != nil {
		t.Fatalf("get role before rollback: %v", err)
	}
	_, err = service.SaveRole(t.Context(), SaveRoleInput{
		ID: role.ID, Name: "不应提交", PermissionIDs: []string{newID()}, Revision: roleBefore.Revision,
	}, integrationPrincipal(admin.ID), "rollback-invalid-permission")
	if !errorIsKind(err, ErrorValidation) {
		t.Fatalf("invalid permission error = %v", err)
	}
	roleAfter, _ := service.GetRole(t.Context(), role.ID, integrationPrincipal(admin.ID))
	if roleAfter.Name != roleBefore.Name || roleAfter.Revision != roleBefore.Revision || !slices.Equal(rolePermissionIDs(roleAfter), rolePermissionIDs(roleBefore)) {
		t.Fatalf("failed save changed role: before=%+v after=%+v", roleBefore, roleAfter)
	}
	missing := newID()
	_, err = service.SaveUser(t.Context(), SaveUserInput{
		ID: missing, DisplayName: "Missing", RoleIDs: []string{role.ID}, Revision: 1,
	}, integrationPrincipal(admin.ID), "missing-user")
	if !errorIsKind(err, ErrorNotFound) {
		t.Fatalf("missing user error = %v", err)
	}
	if _, err = service.SetRoleStatus(t.Context(), role.ID, role.Revision, StatusEnabled, integrationPrincipal(admin.ID), "unchanged-role"); !errorIsKind(err, ErrorConflict) {
		t.Fatalf("unchanged role status error = %v", err)
	}
}

func TestQueryAndPermissionCatalogIntegration(t *testing.T) {
	service, pool, admin := appIntegrationService(t)
	for _, request := range []PageRequest{
		{Page: 1, PageSize: 10, Sort: []SortItem{{Field: "username", Order: "asc"}}},
		{Page: 1, PageSize: 20, Sort: []SortItem{{Field: "username", Order: "desc"}}},
		{Page: 1, PageSize: 20, Sort: []SortItem{{Field: "username", Order: "asc"}, {Field: "username", Order: "asc"}}},
	} {
		if _, err := service.QueryUsers(t.Context(), request, integrationPrincipal(admin.ID)); !errorIsKind(err, ErrorValidation) {
			t.Fatalf("strict user query must reject %#v: %v", request, err)
		}
	}
	if _, err := service.QueryUsers(t.Context(), PageRequest{Filters: map[string]string{"unknown": "value"}}, integrationPrincipal(admin.ID)); !errorIsKind(err, ErrorValidation) {
		t.Fatalf("unknown user filter error = %v", err)
	}
	if _, err := service.QueryRoles(t.Context(), PageRequest{Page: int(^uint(0) >> 1), PageSize: 200}, integrationPrincipal(admin.ID)); !errorIsKind(err, ErrorValidation) {
		t.Fatalf("overflow pagination error = %v", err)
	}
	page, err := service.QueryPermissions(t.Context(), PageRequest{
		Page: 1, PageSize: 20, Filters: map[string]string{"domain": "app"},
		Sort: []SortItem{{Field: "path", Order: "asc"}},
	}, integrationPrincipal(admin.ID))
	if err != nil {
		t.Fatalf("query permissions: %v", err)
	}
	if len(page.Items) < 2 || page.Items[0].Path > page.Items[1].Path {
		t.Fatalf("permissions are not ascending: %+v", page.Items)
	}
	if _, err = service.QueryPermissions(t.Context(), PageRequest{
		Page: 1, PageSize: 200, Sort: []SortItem{{Field: "path", Order: "asc"}},
	}, integrationPrincipal(admin.ID)); !errorIsKind(err, ErrorValidation) {
		t.Fatalf("non-fixed permission page size error = %v", err)
	}
	expectedProtected := []string{
		"/app/menu/activate", "/app/menu/reset-business", "/app/menu/save-business",
		"/app/permission/get", "/app/permission/query",
		"/app/role/create", "/app/role/disable", "/app/role/enable", "/app/role/get", "/app/role/query", "/app/role/save",
		"/app/system-parameter/get", "/app/system-parameter/query", "/app/system-parameter/reset", "/app/system-parameter/save",
		"/app/user/create", "/app/user/disable", "/app/user/enable", "/app/user/get",
		"/app/user/query", "/app/user/reset-password", "/app/user/save",
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
	accPermissionID := permissionIDsByPath(t, pool, "/acc/book/get")[0]
	accPermission, err := service.GetPermission(t.Context(), accPermissionID, integrationPrincipal(admin.ID))
	if err != nil || accPermission.Path != "/acc/book/get" {
		t.Fatalf("get ACC permission = %+v, err=%v", accPermission, err)
	}
}

func TestUserManagementSecurityIntegration(t *testing.T) {
	service, pool, admin := appIntegrationService(t)
	restoreAPPSystemIdentity(t, pool)
	role, err := service.CreateRole(t.Context(), CreateRoleInput{Name: "受管用户角色", PermissionIDs: permissionIDsByPath(t, pool, "/app/user/query")}, integrationPrincipal(admin.ID), "create-managed-reader")
	if err != nil {
		t.Fatalf("create managed role: %v", err)
	}
	user, err := service.CreateUser(t.Context(), CreateUserInput{
		Username: "managed-security", DisplayName: "受管用户", Password: integrationUserPassword, RoleIDs: []string{role.ID},
	}, integrationPrincipal(admin.ID), "create-managed-security")
	if err != nil {
		t.Fatalf("create managed user: %v", err)
	}
	detail, err := service.GetUserDetail(t.Context(), user.ID, integrationPrincipal(admin.ID))
	if err != nil || len(detail.Roles) != 1 || detail.Roles[0].Code != role.Code || detail.Roles[0].Name != role.Name || detail.Roles[0].Status != StatusEnabled {
		t.Fatalf("detail role summary=%+v err=%v", detail.Roles, err)
	}
	if _, err = service.SetRoleStatus(t.Context(), role.ID, role.Revision, StatusDisabled, integrationPrincipal(admin.ID), "disable-managed-role"); err != nil {
		t.Fatalf("disable managed role: %v", err)
	}
	selfSaved, err := service.SaveUser(t.Context(), SaveUserInput{ID: user.ID, DisplayName: "受管用户更新", RoleIDs: []string{role.ID}, Revision: user.Revision}, integrationPrincipal(user.ID), "self-save-disabled-role")
	if err != nil || selfSaved.DisplayName != "受管用户更新" {
		t.Fatalf("self save with disabled role=%+v err=%v", selfSaved, err)
	}
	user = selfSaved
	if _, err = service.SaveUser(t.Context(), SaveUserInput{ID: user.ID, DisplayName: user.DisplayName, RoleIDs: []string{newID()}, Revision: user.Revision}, integrationPrincipal(user.ID), "self-role-forgery"); !errorIsKind(err, ErrorForbidden) {
		t.Fatalf("self role forgery error=%v", err)
	}
	if _, err = service.SetUserStatus(t.Context(), user.ID, user.Revision, StatusDisabled, integrationPrincipal(user.ID), "self-disable"); !errorIsKind(err, ErrorConflict) {
		t.Fatalf("self disable error=%v", err)
	}
	if _, err = service.SetUserStatus(t.Context(), user.ID, user.Revision, StatusEnabled, integrationPrincipal(user.ID), "self-enable"); !errorIsKind(err, ErrorConflict) {
		t.Fatalf("self enable error=%v", err)
	}
	system, err := service.GetUserDetail(t.Context(), systemidentity.UserID, integrationPrincipal(admin.ID))
	if err != nil {
		t.Fatalf("get system user: %v", err)
	}
	if _, err = service.SetUserStatus(t.Context(), system.ID, system.Revision, StatusEnabled, integrationPrincipal(admin.ID), "system-enable"); !errorIsKind(err, ErrorConflict) {
		t.Fatalf("system status error=%v", err)
	}
	if _, err = service.SetUserStatus(t.Context(), system.ID, system.Revision, StatusDisabled, integrationPrincipal(admin.ID), "system-disable"); !errorIsKind(err, ErrorConflict) {
		t.Fatalf("system disable error=%v", err)
	}
	signin, err := service.Signin(t.Context(), user.Username, integrationUserPassword, "managed-session")
	if err != nil {
		t.Fatalf("signin managed user: %v", err)
	}
	disabled, err := service.SetUserStatus(t.Context(), user.ID, user.Revision, StatusDisabled, integrationPrincipal(admin.ID), "disable-managed")
	if err != nil {
		t.Fatalf("disable managed user: %v", err)
	}
	if _, err = restoreSessionForTest(service, t.Context(), signin.SessionToken); !errorIsKind(err, ErrorUnauthenticated) {
		t.Fatalf("disabled session remains valid: %v", err)
	}
	if _, err = service.ResetUserPassword(t.Context(), ResetPasswordInput{ID: user.ID, Revision: disabled.Revision}, integrationPrincipal(admin.ID), "reset-disabled"); !errorIsKind(err, ErrorConflict) {
		t.Fatalf("reset disabled error=%v", err)
	}
	stillDisabled, err := service.GetUserDetail(t.Context(), user.ID, integrationPrincipal(admin.ID))
	if err != nil || stillDisabled.Status != StatusDisabled {
		t.Fatalf("disabled reset changed user=%+v err=%v", stillDisabled, err)
	}
	enabled, err := service.SetUserStatus(t.Context(), user.ID, disabled.Revision, StatusEnabled, integrationPrincipal(admin.ID), "enable-managed")
	if err != nil {
		t.Fatalf("enable managed user: %v", err)
	}
	if _, err = restoreSessionForTest(service, t.Context(), signin.SessionToken); !errorIsKind(err, ErrorUnauthenticated) {
		t.Fatalf("enabled user revived an old session: %v", err)
	}
	if _, err = service.ResetUserPassword(t.Context(), ResetPasswordInput{ID: admin.ID, Revision: admin.Revision}, integrationPrincipal(admin.ID), "reset-self"); !errorIsKind(err, ErrorForbidden) {
		t.Fatalf("reset self error=%v", err)
	}
	if _, err = service.ResetUserPassword(t.Context(), ResetPasswordInput{ID: system.ID, Revision: system.Revision}, integrationPrincipal(admin.ID), "reset-system"); !errorIsKind(err, ErrorForbidden) {
		t.Fatalf("reset system error=%v", err)
	}
	if _, err = service.ResetUserPassword(t.Context(), ResetPasswordInput{ID: user.ID, Revision: disabled.Revision}, integrationPrincipal(admin.ID), "reset-conflict"); !errorIsKind(err, ErrorConflict) {
		t.Fatalf("reset stale error=%v", err)
	}
	beforeReset, err := service.Signin(t.Context(), user.Username, integrationUserPassword, "before-reset")
	if err != nil {
		t.Fatalf("signin before reset: %v", err)
	}
	reset, err := service.ResetUserPassword(t.Context(), ResetPasswordInput{ID: user.ID, Revision: enabled.Revision}, integrationPrincipal(admin.ID), "reset-managed")
	if err != nil || validatePassword(reset.TemporaryPassword, service.cfg.PasswordMinLength) != nil {
		t.Fatalf("reset result invalid: %v", err)
	}
	if _, err = restoreSessionForTest(service, t.Context(), beforeReset.SessionToken); !errorIsKind(err, ErrorUnauthenticated) {
		t.Fatalf("reset session remains valid: %v", err)
	}
	if _, err = service.Signin(t.Context(), user.Username, integrationUserPassword, "old-password-after-reset"); !errorIsKind(err, ErrorUnauthenticated) {
		t.Fatalf("old password remains valid: %v", err)
	}
	temporarySignin, err := service.Signin(t.Context(), user.Username, reset.TemporaryPassword, "temporary-signin")
	if err != nil || !temporarySignin.Data.PasswordChangeRequired {
		t.Fatalf("temporary signin is not restricted: %v", err)
	}
	var summary string
	if err = pool.QueryRow(t.Context(), `SELECT summary::text FROM app_audit_events WHERE event_type = 'USER_RESET_PASSWORD' ORDER BY created_at DESC LIMIT 1`).Scan(&summary); err != nil || strings.Contains(summary, reset.TemporaryPassword) {
		t.Fatalf("reset audit leaked password or failed: %v", err)
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

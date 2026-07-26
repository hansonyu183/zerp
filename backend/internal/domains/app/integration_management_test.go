//go:build integration

package app

import (
	"errors"
	"slices"
	"sync"
	"testing"

	"github.com/jackc/pgx/v5"
)

func TestManagementContractsIntegration(t *testing.T) {
	service, pool, admin := appIntegrationService(t)
	if _, err := service.SetUserStatus(t.Context(), admin.ID, admin.Revision, StatusDisabled, admin.ID, "disable-last-admin"); !errorIsKind(err, ErrorConflict) {
		t.Fatalf("disable last admin error = %v", err)
	}
	catalogPermissionIDs := permissionIDsByPath(
		t, pool,
		signoutPath,
		"/vou/sale-order/query", "/vou/sale-order/get",
		"/wfl/intermediary-trade/query", "/wfl/intermediary-trade/get",
	)
	slices.Sort(catalogPermissionIDs)
	catalogRole, catalogErr := service.CreateRole(t.Context(), CreateRoleInput{
		Code: "vou-wfl-reader", Name: "VOU WFL 查看",
		PermissionIDs: catalogPermissionIDs,
	}, admin.ID, "create-role-with-seeded-permissions")
	if catalogErr != nil {
		t.Fatalf("create role with VOU/WFL seeded permissions: %v", catalogErr)
	}
	slices.Sort(catalogRole.PermissionIDs)
	if !slices.Equal(catalogRole.PermissionIDs, catalogPermissionIDs) {
		t.Fatalf("catalog role permissions = %v, want %v", catalogRole.PermissionIDs, catalogPermissionIDs)
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

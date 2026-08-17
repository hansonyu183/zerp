//go:build integration

package app

import (
	"slices"
	"testing"
)

func TestBoundedRoleDelegationIntegration(t *testing.T) {
	service, pool, admin := appIntegrationService(t)
	restoreAPPSystemIdentity(t, pool)
	adminPrincipal := Principal{User: UserSummary{ID: admin.ID}}
	limitedPaths := []string{
		"/app/role/query", "/app/role/get", "/app/role/create", "/app/role/save",
		"/app/role/enable", "/app/role/disable", "/app/permission/query",
		"/app/user/query", "/app/user/get", "/app/user/create", "/app/user/save",
	}
	limitedPermissionIDs := permissionIDsByPath(t, pool, limitedPaths...)
	limitedRole, err := service.Service.CreateRole(t.Context(), CreateRoleInput{
		Name: "有限管理员", PermissionIDs: limitedPermissionIDs,
	}, adminPrincipal, "create-limited-role")
	if err != nil {
		t.Fatalf("create limited role: %v", err)
	}
	if limitedRole.Code != "ROL-0001" || limitedRole.Type != RoleTypeNormal || limitedRole.Status != StatusEnabled {
		t.Fatalf("limited role identity = %+v", limitedRole.RoleListItem)
	}
	if _, err = service.Service.CreateRole(t.Context(), CreateRoleInput{
		Name: "  有限管理员  ", PermissionIDs: limitedPermissionIDs,
	}, adminPrincipal, "duplicate-limited-role"); !errorIsKind(err, ErrorConflict) || err.Error() != "role name already exists" {
		t.Fatalf("duplicate normalized role name error = %v", err)
	}

	directory, err := service.Service.QueryRoles(t.Context(), PageRequest{
		Page: 1, PageSize: 20, Sort: []SortItem{{Field: "code", Order: "asc"}},
	}, adminPrincipal)
	if err != nil {
		t.Fatalf("query role directory: %v", err)
	}
	types := make([]RoleType, 0, len(directory.Items))
	for _, item := range directory.Items {
		types = append(types, item.Type)
	}
	if !slices.Contains(types, RoleTypeSystem) || !slices.Contains(types, RoleTypeSuperadmin) {
		t.Fatalf("special role types are not both visible: %v", types)
	}

	limitedUser, err := service.Service.CreateUser(t.Context(), CreateUserInput{
		Username: "limited-admin", DisplayName: "有限管理员", Password: integrationUserPassword,
		RoleIDs: []string{limitedRole.ID},
	}, adminPrincipal, "create-limited-admin")
	if err != nil {
		t.Fatalf("create limited admin: %v", err)
	}
	limitedPrincipal := Principal{User: UserSummary{ID: limitedUser.ID}}
	narrowPermissionIDs := permissionIDsByPath(t, pool, "/app/user/query")
	narrowRole, err := service.Service.CreateRole(t.Context(), CreateRoleInput{
		Name: "更窄查询员", PermissionIDs: narrowPermissionIDs,
	}, limitedPrincipal, "create-narrow-role")
	if err != nil {
		t.Fatalf("limited admin creates narrow role: %v", err)
	}
	if narrowRole.Code != "ROL-0002" {
		t.Fatalf("narrow role code = %q, want ROL-0002", narrowRole.Code)
	}

	outsidePermissionIDs := permissionIDsByPath(t, pool, "/app/system-parameter/query")
	if _, err = service.Service.CreateRole(t.Context(), CreateRoleInput{
		Name: "越权角色", PermissionIDs: outsidePermissionIDs,
	}, limitedPrincipal, "create-over-ceiling-role"); !errorIsKind(err, ErrorForbidden) || err.Error() != "requested permissions exceed authorization ceiling" {
		t.Fatalf("over-ceiling role error = %v", err)
	}
	if _, err = service.Service.SaveRole(t.Context(), SaveRoleInput{
		ID: limitedRole.ID, Name: limitedRole.Name, PermissionIDs: limitedPermissionIDs, Revision: limitedRole.Revision,
	}, limitedPrincipal, "save-held-role"); !errorIsKind(err, ErrorForbidden) {
		t.Fatalf("save actor-held role error = %v", err)
	}
	if _, err = service.Service.SaveRole(t.Context(), SaveRoleInput{
		ID: admin.RoleIDs[0], Name: "超级管理员", PermissionIDs: nil, Revision: 1,
	}, limitedPrincipal, "save-superior-role"); !errorIsKind(err, ErrorForbidden) {
		t.Fatalf("save superadmin role error = %v", err)
	}

	adminDetail, err := service.GetUserDetail(t.Context(), admin.ID, limitedPrincipal)
	if err != nil {
		t.Fatalf("read superior user: %v", err)
	}
	if adminDetail.Manageable || adminDetail.RoleAssignmentEditable {
		t.Fatalf("superadmin target unexpectedly manageable: %+v", adminDetail)
	}
	if _, err = service.Service.CreateUser(t.Context(), CreateUserInput{
		Username: "forged-superadmin", DisplayName: "伪造管理员", Password: integrationUserPassword,
		RoleIDs: admin.RoleIDs,
	}, limitedPrincipal, "assign-superadmin"); !errorIsKind(err, ErrorForbidden) {
		t.Fatalf("assign superadmin error = %v", err)
	}
	if _, err = pool.Exec(t.Context(), `UPDATE app_roles SET status = 'DISABLED' WHERE id = $1`, admin.RoleIDs[0]); err != nil {
		t.Fatalf("disable target superadmin role fixture: %v", err)
	}
	disabledSuperadminDetail, err := service.GetUserDetail(t.Context(), admin.ID, limitedPrincipal)
	if err != nil {
		t.Fatalf("read disabled-superadmin target: %v", err)
	}
	if disabledSuperadminDetail.Manageable || disabledSuperadminDetail.RoleAssignmentEditable {
		t.Fatalf("disabled-superadmin target unexpectedly manageable: %+v", disabledSuperadminDetail)
	}

	child, err := service.Service.CreateUser(t.Context(), CreateUserInput{
		Username: "narrow-user", DisplayName: "更窄用户", Password: integrationUserPassword,
		RoleIDs: []string{narrowRole.ID},
	}, limitedPrincipal, "create-narrow-user")
	if err != nil {
		t.Fatalf("create narrow user: %v", err)
	}
	initialSession, err := service.Signin(t.Context(), child.Username, integrationUserPassword, "signin-narrow-user")
	if err != nil {
		t.Fatalf("signin narrow user: %v", err)
	}
	childSession := completeRequiredPasswordChange(t, service, initialSession, integrationUserPassword, "Changed-password-3!")
	if _, err = service.Authorize(t.Context(), childSession.SessionToken, childSession.Data.CSRFToken, "/app/user/query", "before-disable"); err != nil {
		t.Fatalf("authorize before role disable: %v", err)
	}
	disabledRole, err := service.Service.SetRoleStatus(t.Context(), narrowRole.ID, narrowRole.Revision, StatusDisabled, limitedPrincipal, "disable-narrow-role")
	if err != nil {
		t.Fatalf("disable narrow role: %v", err)
	}
	if _, err = service.Authorize(t.Context(), childSession.SessionToken, childSession.Data.CSRFToken, "/app/user/query", "after-disable"); !errorIsKind(err, ErrorForbidden) {
		t.Fatalf("authorization after role disable = %v", err)
	}
	restored, err := service.RestoreSession(t.Context(), childSession.SessionToken)
	if err != nil {
		t.Fatalf("role disable revoked the existing session: %v", err)
	}
	if _, err = service.Service.SetRoleStatus(t.Context(), narrowRole.ID, disabledRole.Revision, StatusEnabled, limitedPrincipal, "enable-narrow-role"); err != nil {
		t.Fatalf("enable narrow role: %v", err)
	}
	if _, err = service.Authorize(t.Context(), childSession.SessionToken, restored.Data.CSRFToken, "/app/user/query", "after-enable"); err != nil {
		t.Fatalf("authorization after role enable: %v", err)
	}
}

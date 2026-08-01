//go:build integration

package app

import (
	"testing"

	"github.com/hansonyu183/zerp/backend/internal/platform/systemidentity"
)

func TestSystemIdentityIntegration(t *testing.T) {
	service, pool, _ := appIntegrationService(t)
	resetAPPIntegrationData(t, pool)
	if _, err := pool.Exec(t.Context(), `INSERT INTO app_roles(id,code,name,status,created_by,updated_by)
		VALUES($1,$2,$3,'ENABLED',$4,$4)`, systemidentity.RoleID, systemidentity.RoleCode,
		systemidentity.RoleName, systemidentity.UserID); err != nil {
		t.Fatalf("restore system role after APP test reset: %v", err)
	}
	if _, err := pool.Exec(t.Context(), `INSERT INTO app_users(
		id,username,display_name,password_hash,status,password_changed_at,created_by,updated_by
	) VALUES($1,$2,$3,'!system-login-disabled!','DISABLED',now(),$1,$1)`, systemidentity.UserID,
		systemidentity.Username, systemidentity.UserDisplayName); err != nil {
		t.Fatalf("restore system user after APP test reset: %v", err)
	}
	if _, err := pool.Exec(t.Context(), `INSERT INTO app_user_roles(user_id,role_id,created_by)
		VALUES($1,$2,$1)`, systemidentity.UserID, systemidentity.RoleID); err != nil {
		t.Fatalf("restore system identity after APP test reset: %v", err)
	}
	admin, err := service.BootstrapAdmin(t.Context(), "admin", "系统管理员", integrationAdminPassword)
	if err != nil {
		t.Fatalf("bootstrap administrator beside system identity: %v", err)
	}

	user, err := service.GetUser(t.Context(), systemidentity.UserID)
	if err != nil {
		t.Fatalf("get system user: %v", err)
	}
	if user.Username != systemidentity.Username || user.DisplayName != systemidentity.UserDisplayName ||
		user.Status != StatusDisabled || len(user.RoleIDs) != 1 || user.RoleIDs[0] != systemidentity.RoleID {
		t.Fatalf("system user = %+v", user)
	}

	role, err := service.GetRole(t.Context(), systemidentity.RoleID)
	if err != nil {
		t.Fatalf("get system role: %v", err)
	}
	if role.Code != systemidentity.RoleCode || role.Name != systemidentity.RoleName ||
		role.Status != StatusEnabled || len(role.PermissionIDs) != 0 {
		t.Fatalf("system role = %+v", role)
	}
	var permissionCount int64
	if err = pool.QueryRow(t.Context(), `SELECT count(*) FROM app_role_permissions WHERE role_id=$1`, systemidentity.RoleID).Scan(&permissionCount); err != nil {
		t.Fatalf("count system permissions: %v", err)
	}
	if permissionCount != 0 {
		t.Fatalf("system role permissions = %d", permissionCount)
	}

	if _, err = service.Signin(t.Context(), systemidentity.Username, "anything", "system-signin"); !errorIsKind(err, ErrorUnauthenticated) {
		t.Fatalf("system signin error = %v", err)
	}
	if _, err = service.CreateUser(t.Context(), CreateUserInput{
		Username: systemidentity.Username, DisplayName: "duplicate", Password: integrationUserPassword,
		RoleIDs: []string{admin.RoleIDs[0]},
	}, admin.ID, "create-system-user"); !errorIsKind(err, ErrorConflict) {
		t.Fatalf("create system user error = %v", err)
	}
	if _, err = service.CreateRole(t.Context(), CreateRoleInput{
		Code: systemidentity.RoleCode, Name: "duplicate",
	}, admin.ID, "create-system-role"); !errorIsKind(err, ErrorValidation) {
		t.Fatalf("create system role error = %v", err)
	}
	if _, err = service.SaveUser(t.Context(), SaveUserInput{
		ID: user.ID, DisplayName: "changed", RoleIDs: user.RoleIDs, Revision: user.Revision,
	}, admin.ID, "save-system-user"); !errorIsKind(err, ErrorConflict) {
		t.Fatalf("save system user error = %v", err)
	}
	if _, err = service.SetUserStatus(t.Context(), user.ID, user.Revision, StatusEnabled, admin.ID, "enable-system-user"); !errorIsKind(err, ErrorConflict) {
		t.Fatalf("enable system user error = %v", err)
	}
	if _, err = service.SaveRole(t.Context(), SaveRoleInput{
		ID: role.ID, Name: "changed", Revision: role.Revision,
	}, admin.ID, "save-system-role"); !errorIsKind(err, ErrorConflict) {
		t.Fatalf("save system role error = %v", err)
	}
	if _, err = service.SetRoleStatus(t.Context(), role.ID, role.Revision, StatusDisabled, admin.ID, "disable-system-role"); !errorIsKind(err, ErrorConflict) {
		t.Fatalf("disable system role error = %v", err)
	}
	if _, err = service.CreateUser(t.Context(), CreateUserInput{
		Username: "system-role-user", DisplayName: "invalid", Password: integrationUserPassword,
		RoleIDs: []string{systemidentity.RoleID},
	}, admin.ID, "assign-system-role"); !errorIsKind(err, ErrorConflict) {
		t.Fatalf("assign system role error = %v", err)
	}
}

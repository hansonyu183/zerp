package app

import "testing"

func TestReportUsePermissionDoesNotGrantDefinitionManagement(t *testing.T) {
	if !permissionAllowsPath([]string{"/rpt/definition/query"}, "/rpt/definition/query") {
		t.Fatal("exact management permission was rejected")
	}
	for _, permission := range []string{"/rpt/account-journal/query", "/rpt/account-journal/export", "/acc/book/query"} {
		if permissionAllowsPath([]string{permission}, "/rpt/definition/query") {
			t.Fatalf("use permission %q granted report management", permission)
		}
	}
	for _, permission := range []string{"/rpt/account-journal/query", "/rpt/account-journal/export"} {
		if !permissionAllowsPath([]string{permission}, "/rpt/directory/query") {
			t.Fatalf("report use permission %q cannot read the session directory", permission)
		}
	}
	if permissionAllowsPath([]string{"/acc/book/query"}, "/rpt/directory/query") {
		t.Fatal("unrelated permission can read the report directory")
	}
}

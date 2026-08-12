package app

import "testing"

func TestReportDiscoveryAllowsManagementOrReportUsePermission(t *testing.T) {
	for _, permissions := range [][]string{
		{"/rpt/definition/query"},
		{"/rpt/account-journal/query"},
		{"/rpt/account-journal/export"},
	} {
		if !permissionAllowsPath(permissions, "/rpt/definition/query") {
			t.Fatalf("permissions %v cannot discover reports", permissions)
		}
	}
	if permissionAllowsPath([]string{"/acc/book/query"}, "/rpt/definition/query") {
		t.Fatal("unrelated permission can discover reports")
	}
}

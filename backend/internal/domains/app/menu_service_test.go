package app

import (
	"testing"

	dbsqlc "github.com/hansonyu183/zerp/backend/internal/database/sqlc"
)

func TestBusinessMenuRevisionComesFromOneRowSnapshot(t *testing.T) {
	if revision, err := businessMenuRevision(nil); err != nil || revision != 1 {
		t.Fatalf("empty revision = %d, err=%v", revision, err)
	}
	rows := []dbsqlc.AppBusinessMenuItem{{Revision: 7}, {Revision: 7}}
	if revision, err := businessMenuRevision(rows); err != nil || revision != 7 {
		t.Fatalf("row revision = %d, err=%v", revision, err)
	}
	rows[1].Revision = 8
	if _, err := businessMenuRevision(rows); err == nil {
		t.Fatal("mixed menu revisions were accepted")
	}
}

func TestInitialBusinessMenuClassifiesEveryCashRoute(t *testing.T) {
	for _, key := range []string{
		"vou/employee-loan-writeoff",
		"vou/expense-payment",
		"led/customer",
		"led/supplier",
		"led/other",
	} {
		if group := classifyBusinessRoute(key); group != "menu-group-cash" {
			t.Errorf("classifyBusinessRoute(%q) = %q, want menu-group-cash", key, group)
		}
	}
}

func TestWorkbenchIsTheUniqueDirectMenuEntry(t *testing.T) {
	catalog := []registeredMenuRoute{
		{RouteKey: "home/dashboard", RoutePath: "/home/dashboard", DisplayName: "工作台", PermissionCode: "/app/workbench/query", Order: 10, Always: true},
		{RouteKey: "bob/customer", RoutePath: "/bob/customer", DisplayName: "客户", PermissionCode: "/bob/customer/query", Order: 10},
	}
	for name, menu := range map[string]MenuTree{
		"default":  buildDefaultMenu(catalog),
		"business": buildInitialBusinessMenu(catalog, 1),
	} {
		workbenches := 0
		for _, item := range menu.Items {
			if item.Type == MenuItemGroup && item.DisplayName == "工作台" {
				t.Fatalf("%s menu contains a workbench group: %+v", name, menu.Items)
			}
			if item.RouteKey != nil && *item.RouteKey == "home/dashboard" {
				workbenches++
				if item.ParentID != nil || item.Level != 1 || item.DisplayName != "工作台" {
					t.Fatalf("%s workbench entry = %+v, want direct level-one route", name, item)
				}
			}
		}
		if workbenches != 1 {
			t.Fatalf("%s workbench entries = %d, want 1", name, workbenches)
		}
		filtered := filterMenuForPrincipal(menu, catalog, Principal{})
		if len(filtered.Items) == 0 || filtered.Items[0].RouteKey == nil || *filtered.Items[0].RouteKey != "home/dashboard" {
			t.Fatalf("%s navigation does not retain direct workbench: %+v", name, filtered.Items)
		}
	}
}

func TestDefaultMenuUsesTheDomainFallbackGroupName(t *testing.T) {
	menu := buildDefaultMenu(nil)
	for _, item := range menu.Items {
		if item.ID == "default-other" {
			if item.DisplayName != "其他/待归类" {
				t.Fatalf("default fallback group name = %q, want 其他/待归类", item.DisplayName)
			}
			return
		}
	}
	t.Fatal("default fallback group is missing")
}

func TestValidateBusinessMenuRequiresOneEnabledDirectWorkbench(t *testing.T) {
	catalog := []registeredMenuRoute{
		{RouteKey: "home/dashboard", RoutePath: "/home/dashboard", DisplayName: "工作台", PermissionCode: "/app/workbench/query", Always: true},
		{RouteKey: "admin/menu", RoutePath: "/admin/menu", DisplayName: "菜单管理", PermissionCode: "/app/menu/save-business-template"},
	}
	systemID := "system"
	workbenchKey := "home/dashboard"
	menuKey := "admin/menu"
	items := []SaveMenuItemInput{
		{ID: "workbench", Type: MenuItemRoute, Order: 10, DisplayName: "工作台", Enabled: true, RouteKey: &workbenchKey},
		{ID: systemID, Type: MenuItemGroup, Order: 20, DisplayName: "系统管理", Enabled: true},
		{ID: "menu", ParentID: &systemID, Type: MenuItemRoute, Order: 10, DisplayName: "菜单管理", Enabled: true, RouteKey: &menuKey},
	}
	if _, err := validateBusinessMenu(items, catalog); err != nil {
		t.Fatalf("valid direct workbench menu rejected: %v", err)
	}
	items[0].ParentID = &systemID
	if _, err := validateBusinessMenu(items, catalog); !errorIsKind(err, ErrorValidation) {
		t.Fatalf("grouped workbench error = %v, want validation error", err)
	}
	items[0].ParentID = nil
	items[2].DisplayName = "工作台"
	if _, err := validateBusinessMenu(items, catalog); !errorIsKind(err, ErrorValidation) {
		t.Fatalf("secondary workbench name error = %v, want validation error", err)
	}
}

func TestAccountingBookMenuBelongsToAccounting(t *testing.T) {
	if got := classifyBusinessRoute("acc/book"); got != "menu-group-accounting" {
		t.Fatalf("ACC book group = %q, want accounting", got)
	}
	catalog := []registeredMenuRoute{{
		RouteKey: "acc/book", RoutePath: "/acc/book", DisplayName: "会计账簿",
		PermissionCode: "/acc/book/query", Order: 10,
	}}
	menu := buildDefaultMenu(catalog)
	found := false
	for _, item := range menu.Items {
		if item.RouteKey != nil && *item.RouteKey == "acc/book" {
			found = item.ParentID != nil && *item.ParentID == "default-acc"
		}
	}
	if !found {
		t.Fatal("ACC book was not placed in the default accounting group")
	}
}

func TestReportRoutesHaveDedicatedMenuGroups(t *testing.T) {
	if got := classifyBusinessRoute("rpt/account-journal"); got != "menu-group-reporting" {
		t.Fatalf("report group = %q, want reporting", got)
	}
	catalog := []registeredMenuRoute{{
		RouteKey: "rpt/account-journal", RoutePath: "/rpt/account-journal", DisplayName: "科目流水",
		PermissionCode: "/rpt/account-journal/query", Order: 10,
	}}
	menu := buildDefaultMenu(catalog)
	for _, item := range menu.Items {
		if item.RouteKey != nil && *item.RouteKey == "rpt/account-journal" {
			if item.ParentID == nil || *item.ParentID != "default-rpt" {
				t.Fatalf("report default parent = %v, want default-rpt", item.ParentID)
			}
			return
		}
	}
	t.Fatal("report route is missing from default menu")
}

func TestAppendUnclassifiedRoutesSkipsTombstonedRoutes(t *testing.T) {
	otherID := "other"
	customer := registeredMenuRoute{RouteKey: "bob/customer", RoutePath: "/bob/customer", DisplayName: "客户", PermissionCode: "/bob/customer/query"}
	supplier := registeredMenuRoute{RouteKey: "bob/supplier", RoutePath: "/bob/supplier", DisplayName: "供应商", PermissionCode: "/bob/supplier/query"}
	tree := MenuTree{Revision: 2, Items: []MenuItemView{{
		ID: otherID, Type: MenuItemGroup, Level: 1, DisplayName: "其他/待归类", Enabled: true,
	}}}

	tombstoneParent := menuRouteTombstoneGroupID
	tombstones := menuRouteTombstones([]dbsqlc.AppBusinessMenuItem{{
		ItemType: MenuItemRoute, ParentID: &tombstoneParent, RouteKey: &customer.RouteKey,
	}})
	result := appendUnclassifiedRoutes(tree, []registeredMenuRoute{customer, supplier}, tombstones)
	present := make(map[string]bool)
	for _, item := range result.Items {
		if item.RouteKey != nil {
			present[*item.RouteKey] = true
		}
	}
	if present[customer.RouteKey] {
		t.Fatalf("tombstoned route was re-added: %+v", result.Items)
	}
	if !present[supplier.RouteKey] {
		t.Fatalf("unconfigured route was not appended: %+v", result.Items)
	}
}

func TestFilterMenuForPrincipalRequiresEnabledParentAndRoutePermission(t *testing.T) {
	parent := "group"
	key := "bob/customer"
	path := "/bob/customer"
	permission := "/bob/customer/query"
	catalog := []registeredMenuRoute{{
		RouteKey: key, RoutePath: path, PermissionCode: permission,
		PermissionRoot: "/bob/customer/",
	}}
	tree := MenuTree{Revision: 2, Items: []MenuItemView{
		{ID: parent, Type: MenuItemGroup, Level: 1, DisplayName: "客户", Enabled: false},
		{ID: "route", ParentID: &parent, Type: MenuItemRoute, Level: 2, DisplayName: "客户", Enabled: true, RouteKey: &key, RoutePath: &path, PermissionCode: &permission},
	}}
	principal := Principal{Permissions: []string{"/bob/customer/create"}}

	if result := filterMenuForPrincipal(tree, catalog, principal); len(result.Items) != 0 {
		t.Fatalf("disabled parent returned navigation items: %+v", result.Items)
	}
	tree.Items[0].Enabled = true
	if result := filterMenuForPrincipal(tree, catalog, principal); len(result.Items) != 2 {
		t.Fatalf("entity permission did not reveal enabled route: %+v", result.Items)
	}
	principal.Permissions = []string{"/bob/supplier/query"}
	if result := filterMenuForPrincipal(tree, catalog, principal); len(result.Items) != 0 {
		t.Fatalf("unrelated permission returned navigation items: %+v", result.Items)
	}
}

func TestReportRoutesUseTheirOwnEntityPermissionRoot(t *testing.T) {
	report := registeredMenuRoute{
		RouteKey: "rpt/account-journal", RoutePath: "/rpt/account-journal",
		PermissionCode: "/rpt/account-journal/query", PermissionRoot: "/rpt/account-journal/",
	}
	for _, permission := range []string{"/rpt/account-journal/query", "/rpt/account-journal/export"} {
		if !routeAllowed(report, []string{permission}) {
			t.Fatalf("own report permission %q did not reveal its report", permission)
		}
	}
	for _, permission := range []string{"/rpt/account-balance/query", "/rpt/definition/query"} {
		if routeAllowed(report, []string{permission}) {
			t.Fatalf("permission %q revealed an unrelated report route", permission)
		}
	}

	definition := registeredMenuRoute{
		RouteKey: "rpt/definition", RoutePath: "/rpt/definition",
		PermissionCode: "/rpt/definition/query", PermissionRoot: "/rpt/definition/",
	}
	for _, permission := range []string{"/rpt/definition/query", "/rpt/definition/create"} {
		if !routeAllowed(definition, []string{permission}) {
			t.Fatalf("own definition permission %q did not reveal management entry", permission)
		}
	}
}

func TestMenuCatalogRevisionIncludesRegisteredCatalogContentAndOrder(t *testing.T) {
	catalog := []registeredMenuRoute{
		{RouteKey: "bob/customer", RoutePath: "/bob/customer", DisplayName: "客户", PermissionCode: "/bob/customer/query", PermissionRoot: "/bob/customer/", Order: 10},
		{RouteKey: "bob/supplier", RoutePath: "/bob/supplier", DisplayName: "供应商", PermissionCode: "/bob/supplier/query", PermissionRoot: "/bob/supplier/", Order: 20},
	}
	revision := menuCatalogRevision(catalog)
	if revision == "" || revision != menuCatalogRevision(catalog) {
		t.Fatalf("catalog revision is not deterministic: %q", revision)
	}
	catalog[1].Order = 30
	if revision == menuCatalogRevision(catalog) {
		t.Fatal("catalog order change did not change revision")
	}
	catalog[1].Order = 20
	catalog[1].PermissionCode = "/bob/supplier/get"
	if revision == menuCatalogRevision(catalog) {
		t.Fatal("catalog permission change did not change revision")
	}
}

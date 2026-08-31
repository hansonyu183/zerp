package app

import (
	"testing"

	dbsqlc "github.com/hansonyu183/zerp/backend/internal/database/sqlc"
)

func testMenuCatalog() []registeredMenuRoute {
	return []registeredMenuRoute{
		{RouteKey: "home/dashboard", RoutePath: "/home/dashboard", DisplayName: "工作台", PermissionCode: "/app/workbench/query", Always: true},
		{RouteKey: "app/menu", RoutePath: "/app/menu", DisplayName: "菜单管理", PermissionCode: "/app/menu/save-business"},
		{RouteKey: "dcl/operating-entity", RoutePath: "/dcl/operating-entity", DisplayName: "经营主体", PermissionCode: "/dcl/operating-entity/query", PermissionRoot: "/dcl/operating-entity/"},
		{RouteKey: "dcl/warehouse", RoutePath: "/dcl/warehouse", DisplayName: "仓库", PermissionCode: "/dcl/warehouse/query", PermissionRoot: "/dcl/warehouse/"},
		{RouteKey: "dcl/party", RoutePath: "/dcl/party", DisplayName: "主体", PermissionCode: "/dcl/party/query", PermissionRoot: "/dcl/party/"},
		{RouteKey: "bob/customer", RoutePath: "/bob/customer", DisplayName: "客户", PermissionCode: "/bob/customer/query", PermissionRoot: "/bob/customer/"},
		{RouteKey: "bob/warehouse", RoutePath: "/bob/warehouse", DisplayName: "仓库", PermissionCode: "/bob/warehouse/query", PermissionRoot: "/bob/warehouse/"},
	}
}

func TestDefaultMenuKeepsDCLDeclarationSeparateFromBOBCurrentData(t *testing.T) {
	menu := buildDefaultMenu(testMenuCatalog())
	if !menuRouteUnderGroup(menu, "dcl/operating-entity", "档案变更") {
		t.Fatalf("DCL operating entity is not under its own declaration group: %+v", menu.Items)
	}
	if !menuRouteUnderGroup(menu, "dcl/warehouse", "档案变更") {
		t.Fatalf("DCL warehouse is not under its own declaration group: %+v", menu.Items)
	}
	if !menuRouteUnderGroup(menu, "dcl/party", "档案变更") {
		t.Fatalf("DCL Party is not under its own declaration group: %+v", menu.Items)
	}
	if !menuRouteUnderGroup(menu, "bob/customer", "业务对象") {
		t.Fatalf("BOB current data left the business-object group: %+v", menu.Items)
	}
	if !menuRouteUnderGroup(menu, "bob/warehouse", "业务对象") {
		t.Fatalf("BOB warehouse current data left the business-object group: %+v", menu.Items)
	}
}

func TestDCLMenuDisplayNameKeepsOnlyObjectName(t *testing.T) {
	cases := []struct {
		entity, description, want string
	}{
		{"party", "查询主体声明", "主体"},
		{"operating-entity", "查询经营主体申报", "经营主体"},
		{"employee", "查询员工声明", "人员"},
		{"customer-account", "查询客户账户声明", "客户结算子账户"},
		{"wfl-process-definition", "查询流程定义声明", "流程定义"},
	}
	for _, tc := range cases {
		if got := menuRouteDisplayName("dcl", tc.entity, tc.description); got != tc.want {
			t.Errorf("menuRouteDisplayName(%q) = %q, want %q", tc.entity, got, tc.want)
		}
	}
}

func TestEditableMenuTreeOmitsRetiredRoutes(t *testing.T) {
	groupID := "group"
	retiredKey := "led/asset"
	rows := []dbsqlc.AppBusinessMenuItem{
		{ID: groupID, ItemType: MenuItemGroup, ItemLevel: 1, DisplayName: "资产", Enabled: true},
		{ID: "retired", ParentID: &groupID, ItemType: MenuItemRoute, ItemLevel: 2, DisplayName: "旧资产", Enabled: true, RouteKey: &retiredKey},
	}

	tree := editableMenuTreeFromRows(rows, nil)
	if len(tree.Items) != 1 || tree.Items[0].ID != groupID {
		t.Fatalf("editable tree exposed retired route: %+v", tree.Items)
	}
}

func TestAppendUnclassifiedRoutesAddsEachMissingRouteOnce(t *testing.T) {
	catalog := testMenuCatalog()
	tree := buildInitialBusinessMenu(catalog[:2])
	result := appendUnclassifiedRoutes(tree, catalog)
	result = appendUnclassifiedRoutes(result, catalog)

	counts := map[string]int{}
	for _, item := range result.Items {
		if item.RouteKey != nil {
			counts[*item.RouteKey]++
		}
	}
	if counts["bob/customer"] != 1 || !menuRouteUnderGroup(result, "bob/customer", "其他/待归类") {
		t.Fatalf("missing route synchronization = %+v", result.Items)
	}
}

func TestValidateBusinessMenuRequiresUniqueRoutesAndSafeEntries(t *testing.T) {
	catalog := testMenuCatalog()
	items := menuViewToInput(buildInitialBusinessMenu(catalog).Items)
	if _, err := validateBusinessMenu(items, catalog); err != nil {
		t.Fatalf("valid menu rejected: %v", err)
	}

	duplicate := append([]SaveMenuItemInput(nil), items...)
	for _, item := range items {
		if item.RouteKey != nil && *item.RouteKey == "bob/customer" {
			item.ID = "duplicate-customer"
			duplicate = append(duplicate, item)
			break
		}
	}
	if _, err := validateBusinessMenu(duplicate, catalog); !errorIsKind(err, ErrorValidation) {
		t.Fatalf("duplicate route error = %v", err)
	}

	for index := range items {
		if items[index].RouteKey != nil && *items[index].RouteKey == "app/menu" {
			items[index].Enabled = false
		}
	}
	if _, err := validateBusinessMenu(items, catalog); !errorIsKind(err, ErrorValidation) {
		t.Fatalf("disabled menu management error = %v", err)
	}
}

func TestWorkbenchIsTheUniqueDirectMenuEntry(t *testing.T) {
	catalog := testMenuCatalog()
	for name, menu := range map[string]MenuTree{"default": buildDefaultMenu(catalog), "business": buildInitialBusinessMenu(catalog)} {
		workbenches := 0
		for _, item := range menu.Items {
			if item.RouteKey != nil && *item.RouteKey == "home/dashboard" {
				workbenches++
				if item.ParentID != nil || item.Level != 1 || item.DisplayName != "工作台" {
					t.Fatalf("%s workbench entry = %+v", name, item)
				}
			}
		}
		if workbenches != 1 {
			t.Fatalf("%s workbench entries = %d", name, workbenches)
		}
	}
}

func TestFilterMenuForPrincipalPlacesWorkbenchFirstRegardlessOfOrder(t *testing.T) {
	groupID := "group"
	workbenchKey, workbenchPath := "home/dashboard", "/home/dashboard"
	customerKey, customerPath, customerPermission := "bob/customer", "/bob/customer", "/bob/customer/query"
	tree := MenuTree{Items: []MenuItemView{
		{ID: groupID, Type: MenuItemGroup, Level: 1, DisplayName: "销售", Enabled: true, Order: 1},
		{ID: "customer", ParentID: &groupID, Type: MenuItemRoute, Level: 2, DisplayName: "客户", Enabled: true, Order: 1, RouteKey: &customerKey, RoutePath: &customerPath, PermissionCode: &customerPermission},
		{ID: "workbench", Type: MenuItemRoute, Level: 1, DisplayName: "工作台", Enabled: true, Order: 999, RouteKey: &workbenchKey, RoutePath: &workbenchPath},
	}}
	catalog := []registeredMenuRoute{
		{RouteKey: workbenchKey, RoutePath: workbenchPath, PermissionCode: "/app/workbench/query", Always: true},
		{RouteKey: customerKey, RoutePath: customerPath, PermissionCode: customerPermission},
	}
	result := filterMenuForPrincipal(tree, catalog, Principal{Permissions: []string{customerPermission}})
	if len(result.Items) == 0 || result.Items[0].RouteKey == nil || *result.Items[0].RouteKey != workbenchKey {
		t.Fatalf("workbench was not placed first: %+v", result.Items)
	}
}

func TestFilterMenuForPrincipalRequiresEnabledParentAndPermission(t *testing.T) {
	parent, key, path, permission := "group", "bob/customer", "/bob/customer", "/bob/customer/query"
	catalog := []registeredMenuRoute{{RouteKey: key, RoutePath: path, PermissionCode: permission, PermissionRoot: "/bob/customer/"}}
	tree := MenuTree{Items: []MenuItemView{
		{ID: parent, Type: MenuItemGroup, Level: 1, DisplayName: "客户", Enabled: false},
		{ID: "route", ParentID: &parent, Type: MenuItemRoute, Level: 2, DisplayName: "客户", Enabled: true, RouteKey: &key, RoutePath: &path, PermissionCode: &permission},
	}}
	principal := Principal{Permissions: []string{"/bob/customer/query"}}
	if result := filterMenuForPrincipal(tree, catalog, principal); len(result.Items) != 0 {
		t.Fatalf("disabled parent returned navigation: %+v", result.Items)
	}
	tree.Items[0].Enabled = true
	if result := filterMenuForPrincipal(tree, catalog, principal); len(result.Items) != 2 {
		t.Fatalf("valid entity permission did not reveal route: %+v", result.Items)
	}
}

func TestInitialBusinessMenuClassifiesCurrentDomains(t *testing.T) {
	cases := map[string]string{
		"vou/employee-loan-writeoff": "menu-group-cash",
		"acc/book":                   "menu-group-accounting",
		"rpt/account-journal":        "menu-group-reporting",
	}
	for key, want := range cases {
		if got := classifyBusinessRoute(key); got != want {
			t.Errorf("classifyBusinessRoute(%q) = %q, want %q", key, got, want)
		}
	}
}

func menuRouteUnderGroup(tree MenuTree, key, groupName string) bool {
	groups := map[string]string{}
	for _, item := range tree.Items {
		if item.Type == MenuItemGroup {
			groups[item.ID] = item.DisplayName
		}
	}
	for _, item := range tree.Items {
		if item.RouteKey != nil && *item.RouteKey == key && item.ParentID != nil && groups[*item.ParentID] == groupName {
			return true
		}
	}
	return false
}

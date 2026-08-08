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

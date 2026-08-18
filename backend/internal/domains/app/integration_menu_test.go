//go:build integration

package app

import (
	"sync"
	"testing"
)

func TestMenuManagementIntegration(t *testing.T) {
	service, pool, admin := appIntegrationService(t)
	principal := Principal{User: UserSummary{ID: admin.ID}}
	rows, err := pool.Query(t.Context(), `SELECT path FROM app_permissions WHERE status = 'ENABLED' ORDER BY path`)
	if err != nil {
		t.Fatalf("query permissions: %v", err)
	}
	for rows.Next() {
		var path string
		if err = rows.Scan(&path); err != nil {
			t.Fatalf("scan permission: %v", err)
		}
		principal.Permissions = append(principal.Permissions, path)
	}
	rows.Close()

	before, err := service.GetMenu(t.Context(), principal)
	if err != nil {
		t.Fatalf("get initial menu: %v", err)
	}
	reset, err := service.ResetBusinessMenu(t.Context(), ResetBusinessMenuInput{Revision: before.Draft.Revision, CatalogRevision: before.CatalogRevision}, principal, "reset-menu")
	if err != nil || reset.Draft.Revision != before.Draft.Revision+1 {
		t.Fatalf("reset menu = %+v, %v", reset, err)
	}
	if !menuContainsRoute(reset.Draft, "app/menu") {
		t.Fatal("initial business template does not retain menu management")
	}
	if reset.Published.Revision != before.Published.Revision {
		t.Fatalf("reset changed published revision: got %d want %d", reset.Published.Revision, before.Published.Revision)
	}
	initialPublished, err := service.PublishBusinessMenu(t.Context(), PublishBusinessMenuInput{Revision: reset.Draft.Revision, CatalogRevision: reset.CatalogRevision}, principal, "initial-publish-menu")
	if err != nil || !menuContainsRoute(initialPublished.Published, "app/menu") || initialPublished.Mode != reset.Mode {
		t.Fatalf("initial publish menu = %+v, %v", initialPublished, err)
	}
	assertMenuRouteOrder(t, reset.DefaultMenu, "default-vou",
		"vou/sale-pricing", "vou/sale-order", "vou/sale-outbound", "vou/sale-delivery", "vou/sale-signoff", "vou/sale-return",
		"vou/purchase-inquiry", "vou/purchase-order", "vou/purchase-inbound", "vou/purchase-return",
	)
	assertMenuRouteOrder(t, reset.Draft, "menu-group-sales",
		"vou/sale-pricing", "vou/sale-order", "vou/sale-outbound", "vou/sale-delivery", "vou/sale-signoff", "vou/sale-return",
	)
	assertMenuRouteOrder(t, reset.Draft, "menu-group-purchase",
		"vou/purchase-inquiry", "vou/purchase-order", "vou/purchase-inbound", "vou/purchase-return",
	)
	if _, err = service.ActivateMenu(t.Context(), ActivateMenuInput{Mode: "CUSTOM", Revision: reset.ModeRevision, CatalogRevision: reset.CatalogRevision}, principal, "invalid-mode"); !errorIsKind(err, ErrorValidation) {
		t.Fatalf("invalid mode error = %v", err)
	}
	if _, err = service.ActivateMenu(t.Context(), ActivateMenuInput{Mode: MenuModeBusinessTemplate, Revision: reset.ModeRevision, CatalogRevision: "stale"}, principal, "stale-catalog-activate"); !errorIsKind(err, ErrorConflict) {
		t.Fatalf("stale catalog activation error = %v", err)
	}
	activated, err := service.ActivateMenu(t.Context(), ActivateMenuInput{Mode: MenuModeBusinessTemplate, Revision: reset.ModeRevision, CatalogRevision: reset.CatalogRevision}, principal, "activate-menu")
	if err != nil || activated.Mode != MenuModeBusinessTemplate || activated.ModeRevision != reset.ModeRevision+1 {
		t.Fatalf("activate menu = %+v, %v", activated, err)
	}

	items := menuViewToInput(activated.Draft.Items)
	var systemGroup string
	for index := range items {
		if items[index].Type == MenuItemGroup && items[index].DisplayName == "系统管理" {
			systemGroup = items[index].ID
			items[index].DisplayName = "系统中心"
		}
	}
	duplicateID := newID()
	items = append(items, SaveMenuItemInput{ID: duplicateID, ParentID: &systemGroup, Type: MenuItemRoute, Order: 999, DisplayName: "用户管理副本", Enabled: true, RouteKey: stringPointer("app/user")})
	saved, err := service.SaveBusinessMenu(t.Context(), SaveBusinessMenuInput{Revision: activated.Draft.Revision, CatalogRevision: activated.CatalogRevision, Items: items}, principal, "save-menu")
	if err != nil || saved.Draft.Revision != activated.Draft.Revision+1 || !menuContainsID(saved.Draft, duplicateID) {
		t.Fatalf("save duplicate route menu = %+v, %v", saved, err)
	}
	if menuContainsID(saved.Published, duplicateID) || menuContainsID(saved.Navigation, duplicateID) || saved.Published.Revision != activated.Published.Revision {
		t.Fatalf("draft save leaked into published/navigation: %+v", saved)
	}
	published, err := service.PublishBusinessMenu(t.Context(), PublishBusinessMenuInput{Revision: saved.Draft.Revision, CatalogRevision: saved.CatalogRevision}, principal, "publish-menu")
	if err != nil || !menuContainsID(published.Published, duplicateID) || published.Published.Revision != saved.Published.Revision+1 || published.Mode != saved.Mode {
		t.Fatalf("publish menu = %+v, %v", published, err)
	}
	invalidRoute := menuViewToInput(saved.Draft.Items)
	invalidRoute = append(invalidRoute, SaveMenuItemInput{ID: newID(), ParentID: &systemGroup, Type: MenuItemRoute, Order: 1000, DisplayName: "非法", Enabled: true, RouteKey: stringPointer("arbitrary/url")})
	if _, err = service.SaveBusinessMenu(t.Context(), SaveBusinessMenuInput{Revision: saved.Draft.Revision, CatalogRevision: saved.CatalogRevision, Items: invalidRoute}, principal, "invalid-route"); !errorIsKind(err, ErrorValidation) {
		t.Fatalf("unregistered route error = %v", err)
	}

	tooDeep := menuViewToInput(saved.Draft.Items)
	routeID := ""
	for _, item := range tooDeep {
		if item.Type == MenuItemRoute {
			routeID = item.ID
			break
		}
	}
	tooDeep = append(tooDeep, SaveMenuItemInput{ID: newID(), ParentID: &routeID, Type: MenuItemRoute, Order: 1001, DisplayName: "第三级", Enabled: true, RouteKey: stringPointer("app/user")})
	if _, err = service.SaveBusinessMenu(t.Context(), SaveBusinessMenuInput{Revision: saved.Draft.Revision, CatalogRevision: saved.CatalogRevision, Items: tooDeep}, principal, "too-deep"); !errorIsKind(err, ErrorValidation) {
		t.Fatalf("deep menu error = %v", err)
	}

	withoutMenu := menuViewToInput(saved.Draft.Items)
	for index := range withoutMenu {
		if withoutMenu[index].RouteKey != nil && *withoutMenu[index].RouteKey == "app/menu" {
			withoutMenu[index].Enabled = false
		}
	}
	if _, err = service.SaveBusinessMenu(t.Context(), SaveBusinessMenuInput{Revision: saved.Draft.Revision, CatalogRevision: saved.CatalogRevision, Items: withoutMenu}, principal, "lockout"); !errorIsKind(err, ErrorValidation) {
		t.Fatalf("menu lockout error = %v", err)
	}

	concurrent := SaveBusinessMenuInput{Revision: saved.Draft.Revision, CatalogRevision: saved.CatalogRevision, Items: menuViewToInput(saved.Draft.Items)}
	var wg sync.WaitGroup
	errorsFound := make(chan error, 2)
	for range 2 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, saveErr := service.SaveBusinessMenu(t.Context(), concurrent, principal, "concurrent-menu")
			errorsFound <- saveErr
		}()
	}
	wg.Wait()
	close(errorsFound)
	successes, conflicts := 0, 0
	for saveErr := range errorsFound {
		if saveErr == nil {
			successes++
		} else if errorIsKind(saveErr, ErrorConflict) {
			conflicts++
		} else {
			t.Fatalf("unexpected concurrent save error: %v", saveErr)
		}
	}
	if successes != 1 || conflicts != 1 {
		t.Fatalf("concurrent saves: success=%d conflict=%d", successes, conflicts)
	}

	current, err := service.GetMenu(t.Context(), principal)
	if err != nil {
		t.Fatalf("get current menu: %v", err)
	}
	withoutCustomer := menuViewToInput(current.Draft.Items)
	filteredCustomer := withoutCustomer[:0]
	for _, item := range withoutCustomer {
		if item.RouteKey != nil && *item.RouteKey == "bob/customer" {
			continue
		}
		filteredCustomer = append(filteredCustomer, item)
	}
	withoutCustomerSaved, err := service.SaveBusinessMenu(t.Context(), SaveBusinessMenuInput{
		Revision:        current.Draft.Revision,
		CatalogRevision: current.CatalogRevision,
		Items:           filteredCustomer,
	}, principal, "delete-customer-menu")
	if err != nil || menuContainsRoute(withoutCustomerSaved.Draft, "bob/customer") || menuContainsID(withoutCustomerSaved.Draft, menuRouteTombstoneGroupID) || !menuContainsRoute(withoutCustomerSaved.Draft, "app/menu") {
		t.Fatalf("delete customer route = %+v, %v", withoutCustomerSaved.Draft, err)
	}

	withoutGroup := menuViewToInput(withoutCustomerSaved.Draft.Items)
	auxiliaryGroupID := ""
	for _, item := range withoutGroup {
		if item.Type == MenuItemGroup && item.DisplayName == "辅助资料" {
			auxiliaryGroupID = item.ID
			break
		}
	}
	if auxiliaryGroupID == "" {
		t.Fatal("auxiliary data group is missing from initial business template")
	}
	filteredGroup := withoutGroup[:0]
	for _, item := range withoutGroup {
		if item.ID == auxiliaryGroupID || (item.ParentID != nil && *item.ParentID == auxiliaryGroupID) {
			continue
		}
		filteredGroup = append(filteredGroup, item)
	}
	withoutGroupSaved, err := service.SaveBusinessMenu(t.Context(), SaveBusinessMenuInput{
		Revision:        withoutCustomerSaved.Draft.Revision,
		CatalogRevision: withoutCustomerSaved.CatalogRevision,
		Items:           filteredGroup,
	}, principal, "delete-auxiliary-group-menu")
	if err != nil || menuHasGroupName(withoutGroupSaved.Draft, "辅助资料") || menuContainsID(withoutGroupSaved.Draft, menuRouteTombstoneGroupID) || !menuContainsRoute(withoutGroupSaved.Draft, "app/menu") {
		t.Fatalf("delete auxiliary group = %+v, %v", withoutGroupSaved.Draft, err)
	}
	staleCatalogRevision := withoutGroupSaved.CatalogRevision
	staleItems := menuViewToInput(withoutGroupSaved.Draft.Items)
	if _, err = pool.Exec(t.Context(), `
		INSERT INTO app_permissions (id, path, domain, entity, action, description, status)
		VALUES
			('01JAPPMENUTESTNEWROUTE0001', '/new-domain/new-entity/query', 'new-domain', 'new-entity', 'query', '查询新增路由', 'ENABLED'),
			('01JAPPMENUTESTNEWROUTE0002', '/vou/zz-unclassified/query', 'vou', 'zz-unclassified', 'query', '查询未归类单据', 'ENABLED')
		ON CONFLICT (id) DO UPDATE SET status = 'ENABLED', description = EXCLUDED.description
	`); err != nil {
		t.Fatalf("insert new route permission: %v", err)
	}
	if _, err = service.SaveBusinessMenu(t.Context(), SaveBusinessMenuInput{
		Revision: withoutGroupSaved.Draft.Revision, CatalogRevision: staleCatalogRevision, Items: staleItems,
	}, principal, "stale-catalog-menu"); !errorIsKind(err, ErrorConflict) {
		t.Fatalf("stale catalog save error = %v", err)
	}
	withPending, err := service.GetMenu(t.Context(), principal)
	if err != nil || !menuRouteUnderGroup(withPending.Draft, "new-domain/new-entity", "其他/待归类") || !menuRouteUnderGroup(withPending.Draft, "vou/zz-unclassified", "其他/待归类") || !menuRouteUnderGroup(withPending.DefaultMenu, "vou/zz-unclassified", "业务单据") || menuContainsRoute(withPending.Draft, "bob/customer") || menuHasGroupName(withPending.Draft, "辅助资料") || !menuHasGroupName(withPending.Draft, "系统中心") {
		t.Fatalf("unclassified route merge = %+v, %v", withPending.Draft, err)
	}
	assertMenuRouteOrder(t, withPending.DefaultMenu, "default-vou", "vou/bill-maturity", "vou/zz-unclassified")
	withoutNewRoute := menuViewToInput(withPending.Draft.Items)
	filteredNewRoute := withoutNewRoute[:0]
	for _, item := range withoutNewRoute {
		if item.RouteKey != nil && *item.RouteKey == "new-domain/new-entity" {
			continue
		}
		filteredNewRoute = append(filteredNewRoute, item)
	}
	withoutNewRouteSaved, err := service.SaveBusinessMenu(t.Context(), SaveBusinessMenuInput{
		Revision:        withPending.Draft.Revision,
		CatalogRevision: withPending.CatalogRevision,
		Items:           filteredNewRoute,
	}, principal, "delete-pending-menu-route")
	if err != nil || menuContainsRoute(withoutNewRouteSaved.Draft, "new-domain/new-entity") {
		t.Fatalf("delete pending route = %+v, %v", withoutNewRouteSaved.Draft, err)
	}

	restoredRoutes := menuViewToInput(withoutNewRouteSaved.Draft.Items)
	otherGroupID := ""
	for _, item := range restoredRoutes {
		if item.Type == MenuItemGroup && item.DisplayName == "其他/待归类" {
			otherGroupID = item.ID
			break
		}
	}
	if otherGroupID == "" {
		t.Fatal("other group is missing from business template")
	}
	restoredRoutes = append(restoredRoutes, SaveMenuItemInput{
		ID: newID(), ParentID: &systemGroup, Type: MenuItemRoute, Order: 1002,
		DisplayName: "客户", Enabled: true, RouteKey: stringPointer("bob/customer"),
	})
	restoredRoutes = append(restoredRoutes, SaveMenuItemInput{
		ID: newID(), ParentID: &otherGroupID, Type: MenuItemRoute, Order: 1003,
		DisplayName: "新增路由", Enabled: true, RouteKey: stringPointer("new-domain/new-entity"),
	})
	restored, err := service.SaveBusinessMenu(t.Context(), SaveBusinessMenuInput{
		Revision:        withoutNewRouteSaved.Draft.Revision,
		CatalogRevision: withoutNewRouteSaved.CatalogRevision,
		Items:           restoredRoutes,
	}, principal, "restore-customer-menu")
	if err != nil || !menuContainsRoute(restored.Draft, "bob/customer") || !menuContainsRoute(restored.Draft, "new-domain/new-entity") {
		t.Fatalf("restore deleted routes = %+v, %v", restored.Draft, err)
	}
	if _, err = pool.Exec(t.Context(), `
		UPDATE app_permissions SET status = 'DISABLED'
		WHERE path = '/new-domain/new-entity/query'
	`); err != nil {
		t.Fatalf("retire menu route permission: %v", err)
	}
	retired, err := service.GetMenu(t.Context(), principal)
	if err != nil {
		t.Fatalf("get menu after route retirement: %v", err)
	}
	if menuContainsRoute(retired.Draft, "new-domain/new-entity") {
		t.Fatalf("retired route remained editable: %+v", retired.Draft)
	}
	if _, err = service.PublishBusinessMenu(t.Context(), PublishBusinessMenuInput{
		Revision: retired.Draft.Revision, CatalogRevision: retired.CatalogRevision,
	}, principal, "publish-retired-menu-route"); !errorIsKind(err, ErrorValidation) {
		t.Fatalf("publish retired route error = %v", err)
	}

	limited := Principal{User: principal.User, Permissions: []string{"/bob/customer/get"}}
	filtered, err := service.GetMenu(t.Context(), limited)
	if err != nil {
		t.Fatalf("get filtered menu: %v", err)
	}
	if !menuContainsRoute(filtered.Navigation, "bob/customer") || menuContainsRoute(filtered.Navigation, "app/user") {
		t.Fatalf("permission-filtered navigation = %+v", filtered.Navigation)
	}

	var auditCount int
	if err = pool.QueryRow(t.Context(), `SELECT count(*) FROM app_audit_events WHERE event_type IN ('MENU_BUSINESS_TEMPLATE_RESET', 'MENU_BUSINESS_TEMPLATE_SAVE', 'MENU_BUSINESS_TEMPLATE_PUBLISH', 'MENU_MODE_ACTIVATE')`).Scan(&auditCount); err != nil || auditCount < 4 {
		t.Fatalf("menu audit count = %d, %v", auditCount, err)
	}
	_ = current
}

func menuContainsRoute(tree MenuTree, key string) bool {
	for _, item := range tree.Items {
		if item.RouteKey != nil && *item.RouteKey == key {
			return true
		}
	}
	return false
}

func menuContainsID(tree MenuTree, id string) bool {
	for _, item := range tree.Items {
		if item.ID == id {
			return true
		}
	}
	return false
}

func menuHasGroupName(tree MenuTree, name string) bool {
	for _, item := range tree.Items {
		if item.Type == MenuItemGroup && item.DisplayName == name {
			return true
		}
	}
	return false
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

func assertMenuRouteOrder(t *testing.T, tree MenuTree, parentID string, keys ...string) {
	t.Helper()
	orders := make(map[string]int32, len(keys))
	for _, item := range tree.Items {
		if item.ParentID == nil || *item.ParentID != parentID || item.RouteKey == nil {
			continue
		}
		orders[*item.RouteKey] = item.Order
	}
	last := int32(-1)
	for _, key := range keys {
		order, exists := orders[key]
		if !exists {
			t.Fatalf("menu route %q is missing under %q: %+v", key, parentID, tree.Items)
		}
		if order <= last {
			t.Fatalf("menu route order under %q = %+v, want %v in order", parentID, orders, keys)
		}
		last = order
	}
}

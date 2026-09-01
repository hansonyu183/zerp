//go:build integration

package app

import (
	"strings"
	"sync"
	"testing"
)

func TestSynchronizeMenuRoutesInitializesCatalogAndIsIdempotent(t *testing.T) {
	service, _, admin := appIntegrationService(t)
	principal := Principal{User: UserSummary{ID: admin.ID}}

	if err := service.SynchronizeMenuRoutes(t.Context()); err != nil {
		t.Fatalf("initial menu route synchronization: %v", err)
	}
	initialized, err := service.GetMenu(t.Context(), principal)
	if err != nil || !menuContainsRoute(initialized.BusinessMenu, "app/menu") {
		t.Fatalf("initialized menu = %+v, %v", initialized, err)
	}
	if !menuContainsRoute(initialized.BusinessMenu, "dcl/customer") {
		t.Fatalf("DCL customer route missing from initialized menu: %+v", initialized.BusinessMenu)
	}
	for name, tree := range map[string]MenuTree{
		"default": initialized.DefaultMenu, "business": initialized.BusinessMenu, "navigation": initialized.Navigation,
	} {
		for _, item := range tree.Items {
			if item.RouteKey != nil && strings.HasPrefix(*item.RouteKey, "bob/") {
				t.Fatalf("%s menu exposed BOB current-read route %q", name, *item.RouteKey)
			}
			if item.Type == MenuItemGroup && item.DisplayName == "业务对象" {
				t.Fatalf("%s menu exposed retired business-object group", name)
			}
		}
	}
	for _, route := range initialized.AvailableRoutes {
		if strings.HasPrefix(route.RouteKey, "bob/") {
			t.Fatalf("available routes exposed BOB current-read route %q", route.RouteKey)
		}
	}
	if err = service.SynchronizeMenuRoutes(t.Context()); err != nil {
		t.Fatalf("idempotent menu route synchronization: %v", err)
	}
	stable, err := service.GetMenu(t.Context(), principal)
	if err != nil || stable.Revision != initialized.Revision {
		t.Fatalf("idempotent menu revision = %d, want %d, error = %v", stable.Revision, initialized.Revision, err)
	}
}

func TestGetMenuDoesNotSynchronizeOrWriteRouteCatalog(t *testing.T) {
	service, pool, admin := appIntegrationService(t)
	if err := service.SynchronizeMenuRoutes(t.Context()); err != nil {
		t.Fatalf("initial menu route synchronization: %v", err)
	}
	principal := Principal{User: UserSummary{ID: admin.ID}}
	before, err := service.GetMenu(t.Context(), principal)
	if err != nil {
		t.Fatalf("get initial menu: %v", err)
	}
	var itemCountBefore int
	if err = pool.QueryRow(t.Context(), `SELECT count(*) FROM app_business_menu_items`).Scan(&itemCountBefore); err != nil {
		t.Fatalf("count initial menu items: %v", err)
	}
	if _, err = pool.Exec(t.Context(), `
		INSERT INTO app_permissions (id, path, domain, entity, action, description, status)
		VALUES ('01JAPPMENUPUREREAD0000001', '/pure-read/example/query', 'pure-read', 'example', 'query', '查询纯读菜单证据', 'ENABLED')
		ON CONFLICT (id) DO UPDATE SET status = 'ENABLED', description = EXCLUDED.description
	`); err != nil {
		t.Fatalf("register route after startup: %v", err)
	}

	read, err := service.GetMenu(t.Context(), principal)
	if err != nil {
		t.Fatalf("get menu after route registration: %v", err)
	}
	var revisionAfter int64
	var itemCountAfter int
	if err = pool.QueryRow(t.Context(), `
		SELECT settings.revision, (SELECT count(*) FROM app_business_menu_items)
		FROM app_menu_settings settings WHERE settings.id = 1
	`).Scan(&revisionAfter, &itemCountAfter); err != nil {
		t.Fatalf("read menu state after get: %v", err)
	}
	if read.Revision != before.Revision || revisionAfter != before.Revision || itemCountAfter != itemCountBefore || menuContainsRoute(read.BusinessMenu, "pure-read/example") {
		t.Fatalf("GetMenu wrote route catalog: responseRevision=%d databaseRevision=%d itemCount=%d routePresent=%t", read.Revision, revisionAfter, itemCountAfter, menuContainsRoute(read.BusinessMenu, "pure-read/example"))
	}
}

func TestReferencePermissionRoutesAreNotNavigable(t *testing.T) {
	service, _, admin := appIntegrationService(t)
	if err := service.SynchronizeMenuRoutes(t.Context()); err != nil {
		t.Fatalf("initial menu route synchronization: %v", err)
	}
	principal := Principal{
		User:        UserSummary{ID: admin.ID},
		Permissions: []string{"/aux/reference/query", "/bob/reference/query"},
	}
	menu, err := service.GetMenu(t.Context(), principal)
	if err != nil {
		t.Fatalf("get menu with reference permissions: %v", err)
	}
	for _, routeKey := range []string{"aux/reference", "bob/reference"} {
		if menuContainsRoute(menu.DefaultMenu, routeKey) || menuContainsRoute(menu.BusinessMenu, routeKey) || menuContainsRoute(menu.Navigation, routeKey) {
			t.Fatalf("reference route %q exposed in menu: default=%t business=%t navigation=%t", routeKey,
				menuContainsRoute(menu.DefaultMenu, routeKey), menuContainsRoute(menu.BusinessMenu, routeKey), menuContainsRoute(menu.Navigation, routeKey))
		}
		for _, route := range menu.AvailableRoutes {
			if route.RouteKey == routeKey {
				t.Fatalf("reference route %q exposed in available routes", routeKey)
			}
		}
	}
}

func TestMenuManagementIntegration(t *testing.T) {
	service, pool, admin := appIntegrationService(t)
	if err := service.SynchronizeMenuRoutes(t.Context()); err != nil {
		t.Fatalf("synchronize menu routes at startup: %v", err)
	}
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

	initial, err := service.GetMenu(t.Context(), principal)
	if err != nil || initial.Mode != MenuModeDefault || !menuContainsRoute(initial.BusinessMenu, "app/menu") {
		t.Fatalf("initial menu = %+v, %v", initial, err)
	}
	if _, err = service.ActivateMenu(t.Context(), ActivateMenuInput{Mode: "CUSTOM", Revision: initial.Revision}, principal, "invalid-mode"); !errorIsKind(err, ErrorValidation) {
		t.Fatalf("invalid mode error = %v", err)
	}

	reset, err := service.ResetBusinessMenu(t.Context(), ResetBusinessMenuInput{Revision: initial.Revision}, principal, "reset-menu")
	if err != nil || reset.Revision != initial.Revision+1 {
		t.Fatalf("reset menu = %+v, %v", reset, err)
	}
	activated, err := service.ActivateMenu(t.Context(), ActivateMenuInput{Mode: MenuModeBusiness, Revision: reset.Revision}, principal, "activate-menu")
	if err != nil || activated.Mode != MenuModeBusiness || activated.Revision != reset.Revision+1 {
		t.Fatalf("activate menu = %+v, %v", activated, err)
	}

	items := menuViewToInput(activated.BusinessMenu.Items)
	for index := range items {
		if items[index].Type == MenuItemGroup && items[index].DisplayName == "系统管理" {
			items[index].DisplayName = "系统中心"
		}
	}
	saved, err := service.SaveBusinessMenu(t.Context(), SaveBusinessMenuInput{Revision: activated.Revision, Items: items}, principal, "save-menu")
	if err != nil || saved.Revision != activated.Revision+1 || !menuHasGroupName(saved.BusinessMenu, "系统中心") || !menuHasGroupName(saved.Navigation, "系统中心") {
		t.Fatalf("save active business menu = %+v, %v", saved, err)
	}

	duplicate := menuViewToInput(saved.BusinessMenu.Items)
	for _, item := range duplicate {
		if item.RouteKey != nil && *item.RouteKey == "app/user" {
			item.ID = "duplicate-user-route"
			duplicate = append(duplicate, item)
			break
		}
	}
	if _, err = service.SaveBusinessMenu(t.Context(), SaveBusinessMenuInput{Revision: saved.Revision, Items: duplicate}, principal, "duplicate-route"); !errorIsKind(err, ErrorValidation) {
		t.Fatalf("duplicate route error = %v", err)
	}

	concurrent := SaveBusinessMenuInput{Revision: saved.Revision, Items: menuViewToInput(saved.BusinessMenu.Items)}
	var wait sync.WaitGroup
	results := make(chan error, 2)
	for range 2 {
		wait.Add(1)
		go func() {
			defer wait.Done()
			_, saveErr := service.SaveBusinessMenu(t.Context(), concurrent, principal, "concurrent-menu")
			results <- saveErr
		}()
	}
	wait.Wait()
	close(results)
	successes, conflicts := 0, 0
	for saveErr := range results {
		if saveErr == nil {
			successes++
		} else if errorIsKind(saveErr, ErrorConflict) {
			conflicts++
		} else {
			t.Fatalf("unexpected concurrent error: %v", saveErr)
		}
	}
	if successes != 1 || conflicts != 1 {
		t.Fatalf("concurrent saves: successes=%d conflicts=%d", successes, conflicts)
	}

	beforeRoutes, err := service.GetMenu(t.Context(), principal)
	if err != nil {
		t.Fatalf("get before route registration: %v", err)
	}
	if _, err = pool.Exec(t.Context(), `
		INSERT INTO app_permissions (id, path, domain, entity, action, description, status)
		VALUES
			('01JAPPMENUTESTNEWROUTE0001', '/new-domain/new-entity/query', 'new-domain', 'new-entity', 'query', '查询新增路由', 'ENABLED'),
			('01JAPPMENUTESTNEWROUTE0002', '/vou/zz-unclassified/query', 'vou', 'zz-unclassified', 'query', '查询未归类单据', 'ENABLED')
		ON CONFLICT (id) DO UPDATE SET status = 'ENABLED', description = EXCLUDED.description
	`); err != nil {
		t.Fatalf("register menu routes: %v", err)
	}
	readBeforeSync, err := service.GetMenu(t.Context(), principal)
	if err != nil || readBeforeSync.Revision != beforeRoutes.Revision || menuContainsRoute(readBeforeSync.BusinessMenu, "new-domain/new-entity") {
		t.Fatalf("menu read had synchronization side effects = %+v, %v", readBeforeSync, err)
	}
	if err = service.SynchronizeMenuRoutes(t.Context()); err != nil {
		t.Fatalf("synchronize new menu routes: %v", err)
	}
	withRoutes, err := service.GetMenu(t.Context(), principal)
	if err != nil || withRoutes.Revision != beforeRoutes.Revision+1 || !menuRouteUnderGroup(withRoutes.BusinessMenu, "new-domain/new-entity", "其他/待归类") || !menuRouteUnderGroup(withRoutes.BusinessMenu, "vou/zz-unclassified", "其他/待归类") {
		t.Fatalf("startup route synchronization = %+v, %v", withRoutes, err)
	}
	if err = service.SynchronizeMenuRoutes(t.Context()); err != nil {
		t.Fatalf("repeat menu route synchronization: %v", err)
	}
	stable, err := service.GetMenu(t.Context(), principal)
	if err != nil || stable.Revision != withRoutes.Revision || menuRouteCount(stable.BusinessMenu, "new-domain/new-entity") != 1 {
		t.Fatalf("idempotent startup route synchronization = %+v, %v", stable, err)
	}

	if _, err = pool.Exec(t.Context(), `UPDATE app_permissions SET status = 'DISABLED' WHERE path = '/new-domain/new-entity/query'`); err != nil {
		t.Fatalf("retire menu route: %v", err)
	}
	readBeforeRetirementSync, err := service.GetMenu(t.Context(), principal)
	if err != nil || readBeforeRetirementSync.Revision != stable.Revision || menuContainsRoute(readBeforeRetirementSync.BusinessMenu, "new-domain/new-entity") {
		t.Fatalf("menu read changed retired routes = %+v, %v", readBeforeRetirementSync, err)
	}
	var storedRetiredRouteCount int
	var storedRevision int64
	if err = pool.QueryRow(t.Context(), `
		SELECT
			(SELECT count(*) FROM app_business_menu_items WHERE route_key = 'new-domain/new-entity'),
			(SELECT revision FROM app_menu_settings WHERE id = 1)
	`).Scan(&storedRetiredRouteCount, &storedRevision); err != nil {
		t.Fatalf("read retired route persistence: %v", err)
	}
	if storedRetiredRouteCount != 1 || storedRevision != stable.Revision {
		t.Fatalf("menu read wrote retired route state: routeCount=%d revision=%d", storedRetiredRouteCount, storedRevision)
	}
	if err = service.SynchronizeMenuRoutes(t.Context()); err != nil {
		t.Fatalf("synchronize retired menu route: %v", err)
	}
	retired, err := service.GetMenu(t.Context(), principal)
	if err != nil || retired.Revision != stable.Revision+1 || menuContainsRoute(retired.BusinessMenu, "new-domain/new-entity") || menuContainsRoute(retired.Navigation, "new-domain/new-entity") {
		t.Fatalf("startup retired route synchronization = %+v, %v", retired, err)
	}
	if _, err = pool.Exec(t.Context(), `UPDATE app_permissions SET status = 'ENABLED' WHERE path = '/new-domain/new-entity/query'`); err != nil {
		t.Fatalf("restore menu route: %v", err)
	}
	if err = service.SynchronizeMenuRoutes(t.Context()); err != nil {
		t.Fatalf("synchronize restored menu route: %v", err)
	}
	restored, err := service.GetMenu(t.Context(), principal)
	if err != nil || !menuRouteUnderGroup(restored.BusinessMenu, "new-domain/new-entity", "其他/待归类") {
		t.Fatalf("restored route synchronization = %+v, %v", restored, err)
	}

	limited := Principal{User: principal.User, Permissions: []string{"/dcl/customer/get"}}
	filtered, err := service.GetMenu(t.Context(), limited)
	if err != nil || !menuContainsRoute(filtered.Navigation, "dcl/customer") || menuContainsRoute(filtered.Navigation, "app/user") || menuContainsRoute(filtered.Navigation, "bob/customer") {
		t.Fatalf("permission-filtered navigation = %+v, %v", filtered.Navigation, err)
	}

	var auditCount int
	if err = pool.QueryRow(t.Context(), `SELECT count(*) FROM app_audit_events WHERE event_type IN ('MENU_BUSINESS_RESET', 'MENU_BUSINESS_SAVE', 'MENU_MODE_ACTIVATE')`).Scan(&auditCount); err != nil || auditCount < 3 {
		t.Fatalf("menu audit count = %d, %v", auditCount, err)
	}
}

func menuContainsRoute(tree MenuTree, key string) bool {
	return menuRouteCount(tree, key) > 0
}

func menuRouteTotal(tree MenuTree) int {
	count := 0
	for _, item := range tree.Items {
		if item.Type == MenuItemRoute {
			count++
		}
	}
	return count
}

func menuRouteCount(tree MenuTree, key string) int {
	count := 0
	for _, item := range tree.Items {
		if item.RouteKey != nil && *item.RouteKey == key {
			count++
		}
	}
	return count
}

func menuHasGroupName(tree MenuTree, name string) bool {
	for _, item := range tree.Items {
		if item.Type == MenuItemGroup && item.DisplayName == name {
			return true
		}
	}
	return false
}

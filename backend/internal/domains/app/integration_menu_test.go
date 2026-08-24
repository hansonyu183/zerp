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
	withRoutes, err := service.GetMenu(t.Context(), principal)
	if err != nil || withRoutes.Revision != beforeRoutes.Revision+1 || !menuRouteUnderGroup(withRoutes.BusinessMenu, "new-domain/new-entity", "其他/待归类") || !menuRouteUnderGroup(withRoutes.BusinessMenu, "vou/zz-unclassified", "其他/待归类") {
		t.Fatalf("new route synchronization = %+v, %v", withRoutes, err)
	}
	stable, err := service.GetMenu(t.Context(), principal)
	if err != nil || stable.Revision != withRoutes.Revision || menuRouteCount(stable.BusinessMenu, "new-domain/new-entity") != 1 {
		t.Fatalf("idempotent route synchronization = %+v, %v", stable, err)
	}

	if _, err = pool.Exec(t.Context(), `UPDATE app_permissions SET status = 'DISABLED' WHERE path = '/new-domain/new-entity/query'`); err != nil {
		t.Fatalf("retire menu route: %v", err)
	}
	retired, err := service.GetMenu(t.Context(), principal)
	if err != nil || retired.Revision != stable.Revision+1 || menuContainsRoute(retired.BusinessMenu, "new-domain/new-entity") || menuContainsRoute(retired.Navigation, "new-domain/new-entity") {
		t.Fatalf("retired route synchronization = %+v, %v", retired, err)
	}
	if _, err = pool.Exec(t.Context(), `UPDATE app_permissions SET status = 'ENABLED' WHERE path = '/new-domain/new-entity/query'`); err != nil {
		t.Fatalf("restore menu route: %v", err)
	}
	restored, err := service.GetMenu(t.Context(), principal)
	if err != nil || !menuRouteUnderGroup(restored.BusinessMenu, "new-domain/new-entity", "其他/待归类") {
		t.Fatalf("restored route synchronization = %+v, %v", restored, err)
	}

	limited := Principal{User: principal.User, Permissions: []string{"/bob/customer/get"}}
	filtered, err := service.GetMenu(t.Context(), limited)
	if err != nil || !menuContainsRoute(filtered.Navigation, "bob/customer") || menuContainsRoute(filtered.Navigation, "app/user") {
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

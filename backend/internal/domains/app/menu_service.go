package app

import (
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"sort"
	"strings"
	"unicode/utf8"

	dbsqlc "github.com/hansonyu183/zerp/backend/internal/database/sqlc"
	"github.com/jackc/pgx/v5"
)

type registeredMenuRoute struct {
	RouteKey       string
	RoutePath      string
	DisplayName    string
	PermissionCode string
	PermissionRoot string
	Order          int32
	Always         bool
}

type initialMenuGroup struct {
	ID    string
	Name  string
	Icon  string
	Order int32
}

const menuRouteTombstoneGroupID = "menu-group-route-tombstones"

var businessMenuGroups = []initialMenuGroup{
	{ID: "menu-group-sales", Name: "销售", Icon: "mdi-cart-arrow-up", Order: 20},
	{ID: "menu-group-purchase", Name: "采购", Icon: "mdi-cart-arrow-down", Order: 30},
	{ID: "menu-group-production", Name: "生产", Icon: "mdi-factory", Order: 40},
	{ID: "menu-group-inventory", Name: "库存", Icon: "mdi-warehouse", Order: 50},
	{ID: "menu-group-cash", Name: "出纳", Icon: "mdi-cash-register", Order: 60},
	{ID: "menu-group-assets", Name: "资产", Icon: "mdi-office-building-cog-outline", Order: 70},
	{ID: "menu-group-people", Name: "人事", Icon: "mdi-account-group-outline", Order: 80},
	{ID: "menu-group-accounting", Name: "会计", Icon: "mdi-calculator-variant-outline", Order: 90},
	{ID: "menu-group-master-data", Name: "基础资料", Icon: "mdi-database-outline", Order: 100},
	{ID: "menu-group-auxiliary-data", Name: "辅助资料", Icon: "mdi-shape-plus-outline", Order: 110},
	{ID: "menu-group-workflow", Name: "业务流程", Icon: "mdi-transit-connection-variant", Order: 120},
	{ID: "menu-group-system", Name: "系统管理", Icon: "mdi-cog-outline", Order: 130},
	{ID: "menu-group-reporting", Name: "报表", Icon: "mdi-chart-box-outline", Order: 140},
	{ID: "menu-group-other", Name: "其他/待归类", Icon: "mdi-folder-question-outline", Order: 150},
}

const (
	menuSnapshotDraft     = "DRAFT"
	menuSnapshotPublished = "PUBLISHED"
)

func (s *Service) GetMenu(ctx context.Context, principal Principal) (MenuGetData, error) {
	mode, err := s.queries.GetAppSystemParameter(ctx, MenuModeParameterKey)
	if errors.Is(err, pgx.ErrNoRows) {
		return MenuGetData{}, domainError(ErrorInternal, "menu mode is not registered", err)
	}
	if err != nil {
		return MenuGetData{}, s.internal("get menu mode", err)
	}
	catalog, err := s.menuCatalog(ctx, s.queries)
	if err != nil {
		return MenuGetData{}, err
	}
	draft, err := s.menuSnapshot(ctx, s.queries, menuSnapshotDraft, catalog, true)
	if err != nil {
		return MenuGetData{}, err
	}
	published, err := s.menuSnapshot(ctx, s.queries, menuSnapshotPublished, catalog, false)
	if err != nil {
		return MenuGetData{}, err
	}
	defaultMenu := buildDefaultMenu(catalog)
	selected := defaultMenu
	if mode.ConfiguredValue == MenuModeBusinessTemplate {
		selected = published
	} else if mode.ConfiguredValue != MenuModeDefault {
		return MenuGetData{}, domainError(ErrorInternal, "invalid registered menu mode", nil)
	}
	return MenuGetData{
		Mode: mode.ConfiguredValue, ModeRevision: mode.Revision, CatalogRevision: menuCatalogRevision(catalog),
		DefaultMenu: defaultMenu, Draft: draft, Published: published,
		Navigation:      filterMenuForPrincipal(selected, catalog, principal),
		AvailableRoutes: menuRouteOptions(catalog),
	}, nil
}

func (s *Service) menuSnapshot(ctx context.Context, q *dbsqlc.Queries, snapshotType string, catalog []registeredMenuRoute, appendRoutes bool) (MenuTree, error) {
	rows, err := q.ListAppBusinessMenuItems(ctx, snapshotType)
	if err != nil {
		return MenuTree{}, s.internal("list business menu items", err)
	}
	revision, err := businessMenuRevision(rows)
	if err != nil {
		return MenuTree{}, s.internal("read business menu revision", err)
	}
	tree := editableMenuTreeFromRows(rows, revision, catalog)
	if appendRoutes {
		tree = appendUnclassifiedRoutes(tree, catalog, menuRouteTombstones(rows))
	}
	return tree, nil
}

func businessMenuRevision(rows []dbsqlc.AppBusinessMenuItem) (int64, error) {
	if len(rows) == 0 {
		return 1, nil
	}
	revision := rows[0].Revision
	for _, row := range rows[1:] {
		if row.Revision != revision {
			return 0, errors.ErrUnsupported
		}
	}
	return revision, nil
}

func (s *Service) SaveBusinessMenu(ctx context.Context, input SaveBusinessMenuInput, principal Principal, requestID string) (MenuGetData, error) {
	if input.Revision < 1 || input.CatalogRevision == "" || len(input.Items) == 0 || len(input.Items) > 1000 {
		return MenuGetData{}, domainError(ErrorValidation, "invalid business menu request", nil)
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return MenuGetData{}, s.internal("begin save business menu", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	qtx := s.queries.WithTx(tx)
	if err = qtx.AcquireAppMenuLock(ctx); err != nil {
		return MenuGetData{}, s.internal("lock business menu", err)
	}
	catalog, err := s.menuCatalog(ctx, qtx)
	if err != nil {
		return MenuGetData{}, err
	}
	if input.CatalogRevision != menuCatalogRevision(catalog) {
		return MenuGetData{}, domainError(ErrorConflict, "menu catalog revision conflict", nil)
	}
	revision, err := qtx.GetAppBusinessMenuRevision(ctx, menuSnapshotDraft)
	if err != nil {
		return MenuGetData{}, s.internal("get draft menu revision", err)
	}
	if revision != input.Revision {
		return MenuGetData{}, domainError(ErrorConflict, "draft menu revision conflict", nil)
	}
	items, err := validateBusinessMenu(input.Items, catalog)
	if err != nil {
		return MenuGetData{}, err
	}
	newRevision := revision + 1
	if err = replaceBusinessMenu(ctx, qtx, menuSnapshotDraft, items, catalog, newRevision, principal.User.ID); err != nil {
		return MenuGetData{}, s.internal("replace draft business menu", err)
	}
	groups, routes := menuItemCounts(items)
	if err = s.audit(ctx, qtx, "MENU_BUSINESS_TEMPLATE_SAVE", &principal.User.ID, "menu", nil, "SUCCESS", requestID, map[string]any{"revision": newRevision, "groups": groups, "routes": routes}); err != nil {
		return MenuGetData{}, s.internal("audit business menu save", err)
	}
	if err = tx.Commit(ctx); err != nil {
		return MenuGetData{}, s.internal("commit business menu save", err)
	}
	return s.GetMenu(ctx, principal)
}

func (s *Service) PublishBusinessMenu(ctx context.Context, input PublishBusinessMenuInput, principal Principal, requestID string) (MenuGetData, error) {
	if input.Revision < 1 || input.CatalogRevision == "" {
		return MenuGetData{}, domainError(ErrorValidation, "invalid business menu publish request", nil)
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return MenuGetData{}, s.internal("begin publish business menu", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	qtx := s.queries.WithTx(tx)
	if err = qtx.AcquireAppMenuLock(ctx); err != nil {
		return MenuGetData{}, s.internal("lock business menu", err)
	}
	catalog, err := s.menuCatalog(ctx, qtx)
	if err != nil {
		return MenuGetData{}, err
	}
	if input.CatalogRevision != menuCatalogRevision(catalog) {
		return MenuGetData{}, domainError(ErrorConflict, "menu catalog revision conflict", nil)
	}
	draftRows, err := qtx.ListAppBusinessMenuItems(ctx, menuSnapshotDraft)
	if err != nil {
		return MenuGetData{}, s.internal("list draft menu", err)
	}
	draftRevision, err := businessMenuRevision(draftRows)
	if err != nil {
		return MenuGetData{}, s.internal("read draft menu revision", err)
	}
	if draftRevision != input.Revision {
		return MenuGetData{}, domainError(ErrorConflict, "draft menu revision conflict", nil)
	}
	// Publishing revalidates the persisted draft against the catalog locked by
	// catalogRevision. A route can retire after the last draft save, and such a
	// normal route must not be copied into a newly published snapshot. Stored
	// tombstones remain intentionally outside the editable tree and are copied.
	if _, err = validateBusinessMenu(
		menuViewToInput(menuTreeFromRows(draftRows, draftRevision, catalog).Items),
		catalog,
	); err != nil {
		return MenuGetData{}, err
	}
	publishedRevision, err := qtx.GetAppBusinessMenuRevision(ctx, menuSnapshotPublished)
	if err != nil {
		return MenuGetData{}, s.internal("get published menu revision", err)
	}
	newPublishedRevision := publishedRevision + 1
	if err = replaceBusinessMenuRows(ctx, qtx, menuSnapshotPublished, draftRows, newPublishedRevision, principal.User.ID); err != nil {
		return MenuGetData{}, s.internal("replace published business menu", err)
	}
	if err = s.audit(ctx, qtx, "MENU_BUSINESS_TEMPLATE_PUBLISH", &principal.User.ID, "menu", nil, "SUCCESS", requestID, map[string]any{"draftRevision": draftRevision, "publishedRevision": newPublishedRevision}); err != nil {
		return MenuGetData{}, s.internal("audit business menu publish", err)
	}
	if err = tx.Commit(ctx); err != nil {
		return MenuGetData{}, s.internal("commit publish business menu", err)
	}
	return s.GetMenu(ctx, principal)
}

func (s *Service) ActivateMenu(ctx context.Context, input ActivateMenuInput, principal Principal, requestID string) (MenuGetData, error) {
	if input.Revision < 1 || input.CatalogRevision == "" || (input.Mode != MenuModeDefault && input.Mode != MenuModeBusinessTemplate) {
		return MenuGetData{}, domainError(ErrorValidation, "invalid menu mode", nil)
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return MenuGetData{}, s.internal("begin activate menu", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	qtx := s.queries.WithTx(tx)
	if err = qtx.AcquireAppMenuLock(ctx); err != nil {
		return MenuGetData{}, s.internal("lock business menu", err)
	}
	catalog, err := s.menuCatalog(ctx, qtx)
	if err != nil {
		return MenuGetData{}, err
	}
	if input.CatalogRevision != menuCatalogRevision(catalog) {
		return MenuGetData{}, domainError(ErrorConflict, "menu catalog revision conflict", nil)
	}
	parameter, err := qtx.GetAppSystemParameterForUpdate(ctx, MenuModeParameterKey)
	if err != nil {
		return MenuGetData{}, s.internal("lock menu mode", err)
	}
	if parameter.Revision != input.Revision {
		return MenuGetData{}, domainError(ErrorConflict, "menu mode revision conflict", nil)
	}
	if parameter.ConfiguredValue == input.Mode {
		if err = tx.Commit(ctx); err != nil {
			return MenuGetData{}, s.internal("commit unchanged menu mode", err)
		}
		return s.GetMenu(ctx, principal)
	}
	updated, err := qtx.UpdateAppMenuMode(ctx, dbsqlc.UpdateAppMenuModeParams{Mode: input.Mode, ActorID: &principal.User.ID, Revision: input.Revision})
	if errors.Is(err, pgx.ErrNoRows) {
		return MenuGetData{}, domainError(ErrorConflict, "menu mode changed concurrently", nil)
	}
	if err != nil {
		return MenuGetData{}, s.internal("activate menu", err)
	}
	if err = s.audit(ctx, qtx, "MENU_MODE_ACTIVATE", &principal.User.ID, "system-parameter", stringPointer(MenuModeParameterKey), "SUCCESS", requestID, map[string]any{"from": parameter.ConfiguredValue, "to": input.Mode, "revision": updated.Revision}); err != nil {
		return MenuGetData{}, s.internal("audit menu activation", err)
	}
	if err = tx.Commit(ctx); err != nil {
		return MenuGetData{}, s.internal("commit menu activation", err)
	}
	return s.GetMenu(ctx, principal)
}

func (s *Service) ResetBusinessMenu(ctx context.Context, input ResetBusinessMenuInput, principal Principal, requestID string) (MenuGetData, error) {
	if input.Revision < 1 || input.CatalogRevision == "" {
		return MenuGetData{}, domainError(ErrorValidation, "invalid business menu revision", nil)
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return MenuGetData{}, s.internal("begin reset business menu", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	qtx := s.queries.WithTx(tx)
	if err = qtx.AcquireAppMenuLock(ctx); err != nil {
		return MenuGetData{}, s.internal("lock business menu", err)
	}
	catalog, err := s.menuCatalog(ctx, qtx)
	if err != nil {
		return MenuGetData{}, err
	}
	if input.CatalogRevision != menuCatalogRevision(catalog) {
		return MenuGetData{}, domainError(ErrorConflict, "menu catalog revision conflict", nil)
	}
	revision, err := qtx.GetAppBusinessMenuRevision(ctx, menuSnapshotDraft)
	if err != nil {
		return MenuGetData{}, s.internal("get draft menu revision", err)
	}
	if revision != input.Revision {
		return MenuGetData{}, domainError(ErrorConflict, "draft menu revision conflict", nil)
	}
	newRevision := revision + 1
	if err = replaceBusinessMenu(ctx, qtx, menuSnapshotDraft, menuViewToInput(buildInitialBusinessMenu(catalog, newRevision).Items), catalog, newRevision, principal.User.ID); err != nil {
		return MenuGetData{}, s.internal("reset draft business menu", err)
	}
	if err = s.audit(ctx, qtx, "MENU_BUSINESS_TEMPLATE_RESET", &principal.User.ID, "menu", nil, "SUCCESS", requestID, map[string]any{"revision": newRevision}); err != nil {
		return MenuGetData{}, s.internal("audit business menu reset", err)
	}
	if err = tx.Commit(ctx); err != nil {
		return MenuGetData{}, s.internal("commit reset business menu", err)
	}
	return s.GetMenu(ctx, principal)
}

func (s *Service) menuCatalog(ctx context.Context, q *dbsqlc.Queries) ([]registeredMenuRoute, error) {
	rows, err := q.ListAppMenuPermissionRoutes(ctx)
	if err != nil {
		return nil, s.internal("list registered menu routes", err)
	}
	routes := []registeredMenuRoute{
		{RouteKey: "home/dashboard", RoutePath: "/home/dashboard", DisplayName: "工作台", PermissionCode: "/app/workbench/query", Order: 10, Always: true},
		{RouteKey: "app/user", RoutePath: "/app/user", DisplayName: "用户管理", PermissionCode: "/app/user/query", Order: 10},
		{RouteKey: "app/role", RoutePath: "/app/role", DisplayName: "角色管理", PermissionCode: "/app/role/query", Order: 20},
		{RouteKey: "app/permission", RoutePath: "/app/permission", DisplayName: "权限管理", PermissionCode: "/app/permission/query", Order: 30},
		{RouteKey: "app/system-parameter", RoutePath: "/app/system-parameter", DisplayName: "系统参数", PermissionCode: "/app/system-parameter/query", Order: 40},
		{RouteKey: "app/menu", RoutePath: "/app/menu", DisplayName: "菜单管理", PermissionCode: "/app/menu/save-business-template", PermissionRoot: "/app/menu/", Order: 50},
	}
	for _, row := range rows {
		// RPT directory is a session-only metadata endpoint, not a navigable entity.
		if row.Domain == "rpt" && row.Entity == "directory" {
			continue
		}
		key := row.Domain + "/" + row.Entity
		route := registeredMenuRoute{
			RouteKey: key, RoutePath: "/" + key,
			DisplayName:    menuRouteTitle(row.Entity, row.Description),
			PermissionCode: row.PermissionCode, PermissionRoot: "/" + row.Domain + "/" + row.Entity + "/", Order: row.MenuOrder,
		}
		// Each RPT report and definition management are normal independent
		// entities: their own permissions reveal their own route, never a
		// centralized RPT entry.
		routes = append(routes, route)
	}
	return routes, nil
}

func menuCatalogRevision(catalog []registeredMenuRoute) string {
	hash := sha256.New()
	for _, route := range catalog {
		fmt.Fprintf(hash, "%d:%s|%d:%s|%d:%s|%d:%s|%d:%s|%t|%d;", len(route.RouteKey), route.RouteKey, len(route.RoutePath), route.RoutePath, len(route.DisplayName), route.DisplayName, len(route.PermissionCode), route.PermissionCode, len(route.PermissionRoot), route.PermissionRoot, route.Always, route.Order)
	}
	return fmt.Sprintf("%x", hash.Sum(nil))
}

func validateBusinessMenu(input []SaveMenuItemInput, catalog []registeredMenuRoute) ([]SaveMenuItemInput, error) {
	knownRoutes := make(map[string]registeredMenuRoute, len(catalog))
	for _, route := range catalog {
		knownRoutes[route.RouteKey] = route
	}
	items := make([]SaveMenuItemInput, len(input))
	copy(items, input)
	ids := make(map[string]SaveMenuItemInput, len(items))
	groups := make(map[string]bool)
	for index := range items {
		item := &items[index]
		item.ID = strings.TrimSpace(item.ID)
		item.DisplayName = strings.TrimSpace(item.DisplayName)
		if item.ID == "" {
			item.ID = newID()
		}
		if len(item.ID) > 64 || item.Order < 0 || item.DisplayName == "" || utf8.RuneCountInString(item.DisplayName) > 128 {
			return nil, domainError(ErrorValidation, "invalid menu item", nil)
		}
		if item.ID == menuRouteTombstoneGroupID {
			return nil, domainError(ErrorValidation, "reserved menu item id", nil)
		}
		if _, exists := ids[item.ID]; exists {
			return nil, domainError(ErrorValidation, "duplicate menu item id", nil)
		}
		if item.Icon != nil {
			icon := strings.TrimSpace(*item.Icon)
			if utf8.RuneCountInString(icon) > 128 {
				return nil, domainError(ErrorValidation, "menu icon is too long", nil)
			}
			item.Icon = optionalTrimmed(icon)
		}
		if item.Type == MenuItemGroup {
			if item.ParentID != nil || item.RouteKey != nil {
				return nil, domainError(ErrorValidation, "menu groups must be top level", nil)
			}
			if item.DisplayName == "工作台" {
				return nil, domainError(ErrorValidation, "workbench must be a direct route", nil)
			}
			groups[item.ID] = item.Enabled
		} else if item.Type != MenuItemRoute {
			return nil, domainError(ErrorValidation, "invalid menu item type", nil)
		}
		ids[item.ID] = *item
	}
	hasMenuManagement := false
	for index := range items {
		item := &items[index]
		if item.Type != MenuItemRoute {
			continue
		}
		if item.RouteKey == nil {
			return nil, domainError(ErrorValidation, "menu routes require a route key", nil)
		}
		key := strings.TrimSpace(*item.RouteKey)
		if _, exists := knownRoutes[key]; !exists {
			return nil, domainError(ErrorValidation, "menu route is not registered", nil)
		}
		if key == "home/dashboard" {
			if item.ParentID != nil || item.DisplayName != "工作台" || !item.Enabled {
				return nil, domainError(ErrorValidation, "workbench must be the enabled direct entry", nil)
			}
		} else {
			if item.DisplayName == "工作台" {
				return nil, domainError(ErrorValidation, "workbench name is reserved for the direct entry", nil)
			}
			if item.ParentID == nil {
				return nil, domainError(ErrorValidation, "menu routes require a parent", nil)
			}
			if parent, exists := ids[*item.ParentID]; !exists || parent.Type != MenuItemGroup {
				return nil, domainError(ErrorValidation, "menu depth exceeds two levels or parent is invalid", nil)
			}
		}
		item.RouteKey = stringPointer(key)
		if key == "app/menu" && item.Enabled && item.ParentID != nil && groups[*item.ParentID] {
			hasMenuManagement = true
		}
	}
	workbenchCount := 0
	for _, item := range items {
		if item.Type == MenuItemRoute && item.RouteKey != nil && *item.RouteKey == "home/dashboard" {
			workbenchCount++
		}
	}
	if workbenchCount != 1 {
		return nil, domainError(ErrorValidation, "workbench entry must appear exactly once", nil)
	}
	if !hasMenuManagement {
		return nil, domainError(ErrorValidation, "menu management entry must remain enabled", nil)
	}
	return items, nil
}

func replaceBusinessMenu(ctx context.Context, q *dbsqlc.Queries, snapshotType string, items []SaveMenuItemInput, catalog []registeredMenuRoute, revision int64, actorID string) error {
	previousRows, err := q.ListAppBusinessMenuItems(ctx, snapshotType)
	if err != nil {
		return err
	}
	if err := q.DeleteAppBusinessMenuItems(ctx, snapshotType); err != nil {
		return err
	}
	permissions := make(map[string]string, len(catalog))
	for _, route := range catalog {
		permissions[route.RouteKey] = route.PermissionCode
	}
	ordered := append([]SaveMenuItemInput(nil), items...)
	sort.SliceStable(ordered, func(i, j int) bool { return ordered[i].Type == MenuItemGroup && ordered[j].Type != MenuItemGroup })
	for _, item := range ordered {
		level := int16(1)
		var permission *string
		if item.Type == MenuItemRoute {
			if item.ParentID != nil {
				level = 2
			}
			permission = stringPointer(permissions[*item.RouteKey])
		}
		if err := q.InsertAppBusinessMenuItem(ctx, dbsqlc.InsertAppBusinessMenuItemParams{
			SnapshotType: snapshotType, ID: item.ID, ParentID: item.ParentID, ItemType: item.Type, ItemLevel: level,
			SortOrder: item.Order, DisplayName: item.DisplayName, Icon: item.Icon, Enabled: item.Enabled,
			RouteKey: item.RouteKey, PermissionCode: permission, Revision: revision, ActorID: &actorID,
		}); err != nil {
			return err
		}
	}
	configuredRoutes := make(map[string]bool, len(items))
	for _, item := range items {
		if item.Type == MenuItemRoute && item.RouteKey != nil {
			configuredRoutes[*item.RouteKey] = true
		}
	}
	previousRoutes := menuRouteTombstonePermissions(previousRows)
	// Save receives the complete current template, including routes appended at read time.
	// An omitted catalog route is therefore an administrator deletion even when it
	// has not yet been persisted as a normal menu item.
	for _, route := range catalog {
		if _, exists := previousRoutes[route.RouteKey]; !exists {
			previousRoutes[route.RouteKey] = route.PermissionCode
		}
	}
	deletedRoutes := make([]string, 0, len(previousRoutes))
	for routeKey := range previousRoutes {
		if !configuredRoutes[routeKey] {
			deletedRoutes = append(deletedRoutes, routeKey)
		}
	}
	if len(deletedRoutes) == 0 {
		return nil
	}
	sort.Strings(deletedRoutes)
	if err := q.InsertAppBusinessMenuItem(ctx, dbsqlc.InsertAppBusinessMenuItemParams{
		SnapshotType: snapshotType, ID: menuRouteTombstoneGroupID, ItemType: MenuItemGroup, ItemLevel: 1,
		SortOrder: 1_000_000, DisplayName: "已删除菜单路由", Enabled: false,
		Revision: revision, ActorID: &actorID,
	}); err != nil {
		return err
	}
	for _, routeKey := range deletedRoutes {
		permissionCode := previousRoutes[routeKey]
		if err := q.InsertAppBusinessMenuItem(ctx, dbsqlc.InsertAppBusinessMenuItemParams{
			SnapshotType: snapshotType, ID: stableRouteID("tombstone", routeKey), ParentID: stringPointer(menuRouteTombstoneGroupID),
			ItemType: MenuItemRoute, ItemLevel: 2, SortOrder: 0, DisplayName: routeKey, Enabled: false,
			RouteKey: stringPointer(routeKey), PermissionCode: stringPointer(permissionCode), Revision: revision, ActorID: &actorID,
		}); err != nil {
			return err
		}
	}
	return nil
}

func replaceBusinessMenuRows(ctx context.Context, q *dbsqlc.Queries, snapshotType string, rows []dbsqlc.AppBusinessMenuItem, revision int64, actorID string) error {
	if err := q.DeleteAppBusinessMenuItems(ctx, snapshotType); err != nil {
		return err
	}
	for _, row := range rows {
		if err := q.InsertAppBusinessMenuItem(ctx, dbsqlc.InsertAppBusinessMenuItemParams{
			SnapshotType: snapshotType, ID: row.ID, ParentID: row.ParentID, ItemType: row.ItemType,
			ItemLevel: row.ItemLevel, SortOrder: row.SortOrder, DisplayName: row.DisplayName,
			Icon: row.Icon, Enabled: row.Enabled, RouteKey: row.RouteKey, PermissionCode: row.PermissionCode,
			Revision: revision, ActorID: &actorID,
		}); err != nil {
			return err
		}
	}
	return nil
}

func buildDefaultMenu(catalog []registeredMenuRoute) MenuTree {
	groups := []initialMenuGroup{
		{ID: "default-bob", Name: "业务对象", Icon: "mdi-account-group-outline", Order: 20},
		{ID: "default-aux", Name: "辅助对象", Icon: "mdi-shape-outline", Order: 30},
		{ID: "default-vou", Name: "业务单据", Icon: "mdi-file-document-multiple-outline", Order: 40},
		{ID: "default-wfl", Name: "业务流程", Icon: "mdi-transit-connection-variant", Order: 50},
		{ID: "default-acc", Name: "内部会计", Icon: "mdi-calculator-variant-outline", Order: 60},
		{ID: "default-led", Name: "业务账簿", Icon: "mdi-book-open-page-variant-outline", Order: 70},
		{ID: "default-system", Name: "系统管理", Icon: "mdi-cog-outline", Order: 80},
		{ID: "default-rpt", Name: "报表", Icon: "mdi-chart-box-outline", Order: 90},
		{ID: "default-other", Name: "其他", Icon: "mdi-folder-outline", Order: 100},
	}
	items := groupViews(groups)
	orders := map[string]int32{}
	for _, route := range catalog {
		if route.RouteKey == "home/dashboard" {
			items = append(items, directRouteView(route, route.Order, stableRouteID("default", route.RouteKey)))
			continue
		}
		parent := "default-other"
		domain := strings.SplitN(route.RouteKey, "/", 2)[0]
		switch domain {
		case "bob", "aux", "vou", "wfl", "acc", "led":
			parent = "default-" + domain
		case "app":
			parent = "default-system"
		case "rpt":
			parent = "default-rpt"
		}
		orders[parent] += 10
		items = append(items, routeView(route, parent, orders[parent], stableRouteID("default", route.RouteKey)))
	}
	return MenuTree{Revision: 1, Items: items}
}

func buildInitialBusinessMenu(catalog []registeredMenuRoute, revision int64) MenuTree {
	items := groupViews(businessMenuGroups)
	orders := map[string]int32{}
	for _, route := range catalog {
		if route.RouteKey == "home/dashboard" {
			items = append(items, directRouteView(route, route.Order, stableRouteID("business", route.RouteKey)))
			continue
		}
		parent := classifyBusinessRoute(route.RouteKey)
		orders[parent] += 10
		items = append(items, routeView(route, parent, orders[parent], stableRouteID("business", route.RouteKey)))
	}
	return MenuTree{Revision: revision, Items: items}
}

func classifyBusinessRoute(key string) string {
	parts := strings.SplitN(key, "/", 2)
	if len(parts) != 2 {
		return "menu-group-other"
	}
	domain, entity := parts[0], parts[1]
	if domain == "app" {
		return "menu-group-system"
	}
	if domain == "rpt" {
		return "menu-group-reporting"
	}
	if domain == "bob" && entity == "customer" || domain == "vou" && strings.HasPrefix(entity, "sale-") {
		return "menu-group-sales"
	}
	if domain == "bob" && entity == "supplier" || domain == "vou" && strings.HasPrefix(entity, "purchase-") {
		return "menu-group-purchase"
	}
	if domain == "vou" && (entity == "order-production" || entity == "self-production") {
		return "menu-group-production"
	}
	if domain == "bob" && (entity == "product" || entity == "warehouse") || domain == "vou" && entity == "inventory-count" || domain == "led" && entity == "inventory" {
		return "menu-group-inventory"
	}
	if domain == "bob" && entity == "fund-account" || domain == "led" && (entity == "fund" || entity == "party" || entity == "customer" || entity == "supplier" || entity == "other" || entity == "employee" || entity == "container" || entity == "bill") || domain == "vou" && (strings.Contains(entity, "receipt") || strings.Contains(entity, "payment") || strings.HasPrefix(entity, "bill-") || entity == "expense-reimbursement" || entity == "employee-loan" || entity == "employee-loan-writeoff" || entity == "employee-repayment" || entity == "expense-payment" || entity == "other-income") {
		return "menu-group-cash"
	}
	if domain == "aux" && entity == "asset-category" || domain == "led" && entity == "asset" || domain == "vou" && strings.HasPrefix(entity, "asset-") {
		return "menu-group-assets"
	}
	if domain == "bob" && entity == "employee" || domain == "aux" && (entity == "department" || entity == "position") {
		return "menu-group-people"
	}
	if domain == "acc" || domain == "led" && entity == "closing" {
		return "menu-group-accounting"
	}
	if domain == "bob" {
		return "menu-group-master-data"
	}
	if domain == "aux" {
		return "menu-group-auxiliary-data"
	}
	if domain == "wfl" {
		return "menu-group-workflow"
	}
	return "menu-group-other"
}

func menuTreeFromRows(rows []dbsqlc.AppBusinessMenuItem, revision int64, catalog []registeredMenuRoute) MenuTree {
	byKey := make(map[string]registeredMenuRoute, len(catalog))
	for _, route := range catalog {
		byKey[route.RouteKey] = route
	}
	items := make([]MenuItemView, 0, len(rows))
	for _, row := range rows {
		if row.ID == menuRouteTombstoneGroupID || isMenuRouteTombstone(row) {
			continue
		}
		view := MenuItemView{ID: row.ID, ParentID: row.ParentID, Type: row.ItemType, Level: int32(row.ItemLevel), Order: row.SortOrder, DisplayName: row.DisplayName, Icon: row.Icon, Enabled: row.Enabled, RouteKey: row.RouteKey, PermissionCode: row.PermissionCode}
		if row.RouteKey != nil {
			path := "/" + *row.RouteKey
			if route, ok := byKey[*row.RouteKey]; ok {
				path = route.RoutePath
				view.PermissionCode = stringPointer(route.PermissionCode)
			}
			view.RoutePath = &path
		}
		items = append(items, view)
	}
	return MenuTree{Revision: revision, Items: items}
}

func editableMenuTreeFromRows(rows []dbsqlc.AppBusinessMenuItem, revision int64, catalog []registeredMenuRoute) MenuTree {
	registered := make(map[string]bool, len(catalog))
	for _, route := range catalog {
		registered[route.RouteKey] = true
	}
	currentRows := make([]dbsqlc.AppBusinessMenuItem, 0, len(rows))
	for _, row := range rows {
		if row.ItemType == MenuItemRoute && row.RouteKey != nil && !registered[*row.RouteKey] {
			continue
		}
		currentRows = append(currentRows, row)
	}
	return menuTreeFromRows(currentRows, revision, catalog)
}

func isMenuRouteTombstone(row dbsqlc.AppBusinessMenuItem) bool {
	return row.ItemType == MenuItemRoute && row.ParentID != nil && *row.ParentID == menuRouteTombstoneGroupID
}

func menuRouteTombstones(rows []dbsqlc.AppBusinessMenuItem) map[string]bool {
	tombstones := make(map[string]bool, len(rows))
	for _, row := range rows {
		if isMenuRouteTombstone(row) && row.RouteKey != nil {
			tombstones[*row.RouteKey] = true
		}
	}
	return tombstones
}

func menuRouteTombstonePermissions(rows []dbsqlc.AppBusinessMenuItem) map[string]string {
	routes := make(map[string]string)
	for _, row := range rows {
		if row.ItemType != MenuItemRoute || row.RouteKey == nil || row.PermissionCode == nil {
			continue
		}
		routes[*row.RouteKey] = *row.PermissionCode
	}
	return routes
}

func appendUnclassifiedRoutes(tree MenuTree, catalog []registeredMenuRoute, tombstones map[string]bool) MenuTree {
	present := map[string]bool{}
	otherID := ""
	maxOrder := int32(0)
	for _, item := range tree.Items {
		if item.RouteKey != nil {
			present[*item.RouteKey] = true
		}
		if item.Type == MenuItemGroup && item.DisplayName == "其他/待归类" {
			otherID = item.ID
		}
		if item.ParentID != nil && item.Order > maxOrder {
			maxOrder = item.Order
		}
	}
	if otherID == "" {
		otherID = "menu-group-other-pending"
		tree.Items = append(tree.Items, MenuItemView{ID: otherID, Type: MenuItemGroup, Level: 1, Order: 1_000_000, DisplayName: "其他/待归类", Icon: stringPointer("mdi-folder-question-outline"), Enabled: true})
	}
	for _, route := range catalog {
		if route.RouteKey == "home/dashboard" {
			continue
		}
		if present[route.RouteKey] || tombstones[route.RouteKey] {
			continue
		}
		maxOrder += 10
		tree.Items = append(tree.Items, routeView(route, otherID, maxOrder, stableRouteID("pending", route.RouteKey)))
	}
	return tree
}

func filterMenuForPrincipal(tree MenuTree, catalog []registeredMenuRoute, principal Principal) MenuTree {
	byKey := make(map[string]registeredMenuRoute, len(catalog))
	for _, route := range catalog {
		byKey[route.RouteKey] = route
	}
	allowed := make(map[string]bool)
	enabledGroups := make(map[string]bool)
	for _, item := range tree.Items {
		if item.Type == MenuItemGroup && item.Enabled {
			enabledGroups[item.ID] = true
		}
	}
	for _, item := range tree.Items {
		if item.Type != MenuItemRoute || !item.Enabled || item.RouteKey == nil {
			continue
		}
		route, exists := byKey[*item.RouteKey]
		if exists && routeAllowed(route, principal.Permissions) {
			allowed[item.ID] = true
		}
	}
	groupHasRoute := map[string]bool{}
	for _, item := range tree.Items {
		if allowed[item.ID] && item.ParentID != nil && enabledGroups[*item.ParentID] {
			groupHasRoute[*item.ParentID] = true
		}
	}
	result := make([]MenuItemView, 0, len(tree.Items))
	for _, item := range tree.Items {
		if item.Type == MenuItemGroup && item.Enabled && groupHasRoute[item.ID] {
			result = append(result, item)
		}
		if item.Type == MenuItemRoute && allowed[item.ID] {
			if item.ParentID == nil || enabledGroups[*item.ParentID] && groupHasRoute[*item.ParentID] {
				result = append(result, item)
			}
		}
	}
	return MenuTree{Revision: tree.Revision, Items: result}
}

func routeAllowed(route registeredMenuRoute, permissions []string) bool {
	if route.Always {
		return true
	}
	for _, permission := range permissions {
		if permission == route.PermissionCode || route.PermissionRoot != "" && strings.HasPrefix(permission, route.PermissionRoot) {
			return true
		}
	}
	return false
}

func groupViews(groups []initialMenuGroup) []MenuItemView {
	items := make([]MenuItemView, 0, len(groups))
	for _, group := range groups {
		icon := group.Icon
		items = append(items, MenuItemView{ID: group.ID, Type: MenuItemGroup, Level: 1, Order: group.Order, DisplayName: group.Name, Icon: &icon, Enabled: true})
	}
	return items
}

func routeView(route registeredMenuRoute, parent string, order int32, id string) MenuItemView {
	return MenuItemView{ID: id, ParentID: &parent, Type: MenuItemRoute, Level: 2, Order: order, DisplayName: route.DisplayName, Enabled: true, RouteKey: &route.RouteKey, RoutePath: &route.RoutePath, PermissionCode: &route.PermissionCode}
}

func directRouteView(route registeredMenuRoute, order int32, id string) MenuItemView {
	return MenuItemView{ID: id, Type: MenuItemRoute, Level: 1, Order: order, DisplayName: route.DisplayName, Icon: stringPointer("mdi-view-dashboard-outline"), Enabled: true, RouteKey: &route.RouteKey, RoutePath: &route.RoutePath, PermissionCode: &route.PermissionCode}
}

func stableRouteID(prefix, key string) string {
	sum := sha256.Sum256([]byte(prefix + ":" + key))
	return fmt.Sprintf("route-%x", sum[:12])
}

func menuRouteOptions(routes []registeredMenuRoute) []MenuRouteOption {
	items := make([]MenuRouteOption, 0, len(routes))
	for _, route := range routes {
		permission := route.PermissionCode
		items = append(items, MenuRouteOption{RouteKey: route.RouteKey, RoutePath: route.RoutePath, DisplayName: route.DisplayName, PermissionCode: &permission})
	}
	return items
}

func menuRouteTitle(entity, description string) string {
	prefixes := []string{"查询", "查看", "读取", "创建", "新增", "修改", "保存", "启用", "停用", "删除", "提交", "审核", "批准", "驳回", "核对", "完成"}
	value := strings.TrimSpace(description)
	for _, prefix := range prefixes {
		value = strings.TrimSpace(strings.TrimPrefix(value, prefix))
	}
	if value != "" {
		return value
	}
	return strings.ReplaceAll(entity, "-", " ")
}

func menuViewToInput(items []MenuItemView) []SaveMenuItemInput {
	result := make([]SaveMenuItemInput, 0, len(items))
	for _, item := range items {
		result = append(result, SaveMenuItemInput{ID: item.ID, ParentID: item.ParentID, Type: item.Type, Order: item.Order, DisplayName: item.DisplayName, Icon: item.Icon, Enabled: item.Enabled, RouteKey: item.RouteKey})
	}
	return result
}

func menuItemCounts(items []SaveMenuItemInput) (int, int) {
	groups, routes := 0, 0
	for _, item := range items {
		if item.Type == MenuItemGroup {
			groups++
		} else {
			routes++
		}
	}
	return groups, routes
}

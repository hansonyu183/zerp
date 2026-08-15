BEGIN;
SET CONSTRAINTS ALL DEFERRED;

-- Model a valid legacy template with no usable group except Workbench. All
-- non-home routes remain valid second-level routes below that group.
DELETE FROM app_business_menu_items
WHERE route_key = 'home/dashboard';

UPDATE app_business_menu_items
SET parent_id = 'menu-group-workbench', revision = 7
WHERE item_type = 'ROUTE';

DELETE FROM app_business_menu_items
WHERE item_type = 'GROUP'
  AND id NOT IN ('menu-group-workbench', 'menu-group-other');

-- Occupy both historical preferred IDs with non-home routes. The migration
-- must neither overwrite them nor rely on either ID being free.
DELETE FROM app_business_menu_items
WHERE route_key = 'admin/role';

UPDATE app_business_menu_items
SET parent_id = 'menu-group-workbench',
    item_type = 'ROUTE',
    item_level = 2,
    sort_order = 60,
    display_name = '角色管理',
    icon = 'mdi-account-key-outline',
    enabled = true,
    route_key = 'admin/role',
    permission_code = '/app/role/query',
    revision = 7
WHERE id = 'menu-group-other';

UPDATE app_business_menu_items
SET id = 'menu-route-workbench', revision = 7
WHERE id = 'menu-route-admin-menu';

UPDATE app_business_menu_items
SET revision = 7;

INSERT INTO app_business_menu_items (
    id, item_type, item_level, sort_order, display_name, icon, enabled,
    revision, created_by, updated_by
)
VALUES (
    'menu-group-route-tombstones', 'GROUP', 1, 1000000,
    '已删除菜单路由', 'mdi-folder-question-outline', false, 7,
    '01JAPPSYST3MACTR0000000000', '01JAPPSYST3MACTR0000000000'
);

INSERT INTO app_business_menu_items (
    id, parent_id, item_type, item_level, sort_order, display_name, enabled,
    route_key, permission_code, revision, created_by, updated_by
)
VALUES (
    'migration-workbench-tombstone', 'menu-group-route-tombstones',
    'ROUTE', 2, 10, 'home/dashboard', false, 'home/dashboard',
    '/app/workbench/query', 7,
    '01JAPPSYST3MACTR0000000000', '01JAPPSYST3MACTR0000000000'
);

SET CONSTRAINTS ALL IMMEDIATE;
COMMIT;

DO $$
BEGIN
    IF (SELECT count(*) FROM app_business_menu_items WHERE route_key = 'home/dashboard') <> 1
       OR NOT EXISTS (
           SELECT 1 FROM app_business_menu_items
           WHERE id = 'migration-workbench-tombstone'
             AND parent_id = 'menu-group-route-tombstones'
             AND NOT enabled
       )
       OR NOT EXISTS (
           SELECT 1 FROM app_business_menu_items
           WHERE id = 'menu-route-workbench'
             AND route_key = 'admin/menu'
             AND parent_id = 'menu-group-workbench'
             AND enabled
       )
       OR NOT EXISTS (
           SELECT 1 FROM app_business_menu_items
           WHERE id = 'menu-group-other'
             AND route_key = 'admin/role'
             AND parent_id = 'menu-group-workbench'
             AND enabled
       )
       OR NOT EXISTS (
           SELECT 1 FROM app_business_menu_items
           WHERE route_key = 'admin/user'
             AND parent_id = 'menu-group-workbench'
             AND enabled
       )
       OR EXISTS (
           SELECT 1 FROM app_business_menu_items
           WHERE item_type = 'GROUP'
             AND enabled
             AND id <> 'menu-group-workbench'
       )
       OR EXISTS (
           SELECT 1 FROM app_business_menu_items
           WHERE revision <> 7
       ) THEN
        RAISE EXCEPTION 'legacy workbench collision fixture is incomplete';
    END IF;
END
$$;

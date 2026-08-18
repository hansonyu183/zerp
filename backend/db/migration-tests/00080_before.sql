BEGIN;
SET CONSTRAINTS ALL DEFERRED;

-- Put normal and deleted management routes into nontrivial legacy data.  The
-- upgrade must convert both copies without changing IDs, parents or metadata.
UPDATE app_business_menu_items
SET revision = 7;

INSERT INTO app_business_menu_items (
    id, item_type, item_level, sort_order, display_name, icon, enabled,
    revision, created_by, updated_by
) VALUES (
    'migration-tombstone-group', 'GROUP', 1, 999999, '已删除菜单路由',
    'mdi-folder-question-outline', false, 7,
    '01JAPPSYST3MACTR0000000000', '01JAPPSYST3MACTR0000000000'
) ON CONFLICT (id) DO UPDATE SET revision = 7;

INSERT INTO app_business_menu_items (
    id, parent_id, item_type, item_level, sort_order, display_name, icon,
    enabled, route_key, permission_code, revision, created_by, updated_by
) VALUES (
    'migration-admin-menu-tombstone', 'migration-tombstone-group', 'ROUTE', 2,
    10, 'admin/menu', NULL, false, 'admin/menu', '/app/menu/save-business-template',
    7, '01JAPPSYST3MACTR0000000000', '01JAPPSYST3MACTR0000000000'
) ON CONFLICT (id) DO UPDATE SET revision = 7;

SET CONSTRAINTS ALL IMMEDIATE;
COMMIT;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM app_business_menu_items WHERE route_key = 'admin/user')
       OR NOT EXISTS (SELECT 1 FROM app_business_menu_items WHERE id = 'migration-admin-menu-tombstone' AND route_key = 'admin/menu')
       OR EXISTS (SELECT 1 FROM app_business_menu_items WHERE revision <> 7) THEN
        RAISE EXCEPTION 'legacy APP menu fixture is incomplete';
    END IF;
END
$$;

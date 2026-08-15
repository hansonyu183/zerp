DO $$
BEGIN
    IF (SELECT count(*) FROM app_business_menu_items WHERE route_key = 'home/dashboard') <> 1
       OR EXISTS (
           SELECT 1 FROM app_business_menu_items
           WHERE id = 'menu-group-workbench'
       )
       OR EXISTS (
           SELECT 1 FROM app_business_menu_items
           WHERE route_key = 'home/dashboard'
             AND (parent_id IS NOT NULL OR NOT enabled)
       )
       OR EXISTS (
           SELECT 1 FROM app_business_menu_items
           WHERE id = 'menu-group-route-tombstones'
       )
       OR NOT EXISTS (
           SELECT 1 FROM app_business_menu_items
           WHERE id = 'menu-group-workbench-fallback-0'
             AND item_type = 'GROUP'
             AND item_level = 1
             AND parent_id IS NULL
             AND enabled
             AND revision = 7
             AND created_by = '01JAPPSYST3MACTR0000000000'
             AND updated_by = '01JAPPSYST3MACTR0000000000'
       )
       OR NOT EXISTS (
           SELECT 1 FROM app_business_menu_items
           WHERE id = 'menu-route-workbench-direct-0'
             AND item_type = 'ROUTE'
             AND item_level = 1
             AND parent_id IS NULL
             AND display_name = '工作台'
             AND enabled
             AND route_key = 'home/dashboard'
             AND permission_code = '/app/workbench/query'
             AND revision = 7
             AND created_by = '01JAPPSYST3MACTR0000000000'
             AND updated_by = '01JAPPSYST3MACTR0000000000'
       )
       OR NOT EXISTS (
           SELECT 1
           FROM app_business_menu_items AS route
           JOIN app_business_menu_items AS parent ON parent.id = route.parent_id
           WHERE route.id = 'menu-route-workbench'
             AND route.route_key = 'admin/menu'
             AND parent.id = 'menu-group-workbench-fallback-0'
             AND parent.item_type = 'GROUP'
             AND parent.enabled
       )
       OR NOT EXISTS (
           SELECT 1
           FROM app_business_menu_items AS route
           JOIN app_business_menu_items AS parent ON parent.id = route.parent_id
           WHERE route.id = 'menu-group-other'
             AND route.route_key = 'admin/role'
             AND parent.id = 'menu-group-workbench-fallback-0'
             AND parent.item_type = 'GROUP'
             AND parent.enabled
       )
       OR NOT EXISTS (
           SELECT 1
           FROM app_business_menu_items AS route
           JOIN app_business_menu_items AS parent ON parent.id = route.parent_id
           WHERE route.route_key = 'admin/user'
             AND parent.id = 'menu-group-workbench-fallback-0'
             AND parent.item_type = 'GROUP'
             AND parent.enabled
       )
       OR EXISTS (
           SELECT 1 FROM app_business_menu_items
           WHERE revision <> 7
       ) THEN
        RAISE EXCEPTION 'workbench was not converted to one direct menu route';
    END IF;

    BEGIN
        INSERT INTO app_business_menu_items (
            id, item_type, item_level, sort_order, display_name, enabled,
            route_key, permission_code, revision, created_by, updated_by
        ) VALUES (
            'migration-workbench-second', 'ROUTE', 1, 20, '重复工作台', true,
            'home/dashboard', '/app/workbench/query', 7,
            '01JAPPSYST3MACTR0000000000', '01JAPPSYST3MACTR0000000000'
        );
        RAISE EXCEPTION 'duplicate direct workbench route was accepted';
    EXCEPTION WHEN unique_violation THEN
        NULL;
    END;
END
$$;

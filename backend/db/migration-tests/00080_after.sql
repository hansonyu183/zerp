DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM app_business_menu_items WHERE route_key LIKE 'admin/%') THEN
        RAISE EXCEPTION 'legacy admin route keys remain after snapshot upgrade';
    END IF;
    IF (SELECT count(DISTINCT snapshot_type) FROM app_business_menu_items) <> 2 THEN
        RAISE EXCEPTION 'draft/published snapshots were not created';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM app_business_menu_items
        WHERE id = 'migration-admin-menu-tombstone'
          AND route_key = 'app/menu'
          AND snapshot_type = 'DRAFT'
          AND parent_id = 'migration-tombstone-group'
          AND NOT enabled AND revision = 8
    ) OR NOT EXISTS (
        SELECT 1 FROM app_business_menu_items
        WHERE id = 'migration-admin-menu-tombstone'
          AND route_key = 'app/menu'
          AND snapshot_type = 'PUBLISHED'
          AND parent_id = 'migration-tombstone-group'
          AND NOT enabled AND revision = 8
    ) THEN
        RAISE EXCEPTION 'menu tombstone was not copied and canonicalized';
    END IF;
    IF (SELECT count(*) FROM app_business_menu_items WHERE snapshot_type = 'DRAFT' AND route_key = 'app/user') <> 1
       OR (SELECT count(*) FROM app_business_menu_items WHERE snapshot_type = 'PUBLISHED' AND route_key = 'app/user') <> 1
       OR NOT EXISTS (SELECT 1 FROM app_permissions WHERE path = '/app/menu/publish-business-template' AND status = 'ENABLED') THEN
        RAISE EXCEPTION 'canonical APP catalog or publish permission is missing';
    END IF;
END
$$;

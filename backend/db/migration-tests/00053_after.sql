DO $$
BEGIN
    IF (
        SELECT count(*) FROM app_business_menu_items
        WHERE item_type = 'GROUP'
    ) <> 14 THEN
        RAISE EXCEPTION 'initial business menu groups missing';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM app_business_menu_items
        WHERE route_key = 'admin/menu' AND enabled = true
    ) THEN
        RAISE EXCEPTION 'menu management recovery route missing';
    END IF;
    IF (
        SELECT count(*) FROM app_permissions
        WHERE domain = 'app' AND entity = 'menu' AND status = 'ENABLED'
    ) <> 3 THEN
        RAISE EXCEPTION 'menu management permissions missing';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM app_system_parameters
        WHERE parameter_key = 'app.menu.mode' AND editable = false
    ) THEN
        RAISE EXCEPTION 'menu mode parameter missing';
    END IF;
    IF (
        SELECT menu_order FROM app_permissions
        WHERE path = '/vou/sale-order/query'
    ) <> 10 OR (
        SELECT menu_order FROM app_permissions
        WHERE path = '/vou/purchase-order/query'
    ) <> 60 THEN
        RAISE EXCEPTION 'registered VOU menu order missing';
    END IF;
    IF EXISTS (
        SELECT 1 FROM app_permissions
        WHERE action <> 'query' AND menu_order IS NOT NULL
    ) THEN
        RAISE EXCEPTION 'menu order must only be set on query permissions';
    END IF;
    IF EXISTS (
        SELECT 1
        FROM app_business_menu_items
        WHERE route_key IN ('led/customer', 'led/supplier', 'led/other', 'led/employee')
          AND parent_id <> 'menu-group-cash'
    ) THEN
        RAISE EXCEPTION 'ledger party routes must be classified under cash';
    END IF;
END $$;

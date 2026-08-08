DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM app_business_menu_items
        WHERE id IN (
            'menu-route-intermediary-calculation',
            'menu-route-other-payable'
        )
    ) THEN
        RAISE EXCEPTION 'migration 00057 still persisted catalog routes';
    END IF;
END $$;

INSERT INTO app_business_menu_items(
    id, parent_id, item_type, item_level, sort_order, display_name, icon,
    enabled, route_key, permission_code, revision, created_by, updated_by
) VALUES
    (
        'menu-route-intermediary-calculation', 'menu-group-sales', 'ROUTE', 2,
        45, '居间计算', 'mdi-calculator-variant-outline', true,
        'vou/intermediary-calculation', '/vou/intermediary-calculation/query', 1,
        '01JAPPSYST3MACTR0000000000', '01JAPPSYST3MACTR0000000000'
    ),
    (
        'menu-route-other-payable', 'menu-group-accounting', 'ROUTE', 2,
        20, '其它应付', 'mdi-account-cash-outline', true,
        'led/other-payable', '/led/other-payable/query', 1,
        '01JAPPSYST3MACTR0000000000', '01JAPPSYST3MACTR0000000000'
    );

UPDATE app_business_menu_items
SET revision = 3
WHERE id NOT IN (
    'menu-route-intermediary-calculation',
    'menu-route-other-payable'
);

DO $$
BEGIN
    IF (SELECT count(DISTINCT revision) FROM app_business_menu_items) <> 2 THEN
        RAISE EXCEPTION 'mixed business menu revision fixture was not created';
    END IF;
END $$;

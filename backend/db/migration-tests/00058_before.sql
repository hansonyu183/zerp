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

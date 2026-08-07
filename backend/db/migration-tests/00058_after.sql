DO $$
BEGIN
    IF (SELECT count(DISTINCT revision) FROM app_business_menu_items) <> 1 THEN
        RAISE EXCEPTION 'business menu revisions remain inconsistent';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM app_business_menu_items
        WHERE revision <> 3
    ) THEN
        RAISE EXCEPTION 'business menu rows did not converge on the latest revision';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM app_business_menu_items
        WHERE id IN (
            'menu-route-intermediary-calculation',
            'menu-route-other-payable'
        )
    ) THEN
        RAISE EXCEPTION 'new catalog routes were persisted in the customized menu snapshot';
    END IF;
END $$;

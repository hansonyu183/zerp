DO $$
BEGIN
    IF to_regclass('public.app_business_menu_items') IS NOT NULL THEN
        RAISE EXCEPTION 'app_business_menu_items must not exist before migration 00053';
    END IF;
END $$;

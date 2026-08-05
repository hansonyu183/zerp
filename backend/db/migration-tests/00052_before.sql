DO $$
BEGIN
    IF to_regclass('public.app_system_parameters') IS NOT NULL THEN
        RAISE EXCEPTION 'app_system_parameters must not exist before migration 00052';
    END IF;
END $$;

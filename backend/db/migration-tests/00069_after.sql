DO $$ BEGIN
    IF to_regclass('public.acc_assets') IS NULL OR to_regclass('public.acc_bills') IS NULL OR to_regclass('public.acc_container_entries') IS NULL THEN
        RAISE EXCEPTION 'migration 00069 registers are missing';
    END IF;
END $$;

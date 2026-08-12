DO $$ BEGIN
    IF to_regclass('public.acc_assets') IS NOT NULL THEN RAISE EXCEPTION 'migration 00069 registers already exist'; END IF;
END $$;

DO $$
BEGIN
    IF to_regclass('public.acc_inventory_entries') IS NULL THEN
        RAISE EXCEPTION 'expected ACC inventory entries before cost migration';
    END IF;
END $$;

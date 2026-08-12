DO $$
BEGIN
    IF to_regclass('public.acc_inventory_entries') IS NOT NULL THEN
        RAISE EXCEPTION 'migration 00067 inventory entries already exist';
    END IF;
END
$$;

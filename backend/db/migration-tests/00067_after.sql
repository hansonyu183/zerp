DO $$
BEGIN
    IF to_regclass('public.acc_inventory_entries') IS NULL THEN
        RAISE EXCEPTION 'migration 00067 inventory entries are missing';
    END IF;
    IF to_regclass('public.acc_inventory_entries_balance_idx') IS NULL THEN
        RAISE EXCEPTION 'migration 00067 inventory balance index is missing';
    END IF;
END
$$;

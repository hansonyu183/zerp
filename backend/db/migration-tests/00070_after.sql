DO $$
BEGIN
    IF to_regclass('public.acc_inventory_cost_allocations') IS NULL THEN
        RAISE EXCEPTION 'ACC inventory cost allocations missing after migration';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema='public' AND table_name='acc_inventory_entries'
          AND column_name='cost_counterpart_subject_id'
    ) THEN
        RAISE EXCEPTION 'ACC inventory cost configuration missing after migration';
    END IF;
END $$;

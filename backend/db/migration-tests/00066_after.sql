DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'acc_vouchers'
          AND column_name = 'source_revision'
    ) THEN
        RAISE EXCEPTION 'migration 00066 automatic posting columns are missing';
    END IF;
    IF to_regclass('public.acc_vouchers_vou_source_idx') IS NULL THEN
        RAISE EXCEPTION 'migration 00066 VOU source index is missing';
    END IF;
END
$$;

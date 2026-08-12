DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'acc_vouchers'
          AND column_name = 'source_revision'
    ) THEN
        RAISE EXCEPTION 'migration 00066 automatic posting columns already exist';
    END IF;
END
$$;

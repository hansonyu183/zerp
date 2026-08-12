DO $$
BEGIN
    IF to_regclass('public.acc_periods') IS NULL THEN
        RAISE EXCEPTION 'migration 00068 periods are missing';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'vou_documents_locked_period_guard') THEN
        RAISE EXCEPTION 'migration 00068 VOU period guard is missing';
    END IF;
END
$$;

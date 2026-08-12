DO $$
BEGIN
    IF to_regclass('public.acc_books') IS NULL
       OR to_regclass('public.acc_book_user_scopes') IS NULL THEN
        RAISE EXCEPTION 'migration 00062 ACC book structures are incomplete';
    END IF;
    IF (
        SELECT count(*) FROM app_permissions
        WHERE domain = 'acc' AND entity = 'book' AND status = 'ENABLED'
    ) <> 5 THEN
        RAISE EXCEPTION 'migration 00062 ACC book permissions are incomplete';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE schemaname = 'public'
          AND indexname = 'acc_books_single_control_uq'
    ) THEN
        RAISE EXCEPTION 'migration 00062 control book uniqueness is missing';
    END IF;
    IF NOT pg_get_constraintdef(
        (SELECT oid FROM pg_constraint WHERE conname = 'object_number_counters_domain_check')
    ) LIKE '%acc%' THEN
        RAISE EXCEPTION 'migration 00062 ACC numbering domain is missing';
    END IF;
END
$$;

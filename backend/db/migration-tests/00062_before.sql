DO $$
BEGIN
    IF to_regclass('public.acc_books') IS NOT NULL
       OR to_regclass('public.acc_book_user_scopes') IS NOT NULL THEN
        RAISE EXCEPTION 'migration 00062 ACC book structures already exist';
    END IF;
    IF pg_get_constraintdef(
        (SELECT oid FROM pg_constraint WHERE conname = 'object_number_counters_domain_check')
    ) LIKE '%acc%' THEN
        RAISE EXCEPTION 'migration 00062 ACC numbering domain already exists';
    END IF;
END
$$;

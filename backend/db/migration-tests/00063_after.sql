DO $$
BEGIN
    IF to_regclass('public.acc_subjects') IS NULL
       OR to_regclass('public.acc_subject_dimensions') IS NULL
       OR to_regclass('public.acc_subject_usages') IS NULL THEN
        RAISE EXCEPTION 'migration 00063 ACC subject structures are incomplete';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'acc_books'
          AND column_name = 'subject_template'
    ) THEN
        RAISE EXCEPTION 'migration 00063 subject template is missing';
    END IF;
    IF (
        SELECT count(*) FROM app_permissions
        WHERE domain = 'acc' AND entity = 'subject' AND status = 'ENABLED'
    ) <> 5 THEN
        RAISE EXCEPTION 'migration 00063 ACC subject permissions are incomplete';
    END IF;
END
$$;

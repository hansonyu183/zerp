DO $$
BEGIN
    IF to_regclass('public.acc_subjects') IS NOT NULL
       OR to_regclass('public.acc_subject_dimensions') IS NOT NULL
       OR to_regclass('public.acc_subject_usages') IS NOT NULL THEN
        RAISE EXCEPTION 'migration 00063 ACC subject structures already exist';
    END IF;
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'acc_books'
          AND column_name = 'subject_template'
    ) THEN
        RAISE EXCEPTION 'migration 00063 subject template already exists';
    END IF;
END
$$;

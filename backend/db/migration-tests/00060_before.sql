DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM wfl_process_definitions) THEN
        RAISE EXCEPTION 'migration 00060 requires existing workflow definitions';
    END IF;
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema='public'
          AND table_name='wfl_process_definitions'
          AND column_name='source_kind'
    ) THEN
        RAISE EXCEPTION 'migration 00060 source columns already exist';
    END IF;
END
$$;

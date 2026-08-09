DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM wfl_process_definitions
        WHERE source_kind <> 'GRAPH' OR draft_script IS NOT NULL
    ) THEN
        RAISE EXCEPTION 'migration 00060 did not preserve graph definitions';
    END IF;
    IF (
        SELECT count(*) FROM information_schema.columns
        WHERE table_schema='public'
          AND table_name='wfl_process_definitions'
          AND column_name IN ('source_kind','draft_script','draft_diagnostic','last_trial_revision','last_trial_at')
    ) <> 5 THEN
        RAISE EXCEPTION 'migration 00060 source columns are incomplete';
    END IF;
    IF (
        SELECT count(*) FROM pg_constraint
        WHERE conname IN (
            'wfl_process_definitions_script_source_ck',
            'wfl_process_definitions_trial_revision_ck'
        ) AND convalidated
    ) <> 2 THEN
        RAISE EXCEPTION 'migration 00060 source constraints are incomplete';
    END IF;
END
$$;

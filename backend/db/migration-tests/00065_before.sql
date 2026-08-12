DO $$
BEGIN
    IF to_regclass('public.acc_mapping_versions') IS NOT NULL THEN
        RAISE EXCEPTION 'migration 00065 ACC mapping structures already exist';
    END IF;
END
$$;

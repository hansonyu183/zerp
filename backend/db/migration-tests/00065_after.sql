DO $$
BEGIN
    IF to_regclass('public.acc_mapping_versions') IS NULL THEN
        RAISE EXCEPTION 'migration 00065 ACC mapping structures are missing';
    END IF;
    IF (
        SELECT count(*) FROM app_permissions
        WHERE domain = 'acc' AND entity = 'mapping' AND status = 'ENABLED'
    ) <> 7 THEN
        RAISE EXCEPTION 'migration 00065 ACC mapping permissions are incomplete';
    END IF;
END
$$;

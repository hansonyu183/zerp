DO $$
BEGIN
    IF to_regclass('bob_service_versions') IS NOT NULL THEN
        RAISE EXCEPTION 'standalone service detail table remains';
    END IF;
    IF EXISTS (SELECT 1 FROM app_permissions WHERE domain='bob' AND entity='service') THEN
        RAISE EXCEPTION 'standalone service permissions remain';
    END IF;
    IF EXISTS (SELECT 1 FROM bob_objects WHERE entity='service') THEN
        RAISE EXCEPTION 'standalone service objects remain';
    END IF;
END $$;

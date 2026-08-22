DO $$
BEGIN
    IF to_regclass('bob_parties') IS NULL
       OR to_regclass('bob_service_relationships') IS NULL
       OR to_regclass('bob_service_relationship_versions') IS NULL THEN
        RAISE EXCEPTION 'Party or Service Relationship tables are missing';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM app_permissions WHERE path='/bob/party/save'
    ) OR NOT EXISTS (
        SELECT 1 FROM app_permissions WHERE path='/bob/other-unit/create'
    ) THEN
        RAISE EXCEPTION 'Party or Other Unit permissions are missing';
    END IF;
    IF EXISTS (
        SELECT 1 FROM app_permissions WHERE path LIKE '/bob/other-party/%'
    ) THEN
        RAISE EXCEPTION 'legacy other-party permissions remain';
    END IF;
END
$$;

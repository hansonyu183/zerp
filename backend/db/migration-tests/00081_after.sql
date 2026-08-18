DO $$
BEGIN
    IF to_regclass('app_system_parameter_runtime_scopes') IS NULL
       OR to_regclass('app_system_parameter_runtime_adoptions') IS NULL THEN
        RAISE EXCEPTION 'runtime adoption tables are missing after migration 00081';
    END IF;
END
$$;

BEGIN;
INSERT INTO app_system_parameter_runtime_scopes (
    parameter_key, revision, deployment_scope, expected_instance_ids
)
SELECT parameter_key, revision, 'migration-test', ARRAY['api-1', 'api-2']::text[]
FROM app_system_parameters
WHERE parameter_key = 'app.menu.mode';

INSERT INTO app_system_parameter_runtime_adoptions (
    parameter_key, revision, deployment_scope, instance_id
)
SELECT parameter_key, revision, 'migration-test', 'api-1'
FROM app_system_parameters
WHERE parameter_key = 'app.menu.mode';

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM app_system_parameter_runtime_adoptions
        WHERE parameter_key = 'app.menu.mode'
          AND deployment_scope = 'migration-test'
          AND instance_id = 'api-1'
    ) THEN
        RAISE EXCEPTION 'runtime adoption report could not be persisted';
    END IF;
END
$$;
ROLLBACK;

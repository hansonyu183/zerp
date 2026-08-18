DO $$
BEGIN
    IF to_regclass('app_system_parameter_runtime_scopes') IS NOT NULL
       OR to_regclass('app_system_parameter_runtime_adoptions') IS NOT NULL THEN
        RAISE EXCEPTION 'runtime adoption tables already exist before migration 00081';
    END IF;
END
$$;

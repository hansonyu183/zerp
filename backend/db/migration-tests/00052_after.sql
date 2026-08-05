DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM app_system_parameters
        WHERE parameter_key = 'app.menu.mode'
          AND current_value = 'DEFAULT'
          AND default_value = 'DEFAULT'
          AND editable = false
    ) THEN
        RAISE EXCEPTION 'app.menu.mode parameter missing or invalid';
    END IF;
    IF (
        SELECT count(*) FROM app_permissions
        WHERE domain = 'app' AND entity = 'system-parameter' AND status = 'ENABLED'
    ) <> 4 THEN
        RAISE EXCEPTION 'system parameter permissions missing';
    END IF;
END $$;

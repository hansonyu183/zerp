DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM app_system_parameters
        WHERE parameter_key = 'test.string-setting'
          AND configured_value = 'configured'
          AND running_value = 'configured'
          AND running_revision = revision
          AND effect_mode = 'IMMEDIATE'
          AND restart_pending = false
          AND constraints ->> 'maxLength' = '4000'
    ) THEN
        RAISE EXCEPTION 'editable parameter effect state was not migrated';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM app_system_parameters
        WHERE parameter_key = 'test.read-only-setting'
          AND constraints IS NULL
          AND configured_value = running_value
          AND running_revision = revision
    ) THEN
        RAISE EXCEPTION 'read-only parameter effect state was not migrated';
    END IF;
END
$$;

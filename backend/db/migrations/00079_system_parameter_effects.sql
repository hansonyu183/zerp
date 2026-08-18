-- +goose Up

ALTER TABLE app_system_parameters
    RENAME COLUMN current_value TO configured_value;

ALTER TABLE app_system_parameters
    ADD COLUMN constraints jsonb,
    ADD COLUMN effect_mode varchar(24) NOT NULL DEFAULT 'IMMEDIATE',
    ADD COLUMN running_value text,
    ADD COLUMN running_revision bigint,
    ADD COLUMN restart_pending boolean NOT NULL DEFAULT false;

UPDATE app_system_parameters
SET constraints = CASE value_type
        WHEN 'STRING' THEN jsonb_build_object(
            'required', false,
            'minLength', 0,
            'maxLength', 4000,
            'minimum', NULL,
            'maximum', NULL,
            'allowedValues', jsonb_build_array()
        )
        WHEN 'INTEGER' THEN jsonb_build_object(
            'required', true,
            'minLength', NULL,
            'maxLength', NULL,
            'minimum', NULL,
            'maximum', NULL,
            'allowedValues', jsonb_build_array()
        )
        WHEN 'DECIMAL' THEN jsonb_build_object(
            'required', true,
            'minLength', NULL,
            'maxLength', NULL,
            'minimum', NULL,
            'maximum', NULL,
            'allowedValues', jsonb_build_array()
        )
        WHEN 'BOOLEAN' THEN jsonb_build_object(
            'required', true,
            'minLength', NULL,
            'maxLength', NULL,
            'minimum', NULL,
            'maximum', NULL,
            'allowedValues', jsonb_build_array('true', 'false')
        )
    END
WHERE editable;

UPDATE app_system_parameters
SET running_value = configured_value,
    running_revision = revision;

ALTER TABLE app_system_parameters
    ALTER COLUMN running_value SET NOT NULL,
    ALTER COLUMN running_revision SET NOT NULL,
    ADD CONSTRAINT app_system_parameters_effect_mode CHECK (
        effect_mode IN ('IMMEDIATE', 'NEXT_REQUEST', 'RESTART_REQUIRED')
    ),
    ADD CONSTRAINT app_system_parameters_editable_constraints CHECK (
        NOT editable OR constraints IS NOT NULL
    ),
    ADD CONSTRAINT app_system_parameters_constraints_shape CHECK (
        constraints IS NULL OR jsonb_typeof(constraints) = 'object'
    ),
    ADD CONSTRAINT app_system_parameters_restart_state CHECK (
        (effect_mode = 'RESTART_REQUIRED')
        OR (restart_pending = false AND running_value = configured_value AND running_revision = revision)
    );

ALTER TABLE app_system_parameters
    ALTER COLUMN effect_mode DROP DEFAULT;

-- +goose Down
-- +goose StatementBegin
DO $$
BEGIN
    RAISE EXCEPTION 'migration 00079 is irreversible; restore the database and previous image';
END
$$;
-- +goose StatementEnd

-- +goose Up

CREATE TABLE app_system_parameter_runtime_scopes (
    parameter_key varchar(128) NOT NULL REFERENCES app_system_parameters(parameter_key) ON DELETE CASCADE,
    revision bigint NOT NULL CHECK (revision >= 1),
    deployment_scope varchar(128) NOT NULL,
    expected_instance_ids text[] NOT NULL CHECK (cardinality(expected_instance_ids) > 0),
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (parameter_key, revision, deployment_scope)
);

CREATE TABLE app_system_parameter_runtime_adoptions (
    parameter_key varchar(128) NOT NULL,
    revision bigint NOT NULL,
    deployment_scope varchar(128) NOT NULL,
    instance_id varchar(128) NOT NULL,
    adopted_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (parameter_key, revision, deployment_scope, instance_id),
    FOREIGN KEY (parameter_key, revision, deployment_scope)
        REFERENCES app_system_parameter_runtime_scopes(parameter_key, revision, deployment_scope)
        ON DELETE CASCADE
);

SELECT rpt_validate_current_reports();

-- +goose Down
-- +goose StatementBegin
DO $$
BEGIN
    RAISE EXCEPTION 'migration 00081 is irreversible; restore the database and previous image';
END
$$;
-- +goose StatementEnd

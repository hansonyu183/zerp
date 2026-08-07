-- +goose Up

ALTER TABLE wfl_process_definitions
    ADD COLUMN source_kind varchar(16) NOT NULL DEFAULT 'GRAPH'
        CHECK (source_kind IN ('GRAPH', 'STARLARK')),
    ADD COLUMN draft_script text,
    ADD COLUMN draft_diagnostic text,
    ADD COLUMN last_trial_revision bigint,
    ADD COLUMN last_trial_at timestamptz,
    ADD CONSTRAINT wfl_process_definitions_script_source_ck CHECK (
        (source_kind = 'GRAPH' AND draft_script IS NULL)
        OR (source_kind = 'STARLARK' AND length(btrim(draft_script)) > 0)
    ),
    ADD CONSTRAINT wfl_process_definitions_trial_revision_ck CHECK (
        (last_trial_revision IS NULL AND last_trial_at IS NULL)
        OR (
            last_trial_revision BETWEEN 1 AND revision
            AND last_trial_at IS NOT NULL
        )
    );

-- +goose Down

ALTER TABLE wfl_process_definitions
    DROP CONSTRAINT wfl_process_definitions_trial_revision_ck,
    DROP CONSTRAINT wfl_process_definitions_script_source_ck,
    DROP COLUMN last_trial_at,
    DROP COLUMN last_trial_revision,
    DROP COLUMN draft_diagnostic,
    DROP COLUMN draft_script,
    DROP COLUMN source_kind;

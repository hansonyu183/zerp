-- +goose Up

-- Typed relationship dimensions use explicit names such as
-- SUPPLIER_RELATIONSHIP, which exceed the legacy 20-character limit.
ALTER TABLE acc_subject_dimensions
    ALTER COLUMN dimension TYPE varchar(32);

SELECT rpt_validate_current_reports();

-- +goose Down
-- +goose StatementBegin
DO $$ BEGIN RAISE EXCEPTION '00094 accounting dimension width cutover is irreversible'; END $$;
-- +goose StatementEnd

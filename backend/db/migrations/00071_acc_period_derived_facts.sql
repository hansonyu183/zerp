-- +goose Up

ALTER TABLE acc_assets ADD COLUMN disposed_on date;

ALTER TABLE acc_asset_book_values
    ADD COLUMN asset_subject_id varchar(26),
    ADD COLUMN asset_dimensions jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(asset_dimensions)='object'),
    ADD COLUMN accumulated_subject_id varchar(26),
    ADD COLUMN accumulated_dimensions jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(accumulated_dimensions)='object'),
    ADD COLUMN expense_subject_id varchar(26),
    ADD COLUMN expense_dimensions jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(expense_dimensions)='object'),
    ADD CONSTRAINT acc_asset_book_asset_subject_fk FOREIGN KEY(book_id,asset_subject_id) REFERENCES acc_subjects(book_id,id) ON DELETE RESTRICT,
    ADD CONSTRAINT acc_asset_book_accumulated_subject_fk FOREIGN KEY(book_id,accumulated_subject_id) REFERENCES acc_subjects(book_id,id) ON DELETE RESTRICT,
    ADD CONSTRAINT acc_asset_book_expense_subject_fk FOREIGN KEY(book_id,expense_subject_id) REFERENCES acc_subjects(book_id,id) ON DELETE RESTRICT;

CREATE TABLE acc_depreciation_entries (
    id varchar(26) PRIMARY KEY,
    book_id varchar(26) NOT NULL REFERENCES acc_books(id) ON DELETE CASCADE,
    asset_id varchar(26) NOT NULL REFERENCES acc_assets(id) ON DELETE RESTRICT,
    period_month date NOT NULL CHECK (period_month=date_trunc('month',period_month)::date),
    amount_minor bigint NOT NULL CHECK (amount_minor>0),
    system_voucher_id varchar(26) NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY(book_id,system_voucher_id) REFERENCES acc_vouchers(book_id,id) ON DELETE CASCADE,
    UNIQUE(book_id,asset_id,period_month)
);

CREATE TABLE acc_period_balances (
    id varchar(26) PRIMARY KEY,
    book_id varchar(26) NOT NULL REFERENCES acc_books(id) ON DELETE CASCADE,
    period_month date NOT NULL CHECK (period_month=date_trunc('month',period_month)::date),
    subject_id varchar(26) NOT NULL,
    currency varchar(3) NOT NULL,
    dimensions jsonb NOT NULL CHECK (jsonb_typeof(dimensions)='object'),
    dimension_key text NOT NULL,
    opening_balance_minor bigint NOT NULL,
    debit_turnover_minor bigint NOT NULL CHECK (debit_turnover_minor>=0),
    credit_turnover_minor bigint NOT NULL CHECK (credit_turnover_minor>=0),
    closing_balance_minor bigint NOT NULL,
    FOREIGN KEY(book_id,subject_id) REFERENCES acc_subjects(book_id,id) ON DELETE RESTRICT,
    UNIQUE(book_id,period_month,subject_id,currency,dimension_key)
);

-- +goose Down

DROP TABLE acc_period_balances;
DROP TABLE acc_depreciation_entries;
ALTER TABLE acc_asset_book_values
    DROP CONSTRAINT acc_asset_book_expense_subject_fk,
    DROP CONSTRAINT acc_asset_book_accumulated_subject_fk,
    DROP CONSTRAINT acc_asset_book_asset_subject_fk,
    DROP COLUMN expense_dimensions,
    DROP COLUMN expense_subject_id,
    DROP COLUMN accumulated_dimensions,
    DROP COLUMN accumulated_subject_id,
    DROP COLUMN asset_dimensions,
    DROP COLUMN asset_subject_id;
ALTER TABLE acc_assets DROP COLUMN disposed_on;

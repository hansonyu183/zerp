-- +goose Up

ALTER TABLE acc_inventory_entries
    ADD COLUMN cost_counterpart_subject_id varchar(26),
    ADD COLUMN cost_counterpart_dimensions jsonb NOT NULL DEFAULT '{}'::jsonb
        CHECK (jsonb_typeof(cost_counterpart_dimensions) = 'object'),
    ADD COLUMN origin_source_document_id varchar(26),
    ADD COLUMN origin_source_line_id varchar(64),
    ADD CONSTRAINT acc_inventory_entries_cost_subject_fk
        FOREIGN KEY (book_id, cost_counterpart_subject_id)
        REFERENCES acc_subjects(book_id, id) ON DELETE RESTRICT;

CREATE TABLE acc_inventory_cost_allocations (
    entry_id varchar(26) PRIMARY KEY REFERENCES acc_inventory_entries(id) ON DELETE CASCADE,
    book_id varchar(26) NOT NULL REFERENCES acc_books(id) ON DELETE CASCADE,
    period_month date NOT NULL CHECK (period_month = date_trunc('month', period_month)::date),
    quantity_micros bigint NOT NULL CHECK (quantity_micros > 0),
    cost_minor bigint NOT NULL CHECK (cost_minor > 0),
    source_cost_entry_id varchar(26) REFERENCES acc_inventory_entries(id) ON DELETE RESTRICT,
    system_voucher_id varchar(26),
    created_at timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (book_id, system_voucher_id) REFERENCES acc_vouchers(book_id, id) ON DELETE CASCADE
);
CREATE INDEX acc_inventory_cost_allocations_period_idx
    ON acc_inventory_cost_allocations (book_id, period_month, entry_id);

-- +goose Down

DROP TABLE acc_inventory_cost_allocations;
ALTER TABLE acc_inventory_entries
    DROP CONSTRAINT acc_inventory_entries_cost_subject_fk,
    DROP COLUMN origin_source_line_id,
    DROP COLUMN origin_source_document_id,
    DROP COLUMN cost_counterpart_dimensions,
    DROP COLUMN cost_counterpart_subject_id;

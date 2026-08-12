-- +goose Up

ALTER TABLE acc_voucher_lines DROP CONSTRAINT acc_voucher_lines_check;
ALTER TABLE acc_voucher_lines ADD CONSTRAINT acc_voucher_lines_value_check CHECK (
    (debit_minor > 0 AND credit_minor = 0)
    OR (credit_minor > 0 AND debit_minor = 0)
    OR (debit_minor = 0 AND credit_minor = 0 AND quantity_micros IS NOT NULL)
);

CREATE TABLE acc_inventory_entries (
    id varchar(26) PRIMARY KEY,
    book_id varchar(26) NOT NULL,
    voucher_id varchar(26) NOT NULL,
    voucher_line_id varchar(26) NOT NULL UNIQUE REFERENCES acc_voucher_lines(id) ON DELETE CASCADE,
    subject_id varchar(26) NOT NULL,
    product_id varchar(26) NOT NULL,
    warehouse_id varchar(26) NOT NULL,
    business_date date NOT NULL,
    quantity_delta_micros bigint NOT NULL CHECK (quantity_delta_micros <> 0),
    source_line_id varchar(64) NOT NULL,
    FOREIGN KEY (book_id, voucher_id) REFERENCES acc_vouchers(book_id, id) ON DELETE CASCADE,
    FOREIGN KEY (book_id, subject_id) REFERENCES acc_subjects(book_id, id) ON DELETE RESTRICT
);

CREATE INDEX acc_inventory_entries_balance_idx
    ON acc_inventory_entries (book_id, subject_id, warehouse_id, product_id, business_date);

-- +goose Down

DROP TABLE acc_inventory_entries;
ALTER TABLE acc_voucher_lines DROP CONSTRAINT acc_voucher_lines_value_check;
ALTER TABLE acc_voucher_lines ADD CONSTRAINT acc_voucher_lines_check CHECK (
    (debit_minor > 0 AND credit_minor = 0) OR (credit_minor > 0 AND debit_minor = 0)
);

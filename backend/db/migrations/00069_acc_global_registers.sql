-- +goose Up

CREATE TABLE acc_register_events (
    source_entity varchar(64) NOT NULL,
    source_document_id varchar(26) NOT NULL,
    source_revision bigint NOT NULL,
    PRIMARY KEY (source_entity, source_document_id)
);

CREATE TABLE acc_assets (
    id varchar(26) PRIMARY KEY,
    asset_no varchar(32) NOT NULL UNIQUE,
    source_document_id varchar(26) NOT NULL,
    source_line_id varchar(26) NOT NULL UNIQUE,
    name varchar(200) NOT NULL,
    category_id varchar(26) NOT NULL,
    department_id varchar(26) NOT NULL,
    useful_life_months integer NOT NULL CHECK (useful_life_months > 0),
    residual_rate_bps integer NOT NULL CHECK (residual_rate_bps BETWEEN 0 AND 10000),
    acquired_on date NOT NULL,
    state varchar(8) NOT NULL CHECK (state IN ('ACTIVE', 'SOLD', 'RETIRED')),
    disposed_by_document_id varchar(26)
);

CREATE TABLE acc_asset_book_values (
    book_id varchar(26) NOT NULL REFERENCES acc_books(id) ON DELETE CASCADE,
    asset_id varchar(26) NOT NULL REFERENCES acc_assets(id) ON DELETE CASCADE,
    currency varchar(3) NOT NULL,
    original_minor bigint NOT NULL CHECK (original_minor >= 0),
    accumulated_depreciation_minor bigint NOT NULL DEFAULT 0 CHECK (accumulated_depreciation_minor >= 0),
    PRIMARY KEY (book_id, asset_id)
);

CREATE TABLE acc_bills (
    id varchar(26) PRIMARY KEY,
    bill_no varchar(64) NOT NULL UNIQUE,
    bill_type varchar(32) NOT NULL,
    position_type varchar(16) NOT NULL CHECK (position_type IN ('ASSET', 'LIABILITY')),
    currency varchar(3) NOT NULL,
    face_amount_minor bigint NOT NULL CHECK (face_amount_minor > 0),
    issue_date date NOT NULL,
    maturity_date date NOT NULL,
    state varchar(12) NOT NULL CHECK (state IN ('AVAILABLE', 'SETTLED')),
    source_document_id varchar(26) NOT NULL,
    settled_by_document_id varchar(26)
);

CREATE TABLE acc_bill_book_values (
    book_id varchar(26) NOT NULL REFERENCES acc_books(id) ON DELETE CASCADE,
    bill_id varchar(26) NOT NULL REFERENCES acc_bills(id) ON DELETE CASCADE,
    value_minor bigint NOT NULL CHECK (value_minor >= 0),
    PRIMARY KEY (book_id, bill_id)
);

CREATE TABLE acc_container_entries (
    id varchar(26) PRIMARY KEY,
    customer_id varchar(26) NOT NULL,
    container_type varchar(8) NOT NULL CHECK (container_type IN ('SOLVENT', 'RESIN')),
    quantity_delta bigint NOT NULL CHECK (quantity_delta <> 0),
    source_document_id varchar(26) NOT NULL,
    source_revision bigint NOT NULL,
    UNIQUE (source_document_id, container_type)
);
CREATE INDEX acc_container_entries_balance_idx ON acc_container_entries (customer_id, container_type);

-- +goose Down

DROP TABLE acc_container_entries;
DROP TABLE acc_bill_book_values;
DROP TABLE acc_bills;
DROP TABLE acc_asset_book_values;
DROP TABLE acc_assets;
DROP TABLE acc_register_events;

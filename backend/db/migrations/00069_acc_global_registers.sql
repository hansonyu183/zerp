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
    medium varchar(16) NOT NULL CHECK (medium IN ('PAPER', 'ELECTRONIC')),
    face_amount_minor bigint NOT NULL CHECK (face_amount_minor > 0),
    issue_date date NOT NULL,
    maturity_date date NOT NULL,
    drawer varchar(200) NOT NULL,
    acceptor varchar(200) NOT NULL,
    payee varchar(200) NOT NULL,
    annual_rate_bps integer NOT NULL CHECK (annual_rate_bps BETWEEN 0 AND 100000),
    interest_days integer NOT NULL CHECK (interest_days >= 0),
    interest_amount_minor bigint NOT NULL CHECK (interest_amount_minor >= 0),
    customer_cost_amount_minor bigint NOT NULL CHECK (customer_cost_amount_minor >= 0),
    origin_party_entity varchar(16),
    origin_party_object_id varchar(26),
    origin_party_version_id varchar(26),
    origin_party_code varchar(64),
    origin_party_name varchar(200),
    state varchar(12) NOT NULL CHECK (state IN ('AVAILABLE', 'SETTLED')),
    source_document_id varchar(26) NOT NULL,
    source_line_id varchar(26) NOT NULL UNIQUE,
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
    UNIQUE (source_document_id, customer_id, container_type)
);
CREATE INDEX acc_container_entries_balance_idx ON acc_container_entries (customer_id, container_type);

CREATE TABLE acc_opening_assets (
    book_id varchar(26) NOT NULL REFERENCES acc_openings(book_id) ON DELETE CASCADE,
    line_order integer NOT NULL CHECK (line_order >= 0),
    asset_id varchar(26) NOT NULL,
    create_object boolean NOT NULL,
    asset_no varchar(32),
    name varchar(200),
    category_id varchar(26),
    department_id varchar(26),
    useful_life_months integer,
    residual_rate_bps integer,
    acquired_on date,
    currency varchar(3) NOT NULL,
    original_minor bigint NOT NULL CHECK (original_minor > 0),
    accumulated_minor bigint NOT NULL CHECK (accumulated_minor >= 0 AND accumulated_minor <= original_minor),
    PRIMARY KEY (book_id, asset_id),
    UNIQUE (book_id, line_order),
    CHECK (NOT create_object OR (
        asset_no IS NOT NULL AND btrim(asset_no) <> '' AND name IS NOT NULL AND btrim(name) <> ''
        AND category_id IS NOT NULL AND department_id IS NOT NULL
        AND useful_life_months > 0 AND residual_rate_bps BETWEEN 0 AND 10000
        AND acquired_on IS NOT NULL
    ))
);

CREATE TABLE acc_opening_bills (
    book_id varchar(26) NOT NULL REFERENCES acc_openings(book_id) ON DELETE CASCADE,
    line_order integer NOT NULL CHECK (line_order >= 0),
    bill_id varchar(26) NOT NULL,
    create_object boolean NOT NULL,
    bill_no varchar(64),
    bill_type varchar(32),
    position_type varchar(16),
    medium varchar(16),
    currency varchar(3) NOT NULL,
    face_amount_minor bigint,
    issue_date date,
    maturity_date date,
    drawer varchar(200),
    acceptor varchar(200),
    payee varchar(200),
    annual_rate_bps integer,
    interest_days integer,
    interest_amount_minor bigint,
    customer_cost_amount_minor bigint,
    origin_party_entity varchar(16),
    origin_party_object_id varchar(26),
    origin_party_version_id varchar(26),
    origin_party_code varchar(64),
    origin_party_name varchar(200),
    value_minor bigint NOT NULL CHECK (value_minor > 0),
    PRIMARY KEY (book_id, bill_id),
    UNIQUE (book_id, line_order),
    CHECK (NOT create_object OR (
        bill_no IS NOT NULL AND btrim(bill_no) <> '' AND bill_type IS NOT NULL
        AND position_type IN ('ASSET', 'LIABILITY') AND medium IN ('PAPER', 'ELECTRONIC')
        AND face_amount_minor > 0 AND issue_date IS NOT NULL AND maturity_date >= issue_date
        AND drawer IS NOT NULL AND acceptor IS NOT NULL AND payee IS NOT NULL
        AND annual_rate_bps BETWEEN 0 AND 100000 AND interest_days >= 0
        AND interest_amount_minor >= 0 AND customer_cost_amount_minor >= 0
    ))
);

CREATE TABLE acc_opening_containers (
    book_id varchar(26) NOT NULL REFERENCES acc_openings(book_id) ON DELETE CASCADE,
    line_order integer NOT NULL CHECK (line_order >= 0),
    customer_id varchar(26) NOT NULL,
    container_type varchar(8) NOT NULL CHECK (container_type IN ('SOLVENT', 'RESIN')),
    quantity bigint NOT NULL CHECK (quantity <> 0),
    PRIMARY KEY (book_id, customer_id, container_type),
    UNIQUE (book_id, line_order)
);

-- +goose Down

DROP TABLE acc_opening_containers;
DROP TABLE acc_opening_bills;
DROP TABLE acc_opening_assets;
DROP TABLE acc_container_entries;
DROP TABLE acc_bill_book_values;
DROP TABLE acc_bills;
DROP TABLE acc_asset_book_values;
DROP TABLE acc_assets;
DROP TABLE acc_register_events;

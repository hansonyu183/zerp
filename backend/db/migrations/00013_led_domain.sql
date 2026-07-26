-- +goose Up
ALTER TABLE vou_product_lines
    ADD COLUMN purchase_unit_price_cents bigint
        CHECK (purchase_unit_price_cents IS NULL OR purchase_unit_price_cents > 0);

CREATE TABLE led_control (
    singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
    status varchar(16) NOT NULL DEFAULT 'DRAFT'
        CHECK (status IN ('DRAFT', 'ACTIVE', 'REOPENING')),
    cutover_date date,
    active_generation_id varchar(26),
    revision bigint NOT NULL DEFAULT 1 CHECK (revision >= 1),
    updated_at timestamptz NOT NULL DEFAULT now(),
    updated_by varchar(26)
);
INSERT INTO led_control (singleton) VALUES (true);

CREATE TABLE led_generations (
    id varchar(26) PRIMARY KEY,
    cutover_date date NOT NULL,
    status varchar(16) NOT NULL CHECK (status IN ('ACTIVE', 'ARCHIVED')),
    activated_at timestamptz NOT NULL DEFAULT now(),
    activated_by varchar(26) NOT NULL,
    request_id varchar(128) NOT NULL
);
ALTER TABLE led_control
    ADD CONSTRAINT led_control_active_generation_fk
    FOREIGN KEY (active_generation_id) REFERENCES led_generations(id) DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE led_draft_inventory (
    id varchar(26) PRIMARY KEY,
    warehouse_object_id varchar(26) NOT NULL,
    warehouse_version_id varchar(26) NOT NULL,
    warehouse_code varchar(64) NOT NULL,
    warehouse_name varchar(200) NOT NULL,
    product_object_id varchar(26) NOT NULL,
    product_version_id varchar(26) NOT NULL,
    product_code varchar(64) NOT NULL,
    product_name varchar(200) NOT NULL,
    product_unit varchar(32) NOT NULL,
    quantity_micros bigint NOT NULL CHECK (quantity_micros >= 0),
    UNIQUE (warehouse_object_id, product_object_id)
);

CREATE TABLE led_draft_fund (
    id varchar(26) PRIMARY KEY,
    fund_account_object_id varchar(26) NOT NULL UNIQUE,
    fund_account_version_id varchar(26) NOT NULL,
    fund_account_code varchar(64) NOT NULL,
    fund_account_name varchar(200) NOT NULL,
    currency varchar(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
    amount_cents bigint NOT NULL
);

CREATE TABLE led_draft_party (
    id varchar(26) PRIMARY KEY,
    counterparty_entity varchar(16) NOT NULL CHECK (counterparty_entity IN ('customer', 'supplier')),
    counterparty_object_id varchar(26) NOT NULL,
    counterparty_version_id varchar(26) NOT NULL,
    counterparty_code varchar(64) NOT NULL,
    counterparty_name varchar(200) NOT NULL,
    currency varchar(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
    amount_cents bigint NOT NULL,
    UNIQUE (counterparty_entity, counterparty_object_id, currency)
);

CREATE TABLE led_opening_inventory (
    id varchar(26) NOT NULL,
    generation_id varchar(26) NOT NULL REFERENCES led_generations(id) ON DELETE RESTRICT,
    warehouse_object_id varchar(26) NOT NULL,
    warehouse_version_id varchar(26) NOT NULL,
    warehouse_code varchar(64) NOT NULL,
    warehouse_name varchar(200) NOT NULL,
    product_object_id varchar(26) NOT NULL,
    product_version_id varchar(26) NOT NULL,
    product_code varchar(64) NOT NULL,
    product_name varchar(200) NOT NULL,
    product_unit varchar(32) NOT NULL,
    quantity_micros bigint NOT NULL CHECK (quantity_micros >= 0),
    PRIMARY KEY (generation_id, id),
    UNIQUE (generation_id, warehouse_object_id, product_object_id)
);

CREATE TABLE led_opening_fund (
    id varchar(26) NOT NULL,
    generation_id varchar(26) NOT NULL REFERENCES led_generations(id) ON DELETE RESTRICT,
    fund_account_object_id varchar(26) NOT NULL,
    fund_account_version_id varchar(26) NOT NULL,
    fund_account_code varchar(64) NOT NULL,
    fund_account_name varchar(200) NOT NULL,
    currency varchar(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
    amount_cents bigint NOT NULL,
    PRIMARY KEY (generation_id, id),
    UNIQUE (generation_id, fund_account_object_id)
);

CREATE TABLE led_opening_party (
    id varchar(26) NOT NULL,
    generation_id varchar(26) NOT NULL REFERENCES led_generations(id) ON DELETE RESTRICT,
    counterparty_entity varchar(16) NOT NULL CHECK (counterparty_entity IN ('customer', 'supplier')),
    counterparty_object_id varchar(26) NOT NULL,
    counterparty_version_id varchar(26) NOT NULL,
    counterparty_code varchar(64) NOT NULL,
    counterparty_name varchar(200) NOT NULL,
    currency varchar(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
    amount_cents bigint NOT NULL,
    PRIMARY KEY (generation_id, id),
    UNIQUE (generation_id, counterparty_entity, counterparty_object_id, currency)
);

CREATE TABLE led_inventory_entries (
    id varchar(26) NOT NULL,
    generation_id varchar(26) NOT NULL REFERENCES led_generations(id) ON DELETE RESTRICT,
    entry_type varchar(16) NOT NULL CHECK (entry_type IN ('OPENING', 'POSTING', 'REVERSAL')),
    source_entity varchar(32) NOT NULL,
    source_document_id varchar(26) NOT NULL DEFAULT '',
    source_document_no varchar(32) NOT NULL DEFAULT '',
    source_line_id varchar(26) NOT NULL DEFAULT '',
    source_revision bigint NOT NULL DEFAULT 0 CHECK (source_revision >= 0),
    effective_date date NOT NULL,
    occurred_at timestamptz NOT NULL,
    actor_id varchar(26) NOT NULL,
    request_id varchar(128) NOT NULL,
    reason varchar(1000),
    warehouse_object_id varchar(26) NOT NULL,
    warehouse_version_id varchar(26) NOT NULL,
    warehouse_code varchar(64) NOT NULL,
    warehouse_name varchar(200) NOT NULL,
    product_object_id varchar(26) NOT NULL,
    product_version_id varchar(26) NOT NULL,
    product_code varchar(64) NOT NULL,
    product_name varchar(200) NOT NULL,
    product_unit varchar(32) NOT NULL,
    quantity_delta_micros bigint NOT NULL CHECK (quantity_delta_micros <> 0),
    PRIMARY KEY (generation_id, id),
    UNIQUE (generation_id, entry_type, source_document_id, source_line_id, source_revision)
);
CREATE INDEX led_inventory_timeline_idx
    ON led_inventory_entries (generation_id, warehouse_object_id, product_object_id, effective_date, occurred_at, id);
CREATE INDEX led_inventory_query_idx
    ON led_inventory_entries (generation_id, effective_date DESC, occurred_at DESC, id DESC);

CREATE TABLE led_fund_entries (
    id varchar(26) NOT NULL,
    generation_id varchar(26) NOT NULL REFERENCES led_generations(id) ON DELETE RESTRICT,
    entry_type varchar(16) NOT NULL CHECK (entry_type IN ('OPENING', 'POSTING', 'REVERSAL')),
    source_entity varchar(32) NOT NULL,
    source_document_id varchar(26) NOT NULL DEFAULT '',
    source_document_no varchar(32) NOT NULL DEFAULT '',
    source_line_id varchar(26) NOT NULL DEFAULT '',
    source_revision bigint NOT NULL DEFAULT 0 CHECK (source_revision >= 0),
    effective_date date NOT NULL,
    occurred_at timestamptz NOT NULL,
    actor_id varchar(26) NOT NULL,
    request_id varchar(128) NOT NULL,
    reason varchar(1000),
    fund_account_object_id varchar(26) NOT NULL,
    fund_account_version_id varchar(26) NOT NULL,
    fund_account_code varchar(64) NOT NULL,
    fund_account_name varchar(200) NOT NULL,
    currency varchar(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
    amount_delta_cents bigint NOT NULL CHECK (amount_delta_cents <> 0),
    PRIMARY KEY (generation_id, id),
    UNIQUE (generation_id, entry_type, source_document_id, source_line_id, source_revision)
);
CREATE INDEX led_fund_query_idx
    ON led_fund_entries (generation_id, effective_date DESC, occurred_at DESC, id DESC);
CREATE INDEX led_fund_balance_idx
    ON led_fund_entries (generation_id, fund_account_object_id, currency, effective_date);

CREATE TABLE led_party_entries (
    id varchar(26) NOT NULL,
    generation_id varchar(26) NOT NULL REFERENCES led_generations(id) ON DELETE RESTRICT,
    entry_type varchar(16) NOT NULL CHECK (entry_type IN ('OPENING', 'POSTING', 'REVERSAL')),
    source_entity varchar(32) NOT NULL,
    source_document_id varchar(26) NOT NULL DEFAULT '',
    source_document_no varchar(32) NOT NULL DEFAULT '',
    source_line_id varchar(26) NOT NULL DEFAULT '',
    source_revision bigint NOT NULL DEFAULT 0 CHECK (source_revision >= 0),
    effective_date date NOT NULL,
    occurred_at timestamptz NOT NULL,
    actor_id varchar(26) NOT NULL,
    request_id varchar(128) NOT NULL,
    reason varchar(1000),
    counterparty_entity varchar(16) NOT NULL CHECK (counterparty_entity IN ('customer', 'supplier')),
    counterparty_object_id varchar(26) NOT NULL,
    counterparty_version_id varchar(26) NOT NULL,
    counterparty_code varchar(64) NOT NULL,
    counterparty_name varchar(200) NOT NULL,
    currency varchar(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
    amount_delta_cents bigint NOT NULL CHECK (amount_delta_cents <> 0),
    PRIMARY KEY (generation_id, id),
    UNIQUE (generation_id, entry_type, source_document_id, source_line_id, source_revision, counterparty_entity)
);
CREATE INDEX led_party_query_idx
    ON led_party_entries (generation_id, effective_date DESC, occurred_at DESC, id DESC);
CREATE INDEX led_party_balance_idx
    ON led_party_entries (generation_id, counterparty_entity, counterparty_object_id, currency, effective_date);

CREATE TABLE led_audit_events (
    id varchar(26) PRIMARY KEY,
    event_type varchar(32) NOT NULL
        CHECK (event_type IN ('OPENING_SAVED', 'ACTIVATED', 'REOPENED', 'REOPEN_CANCELLED')),
    from_status varchar(16),
    to_status varchar(16) NOT NULL,
    generation_id varchar(26),
    revision bigint NOT NULL CHECK (revision >= 1),
    actor_id varchar(26) NOT NULL,
    occurred_at timestamptz NOT NULL DEFAULT now(),
    reason varchar(1000),
    request_id varchar(128) NOT NULL,
    summary jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX led_audit_history_idx ON led_audit_events (occurred_at DESC, id DESC);

WITH permissions(id, path, entity, action, description) AS (
    VALUES
        ('01JLED00000000000000000001', '/led/opening/get', 'opening', 'get', '查看账簿启用与期初'),
        ('01JLED00000000000000000002', '/led/opening/save', 'opening', 'save', '保存账簿期初'),
        ('01JLED00000000000000000003', '/led/opening/activate', 'opening', 'activate', '启用账簿'),
        ('01JLED00000000000000000004', '/led/opening/reopen', 'opening', 'reopen', '重开账簿期初'),
        ('01JLED00000000000000000005', '/led/opening/cancel-reopen', 'opening', 'cancel-reopen', '取消重开账簿'),
        ('01JLED00000000000000000006', '/led/opening/audit-history', 'opening', 'audit-history', '查看账簿生命周期审计'),
        ('01JLED00000000000000000007', '/led/inventory/query', 'inventory', 'query', '查询库存流水'),
        ('01JLED00000000000000000008', '/led/inventory/balance', 'inventory', 'balance', '查询库存余额'),
        ('01JLED00000000000000000009', '/led/fund/query', 'fund', 'query', '查询资金流水'),
        ('01JLED00000000000000000010', '/led/fund/balance', 'fund', 'balance', '查询资金余额'),
        ('01JLED00000000000000000011', '/led/party/query', 'party', 'query', '查询往来流水'),
        ('01JLED00000000000000000012', '/led/party/balance', 'party', 'balance', '查询往来余额')
)
INSERT INTO app_permissions (id, path, domain, entity, action, description, status)
SELECT id, path, 'led', entity, action, description, 'ENABLED' FROM permissions;

-- +goose Down
-- +goose StatementBegin
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM led_generations) OR EXISTS (SELECT 1 FROM led_audit_events) THEN
        RAISE EXCEPTION 'cannot roll back LED migration while LED data exists';
    END IF;
END $$;
-- +goose StatementEnd

DELETE FROM app_role_permissions WHERE permission_id IN (SELECT id FROM app_permissions WHERE domain = 'led');
DELETE FROM app_permissions WHERE domain = 'led';
DROP TABLE led_audit_events;
DROP TABLE led_party_entries;
DROP TABLE led_fund_entries;
DROP TABLE led_inventory_entries;
DROP TABLE led_opening_party;
DROP TABLE led_opening_fund;
DROP TABLE led_opening_inventory;
DROP TABLE led_draft_party;
DROP TABLE led_draft_fund;
DROP TABLE led_draft_inventory;
ALTER TABLE led_control DROP CONSTRAINT led_control_active_generation_fk;
DROP TABLE led_control;
DROP TABLE led_generations;
ALTER TABLE vou_product_lines DROP COLUMN purchase_unit_price_cents;

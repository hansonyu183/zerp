-- +goose Up
ALTER TABLE led_control
    ADD COLUMN last_closing_id varchar(26),
    ADD COLUMN rebuild_required boolean NOT NULL DEFAULT true;

CREATE TABLE led_closings (
    id varchar(26) PRIMARY KEY,
    closing_date date NOT NULL,
    opening_date date NOT NULL,
    status varchar(16) NOT NULL DEFAULT 'ACTIVE'
        CHECK (status IN ('ACTIVE', 'REVERSED')),
    revision bigint NOT NULL CHECK (revision >= 1),
    closed_at timestamptz NOT NULL DEFAULT now(),
    closed_by varchar(26) NOT NULL,
    request_id varchar(128) NOT NULL,
    reversed_at timestamptz,
    reversed_by varchar(26),
    reverse_reason varchar(1000),
    reverse_request_id varchar(128),
    CHECK (opening_date = closing_date + 1),
    CHECK (
        (status = 'ACTIVE' AND reversed_at IS NULL AND reversed_by IS NULL
            AND reverse_reason IS NULL AND reverse_request_id IS NULL)
        OR
        (status = 'REVERSED' AND reversed_at IS NOT NULL AND reversed_by IS NOT NULL
            AND reverse_reason IS NOT NULL AND reverse_request_id IS NOT NULL)
    )
);
CREATE UNIQUE INDEX led_closings_active_date_uq
    ON led_closings(closing_date) WHERE status = 'ACTIVE';
CREATE INDEX led_closings_history_idx ON led_closings(closed_at DESC, id DESC);

ALTER TABLE led_control
    ADD CONSTRAINT led_control_last_closing_fk
    FOREIGN KEY (last_closing_id) REFERENCES led_closings(id)
    DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE led_closing_inventory (
    closing_id varchar(26) NOT NULL REFERENCES led_closings(id) ON DELETE RESTRICT,
    warehouse_object_id varchar(26) NOT NULL,
    warehouse_version_id varchar(26) NOT NULL,
    warehouse_code varchar(64) NOT NULL,
    warehouse_name varchar(200) NOT NULL,
    product_object_id varchar(26) NOT NULL,
    product_version_id varchar(26) NOT NULL,
    product_code varchar(64) NOT NULL,
    product_name varchar(200) NOT NULL,
    product_unit varchar(32) NOT NULL,
    quantity_micros bigint NOT NULL CHECK (quantity_micros > 0),
    currency varchar(3) NOT NULL DEFAULT 'CNY' CHECK (currency = 'CNY'),
    cost_amount_cents bigint NOT NULL CHECK (cost_amount_cents >= 0),
    PRIMARY KEY (closing_id, warehouse_object_id, product_object_id)
);

CREATE TABLE led_closing_fund (
    closing_id varchar(26) NOT NULL REFERENCES led_closings(id) ON DELETE RESTRICT,
    fund_account_object_id varchar(26) NOT NULL,
    fund_account_version_id varchar(26) NOT NULL,
    fund_account_code varchar(64) NOT NULL,
    fund_account_name varchar(200) NOT NULL,
    currency varchar(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
    amount_cents bigint NOT NULL CHECK (amount_cents <> 0),
    PRIMARY KEY (closing_id, fund_account_object_id, currency)
);

CREATE TABLE led_closing_party (
    closing_id varchar(26) NOT NULL REFERENCES led_closings(id) ON DELETE RESTRICT,
    counterparty_entity varchar(16) NOT NULL
        CHECK (counterparty_entity IN ('customer', 'supplier')),
    counterparty_object_id varchar(26) NOT NULL,
    counterparty_version_id varchar(26) NOT NULL,
    counterparty_code varchar(64) NOT NULL,
    counterparty_name varchar(200) NOT NULL,
    currency varchar(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
    amount_cents bigint NOT NULL CHECK (amount_cents <> 0),
    PRIMARY KEY (
        closing_id, counterparty_entity, counterparty_object_id, currency
    )
);

CREATE TABLE led_closing_container (
    closing_id varchar(26) NOT NULL REFERENCES led_closings(id) ON DELETE RESTRICT,
    customer_object_id varchar(26) NOT NULL,
    customer_version_id varchar(26) NOT NULL,
    customer_code varchar(64) NOT NULL,
    customer_name varchar(200) NOT NULL,
    container_type varchar(16) NOT NULL
        CHECK (container_type IN ('SOLVENT', 'RESIN')),
    quantity bigint NOT NULL CHECK (quantity <> 0),
    PRIMARY KEY (closing_id, customer_object_id, container_type)
);

CREATE TABLE led_inventory_cost_allocations (
    closing_id varchar(26) NOT NULL REFERENCES led_closings(id) ON DELETE RESTRICT,
    entry_id varchar(26) NOT NULL,
    source_document_id varchar(26) NOT NULL,
    source_line_id varchar(26) NOT NULL,
    quantity_micros bigint NOT NULL CHECK (quantity_micros <> 0),
    cost_amount_cents bigint NOT NULL CHECK (cost_amount_cents >= 0),
    currency varchar(3) NOT NULL DEFAULT 'CNY' CHECK (currency = 'CNY'),
    PRIMARY KEY (closing_id, entry_id)
);
CREATE INDEX led_inventory_cost_source_idx
    ON led_inventory_cost_allocations(source_document_id, source_line_id);

INSERT INTO led_generations (
    id, cutover_date, status, activated_by, request_id
)
SELECT
    '01JLEDCLOSINGBASE000000000', DATE '0001-01-01', 'ACTIVE',
    '01JLEDSYSTEM00000000000000', 'migration/00034'
WHERE NOT EXISTS (SELECT 1 FROM led_generations WHERE status = 'ACTIVE');

UPDATE led_control
SET status = 'ACTIVE',
    cutover_date = DATE '0001-01-01',
    active_generation_id = (
        SELECT id FROM led_generations WHERE status = 'ACTIVE'
        ORDER BY activated_at DESC, id DESC LIMIT 1
    ),
    revision = revision + 1,
    rebuild_required = true,
    updated_at = now(),
    updated_by = '01JLEDSYSTEM00000000000000'
WHERE singleton = true;

UPDATE app_permissions
SET path = '/led/closing/get', entity = 'closing', action = 'get',
    description = '查看月末结账与期初'
WHERE id = '01JLED00000000000000000001';
UPDATE app_permissions
SET path = '/led/closing/close', entity = 'closing', action = 'close',
    description = '执行月末结账'
WHERE id = '01JLED00000000000000000003';
UPDATE app_permissions
SET path = '/led/closing/unclose', entity = 'closing', action = 'unclose',
    description = '反结最近一期'
WHERE id = '01JLED00000000000000000004';
UPDATE app_permissions
SET path = '/led/closing/history', entity = 'closing', action = 'history',
    description = '查看月末结账历史'
WHERE id = '01JLED00000000000000000006';
DELETE FROM app_role_permissions
WHERE permission_id IN (
    '01JLED00000000000000000002',
    '01JLED00000000000000000005'
);
DELETE FROM app_permissions
WHERE id IN (
    '01JLED00000000000000000002',
    '01JLED00000000000000000005'
);

-- +goose StatementBegin
CREATE FUNCTION led_assert_document_open() RETURNS trigger AS $$
DECLARE
    closed_through date;
    target_date date;
BEGIN
    SELECT c.closing_date INTO closed_through
    FROM led_control control
    LEFT JOIN led_closings c
      ON c.id = control.last_closing_id AND c.status = 'ACTIVE'
    WHERE control.singleton = true
    FOR SHARE OF control;

    IF closed_through IS NULL THEN
        RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
    END IF;

    IF TG_OP = 'INSERT' THEN
        target_date := NEW.business_date;
    ELSIF TG_OP = 'DELETE' THEN
        target_date := OLD.business_date;
    ELSE
        IF OLD.business_date <= closed_through OR NEW.business_date <= closed_through THEN
            RAISE EXCEPTION 'document date is closed through %', closed_through
                USING ERRCODE = 'P0001';
        END IF;
        RETURN NEW;
    END IF;

    IF target_date <= closed_through THEN
        RAISE EXCEPTION 'document date is closed through %', closed_through
            USING ERRCODE = 'P0001';
    END IF;
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$ LANGUAGE plpgsql;

CREATE FUNCTION led_assert_attachment_open() RETURNS trigger AS $$
DECLARE
    target_file_id varchar(26);
    closed_through date;
    document_date date;
BEGIN
    target_file_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.id ELSE NEW.id END;
    PERFORM 1 FROM led_control WHERE singleton = true FOR SHARE;
    SELECT c.closing_date, d.business_date
    INTO closed_through, document_date
    FROM vou_document_attachments a
    JOIN vou_documents d ON d.id = a.document_id
    JOIN led_control control ON control.singleton = true
    JOIN led_closings c ON c.id = control.last_closing_id
    WHERE a.file_id = target_file_id AND c.status = 'ACTIVE';

    IF closed_through IS NOT NULL AND document_date <= closed_through THEN
        RAISE EXCEPTION 'document attachment is closed through %', closed_through
            USING ERRCODE = 'P0001';
    END IF;
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$ LANGUAGE plpgsql;
-- +goose StatementEnd

CREATE TRIGGER vou_documents_closing_guard
    BEFORE INSERT OR UPDATE OR DELETE ON vou_documents
    FOR EACH ROW EXECUTE FUNCTION led_assert_document_open();
CREATE TRIGGER vou_files_closing_guard
    BEFORE UPDATE OR DELETE ON vou_files
    FOR EACH ROW EXECUTE FUNCTION led_assert_attachment_open();

-- +goose Down
DROP TRIGGER vou_files_closing_guard ON vou_files;
DROP TRIGGER vou_documents_closing_guard ON vou_documents;
DROP FUNCTION led_assert_attachment_open();
DROP FUNCTION led_assert_document_open();

UPDATE app_permissions
SET path = '/led/opening/get', entity = 'opening', action = 'get',
    description = '查看账簿启用与期初'
WHERE id = '01JLED00000000000000000001';
UPDATE app_permissions
SET path = '/led/opening/activate', entity = 'opening', action = 'activate',
    description = '启用账簿'
WHERE id = '01JLED00000000000000000003';
UPDATE app_permissions
SET path = '/led/opening/reopen', entity = 'opening', action = 'reopen',
    description = '重开账簿期初'
WHERE id = '01JLED00000000000000000004';
UPDATE app_permissions
SET path = '/led/opening/audit-history', entity = 'opening',
    action = 'audit-history', description = '查看账簿生命周期审计'
WHERE id = '01JLED00000000000000000006';
INSERT INTO app_permissions(id,path,domain,entity,action,description,status)
VALUES
    ('01JLED00000000000000000002','/led/opening/save','led','opening','save','保存账簿期初','ENABLED'),
    ('01JLED00000000000000000005','/led/opening/cancel-reopen','led','opening','cancel-reopen','取消重开账簿','ENABLED')
ON CONFLICT (id) DO NOTHING;
INSERT INTO app_role_permissions(role_id,permission_id,created_by)
SELECT role.id,permission.id,role.updated_by
FROM app_roles role
JOIN app_permissions permission ON permission.id IN (
    '01JLED00000000000000000002',
    '01JLED00000000000000000005'
)
WHERE role.code='superadmin'
ON CONFLICT DO NOTHING;

DROP TABLE led_inventory_cost_allocations;
DROP TABLE led_closing_container;
DROP TABLE led_closing_party;
DROP TABLE led_closing_fund;
DROP TABLE led_closing_inventory;
ALTER TABLE led_control DROP CONSTRAINT led_control_last_closing_fk;
DROP TABLE led_closings;
ALTER TABLE led_control
    DROP COLUMN rebuild_required,
    DROP COLUMN last_closing_id;

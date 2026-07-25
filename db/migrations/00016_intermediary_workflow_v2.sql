-- +goose Up

ALTER TABLE bob_product_versions
    ADD COLUMN container_type varchar(16) NOT NULL DEFAULT 'NONE',
    ADD COLUMN quantity_per_container_micros bigint,
    ADD CONSTRAINT bob_product_container_type_ck
        CHECK (container_type IN ('NONE', 'SOLVENT', 'RESIN')),
    ADD CONSTRAINT bob_product_container_quantity_ck CHECK (
        (container_type = 'NONE' AND quantity_per_container_micros IS NULL)
        OR (container_type IN ('SOLVENT', 'RESIN') AND quantity_per_container_micros > 0)
    );

CREATE OR REPLACE VIEW bob_version_views AS
SELECT
    o.id AS object_id, o.entity, o.code, o.current_version_id, o.effective_version_id,
    o.revision AS object_revision, o.updated_at AS object_updated_at,
    v.id AS version_id, v.version_no, v.status, v.revision AS version_revision,
    v.created_at, v.created_by, v.updated_at, v.updated_by, v.submitted_at, v.submitted_by,
    v.reviewed_at, v.reviewed_by, v.review_comment,
    COALESCE(c.name, s.name, e.name, p.name, sv.name, w.name, vh.name, f.name,
             ca.name, d.name, po.name, sm.name) AS name,
    COALESCE(p.unit, sv.unit, '') AS unit,
    f.currency, s.supplier_type, vh.plate_number, vh.vehicle_type, vh.platform_object_id,
    COALESCE(c.customer_type, '') AS customer_type,
    COALESCE(c.short_name, s.short_name, '') AS short_name,
    COALESCE(c.category_id, s.category_id, e.category_id, p.category_id, sv.category_id,
             w.category_id, vh.category_id, f.category_id, d.category_id, po.category_id, '') AS category_id,
    COALESCE(c.tax_number, s.tax_number, '') AS tax_number,
    COALESCE(c.contact_name, s.contact_name, w.contact_name, '') AS contact_name,
    COALESCE(c.contact_phone, s.contact_phone, w.contact_phone, '') AS contact_phone,
    COALESCE(c.email, s.email, e.email, '') AS email,
    COALESCE(c.address, s.address, w.address, '') AS address,
    COALESCE(c.remark, s.remark, e.remark, p.remark, sv.remark, w.remark, vh.remark, f.remark, '') AS remark,
    COALESCE(e.department_id, '') AS department_id,
    COALESCE(e.position_id, '') AS position_id,
    COALESCE(e.phone, '') AS phone,
    CAST(COALESCE(e.hire_date::text, '') AS varchar(10)) AS hire_date,
    COALESCE(p.specification, '') AS specification,
    COALESCE(p.model, '') AS model,
    COALESCE(p.barcode, '') AS barcode,
    COALESCE(sv.description, ca.description, d.description, po.description, sm.description, '') AS description,
    COALESCE(w.manager_employee_id, '') AS manager_employee_id,
    COALESCE(vh.vin, '') AS vin,
    COALESCE(vh.engine_number, '') AS engine_number,
    CAST(COALESCE(vh.load_capacity_kg::text, '') AS varchar(32)) AS load_capacity_kg,
    COALESCE(f.account_name, '') AS account_name,
    COALESCE(f.bank_name, '') AS bank_name,
    COALESCE(f.bank_branch, '') AS bank_branch,
    COALESCE(f.account_number, '') AS account_number,
    COALESCE(ca.target_entity, '') AS target_entity,
    COALESCE(ca.parent_id, d.parent_id, '') AS parent_id,
    COALESCE(c.settlement_method_id, s.settlement_method_id, '') AS settlement_method_id,
    COALESCE(c.salesperson_employee_id, s.salesperson_employee_id, '') AS salesperson_employee_id,
    COALESCE(linked_sm.effective_version_id, '') AS settlement_method_version_id,
    COALESCE(sm.rule_type, '') AS settlement_rule_type,
    COALESCE(sm.month_offset, 0) AS settlement_month_offset,
    COALESCE(sm.day_of_month, 0) AS settlement_day_of_month,
    COALESCE(sm.day_offset, 0) AS settlement_day_offset,
    COALESCE(p.container_type, '') AS container_type,
    COALESCE(p.quantity_per_container_micros, 0) AS quantity_per_container_micros
FROM bob_objects o
JOIN bob_versions v ON v.object_id = o.id AND v.entity = o.entity
LEFT JOIN bob_customer_versions c ON c.version_id = v.id
LEFT JOIN bob_supplier_versions s ON s.version_id = v.id
LEFT JOIN bob_employee_versions e ON e.version_id = v.id
LEFT JOIN bob_product_versions p ON p.version_id = v.id
LEFT JOIN bob_service_versions sv ON sv.version_id = v.id
LEFT JOIN bob_warehouse_versions w ON w.version_id = v.id
LEFT JOIN bob_vehicle_versions vh ON vh.version_id = v.id
LEFT JOIN bob_fund_account_versions f ON f.version_id = v.id
LEFT JOIN bob_category_versions ca ON ca.version_id = v.id
LEFT JOIN bob_department_versions d ON d.version_id = v.id
LEFT JOIN bob_position_versions po ON po.version_id = v.id
LEFT JOIN bob_objects linked_sm
    ON linked_sm.id = COALESCE(c.settlement_method_id, s.settlement_method_id)
   AND linked_sm.entity = 'settlement-method'
LEFT JOIN bob_settlement_method_versions sm ON sm.version_id = v.id;

ALTER TABLE vou_documents
    ADD COLUMN workflow_version smallint NOT NULL DEFAULT 1,
    ADD COLUMN checked_at timestamptz,
    ADD COLUMN checked_by varchar(26),
    ADD COLUMN completed_at timestamptz,
    DROP CONSTRAINT vou_documents_status_check,
    DROP CONSTRAINT vou_documents_status_audit_ck,
    ADD CONSTRAINT vou_documents_workflow_version_ck CHECK (workflow_version IN (1, 2)),
    ADD CONSTRAINT vou_documents_status_ck CHECK (
        (workflow_version = 1 AND status IN ('DRAFT', 'REVIEWED', 'APPROVED', 'EXECUTED'))
        OR
        (workflow_version = 2 AND entity = 'intermediary-sale-order'
            AND status IN ('DRAFT', 'CHECKED', 'APPROVED', 'COMPLETED',
                           'SHORT_CLOSE_REQUESTED', 'SHORT_CLOSED'))
    ),
    ADD CONSTRAINT vou_documents_status_audit_ck CHECK (
        (workflow_version = 1 AND (
            (status = 'DRAFT' AND reviewed_at IS NULL AND reviewed_by IS NULL
                AND approved_at IS NULL AND approved_by IS NULL AND executed_at IS NULL AND executed_by IS NULL)
            OR (status = 'REVIEWED' AND reviewed_at IS NOT NULL AND reviewed_by IS NOT NULL
                AND approved_at IS NULL AND approved_by IS NULL AND executed_at IS NULL AND executed_by IS NULL)
            OR (status = 'APPROVED' AND reviewed_at IS NOT NULL AND reviewed_by IS NOT NULL
                AND approved_at IS NOT NULL AND approved_by IS NOT NULL AND executed_at IS NULL AND executed_by IS NULL)
            OR (status = 'EXECUTED' AND reviewed_at IS NOT NULL AND reviewed_by IS NOT NULL
                AND approved_at IS NOT NULL AND approved_by IS NOT NULL AND executed_at IS NOT NULL AND executed_by IS NOT NULL)
        ))
        OR
        (workflow_version = 2 AND reviewed_at IS NULL AND reviewed_by IS NULL
            AND executed_at IS NULL AND executed_by IS NULL AND (
            (status = 'DRAFT' AND checked_at IS NULL AND checked_by IS NULL
                AND approved_at IS NULL AND approved_by IS NULL AND completed_at IS NULL)
            OR (status = 'CHECKED' AND checked_at IS NOT NULL AND checked_by IS NOT NULL
                AND approved_at IS NULL AND approved_by IS NULL AND completed_at IS NULL)
            OR (status IN ('APPROVED', 'SHORT_CLOSE_REQUESTED')
                AND checked_at IS NOT NULL AND checked_by IS NOT NULL
                AND approved_at IS NOT NULL AND approved_by IS NOT NULL AND completed_at IS NULL)
            OR (status IN ('COMPLETED', 'SHORT_CLOSED')
                AND checked_at IS NOT NULL AND checked_by IS NOT NULL
                AND approved_at IS NOT NULL AND approved_by IS NOT NULL AND completed_at IS NOT NULL)
        ))
    );

CREATE TABLE vou_intermediary_v2_details (
    document_id varchar(26) PRIMARY KEY,
    entity varchar(32) NOT NULL DEFAULT 'intermediary-sale-order'
        CHECK (entity = 'intermediary-sale-order'),
    customer_object_id varchar(26) NOT NULL,
    customer_version_id varchar(26) NOT NULL,
    customer_code varchar(64) NOT NULL,
    customer_name varchar(200) NOT NULL,
    salesperson_object_id varchar(26) NOT NULL,
    salesperson_version_id varchar(26) NOT NULL,
    salesperson_code varchar(64) NOT NULL,
    salesperson_name varchar(200) NOT NULL,
    contact_name varchar(100),
    contact_phone varchar(32),
    delivery_address varchar(500),
    settlement_object_id varchar(26) NOT NULL,
    settlement_version_id varchar(26) NOT NULL,
    settlement_code varchar(64) NOT NULL,
    settlement_name varchar(200) NOT NULL,
    settlement_rule_type varchar(16) NOT NULL,
    settlement_month_offset integer NOT NULL,
    settlement_day_of_month integer,
    settlement_day_offset integer NOT NULL,
    FOREIGN KEY (document_id, entity) REFERENCES vou_documents(id, entity) ON DELETE RESTRICT
);

CREATE TABLE vou_intermediary_v2_lines (
    id varchar(26) PRIMARY KEY,
    document_id varchar(26) NOT NULL REFERENCES vou_intermediary_v2_details(document_id) ON DELETE RESTRICT,
    line_no integer NOT NULL CHECK (line_no > 0),
    product_object_id varchar(26) NOT NULL,
    product_version_id varchar(26) NOT NULL,
    product_code varchar(64) NOT NULL,
    product_name varchar(200) NOT NULL,
    product_unit varchar(32) NOT NULL,
    ordered_qty_micros bigint NOT NULL CHECK (ordered_qty_micros > 0),
    sale_unit_price_cents bigint NOT NULL CHECK (sale_unit_price_cents > 0),
    line_amount_cents bigint NOT NULL CHECK (line_amount_cents > 0),
    container_type varchar(16) NOT NULL CHECK (container_type IN ('NONE', 'SOLVENT', 'RESIN')),
    quantity_per_container_micros bigint,
    remark varchar(1000),
    UNIQUE (document_id, line_no),
    CONSTRAINT vou_intermediary_v2_line_container_ck CHECK (
        (container_type = 'NONE' AND quantity_per_container_micros IS NULL)
        OR (container_type IN ('SOLVENT', 'RESIN') AND quantity_per_container_micros > 0)
    )
);

CREATE TABLE vou_intermediary_children (
    id varchar(26) PRIMARY KEY,
    document_id varchar(26) NOT NULL REFERENCES vou_intermediary_v2_details(document_id) ON DELETE RESTRICT,
    stage varchar(16) NOT NULL CHECK (stage IN ('PROCUREMENT', 'RECEIPT', 'DELIVERY', 'SIGNOFF')),
    child_no varchar(40) NOT NULL UNIQUE,
    status varchar(16) NOT NULL DEFAULT 'DRAFT',
    revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
    created_at timestamptz NOT NULL DEFAULT now(),
    created_by varchar(26) NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now(),
    updated_by varchar(26) NOT NULL,
    checked_at timestamptz,
    checked_by varchar(26),
    final_at timestamptz,
    final_by varchar(26),
    UNIQUE (id, stage),
    CONSTRAINT vou_intermediary_child_status_ck CHECK (
        (stage = 'PROCUREMENT' AND status IN ('DRAFT', 'CHECKED', 'ORDERED'))
        OR (stage = 'RECEIPT' AND status IN ('DRAFT', 'CHECKED', 'CONFIRMED'))
        OR (stage = 'DELIVERY' AND status IN ('DRAFT', 'CHECKED', 'EXECUTED'))
        OR (stage = 'SIGNOFF' AND status IN ('DRAFT', 'CHECKED', 'CONFIRMED'))
    ),
    CONSTRAINT vou_intermediary_child_audit_ck CHECK (
        (status = 'DRAFT' AND checked_at IS NULL AND checked_by IS NULL AND final_at IS NULL AND final_by IS NULL)
        OR (status = 'CHECKED' AND checked_at IS NOT NULL AND checked_by IS NOT NULL
            AND final_at IS NULL AND final_by IS NULL)
        OR (status IN ('ORDERED', 'CONFIRMED', 'EXECUTED')
            AND checked_at IS NOT NULL AND checked_by IS NOT NULL
            AND final_at IS NOT NULL AND final_by IS NOT NULL)
    )
);
CREATE UNIQUE INDEX vou_intermediary_single_procurement_uq
    ON vou_intermediary_children(document_id) WHERE stage = 'PROCUREMENT';
CREATE INDEX vou_intermediary_children_document_idx
    ON vou_intermediary_children(document_id, stage, created_at, id);

CREATE TABLE vou_intermediary_child_counters (
    document_id varchar(26) NOT NULL REFERENCES vou_intermediary_v2_details(document_id) ON DELETE RESTRICT,
    stage varchar(16) NOT NULL CHECK (stage IN ('RECEIPT', 'DELIVERY', 'SIGNOFF')),
    last_value integer NOT NULL CHECK (last_value BETWEEN 1 AND 999),
    PRIMARY KEY (document_id, stage)
);

CREATE TABLE vou_intermediary_procurements (
    child_id varchar(26) PRIMARY KEY,
    stage varchar(16) NOT NULL DEFAULT 'PROCUREMENT' CHECK (stage = 'PROCUREMENT'),
    supplier_object_id varchar(26) NOT NULL,
    supplier_version_id varchar(26) NOT NULL,
    supplier_code varchar(64) NOT NULL,
    supplier_name varchar(200) NOT NULL,
    purchaser_object_id varchar(26) NOT NULL,
    purchaser_version_id varchar(26) NOT NULL,
    purchaser_code varchar(64) NOT NULL,
    purchaser_name varchar(200) NOT NULL,
    purchase_date date NOT NULL,
    contact_name varchar(100),
    contact_phone varchar(32),
    settlement_object_id varchar(26) NOT NULL,
    settlement_version_id varchar(26) NOT NULL,
    settlement_code varchar(64) NOT NULL,
    settlement_name varchar(200) NOT NULL,
    settlement_rule_type varchar(16) NOT NULL,
    settlement_month_offset integer NOT NULL,
    settlement_day_of_month integer,
    settlement_day_offset integer NOT NULL,
    remark varchar(1000),
    FOREIGN KEY (child_id, stage) REFERENCES vou_intermediary_children(id, stage) ON DELETE CASCADE
);

CREATE TABLE vou_intermediary_procurement_lines (
    id varchar(26) PRIMARY KEY,
    child_id varchar(26) NOT NULL REFERENCES vou_intermediary_procurements(child_id) ON DELETE CASCADE,
    root_line_id varchar(26) NOT NULL REFERENCES vou_intermediary_v2_lines(id) ON DELETE RESTRICT,
    quantity_micros bigint NOT NULL CHECK (quantity_micros >= 0),
    unit_price_cents bigint,
    line_amount_cents bigint,
    remark varchar(1000),
    UNIQUE (child_id, root_line_id),
    CHECK (
        (quantity_micros = 0 AND unit_price_cents IS NULL AND line_amount_cents IS NULL)
        OR (quantity_micros > 0 AND unit_price_cents > 0 AND line_amount_cents > 0)
    )
);

CREATE TABLE vou_intermediary_receipts (
    child_id varchar(26) PRIMARY KEY,
    stage varchar(16) NOT NULL DEFAULT 'RECEIPT' CHECK (stage = 'RECEIPT'),
    receipt_date date NOT NULL,
    remark varchar(1000),
    FOREIGN KEY (child_id, stage) REFERENCES vou_intermediary_children(id, stage) ON DELETE CASCADE
);
CREATE TABLE vou_intermediary_receipt_lines (
    id varchar(26) PRIMARY KEY,
    child_id varchar(26) NOT NULL REFERENCES vou_intermediary_receipts(child_id) ON DELETE CASCADE,
    root_line_id varchar(26) NOT NULL REFERENCES vou_intermediary_v2_lines(id) ON DELETE RESTRICT,
    quantity_micros bigint NOT NULL CHECK (quantity_micros >= 0),
    remark varchar(1000),
    UNIQUE (child_id, root_line_id)
);

CREATE TABLE vou_intermediary_deliveries (
    child_id varchar(26) PRIMARY KEY,
    stage varchar(16) NOT NULL DEFAULT 'DELIVERY' CHECK (stage = 'DELIVERY'),
    delivery_date date NOT NULL,
    platform_object_id varchar(26) NOT NULL,
    platform_version_id varchar(26) NOT NULL,
    platform_code varchar(64) NOT NULL,
    platform_name varchar(200) NOT NULL,
    vehicle_object_id varchar(26) NOT NULL,
    vehicle_version_id varchar(26) NOT NULL,
    vehicle_code varchar(64) NOT NULL,
    vehicle_name varchar(200) NOT NULL,
    vehicle_plate_number varchar(32) NOT NULL,
    expected_solvent_containers bigint NOT NULL DEFAULT 0 CHECK (expected_solvent_containers >= 0),
    expected_resin_containers bigint NOT NULL DEFAULT 0 CHECK (expected_resin_containers >= 0),
    remark varchar(1000),
    FOREIGN KEY (child_id, stage) REFERENCES vou_intermediary_children(id, stage) ON DELETE CASCADE
);
CREATE TABLE vou_intermediary_delivery_lines (
    id varchar(26) PRIMARY KEY,
    child_id varchar(26) NOT NULL REFERENCES vou_intermediary_deliveries(child_id) ON DELETE CASCADE,
    root_line_id varchar(26) NOT NULL REFERENCES vou_intermediary_v2_lines(id) ON DELETE RESTRICT,
    quantity_micros bigint NOT NULL CHECK (quantity_micros >= 0),
    remark varchar(1000),
    UNIQUE (child_id, root_line_id)
);

CREATE TABLE vou_intermediary_signoffs (
    child_id varchar(26) PRIMARY KEY,
    stage varchar(16) NOT NULL DEFAULT 'SIGNOFF' CHECK (stage = 'SIGNOFF'),
    delivery_child_id varchar(26) NOT NULL UNIQUE REFERENCES vou_intermediary_deliveries(child_id) ON DELETE RESTRICT,
    signoff_date date NOT NULL,
    returned_solvent_containers bigint NOT NULL CHECK (returned_solvent_containers >= 0),
    returned_resin_containers bigint NOT NULL CHECK (returned_resin_containers >= 0),
    container_difference_reason varchar(1000),
    remark varchar(1000),
    FOREIGN KEY (child_id, stage) REFERENCES vou_intermediary_children(id, stage) ON DELETE CASCADE
);
CREATE TABLE vou_intermediary_signoff_lines (
    id varchar(26) PRIMARY KEY,
    child_id varchar(26) NOT NULL REFERENCES vou_intermediary_signoffs(child_id) ON DELETE CASCADE,
    root_line_id varchar(26) NOT NULL REFERENCES vou_intermediary_v2_lines(id) ON DELETE RESTRICT,
    signed_qty_micros bigint NOT NULL CHECK (signed_qty_micros >= 0),
    rejected_qty_micros bigint NOT NULL CHECK (rejected_qty_micros >= 0),
    loss_qty_micros bigint NOT NULL CHECK (loss_qty_micros >= 0),
    remark varchar(1000),
    UNIQUE (child_id, root_line_id)
);

CREATE TABLE vou_intermediary_child_attachments (
    child_id varchar(26) NOT NULL REFERENCES vou_intermediary_children(id) ON DELETE RESTRICT,
    file_id varchar(26) NOT NULL REFERENCES vou_files(id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),
    created_by varchar(26) NOT NULL,
    PRIMARY KEY (child_id, file_id)
);

ALTER TABLE vou_audit_events
    ADD COLUMN workflow_version smallint NOT NULL DEFAULT 1 CHECK (workflow_version IN (1, 2)),
    ADD COLUMN stage varchar(16),
    ADD COLUMN child_id varchar(26),
    ADD COLUMN child_no varchar(40),
    ADD COLUMN child_status varchar(16),
    ALTER COLUMN event_type TYPE varchar(48),
    DROP CONSTRAINT vou_audit_events_event_type_check,
    DROP CONSTRAINT vou_audit_events_from_status_check,
    DROP CONSTRAINT vou_audit_events_to_status_check;

CREATE TABLE led_draft_container (
    id varchar(26) PRIMARY KEY,
    customer_object_id varchar(26) NOT NULL,
    customer_version_id varchar(26) NOT NULL,
    customer_code varchar(64) NOT NULL,
    customer_name varchar(200) NOT NULL,
    container_type varchar(16) NOT NULL CHECK (container_type IN ('SOLVENT', 'RESIN')),
    quantity bigint NOT NULL,
    UNIQUE (customer_object_id, container_type)
);
CREATE TABLE led_opening_container (
    id varchar(26) NOT NULL,
    generation_id varchar(26) NOT NULL REFERENCES led_generations(id) ON DELETE RESTRICT,
    customer_object_id varchar(26) NOT NULL,
    customer_version_id varchar(26) NOT NULL,
    customer_code varchar(64) NOT NULL,
    customer_name varchar(200) NOT NULL,
    container_type varchar(16) NOT NULL CHECK (container_type IN ('SOLVENT', 'RESIN')),
    quantity bigint NOT NULL,
    PRIMARY KEY (generation_id, id),
    UNIQUE (generation_id, customer_object_id, container_type)
);
CREATE TABLE led_container_entries (
    id varchar(26) NOT NULL,
    generation_id varchar(26) NOT NULL REFERENCES led_generations(id) ON DELETE RESTRICT,
    entry_type varchar(16) NOT NULL CHECK (entry_type IN ('OPENING', 'POSTING', 'REVERSAL')),
    source_entity varchar(32) NOT NULL,
    source_document_id varchar(26) NOT NULL DEFAULT '',
    source_document_no varchar(40) NOT NULL DEFAULT '',
    source_line_id varchar(26) NOT NULL DEFAULT '',
    source_revision bigint NOT NULL DEFAULT 0 CHECK (source_revision >= 0),
    root_document_id varchar(26) NOT NULL DEFAULT '',
    root_document_no varchar(32) NOT NULL DEFAULT '',
    effective_date date NOT NULL,
    occurred_at timestamptz NOT NULL,
    actor_id varchar(26) NOT NULL,
    request_id varchar(128) NOT NULL,
    reason varchar(1000),
    customer_object_id varchar(26) NOT NULL,
    customer_version_id varchar(26) NOT NULL,
    customer_code varchar(64) NOT NULL,
    customer_name varchar(200) NOT NULL,
    container_type varchar(16) NOT NULL CHECK (container_type IN ('SOLVENT', 'RESIN')),
    quantity_delta bigint NOT NULL CHECK (quantity_delta <> 0),
    PRIMARY KEY (generation_id, id),
    UNIQUE (generation_id, entry_type, source_document_id, source_revision, container_type)
);
CREATE INDEX led_container_query_idx
    ON led_container_entries(generation_id, effective_date DESC, occurred_at DESC, id DESC);
CREATE INDEX led_container_balance_idx
    ON led_container_entries(generation_id, customer_object_id, container_type, effective_date);

-- V2 documents use their own typed detail instead of the V1 intermediary detail.
-- +goose StatementBegin
CREATE OR REPLACE FUNCTION vou_validate_document_detail() RETURNS trigger AS $$
DECLARE
    target_id varchar(26);
    detail_count integer;
    target_workflow smallint;
BEGIN
    IF TG_TABLE_NAME = 'vou_documents' THEN
        target_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.id ELSE NEW.id END;
    ELSE
        target_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.document_id ELSE NEW.document_id END;
    END IF;
    SELECT workflow_version INTO target_workflow FROM vou_documents WHERE id = target_id;
    IF NOT FOUND THEN
        RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
    END IF;
    SELECT
        (SELECT count(*) FROM vou_sale_order_details WHERE document_id = target_id) +
        (SELECT count(*) FROM vou_purchase_order_details WHERE document_id = target_id) +
        (SELECT count(*) FROM vou_intermediary_sale_order_details WHERE document_id = target_id) +
        (SELECT count(*) FROM vou_intermediary_v2_details WHERE document_id = target_id) +
        (SELECT count(*) FROM vou_receipt_details WHERE document_id = target_id) +
        (SELECT count(*) FROM vou_payment_details WHERE document_id = target_id) +
        (SELECT count(*) FROM vou_expense_reimbursement_details WHERE document_id = target_id) +
        (SELECT count(*) FROM vou_other_income_details WHERE document_id = target_id)
    INTO detail_count;
    IF detail_count <> 1 THEN
        RAISE EXCEPTION 'document % must have exactly one typed detail, found %', target_id, detail_count
            USING ERRCODE = '23514';
    END IF;
    IF target_workflow = 2 AND NOT EXISTS (
        SELECT 1 FROM vou_intermediary_v2_details WHERE document_id = target_id
    ) THEN
        RAISE EXCEPTION 'V2 intermediary document % has invalid typed detail', target_id
            USING ERRCODE = '23514';
    END IF;
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$ LANGUAGE plpgsql;
-- +goose StatementEnd
CREATE CONSTRAINT TRIGGER vou_intermediary_v2_detail_ck
    AFTER INSERT OR UPDATE OR DELETE ON vou_intermediary_v2_details
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION vou_validate_document_detail();

WITH paths(path, entity, action, description) AS (
    VALUES
    ('/vou/intermediary-sale-order/check','intermediary-sale-order','check','核对居间客户订单'),
    ('/vou/intermediary-sale-order/uncheck','intermediary-sale-order','uncheck','反核对居间客户订单'),
    ('/vou/intermediary-sale-order/short-close-request','intermediary-sale-order','short-close-request','申请居间订单短结'),
    ('/vou/intermediary-sale-order/short-close-cancel','intermediary-sale-order','short-close-cancel','取消居间订单短结申请'),
    ('/vou/intermediary-sale-order/short-close-confirm','intermediary-sale-order','short-close-confirm','确认居间订单短结'),
    ('/vou/intermediary-sale-order/short-close-unconfirm','intermediary-sale-order','short-close-unconfirm','反确认居间订单短结'),
    ('/vou/intermediary-sale-order/procurement-create','intermediary-procurement','create','创建居间采购'),
    ('/vou/intermediary-sale-order/procurement-get','intermediary-procurement','get','查看居间采购'),
    ('/vou/intermediary-sale-order/procurement-save','intermediary-procurement','save','保存居间采购'),
    ('/vou/intermediary-sale-order/procurement-delete','intermediary-procurement','delete','删除居间采购草稿'),
    ('/vou/intermediary-sale-order/procurement-check','intermediary-procurement','check','核对居间采购'),
    ('/vou/intermediary-sale-order/procurement-uncheck','intermediary-procurement','uncheck','反核对居间采购'),
    ('/vou/intermediary-sale-order/procurement-place','intermediary-procurement','place','居间采购下单'),
    ('/vou/intermediary-sale-order/procurement-unplace','intermediary-procurement','unplace','居间采购反下单'),
    ('/vou/intermediary-sale-order/receipt-create','intermediary-receipt','create','创建居间收货'),
    ('/vou/intermediary-sale-order/receipt-get','intermediary-receipt','get','查看居间收货'),
    ('/vou/intermediary-sale-order/receipt-save','intermediary-receipt','save','保存居间收货'),
    ('/vou/intermediary-sale-order/receipt-delete','intermediary-receipt','delete','删除居间收货草稿'),
    ('/vou/intermediary-sale-order/receipt-check','intermediary-receipt','check','核对居间收货'),
    ('/vou/intermediary-sale-order/receipt-uncheck','intermediary-receipt','uncheck','反核对居间收货'),
    ('/vou/intermediary-sale-order/receipt-confirm','intermediary-receipt','confirm','确认居间收货'),
    ('/vou/intermediary-sale-order/receipt-unconfirm','intermediary-receipt','unconfirm','反确认居间收货'),
    ('/vou/intermediary-sale-order/delivery-create','intermediary-delivery','create','创建居间送货'),
    ('/vou/intermediary-sale-order/delivery-get','intermediary-delivery','get','查看居间送货'),
    ('/vou/intermediary-sale-order/delivery-save','intermediary-delivery','save','保存居间送货'),
    ('/vou/intermediary-sale-order/delivery-delete','intermediary-delivery','delete','删除居间送货草稿'),
    ('/vou/intermediary-sale-order/delivery-check','intermediary-delivery','check','核对居间送货'),
    ('/vou/intermediary-sale-order/delivery-uncheck','intermediary-delivery','uncheck','反核对居间送货'),
    ('/vou/intermediary-sale-order/delivery-execute','intermediary-delivery','execute','执行居间送货'),
    ('/vou/intermediary-sale-order/delivery-unexecute','intermediary-delivery','unexecute','反执行居间送货'),
    ('/vou/intermediary-sale-order/signoff-create','intermediary-signoff','create','创建居间签收'),
    ('/vou/intermediary-sale-order/signoff-get','intermediary-signoff','get','查看居间签收'),
    ('/vou/intermediary-sale-order/signoff-save','intermediary-signoff','save','保存居间签收'),
    ('/vou/intermediary-sale-order/signoff-delete','intermediary-signoff','delete','删除居间签收草稿'),
    ('/vou/intermediary-sale-order/signoff-check','intermediary-signoff','check','核对居间签收'),
    ('/vou/intermediary-sale-order/signoff-uncheck','intermediary-signoff','uncheck','反核对居间签收'),
    ('/vou/intermediary-sale-order/signoff-confirm','intermediary-signoff','confirm','确认居间签收'),
    ('/vou/intermediary-sale-order/signoff-unconfirm','intermediary-signoff','unconfirm','反确认居间签收'),
    ('/vou/intermediary-sale-order/procurement-attachment-initiate','intermediary-procurement','attachment-initiate','发起居间采购附件上传'),
    ('/vou/intermediary-sale-order/procurement-attachment-download','intermediary-procurement','attachment-download','下载居间采购附件'),
    ('/vou/intermediary-sale-order/procurement-attachment-remove','intermediary-procurement','attachment-remove','移除居间采购附件'),
    ('/vou/intermediary-sale-order/receipt-attachment-initiate','intermediary-receipt','attachment-initiate','发起居间收货附件上传'),
    ('/vou/intermediary-sale-order/receipt-attachment-download','intermediary-receipt','attachment-download','下载居间收货附件'),
    ('/vou/intermediary-sale-order/receipt-attachment-remove','intermediary-receipt','attachment-remove','移除居间收货附件'),
    ('/vou/intermediary-sale-order/delivery-attachment-initiate','intermediary-delivery','attachment-initiate','发起居间送货附件上传'),
    ('/vou/intermediary-sale-order/delivery-attachment-download','intermediary-delivery','attachment-download','下载居间送货附件'),
    ('/vou/intermediary-sale-order/delivery-attachment-remove','intermediary-delivery','attachment-remove','移除居间送货附件'),
    ('/vou/intermediary-sale-order/signoff-attachment-initiate','intermediary-signoff','attachment-initiate','发起居间签收附件上传'),
    ('/vou/intermediary-sale-order/signoff-attachment-download','intermediary-signoff','attachment-download','下载居间签收附件'),
    ('/vou/intermediary-sale-order/signoff-attachment-remove','intermediary-signoff','attachment-remove','移除居间签收附件'),
    ('/led/container/query','container','query','查询客户空桶流水'),
    ('/led/container/balance','container','balance','查询客户空桶余额')
)
INSERT INTO app_permissions(id, path, domain, entity, action, description, status)
SELECT 'V2' || substring(md5(path), 1, 24), path,
       CASE WHEN path LIKE '/led/%' THEN 'led' ELSE 'vou' END,
       split_part(path, '/', 3), split_part(path, '/', 4), description, 'ENABLED'
FROM paths;

-- +goose Down
-- +goose StatementBegin
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM vou_documents WHERE workflow_version = 2)
       OR EXISTS (SELECT 1 FROM led_container_entries)
       OR EXISTS (SELECT 1 FROM bob_product_versions WHERE container_type <> 'NONE') THEN
        RAISE EXCEPTION 'cannot roll back intermediary V2 migration while V2 data exists';
    END IF;
END
$$;
-- +goose StatementEnd

DELETE FROM app_role_permissions WHERE permission_id IN (
    SELECT id FROM app_permissions
    WHERE path LIKE '/vou/intermediary-sale-order/%'
      AND action IN ('check','uncheck','short-close-request','short-close-cancel',
                     'short-close-confirm','short-close-unconfirm','delete',
                     'place','unplace','confirm','unconfirm','attachment-initiate',
                     'attachment-download','attachment-remove')
    UNION SELECT id FROM app_permissions WHERE path LIKE '/led/container/%'
);
DELETE FROM app_permissions WHERE id LIKE 'V2%';

DROP TABLE led_container_entries;
DROP TABLE led_opening_container;
DROP TABLE led_draft_container;
ALTER TABLE vou_audit_events
    DROP COLUMN child_status, DROP COLUMN child_no, DROP COLUMN child_id,
    DROP COLUMN stage, DROP COLUMN workflow_version,
    ALTER COLUMN event_type TYPE varchar(32),
    ADD CONSTRAINT vou_audit_events_event_type_check CHECK (event_type IN (
        'CREATED', 'SAVED', 'REVIEWED', 'UNREVIEWED', 'APPROVED', 'UNAPPROVED',
        'EXECUTED', 'UNEXECUTED', 'ATTACHMENT_INITIATED', 'ATTACHMENT_UPLOADED',
        'ATTACHMENT_REMOVED'
    )),
    ADD CONSTRAINT vou_audit_events_from_status_check CHECK (
        from_status IS NULL OR from_status IN ('DRAFT', 'REVIEWED', 'APPROVED', 'EXECUTED')
    ),
    ADD CONSTRAINT vou_audit_events_to_status_check CHECK (
        to_status IN ('DRAFT', 'REVIEWED', 'APPROVED', 'EXECUTED')
    );
DROP TABLE vou_intermediary_child_attachments;
DROP TABLE vou_intermediary_signoff_lines;
DROP TABLE vou_intermediary_signoffs;
DROP TABLE vou_intermediary_delivery_lines;
DROP TABLE vou_intermediary_deliveries;
DROP TABLE vou_intermediary_receipt_lines;
DROP TABLE vou_intermediary_receipts;
DROP TABLE vou_intermediary_procurement_lines;
DROP TABLE vou_intermediary_procurements;
DROP TABLE vou_intermediary_child_counters;
DROP TABLE vou_intermediary_children;
DROP TABLE vou_intermediary_v2_lines;
DROP TRIGGER vou_intermediary_v2_detail_ck ON vou_intermediary_v2_details;
DROP TABLE vou_intermediary_v2_details;

-- +goose StatementBegin
CREATE OR REPLACE FUNCTION vou_validate_document_detail() RETURNS trigger AS $$
DECLARE
    target_id varchar(26);
    detail_count integer;
BEGIN
    IF TG_TABLE_NAME = 'vou_documents' THEN
        target_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.id ELSE NEW.id END;
    ELSE
        target_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.document_id ELSE NEW.document_id END;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM vou_documents WHERE id = target_id) THEN
        RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
    END IF;
    SELECT
        (SELECT count(*) FROM vou_sale_order_details WHERE document_id = target_id) +
        (SELECT count(*) FROM vou_purchase_order_details WHERE document_id = target_id) +
        (SELECT count(*) FROM vou_intermediary_sale_order_details WHERE document_id = target_id) +
        (SELECT count(*) FROM vou_receipt_details WHERE document_id = target_id) +
        (SELECT count(*) FROM vou_payment_details WHERE document_id = target_id) +
        (SELECT count(*) FROM vou_expense_reimbursement_details WHERE document_id = target_id) +
        (SELECT count(*) FROM vou_other_income_details WHERE document_id = target_id)
    INTO detail_count;
    IF detail_count <> 1 THEN
        RAISE EXCEPTION 'VOU document must have exactly one typed detail row'
            USING ERRCODE = '23514';
    END IF;
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$ LANGUAGE plpgsql;
-- +goose StatementEnd

ALTER TABLE vou_documents
    DROP CONSTRAINT vou_documents_status_audit_ck,
    DROP CONSTRAINT vou_documents_status_ck,
    DROP CONSTRAINT vou_documents_workflow_version_ck,
    DROP COLUMN completed_at,
    DROP COLUMN checked_by,
    DROP COLUMN checked_at,
    DROP COLUMN workflow_version,
    ADD CONSTRAINT vou_documents_status_check
        CHECK (status IN ('DRAFT', 'REVIEWED', 'APPROVED', 'EXECUTED')),
    ADD CONSTRAINT vou_documents_status_audit_ck CHECK (
        (status = 'DRAFT' AND reviewed_at IS NULL AND reviewed_by IS NULL
            AND approved_at IS NULL AND approved_by IS NULL AND executed_at IS NULL AND executed_by IS NULL)
        OR (status = 'REVIEWED' AND reviewed_at IS NOT NULL AND reviewed_by IS NOT NULL
            AND approved_at IS NULL AND approved_by IS NULL AND executed_at IS NULL AND executed_by IS NULL)
        OR (status = 'APPROVED' AND reviewed_at IS NOT NULL AND reviewed_by IS NOT NULL
            AND approved_at IS NOT NULL AND approved_by IS NOT NULL AND executed_at IS NULL AND executed_by IS NULL)
        OR (status = 'EXECUTED' AND reviewed_at IS NOT NULL AND reviewed_by IS NOT NULL
            AND approved_at IS NOT NULL AND approved_by IS NOT NULL AND executed_at IS NOT NULL AND executed_by IS NOT NULL)
    );

DROP VIEW bob_version_views;
ALTER TABLE bob_product_versions
    DROP CONSTRAINT bob_product_container_quantity_ck,
    DROP CONSTRAINT bob_product_container_type_ck,
    DROP COLUMN quantity_per_container_micros,
    DROP COLUMN container_type;

CREATE VIEW bob_version_views AS
SELECT
    o.id AS object_id, o.entity, o.code, o.current_version_id, o.effective_version_id,
    o.revision AS object_revision, o.updated_at AS object_updated_at,
    v.id AS version_id, v.version_no, v.status, v.revision AS version_revision,
    v.created_at, v.created_by, v.updated_at, v.updated_by, v.submitted_at, v.submitted_by,
    v.reviewed_at, v.reviewed_by, v.review_comment,
    COALESCE(c.name, s.name, e.name, p.name, sv.name, w.name, vh.name, f.name,
             ca.name, d.name, po.name, sm.name) AS name,
    COALESCE(p.unit, sv.unit, '') AS unit,
    f.currency, s.supplier_type, vh.plate_number, vh.vehicle_type, vh.platform_object_id,
    COALESCE(c.customer_type, '') AS customer_type,
    COALESCE(c.short_name, s.short_name, '') AS short_name,
    COALESCE(c.category_id, s.category_id, e.category_id, p.category_id, sv.category_id,
             w.category_id, vh.category_id, f.category_id, d.category_id, po.category_id, '') AS category_id,
    COALESCE(c.tax_number, s.tax_number, '') AS tax_number,
    COALESCE(c.contact_name, s.contact_name, w.contact_name, '') AS contact_name,
    COALESCE(c.contact_phone, s.contact_phone, w.contact_phone, '') AS contact_phone,
    COALESCE(c.email, s.email, e.email, '') AS email,
    COALESCE(c.address, s.address, w.address, '') AS address,
    COALESCE(c.remark, s.remark, e.remark, p.remark, sv.remark, w.remark, vh.remark, f.remark, '') AS remark,
    COALESCE(e.department_id, '') AS department_id,
    COALESCE(e.position_id, '') AS position_id,
    COALESCE(e.phone, '') AS phone,
    CAST(COALESCE(e.hire_date::text, '') AS varchar(10)) AS hire_date,
    COALESCE(p.specification, '') AS specification,
    COALESCE(p.model, '') AS model,
    COALESCE(p.barcode, '') AS barcode,
    COALESCE(sv.description, ca.description, d.description, po.description, sm.description, '') AS description,
    COALESCE(w.manager_employee_id, '') AS manager_employee_id,
    COALESCE(vh.vin, '') AS vin,
    COALESCE(vh.engine_number, '') AS engine_number,
    CAST(COALESCE(vh.load_capacity_kg::text, '') AS varchar(32)) AS load_capacity_kg,
    COALESCE(f.account_name, '') AS account_name,
    COALESCE(f.bank_name, '') AS bank_name,
    COALESCE(f.bank_branch, '') AS bank_branch,
    COALESCE(f.account_number, '') AS account_number,
    COALESCE(ca.target_entity, '') AS target_entity,
    COALESCE(ca.parent_id, d.parent_id, '') AS parent_id,
    COALESCE(c.settlement_method_id, s.settlement_method_id, '') AS settlement_method_id,
    COALESCE(c.salesperson_employee_id, s.salesperson_employee_id, '') AS salesperson_employee_id,
    COALESCE(linked_sm.effective_version_id, '') AS settlement_method_version_id,
    COALESCE(sm.rule_type, '') AS settlement_rule_type,
    COALESCE(sm.month_offset, 0) AS settlement_month_offset,
    COALESCE(sm.day_of_month, 0) AS settlement_day_of_month,
    COALESCE(sm.day_offset, 0) AS settlement_day_offset
FROM bob_objects o
JOIN bob_versions v ON v.object_id = o.id AND v.entity = o.entity
LEFT JOIN bob_customer_versions c ON c.version_id = v.id
LEFT JOIN bob_supplier_versions s ON s.version_id = v.id
LEFT JOIN bob_employee_versions e ON e.version_id = v.id
LEFT JOIN bob_product_versions p ON p.version_id = v.id
LEFT JOIN bob_service_versions sv ON sv.version_id = v.id
LEFT JOIN bob_warehouse_versions w ON w.version_id = v.id
LEFT JOIN bob_vehicle_versions vh ON vh.version_id = v.id
LEFT JOIN bob_fund_account_versions f ON f.version_id = v.id
LEFT JOIN bob_category_versions ca ON ca.version_id = v.id
LEFT JOIN bob_department_versions d ON d.version_id = v.id
LEFT JOIN bob_position_versions po ON po.version_id = v.id
LEFT JOIN bob_objects linked_sm
    ON linked_sm.id = COALESCE(c.settlement_method_id, s.settlement_method_id)
   AND linked_sm.entity = 'settlement-method'
LEFT JOIN bob_settlement_method_versions sm ON sm.version_id = v.id;

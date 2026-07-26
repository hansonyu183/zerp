-- +goose Up
-- +goose StatementBegin
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM vou_documents WHERE workflow_version = 2)
       OR EXISTS (SELECT 1 FROM led_party_entries
                  WHERE source_entity IN ('intermediary-receipt', 'intermediary-signoff'))
       OR EXISTS (SELECT 1 FROM led_container_entries
                  WHERE source_entity = 'intermediary-signoff') THEN
        RAISE EXCEPTION 'cannot replace intermediary V2 while V2 business data exists'
            USING ERRCODE = 'P0001';
    END IF;
END
$$;
-- +goose StatementEnd

DELETE FROM app_role_permissions
WHERE permission_id IN (
    SELECT id FROM app_permissions
    WHERE path LIKE '/vou/intermediary-sale-order/%'
      AND id LIKE 'V2%'
);
DELETE FROM app_permissions
WHERE path LIKE '/vou/intermediary-sale-order/%'
  AND id LIKE 'V2%';

DROP TABLE IF EXISTS vou_intermediary_child_attachments;
DROP TABLE IF EXISTS vou_intermediary_signoff_lines;
DROP TABLE IF EXISTS vou_intermediary_signoffs;
DROP TABLE IF EXISTS vou_intermediary_delivery_lines;
DROP TABLE IF EXISTS vou_intermediary_deliveries;
DROP TABLE IF EXISTS vou_intermediary_receipt_lines;
DROP TABLE IF EXISTS vou_intermediary_receipts;
DROP TABLE IF EXISTS vou_intermediary_procurement_lines;
DROP TABLE IF EXISTS vou_intermediary_procurements;
DROP TABLE IF EXISTS vou_intermediary_child_counters;
DROP TABLE IF EXISTS vou_intermediary_children;
DROP TABLE IF EXISTS vou_intermediary_v2_lines;
DROP TABLE IF EXISTS vou_intermediary_v2_details CASCADE;

ALTER TABLE vou_documents
    DROP CONSTRAINT vou_documents_entity_check,
    DROP CONSTRAINT vou_documents_total_amount_cents_check,
    ADD COLUMN parent_document_id varchar(26),
    ADD COLUMN control_domain varchar(8) NOT NULL DEFAULT 'VOU'
        CHECK (control_domain IN ('VOU', 'WFL')),
    ADD CONSTRAINT vou_documents_parent_fk
        FOREIGN KEY (parent_document_id) REFERENCES vou_documents(id) ON DELETE RESTRICT,
    ADD CONSTRAINT vou_documents_not_self_parent_ck
        CHECK (parent_document_id IS NULL OR parent_document_id <> id),
    ADD CONSTRAINT vou_documents_entity_check CHECK (entity IN (
        'sale-order', 'purchase-order', 'intermediary-sale-order',
        'receipt', 'payment', 'expense-reimbursement', 'other-income',
        'customer-order', 'procurement-order', 'goods-receipt',
        'delivery-note', 'signoff-note'
    )),
    ADD CONSTRAINT vou_documents_total_amount_ck CHECK (
        (entity = 'signoff-note' AND total_amount_cents >= 0)
        OR (entity <> 'signoff-note' AND total_amount_cents > 0)
    );
CREATE INDEX vou_documents_parent_idx ON vou_documents(parent_document_id)
    WHERE parent_document_id IS NOT NULL;

CREATE TABLE vou_customer_order_details (
    document_id varchar(26) PRIMARY KEY REFERENCES vou_documents(id) ON DELETE CASCADE,
    entity varchar(32) NOT NULL DEFAULT 'customer-order' CHECK (entity = 'customer-order'),
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
    FOREIGN KEY (document_id, entity) REFERENCES vou_documents(id, entity) ON DELETE CASCADE
);
CREATE TABLE vou_customer_order_lines (
    id varchar(26) PRIMARY KEY,
    document_id varchar(26) NOT NULL REFERENCES vou_customer_order_details(document_id) ON DELETE CASCADE,
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
    UNIQUE(document_id, line_no),
    CHECK (
        (container_type = 'NONE' AND quantity_per_container_micros IS NULL)
        OR (container_type IN ('SOLVENT', 'RESIN') AND quantity_per_container_micros > 0)
    )
);

CREATE TABLE vou_procurement_order_details (
    document_id varchar(26) PRIMARY KEY REFERENCES vou_documents(id) ON DELETE CASCADE,
    entity varchar(32) NOT NULL DEFAULT 'procurement-order' CHECK (entity = 'procurement-order'),
    supplier_object_id varchar(26) NOT NULL,
    supplier_version_id varchar(26) NOT NULL,
    supplier_code varchar(64) NOT NULL,
    supplier_name varchar(200) NOT NULL,
    purchaser_object_id varchar(26) NOT NULL,
    purchaser_version_id varchar(26) NOT NULL,
    purchaser_code varchar(64) NOT NULL,
    purchaser_name varchar(200) NOT NULL,
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
    FOREIGN KEY (document_id, entity) REFERENCES vou_documents(id, entity) ON DELETE CASCADE
);
CREATE TABLE vou_procurement_order_lines (
    id varchar(26) PRIMARY KEY,
    document_id varchar(26) NOT NULL REFERENCES vou_procurement_order_details(document_id) ON DELETE CASCADE,
    source_customer_line_id varchar(26) NOT NULL REFERENCES vou_customer_order_lines(id) ON DELETE RESTRICT,
    quantity_micros bigint NOT NULL CHECK (quantity_micros >= 0),
    unit_price_cents bigint,
    line_amount_cents bigint,
    remark varchar(1000),
    UNIQUE(document_id, source_customer_line_id),
    CHECK (
        (quantity_micros = 0 AND unit_price_cents IS NULL AND line_amount_cents IS NULL)
        OR (quantity_micros > 0 AND unit_price_cents > 0 AND line_amount_cents > 0)
    )
);

CREATE TABLE vou_goods_receipt_details (
    document_id varchar(26) PRIMARY KEY REFERENCES vou_documents(id) ON DELETE CASCADE,
    entity varchar(32) NOT NULL DEFAULT 'goods-receipt' CHECK (entity = 'goods-receipt'),
    supplier_object_id varchar(26) NOT NULL,
    supplier_version_id varchar(26) NOT NULL,
    supplier_code varchar(64) NOT NULL,
    supplier_name varchar(200) NOT NULL,
    FOREIGN KEY (document_id, entity) REFERENCES vou_documents(id, entity) ON DELETE CASCADE
);
CREATE TABLE vou_goods_receipt_lines (
    id varchar(26) PRIMARY KEY,
    document_id varchar(26) NOT NULL REFERENCES vou_goods_receipt_details(document_id) ON DELETE CASCADE,
    source_procurement_line_id varchar(26) NOT NULL REFERENCES vou_procurement_order_lines(id) ON DELETE RESTRICT,
    source_customer_line_id varchar(26) NOT NULL REFERENCES vou_customer_order_lines(id) ON DELETE RESTRICT,
    quantity_micros bigint NOT NULL CHECK (quantity_micros >= 0),
    purchase_unit_price_cents bigint NOT NULL CHECK (purchase_unit_price_cents > 0),
    line_amount_cents bigint NOT NULL CHECK (line_amount_cents >= 0),
    remark varchar(1000),
    UNIQUE(document_id, source_procurement_line_id)
);

CREATE TABLE vou_delivery_note_details (
    document_id varchar(26) PRIMARY KEY REFERENCES vou_documents(id) ON DELETE CASCADE,
    entity varchar(32) NOT NULL DEFAULT 'delivery-note' CHECK (entity = 'delivery-note'),
    customer_object_id varchar(26) NOT NULL,
    customer_version_id varchar(26) NOT NULL,
    customer_code varchar(64) NOT NULL,
    customer_name varchar(200) NOT NULL,
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
    FOREIGN KEY (document_id, entity) REFERENCES vou_documents(id, entity) ON DELETE CASCADE
);
CREATE TABLE vou_delivery_note_lines (
    id varchar(26) PRIMARY KEY,
    document_id varchar(26) NOT NULL REFERENCES vou_delivery_note_details(document_id) ON DELETE CASCADE,
    source_customer_line_id varchar(26) NOT NULL REFERENCES vou_customer_order_lines(id) ON DELETE RESTRICT,
    quantity_micros bigint NOT NULL CHECK (quantity_micros >= 0),
    sale_unit_price_cents bigint NOT NULL CHECK (sale_unit_price_cents > 0),
    line_amount_cents bigint NOT NULL CHECK (line_amount_cents >= 0),
    remark varchar(1000),
    UNIQUE(document_id, source_customer_line_id)
);

CREATE TABLE vou_signoff_note_details (
    document_id varchar(26) PRIMARY KEY REFERENCES vou_documents(id) ON DELETE CASCADE,
    entity varchar(32) NOT NULL DEFAULT 'signoff-note' CHECK (entity = 'signoff-note'),
    customer_object_id varchar(26) NOT NULL,
    customer_version_id varchar(26) NOT NULL,
    customer_code varchar(64) NOT NULL,
    customer_name varchar(200) NOT NULL,
    returned_solvent_containers bigint NOT NULL CHECK (returned_solvent_containers >= 0),
    returned_resin_containers bigint NOT NULL CHECK (returned_resin_containers >= 0),
    container_difference_reason varchar(1000),
    FOREIGN KEY (document_id, entity) REFERENCES vou_documents(id, entity) ON DELETE CASCADE
);
CREATE TABLE vou_signoff_note_lines (
    id varchar(26) PRIMARY KEY,
    document_id varchar(26) NOT NULL REFERENCES vou_signoff_note_details(document_id) ON DELETE CASCADE,
    source_delivery_line_id varchar(26) NOT NULL REFERENCES vou_delivery_note_lines(id) ON DELETE RESTRICT,
    source_customer_line_id varchar(26) NOT NULL REFERENCES vou_customer_order_lines(id) ON DELETE RESTRICT,
    signed_qty_micros bigint NOT NULL CHECK (signed_qty_micros >= 0),
    rejected_qty_micros bigint NOT NULL CHECK (rejected_qty_micros >= 0),
    loss_qty_micros bigint NOT NULL CHECK (loss_qty_micros >= 0),
    sale_unit_price_cents bigint NOT NULL CHECK (sale_unit_price_cents > 0),
    line_amount_cents bigint NOT NULL CHECK (line_amount_cents >= 0),
    remark varchar(1000),
    UNIQUE(document_id, source_delivery_line_id)
);

CREATE TABLE wfl_process_instances (
    id varchar(26) PRIMARY KEY,
    process_type varchar(32) NOT NULL CHECK (process_type = 'INTERMEDIARY_TRADE'),
    definition_version integer NOT NULL DEFAULT 1 CHECK (definition_version = 1),
    root_document_id varchar(26) NOT NULL UNIQUE REFERENCES vou_documents(id) ON DELETE RESTRICT,
    status varchar(32) NOT NULL CHECK (status IN (
        'DRAFT', 'CHECKED', 'APPROVED', 'COMPLETED',
        'SHORT_CLOSE_REQUESTED', 'SHORT_CLOSED'
    )),
    revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
    created_at timestamptz NOT NULL DEFAULT now(),
    created_by varchar(26) NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now(),
    updated_by varchar(26) NOT NULL,
    completed_at timestamptz
);
CREATE INDEX wfl_process_query_idx
    ON wfl_process_instances(process_type, status, updated_at DESC, id DESC);

CREATE TABLE wfl_process_documents (
    process_id varchar(26) NOT NULL REFERENCES wfl_process_instances(id) ON DELETE RESTRICT,
    document_id varchar(26) NOT NULL UNIQUE REFERENCES vou_documents(id) ON DELETE CASCADE,
    stage varchar(24) NOT NULL CHECK (stage IN (
        'CUSTOMER_ORDER', 'PROCUREMENT', 'RECEIPT', 'DELIVERY', 'SIGNOFF'
    )),
    sequence_no integer NOT NULL CHECK (sequence_no > 0),
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY(process_id, stage, sequence_no)
);
CREATE UNIQUE INDEX wfl_single_procurement_uq
    ON wfl_process_documents(process_id) WHERE stage = 'PROCUREMENT';

CREATE TABLE wfl_audit_events (
    id varchar(26) PRIMARY KEY,
    process_id varchar(26) NOT NULL REFERENCES wfl_process_instances(id) ON DELETE RESTRICT,
    event_type varchar(48) NOT NULL,
    from_status varchar(32),
    to_status varchar(32) NOT NULL,
    stage varchar(24),
    document_id varchar(26),
    document_no varchar(32),
    document_status varchar(16),
    actor_id varchar(26) NOT NULL,
    occurred_at timestamptz NOT NULL DEFAULT now(),
    reason varchar(1000),
    request_id varchar(128) NOT NULL,
    summary jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX wfl_audit_history_idx
    ON wfl_audit_events(process_id, occurred_at DESC, id DESC);

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
        (SELECT count(*) FROM vou_other_income_details WHERE document_id = target_id) +
        (SELECT count(*) FROM vou_customer_order_details WHERE document_id = target_id) +
        (SELECT count(*) FROM vou_procurement_order_details WHERE document_id = target_id) +
        (SELECT count(*) FROM vou_goods_receipt_details WHERE document_id = target_id) +
        (SELECT count(*) FROM vou_delivery_note_details WHERE document_id = target_id) +
        (SELECT count(*) FROM vou_signoff_note_details WHERE document_id = target_id)
    INTO detail_count;
    IF detail_count <> 1 THEN
        RAISE EXCEPTION 'document % must have exactly one typed detail, found %', target_id, detail_count
            USING ERRCODE = '23514';
    END IF;
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$ LANGUAGE plpgsql;
-- +goose StatementEnd

CREATE CONSTRAINT TRIGGER vou_customer_order_detail_ck
    AFTER INSERT OR UPDATE OR DELETE ON vou_customer_order_details
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION vou_validate_document_detail();
CREATE CONSTRAINT TRIGGER vou_procurement_order_detail_ck
    AFTER INSERT OR UPDATE OR DELETE ON vou_procurement_order_details
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION vou_validate_document_detail();
CREATE CONSTRAINT TRIGGER vou_goods_receipt_detail_ck
    AFTER INSERT OR UPDATE OR DELETE ON vou_goods_receipt_details
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION vou_validate_document_detail();
CREATE CONSTRAINT TRIGGER vou_delivery_note_detail_ck
    AFTER INSERT OR UPDATE OR DELETE ON vou_delivery_note_details
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION vou_validate_document_detail();
CREATE CONSTRAINT TRIGGER vou_signoff_note_detail_ck
    AFTER INSERT OR UPDATE OR DELETE ON vou_signoff_note_details
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION vou_validate_document_detail();

-- +goose StatementBegin
CREATE FUNCTION vou_validate_wfl_parent() RETURNS trigger AS $$
DECLARE parent_entity varchar(32);
BEGIN
    IF NEW.control_domain = 'VOU' THEN
        IF NEW.parent_document_id IS NOT NULL THEN
            RAISE EXCEPTION 'direct VOU document cannot have parent';
        END IF;
        RETURN NEW;
    END IF;
    IF NEW.entity = 'customer-order' AND NEW.parent_document_id IS NULL THEN RETURN NEW; END IF;
    IF NEW.parent_document_id IS NULL THEN RAISE EXCEPTION 'WFL child requires parent'; END IF;
    SELECT entity INTO parent_entity FROM vou_documents WHERE id = NEW.parent_document_id;
    IF (NEW.entity = 'procurement-order' AND parent_entity = 'customer-order')
       OR (NEW.entity = 'goods-receipt' AND parent_entity = 'procurement-order')
       OR (NEW.entity = 'delivery-note' AND parent_entity = 'customer-order')
       OR (NEW.entity = 'signoff-note' AND parent_entity = 'delivery-note') THEN
        RETURN NEW;
    END IF;
    RAISE EXCEPTION 'invalid WFL document parent';
END;
$$ LANGUAGE plpgsql;
-- +goose StatementEnd
CREATE CONSTRAINT TRIGGER vou_wfl_parent_ck
    AFTER INSERT OR UPDATE OF entity,parent_document_id,control_domain ON vou_documents
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION vou_validate_wfl_parent();

WITH actions(action, description) AS (
    VALUES
    ('query','查询居间流程'),('get','查看居间流程'),('create','创建居间流程'),
    ('save','保存客户订单'),('check','核对客户订单'),('uncheck','反核对客户订单'),
    ('approve','批准客户订单'),('unapprove','反批准客户订单'),
    ('audit-history','查看流程审计'),
    ('short-close-request','申请短结'),('short-close-cancel','取消短结申请'),
    ('short-close-confirm','确认短结'),('short-close-unconfirm','反确认短结'),
    ('procurement-create','创建采购单'),('procurement-get','查看采购单'),
    ('procurement-save','保存采购单'),('procurement-delete','删除采购草稿'),
    ('procurement-check','核对采购单'),('procurement-uncheck','反核对采购单'),
    ('procurement-place','采购下单'),('procurement-unplace','采购反下单'),
    ('receipt-create','创建收货单'),('receipt-get','查看收货单'),
    ('receipt-save','保存收货单'),('receipt-delete','删除收货草稿'),
    ('receipt-check','核对收货单'),('receipt-uncheck','反核对收货单'),
    ('receipt-confirm','确认收货'),('receipt-unconfirm','反确认收货'),
    ('delivery-create','创建送货单'),('delivery-get','查看送货单'),
    ('delivery-save','保存送货单'),('delivery-delete','删除送货草稿'),
    ('delivery-check','核对送货单'),('delivery-uncheck','反核对送货单'),
    ('delivery-execute','执行送货'),('delivery-unexecute','反执行送货'),
    ('signoff-create','创建签收单'),('signoff-get','查看签收单'),
    ('signoff-save','保存签收单'),('signoff-delete','删除签收草稿'),
    ('signoff-check','核对签收单'),('signoff-uncheck','反核对签收单'),
    ('signoff-confirm','确认签收'),('signoff-unconfirm','反确认签收'),
    ('procurement-attachment-initiate','发起采购附件上传'),
    ('procurement-attachment-download','下载采购附件'),
    ('procurement-attachment-remove','移除采购附件'),
    ('receipt-attachment-initiate','发起收货附件上传'),
    ('receipt-attachment-download','下载收货附件'),
    ('receipt-attachment-remove','移除收货附件'),
    ('delivery-attachment-initiate','发起送货附件上传'),
    ('delivery-attachment-download','下载送货附件'),
    ('delivery-attachment-remove','移除送货附件'),
    ('signoff-attachment-initiate','发起签收附件上传'),
    ('signoff-attachment-download','下载签收附件'),
    ('signoff-attachment-remove','移除签收附件')
)
INSERT INTO app_permissions(id,path,domain,entity,action,description,status)
SELECT 'WF' || substring(md5(action),1,24),
       '/wfl/intermediary-trade/' || action,
       'wfl','intermediary-trade',action,description,'ENABLED'
FROM actions;

-- +goose Down
-- +goose StatementBegin
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM wfl_process_instances)
       OR EXISTS (SELECT 1 FROM vou_documents WHERE control_domain = 'WFL') THEN
        RAISE EXCEPTION 'cannot roll back WFL migration while WFL data exists';
    END IF;
END
$$;
-- +goose StatementEnd

DELETE FROM app_role_permissions
WHERE permission_id IN (SELECT id FROM app_permissions WHERE domain = 'wfl');
DELETE FROM app_permissions WHERE domain = 'wfl';

DROP TRIGGER vou_wfl_parent_ck ON vou_documents;
DROP FUNCTION vou_validate_wfl_parent();
DROP TABLE wfl_audit_events;
DROP TABLE wfl_process_documents;
DROP TABLE wfl_process_instances;
DROP TABLE vou_signoff_note_lines;
DROP TRIGGER vou_signoff_note_detail_ck ON vou_signoff_note_details;
DROP TABLE vou_signoff_note_details;
DROP TABLE vou_delivery_note_lines;
DROP TRIGGER vou_delivery_note_detail_ck ON vou_delivery_note_details;
DROP TABLE vou_delivery_note_details;
DROP TABLE vou_goods_receipt_lines;
DROP TRIGGER vou_goods_receipt_detail_ck ON vou_goods_receipt_details;
DROP TABLE vou_goods_receipt_details;
DROP TABLE vou_procurement_order_lines;
DROP TRIGGER vou_procurement_order_detail_ck ON vou_procurement_order_details;
DROP TABLE vou_procurement_order_details;
DROP TABLE vou_customer_order_lines;
DROP TRIGGER vou_customer_order_detail_ck ON vou_customer_order_details;
DROP TABLE vou_customer_order_details;

DROP INDEX vou_documents_parent_idx;
ALTER TABLE vou_documents
    DROP CONSTRAINT vou_documents_total_amount_ck,
    DROP CONSTRAINT vou_documents_entity_check,
    DROP CONSTRAINT vou_documents_not_self_parent_ck,
    DROP CONSTRAINT vou_documents_parent_fk,
    DROP COLUMN control_domain,
    DROP COLUMN parent_document_id,
    ADD CONSTRAINT vou_documents_entity_check CHECK (entity IN (
        'sale-order', 'purchase-order', 'intermediary-sale-order',
        'receipt', 'payment', 'expense-reimbursement', 'other-income'
    )),
    ADD CONSTRAINT vou_documents_total_amount_cents_check CHECK (total_amount_cents > 0);

-- The old V2 schema is intentionally not reconstructed automatically. Version 17
-- can only be rolled back on an empty WFL deployment; reapplying 17 remains safe.

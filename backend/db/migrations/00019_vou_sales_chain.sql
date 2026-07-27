-- +goose Up
-- +goose StatementBegin
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM vou_documents WHERE entity = 'sale-order') THEN
        RAISE EXCEPTION 'sales-chain migration requires sale-order data to be cleared and rebuilt'
            USING ERRCODE = 'P0001';
    END IF;
END
$$;
-- +goose StatementEnd

ALTER TABLE vou_documents
    DROP CONSTRAINT vou_documents_status_ck,
    DROP CONSTRAINT vou_documents_status_audit_ck,
    DROP CONSTRAINT vou_documents_entity_check,
    DROP CONSTRAINT vou_documents_total_amount_ck;

UPDATE vou_documents SET status = 'CHECKED'
WHERE control_domain = 'VOU' AND status = 'REVIEWED';
UPDATE vou_documents SET status = 'FINALIZED'
WHERE control_domain = 'VOU' AND status = 'EXECUTED';

ALTER TABLE vou_documents
    ADD CONSTRAINT vou_documents_status_ck CHECK (
        (control_domain = 'VOU' AND status IN ('DRAFT', 'CHECKED', 'APPROVED', 'FINALIZED'))
        OR (control_domain = 'WFL' AND workflow_version = 1
            AND status IN ('DRAFT', 'REVIEWED', 'APPROVED', 'EXECUTED'))
        OR (workflow_version = 2 AND entity = 'intermediary-sale-order'
            AND status IN ('DRAFT', 'CHECKED', 'APPROVED', 'COMPLETED',
                           'SHORT_CLOSE_REQUESTED', 'SHORT_CLOSED'))
    ),
    ADD CONSTRAINT vou_documents_status_audit_ck CHECK (
        (control_domain = 'VOU' AND (
            (status = 'DRAFT' AND reviewed_at IS NULL AND reviewed_by IS NULL
                AND approved_at IS NULL AND approved_by IS NULL AND executed_at IS NULL AND executed_by IS NULL)
            OR (status = 'CHECKED' AND reviewed_at IS NOT NULL AND reviewed_by IS NOT NULL
                AND approved_at IS NULL AND approved_by IS NULL AND executed_at IS NULL AND executed_by IS NULL)
            OR (status = 'APPROVED' AND reviewed_at IS NOT NULL AND reviewed_by IS NOT NULL
                AND approved_at IS NOT NULL AND approved_by IS NOT NULL AND executed_at IS NULL AND executed_by IS NULL)
            OR (status = 'FINALIZED' AND reviewed_at IS NOT NULL AND reviewed_by IS NOT NULL
                AND approved_at IS NOT NULL AND approved_by IS NOT NULL AND executed_at IS NOT NULL AND executed_by IS NOT NULL)
        ))
        OR (control_domain = 'WFL' AND workflow_version = 1 AND (
            (status = 'DRAFT' AND reviewed_at IS NULL AND reviewed_by IS NULL
                AND approved_at IS NULL AND approved_by IS NULL AND executed_at IS NULL AND executed_by IS NULL)
            OR (status = 'REVIEWED' AND reviewed_at IS NOT NULL AND reviewed_by IS NOT NULL
                AND approved_at IS NULL AND approved_by IS NULL AND executed_at IS NULL AND executed_by IS NULL)
            OR (status = 'APPROVED' AND reviewed_at IS NOT NULL AND reviewed_by IS NOT NULL
                AND approved_at IS NOT NULL AND approved_by IS NOT NULL AND executed_at IS NULL AND executed_by IS NULL)
            OR (status = 'EXECUTED' AND reviewed_at IS NOT NULL AND reviewed_by IS NOT NULL
                AND approved_at IS NOT NULL AND approved_by IS NOT NULL AND executed_at IS NOT NULL AND executed_by IS NOT NULL)
        ))
        OR (workflow_version = 2 AND reviewed_at IS NULL AND reviewed_by IS NULL
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
    ),
    ADD CONSTRAINT vou_documents_entity_check CHECK (entity IN (
        'sale-order', 'sale-outbound', 'sale-delivery', 'sale-signoff',
        'purchase-order', 'intermediary-sale-order',
        'receipt', 'payment', 'expense-reimbursement', 'other-income',
        'customer-order', 'procurement-order', 'goods-receipt',
        'delivery-note', 'signoff-note'
    )),
    ADD CONSTRAINT vou_documents_total_amount_ck CHECK (
        (entity IN ('signoff-note', 'sale-signoff') AND total_amount_cents >= 0)
        OR (entity NOT IN ('signoff-note', 'sale-signoff') AND total_amount_cents > 0)
    );

UPDATE vou_audit_events SET event_type = 'CHECKED'
WHERE event_type = 'REVIEWED' AND document_id IN (
    SELECT id FROM vou_documents WHERE control_domain = 'VOU'
);
UPDATE vou_audit_events SET event_type = 'UNCHECKED'
WHERE event_type = 'UNREVIEWED' AND document_id IN (
    SELECT id FROM vou_documents WHERE control_domain = 'VOU'
);
UPDATE vou_audit_events SET event_type = 'FINALIZED'
WHERE event_type = 'EXECUTED' AND document_id IN (
    SELECT id FROM vou_documents WHERE control_domain = 'VOU'
);
UPDATE vou_audit_events SET event_type = 'UNFINALIZED'
WHERE event_type = 'UNEXECUTED' AND document_id IN (
    SELECT id FROM vou_documents WHERE control_domain = 'VOU'
);
UPDATE vou_audit_events SET from_status = 'CHECKED'
WHERE from_status = 'REVIEWED' AND document_id IN (
    SELECT id FROM vou_documents WHERE control_domain = 'VOU'
);
UPDATE vou_audit_events SET from_status = 'FINALIZED'
WHERE from_status = 'EXECUTED' AND document_id IN (
    SELECT id FROM vou_documents WHERE control_domain = 'VOU'
);
UPDATE vou_audit_events SET to_status = 'CHECKED'
WHERE to_status = 'REVIEWED' AND document_id IN (
    SELECT id FROM vou_documents WHERE control_domain = 'VOU'
);
UPDATE vou_audit_events SET to_status = 'FINALIZED'
WHERE to_status = 'EXECUTED' AND document_id IN (
    SELECT id FROM vou_documents WHERE control_domain = 'VOU'
);

ALTER TABLE vou_sale_order_details
    DROP CONSTRAINT vou_sale_order_execution_ck,
    DROP CONSTRAINT vou_sale_order_warehouse_ck,
    DROP COLUMN outbound_date,
    DROP COLUMN signoff_date,
    DROP COLUMN platform_object_id,
    DROP COLUMN platform_version_id,
    DROP COLUMN platform_code,
    DROP COLUMN platform_name,
    DROP COLUMN vehicle_object_id,
    DROP COLUMN vehicle_version_id,
    DROP COLUMN vehicle_code,
    DROP COLUMN vehicle_name,
    DROP COLUMN vehicle_plate_number,
    DROP COLUMN difference_reason,
    DROP COLUMN warehouse_object_id,
    DROP COLUMN warehouse_version_id,
    DROP COLUMN warehouse_code,
    DROP COLUMN warehouse_name,
    ADD COLUMN fulfillment_status varchar(32) NOT NULL DEFAULT 'OPEN'
        CHECK (fulfillment_status IN ('OPEN', 'FULFILLED', 'SHORT_CLOSE_REQUESTED', 'SHORT_CLOSED')),
    ADD COLUMN short_close_requested_by varchar(26),
    ADD COLUMN short_close_reason varchar(1000),
    ADD CONSTRAINT vou_sale_order_short_close_ck CHECK (
        (fulfillment_status IN ('OPEN', 'FULFILLED')
            AND short_close_requested_by IS NULL AND short_close_reason IS NULL)
        OR (fulfillment_status IN ('SHORT_CLOSE_REQUESTED', 'SHORT_CLOSED')
            AND short_close_requested_by IS NOT NULL AND short_close_reason IS NOT NULL)
    );

CREATE TABLE vou_sale_outbound_details (
    document_id varchar(26) PRIMARY KEY,
    entity varchar(32) NOT NULL DEFAULT 'sale-outbound' CHECK (entity = 'sale-outbound'),
    source_order_id varchar(26) NOT NULL REFERENCES vou_sale_order_details(document_id) ON DELETE RESTRICT,
    customer_object_id varchar(26) NOT NULL,
    customer_version_id varchar(26) NOT NULL,
    customer_code varchar(64) NOT NULL,
    customer_name varchar(200) NOT NULL,
    warehouse_object_id varchar(26) NOT NULL,
    warehouse_version_id varchar(26) NOT NULL,
    warehouse_code varchar(64) NOT NULL,
    warehouse_name varchar(200) NOT NULL,
    FOREIGN KEY (document_id, entity) REFERENCES vou_documents(id, entity) ON DELETE RESTRICT
);

CREATE TABLE vou_sale_outbound_lines (
    id varchar(26) PRIMARY KEY,
    document_id varchar(26) NOT NULL REFERENCES vou_sale_outbound_details(document_id) ON DELETE RESTRICT,
    source_order_line_id varchar(26) NOT NULL REFERENCES vou_product_lines(id) ON DELETE RESTRICT,
    line_no integer NOT NULL CHECK (line_no > 0),
    product_object_id varchar(26) NOT NULL,
    product_version_id varchar(26) NOT NULL,
    product_code varchar(64) NOT NULL,
    product_name varchar(200) NOT NULL,
    product_unit varchar(32) NOT NULL,
    quantity_micros bigint NOT NULL CHECK (quantity_micros > 0),
    unit_price_cents bigint NOT NULL CHECK (unit_price_cents > 0),
    line_amount_cents bigint NOT NULL CHECK (line_amount_cents > 0),
    remark varchar(1000),
    UNIQUE (document_id, source_order_line_id),
    UNIQUE (document_id, line_no)
);
CREATE INDEX vou_sale_outbound_lines_source_idx
    ON vou_sale_outbound_lines(source_order_line_id);

CREATE TABLE vou_sale_delivery_details (
    document_id varchar(26) PRIMARY KEY,
    entity varchar(32) NOT NULL DEFAULT 'sale-delivery' CHECK (entity = 'sale-delivery'),
    source_outbound_id varchar(26) NOT NULL UNIQUE
        REFERENCES vou_sale_outbound_details(document_id) ON DELETE RESTRICT,
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
    FOREIGN KEY (document_id, entity) REFERENCES vou_documents(id, entity) ON DELETE RESTRICT
);

CREATE TABLE vou_sale_signoff_details (
    document_id varchar(26) PRIMARY KEY,
    entity varchar(32) NOT NULL DEFAULT 'sale-signoff' CHECK (entity = 'sale-signoff'),
    source_delivery_id varchar(26) NOT NULL UNIQUE
        REFERENCES vou_sale_delivery_details(document_id) ON DELETE RESTRICT,
    source_outbound_id varchar(26) NOT NULL
        REFERENCES vou_sale_outbound_details(document_id) ON DELETE RESTRICT,
    source_order_id varchar(26) NOT NULL
        REFERENCES vou_sale_order_details(document_id) ON DELETE RESTRICT,
    customer_object_id varchar(26) NOT NULL,
    customer_version_id varchar(26) NOT NULL,
    customer_code varchar(64) NOT NULL,
    customer_name varchar(200) NOT NULL,
    warehouse_object_id varchar(26) NOT NULL,
    warehouse_version_id varchar(26) NOT NULL,
    warehouse_code varchar(64) NOT NULL,
    warehouse_name varchar(200) NOT NULL,
    FOREIGN KEY (document_id, entity) REFERENCES vou_documents(id, entity) ON DELETE RESTRICT
);

CREATE TABLE vou_sale_signoff_lines (
    id varchar(26) PRIMARY KEY,
    document_id varchar(26) NOT NULL REFERENCES vou_sale_signoff_details(document_id) ON DELETE RESTRICT,
    source_outbound_line_id varchar(26) NOT NULL REFERENCES vou_sale_outbound_lines(id) ON DELETE RESTRICT,
    source_order_line_id varchar(26) NOT NULL REFERENCES vou_product_lines(id) ON DELETE RESTRICT,
    line_no integer NOT NULL CHECK (line_no > 0),
    product_object_id varchar(26) NOT NULL,
    product_version_id varchar(26) NOT NULL,
    product_code varchar(64) NOT NULL,
    product_name varchar(200) NOT NULL,
    product_unit varchar(32) NOT NULL,
    signed_qty_micros bigint NOT NULL CHECK (signed_qty_micros >= 0),
    rejected_qty_micros bigint NOT NULL CHECK (rejected_qty_micros >= 0),
    loss_qty_micros bigint NOT NULL CHECK (loss_qty_micros >= 0),
    unit_price_cents bigint NOT NULL CHECK (unit_price_cents > 0),
    line_amount_cents bigint NOT NULL CHECK (line_amount_cents >= 0),
    remark varchar(1000),
    UNIQUE (document_id, source_outbound_line_id),
    UNIQUE (document_id, line_no)
);
CREATE INDEX vou_sale_signoff_lines_order_idx
    ON vou_sale_signoff_lines(source_order_line_id);

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
        (SELECT count(*) FROM vou_sale_outbound_details WHERE document_id = target_id) +
        (SELECT count(*) FROM vou_sale_delivery_details WHERE document_id = target_id) +
        (SELECT count(*) FROM vou_sale_signoff_details WHERE document_id = target_id) +
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
        RAISE EXCEPTION 'VOU document must have exactly one typed detail row' USING ERRCODE = '23514';
    END IF;
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$ LANGUAGE plpgsql;
-- +goose StatementEnd

CREATE CONSTRAINT TRIGGER vou_sale_outbound_detail_ck
    AFTER INSERT OR UPDATE OR DELETE ON vou_sale_outbound_details
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION vou_validate_document_detail();
CREATE CONSTRAINT TRIGGER vou_sale_delivery_detail_ck
    AFTER INSERT OR UPDATE OR DELETE ON vou_sale_delivery_details
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION vou_validate_document_detail();
CREATE CONSTRAINT TRIGGER vou_sale_signoff_detail_ck
    AFTER INSERT OR UPDATE OR DELETE ON vou_sale_signoff_details
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION vou_validate_document_detail();

-- +goose StatementBegin
CREATE OR REPLACE FUNCTION vou_validate_wfl_parent() RETURNS trigger AS $$
DECLARE parent_entity varchar(32);
BEGIN
    IF NEW.control_domain = 'VOU' THEN
        IF NEW.entity = 'sale-order' AND NEW.parent_document_id IS NULL THEN RETURN NEW; END IF;
        IF NEW.entity NOT IN ('sale-outbound', 'sale-delivery', 'sale-signoff')
           AND NEW.parent_document_id IS NULL THEN RETURN NEW; END IF;
        IF NEW.parent_document_id IS NULL THEN RAISE EXCEPTION 'sales-chain child requires parent'; END IF;
        SELECT entity INTO parent_entity FROM vou_documents WHERE id = NEW.parent_document_id;
        IF (NEW.entity = 'sale-outbound' AND parent_entity = 'sale-order')
           OR (NEW.entity = 'sale-delivery' AND parent_entity = 'sale-outbound')
           OR (NEW.entity = 'sale-signoff' AND parent_entity = 'sale-delivery') THEN
            RETURN NEW;
        END IF;
        RAISE EXCEPTION 'invalid VOU sales-chain parent';
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

UPDATE app_permissions
SET path = replace(path, '/review', '/check'), action = 'check',
    description = replace(description, '审核', '核对')
WHERE domain = 'vou' AND action = 'review';
UPDATE app_permissions
SET path = replace(path, '/unreview', '/uncheck'), action = 'uncheck',
    description = replace(description, '反审核', '反核对')
WHERE domain = 'vou' AND action = 'unreview';
UPDATE app_permissions
SET path = replace(path, '/execute', '/finalize'), action = 'finalize',
    description = replace(description, '执行', '最终处理')
WHERE domain = 'vou' AND action = 'execute';
UPDATE app_permissions
SET path = replace(path, '/unexecute', '/unfinalize'), action = 'unfinalize',
    description = replace(description, '反执行', '撤销最终处理')
WHERE domain = 'vou' AND action = 'unexecute';

WITH actions(action, description, ordinal) AS (
    VALUES
        ('query', '查询', 1), ('get', '查看', 2), ('create', '创建', 3), ('save', '保存草稿', 4),
        ('check', '核对', 5), ('uncheck', '反核对', 6), ('approve', '批准', 7),
        ('unapprove', '反批准', 8), ('finalize', '最终处理', 9),
        ('unfinalize', '撤销最终处理', 10), ('audit-history', '查看审计记录', 11),
        ('attachment-initiate', '发起附件上传', 12),
        ('attachment-download', '下载附件', 13), ('attachment-remove', '移除附件', 14),
        ('delete', '删除草稿', 15)
), entities(entity, description, ordinal) AS (
    VALUES
        ('sale-outbound', '销售出库单', 7),
        ('sale-delivery', '销售配送单', 8),
        ('sale-signoff', '销售签收单', 9)
), numbered AS (
    SELECT e.entity, e.description AS entity_description, a.action,
           a.description AS action_description, 99 + (e.ordinal - 7) * 15 + a.ordinal AS seq
    FROM entities e CROSS JOIN actions a
)
INSERT INTO app_permissions (id, path, domain, entity, action, description, status)
SELECT '01JVOU' || lpad(seq::text, 20, '0'), '/vou/' || entity || '/' || action,
       'vou', entity, action, action_description || entity_description, 'ENABLED'
FROM numbered;

WITH actions(action, description, seq) AS (
    VALUES
        ('short-close-request', '申请短结销售订单', 145),
        ('short-close-cancel', '取消短结申请', 146),
        ('short-close-confirm', '确认短结销售订单', 147),
        ('short-close-unconfirm', '反确认短结销售订单', 148)
)
INSERT INTO app_permissions (id, path, domain, entity, action, description, status)
SELECT '01JVOU' || lpad(seq::text, 20, '0'), '/vou/sale-order/' || action,
       'vou', 'sale-order', action, description, 'ENABLED'
FROM actions;

INSERT INTO app_role_permissions (role_id, permission_id, created_by)
SELECT r.id, p.id, r.updated_by
FROM app_roles r
CROSS JOIN app_permissions p
WHERE r.code = 'superadmin' AND p.domain = 'vou'
ON CONFLICT DO NOTHING;

-- +goose Down
DELETE FROM app_role_permissions
WHERE permission_id IN (
    SELECT id FROM app_permissions
    WHERE entity IN ('sale-outbound', 'sale-delivery', 'sale-signoff')
       OR (entity = 'sale-order' AND action LIKE 'short-close-%')
);
DELETE FROM app_permissions
WHERE entity IN ('sale-outbound', 'sale-delivery', 'sale-signoff')
   OR (entity = 'sale-order' AND action LIKE 'short-close-%');

UPDATE app_permissions
SET path = replace(path, '/check', '/review'), action = 'review',
    description = replace(description, '核对', '审核')
WHERE domain = 'vou' AND action = 'check';
UPDATE app_permissions
SET path = replace(path, '/uncheck', '/unreview'), action = 'unreview',
    description = replace(description, '反核对', '反审核')
WHERE domain = 'vou' AND action = 'uncheck';
UPDATE app_permissions
SET path = replace(path, '/finalize', '/execute'), action = 'execute',
    description = replace(description, '最终处理', '执行')
WHERE domain = 'vou' AND action = 'finalize';
UPDATE app_permissions
SET path = replace(path, '/unfinalize', '/unexecute'), action = 'unexecute',
    description = replace(description, '撤销最终处理', '反执行')
WHERE domain = 'vou' AND action = 'unfinalize';

DROP TRIGGER vou_sale_signoff_detail_ck ON vou_sale_signoff_details;
DROP TRIGGER vou_sale_delivery_detail_ck ON vou_sale_delivery_details;
DROP TRIGGER vou_sale_outbound_detail_ck ON vou_sale_outbound_details;

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
        RAISE EXCEPTION 'VOU document must have exactly one typed detail row' USING ERRCODE = '23514';
    END IF;
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$ LANGUAGE plpgsql;
-- +goose StatementEnd

DROP TABLE vou_sale_signoff_lines;
DROP TABLE vou_sale_signoff_details;
DROP TABLE vou_sale_delivery_details;
DROP TABLE vou_sale_outbound_lines;
DROP TABLE vou_sale_outbound_details;

ALTER TABLE vou_sale_order_details
    DROP CONSTRAINT vou_sale_order_short_close_ck,
    DROP COLUMN short_close_reason,
    DROP COLUMN short_close_requested_by,
    DROP COLUMN fulfillment_status,
    ADD COLUMN warehouse_object_id varchar(26),
    ADD COLUMN warehouse_version_id varchar(26),
    ADD COLUMN warehouse_code varchar(64),
    ADD COLUMN warehouse_name varchar(200),
    ADD COLUMN outbound_date date,
    ADD COLUMN signoff_date date,
    ADD COLUMN platform_object_id varchar(26),
    ADD COLUMN platform_version_id varchar(26),
    ADD COLUMN platform_code varchar(64),
    ADD COLUMN platform_name varchar(200),
    ADD COLUMN vehicle_object_id varchar(26),
    ADD COLUMN vehicle_version_id varchar(26),
    ADD COLUMN vehicle_code varchar(64),
    ADD COLUMN vehicle_name varchar(200),
    ADD COLUMN vehicle_plate_number varchar(32),
    ADD COLUMN difference_reason varchar(1000),
    ADD CONSTRAINT vou_sale_order_warehouse_ck CHECK (
        (warehouse_object_id IS NULL AND warehouse_version_id IS NULL
            AND warehouse_code IS NULL AND warehouse_name IS NULL)
        OR (warehouse_object_id IS NOT NULL AND warehouse_version_id IS NOT NULL
            AND warehouse_code IS NOT NULL AND warehouse_name IS NOT NULL)
    ),
    ADD CONSTRAINT vou_sale_order_execution_ck CHECK (
        (outbound_date IS NULL AND signoff_date IS NULL
            AND platform_object_id IS NULL AND platform_version_id IS NULL
            AND platform_code IS NULL AND platform_name IS NULL
            AND vehicle_object_id IS NULL AND vehicle_version_id IS NULL
            AND vehicle_code IS NULL AND vehicle_name IS NULL AND vehicle_plate_number IS NULL
            AND difference_reason IS NULL)
        OR (outbound_date IS NOT NULL AND signoff_date IS NOT NULL
            AND platform_object_id IS NOT NULL AND platform_version_id IS NOT NULL
            AND platform_code IS NOT NULL AND platform_name IS NOT NULL
            AND vehicle_object_id IS NOT NULL AND vehicle_version_id IS NOT NULL
            AND vehicle_code IS NOT NULL AND vehicle_name IS NOT NULL AND vehicle_plate_number IS NOT NULL
            AND outbound_date <= signoff_date)
    );

ALTER TABLE vou_documents
    DROP CONSTRAINT vou_documents_status_ck,
    DROP CONSTRAINT vou_documents_status_audit_ck,
    DROP CONSTRAINT vou_documents_entity_check,
    DROP CONSTRAINT vou_documents_total_amount_ck;

UPDATE vou_documents SET status = 'REVIEWED'
WHERE control_domain = 'VOU' AND status = 'CHECKED';
UPDATE vou_documents SET status = 'EXECUTED'
WHERE control_domain = 'VOU' AND status = 'FINALIZED';

ALTER TABLE vou_documents
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
        OR (workflow_version = 2 AND reviewed_at IS NULL AND reviewed_by IS NULL
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
    ),
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

UPDATE vou_audit_events SET event_type = 'REVIEWED'
WHERE event_type = 'CHECKED' AND document_id IN (
    SELECT id FROM vou_documents WHERE control_domain = 'VOU'
);
UPDATE vou_audit_events SET event_type = 'UNREVIEWED'
WHERE event_type = 'UNCHECKED' AND document_id IN (
    SELECT id FROM vou_documents WHERE control_domain = 'VOU'
);
UPDATE vou_audit_events SET event_type = 'EXECUTED'
WHERE event_type = 'FINALIZED' AND document_id IN (
    SELECT id FROM vou_documents WHERE control_domain = 'VOU'
);
UPDATE vou_audit_events SET event_type = 'UNEXECUTED'
WHERE event_type = 'UNFINALIZED' AND document_id IN (
    SELECT id FROM vou_documents WHERE control_domain = 'VOU'
);
UPDATE vou_audit_events SET from_status = 'REVIEWED'
WHERE from_status = 'CHECKED' AND document_id IN (
    SELECT id FROM vou_documents WHERE control_domain = 'VOU'
);
UPDATE vou_audit_events SET from_status = 'EXECUTED'
WHERE from_status = 'FINALIZED' AND document_id IN (
    SELECT id FROM vou_documents WHERE control_domain = 'VOU'
);
UPDATE vou_audit_events SET to_status = 'REVIEWED'
WHERE to_status = 'CHECKED' AND document_id IN (
    SELECT id FROM vou_documents WHERE control_domain = 'VOU'
);
UPDATE vou_audit_events SET to_status = 'EXECUTED'
WHERE to_status = 'FINALIZED' AND document_id IN (
    SELECT id FROM vou_documents WHERE control_domain = 'VOU'
);
-- +goose StatementBegin
CREATE OR REPLACE FUNCTION vou_validate_wfl_parent() RETURNS trigger AS $$
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

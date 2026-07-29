-- +goose Up
ALTER TABLE vou_documents
    DROP CONSTRAINT vou_documents_entity_check,
    ADD CONSTRAINT vou_documents_entity_check CHECK (entity IN (
        'sale-order', 'sale-outbound', 'sale-delivery', 'sale-signoff', 'sale-return',
        'purchase-order', 'purchase-inbound',
        'receipt', 'payment', 'expense-reimbursement', 'other-income',
        'customer-order', 'procurement-order', 'goods-receipt',
        'delivery-note', 'signoff-note'
    ));

CREATE TABLE vou_sale_return_details (
    document_id varchar(26) PRIMARY KEY,
    entity varchar(32) NOT NULL DEFAULT 'sale-return' CHECK (entity = 'sale-return'),
    source_order_id varchar(26) NOT NULL
        REFERENCES vou_sale_order_details(document_id) ON DELETE RESTRICT,
    source_signoff_id varchar(26)
        REFERENCES vou_sale_signoff_details(document_id) ON DELETE RESTRICT,
    return_kind varchar(16) NOT NULL CHECK (return_kind IN ('REFUSAL', 'AFTER_SALE')),
    return_reason varchar(1000) NOT NULL CHECK (length(btrim(return_reason)) > 0),
    customer_object_id varchar(26) NOT NULL,
    customer_version_id varchar(26) NOT NULL,
    customer_code varchar(64) NOT NULL,
    customer_name varchar(200) NOT NULL,
    warehouse_object_id varchar(26) NOT NULL,
    warehouse_version_id varchar(26) NOT NULL,
    warehouse_code varchar(64) NOT NULL,
    warehouse_name varchar(200) NOT NULL,
    FOREIGN KEY (document_id, entity)
        REFERENCES vou_documents(id, entity) ON DELETE RESTRICT,
    CONSTRAINT vou_sale_return_source_kind_ck CHECK (
        (return_kind='REFUSAL' AND source_signoff_id IS NOT NULL)
        OR (return_kind='AFTER_SALE' AND source_signoff_id IS NULL)
    )
);
CREATE UNIQUE INDEX vou_sale_return_refusal_uq
    ON vou_sale_return_details(source_signoff_id)
    WHERE return_kind = 'REFUSAL';

CREATE TABLE vou_sale_return_lines (
    id varchar(26) PRIMARY KEY,
    document_id varchar(26) NOT NULL
        REFERENCES vou_sale_return_details(document_id) ON DELETE RESTRICT,
    source_signoff_line_id varchar(26) NOT NULL
        REFERENCES vou_sale_signoff_lines(id) ON DELETE RESTRICT,
    source_signoff_id varchar(26) NOT NULL
        REFERENCES vou_sale_signoff_details(document_id) ON DELETE RESTRICT,
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
    UNIQUE (document_id, source_signoff_line_id),
    UNIQUE (document_id, line_no)
);
CREATE INDEX vou_sale_return_lines_source_idx
    ON vou_sale_return_lines(source_signoff_line_id);

CREATE CONSTRAINT TRIGGER vou_sale_return_detail_ck
    AFTER INSERT OR UPDATE OR DELETE ON vou_sale_return_details
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION vou_validate_document_detail();

ALTER TABLE wfl_process_documents
    DROP CONSTRAINT wfl_process_documents_stage_check,
    ADD CONSTRAINT wfl_process_documents_stage_check CHECK (stage IN (
        'CUSTOMER_ORDER', 'PROCUREMENT', 'RECEIPT', 'DELIVERY', 'SIGNOFF',
        'SALE_ORDER', 'OUTBOUND', 'RETURN', 'PURCHASE_ORDER', 'PURCHASE_INBOUND'
    ));

ALTER TABLE wfl_process_instances
    DROP CONSTRAINT wfl_process_instances_status_check,
    ADD CONSTRAINT wfl_process_instances_status_check CHECK (status IN (
        'DRAFT', 'CHECKED', 'APPROVED', 'COMPLETED', 'RETURNING',
        'SHORT_CLOSE_REQUESTED', 'SHORT_CLOSED'
    ));

-- +goose StatementBegin
CREATE OR REPLACE FUNCTION vou_validate_document_detail() RETURNS trigger AS $$
DECLARE target_id varchar(26); detail_count integer;
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
        (SELECT count(*) FROM vou_sale_return_details WHERE document_id = target_id) +
        (SELECT count(*) FROM vou_purchase_order_details WHERE document_id = target_id) +
        (SELECT count(*) FROM vou_purchase_inbound_details WHERE document_id = target_id) +
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

WITH actions(action, description) AS (
    VALUES
        ('query','查询销售退货'), ('get','查看销售退货'), ('create','创建销售退货'),
        ('save','保存销售退货'), ('delete','删除销售退货'), ('check','核对销售退货'),
        ('uncheck','反核对销售退货'), ('approve','批准销售退货'),
        ('unapprove','反批准销售退货'), ('finalize','完成销售退货'),
        ('unfinalize','撤销销售退货'), ('audit-history','查看销售退货审计'),
        ('attachment-initiate','上传销售退货附件'),
        ('attachment-download','下载销售退货附件'),
        ('attachment-remove','删除销售退货附件')
)
INSERT INTO app_permissions(id,path,domain,entity,action,description,status)
SELECT 'SR' || substring(md5('/vou/sale-return/' || action), 1, 24),
       '/vou/sale-return/' || action, 'vou', 'sale-return', action, description, 'ENABLED'
FROM actions ON CONFLICT (path) DO NOTHING;

INSERT INTO app_role_permissions(role_id, permission_id, created_by)
SELECT r.id, p.id, r.updated_by
FROM app_roles r CROSS JOIN app_permissions p
WHERE r.code = 'superadmin' AND p.domain = 'vou' AND p.entity = 'sale-return'
ON CONFLICT DO NOTHING;

WITH mapping(source_action, target_action) AS (
    VALUES ('query','query'),('get','get'),('save','save'),('delete','delete'),
        ('check','check'),('uncheck','uncheck'),('approve','approve'),
        ('unapprove','unapprove'),('finalize','finalize'),('unfinalize','unfinalize'),
        ('audit-history','audit-history'),('attachment-initiate','attachment-initiate'),
        ('attachment-download','attachment-download'),('attachment-remove','attachment-remove')
)
INSERT INTO app_role_permissions(role_id, permission_id, created_by)
SELECT DISTINCT rp.role_id, target.id, rp.created_by
FROM mapping m
JOIN app_permissions source ON source.path='/vou/sale-signoff/' || m.source_action
JOIN app_role_permissions rp ON rp.permission_id=source.id
JOIN app_permissions target ON target.path='/vou/sale-return/' || m.target_action
ON CONFLICT DO NOTHING;

INSERT INTO app_role_permissions(role_id, permission_id, created_by)
SELECT DISTINCT rp.role_id, target.id, rp.created_by
FROM app_permissions source
JOIN app_role_permissions rp ON rp.permission_id=source.id
JOIN app_permissions workflow ON workflow.path='/wfl/sales-fulfillment/get'
JOIN app_role_permissions wrp ON wrp.role_id=rp.role_id AND wrp.permission_id=workflow.id
JOIN app_permissions target ON target.path='/vou/sale-return/create'
WHERE source.path='/vou/sale-signoff/save'
ON CONFLICT DO NOTHING;

-- +goose Down
DELETE FROM app_role_permissions WHERE permission_id IN (
    SELECT id FROM app_permissions WHERE domain='vou' AND entity='sale-return'
);
DELETE FROM app_permissions WHERE domain='vou' AND entity='sale-return';
ALTER TABLE wfl_process_instances
    DROP CONSTRAINT wfl_process_instances_status_check,
    ADD CONSTRAINT wfl_process_instances_status_check CHECK (status IN (
        'DRAFT', 'CHECKED', 'APPROVED', 'COMPLETED',
        'SHORT_CLOSE_REQUESTED', 'SHORT_CLOSED'
    ));
ALTER TABLE wfl_process_documents
    DROP CONSTRAINT wfl_process_documents_stage_check,
    ADD CONSTRAINT wfl_process_documents_stage_check CHECK (stage IN (
        'CUSTOMER_ORDER', 'PROCUREMENT', 'RECEIPT', 'DELIVERY', 'SIGNOFF',
        'SALE_ORDER', 'OUTBOUND', 'PURCHASE_ORDER', 'PURCHASE_INBOUND'
    ));
DROP TRIGGER vou_sale_return_detail_ck ON vou_sale_return_details;
DROP TABLE vou_sale_return_lines;
DROP TABLE vou_sale_return_details;
-- +goose StatementBegin
CREATE OR REPLACE FUNCTION vou_validate_document_detail() RETURNS trigger AS $$
DECLARE target_id varchar(26); detail_count integer;
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
        (SELECT count(*) FROM vou_purchase_inbound_details WHERE document_id = target_id) +
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
    DROP CONSTRAINT vou_documents_entity_check,
    ADD CONSTRAINT vou_documents_entity_check CHECK (entity IN (
        'sale-order', 'sale-outbound', 'sale-delivery', 'sale-signoff',
        'purchase-order', 'purchase-inbound',
        'receipt', 'payment', 'expense-reimbursement', 'other-income',
        'customer-order', 'procurement-order', 'goods-receipt',
        'delivery-note', 'signoff-note'
    ));

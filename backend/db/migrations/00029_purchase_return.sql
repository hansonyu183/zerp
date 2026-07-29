-- +goose Up
ALTER TABLE vou_documents
    DROP CONSTRAINT vou_documents_entity_check,
    ADD CONSTRAINT vou_documents_entity_check CHECK (entity IN (
        'sale-order', 'sale-outbound', 'sale-delivery', 'sale-signoff', 'sale-return',
        'purchase-order', 'purchase-inbound', 'purchase-return',
        'receipt', 'payment', 'expense-reimbursement', 'other-income',
        'customer-order', 'procurement-order', 'goods-receipt',
        'delivery-note', 'signoff-note'
    ));

CREATE TABLE vou_purchase_return_details (
    document_id varchar(26) PRIMARY KEY,
    entity varchar(32) NOT NULL DEFAULT 'purchase-return' CHECK (entity = 'purchase-return'),
    source_order_id varchar(26) NOT NULL
        REFERENCES vou_purchase_order_details(document_id) ON DELETE RESTRICT,
    return_reason varchar(1000) NOT NULL CHECK (length(btrim(return_reason)) > 0),
    supplier_object_id varchar(26) NOT NULL,
    supplier_version_id varchar(26) NOT NULL,
    supplier_code varchar(64) NOT NULL,
    supplier_name varchar(200) NOT NULL,
    warehouse_object_id varchar(26) NOT NULL,
    warehouse_version_id varchar(26) NOT NULL,
    warehouse_code varchar(64) NOT NULL,
    warehouse_name varchar(200) NOT NULL,
    FOREIGN KEY (document_id, entity)
        REFERENCES vou_documents(id, entity) ON DELETE RESTRICT
);

CREATE TABLE vou_purchase_return_lines (
    id varchar(26) PRIMARY KEY,
    document_id varchar(26) NOT NULL
        REFERENCES vou_purchase_return_details(document_id) ON DELETE RESTRICT,
    source_inbound_line_id varchar(26) NOT NULL
        REFERENCES vou_purchase_inbound_lines(id) ON DELETE RESTRICT,
    source_inbound_id varchar(26) NOT NULL
        REFERENCES vou_purchase_inbound_details(document_id) ON DELETE RESTRICT,
    source_order_line_id varchar(26) NOT NULL
        REFERENCES vou_product_lines(id) ON DELETE RESTRICT,
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
    UNIQUE (document_id, source_inbound_line_id),
    UNIQUE (document_id, line_no)
);
CREATE INDEX vou_purchase_return_lines_source_idx
    ON vou_purchase_return_lines(source_inbound_line_id);
CREATE INDEX vou_purchase_return_lines_order_idx
    ON vou_purchase_return_lines(source_order_line_id);

CREATE CONSTRAINT TRIGGER vou_purchase_return_detail_ck
    AFTER INSERT OR UPDATE OR DELETE ON vou_purchase_return_details
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION vou_validate_document_detail();

ALTER TABLE wfl_process_documents
    DROP CONSTRAINT wfl_process_documents_stage_check,
    ADD CONSTRAINT wfl_process_documents_stage_check CHECK (stage IN (
        'CUSTOMER_ORDER', 'PROCUREMENT', 'RECEIPT', 'DELIVERY', 'SIGNOFF',
        'SALE_ORDER', 'OUTBOUND', 'RETURN', 'PURCHASE_ORDER', 'PURCHASE_INBOUND',
        'PURCHASE_RETURN'
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
        (SELECT count(*) FROM vou_purchase_return_details WHERE document_id = target_id) +
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
        ('query','查询采购退货'), ('get','查看采购退货'), ('create','创建采购退货'),
        ('save','保存采购退货'), ('delete','删除采购退货'), ('check','核对采购退货'),
        ('uncheck','反核对采购退货'), ('approve','批准采购退货'),
        ('unapprove','反批准采购退货'), ('finalize','完成采购退货'),
        ('unfinalize','撤销采购退货'), ('audit-history','查看采购退货审计'),
        ('attachment-initiate','上传采购退货附件'),
        ('attachment-download','下载采购退货附件'),
        ('attachment-remove','删除采购退货附件')
)
INSERT INTO app_permissions(id,path,domain,entity,action,description,status)
SELECT 'PR' || substring(md5('/vou/purchase-return/' || action), 1, 24),
       '/vou/purchase-return/' || action, 'vou', 'purchase-return', action, description, 'ENABLED'
FROM actions ON CONFLICT (path) DO NOTHING;

INSERT INTO app_role_permissions(role_id, permission_id, created_by)
SELECT r.id, p.id, r.updated_by
FROM app_roles r CROSS JOIN app_permissions p
WHERE r.code = 'superadmin' AND p.domain = 'vou' AND p.entity = 'purchase-return'
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
JOIN app_permissions source ON source.path='/vou/purchase-inbound/' || m.source_action
JOIN app_role_permissions rp ON rp.permission_id=source.id
JOIN app_permissions target ON target.path='/vou/purchase-return/' || m.target_action
ON CONFLICT DO NOTHING;

INSERT INTO app_role_permissions(role_id, permission_id, created_by)
SELECT DISTINCT rp.role_id, target.id, rp.created_by
FROM app_permissions source
JOIN app_role_permissions rp ON rp.permission_id=source.id
JOIN app_permissions workflow ON workflow.path='/wfl/purchase-fulfillment/get'
JOIN app_role_permissions wrp ON wrp.role_id=rp.role_id AND wrp.permission_id=workflow.id
JOIN app_permissions target ON target.path='/vou/purchase-return/create'
WHERE source.path='/vou/purchase-inbound/save'
ON CONFLICT DO NOTHING;

-- +goose Down
DELETE FROM app_role_permissions WHERE permission_id IN (
    SELECT id FROM app_permissions WHERE domain='vou' AND entity='purchase-return'
);
DELETE FROM app_permissions WHERE domain='vou' AND entity='purchase-return';
ALTER TABLE wfl_process_documents
    DROP CONSTRAINT wfl_process_documents_stage_check,
    ADD CONSTRAINT wfl_process_documents_stage_check CHECK (stage IN (
        'CUSTOMER_ORDER', 'PROCUREMENT', 'RECEIPT', 'DELIVERY', 'SIGNOFF',
        'SALE_ORDER', 'OUTBOUND', 'RETURN', 'PURCHASE_ORDER', 'PURCHASE_INBOUND'
    ));
DROP TRIGGER vou_purchase_return_detail_ck ON vou_purchase_return_details;
DROP TABLE vou_purchase_return_lines;
DROP TABLE vou_purchase_return_details;
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
ALTER TABLE vou_documents
    DROP CONSTRAINT vou_documents_entity_check,
    ADD CONSTRAINT vou_documents_entity_check CHECK (entity IN (
        'sale-order', 'sale-outbound', 'sale-delivery', 'sale-signoff', 'sale-return',
        'purchase-order', 'purchase-inbound',
        'receipt', 'payment', 'expense-reimbursement', 'other-income',
        'customer-order', 'procurement-order', 'goods-receipt',
        'delivery-note', 'signoff-note'
    ));

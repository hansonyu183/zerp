-- +goose Up

ALTER TABLE vou_documents DROP CONSTRAINT vou_documents_entity_check;
ALTER TABLE vou_documents
    ADD CONSTRAINT vou_documents_entity_check CHECK (entity IN (
        'sale-pricing', 'sale-order', 'sale-outbound', 'sale-delivery', 'sale-signoff', 'sale-return',
        'purchase-inquiry', 'purchase-order', 'purchase-inbound', 'purchase-return',
        'order-production', 'self-production', 'inventory-count',
        'receipt', 'payment',
        'customer-receipt', 'supplier-receipt', 'other-receipt',
        'customer-payment', 'supplier-payment', 'other-payment',
        'expense-reimbursement', 'expense-payment', 'other-income',
        'customer-order', 'procurement-order', 'goods-receipt', 'delivery-note', 'signoff-note'
    ));
ALTER TABLE vou_documents
    DROP CONSTRAINT vou_documents_total_amount_ck,
    ADD CONSTRAINT vou_documents_total_amount_ck CHECK (
        (entity IN ('sale-pricing', 'purchase-inquiry', 'sale-order', 'sale-outbound',
                    'sale-delivery', 'sale-signoff', 'sale-return', 'purchase-order',
                    'purchase-inbound', 'purchase-return', 'order-production', 'self-production',
                    'inventory-count')
            AND total_amount_cents >= 0)
        OR
        (entity NOT IN ('sale-pricing', 'purchase-inquiry', 'sale-order', 'sale-outbound',
                        'sale-delivery', 'sale-signoff', 'sale-return', 'purchase-order',
                        'purchase-inbound', 'purchase-return', 'order-production', 'self-production',
                        'inventory-count')
            AND total_amount_cents > 0)
    );

CREATE TABLE vou_inventory_count_details (
    document_id varchar(26) PRIMARY KEY,
    entity varchar(32) NOT NULL DEFAULT 'inventory-count' CHECK (entity = 'inventory-count'),
    warehouse_object_id varchar(26) NOT NULL,
    warehouse_version_id varchar(26) NOT NULL,
    warehouse_code varchar(64) NOT NULL,
    warehouse_name varchar(200) NOT NULL,
    FOREIGN KEY (document_id, entity) REFERENCES vou_documents(id, entity) ON DELETE RESTRICT
);

CREATE TABLE vou_inventory_count_lines (
    id varchar(26) PRIMARY KEY,
    document_id varchar(26) NOT NULL REFERENCES vou_inventory_count_details(document_id) ON DELETE RESTRICT,
    line_no integer NOT NULL CHECK (line_no >= 1 AND line_no <= 200),
    product_object_id varchar(26) NOT NULL,
    product_version_id varchar(26) NOT NULL,
    product_code varchar(64) NOT NULL,
    product_name varchar(200) NOT NULL,
    product_unit varchar(32) NOT NULL,
    actual_quantity_micros bigint NOT NULL CHECK (actual_quantity_micros >= 0),
    book_quantity_micros bigint,
    difference_quantity_micros bigint,
    remark varchar(1000),
    CHECK (
        (book_quantity_micros IS NULL AND difference_quantity_micros IS NULL) OR
        (book_quantity_micros IS NOT NULL AND book_quantity_micros >= 0 AND
         difference_quantity_micros = actual_quantity_micros - book_quantity_micros)
    ),
    UNIQUE (document_id, line_no),
    UNIQUE (document_id, product_object_id)
);

CREATE CONSTRAINT TRIGGER vou_inventory_count_detail_ck
    AFTER INSERT OR UPDATE OR DELETE ON vou_inventory_count_details
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION vou_validate_document_detail();

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
        (SELECT count(*) FROM vou_sale_pricing_details WHERE document_id = target_id) +
        (SELECT count(*) FROM vou_purchase_inquiry_details WHERE document_id = target_id) +
        (SELECT count(*) FROM vou_sale_order_details WHERE document_id = target_id) +
        (SELECT count(*) FROM vou_sale_outbound_details WHERE document_id = target_id) +
        (SELECT count(*) FROM vou_sale_delivery_details WHERE document_id = target_id) +
        (SELECT count(*) FROM vou_sale_signoff_details WHERE document_id = target_id) +
        (SELECT count(*) FROM vou_sale_return_details WHERE document_id = target_id) +
        (SELECT count(*) FROM vou_purchase_order_details WHERE document_id = target_id) +
        (SELECT count(*) FROM vou_purchase_inbound_details WHERE document_id = target_id) +
        (SELECT count(*) FROM vou_purchase_return_details WHERE document_id = target_id) +
        (SELECT count(*) FROM vou_production_details WHERE document_id = target_id) +
        (SELECT count(*) FROM vou_inventory_count_details WHERE document_id = target_id) +
        (SELECT count(*) FROM vou_receipt_details WHERE document_id = target_id) +
        (SELECT count(*) FROM vou_payment_details WHERE document_id = target_id) +
        (SELECT count(*) FROM vou_expense_reimbursement_details WHERE document_id = target_id) +
        (SELECT count(*) FROM vou_expense_payment_details WHERE document_id = target_id) +
        (SELECT count(*) FROM vou_other_income_details WHERE document_id = target_id)
    INTO detail_count;
    IF detail_count <> 1 THEN
        RAISE EXCEPTION 'VOU document must have exactly one typed detail row' USING ERRCODE = '23514';
    END IF;
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$ LANGUAGE plpgsql;
-- +goose StatementEnd

INSERT INTO app_permissions(id, path, domain, entity, action, description, status)
SELECT 'IC' || substring(md5('/vou/inventory-count/' || action), 1, 24),
       '/vou/inventory-count/' || action,
       'vou', 'inventory-count', action,
       CASE action
           WHEN 'query' THEN '查询库存盘点单'
           WHEN 'get' THEN '查看库存盘点单'
           WHEN 'book-balance' THEN '读取库存盘点账面数量'
           WHEN 'create' THEN '创建库存盘点单'
           WHEN 'save' THEN '保存库存盘点单'
           WHEN 'delete' THEN '删除库存盘点单'
           WHEN 'check' THEN '核对库存盘点单'
           WHEN 'uncheck' THEN '反核对库存盘点单'
           WHEN 'approve' THEN '批准库存盘点单'
           WHEN 'unapprove' THEN '反批准库存盘点单'
           WHEN 'finalize' THEN '完成库存盘点单'
           WHEN 'unfinalize' THEN '撤销完成库存盘点单'
           WHEN 'audit-history' THEN '查看库存盘点单审计'
           WHEN 'attachment-initiate' THEN '发起库存盘点单附件上传'
           WHEN 'attachment-download' THEN '下载库存盘点单附件'
           WHEN 'attachment-remove' THEN '移除库存盘点单附件'
       END,
       'ENABLED'
FROM unnest(ARRAY[
    'query','get','book-balance','create','save','delete','check','uncheck','approve','unapprove',
    'finalize','unfinalize','audit-history','attachment-initiate','attachment-download','attachment-remove'
]) AS action;

-- +goose Down

DELETE FROM app_role_permissions
WHERE permission_id IN (SELECT id FROM app_permissions WHERE domain='vou' AND entity='inventory-count');
DELETE FROM app_permissions WHERE domain='vou' AND entity='inventory-count';
DROP TABLE vou_inventory_count_lines;
DROP TRIGGER vou_inventory_count_detail_ck ON vou_inventory_count_details;
DROP TABLE vou_inventory_count_details;
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
        (SELECT count(*) FROM vou_sale_pricing_details WHERE document_id = target_id) +
        (SELECT count(*) FROM vou_purchase_inquiry_details WHERE document_id = target_id) +
        (SELECT count(*) FROM vou_sale_order_details WHERE document_id = target_id) +
        (SELECT count(*) FROM vou_sale_outbound_details WHERE document_id = target_id) +
        (SELECT count(*) FROM vou_sale_delivery_details WHERE document_id = target_id) +
        (SELECT count(*) FROM vou_sale_signoff_details WHERE document_id = target_id) +
        (SELECT count(*) FROM vou_sale_return_details WHERE document_id = target_id) +
        (SELECT count(*) FROM vou_purchase_order_details WHERE document_id = target_id) +
        (SELECT count(*) FROM vou_purchase_inbound_details WHERE document_id = target_id) +
        (SELECT count(*) FROM vou_purchase_return_details WHERE document_id = target_id) +
        (SELECT count(*) FROM vou_production_details WHERE document_id = target_id) +
        (SELECT count(*) FROM vou_receipt_details WHERE document_id = target_id) +
        (SELECT count(*) FROM vou_payment_details WHERE document_id = target_id) +
        (SELECT count(*) FROM vou_expense_reimbursement_details WHERE document_id = target_id) +
        (SELECT count(*) FROM vou_expense_payment_details WHERE document_id = target_id) +
        (SELECT count(*) FROM vou_other_income_details WHERE document_id = target_id)
    INTO detail_count;
    IF detail_count <> 1 THEN
        RAISE EXCEPTION 'VOU document must have exactly one typed detail row' USING ERRCODE = '23514';
    END IF;
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$ LANGUAGE plpgsql;
-- +goose StatementEnd
ALTER TABLE vou_documents
    DROP CONSTRAINT vou_documents_total_amount_ck,
    ADD CONSTRAINT vou_documents_total_amount_ck CHECK (
        (entity IN ('sale-pricing', 'purchase-inquiry', 'sale-order', 'sale-outbound',
                    'sale-delivery', 'sale-signoff', 'sale-return', 'purchase-order',
                    'purchase-inbound', 'purchase-return', 'order-production', 'self-production')
            AND total_amount_cents >= 0)
        OR
        (entity NOT IN ('sale-pricing', 'purchase-inquiry', 'sale-order', 'sale-outbound',
                        'sale-delivery', 'sale-signoff', 'sale-return', 'purchase-order',
                        'purchase-inbound', 'purchase-return', 'order-production', 'self-production')
            AND total_amount_cents > 0)
    );
ALTER TABLE vou_documents DROP CONSTRAINT vou_documents_entity_check;
ALTER TABLE vou_documents
    ADD CONSTRAINT vou_documents_entity_check CHECK (entity IN (
        'sale-pricing', 'sale-order', 'sale-outbound', 'sale-delivery', 'sale-signoff', 'sale-return',
        'purchase-inquiry', 'purchase-order', 'purchase-inbound', 'purchase-return',
        'order-production', 'self-production',
        'receipt', 'payment',
        'customer-receipt', 'supplier-receipt', 'other-receipt',
        'customer-payment', 'supplier-payment', 'other-payment',
        'expense-reimbursement', 'expense-payment', 'other-income',
        'customer-order', 'procurement-order', 'goods-receipt', 'delivery-note', 'signoff-note'
    ));

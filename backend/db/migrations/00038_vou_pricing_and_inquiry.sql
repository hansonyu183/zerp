-- +goose Up

ALTER TABLE vou_documents
    DROP CONSTRAINT vou_documents_entity_check,
    ADD CONSTRAINT vou_documents_entity_check CHECK (entity IN (
        'sale-pricing', 'sale-order', 'sale-outbound', 'sale-delivery', 'sale-signoff', 'sale-return',
        'purchase-inquiry', 'purchase-order', 'purchase-inbound', 'purchase-return',
        'order-production', 'self-production',
        'receipt', 'payment', 'expense-reimbursement', 'other-income',
        'customer-order', 'procurement-order', 'goods-receipt',
        'delivery-note', 'signoff-note'
    )),
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

CREATE TABLE vou_sale_pricing_details (
    document_id varchar(26) PRIMARY KEY,
    entity varchar(32) NOT NULL DEFAULT 'sale-pricing' CHECK (entity = 'sale-pricing'),
    FOREIGN KEY (document_id, entity) REFERENCES vou_documents(id, entity) ON DELETE RESTRICT
);

CREATE TABLE vou_purchase_inquiry_details (
    document_id varchar(26) PRIMARY KEY,
    entity varchar(32) NOT NULL DEFAULT 'purchase-inquiry' CHECK (entity = 'purchase-inquiry'),
    supplier_object_id varchar(26) NOT NULL,
    supplier_version_id varchar(26) NOT NULL,
    supplier_code varchar(64) NOT NULL,
    supplier_name varchar(200) NOT NULL,
    FOREIGN KEY (document_id, entity) REFERENCES vou_documents(id, entity) ON DELETE RESTRICT
);
CREATE INDEX vou_purchase_inquiry_supplier_idx
    ON vou_purchase_inquiry_details(supplier_object_id, document_id);

CREATE TABLE vou_price_lines (
    id varchar(26) PRIMARY KEY,
    document_id varchar(26) NOT NULL,
    document_entity varchar(32) NOT NULL CHECK (document_entity IN ('sale-pricing', 'purchase-inquiry')),
    line_no integer NOT NULL CHECK (line_no > 0),
    product_object_id varchar(26) NOT NULL,
    product_version_id varchar(26) NOT NULL,
    product_code varchar(64) NOT NULL,
    product_name varchar(200) NOT NULL,
    product_unit varchar(32) NOT NULL,
    product_kind varchar(32) NOT NULL,
    pricing_quantity_per_inventory_unit_micros bigint NOT NULL CHECK (pricing_quantity_per_inventory_unit_micros > 0),
    unit_price_cents bigint NOT NULL CHECK (unit_price_cents >= 0),
    remark varchar(1000),
    FOREIGN KEY (document_id, document_entity) REFERENCES vou_documents(id, entity) ON DELETE RESTRICT,
    UNIQUE (document_id, line_no),
    UNIQUE (document_id, product_object_id)
);
CREATE INDEX vou_price_lines_lookup_idx
    ON vou_price_lines(document_entity, product_object_id, document_id);

ALTER TABLE vou_product_lines
    ADD COLUMN reference_unit_price_cents bigint NOT NULL DEFAULT 0
        CHECK (reference_unit_price_cents >= 0),
    ADD COLUMN reference_document_id varchar(26),
    ADD COLUMN reference_document_no varchar(32),
    ADD COLUMN reference_business_date date,
    ADD COLUMN reference_line_id varchar(26),
    ADD CONSTRAINT vou_product_lines_reference_ck CHECK (
        (reference_document_id IS NULL AND reference_document_no IS NULL
            AND reference_business_date IS NULL AND reference_line_id IS NULL
            AND reference_unit_price_cents = 0)
        OR
        (reference_document_id IS NOT NULL AND reference_document_no IS NOT NULL
            AND reference_business_date IS NOT NULL AND reference_line_id IS NOT NULL)
    ),
    DROP CONSTRAINT vou_product_lines_unit_price_cents_check,
    DROP CONSTRAINT vou_product_lines_line_amount_cents_check,
    DROP CONSTRAINT vou_product_lines_base_price_ck,
    ADD CONSTRAINT vou_product_lines_unit_price_ck CHECK (unit_price_cents >= 0),
    ADD CONSTRAINT vou_product_lines_line_amount_ck CHECK (line_amount_cents >= 0),
    ADD CONSTRAINT vou_product_lines_base_price_ck CHECK (base_unit_price_cents >= 0);

ALTER TABLE vou_sale_outbound_lines
    DROP CONSTRAINT vou_sale_outbound_lines_unit_price_cents_check,
    DROP CONSTRAINT vou_sale_outbound_lines_line_amount_cents_check,
    ADD CONSTRAINT vou_sale_outbound_lines_unit_price_ck CHECK (unit_price_cents >= 0),
    ADD CONSTRAINT vou_sale_outbound_lines_line_amount_ck CHECK (line_amount_cents >= 0);
ALTER TABLE vou_sale_signoff_lines
    DROP CONSTRAINT vou_sale_signoff_lines_unit_price_cents_check,
    ADD CONSTRAINT vou_sale_signoff_lines_unit_price_ck CHECK (unit_price_cents >= 0);
ALTER TABLE vou_sale_return_lines
    DROP CONSTRAINT vou_sale_return_lines_unit_price_cents_check,
    DROP CONSTRAINT vou_sale_return_lines_line_amount_cents_check,
    ADD CONSTRAINT vou_sale_return_lines_unit_price_ck CHECK (unit_price_cents >= 0),
    ADD CONSTRAINT vou_sale_return_lines_line_amount_ck CHECK (line_amount_cents >= 0);
ALTER TABLE vou_purchase_inbound_lines
    DROP CONSTRAINT vou_purchase_inbound_lines_unit_price_cents_check,
    DROP CONSTRAINT vou_purchase_inbound_lines_line_amount_cents_check,
    ADD CONSTRAINT vou_purchase_inbound_lines_unit_price_ck CHECK (unit_price_cents >= 0),
    ADD CONSTRAINT vou_purchase_inbound_lines_line_amount_ck CHECK (line_amount_cents >= 0);
ALTER TABLE vou_purchase_return_lines
    DROP CONSTRAINT vou_purchase_return_lines_unit_price_cents_check,
    DROP CONSTRAINT vou_purchase_return_lines_line_amount_cents_check,
    ADD CONSTRAINT vou_purchase_return_lines_unit_price_ck CHECK (unit_price_cents >= 0),
    ADD CONSTRAINT vou_purchase_return_lines_line_amount_ck CHECK (line_amount_cents >= 0);

ALTER TABLE led_draft_inventory
    DROP CONSTRAINT led_draft_inventory_pricing_ck,
    ADD CONSTRAINT led_draft_inventory_pricing_ck CHECK (
        (currency IS NULL AND unit_price_cents IS NULL AND amount_cents IS NULL)
        OR (currency ~ '^[A-Z]{3}$' AND unit_price_cents >= 0 AND amount_cents >= 0)
    );
ALTER TABLE led_opening_inventory
    DROP CONSTRAINT led_opening_inventory_pricing_ck,
    ADD CONSTRAINT led_opening_inventory_pricing_ck CHECK (
        (currency IS NULL AND unit_price_cents IS NULL AND amount_cents IS NULL)
        OR (currency ~ '^[A-Z]{3}$' AND unit_price_cents >= 0 AND amount_cents >= 0)
    );
ALTER TABLE led_inventory_entries
    DROP CONSTRAINT led_inventory_entries_pricing_ck,
    ADD CONSTRAINT led_inventory_entries_pricing_ck CHECK (
        (currency IS NULL AND unit_price_cents IS NULL AND amount_cents IS NULL)
        OR (currency ~ '^[A-Z]{3}$' AND unit_price_cents >= 0 AND amount_cents >= 0)
    );

CREATE CONSTRAINT TRIGGER vou_sale_pricing_detail_ck
    AFTER INSERT OR UPDATE OR DELETE ON vou_sale_pricing_details
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION vou_validate_document_detail();
CREATE CONSTRAINT TRIGGER vou_purchase_inquiry_detail_ck
    AFTER INSERT OR UPDATE OR DELETE ON vou_purchase_inquiry_details
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
        (SELECT count(*) FROM vou_receipt_details WHERE document_id = target_id) +
        (SELECT count(*) FROM vou_payment_details WHERE document_id = target_id) +
        (SELECT count(*) FROM vou_expense_reimbursement_details WHERE document_id = target_id) +
        (SELECT count(*) FROM vou_other_income_details WHERE document_id = target_id)
    INTO detail_count;
    IF detail_count <> 1 THEN
        RAISE EXCEPTION 'VOU document must have exactly one typed detail row' USING ERRCODE = '23514';
    END IF;
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$ LANGUAGE plpgsql;
-- +goose StatementEnd

WITH entities(entity, title, source_entity) AS (
    VALUES ('sale-pricing', '销售定价', 'sale-order'),
           ('purchase-inquiry', '采购询价', 'purchase-order')
), actions(action, title) AS (
    VALUES ('query', '查询'), ('get', '查看'), ('create', '创建'), ('save', '保存'),
           ('delete', '删除'), ('check', '核对'), ('uncheck', '反核对'),
           ('approve', '批准'), ('unapprove', '反批准'), ('finalize', '完成'),
           ('unfinalize', '撤销完成'), ('audit-history', '查看审计'),
           ('attachment-initiate', '上传附件'), ('attachment-download', '下载附件'),
           ('attachment-remove', '删除附件')
)
INSERT INTO app_permissions(id,path,domain,entity,action,description,status)
SELECT 'PR' || substring(md5('/vou/' || entity || '/' || action),1,24),
       '/vou/' || entity || '/' || action, 'vou', entity, action,
       actions.title || entities.title, 'ENABLED'
FROM entities CROSS JOIN actions ON CONFLICT(path) DO NOTHING;

WITH mappings(target_entity, source_entity) AS (
    VALUES ('sale-pricing', 'sale-order'), ('purchase-inquiry', 'purchase-order')
)
INSERT INTO app_role_permissions(role_id,permission_id,created_by)
SELECT DISTINCT rp.role_id,target.id,rp.created_by
FROM mappings
JOIN app_permissions source ON source.entity=mappings.source_entity AND source.domain='vou'
JOIN app_role_permissions rp ON rp.permission_id=source.id
JOIN app_permissions target ON target.entity=mappings.target_entity
    AND target.domain='vou' AND target.action=source.action
ON CONFLICT DO NOTHING;

INSERT INTO app_permissions(id,path,domain,entity,action,description,status) VALUES
('PR' || substring(md5('/vou/sale-order/price-reference'),1,24),
 '/vou/sale-order/price-reference','vou','sale-order','price-reference','解析销售参考价','ENABLED'),
('PR' || substring(md5('/vou/purchase-order/price-reference'),1,24),
 '/vou/purchase-order/price-reference','vou','purchase-order','price-reference','解析采购参考价','ENABLED')
ON CONFLICT(path) DO NOTHING;

INSERT INTO app_role_permissions(role_id,permission_id,created_by)
SELECT DISTINCT rp.role_id,target.id,rp.created_by
FROM app_permissions source
JOIN app_role_permissions rp ON rp.permission_id=source.id
JOIN app_permissions target ON target.domain='vou' AND target.entity=source.entity
    AND target.action='price-reference'
WHERE source.domain='vou' AND source.entity IN ('sale-order','purchase-order')
  AND source.action IN ('create','save')
ON CONFLICT DO NOTHING;

-- +goose Down

-- +goose StatementBegin
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM vou_documents WHERE entity IN ('sale-pricing','purchase-inquiry'))
       OR EXISTS (SELECT 1 FROM vou_product_lines WHERE unit_price_cents=0 OR line_amount_cents=0 OR base_unit_price_cents=0)
       OR EXISTS (SELECT 1 FROM vou_sale_outbound_lines WHERE unit_price_cents=0 OR line_amount_cents=0)
       OR EXISTS (SELECT 1 FROM vou_purchase_inbound_lines WHERE unit_price_cents=0 OR line_amount_cents=0) THEN
        RAISE EXCEPTION 'cannot remove pricing support while pricing or zero-price data exists';
    END IF;
END
$$;
-- +goose StatementEnd

DELETE FROM app_role_permissions WHERE permission_id IN (
    SELECT id FROM app_permissions WHERE domain='vou'
      AND (entity IN ('sale-pricing','purchase-inquiry') OR action='price-reference')
);
DELETE FROM app_permissions WHERE domain='vou'
  AND (entity IN ('sale-pricing','purchase-inquiry') OR action='price-reference');

DROP TRIGGER vou_sale_pricing_detail_ck ON vou_sale_pricing_details;
DROP TRIGGER vou_purchase_inquiry_detail_ck ON vou_purchase_inquiry_details;
DROP TABLE vou_price_lines;
DROP TABLE vou_purchase_inquiry_details;
DROP TABLE vou_sale_pricing_details;

ALTER TABLE vou_product_lines
    DROP CONSTRAINT vou_product_lines_reference_ck,
    DROP COLUMN reference_line_id,
    DROP COLUMN reference_business_date,
    DROP COLUMN reference_document_no,
    DROP COLUMN reference_document_id,
    DROP COLUMN reference_unit_price_cents,
    DROP CONSTRAINT vou_product_lines_unit_price_ck,
    DROP CONSTRAINT vou_product_lines_line_amount_ck,
    DROP CONSTRAINT vou_product_lines_base_price_ck,
    ADD CONSTRAINT vou_product_lines_unit_price_cents_check CHECK (unit_price_cents > 0),
    ADD CONSTRAINT vou_product_lines_line_amount_cents_check CHECK (line_amount_cents > 0),
    ADD CONSTRAINT vou_product_lines_base_price_ck CHECK (base_unit_price_cents > 0);

ALTER TABLE vou_sale_outbound_lines
    DROP CONSTRAINT vou_sale_outbound_lines_unit_price_ck,
    DROP CONSTRAINT vou_sale_outbound_lines_line_amount_ck,
    ADD CONSTRAINT vou_sale_outbound_lines_unit_price_cents_check CHECK (unit_price_cents > 0),
    ADD CONSTRAINT vou_sale_outbound_lines_line_amount_cents_check CHECK (line_amount_cents > 0);
ALTER TABLE vou_sale_signoff_lines
    DROP CONSTRAINT vou_sale_signoff_lines_unit_price_ck,
    ADD CONSTRAINT vou_sale_signoff_lines_unit_price_cents_check CHECK (unit_price_cents > 0);
ALTER TABLE vou_sale_return_lines
    DROP CONSTRAINT vou_sale_return_lines_unit_price_ck,
    DROP CONSTRAINT vou_sale_return_lines_line_amount_ck,
    ADD CONSTRAINT vou_sale_return_lines_unit_price_cents_check CHECK (unit_price_cents > 0),
    ADD CONSTRAINT vou_sale_return_lines_line_amount_cents_check CHECK (line_amount_cents > 0);
ALTER TABLE vou_purchase_inbound_lines
    DROP CONSTRAINT vou_purchase_inbound_lines_unit_price_ck,
    DROP CONSTRAINT vou_purchase_inbound_lines_line_amount_ck,
    ADD CONSTRAINT vou_purchase_inbound_lines_unit_price_cents_check CHECK (unit_price_cents > 0),
    ADD CONSTRAINT vou_purchase_inbound_lines_line_amount_cents_check CHECK (line_amount_cents > 0);
ALTER TABLE vou_purchase_return_lines
    DROP CONSTRAINT vou_purchase_return_lines_unit_price_ck,
    DROP CONSTRAINT vou_purchase_return_lines_line_amount_ck,
    ADD CONSTRAINT vou_purchase_return_lines_unit_price_cents_check CHECK (unit_price_cents > 0),
    ADD CONSTRAINT vou_purchase_return_lines_line_amount_cents_check CHECK (line_amount_cents > 0);

ALTER TABLE led_draft_inventory DROP CONSTRAINT led_draft_inventory_pricing_ck,
    ADD CONSTRAINT led_draft_inventory_pricing_ck CHECK (
        (currency IS NULL AND unit_price_cents IS NULL AND amount_cents IS NULL)
        OR (currency ~ '^[A-Z]{3}$' AND unit_price_cents > 0 AND amount_cents >= 0));
ALTER TABLE led_opening_inventory DROP CONSTRAINT led_opening_inventory_pricing_ck,
    ADD CONSTRAINT led_opening_inventory_pricing_ck CHECK (
        (currency IS NULL AND unit_price_cents IS NULL AND amount_cents IS NULL)
        OR (currency ~ '^[A-Z]{3}$' AND unit_price_cents > 0 AND amount_cents >= 0));
ALTER TABLE led_inventory_entries DROP CONSTRAINT led_inventory_entries_pricing_ck,
    ADD CONSTRAINT led_inventory_entries_pricing_ck CHECK (
        (currency IS NULL AND unit_price_cents IS NULL AND amount_cents IS NULL)
        OR (currency ~ '^[A-Z]{3}$' AND unit_price_cents > 0 AND amount_cents >= 0));

ALTER TABLE vou_documents
    DROP CONSTRAINT vou_documents_total_amount_ck,
    ADD CONSTRAINT vou_documents_total_amount_ck CHECK (
        (entity IN ('sale-signoff','order-production','self-production') AND total_amount_cents >= 0)
        OR (entity NOT IN ('sale-signoff','order-production','self-production') AND total_amount_cents > 0)
    ),
    DROP CONSTRAINT vou_documents_entity_check,
    ADD CONSTRAINT vou_documents_entity_check CHECK (entity IN (
        'sale-order', 'sale-outbound', 'sale-delivery', 'sale-signoff', 'sale-return',
        'purchase-order', 'purchase-inbound', 'purchase-return',
        'order-production', 'self-production', 'receipt', 'payment',
        'expense-reimbursement', 'other-income', 'customer-order', 'procurement-order',
        'goods-receipt', 'delivery-note', 'signoff-note'
    ));

-- The previous detail validator is restored by the next migration when rolling forward;
-- down migrations are guarded against retained pricing data and leave the function compatible
-- because the dropped tables are no longer referenced only after replacing it below.
-- +goose StatementBegin
CREATE OR REPLACE FUNCTION vou_validate_document_detail() RETURNS trigger AS $$
DECLARE target_id varchar(26); detail_count integer;
BEGIN
    IF TG_TABLE_NAME = 'vou_documents' THEN target_id := CASE WHEN TG_OP='DELETE' THEN OLD.id ELSE NEW.id END;
    ELSE target_id := CASE WHEN TG_OP='DELETE' THEN OLD.document_id ELSE NEW.document_id END; END IF;
    IF NOT EXISTS (SELECT 1 FROM vou_documents WHERE id=target_id) THEN RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END; END IF;
    SELECT (SELECT count(*) FROM vou_sale_order_details WHERE document_id=target_id)
         + (SELECT count(*) FROM vou_sale_outbound_details WHERE document_id=target_id)
         + (SELECT count(*) FROM vou_sale_delivery_details WHERE document_id=target_id)
         + (SELECT count(*) FROM vou_sale_signoff_details WHERE document_id=target_id)
         + (SELECT count(*) FROM vou_sale_return_details WHERE document_id=target_id)
         + (SELECT count(*) FROM vou_purchase_order_details WHERE document_id=target_id)
         + (SELECT count(*) FROM vou_purchase_inbound_details WHERE document_id=target_id)
         + (SELECT count(*) FROM vou_purchase_return_details WHERE document_id=target_id)
         + (SELECT count(*) FROM vou_production_details WHERE document_id=target_id)
         + (SELECT count(*) FROM vou_receipt_details WHERE document_id=target_id)
         + (SELECT count(*) FROM vou_payment_details WHERE document_id=target_id)
         + (SELECT count(*) FROM vou_expense_reimbursement_details WHERE document_id=target_id)
         + (SELECT count(*) FROM vou_other_income_details WHERE document_id=target_id) INTO detail_count;
    IF detail_count<>1 THEN RAISE EXCEPTION 'VOU document must have exactly one typed detail row' USING ERRCODE='23514'; END IF;
    RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END;
$$ LANGUAGE plpgsql;
-- +goose StatementEnd

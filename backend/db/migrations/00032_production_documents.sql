-- +goose Up

ALTER TABLE vou_documents
    DROP CONSTRAINT vou_documents_entity_check,
    ADD CONSTRAINT vou_documents_entity_check CHECK (entity IN (
        'sale-order', 'sale-outbound', 'sale-delivery', 'sale-signoff', 'sale-return',
        'purchase-order', 'purchase-inbound', 'purchase-return',
        'order-production', 'self-production',
        'receipt', 'payment', 'expense-reimbursement', 'other-income',
        'customer-order', 'procurement-order', 'goods-receipt',
        'delivery-note', 'signoff-note'
    )),
    DROP CONSTRAINT vou_documents_total_amount_ck,
    ADD CONSTRAINT vou_documents_total_amount_ck CHECK (
        (entity IN ('sale-signoff', 'order-production', 'self-production')
            AND total_amount_cents >= 0)
        OR
        (entity NOT IN ('sale-signoff', 'order-production', 'self-production')
            AND total_amount_cents > 0)
    ),
    ALTER COLUMN currency DROP NOT NULL,
    ADD CONSTRAINT vou_documents_production_money_ck CHECK (
        (
            entity IN ('order-production', 'self-production')
            AND currency IS NULL
            AND total_amount_cents = 0
        )
        OR
        (
            entity NOT IN ('order-production', 'self-production')
            AND currency IS NOT NULL
        )
    );

CREATE TABLE vou_production_details (
    document_id varchar(26) PRIMARY KEY,
    entity varchar(32) NOT NULL
        CHECK (entity IN ('order-production', 'self-production')),
    material_warehouse_object_id varchar(26) NOT NULL,
    material_warehouse_version_id varchar(26) NOT NULL,
    material_warehouse_code varchar(64) NOT NULL,
    material_warehouse_name varchar(200) NOT NULL,
    finished_warehouse_object_id varchar(26) NOT NULL,
    finished_warehouse_version_id varchar(26) NOT NULL,
    finished_warehouse_code varchar(64) NOT NULL,
    finished_warehouse_name varchar(200) NOT NULL,
    FOREIGN KEY (document_id, entity)
        REFERENCES vou_documents(id, entity) ON DELETE RESTRICT
);

CREATE TABLE vou_production_output_lines (
    id varchar(26) PRIMARY KEY,
    document_id varchar(26) NOT NULL
        REFERENCES vou_production_details(document_id) ON DELETE RESTRICT,
    line_no integer NOT NULL CHECK (line_no > 0),
    source_order_line_id varchar(26)
        REFERENCES vou_product_lines(id) ON DELETE RESTRICT,
    product_object_id varchar(26) NOT NULL,
    product_version_id varchar(26) NOT NULL,
    product_code varchar(64) NOT NULL,
    product_name varchar(200) NOT NULL,
    product_unit varchar(32) NOT NULL,
    product_kind varchar(32) NOT NULL
        CHECK (product_kind IN ('STANDARD_FINISHED', 'CUSTOM_FINISHED')),
    output_quantity_micros bigint NOT NULL CHECK (output_quantity_micros > 0),
    loss_rate_micros bigint NOT NULL
        CHECK (loss_rate_micros BETWEEN 0 AND 100000000),
    formula_base_output_quantity_micros bigint NOT NULL
        CHECK (formula_base_output_quantity_micros > 0),
    remark varchar(1000),
    UNIQUE (document_id, line_no),
    UNIQUE (document_id, product_object_id),
    UNIQUE (document_id, source_order_line_id)
);
CREATE INDEX vou_production_output_source_idx
    ON vou_production_output_lines(source_order_line_id)
    WHERE source_order_line_id IS NOT NULL;

CREATE TABLE vou_production_material_lines (
    id varchar(26) PRIMARY KEY,
    output_line_id varchar(26) NOT NULL
        REFERENCES vou_production_output_lines(id) ON DELETE RESTRICT,
    line_no integer NOT NULL CHECK (line_no > 0),
    formula_material_object_id varchar(26) NOT NULL,
    formula_material_version_id varchar(26) NOT NULL,
    formula_material_code varchar(64) NOT NULL,
    formula_material_name varchar(200) NOT NULL,
    formula_material_unit varchar(32) NOT NULL,
    formula_quantity_micros bigint NOT NULL CHECK (formula_quantity_micros > 0),
    suggested_quantity_micros bigint NOT NULL CHECK (suggested_quantity_micros > 0),
    actual_material_object_id varchar(26) NOT NULL,
    actual_material_version_id varchar(26) NOT NULL,
    actual_material_code varchar(64) NOT NULL,
    actual_material_name varchar(200) NOT NULL,
    actual_material_unit varchar(32) NOT NULL,
    actual_quantity_micros bigint NOT NULL CHECK (actual_quantity_micros > 0),
    adjustment_reason varchar(1000),
    UNIQUE (output_line_id, line_no),
    CONSTRAINT vou_production_material_adjustment_ck CHECK (
        (
            formula_material_object_id = actual_material_object_id
            AND formula_material_version_id = actual_material_version_id
            AND suggested_quantity_micros = actual_quantity_micros
        )
        OR length(btrim(COALESCE(adjustment_reason, ''))) > 0
    )
);
CREATE INDEX vou_production_material_actual_idx
    ON vou_production_material_lines(actual_material_object_id, actual_material_version_id);

CREATE CONSTRAINT TRIGGER vou_production_detail_ck
    AFTER INSERT OR UPDATE OR DELETE ON vou_production_details
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION vou_validate_document_detail();

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
        (SELECT count(*) FROM vou_production_details WHERE document_id = target_id) +
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

-- +goose StatementBegin
CREATE OR REPLACE FUNCTION vou_validate_wfl_parent() RETURNS trigger AS $$
DECLARE parent_entity varchar(32);
BEGIN
    IF NEW.control_domain = 'VOU' THEN
        IF NEW.parent_document_id IS NULL THEN RETURN NEW; END IF;
        SELECT entity INTO parent_entity FROM vou_documents WHERE id = NEW.parent_document_id;
        IF (NEW.entity = 'sale-outbound' AND parent_entity = 'sale-order')
           OR (NEW.entity = 'sale-delivery' AND parent_entity = 'sale-outbound')
           OR (NEW.entity = 'sale-signoff' AND parent_entity = 'sale-delivery')
           OR (NEW.entity = 'order-production' AND parent_entity = 'sale-order') THEN
            RETURN NEW;
        END IF;
        RAISE EXCEPTION 'invalid VOU document parent';
    END IF;
    IF NEW.entity IN ('customer-order', 'sale-order', 'purchase-order')
       AND NEW.parent_document_id IS NULL THEN
        RETURN NEW;
    END IF;
    IF NEW.parent_document_id IS NULL THEN
        RAISE EXCEPTION 'WFL child requires parent';
    END IF;
    SELECT entity INTO parent_entity FROM vou_documents WHERE id = NEW.parent_document_id;
    IF (NEW.entity = 'procurement-order' AND parent_entity = 'customer-order')
       OR (NEW.entity = 'goods-receipt' AND parent_entity = 'procurement-order')
       OR (NEW.entity = 'delivery-note' AND parent_entity = 'customer-order')
       OR (NEW.entity = 'signoff-note' AND parent_entity = 'delivery-note')
       OR (NEW.entity = 'sale-outbound' AND parent_entity = 'sale-order')
       OR (NEW.entity = 'sale-delivery' AND parent_entity = 'sale-outbound')
       OR (NEW.entity = 'sale-signoff' AND parent_entity = 'sale-delivery')
       OR (NEW.entity = 'purchase-inbound' AND parent_entity = 'purchase-order') THEN
        RETURN NEW;
    END IF;
    RAISE EXCEPTION 'invalid WFL document parent';
END;
$$ LANGUAGE plpgsql;
-- +goose StatementEnd

ALTER TABLE wfl_process_documents
    DROP CONSTRAINT wfl_process_documents_stage_check,
    ADD CONSTRAINT wfl_process_documents_stage_check CHECK (stage IN (
        'CUSTOMER_ORDER', 'PROCUREMENT', 'RECEIPT', 'DELIVERY', 'SIGNOFF',
        'SALE_ORDER', 'PRODUCTION', 'OUTBOUND', 'RETURN',
        'PURCHASE_ORDER', 'PURCHASE_INBOUND', 'PURCHASE_RETURN'
    ));

WITH entities(entity, title) AS (
    VALUES
        ('order-production', '订单生产'),
        ('self-production', '自制品生产')
), actions(action, title) AS (
    VALUES
        ('query', '查询'), ('get', '查看'), ('create', '创建'),
        ('save', '保存'), ('delete', '删除'), ('check', '核对'),
        ('uncheck', '反核对'), ('approve', '批准'), ('unapprove', '反批准'),
        ('finalize', '完成'), ('unfinalize', '撤销完成'),
        ('audit-history', '查看审计'), ('attachment-initiate', '上传附件'),
        ('attachment-download', '下载附件'), ('attachment-remove', '删除附件')
)
INSERT INTO app_permissions(id, path, domain, entity, action, description, status)
SELECT 'PD' || substring(md5('/vou/' || entity || '/' || action), 1, 24),
       '/vou/' || entity || '/' || action,
       'vou', entity, action, actions.title || entities.title, 'ENABLED'
FROM entities CROSS JOIN actions
ON CONFLICT (path) DO NOTHING;

WITH entities(entity) AS (
    VALUES ('order-production'), ('self-production')
), actions(action) AS (
    VALUES
        ('query'), ('get'), ('create'), ('save'), ('delete'), ('check'),
        ('uncheck'), ('approve'), ('unapprove'), ('finalize'), ('unfinalize'),
        ('audit-history'), ('attachment-initiate'), ('attachment-download'),
        ('attachment-remove')
)
INSERT INTO app_role_permissions(role_id, permission_id, created_by)
SELECT DISTINCT source_role.role_id, target.id, source_role.created_by
FROM entities
CROSS JOIN actions
JOIN app_permissions source
  ON source.path = '/vou/sale-order/' || actions.action
JOIN app_role_permissions source_role ON source_role.permission_id = source.id
JOIN app_permissions target
  ON target.path = '/vou/' || entities.entity || '/' || actions.action
ON CONFLICT DO NOTHING;

INSERT INTO app_permissions(id, path, domain, entity, action, description, status)
VALUES (
    'PD' || substring(md5('/vou/self-production/formula-default'), 1, 24),
    '/vou/self-production/formula-default',
    'vou',
    'self-production',
    'formula-default',
    '解析自制品默认配方',
    'ENABLED'
)
ON CONFLICT (path) DO NOTHING;

INSERT INTO app_role_permissions(role_id, permission_id, created_by)
SELECT source_role.role_id, target.id, source_role.created_by
FROM app_permissions source
JOIN app_role_permissions source_role ON source_role.permission_id = source.id
JOIN app_permissions target
  ON target.path = '/vou/self-production/formula-default'
WHERE source.path = '/vou/sale-order/formula-default'
ON CONFLICT DO NOTHING;

INSERT INTO app_role_permissions(role_id, permission_id, created_by)
SELECT role.id, permission.id, role.updated_by
FROM app_roles role
CROSS JOIN app_permissions permission
WHERE role.code = 'superadmin'
  AND permission.domain = 'vou'
  AND permission.entity IN ('order-production', 'self-production')
ON CONFLICT DO NOTHING;

-- +goose Down

-- +goose StatementBegin
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM vou_documents
        WHERE entity IN ('order-production', 'self-production')
    ) THEN
        RAISE EXCEPTION 'cannot remove production documents while production data exists';
    END IF;
END
$$;
-- +goose StatementEnd

DELETE FROM app_role_permissions
WHERE permission_id IN (
    SELECT id FROM app_permissions
    WHERE domain = 'vou' AND entity IN ('order-production', 'self-production')
);
DELETE FROM app_permissions
WHERE domain = 'vou' AND entity IN ('order-production', 'self-production');

ALTER TABLE wfl_process_documents
    DROP CONSTRAINT wfl_process_documents_stage_check,
    ADD CONSTRAINT wfl_process_documents_stage_check CHECK (stage IN (
        'CUSTOMER_ORDER', 'PROCUREMENT', 'RECEIPT', 'DELIVERY', 'SIGNOFF',
        'SALE_ORDER', 'OUTBOUND', 'RETURN',
        'PURCHASE_ORDER', 'PURCHASE_INBOUND', 'PURCHASE_RETURN'
    ));

DROP TRIGGER vou_production_detail_ck ON vou_production_details;
DROP TABLE vou_production_material_lines;
DROP TABLE vou_production_output_lines;
DROP TABLE vou_production_details;

ALTER TABLE vou_documents
    DROP CONSTRAINT vou_documents_production_money_ck,
    ALTER COLUMN currency SET NOT NULL,
    DROP CONSTRAINT vou_documents_total_amount_ck,
    ADD CONSTRAINT vou_documents_total_amount_ck CHECK (
        (entity = 'sale-signoff' AND total_amount_cents >= 0)
        OR (entity <> 'sale-signoff' AND total_amount_cents > 0)
    ),
    DROP CONSTRAINT vou_documents_entity_check,
    ADD CONSTRAINT vou_documents_entity_check CHECK (entity IN (
        'sale-order', 'sale-outbound', 'sale-delivery', 'sale-signoff', 'sale-return',
        'purchase-order', 'purchase-inbound', 'purchase-return',
        'receipt', 'payment', 'expense-reimbursement', 'other-income',
        'customer-order', 'procurement-order', 'goods-receipt',
        'delivery-note', 'signoff-note'
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

-- +goose StatementBegin
CREATE OR REPLACE FUNCTION vou_validate_wfl_parent() RETURNS trigger AS $$
DECLARE parent_entity varchar(32);
BEGIN
    IF NEW.control_domain = 'VOU' THEN
        IF NEW.parent_document_id IS NULL THEN RETURN NEW; END IF;
        SELECT entity INTO parent_entity FROM vou_documents WHERE id = NEW.parent_document_id;
        IF (NEW.entity = 'sale-outbound' AND parent_entity = 'sale-order')
           OR (NEW.entity = 'sale-delivery' AND parent_entity = 'sale-outbound')
           OR (NEW.entity = 'sale-signoff' AND parent_entity = 'sale-delivery') THEN
            RETURN NEW;
        END IF;
        RAISE EXCEPTION 'invalid VOU sales-chain parent';
    END IF;
    IF NEW.entity IN ('customer-order', 'sale-order', 'purchase-order')
       AND NEW.parent_document_id IS NULL THEN
        RETURN NEW;
    END IF;
    IF NEW.parent_document_id IS NULL THEN
        RAISE EXCEPTION 'WFL child requires parent';
    END IF;
    SELECT entity INTO parent_entity FROM vou_documents WHERE id = NEW.parent_document_id;
    IF (NEW.entity = 'procurement-order' AND parent_entity = 'customer-order')
       OR (NEW.entity = 'goods-receipt' AND parent_entity = 'procurement-order')
       OR (NEW.entity = 'delivery-note' AND parent_entity = 'customer-order')
       OR (NEW.entity = 'signoff-note' AND parent_entity = 'delivery-note')
       OR (NEW.entity = 'sale-outbound' AND parent_entity = 'sale-order')
       OR (NEW.entity = 'sale-delivery' AND parent_entity = 'sale-outbound')
       OR (NEW.entity = 'sale-signoff' AND parent_entity = 'sale-delivery')
       OR (NEW.entity = 'purchase-inbound' AND parent_entity = 'purchase-order') THEN
        RETURN NEW;
    END IF;
    RAISE EXCEPTION 'invalid WFL document parent';
END;
$$ LANGUAGE plpgsql;
-- +goose StatementEnd

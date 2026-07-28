-- +goose Up
-- This migration intentionally removes the obsolete intermediary-sale-order
-- aggregate. It is guarded so production stops instead of silently deleting
-- documents that have moved beyond the reviewed deletion snapshot.
-- +goose StatementBegin
DO $$
DECLARE
    legacy_documents integer;
    legacy_lines integer;
    legacy_audits integer;
BEGIN
    IF EXISTS (
        SELECT 1 FROM vou_documents
        WHERE entity = 'intermediary-sale-order' AND status <> 'DRAFT'
    ) THEN
        RAISE EXCEPTION 'cannot remove non-draft intermediary sale orders'
            USING ERRCODE = 'P0001';
    END IF;
    IF EXISTS (
        SELECT 1 FROM vou_document_attachments a
        JOIN vou_documents d ON d.id = a.document_id
        WHERE d.entity = 'intermediary-sale-order'
    ) THEN
        RAISE EXCEPTION 'cannot remove intermediary sale orders with attachments'
            USING ERRCODE = 'P0001';
    END IF;
    IF EXISTS (
        SELECT 1 FROM led_inventory_entries WHERE source_entity = 'intermediary-sale-order'
        UNION ALL
        SELECT 1 FROM led_fund_entries WHERE source_entity = 'intermediary-sale-order'
        UNION ALL
        SELECT 1 FROM led_party_entries WHERE source_entity = 'intermediary-sale-order'
        UNION ALL
        SELECT 1 FROM led_container_entries WHERE source_entity = 'intermediary-sale-order'
    ) THEN
        RAISE EXCEPTION 'cannot remove intermediary sale orders with ledger entries'
            USING ERRCODE = 'P0001';
    END IF;
    IF EXISTS (SELECT 1 FROM vou_documents WHERE entity = 'purchase-order') THEN
        RAISE EXCEPTION 'purchase fulfillment migration requires purchase-order data to be empty'
            USING ERRCODE = 'P0001';
    END IF;
    SELECT count(*) INTO legacy_documents
    FROM vou_documents WHERE entity = 'intermediary-sale-order';
    SELECT count(*) INTO legacy_lines
    FROM vou_product_lines WHERE document_entity = 'intermediary-sale-order';
    SELECT count(*) INTO legacy_audits
    FROM vou_audit_events a
    JOIN vou_documents d ON d.id = a.document_id
    WHERE d.entity = 'intermediary-sale-order';
    IF legacy_documents > 0 AND (
        legacy_documents <> 9 OR legacy_lines <> 9 OR legacy_audits <> 17
    ) THEN
        RAISE EXCEPTION
            'legacy intermediary snapshot changed: documents %, lines %, audits %',
            legacy_documents, legacy_lines, legacy_audits
            USING ERRCODE = 'P0001';
    END IF;
END
$$;
-- +goose StatementEnd

DELETE FROM app_role_permissions
WHERE permission_id IN (
    SELECT id FROM app_permissions
    WHERE domain = 'vou' AND entity = 'intermediary-sale-order'
);
DELETE FROM app_permissions
WHERE domain = 'vou' AND entity = 'intermediary-sale-order';
DELETE FROM vou_audit_events
WHERE document_id IN (
    SELECT id FROM vou_documents WHERE entity = 'intermediary-sale-order'
);
DELETE FROM vou_product_lines
WHERE document_entity = 'intermediary-sale-order';
DELETE FROM vou_intermediary_sale_order_details;
DELETE FROM vou_documents WHERE entity = 'intermediary-sale-order';
DELETE FROM vou_number_counters WHERE entity = 'intermediary-sale-order';

DROP TRIGGER vou_intermediary_sale_order_detail_ck
    ON vou_intermediary_sale_order_details;
DROP TABLE vou_intermediary_sale_order_details;

ALTER TABLE vou_purchase_order_details
    DROP CONSTRAINT vou_purchase_order_warehouse_ck,
    DROP COLUMN inbound_date,
    DROP COLUMN difference_reason,
    ADD COLUMN fulfillment_status varchar(32) NOT NULL DEFAULT 'OPEN'
        CHECK (fulfillment_status IN (
            'OPEN', 'FULFILLED', 'SHORT_CLOSE_REQUESTED', 'SHORT_CLOSED'
        )),
    ADD COLUMN short_close_requested_by varchar(26),
    ADD COLUMN short_close_reason varchar(1000),
    ADD CONSTRAINT vou_purchase_order_warehouse_ck CHECK (
        warehouse_object_id IS NOT NULL AND warehouse_version_id IS NOT NULL
        AND warehouse_code IS NOT NULL AND warehouse_name IS NOT NULL
    ),
    ADD CONSTRAINT vou_purchase_order_short_close_ck CHECK (
        (fulfillment_status IN ('OPEN', 'FULFILLED')
            AND short_close_requested_by IS NULL AND short_close_reason IS NULL)
        OR (fulfillment_status IN ('SHORT_CLOSE_REQUESTED', 'SHORT_CLOSED')
            AND short_close_requested_by IS NOT NULL AND short_close_reason IS NOT NULL)
    );

ALTER TABLE vou_product_lines
    DROP CONSTRAINT vou_product_lines_document_entity_check,
    DROP CONSTRAINT vou_product_lines_execution_ck,
    ADD CONSTRAINT vou_product_lines_document_entity_check
        CHECK (document_entity IN ('sale-order', 'purchase-order')),
    ADD CONSTRAINT vou_product_lines_execution_ck CHECK (
        (document_entity = 'purchase-order'
            AND outbound_qty_micros IS NULL AND signed_qty_micros IS NULL
            AND rejected_qty_micros IS NULL AND loss_qty_micros IS NULL
            AND inbound_qty_micros IS NULL)
        OR (document_entity = 'sale-order' AND inbound_qty_micros IS NULL)
    );

CREATE TABLE vou_purchase_inbound_details (
    document_id varchar(26) PRIMARY KEY,
    entity varchar(32) NOT NULL DEFAULT 'purchase-inbound'
        CHECK (entity = 'purchase-inbound'),
    source_order_id varchar(26) NOT NULL
        REFERENCES vou_purchase_order_details(document_id) ON DELETE RESTRICT,
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

CREATE TABLE vou_purchase_inbound_lines (
    id varchar(26) PRIMARY KEY,
    document_id varchar(26) NOT NULL
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
    UNIQUE (document_id, source_order_line_id),
    UNIQUE (document_id, line_no)
);
CREATE INDEX vou_purchase_inbound_lines_source_idx
    ON vou_purchase_inbound_lines(source_order_line_id);

ALTER TABLE vou_documents
    DROP CONSTRAINT vou_documents_entity_check,
    DROP CONSTRAINT vou_documents_status_ck,
    DROP CONSTRAINT vou_documents_status_audit_ck,
    ADD CONSTRAINT vou_documents_entity_check CHECK (entity IN (
        'sale-order', 'sale-outbound', 'sale-delivery', 'sale-signoff',
        'purchase-order', 'purchase-inbound',
        'receipt', 'payment', 'expense-reimbursement', 'other-income',
        'customer-order', 'procurement-order', 'goods-receipt',
        'delivery-note', 'signoff-note'
    )),
    ADD CONSTRAINT vou_documents_status_ck CHECK (
        (control_domain = 'VOU' AND status IN ('DRAFT', 'CHECKED', 'APPROVED', 'FINALIZED'))
        OR (control_domain = 'WFL' AND workflow_version = 1
            AND status IN ('DRAFT', 'REVIEWED', 'APPROVED', 'EXECUTED'))
        OR (control_domain = 'WFL' AND workflow_version = 2
            AND entity IN (
                'sale-order', 'sale-outbound', 'sale-delivery', 'sale-signoff',
                'purchase-order', 'purchase-inbound'
            )
            AND status IN ('DRAFT', 'CHECKED', 'APPROVED', 'FINALIZED'))
    ),
    ADD CONSTRAINT vou_documents_status_audit_ck CHECK (
        ((control_domain = 'VOU'
            OR (control_domain = 'WFL' AND workflow_version = 2
                AND entity IN (
                    'sale-order', 'sale-outbound', 'sale-delivery', 'sale-signoff',
                    'purchase-order', 'purchase-inbound'
                )))
            AND (
                (status = 'DRAFT' AND reviewed_at IS NULL AND reviewed_by IS NULL
                    AND approved_at IS NULL AND approved_by IS NULL
                    AND executed_at IS NULL AND executed_by IS NULL)
                OR
                (status = 'CHECKED' AND reviewed_at IS NOT NULL AND reviewed_by IS NOT NULL
                    AND approved_at IS NULL AND approved_by IS NULL
                    AND executed_at IS NULL AND executed_by IS NULL)
                OR
                (status = 'APPROVED' AND reviewed_at IS NOT NULL AND reviewed_by IS NOT NULL
                    AND approved_at IS NOT NULL AND approved_by IS NOT NULL
                    AND executed_at IS NULL AND executed_by IS NULL)
                OR
                (status = 'FINALIZED' AND reviewed_at IS NOT NULL AND reviewed_by IS NOT NULL
                    AND approved_at IS NOT NULL AND approved_by IS NOT NULL
                    AND executed_at IS NOT NULL AND executed_by IS NOT NULL)
            ))
        OR
        (control_domain = 'WFL' AND workflow_version = 1 AND (
            (status = 'DRAFT' AND reviewed_at IS NULL AND reviewed_by IS NULL
                AND approved_at IS NULL AND approved_by IS NULL
                AND executed_at IS NULL AND executed_by IS NULL)
            OR
            (status = 'REVIEWED' AND reviewed_at IS NOT NULL AND reviewed_by IS NOT NULL
                AND approved_at IS NULL AND approved_by IS NULL
                AND executed_at IS NULL AND executed_by IS NULL)
            OR
            (status = 'APPROVED' AND reviewed_at IS NOT NULL AND reviewed_by IS NOT NULL
                AND approved_at IS NOT NULL AND approved_by IS NOT NULL
                AND executed_at IS NULL AND executed_by IS NULL)
            OR
            (status = 'EXECUTED' AND reviewed_at IS NOT NULL AND reviewed_by IS NOT NULL
                AND approved_at IS NOT NULL AND approved_by IS NOT NULL
                AND executed_at IS NOT NULL AND executed_by IS NOT NULL)
        ))
    );

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
        (SELECT count(*) FROM vou_purchase_inbound_details WHERE document_id = target_id) +
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
        RAISE EXCEPTION 'VOU document must have exactly one typed detail row'
            USING ERRCODE = '23514';
    END IF;
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$ LANGUAGE plpgsql;
-- +goose StatementEnd

CREATE CONSTRAINT TRIGGER vou_purchase_inbound_detail_ck
    AFTER INSERT OR UPDATE OR DELETE ON vou_purchase_inbound_details
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION vou_validate_document_detail();

ALTER TABLE wfl_process_instances
    DROP CONSTRAINT wfl_process_instances_process_type_check,
    ADD CONSTRAINT wfl_process_instances_process_type_check
        CHECK (process_type IN (
            'INTERMEDIARY_TRADE', 'SALES_FULFILLMENT', 'PURCHASE_FULFILLMENT'
        ));

ALTER TABLE wfl_process_documents
    DROP CONSTRAINT wfl_process_documents_stage_check,
    ADD CONSTRAINT wfl_process_documents_stage_check CHECK (stage IN (
        'CUSTOMER_ORDER', 'PROCUREMENT', 'RECEIPT', 'DELIVERY', 'SIGNOFF',
        'SALE_ORDER', 'OUTBOUND', 'PURCHASE_ORDER', 'PURCHASE_INBOUND'
    ));

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

UPDATE vou_documents
SET control_domain = 'WFL', workflow_version = 2
WHERE entity = 'purchase-order';

WITH actions(action, description) AS (
    VALUES
        ('query','查询采购履约'),('get','查看采购履约'),
        ('create','创建采购订单'),('save','保存采购订单'),
        ('check','核对采购订单'),('uncheck','反核对采购订单'),
        ('approve','批准采购订单'),('unapprove','反批准采购订单'),
        ('short-close-request','申请采购订单短结'),
        ('short-close-cancel','取消采购订单短结'),
        ('short-close-confirm','确认采购订单短结'),
        ('short-close-unconfirm','撤销采购订单短结'),
        ('audit-history','查看采购履约审计'),
        ('order-attachment-initiate','发起采购订单附件上传'),
        ('order-attachment-download','下载采购订单附件'),
        ('order-attachment-remove','移除采购订单附件'),
        ('inbound-create','创建采购入库'),
        ('inbound-get','查看采购入库'),('inbound-save','保存采购入库'),
        ('inbound-delete','删除采购入库草稿'),
        ('inbound-check','核对采购入库'),('inbound-uncheck','反核对采购入库'),
        ('inbound-approve','批准采购入库'),('inbound-unapprove','反批准采购入库'),
        ('inbound-finalize','最终处理采购入库'),
        ('inbound-unfinalize','反最终处理采购入库'),
        ('inbound-attachment-initiate','发起采购入库附件上传'),
        ('inbound-attachment-download','下载采购入库附件'),
        ('inbound-attachment-remove','移除采购入库附件')
)
INSERT INTO app_permissions(id,path,domain,entity,action,description,status)
SELECT 'WP' || substring(md5('/wfl/purchase-fulfillment/' || action),1,24),
       '/wfl/purchase-fulfillment/' || action,
       'wfl','purchase-fulfillment',action,description,'ENABLED'
FROM actions
ON CONFLICT (path) DO NOTHING;

WITH actions(action, description) AS (
    VALUES
        ('query','查询采购入库'),('get','查看采购入库'),
        ('audit-history','查看采购入库审计'),
        ('attachment-download','下载采购入库附件')
)
INSERT INTO app_permissions(id,path,domain,entity,action,description,status)
SELECT 'VI' || substring(md5('/vou/purchase-inbound/' || action),1,24),
       '/vou/purchase-inbound/' || action,
       'vou','purchase-inbound',action,description,'ENABLED'
FROM actions
ON CONFLICT (path) DO NOTHING;

WITH mapping(wfl_action, source_path) AS (
    VALUES
        ('query','/vou/purchase-order/query'),('get','/vou/purchase-order/get'),
        ('create','/vou/purchase-order/create'),('save','/vou/purchase-order/save'),
        ('inbound-create','/vou/purchase-order/create'),
        ('inbound-save','/vou/purchase-order/save'),
        ('inbound-delete','/vou/purchase-order/save'),
        ('check','/vou/purchase-order/check'),('uncheck','/vou/purchase-order/uncheck'),
        ('inbound-check','/vou/purchase-order/check'),
        ('inbound-uncheck','/vou/purchase-order/uncheck'),
        ('approve','/vou/purchase-order/approve'),('unapprove','/vou/purchase-order/unapprove'),
        ('inbound-approve','/vou/purchase-order/approve'),
        ('inbound-finalize','/vou/purchase-order/finalize'),
        ('inbound-unapprove','/vou/purchase-order/unapprove'),
        ('inbound-unfinalize','/vou/purchase-order/unfinalize'),
        ('audit-history','/vou/purchase-order/audit-history'),
        ('order-attachment-initiate','/vou/purchase-order/attachment-initiate'),
        ('order-attachment-download','/vou/purchase-order/attachment-download'),
        ('order-attachment-remove','/vou/purchase-order/attachment-remove'),
        ('inbound-attachment-initiate','/vou/purchase-order/attachment-initiate'),
        ('inbound-attachment-download','/vou/purchase-order/attachment-download'),
        ('inbound-attachment-remove','/vou/purchase-order/attachment-remove')
)
INSERT INTO app_role_permissions(role_id, permission_id, created_by)
SELECT DISTINCT rp.role_id, target.id, rp.created_by
FROM mapping m
JOIN app_permissions source ON source.path = m.source_path
JOIN app_role_permissions rp ON rp.permission_id = source.id
JOIN app_permissions target
  ON target.path = '/wfl/purchase-fulfillment/' || m.wfl_action
ON CONFLICT DO NOTHING;

WITH mapping(target_path, source_path) AS (
    VALUES
        ('/vou/purchase-inbound/query','/vou/purchase-order/query'),
        ('/vou/purchase-inbound/get','/vou/purchase-order/get'),
        ('/vou/purchase-inbound/audit-history','/vou/purchase-order/audit-history'),
        ('/vou/purchase-inbound/attachment-download','/vou/purchase-order/attachment-download')
)
INSERT INTO app_role_permissions(role_id, permission_id, created_by)
SELECT DISTINCT rp.role_id, target.id, rp.created_by
FROM mapping m
JOIN app_permissions source ON source.path = m.source_path
JOIN app_role_permissions rp ON rp.permission_id = source.id
JOIN app_permissions target ON target.path = m.target_path
ON CONFLICT DO NOTHING;

INSERT INTO app_role_permissions(role_id, permission_id, created_by)
SELECT r.id, p.id, r.updated_by
FROM app_roles r CROSS JOIN app_permissions p
WHERE r.code = 'superadmin'
  AND ((p.domain = 'wfl' AND p.entity = 'purchase-fulfillment')
    OR (p.domain = 'vou' AND p.entity = 'purchase-inbound'))
ON CONFLICT DO NOTHING;

DELETE FROM app_role_permissions
WHERE permission_id IN (
    SELECT id FROM app_permissions
    WHERE domain = 'vou' AND entity = 'purchase-order'
      AND action NOT IN ('query', 'get', 'audit-history', 'attachment-download')
);
DELETE FROM app_permissions
WHERE domain = 'vou' AND entity = 'purchase-order'
  AND action NOT IN ('query', 'get', 'audit-history', 'attachment-download');

UPDATE app_permissions
SET description = replace(
    replace(
    replace(
    replace(
    replace(
    replace(
    replace(
    replace(
    replace(
    replace(
    replace(
    replace(
    replace(
    replace(description,
        '销售出库单', '销售出库'),
        '销售配送单', '销售送货'),
        '销售签收单', '销售签收'),
        '采购单', '采购订单'),
        '客户订单', '居间订单'),
        '居间贸易采购', '居间采购'),
        '居间贸易收货', '居间收货'),
        '居间贸易送货', '居间送货'),
        '居间贸易签收', '居间签收'),
        '往来款收款单', '往来收款'),
        '往来款付款单', '往来付款'),
        '费用报销单', '费用报销'),
        '其它收入单', '其他收入'),
        '其他收入单', '其他收入');

-- +goose Down
-- +goose StatementBegin
DO $$
BEGIN
    RAISE EXCEPTION
        'migration 00022 is irreversible; restore the database backup and previous image';
END
$$;
-- +goose StatementEnd

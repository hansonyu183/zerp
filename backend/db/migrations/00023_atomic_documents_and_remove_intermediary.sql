-- +goose Up
-- Atomic vouchers are independently authorized and keep only one optional
-- direct-parent reference. Workflow topology remains in wfl_process_documents.

CREATE TEMP TABLE removed_intermediary_files ON COMMIT DROP AS
SELECT DISTINCT f.id, f.storage_key
FROM vou_files f
JOIN vou_document_attachments a ON a.file_id = f.id
JOIN vou_documents d ON d.id = a.document_id
WHERE d.entity IN (
    'customer-order', 'procurement-order', 'goods-receipt',
    'delivery-note', 'signoff-note'
);

DELETE FROM wfl_audit_events
WHERE process_id IN (
    SELECT id FROM wfl_process_instances WHERE process_type = 'INTERMEDIARY_TRADE'
);
DELETE FROM wfl_process_documents
WHERE process_id IN (
    SELECT id FROM wfl_process_instances WHERE process_type = 'INTERMEDIARY_TRADE'
);
DELETE FROM wfl_process_instances WHERE process_type = 'INTERMEDIARY_TRADE';

DELETE FROM led_inventory_entries
WHERE source_entity IN (
    'customer-order', 'procurement-order', 'goods-receipt',
    'delivery-note', 'signoff-note'
);
DELETE FROM led_fund_entries
WHERE source_entity IN (
    'customer-order', 'procurement-order', 'goods-receipt',
    'delivery-note', 'signoff-note'
);
DELETE FROM led_party_entries
WHERE source_entity IN (
    'customer-order', 'procurement-order', 'goods-receipt',
    'delivery-note', 'signoff-note',
    'intermediary-receipt', 'intermediary-signoff'
);
DELETE FROM led_container_entries
WHERE source_entity IN (
    'customer-order', 'procurement-order', 'goods-receipt',
    'delivery-note', 'signoff-note', 'intermediary-signoff'
);

DELETE FROM vou_audit_events
WHERE document_id IN (
    SELECT id FROM vou_documents WHERE entity IN (
        'customer-order', 'procurement-order', 'goods-receipt',
        'delivery-note', 'signoff-note'
    )
);
DELETE FROM vou_document_attachments
WHERE document_id IN (
    SELECT id FROM vou_documents WHERE entity IN (
        'customer-order', 'procurement-order', 'goods-receipt',
        'delivery-note', 'signoff-note'
    )
);
DELETE FROM vou_download_tokens
WHERE file_id IN (SELECT id FROM removed_intermediary_files);
DELETE FROM vou_files
WHERE id IN (SELECT id FROM removed_intermediary_files)
  AND NOT EXISTS (
      SELECT 1 FROM vou_document_attachments a WHERE a.file_id = vou_files.id
  );

DELETE FROM vou_signoff_note_lines;
DELETE FROM vou_signoff_note_details;
DELETE FROM vou_delivery_note_lines;
DELETE FROM vou_delivery_note_details;
DELETE FROM vou_goods_receipt_lines;
DELETE FROM vou_goods_receipt_details;
DELETE FROM vou_procurement_order_lines;
DELETE FROM vou_procurement_order_details;
DELETE FROM vou_customer_order_lines;
DELETE FROM vou_customer_order_details;
DELETE FROM vou_documents
WHERE entity IN (
    'customer-order', 'procurement-order', 'goods-receipt',
    'delivery-note', 'signoff-note'
);
DELETE FROM vou_number_counters
WHERE entity IN (
    'customer-order', 'procurement-order', 'goods-receipt',
    'delivery-note', 'signoff-note'
);

DROP TABLE vou_signoff_note_lines;
DROP TABLE vou_signoff_note_details;
DROP TABLE vou_delivery_note_lines;
DROP TABLE vou_delivery_note_details;
DROP TABLE vou_goods_receipt_lines;
DROP TABLE vou_goods_receipt_details;
DROP TABLE vou_procurement_order_lines;
DROP TABLE vou_procurement_order_details;
DROP TABLE vou_customer_order_lines;
DROP TABLE vou_customer_order_details;

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

DROP INDEX IF EXISTS vou_sales_auto_draft_uq;
DROP TRIGGER IF EXISTS vou_wfl_parent_ck ON vou_documents;
DROP FUNCTION IF EXISTS vou_validate_wfl_parent();

ALTER TABLE vou_documents ADD COLUMN parent_entity varchar(32);
UPDATE vou_documents child
SET parent_entity = parent.entity
FROM vou_documents parent
WHERE parent.id = child.parent_document_id;

ALTER TABLE vou_documents
    DROP CONSTRAINT vou_documents_entity_check,
    DROP CONSTRAINT vou_documents_status_ck,
    DROP CONSTRAINT vou_documents_status_audit_ck;

UPDATE vou_documents
SET status = 'APPROVED', completed_at = NULL
WHERE status IN ('COMPLETED', 'SHORT_CLOSE_REQUESTED', 'SHORT_CLOSED');

ALTER TABLE vou_documents
    ADD CONSTRAINT vou_documents_entity_check CHECK (entity IN (
        'sale-order', 'sale-outbound', 'sale-delivery', 'sale-signoff',
        'purchase-order', 'purchase-inbound',
        'receipt', 'payment', 'expense-reimbursement', 'other-income'
    )),
    ADD CONSTRAINT vou_documents_parent_pair_ck CHECK (
        (parent_entity IS NULL) = (parent_document_id IS NULL)
    ),
    ADD CONSTRAINT vou_documents_status_ck CHECK (
        status IN ('DRAFT', 'CHECKED', 'APPROVED', 'FINALIZED')
    ),
    ADD CONSTRAINT vou_documents_status_audit_ck CHECK (
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
    );

-- +goose StatementBegin
CREATE FUNCTION vou_validate_parent() RETURNS trigger AS $$
DECLARE actual_entity varchar(32);
BEGIN
    IF TG_OP = 'UPDATE'
       AND (NEW.parent_entity, NEW.parent_document_id)
           IS DISTINCT FROM (OLD.parent_entity, OLD.parent_document_id) THEN
        RAISE EXCEPTION 'document parent is immutable';
    END IF;
    IF NEW.parent_document_id IS NULL THEN
        RETURN NEW;
    END IF;
    IF NEW.parent_document_id = NEW.id THEN
        RAISE EXCEPTION 'document cannot reference itself as parent';
    END IF;
    SELECT entity INTO actual_entity
    FROM vou_documents
    WHERE id = NEW.parent_document_id;
    IF actual_entity IS NULL OR actual_entity <> NEW.parent_entity THEN
        RAISE EXCEPTION 'parent document does not match parent entity';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
-- +goose StatementEnd

CREATE CONSTRAINT TRIGGER vou_parent_ck
    AFTER INSERT OR UPDATE OF parent_entity,parent_document_id ON vou_documents
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION vou_validate_parent();

ALTER TABLE vou_documents
    DROP COLUMN control_domain,
    DROP COLUMN auto_generated,
    DROP COLUMN workflow_version;

ALTER TABLE wfl_process_instances
    DROP CONSTRAINT wfl_process_instances_process_type_check,
    ADD CONSTRAINT wfl_process_instances_process_type_check
        CHECK (process_type IN ('SALES_FULFILLMENT', 'PURCHASE_FULFILLMENT'));
ALTER TABLE wfl_process_documents
    DROP CONSTRAINT wfl_process_documents_stage_check,
    ADD CONSTRAINT wfl_process_documents_stage_check CHECK (stage IN (
        'SALE_ORDER', 'OUTBOUND', 'DELIVERY', 'SIGNOFF',
        'PURCHASE_ORDER', 'INBOUND'
    ));

DELETE FROM app_role_permissions
WHERE permission_id IN (
    SELECT id FROM app_permissions
    WHERE (domain = 'vou' AND entity IN (
        'customer-order', 'procurement-order', 'goods-receipt',
        'delivery-note', 'signoff-note'
    )) OR (domain = 'wfl' AND entity = 'intermediary-trade')
);
DELETE FROM app_permissions
WHERE (domain = 'vou' AND entity IN (
    'customer-order', 'procurement-order', 'goods-receipt',
    'delivery-note', 'signoff-note'
)) OR (domain = 'wfl' AND entity = 'intermediary-trade');

DELETE FROM app_role_permissions
WHERE permission_id IN (
    SELECT id FROM app_permissions
    WHERE domain = 'vou' AND action LIKE 'short-close-%'
);
DELETE FROM app_permissions
WHERE domain = 'vou' AND action LIKE 'short-close-%';

WITH entities(entity, label, can_create) AS (
    VALUES
        ('sale-order','销售订单',true),
        ('sale-outbound','销售出库',false),
        ('sale-delivery','销售送货',false),
        ('sale-signoff','销售签收',false),
        ('purchase-order','采购订单',true),
        ('purchase-inbound','采购入库',true),
        ('receipt','往来收款',true),
        ('payment','往来付款',true),
        ('expense-reimbursement','费用报销',true),
        ('other-income','其他收入',true)
), actions(action, verb) AS (
    VALUES
        ('query','查询'),('get','查看'),('create','创建'),('save','保存'),
        ('delete','删除草稿'),('check','核对'),('uncheck','反核对'),
        ('approve','批准'),('unapprove','反批准'),
        ('finalize','最终处理'),('unfinalize','反最终处理'),
        ('audit-history','查看审计'),
        ('attachment-initiate','发起附件上传'),
        ('attachment-download','下载附件'),
        ('attachment-remove','移除附件')
)
INSERT INTO app_permissions(id,path,domain,entity,action,description,status)
SELECT '01' || upper(substring(md5('/vou/' || e.entity || '/' || a.action),1,24)),
       '/vou/' || e.entity || '/' || a.action,
       'vou',e.entity,a.action,a.verb || e.label,'ENABLED'
FROM entities e CROSS JOIN actions a
WHERE a.action <> 'create' OR e.can_create
ON CONFLICT (path) DO UPDATE
SET description = EXCLUDED.description, status = 'ENABLED';

WITH mappings(source_path, target_path) AS (
    VALUES
        ('/wfl/sales-fulfillment/create','/vou/sale-order/create'),
        ('/wfl/sales-fulfillment/save','/vou/sale-order/save'),
        ('/wfl/sales-fulfillment/check','/vou/sale-order/check'),
        ('/wfl/sales-fulfillment/uncheck','/vou/sale-order/uncheck'),
        ('/wfl/sales-fulfillment/approve','/vou/sale-order/approve'),
        ('/wfl/sales-fulfillment/unapprove','/vou/sale-order/unapprove'),
        ('/wfl/purchase-fulfillment/create','/vou/purchase-order/create'),
        ('/wfl/purchase-fulfillment/save','/vou/purchase-order/save'),
        ('/wfl/purchase-fulfillment/check','/vou/purchase-order/check'),
        ('/wfl/purchase-fulfillment/uncheck','/vou/purchase-order/uncheck'),
        ('/wfl/purchase-fulfillment/approve','/vou/purchase-order/approve'),
        ('/wfl/purchase-fulfillment/unapprove','/vou/purchase-order/unapprove'),
        ('/wfl/purchase-fulfillment/inbound-create','/vou/purchase-inbound/create'),
        ('/wfl/purchase-fulfillment/inbound-save','/vou/purchase-inbound/save'),
        ('/wfl/purchase-fulfillment/inbound-delete','/vou/purchase-inbound/delete'),
        ('/wfl/purchase-fulfillment/inbound-check','/vou/purchase-inbound/check'),
        ('/wfl/purchase-fulfillment/inbound-uncheck','/vou/purchase-inbound/uncheck'),
        ('/wfl/purchase-fulfillment/inbound-approve','/vou/purchase-inbound/approve'),
        ('/wfl/purchase-fulfillment/inbound-unapprove','/vou/purchase-inbound/unapprove'),
        ('/wfl/purchase-fulfillment/inbound-finalize','/vou/purchase-inbound/finalize'),
        ('/wfl/purchase-fulfillment/inbound-unfinalize','/vou/purchase-inbound/unfinalize')
)
INSERT INTO app_role_permissions(role_id,permission_id,created_by)
SELECT DISTINCT rp.role_id,target.id,rp.created_by
FROM mappings m
JOIN app_permissions source ON source.path=m.source_path
JOIN app_role_permissions rp ON rp.permission_id=source.id
JOIN app_permissions target ON target.path=m.target_path
ON CONFLICT DO NOTHING;

DELETE FROM app_role_permissions
WHERE permission_id IN (
    SELECT id FROM app_permissions
    WHERE domain='wfl'
      AND entity IN ('sales-fulfillment','purchase-fulfillment')
      AND action NOT IN (
          'query','get','audit-history',
          'short-close-request','short-close-cancel',
          'short-close-confirm','short-close-unconfirm'
      )
);
DELETE FROM app_permissions
WHERE domain='wfl'
  AND entity IN ('sales-fulfillment','purchase-fulfillment')
  AND action NOT IN (
      'query','get','audit-history',
      'short-close-request','short-close-cancel',
      'short-close-confirm','short-close-unconfirm'
  );

CREATE TEMP TABLE migration_wfl_role_permissions ON COMMIT DROP AS
SELECT rp.role_id,p.entity,p.action,rp.created_by
FROM app_role_permissions rp
JOIN app_permissions p ON p.id=rp.permission_id
WHERE p.domain='wfl'
  AND p.entity IN ('sales-fulfillment','purchase-fulfillment');

DELETE FROM app_role_permissions
WHERE permission_id IN (
    SELECT id FROM app_permissions
    WHERE domain='wfl'
      AND entity IN ('sales-fulfillment','purchase-fulfillment')
);

UPDATE app_permissions
SET id = '01' || upper(substring(md5(path),1,24))
WHERE domain='wfl'
  AND entity IN ('sales-fulfillment','purchase-fulfillment');

INSERT INTO app_role_permissions(role_id,permission_id,created_by)
SELECT saved.role_id,current.id,saved.created_by
FROM migration_wfl_role_permissions saved
JOIN app_permissions current
  ON current.domain='wfl'
 AND current.entity=saved.entity
 AND current.action=saved.action
ON CONFLICT DO NOTHING;

DELETE FROM app_role_permissions
WHERE permission_id IN (
    SELECT id FROM app_permissions
    WHERE domain='vou'
      AND entity IN ('sale-outbound','sale-delivery','sale-signoff')
      AND action='create'
);
DELETE FROM app_permissions
WHERE domain='vou'
  AND entity IN ('sale-outbound','sale-delivery','sale-signoff')
  AND action='create';

INSERT INTO app_role_permissions(role_id,permission_id,created_by)
SELECT r.id,p.id,r.updated_by
FROM app_roles r CROSS JOIN app_permissions p
WHERE r.code='superadmin'
  AND (
      (p.domain='vou' AND p.entity IN (
          'sale-order','sale-outbound','sale-delivery','sale-signoff',
          'purchase-order','purchase-inbound','receipt','payment',
          'expense-reimbursement','other-income'
      ))
      OR (p.domain='wfl' AND p.entity IN (
          'sales-fulfillment','purchase-fulfillment'
      ))
  )
ON CONFLICT DO NOTHING;

-- +goose Down
-- +goose StatementBegin
DO $$
BEGIN
    RAISE EXCEPTION
        'migration 00023 is irreversible; restore database, attachments, and previous image';
END
$$;
-- +goose StatementEnd

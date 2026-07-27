-- +goose Up
ALTER TABLE wfl_process_instances
    DROP CONSTRAINT wfl_process_instances_process_type_check,
    ADD CONSTRAINT wfl_process_instances_process_type_check
        CHECK (process_type IN ('INTERMEDIARY_TRADE', 'SALES_FULFILLMENT'));

ALTER TABLE wfl_process_documents
    DROP CONSTRAINT wfl_process_documents_stage_check,
    ADD CONSTRAINT wfl_process_documents_stage_check
        CHECK (stage IN (
            'CUSTOMER_ORDER', 'PROCUREMENT', 'RECEIPT', 'DELIVERY', 'SIGNOFF',
            'SALE_ORDER', 'OUTBOUND'
        ));

ALTER TABLE vou_documents
    ADD COLUMN auto_generated boolean NOT NULL DEFAULT false;

CREATE UNIQUE INDEX vou_sales_auto_draft_uq
    ON vou_documents(parent_document_id, entity)
    WHERE control_domain = 'WFL' AND auto_generated AND status = 'DRAFT';

ALTER TABLE vou_sale_outbound_details
    ALTER COLUMN warehouse_object_id DROP NOT NULL,
    ALTER COLUMN warehouse_version_id DROP NOT NULL,
    ALTER COLUMN warehouse_code DROP NOT NULL,
    ALTER COLUMN warehouse_name DROP NOT NULL,
    ADD CONSTRAINT vou_sale_outbound_warehouse_draft_ck CHECK (
        (warehouse_object_id IS NULL AND warehouse_version_id IS NULL
            AND warehouse_code IS NULL AND warehouse_name IS NULL)
        OR
        (warehouse_object_id IS NOT NULL AND warehouse_version_id IS NOT NULL
            AND warehouse_code IS NOT NULL AND warehouse_name IS NOT NULL)
    );

ALTER TABLE vou_sale_delivery_details
    ALTER COLUMN platform_object_id DROP NOT NULL,
    ALTER COLUMN platform_version_id DROP NOT NULL,
    ALTER COLUMN platform_code DROP NOT NULL,
    ALTER COLUMN platform_name DROP NOT NULL,
    ALTER COLUMN vehicle_object_id DROP NOT NULL,
    ALTER COLUMN vehicle_version_id DROP NOT NULL,
    ALTER COLUMN vehicle_code DROP NOT NULL,
    ALTER COLUMN vehicle_name DROP NOT NULL,
    ALTER COLUMN vehicle_plate_number DROP NOT NULL,
    ADD CONSTRAINT vou_sale_delivery_transport_draft_ck CHECK (
        (platform_object_id IS NULL AND platform_version_id IS NULL
            AND platform_code IS NULL AND platform_name IS NULL
            AND vehicle_object_id IS NULL AND vehicle_version_id IS NULL
            AND vehicle_code IS NULL AND vehicle_name IS NULL
            AND vehicle_plate_number IS NULL)
        OR
        (platform_object_id IS NOT NULL AND platform_version_id IS NOT NULL
            AND platform_code IS NOT NULL AND platform_name IS NOT NULL
            AND vehicle_object_id IS NOT NULL AND vehicle_version_id IS NOT NULL
            AND vehicle_code IS NOT NULL AND vehicle_name IS NOT NULL
            AND vehicle_plate_number IS NOT NULL)
    );

ALTER TABLE vou_documents
    DROP CONSTRAINT vou_documents_status_ck,
    DROP CONSTRAINT vou_documents_status_audit_ck;

ALTER TABLE vou_documents
    ADD CONSTRAINT vou_documents_status_ck CHECK (
        (control_domain = 'VOU' AND status IN ('DRAFT', 'CHECKED', 'APPROVED', 'FINALIZED'))
        OR
        (control_domain = 'WFL' AND workflow_version = 1
            AND status IN ('DRAFT', 'REVIEWED', 'APPROVED', 'EXECUTED'))
        OR
        (control_domain = 'WFL' AND workflow_version = 2
            AND entity IN ('sale-order', 'sale-outbound', 'sale-delivery', 'sale-signoff')
            AND status IN ('DRAFT', 'CHECKED', 'APPROVED', 'FINALIZED'))
        OR
        (workflow_version = 2 AND entity = 'intermediary-sale-order'
            AND status IN ('DRAFT', 'CHECKED', 'APPROVED', 'COMPLETED',
                           'SHORT_CLOSE_REQUESTED', 'SHORT_CLOSED'))
    ),
    ADD CONSTRAINT vou_documents_status_audit_ck CHECK (
        ((control_domain = 'VOU'
            OR (control_domain = 'WFL' AND workflow_version = 2
                AND entity IN ('sale-order', 'sale-outbound', 'sale-delivery', 'sale-signoff')))
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
        OR
        (workflow_version = 2 AND entity = 'intermediary-sale-order'
            AND reviewed_at IS NULL AND reviewed_by IS NULL
            AND executed_at IS NULL AND executed_by IS NULL AND (
                (status = 'DRAFT' AND checked_at IS NULL AND checked_by IS NULL
                    AND approved_at IS NULL AND approved_by IS NULL AND completed_at IS NULL)
                OR
                (status = 'CHECKED' AND checked_at IS NOT NULL AND checked_by IS NOT NULL
                    AND approved_at IS NULL AND approved_by IS NULL AND completed_at IS NULL)
                OR
                (status IN ('APPROVED', 'SHORT_CLOSE_REQUESTED')
                    AND checked_at IS NOT NULL AND checked_by IS NOT NULL
                    AND approved_at IS NOT NULL AND approved_by IS NOT NULL
                    AND completed_at IS NULL)
                OR
                (status IN ('COMPLETED', 'SHORT_CLOSED')
                    AND checked_at IS NOT NULL AND checked_by IS NOT NULL
                    AND approved_at IS NOT NULL AND approved_by IS NOT NULL
                    AND completed_at IS NOT NULL)
            ))
    );

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
    IF NEW.entity IN ('customer-order', 'sale-order') AND NEW.parent_document_id IS NULL THEN
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
       OR (NEW.entity = 'sale-signoff' AND parent_entity = 'sale-delivery') THEN
        RETURN NEW;
    END IF;
    RAISE EXCEPTION 'invalid WFL document parent';
END;
$$ LANGUAGE plpgsql;
-- +goose StatementEnd

-- Existing valid sales chains become managed workflow instances without changing
-- their document ids, numbers, revisions, or audit history.
-- +goose StatementBegin
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM vou_documents child
        LEFT JOIN vou_documents parent ON parent.id = child.parent_document_id
        WHERE child.entity IN ('sale-outbound', 'sale-delivery', 'sale-signoff')
          AND (
            parent.id IS NULL
            OR (child.entity = 'sale-outbound' AND parent.entity <> 'sale-order')
            OR (child.entity = 'sale-delivery' AND parent.entity <> 'sale-outbound')
            OR (child.entity = 'sale-signoff' AND parent.entity <> 'sale-delivery')
          )
    ) THEN
        RAISE EXCEPTION 'cannot backfill invalid sales fulfillment chain'
            USING ERRCODE = 'P0001';
    END IF;
END
$$;
-- +goose StatementEnd

INSERT INTO wfl_process_instances(
    id, process_type, definition_version, root_document_id, status, revision,
    created_at, created_by, updated_at, updated_by, completed_at
)
SELECT d.id, 'SALES_FULFILLMENT', 1, d.id,
       CASE
           WHEN o.fulfillment_status = 'FULFILLED' THEN 'COMPLETED'
           WHEN o.fulfillment_status = 'SHORT_CLOSE_REQUESTED' THEN 'SHORT_CLOSE_REQUESTED'
           WHEN o.fulfillment_status = 'SHORT_CLOSED' THEN 'SHORT_CLOSED'
           WHEN d.status = 'DRAFT' THEN 'DRAFT'
           WHEN d.status = 'CHECKED' THEN 'CHECKED'
           ELSE 'APPROVED'
       END,
       d.revision, d.created_at, d.created_by, d.updated_at, d.updated_by,
       CASE WHEN o.fulfillment_status IN ('FULFILLED', 'SHORT_CLOSED')
            THEN d.updated_at ELSE NULL END
FROM vou_documents d
JOIN vou_sale_order_details o ON o.document_id = d.id
WHERE d.entity = 'sale-order'
ON CONFLICT (root_document_id) DO NOTHING;

INSERT INTO wfl_process_documents(process_id, document_id, stage, sequence_no)
SELECT d.id, d.id, 'SALE_ORDER', 1
FROM vou_documents d
WHERE d.entity = 'sale-order'
ON CONFLICT DO NOTHING;

WITH outbound AS (
    SELECT o.source_order_id AS process_id, o.document_id,
           row_number() OVER (
               PARTITION BY o.source_order_id
               ORDER BY d.created_at, d.id
           )::integer AS sequence_no
    FROM vou_sale_outbound_details o
    JOIN vou_documents d ON d.id = o.document_id
)
INSERT INTO wfl_process_documents(process_id, document_id, stage, sequence_no)
SELECT process_id, document_id, 'OUTBOUND', sequence_no FROM outbound
ON CONFLICT DO NOTHING;

WITH delivery AS (
    SELECT o.source_order_id AS process_id, x.document_id,
           row_number() OVER (
               PARTITION BY o.source_order_id
               ORDER BY d.created_at, d.id
           )::integer AS sequence_no
    FROM vou_sale_delivery_details x
    JOIN vou_sale_outbound_details o ON o.document_id = x.source_outbound_id
    JOIN vou_documents d ON d.id = x.document_id
)
INSERT INTO wfl_process_documents(process_id, document_id, stage, sequence_no)
SELECT process_id, document_id, 'DELIVERY', sequence_no FROM delivery
ON CONFLICT DO NOTHING;

WITH signoff AS (
    SELECT x.source_order_id AS process_id, x.document_id,
           row_number() OVER (
               PARTITION BY x.source_order_id
               ORDER BY d.created_at, d.id
           )::integer AS sequence_no
    FROM vou_sale_signoff_details x
    JOIN vou_documents d ON d.id = x.document_id
)
INSERT INTO wfl_process_documents(process_id, document_id, stage, sequence_no)
SELECT process_id, document_id, 'SIGNOFF', sequence_no FROM signoff
ON CONFLICT DO NOTHING;

-- Mirror the existing voucher audit trail into the process history while
-- retaining the original voucher events for read compatibility.
INSERT INTO wfl_audit_events(
    id, process_id, event_type, from_status, to_status, stage,
    document_id, document_no, document_status, actor_id, occurred_at,
    reason, request_id, summary
)
SELECT a.id, x.process_id, a.event_type, a.from_status, a.to_status, x.stage,
       a.document_id, d.document_no, a.to_status, a.actor_id, a.occurred_at,
       a.reason, a.request_id, a.summary
FROM vou_audit_events a
JOIN wfl_process_documents x ON x.document_id = a.document_id
JOIN wfl_process_instances p ON p.id = x.process_id
JOIN vou_documents d ON d.id = a.document_id
WHERE p.process_type = 'SALES_FULFILLMENT'
ON CONFLICT DO NOTHING;

UPDATE vou_documents
SET control_domain = 'WFL', workflow_version = 2
WHERE entity IN ('sale-order', 'sale-outbound', 'sale-delivery', 'sale-signoff');

WITH actions(action, description) AS (
    VALUES
        ('query','查询销售履约流程'),('get','查看销售履约流程'),
        ('create','创建销售履约流程'),('save','保存销售订单'),
        ('check','核对销售订单'),('uncheck','反核对销售订单'),
        ('approve','批准销售订单'),('unapprove','反批准销售订单'),
        ('finalize','完成销售订单'),('unfinalize','撤销完成销售订单'),
        ('audit-history','查看销售履约审计'),
        ('short-close-request','申请销售履约短结'),
        ('short-close-cancel','取消销售履约短结申请'),
        ('short-close-confirm','确认销售履约短结'),
        ('short-close-unconfirm','撤销销售履约短结'),
        ('outbound-get','查看销售出库单'),('outbound-save','保存销售出库单'),
        ('outbound-check','核对销售出库单'),('outbound-uncheck','反核对销售出库单'),
        ('outbound-approve','批准销售出库单'),('outbound-unapprove','反批准销售出库单'),
        ('outbound-finalize','完成销售出库单'),('outbound-unfinalize','撤销完成销售出库单'),
        ('delivery-get','查看销售配送单'),('delivery-save','保存销售配送单'),
        ('delivery-check','核对销售配送单'),('delivery-uncheck','反核对销售配送单'),
        ('delivery-approve','批准销售配送单'),('delivery-unapprove','反批准销售配送单'),
        ('delivery-finalize','完成销售配送单'),('delivery-unfinalize','撤销完成销售配送单'),
        ('signoff-get','查看销售签收单'),('signoff-save','保存销售签收单'),
        ('signoff-check','核对销售签收单'),('signoff-uncheck','反核对销售签收单'),
        ('signoff-approve','批准销售签收单'),('signoff-unapprove','反批准销售签收单'),
        ('signoff-finalize','完成销售签收单'),('signoff-unfinalize','撤销完成销售签收单')
)
INSERT INTO app_permissions(id,path,domain,entity,action,description,status)
SELECT 'WS' || substring(md5('/wfl/sales-fulfillment/' || action),1,24),
       '/wfl/sales-fulfillment/' || action,
       'wfl','sales-fulfillment',action,description,'ENABLED'
FROM actions;

WITH mapping(wfl_action, vou_entity, vou_action) AS (
    VALUES
        ('query','sale-order','query'),('get','sale-order','get'),
        ('create','sale-order','create'),('save','sale-order','save'),
        ('check','sale-order','check'),('uncheck','sale-order','uncheck'),
        ('approve','sale-order','approve'),('unapprove','sale-order','unapprove'),
        ('finalize','sale-order','finalize'),('unfinalize','sale-order','unfinalize'),
        ('audit-history','sale-order','audit-history'),
        ('short-close-request','sale-order','short-close-request'),
        ('short-close-cancel','sale-order','short-close-cancel'),
        ('short-close-confirm','sale-order','short-close-confirm'),
        ('short-close-unconfirm','sale-order','short-close-unconfirm'),
        ('outbound-get','sale-outbound','get'),('outbound-save','sale-outbound','save'),
        ('outbound-check','sale-outbound','check'),('outbound-uncheck','sale-outbound','uncheck'),
        ('outbound-approve','sale-outbound','approve'),('outbound-unapprove','sale-outbound','unapprove'),
        ('outbound-finalize','sale-outbound','finalize'),('outbound-unfinalize','sale-outbound','unfinalize'),
        ('delivery-get','sale-delivery','get'),('delivery-save','sale-delivery','save'),
        ('delivery-check','sale-delivery','check'),('delivery-uncheck','sale-delivery','uncheck'),
        ('delivery-approve','sale-delivery','approve'),('delivery-unapprove','sale-delivery','unapprove'),
        ('delivery-finalize','sale-delivery','finalize'),('delivery-unfinalize','sale-delivery','unfinalize'),
        ('signoff-get','sale-signoff','get'),('signoff-save','sale-signoff','save'),
        ('signoff-check','sale-signoff','check'),('signoff-uncheck','sale-signoff','uncheck'),
        ('signoff-approve','sale-signoff','approve'),('signoff-unapprove','sale-signoff','unapprove'),
        ('signoff-finalize','sale-signoff','finalize'),('signoff-unfinalize','sale-signoff','unfinalize')
)
INSERT INTO app_role_permissions(role_id, permission_id, created_by)
SELECT DISTINCT rp.role_id, target.id, rp.created_by
FROM mapping m
JOIN app_permissions source
  ON source.domain = 'vou' AND source.entity = m.vou_entity
 AND source.action = m.vou_action
JOIN app_role_permissions rp ON rp.permission_id = source.id
JOIN app_permissions target
  ON target.path = '/wfl/sales-fulfillment/' || m.wfl_action
ON CONFLICT DO NOTHING;

INSERT INTO app_role_permissions(role_id, permission_id, created_by)
SELECT r.id, p.id, r.updated_by
FROM app_roles r
CROSS JOIN app_permissions p
WHERE r.code = 'superadmin' AND p.entity = 'sales-fulfillment'
ON CONFLICT DO NOTHING;

-- +goose Down
-- +goose StatementBegin
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM vou_documents
        WHERE control_domain = 'WFL'
          AND entity IN ('sale-order', 'sale-outbound', 'sale-delivery', 'sale-signoff')
          AND auto_generated
    ) THEN
        RAISE EXCEPTION 'cannot roll back sales fulfillment while generated drafts exist';
    END IF;
END
$$;
-- +goose StatementEnd

DELETE FROM app_role_permissions
WHERE permission_id IN (
    SELECT id FROM app_permissions
    WHERE domain = 'wfl' AND entity = 'sales-fulfillment'
);
DELETE FROM app_permissions
WHERE domain = 'wfl' AND entity = 'sales-fulfillment';

UPDATE vou_documents
SET control_domain = 'VOU', workflow_version = 1
WHERE control_domain = 'WFL'
  AND entity IN ('sale-order', 'sale-outbound', 'sale-delivery', 'sale-signoff');

ALTER TABLE vou_documents
    DROP CONSTRAINT vou_documents_status_ck,
    DROP CONSTRAINT vou_documents_status_audit_ck,
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
                AND approved_at IS NULL AND approved_by IS NULL
                AND executed_at IS NULL AND executed_by IS NULL)
            OR (status = 'CHECKED' AND reviewed_at IS NOT NULL AND reviewed_by IS NOT NULL
                AND approved_at IS NULL AND approved_by IS NULL
                AND executed_at IS NULL AND executed_by IS NULL)
            OR (status = 'APPROVED' AND reviewed_at IS NOT NULL AND reviewed_by IS NOT NULL
                AND approved_at IS NOT NULL AND approved_by IS NOT NULL
                AND executed_at IS NULL AND executed_by IS NULL)
            OR (status = 'FINALIZED' AND reviewed_at IS NOT NULL AND reviewed_by IS NOT NULL
                AND approved_at IS NOT NULL AND approved_by IS NOT NULL
                AND executed_at IS NOT NULL AND executed_by IS NOT NULL)
        ))
        OR (control_domain = 'WFL' AND workflow_version = 1 AND (
            (status = 'DRAFT' AND reviewed_at IS NULL AND reviewed_by IS NULL
                AND approved_at IS NULL AND approved_by IS NULL
                AND executed_at IS NULL AND executed_by IS NULL)
            OR (status = 'REVIEWED' AND reviewed_at IS NOT NULL AND reviewed_by IS NOT NULL
                AND approved_at IS NULL AND approved_by IS NULL
                AND executed_at IS NULL AND executed_by IS NULL)
            OR (status = 'APPROVED' AND reviewed_at IS NOT NULL AND reviewed_by IS NOT NULL
                AND approved_at IS NOT NULL AND approved_by IS NOT NULL
                AND executed_at IS NULL AND executed_by IS NULL)
            OR (status = 'EXECUTED' AND reviewed_at IS NOT NULL AND reviewed_by IS NOT NULL
                AND approved_at IS NOT NULL AND approved_by IS NOT NULL
                AND executed_at IS NOT NULL AND executed_by IS NOT NULL)
        ))
        OR (workflow_version = 2 AND entity = 'intermediary-sale-order'
            AND reviewed_at IS NULL AND reviewed_by IS NULL
            AND executed_at IS NULL AND executed_by IS NULL AND (
                (status = 'DRAFT' AND checked_at IS NULL AND checked_by IS NULL
                    AND approved_at IS NULL AND approved_by IS NULL AND completed_at IS NULL)
                OR (status = 'CHECKED' AND checked_at IS NOT NULL AND checked_by IS NOT NULL
                    AND approved_at IS NULL AND approved_by IS NULL AND completed_at IS NULL)
                OR (status IN ('APPROVED', 'SHORT_CLOSE_REQUESTED')
                    AND checked_at IS NOT NULL AND checked_by IS NOT NULL
                    AND approved_at IS NOT NULL AND approved_by IS NOT NULL
                    AND completed_at IS NULL)
                OR (status IN ('COMPLETED', 'SHORT_CLOSED')
                    AND checked_at IS NOT NULL AND checked_by IS NOT NULL
                    AND approved_at IS NOT NULL AND approved_by IS NOT NULL
                    AND completed_at IS NOT NULL)
            ))
    );

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

DELETE FROM wfl_process_documents
WHERE process_id IN (
    SELECT id FROM wfl_process_instances WHERE process_type = 'SALES_FULFILLMENT'
);
DELETE FROM wfl_audit_events
WHERE process_id IN (
    SELECT id FROM wfl_process_instances WHERE process_type = 'SALES_FULFILLMENT'
);
DELETE FROM wfl_process_instances WHERE process_type = 'SALES_FULFILLMENT';

DROP INDEX vou_sales_auto_draft_uq;
ALTER TABLE vou_documents DROP COLUMN auto_generated;

ALTER TABLE vou_sale_delivery_details
    DROP CONSTRAINT vou_sale_delivery_transport_draft_ck,
    ALTER COLUMN platform_object_id SET NOT NULL,
    ALTER COLUMN platform_version_id SET NOT NULL,
    ALTER COLUMN platform_code SET NOT NULL,
    ALTER COLUMN platform_name SET NOT NULL,
    ALTER COLUMN vehicle_object_id SET NOT NULL,
    ALTER COLUMN vehicle_version_id SET NOT NULL,
    ALTER COLUMN vehicle_code SET NOT NULL,
    ALTER COLUMN vehicle_name SET NOT NULL,
    ALTER COLUMN vehicle_plate_number SET NOT NULL;

ALTER TABLE vou_sale_outbound_details
    DROP CONSTRAINT vou_sale_outbound_warehouse_draft_ck,
    ALTER COLUMN warehouse_object_id SET NOT NULL,
    ALTER COLUMN warehouse_version_id SET NOT NULL,
    ALTER COLUMN warehouse_code SET NOT NULL,
    ALTER COLUMN warehouse_name SET NOT NULL;

ALTER TABLE wfl_process_documents
    DROP CONSTRAINT wfl_process_documents_stage_check,
    ADD CONSTRAINT wfl_process_documents_stage_check
        CHECK (stage IN ('CUSTOMER_ORDER', 'PROCUREMENT', 'RECEIPT', 'DELIVERY', 'SIGNOFF'));

ALTER TABLE wfl_process_instances
    DROP CONSTRAINT wfl_process_instances_process_type_check,
    ADD CONSTRAINT wfl_process_instances_process_type_check
        CHECK (process_type = 'INTERMEDIARY_TRADE');

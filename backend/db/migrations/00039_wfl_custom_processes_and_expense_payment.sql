-- +goose Up

ALTER TABLE vou_documents
    DROP CONSTRAINT vou_documents_entity_check,
    ADD CONSTRAINT vou_documents_entity_check CHECK (entity IN (
        'sale-pricing', 'sale-order', 'sale-outbound', 'sale-delivery', 'sale-signoff', 'sale-return',
        'purchase-inquiry', 'purchase-order', 'purchase-inbound', 'purchase-return',
        'order-production', 'self-production',
        'receipt', 'payment', 'expense-reimbursement', 'expense-payment', 'other-income',
        'customer-order', 'procurement-order', 'goods-receipt', 'delivery-note', 'signoff-note'
    ));

ALTER TABLE vou_expense_reimbursement_details
    ADD COLUMN settlement_mode varchar(16) NOT NULL DEFAULT 'LEGACY_DIRECT'
        CHECK (settlement_mode IN ('LEGACY_DIRECT', 'FLOW_PAYMENT')),
    ALTER COLUMN fund_account_object_id DROP NOT NULL,
    ALTER COLUMN fund_account_version_id DROP NOT NULL,
    ALTER COLUMN fund_account_code DROP NOT NULL,
    ALTER COLUMN fund_account_name DROP NOT NULL;
ALTER TABLE vou_expense_reimbursement_details
    ALTER COLUMN settlement_mode SET DEFAULT 'FLOW_PAYMENT';

CREATE TABLE vou_expense_payment_details (
    document_id varchar(26) PRIMARY KEY,
    entity varchar(32) NOT NULL DEFAULT 'expense-payment' CHECK (entity = 'expense-payment'),
    source_reimbursement_id varchar(26) NOT NULL UNIQUE
        REFERENCES vou_expense_reimbursement_details(document_id) ON DELETE RESTRICT,
    employee_object_id varchar(26) NOT NULL,
    employee_version_id varchar(26) NOT NULL,
    employee_code varchar(64) NOT NULL,
    employee_name varchar(200) NOT NULL,
    fund_account_object_id varchar(26) NOT NULL,
    fund_account_version_id varchar(26) NOT NULL,
    fund_account_code varchar(64) NOT NULL,
    fund_account_name varchar(200) NOT NULL,
    FOREIGN KEY (document_id, entity) REFERENCES vou_documents(id, entity) ON DELETE RESTRICT
);

-- +goose StatementBegin
CREATE OR REPLACE FUNCTION vou_validate_document_detail() RETURNS trigger AS $$
DECLARE target_id varchar(26); detail_count integer;
BEGIN
    IF TG_TABLE_NAME = 'vou_documents' THEN target_id := CASE WHEN TG_OP='DELETE' THEN OLD.id ELSE NEW.id END;
    ELSE target_id := CASE WHEN TG_OP='DELETE' THEN OLD.document_id ELSE NEW.document_id END; END IF;
    IF NOT EXISTS (SELECT 1 FROM vou_documents WHERE id=target_id) THEN RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END; END IF;
    SELECT (SELECT count(*) FROM vou_sale_pricing_details WHERE document_id=target_id)
         + (SELECT count(*) FROM vou_purchase_inquiry_details WHERE document_id=target_id)
         + (SELECT count(*) FROM vou_sale_order_details WHERE document_id=target_id)
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
         + (SELECT count(*) FROM vou_expense_payment_details WHERE document_id=target_id)
         + (SELECT count(*) FROM vou_other_income_details WHERE document_id=target_id) INTO detail_count;
    IF detail_count<>1 THEN RAISE EXCEPTION 'VOU document must have exactly one typed detail row' USING ERRCODE='23514'; END IF;
    RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END;
$$ LANGUAGE plpgsql;
-- +goose StatementEnd

CREATE CONSTRAINT TRIGGER vou_expense_payment_detail_ck
    AFTER INSERT OR UPDATE OR DELETE ON vou_expense_payment_details
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION vou_validate_document_detail();

CREATE TABLE wfl_process_definitions (
    id varchar(26) PRIMARY KEY,
    code varchar(64) NOT NULL UNIQUE CHECK (code ~ '^[a-z][a-z0-9-]{1,62}[a-z0-9]$'),
    name varchar(100) NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 100),
    status varchar(16) NOT NULL CHECK (status IN ('DRAFT', 'ENABLED', 'DISABLED')),
    revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
    root_node_id varchar(26),
    start_condition jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    created_by varchar(26) NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now(),
    updated_by varchar(26) NOT NULL
);

CREATE TABLE wfl_definition_nodes (
    id varchar(26) PRIMARY KEY,
    definition_id varchar(26) NOT NULL REFERENCES wfl_process_definitions(id) ON DELETE RESTRICT,
    node_key varchar(64) NOT NULL,
    name varchar(100) NOT NULL,
    document_entity varchar(32) NOT NULL CHECK (document_entity NOT IN (
        'sale-pricing', 'purchase-inquiry', 'other-income'
    )),
    position_x integer NOT NULL DEFAULT 0,
    position_y integer NOT NULL DEFAULT 0,
    defaults jsonb NOT NULL DEFAULT '{}'::jsonb,
    archived boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE wfl_definition_edges (
    id varchar(26) PRIMARY KEY,
    definition_id varchar(26) NOT NULL REFERENCES wfl_process_definitions(id) ON DELETE RESTRICT,
    source_node_id varchar(26) NOT NULL REFERENCES wfl_definition_nodes(id) ON DELETE RESTRICT,
    target_node_id varchar(26) NOT NULL REFERENCES wfl_definition_nodes(id) ON DELETE RESTRICT,
    converter_key varchar(64) NOT NULL,
    condition jsonb NOT NULL DEFAULT '{}'::jsonb,
    archived boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK (source_node_id <> target_node_id)
);

CREATE TABLE wfl_definition_instances (
    id varchar(26) PRIMARY KEY,
    definition_id varchar(26) NOT NULL REFERENCES wfl_process_definitions(id) ON DELETE RESTRICT,
    root_document_id varchar(26) NOT NULL REFERENCES vou_documents(id) ON DELETE CASCADE,
    status varchar(16) NOT NULL CHECK (status IN ('ACTIVE', 'COMPLETED')),
    revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
    started_definition_revision bigint NOT NULL CHECK (started_definition_revision > 0),
    created_at timestamptz NOT NULL DEFAULT now(),
    created_by varchar(26) NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now(),
    updated_by varchar(26) NOT NULL,
    completed_at timestamptz,
    UNIQUE(definition_id, root_document_id)
);
CREATE INDEX wfl_definition_instances_query_idx
    ON wfl_definition_instances(status, updated_at DESC, id DESC);

CREATE TABLE wfl_node_instances (
    id varchar(26) PRIMARY KEY,
    process_id varchar(26) NOT NULL REFERENCES wfl_definition_instances(id) ON DELETE CASCADE,
    definition_node_id varchar(26) REFERENCES wfl_definition_nodes(id) ON DELETE SET NULL,
    parent_node_instance_id varchar(26) REFERENCES wfl_node_instances(id) ON DELETE SET NULL,
    document_id varchar(26) NOT NULL REFERENCES vou_documents(id) ON DELETE CASCADE,
    node_key varchar(64) NOT NULL,
    node_name varchar(100) NOT NULL,
    document_entity varchar(32) NOT NULL,
    evaluated_definition_revision bigint,
    evaluated_at timestamptz,
    legacy boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE(process_id, definition_node_id, document_id)
);
CREATE INDEX wfl_node_instances_document_idx ON wfl_node_instances(document_id);

CREATE TABLE wfl_edge_executions (
    process_id varchar(26) NOT NULL REFERENCES wfl_definition_instances(id) ON DELETE CASCADE,
    source_node_instance_id varchar(26) NOT NULL REFERENCES wfl_node_instances(id) ON DELETE CASCADE,
    edge_id varchar(26) NOT NULL REFERENCES wfl_definition_edges(id) ON DELETE RESTRICT,
    matched boolean NOT NULL,
    target_node_instance_id varchar(26) REFERENCES wfl_node_instances(id) ON DELETE SET NULL,
    definition_revision bigint NOT NULL,
    executed_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY(process_id, source_node_instance_id, edge_id)
);

CREATE TABLE wfl_runtime_audit_events (
    id varchar(26) PRIMARY KEY,
    process_id varchar(26) NOT NULL REFERENCES wfl_definition_instances(id) ON DELETE CASCADE,
    event_type varchar(48) NOT NULL,
    node_instance_id varchar(26) REFERENCES wfl_node_instances(id) ON DELETE SET NULL,
    document_id varchar(26),
    document_no varchar(32),
    actor_id varchar(26) NOT NULL,
    request_id varchar(128) NOT NULL,
    summary jsonb NOT NULL DEFAULT '{}'::jsonb,
    occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX wfl_runtime_audit_history_idx
    ON wfl_runtime_audit_events(process_id, occurred_at DESC, id DESC);

INSERT INTO wfl_process_definitions(id,code,name,status,created_by,updated_by)
VALUES
    ('WFD' || substring(md5('sales-fulfillment'),1,23), 'sales-fulfillment', '销售履约', 'ENABLED',
     '01JAPPSYST3MACTR0000000000', '01JAPPSYST3MACTR0000000000'),
    ('WFD' || substring(md5('purchase-fulfillment'),1,23), 'purchase-fulfillment', '采购履约', 'ENABLED',
     '01JAPPSYST3MACTR0000000000', '01JAPPSYST3MACTR0000000000'),
    ('WFD' || substring(md5('expense-payment'),1,23), 'expense-payment', '费用报销付款', 'DRAFT',
     '01JAPPSYST3MACTR0000000000', '01JAPPSYST3MACTR0000000000');

INSERT INTO wfl_definition_nodes(id,definition_id,node_key,name,document_entity,position_x,position_y,defaults)
VALUES
    ('WFN' || substring(md5('sales-fulfillment:order'),1,23), 'WFD' || substring(md5('sales-fulfillment'),1,23), 'order', '销售订单', 'sale-order', 0, 120, '{}'),
    ('WFN' || substring(md5('sales-fulfillment:outbound'),1,23), 'WFD' || substring(md5('sales-fulfillment'),1,23), 'outbound', '销售出库', 'sale-outbound', 260, 120, '{}'),
    ('WFN' || substring(md5('sales-fulfillment:delivery'),1,23), 'WFD' || substring(md5('sales-fulfillment'),1,23), 'delivery', '销售送货', 'sale-delivery', 520, 120, '{}'),
    ('WFN' || substring(md5('sales-fulfillment:signoff'),1,23), 'WFD' || substring(md5('sales-fulfillment'),1,23), 'signoff', '销售签收', 'sale-signoff', 780, 120, '{}'),
    ('WFN' || substring(md5('purchase-fulfillment:order'),1,23), 'WFD' || substring(md5('purchase-fulfillment'),1,23), 'order', '采购订单', 'purchase-order', 0, 120, '{}'),
    ('WFN' || substring(md5('purchase-fulfillment:inbound'),1,23), 'WFD' || substring(md5('purchase-fulfillment'),1,23), 'inbound', '采购入库', 'purchase-inbound', 280, 120, '{}'),
    ('WFN' || substring(md5('expense-payment:reimbursement'),1,23), 'WFD' || substring(md5('expense-payment'),1,23), 'reimbursement', '费用报销', 'expense-reimbursement', 0, 120, '{}'),
    ('WFN' || substring(md5('expense-payment:payment'),1,23), 'WFD' || substring(md5('expense-payment'),1,23), 'payment', '费用付款', 'expense-payment', 300, 120, '{}');

UPDATE wfl_process_definitions SET root_node_id=CASE code
    WHEN 'sales-fulfillment' THEN 'WFN' || substring(md5('sales-fulfillment:order'),1,23)
    WHEN 'purchase-fulfillment' THEN 'WFN' || substring(md5('purchase-fulfillment:order'),1,23)
    WHEN 'expense-payment' THEN 'WFN' || substring(md5('expense-payment:reimbursement'),1,23)
END;
ALTER TABLE wfl_process_definitions ALTER COLUMN root_node_id SET NOT NULL;

INSERT INTO wfl_definition_edges(id,definition_id,source_node_id,target_node_id,converter_key)
VALUES
    ('WFE' || substring(md5('sales:order-outbound'),1,23), 'WFD' || substring(md5('sales-fulfillment'),1,23), 'WFN' || substring(md5('sales-fulfillment:order'),1,23), 'WFN' || substring(md5('sales-fulfillment:outbound'),1,23), 'sale-order-to-outbound'),
    ('WFE' || substring(md5('sales:outbound-delivery'),1,23), 'WFD' || substring(md5('sales-fulfillment'),1,23), 'WFN' || substring(md5('sales-fulfillment:outbound'),1,23), 'WFN' || substring(md5('sales-fulfillment:delivery'),1,23), 'sale-outbound-to-delivery'),
    ('WFE' || substring(md5('sales:delivery-signoff'),1,23), 'WFD' || substring(md5('sales-fulfillment'),1,23), 'WFN' || substring(md5('sales-fulfillment:delivery'),1,23), 'WFN' || substring(md5('sales-fulfillment:signoff'),1,23), 'sale-delivery-to-signoff'),
    ('WFE' || substring(md5('purchase:order-inbound'),1,23), 'WFD' || substring(md5('purchase-fulfillment'),1,23), 'WFN' || substring(md5('purchase-fulfillment:order'),1,23), 'WFN' || substring(md5('purchase-fulfillment:inbound'),1,23), 'purchase-order-to-inbound'),
    ('WFE' || substring(md5('expense:reimbursement-payment'),1,23), 'WFD' || substring(md5('expense-payment'),1,23), 'WFN' || substring(md5('expense-payment:reimbursement'),1,23), 'WFN' || substring(md5('expense-payment:payment'),1,23), 'expense-reimbursement-to-payment');

-- Preserve current workflow history in the new read model. Legacy auxiliary
-- nodes remain visible but are excluded from generic completion decisions.
INSERT INTO wfl_definition_instances(
    id,definition_id,root_document_id,status,revision,started_definition_revision,
    created_at,created_by,updated_at,updated_by,completed_at
)
SELECT p.id,
       CASE p.process_type
         WHEN 'SALES_FULFILLMENT' THEN 'WFD' || substring(md5('sales-fulfillment'),1,23)
         ELSE 'WFD' || substring(md5('purchase-fulfillment'),1,23)
       END,
       p.root_document_id,
       CASE WHEN p.status IN ('COMPLETED','SHORT_CLOSED') THEN 'COMPLETED' ELSE 'ACTIVE' END,
       p.revision,1,p.created_at,p.created_by,p.updated_at,p.updated_by,
       CASE WHEN p.status IN ('COMPLETED','SHORT_CLOSED') THEN COALESCE(p.completed_at,p.updated_at) END
FROM wfl_process_instances p
WHERE p.process_type IN ('SALES_FULFILLMENT','PURCHASE_FULFILLMENT')
ON CONFLICT DO NOTHING;

INSERT INTO wfl_node_instances(
    id,process_id,definition_node_id,parent_node_instance_id,document_id,node_key,node_name,
    document_entity,legacy,created_at
)
SELECT 'WNI' || substring(md5(x.process_id || ':' || x.document_id),1,23),
       x.process_id,
       n.id,
       NULL,
       x.document_id,
       lower(x.stage),
       COALESCE(n.name,x.stage),
       d.entity,
       n.id IS NULL,
       x.created_at
FROM wfl_process_documents x
JOIN vou_documents d ON d.id=x.document_id
LEFT JOIN wfl_process_definitions def ON def.id=(
    SELECT definition_id FROM wfl_definition_instances WHERE id=x.process_id
)
LEFT JOIN wfl_definition_nodes n ON n.definition_id=def.id AND n.document_entity=d.entity
WHERE EXISTS (SELECT 1 FROM wfl_definition_instances i WHERE i.id=x.process_id)
ON CONFLICT DO NOTHING;

UPDATE wfl_node_instances child
SET parent_node_instance_id=parent.id
FROM vou_documents document, wfl_node_instances parent
WHERE child.document_id=document.id
  AND document.parent_document_id IS NOT NULL
  AND parent.document_id=document.parent_document_id
  AND parent.process_id=child.process_id;

INSERT INTO app_permissions(id,path,domain,entity,action,description,status)
SELECT 'WD' || substring(md5('/wfl/' || definition.code || '/' || permission.action),1,24),
       '/wfl/' || definition.code || '/' || permission.action,
       'wfl',definition.code,permission.action,permission.label || definition.name || '流程','ENABLED'
FROM wfl_process_definitions definition
CROSS JOIN (VALUES
    ('query','查询'),('get','读取'),('audit-history','查询审计')
) AS permission(action,label)
WHERE definition.status='ENABLED'
ON CONFLICT (path) DO UPDATE SET
    domain='wfl',entity=excluded.entity,action=excluded.action,
    description=excluded.description,status='ENABLED',updated_at=now();

INSERT INTO app_permissions(id,path,domain,entity,action,description,status)
SELECT 'WG' || substring(md5('/wfl/' || entity || '/' || action),1,24),
       '/wfl/' || entity || '/' || action,
       'wfl',entity,action,description,'ENABLED'
FROM (VALUES
    ('process-definition','query','查询流程定义'),
    ('process-definition','get','读取流程定义'),
    ('process-definition','create','新建流程定义'),
    ('process-definition','save','保存流程定义'),
    ('process-definition','enable','启用流程定义'),
    ('process-definition','disable','停用流程定义'),
    ('process-definition','delete','删除流程定义'),
    ('process-definition','catalog','读取流程配置目录'),
    ('process-instance','query','查询流程实例'),
    ('process-instance','get','读取流程实例'),
    ('process-instance','audit-history','查询流程实例审计')
) AS permission(entity,action,description)
ON CONFLICT (path) DO NOTHING;

INSERT INTO app_permissions(id,path,domain,entity,action,description,status)
SELECT 'VE' || substring(md5('/vou/expense-payment/' || action),1,24),
       '/vou/expense-payment/' || action,
       'vou','expense-payment',action,description,'ENABLED'
FROM (VALUES
    ('query','查询费用付款'),('get','读取费用付款'),('save','保存费用付款'),
    ('delete','删除费用付款'),('check','核对费用付款'),('uncheck','撤销核对费用付款'),
    ('approve','批准费用付款'),('unapprove','撤销批准费用付款'),
    ('finalize','最终处理费用付款'),('unfinalize','撤销最终处理费用付款'),
    ('audit-history','查询费用付款审计'),
    ('attachment-initiate','发起费用付款附件上传'),
    ('attachment-download','下载费用付款附件'),
    ('attachment-remove','删除费用付款附件')
) AS permission(action,description)
ON CONFLICT (path) DO NOTHING;

-- +goose Down

-- +goose StatementBegin
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM vou_documents WHERE entity = 'expense-payment'
        UNION ALL
        SELECT 1 FROM vou_expense_reimbursement_details WHERE settlement_mode = 'FLOW_PAYMENT'
        UNION ALL
        SELECT 1 FROM wfl_runtime_audit_events
        UNION ALL
        SELECT 1 FROM wfl_process_definitions
        WHERE code NOT IN ('sales-fulfillment', 'purchase-fulfillment', 'expense-payment')
           OR revision <> 1
           OR status <> CASE code
               WHEN 'sales-fulfillment' THEN 'ENABLED'
               WHEN 'purchase-fulfillment' THEN 'ENABLED'
               WHEN 'expense-payment' THEN 'DRAFT'
           END
    ) THEN
        RAISE EXCEPTION
            'cannot roll back configurable workflows while new workflow or expense-payment data exists; keep the current schema or restore a pre-migration backup';
    END IF;
END
$$;
-- +goose StatementEnd

DELETE FROM app_role_permissions WHERE permission_id IN (
    SELECT id FROM app_permissions
    WHERE (domain='wfl' AND entity IN ('process-definition','process-instance'))
       OR (domain='vou' AND entity='expense-payment')
);
DELETE FROM app_permissions
WHERE (domain='wfl' AND entity IN ('process-definition','process-instance'))
   OR (domain='vou' AND entity='expense-payment');
DROP TABLE wfl_runtime_audit_events;
DROP TABLE wfl_edge_executions;
DROP TABLE wfl_node_instances;
DROP TABLE wfl_definition_instances;
DROP TABLE wfl_definition_edges;
DROP TABLE wfl_definition_nodes;
DROP TABLE wfl_process_definitions;
DROP TRIGGER vou_expense_payment_detail_ck ON vou_expense_payment_details;
-- +goose StatementBegin
CREATE OR REPLACE FUNCTION vou_validate_document_detail() RETURNS trigger AS $$
DECLARE target_id varchar(26); detail_count integer;
BEGIN
    IF TG_TABLE_NAME = 'vou_documents' THEN target_id := CASE WHEN TG_OP='DELETE' THEN OLD.id ELSE NEW.id END;
    ELSE target_id := CASE WHEN TG_OP='DELETE' THEN OLD.document_id ELSE NEW.document_id END; END IF;
    IF NOT EXISTS (SELECT 1 FROM vou_documents WHERE id=target_id) THEN RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END; END IF;
    SELECT (SELECT count(*) FROM vou_sale_pricing_details WHERE document_id=target_id)
         + (SELECT count(*) FROM vou_purchase_inquiry_details WHERE document_id=target_id)
         + (SELECT count(*) FROM vou_sale_order_details WHERE document_id=target_id)
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
DROP TABLE vou_expense_payment_details;
ALTER TABLE vou_expense_reimbursement_details
    DROP COLUMN settlement_mode,
    ALTER COLUMN fund_account_object_id SET NOT NULL,
    ALTER COLUMN fund_account_version_id SET NOT NULL,
    ALTER COLUMN fund_account_code SET NOT NULL,
    ALTER COLUMN fund_account_name SET NOT NULL;
ALTER TABLE vou_documents
    DROP CONSTRAINT vou_documents_entity_check,
    ADD CONSTRAINT vou_documents_entity_check CHECK (entity IN (
        'sale-pricing', 'sale-order', 'sale-outbound', 'sale-delivery', 'sale-signoff', 'sale-return',
        'purchase-inquiry', 'purchase-order', 'purchase-inbound', 'purchase-return',
        'order-production', 'self-production',
        'receipt', 'payment', 'expense-reimbursement', 'other-income',
        'customer-order', 'procurement-order', 'goods-receipt', 'delivery-note', 'signoff-note'
    ));

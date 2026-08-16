-- +goose Up

ALTER TABLE vou_expense_reimbursement_details
    DROP COLUMN settlement_mode,
    DROP COLUMN fund_account_object_id,
    DROP COLUMN fund_account_version_id,
    DROP COLUMN fund_account_code,
    DROP COLUMN fund_account_name;

-- The historical reservation DDL is removed for fresh schemas so sqlc does not
-- retain a dead model. Existing installations still need an explicit upgrade.
DROP TABLE IF EXISTS vou_settlement_reservations;

DROP TABLE IF EXISTS wfl_edge_executions CASCADE;
DROP TABLE IF EXISTS wfl_runtime_audit_events CASCADE;
DROP TABLE IF EXISTS wfl_node_instances CASCADE;
DROP TABLE IF EXISTS wfl_definition_instances CASCADE;
DROP TABLE IF EXISTS wfl_definition_edges CASCADE;
DROP TABLE IF EXISTS wfl_definition_nodes CASCADE;
DROP TABLE IF EXISTS wfl_process_definitions CASCADE;

DROP TABLE IF EXISTS wfl_audit_events CASCADE;
DROP TABLE IF EXISTS wfl_process_documents CASCADE;
DROP TABLE IF EXISTS wfl_process_instances CASCADE;

DELETE FROM app_role_permissions role_permission
USING app_permissions permission
WHERE role_permission.permission_id=permission.id
  AND permission.path='/vou/purchase-inbound/create';
DELETE FROM app_permissions WHERE path='/vou/purchase-inbound/create';

CREATE TABLE wfl_process_definitions (
    id varchar(26) PRIMARY KEY,
    code varchar(64) NOT NULL UNIQUE CHECK (code ~ '^[a-z][a-z0-9-]{1,62}[a-z0-9]$'),
    name varchar(100) NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 100),
    status varchar(16) NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','ENABLED','DISABLED')),
    revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
    draft_script text NOT NULL,
    draft_diagnostic text,
    draft_compiled jsonb NOT NULL,
    last_trial_revision bigint,
    published_revision bigint,
    created_at timestamptz NOT NULL DEFAULT now(),
    created_by varchar(26) NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now(),
    updated_by varchar(26) NOT NULL,
    CHECK (last_trial_revision IS NULL OR last_trial_revision <= revision),
    CHECK (published_revision IS NULL OR published_revision > 0)
);

CREATE TABLE wfl_definition_revisions (
    definition_id varchar(26) NOT NULL REFERENCES wfl_process_definitions(id) ON DELETE RESTRICT,
    revision bigint NOT NULL CHECK (revision > 0),
    script text NOT NULL,
    compiled jsonb NOT NULL,
    published_at timestamptz NOT NULL DEFAULT now(),
    published_by varchar(26) NOT NULL,
    PRIMARY KEY (definition_id, revision)
);

CREATE TABLE wfl_definition_instances (
    id varchar(26) PRIMARY KEY,
    definition_id varchar(26) NOT NULL REFERENCES wfl_process_definitions(id) ON DELETE RESTRICT,
    root_document_id varchar(26) REFERENCES vou_documents(id) ON DELETE SET NULL,
    root_document_no varchar(32) NOT NULL,
    root_entity varchar(32) NOT NULL,
    party_object_id varchar(26),
    party_code varchar(64),
    party_name varchar(200),
    definition_code varchar(64) NOT NULL,
    definition_name varchar(100) NOT NULL,
    started_definition_revision bigint NOT NULL CHECK (started_definition_revision > 0),
    revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
    root_deleted_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    created_by varchar(26) NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now(),
    updated_by varchar(26) NOT NULL,
    UNIQUE(definition_id, root_document_id)
);
CREATE INDEX wfl_definition_instances_query_idx
    ON wfl_definition_instances(updated_at DESC, id DESC) WHERE root_deleted_at IS NULL;

CREATE TABLE wfl_node_instances (
    id varchar(26) PRIMARY KEY,
    process_id varchar(26) NOT NULL REFERENCES wfl_definition_instances(id) ON DELETE RESTRICT,
    parent_node_instance_id varchar(26) REFERENCES wfl_node_instances(id) ON DELETE SET NULL,
    node_key varchar(64) NOT NULL,
    node_name varchar(100) NOT NULL,
    document_id varchar(26) REFERENCES vou_documents(id) ON DELETE SET NULL,
    document_no varchar(32) NOT NULL,
    document_entity varchar(32) NOT NULL,
    business_parent_entity varchar(32),
    business_parent_document_id varchar(26),
    relation_name varchar(64),
    trigger_event varchar(64) NOT NULL,
    action_name varchar(64),
    evaluated_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE(process_id, node_key, document_id)
);
CREATE INDEX wfl_node_instances_document_idx ON wfl_node_instances(document_id);

CREATE TABLE wfl_action_executions (
    id varchar(26) PRIMARY KEY,
    process_id varchar(26) NOT NULL REFERENCES wfl_definition_instances(id) ON DELETE RESTRICT,
    source_node_instance_id varchar(26) NOT NULL REFERENCES wfl_node_instances(id) ON DELETE RESTRICT,
    target_node_key varchar(64) NOT NULL,
    relation_name varchar(64) NOT NULL,
    action_name varchar(64) NOT NULL,
    action_fingerprint varchar(64) NOT NULL,
    target_node_instance_id varchar(26) REFERENCES wfl_node_instances(id) ON DELETE SET NULL,
    executed_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE(process_id, source_node_instance_id, action_fingerprint),
    UNIQUE(process_id, source_node_instance_id, target_node_key, relation_name)
);

CREATE TABLE wfl_create_child_requests (
    definition_id varchar(26) NOT NULL REFERENCES wfl_process_definitions(id) ON DELETE RESTRICT,
    request_key varchar(64) NOT NULL CHECK (length(request_key) BETWEEN 16 AND 64),
    process_id varchar(26) NOT NULL REFERENCES wfl_definition_instances(id) ON DELETE RESTRICT,
    parent_node_instance_id varchar(26) NOT NULL REFERENCES wfl_node_instances(id) ON DELETE RESTRICT,
    target_node_key varchar(64) NOT NULL,
    action_execution_id varchar(26) REFERENCES wfl_action_executions(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY(definition_id, request_key)
);

CREATE TABLE wfl_runtime_audit_events (
    id varchar(26) PRIMARY KEY,
    process_id varchar(26),
    definition_id varchar(26) NOT NULL,
    definition_revision bigint NOT NULL,
    event_type varchar(48) NOT NULL,
    node_instance_id varchar(26),
    document_id varchar(26),
    document_no varchar(32),
    actor_id varchar(26) NOT NULL,
    request_id varchar(128) NOT NULL,
    summary jsonb NOT NULL DEFAULT '{}'::jsonb,
    occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX wfl_runtime_audit_history_idx
    ON wfl_runtime_audit_events(process_id, occurred_at DESC, id DESC);

INSERT INTO wfl_process_definitions(
    id,code,name,draft_script,draft_compiled,created_by,updated_by
) VALUES
(
    'WFD' || substring(md5('expense-payment'),1,23),
    'expense-payment','费用报销付款',
    E'reimbursement = node(key="reimbursement", name="费用报销", entity="expense-reimbursement")\npayment = node(key="payment", name="费用付款", entity="expense-payment")\nworkflow(code="expense-payment", name="费用报销付款", root=reimbursement, edges=[edge(source=reimbursement, target=payment, relation="payment", action=expense_payment(initial={"fundAccountObjectId": ""}))])',
    '{"rootKey":"reimbursement","nodes":[{"key":"reimbursement","name":"费用报销","entity":"expense-reimbursement"},{"key":"payment","name":"费用付款","entity":"expense-payment"}],"edges":[{"sourceKey":"reimbursement","targetKey":"payment","actionName":"expense_payment","relation":"payment"}]}'::jsonb,
    '01JAPPSYST3MACTR0000000000','01JAPPSYST3MACTR0000000000'
),
(
    'WFD' || substring(md5('purchase-fulfillment'),1,23),
    'purchase-fulfillment','采购履约',
    E'purchase = node(key="purchase-order", name="采购订单", entity="purchase-order")\ninbound = node(key="purchase-inbound", name="采购入库", entity="purchase-inbound")\nworkflow(code="purchase-fulfillment", name="采购履约", root=purchase, edges=[edge(source=purchase, target=inbound, relation="inbound", action=purchase_inbound(initial={}))])',
    '{"rootKey":"purchase-order","nodes":[{"key":"purchase-order","name":"采购订单","entity":"purchase-order"},{"key":"purchase-inbound","name":"采购入库","entity":"purchase-inbound"}],"edges":[{"sourceKey":"purchase-order","targetKey":"purchase-inbound","actionName":"purchase_inbound","relation":"inbound"}]}'::jsonb,
    '01JAPPSYST3MACTR0000000000','01JAPPSYST3MACTR0000000000'
),
(
    'WFD' || substring(md5('sales-fulfillment'),1,23),
    'sales-fulfillment','销售履约',
    E'order = node(key="sale-order", name="销售订单", entity="sale-order")\noutbound = node(key="sale-outbound", name="销售出库", entity="sale-outbound")\ndelivery = node(key="sale-delivery", name="销售送货", entity="sale-delivery")\nsignoff = node(key="sale-signoff", name="销售签收", entity="sale-signoff")\nrefusal_return = node(key="sale-return", name="拒收退货", entity="sale-return")\nworkflow(code="sales-fulfillment", name="销售履约", root=order, edges=[edge(source=order, target=outbound, relation="outbound", action=sale_outbound(initial={})), edge(source=outbound, target=delivery, relation="delivery", action=sale_delivery(initial={"platformObjectId":"","vehicleObjectId":""})), edge(source=delivery, target=signoff, relation="signoff", action=sale_signoff(initial={})), edge(source=signoff, target=refusal_return, relation="refusal-return", action=sale_return(initial={}))])',
    '{"rootKey":"sale-order","nodes":[{"key":"sale-order","name":"销售订单","entity":"sale-order"},{"key":"sale-outbound","name":"销售出库","entity":"sale-outbound"},{"key":"sale-delivery","name":"销售送货","entity":"sale-delivery"},{"key":"sale-signoff","name":"销售签收","entity":"sale-signoff"},{"key":"sale-return","name":"拒收退货","entity":"sale-return"}],"edges":[{"sourceKey":"sale-order","targetKey":"sale-outbound","actionName":"sale_outbound","relation":"outbound"},{"sourceKey":"sale-outbound","targetKey":"sale-delivery","actionName":"sale_delivery","relation":"delivery"},{"sourceKey":"sale-delivery","targetKey":"sale-signoff","actionName":"sale_signoff","relation":"signoff"},{"sourceKey":"sale-signoff","targetKey":"sale-return","actionName":"sale_return","relation":"refusal-return"}]}'::jsonb,
    '01JAPPSYST3MACTR0000000000','01JAPPSYST3MACTR0000000000'
);

DELETE FROM app_role_permissions role_permission
USING app_permissions permission
WHERE role_permission.permission_id=permission.id
  AND permission.domain='wfl'
  AND permission.path NOT IN (
      '/wfl/process-definition/query',
      '/wfl/process-definition/get',
      '/wfl/process-definition/create',
      '/wfl/process-definition/save',
      '/wfl/process-definition/trial',
      '/wfl/process-definition/publish',
      '/wfl/process-definition/enable',
      '/wfl/process-definition/disable',
      '/wfl/process-definition/delete',
      '/wfl/process-instance/query',
      '/wfl/process-instance/get',
      '/wfl/process-instance/audit-history'
  );
DELETE FROM app_permissions
WHERE domain='wfl'
  AND path NOT IN (
      '/wfl/process-definition/query',
      '/wfl/process-definition/get',
      '/wfl/process-definition/create',
      '/wfl/process-definition/save',
      '/wfl/process-definition/trial',
      '/wfl/process-definition/publish',
      '/wfl/process-definition/enable',
      '/wfl/process-definition/disable',
      '/wfl/process-definition/delete',
      '/wfl/process-instance/query',
      '/wfl/process-instance/get',
      '/wfl/process-instance/audit-history'
  );
INSERT INTO app_permissions(id,path,domain,entity,action,description,status)
SELECT 'WG' || substring(md5('/wfl/' || entity || '/' || action),1,24),
       '/wfl/' || entity || '/' || action,'wfl',entity,action,description,'ENABLED'
FROM (VALUES
    ('process-definition','query','查询流程定义'),
    ('process-definition','get','读取流程定义'),
    ('process-definition','create','新建流程定义'),
    ('process-definition','save','保存流程定义'),
    ('process-definition','trial','试算流程定义'),
    ('process-definition','publish','发布流程定义'),
    ('process-definition','enable','启用流程定义'),
    ('process-definition','disable','停用流程定义'),
    ('process-definition','delete','删除流程定义'),
    ('process-instance','query','查询流程实例'),
    ('process-instance','get','读取流程实例'),
    ('process-instance','audit-history','查询流程实例审计')
) AS permission(entity,action,description)
ON CONFLICT(path) DO UPDATE SET
    domain=excluded.domain,
    entity=excluded.entity,
    action=excluded.action,
    description=excluded.description,
    status='ENABLED',
    updated_at=now();

SELECT rpt_validate_current_reports();

-- +goose Down

SELECT 1;

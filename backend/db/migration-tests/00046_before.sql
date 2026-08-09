BEGIN;
SET CONSTRAINTS ALL DEFERRED;

INSERT INTO aux_objects(
    id,entity,code,current_version_id,enabled,next_version_no,revision,created_by,updated_by
) VALUES
 ('01J0000000000000000000461','settlement-method','SMT-0461','01J0000000000000000000462',true,2,1,'01JAPPSYST3MACTR0000000000','01JAPPSYST3MACTR0000000000'),
 ('01J0000000000000000000463','settlement-method','SMT-0463','01J0000000000000000000464',true,2,1,'01JAPPSYST3MACTR0000000000','01JAPPSYST3MACTR0000000000'),
 ('01J0000000000000000000482','settlement-method','SMT-0482','01J0000000000000000000483',true,2,1,'01JAPPSYST3MACTR0000000000','01JAPPSYST3MACTR0000000000');

INSERT INTO aux_versions(id,object_id,entity,version_no,data,created_by) VALUES
 ('01J0000000000000000000462','01J0000000000000000000461','settlement-method',1,
  '{"name":"迁移预付","ruleType":"DUE_DAYS","dueDays":30,"defaultSalesSurcharge":"9.99"}',
  '01JAPPSYST3MACTR0000000000'),
 ('01J0000000000000000000464','01J0000000000000000000463','settlement-method',1,
  '{"name":"迁移账期","ruleType":"DUE_DAYS","dueDays":4,"defaultSalesSurcharge":"9.99"}',
  '01JAPPSYST3MACTR0000000000'),
 ('01J0000000000000000000483','01J0000000000000000000482','settlement-method',1,
  '{"name":"重叠月结方式","ruleType":"MONTH_END","defaultSalesSurcharge":"0"}',
  '01JAPPSYST3MACTR0000000000');

INSERT INTO bob_objects(id,entity,code,current_version_id,next_version_no,revision,created_by,updated_by)
VALUES ('01J0000000000000000000465','employee','EMP-9046','01J0000000000000000000466',2,1,'01JAPPSYST3MACTR0000000000','01JAPPSYST3MACTR0000000000'),
       ('01J0000000000000000000467','customer','CUS-9046','01J0000000000000000000468',2,1,'01JAPPSYST3MACTR0000000000','01JAPPSYST3MACTR0000000000');

INSERT INTO bob_objects(
    id,entity,code,current_version_id,effective_version_id,enabled,
    next_version_no,revision,created_by,updated_by
) VALUES
 ('01J0000000000000000000469','settlement-method','STM-9046','01J0000000000000000000470','01J0000000000000000000470',true,2,1,'01JAPPSYST3MACTR0000000000','01JAPPSYST3MACTR0000000000'),
 ('01J0000000000000000000471','supplier','SUP-9046','01J0000000000000000000472',NULL,true,2,1,'01JAPPSYST3MACTR0000000000','01JAPPSYST3MACTR0000000000'),
 ('01J0000000000000000000482','settlement-method','STM-9047','01J0000000000000000000484','01J0000000000000000000484',true,2,1,'01JAPPSYST3MACTR0000000000','01JAPPSYST3MACTR0000000000');

INSERT INTO bob_versions(id,object_id,entity,version_no,status,revision,created_by,updated_by)
VALUES ('01J0000000000000000000466','01J0000000000000000000465','employee',1,'DRAFT',1,'01JAPPSYST3MACTR0000000000','01JAPPSYST3MACTR0000000000'),
       ('01J0000000000000000000468','01J0000000000000000000467','customer',1,'DRAFT',1,'01JAPPSYST3MACTR0000000000','01JAPPSYST3MACTR0000000000'),
       ('01J0000000000000000000472','01J0000000000000000000471','supplier',1,'DRAFT',1,'01JAPPSYST3MACTR0000000000','01JAPPSYST3MACTR0000000000');

INSERT INTO bob_versions(
    id,object_id,entity,version_no,status,revision,created_by,updated_by,
    submitted_at,submitted_by,reviewed_at,reviewed_by
) VALUES (
    '01J0000000000000000000470','01J0000000000000000000469','settlement-method',1,
    'EFFECTIVE',1,'01JAPPSYST3MACTR0000000000','01JAPPSYST3MACTR0000000000',
    now(),'01JAPPSYST3MACTR0000000000',now(),'01JAPPSYST3MACTR0000000001'
), (
    '01J0000000000000000000484','01J0000000000000000000482','settlement-method',1,
    'EFFECTIVE',1,'01JAPPSYST3MACTR0000000000','01JAPPSYST3MACTR0000000000',
    now(),'01JAPPSYST3MACTR0000000000',now(),'01JAPPSYST3MACTR0000000001'
);

INSERT INTO bob_employee_versions(version_id,name)
VALUES ('01J0000000000000000000466','迁移测试员工');
INSERT INTO bob_customer_versions(
    version_id,entity,name,customer_type,settlement_method_id,monthly_closing_day,salesperson_employee_id
) VALUES (
    '01J0000000000000000000468','customer','迁移测试客户','DIT-0001',
    '01J0000000000000000000463',31,'01J0000000000000000000465'
);
INSERT INTO bob_settlement_method_versions(
    version_id,name,rule_type,month_offset,day_offset
) VALUES (
    '01J0000000000000000000470','旧 BOB 月结 60 天','MONTH_END',2,0
), (
    '01J0000000000000000000484','旧 BOB 重叠月结 60 天','MONTH_END',2,0
);
INSERT INTO bob_supplier_versions(
    version_id,name,supplier_type,settlement_method_id,salesperson_employee_id
) VALUES (
    '01J0000000000000000000472','迁移测试供应商','GENERAL',
    '01J0000000000000000000469','01J0000000000000000000465'
);

INSERT INTO app_roles(id,code,name,status,created_by,updated_by)
VALUES (
    '01J0000000000000000000473','migration-00046-custom','迁移测试自定义角色','ENABLED',
    '01JAPPSYST3MACTR0000000000','01JAPPSYST3MACTR0000000000'
);

INSERT INTO app_role_permissions(role_id,permission_id,created_by)
SELECT '01J0000000000000000000473',permission.id,'01JAPPSYST3MACTR0000000000'
FROM app_permissions permission
WHERE permission.domain='aux' AND permission.entity='settlement-method'
  AND permission.action IN ('query','save','disable');

INSERT INTO vou_documents(
    id,entity,document_no,status,business_date,currency,total_amount_cents,
    reviewed_at,reviewed_by,approved_at,approved_by,created_by,updated_by
) VALUES
 ('01J0000000000000000000474','sale-order','SOR-20460101-0046','APPROVED',
  '2046-01-01','CNY',1000,now(),'01JAPPSYST3MACTR0000000000',now(),
  '01JAPPSYST3MACTR0000000000','01JAPPSYST3MACTR0000000000','01JAPPSYST3MACTR0000000000'),
 ('01J0000000000000000000475','purchase-order','POR-20460101-0046','APPROVED',
  '2046-01-01','CNY',2000,now(),'01JAPPSYST3MACTR0000000000',now(),
  '01JAPPSYST3MACTR0000000000','01JAPPSYST3MACTR0000000000','01JAPPSYST3MACTR0000000000'),
 ('01J0000000000000000000476','purchase-inbound','PIN-20460102-0046','APPROVED',
  '2046-01-02','CNY',500,now(),'01JAPPSYST3MACTR0000000000',now(),
  '01JAPPSYST3MACTR0000000000','01JAPPSYST3MACTR0000000000','01JAPPSYST3MACTR0000000000'),
 ('01J0000000000000000000477','purchase-return','PRT-20460103-0046','APPROVED',
  '2046-01-03','CNY',200,now(),'01JAPPSYST3MACTR0000000000',now(),
  '01JAPPSYST3MACTR0000000000','01JAPPSYST3MACTR0000000000','01JAPPSYST3MACTR0000000000'),
 ('01J0000000000000000000478','purchase-order','POR-20460101-0047','APPROVED',
  '2046-01-01','CNY',300,now(),'01JAPPSYST3MACTR0000000000',now(),
  '01JAPPSYST3MACTR0000000000','01JAPPSYST3MACTR0000000000','01JAPPSYST3MACTR0000000000'),
 ('01J0000000000000000000479','purchase-order','POR-20460101-0048','APPROVED',
  '2046-01-01','CNY',400,now(),'01JAPPSYST3MACTR0000000000',now(),
  '01JAPPSYST3MACTR0000000000','01JAPPSYST3MACTR0000000000','01JAPPSYST3MACTR0000000000');

INSERT INTO vou_sale_order_details(
    document_id,customer_object_id,customer_version_id,customer_code,customer_name,
    warehouse_object_id,warehouse_version_id,warehouse_code,warehouse_name,
    settlement_method_object_id,settlement_method_version_id,settlement_method_code,
    settlement_method_name,settlement_rule_type,settlement_month_offset,
    settlement_day_offset,settlement_due_days,fulfillment_status
) VALUES (
    '01J0000000000000000000474','01J0000000000000000000467',
    '01J0000000000000000000468','CUS-9046','迁移测试客户',
    '01J0000000000000000000480','01J0000000000000000000481','WAR-9046','迁移仓库',
    '01J0000000000000000000461','01J0000000000000000000462','SMT-0461',
    '迁移预付','DUE_DAYS',0,30,30,'OPEN'
);

INSERT INTO vou_purchase_order_details(
    document_id,supplier_object_id,supplier_version_id,supplier_code,supplier_name,
    warehouse_object_id,warehouse_version_id,warehouse_code,warehouse_name,
    settlement_method_object_id,settlement_method_version_id,settlement_method_code,
    settlement_method_name,settlement_rule_type,settlement_month_offset,
    settlement_day_offset,settlement_due_days,fulfillment_status
) VALUES
(
    '01J0000000000000000000475','01J0000000000000000000471',
    '01J0000000000000000000472','SUP-9046','迁移测试供应商',
    '01J0000000000000000000480','01J0000000000000000000481','WAR-9046','迁移仓库',
    '01J0000000000000000000463','01J0000000000000000000464','SMT-0463',
    '现结','DUE_DAYS',0,0,0,'OPEN'
),
(
    '01J0000000000000000000478','01J0000000000000000000471',
    '01J0000000000000000000472','SUP-9046','迁移测试供应商',
    '01J0000000000000000000480','01J0000000000000000000481','WAR-9046','迁移仓库',
    '01J0000000000000000000463','01J0000000000000000000464','SMT-0463',
    '现结','DUE_DAYS',0,0,0,'OPEN'
),
(
    '01J0000000000000000000479','01J0000000000000000000471',
    '01J0000000000000000000472','SUP-9046','迁移测试供应商',
    '01J0000000000000000000480','01J0000000000000000000481','WAR-9046','迁移仓库',
    '01J0000000000000000000463','01J0000000000000000000464','SMT-0463',
    '现结','DUE_DAYS',0,0,0,'FULFILLED'
);

INSERT INTO vou_purchase_inbound_details(
    document_id,source_order_id,supplier_object_id,supplier_version_id,
    supplier_code,supplier_name,warehouse_object_id,warehouse_version_id,
    warehouse_code,warehouse_name
) VALUES (
    '01J0000000000000000000476','01J0000000000000000000475',
    '01J0000000000000000000471','01J0000000000000000000472','SUP-9046',
    '迁移测试供应商','01J0000000000000000000480','01J0000000000000000000481',
    'WAR-9046','迁移仓库'
);

INSERT INTO vou_purchase_return_details(
    document_id,source_order_id,return_reason,supplier_object_id,supplier_version_id,
    supplier_code,supplier_name,warehouse_object_id,warehouse_version_id,
    warehouse_code,warehouse_name
) VALUES (
    '01J0000000000000000000477','01J0000000000000000000475','迁移回填测试',
    '01J0000000000000000000471','01J0000000000000000000472','SUP-9046',
    '迁移测试供应商','01J0000000000000000000480','01J0000000000000000000481',
    'WAR-9046','迁移仓库'
);

COMMIT;

BEGIN;
SET CONSTRAINTS ALL DEFERRED;

INSERT INTO aux_objects(
    id,entity,code,current_version_id,enabled,next_version_no,revision,created_by,updated_by
) VALUES
 ('01J0000000000000000000461','settlement-method','SMT-0461','01J0000000000000000000462',true,2,1,'01JAPPSYST3MACTR0000000000','01JAPPSYST3MACTR0000000000'),
 ('01J0000000000000000000463','settlement-method','SMT-0463','01J0000000000000000000464',true,2,1,'01JAPPSYST3MACTR0000000000','01JAPPSYST3MACTR0000000000');

INSERT INTO aux_versions(id,object_id,entity,version_no,data,created_by) VALUES
 ('01J0000000000000000000462','01J0000000000000000000461','settlement-method',1,
  '{"name":"迁移预付","ruleType":"DUE_DAYS","dueDays":30,"defaultSalesSurcharge":"9.99"}',
  '01JAPPSYST3MACTR0000000000'),
 ('01J0000000000000000000464','01J0000000000000000000463','settlement-method',1,
  '{"name":"迁移账期","ruleType":"DUE_DAYS","dueDays":4,"defaultSalesSurcharge":"9.99"}',
  '01JAPPSYST3MACTR0000000000');

INSERT INTO bob_objects(id,entity,code,current_version_id,next_version_no,revision,created_by,updated_by)
VALUES ('01J0000000000000000000465','employee','EMP-9046','01J0000000000000000000466',2,1,'01JAPPSYST3MACTR0000000000','01JAPPSYST3MACTR0000000000'),
       ('01J0000000000000000000467','customer','CUS-9046','01J0000000000000000000468',2,1,'01JAPPSYST3MACTR0000000000','01JAPPSYST3MACTR0000000000');

INSERT INTO bob_objects(
    id,entity,code,current_version_id,effective_version_id,enabled,
    next_version_no,revision,created_by,updated_by
) VALUES
 ('01J0000000000000000000469','settlement-method','STM-9046','01J0000000000000000000470','01J0000000000000000000470',true,2,1,'01JAPPSYST3MACTR0000000000','01JAPPSYST3MACTR0000000000'),
 ('01J0000000000000000000471','supplier','SUP-9046','01J0000000000000000000472',NULL,true,2,1,'01JAPPSYST3MACTR0000000000','01JAPPSYST3MACTR0000000000');

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

COMMIT;

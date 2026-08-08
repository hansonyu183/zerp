BEGIN;
SET CONSTRAINTS ALL DEFERRED;

INSERT INTO aux_objects (
    id, entity, code, current_version_id, enabled, next_version_no, revision,
    created_by, updated_by
) VALUES (
    '01J0000000000000000000451', 'settlement-method', 'SMT-0045',
    '01J0000000000000000000452', true, 2, 1,
    '01JAPPSYST3MACTR0000000000', '01JAPPSYST3MACTR0000000000'
);

INSERT INTO aux_versions (
    id, object_id, entity, version_no, data, created_by
) VALUES (
    '01J0000000000000000000452', '01J0000000000000000000451',
    'settlement-method', 1,
    '{"name":"迁移月结","ruleType":"MONTH_END","cutoffDay":20,"monthOffset":2,"defaultSalesSurcharge":"0.00"}'::jsonb,
    '01JAPPSYST3MACTR0000000000'
);

INSERT INTO bob_objects (
    id, entity, code, current_version_id, next_version_no, revision,
    created_by, updated_by
) VALUES
    ('01J0000000000000000000453', 'employee', 'EMP-0045',
     '01J0000000000000000000454', 2, 1,
     '01JAPPSYST3MACTR0000000000', '01JAPPSYST3MACTR0000000000'),
    ('01J0000000000000000000455', 'customer', 'CUS-0045',
     '01J0000000000000000000456', 2, 1,
     '01JAPPSYST3MACTR0000000000', '01JAPPSYST3MACTR0000000000');

INSERT INTO bob_versions (
    id, object_id, entity, version_no, status, revision, created_by, updated_by
) VALUES
    ('01J0000000000000000000454', '01J0000000000000000000453',
     'employee', 1, 'DRAFT', 1,
     '01JAPPSYST3MACTR0000000000', '01JAPPSYST3MACTR0000000000'),
    ('01J0000000000000000000456', '01J0000000000000000000455',
     'customer', 1, 'DRAFT', 1,
     '01JAPPSYST3MACTR0000000000', '01JAPPSYST3MACTR0000000000');

INSERT INTO bob_employee_versions (version_id, name)
VALUES ('01J0000000000000000000454', '迁移测试业务员');

INSERT INTO bob_customer_versions (
    version_id, entity, name, customer_type, settlement_method_id,
    salesperson_employee_id
) VALUES (
    '01J0000000000000000000456', 'customer', '迁移测试客户', 'DIT-0001',
    '01J0000000000000000000451', '01J0000000000000000000453'
);

COMMIT;

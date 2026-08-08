DO $$ BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name IN ('bob_objects', 'aux_objects', 'vou_documents')
          AND column_name = 'oit_id'
    ) THEN
        RAISE EXCEPTION 'oit_id exists before migration';
    END IF;
END $$;

BEGIN;
SET CONSTRAINTS ALL DEFERRED;
INSERT INTO bob_objects (id, entity, code, current_version_id, created_by, updated_by) VALUES
    ('00000000000000000000000001', 'warehouse', 'WHS-0001', '00000000000000000000000011', 'migration-fixture', 'migration-fixture'),
    ('00000000000000000000000002', 'warehouse', 'WHS-0002', '00000000000000000000000012', 'migration-fixture', 'migration-fixture'),
    ('00000000000000000000000003', 'fund-account', 'FAC-0001', '00000000000000000000000013', 'migration-fixture', 'migration-fixture'),
    ('00000000000000000000000004', 'warehouse', 'WHS-0004', '00000000000000000000000014', 'migration-fixture', 'migration-fixture');
INSERT INTO bob_versions (id, object_id, entity, version_no, status, created_by, updated_by) VALUES
    ('00000000000000000000000011', '00000000000000000000000001', 'warehouse', 1, 'DRAFT', 'migration-fixture', 'migration-fixture'),
    ('00000000000000000000000012', '00000000000000000000000002', 'warehouse', 1, 'DRAFT', 'migration-fixture', 'migration-fixture'),
    ('00000000000000000000000013', '00000000000000000000000003', 'fund-account', 1, 'DRAFT', 'migration-fixture', 'migration-fixture'),
    ('00000000000000000000000014', '00000000000000000000000004', 'warehouse', 1, 'DRAFT', 'migration-fixture', 'migration-fixture');
INSERT INTO bob_warehouse_versions (version_id, name) VALUES
    ('00000000000000000000000011', 'Fixture warehouse 1'),
    ('00000000000000000000000012', 'Fixture warehouse 2'),
    ('00000000000000000000000014', 'Fixture warehouse 4');
INSERT INTO bob_fund_account_versions (version_id, name, currency) VALUES
    ('00000000000000000000000013', 'Fixture fund account', 'CNY');
COMMIT;

BEGIN;
SET CONSTRAINTS ALL DEFERRED;
INSERT INTO aux_objects (id, entity, code, current_version_id, created_by, updated_by) VALUES
    ('00000000000000000000000101', 'product-category', 'PCT-0001', '00000000000000000000000111', 'migration-fixture', 'migration-fixture'),
    ('00000000000000000000000102', 'product-category', 'PCT-0002', '00000000000000000000000112', 'migration-fixture', 'migration-fixture'),
    ('00000000000000000000000103', 'department', 'DEP-0001', '00000000000000000000000113', 'migration-fixture', 'migration-fixture'),
    ('00000000000000000000000104', 'product-category', 'PCT-0004', '00000000000000000000000114', 'migration-fixture', 'migration-fixture');
INSERT INTO aux_versions (id, object_id, entity, version_no, data, created_by) VALUES
    ('00000000000000000000000111', '00000000000000000000000101', 'product-category', 1, '{}'::jsonb, 'migration-fixture'),
    ('00000000000000000000000112', '00000000000000000000000102', 'product-category', 1, '{}'::jsonb, 'migration-fixture'),
    ('00000000000000000000000113', '00000000000000000000000103', 'department', 1, '{}'::jsonb, 'migration-fixture'),
    ('00000000000000000000000114', '00000000000000000000000104', 'product-category', 1, '{}'::jsonb, 'migration-fixture');
COMMIT;

BEGIN;
SET CONSTRAINTS ALL DEFERRED;
INSERT INTO vou_documents (id, entity, document_no, business_date, currency, total_amount_cents, created_by, updated_by) VALUES
    ('00000000000000000000000201', 'other-income', 'OIN-20260101-0001', '2026-01-01', 'CNY', 1, 'migration-fixture', 'migration-fixture'),
    ('00000000000000000000000202', 'other-income', 'OIN-20260101-0002', '2026-01-01', 'CNY', 1, 'migration-fixture', 'migration-fixture'),
    ('00000000000000000000000203', 'expense-reimbursement', 'EXR-20260101-0003', '2026-01-01', 'CNY', 1, 'migration-fixture', 'migration-fixture'),
    ('00000000000000000000000204', 'other-income', 'OIN-20260101-0004', '2026-01-01', 'CNY', 1, 'migration-fixture', 'migration-fixture');
INSERT INTO vou_other_income_details (document_id, source_name, fund_account_object_id, fund_account_version_id, fund_account_code, fund_account_name) VALUES
    ('00000000000000000000000201', 'Fixture income 1', '00000000000000000000000003', '00000000000000000000000013', 'FAC-0001', 'Fixture fund account'),
    ('00000000000000000000000202', 'Fixture income 2', '00000000000000000000000003', '00000000000000000000000013', 'FAC-0001', 'Fixture fund account'),
    ('00000000000000000000000204', 'Fixture income 4', '00000000000000000000000003', '00000000000000000000000013', 'FAC-0001', 'Fixture fund account');
INSERT INTO vou_expense_reimbursement_details (document_id, employee_object_id, employee_version_id, employee_code, employee_name, fund_account_object_id, fund_account_version_id, fund_account_code, fund_account_name) VALUES
    ('00000000000000000000000203', '00000000000000000000000001', '00000000000000000000000011', 'WHS-0001', 'Fixture employee', '00000000000000000000000003', '00000000000000000000000013', 'FAC-0001', 'Fixture fund account');
COMMIT;

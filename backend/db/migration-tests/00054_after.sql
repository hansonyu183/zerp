DO $$
DECLARE
    target_table text;
    first_id varchar(26);
    second_id varchar(26);
    other_id varchar(26);
    same_entity text;
    other_entity text;
    fourth_id varchar(26);
    row_count bigint;
    exists_after_update boolean;
BEGIN
    IF (SELECT count(*) FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name IN ('bob_objects', 'aux_objects', 'vou_documents')
          AND column_name = 'oit_id') <> 3 THEN
        RAISE EXCEPTION 'oit_id is missing after migration';
    END IF;

    FOR target_table, first_id, second_id, other_id, same_entity, other_entity IN
        SELECT * FROM (VALUES
            ('bob_objects', '00000000000000000000000001', '00000000000000000000000002', '00000000000000000000000003', 'warehouse', 'fund-account'),
            ('aux_objects', '00000000000000000000000101', '00000000000000000000000102', '00000000000000000000000103', 'product-category', 'department'),
            ('vou_documents', '00000000000000000000000201', '00000000000000000000000202', '00000000000000000000000203', 'other-income', 'expense-reimbursement')
        ) AS fixtures(target_table, first_id, second_id, other_id, same_entity, other_entity)
    LOOP
        fourth_id := CASE target_table WHEN 'bob_objects' THEN '00000000000000000000000004'
                                        WHEN 'aux_objects' THEN '00000000000000000000000104'
                                        ELSE '00000000000000000000000204' END;
        EXECUTE format('SELECT count(*) FROM %I WHERE id IN ($1, $2, $3, $4) AND oit_id IS NULL', target_table)
            INTO row_count USING first_id, second_id, other_id, fourth_id;
        IF row_count <> 4 THEN
            RAISE EXCEPTION '% legacy rows did not remain NULL', target_table;
        END IF;

        EXECUTE format('UPDATE %I SET oit_id = $1 WHERE id = $2', target_table) USING 'OIT-DUP', first_id;
        BEGIN
            EXECUTE format('UPDATE %I SET oit_id = $1 WHERE id = $2', target_table) USING 'OIT-DUP', second_id;
            RAISE EXCEPTION '% allows duplicate oit_id within an entity', target_table;
        EXCEPTION WHEN unique_violation THEN NULL;
        END;
        EXECUTE format('UPDATE %I SET oit_id = $1 WHERE id = $2', target_table) USING 'OIT-DUP', other_id;

        BEGIN
            EXECUTE format('UPDATE %I SET oit_id = $1 WHERE id = $2', target_table) USING '', second_id;
            RAISE EXCEPTION '% allows empty oit_id', target_table;
        EXCEPTION WHEN check_violation THEN NULL;
        END;
        BEGIN
            EXECUTE format('UPDATE %I SET oit_id = $1 WHERE id = $2', target_table) USING ' ', second_id;
            RAISE EXCEPTION '% allows blank oit_id', target_table;
        EXCEPTION WHEN check_violation THEN NULL;
        END;
        BEGIN
            EXECUTE format('UPDATE %I SET oit_id = $1 WHERE id = $2', target_table) USING ' OIT-SPACE', second_id;
            RAISE EXCEPTION '% allows leading whitespace in oit_id', target_table;
        EXCEPTION WHEN check_violation THEN NULL;
        END;
        BEGIN
            EXECUTE format('UPDATE %I SET oit_id = $1 WHERE id = $2', target_table) USING 'OIT-SPACE ', second_id;
            RAISE EXCEPTION '% allows trailing whitespace in oit_id', target_table;
        EXCEPTION WHEN check_violation THEN NULL;
        END;
        BEGIN
            EXECUTE format('UPDATE %I SET oit_id = $1 WHERE id = $2', target_table) USING repeat('X', 65), second_id;
            RAISE EXCEPTION '% allows an oit_id longer than 64 characters', target_table;
        EXCEPTION WHEN string_data_right_truncation THEN NULL;
        END;

        EXECUTE format('SELECT count(*) FROM %I WHERE entity = $1 AND oit_id IS NULL', target_table)
            INTO row_count USING same_entity;
        IF row_count <> 2 THEN
            RAISE EXCEPTION '% does not allow multiple NULL oit_id values', target_table;
        END IF;
        EXECUTE format('SELECT EXISTS (SELECT 1 FROM %I WHERE id = $1 AND entity = $2 AND oit_id = $3)', target_table)
            INTO exists_after_update USING other_id, other_entity, 'OIT-DUP';
        IF NOT exists_after_update THEN
            RAISE EXCEPTION '% does not allow the same oit_id across entities', target_table;
        END IF;
    END LOOP;
END $$;

BEGIN;
SET CONSTRAINTS ALL DEFERRED;
DELETE FROM vou_expense_reimbursement_details
WHERE document_id IN (
    '00000000000000000000000201',
    '00000000000000000000000202',
    '00000000000000000000000203',
    '00000000000000000000000204'
);
DELETE FROM vou_other_income_details
WHERE document_id IN (
    '00000000000000000000000201',
    '00000000000000000000000202',
    '00000000000000000000000203',
    '00000000000000000000000204'
);
DELETE FROM vou_documents
WHERE id IN (
    '00000000000000000000000201',
    '00000000000000000000000202',
    '00000000000000000000000203',
    '00000000000000000000000204'
);

DELETE FROM aux_versions
WHERE object_id IN (
    '00000000000000000000000101',
    '00000000000000000000000102',
    '00000000000000000000000103',
    '00000000000000000000000104'
);
DELETE FROM aux_objects
WHERE id IN (
    '00000000000000000000000101',
    '00000000000000000000000102',
    '00000000000000000000000103',
    '00000000000000000000000104'
);

DELETE FROM bob_warehouse_versions
WHERE version_id IN (
    '00000000000000000000000011',
    '00000000000000000000000012',
    '00000000000000000000000014'
);
DELETE FROM bob_fund_account_versions
WHERE version_id = '00000000000000000000000013';
DELETE FROM bob_versions
WHERE object_id IN (
    '00000000000000000000000001',
    '00000000000000000000000002',
    '00000000000000000000000003',
    '00000000000000000000000004'
);
DELETE FROM bob_objects
WHERE id IN (
    '00000000000000000000000001',
    '00000000000000000000000002',
    '00000000000000000000000003',
    '00000000000000000000000004'
);
COMMIT;

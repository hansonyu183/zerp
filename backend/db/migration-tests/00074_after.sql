DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM aux_objects WHERE entity='account-subject')
       OR EXISTS (SELECT 1 FROM aux_versions WHERE entity='account-subject')
       OR EXISTS (SELECT 1 FROM aux_audit_events WHERE entity='account-subject') THEN
        RAISE EXCEPTION 'obsolete AUX accounting-subject data remains after migration 00074';
    END IF;
    IF EXISTS (SELECT 1 FROM aux_versions WHERE data ? 'accountSubjectId') THEN
        RAISE EXCEPTION 'obsolete accountSubjectId mapping remains after migration 00074';
    END IF;
    IF EXISTS (
        SELECT 1 FROM object_number_counters
        WHERE domain='aux' AND entity='account-subject'
    ) OR EXISTS (
        SELECT 1 FROM identifier_object_renumber_history
        WHERE domain='aux' AND entity='account-subject'
    ) THEN
        RAISE EXCEPTION 'obsolete AUX accounting-subject numbering metadata remains after migration 00074';
    END IF;
    IF EXISTS (
        SELECT 1 FROM app_permissions
        WHERE domain='aux' AND entity='account-subject'
    ) OR EXISTS (
        SELECT 1 FROM app_business_menu_items
        WHERE route_key='aux/account-subject'
           OR permission_code LIKE '/aux/account-subject/%'
    ) THEN
        RAISE EXCEPTION 'obsolete AUX accounting-subject access metadata remains after migration 00074';
    END IF;
    IF pg_get_constraintdef(
        (SELECT oid FROM pg_constraint
         WHERE conrelid='aux_objects'::regclass
           AND conname='aux_objects_entity_check')
    ) LIKE '%account-subject%' THEN
        RAISE EXCEPTION 'aux_objects still accepts account-subject after migration 00074';
    END IF;
END
$$;

BEGIN;
SET CONSTRAINTS ALL DEFERRED;
INSERT INTO aux_objects(
    id,entity,code,current_version_id,created_by,updated_by
) VALUES (
    '00000000000000000000007406','income-expense-type','IET-7402',
    '00000000000000000000007407','01JAPPSYST3MACTR0000000000',
    '01JAPPSYST3MACTR0000000000'
);
INSERT INTO aux_versions(id,object_id,entity,version_no,data,created_by) VALUES (
    '00000000000000000000007407','00000000000000000000007406',
    'income-expense-type',1,'{"name":"Current income","direction":"INCOME"}'::jsonb,
    '01JAPPSYST3MACTR0000000000'
);
DELETE FROM aux_versions WHERE object_id='00000000000000000000007406';
DELETE FROM aux_objects WHERE id='00000000000000000000007406';
SET CONSTRAINTS ALL IMMEDIATE;
COMMIT;

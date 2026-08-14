BEGIN;
SET CONSTRAINTS ALL DEFERRED;

INSERT INTO aux_objects(
    id,entity,code,current_version_id,created_by,updated_by
) VALUES (
    '00000000000000000000007401','account-subject','ACS-7401',
    '00000000000000000000007402','01JAPPSYST3MACTR0000000000',
    '01JAPPSYST3MACTR0000000000'
), (
    '00000000000000000000007404','income-expense-type','IET-7401',
    '00000000000000000000007405','01JAPPSYST3MACTR0000000000',
    '01JAPPSYST3MACTR0000000000'
);

INSERT INTO aux_versions(id,object_id,entity,version_no,data,created_by) VALUES (
    '00000000000000000000007402','00000000000000000000007401',
    'account-subject',1,'{"name":"Legacy revenue","direction":"REVENUE"}'::jsonb,
    '01JAPPSYST3MACTR0000000000'
), (
    '00000000000000000000007405','00000000000000000000007404',
    'income-expense-type',1,
    '{"name":"Legacy income","direction":"INCOME","accountSubjectId":"00000000000000000000007401"}'::jsonb,
    '01JAPPSYST3MACTR0000000000'
);

INSERT INTO aux_audit_events(
    id,object_id,version_id,entity,event_type,actor_id,request_id
) VALUES (
    '00000000000000000000007403','00000000000000000000007401',
    '00000000000000000000007402','account-subject','CREATED',
    '01JAPPSYST3MACTR0000000000','migration-00074'
);

INSERT INTO object_number_counters(domain,entity,last_value)
VALUES('aux','account-subject',7401)
ON CONFLICT(domain,entity) DO UPDATE SET last_value=EXCLUDED.last_value;

INSERT INTO identifier_object_renumber_history(
    domain,object_id,entity,old_code,new_code
) VALUES (
    'aux','00000000000000000000007401','account-subject','LEGACY-7401','ACS-7401'
)
ON CONFLICT(domain,object_id) DO UPDATE SET
    entity=EXCLUDED.entity,old_code=EXCLUDED.old_code,new_code=EXCLUDED.new_code;

INSERT INTO app_role_permissions(role_id,permission_id,created_by)
SELECT role.id,permission.id,'01JAPPSYST3MACTR0000000000'
FROM (SELECT id FROM app_roles ORDER BY id LIMIT 1) role
JOIN app_permissions permission
  ON permission.domain='aux' AND permission.entity='account-subject'
 AND permission.action='query'
ON CONFLICT DO NOTHING;

SET CONSTRAINTS ALL IMMEDIATE;
COMMIT;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM aux_objects WHERE entity='account-subject')
       OR NOT EXISTS (
           SELECT 1 FROM aux_versions WHERE data ? 'accountSubjectId'
       )
       OR NOT EXISTS (
           SELECT 1 FROM app_permissions
           WHERE domain='aux' AND entity='account-subject'
       )
       OR NOT EXISTS (
           SELECT 1 FROM object_number_counters
           WHERE domain='aux' AND entity='account-subject'
       )
       OR NOT EXISTS (
           SELECT 1 FROM identifier_object_renumber_history
           WHERE domain='aux' AND entity='account-subject'
       )
       OR NOT EXISTS (
           SELECT 1 FROM app_business_menu_items
           WHERE route_key='aux/account-subject'
       ) THEN
        RAISE EXCEPTION 'obsolete AUX accounting-subject fixture is incomplete';
    END IF;
END
$$;

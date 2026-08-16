DO $$
BEGIN
    IF to_regclass('public.wfl_definition_edges') IS NULL
       OR to_regclass('public.wfl_process_instances') IS NULL THEN
        RAISE EXCEPTION 'legacy workflow tables are required before migration 00077';
    END IF;
    IF to_regclass('public.wfl_definition_revisions') IS NOT NULL THEN
        RAISE EXCEPTION 'immutable workflow revisions already exist';
    END IF;
END
$$;

DO $$
DECLARE
    target_role_id varchar(26);
    target_permission_id varchar(26);
BEGIN
    SELECT id INTO target_role_id FROM app_roles ORDER BY id LIMIT 1;
    SELECT id INTO target_permission_id FROM app_permissions
    WHERE path='/wfl/process-definition/query';
    IF target_role_id IS NULL OR target_permission_id IS NULL THEN
        RAISE EXCEPTION 'role and workflow query permission are required for migration grant probe';
    END IF;
    INSERT INTO app_role_permissions(role_id,permission_id,created_by)
    VALUES(target_role_id,target_permission_id,'01JAPPSYST3MACTR0000000000')
    ON CONFLICT DO NOTHING;
END
$$;

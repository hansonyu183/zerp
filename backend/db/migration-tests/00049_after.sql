DO $$
BEGIN
    IF (
        SELECT count(*) FROM app_permissions
        WHERE domain = 'vou' AND entity = 'bill-issue'
    ) <> 15 THEN
        RAISE EXCEPTION 'bill issue permissions are incomplete';
    END IF;
    IF EXISTS (SELECT 1 FROM app_roles WHERE code = 'superadmin')
       AND NOT EXISTS (
        SELECT 1 FROM app_role_permissions role_permission
        JOIN app_roles role ON role.id = role_permission.role_id
        JOIN app_permissions permission ON permission.id = role_permission.permission_id
        WHERE role.code = 'superadmin'
          AND permission.path = '/vou/bill-issue/create'
    ) THEN
        RAISE EXCEPTION 'superadmin bill issue permission is missing';
    END IF;
END
$$;

DO $$ BEGIN
 IF (SELECT count(*) FROM app_permissions WHERE domain='vou' AND entity='bill-maturity') <> 15 THEN RAISE EXCEPTION 'bill maturity permissions are incomplete'; END IF;
 IF EXISTS(SELECT 1 FROM app_roles WHERE code='superadmin') AND NOT EXISTS(SELECT 1 FROM app_role_permissions rp JOIN app_roles role ON role.id=rp.role_id JOIN app_permissions permission ON permission.id=rp.permission_id WHERE role.code='superadmin' AND permission.domain='vou' AND permission.entity='bill-maturity') THEN RAISE EXCEPTION 'bill maturity permissions are not granted to superadmin'; END IF;
END $$;

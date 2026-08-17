DO $$
BEGIN
  IF to_regclass('public.app_roles') IS NULL THEN
    RAISE EXCEPTION 'app_roles is required before role-management migration';
  END IF;
END
$$;

INSERT INTO app_roles (id, code, name, status)
VALUES ('01JROLEMGMT00000000000001', 'ROL-0042', 'Legacy Role Code', 'ENABLED')
ON CONFLICT (id) DO NOTHING;

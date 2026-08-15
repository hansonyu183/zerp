DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'app_users' AND column_name = 'password_change_required'
          AND is_nullable = 'NO' AND column_default = 'true'
    ) THEN
        RAISE EXCEPTION 'password_change_required column is missing or has an unsafe default';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM app_permissions WHERE path = '/app/user/reset-password' AND status = 'ENABLED')
       OR EXISTS (SELECT 1 FROM app_permissions WHERE path IN ('/app/user/signout', '/app/user/change-password')) THEN
        RAISE EXCEPTION 'self-service/reset password permission catalog is invalid';
    END IF;
END
$$;

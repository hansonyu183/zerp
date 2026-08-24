DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM app_permissions
        WHERE path='/bob/warehouse/disable-precheck'
          AND domain='bob' AND entity='warehouse' AND action='disable-precheck' AND status='ENABLED'
    ) THEN
        RAISE EXCEPTION 'warehouse disable precheck permission is missing';
    END IF;
END $$;

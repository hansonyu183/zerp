DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM app_permissions WHERE path='/bob/warehouse/disable-precheck') THEN
        RAISE EXCEPTION 'warehouse disable precheck permission already exists';
    END IF;
END $$;

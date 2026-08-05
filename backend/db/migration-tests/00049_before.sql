DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM app_permissions
        WHERE domain = 'vou' AND entity = 'bill-issue'
    ) THEN
        RAISE EXCEPTION 'bill issue permissions already exist before migration';
    END IF;
END
$$;

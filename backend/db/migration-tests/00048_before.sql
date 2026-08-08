DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM app_permissions
        WHERE domain = 'vou' AND entity = 'bill-payment'
    ) THEN
        RAISE EXCEPTION 'bill payment permissions already exist before migration';
    END IF;
END
$$;

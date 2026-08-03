DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='led_assets') THEN
        RAISE EXCEPTION 'fixed asset tables unexpectedly exist before migration 00043';
    END IF;
END
$$;

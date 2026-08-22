DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM bob_objects WHERE entity IN ('customer','supplier','employee')) THEN
        RAISE EXCEPTION '00086 fixture requires no legacy relationship objects';
    END IF;
    IF to_regclass('bob_sales_relationships') IS NOT NULL THEN
        RAISE EXCEPTION 'typed relationship tables already exist';
    END IF;
END
$$;

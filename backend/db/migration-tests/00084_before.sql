DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM bob_supplier_versions) THEN
        RAISE EXCEPTION '00084 fixture requires no legacy suppliers';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name='bob_supplier_versions' AND column_name='salesperson_employee_id'
    ) THEN
        RAISE EXCEPTION 'legacy supplier salesperson column is missing';
    END IF;
END
$$;

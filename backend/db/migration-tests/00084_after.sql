DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name='bob_supplier_versions' AND column_name='salesperson_employee_id'
    ) THEN
        RAISE EXCEPTION 'legacy supplier salesperson column still exists';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name='bob_supplier_versions' AND column_name='default_purchaser_employee_id'
    ) OR NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name='bob_supplier_versions' AND column_name='settlement_method_code'
    ) THEN
        RAISE EXCEPTION 'supplier target columns are missing';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM app_permissions WHERE path='/bob/supplier/tax-match'
    ) THEN
        RAISE EXCEPTION 'supplier tax-match permission is missing';
    END IF;
END
$$;

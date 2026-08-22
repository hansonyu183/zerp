DO $$
BEGIN
    IF to_regclass('bob_customer_relationships') IS NULL
       OR to_regclass('bob_supplier_relationships') IS NULL
       OR to_regclass('bob_employment_relationships') IS NULL
       OR to_regclass('bob_sales_relationships') IS NULL
       OR to_regclass('bob_sales_partner_versions') IS NULL THEN
        RAISE EXCEPTION 'typed relationship tables are missing';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM app_permissions WHERE path='/bob/sales-partner/create') THEN
        RAISE EXCEPTION 'sales relationship permissions are missing';
    END IF;
END
$$;

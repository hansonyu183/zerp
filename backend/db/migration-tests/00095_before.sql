DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema='public' AND table_name='bob_supplier_versions' AND column_name='supplier_type'
    ) OR NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema='public' AND table_name='bob_customer_versions' AND column_name='intermediary_other_party_id'
    ) THEN
        RAISE EXCEPTION '00095 fixture expects legacy supplier and intermediary fields';
    END IF;
END $$;

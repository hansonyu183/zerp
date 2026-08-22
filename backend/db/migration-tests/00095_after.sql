DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema='public' AND table_name IN ('bob_supplier_versions','bob_customer_versions')
          AND column_name IN ('supplier_type','intermediary_other_party_id')
    ) OR EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema='public' AND table_name='bob_version_views'
          AND column_name IN ('supplier_type','intermediary_other_party_id')
    ) THEN
        RAISE EXCEPTION '00095 legacy supplier or intermediary field remains';
    END IF;
    PERFORM 1 FROM bob_version_views LIMIT 1;
END $$;

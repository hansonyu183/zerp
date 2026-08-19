DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema='public' AND table_name='bob_customer_groups'
    ) THEN
        RAISE EXCEPTION 'bob_customer_groups was not created';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema='public' AND table_name='bob_customer_versions'
          AND column_name='pricing_policy'
    ) THEN
        RAISE EXCEPTION 'bob_customer_versions.pricing_policy was not created';
    END IF;
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema='public' AND table_name='bob_customer_versions'
          AND column_name='monthly_closing_day'
          AND (is_nullable <> 'YES' OR column_default IS NOT NULL)
    ) THEN
        RAISE EXCEPTION 'bob_customer_versions.monthly_closing_day still has a persisted default';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema='public' AND table_name='bob_operating_entity_versions'
    ) THEN
        RAISE EXCEPTION 'bob_operating_entity_versions was not created';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema='public' AND table_name='bob_customer_version_attachments'
    ) THEN
        RAISE EXCEPTION 'bob_customer_version_attachments was not created';
    END IF;
    IF (SELECT count(*) FROM aux_objects object JOIN aux_versions version ON version.id=object.current_version_id
        WHERE object.entity='dictionary-item' AND version.data->>'dictionaryTypeCode'='DCT-0003') <> 7 THEN
        RAISE EXCEPTION 'customer document categories were not seeded';
    END IF;
END;
$$;

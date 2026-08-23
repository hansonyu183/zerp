DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name IN ('bob_objects', 'aux_objects', 'vou_documents')
          AND column_name = 'oit_id'
    ) THEN
        RAISE EXCEPTION '00099 left an OIT identifier column behind';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM pg_indexes
        WHERE schemaname = 'public'
          AND indexname IN (
              'bob_objects_entity_oit_id_uq',
              'aux_objects_entity_oit_id_uq',
              'vou_documents_entity_oit_id_uq'
          )
    ) THEN
        RAISE EXCEPTION '00099 left an OIT identifier index behind';
    END IF;
END $$;

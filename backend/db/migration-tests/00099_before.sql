DO $$
BEGIN
    IF (
        SELECT count(*)
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name IN ('bob_objects', 'aux_objects', 'vou_documents')
          AND column_name = 'oit_id'
    ) <> 3 THEN
        RAISE EXCEPTION '00099 fixture expects all OIT identifier columns';
    END IF;

    IF EXISTS (SELECT 1 FROM bob_objects WHERE oit_id IS NOT NULL)
       OR EXISTS (SELECT 1 FROM aux_objects WHERE oit_id IS NOT NULL)
       OR EXISTS (SELECT 1 FROM vou_documents WHERE oit_id IS NOT NULL) THEN
        RAISE EXCEPTION '00099 fixture expects no persisted OIT identifiers';
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'aux_objects'
          AND column_name = 'oit_id'
    ) THEN
        RAISE EXCEPTION '00099 rejection did not roll back the schema change';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM aux_objects
        WHERE id = '01JAVX00000000000000000001'
          AND oit_id = 'OIT-NEGATIVE-00099'
    ) THEN
        RAISE EXCEPTION '00099 rejection did not preserve the blocking OIT identifier';
    END IF;
END $$;

UPDATE aux_objects
SET oit_id = NULL
WHERE id = '01JAVX00000000000000000001'
  AND oit_id = 'OIT-NEGATIVE-00099';

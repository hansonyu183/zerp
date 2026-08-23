UPDATE aux_objects
SET oit_id = 'OIT-NEGATIVE-00099'
WHERE id = '01JAVX00000000000000000001';

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM aux_objects
        WHERE id = '01JAVX00000000000000000001'
          AND oit_id = 'OIT-NEGATIVE-00099'
    ) THEN
        RAISE EXCEPTION '00099 negative fixture could not persist an OIT identifier';
    END IF;
END $$;

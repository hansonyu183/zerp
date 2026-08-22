DO $$
DECLARE dimension_length integer;
BEGIN
    SELECT character_maximum_length INTO dimension_length
    FROM information_schema.columns
    WHERE table_schema='public'
      AND table_name='acc_subject_dimensions'
      AND column_name='dimension';
    IF dimension_length <> 32 THEN
        RAISE EXCEPTION '00094 accounting dimension width is %, want 32', dimension_length;
    END IF;
END
$$;

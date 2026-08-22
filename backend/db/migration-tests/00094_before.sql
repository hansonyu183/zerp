DO $$
DECLARE dimension_length integer;
BEGIN
    SELECT character_maximum_length INTO dimension_length
    FROM information_schema.columns
    WHERE table_schema='public'
      AND table_name='acc_subject_dimensions'
      AND column_name='dimension';
    IF dimension_length <> 20 THEN
        RAISE EXCEPTION '00094 fixture expects legacy dimension width 20, got %', dimension_length;
    END IF;
END
$$;

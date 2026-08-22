DO $$
DECLARE definition text;
BEGIN
    SELECT pg_get_constraintdef(oid) INTO definition
    FROM pg_constraint
    WHERE conname = 'acc_subject_dimensions_dimension_check';
    IF definition IS NULL OR position('OTHER_PARTY' in definition) = 0 THEN
        RAISE EXCEPTION '00090 fixture expects legacy accounting dimensions';
    END IF;
END
$$;

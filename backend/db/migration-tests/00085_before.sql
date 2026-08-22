DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM bob_objects WHERE entity='other-party') THEN
        RAISE EXCEPTION '00085 fixture requires no other-party objects';
    END IF;
    IF to_regclass('bob_parties') IS NOT NULL THEN
        RAISE EXCEPTION 'Party tables already exist';
    END IF;
END
$$;

DO $$
BEGIN
    IF to_regclass('bob_party_merge_preflights') IS NOT NULL THEN
        RAISE EXCEPTION '00088 fixture expects no Party merge tables';
    END IF;
END
$$;

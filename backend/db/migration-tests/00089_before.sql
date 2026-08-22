DO $$
BEGIN
    IF to_regclass('bob_party_merge_preflights') IS NULL
       OR to_regclass('bob_party_merge_events') IS NULL
       OR to_regclass('bob_party_relationship_merge_events') IS NULL THEN
        RAISE EXCEPTION '00088 Party merge tables missing';
    END IF;
END
$$;

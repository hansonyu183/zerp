DO $$ BEGIN
 IF (SELECT count(*) FROM app_permissions WHERE domain='vou' AND entity='bill-discount') <> 15 THEN RAISE EXCEPTION 'bill discount permissions are incomplete'; END IF;
END $$;

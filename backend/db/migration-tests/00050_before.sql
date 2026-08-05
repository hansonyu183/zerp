DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM app_permissions WHERE domain='vou' AND entity='bill-discount') THEN RAISE EXCEPTION 'bill discount permissions already exist before migration'; END IF;
END $$;

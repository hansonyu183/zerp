DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM app_permissions WHERE domain='vou' AND entity='bill-maturity') THEN RAISE EXCEPTION 'bill maturity permissions already exist before migration'; END IF;
END $$;

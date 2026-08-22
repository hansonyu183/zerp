DO $$
BEGIN
 IF to_regclass('bob_customer_relationship_versions') IS NULL OR to_regclass('bob_customer_accounts') IS NULL THEN
   RAISE EXCEPTION '00089 customer relationship/account tables missing';
 END IF;
 IF EXISTS(SELECT 1 FROM app_permissions WHERE domain='bob' AND entity='customer-group') THEN
   RAISE EXCEPTION 'customer-group permissions remain reachable';
 END IF;
END $$;

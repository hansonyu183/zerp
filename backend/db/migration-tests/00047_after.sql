DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM information_schema.tables WHERE table_name='vou_bill_details') THEN RAISE EXCEPTION 'bill tables missing'; END IF;
 IF NOT EXISTS(SELECT 1 FROM app_permissions WHERE path='/vou/bill-receipt/create') THEN RAISE EXCEPTION 'bill receipt permission missing'; END IF;
 IF NOT EXISTS(SELECT 1 FROM information_schema.tables WHERE table_name='led_bills') THEN RAISE EXCEPTION 'ledger bill tables missing'; END IF;
END $$;

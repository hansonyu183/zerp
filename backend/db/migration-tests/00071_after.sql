DO $$ BEGIN
    IF to_regclass('public.acc_depreciation_entries') IS NULL OR to_regclass('public.acc_period_balances') IS NULL THEN
        RAISE EXCEPTION 'period derived facts missing';
    END IF;
END $$;

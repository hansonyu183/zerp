DO $$
BEGIN
    IF to_regclass('public.acc_openings') IS NOT NULL
       OR to_regclass('public.acc_opening_lines') IS NOT NULL
       OR to_regclass('public.acc_vouchers') IS NOT NULL
       OR to_regclass('public.acc_voucher_lines') IS NOT NULL THEN
        RAISE EXCEPTION 'migration 00064 ACC opening structures already exist';
    END IF;
END
$$;

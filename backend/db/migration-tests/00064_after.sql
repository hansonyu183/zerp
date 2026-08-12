DO $$
BEGIN
    IF to_regclass('public.acc_openings') IS NULL
       OR to_regclass('public.acc_opening_lines') IS NULL
       OR to_regclass('public.acc_vouchers') IS NULL
       OR to_regclass('public.acc_voucher_lines') IS NULL THEN
        RAISE EXCEPTION 'migration 00064 ACC opening structures are incomplete';
    END IF;
    IF (
        SELECT count(*) FROM app_permissions
        WHERE domain = 'acc' AND entity = 'opening' AND status = 'ENABLED'
    ) <> 4 THEN
        RAISE EXCEPTION 'migration 00064 ACC opening permissions are incomplete';
    END IF;
END
$$;

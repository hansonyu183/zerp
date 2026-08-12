DO $$
BEGIN
    IF to_regclass('public.acc_periods') IS NOT NULL THEN
        RAISE EXCEPTION 'migration 00068 periods already exist';
    END IF;
END
$$;

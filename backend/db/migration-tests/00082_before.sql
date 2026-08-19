DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM aux_objects WHERE entity='payment-method') THEN
        RAISE EXCEPTION 'payment-method unexpectedly exists before migration 00082';
    END IF;
END
$$;

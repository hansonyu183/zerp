DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema='public' AND table_name='vou_sale_order_details'
          AND column_name='settlement_term_code'
    ) THEN
        RAISE EXCEPTION 'expected pre-00057 sale order schema is missing';
    END IF;
END $$;

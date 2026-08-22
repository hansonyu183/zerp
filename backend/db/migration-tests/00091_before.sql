DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema='public' AND table_name='vou_sale_order_details'
          AND column_name='customer_version_id'
    ) THEN
        RAISE EXCEPTION '00091 fixture expects sale order customer snapshots';
    END IF;
END
$$;

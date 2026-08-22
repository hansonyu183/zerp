DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema='public' AND table_name='vou_product_lines'
          AND column_name='ordered_qty_micros'
    ) THEN
        RAISE EXCEPTION '00098 fixture expects the legacy VOU quantity shape';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema='public' AND table_name='vou_sale_order_formulas'
          AND column_name='base_output_quantity_micros'
    ) THEN
        RAISE EXCEPTION '00098 fixture expects the legacy VOU formula shape';
    END IF;
END
$$;

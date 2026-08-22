DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema='public'
          AND column_name IN (
            'ordered_qty_micros', 'product_kind',
            'pricing_quantity_per_inventory_unit_micros'
          )
          AND table_name IN ('vou_product_lines', 'vou_price_lines')
    ) THEN
        RAISE EXCEPTION '00098 left legacy VOU product columns installed';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema='public' AND table_name='vou_product_lines'
          AND column_name='entered_quantity_micros'
    ) OR NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema='public' AND table_name='vou_product_lines'
          AND column_name='base_quantity_micros'
    ) OR NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema='public' AND table_name='vou_sale_order_formulas'
          AND column_name='output_base_quantity_micros'
    ) OR NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema='public' AND table_name='vou_sale_order_formula_lines'
          AND column_name='entered_quantity_micros'
    ) THEN
        RAISE EXCEPTION '00098 target VOU quantity snapshots are incomplete';
    END IF;
END
$$;

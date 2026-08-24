DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name='vou_product_lines' AND column_name='delivery_specification_type'
    ) THEN
        RAISE EXCEPTION 'sale order delivery specification type is absent';
    END IF;
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name='vou_sale_delivery_details' AND column_name LIKE 'platform_%'
    ) THEN
        RAISE EXCEPTION 'legacy sale delivery platform columns remain';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name='vou_sale_delivery_details' AND column_name='carrier_type'
    ) THEN
        RAISE EXCEPTION 'sale delivery carrier snapshot is absent';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname='vou_sale_delivery_transport_snapshot_ck'
    ) THEN
        RAISE EXCEPTION 'sale delivery carrier snapshot constraint is absent';
    END IF;
    IF NOT EXISTS (
        SELECT 1
        FROM vou_sale_delivery_details
        WHERE document_id='01J0000000000000000000302'
          AND carrier_type='EXTERNAL'
          AND vehicle_object_id IS NULL
          AND carrier_operating_entity_object_id IS NULL
          AND carrier_service_relationship_object_id IS NULL
    ) THEN
        RAISE EXCEPTION 'unconfigured sale delivery draft was not preserved';
    END IF;
END $$;

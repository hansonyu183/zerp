DO $$
BEGIN
    IF (SELECT count(*) FROM information_schema.tables WHERE table_name IN (
        'vou_asset_acquisition_details','vou_asset_acquisition_lines',
        'vou_asset_depreciation_details','vou_asset_depreciation_lines',
        'vou_asset_sale_details','vou_asset_sale_lines',
        'vou_asset_liquidation_details','vou_asset_liquidation_lines',
        'led_assets','led_asset_entries','led_asset_number_counters','led_asset_number_assignments'
    )) <> 12 THEN
        RAISE EXCEPTION 'migration 00043 did not create the complete fixed asset schema';
    END IF;
    IF (SELECT count(*) FROM app_permissions WHERE
        (domain='aux' AND entity='asset-category') OR
        (domain='vou' AND entity IN ('asset-acquisition','asset-depreciation','asset-sale','asset-liquidation')) OR
        (domain='led' AND entity='asset')) <> 72 THEN
        RAISE EXCEPTION 'migration 00043 fixed asset permissions are incomplete';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname='vou_documents_entity_check'
          AND pg_get_constraintdef(oid) LIKE '%asset-liquidation%'
          AND pg_get_constraintdef(oid) LIKE '%inventory-count%'
    ) THEN
        RAISE EXCEPTION 'migration 00043 did not extend the voucher entity constraint';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname='vou_documents_total_amount_ck'
          AND pg_get_constraintdef(oid) LIKE '%asset-liquidation%'
          AND pg_get_constraintdef(oid) LIKE '%inventory-count%'
    ) THEN
        RAISE EXCEPTION 'migration 00043 did not preserve zero-amount voucher constraints';
    END IF;
    IF pg_get_functiondef('vou_validate_document_detail()'::regprocedure)
        NOT LIKE '%vou_inventory_count_details%' THEN
        RAISE EXCEPTION 'migration 00043 did not preserve inventory typed-detail validation';
    END IF;
END
$$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema='public' AND table_name='vou_sale_order_details'
          AND column_name IN (
            'sales_attribution_type','sales_attribution_subject_object_id',
            'sales_attribution_subject_version_id','sales_attribution_subject_code',
            'sales_attribution_subject_name'
        )
        GROUP BY table_schema,table_name HAVING count(*)=5
    ) THEN
        RAISE EXCEPTION '00091 sale order attribution snapshot columns are incomplete';
    END IF;
END
$$;
DO $$
DECLARE script_source text;
BEGIN
    SELECT source INTO script_source FROM vou_intermediary_scripts
    WHERE id='00000000000000000000005701';
    IF script_source LIKE '%bill.salesperson%' OR script_source LIKE '%byCustomerEmployee%' OR
       script_source NOT LIKE '%source.salesAttributionType%' THEN
        RAISE EXCEPTION '00091 system intermediary script still uses the mutable salesperson contract';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname='vou_intermediary_calculation_summaries_category_check'
          AND pg_get_constraintdef(oid) LIKE '%EXTERNAL_PART_TIME%'
          AND pg_get_constraintdef(oid) LIKE '%CHANNEL_PARTNER%'
    ) OR NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname='vou_intermediary_calculation_summaries_payee_entity_check'
          AND pg_get_constraintdef(oid) LIKE '%sales-partner%'
    ) THEN
        RAISE EXCEPTION '00091 intermediary summary typed sales relationship constraints are incomplete';
    END IF;
END
$$;

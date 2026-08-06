DO $$
DECLARE
    script_source text;
    script_hash text;
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema='public' AND table_name='vou_sale_order_details'
          AND column_name='special_approval' AND data_type='boolean'
    ) THEN
        RAISE EXCEPTION 'special approval snapshot column is missing';
    END IF;

    SELECT source, source_hash INTO script_source, script_hash
    FROM vou_intermediary_scripts WHERE singleton=true;
    IF script_source IS NULL OR script_hash <>
       encode(sha256(convert_to(script_source,'UTF8')),'hex') THEN
        RAISE EXCEPTION 'default intermediary script hash is invalid';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE schemaname='public' AND indexname='vou_intermediary_calculation_period_uq'
    ) THEN
        RAISE EXCEPTION 'intermediary calculation period uniqueness is missing';
    END IF;

    IF (SELECT count(*) FROM app_permissions
        WHERE domain='vou' AND entity='intermediary-calculation') <> 16 THEN
        RAISE EXCEPTION 'intermediary calculation permissions are incomplete';
    END IF;

    IF (SELECT count(*) FROM app_permissions
        WHERE domain='led' AND entity='other-payable') <> 2 THEN
        RAISE EXCEPTION 'other payable permissions are incomplete';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM app_business_menu_items
        WHERE route_key='vou/intermediary-calculation'
    ) OR NOT EXISTS (
        SELECT 1 FROM app_business_menu_items
        WHERE route_key='led/other-payable'
    ) THEN
        RAISE EXCEPTION 'intermediary calculation menu routes are incomplete';
    END IF;

    BEGIN
        INSERT INTO vou_documents(
            id,entity,document_no,status,revision,business_date,currency,total_amount_cents,
            created_by,updated_by
        ) VALUES(
            '00000000000000000000005710','intermediary-calculation','ICL-20570130-0001',
            'DRAFT',1,'2057-01-30','CNY',0,
            '01JAPPSYST3MACTR0000000000','01JAPPSYST3MACTR0000000000'
        );
        INSERT INTO vou_intermediary_calculation_details(
            document_id,period_start,period_end,source_hash,source_snapshot,
            script_id,script_revision,script_name,script_source,script_hash,result_snapshot
        ) SELECT
            '00000000000000000000005710','2057-01-01','2057-01-30',script_hash,'{}'::jsonb,
            id,revision,name,source,source_hash,'{}'::jsonb
        FROM vou_intermediary_scripts WHERE singleton=true;
        RAISE EXCEPTION 'non-month-end intermediary calculation was accepted';
    EXCEPTION WHEN check_violation THEN NULL;
    END;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema='public' AND table_name='led_party_entries'
          AND column_name='account_type'
    ) OR to_regclass('public.led_closing_other_payable') IS NULL THEN
        RAISE EXCEPTION 'classified other payable ledger schema is incomplete';
    END IF;
END $$;

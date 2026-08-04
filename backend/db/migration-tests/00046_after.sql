DO $$
BEGIN
    IF (SELECT count(*) FROM bob_settlement_method_versions
        WHERE term_code <> 'LEGACY') <> 11 THEN
        RAISE EXCEPTION 'migration 00046 did not create eleven fixed settlement methods';
    END IF;
    IF EXISTS (
        SELECT 1 FROM bob_settlement_method_versions method
        JOIN bob_versions version ON version.id=method.version_id
        JOIN bob_objects object ON object.id=version.object_id
        WHERE method.term_code <> 'LEGACY'
          AND (version.status <> 'EFFECTIVE' OR NOT object.enabled)
    ) THEN
        RAISE EXCEPTION 'migration 00046 fixed settlement methods are not enabled and effective';
    END IF;
    IF (SELECT default_sales_surcharge_cents FROM bob_settlement_method_versions
        WHERE term_code='ARRIVAL_30') <> 10
       OR (SELECT default_sales_surcharge_cents FROM bob_settlement_method_versions
        WHERE term_code='MONTHLY_CURRENT') <> 5
       OR (SELECT default_sales_surcharge_cents FROM bob_settlement_method_versions
        WHERE term_code='MONTHLY_90') <> 30 THEN
        RAISE EXCEPTION 'migration 00046 surcharge defaults are incorrect';
    END IF;
    IF (SELECT method.term_code
        FROM bob_customer_versions customer
        JOIN bob_objects object ON object.id=customer.settlement_method_id
        JOIN bob_settlement_method_versions method ON method.version_id=object.effective_version_id
        WHERE customer.version_id='01J0000000000000000000468') <> 'ARRIVAL_5' THEN
        RAISE EXCEPTION 'migration 00046 nearest due-day mapping or longer tie-break is incorrect';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM bob_migration_00046_aux_map mapping
        JOIN bob_objects object ON object.id=mapping.target_object_id
        JOIN bob_settlement_method_versions method ON method.version_id=object.effective_version_id
        WHERE mapping.aux_object_id='01J0000000000000000000461'
          AND method.term_code='PREPAID'
    ) THEN
        RAISE EXCEPTION 'migration 00046 prepaid name precedence is incorrect';
    END IF;
    IF (SELECT method.term_code
        FROM bob_supplier_versions supplier
        JOIN bob_objects object ON object.id=supplier.settlement_method_id
        JOIN bob_settlement_method_versions method ON method.version_id=object.effective_version_id
        WHERE supplier.version_id='01J0000000000000000000472') <> 'MONTHLY_60' THEN
        RAISE EXCEPTION 'migration 00046 legacy BOB settlement mapping is incorrect';
    END IF;
    IF EXISTS (SELECT 1 FROM app_permissions WHERE domain='aux' AND entity='settlement-method')
       OR (SELECT count(*) FROM app_permissions WHERE domain='bob' AND entity='settlement-method') <> 12 THEN
        RAISE EXCEPTION 'migration 00046 settlement permissions are incorrect';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
        WHERE table_name='vou_settlement_reservations' AND column_name='active' AND is_nullable='NO') THEN
        RAISE EXCEPTION 'migration 00046 reservation schema is missing';
    END IF;
    IF (SELECT monthly_closing_day FROM bob_customer_versions
        WHERE version_id='01J0000000000000000000468') <> 31 THEN
        RAISE EXCEPTION 'migration 00046 changed the natural-month default';
    END IF;
END
$$;

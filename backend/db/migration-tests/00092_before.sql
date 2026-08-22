DO $$
DECLARE relation_table text;
BEGIN
    FOREACH relation_table IN ARRAY ARRAY[
        'bob_customer_relationships','bob_supplier_relationships','bob_employment_relationships',
        'bob_service_relationships','bob_sales_relationships'
    ] LOOP
        IF NOT EXISTS (
            SELECT 1 FROM pg_constraint
            WHERE conrelid=relation_table::regclass AND contype='u'
              AND pg_get_constraintdef(oid) LIKE 'UNIQUE (party_id, operating_entity_id)%'
        ) THEN
            RAISE EXCEPTION '00092 fixture expects legacy full uniqueness on %', relation_table;
        END IF;
    END LOOP;
END
$$;

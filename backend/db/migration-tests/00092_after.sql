DO $$
DECLARE relation_table text;
DECLARE index_name text;
DECLARE index_definition text;
BEGIN
    FOREACH relation_table IN ARRAY ARRAY[
        'bob_customer_relationships','bob_supplier_relationships','bob_employment_relationships',
        'bob_service_relationships','bob_sales_relationships'
    ] LOOP
        index_name := relation_table || '_active_party_operating_key';
        SELECT indexdef INTO index_definition FROM pg_indexes
        WHERE schemaname='public' AND indexname=index_name;
        IF index_definition IS NULL
           OR position('UNIQUE INDEX' in index_definition)=0
           OR position('(party_id, operating_entity_id)' in index_definition)=0
           OR position('WHERE (merged_into_object_id IS NULL)' in index_definition)=0 THEN
            RAISE EXCEPTION '00092 active relationship uniqueness is incomplete for %', relation_table;
        END IF;
    END LOOP;
END
$$;

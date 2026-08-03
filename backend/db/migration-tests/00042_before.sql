DO $$
BEGIN
    IF to_regclass('vou_inventory_count_details') IS NOT NULL THEN
        RAISE EXCEPTION 'inventory count tables existed before migration 00042';
    END IF;
END
$$;

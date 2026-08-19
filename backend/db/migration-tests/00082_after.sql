DO $$
DECLARE
    method_count integer;
BEGIN
    SELECT count(*) INTO method_count
    FROM aux_objects
    WHERE entity='settlement-method' AND enabled;
    IF method_count <> 11 THEN
        RAISE EXCEPTION 'expected 11 enabled settlement methods, got %', method_count;
    END IF;
    IF NOT EXISTS (
        SELECT 1
        FROM aux_versions version
        JOIN aux_objects object ON object.current_version_id=version.id
        WHERE object.entity='settlement-method'
          AND version.data @> '{"termCode":"MONTHLY_90","ruleType":"MONTH_END","monthOffset":3,"dayOfMonth":0,"dayOffset":0,"defaultSalesSurcharge":"0.30"}'::jsonb
    ) THEN
        RAISE EXCEPTION 'monthly 90 settlement method was not seeded with fixed facts';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid='aux_objects'::regclass
          AND pg_get_constraintdef(oid) LIKE '%payment-method%'
    ) THEN
        RAISE EXCEPTION 'aux_objects no longer permits payment-method';
    END IF;
END
$$;

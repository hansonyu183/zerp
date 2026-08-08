DO $$
BEGIN
    IF (SELECT monthly_closing_day
        FROM bob_customer_versions
        WHERE version_id = '01J0000000000000000000456') <> 20 THEN
        RAISE EXCEPTION 'migration 00045 did not backfill customer monthly closing day';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM aux_versions
        WHERE id = '01J0000000000000000000452'
          AND (data ? 'cutoffDay' OR data ? 'monthOffset')
    ) THEN
        RAISE EXCEPTION 'migration 00045 did not remove settlement cutoff or month offset';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM aux_migration_00045_settlement_terms
        WHERE version_id = '01J0000000000000000000452'
          AND cutoff_day = 20
          AND month_offset = 2
    ) THEN
        RAISE EXCEPTION 'migration 00045 did not preserve reversible settlement terms';
    END IF;

    IF (SELECT monthly_closing_day
        FROM bob_version_views
        WHERE version_id = '01J0000000000000000000456') <> 20 THEN
        RAISE EXCEPTION 'migration 00045 did not expose monthly closing day';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'bob_customer_versions'::regclass
          AND pg_get_constraintdef(oid) LIKE '%monthly_closing_day >= 1%'
          AND pg_get_constraintdef(oid) LIKE '%monthly_closing_day <= 31%'
    ) THEN
        RAISE EXCEPTION 'migration 00045 monthly closing day constraint is missing';
    END IF;
END
$$;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='bob_vehicle_versions' AND column_name='platform_object_id') THEN
        RAISE EXCEPTION 'legacy vehicle platform column remains';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='bob_vehicle_versions' AND column_name='carrier_affiliation_type') THEN
        RAISE EXCEPTION 'vehicle carrier affiliation type is absent';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='bob_objects_active_vehicle_plate_uq' AND NOT tgisinternal) THEN
        RAISE EXCEPTION 'active vehicle plate uniqueness trigger is absent';
    END IF;
    IF NOT EXISTS (
        SELECT 1
        FROM bob_vehicle_versions
        WHERE version_id='01J0000000000000000000203'
          AND carrier_affiliation_type='EXTERNAL'
          AND carrier_service_relationship_object_id='01J0000000000000000000200'
          AND carrier_operating_entity_id IS NULL
    ) THEN
        RAISE EXCEPTION 'legacy vehicle carrier affiliation was not backfilled';
    END IF;
END $$;

BEGIN;
SET CONSTRAINTS ALL DEFERRED;

-- Keep a legacy vehicle/platform graph so the affiliation backfill queues the
-- deferred vehicle-detail and uniqueness triggers on an upgraded database.
INSERT INTO bob_objects(id,entity,code,current_version_id,created_by,updated_by)
VALUES
    ('01J0000000000000000000200','other-unit','OTH-0200',
     '01J0000000000000000000201','migration-fixture','migration-fixture'),
    ('01J0000000000000000000202','vehicle','VEH-0202',
     '01J0000000000000000000203','migration-fixture','migration-fixture');
INSERT INTO bob_versions(id,object_id,entity,version_no,status,created_by,updated_by)
VALUES
    ('01J0000000000000000000201','01J0000000000000000000200','other-unit',1,
     'DRAFT','migration-fixture','migration-fixture'),
    ('01J0000000000000000000203','01J0000000000000000000202','vehicle',1,
     'DRAFT','migration-fixture','migration-fixture');
INSERT INTO bob_service_relationship_versions(version_id)
VALUES ('01J0000000000000000000201');
INSERT INTO bob_vehicle_versions(
    version_id,name,plate_number,vehicle_type,platform_object_id
) VALUES (
    '01J0000000000000000000203','Legacy vehicle','TEST-0202','TANK',
    '01J0000000000000000000200'
);

SET CONSTRAINTS ALL IMMEDIATE;
COMMIT;

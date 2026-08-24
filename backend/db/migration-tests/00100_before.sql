BEGIN;
SET CONSTRAINTS ALL DEFERRED;

-- Keep a complete legacy Service graph so the upgrade exercises the deferred
-- trigger events produced by the cutover deletes.
INSERT INTO bob_objects(id,entity,code,current_version_id,created_by,updated_by)
VALUES (
    '01J0000000000000000000100','service','SVC-0100',
    '01J0000000000000000000101','migration-fixture','migration-fixture'
);
INSERT INTO bob_versions(id,object_id,entity,version_no,status,created_by,updated_by)
VALUES (
    '01J0000000000000000000101','01J0000000000000000000100','service',1,
    'DRAFT','migration-fixture','migration-fixture'
);
INSERT INTO bob_service_versions(version_id,name,unit,unit_id)
VALUES (
    '01J0000000000000000000101','Legacy service','kg',
    '01JAVX00000000000000000011'
);

SET CONSTRAINTS ALL IMMEDIATE;
COMMIT;

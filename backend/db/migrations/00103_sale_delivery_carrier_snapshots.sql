-- +goose Up
ALTER TABLE vou_product_lines
    ADD COLUMN delivery_specification_type varchar(16) NOT NULL DEFAULT 'PACKAGED'
        CHECK (delivery_specification_type IN ('PACKAGED', 'BULK_LIQUID'));

ALTER TABLE vou_sale_delivery_details
    DROP CONSTRAINT vou_sale_delivery_transport_draft_ck;

ALTER TABLE vou_sale_delivery_details
    RENAME COLUMN platform_object_id TO carrier_service_relationship_object_id;
ALTER TABLE vou_sale_delivery_details
    RENAME COLUMN platform_version_id TO carrier_service_relationship_version_id;
ALTER TABLE vou_sale_delivery_details
    RENAME COLUMN platform_code TO carrier_service_relationship_code;
ALTER TABLE vou_sale_delivery_details
    RENAME COLUMN platform_name TO carrier_service_relationship_name;

ALTER TABLE vou_sale_delivery_details
    ADD COLUMN carrier_type varchar(16) NOT NULL DEFAULT 'EXTERNAL',
    ADD COLUMN carrier_operating_entity_object_id varchar(26),
    ADD COLUMN carrier_operating_entity_version_id varchar(26),
    ADD COLUMN carrier_operating_entity_code varchar(64),
    ADD COLUMN carrier_operating_entity_name varchar(200),
    ADD COLUMN vehicle_bulk_liquid_capable boolean NOT NULL DEFAULT false;

UPDATE vou_sale_delivery_details delivery
SET vehicle_bulk_liquid_capable = vehicle.bulk_liquid_capable
FROM bob_vehicle_versions vehicle
WHERE vehicle.version_id = delivery.vehicle_version_id;

-- This update queues the deferred document-detail trigger. Flush it before
-- changing the same delivery-detail table in this Goose transaction.
SET CONSTRAINTS ALL IMMEDIATE;

ALTER TABLE vou_sale_delivery_details
    ALTER COLUMN carrier_type DROP DEFAULT,
    ADD CONSTRAINT vou_sale_delivery_carrier_type_ck
        CHECK (carrier_type IN ('INTERNAL', 'EXTERNAL')),
    ADD CONSTRAINT vou_sale_delivery_transport_snapshot_ck CHECK (
        vehicle_object_id IS NOT NULL
        AND vehicle_version_id IS NOT NULL
        AND vehicle_code IS NOT NULL
        AND vehicle_name IS NOT NULL
        AND vehicle_plate_number IS NOT NULL
        AND (
            carrier_type = 'INTERNAL'
            AND carrier_operating_entity_object_id IS NOT NULL
            AND carrier_operating_entity_version_id IS NOT NULL
            AND carrier_operating_entity_code IS NOT NULL
            AND carrier_operating_entity_name IS NOT NULL
            AND carrier_service_relationship_object_id IS NULL
            AND carrier_service_relationship_version_id IS NULL
            AND carrier_service_relationship_code IS NULL
            AND carrier_service_relationship_name IS NULL
        OR
            carrier_type = 'EXTERNAL'
            AND carrier_operating_entity_object_id IS NULL
            AND carrier_operating_entity_version_id IS NULL
            AND carrier_operating_entity_code IS NULL
            AND carrier_operating_entity_name IS NULL
            AND carrier_service_relationship_object_id IS NOT NULL
            AND carrier_service_relationship_version_id IS NOT NULL
            AND carrier_service_relationship_code IS NOT NULL
            AND carrier_service_relationship_name IS NOT NULL
        )
    );

UPDATE wfl_process_definitions
SET draft_script = replace(draft_script, 'platformObjectId', 'carrierServiceRelationshipObjectId'),
    revision = revision + 1,
    updated_at = now()
WHERE draft_script LIKE '%platformObjectId%';

UPDATE wfl_definition_revisions
SET script = replace(script, 'platformObjectId', 'carrierServiceRelationshipObjectId')
WHERE script LIKE '%platformObjectId%';

SELECT rpt_validate_current_reports();

-- +goose Down
SELECT 1;

-- +goose Up

-- Merged relationship rows remain immutable history.  Only active relationships
-- participate in the Party + operating-entity uniqueness rule so Party merge
-- can retain either side without rewriting historical relationship identity.
ALTER TABLE bob_customer_relationships
    DROP CONSTRAINT bob_customer_relationships_party_id_operating_entity_id_key;
ALTER TABLE bob_supplier_relationships
    DROP CONSTRAINT bob_supplier_relationships_party_id_operating_entity_id_key;
ALTER TABLE bob_employment_relationships
    DROP CONSTRAINT bob_employment_relationships_party_id_operating_entity_id_key;
ALTER TABLE bob_service_relationships
    DROP CONSTRAINT bob_service_relationships_party_id_operating_entity_id_key;
ALTER TABLE bob_sales_relationships
    DROP CONSTRAINT bob_sales_relationships_party_id_operating_entity_id_key;

CREATE UNIQUE INDEX bob_customer_relationships_active_party_operating_key
    ON bob_customer_relationships(party_id,operating_entity_id)
    WHERE merged_into_object_id IS NULL;
CREATE UNIQUE INDEX bob_supplier_relationships_active_party_operating_key
    ON bob_supplier_relationships(party_id,operating_entity_id)
    WHERE merged_into_object_id IS NULL;
CREATE UNIQUE INDEX bob_employment_relationships_active_party_operating_key
    ON bob_employment_relationships(party_id,operating_entity_id)
    WHERE merged_into_object_id IS NULL;
CREATE UNIQUE INDEX bob_service_relationships_active_party_operating_key
    ON bob_service_relationships(party_id,operating_entity_id)
    WHERE merged_into_object_id IS NULL;
CREATE UNIQUE INDEX bob_sales_relationships_active_party_operating_key
    ON bob_sales_relationships(party_id,operating_entity_id)
    WHERE merged_into_object_id IS NULL;

SELECT rpt_validate_current_reports();

-- +goose Down
-- +goose StatementBegin
DO $$ BEGIN RAISE EXCEPTION '00092 active relationship uniqueness is irreversible'; END $$;
-- +goose StatementEnd

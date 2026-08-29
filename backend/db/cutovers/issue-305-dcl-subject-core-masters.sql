\set ON_ERROR_STOP on

-- Issue #305/#307 one-way cutover. The five core master IDs become DCL
-- subjects; BOB retains only the identities not yet moved by #308.
BEGIN;

LOCK TABLE bob_objects, dcl_subjects, approval_entries,
  bob_operating_entities, bob_warehouses, bob_vehicles, bob_fund_accounts,
  bob_products IN ACCESS EXCLUSIVE MODE;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM bob_objects object
    LEFT JOIN dcl_subjects subject ON subject.id=object.id AND subject.entity=object.entity
    WHERE object.entity IN ('operating-entity','warehouse','vehicle','fund-account','product')
      AND subject.id IS NULL
  ) OR EXISTS (
    SELECT 1
    FROM dcl_subjects subject
    LEFT JOIN bob_objects object ON object.id=subject.id AND object.entity=subject.entity
    WHERE subject.entity IN ('operating-entity','warehouse','vehicle','fund-account','product')
      AND object.id IS NULL
  ) THEN
    RAISE EXCEPTION 'issue #305/#307 cutover found a missing or mismatched core-master identity';
  END IF;
END $$;

ALTER TABLE dcl_subjects ADD COLUMN code character varying(64);
ALTER TABLE dcl_subjects ADD CONSTRAINT dcl_subjects_code_check
  CHECK (code IS NULL OR code ~ '^[A-Z]{3}-[0-9]{4}$');

UPDATE dcl_subjects subject
SET code=object.code,
    created_at=object.created_at,
    created_by=object.created_by
FROM bob_objects object
WHERE object.id=subject.id AND object.entity=subject.entity
  AND object.entity IN ('operating-entity','warehouse','vehicle','fund-account','product');

ALTER TABLE dcl_subjects ADD CONSTRAINT dcl_subjects_core_code_required_ck
  CHECK (entity NOT IN ('operating-entity','warehouse','vehicle','fund-account','product') OR code IS NOT NULL);

CREATE UNIQUE INDEX dcl_subjects_entity_code_uq
  ON dcl_subjects(entity, upper(code)) WHERE code IS NOT NULL;

ALTER TABLE object_number_counters DROP CONSTRAINT object_number_counters_domain_check;
ALTER TABLE object_number_counters ADD CONSTRAINT object_number_counters_domain_check
  CHECK (domain IN ('bob','aux','acc','dcl'));

ALTER TABLE dcl_fund_account_versions
  ADD COLUMN operating_entity_entity character varying(16) NOT NULL DEFAULT 'operating-entity',
  ADD CONSTRAINT dcl_fund_account_versions_operating_entity_check
    CHECK (operating_entity_entity='operating-entity');
ALTER TABLE dcl_fund_account_identifier_claims
  ADD COLUMN object_entity character varying(16) NOT NULL DEFAULT 'fund-account',
  ADD CONSTRAINT dcl_fund_account_identifier_claims_object_entity_ck
    CHECK (object_entity='fund-account');
ALTER TABLE dcl_product_barcode_claims
  ADD COLUMN object_entity character varying(16) NOT NULL DEFAULT 'product',
  ADD CONSTRAINT dcl_product_barcode_claims_object_entity_ck
    CHECK (object_entity='product');
ALTER TABLE dcl_product_formula_lines
  ADD COLUMN material_entity character varying(16) NOT NULL DEFAULT 'product',
  ADD CONSTRAINT dcl_product_formula_lines_material_entity_ck
    CHECK (material_entity='product');
ALTER TABLE dcl_vehicle_identifier_claims
  ADD COLUMN object_entity character varying(16) NOT NULL DEFAULT 'vehicle',
  ADD CONSTRAINT dcl_vehicle_identifier_claims_object_entity_ck
    CHECK (object_entity='vehicle');
ALTER TABLE bob_party_relationship_merge_events
  ADD COLUMN operating_entity_entity character varying(16) NOT NULL DEFAULT 'operating-entity',
  ADD CONSTRAINT bob_party_relationship_merge_events_operating_entity_entity_ck
    CHECK (operating_entity_entity='operating-entity');

ALTER TABLE bob_customer_relationships DROP CONSTRAINT IF EXISTS bob_customer_relationships_operating_entity_id_operating_e_fkey;
ALTER TABLE bob_employment_relationships DROP CONSTRAINT IF EXISTS bob_employment_relationships_operating_entity_id_operating_fkey;
ALTER TABLE bob_sales_relationships DROP CONSTRAINT IF EXISTS bob_sales_relationships_operating_entity_id_operating_enti_fkey;
ALTER TABLE bob_service_relationships DROP CONSTRAINT IF EXISTS bob_service_relationships_operating_entity_id_operating_en_fkey;
ALTER TABLE bob_supplier_relationships DROP CONSTRAINT IF EXISTS bob_supplier_relationships_operating_entity_id_operating_e_fkey;
ALTER TABLE bob_party_relationship_merge_events DROP CONSTRAINT IF EXISTS bob_party_relationship_merge_events_operating_entity_id_fkey;
ALTER TABLE dcl_fund_account_versions DROP CONSTRAINT IF EXISTS dcl_fund_account_operating_object_fk;
ALTER TABLE dcl_fund_account_identifier_claims DROP CONSTRAINT IF EXISTS dcl_fund_account_identifier_claims_object_fkey;
ALTER TABLE dcl_product_barcode_claims DROP CONSTRAINT IF EXISTS dcl_product_barcode_claims_object_fkey;
ALTER TABLE dcl_product_formula_lines DROP CONSTRAINT IF EXISTS dcl_product_formula_lines_material_object_id_fkey;
ALTER TABLE dcl_vehicle_versions DROP CONSTRAINT IF EXISTS dcl_vehicle_versions_carrier_operating_fk;
ALTER TABLE dcl_vehicle_identifier_claims DROP CONSTRAINT IF EXISTS dcl_vehicle_identifier_claims_object_id_fkey;

ALTER TABLE bob_customer_relationships ADD CONSTRAINT bob_customer_relationships_operating_entity_id_operating_e_fkey FOREIGN KEY (operating_entity_id,operating_entity_entity) REFERENCES dcl_subjects(id,entity) ON DELETE RESTRICT;
ALTER TABLE bob_employment_relationships ADD CONSTRAINT bob_employment_relationships_operating_entity_id_operating_fkey FOREIGN KEY (operating_entity_id,operating_entity_entity) REFERENCES dcl_subjects(id,entity) ON DELETE RESTRICT;
ALTER TABLE bob_sales_relationships ADD CONSTRAINT bob_sales_relationships_operating_entity_id_operating_enti_fkey FOREIGN KEY (operating_entity_id,operating_entity_entity) REFERENCES dcl_subjects(id,entity) ON DELETE RESTRICT;
ALTER TABLE bob_service_relationships ADD CONSTRAINT bob_service_relationships_operating_entity_id_operating_en_fkey FOREIGN KEY (operating_entity_id,operating_entity_entity) REFERENCES dcl_subjects(id,entity) ON DELETE RESTRICT;
ALTER TABLE bob_supplier_relationships ADD CONSTRAINT bob_supplier_relationships_operating_entity_id_operating_e_fkey FOREIGN KEY (operating_entity_id,operating_entity_entity) REFERENCES dcl_subjects(id,entity) ON DELETE RESTRICT;
ALTER TABLE bob_party_relationship_merge_events ADD CONSTRAINT bob_party_relationship_merge_events_operating_entity_id_fkey FOREIGN KEY (operating_entity_id,operating_entity_entity) REFERENCES dcl_subjects(id,entity) ON DELETE RESTRICT;
ALTER TABLE dcl_fund_account_versions ADD CONSTRAINT dcl_fund_account_operating_object_fk FOREIGN KEY (operating_entity_id,operating_entity_entity) REFERENCES dcl_subjects(id,entity) ON DELETE RESTRICT;
ALTER TABLE dcl_fund_account_identifier_claims ADD CONSTRAINT dcl_fund_account_identifier_claims_object_fkey FOREIGN KEY (object_id,object_entity) REFERENCES dcl_subjects(id,entity) ON DELETE CASCADE;
ALTER TABLE dcl_product_barcode_claims ADD CONSTRAINT dcl_product_barcode_claims_object_fkey FOREIGN KEY (object_id,object_entity) REFERENCES dcl_subjects(id,entity) ON DELETE CASCADE;
ALTER TABLE dcl_product_formula_lines ADD CONSTRAINT dcl_product_formula_lines_material_object_id_fkey FOREIGN KEY (material_object_id,material_entity) REFERENCES dcl_subjects(id,entity) ON DELETE RESTRICT;
ALTER TABLE dcl_vehicle_versions ADD CONSTRAINT dcl_vehicle_versions_carrier_operating_fk FOREIGN KEY (carrier_operating_entity_id,carrier_operating_entity) REFERENCES dcl_subjects(id,entity) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE dcl_vehicle_identifier_claims ADD CONSTRAINT dcl_vehicle_identifier_claims_object_id_fkey FOREIGN KEY (object_id,object_entity) REFERENCES dcl_subjects(id,entity) ON DELETE CASCADE;

INSERT INTO object_number_counters(domain,entity,last_value)
SELECT 'dcl', entity,
  GREATEST(COALESCE((SELECT last_value FROM object_number_counters c WHERE c.domain='bob' AND c.entity=object.entity),0),
           COALESCE((SELECT last_value FROM object_number_counters c WHERE c.domain='dcl' AND c.entity=object.entity),0),
           COALESCE(MAX((substring(object.code FROM '[0-9]+$'))::integer),0))
FROM bob_objects object
WHERE object.entity IN ('operating-entity','warehouse','vehicle','fund-account','product')
GROUP BY object.entity
ON CONFLICT(domain,entity) DO UPDATE SET last_value=GREATEST(object_number_counters.last_value,EXCLUDED.last_value);

DROP TABLE bob_operating_entities;
DROP TABLE bob_warehouses;
DROP TABLE bob_vehicles;
DROP TABLE bob_fund_accounts;
DROP TABLE bob_products;

DELETE FROM bob_objects
WHERE entity IN ('operating-entity','warehouse','vehicle','fund-account','product');

COMMIT;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM bob_objects WHERE entity IN ('operating-entity','warehouse','vehicle','fund-account','product'))
     OR to_regclass('public.bob_operating_entities') IS NOT NULL
     OR to_regclass('public.bob_warehouses') IS NOT NULL
     OR to_regclass('public.bob_vehicles') IS NOT NULL
     OR to_regclass('public.bob_fund_accounts') IS NOT NULL
     OR to_regclass('public.bob_products') IS NOT NULL THEN
    RAISE EXCEPTION 'issue #305/#307 cutover retained an obsolete BOB core-master identity or current table';
  END IF;
END $$;

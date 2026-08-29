\set ON_ERROR_STOP on

-- #308 is a one-way continuation of #307.  It retains IDs, codes, creation
-- metadata and every Approval Entry while removing the BOB identity/current
-- copies for Party and typed relationships.
BEGIN;

LOCK TABLE object_number_counters, dcl_subjects, approval_entries, bob_objects, bob_parties,
  bob_customer_relationships, bob_employment_relationships,
  bob_supplier_relationships, bob_service_relationships, bob_sales_relationships,
  bob_customer_accounts, bob_party_currents, bob_party_identifiers,
  bob_customers, bob_employees, bob_suppliers, bob_other_units,
  bob_sales_partners, bob_customer_account_currents IN ACCESS EXCLUSIVE MODE;

CREATE TABLE dcl_parties (id varchar(26) PRIMARY KEY, entity varchar(16) NOT NULL DEFAULT 'party', merged_into_party_id varchar(26), merged_at timestamptz,
  CHECK(entity='party'), CHECK((merged_into_party_id IS NULL AND merged_at IS NULL) OR (merged_into_party_id IS NOT NULL AND merged_at IS NOT NULL AND merged_into_party_id<>id)));
CREATE TABLE dcl_customer_relationships (object_id varchar(26) PRIMARY KEY, object_entity varchar(16) NOT NULL DEFAULT 'customer', party_id varchar(26) NOT NULL, operating_entity_id varchar(26) NOT NULL, operating_entity_entity varchar(16) NOT NULL DEFAULT 'operating-entity', merged_into_object_id varchar(26), merged_at timestamptz, CHECK(object_entity='customer' AND operating_entity_entity='operating-entity'));
CREATE TABLE dcl_employment_relationships (object_id varchar(26) PRIMARY KEY, object_entity varchar(16) NOT NULL DEFAULT 'employee', party_id varchar(26) NOT NULL, operating_entity_id varchar(26) NOT NULL, operating_entity_entity varchar(16) NOT NULL DEFAULT 'operating-entity', merged_into_object_id varchar(26), merged_at timestamptz, CHECK(object_entity='employee' AND operating_entity_entity='operating-entity'));
CREATE TABLE dcl_supplier_relationships (object_id varchar(26) PRIMARY KEY, object_entity varchar(16) NOT NULL DEFAULT 'supplier', party_id varchar(26) NOT NULL, operating_entity_id varchar(26) NOT NULL, operating_entity_entity varchar(16) NOT NULL DEFAULT 'operating-entity', merged_into_object_id varchar(26), merged_at timestamptz, CHECK(object_entity='supplier' AND operating_entity_entity='operating-entity'));
CREATE TABLE dcl_service_relationships (object_id varchar(26) PRIMARY KEY, object_entity varchar(16) NOT NULL DEFAULT 'other-unit', party_id varchar(26) NOT NULL, operating_entity_id varchar(26) NOT NULL, operating_entity_entity varchar(16) NOT NULL DEFAULT 'operating-entity', merged_into_object_id varchar(26), merged_at timestamptz, CHECK(object_entity='other-unit' AND operating_entity_entity='operating-entity'));
CREATE TABLE dcl_sales_relationships (object_id varchar(26) PRIMARY KEY, object_entity varchar(16) NOT NULL DEFAULT 'sales-partner', party_id varchar(26) NOT NULL, operating_entity_id varchar(26) NOT NULL, operating_entity_entity varchar(16) NOT NULL DEFAULT 'operating-entity', merged_into_object_id varchar(26), merged_at timestamptz, CHECK(object_entity='sales-partner' AND operating_entity_entity='operating-entity'));
CREATE TABLE dcl_customer_accounts (object_id varchar(26) PRIMARY KEY, object_entity varchar(16) NOT NULL DEFAULT 'customer-account', customer_relationship_id varchar(26) NOT NULL, CHECK(object_entity='customer-account'));
CREATE TABLE dcl_party_merge_preflights (LIKE bob_party_merge_preflights INCLUDING DEFAULTS);
CREATE TABLE dcl_party_merge_events (LIKE bob_party_merge_events INCLUDING DEFAULTS);
CREATE TABLE dcl_party_relationship_merge_events (LIKE bob_party_relationship_merge_events INCLUDING DEFAULTS);

ALTER TABLE dcl_party_merge_preflights
  ADD CONSTRAINT dcl_party_merge_preflights_pkey PRIMARY KEY (id),
  ADD CONSTRAINT dcl_party_merge_preflights_distinct_ck CHECK (source_party_id<>target_party_id),
  ADD CONSTRAINT dcl_party_merge_preflights_consumed_ck CHECK ((consumed_at IS NULL AND consumed_by IS NULL) OR (consumed_at IS NOT NULL AND consumed_by IS NOT NULL)),
  ADD CONSTRAINT dcl_party_merge_preflights_revision_ck CHECK (source_approval_revision>=1 AND target_approval_revision>=1),
  ADD CONSTRAINT dcl_party_merge_preflights_fingerprint_ck CHECK (state_fingerprint ~ '^[0-9a-f]{64}$');
ALTER TABLE dcl_party_merge_events
  ADD CONSTRAINT dcl_party_merge_events_pkey PRIMARY KEY (id),
  ADD CONSTRAINT dcl_party_merge_events_preflight_id_key UNIQUE (preflight_id),
  ADD CONSTRAINT dcl_party_merge_events_distinct_ck CHECK (source_party_id<>target_party_id);
ALTER TABLE dcl_party_relationship_merge_events
  ADD CONSTRAINT dcl_party_relationship_merge_events_pkey PRIMARY KEY (id),
  ADD CONSTRAINT dcl_party_relationship_merge_events_action_ck CHECK (action IN ('TRANSFERRED','MERGED')),
  ADD CONSTRAINT dcl_party_relationship_merge_events_shape_ck CHECK ((action='TRANSFERRED' AND target_object_id IS NULL) OR (action='MERGED' AND target_object_id IS NOT NULL)),
  ADD CONSTRAINT dcl_party_relationship_merge_events_type_ck CHECK (relationship_type IN ('customer','supplier','employee','other-unit','sales-partner'));

-- Relationship identities already have DCL Approval subjects; move their
-- business code and creation audit from the retiring BOB object row.
INSERT INTO dcl_subjects(id,entity,code,created_at,created_by)
SELECT object.id,object.entity,object.code,object.created_at,object.created_by
FROM bob_objects object
WHERE object.entity IN ('employee','customer','supplier','other-unit','sales-partner','customer-account')
ON CONFLICT (id) DO UPDATE SET entity=EXCLUDED.entity,code=EXCLUDED.code,
  created_at=EXCLUDED.created_at,created_by=EXCLUDED.created_by;
INSERT INTO dcl_subjects(id,entity,code,created_at,created_by)
SELECT party.id,'party',NULL,party.created_at,party.created_by
FROM bob_parties party
ON CONFLICT (id) DO UPDATE SET entity=EXCLUDED.entity,code=NULL,
  created_at=EXCLUDED.created_at,created_by=EXCLUDED.created_by;

INSERT INTO dcl_parties(id,merged_into_party_id,merged_at) SELECT id,merged_into_party_id,merged_at FROM bob_parties;
INSERT INTO dcl_customer_relationships(object_id,party_id,operating_entity_id,merged_into_object_id,merged_at) SELECT object_id,party_id,operating_entity_id,merged_into_object_id,merged_at FROM bob_customer_relationships;
INSERT INTO dcl_employment_relationships(object_id,party_id,operating_entity_id,merged_into_object_id,merged_at) SELECT object_id,party_id,operating_entity_id,merged_into_object_id,merged_at FROM bob_employment_relationships;
INSERT INTO dcl_supplier_relationships(object_id,party_id,operating_entity_id,merged_into_object_id,merged_at) SELECT object_id,party_id,operating_entity_id,merged_into_object_id,merged_at FROM bob_supplier_relationships;
INSERT INTO dcl_service_relationships(object_id,party_id,operating_entity_id,merged_into_object_id,merged_at) SELECT object_id,party_id,operating_entity_id,merged_into_object_id,merged_at FROM bob_service_relationships;
INSERT INTO dcl_sales_relationships(object_id,party_id,operating_entity_id,merged_into_object_id,merged_at) SELECT object_id,party_id,operating_entity_id,merged_into_object_id,merged_at FROM bob_sales_relationships;
INSERT INTO dcl_customer_accounts(object_id,customer_relationship_id) SELECT object_id,customer_relationship_id FROM bob_customer_accounts;
INSERT INTO dcl_party_merge_preflights SELECT * FROM bob_party_merge_preflights;
INSERT INTO dcl_party_merge_events SELECT * FROM bob_party_merge_events;
INSERT INTO dcl_party_relationship_merge_events SELECT * FROM bob_party_relationship_merge_events;

ALTER TABLE dcl_party_versions DROP CONSTRAINT IF EXISTS dcl_party_versions_party_id_fkey;
ALTER TABLE dcl_party_identifier_claims DROP CONSTRAINT IF EXISTS dcl_party_identifier_claims_approved_party_id_fkey;
ALTER TABLE dcl_party_identifier_claims DROP CONSTRAINT IF EXISTS dcl_party_identifier_claims_open_party_id_fkey;
ALTER TABLE dcl_vehicle_versions DROP CONSTRAINT IF EXISTS dcl_vehicle_versions_carrier_service_relationship_fk;
ALTER TABLE dcl_warehouse_versions DROP CONSTRAINT IF EXISTS dcl_warehouse_versions_manager_employee_id_manager_employee_entity_fkey;
ALTER TABLE dcl_supplier_versions DROP CONSTRAINT IF EXISTS dcl_supplier_versions_default_purchaser_id_fkey;

ALTER TABLE dcl_subjects DROP CONSTRAINT IF EXISTS dcl_subjects_core_code_required_ck;
ALTER TABLE dcl_subjects ADD CONSTRAINT dcl_subjects_core_code_required_ck
  CHECK (entity NOT IN ('operating-entity','warehouse','vehicle','fund-account','product','employee','customer','supplier','other-unit','sales-partner','customer-account') OR code IS NOT NULL);

DROP VIEW IF EXISTS bob_party_relationship_endpoints;
DROP TABLE bob_party_relationship_merge_events, bob_party_merge_events, bob_party_merge_preflights,
  bob_customer_account_currents, bob_customers, bob_employees, bob_suppliers,
  bob_other_units, bob_sales_partners, bob_party_identifiers, bob_party_currents,
  bob_customer_accounts, bob_customer_relationships, bob_employment_relationships,
  bob_supplier_relationships, bob_service_relationships, bob_sales_relationships, bob_parties;
DELETE FROM bob_objects WHERE entity IN ('employee','customer','supplier','other-unit','sales-partner','customer-account');
DROP FUNCTION IF EXISTS bob_reject_merged_party_relationship();

CREATE FUNCTION dcl_reject_merged_party_relationship() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM dcl_parties WHERE id=NEW.party_id AND merged_into_party_id IS NOT NULL) THEN
    RAISE EXCEPTION 'merged Party cannot start a new relationship' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;

ALTER TABLE dcl_party_versions ADD CONSTRAINT dcl_party_versions_party_id_fkey
  FOREIGN KEY (party_id) REFERENCES dcl_parties(id) ON DELETE RESTRICT;
ALTER TABLE dcl_party_identifier_claims ADD CONSTRAINT dcl_party_identifier_claims_approved_party_id_fkey
  FOREIGN KEY (approved_party_id) REFERENCES dcl_parties(id) ON DELETE RESTRICT;
ALTER TABLE dcl_party_identifier_claims ADD CONSTRAINT dcl_party_identifier_claims_open_party_id_fkey
  FOREIGN KEY (open_party_id) REFERENCES dcl_parties(id) ON DELETE RESTRICT;
ALTER TABLE dcl_parties ADD CONSTRAINT dcl_parties_subject_fkey
  FOREIGN KEY (id,entity) REFERENCES dcl_subjects(id,entity) ON DELETE RESTRICT;
ALTER TABLE dcl_parties ADD CONSTRAINT dcl_parties_merged_into_fkey
  FOREIGN KEY (merged_into_party_id) REFERENCES dcl_parties(id) ON DELETE RESTRICT;
ALTER TABLE dcl_customer_relationships ADD CONSTRAINT dcl_customer_relationships_subject_fkey
  FOREIGN KEY (object_id,object_entity) REFERENCES dcl_subjects(id,entity) ON DELETE RESTRICT;
ALTER TABLE dcl_customer_relationships ADD CONSTRAINT dcl_customer_relationships_party_fkey
  FOREIGN KEY (party_id) REFERENCES dcl_parties(id) ON DELETE RESTRICT;
ALTER TABLE dcl_customer_relationships ADD CONSTRAINT dcl_customer_relationships_operating_fkey
  FOREIGN KEY (operating_entity_id,operating_entity_entity) REFERENCES dcl_subjects(id,entity) ON DELETE RESTRICT;
ALTER TABLE dcl_customer_relationships ADD CONSTRAINT dcl_customer_relationships_merged_fkey
  FOREIGN KEY (merged_into_object_id) REFERENCES dcl_customer_relationships(object_id) ON DELETE RESTRICT;
ALTER TABLE dcl_customer_relationships ADD CONSTRAINT dcl_customer_relationships_merge_ck
  CHECK ((merged_into_object_id IS NULL AND merged_at IS NULL) OR (merged_into_object_id IS NOT NULL AND merged_at IS NOT NULL AND merged_into_object_id<>object_id));
ALTER TABLE dcl_employment_relationships ADD CONSTRAINT dcl_employment_relationships_subject_fkey
  FOREIGN KEY (object_id,object_entity) REFERENCES dcl_subjects(id,entity) ON DELETE RESTRICT;
ALTER TABLE dcl_employment_relationships ADD CONSTRAINT dcl_employment_relationships_party_fkey
  FOREIGN KEY (party_id) REFERENCES dcl_parties(id) ON DELETE RESTRICT;
ALTER TABLE dcl_employment_relationships ADD CONSTRAINT dcl_employment_relationships_operating_fkey
  FOREIGN KEY (operating_entity_id,operating_entity_entity) REFERENCES dcl_subjects(id,entity) ON DELETE RESTRICT;
ALTER TABLE dcl_employment_relationships ADD CONSTRAINT dcl_employment_relationships_merged_fkey
  FOREIGN KEY (merged_into_object_id) REFERENCES dcl_employment_relationships(object_id) ON DELETE RESTRICT;
ALTER TABLE dcl_employment_relationships ADD CONSTRAINT dcl_employment_relationships_merge_ck
  CHECK ((merged_into_object_id IS NULL AND merged_at IS NULL) OR (merged_into_object_id IS NOT NULL AND merged_at IS NOT NULL AND merged_into_object_id<>object_id));
ALTER TABLE dcl_supplier_relationships ADD CONSTRAINT dcl_supplier_relationships_subject_fkey
  FOREIGN KEY (object_id,object_entity) REFERENCES dcl_subjects(id,entity) ON DELETE RESTRICT;
ALTER TABLE dcl_supplier_relationships ADD CONSTRAINT dcl_supplier_relationships_party_fkey
  FOREIGN KEY (party_id) REFERENCES dcl_parties(id) ON DELETE RESTRICT;
ALTER TABLE dcl_supplier_relationships ADD CONSTRAINT dcl_supplier_relationships_operating_fkey
  FOREIGN KEY (operating_entity_id,operating_entity_entity) REFERENCES dcl_subjects(id,entity) ON DELETE RESTRICT;
ALTER TABLE dcl_supplier_relationships ADD CONSTRAINT dcl_supplier_relationships_merged_fkey
  FOREIGN KEY (merged_into_object_id) REFERENCES dcl_supplier_relationships(object_id) ON DELETE RESTRICT;
ALTER TABLE dcl_supplier_relationships ADD CONSTRAINT dcl_supplier_relationships_merge_ck
  CHECK ((merged_into_object_id IS NULL AND merged_at IS NULL) OR (merged_into_object_id IS NOT NULL AND merged_at IS NOT NULL AND merged_into_object_id<>object_id));
ALTER TABLE dcl_service_relationships ADD CONSTRAINT dcl_service_relationships_subject_fkey
  FOREIGN KEY (object_id,object_entity) REFERENCES dcl_subjects(id,entity) ON DELETE RESTRICT;
ALTER TABLE dcl_service_relationships ADD CONSTRAINT dcl_service_relationships_party_fkey
  FOREIGN KEY (party_id) REFERENCES dcl_parties(id) ON DELETE RESTRICT;
ALTER TABLE dcl_service_relationships ADD CONSTRAINT dcl_service_relationships_operating_fkey
  FOREIGN KEY (operating_entity_id,operating_entity_entity) REFERENCES dcl_subjects(id,entity) ON DELETE RESTRICT;
ALTER TABLE dcl_service_relationships ADD CONSTRAINT dcl_service_relationships_merged_fkey
  FOREIGN KEY (merged_into_object_id) REFERENCES dcl_service_relationships(object_id) ON DELETE RESTRICT;
ALTER TABLE dcl_service_relationships ADD CONSTRAINT dcl_service_relationships_merge_ck
  CHECK ((merged_into_object_id IS NULL AND merged_at IS NULL) OR (merged_into_object_id IS NOT NULL AND merged_at IS NOT NULL AND merged_into_object_id<>object_id));
ALTER TABLE dcl_sales_relationships ADD CONSTRAINT dcl_sales_relationships_subject_fkey
  FOREIGN KEY (object_id,object_entity) REFERENCES dcl_subjects(id,entity) ON DELETE RESTRICT;
ALTER TABLE dcl_sales_relationships ADD CONSTRAINT dcl_sales_relationships_party_fkey
  FOREIGN KEY (party_id) REFERENCES dcl_parties(id) ON DELETE RESTRICT;
ALTER TABLE dcl_sales_relationships ADD CONSTRAINT dcl_sales_relationships_operating_fkey
  FOREIGN KEY (operating_entity_id,operating_entity_entity) REFERENCES dcl_subjects(id,entity) ON DELETE RESTRICT;
ALTER TABLE dcl_sales_relationships ADD CONSTRAINT dcl_sales_relationships_merged_fkey
  FOREIGN KEY (merged_into_object_id) REFERENCES dcl_sales_relationships(object_id) ON DELETE RESTRICT;
ALTER TABLE dcl_sales_relationships ADD CONSTRAINT dcl_sales_relationships_merge_ck
  CHECK ((merged_into_object_id IS NULL AND merged_at IS NULL) OR (merged_into_object_id IS NOT NULL AND merged_at IS NOT NULL AND merged_into_object_id<>object_id));
ALTER TABLE dcl_customer_accounts ADD CONSTRAINT dcl_customer_accounts_subject_fkey
  FOREIGN KEY (object_id,object_entity) REFERENCES dcl_subjects(id,entity) ON DELETE RESTRICT;
ALTER TABLE dcl_customer_accounts ADD CONSTRAINT dcl_customer_accounts_relationship_fkey
  FOREIGN KEY (customer_relationship_id) REFERENCES dcl_customer_relationships(object_id) ON DELETE RESTRICT;
ALTER TABLE dcl_party_relationship_merge_events
  ADD COLUMN IF NOT EXISTS operating_entity_entity varchar(16) NOT NULL DEFAULT 'operating-entity';
ALTER TABLE dcl_party_relationship_merge_events
  ADD CONSTRAINT dcl_party_relationship_merge_events_operating_entity_ck CHECK (operating_entity_entity='operating-entity');
ALTER TABLE dcl_party_relationship_merge_events
  ADD CONSTRAINT dcl_party_relationship_merge_events_operating_fkey FOREIGN KEY (operating_entity_id,operating_entity_entity) REFERENCES dcl_subjects(id,entity) ON DELETE RESTRICT;
ALTER TABLE dcl_party_merge_preflights
  ADD CONSTRAINT dcl_party_merge_preflights_source_fkey FOREIGN KEY (source_party_id) REFERENCES dcl_parties(id) ON DELETE RESTRICT,
  ADD CONSTRAINT dcl_party_merge_preflights_target_fkey FOREIGN KEY (target_party_id) REFERENCES dcl_parties(id) ON DELETE RESTRICT,
  ADD CONSTRAINT dcl_party_merge_preflights_source_entry_fkey FOREIGN KEY (source_approval_entry_id) REFERENCES approval_entries(id) ON DELETE RESTRICT,
  ADD CONSTRAINT dcl_party_merge_preflights_target_entry_fkey FOREIGN KEY (target_approval_entry_id) REFERENCES approval_entries(id) ON DELETE RESTRICT;
ALTER TABLE dcl_party_merge_events
  ADD CONSTRAINT dcl_party_merge_events_preflight_fkey FOREIGN KEY (preflight_id) REFERENCES dcl_party_merge_preflights(id) ON DELETE RESTRICT,
  ADD CONSTRAINT dcl_party_merge_events_source_fkey FOREIGN KEY (source_party_id) REFERENCES dcl_parties(id) ON DELETE RESTRICT,
  ADD CONSTRAINT dcl_party_merge_events_target_fkey FOREIGN KEY (target_party_id) REFERENCES dcl_parties(id) ON DELETE RESTRICT;
ALTER TABLE dcl_party_relationship_merge_events
  ADD CONSTRAINT dcl_party_relationship_merge_events_merge_fkey FOREIGN KEY (merge_event_id) REFERENCES dcl_party_merge_events(id) ON DELETE RESTRICT;
ALTER TABLE dcl_vehicle_versions ADD CONSTRAINT dcl_vehicle_versions_carrier_service_relationship_fk
  FOREIGN KEY (carrier_service_relationship_object_id,carrier_service_relationship_entity)
  REFERENCES dcl_subjects(id,entity) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE dcl_warehouse_versions ADD CONSTRAINT dcl_warehouse_versions_manager_employee_id_manager_employee_entity_fkey
  FOREIGN KEY (manager_employee_id,manager_employee_entity)
  REFERENCES dcl_subjects(id,entity) ON DELETE RESTRICT;
ALTER TABLE dcl_supplier_versions ADD COLUMN default_purchaser_employee_entity varchar(16) NOT NULL DEFAULT 'employee';
ALTER TABLE dcl_supplier_versions ADD CONSTRAINT dcl_supplier_versions_default_purchaser_employee_entity_ck
  CHECK (default_purchaser_employee_entity='employee');
ALTER TABLE dcl_supplier_versions ADD CONSTRAINT dcl_supplier_versions_default_purchaser_id_fkey
  FOREIGN KEY (default_purchaser_employee_id,default_purchaser_employee_entity)
  REFERENCES dcl_subjects(id,entity) ON DELETE RESTRICT;

CREATE VIEW dcl_party_relationship_endpoints AS
  SELECT 'customer'::varchar(16) AS entity,object_id,party_id,operating_entity_id,merged_into_object_id FROM public.dcl_customer_relationships
  UNION ALL SELECT 'employee'::varchar(16),object_id,party_id,operating_entity_id,merged_into_object_id FROM public.dcl_employment_relationships
  UNION ALL SELECT 'supplier'::varchar(16),object_id,party_id,operating_entity_id,merged_into_object_id FROM public.dcl_supplier_relationships
  UNION ALL SELECT 'other-unit'::varchar(16),object_id,party_id,operating_entity_id,merged_into_object_id FROM public.dcl_service_relationships
  UNION ALL SELECT 'sales-partner'::varchar(16),object_id,party_id,operating_entity_id,merged_into_object_id FROM public.dcl_sales_relationships;

CREATE TRIGGER dcl_customer_relationship_merged_party_ck BEFORE INSERT OR UPDATE OF party_id ON dcl_customer_relationships FOR EACH ROW EXECUTE FUNCTION dcl_reject_merged_party_relationship();
CREATE TRIGGER dcl_employment_relationship_merged_party_ck BEFORE INSERT OR UPDATE OF party_id ON dcl_employment_relationships FOR EACH ROW EXECUTE FUNCTION dcl_reject_merged_party_relationship();
CREATE TRIGGER dcl_supplier_relationship_merged_party_ck BEFORE INSERT OR UPDATE OF party_id ON dcl_supplier_relationships FOR EACH ROW EXECUTE FUNCTION dcl_reject_merged_party_relationship();
CREATE TRIGGER dcl_service_relationship_merged_party_ck BEFORE INSERT OR UPDATE OF party_id ON dcl_service_relationships FOR EACH ROW EXECUTE FUNCTION dcl_reject_merged_party_relationship();
CREATE TRIGGER dcl_sales_relationship_merged_party_ck BEFORE INSERT OR UPDATE OF party_id ON dcl_sales_relationships FOR EACH ROW EXECUTE FUNCTION dcl_reject_merged_party_relationship();

CREATE INDEX dcl_customer_accounts_relationship_idx ON dcl_customer_accounts(customer_relationship_id,object_id);
CREATE UNIQUE INDEX dcl_customer_relationships_active_party_operating_key ON dcl_customer_relationships(party_id,operating_entity_id) WHERE merged_into_object_id IS NULL;
CREATE UNIQUE INDEX dcl_employment_relationships_active_party_operating_key ON dcl_employment_relationships(party_id,operating_entity_id) WHERE merged_into_object_id IS NULL;
CREATE UNIQUE INDEX dcl_supplier_relationships_active_party_operating_key ON dcl_supplier_relationships(party_id,operating_entity_id) WHERE merged_into_object_id IS NULL;
CREATE UNIQUE INDEX dcl_service_relationships_active_party_operating_key ON dcl_service_relationships(party_id,operating_entity_id) WHERE merged_into_object_id IS NULL;
CREATE UNIQUE INDEX dcl_sales_relationships_active_party_operating_key ON dcl_sales_relationships(party_id,operating_entity_id) WHERE merged_into_object_id IS NULL;
CREATE INDEX dcl_party_merge_preflights_open_idx ON dcl_party_merge_preflights(source_party_id,target_party_id,created_at DESC) WHERE consumed_at IS NULL;
CREATE INDEX dcl_party_relationship_merge_events_source_idx ON dcl_party_relationship_merge_events(source_object_id,occurred_at DESC) INCLUDE (merge_event_id);

INSERT INTO object_number_counters(domain,entity,last_value)
SELECT 'dcl',entity,GREATEST(COALESCE(MAX(last_value) FILTER (WHERE domain='bob'),0),COALESCE(MAX(last_value) FILTER (WHERE domain='dcl'),0),COALESCE(MAX((substring(code FROM '[0-9]+$'))::integer),0))
FROM object_number_counters FULL JOIN dcl_subjects USING(entity)
WHERE entity IN ('employee','customer','supplier','other-unit','sales-partner','customer-account')
GROUP BY entity
ON CONFLICT(domain,entity) DO UPDATE SET last_value=GREATEST(object_number_counters.last_value,EXCLUDED.last_value);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM bob_objects WHERE entity IN ('employee','customer','supplier','other-unit','sales-partner','customer-account'))
     OR to_regclass('public.bob_party_currents') IS NOT NULL
     OR to_regclass('public.bob_customer_relationships') IS NOT NULL
     OR to_regprocedure('public.bob_reject_merged_party_relationship()') IS NOT NULL
     OR to_regprocedure('public.dcl_reject_merged_party_relationship()') IS NULL
     OR to_regclass('public.dcl_party_merge_preflights_open_idx') IS NULL
     OR to_regclass('public.dcl_party_relationship_merge_events_source_idx') IS NULL
     OR NOT EXISTS (
       SELECT 1 FROM pg_constraint
       WHERE conrelid='public.dcl_party_merge_events'::regclass
         AND conname='dcl_party_merge_events_preflight_id_key'
         AND contype='u'
     )
     OR (SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal AND tgname IN (
       'dcl_customer_relationship_merged_party_ck',
       'dcl_employment_relationship_merged_party_ck',
       'dcl_supplier_relationship_merged_party_ck',
       'dcl_service_relationship_merged_party_ck',
       'dcl_sales_relationship_merged_party_ck'
     ))<>5
     OR EXISTS (SELECT 1 FROM dcl_subjects subject WHERE subject.entity IN ('employee','customer','supplier','other-unit','sales-partner','customer-account') AND (subject.code IS NULL OR NOT EXISTS (SELECT 1 FROM approval_entries entry WHERE entry.domain='dcl' AND entry.entity=subject.entity AND entry.subject_id=subject.id)))
     OR EXISTS (
       SELECT 1 FROM dcl_subjects subject
       WHERE subject.entity IN ('party','employee','customer','supplier','other-unit','sales-partner','customer-account')
         AND NOT CASE subject.entity
           WHEN 'party' THEN EXISTS (SELECT 1 FROM dcl_parties root WHERE root.id=subject.id)
           WHEN 'employee' THEN EXISTS (SELECT 1 FROM dcl_employment_relationships root WHERE root.object_id=subject.id)
           WHEN 'customer' THEN EXISTS (SELECT 1 FROM dcl_customer_relationships root WHERE root.object_id=subject.id)
           WHEN 'supplier' THEN EXISTS (SELECT 1 FROM dcl_supplier_relationships root WHERE root.object_id=subject.id)
           WHEN 'other-unit' THEN EXISTS (SELECT 1 FROM dcl_service_relationships root WHERE root.object_id=subject.id)
           WHEN 'sales-partner' THEN EXISTS (SELECT 1 FROM dcl_sales_relationships root WHERE root.object_id=subject.id)
           WHEN 'customer-account' THEN EXISTS (SELECT 1 FROM dcl_customer_accounts root WHERE root.object_id=subject.id)
         END)
     OR EXISTS (
       SELECT 1 FROM approval_entries entry
       WHERE entry.domain='dcl' AND entry.entity IN ('party','employee','customer','supplier','other-unit','sales-partner','customer-account')
         AND NOT CASE entry.entity
           WHEN 'party' THEN EXISTS (SELECT 1 FROM dcl_party_versions snapshot WHERE snapshot.approval_entry_id=entry.id AND snapshot.party_id=entry.subject_id)
           WHEN 'employee' THEN EXISTS (SELECT 1 FROM dcl_employee_versions snapshot WHERE snapshot.approval_entry_id=entry.id)
           WHEN 'customer' THEN EXISTS (SELECT 1 FROM dcl_customer_versions snapshot WHERE snapshot.approval_entry_id=entry.id)
           WHEN 'supplier' THEN EXISTS (SELECT 1 FROM dcl_supplier_versions snapshot WHERE snapshot.approval_entry_id=entry.id)
           WHEN 'other-unit' THEN EXISTS (SELECT 1 FROM dcl_other_unit_versions snapshot WHERE snapshot.approval_entry_id=entry.id)
           WHEN 'sales-partner' THEN EXISTS (SELECT 1 FROM dcl_sales_partner_versions snapshot WHERE snapshot.approval_entry_id=entry.id)
           WHEN 'customer-account' THEN EXISTS (SELECT 1 FROM dcl_customer_account_versions snapshot WHERE snapshot.approval_entry_id=entry.id)
         END)
     OR EXISTS (SELECT entity,upper(code) FROM dcl_subjects WHERE code IS NOT NULL GROUP BY entity,upper(code) HAVING count(*)>1) THEN
    RAISE EXCEPTION 'issue #308 cutover retained obsolete BOB identity/current data or created an invalid DCL identity';
  END IF;
END $$;

COMMIT;

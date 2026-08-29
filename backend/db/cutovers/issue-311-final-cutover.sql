\set ON_ERROR_STOP on

-- #311 is the terminal guard for the #305 architecture cutover. Earlier
-- slices move each typed identity and payload in place; this step refuses any
-- incomplete chain, retires the last BOB number-counter namespace, and leaves
-- the database with DCL subject + Approval + typed snapshot as the only path.
BEGIN;

LOCK TABLE object_number_counters, dcl_subjects, approval_entries,
  approval_events IN ACCESS EXCLUSIVE MODE;

CREATE TEMP TABLE issue_311_typed_snapshots ON COMMIT DROP AS
SELECT approval_entry_id, 'operating-entity'::text AS entity, NULL::text AS owned_subject_id FROM dcl_operating_entity_versions
UNION ALL SELECT approval_entry_id, 'warehouse', NULL FROM dcl_warehouse_versions
UNION ALL SELECT approval_entry_id, 'vehicle', NULL FROM dcl_vehicle_versions
UNION ALL SELECT approval_entry_id, 'fund-account', NULL FROM dcl_fund_account_versions
UNION ALL SELECT approval_entry_id, 'product', NULL FROM dcl_product_versions
UNION ALL SELECT approval_entry_id, 'party', party_id FROM dcl_party_versions
UNION ALL SELECT approval_entry_id, 'employee', NULL FROM dcl_employee_versions
UNION ALL SELECT approval_entry_id, 'other-unit', NULL FROM dcl_other_unit_versions
UNION ALL SELECT approval_entry_id, 'sales-partner', NULL FROM dcl_sales_partner_versions
UNION ALL SELECT approval_entry_id, 'supplier', NULL FROM dcl_supplier_versions
UNION ALL SELECT approval_entry_id, 'customer', NULL FROM dcl_customer_versions
UNION ALL SELECT approval_entry_id, 'customer-account', NULL FROM dcl_customer_account_versions
UNION ALL SELECT approval_entry_id, 'acc-mapping', mapping_id FROM dcl_acc_mapping_versions
UNION ALL SELECT approval_entry_id, 'rpt-definition', NULL FROM dcl_rpt_definition_versions
UNION ALL SELECT approval_entry_id, 'wfl-process-definition', definition_id FROM dcl_wfl_process_definition_versions;

CREATE TEMP TABLE issue_311_typed_roots ON COMMIT DROP AS
SELECT id AS object_id, 'party'::text AS entity FROM dcl_parties
UNION ALL SELECT object_id, 'customer' FROM dcl_customer_relationships
UNION ALL SELECT object_id, 'employee' FROM dcl_employment_relationships
UNION ALL SELECT object_id, 'supplier' FROM dcl_supplier_relationships
UNION ALL SELECT object_id, 'other-unit' FROM dcl_service_relationships
UNION ALL SELECT object_id, 'sales-partner' FROM dcl_sales_relationships
UNION ALL SELECT object_id, 'customer-account' FROM dcl_customer_accounts;

DO $$
DECLARE
  obsolete_relation text;
  missing_constraint text;
BEGIN
  SELECT relation_name INTO obsolete_relation
  FROM unnest(ARRAY[
    'bob_objects', 'bob_operating_entities', 'bob_warehouses', 'bob_vehicles',
    'bob_fund_accounts', 'bob_products', 'bob_parties', 'bob_party_currents',
    'bob_party_identifiers', 'bob_customer_relationships', 'bob_customer_accounts',
    'bob_employment_relationships', 'bob_supplier_relationships',
    'bob_service_relationships', 'bob_sales_relationships', 'bob_customers',
    'bob_customer_account_currents', 'bob_employees', 'bob_suppliers',
    'bob_other_units', 'bob_sales_partners', 'rpt_definitions'
  ]) AS obsolete(relation_name)
  WHERE to_regclass(format('public.%I', relation_name)) IS NOT NULL
  LIMIT 1;
  IF obsolete_relation IS NOT NULL THEN
    RAISE EXCEPTION 'issue #311 found obsolete BOB identity/current relation: %', obsolete_relation;
  END IF;

  IF EXISTS (
    SELECT 1 FROM approval_entries
    WHERE domain='bob' AND version_no IS NOT NULL
  ) OR EXISTS (
    SELECT 1 FROM approval_events
    WHERE domain='bob' AND version_no IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'issue #311 found versioned Approval history still owned by BOB';
  END IF;

  IF EXISTS (
    SELECT entity, upper(code)
    FROM dcl_subjects
    WHERE code IS NOT NULL
    GROUP BY entity, upper(code)
    HAVING count(*)>1
  ) THEN
    RAISE EXCEPTION 'issue #311 found duplicate DCL entity + business code';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM dcl_subjects subject
    WHERE NOT EXISTS (
      SELECT 1 FROM approval_entries entry
      WHERE entry.domain='dcl' AND entry.entity=subject.entity
        AND entry.subject_id=subject.id AND entry.version_no IS NOT NULL
    )
  ) OR EXISTS (
    SELECT 1
    FROM approval_entries entry
    WHERE entry.domain='dcl' AND entry.version_no IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM dcl_subjects subject
        WHERE subject.id=entry.subject_id AND subject.entity=entry.entity
      )
  ) THEN
    RAISE EXCEPTION 'issue #311 found an orphan DCL subject or Approval Entry';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM issue_311_typed_snapshots snapshot
    LEFT JOIN approval_entries entry ON entry.id=snapshot.approval_entry_id
    WHERE entry.id IS NULL OR entry.domain<>'dcl' OR entry.entity<>snapshot.entity
       OR (snapshot.owned_subject_id IS NOT NULL AND entry.subject_id<>snapshot.owned_subject_id)
  ) OR EXISTS (
    SELECT 1
    FROM approval_entries entry
    WHERE entry.domain='dcl' AND entry.version_no IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM issue_311_typed_snapshots snapshot
        WHERE snapshot.approval_entry_id=entry.id AND snapshot.entity=entry.entity
      )
  ) THEN
    RAISE EXCEPTION 'issue #311 found an orphan or mismatched typed DCL snapshot';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM issue_311_typed_roots root
    LEFT JOIN dcl_subjects subject
      ON subject.id=root.object_id AND subject.entity=root.entity
    WHERE subject.id IS NULL
  ) OR EXISTS (
    SELECT 1
    FROM dcl_subjects subject
    WHERE subject.entity IN ('party','customer','employee','supplier','other-unit','sales-partner','customer-account')
      AND NOT EXISTS (
        SELECT 1 FROM issue_311_typed_roots root
        WHERE root.object_id=subject.id AND root.entity=subject.entity
      )
  ) THEN
    RAISE EXCEPTION 'issue #311 found an orphan or mismatched typed DCL stable root';
  END IF;

  SELECT constraint_name INTO missing_constraint
  FROM unnest(ARRAY[
    'dcl_parties_subject_fkey',
    'dcl_customer_relationships_subject_fkey',
    'dcl_customer_relationships_operating_fkey',
    'dcl_employment_relationships_subject_fkey',
    'dcl_employment_relationships_operating_fkey',
    'dcl_supplier_relationships_subject_fkey',
    'dcl_supplier_relationships_operating_fkey',
    'dcl_service_relationships_subject_fkey',
    'dcl_service_relationships_operating_fkey',
    'dcl_sales_relationships_subject_fkey',
    'dcl_sales_relationships_operating_fkey',
    'dcl_customer_accounts_subject_fkey',
    'dcl_fund_account_operating_object_fk',
    'dcl_vehicle_versions_carrier_operating_fk',
    'dcl_vehicle_versions_carrier_service_relationship_fk',
    'dcl_warehouse_versions_manager_employee_id_manager_employee_ent',
    'dcl_supplier_versions_default_purchaser_id_fkey',
    'dcl_product_formula_lines_material_object_id_fkey'
  ]) AS required(constraint_name)
  WHERE NOT EXISTS (
    SELECT 1 FROM pg_constraint constraint_row
    WHERE constraint_row.conname=constraint_name AND constraint_row.convalidated
  )
  LIMIT 1;
  IF missing_constraint IS NOT NULL THEN
    RAISE EXCEPTION 'issue #311 found missing typed entity constraint: %', missing_constraint;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM object_number_counters bob_counter
    LEFT JOIN object_number_counters dcl_counter
      ON dcl_counter.domain='dcl' AND dcl_counter.entity=bob_counter.entity
    WHERE bob_counter.domain='bob'
      AND (dcl_counter.last_value IS NULL OR dcl_counter.last_value<bob_counter.last_value)
  ) THEN
    RAISE EXCEPTION 'issue #311 found a BOB code counter not preserved by DCL';
  END IF;
END $$;

DELETE FROM object_number_counters WHERE domain='bob';
ALTER TABLE object_number_counters DROP CONSTRAINT object_number_counters_domain_check;
ALTER TABLE object_number_counters ADD CONSTRAINT object_number_counters_domain_check
  CHECK (domain IN ('aux','acc','dcl'));

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM object_number_counters WHERE domain='bob')
     OR position('bob' IN pg_get_constraintdef(
       (SELECT oid FROM pg_constraint
        WHERE conrelid='object_number_counters'::regclass
          AND conname='object_number_counters_domain_check')
     ))>0 THEN
    RAISE EXCEPTION 'issue #311 did not retire the BOB code-counter namespace';
  END IF;
END $$;

SELECT
  (SELECT count(*) FROM dcl_subjects) AS dcl_subjects,
  (SELECT count(*) FROM approval_entries WHERE domain='dcl' AND version_no IS NOT NULL) AS dcl_versions,
  (SELECT count(*) FROM issue_311_typed_snapshots) AS typed_snapshots,
  (SELECT count(*) FROM issue_311_typed_roots) AS typed_stable_roots;

COMMIT;

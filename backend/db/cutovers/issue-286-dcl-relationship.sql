\set ON_ERROR_STOP on

-- One-time, deliberately non-idempotent cutover for #286. Run while the
-- Other Unit and Sales Partner declaration surfaces are stopped, then deploy
-- the matching application SHA.
BEGIN;

LOCK TABLE bob_objects, bob_service_relationships, bob_sales_relationships,
  bob_service_relationship_versions, bob_sales_partner_versions,
  dcl_subjects, approval_entries, approval_events, app_permissions
  IN ACCESS EXCLUSIVE MODE;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM bob_service_relationship_versions p
    WHERE (p.settlement_method_id IS NULL) <> (p.settlement_method_approval_entry_id IS NULL)
  ) THEN
    RAISE EXCEPTION 'issue #286 Other Unit has an incomplete settlement-method exact reference';
  END IF;
  IF EXISTS (
    SELECT 1 FROM bob_objects o WHERE o.entity IN ('other-unit','sales-partner')
    AND NOT EXISTS (
      SELECT 1 FROM bob_service_relationships r WHERE o.entity='other-unit' AND r.object_id=o.id
      UNION ALL
      SELECT 1 FROM bob_sales_relationships r WHERE o.entity='sales-partner' AND r.object_id=o.id
    )
  ) THEN
    RAISE EXCEPTION 'issue #286 relationship root is missing its immutable Party to operating-entity identity';
  END IF;
END $$;

ALTER TABLE dcl_subjects DROP CONSTRAINT dcl_subjects_entity_check;
ALTER TABLE dcl_subjects ADD CONSTRAINT dcl_subjects_entity_check CHECK (
  entity IN ('operating-entity','warehouse','vehicle','fund-account','product','party','employee','other-unit','sales-partner')
);

CREATE TABLE dcl_other_unit_versions (
  approval_entry_id character varying(26) PRIMARY KEY REFERENCES approval_entries(id) ON DELETE RESTRICT,
  contact_name character varying(100), contact_phone character varying(32), email character varying(254), address character varying(500),
  settlement_method_id character varying(26), settlement_method_approval_entry_id character varying(26),
  settlement_method_code character varying(32), settlement_method_name character varying(200), settlement_term_code character varying(32),
  settlement_rule_type character varying(32), settlement_month_offset integer NOT NULL DEFAULT 0,
  settlement_day_of_month integer NOT NULL DEFAULT 0, settlement_day_offset integer NOT NULL DEFAULT 0,
  remark character varying(1000), enabled boolean NOT NULL,
  CONSTRAINT dcl_other_unit_settlement_ck CHECK (
    (settlement_method_id IS NULL)=(settlement_method_approval_entry_id IS NULL)
    AND (settlement_method_id IS NULL)=(settlement_method_code IS NULL)
    AND (settlement_method_id IS NULL)=(settlement_method_name IS NULL)
    AND (settlement_method_id IS NULL)=(settlement_term_code IS NULL)
    AND (settlement_method_id IS NULL)=(settlement_rule_type IS NULL)
    AND (settlement_method_id IS NOT NULL OR (settlement_month_offset=0 AND settlement_day_of_month=0 AND settlement_day_offset=0))
  ),
  CONSTRAINT dcl_other_unit_day_of_month_ck CHECK (settlement_day_of_month BETWEEN 0 AND 31),
  CONSTRAINT dcl_other_unit_day_offset_ck CHECK (settlement_day_offset >= 0),
  CONSTRAINT dcl_other_unit_month_offset_ck CHECK (settlement_month_offset >= 0)
);
CREATE INDEX dcl_other_unit_versions_settlement_method_idx ON dcl_other_unit_versions(settlement_method_id);

CREATE TABLE dcl_sales_partner_versions (
  approval_entry_id character varying(26) PRIMARY KEY REFERENCES approval_entries(id) ON DELETE RESTRICT,
  capabilities character varying(32)[] NOT NULL DEFAULT '{}', contact_name character varying(100), contact_phone character varying(32),
  email character varying(254), address character varying(500), remark character varying(1000), enabled boolean NOT NULL,
  CONSTRAINT dcl_sales_partner_capabilities_ck CHECK (
    capabilities <@ ARRAY['EXTERNAL_PART_TIME'::character varying(32),'CHANNEL_PARTNER'::character varying(32)]
    AND cardinality(capabilities)<=2 AND (cardinality(capabilities)<2 OR capabilities[1]<>capabilities[2])
  )
);

CREATE TABLE bob_other_units (
  object_id character varying(26) PRIMARY KEY REFERENCES bob_objects(id) ON DELETE RESTRICT,
  source_approval_entry_id character varying(26) NOT NULL UNIQUE REFERENCES approval_entries(id) ON DELETE RESTRICT,
  enabled boolean NOT NULL, updated_at timestamp with time zone NOT NULL DEFAULT now(), updated_by character varying(26) NOT NULL
);
CREATE TABLE bob_sales_partners (
  object_id character varying(26) PRIMARY KEY REFERENCES bob_objects(id) ON DELETE RESTRICT,
  source_approval_entry_id character varying(26) NOT NULL UNIQUE REFERENCES approval_entries(id) ON DELETE RESTRICT,
  enabled boolean NOT NULL, updated_at timestamp with time zone NOT NULL DEFAULT now(), updated_by character varying(26) NOT NULL
);

INSERT INTO dcl_subjects(id,entity,created_at,created_by)
SELECT id,entity,created_at,created_by FROM bob_objects WHERE entity IN ('other-unit','sales-partner');

INSERT INTO dcl_other_unit_versions(
  approval_entry_id,contact_name,contact_phone,email,address,settlement_method_id,settlement_method_approval_entry_id,
  settlement_method_code,settlement_method_name,settlement_term_code,settlement_rule_type,settlement_month_offset,
  settlement_day_of_month,settlement_day_offset,remark,enabled
)
SELECT p.approval_entry_id,p.contact_name,p.contact_phone,p.email,p.address,p.settlement_method_id,p.settlement_method_approval_entry_id,
  p.settlement_method_code,p.settlement_method_name,p.settlement_term_code,p.settlement_rule_type,p.settlement_month_offset,
  p.settlement_day_of_month,p.settlement_day_offset,p.remark,o.enabled
FROM bob_service_relationship_versions p
JOIN approval_entries e ON e.id=p.approval_entry_id AND e.domain='bob' AND e.entity='other-unit'
JOIN bob_objects o ON o.id=e.subject_id AND o.entity='other-unit';

INSERT INTO dcl_sales_partner_versions(approval_entry_id,capabilities,contact_name,contact_phone,email,address,remark,enabled)
SELECT p.approval_entry_id,p.capabilities,p.contact_name,p.contact_phone,p.email,p.address,p.remark,o.enabled
FROM bob_sales_partner_versions p
JOIN approval_entries e ON e.id=p.approval_entry_id AND e.domain='bob' AND e.entity='sales-partner'
JOIN bob_objects o ON o.id=e.subject_id AND o.entity='sales-partner';

UPDATE approval_entries SET domain='dcl' WHERE domain='bob' AND entity IN ('other-unit','sales-partner');
UPDATE approval_events SET domain='dcl' WHERE domain='bob' AND entity IN ('other-unit','sales-partner');

INSERT INTO bob_other_units(object_id,source_approval_entry_id,enabled,updated_at,updated_by)
SELECT e.subject_id,e.id,v.enabled,e.updated_at,e.updated_by
FROM approval_entries e JOIN dcl_other_unit_versions v ON v.approval_entry_id=e.id
WHERE e.domain='dcl' AND e.entity='other-unit' AND e.status='APPROVED'
  AND e.version_no=(SELECT max(x.version_no) FROM approval_entries x WHERE x.domain='dcl' AND x.entity='other-unit' AND x.subject_id=e.subject_id AND x.status='APPROVED');
INSERT INTO bob_sales_partners(object_id,source_approval_entry_id,enabled,updated_at,updated_by)
SELECT e.subject_id,e.id,v.enabled,e.updated_at,e.updated_by
FROM approval_entries e JOIN dcl_sales_partner_versions v ON v.approval_entry_id=e.id
WHERE e.domain='dcl' AND e.entity='sales-partner' AND e.status='APPROVED'
  AND e.version_no=(SELECT max(x.version_no) FROM approval_entries x WHERE x.domain='dcl' AND x.entity='sales-partner' AND x.subject_id=e.subject_id AND x.status='APPROVED');

UPDATE app_permissions
SET path=regexp_replace(path, '^/bob/(other-unit|sales-partner)/', '/dcl/\\1/'), domain='dcl', updated_at=clock_timestamp(), revision=revision+1
WHERE path ~ '^/bob/(other-unit|sales-partner)/' AND action NOT IN ('query','get');

DO $$
DECLARE legacy_other bigint; legacy_sales bigint; approved_other bigint; approved_sales bigint;
BEGIN
  SELECT count(*) INTO legacy_other FROM bob_service_relationship_versions;
  SELECT count(*) INTO legacy_sales FROM bob_sales_partner_versions;
  SELECT count(DISTINCT subject_id) INTO approved_other FROM approval_entries WHERE domain='dcl' AND entity='other-unit' AND status='APPROVED';
  SELECT count(DISTINCT subject_id) INTO approved_sales FROM approval_entries WHERE domain='dcl' AND entity='sales-partner' AND status='APPROVED';
  IF legacy_other<>(SELECT count(*) FROM dcl_other_unit_versions) OR legacy_sales<>(SELECT count(*) FROM dcl_sales_partner_versions)
     OR approved_other<>(SELECT count(*) FROM bob_other_units) OR approved_sales<>(SELECT count(*) FROM bob_sales_partners) THEN
    RAISE EXCEPTION 'issue #286 relationship version/current count mismatch';
  END IF;
  IF EXISTS (SELECT 1 FROM approval_entries WHERE domain='bob' AND entity IN ('other-unit','sales-partner'))
     OR EXISTS (SELECT 1 FROM approval_events WHERE domain='bob' AND entity IN ('other-unit','sales-partner')) THEN
    RAISE EXCEPTION 'issue #286 left BOB-owned relationship approval data';
  END IF;
END $$;

DROP TABLE bob_service_relationship_versions;
DROP TABLE bob_sales_partner_versions;

COMMIT;

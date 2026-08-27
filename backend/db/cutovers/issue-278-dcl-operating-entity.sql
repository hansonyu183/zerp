\set ON_ERROR_STOP on

-- One-time in-place cutover for issue #278. Run against the pre-#278 schema
-- while application writes are stopped, then deploy the matching application
-- SHA. IDs, codes, Approval entry IDs, version numbers and audit event IDs are
-- intentionally retained; this script creates no compatibility views.
BEGIN;

LOCK TABLE bob_objects, bob_operating_entity_versions, approval_entries,
  approval_events, app_permissions IN ACCESS EXCLUSIVE MODE;

CREATE TABLE dcl_subjects (
  id character varying(26) PRIMARY KEY,
  entity character varying(64) NOT NULL CHECK (entity='operating-entity'),
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  created_by character varying(26) NOT NULL,
  UNIQUE(id,entity)
);

CREATE TABLE dcl_operating_entity_versions (
  approval_entry_id character varying(26) PRIMARY KEY
    REFERENCES approval_entries(id) ON DELETE RESTRICT,
  legal_name character varying(200) NOT NULL
    CHECK (length(btrim(legal_name)) BETWEEN 1 AND 200),
  short_name character varying(100),
  tax_number character varying(100),
  address character varying(500),
  phone character varying(100),
  remark character varying(1000),
  enabled boolean NOT NULL
);

CREATE TABLE bob_operating_entities (
  object_id character varying(26) PRIMARY KEY
    REFERENCES bob_objects(id) ON DELETE RESTRICT,
  source_approval_entry_id character varying(26) NOT NULL UNIQUE
    REFERENCES approval_entries(id) ON DELETE RESTRICT,
  legal_name character varying(200) NOT NULL
    CHECK (length(btrim(legal_name)) BETWEEN 1 AND 200),
  short_name character varying(100),
  tax_number character varying(100),
  address character varying(500),
  phone character varying(100),
  remark character varying(1000),
  enabled boolean NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_by character varying(26) NOT NULL
);

CREATE INDEX bob_operating_entities_tax_idx
  ON bob_operating_entities (upper(btrim(tax_number)))
  WHERE tax_number IS NOT NULL AND btrim(tax_number)<>'';

INSERT INTO dcl_subjects(id,entity,created_at,created_by)
SELECT id,entity,created_at,created_by
FROM bob_objects
WHERE entity='operating-entity';

INSERT INTO dcl_operating_entity_versions(
  approval_entry_id,legal_name,short_name,tax_number,address,phone,remark,enabled
)
SELECT version.approval_entry_id,version.legal_name,version.short_name,
       version.tax_number,version.address,version.phone,version.remark,object.enabled
FROM bob_operating_entity_versions version
JOIN approval_entries entry
  ON entry.id=version.approval_entry_id
 AND entry.domain='bob' AND entry.entity='operating-entity'
JOIN bob_objects object
  ON object.id=entry.subject_id AND object.entity='operating-entity';

INSERT INTO bob_operating_entities(
  object_id,source_approval_entry_id,legal_name,short_name,tax_number,address,
  phone,remark,enabled,updated_at,updated_by
)
SELECT object.id,entry.id,version.legal_name,version.short_name,
       version.tax_number,version.address,version.phone,version.remark,
       object.enabled,object.updated_at,object.updated_by
FROM bob_objects object
JOIN LATERAL (
  SELECT approved.*
  FROM approval_entries approved
  WHERE approved.domain='bob' AND approved.entity='operating-entity'
    AND approved.subject_id=object.id AND approved.status='APPROVED'
  ORDER BY approved.version_no DESC
  LIMIT 1
) entry ON true
JOIN bob_operating_entity_versions version ON version.approval_entry_id=entry.id
WHERE object.entity='operating-entity';

UPDATE approval_entries
SET domain='dcl'
WHERE domain='bob' AND entity='operating-entity';

UPDATE approval_events
SET domain='dcl'
WHERE domain='bob' AND entity='operating-entity';

UPDATE app_permissions permission
SET path=mapping.path,
    domain=mapping.domain,
    action=mapping.action,
    description=mapping.description,
    revision=permission.revision+1,
    updated_at=clock_timestamp()
FROM (VALUES
  ('01JBOB83000000000000000001','/dcl/operating-entity/approve','dcl','approve','审核经营主体'),
  ('01JBOB83000000000000000002','/dcl/operating-entity/audit-history','dcl','audit-history','查看经营主体审计'),
  ('01JBOB83000000000000000003','/dcl/operating-entity/create','dcl','create','创建经营主体'),
  ('01JBOB83000000000000000004','/dcl/operating-entity/delete','dcl','delete','删除经营主体'),
  ('01JBOB83000000000000000005','/dcl/operating-entity/get','dcl','get','查看经营主体申报版本'),
  ('01JBOB83000000000000000006','/dcl/operating-entity/query','dcl','query','查询经营主体申报'),
  ('01JBOB83000000000000000007','/bob/operating-entity/get','bob','get','查看经营主体'),
  ('01JBOB83000000000000000008','/bob/operating-entity/query','bob','query','查询经营主体'),
  ('01JBOB83000000000000000009','/dcl/operating-entity/reject','dcl','reject','驳回经营主体'),
  ('01JBOB83000000000000000010','/dcl/operating-entity/save','dcl','save','保存经营主体'),
  ('01JBOB83000000000000000011','/dcl/operating-entity/submit','dcl','submit','提交经营主体'),
  ('01JBOB83000000000000000012','/dcl/operating-entity/unapprove','dcl','unapprove','反审核经营主体'),
  ('01JBOB83000000000000000013','/dcl/operating-entity/unsubmit','dcl','unsubmit','撤回经营主体'),
  ('01JBOB83000000000000000014','/dcl/operating-entity/versions','dcl','versions','查看经营主体版本')
) mapping(id,path,domain,action,description)
WHERE permission.id=mapping.id;

DO $$
DECLARE
  object_count bigint;
  subject_count bigint;
  old_version_count bigint;
  new_version_count bigint;
  approved_subject_count bigint;
  current_count bigint;
BEGIN
  SELECT count(*) INTO object_count FROM bob_objects WHERE entity='operating-entity';
  SELECT count(*) INTO subject_count FROM dcl_subjects WHERE entity='operating-entity';
  SELECT count(*) INTO old_version_count FROM bob_operating_entity_versions;
  SELECT count(*) INTO new_version_count FROM dcl_operating_entity_versions;
  SELECT count(DISTINCT subject_id) INTO approved_subject_count
    FROM approval_entries WHERE domain='dcl' AND entity='operating-entity' AND status='APPROVED';
  SELECT count(*) INTO current_count FROM bob_operating_entities;
  IF object_count<>subject_count OR old_version_count<>new_version_count OR
     approved_subject_count<>current_count THEN
    RAISE EXCEPTION 'issue #278 cutover count mismatch: objects %, subjects %, old versions %, new versions %, approved subjects %, current %',
      object_count,subject_count,old_version_count,new_version_count,approved_subject_count,current_count;
  END IF;
  IF EXISTS (
    SELECT 1 FROM approval_entries
    WHERE domain='bob' AND entity='operating-entity'
  ) OR EXISTS (
    SELECT 1 FROM approval_events
    WHERE domain='bob' AND entity='operating-entity'
  ) THEN
    RAISE EXCEPTION 'issue #278 cutover left BOB-owned operating entity approval data';
  END IF;
  IF (SELECT count(*) FROM app_permissions WHERE id LIKE '01JBOB830000000000000000%' AND
      ((id IN ('01JBOB83000000000000000007','01JBOB83000000000000000008') AND domain='bob') OR
       (id NOT IN ('01JBOB83000000000000000007','01JBOB83000000000000000008') AND domain='dcl')))<>14 THEN
    RAISE EXCEPTION 'issue #278 permission cutover did not update all 14 stable permission IDs';
  END IF;
END $$;

DROP TABLE bob_operating_entity_versions;

COMMIT;

-- Post-commit proof (must all return zero except the three equal counts).
SELECT
  (SELECT count(*) FROM bob_objects WHERE entity='operating-entity') AS stable_objects,
  (SELECT count(*) FROM dcl_subjects WHERE entity='operating-entity') AS dcl_subjects,
  (SELECT count(*) FROM dcl_operating_entity_versions) AS dcl_versions,
  (SELECT count(*) FROM bob_operating_entities) AS bob_current;
SELECT count(*) AS obsolete_bob_approval_entries
FROM approval_entries WHERE domain='bob' AND entity='operating-entity';
SELECT count(*) AS obsolete_bob_approval_events
FROM approval_events WHERE domain='bob' AND entity='operating-entity';

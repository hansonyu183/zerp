\set ON_ERROR_STOP on

-- One-time in-place cutover for issue #279. Run against the post-#278,
-- pre-#279 schema while warehouse writes are stopped, then deploy the matching
-- application SHA. It deliberately retains stable object, approval and event
-- IDs, while removing the former BOB warehouse version store and write paths.
BEGIN;

LOCK TABLE bob_objects, dcl_subjects, bob_warehouse_versions, approval_entries,
  approval_events, app_permissions IN ACCESS EXCLUSIVE MODE;

ALTER TABLE dcl_subjects DROP CONSTRAINT dcl_subjects_entity_check;
ALTER TABLE dcl_subjects ADD CONSTRAINT dcl_subjects_entity_check
  CHECK (entity IN ('operating-entity','warehouse'));

CREATE TABLE dcl_warehouse_versions (
  approval_entry_id character varying(26) PRIMARY KEY
    REFERENCES approval_entries(id) ON DELETE RESTRICT,
  category_id character varying(26),
  category_approval_entry_id character varying(26),
  category_entity character varying(16) NOT NULL DEFAULT 'category'
    CHECK (category_entity='category'),
  name character varying(200) NOT NULL
    CHECK (length(btrim(name)) BETWEEN 1 AND 200),
  address character varying(500),
  contact_name character varying(100),
  contact_phone character varying(32),
  manager_employee_id character varying(26),
  manager_employee_approval_entry_id character varying(26),
  manager_employee_entity character varying(16) NOT NULL DEFAULT 'employee'
    CHECK (manager_employee_entity='employee'),
  remark character varying(1000),
  enabled boolean NOT NULL,
  FOREIGN KEY (category_id,category_entity) REFERENCES aux_objects(id,entity)
    ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (manager_employee_id,manager_employee_entity) REFERENCES bob_objects(id,entity)
    ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED
);
CREATE INDEX dcl_warehouse_versions_category_idx ON dcl_warehouse_versions(category_id);
CREATE INDEX dcl_warehouse_versions_manager_idx ON dcl_warehouse_versions(manager_employee_id);

CREATE TABLE bob_warehouses (
  object_id character varying(26) PRIMARY KEY REFERENCES bob_objects(id) ON DELETE RESTRICT,
  source_approval_entry_id character varying(26) NOT NULL UNIQUE REFERENCES approval_entries(id) ON DELETE RESTRICT,
  category_id character varying(26),
  category_approval_entry_id character varying(26),
  name character varying(200) NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 200),
  address character varying(500),
  contact_name character varying(100),
  contact_phone character varying(32),
  manager_employee_id character varying(26),
  manager_employee_approval_entry_id character varying(26),
  remark character varying(1000),
  enabled boolean NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_by character varying(26) NOT NULL
);

INSERT INTO dcl_subjects(id,entity,created_at,created_by)
SELECT id,entity,created_at,created_by FROM bob_objects WHERE entity='warehouse';

INSERT INTO dcl_warehouse_versions(
  approval_entry_id,category_id,category_approval_entry_id,category_entity,name,address,
  contact_name,contact_phone,manager_employee_id,manager_employee_approval_entry_id,
  manager_employee_entity,remark,enabled
)
SELECT version.approval_entry_id,version.category_id,version.category_approval_entry_id,
       version.category_entity,version.name,version.address,version.contact_name,
       version.contact_phone,version.manager_employee_id,
       version.manager_employee_approval_entry_id,version.manager_employee_entity,
       version.remark,object.enabled
FROM bob_warehouse_versions version
JOIN approval_entries entry ON entry.id=version.approval_entry_id
  AND entry.domain='bob' AND entry.entity='warehouse'
JOIN bob_objects object ON object.id=entry.subject_id AND object.entity='warehouse';

INSERT INTO bob_warehouses(
  object_id,source_approval_entry_id,category_id,category_approval_entry_id,name,address,
  contact_name,contact_phone,manager_employee_id,manager_employee_approval_entry_id,
  remark,enabled,updated_at,updated_by
)
SELECT object.id,entry.id,version.category_id,version.category_approval_entry_id,
       version.name,version.address,version.contact_name,version.contact_phone,
       version.manager_employee_id,version.manager_employee_approval_entry_id,
       version.remark,object.enabled,object.updated_at,object.updated_by
FROM bob_objects object
JOIN LATERAL (
  SELECT approved.* FROM approval_entries approved
  WHERE approved.domain='bob' AND approved.entity='warehouse'
    AND approved.subject_id=object.id AND approved.status='APPROVED'
  ORDER BY approved.version_no DESC LIMIT 1
) entry ON true
JOIN bob_warehouse_versions version ON version.approval_entry_id=entry.id
WHERE object.entity='warehouse';

UPDATE approval_entries SET domain='dcl'
WHERE domain='bob' AND entity='warehouse';
UPDATE approval_events SET domain='dcl'
WHERE domain='bob' AND entity='warehouse';

UPDATE app_permissions permission
SET path=mapping.path, domain=mapping.domain, action=mapping.action,
    description=mapping.description, revision=permission.revision+1,
    updated_at=clock_timestamp()
FROM (VALUES
  ('01JBOB00000000000000000061','/dcl/warehouse/approve','dcl','approve','审核通过仓库声明'),
  ('01JBOB00000000000000000062','/dcl/warehouse/audit-history','dcl','audit-history','查看仓库声明审核记录'),
  ('01JBOB00000000000000000063','/dcl/warehouse/create','dcl','create','创建仓库声明'),
  ('01JBOB00000000000000000067','/dcl/warehouse/reject','dcl','reject','审核驳回仓库声明'),
  ('01JBOB00000000000000000068','/dcl/warehouse/save','dcl','save','保存仓库声明草稿'),
  ('01JBOB00000000000000000069','/dcl/warehouse/submit','dcl','submit','提交仓库声明审核'),
  ('01JBOB00000000000000000070','/dcl/warehouse/versions','dcl','versions','查看仓库声明版本'),
  ('01JBOB00000000000000000086','/dcl/warehouse/delete','dcl','delete','删除首版仓库声明草稿'),
  ('01JBOB00000000000000000153','/dcl/warehouse/unsubmit','dcl','unsubmit','撤回仓库声明审核'),
  ('01JBOB00000000000000000154','/dcl/warehouse/unapprove','dcl','unapprove','反审核仓库声明'),
  ('01JBOB00000000000000000155','/dcl/warehouse/get','dcl','get','查看仓库声明'),
  ('01JBOB00000000000000000156','/dcl/warehouse/query','dcl','query','查询仓库声明')
) mapping(id,path,domain,action,description)
WHERE permission.id=mapping.id;

DO $$
DECLARE
  object_count bigint; subject_count bigint; old_version_count bigint;
  new_version_count bigint; approved_subject_count bigint; current_count bigint;
BEGIN
  SELECT count(*) INTO object_count FROM bob_objects WHERE entity='warehouse';
  SELECT count(*) INTO subject_count FROM dcl_subjects WHERE entity='warehouse';
  SELECT count(*) INTO old_version_count FROM bob_warehouse_versions;
  SELECT count(*) INTO new_version_count FROM dcl_warehouse_versions;
  SELECT count(DISTINCT subject_id) INTO approved_subject_count FROM approval_entries
    WHERE domain='dcl' AND entity='warehouse' AND status='APPROVED';
  SELECT count(*) INTO current_count FROM bob_warehouses;
  IF object_count<>subject_count OR old_version_count<>new_version_count OR approved_subject_count<>current_count THEN
    RAISE EXCEPTION 'issue #279 cutover count mismatch: objects %, subjects %, old versions %, new versions %, approved subjects %, current %', object_count,subject_count,old_version_count,new_version_count,approved_subject_count,current_count;
  END IF;
  IF EXISTS (SELECT 1 FROM approval_entries WHERE domain='bob' AND entity='warehouse')
    OR EXISTS (SELECT 1 FROM approval_events WHERE domain='bob' AND entity='warehouse') THEN
    RAISE EXCEPTION 'issue #279 cutover left BOB-owned warehouse approval data';
  END IF;
  IF (SELECT count(*) FROM app_permissions WHERE id IN (
      '01JBOB00000000000000000061','01JBOB00000000000000000062','01JBOB00000000000000000063',
      '01JBOB00000000000000000067','01JBOB00000000000000000068','01JBOB00000000000000000069',
      '01JBOB00000000000000000070','01JBOB00000000000000000086','01JBOB00000000000000000153',
      '01JBOB00000000000000000154','01JBOB00000000000000000155','01JBOB00000000000000000156'
    ) AND domain='dcl')<>12 THEN
    RAISE EXCEPTION 'issue #279 permission cutover did not update all DCL warehouse permission IDs';
  END IF;
  IF (SELECT count(*) FROM app_permissions WHERE id IN ('01JBOB00000000000000000065','01JBOB00000000000000000066')
      AND domain='bob' AND action IN ('get','query'))<>2 THEN
    RAISE EXCEPTION 'issue #279 permission cutover changed BOB warehouse current read IDs';
  END IF;
END $$;

DROP TABLE bob_warehouse_versions;
COMMIT;

SELECT
  (SELECT count(*) FROM bob_objects WHERE entity='warehouse') AS stable_objects,
  (SELECT count(*) FROM dcl_subjects WHERE entity='warehouse') AS dcl_subjects,
  (SELECT count(*) FROM dcl_warehouse_versions) AS dcl_versions,
  (SELECT count(*) FROM bob_warehouses) AS bob_current;
SELECT count(*) AS obsolete_bob_approval_entries FROM approval_entries WHERE domain='bob' AND entity='warehouse';
SELECT count(*) AS obsolete_bob_approval_events FROM approval_events WHERE domain='bob' AND entity='warehouse';

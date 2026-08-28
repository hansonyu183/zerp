\set ON_ERROR_STOP on

-- One-time in-place cutover for issue #292. Run against the post-#291,
-- pre-#292 schema while RPT definition writes are stopped, then deploy the
-- matching application SHA. It deliberately retains stable definition,
-- approval and event IDs, while removing the former RPT version store and
-- write paths.
BEGIN;

LOCK TABLE rpt_definitions, rpt_versions, dcl_subjects, approval_entries,
  approval_events, app_permissions, app_role_permissions IN ACCESS EXCLUSIVE MODE;

ALTER TABLE dcl_subjects DROP CONSTRAINT dcl_subjects_entity_check;
ALTER TABLE dcl_subjects ADD CONSTRAINT dcl_subjects_entity_check
  CHECK (entity IN ('operating-entity','warehouse','vehicle','fund-account','product','party','employee','other-unit','sales-partner','supplier','customer','customer-account','acc-mapping','rpt-definition'));

CREATE TABLE dcl_rpt_definition_versions (
  approval_entry_id character varying(26) PRIMARY KEY
    REFERENCES approval_entries(id) ON DELETE RESTRICT,
  definition_id character varying(26) NOT NULL
    REFERENCES rpt_definitions(id) ON DELETE CASCADE,
  name character varying(200) NOT NULL
    CHECK (btrim(name) <> ''),
  description character varying(1000) NOT NULL DEFAULT '',
  validity character varying(16) NOT NULL
    CHECK (validity IN ('VALID','INVALID')),
  sql_text text NOT NULL
    CHECK (btrim(sql_text) <> ''),
  parameters jsonb NOT NULL
    CHECK (jsonb_typeof(parameters) = 'array'),
  columns jsonb NOT NULL
    CHECK (jsonb_typeof(columns) = 'array'),
  invalidated_at timestamp with time zone,
  invalid_reason character varying(200),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  created_by character varying(26) NOT NULL,
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_by character varying(26) NOT NULL
);

CREATE TABLE dcl_rpt_definition_code_counters (
  counter_key text PRIMARY KEY,
  next_value integer NOT NULL CHECK (next_value BETWEEN 0 AND 999999)
);
INSERT INTO dcl_rpt_definition_code_counters(counter_key,next_value)
SELECT 'default',COALESCE(max(substring(code FROM '^rpt-([0-9]{6})$')::integer),0)
FROM rpt_definitions;

INSERT INTO dcl_subjects(id, entity, created_at, created_by)
SELECT id, 'rpt-definition', created_at, created_by FROM rpt_definitions;

INSERT INTO dcl_rpt_definition_versions(approval_entry_id, definition_id, name, description, validity, sql_text, parameters, columns, invalidated_at, invalid_reason, created_at, created_by, updated_at, updated_by)
SELECT v.approval_entry_id, v.definition_id, v.name, v.description, v.validity, v.sql_text, v.parameters, v.columns, v.invalidated_at, v.invalid_reason, v.created_at, v.created_by, v.updated_at, v.updated_by
FROM rpt_versions v;

UPDATE approval_entries SET domain='dcl', entity='rpt-definition'
WHERE domain='rpt' AND entity='definition';

UPDATE approval_events SET domain='dcl', entity='rpt-definition'
WHERE domain='rpt' AND entity='definition';

-- Permission cutover: reuse every live RPT definition permission ID for its
-- DCL equivalent so existing role grants remain intact. The obsolete stable
-- delete permission is removed; deletion is version-scoped in DCL.
UPDATE app_permissions permission
SET path=mapping.path, domain=mapping.domain, entity=mapping.entity, action=mapping.action,
    description=mapping.description, revision=permission.revision+1,
    updated_at=clock_timestamp()
FROM (VALUES
  ('01KRPT00000000000000000001','/dcl/rpt-definition/query','dcl','rpt-definition','query','查询报表定义声明'),
  ('01KRPT00000000000000000002','/dcl/rpt-definition/get','dcl','rpt-definition','get','查看报表定义声明'),
  ('01KRPT00000000000000000003','/dcl/rpt-definition/create','dcl','rpt-definition','create','创建报表定义声明'),
  ('01KRPT00000000000000000005','/dcl/rpt-definition/save','dcl','rpt-definition','save','保存报表定义声明草稿'),
  ('01KRPT00000000000000000006','/dcl/rpt-definition/approve','dcl','rpt-definition','approve','审核通过报表定义声明'),
  ('01KRPT00000000000000000007','/dcl/rpt-definition/unapprove','dcl','rpt-definition','unapprove','反审核报表定义声明'),
  ('01KRPT00000000000000000008','/dcl/rpt-definition/enable','dcl','rpt-definition','enable','启用报表定义'),
  ('01KRPT00000000000000000009','/dcl/rpt-definition/disable','dcl','rpt-definition','disable','停用报表定义'),
  ('01KRPT00000000000000000011','/dcl/rpt-definition/versions','dcl','rpt-definition','versions','查看报表定义声明版本'),
  ('01KRPT00000000000000000012','/dcl/rpt-definition/submit','dcl','rpt-definition','submit','提交报表定义声明审核'),
  ('01KRPT00000000000000000013','/dcl/rpt-definition/unsubmit','dcl','rpt-definition','unsubmit','撤回报表定义声明审核'),
  ('01KRPT00000000000000000014','/dcl/rpt-definition/reject','dcl','rpt-definition','reject','审核驳回报表定义声明'),
  ('01KRPT00000000000000000015','/dcl/rpt-definition/create-next','dcl','rpt-definition','create-next','创建下一报表定义声明版本'),
  ('01KRPT00000000000000000016','/dcl/rpt-definition/delete-version','dcl','rpt-definition','delete-version','删除报表定义声明草稿版本')
) mapping(id,path,domain,entity,action,description)
WHERE permission.id=mapping.id;

DELETE FROM app_role_permissions WHERE permission_id='01KRPT00000000000000000010';
DELETE FROM app_permissions WHERE id='01KRPT00000000000000000010';

-- Audit history had no RPT counterpart; inherit version-history grants.
INSERT INTO app_permissions(id, path, domain, entity, action, description, status, created_at, created_by, updated_at, updated_by, revision, menu_order)
VALUES
  ('01KRPT00000000000000000017', '/dcl/rpt-definition/audit-history', 'dcl', 'rpt-definition', 'audit-history', '查看报表定义声明审核记录', 'ENABLED', clock_timestamp(), NULL, clock_timestamp(), NULL, 1, NULL);

INSERT INTO app_role_permissions(role_id,permission_id,created_at,created_by)
SELECT role_id,'01KRPT00000000000000000017',created_at,created_by
FROM app_role_permissions WHERE permission_id='01KRPT00000000000000000011'
ON CONFLICT DO NOTHING;

-- Assertions
DO $$
DECLARE
  subject_count bigint; old_version_count bigint; new_version_count bigint;
BEGIN
  SELECT count(*) INTO subject_count FROM dcl_subjects WHERE entity='rpt-definition';
  SELECT count(*) INTO old_version_count FROM rpt_versions;
  SELECT count(*) INTO new_version_count FROM dcl_rpt_definition_versions;
  IF (SELECT count(*) FROM rpt_definitions)<>subject_count OR old_version_count<>new_version_count THEN
    RAISE EXCEPTION 'issue #292 cutover count mismatch: definitions %, subjects %, old versions %, new versions %',
      (SELECT count(*) FROM rpt_definitions), subject_count, old_version_count, new_version_count;
  END IF;
  IF EXISTS (SELECT 1 FROM approval_entries WHERE domain='rpt' AND entity='definition')
    OR EXISTS (SELECT 1 FROM approval_events WHERE domain='rpt' AND entity='definition') THEN
    RAISE EXCEPTION 'issue #292 cutover left RPT-owned definition approval data';
  END IF;
  IF (SELECT count(*) FROM app_permissions WHERE id IN (
      '01KRPT00000000000000000001','01KRPT00000000000000000002','01KRPT00000000000000000003',
      '01KRPT00000000000000000005','01KRPT00000000000000000006','01KRPT00000000000000000007',
      '01KRPT00000000000000000008','01KRPT00000000000000000009','01KRPT00000000000000000011',
      '01KRPT00000000000000000012','01KRPT00000000000000000013','01KRPT00000000000000000014',
      '01KRPT00000000000000000015','01KRPT00000000000000000016'
    ) AND domain='dcl' AND entity='rpt-definition')<>14 THEN
    RAISE EXCEPTION 'issue #292 permission cutover did not update all DCL rpt-definition permission IDs';
  END IF;
  IF EXISTS (SELECT 1 FROM app_permissions WHERE id='01KRPT00000000000000000010')
    OR NOT EXISTS (SELECT 1 FROM app_permissions WHERE id='01KRPT00000000000000000017'
      AND domain='dcl' AND entity='rpt-definition' AND action='audit-history') THEN
    RAISE EXCEPTION 'issue #292 permission cutover did not replace obsolete RPT definition permissions';
  END IF;
END $$;

DROP TABLE rpt_versions;
COMMIT;

SELECT
  (SELECT count(*) FROM rpt_definitions) AS stable_definitions,
  (SELECT count(*) FROM dcl_subjects WHERE entity='rpt-definition') AS dcl_subjects,
  (SELECT count(*) FROM dcl_rpt_definition_versions) AS dcl_versions;
SELECT count(*) AS obsolete_rpt_approval_entries FROM approval_entries WHERE domain='rpt' AND entity='definition';
SELECT count(*) AS obsolete_rpt_approval_events FROM approval_events WHERE domain='rpt' AND entity='definition';

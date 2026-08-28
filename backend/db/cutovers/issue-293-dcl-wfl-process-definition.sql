\set ON_ERROR_STOP on

-- One-time in-place cutover for issue #293. Run against the post-#292,
-- pre-#293 schema while DCL/WFL definition writes and WFL runtime instance
-- creation are stopped, then deploy the matching application SHA. Stable
-- definition IDs, Approval Entry IDs, version numbers, lifecycle state,
-- revisions, payloads, audit events and persisted instance pins are retained.
BEGIN;

LOCK TABLE wfl_process_definitions, wfl_definition_versions,
  wfl_definition_instances, dcl_subjects, approval_entries, approval_events,
  app_permissions, app_role_permissions IN ACCESS EXCLUSIVE MODE;

ALTER TABLE dcl_subjects DROP CONSTRAINT dcl_subjects_entity_check;
ALTER TABLE dcl_subjects ADD CONSTRAINT dcl_subjects_entity_check
  CHECK (entity IN ('operating-entity','warehouse','vehicle','fund-account','product','party','employee','other-unit','sales-partner','supplier','customer','customer-account','acc-mapping','rpt-definition','wfl-process-definition'));

CREATE TABLE dcl_wfl_process_definition_versions (
  approval_entry_id character varying(26) PRIMARY KEY,
  definition_id character varying(26) NOT NULL
    REFERENCES wfl_process_definitions(id) ON DELETE CASCADE,
  script text NOT NULL,
  diagnostic text,
  compiled jsonb NOT NULL,
  last_trial_approval_revision bigint
    CHECK (last_trial_approval_revision IS NULL OR last_trial_approval_revision > 0),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  created_by character varying(26) NOT NULL,
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_by character varying(26) NOT NULL
);

INSERT INTO dcl_subjects(id, entity, created_at, created_by)
SELECT id, 'wfl-process-definition', created_at, created_by
FROM wfl_process_definitions;

INSERT INTO dcl_wfl_process_definition_versions(
  approval_entry_id, definition_id, script, diagnostic, compiled,
  last_trial_approval_revision, created_at, created_by, updated_at, updated_by
)
SELECT approval_entry_id, definition_id, script, diagnostic, compiled,
       last_trial_approval_revision, created_at, created_by, updated_at, updated_by
FROM wfl_definition_versions;

UPDATE approval_entries
SET domain='dcl', entity='wfl-process-definition'
WHERE domain='wfl' AND entity='process-definition';

UPDATE approval_events
SET domain='dcl', entity='wfl-process-definition'
WHERE domain='wfl' AND entity='process-definition';

ALTER TABLE dcl_wfl_process_definition_versions
  ADD CONSTRAINT dcl_wfl_process_definition_versions_approval_entry_id_fkey
  FOREIGN KEY (approval_entry_id) REFERENCES approval_entries(id) ON DELETE RESTRICT;

ALTER TABLE wfl_definition_instances
  DROP CONSTRAINT wfl_definition_instances_approval_entry_id_fkey;
ALTER TABLE wfl_definition_instances
  ADD CONSTRAINT wfl_definition_instances_approval_entry_id_fkey
  FOREIGN KEY (definition_approval_entry_id)
  REFERENCES dcl_wfl_process_definition_versions(approval_entry_id) ON DELETE RESTRICT;

-- Preserve existing role grants while moving every former WFL maintenance
-- action to DCL. Current reads and trial remain WFL runtime capabilities.
UPDATE app_permissions permission
SET path=mapping.path, domain=mapping.domain, entity=mapping.entity,
    action=mapping.action, description=mapping.description,
    revision=permission.revision+1, updated_at=clock_timestamp()
FROM (VALUES
  ('WGaeb45c648bc71c8a7cd97aec','/dcl/wfl-process-definition/create','dcl','wfl-process-definition','create','创建流程定义声明'),
  ('WGd6e65556b0f2761f2666649d','/dcl/wfl-process-definition/save','dcl','wfl-process-definition','save','保存流程定义声明草稿'),
  ('WG45cc51ab6fa077508670df15','/dcl/wfl-process-definition/enable','dcl','wfl-process-definition','enable','启用流程定义'),
  ('WG855f746f2476c3c06c7132e9','/dcl/wfl-process-definition/disable','dcl','wfl-process-definition','disable','停用流程定义'),
  ('01KWFL00000000000000000001','/dcl/wfl-process-definition/versions','dcl','wfl-process-definition','versions','查看流程定义声明版本'),
  ('01KWFL00000000000000000002','/dcl/wfl-process-definition/submit','dcl','wfl-process-definition','submit','提交流程定义声明审核'),
  ('01KWFL00000000000000000003','/dcl/wfl-process-definition/unsubmit','dcl','wfl-process-definition','unsubmit','撤回流程定义声明审核'),
  ('01KWFL00000000000000000004','/dcl/wfl-process-definition/reject','dcl','wfl-process-definition','reject','审核驳回流程定义声明'),
  ('01KWFL00000000000000000005','/dcl/wfl-process-definition/approve','dcl','wfl-process-definition','approve','审核通过流程定义声明'),
  ('01KWFL00000000000000000006','/dcl/wfl-process-definition/unapprove','dcl','wfl-process-definition','unapprove','反审核流程定义声明'),
  ('01KWFL00000000000000000007','/dcl/wfl-process-definition/create-next','dcl','wfl-process-definition','create-next','创建下一流程定义声明版本'),
  ('01KWFL00000000000000000008','/dcl/wfl-process-definition/delete-version','dcl','wfl-process-definition','delete-version','删除流程定义声明草稿版本')
) mapping(id,path,domain,entity,action,description)
WHERE permission.id=mapping.id;

DELETE FROM app_role_permissions
WHERE permission_id='WG8cce66a1abfe87c2efebdd54';
DELETE FROM app_permissions
WHERE id='WG8cce66a1abfe87c2efebdd54';

-- DCL query/get are separate from WFL current query/get. Existing readers
-- inherit them, and version-history readers inherit audit-history.
INSERT INTO app_permissions(id,path,domain,entity,action,description,status,created_at,created_by,updated_at,updated_by,revision,menu_order)
VALUES
  ('01KWFL00000000000000000009','/dcl/wfl-process-definition/query','dcl','wfl-process-definition','query','查询流程定义声明','ENABLED',clock_timestamp(),NULL,clock_timestamp(),NULL,1,90),
  ('01KWFL00000000000000000010','/dcl/wfl-process-definition/get','dcl','wfl-process-definition','get','查看流程定义声明','ENABLED',clock_timestamp(),NULL,clock_timestamp(),NULL,1,NULL),
  ('01KWFL00000000000000000011','/dcl/wfl-process-definition/audit-history','dcl','wfl-process-definition','audit-history','查看流程定义声明审核记录','ENABLED',clock_timestamp(),NULL,clock_timestamp(),NULL,1,NULL);

INSERT INTO app_role_permissions(role_id,permission_id,created_at,created_by)
SELECT role_id,'01KWFL00000000000000000009',created_at,created_by
FROM app_role_permissions WHERE permission_id='WG766d7129dcc7b17ec75871ae'
ON CONFLICT DO NOTHING;
INSERT INTO app_role_permissions(role_id,permission_id,created_at,created_by)
SELECT role_id,'01KWFL00000000000000000010',created_at,created_by
FROM app_role_permissions WHERE permission_id='WG97a91cf1d6594be99cbcc468'
ON CONFLICT DO NOTHING;
INSERT INTO app_role_permissions(role_id,permission_id,created_at,created_by)
SELECT role_id,'01KWFL00000000000000000011',created_at,created_by
FROM app_role_permissions WHERE permission_id='01KWFL00000000000000000001'
ON CONFLICT DO NOTHING;

DO $$
DECLARE
  definition_count bigint;
  subject_count bigint;
  old_version_count bigint;
  new_version_count bigint;
BEGIN
  SELECT count(*) INTO definition_count FROM wfl_process_definitions;
  SELECT count(*) INTO subject_count FROM dcl_subjects
    WHERE entity='wfl-process-definition';
  SELECT count(*) INTO old_version_count FROM wfl_definition_versions;
  SELECT count(*) INTO new_version_count
    FROM dcl_wfl_process_definition_versions;
  IF definition_count<>subject_count OR old_version_count<>new_version_count THEN
    RAISE EXCEPTION 'issue #293 cutover count mismatch: definitions %, subjects %, old versions %, new versions %',
      definition_count, subject_count, old_version_count, new_version_count;
  END IF;
  IF EXISTS (
    SELECT approval_entry_id,definition_id,script,diagnostic,compiled,
           last_trial_approval_revision,created_at,created_by,updated_at,updated_by
    FROM wfl_definition_versions
    EXCEPT
    SELECT approval_entry_id,definition_id,script,diagnostic,compiled,
           last_trial_approval_revision,created_at,created_by,updated_at,updated_by
    FROM dcl_wfl_process_definition_versions
  ) OR EXISTS (
    SELECT approval_entry_id,definition_id,script,diagnostic,compiled,
           last_trial_approval_revision,created_at,created_by,updated_at,updated_by
    FROM dcl_wfl_process_definition_versions
    EXCEPT
    SELECT approval_entry_id,definition_id,script,diagnostic,compiled,
           last_trial_approval_revision,created_at,created_by,updated_at,updated_by
    FROM wfl_definition_versions
  ) THEN
    RAISE EXCEPTION 'issue #293 cutover changed workflow version payloads';
  END IF;
  IF EXISTS (SELECT 1 FROM approval_entries WHERE domain='wfl' AND entity='process-definition')
    OR EXISTS (SELECT 1 FROM approval_events WHERE domain='wfl' AND entity='process-definition') THEN
    RAISE EXCEPTION 'issue #293 cutover left WFL-owned definition approval data';
  END IF;
  IF EXISTS (
    SELECT 1 FROM wfl_definition_instances instance
    LEFT JOIN dcl_wfl_process_definition_versions version
      ON version.approval_entry_id=instance.definition_approval_entry_id
    WHERE version.approval_entry_id IS NULL
  ) THEN
    RAISE EXCEPTION 'issue #293 cutover lost a persisted workflow instance version pin';
  END IF;
  IF (SELECT count(*) FROM app_permissions
      WHERE domain='dcl' AND entity='wfl-process-definition')<>15 THEN
    RAISE EXCEPTION 'issue #293 permission cutover did not install all 15 DCL maintenance permissions';
  END IF;
  IF EXISTS (SELECT 1 FROM app_permissions WHERE id='WG8cce66a1abfe87c2efebdd54')
    OR NOT EXISTS (SELECT 1 FROM app_permissions
      WHERE id='WG6ba149ae2772987659e7e433'
        AND domain='wfl' AND entity='process-definition' AND action='trial') THEN
    RAISE EXCEPTION 'issue #293 permission cutover changed the WFL runtime boundary';
  END IF;
END $$;

DROP TABLE wfl_definition_versions;
COMMIT;

SELECT
  (SELECT count(*) FROM wfl_process_definitions) AS stable_definitions,
  (SELECT count(*) FROM dcl_subjects WHERE entity='wfl-process-definition') AS dcl_subjects,
  (SELECT count(*) FROM dcl_wfl_process_definition_versions) AS dcl_versions;
SELECT count(*) AS obsolete_wfl_approval_entries
FROM approval_entries WHERE domain='wfl' AND entity='process-definition';
SELECT count(*) AS obsolete_wfl_approval_events
FROM approval_events WHERE domain='wfl' AND entity='process-definition';

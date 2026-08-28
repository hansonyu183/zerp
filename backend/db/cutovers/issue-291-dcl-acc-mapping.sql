\set ON_ERROR_STOP on

-- One-time in-place cutover for issue #291. Run against the post-#290,
-- pre-#291 schema while ACC mapping writes are stopped, then deploy the
-- matching application SHA. It deliberately retains stable mapping, approval
-- and event IDs, while removing the former ACC mapping version store and
-- write paths.
BEGIN;

LOCK TABLE acc_mappings, acc_mapping_versions, dcl_subjects, approval_entries,
  approval_events, app_permissions, app_role_permissions IN ACCESS EXCLUSIVE MODE;

ALTER TABLE dcl_subjects DROP CONSTRAINT dcl_subjects_entity_check;
ALTER TABLE dcl_subjects ADD CONSTRAINT dcl_subjects_entity_check
  CHECK (entity IN ('operating-entity','warehouse','vehicle','fund-account','product','party','employee','other-unit','sales-partner','supplier','customer','customer-account','acc-mapping'));

CREATE TABLE dcl_acc_mapping_versions (
  approval_entry_id character varying(26) PRIMARY KEY
    REFERENCES approval_entries(id) ON DELETE RESTRICT,
  mapping_id character varying(26) NOT NULL
    REFERENCES acc_mappings(id) ON DELETE CASCADE,
  default_result character varying(7) NOT NULL
    CHECK (default_result IN ('POST','UN_POST')),
  definition jsonb NOT NULL
    CHECK (jsonb_typeof(definition) = 'object')
);

INSERT INTO dcl_subjects(id, entity, created_at, created_by)
SELECT id, 'acc-mapping', created_at, created_by FROM acc_mappings;

INSERT INTO dcl_acc_mapping_versions(approval_entry_id, mapping_id, default_result, definition)
SELECT v.approval_entry_id, v.mapping_id, v.default_result, v.definition
FROM acc_mapping_versions v;

UPDATE approval_entries SET domain='dcl', entity='acc-mapping'
WHERE domain='acc' AND entity='mapping';

UPDATE approval_events SET domain='dcl', entity='acc-mapping'
WHERE domain='acc' AND entity='mapping';

UPDATE app_permissions permission
SET path=mapping.path, domain=mapping.domain, entity=mapping.entity, action=mapping.action,
    description=mapping.description, revision=permission.revision+1,
    updated_at=clock_timestamp()
FROM (VALUES
  ('01JACC00000000000000000112','/dcl/acc-mapping/create','dcl','acc-mapping','create','创建会计映射声明'),
  ('01JACC00000000000000000113','/dcl/acc-mapping/save','dcl','acc-mapping','save','保存会计映射声明草稿'),
  ('01JACC00000000000000000114','/dcl/acc-mapping/approve','dcl','acc-mapping','approve','审核通过会计映射声明'),
  ('01JACC00000000000000000115','/dcl/acc-mapping/unapprove','dcl','acc-mapping','unapprove','反审核会计映射声明'),
  ('01JACC00000000000000000211','/dcl/acc-mapping/versions','dcl','acc-mapping','versions','查看会计映射声明版本'),
  ('01JACC00000000000000000213','/dcl/acc-mapping/submit','dcl','acc-mapping','submit','提交会计映射声明审核'),
  ('01JACC00000000000000000214','/dcl/acc-mapping/unsubmit','dcl','acc-mapping','unsubmit','撤回会计映射声明审核'),
  ('01JACC00000000000000000215','/dcl/acc-mapping/reject','dcl','acc-mapping','reject','审核驳回会计映射声明'),
  ('01JACC00000000000000000216','/dcl/acc-mapping/create-next','dcl','acc-mapping','create-next','创建下一会计映射声明版本'),
  ('01JACC00000000000000000217','/dcl/acc-mapping/delete-version','dcl','acc-mapping','delete-version','删除会计映射声明草稿版本')
) mapping(id,path,domain,entity,action,description)
WHERE permission.id=mapping.id;

INSERT INTO app_permissions(id, path, domain, entity, action, description, status, created_at, created_by, updated_at, updated_by, revision, menu_order)
VALUES
  ('01JACC00000000000000000218', '/dcl/acc-mapping/query', 'dcl', 'acc-mapping', 'query', '查询会计映射声明', 'ENABLED', clock_timestamp(), NULL, clock_timestamp(), NULL, 1, NULL),
  ('01JACC00000000000000000219', '/dcl/acc-mapping/get', 'dcl', 'acc-mapping', 'get', '查看会计映射声明', 'ENABLED', clock_timestamp(), NULL, clock_timestamp(), NULL, 1, NULL),
  ('01JACC00000000000000000220', '/dcl/acc-mapping/audit-history', 'dcl', 'acc-mapping', 'audit-history', '查看会计映射声明审核记录', 'ENABLED', clock_timestamp(), NULL, clock_timestamp(), NULL, 1, NULL);

INSERT INTO app_role_permissions(role_id,permission_id,created_at,created_by)
SELECT role_id,'01JACC00000000000000000218',created_at,created_by
FROM app_role_permissions WHERE permission_id='01JACC00000000000000000110'
ON CONFLICT DO NOTHING;
INSERT INTO app_role_permissions(role_id,permission_id,created_at,created_by)
SELECT role_id,'01JACC00000000000000000219',created_at,created_by
FROM app_role_permissions WHERE permission_id='01JACC00000000000000000111'
ON CONFLICT DO NOTHING;
INSERT INTO app_role_permissions(role_id,permission_id,created_at,created_by)
SELECT role_id,'01JACC00000000000000000220',created_at,created_by
FROM app_role_permissions WHERE permission_id='01JACC00000000000000000211'
ON CONFLICT DO NOTHING;

DELETE FROM app_role_permissions WHERE permission_id='01JACC00000000000000000212';
DELETE FROM app_permissions WHERE id='01JACC00000000000000000212';

UPDATE app_permissions
SET description=CASE
    WHEN id='01JACC00000000000000000110' THEN '查询当前会计映射'
    WHEN id='01JACC00000000000000000111' THEN '查看当前会计映射'
  END,
  revision=revision+1,
  updated_at=clock_timestamp()
WHERE id IN ('01JACC00000000000000000110','01JACC00000000000000000111');

ALTER TABLE acc_vouchers DROP CONSTRAINT acc_vouchers_mapping_approval_entry_fk;
ALTER TABLE acc_vouchers ADD CONSTRAINT acc_vouchers_mapping_approval_entry_fk
  FOREIGN KEY (mapping_approval_entry_id) REFERENCES dcl_acc_mapping_versions(approval_entry_id) ON DELETE RESTRICT;

DO $$
DECLARE
  subject_count bigint; old_version_count bigint; new_version_count bigint;
BEGIN
  SELECT count(*) INTO subject_count FROM dcl_subjects WHERE entity='acc-mapping';
  SELECT count(*) INTO old_version_count FROM acc_mapping_versions;
  SELECT count(*) INTO new_version_count FROM dcl_acc_mapping_versions;
  IF (SELECT count(*) FROM acc_mappings)<>subject_count OR old_version_count<>new_version_count THEN
    RAISE EXCEPTION 'issue #291 cutover count mismatch: mappings %, subjects %, old versions %, new versions %',
      (SELECT count(*) FROM acc_mappings), subject_count, old_version_count, new_version_count;
  END IF;
  IF EXISTS (SELECT 1 FROM approval_entries WHERE domain='acc' AND entity='mapping')
    OR EXISTS (SELECT 1 FROM approval_events WHERE domain='acc' AND entity='mapping') THEN
    RAISE EXCEPTION 'issue #291 cutover left ACC-owned mapping approval data';
  END IF;
  IF (SELECT count(*) FROM app_permissions WHERE id IN (
      '01JACC00000000000000000112','01JACC00000000000000000113','01JACC00000000000000000114',
      '01JACC00000000000000000115','01JACC00000000000000000211',
      '01JACC00000000000000000213','01JACC00000000000000000214','01JACC00000000000000000215',
      '01JACC00000000000000000216','01JACC00000000000000000217'
    ) AND domain='dcl' AND entity='acc-mapping')<>10 THEN
    RAISE EXCEPTION 'issue #291 permission cutover did not update all DCL acc-mapping permission IDs';
  END IF;
  IF EXISTS (SELECT 1 FROM app_permissions WHERE id='01JACC00000000000000000212')
    OR (SELECT count(*) FROM app_permissions WHERE id IN (
      '01JACC00000000000000000218','01JACC00000000000000000219','01JACC00000000000000000220'
    ) AND domain='dcl' AND entity='acc-mapping')<>3 THEN
    RAISE EXCEPTION 'issue #291 permission cutover did not replace obsolete ACC mapping permissions';
  END IF;
  IF (SELECT count(*) FROM app_permissions WHERE id IN ('01JACC00000000000000000110','01JACC00000000000000000111','01JACC00000000000000000116')
      AND domain='acc')<>3 THEN
    RAISE EXCEPTION 'issue #291 permission cutover changed ACC mapping current read IDs';
  END IF;
END $$;

DROP TABLE acc_mapping_versions;
COMMIT;

SELECT
  (SELECT count(*) FROM acc_mappings) AS stable_mappings,
  (SELECT count(*) FROM dcl_subjects WHERE entity='acc-mapping') AS dcl_subjects,
  (SELECT count(*) FROM dcl_acc_mapping_versions) AS dcl_versions;
SELECT count(*) AS obsolete_acc_approval_entries FROM approval_entries WHERE domain='acc' AND entity='mapping';
SELECT count(*) AS obsolete_acc_approval_events FROM approval_events WHERE domain='acc' AND entity='mapping';

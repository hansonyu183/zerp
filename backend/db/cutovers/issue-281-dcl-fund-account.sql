\set ON_ERROR_STOP on

BEGIN;

LOCK TABLE bob_objects, dcl_subjects, bob_fund_account_versions, approval_entries,
  approval_events, app_permissions IN ACCESS EXCLUSIVE MODE;

ALTER TABLE dcl_subjects DROP CONSTRAINT dcl_subjects_entity_check;
ALTER TABLE dcl_subjects ADD CONSTRAINT dcl_subjects_entity_check
  CHECK (entity IN ('operating-entity','warehouse','vehicle','fund-account'));

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM bob_fund_account_versions WHERE category_id IS NOT NULL OR category_approval_entry_id IS NOT NULL) THEN
    RAISE EXCEPTION 'issue #281 cannot discard populated fund-account category references';
  END IF;
END $$;

CREATE TABLE dcl_fund_account_versions (
  approval_entry_id character varying(26) PRIMARY KEY REFERENCES approval_entries(id) ON DELETE RESTRICT,
  entity character varying(16) NOT NULL DEFAULT 'fund-account' CHECK (entity='fund-account'),
  name character varying(200) NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 200),
  currency character varying(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  account_name character varying(200), bank_name character varying(200), bank_branch character varying(200),
  account_number character varying(64), remark character varying(1000),
  operating_entity_id character varying(26) NOT NULL REFERENCES bob_objects(id) ON DELETE RESTRICT,
  operating_entity_approval_entry_id character varying(26) NOT NULL REFERENCES approval_entries(id) ON DELETE RESTRICT,
  operating_entity_code character varying(16) NOT NULL, operating_entity_name character varying(200) NOT NULL,
  enabled boolean NOT NULL
);
CREATE TABLE dcl_fund_account_identifier_claims (
  normalized_account_number character varying(64) PRIMARY KEY, object_id character varying(26) NOT NULL REFERENCES bob_objects(id) ON DELETE CASCADE,
  approved_entry_id character varying(26) REFERENCES approval_entries(id) ON DELETE RESTRICT,
  open_entry_id character varying(26) REFERENCES approval_entries(id) ON DELETE RESTRICT,
  CHECK (approved_entry_id IS NOT NULL OR open_entry_id IS NOT NULL)
);
CREATE TABLE bob_fund_accounts (
  object_id character varying(26) PRIMARY KEY REFERENCES bob_objects(id) ON DELETE RESTRICT,
  source_approval_entry_id character varying(26) NOT NULL UNIQUE REFERENCES approval_entries(id) ON DELETE RESTRICT,
  name character varying(200) NOT NULL, currency character varying(3) NOT NULL,
  account_name character varying(200), bank_name character varying(200), bank_branch character varying(200), account_number character varying(64), remark character varying(1000),
  operating_entity_id character varying(26) NOT NULL REFERENCES bob_objects(id) ON DELETE RESTRICT,
  operating_entity_approval_entry_id character varying(26) NOT NULL REFERENCES approval_entries(id) ON DELETE RESTRICT,
  operating_entity_code character varying(16) NOT NULL, operating_entity_name character varying(200) NOT NULL,
  enabled boolean NOT NULL, updated_at timestamp with time zone NOT NULL DEFAULT now(), updated_by character varying(26) NOT NULL
);

INSERT INTO dcl_subjects(id,entity,created_at,created_by)
SELECT id,entity,created_at,created_by FROM bob_objects WHERE entity='fund-account';
INSERT INTO dcl_fund_account_versions(approval_entry_id,entity,name,currency,account_name,bank_name,bank_branch,account_number,remark,operating_entity_id,operating_entity_approval_entry_id,operating_entity_code,operating_entity_name,enabled)
SELECT version.approval_entry_id,version.entity,version.name,version.currency,version.account_name,version.bank_name,version.bank_branch,NULLIF(upper(replace(replace(btrim(version.account_number),' ',''),'-','')),''),version.remark,
  version.operating_entity_id,version.operating_entity_approval_entry_id,version.operating_entity_code,version.operating_entity_name,object.enabled
FROM bob_fund_account_versions version
JOIN approval_entries entry ON entry.id=version.approval_entry_id AND entry.domain='bob' AND entry.entity='fund-account'
JOIN bob_objects object ON object.id=entry.subject_id AND object.entity='fund-account';
INSERT INTO bob_fund_accounts
SELECT object.id,entry.id,version.name,version.currency,version.account_name,version.bank_name,version.bank_branch,version.account_number,version.remark,
  version.operating_entity_id,version.operating_entity_approval_entry_id,version.operating_entity_code,version.operating_entity_name,
  version.enabled,object.updated_at,object.updated_by
FROM bob_objects object JOIN LATERAL (
  SELECT approved.* FROM approval_entries approved WHERE approved.domain='bob' AND approved.entity='fund-account'
    AND approved.subject_id=object.id AND approved.status='APPROVED' ORDER BY approved.version_no DESC LIMIT 1
) entry ON true JOIN dcl_fund_account_versions version ON version.approval_entry_id=entry.id WHERE object.entity='fund-account';

UPDATE approval_entries SET domain='dcl' WHERE domain='bob' AND entity='fund-account';
UPDATE approval_events SET domain='dcl' WHERE domain='bob' AND entity='fund-account';
WITH selected_entries AS (
  SELECT id,subject_id,status FROM approval_entries WHERE domain='dcl' AND entity='fund-account' AND status IN ('DRAFT','PENDING')
  UNION ALL SELECT approved.id,approved.subject_id,approved.status FROM approval_entries approved WHERE approved.domain='dcl' AND approved.entity='fund-account' AND approved.status='APPROVED' AND approved.id=(SELECT latest.id FROM approval_entries latest WHERE latest.domain='dcl' AND latest.entity='fund-account' AND latest.subject_id=approved.subject_id AND latest.status='APPROVED' ORDER BY latest.version_no DESC LIMIT 1)
)
INSERT INTO dcl_fund_account_identifier_claims(normalized_account_number,object_id,approved_entry_id,open_entry_id)
SELECT upper(replace(replace(btrim(version.account_number),' ',''),'-','')),entry.subject_id,max(entry.id) FILTER (WHERE entry.status='APPROVED'),max(entry.id) FILTER (WHERE entry.status IN ('DRAFT','PENDING'))
FROM selected_entries entry JOIN dcl_fund_account_versions version ON version.approval_entry_id=entry.id
WHERE version.account_number IS NOT NULL AND btrim(version.account_number)<>'' GROUP BY 1,2;
UPDATE app_permissions permission SET path=mapping.path,domain='dcl',action=mapping.action,description=mapping.description,revision=permission.revision+1,updated_at=clock_timestamp()
FROM (VALUES
 ('01JBOB00000000000000000051','/dcl/fund-account/approve','approve','审核通过资金账户声明'),
 ('01JBOB00000000000000000052','/dcl/fund-account/audit-history','audit-history','查看资金账户声明审核记录'),
 ('01JBOB00000000000000000053','/dcl/fund-account/create','create','创建资金账户声明'),
 ('01JBOB00000000000000000057','/dcl/fund-account/reject','reject','审核驳回资金账户声明'),
 ('01JBOB00000000000000000058','/dcl/fund-account/save','save','保存资金账户声明草稿'),
 ('01JBOB00000000000000000059','/dcl/fund-account/submit','submit','提交资金账户声明审核'),
 ('01JBOB00000000000000000060','/dcl/fund-account/versions','versions','查看资金账户声明版本'),
 ('01JBOB00000000000000000088','/dcl/fund-account/delete','delete','删除首版资金账户声明草稿'),
 ('01JBOB00000000000000000161','/dcl/fund-account/unsubmit','unsubmit','撤回资金账户声明审核'),
 ('01JBOB00000000000000000162','/dcl/fund-account/unapprove','unapprove','反审核资金账户声明'),
 ('01JBOB00000000000000000163','/dcl/fund-account/get','get','查看资金账户声明'),
 ('01JBOB00000000000000000164','/dcl/fund-account/query','query','查询资金账户声明')
) mapping(id,path,action,description) WHERE permission.id=mapping.id;
DO $$ BEGIN
  IF (SELECT count(*) FROM bob_objects WHERE entity='fund-account')<>(SELECT count(*) FROM dcl_subjects WHERE entity='fund-account')
    OR (SELECT count(*) FROM bob_fund_account_versions)<>(SELECT count(*) FROM dcl_fund_account_versions)
    OR (SELECT count(DISTINCT subject_id) FROM approval_entries WHERE domain='dcl' AND entity='fund-account' AND status='APPROVED')<>(SELECT count(*) FROM bob_fund_accounts) THEN RAISE EXCEPTION 'issue #281 cutover count mismatch'; END IF;
  IF EXISTS (SELECT 1 FROM approval_entries WHERE domain='bob' AND entity='fund-account') OR EXISTS (SELECT 1 FROM approval_events WHERE domain='bob' AND entity='fund-account') THEN RAISE EXCEPTION 'issue #281 cutover left BOB-owned fund account approval data'; END IF;
  IF (SELECT count(*) FROM app_permissions WHERE id IN ('01JBOB00000000000000000051','01JBOB00000000000000000052','01JBOB00000000000000000053','01JBOB00000000000000000057','01JBOB00000000000000000058','01JBOB00000000000000000059','01JBOB00000000000000000060','01JBOB00000000000000000088','01JBOB00000000000000000161','01JBOB00000000000000000162','01JBOB00000000000000000163','01JBOB00000000000000000164') AND domain='dcl')<>12 THEN RAISE EXCEPTION 'issue #281 permission cutover did not update all DCL fund account permissions'; END IF;
  IF (SELECT count(*) FROM app_permissions WHERE id IN ('01JBOB00000000000000000055','01JBOB00000000000000000056') AND domain='bob' AND action IN ('get','query'))<>2 THEN RAISE EXCEPTION 'issue #281 permission cutover changed BOB fund account current read IDs'; END IF;
END $$;
DROP TABLE bob_fund_account_versions;
COMMIT;

\set ON_ERROR_STOP on

-- One-time in-place cutover for issue #283. Run against the post-#282,
-- pre-#283 schema while Party and relationship writes are stopped, then deploy
-- the matching application SHA. Existing unversioned Party facts become one
-- approved DCL baseline version; no compatibility view or legacy write path is
-- retained.
BEGIN;

LOCK TABLE bob_parties, bob_party_identifiers, bob_party_audit_events,
  bob_party_merge_preflights, bob_party_merge_events, dcl_subjects,
  approval_entries, approval_events, app_permissions, app_role_permissions IN ACCESS EXCLUSIVE MODE;

ALTER TABLE dcl_subjects DROP CONSTRAINT dcl_subjects_entity_check;
ALTER TABLE dcl_subjects ADD CONSTRAINT dcl_subjects_entity_check
  CHECK (entity IN ('operating-entity','warehouse','vehicle','fund-account','product','party'));

CREATE TABLE dcl_party_versions (
  approval_entry_id character varying(26) PRIMARY KEY
    REFERENCES approval_entries(id) ON DELETE RESTRICT,
  party_id character varying(26) NOT NULL
    REFERENCES bob_parties(id) ON DELETE RESTRICT,
  kind character varying(16) NOT NULL CHECK (kind IN ('PERSON','ORGANIZATION')),
  legal_name character varying(200) NOT NULL
    CHECK (length(btrim(legal_name)) BETWEEN 1 AND 200),
  display_name character varying(200) NOT NULL
    CHECK (length(btrim(display_name)) BETWEEN 1 AND 200),
  tax_number character varying(100),
  phone character varying(32),
  email character varying(254),
  address character varying(500)
);
CREATE INDEX dcl_party_versions_party_idx
  ON dcl_party_versions(party_id,approval_entry_id);

CREATE TABLE dcl_party_version_identifiers (
  approval_entry_id character varying(26) NOT NULL
    REFERENCES dcl_party_versions(approval_entry_id) ON DELETE CASCADE,
  identifier_type character varying(40) NOT NULL
  CONSTRAINT dcl_party_version_identifiers_type_check
    CHECK (identifier_type IN ('PERSON_ID','UNIFIED_SOCIAL_CREDIT_CODE','TAX_NUMBER')),
  value character varying(100) NOT NULL,
  normalized_value character varying(100) NOT NULL,
  PRIMARY KEY(approval_entry_id,identifier_type,normalized_value)
);

CREATE TABLE dcl_party_identifier_claims (
  identifier_type character varying(40) NOT NULL,
  normalized_value character varying(100) NOT NULL,
  approved_party_id character varying(26) REFERENCES bob_parties(id) ON DELETE RESTRICT,
  approved_approval_entry_id character varying(26) REFERENCES approval_entries(id) ON DELETE RESTRICT,
  open_party_id character varying(26) REFERENCES bob_parties(id) ON DELETE RESTRICT,
  open_approval_entry_id character varying(26) REFERENCES approval_entries(id) ON DELETE RESTRICT,
  PRIMARY KEY(identifier_type,normalized_value),
  CONSTRAINT dcl_party_identifier_claims_approved_pair_check
    CHECK ((approved_party_id IS NULL)=(approved_approval_entry_id IS NULL)),
  CONSTRAINT dcl_party_identifier_claims_open_pair_check
    CHECK ((open_party_id IS NULL)=(open_approval_entry_id IS NULL))
);
CREATE INDEX dcl_party_identifier_claims_approved_party_idx
  ON dcl_party_identifier_claims(approved_party_id) WHERE approved_party_id IS NOT NULL;
CREATE INDEX dcl_party_identifier_claims_open_party_idx
  ON dcl_party_identifier_claims(open_party_id) WHERE open_party_id IS NOT NULL;

CREATE TEMP TABLE issue_283_party_entries(
  party_id character varying(26) PRIMARY KEY,
  approval_entry_id character varying(26) NOT NULL UNIQUE,
  reviewer_id character varying(26) NOT NULL
) ON COMMIT DROP;

INSERT INTO issue_283_party_entries(party_id,approval_entry_id,reviewer_id)
SELECT id,
	       '0000000000'||substring(upper(md5('issue-283-party-entry:'||id)),1,16),
       CASE WHEN created_by='issue-283-cutover-reviewer'
            THEN 'issue-283-cutover-approver'
            ELSE 'issue-283-cutover-reviewer' END
FROM bob_parties;

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM issue_283_party_entries mapping
    JOIN approval_entries entry ON entry.id=mapping.approval_entry_id
  ) THEN
    RAISE EXCEPTION 'issue #283 generated Approval entry ID collides with existing data';
  END IF;
  IF EXISTS (
    SELECT 1
	    FROM bob_parties party
	    JOIN approval_events event ON event.id IN (
	      '0000000000'||substring(upper(md5('issue-283-party-created:'||party.id)),1,16),
	      '0000000000'||substring(upper(md5('issue-283-party-submitted:'||party.id)),1,16),
	      '0000000000'||substring(upper(md5('issue-283-party-approved:'||party.id)),1,16)
    )
  ) THEN
    RAISE EXCEPTION 'issue #283 generated Approval event ID collides with existing data';
  END IF;
  IF EXISTS (
    SELECT 1 FROM bob_party_audit_events legacy
    JOIN approval_events event ON event.id=legacy.id
  ) THEN
    RAISE EXCEPTION 'issue #283 legacy Party audit ID collides with Approval events';
  END IF;
  IF EXISTS (
    SELECT 1 FROM bob_parties party
    JOIN LATERAL (
      SELECT count(*) created_count FROM bob_party_audit_events audit
      WHERE audit.party_id=party.id AND audit.event_type='CREATED'
    ) audit ON true
    WHERE audit.created_count>1
  ) THEN
    RAISE EXCEPTION 'issue #283 found duplicate legacy Party CREATED audits';
  END IF;
  IF EXISTS (
    SELECT 1 FROM bob_party_audit_events audit
    JOIN bob_parties party ON party.id=audit.party_id
    WHERE audit.revision<1 OR audit.revision>party.revision
      OR (audit.event_type='CREATED' AND audit.revision<>1)
      OR (audit.event_type='SAVED' AND audit.revision<2)
  ) THEN
    RAISE EXCEPTION 'issue #283 found invalid legacy Party audit revision';
  END IF;
  IF EXISTS (
    SELECT 1 FROM bob_party_audit_events audit
    WHERE audit.event_type='MERGED' AND NOT EXISTS (
      SELECT 1 FROM bob_party_merge_events merge_event
      WHERE merge_event.source_party_id=audit.party_id
        AND merge_event.actor_id=audit.actor_id
        AND merge_event.request_id=audit.request_id
    )
  ) THEN
    RAISE EXCEPTION 'issue #283 cannot match legacy Party MERGED audit to merge event';
  END IF;
END $$;

INSERT INTO dcl_subjects(id,entity,created_at,created_by)
SELECT id,'party',created_at,created_by FROM bob_parties;

-- Party was unversioned before #283. Establish a complete, auditable approved
-- V1 baseline so every existing current fact has one formal DCL source.
INSERT INTO approval_entries(
  id,domain,entity,subject_id,version_no,status,revision,
  created_by,created_at,updated_by,updated_at,
  submitted_by,submitted_at,approved_by,approved_at
)
SELECT mapping.approval_entry_id,'dcl','party',party.id,1,'APPROVED',party.revision+2,
       party.created_by,party.created_at,mapping.reviewer_id,party.updated_at,
       party.created_by,party.created_at,mapping.reviewer_id,party.updated_at
FROM bob_parties party
JOIN issue_283_party_entries mapping ON mapping.party_id=party.id;

INSERT INTO approval_events(
  id,entry_id,domain,entity,subject_id,version_no,action,
  from_status,to_status,from_revision,to_revision,actor_id,reason,request_id,created_at
)
SELECT audit.id,mapping.approval_entry_id,'dcl','party',party.id,1,audit.event_type,
       CASE WHEN audit.event_type='CREATED' THEN NULL ELSE 'DRAFT' END,
       'DRAFT',
       CASE WHEN audit.event_type='CREATED' THEN NULL ELSE audit.revision-1 END,
       audit.revision,audit.actor_id,NULL,audit.request_id,audit.occurred_at
FROM bob_party_audit_events audit
JOIN bob_parties party ON party.id=audit.party_id
JOIN issue_283_party_entries mapping ON mapping.party_id=party.id
WHERE audit.event_type IN ('CREATED','SAVED')
UNION ALL
SELECT '0000000000'||substring(upper(md5('issue-283-party-created:'||party.id)),1,16),
       mapping.approval_entry_id,'dcl','party',party.id,1,'CREATED',
       NULL,'DRAFT',NULL,1,party.created_by,NULL,'issue-283-cutover',party.created_at
FROM bob_parties party JOIN issue_283_party_entries mapping ON mapping.party_id=party.id
WHERE NOT EXISTS (
  SELECT 1 FROM bob_party_audit_events audit
  WHERE audit.party_id=party.id AND audit.event_type='CREATED'
)
UNION ALL
SELECT '0000000000'||substring(upper(md5('issue-283-party-submitted:'||party.id)),1,16),
       mapping.approval_entry_id,'dcl','party',party.id,1,'SUBMITTED',
       'DRAFT','PENDING',party.revision,party.revision+1,
       party.created_by,NULL,'issue-283-cutover',party.updated_at
FROM bob_parties party JOIN issue_283_party_entries mapping ON mapping.party_id=party.id
UNION ALL
SELECT '0000000000'||substring(upper(md5('issue-283-party-approved:'||party.id)),1,16),
       mapping.approval_entry_id,'dcl','party',party.id,1,'APPROVED',
       'PENDING','APPROVED',party.revision+1,party.revision+2,
       mapping.reviewer_id,NULL,'issue-283-cutover',party.updated_at
FROM bob_parties party JOIN issue_283_party_entries mapping ON mapping.party_id=party.id;

INSERT INTO dcl_party_versions(
  approval_entry_id,party_id,kind,legal_name,display_name,tax_number,phone,email,address
)
SELECT mapping.approval_entry_id,party.id,party.kind,party.legal_name,
       party.display_name,party.tax_number,party.phone,party.email,party.address
FROM bob_parties party
JOIN issue_283_party_entries mapping ON mapping.party_id=party.id;

INSERT INTO dcl_party_version_identifiers(
  approval_entry_id,identifier_type,value,normalized_value
)
SELECT mapping.approval_entry_id,identifier.identifier_type,
       identifier.value,identifier.normalized_value
FROM bob_party_identifiers identifier
JOIN issue_283_party_entries mapping ON mapping.party_id=identifier.party_id;

INSERT INTO dcl_party_identifier_claims(
  identifier_type,normalized_value,approved_party_id,approved_approval_entry_id
)
SELECT identifier.identifier_type,identifier.normalized_value,
       identifier.party_id,mapping.approval_entry_id
FROM bob_party_identifiers identifier
JOIN issue_283_party_entries mapping ON mapping.party_id=identifier.party_id;

CREATE TABLE bob_party_currents (
  party_id character varying(26) PRIMARY KEY REFERENCES bob_parties(id) ON DELETE RESTRICT,
  source_approval_entry_id character varying(26) NOT NULL UNIQUE
    REFERENCES approval_entries(id) ON DELETE RESTRICT,
  kind character varying(16) NOT NULL CHECK (kind IN ('PERSON','ORGANIZATION')),
  legal_name character varying(200) NOT NULL
    CHECK (length(btrim(legal_name)) BETWEEN 1 AND 200),
  display_name character varying(200) NOT NULL
    CHECK (length(btrim(display_name)) BETWEEN 1 AND 200),
  tax_number character varying(100),
  phone character varying(32),
  email character varying(254),
  address character varying(500),
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_by character varying(26) NOT NULL
);
CREATE INDEX bob_party_currents_name_idx
  ON bob_party_currents(upper(display_name),party_id);

INSERT INTO bob_party_currents(
  party_id,source_approval_entry_id,kind,legal_name,display_name,
  tax_number,phone,email,address,updated_at,updated_by
)
SELECT party.id,mapping.approval_entry_id,party.kind,party.legal_name,
       party.display_name,party.tax_number,party.phone,party.email,party.address,
       party.updated_at,party.updated_by
FROM bob_parties party
JOIN issue_283_party_entries mapping ON mapping.party_id=party.id
WHERE party.merged_into_party_id IS NULL;

-- Old preflights cannot be confirmed under the new Approval-token protocol.
-- Remove only unconsumed transient rows; retain consumed rows referenced by
-- immutable merge audit events and attach their synthesized baseline tokens.
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM bob_party_merge_preflights preflight
    JOIN bob_party_merge_events merge_event ON merge_event.preflight_id=preflight.id
    WHERE preflight.consumed_at IS NULL
  ) THEN
    RAISE EXCEPTION 'issue #283 found merge event referencing an unconsumed preflight';
  END IF;
END $$;
DELETE FROM bob_party_merge_preflights WHERE consumed_at IS NULL;
ALTER TABLE bob_party_merge_preflights
  RENAME COLUMN source_revision TO source_approval_revision;
ALTER TABLE bob_party_merge_preflights
  RENAME COLUMN target_revision TO target_approval_revision;
ALTER TABLE bob_party_merge_preflights
  RENAME CONSTRAINT bob_party_merge_preflights_source_revision_check
    TO bob_party_merge_preflights_source_approval_revision_check;
ALTER TABLE bob_party_merge_preflights
  RENAME CONSTRAINT bob_party_merge_preflights_target_revision_check
    TO bob_party_merge_preflights_target_approval_revision_check;
ALTER TABLE bob_party_merge_preflights
  ADD COLUMN source_approval_entry_id character varying(26),
  ADD COLUMN target_approval_entry_id character varying(26);
UPDATE bob_party_merge_preflights preflight
SET source_approval_entry_id=source_entry.approval_entry_id,
    target_approval_entry_id=target_entry.approval_entry_id,
    source_approval_revision=source_party.revision+2,
    target_approval_revision=target_party.revision+2
FROM issue_283_party_entries source_entry
JOIN bob_parties source_party ON source_party.id=source_entry.party_id
JOIN issue_283_party_entries target_entry ON true
JOIN bob_parties target_party ON target_party.id=target_entry.party_id
WHERE source_entry.party_id=preflight.source_party_id
  AND target_entry.party_id=preflight.target_party_id;
ALTER TABLE bob_party_merge_preflights
  ALTER COLUMN source_approval_entry_id SET NOT NULL,
  ALTER COLUMN target_approval_entry_id SET NOT NULL,
  ADD CONSTRAINT bob_party_merge_preflights_source_approval_entry_id_fkey
    FOREIGN KEY(source_approval_entry_id) REFERENCES approval_entries(id) ON DELETE RESTRICT,
  ADD CONSTRAINT bob_party_merge_preflights_target_approval_entry_id_fkey
    FOREIGN KEY(target_approval_entry_id) REFERENCES approval_entries(id) ON DELETE RESTRICT;

DROP INDEX bob_parties_name_idx;
ALTER TABLE bob_parties
  DROP COLUMN kind,
  DROP COLUMN legal_name,
  DROP COLUMN display_name,
  DROP COLUMN tax_number,
  DROP COLUMN phone,
  DROP COLUMN email,
  DROP COLUMN address,
  DROP COLUMN revision,
  DROP COLUMN updated_at,
  DROP COLUMN updated_by;
DROP TABLE bob_party_audit_events;

-- Preserve every existing grant by reusing the former create/save/audit and
-- merge permission IDs. New permissions are created here; read and draft
-- lifecycle grants are copied below while review grants remain explicit.
UPDATE app_permissions permission
SET path=mapping.path,domain=mapping.domain,entity='party',action=mapping.action,
    description=mapping.description,revision=permission.revision+1,
    updated_at=clock_timestamp()
FROM (VALUES
  ('01JBOB85000000000000000003','/dcl/party/create','dcl','create','随首条关系创建主体声明'),
  ('01JBOB85000000000000000004','/dcl/party/save','dcl','save','保存主体声明'),
  ('01JBOB85000000000000000005','/dcl/party/audit-history','dcl','audit-history','查看主体声明审计'),
  ('01JBOB88MRG000000000000001','/dcl/party/merge-preflight','dcl','merge-preflight','预检主体合并'),
  ('01JBOB88MRG000000000000002','/dcl/party/merge-confirm','dcl','merge-confirm','确认主体合并')
) mapping(id,path,domain,action,description)
WHERE permission.id=mapping.id;

INSERT INTO app_permissions(
  id,path,domain,entity,action,description,status,created_at,updated_at,revision,menu_order
) VALUES
  ('01JDCLPTY00000000000000003','/dcl/party/submit','dcl','party','submit','提交主体声明','ENABLED',clock_timestamp(),clock_timestamp(),1,NULL),
  ('01JDCLPTY00000000000000004','/dcl/party/unsubmit','dcl','party','unsubmit','撤回主体声明','ENABLED',clock_timestamp(),clock_timestamp(),1,NULL),
  ('01JDCLPTY00000000000000005','/dcl/party/reject','dcl','party','reject','驳回主体声明','ENABLED',clock_timestamp(),clock_timestamp(),1,NULL),
  ('01JDCLPTY00000000000000006','/dcl/party/approve','dcl','party','approve','审核主体声明','ENABLED',clock_timestamp(),clock_timestamp(),1,NULL),
  ('01JDCLPTY00000000000000007','/dcl/party/unapprove','dcl','party','unapprove','反审核主体声明','ENABLED',clock_timestamp(),clock_timestamp(),1,NULL),
	  ('01JDCLPTY00000000000000008','/dcl/party/delete','dcl','party','delete','删除主体候选草稿','ENABLED',clock_timestamp(),clock_timestamp(),1,NULL),
  ('01JDCLPTY00000000000000009','/dcl/party/get','dcl','party','get','查看主体声明','ENABLED',clock_timestamp(),clock_timestamp(),1,NULL),
  ('01JDCLPTY00000000000000010','/dcl/party/query','dcl','party','query','查询主体声明','ENABLED',clock_timestamp(),clock_timestamp(),1,90),
  ('01JDCLPTY00000000000000011','/dcl/party/versions','dcl','party','versions','查看主体声明版本','ENABLED',clock_timestamp(),clock_timestamp(),1,NULL);

-- Carry old read grants to the new declaration read surface. Roles that could
-- directly save Party identity keep draft lifecycle control, but review
-- permissions remain deliberately unassigned so submitter/reviewer separation
-- is not weakened during cutover.
INSERT INTO app_role_permissions(role_id,permission_id,created_at,created_by)
SELECT grant_row.role_id,mapping.new_permission_id,clock_timestamp(),grant_row.created_by
FROM app_role_permissions grant_row
JOIN (VALUES
  ('01JBOB85000000000000000001','01JDCLPTY00000000000000010'),
  ('01JBOB85000000000000000002','01JDCLPTY00000000000000009'),
  ('01JBOB85000000000000000002','01JDCLPTY00000000000000011'),
  ('01JBOB85000000000000000004','01JDCLPTY00000000000000003'),
  ('01JBOB85000000000000000004','01JDCLPTY00000000000000004'),
  ('01JBOB85000000000000000004','01JDCLPTY00000000000000008'),
  ('01JBOB85000000000000000004','01JDCLPTY00000000000000009'),
  ('01JBOB85000000000000000004','01JDCLPTY00000000000000010'),
  ('01JBOB85000000000000000004','01JDCLPTY00000000000000011')
) mapping(old_permission_id,new_permission_id)
  ON mapping.old_permission_id=grant_row.permission_id
ON CONFLICT (role_id,permission_id) DO NOTHING;

DO $$
DECLARE
  party_count bigint;
  current_count bigint;
BEGIN
	  SELECT count(*) INTO party_count FROM bob_parties;
	  SELECT count(*) INTO current_count FROM bob_parties WHERE merged_into_party_id IS NULL;
	  IF EXISTS (
	    SELECT 1 FROM approval_entries
	    WHERE domain='dcl' AND entity='party'
	      AND id !~ '^[0-7][0-9A-HJKMNP-TV-Z]{25}$'
	  ) OR EXISTS (
	    SELECT 1 FROM approval_events
	    WHERE domain='dcl' AND entity='party' AND request_id='issue-283-cutover'
	      AND id !~ '^[0-7][0-9A-HJKMNP-TV-Z]{25}$'
	  ) THEN
	    RAISE EXCEPTION 'issue #283 generated a non-ULID Approval identifier';
	  END IF;
	  IF party_count<>(SELECT count(*) FROM dcl_subjects WHERE entity='party')
    OR party_count<>(SELECT count(*) FROM dcl_party_versions)
    OR party_count<>(SELECT count(*) FROM approval_entries WHERE domain='dcl' AND entity='party')
    OR current_count<>(SELECT count(*) FROM bob_party_currents) THEN
    RAISE EXCEPTION 'issue #283 Party root/version/current count mismatch';
  END IF;
  IF (SELECT count(*) FROM bob_party_identifiers)<>
     (SELECT count(*) FROM dcl_party_version_identifiers) OR
     (SELECT count(*) FROM bob_party_identifiers)<>
     (SELECT count(*) FROM dcl_party_identifier_claims) THEN
    RAISE EXCEPTION 'issue #283 Party identifier snapshot/claim count mismatch';
  END IF;
  IF (SELECT count(*) FROM app_permissions WHERE path LIKE '/dcl/party/%')<>14
    OR (SELECT count(*) FROM app_permissions WHERE path IN ('/bob/party/query','/bob/party/get'))<>2 THEN
    RAISE EXCEPTION 'issue #283 Party permission cutover mismatch';
  END IF;
  IF EXISTS (
    SELECT 1 FROM app_role_permissions old_grant
    WHERE old_grant.permission_id='01JBOB85000000000000000001'
      AND NOT EXISTS (
        SELECT 1 FROM app_role_permissions new_grant
        WHERE new_grant.role_id=old_grant.role_id
          AND new_grant.permission_id='01JDCLPTY00000000000000010'
      )
  ) OR EXISTS (
    SELECT 1 FROM app_role_permissions old_grant
    WHERE old_grant.permission_id='01JBOB85000000000000000002'
      AND NOT EXISTS (
        SELECT 1 FROM app_role_permissions new_grant
        WHERE new_grant.role_id=old_grant.role_id
          AND new_grant.permission_id IN ('01JDCLPTY00000000000000009','01JDCLPTY00000000000000011')
        GROUP BY new_grant.role_id HAVING count(*)=2
      )
  ) THEN
    RAISE EXCEPTION 'issue #283 Party read role grants were not copied';
  END IF;
END $$;

COMMIT;

SELECT
  (SELECT count(*) FROM bob_parties) AS stable_parties,
  (SELECT count(*) FROM dcl_party_versions) AS dcl_versions,
  (SELECT count(*) FROM bob_party_currents) AS bob_current,
  (SELECT count(*) FROM dcl_party_identifier_claims) AS identifier_claims;
SELECT count(*) AS obsolete_bob_party_write_permissions
FROM app_permissions
WHERE path IN ('/bob/party/create','/bob/party/save','/bob/party/audit-history',
               '/bob/party/merge-preflight','/bob/party/merge-confirm');

\set ON_ERROR_STOP on

-- #309 is the terminal ownership cutover after #305/#308. It removes the
-- last physical BOB identity table and moves report-definition stable identity
-- into DCL without recreating IDs, Approval entries/events, or runtime audit.
BEGIN;

LOCK TABLE bob_objects, dcl_subjects, approval_entries, approval_events,
  rpt_definitions, dcl_rpt_definition_versions, rpt_runtime_audit_events,
  dcl_rpt_definition_code_counters IN ACCESS EXCLUSIVE MODE;

-- #308 must already have copied every remaining BOB identity into its typed
-- DCL root. Do not silently perform a partial or second migration here.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM bob_objects) THEN
    RAISE EXCEPTION 'issue #309 requires issue #308: bob_objects still contains identities';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM dcl_subjects subject
    WHERE subject.entity IN ('employee','customer','supplier','other-unit','sales-partner','customer-account')
      AND (subject.code IS NULL OR NOT EXISTS (
        SELECT 1 FROM approval_entries entry
        WHERE entry.domain='dcl' AND entry.entity=subject.entity AND entry.subject_id=subject.id
      ))
  ) THEN
    RAISE EXCEPTION 'issue #309 found an orphaned DCL subject after BOB identity cutover';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM rpt_definitions definition
    LEFT JOIN dcl_subjects subject
      ON subject.id=definition.id AND subject.entity='rpt-definition'
    WHERE subject.id IS NULL
       OR subject.created_at<>definition.created_at
       OR subject.created_by<>definition.created_by
  ) OR EXISTS (
    SELECT 1
    FROM dcl_rpt_definition_versions snapshot
    JOIN approval_entries entry ON entry.id=snapshot.approval_entry_id
    WHERE entry.domain<>'dcl' OR entry.entity<>'rpt-definition'
       OR entry.subject_id<>snapshot.definition_id
  ) THEN
    RAISE EXCEPTION 'issue #309 found a report-definition identity, approval, or snapshot mismatch';
  END IF;
END $$;

CREATE TEMP TABLE issue_309_rpt_runtime_audit ON COMMIT DROP AS
SELECT id,definition_id,report_code,approval_entry_id,event_type,actor_id,request_id,occurred_at,summary
FROM rpt_runtime_audit_events;
CREATE TEMP TABLE issue_309_rpt_approval_events ON COMMIT DROP AS
SELECT id,entry_id,domain,entity,subject_id,version_no,action,from_status,to_status,
       from_revision,to_revision,actor_id,reason,request_id,created_at
FROM approval_events
WHERE domain='dcl' AND entity='rpt-definition';
CREATE TEMP TABLE issue_309_rpt_approval_entries ON COMMIT DROP AS
SELECT id,domain,entity,subject_id,version_no,status,revision,
       created_by,created_at,updated_by,updated_at,submitted_by,submitted_at,
       approved_by,approved_at
FROM approval_entries
WHERE domain='dcl' AND entity='rpt-definition';
CREATE TEMP TABLE issue_309_rpt_code_counters ON COMMIT DROP AS
SELECT counter_key,next_value FROM dcl_rpt_definition_code_counters;

-- A DCL subject owns report code and creation audit. The general code check was
-- originally limited to BOB-style codes, so admit the existing report-code wire
-- grammar before copying it in place.
ALTER TABLE dcl_subjects DROP CONSTRAINT dcl_subjects_code_check;
ALTER TABLE dcl_subjects ADD CONSTRAINT dcl_subjects_code_check
  CHECK (
    code IS NULL
    OR (entity='rpt-definition' AND code ~ '^[a-z][a-z0-9-]{1,62}[a-z0-9]$'
        AND code NOT IN ('definition','directory'))
    OR (entity<>'rpt-definition' AND code ~ '^[A-Z]{3}-[0-9]{4}$')
  );
UPDATE dcl_subjects subject
SET code=definition.code,
    created_at=definition.created_at,
    created_by=definition.created_by
FROM rpt_definitions definition
WHERE subject.id=definition.id AND subject.entity='rpt-definition';
ALTER TABLE dcl_subjects DROP CONSTRAINT dcl_subjects_core_code_required_ck;
ALTER TABLE dcl_subjects ADD CONSTRAINT dcl_subjects_core_code_required_ck
  CHECK (entity NOT IN ('operating-entity','warehouse','vehicle','fund-account','product',
                        'employee','customer','supplier','other-unit','sales-partner',
                        'customer-account','rpt-definition') OR code IS NOT NULL);

-- enabled is declaration data; technical validity is RPT-owned runtime state.
ALTER TABLE dcl_rpt_definition_versions
  ADD COLUMN enabled boolean NOT NULL DEFAULT true;
UPDATE dcl_rpt_definition_versions snapshot
SET enabled=definition.enabled
FROM rpt_definitions definition
WHERE definition.id=snapshot.definition_id;
CREATE TABLE rpt_definition_validities (
  approval_entry_id character varying(26) PRIMARY KEY
    REFERENCES approval_entries(id) ON DELETE CASCADE,
  validity character varying(16) NOT NULL CHECK (validity IN ('VALID','INVALID')),
  invalidated_at timestamp with time zone,
  invalid_reason character varying(200),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  created_by character varying(26) NOT NULL,
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_by character varying(26) NOT NULL
);
INSERT INTO rpt_definition_validities(
  approval_entry_id,validity,invalidated_at,invalid_reason,created_at,created_by,updated_at,updated_by
)
SELECT snapshot.approval_entry_id,snapshot.validity,snapshot.invalidated_at,snapshot.invalid_reason,
       entry.created_at,entry.created_by,snapshot.updated_at,snapshot.updated_by
FROM dcl_rpt_definition_versions snapshot
JOIN approval_entries entry ON entry.id=snapshot.approval_entry_id;

ALTER TABLE dcl_rpt_definition_versions
  DROP CONSTRAINT dcl_rpt_definition_versions_definition_id_fkey;
ALTER TABLE dcl_rpt_definition_versions DROP COLUMN definition_id;
ALTER TABLE dcl_rpt_definition_versions DROP COLUMN validity;
ALTER TABLE dcl_rpt_definition_versions DROP COLUMN invalidated_at;
ALTER TABLE dcl_rpt_definition_versions DROP COLUMN invalid_reason;

ALTER TABLE rpt_runtime_audit_events
  DROP CONSTRAINT rpt_runtime_audit_events_definition_id_fkey;
ALTER TABLE rpt_runtime_audit_events
  ADD CONSTRAINT rpt_runtime_audit_events_definition_id_fkey
  FOREIGN KEY (definition_id) REFERENCES dcl_subjects(id) ON DELETE SET NULL;

DROP TABLE bob_objects;
DROP TABLE rpt_definitions;

DO $$
BEGIN
  IF to_regclass('public.bob_objects') IS NOT NULL
     OR to_regclass('public.rpt_definitions') IS NOT NULL
     OR EXISTS (SELECT 1 FROM dcl_subjects WHERE entity='rpt-definition' AND code IS NULL)
     OR EXISTS (SELECT entity,upper(code) FROM dcl_subjects WHERE code IS NOT NULL GROUP BY entity,upper(code) HAVING count(*)>1)
     OR EXISTS (
       SELECT 1
       FROM dcl_rpt_definition_versions snapshot
       JOIN approval_entries entry ON entry.id=snapshot.approval_entry_id
       LEFT JOIN rpt_definition_validities validity ON validity.approval_entry_id=snapshot.approval_entry_id
       WHERE entry.domain<>'dcl' OR entry.entity<>'rpt-definition'
          OR entry.subject_id NOT IN (SELECT id FROM dcl_subjects WHERE entity='rpt-definition')
          OR validity.approval_entry_id IS NULL
     )
     OR EXISTS (
       (SELECT * FROM issue_309_rpt_runtime_audit EXCEPT SELECT id,definition_id,report_code,approval_entry_id,event_type,actor_id,request_id,occurred_at,summary FROM rpt_runtime_audit_events)
       UNION ALL
       (SELECT id,definition_id,report_code,approval_entry_id,event_type,actor_id,request_id,occurred_at,summary FROM rpt_runtime_audit_events EXCEPT SELECT * FROM issue_309_rpt_runtime_audit)
     )
     OR EXISTS (
       (SELECT * FROM issue_309_rpt_approval_events EXCEPT SELECT id,entry_id,domain,entity,subject_id,version_no,action,from_status,to_status,from_revision,to_revision,actor_id,reason,request_id,created_at FROM approval_events WHERE domain='dcl' AND entity='rpt-definition')
       UNION ALL
       (SELECT id,entry_id,domain,entity,subject_id,version_no,action,from_status,to_status,from_revision,to_revision,actor_id,reason,request_id,created_at FROM approval_events WHERE domain='dcl' AND entity='rpt-definition' EXCEPT SELECT * FROM issue_309_rpt_approval_events)
     )
     OR EXISTS (
       (SELECT * FROM issue_309_rpt_approval_entries EXCEPT SELECT id,domain,entity,subject_id,version_no,status,revision,created_by,created_at,updated_by,updated_at,submitted_by,submitted_at,approved_by,approved_at FROM approval_entries WHERE domain='dcl' AND entity='rpt-definition')
       UNION ALL
       (SELECT id,domain,entity,subject_id,version_no,status,revision,created_by,created_at,updated_by,updated_at,submitted_by,submitted_at,approved_by,approved_at FROM approval_entries WHERE domain='dcl' AND entity='rpt-definition' EXCEPT SELECT * FROM issue_309_rpt_approval_entries)
     )
     OR EXISTS (
       (SELECT * FROM issue_309_rpt_code_counters EXCEPT SELECT counter_key,next_value FROM dcl_rpt_definition_code_counters)
       UNION ALL
       (SELECT counter_key,next_value FROM dcl_rpt_definition_code_counters EXCEPT SELECT * FROM issue_309_rpt_code_counters)
     ) THEN
    RAISE EXCEPTION 'issue #309 did not preserve DCL/RPT identities, Approval audit, or runtime audit';
  END IF;
END $$;

COMMIT;

SELECT
  (SELECT count(*) FROM dcl_subjects WHERE entity='rpt-definition') AS rpt_dcl_subjects,
  (SELECT count(*) FROM dcl_rpt_definition_versions) AS rpt_declaration_versions,
  (SELECT count(*) FROM rpt_definition_validities) AS rpt_technical_validities,
  (SELECT count(*) FROM rpt_runtime_audit_events) AS rpt_runtime_audits;

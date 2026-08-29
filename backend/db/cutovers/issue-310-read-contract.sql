\set ON_ERROR_STOP on

-- #310 removes the last DCL stable-subject revision. Workflow definition
-- concurrency is owned by the latest APPROVED approval entry and its revision;
-- enabled remains a separate runtime switch on the stable subject.
BEGIN;

LOCK TABLE wfl_process_definitions, dcl_subjects, approval_entries,
  dcl_wfl_process_definition_versions IN ACCESS EXCLUSIVE MODE;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM wfl_process_definitions definition
    LEFT JOIN dcl_subjects subject
      ON subject.id=definition.id AND subject.entity='wfl-process-definition'
    WHERE subject.id IS NULL
       OR NOT EXISTS (
         SELECT 1
         FROM dcl_wfl_process_definition_versions snapshot
         JOIN approval_entries entry ON entry.id=snapshot.approval_entry_id
         WHERE snapshot.definition_id=definition.id
           AND entry.domain='dcl'
           AND entry.entity='wfl-process-definition'
           AND entry.subject_id=definition.id
       )
  ) OR EXISTS (
    SELECT 1
    FROM approval_entries entry
    LEFT JOIN dcl_wfl_process_definition_versions snapshot
      ON snapshot.approval_entry_id=entry.id
    WHERE entry.domain='dcl'
      AND entry.entity='wfl-process-definition'
      AND snapshot.approval_entry_id IS NULL
  ) THEN
    RAISE EXCEPTION 'issue #310 found a workflow definition without its DCL subject or typed Approval snapshot';
  END IF;
END $$;

ALTER TABLE wfl_process_definitions
  DROP CONSTRAINT wfl_process_definitions_revision_check;
ALTER TABLE wfl_process_definitions DROP COLUMN revision;

COMMIT;

SELECT count(*) AS workflow_definitions_without_object_revision
FROM information_schema.columns
WHERE table_schema='public'
  AND table_name='wfl_process_definitions'
  AND column_name='revision';

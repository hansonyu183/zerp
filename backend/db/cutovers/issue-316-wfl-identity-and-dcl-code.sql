BEGIN;

LOCK TABLE dcl_subjects, wfl_process_definitions,
  dcl_wfl_process_definition_versions, wfl_definition_instances,
  wfl_create_child_requests IN ACCESS EXCLUSIVE MODE;

DO $$
BEGIN
  IF to_regclass('public.wfl_definition_runtime_states') IS NOT NULL THEN
    RAISE EXCEPTION 'issue-316 cutover requires the legacy WFL root and no runtime-state table';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM wfl_process_definitions definition
    LEFT JOIN dcl_subjects subject
      ON subject.id=definition.id AND subject.entity='wfl-process-definition'
    WHERE subject.id IS NULL
       OR (subject.code IS NOT NULL AND subject.code<>definition.code)
  ) OR EXISTS (
    SELECT 1
    FROM dcl_subjects subject
    LEFT JOIN wfl_process_definitions definition ON definition.id=subject.id
    WHERE subject.entity='wfl-process-definition' AND definition.id IS NULL
  ) THEN
    RAISE EXCEPTION 'WFL definition roots and DCL subjects are not one-to-one';
  END IF;

  IF EXISTS (
    SELECT 1 FROM wfl_process_definitions
    WHERE code IS NULL OR code !~ '^[a-z][a-z0-9-]{1,62}[a-z0-9]$'
  ) OR EXISTS (
    SELECT upper(code)
    FROM wfl_process_definitions
    GROUP BY upper(code)
    HAVING count(*)>1
  ) THEN
    RAISE EXCEPTION 'WFL definition code is null, malformed, or duplicated';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM dcl_wfl_process_definition_versions version
    LEFT JOIN wfl_process_definitions definition ON definition.id=version.definition_id
    WHERE definition.id IS NULL
  ) OR EXISTS (
    SELECT 1
    FROM wfl_definition_instances instance
    LEFT JOIN wfl_process_definitions definition ON definition.id=instance.definition_id
    WHERE definition.id IS NULL
  ) OR EXISTS (
    SELECT 1
    FROM wfl_create_child_requests request
    LEFT JOIN wfl_process_definitions definition ON definition.id=request.definition_id
    WHERE definition.id IS NULL
  ) THEN
    RAISE EXCEPTION 'WFL version, instance, or child request has an orphan definition';
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM dcl_subjects
    WHERE entity<>'wfl-process-definition'
      AND NOT (
        (code IS NOT NULL AND (
          (entity='operating-entity' AND code ~ '^OPE-[0-9]{4}$')
          OR (entity='warehouse' AND code ~ '^WHS-[0-9]{4}$')
          OR (entity='vehicle' AND code ~ '^VEH-[0-9]{4}$')
          OR (entity='fund-account' AND code ~ '^FAC-[0-9]{4}$')
          OR (entity='product' AND code ~ '^PRD-[0-9]{4}$')
          OR (entity='employee' AND code ~ '^EMP-[0-9]{4}$')
          OR (entity='customer' AND code ~ '^CUS-[0-9]{4}$')
          OR (entity='customer-account' AND code ~ '^ACC-[0-9]{4}$')
          OR (entity='supplier' AND code ~ '^SUP-[0-9]{4}$')
          OR (entity='other-unit' AND code ~ '^OTU-[0-9]{4}$')
          OR (entity='sales-partner' AND code ~ '^SLP-[0-9]{4}$')
          OR (entity='rpt-definition' AND code ~ '^[a-z][a-z0-9-]{1,62}[a-z0-9]$' AND code NOT IN ('definition','directory'))
        ))
        OR (code IS NULL AND entity IN ('party','acc-mapping'))
      )
  ) THEN
    RAISE EXCEPTION 'DCL subject code is null, malformed, or has the wrong entity prefix';
  END IF;
END $$;

-- The legacy check only admits BOB-style codes. All replacement values have
-- already been validated above, so remove it before copying WFL slugs.
ALTER TABLE dcl_subjects
  DROP CONSTRAINT dcl_subjects_code_check,
  DROP CONSTRAINT dcl_subjects_core_code_required_ck;

UPDATE dcl_subjects subject
SET code=definition.code,
    created_at=definition.created_at,
    created_by=definition.created_by
FROM wfl_process_definitions definition
WHERE subject.id=definition.id AND subject.entity='wfl-process-definition';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM dcl_subjects
    WHERE NOT (
      (code IS NOT NULL AND (
        (entity='operating-entity' AND code ~ '^OPE-[0-9]{4}$')
        OR (entity='warehouse' AND code ~ '^WHS-[0-9]{4}$')
        OR (entity='vehicle' AND code ~ '^VEH-[0-9]{4}$')
        OR (entity='fund-account' AND code ~ '^FAC-[0-9]{4}$')
        OR (entity='product' AND code ~ '^PRD-[0-9]{4}$')
        OR (entity='employee' AND code ~ '^EMP-[0-9]{4}$')
        OR (entity='customer' AND code ~ '^CUS-[0-9]{4}$')
        OR (entity='customer-account' AND code ~ '^ACC-[0-9]{4}$')
        OR (entity='supplier' AND code ~ '^SUP-[0-9]{4}$')
        OR (entity='other-unit' AND code ~ '^OTU-[0-9]{4}$')
        OR (entity='sales-partner' AND code ~ '^SLP-[0-9]{4}$')
        OR (entity='rpt-definition' AND code ~ '^[a-z][a-z0-9-]{1,62}[a-z0-9]$' AND code NOT IN ('definition','directory'))
        OR (entity='wfl-process-definition' AND code ~ '^[a-z][a-z0-9-]{1,62}[a-z0-9]$')
      ))
      OR (code IS NULL AND entity IN ('party','acc-mapping'))
    )
  ) THEN
    RAISE EXCEPTION 'DCL subject code is null, malformed, or has the wrong entity prefix';
  END IF;
END $$;

CREATE TABLE wfl_definition_runtime_states (
  subject_id varchar(26) PRIMARY KEY,
  subject_entity varchar(64) NOT NULL DEFAULT 'wfl-process-definition'
    CHECK (subject_entity='wfl-process-definition'),
  enabled boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by varchar(26) NOT NULL,
  FOREIGN KEY (subject_id,subject_entity)
    REFERENCES dcl_subjects(id,entity) ON DELETE CASCADE
);

INSERT INTO wfl_definition_runtime_states(subject_id,enabled,updated_at,updated_by)
SELECT id,enabled,updated_at,updated_by
FROM wfl_process_definitions;

ALTER TABLE dcl_wfl_process_definition_versions
  DROP CONSTRAINT dcl_wfl_process_definition_versions_definition_id_fkey;
ALTER TABLE wfl_definition_instances
  DROP CONSTRAINT wfl_definition_instances_definition_id_fkey;
ALTER TABLE wfl_create_child_requests
  DROP CONSTRAINT wfl_create_child_requests_definition_id_fkey;

ALTER TABLE dcl_wfl_process_definition_versions
  ADD CONSTRAINT dcl_wfl_process_definition_versions_definition_id_fkey
  FOREIGN KEY (definition_id) REFERENCES wfl_definition_runtime_states(subject_id) ON DELETE CASCADE;
ALTER TABLE wfl_definition_instances
  ADD CONSTRAINT wfl_definition_instances_definition_id_fkey
  FOREIGN KEY (definition_id) REFERENCES wfl_definition_runtime_states(subject_id) ON DELETE RESTRICT;
ALTER TABLE wfl_create_child_requests
  ADD CONSTRAINT wfl_create_child_requests_definition_id_fkey
  FOREIGN KEY (definition_id) REFERENCES wfl_definition_runtime_states(subject_id) ON DELETE RESTRICT;

ALTER TABLE dcl_subjects
  ADD CONSTRAINT dcl_subjects_code_ck CHECK (
    (code IS NOT NULL AND (
      (entity='operating-entity' AND code ~ '^OPE-[0-9]{4}$')
      OR (entity='warehouse' AND code ~ '^WHS-[0-9]{4}$')
      OR (entity='vehicle' AND code ~ '^VEH-[0-9]{4}$')
      OR (entity='fund-account' AND code ~ '^FAC-[0-9]{4}$')
      OR (entity='product' AND code ~ '^PRD-[0-9]{4}$')
      OR (entity='employee' AND code ~ '^EMP-[0-9]{4}$')
      OR (entity='customer' AND code ~ '^CUS-[0-9]{4}$')
      OR (entity='customer-account' AND code ~ '^ACC-[0-9]{4}$')
      OR (entity='supplier' AND code ~ '^SUP-[0-9]{4}$')
      OR (entity='other-unit' AND code ~ '^OTU-[0-9]{4}$')
      OR (entity='sales-partner' AND code ~ '^SLP-[0-9]{4}$')
      OR (entity='rpt-definition' AND code ~ '^[a-z][a-z0-9-]{1,62}[a-z0-9]$' AND code NOT IN ('definition','directory'))
      OR (entity='wfl-process-definition' AND code ~ '^[a-z][a-z0-9-]{1,62}[a-z0-9]$')
    ))
    OR (code IS NULL AND entity IN ('party','acc-mapping'))
  );

CREATE FUNCTION dcl_require_subject_code(subject_code varchar) RETURNS varchar
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE
AS $$
BEGIN
  IF subject_code IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = 'check_violation',
      MESSAGE = 'coded DCL subject has a null code';
  END IF;
  RETURN subject_code;
END;
$$;

DROP TABLE wfl_process_definitions;

DO $$
BEGIN
  IF to_regclass('public.wfl_process_definitions') IS NOT NULL
     OR EXISTS (
       SELECT 1
       FROM dcl_subjects subject
       FULL JOIN wfl_definition_runtime_states runtime ON runtime.subject_id=subject.id
       WHERE (subject.entity='wfl-process-definition' OR runtime.subject_id IS NOT NULL)
         AND (subject.id IS NULL OR subject.entity<>'wfl-process-definition' OR runtime.subject_id IS NULL)
     ) OR EXISTS (
       SELECT 1 FROM dcl_wfl_process_definition_versions version
       LEFT JOIN wfl_definition_runtime_states runtime ON runtime.subject_id=version.definition_id
       WHERE runtime.subject_id IS NULL
     ) OR EXISTS (
       SELECT 1 FROM wfl_definition_instances instance
       LEFT JOIN wfl_definition_runtime_states runtime ON runtime.subject_id=instance.definition_id
       WHERE runtime.subject_id IS NULL
     ) OR EXISTS (
       SELECT 1 FROM wfl_create_child_requests request
       LEFT JOIN wfl_definition_runtime_states runtime ON runtime.subject_id=request.definition_id
       WHERE runtime.subject_id IS NULL
     ) THEN
    RAISE EXCEPTION 'issue-316 final WFL identity guard failed';
  END IF;
END $$;

COMMIT;

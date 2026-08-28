\set ON_ERROR_STOP on

-- One-time in-place cutover for issue #284. Run against the post-#283,
-- pre-#284 schema while Employee writes are stopped, then deploy the matching
-- application SHA. This script is deliberately non-idempotent.
BEGIN;

LOCK TABLE bob_objects, bob_employee_versions, bob_employment_relationships,
  bob_parties, bob_party_currents, aux_objects, aux_version_payloads,
  dcl_subjects, approval_entries, approval_events, app_permissions,
  app_role_permissions IN ACCESS EXCLUSIVE MODE;

-- The legacy category relation is constrained to the obsolete AUX entity
-- `category`. It cannot be inferred to mean the new `employee-category`.
-- Establish explicit employee-category snapshots first, then clear/remodel
-- legacy data before rerunning this one-time cutover.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM bob_employee_versions
    WHERE category_id IS NOT NULL OR category_approval_entry_id IS NOT NULL
  ) THEN
    RAISE EXCEPTION
      'issue #284 cannot map legacy employee category: category is not employee-category; establish explicit employee-category references before cutover';
  END IF;
  IF EXISTS (
    SELECT 1 FROM bob_employee_versions payload
    WHERE (payload.department_id IS NULL)<>(payload.department_approval_entry_id IS NULL)
       OR (payload.position_id IS NULL)<>(payload.position_approval_entry_id IS NULL)
  ) THEN
    RAISE EXCEPTION 'issue #284 employee payload has an incomplete department or position exact reference';
  END IF;
  IF EXISTS (
    SELECT 1 FROM bob_employee_versions payload
    WHERE payload.department_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM aux_objects object
      JOIN approval_entries entry ON entry.id=payload.department_approval_entry_id
        AND entry.domain='aux' AND entry.entity='department'
        AND entry.subject_id=object.id
      JOIN aux_version_payloads version ON version.approval_entry_id=entry.id
        AND version.object_id=object.id AND version.entity='department'
      WHERE object.id=payload.department_id AND object.entity='department'
        AND btrim(COALESCE(version.data->>'name',''))<>''
    )
  ) OR EXISTS (
    SELECT 1 FROM bob_employee_versions payload
    WHERE payload.position_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM aux_objects object
      JOIN approval_entries entry ON entry.id=payload.position_approval_entry_id
        AND entry.domain='aux' AND entry.entity='position'
        AND entry.subject_id=object.id
      JOIN aux_version_payloads version ON version.approval_entry_id=entry.id
        AND version.object_id=object.id AND version.entity='position'
      WHERE object.id=payload.position_id AND object.entity='position'
        AND btrim(COALESCE(version.data->>'name',''))<>''
    )
  ) THEN
    RAISE EXCEPTION 'issue #284 cannot resolve a legacy department or position exact AUX approval snapshot';
  END IF;
  IF EXISTS (
    SELECT 1 FROM bob_objects object
    WHERE object.entity='employee' AND NOT EXISTS (
      SELECT 1 FROM bob_employment_relationships relationship
      JOIN bob_party_currents party ON party.party_id=relationship.party_id
      WHERE relationship.object_id=object.id
    )
  ) THEN
    RAISE EXCEPTION 'issue #284 employee root has no stable Party current employment relationship';
  END IF;
END $$;

ALTER TABLE aux_objects DROP CONSTRAINT aux_objects_entity_check;
ALTER TABLE aux_objects ADD CONSTRAINT aux_objects_entity_check CHECK (
  entity IN ('product-category','product-type','employee-category','department',
             'position','settlement-method','payment-method','dictionary-type',
             'dictionary-item','measurement-unit','income-expense-type','asset-category')
);

ALTER TABLE dcl_subjects DROP CONSTRAINT dcl_subjects_entity_check;
ALTER TABLE dcl_subjects ADD CONSTRAINT dcl_subjects_entity_check CHECK (
  entity IN ('operating-entity','warehouse','vehicle','fund-account','product','party','employee')
);

CREATE TABLE dcl_employee_versions (
  approval_entry_id character varying(26) PRIMARY KEY
    REFERENCES approval_entries(id) ON DELETE RESTRICT,
  employee_category_id character varying(26) REFERENCES aux_objects(id) ON DELETE RESTRICT,
  employee_category_approval_entry_id character varying(26) REFERENCES approval_entries(id) ON DELETE RESTRICT,
  employee_category_code character varying(64),
  employee_category_name character varying(200),
  department_id character varying(26) REFERENCES aux_objects(id) ON DELETE RESTRICT,
  department_approval_entry_id character varying(26) REFERENCES approval_entries(id) ON DELETE RESTRICT,
  department_code character varying(64),
  department_name character varying(200),
  position_id character varying(26) REFERENCES aux_objects(id) ON DELETE RESTRICT,
  position_approval_entry_id character varying(26) REFERENCES approval_entries(id) ON DELETE RESTRICT,
  position_code character varying(64),
  position_name character varying(200),
  phone character varying(32),
  email character varying(254),
  hire_date date,
  remark character varying(1000),
  enabled boolean NOT NULL,
  CONSTRAINT dcl_employee_versions_employee_category_snapshot_check CHECK (
    (employee_category_id IS NULL)=(employee_category_approval_entry_id IS NULL)
    AND (employee_category_id IS NULL)=(employee_category_code IS NULL)
    AND (employee_category_id IS NULL)=(employee_category_name IS NULL)
  ),
  CONSTRAINT dcl_employee_versions_department_snapshot_check CHECK (
    (department_id IS NULL)=(department_approval_entry_id IS NULL)
    AND (department_id IS NULL)=(department_code IS NULL)
    AND (department_id IS NULL)=(department_name IS NULL)
  ),
  CONSTRAINT dcl_employee_versions_position_snapshot_check CHECK (
    (position_id IS NULL)=(position_approval_entry_id IS NULL)
    AND (position_id IS NULL)=(position_code IS NULL)
    AND (position_id IS NULL)=(position_name IS NULL)
  )
);
CREATE INDEX dcl_employee_versions_employee_category_idx ON dcl_employee_versions(employee_category_id);
CREATE INDEX dcl_employee_versions_department_idx ON dcl_employee_versions(department_id);
CREATE INDEX dcl_employee_versions_position_idx ON dcl_employee_versions(position_id);

CREATE TABLE bob_employees (
  object_id character varying(26) PRIMARY KEY REFERENCES bob_objects(id) ON DELETE RESTRICT,
  source_approval_entry_id character varying(26) NOT NULL UNIQUE
    REFERENCES approval_entries(id) ON DELETE RESTRICT,
  enabled boolean NOT NULL,
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_by character varying(26) NOT NULL
);

INSERT INTO dcl_subjects(id,entity,created_at,created_by)
SELECT id,'employee',created_at,created_by
FROM bob_objects WHERE entity='employee';

INSERT INTO dcl_employee_versions(
  approval_entry_id,department_id,department_approval_entry_id,department_code,
  department_name,position_id,position_approval_entry_id,position_code,position_name,
  phone,email,hire_date,remark,enabled
)
SELECT legacy.approval_entry_id,
  legacy.department_id,legacy.department_approval_entry_id,department.code,
  department_payload.data->>'name',legacy.position_id,
  legacy.position_approval_entry_id,position.code,position_payload.data->>'name',
  legacy.phone,legacy.email,legacy.hire_date,legacy.remark,object.enabled
FROM bob_employee_versions legacy
JOIN approval_entries employee_entry ON employee_entry.id=legacy.approval_entry_id
  AND employee_entry.domain='bob' AND employee_entry.entity='employee'
JOIN bob_objects object ON object.id=employee_entry.subject_id AND object.entity='employee'
LEFT JOIN aux_objects department ON department.id=legacy.department_id
  AND department.entity='department'
LEFT JOIN aux_version_payloads department_payload
  ON department_payload.approval_entry_id=legacy.department_approval_entry_id
  AND department_payload.object_id=department.id AND department_payload.entity='department'
LEFT JOIN aux_objects position ON position.id=legacy.position_id AND position.entity='position'
LEFT JOIN aux_version_payloads position_payload
  ON position_payload.approval_entry_id=legacy.position_approval_entry_id
  AND position_payload.object_id=position.id AND position_payload.entity='position';

UPDATE approval_entries SET domain='dcl'
WHERE domain='bob' AND entity='employee';
UPDATE approval_events SET domain='dcl'
WHERE domain='bob' AND entity='employee';

INSERT INTO bob_employees(
  object_id,source_approval_entry_id,enabled,updated_at,updated_by
)
SELECT object.id,entry.id,snapshot.enabled,entry.updated_at,entry.updated_by
FROM bob_objects object
JOIN LATERAL (
  SELECT id FROM approval_entries
  WHERE domain='dcl' AND entity='employee' AND subject_id=object.id
    AND status='APPROVED'
  ORDER BY version_no DESC LIMIT 1
) entry ON true
JOIN dcl_employee_versions snapshot ON snapshot.approval_entry_id=entry.id
WHERE object.entity='employee';

-- Keep BOB's stable get/query permissions. All declaration lifecycle and
-- approval surfaces retain their permission IDs but move to DCL routes.
UPDATE app_permissions
SET path='/dcl/employee/'||action,domain='dcl',updated_at=clock_timestamp(),revision=revision+1
WHERE id IN (
  '01JBOB00000000000000000021','01JBOB00000000000000000022',
  '01JBOB00000000000000000023','01JBOB00000000000000000027',
  '01JBOB00000000000000000028','01JBOB00000000000000000029',
  '01JBOB00000000000000000030','01JBOB00000000000000000083',
  '01JBOB00000000000000000141','01JBOB00000000000000000142',
  '01JBOB00000000000000000143','01JBOB00000000000000000144'
);

DO $$
DECLARE
  object_count bigint;
  legacy_count bigint;
  version_count bigint;
  approved_count bigint;
  current_count bigint;
BEGIN
  SELECT count(*) INTO object_count FROM bob_objects WHERE entity='employee';
  SELECT count(*) INTO legacy_count FROM bob_employee_versions;
  SELECT count(*) INTO version_count FROM dcl_employee_versions;
  SELECT count(DISTINCT subject_id) INTO approved_count
  FROM approval_entries WHERE domain='dcl' AND entity='employee' AND status='APPROVED';
  SELECT count(*) INTO current_count FROM bob_employees;
  IF object_count<>(SELECT count(*) FROM dcl_subjects WHERE entity='employee')
     OR legacy_count<>version_count OR approved_count<>current_count THEN
    RAISE EXCEPTION 'issue #284 employee root/version/current count mismatch: objects %, legacy %, versions %, approved %, current %',
      object_count,legacy_count,version_count,approved_count,current_count;
  END IF;
  IF EXISTS (SELECT 1 FROM approval_entries WHERE domain='bob' AND entity='employee')
     OR EXISTS (SELECT 1 FROM approval_events WHERE domain='bob' AND entity='employee') THEN
    RAISE EXCEPTION 'issue #284 cutover left BOB-owned employee approval data';
  END IF;
  IF (SELECT count(*) FROM app_permissions WHERE id IN (
        '01JBOB00000000000000000021','01JBOB00000000000000000022',
        '01JBOB00000000000000000023','01JBOB00000000000000000027',
        '01JBOB00000000000000000028','01JBOB00000000000000000029',
        '01JBOB00000000000000000030','01JBOB00000000000000000083',
        '01JBOB00000000000000000141','01JBOB00000000000000000142',
        '01JBOB00000000000000000143','01JBOB00000000000000000144'
      ) AND domain='dcl' AND path LIKE '/dcl/employee/%')<>12
     OR (SELECT count(*) FROM app_permissions
         WHERE id IN ('01JBOB00000000000000000025','01JBOB00000000000000000026')
           AND domain='bob' AND path LIKE '/bob/employee/%')<>2 THEN
    RAISE EXCEPTION 'issue #284 employee permission cutover mismatch';
  END IF;
END $$;

DROP TABLE bob_employee_versions;

COMMIT;

SELECT
  (SELECT count(*) FROM dcl_employee_versions) AS dcl_employee_versions,
  (SELECT count(*) FROM bob_employees) AS bob_employees_current;

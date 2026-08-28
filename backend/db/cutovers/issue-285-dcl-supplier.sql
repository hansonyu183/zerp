\set ON_ERROR_STOP on

-- One-time, deliberately non-idempotent #285 cutover. Supplier writes must be
-- stopped while this runs; deploy the matching DCL-only API immediately after.
BEGIN;

LOCK TABLE bob_objects, bob_supplier_relationships, bob_supplier_versions,
  bob_suppliers, bob_parties, bob_party_currents, dcl_subjects,
  approval_entries, approval_events, app_permissions IN ACCESS EXCLUSIVE MODE;

-- `category` was an obsolete Supplier field. It has no DCL meaning and must
-- never be guessed into the new declaration.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM bob_supplier_versions WHERE category_id IS NOT NULL OR category_approval_entry_id IS NOT NULL) THEN
    RAISE EXCEPTION 'issue #285 cannot cut over Supplier category: remove obsolete category facts explicitly before retrying';
  END IF;
  IF EXISTS (SELECT 1 FROM bob_supplier_versions WHERE (settlement_method_id IS NULL)<>(settlement_method_approval_entry_id IS NULL) OR (default_purchaser_employee_id IS NULL)<>(default_purchaser_employee_approval_entry_id IS NULL)) THEN
    RAISE EXCEPTION 'issue #285 cannot cut over incomplete Supplier exact snapshot';
  END IF;
END $$;

ALTER TABLE dcl_subjects DROP CONSTRAINT dcl_subjects_entity_check;
ALTER TABLE dcl_subjects ADD CONSTRAINT dcl_subjects_entity_check CHECK (entity IN ('operating-entity','warehouse','vehicle','fund-account','product','party','employee','other-unit','sales-partner','supplier'));

CREATE TABLE dcl_supplier_versions (
  approval_entry_id character varying(26) PRIMARY KEY REFERENCES approval_entries(id) ON DELETE RESTRICT,
  short_name character varying(100), tax_number character varying(50), contact_name character varying(100), contact_phone character varying(32), email character varying(254), address character varying(500), remark character varying(1000),
  settlement_method_id character varying(26), settlement_method_approval_entry_id character varying(26), settlement_method_code character varying(32), settlement_method_name character varying(200), settlement_term_code character varying(32), settlement_rule_type character varying(32), settlement_month_offset integer NOT NULL DEFAULT 0, settlement_day_of_month integer NOT NULL DEFAULT 0, settlement_day_offset integer NOT NULL DEFAULT 0,
  default_purchaser_employee_id character varying(26), default_purchaser_employee_approval_entry_id character varying(26), default_purchaser_employee_code character varying(64), default_purchaser_employee_name character varying(200), enabled boolean NOT NULL,
  CONSTRAINT dcl_supplier_settlement_snapshot_ck CHECK ((settlement_method_id IS NULL)=(settlement_method_approval_entry_id IS NULL) AND (settlement_method_id IS NULL)=(settlement_method_code IS NULL) AND (settlement_method_id IS NULL)=(settlement_method_name IS NULL) AND (settlement_method_id IS NULL)=(settlement_term_code IS NULL) AND (settlement_method_id IS NULL)=(settlement_rule_type IS NULL) AND (settlement_method_id IS NOT NULL OR (settlement_month_offset=0 AND settlement_day_of_month=0 AND settlement_day_offset=0))),
  CONSTRAINT dcl_supplier_default_purchaser_snapshot_ck CHECK ((default_purchaser_employee_id IS NULL)=(default_purchaser_employee_approval_entry_id IS NULL) AND (default_purchaser_employee_id IS NULL)=(default_purchaser_employee_code IS NULL) AND (default_purchaser_employee_id IS NULL)=(default_purchaser_employee_name IS NULL))
);
ALTER TABLE dcl_supplier_versions ADD CONSTRAINT dcl_supplier_versions_settlement_method_id_fkey FOREIGN KEY (settlement_method_id) REFERENCES aux_objects(id) ON DELETE RESTRICT;
ALTER TABLE dcl_supplier_versions ADD CONSTRAINT dcl_supplier_versions_settlement_method_entry_id_fkey FOREIGN KEY (settlement_method_approval_entry_id) REFERENCES approval_entries(id) ON DELETE RESTRICT;
ALTER TABLE dcl_supplier_versions ADD CONSTRAINT dcl_supplier_versions_default_purchaser_id_fkey FOREIGN KEY (default_purchaser_employee_id) REFERENCES bob_objects(id) ON DELETE RESTRICT;
ALTER TABLE dcl_supplier_versions ADD CONSTRAINT dcl_supplier_versions_default_purchaser_entry_id_fkey FOREIGN KEY (default_purchaser_employee_approval_entry_id) REFERENCES approval_entries(id) ON DELETE RESTRICT;
ALTER TABLE bob_suppliers ADD CONSTRAINT bob_suppliers_object_id_fkey FOREIGN KEY (object_id) REFERENCES bob_objects(id) ON DELETE RESTRICT;
ALTER TABLE bob_suppliers ADD CONSTRAINT bob_suppliers_source_approval_entry_id_fkey FOREIGN KEY (source_approval_entry_id) REFERENCES approval_entries(id) ON DELETE RESTRICT;

INSERT INTO dcl_subjects(id,entity,created_at,created_by) SELECT id,'supplier',created_at,created_by FROM bob_objects WHERE entity='supplier';
INSERT INTO dcl_supplier_versions(approval_entry_id,short_name,tax_number,contact_name,contact_phone,email,address,remark,settlement_method_id,settlement_method_approval_entry_id,settlement_method_code,settlement_method_name,settlement_term_code,settlement_rule_type,settlement_month_offset,settlement_day_of_month,settlement_day_offset,default_purchaser_employee_id,default_purchaser_employee_approval_entry_id,default_purchaser_employee_code,default_purchaser_employee_name,enabled)
SELECT v.approval_entry_id,v.short_name,v.tax_number,v.contact_name,v.contact_phone,v.email,v.address,v.remark,v.settlement_method_id,v.settlement_method_approval_entry_id,v.settlement_method_code,v.settlement_method_name,v.settlement_term_code,v.settlement_rule_type,v.settlement_month_offset,v.settlement_day_of_month,v.settlement_day_offset,v.default_purchaser_employee_id,v.default_purchaser_employee_approval_entry_id,employee.code,party.display_name,o.enabled
FROM bob_supplier_versions v
JOIN approval_entries e ON e.id=v.approval_entry_id AND e.domain='bob' AND e.entity='supplier'
JOIN bob_objects o ON o.id=e.subject_id
LEFT JOIN bob_objects employee ON employee.id=v.default_purchaser_employee_id AND employee.entity='employee'
LEFT JOIN bob_employment_relationships employment ON employment.object_id=employee.id AND employment.merged_into_object_id IS NULL
LEFT JOIN bob_party_currents party ON party.party_id=employment.party_id;
UPDATE approval_entries SET domain='dcl' WHERE domain='bob' AND entity='supplier';
UPDATE approval_events SET domain='dcl' WHERE domain='bob' AND entity='supplier';
-- Keep BOB query/get. Move only real Supplier declaration actions, preserving
-- existing role grants; delete every other old Supplier write permission.
UPDATE app_permissions
SET path=regexp_replace(path,'^/bob/supplier/','/dcl/supplier/'),domain='dcl',updated_at=clock_timestamp(),revision=revision+1
WHERE path ~ '^/bob/supplier/'
  AND action IN ('create','save','submit','unsubmit','reject','approve','unapprove','delete','versions','audit-history');
DELETE FROM app_role_permissions role_permission
USING app_permissions permission
WHERE role_permission.permission_id=permission.id
  AND permission.path ~ '^/bob/supplier/'
  AND permission.action NOT IN ('query','get');
DELETE FROM app_permissions
WHERE path ~ '^/bob/supplier/'
  AND action NOT IN ('query','get');
DELETE FROM bob_suppliers;
INSERT INTO bob_suppliers(object_id,source_approval_entry_id,enabled,updated_at,updated_by) SELECT e.subject_id,e.id,v.enabled,e.updated_at,e.updated_by FROM approval_entries e JOIN dcl_supplier_versions v ON v.approval_entry_id=e.id WHERE e.domain='dcl' AND e.entity='supplier' AND e.status='APPROVED' AND e.version_no=(SELECT max(x.version_no) FROM approval_entries x WHERE x.domain='dcl' AND x.entity='supplier' AND x.subject_id=e.subject_id AND x.status='APPROVED');
DROP TABLE bob_supplier_versions;
COMMIT;

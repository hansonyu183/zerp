\set ON_ERROR_STOP on
BEGIN;

-- Run while Product writes are stopped, immediately before the matching API
-- deployment. Stable objects, approval entries and audit events are retained.
LOCK TABLE bob_objects, dcl_subjects, bob_product_versions,
  bob_product_unit_conversions, bob_product_formulas, bob_product_formula_lines,
  approval_entries, approval_events, app_permissions, app_role_permissions, aux_objects, aux_version_payloads,
  acc_inventory_entries, vou_inventory_count_lines, vou_price_lines, vou_product_lines,
  vou_production_output_lines, vou_purchase_inbound_lines, vou_purchase_return_lines,
  vou_sale_outbound_lines, vou_sale_return_lines, vou_sale_signoff_lines IN ACCESS EXCLUSIVE MODE;

ALTER TABLE dcl_subjects DROP CONSTRAINT dcl_subjects_entity_check;
ALTER TABLE dcl_subjects ADD CONSTRAINT dcl_subjects_entity_check
  CHECK (entity IN ('operating-entity','warehouse','vehicle','fund-account','product'));

CREATE TABLE bob_products (
  object_id character varying(26) PRIMARY KEY REFERENCES bob_objects(id) ON DELETE RESTRICT,
  source_approval_entry_id character varying(26) NOT NULL UNIQUE REFERENCES approval_entries(id) ON DELETE RESTRICT,
  enabled boolean NOT NULL,
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_by character varying(26) NOT NULL
);
ALTER TABLE bob_product_versions ADD COLUMN enabled boolean NOT NULL DEFAULT true;
UPDATE bob_product_versions version SET enabled=object.enabled FROM bob_objects object
WHERE object.id=(SELECT subject_id FROM approval_entries entry WHERE entry.id=version.approval_entry_id);
ALTER TABLE bob_product_versions RENAME TO dcl_product_versions;

ALTER TABLE dcl_product_versions
  ADD COLUMN category_code character varying(64),
  ADD COLUMN category_name character varying(200);
UPDATE dcl_product_versions version
SET category_code=object.code,category_name=payload.data->>'name'
FROM aux_objects object
JOIN approval_entries entry ON entry.subject_id=object.id
  AND entry.domain='aux' AND entry.entity='product-category'
JOIN aux_version_payloads payload ON payload.approval_entry_id=entry.id
WHERE version.category_id=object.id AND version.category_approval_entry_id=entry.id;

ALTER TABLE bob_product_unit_conversions RENAME TO dcl_product_unit_conversions;
ALTER TABLE bob_product_formulas RENAME TO dcl_product_formulas;
ALTER TABLE bob_product_formula_lines RENAME TO dcl_product_formula_lines;
ALTER TABLE dcl_product_formula_lines
  RENAME CONSTRAINT bob_formula_lines_product_entry_material_object_key
  TO dcl_product_formula_lines_product_entry_material_object_key;
CREATE TABLE dcl_product_barcode_claims (
  normalized_barcode character varying(64) PRIMARY KEY,
  object_id character varying(26) NOT NULL REFERENCES bob_objects(id) ON DELETE CASCADE,
  approved_entry_id character varying(26) REFERENCES approval_entries(id) ON DELETE RESTRICT,
  open_entry_id character varying(26) REFERENCES approval_entries(id) ON DELETE RESTRICT,
  CONSTRAINT dcl_product_barcode_claims_source_ck CHECK (approved_entry_id IS NOT NULL OR open_entry_id IS NOT NULL)
);
INSERT INTO dcl_subjects(id,entity,created_at,created_by)
SELECT id,entity,created_at,created_by FROM bob_objects WHERE entity='product';
INSERT INTO bob_products(object_id,source_approval_entry_id,enabled,updated_at,updated_by)
SELECT object.id,entry.id,object.enabled,object.updated_at,object.updated_by
FROM bob_objects object JOIN LATERAL (
  SELECT id FROM approval_entries WHERE domain='bob' AND entity='product'
    AND subject_id=object.id AND status='APPROVED' ORDER BY version_no DESC LIMIT 1
) entry ON true WHERE object.entity='product';

UPDATE approval_entries SET domain='dcl' WHERE domain='bob' AND entity='product';
UPDATE approval_events SET domain='dcl' WHERE domain='bob' AND entity='product';

ALTER TABLE acc_inventory_entries
  ADD COLUMN product_approval_entry_id character varying(26),
  ADD COLUMN product_code character varying(64),
  ADD COLUMN product_name character varying(200);
WITH product_facts AS (
  SELECT id::text AS source_line_id,product_object_id,product_approval_entry_id,product_code,product_name FROM vou_inventory_count_lines
  UNION ALL SELECT id::text,product_object_id,product_approval_entry_id,product_code,product_name FROM vou_price_lines
  UNION ALL SELECT id::text,product_object_id,product_approval_entry_id,product_code,product_name FROM vou_product_lines
  UNION ALL SELECT id::text,product_object_id,product_approval_entry_id,product_code,product_name FROM vou_production_output_lines
  UNION ALL SELECT id::text,product_object_id,product_approval_entry_id,product_code,product_name FROM vou_purchase_inbound_lines
  UNION ALL SELECT id::text,product_object_id,product_approval_entry_id,product_code,product_name FROM vou_purchase_return_lines
  UNION ALL SELECT id::text,product_object_id,product_approval_entry_id,product_code,product_name FROM vou_sale_outbound_lines
  UNION ALL SELECT id::text,product_object_id,product_approval_entry_id,product_code,product_name FROM vou_sale_return_lines
  UNION ALL SELECT id::text,product_object_id,product_approval_entry_id,product_code,product_name FROM vou_sale_signoff_lines
)
UPDATE acc_inventory_entries inventory
SET product_approval_entry_id=fact.product_approval_entry_id,
    product_code=fact.product_code,product_name=fact.product_name
FROM product_facts fact
WHERE inventory.source_line_id=fact.source_line_id
  AND inventory.product_id=fact.product_object_id;
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM acc_inventory_entries WHERE product_approval_entry_id IS NULL) THEN
    RAISE EXCEPTION 'issue #282 cannot prove the product snapshot for every historical ACC inventory entry';
  END IF;
END $$;
ALTER TABLE acc_inventory_entries
  ALTER COLUMN product_approval_entry_id SET NOT NULL,
  ALTER COLUMN product_code SET NOT NULL,
  ALTER COLUMN product_name SET NOT NULL;

WITH selected AS (
  SELECT entry.id,entry.subject_id,entry.status
  FROM approval_entries entry
  WHERE entry.domain='dcl' AND entry.entity='product' AND entry.status='APPROVED'
    AND NOT EXISTS (
      SELECT 1 FROM approval_entries newer
      WHERE newer.domain='dcl' AND newer.entity='product' AND newer.subject_id=entry.subject_id
        AND newer.status='APPROVED' AND newer.version_no>entry.version_no
    )
  UNION ALL
  SELECT entry.id,entry.subject_id,entry.status
  FROM approval_entries entry
  WHERE entry.domain='dcl' AND entry.entity='product' AND entry.status IN ('DRAFT','PENDING')
), desired AS (
  SELECT upper(btrim(version.barcode)) AS normalized_barcode,selected.subject_id AS object_id,
    selected.id,selected.status
  FROM selected JOIN dcl_product_versions version ON version.approval_entry_id=selected.id
  WHERE version.barcode IS NOT NULL AND upper(btrim(version.barcode))<>''
)
INSERT INTO dcl_product_barcode_claims(normalized_barcode,object_id,approved_entry_id,open_entry_id)
SELECT normalized_barcode,object_id,
  max(id) FILTER (WHERE status='APPROVED'),
  max(id) FILTER (WHERE status IN ('DRAFT','PENDING'))
FROM desired GROUP BY normalized_barcode,object_id;

-- BOB get/query retain their existing grants. Product's former lifecycle and
-- enable/disable grants become DCL lifecycle/read grants.
UPDATE app_permissions SET path='/dcl/product/'||action,domain='dcl',updated_at=clock_timestamp(),revision=revision+1
WHERE id IN ('01JBOB00000000000000000031','01JBOB00000000000000000032','01JBOB00000000000000000033','01JBOB00000000000000000037','01JBOB00000000000000000038','01JBOB00000000000000000039','01JBOB00000000000000000040','01JBOB00000000000000000084','01JBOB00000000000000000145','01JBOB00000000000000000146');
INSERT INTO app_permissions(id,path,domain,entity,action,description,status)
VALUES
  ('01JDCL28200000000000000001','/dcl/product/get','dcl','product','get','查看产品声明','ENABLED'),
  ('01JDCL28200000000000000002','/dcl/product/query','dcl','product','query','查询产品声明','ENABLED');
INSERT INTO app_role_permissions(role_id,permission_id,created_at,created_by)
SELECT role_id,'01JDCL28200000000000000001',created_at,created_by FROM app_role_permissions
WHERE permission_id='01JBOB00000000000000000035'
ON CONFLICT DO NOTHING;
INSERT INTO app_role_permissions(role_id,permission_id,created_at,created_by)
SELECT role_id,'01JDCL28200000000000000002',created_at,created_by FROM app_role_permissions
WHERE permission_id='01JBOB00000000000000000036'
ON CONFLICT DO NOTHING;
DELETE FROM app_role_permissions WHERE permission_id IN ('01JBOB00000000000000000147','01JBOB00000000000000000148');
DELETE FROM app_permissions WHERE id IN ('01JBOB00000000000000000147','01JBOB00000000000000000148');

DO $$ BEGIN
  IF (SELECT count(*) FROM bob_objects WHERE entity='product')<>(SELECT count(*) FROM dcl_subjects WHERE entity='product')
    OR (SELECT count(DISTINCT subject_id) FROM approval_entries WHERE domain='dcl' AND entity='product' AND status='APPROVED')<>(SELECT count(*) FROM bob_products) THEN
      RAISE EXCEPTION 'issue #282 product cutover count mismatch';
  END IF;
  IF EXISTS(SELECT 1 FROM approval_entries WHERE domain='bob' AND entity='product') OR EXISTS(SELECT 1 FROM approval_events WHERE domain='bob' AND entity='product') THEN
      RAISE EXCEPTION 'issue #282 left BOB Product approval data';
  END IF;
  IF EXISTS(SELECT 1 FROM dcl_product_versions WHERE category_id IS NOT NULL AND (category_code IS NULL OR category_name IS NULL))
    OR EXISTS(SELECT 1 FROM acc_inventory_entries WHERE product_approval_entry_id IS NULL OR product_code IS NULL OR product_name IS NULL) THEN
      RAISE EXCEPTION 'issue #282 product snapshot backfill mismatch';
  END IF;
  IF (WITH selected AS (
        SELECT id,subject_id,status FROM approval_entries entry WHERE domain='dcl' AND entity='product' AND status='APPROVED'
          AND NOT EXISTS (SELECT 1 FROM approval_entries newer WHERE newer.domain='dcl' AND newer.entity='product' AND newer.subject_id=entry.subject_id AND newer.status='APPROVED' AND newer.version_no>entry.version_no)
        UNION ALL SELECT id,subject_id,status FROM approval_entries WHERE domain='dcl' AND entity='product' AND status IN ('DRAFT','PENDING')
      ) SELECT count(*) FROM (SELECT upper(btrim(v.barcode)),s.subject_id FROM selected s JOIN dcl_product_versions v ON v.approval_entry_id=s.id WHERE v.barcode IS NOT NULL AND upper(btrim(v.barcode))<>'' GROUP BY upper(btrim(v.barcode)),s.subject_id) expected)
     <> (SELECT count(*) FROM dcl_product_barcode_claims) THEN
      RAISE EXCEPTION 'issue #282 product barcode claim mismatch';
  END IF;
END $$;

COMMIT;

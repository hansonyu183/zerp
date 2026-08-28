BEGIN;

-- Issue #290 is destructive: it retires AUX approval payloads. Refuse to run
-- until issue #289 has frozen every saved DCL/VOU business snapshot.
DO $$
DECLARE missing_columns integer;
DECLARE missing_constraints integer;
BEGIN
  SELECT count(*) INTO missing_columns
  FROM (VALUES
    ('dcl_product_unit_conversions','unit_quantity_scale'),
    ('dcl_product_formulas','output_unit_quantity_scale'),
    ('dcl_product_formula_lines','entered_unit_quantity_scale'),
    ('vou_asset_acquisition_lines','category_default_useful_life_months'),
    ('vou_asset_acquisition_lines','category_default_residual_rate_bps')
  ) expected(table_name,column_name)
  LEFT JOIN information_schema.columns actual
    ON actual.table_schema='public'
   AND actual.table_name=expected.table_name
   AND actual.column_name=expected.column_name
   AND actual.is_nullable='NO'
  WHERE actual.column_name IS NULL;

  SELECT count(*) INTO missing_constraints
  FROM (VALUES
    ('dcl_product_unit_conversions_quantity_scale_check'),
    ('dcl_product_formulas_quantity_scale_check'),
    ('dcl_product_formula_lines_quantity_scale_check'),
    ('vou_asset_acquisition_lines_category_default_useful_life_months'),
    ('vou_asset_acquisition_lines_category_default_residual_rate_bps_')
  ) expected(constraint_name)
  LEFT JOIN pg_constraint actual
    ON actual.conname=expected.constraint_name
   AND actual.conrelid<>0
  WHERE actual.oid IS NULL;

  IF missing_columns<>0 OR missing_constraints<>0 THEN
    RAISE EXCEPTION 'issue-290: issue-289 snapshot cutover is required first';
  END IF;
END $$;

-- AUX current data is the latest approved payload. Draft-only/pending-only
-- objects deliberately have no current representation after this cutover.
ALTER TABLE aux_objects ADD COLUMN IF NOT EXISTS data jsonb;
UPDATE aux_objects object
SET data=payload.data
FROM approval_entries entry
JOIN aux_version_payloads payload ON payload.approval_entry_id=entry.id
WHERE entry.domain='aux' AND entry.entity=object.entity AND entry.subject_id=object.id
  AND entry.status='APPROVED'
  AND NOT EXISTS (
    SELECT 1 FROM approval_entries newer
    WHERE newer.domain='aux' AND newer.entity=entry.entity AND newer.subject_id=entry.subject_id
      AND newer.status='APPROVED' AND newer.version_no>entry.version_no
  );

DO $$
DECLARE reference record;
DECLARE broken_count bigint;
BEGIN
  IF EXISTS (
    SELECT 1
    FROM approval_entries entry
    LEFT JOIN aux_version_payloads payload ON payload.approval_entry_id=entry.id
    WHERE entry.domain='aux' AND entry.status='APPROVED'
      AND (
        payload.approval_entry_id IS NULL
        OR payload.object_id<>entry.subject_id
        OR payload.entity<>entry.entity
        OR NOT EXISTS (
          SELECT 1 FROM aux_objects object
          WHERE object.id=entry.subject_id AND object.entity=entry.entity
        )
      )
  ) THEN
    RAISE EXCEPTION 'issue-290: unresolved or mismatched approved AUX payload';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM aux_version_payloads payload
    LEFT JOIN approval_entries entry ON entry.id=payload.approval_entry_id
    WHERE entry.id IS NULL OR entry.domain<>'aux'
      OR entry.subject_id<>payload.object_id OR entry.entity<>payload.entity
  ) THEN
    RAISE EXCEPTION 'issue-290: orphan or mismatched AUX version payload';
  END IF;

  FOR reference IN
    SELECT * FROM (VALUES
      ('dcl_employee_versions','employee_category_id','employee_category_approval_entry_id','employee-category'),
      ('dcl_employee_versions','department_id','department_approval_entry_id','department'),
      ('dcl_employee_versions','position_id','position_approval_entry_id','position'),
      ('dcl_product_versions','category_id','category_approval_entry_id','product-category'),
      ('dcl_product_versions','pricing_unit_id','pricing_unit_approval_entry_id','measurement-unit'),
      ('dcl_product_versions','product_type_id','product_type_approval_entry_id','product-type'),
      ('dcl_product_versions','default_input_unit_id','default_input_unit_approval_entry_id','measurement-unit'),
      ('dcl_product_formulas','output_unit_object_id','output_unit_approval_entry_id','measurement-unit'),
      ('dcl_product_formula_lines','entered_unit_object_id','entered_unit_approval_entry_id','measurement-unit'),
      ('dcl_product_unit_conversions','unit_object_id','unit_approval_entry_id','measurement-unit'),
      ('dcl_supplier_versions','settlement_method_id','settlement_method_approval_entry_id','settlement-method'),
      ('dcl_other_unit_versions','settlement_method_id','settlement_method_approval_entry_id','settlement-method'),
      ('dcl_customer_account_versions','settlement_method_id','settlement_method_approval_entry_id','settlement-method'),
      ('dcl_customer_account_versions','payment_method_id','payment_method_approval_entry_id','payment-method'),
      ('dcl_vehicle_versions','vehicle_type_object_id','vehicle_type_approval_entry_id','dictionary-item'),
      ('dcl_warehouse_versions','category_id','category_approval_entry_id','dictionary-item'),
      ('dcl_customer_attachments','category_object_id','category_approval_entry_id','dictionary-item'),
      ('dcl_customer_account_attachments','category_object_id','category_approval_entry_id','dictionary-item'),
      ('bob_warehouses','category_id','category_approval_entry_id','dictionary-item'),
      ('bob_vehicles','vehicle_type_object_id','vehicle_type_approval_entry_id','dictionary-item'),
      ('vou_asset_acquisition_lines','category_object_id','category_approval_entry_id','asset-category'),
      ('vou_asset_acquisition_lines','department_object_id','department_approval_entry_id','department'),
      ('vou_inventory_count_lines','entered_unit_object_id','entered_unit_approval_entry_id','measurement-unit'),
      ('vou_price_lines','product_type_object_id','product_type_approval_entry_id','product-type'),
      ('vou_product_lines','entered_unit_object_id','entered_unit_approval_entry_id','measurement-unit'),
      ('vou_product_lines','product_type_object_id','product_type_approval_entry_id','product-type'),
      ('vou_production_material_lines','actual_entered_unit_object_id','actual_entered_unit_approval_entry_id','measurement-unit'),
      ('vou_production_output_lines','entered_unit_object_id','entered_unit_approval_entry_id','measurement-unit'),
      ('vou_purchase_order_details','settlement_method_object_id','settlement_method_approval_entry_id','settlement-method'),
      ('vou_sale_order_details','settlement_method_object_id','settlement_method_approval_entry_id','settlement-method'),
      ('vou_sale_order_formula_lines','entered_unit_object_id','entered_unit_approval_entry_id','measurement-unit'),
      ('vou_sale_order_formulas','output_entered_unit_object_id','output_entered_unit_approval_entry_id','measurement-unit'),
      ('vou_service_contract_details','settlement_method_object_id','settlement_method_approval_entry_id','settlement-method')
    ) AS aux_references(table_name,object_column,entry_column,expected_entity)
  LOOP
    EXECUTE format(
      'SELECT count(*) FROM %I source LEFT JOIN approval_entries entry ON entry.id=source.%I LEFT JOIN aux_version_payloads payload ON payload.approval_entry_id=source.%I LEFT JOIN aux_objects object ON object.id=source.%I WHERE (source.%I IS NULL)<>(source.%I IS NULL) OR (source.%I IS NOT NULL AND (entry.id IS NULL OR entry.domain<>''aux'' OR entry.status<>''APPROVED'' OR entry.subject_id<>source.%I OR entry.entity<>%L OR payload.approval_entry_id IS NULL OR payload.object_id<>source.%I OR payload.entity<>%L OR object.id IS NULL OR object.entity<>%L OR object.data IS NULL))',
      reference.table_name,reference.entry_column,reference.entry_column,
      reference.object_column,reference.object_column,reference.entry_column,
      reference.object_column,reference.object_column,reference.expected_entity,
      reference.object_column,reference.expected_entity,reference.expected_entity
    ) INTO broken_count;
    IF broken_count>0 THEN
      RAISE EXCEPTION 'issue-290: % unresolved or mismatched AUX references in %.%',broken_count,reference.table_name,reference.object_column;
    END IF;
  END LOOP;
END $$;

-- Dictionary items own their dictionary type by stable AUX identity. Keep the
-- code and name as immutable display snapshots for filtering and read models.
UPDATE aux_objects item
SET data=item.data || jsonb_build_object(
  'dictionaryTypeId',type_object.id,
  'dictionaryTypeCode',type_object.code,
  'dictionaryTypeName',type_object.data->>'name'
)
FROM aux_objects type_object
WHERE item.entity='dictionary-item'
  AND type_object.entity='dictionary-type'
  AND type_object.code=item.data->>'dictionaryTypeCode';
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM aux_objects item
    LEFT JOIN aux_objects type_object
      ON type_object.id=item.data->>'dictionaryTypeId'
     AND type_object.entity='dictionary-type'
    WHERE item.entity='dictionary-item'
      AND (
        type_object.id IS NULL
        OR item.data->>'dictionaryTypeCode'<>type_object.code
        OR item.data->>'dictionaryTypeName'<>type_object.data->>'name'
      )
  ) THEN
    RAISE EXCEPTION 'issue-290: unresolved dictionary type AUX identity';
  END IF;
END $$;

-- Customer Account previously persisted the dictionary item display code.
-- Replace it with the stable AUX object identity before the old AUX lifecycle
-- rows are removed; an unmapped value aborts the whole transaction.
ALTER TABLE dcl_customer_account_versions
  ALTER COLUMN customer_type TYPE varchar(26);
ALTER TABLE dcl_customer_account_versions
  ADD COLUMN IF NOT EXISTS customer_type_code varchar(32),
  ADD COLUMN IF NOT EXISTS customer_type_name varchar(200);
UPDATE dcl_customer_account_versions version
SET customer_type=type_item.id,
    customer_type_code=type_item.code,
    customer_type_name=type_item.data->>'name'
FROM aux_objects type_item
WHERE type_item.entity='dictionary-item'
  AND type_item.code=version.customer_type
  AND type_item.data->>'dictionaryTypeCode'='DCT-0001';
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM dcl_customer_account_versions version
    LEFT JOIN aux_objects type_item
      ON type_item.id=version.customer_type
     AND type_item.entity='dictionary-item'
    WHERE type_item.id IS NULL
       OR type_item.data->>'dictionaryTypeCode'<>'DCT-0001'
       OR version.customer_type_code<>type_item.code
       OR version.customer_type_name<>type_item.data->>'name'
  ) THEN
    RAISE EXCEPTION 'issue-290: unresolved customer type AUX identity';
  END IF;
END $$;
ALTER TABLE dcl_customer_account_versions
  ALTER COLUMN customer_type_code SET NOT NULL,
  ALTER COLUMN customer_type_name SET NOT NULL;

-- Version payloads have finished serving both migration and identity checks.
-- Removing them first releases their FK so candidate-only AUX objects can be
-- removed without retaining a compatibility row.
DELETE FROM aux_version_payloads;
DELETE FROM aux_objects WHERE data IS NULL;
ALTER TABLE aux_objects ALTER COLUMN data SET NOT NULL;
ALTER TABLE aux_objects DROP CONSTRAINT IF EXISTS aux_objects_data_object_check;
ALTER TABLE aux_objects ADD CONSTRAINT aux_objects_data_object_check CHECK (jsonb_typeof(data)='object');

-- The listed columns are all AUX snapshot entry IDs. Their stable object ID
-- and typed value columns remain; no dual identity is retained.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT table_schema,table_name,column_name
    FROM information_schema.columns
    WHERE table_schema='public'
      AND (table_name,column_name) IN (
        ('dcl_employee_versions','employee_category_approval_entry_id'),('dcl_employee_versions','department_approval_entry_id'),('dcl_employee_versions','position_approval_entry_id'),
        ('dcl_product_versions','category_approval_entry_id'),('dcl_product_versions','pricing_unit_approval_entry_id'),('dcl_product_versions','product_type_approval_entry_id'),('dcl_product_versions','default_input_unit_approval_entry_id'),
        ('dcl_product_formulas','output_unit_approval_entry_id'),('dcl_product_formula_lines','entered_unit_approval_entry_id'),('dcl_product_unit_conversions','unit_approval_entry_id'),
        ('dcl_supplier_versions','settlement_method_approval_entry_id'),('dcl_other_unit_versions','settlement_method_approval_entry_id'),
        ('dcl_customer_account_versions','settlement_method_approval_entry_id'),('dcl_customer_account_versions','payment_method_approval_entry_id'),
        ('dcl_vehicle_versions','vehicle_type_approval_entry_id'),('dcl_warehouse_versions','category_approval_entry_id'),
        ('dcl_customer_attachments','category_approval_entry_id'),('dcl_customer_account_attachments','category_approval_entry_id'),
        ('bob_warehouses','category_approval_entry_id'),('bob_vehicles','vehicle_type_approval_entry_id'),
        ('vou_asset_acquisition_lines','category_approval_entry_id'),('vou_asset_acquisition_lines','department_approval_entry_id'),
        ('vou_inventory_count_lines','entered_unit_approval_entry_id'),('vou_price_lines','product_type_approval_entry_id'),
        ('vou_product_lines','entered_unit_approval_entry_id'),('vou_product_lines','product_type_approval_entry_id'),
        ('vou_production_material_lines','actual_entered_unit_approval_entry_id'),('vou_production_output_lines','entered_unit_approval_entry_id'),
        ('vou_purchase_order_details','settlement_method_approval_entry_id'),('vou_sale_order_details','settlement_method_approval_entry_id'),
        ('vou_sale_order_formula_lines','entered_unit_approval_entry_id'),('vou_sale_order_formulas','output_entered_unit_approval_entry_id'),('vou_service_contract_details','settlement_method_approval_entry_id')
      )
  LOOP
    EXECUTE format('ALTER TABLE %I.%I DROP COLUMN %I CASCADE',r.table_schema,r.table_name,r.column_name);
  END LOOP;
END $$;

DELETE FROM app_role_permissions grant_row
USING app_permissions permission
WHERE grant_row.permission_id=permission.id
  AND permission.domain='aux'
  AND permission.action IN (
    'submit','unsubmit','approve','reject','unapprove','versions','audit-history'
  );
DELETE FROM app_permissions
WHERE domain='aux'
  AND action IN (
    'submit','unsubmit','approve','reject','unapprove','versions','audit-history'
  );

DELETE FROM approval_events WHERE entry_id IN (SELECT id FROM approval_entries WHERE domain='aux');
DELETE FROM approval_entries WHERE domain='aux';
DROP TABLE aux_version_payloads;

COMMIT;

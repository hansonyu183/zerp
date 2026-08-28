\set ON_ERROR_STOP on
BEGIN;

-- Run with DCL Product and VOU asset-acquisition writes stopped immediately
-- before the matching API. Existing snapshots are completed from their exact
-- stored AUX entry;
-- no row is interpreted from current/latest AUX state.
LOCK TABLE dcl_product_unit_conversions, dcl_product_formulas,
  dcl_product_formula_lines, vou_asset_acquisition_lines,
  aux_version_payloads IN ACCESS EXCLUSIVE MODE;

ALTER TABLE dcl_product_unit_conversions ADD COLUMN unit_quantity_scale integer;
ALTER TABLE dcl_product_formulas ADD COLUMN output_unit_quantity_scale integer;
ALTER TABLE dcl_product_formula_lines ADD COLUMN entered_unit_quantity_scale integer;
ALTER TABLE vou_asset_acquisition_lines
  ADD COLUMN category_default_useful_life_months integer,
  ADD COLUMN category_default_residual_rate_bps integer;

UPDATE dcl_product_unit_conversions snapshot
SET unit_quantity_scale=(payload.data->>'quantityScale')::integer
FROM aux_version_payloads payload
WHERE payload.approval_entry_id=snapshot.unit_approval_entry_id
  AND payload.entity='measurement-unit';

UPDATE dcl_product_formulas snapshot
SET output_unit_quantity_scale=(payload.data->>'quantityScale')::integer
FROM aux_version_payloads payload
WHERE payload.approval_entry_id=snapshot.output_unit_approval_entry_id
  AND payload.entity='measurement-unit';

UPDATE dcl_product_formula_lines snapshot
SET entered_unit_quantity_scale=(payload.data->>'quantityScale')::integer
FROM aux_version_payloads payload
WHERE payload.approval_entry_id=snapshot.entered_unit_approval_entry_id
  AND payload.entity='measurement-unit';

UPDATE vou_asset_acquisition_lines snapshot
SET category_default_useful_life_months=(payload.data->>'defaultUsefulLifeMonths')::integer,
    category_default_residual_rate_bps=((payload.data->>'defaultResidualRate')::numeric * 100)::integer
FROM aux_version_payloads payload
WHERE payload.approval_entry_id=snapshot.category_approval_entry_id
  AND payload.entity='asset-category';

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM dcl_product_unit_conversions WHERE unit_quantity_scale IS NULL OR unit_quantity_scale NOT BETWEEN 0 AND 6
  ) OR EXISTS (
    SELECT 1 FROM dcl_product_formulas WHERE output_unit_quantity_scale IS NULL OR output_unit_quantity_scale NOT BETWEEN 0 AND 6
  ) OR EXISTS (
    SELECT 1 FROM dcl_product_formula_lines WHERE entered_unit_quantity_scale IS NULL OR entered_unit_quantity_scale NOT BETWEEN 0 AND 6
  ) OR EXISTS (
    SELECT 1 FROM vou_asset_acquisition_lines
    WHERE category_default_useful_life_months IS NULL
       OR category_default_useful_life_months NOT BETWEEN 1 AND 1200
       OR category_default_residual_rate_bps IS NULL
       OR category_default_residual_rate_bps NOT BETWEEN 0 AND 9999
  ) THEN
    RAISE EXCEPTION 'issue #289 cannot prove every required AUX snapshot';
  END IF;
END $$;

ALTER TABLE dcl_product_unit_conversions
  ALTER COLUMN unit_quantity_scale SET NOT NULL,
  ADD CONSTRAINT dcl_product_unit_conversions_quantity_scale_check
    CHECK (unit_quantity_scale BETWEEN 0 AND 6);
ALTER TABLE dcl_product_formulas
  ALTER COLUMN output_unit_quantity_scale SET NOT NULL,
  ADD CONSTRAINT dcl_product_formulas_quantity_scale_check
    CHECK (output_unit_quantity_scale BETWEEN 0 AND 6);
ALTER TABLE dcl_product_formula_lines
  ALTER COLUMN entered_unit_quantity_scale SET NOT NULL,
  ADD CONSTRAINT dcl_product_formula_lines_quantity_scale_check
    CHECK (entered_unit_quantity_scale BETWEEN 0 AND 6);
ALTER TABLE vou_asset_acquisition_lines
  ALTER COLUMN category_default_useful_life_months SET NOT NULL,
  ALTER COLUMN category_default_residual_rate_bps SET NOT NULL,
  ADD CONSTRAINT vou_asset_acquisition_lines_category_default_useful_life_months_check
    CHECK (category_default_useful_life_months BETWEEN 1 AND 1200),
  ADD CONSTRAINT vou_asset_acquisition_lines_category_default_residual_rate_bps_check
    CHECK (category_default_residual_rate_bps BETWEEN 0 AND 9999);

COMMIT;

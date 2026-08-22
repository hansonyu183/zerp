-- +goose Up

ALTER TABLE vou_product_lines
    RENAME COLUMN ordered_qty_micros TO base_quantity_micros;
ALTER TABLE vou_product_lines
    RENAME COLUMN product_unit TO entered_unit_symbol;
ALTER TABLE vou_product_lines
    RENAME COLUMN product_kind TO behavior_profile;
ALTER TABLE vou_product_lines RENAME COLUMN outbound_qty_micros TO outbound_base_quantity_micros;
ALTER TABLE vou_product_lines RENAME COLUMN signed_qty_micros TO signed_base_quantity_micros;
ALTER TABLE vou_product_lines RENAME COLUMN rejected_qty_micros TO rejected_base_quantity_micros;
ALTER TABLE vou_product_lines RENAME COLUMN loss_qty_micros TO loss_base_quantity_micros;
ALTER TABLE vou_product_lines RENAME COLUMN inbound_qty_micros TO inbound_base_quantity_micros;
ALTER TABLE vou_product_lines
    ADD COLUMN entered_quantity_micros bigint,
    ADD COLUMN entered_unit_object_id varchar(26),
    ADD COLUMN entered_unit_version_id varchar(26),
    ADD COLUMN entered_unit_code varchar(64),
    ADD COLUMN entered_unit_name varchar(200),
    ADD COLUMN product_type_object_id varchar(26),
    ADD COLUMN product_type_version_id varchar(26),
    ADD COLUMN product_type_code varchar(64),
    ADD COLUMN product_type_name varchar(200),
    ADD COLUMN default_packaging_spec_micros bigint;

UPDATE vou_product_lines line
SET entered_quantity_micros = line.base_quantity_micros,
    entered_unit_object_id = conversion.unit_object_id,
    entered_unit_version_id = conversion.unit_version_id,
    entered_unit_code = conversion.unit_code,
    entered_unit_name = conversion.unit_name,
    entered_unit_symbol = conversion.unit_symbol,
    product_type_object_id = product.product_type_id,
    product_type_version_id = product.product_type_version_id,
    product_type_code = product.product_type_code,
    product_type_name = product.product_type_name,
    behavior_profile = product.behavior_profile,
    default_packaging_spec_micros = product.default_packaging_spec_micros
FROM bob_product_versions product
JOIN bob_product_unit_conversions conversion
  ON conversion.product_version_id = product.version_id
 AND conversion.unit_object_id = product.default_input_unit_id
WHERE product.version_id = line.product_version_id;

ALTER TABLE vou_product_lines
    ALTER COLUMN entered_quantity_micros SET NOT NULL,
    ALTER COLUMN entered_unit_object_id SET NOT NULL,
    ALTER COLUMN entered_unit_version_id SET NOT NULL,
    ALTER COLUMN entered_unit_code SET NOT NULL,
    ALTER COLUMN entered_unit_name SET NOT NULL,
    ALTER COLUMN product_type_object_id SET NOT NULL,
    ALTER COLUMN product_type_version_id SET NOT NULL,
    ALTER COLUMN product_type_code SET NOT NULL,
    ALTER COLUMN product_type_name SET NOT NULL,
    DROP COLUMN pricing_quantity_per_inventory_unit_micros;

ALTER TABLE vou_price_lines
    RENAME COLUMN product_unit TO default_input_unit_symbol;
ALTER TABLE vou_price_lines
    RENAME COLUMN product_kind TO behavior_profile;
ALTER TABLE vou_price_lines
    ADD COLUMN product_type_object_id varchar(26),
    ADD COLUMN product_type_version_id varchar(26),
    ADD COLUMN product_type_code varchar(64),
    ADD COLUMN product_type_name varchar(200);

UPDATE vou_price_lines line
SET default_input_unit_symbol = conversion.unit_symbol,
    product_type_object_id = product.product_type_id,
    product_type_version_id = product.product_type_version_id,
    product_type_code = product.product_type_code,
    product_type_name = product.product_type_name,
    behavior_profile = product.behavior_profile
FROM bob_product_versions product
JOIN bob_product_unit_conversions conversion
  ON conversion.product_version_id = product.version_id
 AND conversion.unit_object_id = product.default_input_unit_id
WHERE product.version_id = line.product_version_id;

ALTER TABLE vou_price_lines
    ALTER COLUMN product_type_object_id SET NOT NULL,
    ALTER COLUMN product_type_version_id SET NOT NULL,
    ALTER COLUMN product_type_code SET NOT NULL,
    ALTER COLUMN product_type_name SET NOT NULL,
    DROP COLUMN pricing_quantity_per_inventory_unit_micros;

ALTER TABLE vou_inventory_count_lines
    RENAME COLUMN product_unit TO entered_unit_symbol;
ALTER TABLE vou_inventory_count_lines
    RENAME COLUMN actual_quantity_micros TO actual_base_quantity_micros;
ALTER TABLE vou_inventory_count_lines
    RENAME COLUMN book_quantity_micros TO book_base_quantity_micros;
ALTER TABLE vou_inventory_count_lines
    RENAME COLUMN difference_quantity_micros TO difference_base_quantity_micros;
ALTER TABLE vou_inventory_count_lines
    ADD COLUMN entered_quantity_micros bigint,
    ADD COLUMN entered_unit_object_id varchar(26),
    ADD COLUMN entered_unit_version_id varchar(26),
    ADD COLUMN entered_unit_code varchar(64),
    ADD COLUMN entered_unit_name varchar(200);

UPDATE vou_inventory_count_lines line
SET entered_quantity_micros = line.actual_base_quantity_micros,
    entered_unit_object_id = conversion.unit_object_id,
    entered_unit_version_id = conversion.unit_version_id,
    entered_unit_code = conversion.unit_code,
    entered_unit_name = conversion.unit_name,
    entered_unit_symbol = conversion.unit_symbol
FROM bob_product_versions product
JOIN bob_product_unit_conversions conversion
  ON conversion.product_version_id = product.version_id
 AND conversion.unit_object_id = product.default_input_unit_id
WHERE product.version_id = line.product_version_id;

ALTER TABLE vou_inventory_count_lines
    ALTER COLUMN entered_quantity_micros SET NOT NULL,
    ALTER COLUMN entered_unit_object_id SET NOT NULL,
    ALTER COLUMN entered_unit_version_id SET NOT NULL,
    ALTER COLUMN entered_unit_code SET NOT NULL,
    ALTER COLUMN entered_unit_name SET NOT NULL;

ALTER TABLE vou_production_output_lines
    RENAME COLUMN product_unit TO entered_unit_symbol;
ALTER TABLE vou_production_output_lines
    RENAME COLUMN product_kind TO behavior_profile;
ALTER TABLE vou_production_output_lines
    RENAME COLUMN output_quantity_micros TO base_quantity_micros;
ALTER TABLE vou_production_output_lines
    RENAME COLUMN formula_base_output_quantity_micros TO formula_base_quantity_micros;
ALTER TABLE vou_production_output_lines
    ADD COLUMN entered_quantity_micros bigint,
    ADD COLUMN entered_unit_object_id varchar(26),
    ADD COLUMN entered_unit_version_id varchar(26),
    ADD COLUMN entered_unit_code varchar(64),
    ADD COLUMN entered_unit_name varchar(200);

UPDATE vou_production_output_lines line
SET entered_quantity_micros = line.base_quantity_micros,
    entered_unit_object_id = conversion.unit_object_id,
    entered_unit_version_id = conversion.unit_version_id,
    entered_unit_code = conversion.unit_code,
    entered_unit_name = conversion.unit_name,
    entered_unit_symbol = conversion.unit_symbol
FROM bob_product_versions product
JOIN bob_product_unit_conversions conversion
  ON conversion.product_version_id = product.version_id
 AND conversion.unit_object_id = product.default_input_unit_id
WHERE product.version_id = line.product_version_id;

ALTER TABLE vou_production_output_lines
    ALTER COLUMN entered_quantity_micros SET NOT NULL,
    ALTER COLUMN entered_unit_object_id SET NOT NULL,
    ALTER COLUMN entered_unit_version_id SET NOT NULL,
    ALTER COLUMN entered_unit_code SET NOT NULL,
    ALTER COLUMN entered_unit_name SET NOT NULL;

ALTER TABLE vou_production_material_lines
    RENAME COLUMN formula_quantity_micros TO formula_base_quantity_micros;
ALTER TABLE vou_production_material_lines
    RENAME COLUMN formula_material_unit TO formula_entered_unit_symbol;
ALTER TABLE vou_production_material_lines
    RENAME COLUMN suggested_quantity_micros TO suggested_base_quantity_micros;
ALTER TABLE vou_production_material_lines
    RENAME COLUMN actual_material_unit TO actual_entered_unit_symbol;
ALTER TABLE vou_production_material_lines
    RENAME COLUMN actual_quantity_micros TO actual_base_quantity_micros;
ALTER TABLE vou_production_material_lines
    ADD COLUMN actual_entered_quantity_micros bigint,
    ADD COLUMN actual_entered_unit_object_id varchar(26),
    ADD COLUMN actual_entered_unit_version_id varchar(26),
    ADD COLUMN actual_entered_unit_code varchar(64),
    ADD COLUMN actual_entered_unit_name varchar(200);

UPDATE vou_production_material_lines line
SET actual_entered_quantity_micros = line.actual_base_quantity_micros,
    actual_entered_unit_object_id = conversion.unit_object_id,
    actual_entered_unit_version_id = conversion.unit_version_id,
    actual_entered_unit_code = conversion.unit_code,
    actual_entered_unit_name = conversion.unit_name,
    actual_entered_unit_symbol = conversion.unit_symbol
FROM bob_product_versions product
JOIN bob_product_unit_conversions conversion
  ON conversion.product_version_id = product.version_id
 AND conversion.unit_object_id = product.default_input_unit_id
WHERE product.version_id = line.actual_material_version_id;

ALTER TABLE vou_production_material_lines
    ALTER COLUMN actual_entered_quantity_micros SET NOT NULL,
    ALTER COLUMN actual_entered_unit_object_id SET NOT NULL,
    ALTER COLUMN actual_entered_unit_version_id SET NOT NULL,
    ALTER COLUMN actual_entered_unit_code SET NOT NULL,
    ALTER COLUMN actual_entered_unit_name SET NOT NULL;

ALTER TABLE vou_sale_outbound_lines RENAME COLUMN product_unit TO entered_unit_symbol;
ALTER TABLE vou_sale_outbound_lines RENAME COLUMN quantity_micros TO base_quantity_micros;

ALTER TABLE vou_sale_signoff_lines RENAME COLUMN product_unit TO entered_unit_symbol;
ALTER TABLE vou_sale_signoff_lines RENAME COLUMN signed_qty_micros TO signed_base_quantity_micros;
ALTER TABLE vou_sale_signoff_lines RENAME COLUMN rejected_qty_micros TO rejected_base_quantity_micros;
ALTER TABLE vou_sale_signoff_lines RENAME COLUMN loss_qty_micros TO loss_base_quantity_micros;

ALTER TABLE vou_sale_return_lines RENAME COLUMN product_unit TO entered_unit_symbol;
ALTER TABLE vou_sale_return_lines RENAME COLUMN quantity_micros TO base_quantity_micros;

ALTER TABLE vou_purchase_inbound_lines RENAME COLUMN product_unit TO entered_unit_symbol;
ALTER TABLE vou_purchase_inbound_lines RENAME COLUMN quantity_micros TO base_quantity_micros;

ALTER TABLE vou_purchase_return_lines RENAME COLUMN product_unit TO entered_unit_symbol;
ALTER TABLE vou_purchase_return_lines RENAME COLUMN quantity_micros TO base_quantity_micros;

ALTER TABLE vou_sale_order_formulas
    RENAME COLUMN base_output_quantity_micros TO output_base_quantity_micros;
ALTER TABLE vou_sale_order_formulas
    ADD COLUMN output_entered_quantity_micros bigint,
    ADD COLUMN output_entered_unit_object_id varchar(26),
    ADD COLUMN output_entered_unit_version_id varchar(26),
    ADD COLUMN output_entered_unit_code varchar(64),
    ADD COLUMN output_entered_unit_name varchar(200),
    ADD COLUMN output_entered_unit_symbol varchar(32);

UPDATE vou_sale_order_formulas formula
SET output_entered_quantity_micros = formula.output_base_quantity_micros,
    output_entered_unit_object_id = line.entered_unit_object_id,
    output_entered_unit_version_id = line.entered_unit_version_id,
    output_entered_unit_code = line.entered_unit_code,
    output_entered_unit_name = line.entered_unit_name,
    output_entered_unit_symbol = line.entered_unit_symbol
FROM vou_product_lines line
WHERE line.id = formula.product_line_id;

ALTER TABLE vou_sale_order_formulas
    ALTER COLUMN output_entered_quantity_micros SET NOT NULL,
    ALTER COLUMN output_entered_unit_object_id SET NOT NULL,
    ALTER COLUMN output_entered_unit_version_id SET NOT NULL,
    ALTER COLUMN output_entered_unit_code SET NOT NULL,
    ALTER COLUMN output_entered_unit_name SET NOT NULL,
    ALTER COLUMN output_entered_unit_symbol SET NOT NULL;

ALTER TABLE vou_sale_order_formula_lines RENAME COLUMN material_unit TO entered_unit_symbol;
ALTER TABLE vou_sale_order_formula_lines RENAME COLUMN quantity_micros TO base_quantity_micros;
ALTER TABLE vou_sale_order_formula_lines
    ADD COLUMN entered_quantity_micros bigint,
    ADD COLUMN entered_unit_object_id varchar(26),
    ADD COLUMN entered_unit_version_id varchar(26),
    ADD COLUMN entered_unit_code varchar(64),
    ADD COLUMN entered_unit_name varchar(200);

UPDATE vou_sale_order_formula_lines line
SET entered_quantity_micros = line.base_quantity_micros,
    entered_unit_object_id = conversion.unit_object_id,
    entered_unit_version_id = conversion.unit_version_id,
    entered_unit_code = conversion.unit_code,
    entered_unit_name = conversion.unit_name,
    entered_unit_symbol = conversion.unit_symbol
FROM bob_product_versions product
JOIN bob_product_unit_conversions conversion
  ON conversion.product_version_id = product.version_id
 AND conversion.unit_object_id = product.default_input_unit_id
WHERE product.version_id = line.material_version_id;

ALTER TABLE vou_sale_order_formula_lines
    ALTER COLUMN entered_quantity_micros SET NOT NULL,
    ALTER COLUMN entered_unit_object_id SET NOT NULL,
    ALTER COLUMN entered_unit_version_id SET NOT NULL,
    ALTER COLUMN entered_unit_code SET NOT NULL,
    ALTER COLUMN entered_unit_name SET NOT NULL;

WITH target AS (
    SELECT id,
           replace(replace(source, 'barrelQuantity', 'standardPieceQuantity'),
                   'signedQuantity', 'signedBaseQuantity') AS source
    FROM vou_intermediary_scripts
)
UPDATE vou_intermediary_scripts script
SET source = target.source,
    source_hash = encode(sha256(convert_to(target.source, 'UTF8')), 'hex'),
    revision = script.revision + 1,
    updated_at = now()
FROM target
WHERE target.id = script.id;

SELECT rpt_validate_current_reports();

-- +goose Down

ALTER TABLE vou_sale_order_formula_lines
    DROP COLUMN entered_unit_name,
    DROP COLUMN entered_unit_code,
    DROP COLUMN entered_unit_version_id,
    DROP COLUMN entered_unit_object_id,
    DROP COLUMN entered_quantity_micros;
ALTER TABLE vou_sale_order_formula_lines RENAME COLUMN base_quantity_micros TO quantity_micros;
ALTER TABLE vou_sale_order_formula_lines RENAME COLUMN entered_unit_symbol TO material_unit;

ALTER TABLE vou_sale_order_formulas
    DROP COLUMN output_entered_unit_symbol,
    DROP COLUMN output_entered_unit_name,
    DROP COLUMN output_entered_unit_code,
    DROP COLUMN output_entered_unit_version_id,
    DROP COLUMN output_entered_unit_object_id,
    DROP COLUMN output_entered_quantity_micros;
ALTER TABLE vou_sale_order_formulas
    RENAME COLUMN output_base_quantity_micros TO base_output_quantity_micros;

ALTER TABLE vou_purchase_return_lines RENAME COLUMN base_quantity_micros TO quantity_micros;
ALTER TABLE vou_purchase_return_lines RENAME COLUMN entered_unit_symbol TO product_unit;
ALTER TABLE vou_purchase_inbound_lines RENAME COLUMN base_quantity_micros TO quantity_micros;
ALTER TABLE vou_purchase_inbound_lines RENAME COLUMN entered_unit_symbol TO product_unit;
ALTER TABLE vou_sale_return_lines RENAME COLUMN base_quantity_micros TO quantity_micros;
ALTER TABLE vou_sale_return_lines RENAME COLUMN entered_unit_symbol TO product_unit;
ALTER TABLE vou_sale_signoff_lines RENAME COLUMN loss_base_quantity_micros TO loss_qty_micros;
ALTER TABLE vou_sale_signoff_lines RENAME COLUMN rejected_base_quantity_micros TO rejected_qty_micros;
ALTER TABLE vou_sale_signoff_lines RENAME COLUMN signed_base_quantity_micros TO signed_qty_micros;
ALTER TABLE vou_sale_signoff_lines RENAME COLUMN entered_unit_symbol TO product_unit;
ALTER TABLE vou_sale_outbound_lines RENAME COLUMN base_quantity_micros TO quantity_micros;
ALTER TABLE vou_sale_outbound_lines RENAME COLUMN entered_unit_symbol TO product_unit;

ALTER TABLE vou_production_material_lines
    DROP COLUMN actual_entered_unit_name,
    DROP COLUMN actual_entered_unit_code,
    DROP COLUMN actual_entered_unit_version_id,
    DROP COLUMN actual_entered_unit_object_id,
    DROP COLUMN actual_entered_quantity_micros;
ALTER TABLE vou_production_material_lines RENAME COLUMN actual_base_quantity_micros TO actual_quantity_micros;
ALTER TABLE vou_production_material_lines RENAME COLUMN actual_entered_unit_symbol TO actual_material_unit;
ALTER TABLE vou_production_material_lines RENAME COLUMN suggested_base_quantity_micros TO suggested_quantity_micros;
ALTER TABLE vou_production_material_lines RENAME COLUMN formula_entered_unit_symbol TO formula_material_unit;
ALTER TABLE vou_production_material_lines RENAME COLUMN formula_base_quantity_micros TO formula_quantity_micros;

ALTER TABLE vou_production_output_lines
    DROP COLUMN entered_unit_name,
    DROP COLUMN entered_unit_code,
    DROP COLUMN entered_unit_version_id,
    DROP COLUMN entered_unit_object_id,
    DROP COLUMN entered_quantity_micros;
ALTER TABLE vou_production_output_lines RENAME COLUMN formula_base_quantity_micros TO formula_base_output_quantity_micros;
ALTER TABLE vou_production_output_lines RENAME COLUMN base_quantity_micros TO output_quantity_micros;
ALTER TABLE vou_production_output_lines RENAME COLUMN behavior_profile TO product_kind;
ALTER TABLE vou_production_output_lines RENAME COLUMN entered_unit_symbol TO product_unit;

ALTER TABLE vou_inventory_count_lines
    DROP COLUMN entered_unit_name,
    DROP COLUMN entered_unit_code,
    DROP COLUMN entered_unit_version_id,
    DROP COLUMN entered_unit_object_id,
    DROP COLUMN entered_quantity_micros;
ALTER TABLE vou_inventory_count_lines
    RENAME COLUMN difference_base_quantity_micros TO difference_quantity_micros;
ALTER TABLE vou_inventory_count_lines
    RENAME COLUMN book_base_quantity_micros TO book_quantity_micros;
ALTER TABLE vou_inventory_count_lines
    RENAME COLUMN actual_base_quantity_micros TO actual_quantity_micros;
ALTER TABLE vou_inventory_count_lines
    RENAME COLUMN entered_unit_symbol TO product_unit;

ALTER TABLE vou_price_lines
    ADD COLUMN pricing_quantity_per_inventory_unit_micros bigint NOT NULL DEFAULT 1000000,
    DROP COLUMN product_type_name,
    DROP COLUMN product_type_code,
    DROP COLUMN product_type_version_id,
    DROP COLUMN product_type_object_id;
ALTER TABLE vou_price_lines RENAME COLUMN behavior_profile TO product_kind;
ALTER TABLE vou_price_lines RENAME COLUMN default_input_unit_symbol TO product_unit;

ALTER TABLE vou_product_lines
    ADD COLUMN pricing_quantity_per_inventory_unit_micros bigint NOT NULL DEFAULT 1000000,
    DROP COLUMN default_packaging_spec_micros,
    DROP COLUMN product_type_name,
    DROP COLUMN product_type_code,
    DROP COLUMN product_type_version_id,
    DROP COLUMN product_type_object_id,
    DROP COLUMN entered_unit_name,
    DROP COLUMN entered_unit_code,
    DROP COLUMN entered_unit_version_id,
    DROP COLUMN entered_unit_object_id,
    DROP COLUMN entered_quantity_micros;
ALTER TABLE vou_product_lines RENAME COLUMN behavior_profile TO product_kind;
ALTER TABLE vou_product_lines RENAME COLUMN inbound_base_quantity_micros TO inbound_qty_micros;
ALTER TABLE vou_product_lines RENAME COLUMN loss_base_quantity_micros TO loss_qty_micros;
ALTER TABLE vou_product_lines RENAME COLUMN rejected_base_quantity_micros TO rejected_qty_micros;
ALTER TABLE vou_product_lines RENAME COLUMN signed_base_quantity_micros TO signed_qty_micros;
ALTER TABLE vou_product_lines RENAME COLUMN outbound_base_quantity_micros TO outbound_qty_micros;
ALTER TABLE vou_product_lines RENAME COLUMN entered_unit_symbol TO product_unit;
ALTER TABLE vou_product_lines RENAME COLUMN base_quantity_micros TO ordered_qty_micros;

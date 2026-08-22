-- +goose Up

-- Product types were added to the historical AUX migration after installations
-- had already advanced past it.  This migration is deliberately self-contained:
-- it makes the target Product Type and product-version schema available on both
-- a fresh database and an upgraded database.
ALTER TABLE aux_objects DROP CONSTRAINT IF EXISTS aux_objects_entity_check;
ALTER TABLE aux_objects ADD CONSTRAINT aux_objects_entity_check CHECK (entity IN (
    'product-category','product-type','department','position','settlement-method',
    'payment-method','dictionary-type','dictionary-item','measurement-unit',
    'income-expense-type','account-subject','asset-category'
));

INSERT INTO aux_objects (id, entity, code, current_version_id, enabled, next_version_no, revision, created_by, updated_by)
VALUES
    ('01JPTP00000000000000000001', 'product-type', 'PTP-0001', '01JPTP00000000000000000002', true, 2, 1, '00000000000000000000000000', '00000000000000000000000000'),
    ('01JPTP00000000000000000003', 'product-type', 'PTP-0002', '01JPTP00000000000000000004', true, 2, 1, '00000000000000000000000000', '00000000000000000000000000'),
    ('01JPTP00000000000000000005', 'product-type', 'PTP-0003', '01JPTP00000000000000000006', true, 2, 1, '00000000000000000000000000', '00000000000000000000000000'),
    ('01JPTP00000000000000000007', 'product-type', 'PTP-0004', '01JPTP00000000000000000008', true, 2, 1, '00000000000000000000000000', '00000000000000000000000000')
ON CONFLICT (id) DO NOTHING;
INSERT INTO aux_versions (id, object_id, entity, version_no, data, created_by)
VALUES
    ('01JPTP00000000000000000002', '01JPTP00000000000000000001', 'product-type', 1, '{"name":"原材料","behaviorProfile":"RAW_MATERIAL","description":"系统初始产品类型"}', '00000000000000000000000000'),
    ('01JPTP00000000000000000004', '01JPTP00000000000000000003', 'product-type', 1, '{"name":"标准成品","behaviorProfile":"STANDARD_FINISHED","description":"系统初始产品类型"}', '00000000000000000000000000'),
    ('01JPTP00000000000000000006', '01JPTP00000000000000000005', 'product-type', 1, '{"name":"定制成品","behaviorProfile":"CUSTOM_FINISHED","description":"系统初始产品类型"}', '00000000000000000000000000'),
    ('01JPTP00000000000000000008', '01JPTP00000000000000000007', 'product-type', 1, '{"name":"包装物","behaviorProfile":"PACKAGING","description":"系统初始产品类型"}', '00000000000000000000000000')
ON CONFLICT (id) DO NOTHING;
INSERT INTO object_number_counters(domain, entity, last_value)
VALUES ('aux', 'product-type', 4)
ON CONFLICT (domain, entity) DO UPDATE SET last_value=GREATEST(object_number_counters.last_value, EXCLUDED.last_value);

-- The historical migration cannot have installed Product Type actions on an
-- existing database.  Add the canonical permissions and menu projection here.
WITH actions(action, description, ordinal) AS (
    VALUES ('query','查询',1),('get','查看',2),('create','创建',3),('save','保存',4),
           ('versions','查看版本',5),('audit-history','查看审核记录',6),('enable','启用',7),
           ('disable','停用',8),('delete','删除',9)
)
INSERT INTO app_permissions (id,path,domain,entity,action,description,status)
SELECT '01JPTPPERM' || lpad(ordinal::text, 16, '0'), '/aux/product-type/' || action,
       'aux','product-type',action,description || '产品类型','ENABLED'
FROM actions ON CONFLICT (path) DO NOTHING;
INSERT INTO app_role_permissions (role_id, permission_id, created_by)
SELECT role.id, permission.id, role.updated_by
FROM app_roles role JOIN app_permissions permission ON permission.domain='aux' AND permission.entity='product-type'
WHERE role.code='superadmin'
ON CONFLICT DO NOTHING;
INSERT INTO app_business_menu_items (
    snapshot_type,id,parent_id,item_type,item_level,sort_order,display_name,icon,
    enabled,route_key,permission_code,revision,created_by,updated_by
)
SELECT parent.snapshot_type,'menu-route-aux-product-type',parent.id,'ROUTE',2,15,
       '产品类型','mdi-shape-outline',true,'aux/product-type','/aux/product-type/query',
       parent.revision,'01JAPPSYST3MACTR0000000000','01JAPPSYST3MACTR0000000000'
FROM app_business_menu_items parent
WHERE parent.id='menu-group-auxiliary-data'
ON CONFLICT (snapshot_type,id) DO NOTHING;

-- Flush the cyclic AUX object/version references before later ALTER TABLE
-- statements inspect foreign keys that point at aux_objects on upgraded
-- databases. Restore the normal deferred mode for the remaining migration.
SET CONSTRAINTS ALL IMMEDIATE;
SET CONSTRAINTS ALL DEFERRED;

DROP VIEW bob_version_views;

ALTER TABLE bob_product_versions
    ADD COLUMN product_type_id varchar(26),
    ADD COLUMN product_type_version_id varchar(26),
    ADD COLUMN product_type_code varchar(64),
    ADD COLUMN product_type_name varchar(200),
    ADD COLUMN behavior_profile varchar(32),
    ADD COLUMN default_input_unit_id varchar(26),
    ADD COLUMN IF NOT EXISTS default_packaging_spec_micros bigint;

-- Product drafts may be saved before unit configuration is complete. The
-- complete invariant is enforced when the version is submitted or approved.
ALTER TABLE bob_product_versions
    ALTER COLUMN pricing_unit_id DROP NOT NULL;

UPDATE bob_product_versions product
SET product_type_id = seed.object_id,
    product_type_version_id = seed.version_id,
    product_type_code = seed.code,
    product_type_name = seed.name,
    behavior_profile = seed.behavior_profile,
    default_input_unit_id = product.inventory_unit_id
FROM (VALUES
    ('RAW_MATERIAL','01JPTP00000000000000000001','01JPTP00000000000000000002','PTP-0001','原材料','RAW_MATERIAL'),
    ('STANDARD_FINISHED','01JPTP00000000000000000003','01JPTP00000000000000000004','PTP-0002','标准成品','STANDARD_FINISHED'),
    ('CUSTOM_FINISHED','01JPTP00000000000000000005','01JPTP00000000000000000006','PTP-0003','定制成品','CUSTOM_FINISHED'),
    ('PACKAGING','01JPTP00000000000000000007','01JPTP00000000000000000008','PTP-0004','包装物','PACKAGING')
) AS seed(legacy_kind,object_id,version_id,code,name,behavior_profile)
WHERE product.product_kind = seed.legacy_kind;

-- Existing installations still have the packaging-spec child table from the
-- original 00025. Preserve its authoritative default value before removing
-- that table. Fresh databases already have the scalar column and therefore
-- make this update a harmless no-op.
-- +goose StatementBegin
DO $$
BEGIN
    IF to_regclass('bob_product_packaging_specs') IS NOT NULL THEN
        EXECUTE $sql$
            UPDATE bob_product_versions product
            SET default_packaging_spec_micros = spec.content_quantity_micros
            FROM bob_product_packaging_specs spec
            WHERE spec.product_version_id = product.version_id
              AND spec.is_default
              AND product.default_packaging_spec_micros IS NULL
        $sql$;
    END IF;
END $$;
-- +goose StatementEnd
UPDATE bob_product_versions
SET default_packaging_spec_micros = 1000000
WHERE behavior_profile <> 'PACKAGING'
  AND default_packaging_spec_micros IS NULL;
UPDATE bob_product_versions
SET default_packaging_spec_micros = NULL
WHERE behavior_profile = 'PACKAGING';

CREATE TABLE bob_product_unit_conversions (
    product_version_id varchar(26) NOT NULL REFERENCES bob_product_versions(version_id) ON DELETE CASCADE,
    unit_object_id varchar(26) NOT NULL REFERENCES aux_objects(id) ON DELETE RESTRICT,
    unit_version_id varchar(26) NOT NULL REFERENCES aux_versions(id) ON DELETE RESTRICT,
    unit_code varchar(64) NOT NULL,
    unit_name varchar(200) NOT NULL,
    unit_symbol varchar(32) NOT NULL,
    factor_micros bigint NOT NULL CHECK (factor_micros > 0),
    PRIMARY KEY (product_version_id, unit_object_id)
);
INSERT INTO bob_product_unit_conversions (product_version_id,unit_object_id,unit_version_id,unit_code,unit_name,unit_symbol,factor_micros)
SELECT product.version_id, unit.id, unit_version.id, unit.code,
       unit_version.data->>'name', unit_version.data->>'symbol',
       CASE WHEN product.inventory_unit_id=product.pricing_unit_id THEN product.pricing_quantity_per_inventory_unit_micros ELSE 1000000 END
FROM bob_product_versions product
JOIN aux_objects unit ON unit.id=product.inventory_unit_id AND unit.entity='measurement-unit'
JOIN aux_versions unit_version ON unit_version.id=unit.current_version_id;
INSERT INTO bob_product_unit_conversions (product_version_id,unit_object_id,unit_version_id,unit_code,unit_name,unit_symbol,factor_micros)
SELECT product.version_id, unit.id, unit_version.id, unit.code,
       unit_version.data->>'name', unit_version.data->>'symbol', product.pricing_quantity_per_inventory_unit_micros
FROM bob_product_versions product
JOIN aux_objects unit ON unit.id=product.pricing_unit_id AND unit.entity='measurement-unit'
JOIN aux_versions unit_version ON unit_version.id=unit.current_version_id
ON CONFLICT (product_version_id,unit_object_id) DO NOTHING;

ALTER TABLE bob_product_formulas RENAME COLUMN base_output_quantity_micros TO output_base_quantity_micros;
ALTER TABLE bob_product_formulas
    ADD COLUMN output_entered_quantity_micros bigint,
    ADD COLUMN output_unit_object_id varchar(26),
    ADD COLUMN output_unit_version_id varchar(26),
    ADD COLUMN output_unit_code varchar(64),
    ADD COLUMN output_unit_name varchar(200),
    ADD COLUMN output_unit_symbol varchar(32);
UPDATE bob_product_formulas formula
SET output_entered_quantity_micros=formula.output_base_quantity_micros,
    output_unit_object_id=product.default_input_unit_id,
    output_unit_version_id=conversion.unit_version_id,
    output_unit_code=conversion.unit_code, output_unit_name=conversion.unit_name,
    output_unit_symbol=conversion.unit_symbol
FROM bob_product_versions product
JOIN bob_product_unit_conversions conversion ON conversion.product_version_id=product.version_id AND conversion.unit_object_id=product.default_input_unit_id
WHERE product.version_id=formula.product_version_id;
ALTER TABLE bob_product_formula_lines RENAME COLUMN quantity_micros TO base_quantity_micros;
ALTER TABLE bob_product_formula_lines
    ADD COLUMN entered_quantity_micros bigint,
    ADD COLUMN entered_unit_object_id varchar(26),
    ADD COLUMN entered_unit_version_id varchar(26),
    ADD COLUMN entered_unit_code varchar(64),
    ADD COLUMN entered_unit_name varchar(200),
    ADD COLUMN entered_unit_symbol varchar(32),
    ADD COLUMN resolution_status varchar(16) NOT NULL DEFAULT 'CURRENT' CHECK (resolution_status IN ('CURRENT','UNRESOLVED')),
    ADD COLUMN requires_confirmation boolean NOT NULL DEFAULT false;
UPDATE bob_product_formula_lines line
SET entered_quantity_micros=line.base_quantity_micros,
    entered_unit_object_id=product.default_input_unit_id,
    entered_unit_version_id=conversion.unit_version_id,
    entered_unit_code=conversion.unit_code, entered_unit_name=conversion.unit_name,
    entered_unit_symbol=conversion.unit_symbol
FROM bob_product_versions product
JOIN bob_product_unit_conversions conversion ON conversion.product_version_id=product.version_id AND conversion.unit_object_id=product.default_input_unit_id
WHERE product.version_id=line.material_version_id;

ALTER TABLE bob_product_formulas
    ALTER COLUMN output_entered_quantity_micros SET NOT NULL,
    ALTER COLUMN output_unit_object_id SET NOT NULL,
    ALTER COLUMN output_unit_version_id SET NOT NULL,
    ALTER COLUMN output_unit_code SET NOT NULL,
    ALTER COLUMN output_unit_name SET NOT NULL,
    ALTER COLUMN output_unit_symbol SET NOT NULL;
ALTER TABLE bob_product_formula_lines
    ALTER COLUMN entered_quantity_micros SET NOT NULL,
    ALTER COLUMN entered_unit_object_id SET NOT NULL,
    ALTER COLUMN entered_unit_version_id SET NOT NULL,
    ALTER COLUMN entered_unit_code SET NOT NULL,
    ALTER COLUMN entered_unit_name SET NOT NULL,
    ALTER COLUMN entered_unit_symbol SET NOT NULL;

ALTER TABLE bob_product_versions
    DROP CONSTRAINT IF EXISTS bob_product_inventory_unit_aux_fk,
    DROP CONSTRAINT IF EXISTS bob_product_pricing_unit_aux_fk,
    DROP CONSTRAINT IF EXISTS bob_product_packaging_returnable_ck,
    DROP CONSTRAINT IF EXISTS bob_product_pricing_conversion_ck,
    DROP CONSTRAINT IF EXISTS bob_product_default_packaging_spec_ck,
    DROP CONSTRAINT IF EXISTS bob_product_container_type_ck,
    DROP COLUMN inventory_unit_id,
    DROP COLUMN pricing_quantity_per_inventory_unit_micros,
    DROP COLUMN product_kind,
    DROP COLUMN container_type,
    DROP COLUMN quantity_per_container_micros,
    DROP COLUMN unit;
DROP TABLE IF EXISTS bob_product_packaging_specs;
ALTER TABLE bob_product_versions
    ADD CONSTRAINT bob_product_default_packaging_spec_ck CHECK (
        default_packaging_spec_micros IS NULL
        OR (behavior_profile <> 'PACKAGING' AND default_packaging_spec_micros > 0)
    );

CREATE OR REPLACE VIEW bob_version_views AS
SELECT
    o.id AS object_id, o.entity, o.code, o.current_version_id, o.effective_version_id,
    o.revision AS object_revision, o.updated_at AS object_updated_at,
    v.id AS version_id, v.version_no, v.status, v.revision AS version_revision,
    v.created_at, v.created_by, v.updated_at, v.updated_by, v.submitted_at, v.submitted_by,
    v.reviewed_at, v.reviewed_by, v.review_comment,
    COALESCE(c.name,s.name,e.name,p.name,sv.name,w.name,vh.name,f.name,ca.name,d.name,po.name,sm.name) AS name,
    COALESCE(sv.unit,'') AS unit, COALESCE(sv.unit_id,'') AS inventory_unit_id,
    f.currency, vh.plate_number, vh.vehicle_type, vh.platform_object_id,
    COALESCE(c.customer_type,'') AS customer_type, COALESCE(c.short_name,s.short_name,'') AS short_name,
    COALESCE(c.category_id,s.category_id,e.category_id,p.category_id,sv.category_id,w.category_id,vh.category_id,f.category_id,d.category_id,po.category_id,'') AS category_id,
    COALESCE(c.tax_number,s.tax_number,'') AS tax_number, COALESCE(c.contact_name,s.contact_name,w.contact_name,'') AS contact_name,
    COALESCE(c.contact_phone,s.contact_phone,w.contact_phone,'') AS contact_phone, COALESCE(c.email,s.email,e.email,'') AS email,
    COALESCE(c.address,s.address,w.address,'') AS address, COALESCE(c.remark,s.remark,e.remark,p.remark,sv.remark,w.remark,vh.remark,f.remark,'') AS remark,
    COALESCE(e.department_id,'') AS department_id, COALESCE(e.position_id,'') AS position_id, COALESCE(e.phone,'') AS phone,
    CAST(COALESCE(e.hire_date::text,'') AS varchar(10)) AS hire_date, COALESCE(p.specification,'') AS specification,
    COALESCE(p.model,'') AS model, COALESCE(p.barcode,'') AS barcode, COALESCE(sv.description,ca.description,d.description,po.description,sm.description,'') AS description,
    COALESCE(w.manager_employee_id,'') AS manager_employee_id, COALESCE(vh.vin,'') AS vin, COALESCE(vh.engine_number,'') AS engine_number,
    CAST(COALESCE(vh.load_capacity_kg::text,'') AS varchar(32)) AS load_capacity_kg, COALESCE(f.account_name,'') AS account_name,
    COALESCE(f.bank_name,'') AS bank_name, COALESCE(f.bank_branch,'') AS bank_branch, COALESCE(f.account_number,'') AS account_number,
    COALESCE(ca.target_entity,'') AS target_entity, COALESCE(ca.parent_id,d.parent_id,'') AS parent_id,
    COALESCE(c.settlement_method_id,s.settlement_method_id,'') AS settlement_method_id, COALESCE(s.default_purchaser_employee_id,'') AS salesperson_employee_id,
    COALESCE(linked_aux_sm.current_version_id,linked_sm.effective_version_id,'') AS settlement_method_version_id,
    COALESCE(sm.rule_type,'') AS settlement_rule_type, COALESCE(sm.month_offset,0) AS settlement_month_offset,
    COALESCE(sm.day_of_month,0) AS settlement_day_of_month, COALESCE(sm.day_offset,0) AS settlement_day_offset,
    COALESCE(p.product_type_id,'') AS product_type_id, COALESCE(p.product_type_version_id,'') AS product_type_version_id,
    COALESCE(p.product_type_code,'') AS product_type_code, COALESCE(p.product_type_name,'') AS product_type_name,
    COALESCE(p.behavior_profile,'') AS behavior_profile, COALESCE(p.default_input_unit_id,'') AS default_input_unit_id,
    COALESCE(p.pricing_unit_id,'') AS pricing_unit_id, COALESCE(p.returnable,false) AS returnable,
    COALESCE(p.default_packaging_spec_micros,0) AS default_packaging_spec_micros, COALESCE(c.monthly_closing_day,0) AS monthly_closing_day,
    COALESCE(settlement.term_code,'') AS settlement_term_code, COALESCE(settlement.default_sales_surcharge_cents,0) AS settlement_default_sales_surcharge_cents,
    COALESCE(c.rebate_unit_price_cents,0) AS rebate_unit_price_cents
FROM bob_objects o JOIN bob_versions v ON v.object_id=o.id AND v.entity=o.entity
LEFT JOIN bob_customer_versions c ON c.version_id=v.id LEFT JOIN bob_supplier_versions s ON s.version_id=v.id
LEFT JOIN bob_employee_versions e ON e.version_id=v.id LEFT JOIN bob_product_versions p ON p.version_id=v.id
LEFT JOIN bob_service_versions sv ON sv.version_id=v.id LEFT JOIN bob_warehouse_versions w ON w.version_id=v.id
LEFT JOIN bob_vehicle_versions vh ON vh.version_id=v.id LEFT JOIN bob_fund_account_versions f ON f.version_id=v.id
LEFT JOIN bob_category_versions ca ON ca.version_id=v.id LEFT JOIN bob_department_versions d ON d.version_id=v.id
LEFT JOIN bob_position_versions po ON po.version_id=v.id LEFT JOIN bob_objects linked_sm ON linked_sm.id=COALESCE(c.settlement_method_id,s.settlement_method_id) AND linked_sm.entity='settlement-method'
LEFT JOIN aux_objects linked_aux_sm ON linked_aux_sm.id=COALESCE(c.settlement_method_id,s.settlement_method_id) AND linked_aux_sm.entity='settlement-method' AND linked_aux_sm.enabled
LEFT JOIN bob_settlement_method_versions sm ON sm.version_id=v.id LEFT JOIN bob_settlement_method_versions settlement ON settlement.version_id=v.id;

SELECT rpt_validate_current_reports();

-- +goose Down
-- +goose StatementBegin
DO $$ BEGIN RAISE EXCEPTION '00097 product master-data target is irreversible'; END $$;
-- +goose StatementEnd

-- +goose Up

ALTER TABLE bob_product_versions
    ADD COLUMN product_kind varchar(32) NOT NULL DEFAULT 'RAW_MATERIAL'
        CHECK (product_kind IN ('RAW_MATERIAL', 'STANDARD_FINISHED', 'CUSTOM_FINISHED', 'PACKAGING')),
    ADD COLUMN inventory_unit_id varchar(26),
    ADD COLUMN pricing_unit_id varchar(26),
    ADD COLUMN pricing_quantity_per_inventory_unit_micros bigint,
    ADD COLUMN returnable boolean NOT NULL DEFAULT false,
    ADD COLUMN default_packaging_spec_micros bigint,
    ADD CONSTRAINT bob_product_pricing_conversion_ck
        CHECK (pricing_quantity_per_inventory_unit_micros IS NULL
            OR pricing_quantity_per_inventory_unit_micros > 0),
    ADD CONSTRAINT bob_product_packaging_returnable_ck
        CHECK (product_kind = 'PACKAGING' OR NOT returnable),
    ADD CONSTRAINT bob_product_default_packaging_spec_ck
        CHECK (
            (product_kind = 'PACKAGING' AND default_packaging_spec_micros IS NULL)
            OR (
                product_kind <> 'PACKAGING'
                AND default_packaging_spec_micros IS NOT NULL
                AND default_packaging_spec_micros > 0
            )
        ) NOT VALID;

ALTER TABLE bob_service_versions
    ADD COLUMN unit_id varchar(26);

UPDATE bob_product_versions
SET inventory_unit_id = CASE lower(unit)
        WHEN 'kg' THEN '01JAVX00000000000000000011'
        WHEN '件' THEN '01JAVX00000000000000000013'
        WHEN 'piece' THEN '01JAVX00000000000000000013'
        WHEN 'unit' THEN '01JAVX00000000000000000013'
        WHEN '吨' THEN '01JAVX00000000000000000027'
        WHEN 'ton' THEN '01JAVX00000000000000000027'
        WHEN 't' THEN '01JAVX00000000000000000027'
    END,
    pricing_unit_id = '01JAVX00000000000000000011',
    pricing_quantity_per_inventory_unit_micros = CASE lower(unit)
        WHEN '吨' THEN 1000000000
        WHEN 'ton' THEN 1000000000
        WHEN 't' THEN 1000000000
        ELSE 1000000
    END,
    default_packaging_spec_micros = COALESCE(NULLIF(quantity_per_container_micros, 0), 1000000);

UPDATE bob_service_versions
SET unit_id = CASE lower(unit)
        WHEN 'kg' THEN '01JAVX00000000000000000011'
        WHEN '件' THEN '01JAVX00000000000000000013'
        WHEN '年' THEN '01JAVX00000000000000000015'
        WHEN '次' THEN '01JAVX00000000000000000017'
        WHEN 'hour' THEN '01JAVX00000000000000000025'
        WHEN '小时' THEN '01JAVX00000000000000000025'
        WHEN 'unit' THEN '01JAVX00000000000000000013'
        WHEN '吨' THEN '01JAVX00000000000000000027'
    END;

-- +goose StatementBegin
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM bob_product_versions WHERE inventory_unit_id IS NULL) THEN
        RAISE EXCEPTION 'cannot migrate product unit: unsupported legacy unit'
            USING ERRCODE = 'P0001';
    END IF;
    IF EXISTS (SELECT 1 FROM bob_service_versions WHERE unit_id IS NULL) THEN
        RAISE EXCEPTION 'cannot migrate service unit: unsupported legacy unit'
            USING ERRCODE = 'P0001';
    END IF;
END
$$;
-- +goose StatementEnd

SET CONSTRAINTS ALL IMMEDIATE;

ALTER TABLE bob_product_versions
    ALTER COLUMN inventory_unit_id SET NOT NULL,
    ALTER COLUMN pricing_unit_id SET NOT NULL,
    ALTER COLUMN pricing_quantity_per_inventory_unit_micros SET NOT NULL;
ALTER TABLE bob_product_versions
    VALIDATE CONSTRAINT bob_product_default_packaging_spec_ck;
ALTER TABLE bob_service_versions
    ALTER COLUMN unit_id SET NOT NULL;

ALTER TABLE bob_product_versions
    ADD CONSTRAINT bob_product_inventory_unit_aux_fk
        FOREIGN KEY (inventory_unit_id) REFERENCES aux_objects(id)
        ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
    ADD CONSTRAINT bob_product_pricing_unit_aux_fk
        FOREIGN KEY (pricing_unit_id) REFERENCES aux_objects(id)
        ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE bob_service_versions
    ADD CONSTRAINT bob_service_unit_aux_fk
    FOREIGN KEY (unit_id) REFERENCES aux_objects(id)
    ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;

CREATE OR REPLACE VIEW bob_version_views AS
SELECT
    o.id AS object_id, o.entity, o.code, o.current_version_id, o.effective_version_id,
    o.revision AS object_revision, o.updated_at AS object_updated_at,
    v.id AS version_id, v.version_no, v.status, v.revision AS version_revision,
    v.created_at, v.created_by, v.updated_at, v.updated_by, v.submitted_at, v.submitted_by,
    v.reviewed_at, v.reviewed_by, v.review_comment,
    COALESCE(c.name, s.name, e.name, p.name, sv.name, w.name, vh.name, f.name,
             ca.name, d.name, po.name, sm.name) AS name,
    COALESCE(p.unit, sv.unit, '') AS unit,
    f.currency, s.supplier_type, vh.plate_number, vh.vehicle_type, vh.platform_object_id,
    COALESCE(c.customer_type, '') AS customer_type,
    COALESCE(c.short_name, s.short_name, '') AS short_name,
    COALESCE(c.category_id, s.category_id, e.category_id, p.category_id, sv.category_id,
             w.category_id, vh.category_id, f.category_id, d.category_id, po.category_id, '') AS category_id,
    COALESCE(c.tax_number, s.tax_number, '') AS tax_number,
    COALESCE(c.contact_name, s.contact_name, w.contact_name, '') AS contact_name,
    COALESCE(c.contact_phone, s.contact_phone, w.contact_phone, '') AS contact_phone,
    COALESCE(c.email, s.email, e.email, '') AS email,
    COALESCE(c.address, s.address, w.address, '') AS address,
    COALESCE(c.remark, s.remark, e.remark, p.remark, sv.remark, w.remark, vh.remark, f.remark, '') AS remark,
    COALESCE(e.department_id, '') AS department_id,
    COALESCE(e.position_id, '') AS position_id,
    COALESCE(e.phone, '') AS phone,
    CAST(COALESCE(e.hire_date::text, '') AS varchar(10)) AS hire_date,
    COALESCE(p.specification, '') AS specification,
    COALESCE(p.model, '') AS model,
    COALESCE(p.barcode, '') AS barcode,
    COALESCE(sv.description, ca.description, d.description, po.description, sm.description, '') AS description,
    COALESCE(w.manager_employee_id, '') AS manager_employee_id,
    COALESCE(vh.vin, '') AS vin,
    COALESCE(vh.engine_number, '') AS engine_number,
    CAST(COALESCE(vh.load_capacity_kg::text, '') AS varchar(32)) AS load_capacity_kg,
    COALESCE(f.account_name, '') AS account_name,
    COALESCE(f.bank_name, '') AS bank_name,
    COALESCE(f.bank_branch, '') AS bank_branch,
    COALESCE(f.account_number, '') AS account_number,
    COALESCE(ca.target_entity, '') AS target_entity,
    COALESCE(ca.parent_id, d.parent_id, '') AS parent_id,
    COALESCE(c.settlement_method_id, s.settlement_method_id, '') AS settlement_method_id,
    COALESCE(c.salesperson_employee_id, s.salesperson_employee_id, '') AS salesperson_employee_id,
    COALESCE(linked_aux_sm.current_version_id, linked_sm.effective_version_id, '') AS settlement_method_version_id,
    COALESCE(sm.rule_type, '') AS settlement_rule_type,
    COALESCE(sm.month_offset, 0) AS settlement_month_offset,
    COALESCE(sm.day_of_month, 0) AS settlement_day_of_month,
    COALESCE(sm.day_offset, 0) AS settlement_day_offset,
    COALESCE(p.container_type, '') AS container_type,
    COALESCE(p.quantity_per_container_micros, 0) AS quantity_per_container_micros,
    COALESCE(p.product_kind, '') AS product_kind,
    COALESCE(p.inventory_unit_id, sv.unit_id, '') AS inventory_unit_id,
    COALESCE(p.pricing_unit_id, '') AS pricing_unit_id,
    COALESCE(p.pricing_quantity_per_inventory_unit_micros, 0) AS pricing_quantity_per_inventory_unit_micros,
    COALESCE(p.returnable, false) AS returnable,
    COALESCE(p.default_packaging_spec_micros, 0) AS default_packaging_spec_micros
FROM bob_objects o
JOIN bob_versions v ON v.object_id = o.id AND v.entity = o.entity
LEFT JOIN bob_customer_versions c ON c.version_id = v.id
LEFT JOIN bob_supplier_versions s ON s.version_id = v.id
LEFT JOIN bob_employee_versions e ON e.version_id = v.id
LEFT JOIN bob_product_versions p ON p.version_id = v.id
LEFT JOIN bob_service_versions sv ON sv.version_id = v.id
LEFT JOIN bob_warehouse_versions w ON w.version_id = v.id
LEFT JOIN bob_vehicle_versions vh ON vh.version_id = v.id
LEFT JOIN bob_fund_account_versions f ON f.version_id = v.id
LEFT JOIN bob_category_versions ca ON ca.version_id = v.id
LEFT JOIN bob_department_versions d ON d.version_id = v.id
LEFT JOIN bob_position_versions po ON po.version_id = v.id
LEFT JOIN bob_objects linked_sm
    ON linked_sm.id = COALESCE(c.settlement_method_id, s.settlement_method_id)
   AND linked_sm.entity = 'settlement-method'
LEFT JOIN aux_objects linked_aux_sm
    ON linked_aux_sm.id = COALESCE(c.settlement_method_id, s.settlement_method_id)
   AND linked_aux_sm.entity = 'settlement-method'
   AND linked_aux_sm.enabled
LEFT JOIN bob_settlement_method_versions sm ON sm.version_id = v.id;

-- +goose Down

DROP VIEW bob_version_views;

ALTER TABLE bob_product_versions
    DROP CONSTRAINT bob_product_inventory_unit_aux_fk,
    DROP CONSTRAINT bob_product_pricing_unit_aux_fk;
ALTER TABLE bob_service_versions
    DROP CONSTRAINT bob_service_unit_aux_fk;

SET CONSTRAINTS ALL IMMEDIATE;

ALTER TABLE bob_service_versions DROP COLUMN unit_id;
ALTER TABLE bob_product_versions
    DROP CONSTRAINT bob_product_packaging_returnable_ck,
    DROP CONSTRAINT bob_product_pricing_conversion_ck,
    DROP CONSTRAINT bob_product_default_packaging_spec_ck,
    DROP COLUMN default_packaging_spec_micros,
    DROP COLUMN returnable,
    DROP COLUMN pricing_quantity_per_inventory_unit_micros,
    DROP COLUMN pricing_unit_id,
    DROP COLUMN inventory_unit_id,
    DROP COLUMN product_kind;

CREATE VIEW bob_version_views AS
SELECT
    o.id AS object_id, o.entity, o.code, o.current_version_id, o.effective_version_id,
    o.revision AS object_revision, o.updated_at AS object_updated_at,
    v.id AS version_id, v.version_no, v.status, v.revision AS version_revision,
    v.created_at, v.created_by, v.updated_at, v.updated_by, v.submitted_at, v.submitted_by,
    v.reviewed_at, v.reviewed_by, v.review_comment,
    COALESCE(c.name, s.name, e.name, p.name, sv.name, w.name, vh.name, f.name,
             ca.name, d.name, po.name, sm.name) AS name,
    COALESCE(p.unit, sv.unit, '') AS unit,
    f.currency, s.supplier_type, vh.plate_number, vh.vehicle_type, vh.platform_object_id,
    COALESCE(c.customer_type, '') AS customer_type,
    COALESCE(c.short_name, s.short_name, '') AS short_name,
    COALESCE(c.category_id, s.category_id, e.category_id, p.category_id, sv.category_id,
             w.category_id, vh.category_id, f.category_id, d.category_id, po.category_id, '') AS category_id,
    COALESCE(c.tax_number, s.tax_number, '') AS tax_number,
    COALESCE(c.contact_name, s.contact_name, w.contact_name, '') AS contact_name,
    COALESCE(c.contact_phone, s.contact_phone, w.contact_phone, '') AS contact_phone,
    COALESCE(c.email, s.email, e.email, '') AS email,
    COALESCE(c.address, s.address, w.address, '') AS address,
    COALESCE(c.remark, s.remark, e.remark, p.remark, sv.remark, w.remark, vh.remark, f.remark, '') AS remark,
    COALESCE(e.department_id, '') AS department_id,
    COALESCE(e.position_id, '') AS position_id,
    COALESCE(e.phone, '') AS phone,
    CAST(COALESCE(e.hire_date::text, '') AS varchar(10)) AS hire_date,
    COALESCE(p.specification, '') AS specification,
    COALESCE(p.model, '') AS model,
    COALESCE(p.barcode, '') AS barcode,
    COALESCE(sv.description, ca.description, d.description, po.description, sm.description, '') AS description,
    COALESCE(w.manager_employee_id, '') AS manager_employee_id,
    COALESCE(vh.vin, '') AS vin,
    COALESCE(vh.engine_number, '') AS engine_number,
    CAST(COALESCE(vh.load_capacity_kg::text, '') AS varchar(32)) AS load_capacity_kg,
    COALESCE(f.account_name, '') AS account_name,
    COALESCE(f.bank_name, '') AS bank_name,
    COALESCE(f.bank_branch, '') AS bank_branch,
    COALESCE(f.account_number, '') AS account_number,
    COALESCE(ca.target_entity, '') AS target_entity,
    COALESCE(ca.parent_id, d.parent_id, '') AS parent_id,
    COALESCE(c.settlement_method_id, s.settlement_method_id, '') AS settlement_method_id,
    COALESCE(c.salesperson_employee_id, s.salesperson_employee_id, '') AS salesperson_employee_id,
    COALESCE(linked_aux_sm.current_version_id, linked_sm.effective_version_id, '') AS settlement_method_version_id,
    COALESCE(sm.rule_type, '') AS settlement_rule_type,
    COALESCE(sm.month_offset, 0) AS settlement_month_offset,
    COALESCE(sm.day_of_month, 0) AS settlement_day_of_month,
    COALESCE(sm.day_offset, 0) AS settlement_day_offset,
    COALESCE(p.container_type, '') AS container_type,
    COALESCE(p.quantity_per_container_micros, 0) AS quantity_per_container_micros
FROM bob_objects o
JOIN bob_versions v ON v.object_id = o.id AND v.entity = o.entity
LEFT JOIN bob_customer_versions c ON c.version_id = v.id
LEFT JOIN bob_supplier_versions s ON s.version_id = v.id
LEFT JOIN bob_employee_versions e ON e.version_id = v.id
LEFT JOIN bob_product_versions p ON p.version_id = v.id
LEFT JOIN bob_service_versions sv ON sv.version_id = v.id
LEFT JOIN bob_warehouse_versions w ON w.version_id = v.id
LEFT JOIN bob_vehicle_versions vh ON vh.version_id = v.id
LEFT JOIN bob_fund_account_versions f ON f.version_id = v.id
LEFT JOIN bob_category_versions ca ON ca.version_id = v.id
LEFT JOIN bob_department_versions d ON d.version_id = v.id
LEFT JOIN bob_position_versions po ON po.version_id = v.id
LEFT JOIN bob_objects linked_sm
    ON linked_sm.id = COALESCE(c.settlement_method_id, s.settlement_method_id)
   AND linked_sm.entity = 'settlement-method'
LEFT JOIN aux_objects linked_aux_sm
    ON linked_aux_sm.id = COALESCE(c.settlement_method_id, s.settlement_method_id)
   AND linked_aux_sm.entity = 'settlement-method'
   AND linked_aux_sm.enabled
LEFT JOIN bob_settlement_method_versions sm ON sm.version_id = v.id;

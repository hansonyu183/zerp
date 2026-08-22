-- +goose Up

CREATE TABLE aux_migration_00045_settlement_terms (
    version_id varchar(26) PRIMARY KEY,
    cutoff_day integer,
    month_offset integer
);

INSERT INTO aux_migration_00045_settlement_terms (version_id, cutoff_day, month_offset)
SELECT
    id,
    CASE WHEN data ? 'cutoffDay' THEN (data->>'cutoffDay')::integer END,
    CASE WHEN data ? 'monthOffset' THEN (data->>'monthOffset')::integer END
FROM aux_versions
WHERE entity = 'settlement-method'
  AND (data ? 'cutoffDay' OR data ? 'monthOffset');

ALTER TABLE bob_customer_versions
    ADD COLUMN monthly_closing_day integer NOT NULL DEFAULT 31
        CHECK (monthly_closing_day BETWEEN 1 AND 31);

UPDATE bob_customer_versions customer
SET monthly_closing_day = terms.cutoff_day
FROM aux_objects settlement_object
JOIN aux_migration_00045_settlement_terms terms
  ON terms.version_id = settlement_object.current_version_id
WHERE settlement_object.id = customer.settlement_method_id
  AND settlement_object.entity = 'settlement-method'
  AND terms.cutoff_day BETWEEN 1 AND 31;

UPDATE aux_versions
SET data = data - 'cutoffDay' - 'monthOffset'
WHERE entity = 'settlement-method';

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
    COALESCE(p.default_packaging_spec_micros, 0) AS default_packaging_spec_micros,
    COALESCE(c.monthly_closing_day, 0) AS monthly_closing_day
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

UPDATE aux_versions version
SET data = version.data
    || CASE WHEN terms.cutoff_day IS NULL THEN '{}'::jsonb
            ELSE jsonb_build_object('cutoffDay', terms.cutoff_day) END
    || CASE WHEN terms.month_offset IS NULL THEN '{}'::jsonb
            ELSE jsonb_build_object('monthOffset', terms.month_offset) END
FROM aux_migration_00045_settlement_terms terms
WHERE terms.version_id = version.id;

DROP VIEW bob_version_views;

ALTER TABLE bob_customer_versions DROP COLUMN monthly_closing_day;

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

DROP TABLE aux_migration_00045_settlement_terms;

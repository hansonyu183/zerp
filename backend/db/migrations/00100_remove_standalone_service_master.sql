-- +goose Up

-- Service content belongs to VOU contracts. Standalone BOB Service objects have
-- no consumer and are removed as a direct cutover; VOU contract and acceptance
-- facts are intentionally untouched.
DROP VIEW bob_version_views;

DELETE FROM app_role_permissions
WHERE permission_id IN (SELECT id FROM app_permissions WHERE domain='bob' AND entity='service');
DELETE FROM app_permissions WHERE domain='bob' AND entity='service';
DELETE FROM app_business_menu_items WHERE route_key='bob/service';

DELETE FROM bob_audit_events WHERE entity='service';
DELETE FROM bob_service_versions;
DELETE FROM bob_versions WHERE entity='service';
DELETE FROM bob_objects WHERE entity='service';
DELETE FROM object_number_counters WHERE domain='bob' AND entity='service';

-- Deleting the legacy detail/version/object graph queues deferred BOB and
-- foreign-key trigger events. Flush them before changing bob_objects or
-- dropping the detail table in this Goose transaction.
SET CONSTRAINTS ALL IMMEDIATE;

ALTER TABLE bob_objects DROP CONSTRAINT bob_objects_entity_check;
ALTER TABLE bob_objects ADD CONSTRAINT bob_objects_entity_check CHECK (entity IN (
    'customer','customer-account','supplier','other-unit','employee','sales-partner','product','warehouse',
    'vehicle','fund-account','category','department','position','settlement-method','operating-entity'
));
DROP TABLE bob_service_versions;

-- +goose StatementBegin
CREATE OR REPLACE FUNCTION bob_validate_category_tree() RETURNS trigger AS $$
DECLARE
    category_object_id varchar(26);
    is_current boolean;
BEGIN
    SELECT v.object_id, o.current_version_id = v.id
    INTO category_object_id, is_current
    FROM bob_versions v
    JOIN bob_objects o ON o.id = v.object_id AND o.entity = v.entity
    WHERE v.id = NEW.version_id AND v.entity = 'category';
    IF NOT FOUND OR NOT is_current THEN RETURN NEW; END IF;

    PERFORM pg_advisory_xact_lock(hashtextextended('bob.category.tree', 0));
    IF TG_OP = 'UPDATE' AND OLD.target_entity <> NEW.target_entity AND EXISTS (
        SELECT 1 FROM bob_customer_versions x WHERE x.category_id = category_object_id
        UNION ALL SELECT 1 FROM bob_supplier_versions x WHERE x.category_id = category_object_id
        UNION ALL SELECT 1 FROM bob_employee_versions x WHERE x.category_id = category_object_id
        UNION ALL SELECT 1 FROM bob_product_versions x WHERE x.category_id = category_object_id
        UNION ALL SELECT 1 FROM bob_warehouse_versions x WHERE x.category_id = category_object_id
        UNION ALL SELECT 1 FROM bob_vehicle_versions x WHERE x.category_id = category_object_id
        UNION ALL SELECT 1 FROM bob_fund_account_versions x WHERE x.category_id = category_object_id
        UNION ALL SELECT 1 FROM bob_department_versions x WHERE x.category_id = category_object_id
        UNION ALL SELECT 1 FROM bob_position_versions x WHERE x.category_id = category_object_id
        UNION ALL SELECT 1 FROM bob_category_versions x WHERE x.parent_id = category_object_id
    ) THEN
        RAISE EXCEPTION 'referenced category target cannot change' USING ERRCODE = '23505';
    END IF;
    IF NEW.parent_id = category_object_id THEN
        RAISE EXCEPTION 'category cannot be its own parent' USING ERRCODE = '23514';
    END IF;
    IF NEW.parent_id IS NOT NULL AND NOT EXISTS (
        SELECT 1
        FROM bob_objects parent_object
        JOIN bob_category_versions parent_detail ON parent_detail.version_id = parent_object.effective_version_id
        JOIN bob_versions parent_version ON parent_version.id = parent_object.effective_version_id
        WHERE parent_object.id = NEW.parent_id
          AND parent_object.entity = 'category'
          AND parent_object.current_version_id = parent_object.effective_version_id
          AND parent_version.status = 'EFFECTIVE'
          AND parent_detail.target_entity = NEW.target_entity
    ) THEN
        RAISE EXCEPTION 'category parent must be effective and have the same target entity' USING ERRCODE = '23514';
    END IF;
    IF NEW.parent_id IS NOT NULL AND EXISTS (
        WITH RECURSIVE ancestors(id) AS (
            SELECT NEW.parent_id
            UNION ALL
            SELECT detail.parent_id
            FROM ancestors
            JOIN bob_objects parent_object ON parent_object.id = ancestors.id AND parent_object.entity = 'category'
            JOIN bob_category_versions detail ON detail.version_id = parent_object.current_version_id
            WHERE detail.parent_id IS NOT NULL
        )
        SELECT 1 FROM ancestors WHERE id = category_object_id
    ) THEN
        RAISE EXCEPTION 'category hierarchy contains a cycle' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
-- +goose StatementEnd

-- The shared deferred detail-count trigger is evaluated for every BOB write.
-- Rebuild it against the final detail-table set before any later transaction.
-- +goose StatementBegin
CREATE OR REPLACE FUNCTION bob_validate_version_detail() RETURNS trigger AS $$
DECLARE
    target_id varchar(26);
    detail_count integer;
BEGIN
    IF TG_TABLE_NAME='bob_versions' THEN
        IF TG_OP='DELETE' THEN target_id:=OLD.id; ELSE target_id:=NEW.id; END IF;
    ELSE
        IF TG_OP='DELETE' THEN target_id:=OLD.version_id; ELSE target_id:=NEW.version_id; END IF;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM bob_versions WHERE id=target_id) THEN
        IF TG_OP='DELETE' THEN RETURN OLD; END IF;
        RETURN NEW;
    END IF;
    SELECT
        (SELECT count(*) FROM bob_customer_relationship_versions WHERE version_id=target_id)+
        (SELECT count(*) FROM bob_customer_versions WHERE version_id=target_id)+
        (SELECT count(*) FROM bob_supplier_versions WHERE version_id=target_id)+
        (SELECT count(*) FROM bob_employee_versions WHERE version_id=target_id)+
        (SELECT count(*) FROM bob_product_versions WHERE version_id=target_id)+
        (SELECT count(*) FROM bob_warehouse_versions WHERE version_id=target_id)+
        (SELECT count(*) FROM bob_vehicle_versions WHERE version_id=target_id)+
        (SELECT count(*) FROM bob_fund_account_versions WHERE version_id=target_id)+
        (SELECT count(*) FROM bob_category_versions WHERE version_id=target_id)+
        (SELECT count(*) FROM bob_department_versions WHERE version_id=target_id)+
        (SELECT count(*) FROM bob_position_versions WHERE version_id=target_id)+
        (SELECT count(*) FROM bob_settlement_method_versions WHERE version_id=target_id)+
        (SELECT count(*) FROM bob_operating_entity_versions WHERE version_id=target_id)+
        (SELECT count(*) FROM bob_service_relationship_versions WHERE version_id=target_id)+
        (SELECT count(*) FROM bob_sales_partner_versions WHERE version_id=target_id)
    INTO detail_count;
    IF detail_count<>1 THEN
        RAISE EXCEPTION 'BOB version must have exactly one detail row' USING ERRCODE='23514';
    END IF;
    IF TG_OP='DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
-- +goose StatementEnd

CREATE VIEW bob_version_views AS
SELECT
    o.id AS object_id, o.entity, o.code, o.current_version_id, o.effective_version_id,
    o.revision AS object_revision, o.updated_at AS object_updated_at,
    v.id AS version_id, v.version_no, v.status, v.revision AS version_revision,
    v.created_at, v.created_by, v.updated_at, v.updated_by, v.submitted_at, v.submitted_by,
    v.reviewed_at, v.reviewed_by, v.review_comment,
    COALESCE(c.name,s.name,e.name,p.name,w.name,vh.name,f.name,ca.name,d.name,po.name,sm.name) AS name,
    ''::varchar AS unit, ''::varchar AS inventory_unit_id,
    f.currency, vh.plate_number, vh.vehicle_type, vh.platform_object_id,
    COALESCE(c.customer_type,'') AS customer_type, COALESCE(c.short_name,s.short_name,'') AS short_name,
    COALESCE(c.category_id,s.category_id,e.category_id,p.category_id,w.category_id,vh.category_id,f.category_id,d.category_id,po.category_id,'') AS category_id,
    COALESCE(c.tax_number,s.tax_number,'') AS tax_number, COALESCE(c.contact_name,s.contact_name,w.contact_name,'') AS contact_name,
    COALESCE(c.contact_phone,s.contact_phone,w.contact_phone,'') AS contact_phone, COALESCE(c.email,s.email,e.email,'') AS email,
    COALESCE(c.address,s.address,w.address,'') AS address, COALESCE(c.remark,s.remark,e.remark,p.remark,w.remark,vh.remark,f.remark,'') AS remark,
    COALESCE(e.department_id,'') AS department_id, COALESCE(e.position_id,'') AS position_id, COALESCE(e.phone,'') AS phone,
    CAST(COALESCE(e.hire_date::text,'') AS varchar(10)) AS hire_date, COALESCE(p.specification,'') AS specification,
    COALESCE(p.model,'') AS model, COALESCE(p.barcode,'') AS barcode, COALESCE(ca.description,d.description,po.description,sm.description,'') AS description,
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
LEFT JOIN bob_warehouse_versions w ON w.version_id=v.id LEFT JOIN bob_vehicle_versions vh ON vh.version_id=v.id
LEFT JOIN bob_fund_account_versions f ON f.version_id=v.id LEFT JOIN bob_category_versions ca ON ca.version_id=v.id
LEFT JOIN bob_department_versions d ON d.version_id=v.id LEFT JOIN bob_position_versions po ON po.version_id=v.id
LEFT JOIN bob_objects linked_sm ON linked_sm.id=COALESCE(c.settlement_method_id,s.settlement_method_id) AND linked_sm.entity='settlement-method'
LEFT JOIN aux_objects linked_aux_sm ON linked_aux_sm.id=COALESCE(c.settlement_method_id,s.settlement_method_id) AND linked_aux_sm.entity='settlement-method' AND linked_aux_sm.enabled
LEFT JOIN bob_settlement_method_versions sm ON sm.version_id=v.id LEFT JOIN bob_settlement_method_versions settlement ON settlement.version_id=v.id;

SELECT rpt_validate_current_reports();

-- +goose Down
-- +goose StatementBegin
DO $$ BEGIN RAISE EXCEPTION '00100 standalone Service removal is irreversible'; END $$;
-- +goose StatementEnd

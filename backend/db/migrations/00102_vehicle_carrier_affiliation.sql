-- +goose Up
ALTER TABLE bob_vehicle_versions
    ADD COLUMN carrier_affiliation_type varchar(16),
    ADD COLUMN carrier_operating_entity_id varchar(26),
    ADD COLUMN carrier_operating_entity varchar(16) NOT NULL DEFAULT 'operating-entity' CHECK (carrier_operating_entity = 'operating-entity'),
    ADD COLUMN carrier_service_relationship_object_id varchar(26),
    ADD COLUMN carrier_service_relationship_entity varchar(16) NOT NULL DEFAULT 'other-unit' CHECK (carrier_service_relationship_entity = 'other-unit'),
    ADD COLUMN bulk_liquid_capable boolean NOT NULL DEFAULT false;

UPDATE bob_vehicle_versions
SET carrier_affiliation_type = 'EXTERNAL',
    carrier_service_relationship_object_id = platform_object_id;

-- Updating legacy vehicle details queues deferred detail and uniqueness
-- triggers. Flush them before altering the same table in this transaction.
SET CONSTRAINTS ALL IMMEDIATE;

DROP VIEW bob_version_views;
DROP INDEX bob_vehicle_versions_platform_idx;

ALTER TABLE bob_vehicle_versions
    ALTER COLUMN carrier_affiliation_type SET NOT NULL,
    ADD CONSTRAINT bob_vehicle_versions_carrier_affiliation_type_ck
        CHECK (carrier_affiliation_type IN ('INTERNAL', 'EXTERNAL')),
    ADD CONSTRAINT bob_vehicle_versions_carrier_affiliation_shape_ck CHECK (
        (carrier_affiliation_type = 'INTERNAL'
            AND carrier_operating_entity_id IS NOT NULL
            AND carrier_service_relationship_object_id IS NULL)
        OR
        (carrier_affiliation_type = 'EXTERNAL'
            AND carrier_operating_entity_id IS NULL
            AND carrier_service_relationship_object_id IS NOT NULL)
    ),
    ADD CONSTRAINT bob_vehicle_versions_carrier_operating_fk
        FOREIGN KEY (carrier_operating_entity_id, carrier_operating_entity) REFERENCES bob_objects(id, entity)
        ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
    ADD CONSTRAINT bob_vehicle_versions_carrier_service_relationship_fk
        FOREIGN KEY (carrier_service_relationship_object_id, carrier_service_relationship_entity) REFERENCES bob_objects(id, entity)
        ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
    DROP CONSTRAINT bob_vehicle_versions_platform_object_id_platform_entity_fkey,
    DROP COLUMN platform_object_id,
    DROP COLUMN platform_entity;

CREATE INDEX bob_vehicle_versions_carrier_operating_idx ON bob_vehicle_versions(carrier_operating_entity_id);
CREATE INDEX bob_vehicle_versions_carrier_service_relationship_idx ON bob_vehicle_versions(carrier_service_relationship_object_id);

-- A vehicle remains usable through its last effective version while a
-- candidate is awaiting approval. Both versions therefore reserve their plate
-- number; invalidated history does not. The object-pointer trigger closes the
-- gap between writing a candidate detail and making it current.
-- +goose StatementBegin
CREATE OR REPLACE FUNCTION bob_validate_active_vehicle_plate() RETURNS trigger AS $$
DECLARE
    vehicle_object_id varchar(26);
BEGIN
    IF TG_TABLE_NAME = 'bob_vehicle_versions' THEN
        SELECT object_id INTO vehicle_object_id
        FROM bob_versions WHERE id = NEW.version_id AND entity = 'vehicle';
    ELSIF NEW.entity = 'vehicle' THEN
        vehicle_object_id := NEW.id;
    ELSE
        RETURN NEW;
    END IF;

    IF vehicle_object_id IS NULL THEN
        RETURN NEW;
    END IF;

    PERFORM pg_advisory_xact_lock(hashtextextended('bob.vehicle.plate:' || plate_number, 0))
    FROM (
        SELECT DISTINCT upper(btrim(detail.plate_number)) AS plate_number
        FROM bob_objects object
        JOIN bob_vehicle_versions detail
          ON detail.version_id = object.current_version_id
          OR detail.version_id = object.effective_version_id
        WHERE object.id = vehicle_object_id AND object.entity = 'vehicle'
    ) active_plates
    ORDER BY plate_number;

    IF EXISTS (
        SELECT 1
        FROM bob_objects object
        JOIN bob_vehicle_versions detail
          ON detail.version_id = object.current_version_id
          OR detail.version_id = object.effective_version_id
        JOIN bob_objects other_object
          ON other_object.entity = 'vehicle' AND other_object.id <> object.id
        JOIN bob_vehicle_versions other_detail
          ON other_detail.version_id = other_object.current_version_id
          OR other_detail.version_id = other_object.effective_version_id
        WHERE object.id = vehicle_object_id AND object.entity = 'vehicle'
          AND upper(btrim(detail.plate_number)) = upper(btrim(other_detail.plate_number))
    ) THEN
        RAISE EXCEPTION 'active vehicle plate number must be unique' USING ERRCODE = '23505';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
-- +goose StatementEnd

CREATE CONSTRAINT TRIGGER bob_vehicle_versions_active_plate_uq
AFTER INSERT OR UPDATE OF plate_number ON bob_vehicle_versions DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION bob_validate_active_vehicle_plate();

CREATE CONSTRAINT TRIGGER bob_objects_active_vehicle_plate_uq
AFTER INSERT OR UPDATE OF current_version_id,effective_version_id ON bob_objects DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION bob_validate_active_vehicle_plate();

CREATE VIEW bob_version_views AS
SELECT
    o.id AS object_id, o.entity, o.code, o.current_version_id, o.effective_version_id,
    o.revision AS object_revision, o.updated_at AS object_updated_at,
    v.id AS version_id, v.version_no, v.status, v.revision AS version_revision,
    v.created_at, v.created_by, v.updated_at, v.updated_by, v.submitted_at, v.submitted_by,
    v.reviewed_at, v.reviewed_by, v.review_comment,
    COALESCE(c.name,s.name,e.name,p.name,w.name,vh.name,f.name,ca.name,d.name,po.name,sm.name,oe.legal_name) AS name,
    ''::varchar AS unit, ''::varchar AS inventory_unit_id,
    f.currency, vh.plate_number, vh.vehicle_type, vh.carrier_affiliation_type,
    vh.carrier_operating_entity_id, vh.carrier_service_relationship_object_id, vh.bulk_liquid_capable,
    COALESCE(c.customer_type,'') AS customer_type, COALESCE(c.short_name,s.short_name,oe.short_name,'') AS short_name,
    COALESCE(c.category_id,s.category_id,e.category_id,p.category_id,w.category_id,vh.category_id,f.category_id,d.category_id,po.category_id,'') AS category_id,
    COALESCE(c.tax_number,s.tax_number,oe.tax_number,'') AS tax_number, COALESCE(c.contact_name,s.contact_name,w.contact_name,'') AS contact_name,
    COALESCE(c.contact_phone,s.contact_phone,w.contact_phone,'') AS contact_phone, COALESCE(c.email,s.email,e.email,'') AS email,
    COALESCE(c.address,s.address,w.address,oe.address,'') AS address, COALESCE(c.remark,s.remark,e.remark,p.remark,w.remark,vh.remark,f.remark,oe.remark,'') AS remark,
    COALESCE(e.department_id,'') AS department_id, COALESCE(e.position_id,'') AS position_id, COALESCE(e.phone,oe.phone,'') AS phone,
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
LEFT JOIN bob_warehouse_versions w ON w.version_id=v.id
LEFT JOIN bob_vehicle_versions vh ON vh.version_id=v.id LEFT JOIN bob_fund_account_versions f ON f.version_id=v.id
LEFT JOIN bob_category_versions ca ON ca.version_id=v.id LEFT JOIN bob_department_versions d ON d.version_id=v.id
LEFT JOIN bob_position_versions po ON po.version_id=v.id LEFT JOIN bob_objects linked_sm ON linked_sm.id=COALESCE(c.settlement_method_id,s.settlement_method_id) AND linked_sm.entity='settlement-method'
 LEFT JOIN bob_operating_entity_versions oe ON oe.version_id=v.id
LEFT JOIN aux_objects linked_aux_sm ON linked_aux_sm.id=COALESCE(c.settlement_method_id,s.settlement_method_id) AND linked_aux_sm.entity='settlement-method' AND linked_aux_sm.enabled
LEFT JOIN bob_settlement_method_versions sm ON sm.version_id=v.id LEFT JOIN bob_settlement_method_versions settlement ON settlement.version_id=v.id;

SELECT rpt_validate_current_reports();

-- +goose Down
-- +goose StatementBegin
DO $$ BEGIN RAISE EXCEPTION '00102 vehicle carrier affiliation is irreversible'; END $$;
-- +goose StatementEnd

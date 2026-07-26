-- +goose Up
DROP VIEW bob_version_views;

ALTER TABLE bob_objects
    DROP CONSTRAINT bob_objects_entity_check;

ALTER TABLE bob_objects ALTER COLUMN entity TYPE varchar(32);
ALTER TABLE bob_versions ALTER COLUMN entity TYPE varchar(32);
ALTER TABLE bob_audit_events ALTER COLUMN entity TYPE varchar(32);

ALTER TABLE bob_objects
    ADD CONSTRAINT bob_objects_entity_check
        CHECK (entity IN (
            'customer', 'supplier', 'employee', 'product', 'service', 'warehouse',
            'vehicle', 'fund-account', 'category', 'department', 'position',
            'settlement-method'
        ));

ALTER TABLE bob_customer_versions
    ADD COLUMN settlement_method_id varchar(26),
    ADD COLUMN settlement_method_entity varchar(32) NOT NULL DEFAULT 'settlement-method'
        CHECK (settlement_method_entity = 'settlement-method'),
    ADD FOREIGN KEY (settlement_method_id, settlement_method_entity)
        REFERENCES bob_objects (id, entity) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
    ADD COLUMN salesperson_id varchar(26),
    ADD COLUMN salesperson_entity varchar(32) NOT NULL DEFAULT 'employee'
        CHECK (salesperson_entity = 'employee'),
    ADD FOREIGN KEY (salesperson_id, salesperson_entity)
        REFERENCES bob_objects (id, entity) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE bob_supplier_versions
    ADD COLUMN settlement_method_id varchar(26),
    ADD COLUMN settlement_method_entity varchar(32) NOT NULL DEFAULT 'settlement-method'
        CHECK (settlement_method_entity = 'settlement-method'),
    ADD FOREIGN KEY (settlement_method_id, settlement_method_entity)
        REFERENCES bob_objects (id, entity) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE bob_settlement_method_versions (
    version_id varchar(26) PRIMARY KEY,
    entity varchar(32) NOT NULL DEFAULT 'settlement-method' CHECK (entity = 'settlement-method'),
    name varchar(200) NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 200),
    rule_type varchar(32) NOT NULL CHECK (rule_type IN ('RELATIVE_DAYS', 'MONTH_END', 'FIXED_DAY')),
    month_offset integer NOT NULL DEFAULT 0 CHECK (month_offset BETWEEN 0 AND 120),
    day_of_month integer CHECK (day_of_month BETWEEN 1 AND 31),
    day_offset integer NOT NULL DEFAULT 0 CHECK (day_offset BETWEEN -3650 AND 3650),
    description varchar(1000),
    FOREIGN KEY (version_id, entity)
        REFERENCES bob_versions (id, entity) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
    CONSTRAINT bob_settlement_method_rule_ck CHECK (
        (rule_type = 'RELATIVE_DAYS' AND month_offset = 0 AND day_of_month IS NULL)
        OR (rule_type = 'MONTH_END' AND day_of_month IS NULL)
        OR (rule_type = 'FIXED_DAY' AND day_of_month IS NOT NULL)
    )
);

-- +goose StatementBegin
CREATE OR REPLACE FUNCTION bob_validate_version_detail() RETURNS trigger AS $$
DECLARE
    target_id varchar(26);
    expected_entity varchar(32);
    detail_count integer;
BEGIN
    IF TG_TABLE_NAME = 'bob_versions' THEN
        IF TG_OP = 'DELETE' THEN target_id := OLD.id; ELSE target_id := NEW.id; END IF;
    ELSE
        IF TG_OP = 'DELETE' THEN target_id := OLD.version_id; ELSE target_id := NEW.version_id; END IF;
    END IF;
    SELECT entity INTO expected_entity FROM bob_versions WHERE id = target_id;
    IF NOT FOUND THEN
        IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
        RETURN NEW;
    END IF;

    SELECT
        (SELECT count(*) FROM bob_customer_versions WHERE version_id = target_id) +
        (SELECT count(*) FROM bob_supplier_versions WHERE version_id = target_id) +
        (SELECT count(*) FROM bob_employee_versions WHERE version_id = target_id) +
        (SELECT count(*) FROM bob_product_versions WHERE version_id = target_id) +
        (SELECT count(*) FROM bob_service_versions WHERE version_id = target_id) +
        (SELECT count(*) FROM bob_warehouse_versions WHERE version_id = target_id) +
        (SELECT count(*) FROM bob_vehicle_versions WHERE version_id = target_id) +
        (SELECT count(*) FROM bob_fund_account_versions WHERE version_id = target_id) +
        (SELECT count(*) FROM bob_category_versions WHERE version_id = target_id) +
        (SELECT count(*) FROM bob_department_versions WHERE version_id = target_id) +
        (SELECT count(*) FROM bob_position_versions WHERE version_id = target_id) +
        (SELECT count(*) FROM bob_settlement_method_versions WHERE version_id = target_id)
    INTO detail_count;
    IF detail_count <> 1 THEN
        RAISE EXCEPTION 'BOB version must have exactly one detail row' USING ERRCODE = '23514';
    END IF;
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
-- +goose StatementEnd

CREATE CONSTRAINT TRIGGER bob_settlement_method_versions_detail_ck
    AFTER INSERT OR UPDATE OR DELETE ON bob_settlement_method_versions DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION bob_validate_version_detail();

CREATE VIEW bob_version_views AS
SELECT
    o.id AS object_id,
    o.entity,
    o.code,
    o.current_version_id,
    o.effective_version_id,
    o.revision AS object_revision,
    o.updated_at AS object_updated_at,
    v.id AS version_id,
    v.version_no,
    v.status,
    v.revision AS version_revision,
    v.created_at,
    v.created_by,
    v.updated_at,
    v.updated_by,
    v.submitted_at,
    v.submitted_by,
    v.reviewed_at,
    v.reviewed_by,
    v.review_comment,
    COALESCE(c.name, s.name, e.name, p.name, sv.name, w.name, vh.name, f.name,
             ca.name, d.name, po.name, sm.name) AS name,
    COALESCE(p.unit, sv.unit, '') AS unit,
    f.currency,
    s.supplier_type,
    vh.plate_number,
    vh.vehicle_type,
    vh.platform_object_id,
    COALESCE(c.customer_type, '') AS customer_type,
    COALESCE(c.short_name, s.short_name, '') AS short_name,
    COALESCE(c.category_id, s.category_id, e.category_id, p.category_id, sv.category_id, w.category_id,
             vh.category_id, f.category_id, d.category_id, po.category_id, '') AS category_id,
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
    COALESCE(c.salesperson_id, '') AS salesperson_id,
    COALESCE(linked_sm.effective_version_id, '') AS settlement_method_version_id,
    COALESCE(sm.rule_type, '') AS settlement_rule_type,
    COALESCE(sm.month_offset, 0) AS settlement_month_offset,
    COALESCE(sm.day_of_month, 0) AS settlement_day_of_month,
    COALESCE(sm.day_offset, 0) AS settlement_day_offset
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
LEFT JOIN bob_settlement_method_versions sm ON sm.version_id = v.id;

ALTER TABLE vou_sale_order_details
    ADD COLUMN salesperson_object_id varchar(26),
    ADD COLUMN salesperson_version_id varchar(26),
    ADD COLUMN salesperson_code varchar(64),
    ADD COLUMN salesperson_name varchar(200),
    ADD COLUMN warehouse_object_id varchar(26),
    ADD COLUMN warehouse_version_id varchar(26),
    ADD COLUMN warehouse_code varchar(64),
    ADD COLUMN warehouse_name varchar(200),
    ADD COLUMN contact_name varchar(100),
    ADD COLUMN contact_phone varchar(32),
    ADD COLUMN delivery_address varchar(500),
    ADD COLUMN settlement_method_object_id varchar(26),
    ADD COLUMN settlement_method_version_id varchar(26),
    ADD COLUMN settlement_method_code varchar(64),
    ADD COLUMN settlement_method_name varchar(200),
    ADD COLUMN settlement_rule_type varchar(32),
    ADD COLUMN settlement_month_offset integer,
    ADD COLUMN settlement_day_of_month integer,
    ADD COLUMN settlement_day_offset integer,
    ADD COLUMN settlement_description varchar(1000),
    ADD CONSTRAINT vou_sale_order_salesperson_ck CHECK (
        (salesperson_object_id IS NULL AND salesperson_version_id IS NULL
            AND salesperson_code IS NULL AND salesperson_name IS NULL)
        OR (salesperson_object_id IS NOT NULL AND salesperson_version_id IS NOT NULL
            AND salesperson_code IS NOT NULL AND salesperson_name IS NOT NULL)
    ),
    ADD CONSTRAINT vou_sale_order_warehouse_ck CHECK (
        (warehouse_object_id IS NULL AND warehouse_version_id IS NULL
            AND warehouse_code IS NULL AND warehouse_name IS NULL)
        OR (warehouse_object_id IS NOT NULL AND warehouse_version_id IS NOT NULL
            AND warehouse_code IS NOT NULL AND warehouse_name IS NOT NULL)
    );

ALTER TABLE vou_purchase_order_details
    ADD COLUMN purchaser_object_id varchar(26),
    ADD COLUMN purchaser_version_id varchar(26),
    ADD COLUMN purchaser_code varchar(64),
    ADD COLUMN purchaser_name varchar(200),
    ADD COLUMN warehouse_object_id varchar(26),
    ADD COLUMN warehouse_version_id varchar(26),
    ADD COLUMN warehouse_code varchar(64),
    ADD COLUMN warehouse_name varchar(200),
    ADD COLUMN contact_name varchar(100),
    ADD COLUMN contact_phone varchar(32),
    ADD COLUMN settlement_method_object_id varchar(26),
    ADD COLUMN settlement_method_version_id varchar(26),
    ADD COLUMN settlement_method_code varchar(64),
    ADD COLUMN settlement_method_name varchar(200),
    ADD COLUMN settlement_rule_type varchar(32),
    ADD COLUMN settlement_month_offset integer,
    ADD COLUMN settlement_day_of_month integer,
    ADD COLUMN settlement_day_offset integer,
    ADD COLUMN settlement_description varchar(1000),
    ADD CONSTRAINT vou_purchase_order_purchaser_ck CHECK (
        (purchaser_object_id IS NULL AND purchaser_version_id IS NULL
            AND purchaser_code IS NULL AND purchaser_name IS NULL)
        OR (purchaser_object_id IS NOT NULL AND purchaser_version_id IS NOT NULL
            AND purchaser_code IS NOT NULL AND purchaser_name IS NOT NULL)
    ),
    ADD CONSTRAINT vou_purchase_order_warehouse_ck CHECK (
        (warehouse_object_id IS NULL AND warehouse_version_id IS NULL
            AND warehouse_code IS NULL AND warehouse_name IS NULL)
        OR (warehouse_object_id IS NOT NULL AND warehouse_version_id IS NOT NULL
            AND warehouse_code IS NOT NULL AND warehouse_name IS NOT NULL)
    );

ALTER TABLE vou_intermediary_sale_order_details
    ADD COLUMN salesperson_object_id varchar(26),
    ADD COLUMN salesperson_version_id varchar(26),
    ADD COLUMN salesperson_code varchar(64),
    ADD COLUMN salesperson_name varchar(200),
    ADD COLUMN purchaser_object_id varchar(26),
    ADD COLUMN purchaser_version_id varchar(26),
    ADD COLUMN purchaser_code varchar(64),
    ADD COLUMN purchaser_name varchar(200),
    ADD COLUMN contact_name varchar(100),
    ADD COLUMN contact_phone varchar(32),
    ADD COLUMN delivery_address varchar(500),
    ADD COLUMN customer_settlement_method_object_id varchar(26),
    ADD COLUMN customer_settlement_method_version_id varchar(26),
    ADD COLUMN customer_settlement_method_code varchar(64),
    ADD COLUMN customer_settlement_method_name varchar(200),
    ADD COLUMN customer_settlement_rule_type varchar(32),
    ADD COLUMN customer_settlement_month_offset integer,
    ADD COLUMN customer_settlement_day_of_month integer,
    ADD COLUMN customer_settlement_day_offset integer,
    ADD COLUMN customer_settlement_description varchar(1000),
    ADD COLUMN supplier_settlement_method_object_id varchar(26),
    ADD COLUMN supplier_settlement_method_version_id varchar(26),
    ADD COLUMN supplier_settlement_method_code varchar(64),
    ADD COLUMN supplier_settlement_method_name varchar(200),
    ADD COLUMN supplier_settlement_rule_type varchar(32),
    ADD COLUMN supplier_settlement_month_offset integer,
    ADD COLUMN supplier_settlement_day_of_month integer,
    ADD COLUMN supplier_settlement_day_offset integer,
    ADD COLUMN supplier_settlement_description varchar(1000),
    ADD CONSTRAINT vou_intermediary_salesperson_ck CHECK (
        (salesperson_object_id IS NULL AND salesperson_version_id IS NULL
            AND salesperson_code IS NULL AND salesperson_name IS NULL)
        OR (salesperson_object_id IS NOT NULL AND salesperson_version_id IS NOT NULL
            AND salesperson_code IS NOT NULL AND salesperson_name IS NOT NULL)
    ),
    ADD CONSTRAINT vou_intermediary_purchaser_ck CHECK (
        (purchaser_object_id IS NULL AND purchaser_version_id IS NULL
            AND purchaser_code IS NULL AND purchaser_name IS NULL)
        OR (purchaser_object_id IS NOT NULL AND purchaser_version_id IS NOT NULL
            AND purchaser_code IS NOT NULL AND purchaser_name IS NOT NULL)
    );

ALTER TABLE vou_receipt_details
    ADD COLUMN handler_object_id varchar(26),
    ADD COLUMN handler_version_id varchar(26),
    ADD COLUMN handler_code varchar(64),
    ADD COLUMN handler_name varchar(200),
    ADD CONSTRAINT vou_receipt_handler_ck CHECK (
        (handler_object_id IS NULL AND handler_version_id IS NULL
            AND handler_code IS NULL AND handler_name IS NULL)
        OR (handler_object_id IS NOT NULL AND handler_version_id IS NOT NULL
            AND handler_code IS NOT NULL AND handler_name IS NOT NULL)
    );

ALTER TABLE vou_payment_details
    ADD COLUMN handler_object_id varchar(26),
    ADD COLUMN handler_version_id varchar(26),
    ADD COLUMN handler_code varchar(64),
    ADD COLUMN handler_name varchar(200),
    ADD CONSTRAINT vou_payment_handler_ck CHECK (
        (handler_object_id IS NULL AND handler_version_id IS NULL
            AND handler_code IS NULL AND handler_name IS NULL)
        OR (handler_object_id IS NOT NULL AND handler_version_id IS NOT NULL
            AND handler_code IS NOT NULL AND handler_name IS NOT NULL)
    );

ALTER TABLE vou_other_income_details
    ADD COLUMN handler_object_id varchar(26),
    ADD COLUMN handler_version_id varchar(26),
    ADD COLUMN handler_code varchar(64),
    ADD COLUMN handler_name varchar(200),
    ADD CONSTRAINT vou_other_income_handler_ck CHECK (
        (handler_object_id IS NULL AND handler_version_id IS NULL
            AND handler_code IS NULL AND handler_name IS NULL)
        OR (handler_object_id IS NOT NULL AND handler_version_id IS NOT NULL
            AND handler_code IS NOT NULL AND handler_name IS NOT NULL)
    );

ALTER TABLE vou_product_lines
    ADD COLUMN remark varchar(1000),
    ADD CONSTRAINT vou_product_lines_remark_ck CHECK (
        remark IS NULL OR length(btrim(remark)) BETWEEN 1 AND 1000
    );

ALTER TABLE vou_expense_lines
    ADD COLUMN remark varchar(1000),
    ADD CONSTRAINT vou_expense_lines_remark_ck CHECK (
        remark IS NULL OR length(btrim(remark)) BETWEEN 1 AND 1000
    );

ALTER TABLE vou_sale_order_details
    ADD CONSTRAINT vou_sale_order_settlement_ck CHECK (
        (settlement_method_object_id IS NULL
            AND settlement_method_version_id IS NULL
            AND settlement_method_code IS NULL
            AND settlement_method_name IS NULL
            AND settlement_rule_type IS NULL
            AND settlement_month_offset IS NULL
            AND settlement_day_of_month IS NULL
            AND settlement_day_offset IS NULL
            AND settlement_description IS NULL)
        OR (
            settlement_method_object_id IS NOT NULL
            AND settlement_method_version_id IS NOT NULL
            AND settlement_method_code IS NOT NULL
            AND settlement_method_name IS NOT NULL
            AND settlement_rule_type IN ('RELATIVE_DAYS', 'MONTH_END', 'FIXED_DAY')
            AND settlement_month_offset BETWEEN 0 AND 120
            AND settlement_day_offset BETWEEN -3650 AND 3650
            AND (
                (settlement_rule_type = 'RELATIVE_DAYS'
                    AND settlement_month_offset = 0 AND settlement_day_of_month IS NULL)
                OR (settlement_rule_type = 'MONTH_END' AND settlement_day_of_month IS NULL)
                OR (settlement_rule_type = 'FIXED_DAY' AND settlement_day_of_month BETWEEN 1 AND 31)
            )
        )
    );

ALTER TABLE vou_purchase_order_details
    ADD CONSTRAINT vou_purchase_order_settlement_ck CHECK (
        (settlement_method_object_id IS NULL
            AND settlement_method_version_id IS NULL
            AND settlement_method_code IS NULL
            AND settlement_method_name IS NULL
            AND settlement_rule_type IS NULL
            AND settlement_month_offset IS NULL
            AND settlement_day_of_month IS NULL
            AND settlement_day_offset IS NULL
            AND settlement_description IS NULL)
        OR (
            settlement_method_object_id IS NOT NULL
            AND settlement_method_version_id IS NOT NULL
            AND settlement_method_code IS NOT NULL
            AND settlement_method_name IS NOT NULL
            AND settlement_rule_type IN ('RELATIVE_DAYS', 'MONTH_END', 'FIXED_DAY')
            AND settlement_month_offset BETWEEN 0 AND 120
            AND settlement_day_offset BETWEEN -3650 AND 3650
            AND (
                (settlement_rule_type = 'RELATIVE_DAYS'
                    AND settlement_month_offset = 0 AND settlement_day_of_month IS NULL)
                OR (settlement_rule_type = 'MONTH_END' AND settlement_day_of_month IS NULL)
                OR (settlement_rule_type = 'FIXED_DAY' AND settlement_day_of_month BETWEEN 1 AND 31)
            )
        )
    );

ALTER TABLE vou_intermediary_sale_order_details
    ADD CONSTRAINT vou_intermediary_customer_settlement_ck CHECK (
        (customer_settlement_method_object_id IS NULL
            AND customer_settlement_method_version_id IS NULL
            AND customer_settlement_method_code IS NULL
            AND customer_settlement_method_name IS NULL
            AND customer_settlement_rule_type IS NULL
            AND customer_settlement_month_offset IS NULL
            AND customer_settlement_day_of_month IS NULL
            AND customer_settlement_day_offset IS NULL
            AND customer_settlement_description IS NULL)
        OR (
            customer_settlement_method_object_id IS NOT NULL
            AND customer_settlement_method_version_id IS NOT NULL
            AND customer_settlement_method_code IS NOT NULL
            AND customer_settlement_method_name IS NOT NULL
            AND customer_settlement_rule_type IN ('RELATIVE_DAYS', 'MONTH_END', 'FIXED_DAY')
            AND customer_settlement_month_offset BETWEEN 0 AND 120
            AND customer_settlement_day_offset BETWEEN -3650 AND 3650
            AND (
                (customer_settlement_rule_type = 'RELATIVE_DAYS'
                    AND customer_settlement_month_offset = 0 AND customer_settlement_day_of_month IS NULL)
                OR (customer_settlement_rule_type = 'MONTH_END' AND customer_settlement_day_of_month IS NULL)
                OR (customer_settlement_rule_type = 'FIXED_DAY'
                    AND customer_settlement_day_of_month BETWEEN 1 AND 31)
            )
        )
    ),
    ADD CONSTRAINT vou_intermediary_supplier_settlement_ck CHECK (
        (supplier_settlement_method_object_id IS NULL
            AND supplier_settlement_method_version_id IS NULL
            AND supplier_settlement_method_code IS NULL
            AND supplier_settlement_method_name IS NULL
            AND supplier_settlement_rule_type IS NULL
            AND supplier_settlement_month_offset IS NULL
            AND supplier_settlement_day_of_month IS NULL
            AND supplier_settlement_day_offset IS NULL
            AND supplier_settlement_description IS NULL)
        OR (
            supplier_settlement_method_object_id IS NOT NULL
            AND supplier_settlement_method_version_id IS NOT NULL
            AND supplier_settlement_method_code IS NOT NULL
            AND supplier_settlement_method_name IS NOT NULL
            AND supplier_settlement_rule_type IN ('RELATIVE_DAYS', 'MONTH_END', 'FIXED_DAY')
            AND supplier_settlement_month_offset BETWEEN 0 AND 120
            AND supplier_settlement_day_offset BETWEEN -3650 AND 3650
            AND (
                (supplier_settlement_rule_type = 'RELATIVE_DAYS'
                    AND supplier_settlement_month_offset = 0 AND supplier_settlement_day_of_month IS NULL)
                OR (supplier_settlement_rule_type = 'MONTH_END' AND supplier_settlement_day_of_month IS NULL)
                OR (supplier_settlement_rule_type = 'FIXED_DAY'
                    AND supplier_settlement_day_of_month BETWEEN 1 AND 31)
            )
        )
    );

WITH actions(action, description, offset_no) AS (
    VALUES
        ('approve', '审核通过', 0),
        ('audit-history', '查看审核记录', 1),
        ('create', '创建', 2),
        ('delete', '删除首版草稿', 3),
        ('edit', '发起编辑', 4),
        ('get', '查看', 5),
        ('query', '查询', 6),
        ('reject', '审核驳回', 7),
        ('save', '保存草稿', 8),
        ('submit', '提交审核', 9),
        ('versions', '查看版本', 10)
)
INSERT INTO app_permissions (id, path, domain, entity, action, description, status)
SELECT '01JBOB' || lpad((122 + actions.offset_no)::text, 20, '0'),
       '/bob/settlement-method/' || actions.action,
       'bob', 'settlement-method', actions.action, actions.description || '结算方式', 'ENABLED'
FROM actions;

INSERT INTO app_role_permissions (role_id, permission_id, created_by)
SELECT r.id, p.id, r.updated_by
FROM app_roles r
CROSS JOIN app_permissions p
WHERE r.code = 'superadmin' AND p.domain = 'bob' AND p.entity = 'settlement-method'
ON CONFLICT DO NOTHING;

-- +goose Down
-- +goose StatementBegin
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM bob_objects WHERE entity = 'settlement-method'
        UNION ALL SELECT 1 FROM bob_versions WHERE entity = 'settlement-method'
        UNION ALL SELECT 1 FROM bob_audit_events WHERE entity = 'settlement-method'
        UNION ALL SELECT 1 FROM bob_customer_versions
            WHERE settlement_method_id IS NOT NULL OR salesperson_id IS NOT NULL
        UNION ALL SELECT 1 FROM bob_supplier_versions WHERE settlement_method_id IS NOT NULL
        UNION ALL SELECT 1 FROM vou_sale_order_details WHERE salesperson_object_id IS NOT NULL
            OR warehouse_object_id IS NOT NULL OR settlement_method_object_id IS NOT NULL
        UNION ALL SELECT 1 FROM vou_purchase_order_details WHERE purchaser_object_id IS NOT NULL
            OR warehouse_object_id IS NOT NULL OR settlement_method_object_id IS NOT NULL
        UNION ALL SELECT 1 FROM vou_intermediary_sale_order_details WHERE salesperson_object_id IS NOT NULL
            OR purchaser_object_id IS NOT NULL OR customer_settlement_method_object_id IS NOT NULL
            OR supplier_settlement_method_object_id IS NOT NULL
        UNION ALL SELECT 1 FROM vou_receipt_details WHERE handler_object_id IS NOT NULL
        UNION ALL SELECT 1 FROM vou_payment_details WHERE handler_object_id IS NOT NULL
        UNION ALL SELECT 1 FROM vou_other_income_details WHERE handler_object_id IS NOT NULL
        UNION ALL SELECT 1 FROM vou_product_lines WHERE remark IS NOT NULL
        UNION ALL SELECT 1 FROM vou_expense_lines WHERE remark IS NOT NULL
    ) THEN
        RAISE EXCEPTION 'cannot roll back VOU document attributes while new data exists';
    END IF;
END;
$$;
-- +goose StatementEnd

DELETE FROM app_role_permissions
WHERE permission_id IN (
    SELECT id FROM app_permissions WHERE domain = 'bob' AND entity = 'settlement-method'
);
DELETE FROM app_permissions WHERE domain = 'bob' AND entity = 'settlement-method';

DROP VIEW bob_version_views;

ALTER TABLE vou_expense_lines DROP COLUMN remark;
ALTER TABLE vou_product_lines DROP COLUMN remark;
ALTER TABLE vou_other_income_details
    DROP COLUMN handler_object_id, DROP COLUMN handler_version_id,
    DROP COLUMN handler_code, DROP COLUMN handler_name;
ALTER TABLE vou_payment_details
    DROP COLUMN handler_object_id, DROP COLUMN handler_version_id,
    DROP COLUMN handler_code, DROP COLUMN handler_name;
ALTER TABLE vou_receipt_details
    DROP COLUMN handler_object_id, DROP COLUMN handler_version_id,
    DROP COLUMN handler_code, DROP COLUMN handler_name;
ALTER TABLE vou_intermediary_sale_order_details
    DROP COLUMN salesperson_object_id, DROP COLUMN salesperson_version_id,
    DROP COLUMN salesperson_code, DROP COLUMN salesperson_name,
    DROP COLUMN purchaser_object_id, DROP COLUMN purchaser_version_id,
    DROP COLUMN purchaser_code, DROP COLUMN purchaser_name,
    DROP COLUMN contact_name, DROP COLUMN contact_phone, DROP COLUMN delivery_address,
    DROP COLUMN customer_settlement_method_object_id,
    DROP COLUMN customer_settlement_method_version_id,
    DROP COLUMN customer_settlement_method_code, DROP COLUMN customer_settlement_method_name,
    DROP COLUMN customer_settlement_rule_type, DROP COLUMN customer_settlement_month_offset,
    DROP COLUMN customer_settlement_day_of_month, DROP COLUMN customer_settlement_day_offset,
    DROP COLUMN customer_settlement_description,
    DROP COLUMN supplier_settlement_method_object_id,
    DROP COLUMN supplier_settlement_method_version_id,
    DROP COLUMN supplier_settlement_method_code, DROP COLUMN supplier_settlement_method_name,
    DROP COLUMN supplier_settlement_rule_type, DROP COLUMN supplier_settlement_month_offset,
    DROP COLUMN supplier_settlement_day_of_month, DROP COLUMN supplier_settlement_day_offset,
    DROP COLUMN supplier_settlement_description;
ALTER TABLE vou_purchase_order_details
    DROP COLUMN purchaser_object_id, DROP COLUMN purchaser_version_id,
    DROP COLUMN purchaser_code, DROP COLUMN purchaser_name,
    DROP COLUMN warehouse_object_id, DROP COLUMN warehouse_version_id,
    DROP COLUMN warehouse_code, DROP COLUMN warehouse_name,
    DROP COLUMN contact_name, DROP COLUMN contact_phone,
    DROP COLUMN settlement_method_object_id, DROP COLUMN settlement_method_version_id,
    DROP COLUMN settlement_method_code, DROP COLUMN settlement_method_name,
    DROP COLUMN settlement_rule_type, DROP COLUMN settlement_month_offset,
    DROP COLUMN settlement_day_of_month, DROP COLUMN settlement_day_offset,
    DROP COLUMN settlement_description;
ALTER TABLE vou_sale_order_details
    DROP COLUMN salesperson_object_id, DROP COLUMN salesperson_version_id,
    DROP COLUMN salesperson_code, DROP COLUMN salesperson_name,
    DROP COLUMN warehouse_object_id, DROP COLUMN warehouse_version_id,
    DROP COLUMN warehouse_code, DROP COLUMN warehouse_name,
    DROP COLUMN contact_name, DROP COLUMN contact_phone, DROP COLUMN delivery_address,
    DROP COLUMN settlement_method_object_id, DROP COLUMN settlement_method_version_id,
    DROP COLUMN settlement_method_code, DROP COLUMN settlement_method_name,
    DROP COLUMN settlement_rule_type, DROP COLUMN settlement_month_offset,
    DROP COLUMN settlement_day_of_month, DROP COLUMN settlement_day_offset,
    DROP COLUMN settlement_description;

DROP TRIGGER bob_settlement_method_versions_detail_ck ON bob_settlement_method_versions;
DROP TABLE bob_settlement_method_versions;

ALTER TABLE bob_supplier_versions
    DROP COLUMN settlement_method_id, DROP COLUMN settlement_method_entity;
ALTER TABLE bob_customer_versions
    DROP COLUMN settlement_method_id, DROP COLUMN settlement_method_entity,
    DROP COLUMN salesperson_id, DROP COLUMN salesperson_entity;

-- +goose StatementBegin
CREATE OR REPLACE FUNCTION bob_validate_version_detail() RETURNS trigger AS $$
DECLARE
    target_id varchar(26);
    expected_entity varchar(16);
    detail_count integer;
BEGIN
    IF TG_TABLE_NAME = 'bob_versions' THEN
        IF TG_OP = 'DELETE' THEN target_id := OLD.id; ELSE target_id := NEW.id; END IF;
    ELSE
        IF TG_OP = 'DELETE' THEN target_id := OLD.version_id; ELSE target_id := NEW.version_id; END IF;
    END IF;
    SELECT entity INTO expected_entity FROM bob_versions WHERE id = target_id;
    IF NOT FOUND THEN
        IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
        RETURN NEW;
    END IF;
    SELECT
        (SELECT count(*) FROM bob_customer_versions WHERE version_id = target_id) +
        (SELECT count(*) FROM bob_supplier_versions WHERE version_id = target_id) +
        (SELECT count(*) FROM bob_employee_versions WHERE version_id = target_id) +
        (SELECT count(*) FROM bob_product_versions WHERE version_id = target_id) +
        (SELECT count(*) FROM bob_service_versions WHERE version_id = target_id) +
        (SELECT count(*) FROM bob_warehouse_versions WHERE version_id = target_id) +
        (SELECT count(*) FROM bob_vehicle_versions WHERE version_id = target_id) +
        (SELECT count(*) FROM bob_fund_account_versions WHERE version_id = target_id) +
        (SELECT count(*) FROM bob_category_versions WHERE version_id = target_id) +
        (SELECT count(*) FROM bob_department_versions WHERE version_id = target_id) +
        (SELECT count(*) FROM bob_position_versions WHERE version_id = target_id)
    INTO detail_count;
    IF detail_count <> 1 THEN
        RAISE EXCEPTION 'BOB version must have exactly one detail row' USING ERRCODE = '23514';
    END IF;
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
-- +goose StatementEnd

ALTER TABLE bob_objects
    DROP CONSTRAINT bob_objects_entity_check;
ALTER TABLE bob_audit_events ALTER COLUMN entity TYPE varchar(16);
ALTER TABLE bob_versions ALTER COLUMN entity TYPE varchar(16);
ALTER TABLE bob_objects ALTER COLUMN entity TYPE varchar(16);
ALTER TABLE bob_objects
    ADD CONSTRAINT bob_objects_entity_check
        CHECK (entity IN (
            'customer', 'supplier', 'employee', 'product', 'service', 'warehouse',
            'vehicle', 'fund-account', 'category', 'department', 'position'
        ));

CREATE VIEW bob_version_views AS
SELECT
    o.id AS object_id,
    o.entity,
    o.code,
    o.current_version_id,
    o.effective_version_id,
    o.revision AS object_revision,
    o.updated_at AS object_updated_at,
    v.id AS version_id,
    v.version_no,
    v.status,
    v.revision AS version_revision,
    v.created_at,
    v.created_by,
    v.updated_at,
    v.updated_by,
    v.submitted_at,
    v.submitted_by,
    v.reviewed_at,
    v.reviewed_by,
    v.review_comment,
    COALESCE(c.name, s.name, e.name, p.name, sv.name, w.name, vh.name, f.name, ca.name, d.name, po.name) AS name,
    COALESCE(p.unit, sv.unit, '') AS unit,
    f.currency,
    s.supplier_type,
    vh.plate_number,
    vh.vehicle_type,
    vh.platform_object_id,
    COALESCE(c.customer_type, '') AS customer_type,
    COALESCE(c.short_name, s.short_name, '') AS short_name,
    COALESCE(c.category_id, s.category_id, e.category_id, p.category_id, sv.category_id, w.category_id,
             vh.category_id, f.category_id, d.category_id, po.category_id, '') AS category_id,
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
    COALESCE(sv.description, ca.description, d.description, po.description, '') AS description,
    COALESCE(w.manager_employee_id, '') AS manager_employee_id,
    COALESCE(vh.vin, '') AS vin,
    COALESCE(vh.engine_number, '') AS engine_number,
    CAST(COALESCE(vh.load_capacity_kg::text, '') AS varchar(32)) AS load_capacity_kg,
    COALESCE(f.account_name, '') AS account_name,
    COALESCE(f.bank_name, '') AS bank_name,
    COALESCE(f.bank_branch, '') AS bank_branch,
    COALESCE(f.account_number, '') AS account_number,
    COALESCE(ca.target_entity, '') AS target_entity,
    COALESCE(ca.parent_id, d.parent_id, '') AS parent_id
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
LEFT JOIN bob_position_versions po ON po.version_id = v.id;

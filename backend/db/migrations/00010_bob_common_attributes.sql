-- +goose Up
ALTER TABLE bob_objects
    DROP CONSTRAINT bob_objects_entity_check,
    ADD CONSTRAINT bob_objects_entity_check
        CHECK (entity IN (
            'customer', 'supplier', 'employee', 'product', 'service', 'warehouse',
            'vehicle', 'fund-account', 'category', 'department', 'position'
        ));

ALTER TABLE bob_customer_versions
    ADD COLUMN customer_type varchar(16) NOT NULL DEFAULT 'END_USER'
        CHECK (customer_type IN ('END_USER', 'DEALER')),
    ADD COLUMN short_name varchar(100),
    ADD COLUMN category_id varchar(26),
    ADD COLUMN category_entity varchar(16) NOT NULL DEFAULT 'category' CHECK (category_entity = 'category'),
    ADD COLUMN tax_number varchar(50),
    ADD COLUMN contact_name varchar(100),
    ADD COLUMN contact_phone varchar(32),
    ADD COLUMN email varchar(254),
    ADD COLUMN address varchar(500),
    ADD COLUMN remark varchar(1000),
    ADD FOREIGN KEY (category_id, category_entity)
        REFERENCES bob_objects (id, entity) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE bob_supplier_versions
    ADD COLUMN short_name varchar(100),
    ADD COLUMN category_id varchar(26),
    ADD COLUMN category_entity varchar(16) NOT NULL DEFAULT 'category' CHECK (category_entity = 'category'),
    ADD COLUMN tax_number varchar(50),
    ADD COLUMN contact_name varchar(100),
    ADD COLUMN contact_phone varchar(32),
    ADD COLUMN email varchar(254),
    ADD COLUMN address varchar(500),
    ADD COLUMN remark varchar(1000),
    ADD FOREIGN KEY (category_id, category_entity)
        REFERENCES bob_objects (id, entity) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE bob_employee_versions
    ADD COLUMN category_id varchar(26),
    ADD COLUMN category_entity varchar(16) NOT NULL DEFAULT 'category' CHECK (category_entity = 'category'),
    ADD COLUMN department_id varchar(26),
    ADD COLUMN department_entity varchar(16) NOT NULL DEFAULT 'department' CHECK (department_entity = 'department'),
    ADD COLUMN position_id varchar(26),
    ADD COLUMN position_entity varchar(16) NOT NULL DEFAULT 'position' CHECK (position_entity = 'position'),
    ADD COLUMN phone varchar(32),
    ADD COLUMN email varchar(254),
    ADD COLUMN hire_date date,
    ADD COLUMN remark varchar(1000),
    ADD FOREIGN KEY (category_id, category_entity)
        REFERENCES bob_objects (id, entity) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
    ADD FOREIGN KEY (department_id, department_entity)
        REFERENCES bob_objects (id, entity) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
    ADD FOREIGN KEY (position_id, position_entity)
        REFERENCES bob_objects (id, entity) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE bob_product_versions
    ADD COLUMN category_id varchar(26),
    ADD COLUMN category_entity varchar(16) NOT NULL DEFAULT 'category' CHECK (category_entity = 'category'),
    ADD COLUMN specification varchar(200),
    ADD COLUMN model varchar(200),
    ADD COLUMN barcode varchar(64),
    ADD COLUMN remark varchar(1000),
    ADD FOREIGN KEY (category_id, category_entity)
        REFERENCES bob_objects (id, entity) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE bob_service_versions
    ADD COLUMN category_id varchar(26),
    ADD COLUMN category_entity varchar(16) NOT NULL DEFAULT 'category' CHECK (category_entity = 'category'),
    ADD COLUMN description varchar(1000),
    ADD COLUMN remark varchar(1000),
    ADD FOREIGN KEY (category_id, category_entity)
        REFERENCES bob_objects (id, entity) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE bob_warehouse_versions
    ADD COLUMN category_id varchar(26),
    ADD COLUMN category_entity varchar(16) NOT NULL DEFAULT 'category' CHECK (category_entity = 'category'),
    ADD COLUMN address varchar(500),
    ADD COLUMN contact_name varchar(100),
    ADD COLUMN contact_phone varchar(32),
    ADD COLUMN manager_employee_id varchar(26),
    ADD COLUMN manager_employee_entity varchar(16) NOT NULL DEFAULT 'employee' CHECK (manager_employee_entity = 'employee'),
    ADD COLUMN remark varchar(1000),
    ADD FOREIGN KEY (category_id, category_entity)
        REFERENCES bob_objects (id, entity) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
    ADD FOREIGN KEY (manager_employee_id, manager_employee_entity)
        REFERENCES bob_objects (id, entity) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE bob_vehicle_versions
    ADD COLUMN category_id varchar(26),
    ADD COLUMN category_entity varchar(16) NOT NULL DEFAULT 'category' CHECK (category_entity = 'category'),
    ADD COLUMN vin varchar(17),
    ADD COLUMN engine_number varchar(64),
    ADD COLUMN load_capacity_kg numeric(12,3),
    ADD COLUMN remark varchar(1000),
    ADD FOREIGN KEY (category_id, category_entity)
        REFERENCES bob_objects (id, entity) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
    ADD CHECK (vin IS NULL OR vin ~ '^[A-HJ-NPR-Z0-9]{17}$'),
    ADD CHECK (load_capacity_kg IS NULL OR load_capacity_kg > 0);

ALTER TABLE bob_fund_account_versions
    ADD COLUMN category_id varchar(26),
    ADD COLUMN category_entity varchar(16) NOT NULL DEFAULT 'category' CHECK (category_entity = 'category'),
    ADD COLUMN account_name varchar(200),
    ADD COLUMN bank_name varchar(200),
    ADD COLUMN bank_branch varchar(200),
    ADD COLUMN account_number varchar(64),
    ADD COLUMN remark varchar(1000),
    ADD FOREIGN KEY (category_id, category_entity)
        REFERENCES bob_objects (id, entity) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE bob_category_versions (
    version_id varchar(26) PRIMARY KEY,
    entity varchar(16) NOT NULL DEFAULT 'category' CHECK (entity = 'category'),
    name varchar(200) NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 200),
    target_entity varchar(16) NOT NULL CHECK (target_entity IN (
        'customer', 'supplier', 'employee', 'product', 'service', 'warehouse',
        'vehicle', 'fund-account', 'department', 'position'
    )),
    parent_id varchar(26),
    parent_entity varchar(16) NOT NULL DEFAULT 'category' CHECK (parent_entity = 'category'),
    description varchar(1000),
    FOREIGN KEY (version_id, entity)
        REFERENCES bob_versions (id, entity) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
    FOREIGN KEY (parent_id, parent_entity)
        REFERENCES bob_objects (id, entity) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED
);

CREATE TABLE bob_department_versions (
    version_id varchar(26) PRIMARY KEY,
    entity varchar(16) NOT NULL DEFAULT 'department' CHECK (entity = 'department'),
    name varchar(200) NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 200),
    category_id varchar(26),
    category_entity varchar(16) NOT NULL DEFAULT 'category' CHECK (category_entity = 'category'),
    parent_id varchar(26),
    parent_entity varchar(16) NOT NULL DEFAULT 'department' CHECK (parent_entity = 'department'),
    description varchar(1000),
    FOREIGN KEY (version_id, entity)
        REFERENCES bob_versions (id, entity) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
    FOREIGN KEY (category_id, category_entity)
        REFERENCES bob_objects (id, entity) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
    FOREIGN KEY (parent_id, parent_entity)
        REFERENCES bob_objects (id, entity) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED
);

CREATE TABLE bob_position_versions (
    version_id varchar(26) PRIMARY KEY,
    entity varchar(16) NOT NULL DEFAULT 'position' CHECK (entity = 'position'),
    name varchar(200) NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 200),
    category_id varchar(26),
    category_entity varchar(16) NOT NULL DEFAULT 'category' CHECK (category_entity = 'category'),
    description varchar(1000),
    FOREIGN KEY (version_id, entity)
        REFERENCES bob_versions (id, entity) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
    FOREIGN KEY (category_id, category_entity)
        REFERENCES bob_objects (id, entity) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED
);

CREATE INDEX bob_customer_versions_category_idx ON bob_customer_versions (category_id);
CREATE INDEX bob_supplier_versions_category_idx ON bob_supplier_versions (category_id);
CREATE INDEX bob_employee_versions_category_idx ON bob_employee_versions (category_id);
CREATE INDEX bob_employee_versions_department_idx ON bob_employee_versions (department_id);
CREATE INDEX bob_employee_versions_position_idx ON bob_employee_versions (position_id);
CREATE INDEX bob_product_versions_category_idx ON bob_product_versions (category_id);
CREATE INDEX bob_service_versions_category_idx ON bob_service_versions (category_id);
CREATE INDEX bob_warehouse_versions_category_idx ON bob_warehouse_versions (category_id);
CREATE INDEX bob_warehouse_versions_manager_idx ON bob_warehouse_versions (manager_employee_id);
CREATE INDEX bob_vehicle_versions_category_idx ON bob_vehicle_versions (category_id);
CREATE INDEX bob_fund_account_versions_category_idx ON bob_fund_account_versions (category_id);
CREATE INDEX bob_category_versions_parent_idx ON bob_category_versions (parent_id);
CREATE INDEX bob_department_versions_category_idx ON bob_department_versions (category_id);
CREATE INDEX bob_department_versions_parent_idx ON bob_department_versions (parent_id);
CREATE INDEX bob_position_versions_category_idx ON bob_position_versions (category_id);

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

CREATE CONSTRAINT TRIGGER bob_category_versions_detail_ck
    AFTER INSERT OR UPDATE OR DELETE ON bob_category_versions DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION bob_validate_version_detail();
CREATE CONSTRAINT TRIGGER bob_department_versions_detail_ck
    AFTER INSERT OR UPDATE OR DELETE ON bob_department_versions DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION bob_validate_version_detail();
CREATE CONSTRAINT TRIGGER bob_position_versions_detail_ck
    AFTER INSERT OR UPDATE OR DELETE ON bob_position_versions DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION bob_validate_version_detail();

-- +goose StatementBegin
CREATE FUNCTION bob_validate_current_detail_unique() RETURNS trigger AS $$
DECLARE
    normalized_value text;
    target_object_id varchar(26);
    is_current boolean;
    duplicate_exists boolean;
BEGIN
    normalized_value := upper(btrim(to_jsonb(NEW) ->> TG_ARGV[0]));
    IF normalized_value IS NULL OR normalized_value = '' THEN RETURN NEW; END IF;

    SELECT v.object_id, o.current_version_id = v.id
    INTO target_object_id, is_current
    FROM bob_versions v
    JOIN bob_objects o ON o.id = v.object_id AND o.entity = v.entity
    WHERE v.id = NEW.version_id;
    IF NOT FOUND OR NOT is_current THEN RETURN NEW; END IF;

    PERFORM pg_advisory_xact_lock(hashtextextended(
        'bob.unique:' || TG_TABLE_NAME || ':' || TG_ARGV[0] || ':' || normalized_value, 0
    ));
    EXECUTE format(
        'SELECT EXISTS (
            SELECT 1
            FROM bob_objects o
            JOIN bob_versions v ON v.id = o.current_version_id AND v.object_id = o.id AND v.entity = o.entity
            JOIN %I d ON d.version_id = v.id
            WHERE o.id <> $1 AND upper(btrim(d.%I::text)) = $2
        )',
        TG_TABLE_NAME, TG_ARGV[0]
    ) INTO duplicate_exists USING target_object_id, normalized_value;
    IF duplicate_exists THEN
        RAISE EXCEPTION 'current BOB identifier must be unique' USING ERRCODE = '23505';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
-- +goose StatementEnd

CREATE CONSTRAINT TRIGGER bob_customer_versions_tax_uq
    AFTER INSERT OR UPDATE OF tax_number ON bob_customer_versions DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION bob_validate_current_detail_unique('tax_number');
CREATE CONSTRAINT TRIGGER bob_supplier_versions_tax_uq
    AFTER INSERT OR UPDATE OF tax_number ON bob_supplier_versions DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION bob_validate_current_detail_unique('tax_number');
CREATE CONSTRAINT TRIGGER bob_product_versions_barcode_uq
    AFTER INSERT OR UPDATE OF barcode ON bob_product_versions DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION bob_validate_current_detail_unique('barcode');
CREATE CONSTRAINT TRIGGER bob_vehicle_versions_vin_uq
    AFTER INSERT OR UPDATE OF vin ON bob_vehicle_versions DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION bob_validate_current_detail_unique('vin');
CREATE CONSTRAINT TRIGGER bob_fund_account_versions_account_uq
    AFTER INSERT OR UPDATE OF account_number ON bob_fund_account_versions DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION bob_validate_current_detail_unique('account_number');

-- +goose StatementBegin
CREATE FUNCTION bob_validate_category_tree() RETURNS trigger AS $$
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
        UNION ALL SELECT 1 FROM bob_service_versions x WHERE x.category_id = category_object_id
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

CREATE CONSTRAINT TRIGGER bob_category_versions_tree_ck
    AFTER INSERT OR UPDATE OF target_entity, parent_id ON bob_category_versions DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION bob_validate_category_tree();

-- +goose StatementBegin
CREATE FUNCTION bob_validate_department_tree() RETURNS trigger AS $$
DECLARE
    department_object_id varchar(26);
    is_current boolean;
BEGIN
    SELECT v.object_id, o.current_version_id = v.id
    INTO department_object_id, is_current
    FROM bob_versions v
    JOIN bob_objects o ON o.id = v.object_id AND o.entity = v.entity
    WHERE v.id = NEW.version_id AND v.entity = 'department';
    IF NOT FOUND OR NOT is_current THEN RETURN NEW; END IF;

    PERFORM pg_advisory_xact_lock(hashtextextended('bob.department.tree', 0));
    IF NEW.parent_id = department_object_id THEN
        RAISE EXCEPTION 'department cannot be its own parent' USING ERRCODE = '23514';
    END IF;
    IF NEW.parent_id IS NOT NULL AND NOT EXISTS (
        SELECT 1
        FROM bob_objects parent_object
        JOIN bob_versions parent_version ON parent_version.id = parent_object.effective_version_id
        WHERE parent_object.id = NEW.parent_id
          AND parent_object.entity = 'department'
          AND parent_object.current_version_id = parent_object.effective_version_id
          AND parent_version.status = 'EFFECTIVE'
    ) THEN
        RAISE EXCEPTION 'department parent must be effective' USING ERRCODE = '23514';
    END IF;
    IF NEW.parent_id IS NOT NULL AND EXISTS (
        WITH RECURSIVE ancestors(id) AS (
            SELECT NEW.parent_id
            UNION ALL
            SELECT detail.parent_id
            FROM ancestors
            JOIN bob_objects parent_object ON parent_object.id = ancestors.id AND parent_object.entity = 'department'
            JOIN bob_department_versions detail ON detail.version_id = parent_object.current_version_id
            WHERE detail.parent_id IS NOT NULL
        )
        SELECT 1 FROM ancestors WHERE id = department_object_id
    ) THEN
        RAISE EXCEPTION 'department hierarchy contains a cycle' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
-- +goose StatementEnd

CREATE CONSTRAINT TRIGGER bob_department_versions_tree_ck
    AFTER INSERT OR UPDATE OF parent_id ON bob_department_versions DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION bob_validate_department_tree();

CREATE OR REPLACE VIEW bob_version_views AS
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

WITH entities(entity, description, first_seq) AS (
    VALUES
        ('category', '分类', 89),
        ('department', '部门', 100),
        ('position', '岗位', 111)
),
actions(action, description, offset_no) AS (
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
SELECT '01JBOB' || lpad((entities.first_seq + actions.offset_no)::text, 20, '0'),
       '/bob/' || entities.entity || '/' || actions.action,
       'bob', entities.entity, actions.action, actions.description || entities.description, 'ENABLED'
FROM entities CROSS JOIN actions;

-- +goose Down
-- +goose StatementBegin
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM bob_objects WHERE entity IN ('category', 'department', 'position')) THEN
        RAISE EXCEPTION 'cannot roll back BOB common attributes while new reference objects exist';
    END IF;
    IF EXISTS (
        SELECT 1 FROM bob_customer_versions
        WHERE customer_type <> 'END_USER' OR short_name IS NOT NULL OR category_id IS NOT NULL
           OR tax_number IS NOT NULL OR contact_name IS NOT NULL OR contact_phone IS NOT NULL
           OR email IS NOT NULL OR address IS NOT NULL OR remark IS NOT NULL
        UNION ALL
        SELECT 1 FROM bob_supplier_versions
        WHERE short_name IS NOT NULL OR category_id IS NOT NULL OR tax_number IS NOT NULL
           OR contact_name IS NOT NULL OR contact_phone IS NOT NULL OR email IS NOT NULL
           OR address IS NOT NULL OR remark IS NOT NULL
        UNION ALL
        SELECT 1 FROM bob_employee_versions
        WHERE category_id IS NOT NULL OR department_id IS NOT NULL OR position_id IS NOT NULL
           OR phone IS NOT NULL OR email IS NOT NULL OR hire_date IS NOT NULL OR remark IS NOT NULL
        UNION ALL
        SELECT 1 FROM bob_product_versions
        WHERE category_id IS NOT NULL OR specification IS NOT NULL OR model IS NOT NULL
           OR barcode IS NOT NULL OR remark IS NOT NULL
        UNION ALL
        SELECT 1 FROM bob_service_versions
        WHERE category_id IS NOT NULL OR description IS NOT NULL OR remark IS NOT NULL
        UNION ALL
        SELECT 1 FROM bob_warehouse_versions
        WHERE category_id IS NOT NULL OR address IS NOT NULL OR contact_name IS NOT NULL
           OR contact_phone IS NOT NULL OR manager_employee_id IS NOT NULL OR remark IS NOT NULL
        UNION ALL
        SELECT 1 FROM bob_vehicle_versions
        WHERE category_id IS NOT NULL OR vin IS NOT NULL OR engine_number IS NOT NULL
           OR load_capacity_kg IS NOT NULL OR remark IS NOT NULL
        UNION ALL
        SELECT 1 FROM bob_fund_account_versions
        WHERE category_id IS NOT NULL OR account_name IS NOT NULL OR bank_name IS NOT NULL
           OR bank_branch IS NOT NULL OR account_number IS NOT NULL OR remark IS NOT NULL
    ) THEN
        RAISE EXCEPTION 'cannot roll back BOB common attributes while attribute data exists';
    END IF;
END;
$$;
-- +goose StatementEnd

DELETE FROM app_role_permissions
WHERE permission_id IN (
    SELECT id FROM app_permissions WHERE domain = 'bob' AND entity IN ('category', 'department', 'position')
);
DELETE FROM app_permissions
WHERE domain = 'bob' AND entity IN ('category', 'department', 'position');

DROP VIEW bob_version_views;

DROP TRIGGER bob_department_versions_tree_ck ON bob_department_versions;
DROP FUNCTION bob_validate_department_tree();
DROP TRIGGER bob_category_versions_tree_ck ON bob_category_versions;
DROP FUNCTION bob_validate_category_tree();
DROP TRIGGER bob_fund_account_versions_account_uq ON bob_fund_account_versions;
DROP TRIGGER bob_vehicle_versions_vin_uq ON bob_vehicle_versions;
DROP TRIGGER bob_product_versions_barcode_uq ON bob_product_versions;
DROP TRIGGER bob_supplier_versions_tax_uq ON bob_supplier_versions;
DROP TRIGGER bob_customer_versions_tax_uq ON bob_customer_versions;
DROP FUNCTION bob_validate_current_detail_unique();
DROP TRIGGER bob_position_versions_detail_ck ON bob_position_versions;
DROP TRIGGER bob_department_versions_detail_ck ON bob_department_versions;
DROP TRIGGER bob_category_versions_detail_ck ON bob_category_versions;

DROP TABLE bob_position_versions;
DROP TABLE bob_department_versions;
DROP TABLE bob_category_versions;

ALTER TABLE bob_fund_account_versions
    DROP COLUMN category_id, DROP COLUMN category_entity, DROP COLUMN account_name,
    DROP COLUMN bank_name, DROP COLUMN bank_branch, DROP COLUMN account_number, DROP COLUMN remark;
ALTER TABLE bob_vehicle_versions
    DROP COLUMN category_id, DROP COLUMN category_entity, DROP COLUMN vin,
    DROP COLUMN engine_number, DROP COLUMN load_capacity_kg, DROP COLUMN remark;
ALTER TABLE bob_warehouse_versions
    DROP COLUMN category_id, DROP COLUMN category_entity, DROP COLUMN address,
    DROP COLUMN contact_name, DROP COLUMN contact_phone, DROP COLUMN manager_employee_id,
    DROP COLUMN manager_employee_entity, DROP COLUMN remark;
ALTER TABLE bob_service_versions
    DROP COLUMN category_id, DROP COLUMN category_entity, DROP COLUMN description, DROP COLUMN remark;
ALTER TABLE bob_product_versions
    DROP COLUMN category_id, DROP COLUMN category_entity, DROP COLUMN specification,
    DROP COLUMN model, DROP COLUMN barcode, DROP COLUMN remark;
ALTER TABLE bob_employee_versions
    DROP COLUMN category_id, DROP COLUMN category_entity, DROP COLUMN department_id,
    DROP COLUMN department_entity, DROP COLUMN position_id, DROP COLUMN position_entity,
    DROP COLUMN phone, DROP COLUMN email, DROP COLUMN hire_date, DROP COLUMN remark;
ALTER TABLE bob_supplier_versions
    DROP COLUMN short_name, DROP COLUMN category_id, DROP COLUMN category_entity,
    DROP COLUMN tax_number, DROP COLUMN contact_name, DROP COLUMN contact_phone,
    DROP COLUMN email, DROP COLUMN address, DROP COLUMN remark;
ALTER TABLE bob_customer_versions
    DROP COLUMN customer_type, DROP COLUMN short_name, DROP COLUMN category_id,
    DROP COLUMN category_entity, DROP COLUMN tax_number, DROP COLUMN contact_name,
    DROP COLUMN contact_phone, DROP COLUMN email, DROP COLUMN address, DROP COLUMN remark;

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
        (SELECT count(*) FROM bob_fund_account_versions WHERE version_id = target_id)
    INTO detail_count;
    IF detail_count <> 1 THEN
        RAISE EXCEPTION 'BOB version must have exactly one detail row' USING ERRCODE = '23514';
    END IF;
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
-- +goose StatementEnd

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
    COALESCE(c.name, s.name, e.name, p.name, sv.name, w.name, vh.name, f.name) AS name,
    COALESCE(p.unit, sv.unit, '') AS unit,
    f.currency,
    s.supplier_type,
    vh.plate_number,
    vh.vehicle_type,
    vh.platform_object_id
FROM bob_objects o
JOIN bob_versions v ON v.object_id = o.id AND v.entity = o.entity
LEFT JOIN bob_customer_versions c ON c.version_id = v.id
LEFT JOIN bob_supplier_versions s ON s.version_id = v.id
LEFT JOIN bob_employee_versions e ON e.version_id = v.id
LEFT JOIN bob_product_versions p ON p.version_id = v.id
LEFT JOIN bob_service_versions sv ON sv.version_id = v.id
LEFT JOIN bob_warehouse_versions w ON w.version_id = v.id
LEFT JOIN bob_vehicle_versions vh ON vh.version_id = v.id
LEFT JOIN bob_fund_account_versions f ON f.version_id = v.id;

ALTER TABLE bob_objects
    DROP CONSTRAINT bob_objects_entity_check,
    ADD CONSTRAINT bob_objects_entity_check
        CHECK (entity IN (
            'customer', 'supplier', 'employee', 'product', 'service',
            'warehouse', 'vehicle', 'fund-account'
        ));

-- +goose Up
ALTER TABLE bob_objects
    DROP CONSTRAINT bob_objects_entity_check,
    ADD CONSTRAINT bob_objects_entity_check
        CHECK (entity IN ('customer', 'supplier', 'employee', 'product', 'service', 'warehouse', 'vehicle', 'fund-account'));

ALTER TABLE bob_supplier_versions
    ADD COLUMN supplier_type varchar(32) NOT NULL DEFAULT 'GENERAL'
        CONSTRAINT bob_supplier_versions_supplier_type_ck
        CHECK (supplier_type IN ('GENERAL', 'LOGISTICS_PLATFORM'));

CREATE TABLE bob_vehicle_versions (
    version_id varchar(26) PRIMARY KEY,
    entity varchar(16) NOT NULL DEFAULT 'vehicle' CHECK (entity = 'vehicle'),
    name varchar(200) NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 200),
    plate_number varchar(32) NOT NULL CHECK (
        length(btrim(plate_number)) BETWEEN 1 AND 32
        AND plate_number = upper(btrim(plate_number))
    ),
    vehicle_type varchar(64) NOT NULL CHECK (length(btrim(vehicle_type)) BETWEEN 1 AND 64),
    platform_object_id varchar(26) NOT NULL,
    platform_entity varchar(16) NOT NULL DEFAULT 'supplier' CHECK (platform_entity = 'supplier'),
    FOREIGN KEY (version_id, entity)
        REFERENCES bob_versions (id, entity) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
    FOREIGN KEY (platform_object_id, platform_entity)
        REFERENCES bob_objects (id, entity) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED
);
CREATE INDEX bob_vehicle_versions_platform_idx ON bob_vehicle_versions (platform_object_id);

-- +goose StatementBegin
CREATE OR REPLACE FUNCTION bob_validate_version_detail() RETURNS trigger AS $$
DECLARE
    target_id varchar(26);
    expected_entity varchar(16);
    detail_count integer;
BEGIN
    IF TG_TABLE_NAME = 'bob_versions' THEN
        IF TG_OP = 'DELETE' THEN
            target_id := OLD.id;
        ELSE
            target_id := NEW.id;
        END IF;
    ELSE
        IF TG_OP = 'DELETE' THEN
            target_id := OLD.version_id;
        ELSE
            target_id := NEW.version_id;
        END IF;
    END IF;
    SELECT entity INTO expected_entity FROM bob_versions WHERE id = target_id;
    IF NOT FOUND THEN
        IF TG_OP = 'DELETE' THEN
            RETURN OLD;
        END IF;
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
    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
-- +goose StatementEnd

CREATE CONSTRAINT TRIGGER bob_vehicle_versions_detail_ck
    AFTER INSERT OR UPDATE OR DELETE ON bob_vehicle_versions DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION bob_validate_version_detail();

-- +goose StatementBegin
CREATE FUNCTION bob_validate_current_vehicle_plate() RETURNS trigger AS $$
DECLARE
    vehicle_object_id varchar(26);
    is_current boolean;
BEGIN
    SELECT v.object_id, o.current_version_id = v.id
    INTO vehicle_object_id, is_current
    FROM bob_versions v
    JOIN bob_objects o ON o.id = v.object_id AND o.entity = v.entity
    WHERE v.id = NEW.version_id AND v.entity = 'vehicle';

    IF NOT FOUND OR NOT is_current THEN
        RETURN NEW;
    END IF;

    PERFORM pg_advisory_xact_lock(
        hashtextextended('bob.vehicle.plate:' || upper(btrim(NEW.plate_number)), 0)
    );

    IF EXISTS (
        SELECT 1
        FROM bob_objects other_object
        JOIN bob_versions other_version
          ON other_version.id = other_object.current_version_id
         AND other_version.object_id = other_object.id
         AND other_version.entity = other_object.entity
        JOIN bob_vehicle_versions other_detail ON other_detail.version_id = other_version.id
        WHERE other_object.entity = 'vehicle'
          AND other_object.id <> vehicle_object_id
          AND upper(btrim(other_detail.plate_number)) = upper(btrim(NEW.plate_number))
    ) THEN
        RAISE EXCEPTION 'current vehicle plate number must be unique' USING ERRCODE = '23505';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
-- +goose StatementEnd

CREATE CONSTRAINT TRIGGER bob_vehicle_versions_plate_uq
    AFTER INSERT OR UPDATE OF plate_number ON bob_vehicle_versions DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION bob_validate_current_vehicle_plate();

-- +goose StatementBegin
CREATE FUNCTION bob_prevent_platform_type_downgrade() RETURNS trigger AS $$
DECLARE
    supplier_object_id varchar(26);
    is_current boolean;
BEGIN
    IF NEW.supplier_type = 'LOGISTICS_PLATFORM' THEN
        RETURN NEW;
    END IF;

    SELECT v.object_id, o.current_version_id = v.id
    INTO supplier_object_id, is_current
    FROM bob_versions v
    JOIN bob_objects o ON o.id = v.object_id AND o.entity = v.entity
    WHERE v.id = NEW.version_id AND v.entity = 'supplier';

    IF NOT FOUND OR NOT is_current THEN
        RETURN NEW;
    END IF;

    IF EXISTS (
        SELECT 1
        FROM bob_objects vehicle_object
        JOIN bob_vehicle_versions vehicle_detail
          ON vehicle_detail.version_id = vehicle_object.current_version_id
        WHERE vehicle_object.entity = 'vehicle'
          AND vehicle_detail.platform_object_id = supplier_object_id
    ) THEN
        RAISE EXCEPTION 'logistics platform with current vehicles cannot become a general supplier'
            USING ERRCODE = '23505';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
-- +goose StatementEnd

CREATE CONSTRAINT TRIGGER bob_supplier_versions_platform_type_ck
    AFTER INSERT OR UPDATE OF supplier_type ON bob_supplier_versions DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION bob_prevent_platform_type_downgrade();

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

WITH actions(action, description, seq) AS (
    VALUES
        ('approve', '审核通过', 71),
        ('audit-history', '查看审核记录', 72),
        ('create', '创建', 73),
        ('edit', '发起编辑', 74),
        ('get', '查看', 75),
        ('query', '查询', 76),
        ('reject', '审核驳回', 77),
        ('save', '保存草稿', 78),
        ('submit', '提交审核', 79),
        ('versions', '查看版本', 80)
)
INSERT INTO app_permissions (id, path, domain, entity, action, description, status)
SELECT '01JBOB' || lpad(seq::text, 20, '0'), '/bob/vehicle/' || action,
       'bob', 'vehicle', action, description || '车辆', 'ENABLED'
FROM actions;

INSERT INTO app_role_permissions (role_id, permission_id, created_by)
SELECT r.id, p.id, r.updated_by
FROM app_roles r
CROSS JOIN app_permissions p
WHERE r.code = 'superadmin' AND p.domain = 'bob' AND p.entity = 'vehicle'
ON CONFLICT DO NOTHING;

-- +goose Down
-- +goose StatementBegin
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM bob_objects WHERE entity = 'vehicle') THEN
        RAISE EXCEPTION 'cannot roll back BOB vehicle migration while vehicle objects exist';
    END IF;
    IF EXISTS (SELECT 1 FROM bob_supplier_versions WHERE supplier_type = 'LOGISTICS_PLATFORM') THEN
        RAISE EXCEPTION 'cannot roll back BOB vehicle migration while logistics platform suppliers exist';
    END IF;
END;
$$;
-- +goose StatementEnd

DELETE FROM app_role_permissions
WHERE permission_id IN (
    SELECT id FROM app_permissions WHERE domain = 'bob' AND entity = 'vehicle'
);
DELETE FROM app_permissions WHERE domain = 'bob' AND entity = 'vehicle';

DROP VIEW bob_version_views;
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
    COALESCE(c.name, s.name, e.name, p.name, sv.name, w.name, f.name) AS name,
    COALESCE(p.unit, sv.unit, '') AS unit,
    f.currency
FROM bob_objects o
JOIN bob_versions v ON v.object_id = o.id AND v.entity = o.entity
LEFT JOIN bob_customer_versions c ON c.version_id = v.id
LEFT JOIN bob_supplier_versions s ON s.version_id = v.id
LEFT JOIN bob_employee_versions e ON e.version_id = v.id
LEFT JOIN bob_product_versions p ON p.version_id = v.id
LEFT JOIN bob_service_versions sv ON sv.version_id = v.id
LEFT JOIN bob_warehouse_versions w ON w.version_id = v.id
LEFT JOIN bob_fund_account_versions f ON f.version_id = v.id;

DROP TRIGGER bob_supplier_versions_platform_type_ck ON bob_supplier_versions;
DROP FUNCTION bob_prevent_platform_type_downgrade();
DROP TRIGGER bob_vehicle_versions_plate_uq ON bob_vehicle_versions;
DROP FUNCTION bob_validate_current_vehicle_plate();
DROP TRIGGER bob_vehicle_versions_detail_ck ON bob_vehicle_versions;

-- +goose StatementBegin
CREATE OR REPLACE FUNCTION bob_validate_version_detail() RETURNS trigger AS $$
DECLARE
    target_id varchar(26);
    expected_entity varchar(16);
    detail_count integer;
BEGIN
    IF TG_TABLE_NAME = 'bob_versions' THEN
        IF TG_OP = 'DELETE' THEN
            target_id := OLD.id;
        ELSE
            target_id := NEW.id;
        END IF;
    ELSE
        IF TG_OP = 'DELETE' THEN
            target_id := OLD.version_id;
        ELSE
            target_id := NEW.version_id;
        END IF;
    END IF;
    SELECT entity INTO expected_entity FROM bob_versions WHERE id = target_id;
    IF NOT FOUND THEN
        IF TG_OP = 'DELETE' THEN
            RETURN OLD;
        END IF;
        RETURN NEW;
    END IF;

    SELECT
        (SELECT count(*) FROM bob_customer_versions WHERE version_id = target_id) +
        (SELECT count(*) FROM bob_supplier_versions WHERE version_id = target_id) +
        (SELECT count(*) FROM bob_employee_versions WHERE version_id = target_id) +
        (SELECT count(*) FROM bob_product_versions WHERE version_id = target_id) +
        (SELECT count(*) FROM bob_service_versions WHERE version_id = target_id) +
        (SELECT count(*) FROM bob_warehouse_versions WHERE version_id = target_id) +
        (SELECT count(*) FROM bob_fund_account_versions WHERE version_id = target_id)
    INTO detail_count;

    IF detail_count <> 1 THEN
        RAISE EXCEPTION 'BOB version must have exactly one detail row' USING ERRCODE = '23514';
    END IF;
    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
-- +goose StatementEnd

DROP INDEX bob_vehicle_versions_platform_idx;
DROP TABLE bob_vehicle_versions;
ALTER TABLE bob_supplier_versions DROP COLUMN supplier_type;

ALTER TABLE bob_objects
    DROP CONSTRAINT bob_objects_entity_check,
    ADD CONSTRAINT bob_objects_entity_check
        CHECK (entity IN ('customer', 'supplier', 'employee', 'product', 'service', 'warehouse', 'fund-account'));

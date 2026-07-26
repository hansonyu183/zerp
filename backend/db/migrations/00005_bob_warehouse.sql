-- +goose Up
ALTER TABLE bob_objects
    DROP CONSTRAINT bob_objects_entity_check,
    ADD CONSTRAINT bob_objects_entity_check
        CHECK (entity IN ('customer', 'supplier', 'employee', 'product', 'service', 'warehouse', 'fund-account'));

CREATE TABLE bob_warehouse_versions (
    version_id varchar(26) PRIMARY KEY,
    entity varchar(16) NOT NULL DEFAULT 'warehouse' CHECK (entity = 'warehouse'),
    name varchar(200) NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 200),
    FOREIGN KEY (version_id, entity) REFERENCES bob_versions (id, entity) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED
);

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

CREATE CONSTRAINT TRIGGER bob_warehouse_versions_detail_ck
    AFTER INSERT OR UPDATE OR DELETE ON bob_warehouse_versions DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION bob_validate_version_detail();

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

WITH actions(action, description, seq) AS (
    VALUES
        ('approve', '审核通过', 61),
        ('audit-history', '查看审核记录', 62),
        ('create', '创建', 63),
        ('edit', '发起编辑', 64),
        ('get', '查看', 65),
        ('query', '查询', 66),
        ('reject', '审核驳回', 67),
        ('save', '保存草稿', 68),
        ('submit', '提交审核', 69),
        ('versions', '查看版本', 70)
)
INSERT INTO app_permissions (id, path, domain, entity, action, description, status)
SELECT '01JBOB' || lpad(seq::text, 20, '0'), '/bob/warehouse/' || action,
       'bob', 'warehouse', action, description || '仓库', 'ENABLED'
FROM actions;

INSERT INTO app_role_permissions (role_id, permission_id, created_by)
SELECT r.id, p.id, r.updated_by
FROM app_roles r
CROSS JOIN app_permissions p
WHERE r.code = 'superadmin' AND p.domain = 'bob' AND p.entity = 'warehouse'
ON CONFLICT DO NOTHING;

-- +goose Down
-- +goose StatementBegin
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM bob_objects WHERE entity = 'warehouse') THEN
        RAISE EXCEPTION 'cannot roll back BOB warehouse migration while warehouse objects exist';
    END IF;
END;
$$;
-- +goose StatementEnd

DELETE FROM app_role_permissions
WHERE permission_id IN (
    SELECT id FROM app_permissions WHERE domain = 'bob' AND entity = 'warehouse'
);
DELETE FROM app_permissions WHERE domain = 'bob' AND entity = 'warehouse';

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
    COALESCE(c.name, s.name, e.name, p.name, sv.name, f.name) AS name,
    COALESCE(p.unit, sv.unit, '') AS unit,
    f.currency
FROM bob_objects o
JOIN bob_versions v ON v.object_id = o.id AND v.entity = o.entity
LEFT JOIN bob_customer_versions c ON c.version_id = v.id
LEFT JOIN bob_supplier_versions s ON s.version_id = v.id
LEFT JOIN bob_employee_versions e ON e.version_id = v.id
LEFT JOIN bob_product_versions p ON p.version_id = v.id
LEFT JOIN bob_service_versions sv ON sv.version_id = v.id
LEFT JOIN bob_fund_account_versions f ON f.version_id = v.id;

DROP TRIGGER bob_warehouse_versions_detail_ck ON bob_warehouse_versions;

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

DROP TABLE bob_warehouse_versions;

ALTER TABLE bob_objects
    DROP CONSTRAINT bob_objects_entity_check,
    ADD CONSTRAINT bob_objects_entity_check
        CHECK (entity IN ('customer', 'supplier', 'employee', 'product', 'service', 'fund-account'));

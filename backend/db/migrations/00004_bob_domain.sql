-- +goose Up
CREATE TABLE bob_objects (
    id varchar(26) PRIMARY KEY,
    entity varchar(16) NOT NULL CHECK (entity IN ('customer', 'supplier', 'employee', 'product', 'service', 'fund-account')),
    code varchar(64) NOT NULL CHECK (code ~ '^[A-Z0-9][A-Z0-9._-]*$'),
    current_version_id varchar(26) NOT NULL,
    effective_version_id varchar(26),
    next_version_no integer NOT NULL DEFAULT 2 CHECK (next_version_no >= 2),
    revision bigint NOT NULL DEFAULT 1 CHECK (revision >= 1),
    created_at timestamptz NOT NULL DEFAULT now(),
    created_by varchar(26) NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now(),
    updated_by varchar(26) NOT NULL,
    UNIQUE (id, entity)
);
CREATE UNIQUE INDEX bob_objects_entity_code_uq ON bob_objects (entity, upper(code));
CREATE INDEX bob_objects_entity_updated_idx ON bob_objects (entity, updated_at DESC, id DESC);

CREATE TABLE bob_versions (
    id varchar(26) PRIMARY KEY,
    object_id varchar(26) NOT NULL,
    entity varchar(16) NOT NULL,
    version_no integer NOT NULL CHECK (version_no >= 1),
    status varchar(16) NOT NULL CHECK (status IN ('DRAFT', 'PENDING', 'REJECTED', 'EFFECTIVE', 'INVALID')),
    revision bigint NOT NULL DEFAULT 1 CHECK (revision >= 1),
    created_at timestamptz NOT NULL DEFAULT now(),
    created_by varchar(26) NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now(),
    updated_by varchar(26) NOT NULL,
    submitted_at timestamptz,
    submitted_by varchar(26),
    reviewed_at timestamptz,
    reviewed_by varchar(26),
    review_comment varchar(1000),
    CONSTRAINT bob_versions_object_entity_fk FOREIGN KEY (object_id, entity)
        REFERENCES bob_objects (id, entity) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
    CONSTRAINT bob_versions_number_uq UNIQUE (object_id, version_no),
    CONSTRAINT bob_versions_pointer_target_uq UNIQUE (id, object_id, entity),
    CONSTRAINT bob_versions_id_entity_uq UNIQUE (id, entity),
    CONSTRAINT bob_versions_review_separation CHECK (
        submitted_by IS NULL OR reviewed_by IS NULL OR submitted_by <> reviewed_by
    ),
    CONSTRAINT bob_versions_status_audit_ck CHECK (
        (status = 'DRAFT' AND submitted_at IS NULL AND submitted_by IS NULL AND reviewed_at IS NULL AND reviewed_by IS NULL)
        OR (status = 'PENDING' AND submitted_at IS NOT NULL AND submitted_by IS NOT NULL AND reviewed_at IS NULL AND reviewed_by IS NULL)
        OR (status IN ('REJECTED', 'EFFECTIVE', 'INVALID') AND submitted_at IS NOT NULL AND submitted_by IS NOT NULL AND reviewed_at IS NOT NULL AND reviewed_by IS NOT NULL)
    )
);
CREATE UNIQUE INDEX bob_versions_effective_uq ON bob_versions (object_id) WHERE status = 'EFFECTIVE';
CREATE UNIQUE INDEX bob_versions_candidate_uq ON bob_versions (object_id) WHERE status IN ('DRAFT', 'PENDING', 'REJECTED');
CREATE INDEX bob_versions_history_idx ON bob_versions (object_id, version_no DESC);

ALTER TABLE bob_objects
    ADD CONSTRAINT bob_objects_current_version_fk
    FOREIGN KEY (current_version_id, id, entity)
    REFERENCES bob_versions (id, object_id, entity)
    ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE bob_objects
    ADD CONSTRAINT bob_objects_effective_version_fk
    FOREIGN KEY (effective_version_id, id, entity)
    REFERENCES bob_versions (id, object_id, entity)
    ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE bob_customer_versions (
    version_id varchar(26) PRIMARY KEY,
    entity varchar(16) NOT NULL DEFAULT 'customer' CHECK (entity = 'customer'),
    name varchar(200) NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 200),
    FOREIGN KEY (version_id, entity) REFERENCES bob_versions (id, entity) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED
);
CREATE TABLE bob_supplier_versions (
    version_id varchar(26) PRIMARY KEY,
    entity varchar(16) NOT NULL DEFAULT 'supplier' CHECK (entity = 'supplier'),
    name varchar(200) NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 200),
    FOREIGN KEY (version_id, entity) REFERENCES bob_versions (id, entity) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED
);
CREATE TABLE bob_employee_versions (
    version_id varchar(26) PRIMARY KEY,
    entity varchar(16) NOT NULL DEFAULT 'employee' CHECK (entity = 'employee'),
    name varchar(200) NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 200),
    FOREIGN KEY (version_id, entity) REFERENCES bob_versions (id, entity) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED
);
CREATE TABLE bob_product_versions (
    version_id varchar(26) PRIMARY KEY,
    entity varchar(16) NOT NULL DEFAULT 'product' CHECK (entity = 'product'),
    name varchar(200) NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 200),
    unit varchar(32) NOT NULL CHECK (length(btrim(unit)) BETWEEN 1 AND 32),
    FOREIGN KEY (version_id, entity) REFERENCES bob_versions (id, entity) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED
);
CREATE TABLE bob_service_versions (
    version_id varchar(26) PRIMARY KEY,
    entity varchar(16) NOT NULL DEFAULT 'service' CHECK (entity = 'service'),
    name varchar(200) NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 200),
    unit varchar(32) NOT NULL CHECK (length(btrim(unit)) BETWEEN 1 AND 32),
    FOREIGN KEY (version_id, entity) REFERENCES bob_versions (id, entity) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED
);
CREATE TABLE bob_fund_account_versions (
    version_id varchar(26) PRIMARY KEY,
    entity varchar(16) NOT NULL DEFAULT 'fund-account' CHECK (entity = 'fund-account'),
    name varchar(200) NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 200),
    currency varchar(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
    FOREIGN KEY (version_id, entity) REFERENCES bob_versions (id, entity) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED
);

-- +goose StatementBegin
CREATE FUNCTION bob_validate_version_detail() RETURNS trigger AS $$
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

CREATE CONSTRAINT TRIGGER bob_versions_detail_ck
    AFTER INSERT OR UPDATE ON bob_versions DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION bob_validate_version_detail();
CREATE CONSTRAINT TRIGGER bob_customer_versions_detail_ck
    AFTER INSERT OR UPDATE OR DELETE ON bob_customer_versions DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION bob_validate_version_detail();
CREATE CONSTRAINT TRIGGER bob_supplier_versions_detail_ck
    AFTER INSERT OR UPDATE OR DELETE ON bob_supplier_versions DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION bob_validate_version_detail();
CREATE CONSTRAINT TRIGGER bob_employee_versions_detail_ck
    AFTER INSERT OR UPDATE OR DELETE ON bob_employee_versions DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION bob_validate_version_detail();
CREATE CONSTRAINT TRIGGER bob_product_versions_detail_ck
    AFTER INSERT OR UPDATE OR DELETE ON bob_product_versions DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION bob_validate_version_detail();
CREATE CONSTRAINT TRIGGER bob_service_versions_detail_ck
    AFTER INSERT OR UPDATE OR DELETE ON bob_service_versions DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION bob_validate_version_detail();
CREATE CONSTRAINT TRIGGER bob_fund_account_versions_detail_ck
    AFTER INSERT OR UPDATE OR DELETE ON bob_fund_account_versions DEFERRABLE INITIALLY DEFERRED
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

CREATE TABLE bob_audit_events (
    id varchar(26) PRIMARY KEY,
    object_id varchar(26) NOT NULL REFERENCES bob_objects(id) ON DELETE RESTRICT,
    version_id varchar(26) NOT NULL REFERENCES bob_versions(id) ON DELETE RESTRICT,
    entity varchar(16) NOT NULL,
    event_type varchar(32) NOT NULL CHECK (event_type IN ('CREATED', 'EDIT_STARTED', 'SAVED', 'SUBMITTED', 'APPROVED', 'REJECTED', 'INVALIDATED')),
    from_status varchar(16) CHECK (from_status IS NULL OR from_status IN ('DRAFT', 'PENDING', 'REJECTED', 'EFFECTIVE', 'INVALID')),
    to_status varchar(16) NOT NULL CHECK (to_status IN ('DRAFT', 'PENDING', 'REJECTED', 'EFFECTIVE', 'INVALID')),
    actor_id varchar(26) NOT NULL,
    occurred_at timestamptz NOT NULL DEFAULT now(),
    comment varchar(1000),
    request_id varchar(128) NOT NULL,
    summary jsonb NOT NULL DEFAULT '{}'::jsonb,
    FOREIGN KEY (version_id, object_id, entity) REFERENCES bob_versions(id, object_id, entity) ON DELETE RESTRICT
);
CREATE INDEX bob_audit_events_history_idx ON bob_audit_events (object_id, occurred_at DESC, id DESC);

WITH actions(action, description) AS (
    VALUES
        ('query', '查询'), ('get', '查看'), ('create', '创建'), ('edit', '发起编辑'), ('save', '保存草稿'),
        ('submit', '提交审核'), ('approve', '审核通过'), ('reject', '审核驳回'), ('versions', '查看版本'), ('audit-history', '查看审核记录')
), entities(entity, description, ordinal) AS (
    VALUES
        ('customer', '客户', 0), ('supplier', '供应商', 1), ('employee', '员工', 2),
        ('product', '产品', 3), ('service', '服务', 4), ('fund-account', '资金账户', 5)
), numbered AS (
    SELECT e.entity, e.description AS entity_description, a.action, a.description AS action_description,
           e.ordinal * 10 + row_number() OVER (PARTITION BY e.entity ORDER BY a.action) AS seq
    FROM entities e CROSS JOIN actions a
)
INSERT INTO app_permissions (id, path, domain, entity, action, description, status)
SELECT '01JBOB' || lpad(seq::text, 20, '0'), '/bob/' || entity || '/' || action,
       'bob', entity, action, action_description || entity_description, 'ENABLED'
FROM numbered;

INSERT INTO app_role_permissions (role_id, permission_id, created_by)
SELECT r.id, p.id, r.updated_by
FROM app_roles r
CROSS JOIN app_permissions p
WHERE r.code = 'superadmin' AND p.domain = 'bob'
ON CONFLICT DO NOTHING;

-- +goose Down
DELETE FROM app_role_permissions WHERE permission_id IN (SELECT id FROM app_permissions WHERE domain = 'bob');
DELETE FROM app_permissions WHERE domain = 'bob';
DROP TABLE bob_audit_events;
DROP VIEW bob_version_views;
DROP TRIGGER bob_fund_account_versions_detail_ck ON bob_fund_account_versions;
DROP TRIGGER bob_service_versions_detail_ck ON bob_service_versions;
DROP TRIGGER bob_product_versions_detail_ck ON bob_product_versions;
DROP TRIGGER bob_employee_versions_detail_ck ON bob_employee_versions;
DROP TRIGGER bob_supplier_versions_detail_ck ON bob_supplier_versions;
DROP TRIGGER bob_customer_versions_detail_ck ON bob_customer_versions;
DROP TRIGGER bob_versions_detail_ck ON bob_versions;
DROP FUNCTION bob_validate_version_detail();
DROP TABLE bob_fund_account_versions;
DROP TABLE bob_service_versions;
DROP TABLE bob_product_versions;
DROP TABLE bob_employee_versions;
DROP TABLE bob_supplier_versions;
DROP TABLE bob_customer_versions;
ALTER TABLE bob_objects DROP CONSTRAINT bob_objects_effective_version_fk;
ALTER TABLE bob_objects DROP CONSTRAINT bob_objects_current_version_fk;
DROP TABLE bob_versions;
DROP TABLE bob_objects;

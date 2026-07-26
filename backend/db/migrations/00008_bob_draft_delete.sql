-- +goose Up
ALTER TABLE bob_objects
    DROP CONSTRAINT bob_objects_current_version_fk,
    ADD CONSTRAINT bob_objects_current_version_fk
        FOREIGN KEY (current_version_id, id, entity)
        REFERENCES bob_versions (id, object_id, entity)
        ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
    DROP CONSTRAINT bob_objects_effective_version_fk,
    ADD CONSTRAINT bob_objects_effective_version_fk
        FOREIGN KEY (effective_version_id, id, entity)
        REFERENCES bob_versions (id, object_id, entity)
        ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE bob_versions
    DROP CONSTRAINT bob_versions_object_entity_fk,
    ADD CONSTRAINT bob_versions_object_entity_fk
        FOREIGN KEY (object_id, entity)
        REFERENCES bob_objects (id, entity)
        ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED;

WITH entities(entity, description, seq) AS (
    VALUES
        ('customer', '客户', 81),
        ('supplier', '供应商', 82),
        ('employee', '员工', 83),
        ('product', '产品', 84),
        ('service', '服务', 85),
        ('warehouse', '仓库', 86),
        ('vehicle', '车辆', 87),
        ('fund-account', '资金账户', 88)
)
INSERT INTO app_permissions (id, path, domain, entity, action, description, status)
SELECT '01JBOB' || lpad(seq::text, 20, '0'),
       '/bob/' || entity || '/delete',
       'bob', entity, 'delete', '删除首版草稿' || description, 'ENABLED'
FROM entities;

-- Delete is intentionally not granted to any existing role. Administrators
-- must opt roles into this destructive action explicitly.

-- +goose Down
DELETE FROM app_role_permissions
WHERE permission_id IN (
    SELECT id FROM app_permissions WHERE domain = 'bob' AND action = 'delete'
);
DELETE FROM app_permissions WHERE domain = 'bob' AND action = 'delete';

ALTER TABLE bob_versions
    DROP CONSTRAINT bob_versions_object_entity_fk,
    ADD CONSTRAINT bob_versions_object_entity_fk
        FOREIGN KEY (object_id, entity)
        REFERENCES bob_objects (id, entity)
        ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE bob_objects
    DROP CONSTRAINT bob_objects_current_version_fk,
    ADD CONSTRAINT bob_objects_current_version_fk
        FOREIGN KEY (current_version_id, id, entity)
        REFERENCES bob_versions (id, object_id, entity)
        ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
    DROP CONSTRAINT bob_objects_effective_version_fk,
    ADD CONSTRAINT bob_objects_effective_version_fk
        FOREIGN KEY (effective_version_id, id, entity)
        REFERENCES bob_versions (id, object_id, entity)
        ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;

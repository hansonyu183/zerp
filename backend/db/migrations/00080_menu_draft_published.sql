-- +goose Up

ALTER TABLE app_business_menu_items
    DROP CONSTRAINT app_business_menu_items_parent_fk;

DROP INDEX app_business_menu_items_workbench_route_idx;

ALTER TABLE app_business_menu_items
    DROP CONSTRAINT app_business_menu_items_pkey;

ALTER TABLE app_business_menu_items
    ADD COLUMN snapshot_type varchar(16) NOT NULL DEFAULT 'DRAFT'
        CHECK (snapshot_type IN ('DRAFT', 'PUBLISHED'));

ALTER TABLE app_business_menu_items
    ADD PRIMARY KEY (snapshot_type, id);

ALTER TABLE app_business_menu_items
    ADD CONSTRAINT app_business_menu_items_parent_fk
        FOREIGN KEY (snapshot_type, parent_id)
        REFERENCES app_business_menu_items(snapshot_type, id)
        ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX app_business_menu_items_snapshot_parent_order_idx
    ON app_business_menu_items(snapshot_type, parent_id, sort_order, id);

CREATE UNIQUE INDEX app_business_menu_items_workbench_route_idx
    ON app_business_menu_items(snapshot_type, route_key)
    WHERE route_key = 'home/dashboard';

-- The legacy template becomes the draft.  Publishing starts from an exact,
-- independent copy so no existing installation changes its active navigation.
WITH next_revision AS (
    SELECT COALESCE(max(revision), 1)::bigint + 1 AS value
    FROM app_business_menu_items
)
UPDATE app_business_menu_items item
SET snapshot_type = 'DRAFT',
    revision = next_revision.value,
    route_key = CASE route_key
        WHEN 'admin/user' THEN 'app/user'
        WHEN 'admin/role' THEN 'app/role'
        WHEN 'admin/permission' THEN 'app/permission'
        WHEN 'admin/system-parameter' THEN 'app/system-parameter'
        WHEN 'admin/menu' THEN 'app/menu'
        ELSE route_key
    END,
    updated_at = now(),
    updated_by = '01JAPPSYST3MACTR0000000000'
FROM next_revision;

INSERT INTO app_business_menu_items (
    snapshot_type, id, parent_id, item_type, item_level, sort_order,
    display_name, icon, enabled, route_key, permission_code, revision,
    created_at, created_by, updated_at, updated_by
)
SELECT
    'PUBLISHED', id, parent_id, item_type, item_level, sort_order,
    display_name, icon, enabled, route_key, permission_code, revision,
    created_at, created_by, updated_at, updated_by
FROM app_business_menu_items
WHERE snapshot_type = 'DRAFT';

INSERT INTO app_permissions (id, path, domain, entity, action, description, status)
VALUES ('01JAPPMENU0000000000000004', '/app/menu/publish-business-template', 'app', 'menu', 'publish-business-template', '发布业务菜单模板', 'ENABLED')
ON CONFLICT (path) DO UPDATE
SET description = EXCLUDED.description, status = EXCLUDED.status;

-- +goose Down
-- +goose StatementBegin
DO $$
BEGIN
    RAISE EXCEPTION 'migration 00080 is irreversible; restore the database and previous image';
END
$$;
-- +goose StatementEnd

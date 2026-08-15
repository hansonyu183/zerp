-- +goose Up
ALTER TABLE app_business_menu_items
    DROP CONSTRAINT app_business_menu_items_shape;

ALTER TABLE app_business_menu_items
    ADD CONSTRAINT app_business_menu_items_shape CHECK (
        (item_type = 'GROUP' AND item_level = 1 AND parent_id IS NULL
            AND route_key IS NULL AND permission_code IS NULL)
        OR
        (item_type = 'ROUTE' AND item_level = 1 AND parent_id IS NULL
            AND route_key IS NOT NULL AND permission_code IS NOT NULL)
        OR
        (item_type = 'ROUTE' AND item_level = 2 AND parent_id IS NOT NULL
            AND route_key IS NOT NULL AND permission_code IS NOT NULL)
    );

-- +goose StatementBegin
DO $$
DECLARE
    current_revision bigint;
    fallback_group_id varchar(64);
    workbench_route_id varchar(64);
BEGIN
    SELECT COALESCE(max(revision), 1)
    INTO current_revision
    FROM app_business_menu_items;

    -- Remove both the legacy entry and any disabled tombstone before creating
    -- the sole direct Workbench route.
    DELETE FROM app_business_menu_items
    WHERE route_key = 'home/dashboard';

    SELECT id
    INTO fallback_group_id
    FROM app_business_menu_items
    WHERE item_type = 'GROUP'
      AND enabled
      AND id <> 'menu-group-workbench'
      AND id <> 'menu-group-route-tombstones'
    ORDER BY sort_order, id
    LIMIT 1;

    IF fallback_group_id IS NULL THEN
        -- A pre-change template has at most 1000 items, so one of these 1001
        -- deterministic IDs is free without relying on random generation.
        SELECT format('menu-group-workbench-fallback-%s', candidate)
        INTO fallback_group_id
        FROM generate_series(0, 1000) AS candidates(candidate)
        WHERE NOT EXISTS (
            SELECT 1
            FROM app_business_menu_items
            WHERE id = format('menu-group-workbench-fallback-%s', candidate)
        )
        ORDER BY candidate
        LIMIT 1;

        IF fallback_group_id IS NULL THEN
            RAISE EXCEPTION 'no deterministic fallback menu group ID is available';
        END IF;

        INSERT INTO app_business_menu_items (
            id, item_type, item_level, sort_order, display_name, icon, enabled,
            revision, created_by, updated_by
        ) VALUES (
            fallback_group_id, 'GROUP', 1, 0, '其他/待归类',
            'mdi-folder-question-outline', true, current_revision,
            '01JAPPSYST3MACTR0000000000', '01JAPPSYST3MACTR0000000000'
        );
    END IF;

    UPDATE app_business_menu_items
    SET parent_id = fallback_group_id,
        revision = current_revision,
        updated_at = now(),
        updated_by = '01JAPPSYST3MACTR0000000000'
    WHERE parent_id = 'menu-group-workbench';

    DELETE FROM app_business_menu_items
    WHERE id = 'menu-group-workbench';

    -- Keep tombstones for other routes, but drop the now-empty reserved group.
    DELETE FROM app_business_menu_items AS group_item
    WHERE group_item.id = 'menu-group-route-tombstones'
      AND NOT EXISTS (
          SELECT 1
          FROM app_business_menu_items AS child
          WHERE child.parent_id = group_item.id
      );

    SELECT format('menu-route-workbench-direct-%s', candidate)
    INTO workbench_route_id
    FROM generate_series(0, 1000) AS candidates(candidate)
    WHERE NOT EXISTS (
        SELECT 1
        FROM app_business_menu_items
        WHERE id = format('menu-route-workbench-direct-%s', candidate)
    )
    ORDER BY candidate
    LIMIT 1;

    IF workbench_route_id IS NULL THEN
        RAISE EXCEPTION 'no deterministic direct Workbench route ID is available';
    END IF;

    INSERT INTO app_business_menu_items (
        id, item_type, item_level, sort_order, display_name, icon, enabled,
        route_key, permission_code, revision, created_by, updated_by
    ) VALUES (
        workbench_route_id, 'ROUTE', 1, 10, '工作台',
        'mdi-view-dashboard-outline', true, 'home/dashboard',
        '/app/workbench/query', current_revision,
        '01JAPPSYST3MACTR0000000000', '01JAPPSYST3MACTR0000000000'
    );

    UPDATE app_business_menu_items
    SET revision = current_revision,
        updated_at = now(),
        updated_by = '01JAPPSYST3MACTR0000000000'
    WHERE revision IS DISTINCT FROM current_revision;
END
$$;
-- +goose StatementEnd

-- The self-referencing parent FK is initially deferred. Flush its queued
-- checks before PostgreSQL rebuilds indexes on the table.
SET CONSTRAINTS app_business_menu_items_parent_fk IMMEDIATE;

CREATE UNIQUE INDEX app_business_menu_items_workbench_route_idx
    ON app_business_menu_items(route_key)
    WHERE route_key = 'home/dashboard';

SELECT rpt_validate_current_reports();

-- +goose Down
DROP INDEX app_business_menu_items_workbench_route_idx;

INSERT INTO app_business_menu_items (
    id, item_type, item_level, sort_order, display_name, icon, enabled,
    revision, created_by, updated_by
)
SELECT
    'menu-group-workbench', 'GROUP', 1, 10, '工作台', 'mdi-view-dashboard-outline', true,
    revision, created_by, updated_by
FROM app_business_menu_items
WHERE route_key = 'home/dashboard'
LIMIT 1;

UPDATE app_business_menu_items
SET parent_id = 'menu-group-workbench', item_level = 2
WHERE route_key = 'home/dashboard';

ALTER TABLE app_business_menu_items
    DROP CONSTRAINT app_business_menu_items_shape;

ALTER TABLE app_business_menu_items
    ADD CONSTRAINT app_business_menu_items_shape CHECK (
        (item_type = 'GROUP' AND item_level = 1 AND parent_id IS NULL
            AND route_key IS NULL AND permission_code IS NULL)
        OR
        (item_type = 'ROUTE' AND item_level = 2 AND parent_id IS NOT NULL
            AND route_key IS NOT NULL AND permission_code IS NOT NULL)
    );

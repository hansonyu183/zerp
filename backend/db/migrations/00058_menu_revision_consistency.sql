-- +goose Up

WITH current_revision AS (
    SELECT COALESCE(max(revision), 1)::bigint AS revision
    FROM app_business_menu_items
)
DELETE FROM app_business_menu_items AS item
USING current_revision
WHERE current_revision.revision > 1
  AND item.revision <> current_revision.revision
  AND item.id IN (
      'menu-route-intermediary-calculation',
      'menu-route-other-payable'
  );

WITH current_revision AS (
    SELECT COALESCE(max(revision), 1)::bigint AS revision
    FROM app_business_menu_items
), routes(
    id, parent_id, sort_order, display_name, icon, route_key, permission_code
) AS (VALUES
    ('menu-route-intermediary-calculation', 'menu-group-sales', 45,
     '居间计算', 'mdi-calculator-variant-outline',
     'vou/intermediary-calculation', '/vou/intermediary-calculation/query'),
    ('menu-route-other-payable', 'menu-group-accounting', 20,
     '其它应付', 'mdi-account-cash-outline',
     'led/other-payable', '/led/other-payable/query')
)
INSERT INTO app_business_menu_items(
    id, parent_id, item_type, item_level, sort_order, display_name, icon,
    enabled, route_key, permission_code, revision, created_by, updated_by
)
SELECT
    routes.id, routes.parent_id, 'ROUTE', 2, routes.sort_order,
    routes.display_name, routes.icon, true, routes.route_key,
    routes.permission_code, current_revision.revision,
    '01JAPPSYST3MACTR0000000000', '01JAPPSYST3MACTR0000000000'
FROM routes
CROSS JOIN current_revision
WHERE current_revision.revision = 1
  AND EXISTS (
      SELECT 1
      FROM app_business_menu_items AS parent
      WHERE parent.id = routes.parent_id
        AND parent.item_type = 'GROUP'
  )
ON CONFLICT(id) DO NOTHING;

-- +goose Down
-- +goose StatementBegin
DO $$
BEGIN
    RAISE EXCEPTION 'migration 00058 is irreversible; restore the database and previous image';
END
$$;
-- +goose StatementEnd

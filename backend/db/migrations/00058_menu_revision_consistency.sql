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

-- +goose Down
-- +goose StatementBegin
DO $$
BEGIN
    RAISE EXCEPTION 'migration 00058 is irreversible; restore the database and previous image';
END
$$;
-- +goose StatementEnd

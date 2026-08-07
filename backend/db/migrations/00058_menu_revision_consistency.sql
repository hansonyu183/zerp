-- +goose Up

WITH current_revision AS (
    SELECT COALESCE(max(revision), 1)::bigint AS revision
    FROM app_business_menu_items
)
UPDATE app_business_menu_items AS item
SET revision = current_revision.revision,
    updated_at = now()
FROM current_revision
WHERE item.revision <> current_revision.revision;

-- +goose Down
-- +goose StatementBegin
DO $$
BEGIN
    RAISE EXCEPTION 'migration 00058 is irreversible; restore the database and previous image';
END
$$;
-- +goose StatementEnd

-- +goose Up

DELETE FROM app_business_menu_items
WHERE route_key='aux/account-subject'
   OR permission_code LIKE '/aux/account-subject/%';

DELETE FROM app_role_permissions
WHERE permission_id IN (
    SELECT id FROM app_permissions
    WHERE domain='aux' AND entity='account-subject'
);
DELETE FROM app_permissions
WHERE domain='aux' AND entity='account-subject';

DELETE FROM object_number_counters
WHERE domain='aux' AND entity='account-subject';
DELETE FROM identifier_object_renumber_history
WHERE domain='aux' AND entity='account-subject';

-- Accounting subjects are owned by ACC per accounting book. AUX no longer
-- stores a global subject tree or a direct subject mapping on business types.
UPDATE aux_versions AS version
SET data = version.data - 'accountSubjectId'
FROM aux_objects AS object
WHERE object.id=version.object_id
  AND object.entity='income-expense-type'
  AND version.data ? 'accountSubjectId';

DELETE FROM aux_audit_events
WHERE entity='account-subject'
   OR object_id IN (
       SELECT id FROM aux_objects WHERE entity='account-subject'
   );
DELETE FROM aux_versions WHERE entity='account-subject';
DELETE FROM aux_objects WHERE entity='account-subject';
SET CONSTRAINTS ALL IMMEDIATE;

ALTER TABLE aux_objects DROP CONSTRAINT aux_objects_entity_check;
ALTER TABLE aux_objects ADD CONSTRAINT aux_objects_entity_check CHECK (entity IN (
    'product-category','department','position','settlement-method','dictionary-type',
    'dictionary-item','measurement-unit','income-expense-type','asset-category'
));

SELECT rpt_validate_current_reports();

-- +goose Down
-- +goose StatementBegin
DO $$
BEGIN
    RAISE EXCEPTION 'migration 00074 is irreversible; the duplicate AUX accounting-subject model was intentionally removed';
END
$$;
-- +goose StatementEnd

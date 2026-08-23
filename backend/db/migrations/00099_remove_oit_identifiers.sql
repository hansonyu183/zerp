-- +goose Up
-- +goose StatementBegin
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM bob_objects WHERE oit_id IS NOT NULL)
       OR EXISTS (SELECT 1 FROM aux_objects WHERE oit_id IS NOT NULL)
       OR EXISTS (SELECT 1 FROM vou_documents WHERE oit_id IS NOT NULL) THEN
        RAISE EXCEPTION '00099 cannot remove non-empty OIT identifiers; rebuild the environment without OIT mappings';
    END IF;
END $$;
-- +goose StatementEnd

DROP INDEX bob_objects_entity_oit_id_uq;
ALTER TABLE bob_objects DROP CONSTRAINT bob_objects_oit_id_ck;
ALTER TABLE bob_objects DROP COLUMN oit_id;

DROP INDEX aux_objects_entity_oit_id_uq;
ALTER TABLE aux_objects DROP CONSTRAINT aux_objects_oit_id_ck;
ALTER TABLE aux_objects DROP COLUMN oit_id;

DROP INDEX vou_documents_entity_oit_id_uq;
ALTER TABLE vou_documents DROP CONSTRAINT vou_documents_oit_id_ck;
ALTER TABLE vou_documents DROP COLUMN oit_id;

SELECT rpt_validate_current_reports();

-- +goose Down
-- +goose StatementBegin
DO $$ BEGIN RAISE EXCEPTION '00099 OIT identifier removal is irreversible'; END $$;
-- +goose StatementEnd

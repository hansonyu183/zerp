-- +goose Up
ALTER TABLE bob_objects
    ADD COLUMN oit_id varchar(64),
    ADD CONSTRAINT bob_objects_oit_id_ck CHECK (
        oit_id IS NULL OR (oit_id = btrim(oit_id) AND length(oit_id) BETWEEN 1 AND 64)
    );
CREATE UNIQUE INDEX bob_objects_entity_oit_id_uq
    ON bob_objects (entity, oit_id) WHERE oit_id IS NOT NULL;

ALTER TABLE aux_objects
    ADD COLUMN oit_id varchar(64),
    ADD CONSTRAINT aux_objects_oit_id_ck CHECK (
        oit_id IS NULL OR (oit_id = btrim(oit_id) AND length(oit_id) BETWEEN 1 AND 64)
    );
CREATE UNIQUE INDEX aux_objects_entity_oit_id_uq
    ON aux_objects (entity, oit_id) WHERE oit_id IS NOT NULL;

ALTER TABLE vou_documents
    ADD COLUMN oit_id varchar(64),
    ADD CONSTRAINT vou_documents_oit_id_ck CHECK (
        oit_id IS NULL OR (oit_id = btrim(oit_id) AND length(oit_id) BETWEEN 1 AND 64)
    );
CREATE UNIQUE INDEX vou_documents_entity_oit_id_uq
    ON vou_documents (entity, oit_id) WHERE oit_id IS NOT NULL;

-- +goose Down
DROP INDEX vou_documents_entity_oit_id_uq;
ALTER TABLE vou_documents DROP CONSTRAINT vou_documents_oit_id_ck;
ALTER TABLE vou_documents DROP COLUMN oit_id;

DROP INDEX aux_objects_entity_oit_id_uq;
ALTER TABLE aux_objects DROP CONSTRAINT aux_objects_oit_id_ck;
ALTER TABLE aux_objects DROP COLUMN oit_id;

DROP INDEX bob_objects_entity_oit_id_uq;
ALTER TABLE bob_objects DROP CONSTRAINT bob_objects_oit_id_ck;
ALTER TABLE bob_objects DROP COLUMN oit_id;

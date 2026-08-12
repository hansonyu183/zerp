-- +goose Up

ALTER TABLE acc_vouchers
    ADD COLUMN source_entity varchar(64),
    ADD COLUMN source_revision bigint,
    ADD COLUMN source_document_no varchar(64),
    ADD CONSTRAINT acc_vouchers_vou_source_check CHECK (
        source_type <> 'VOU'
        OR (
            source_entity IS NOT NULL
            AND source_revision IS NOT NULL AND source_revision >= 1
            AND source_document_no IS NOT NULL AND btrim(source_document_no) <> ''
            AND mapping_version_id IS NOT NULL
        )
    );

CREATE UNIQUE INDEX acc_vouchers_vou_source_idx
    ON acc_vouchers (book_id, source_entity, source_id)
    WHERE source_type = 'VOU';

-- +goose Down

DROP INDEX acc_vouchers_vou_source_idx;
ALTER TABLE acc_vouchers
    DROP CONSTRAINT acc_vouchers_vou_source_check,
    DROP COLUMN source_document_no,
    DROP COLUMN source_revision,
    DROP COLUMN source_entity;

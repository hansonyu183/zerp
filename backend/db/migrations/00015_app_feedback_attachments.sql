-- +goose Up
CREATE TABLE app_feedback_files (
    id varchar(26) PRIMARY KEY,
    storage_key varchar(255) NOT NULL UNIQUE,
    original_name varchar(255) NOT NULL,
    content_type varchar(32) NOT NULL CHECK (content_type IN ('image/png', 'image/jpeg')),
    declared_size bigint NOT NULL CHECK (declared_size BETWEEN 1 AND 10485760),
    sha256_hex char(64) NOT NULL CHECK (sha256_hex ~ '^[0-9a-f]{64}$'),
    status varchar(16) NOT NULL DEFAULT 'PENDING'
        CHECK (status IN ('PENDING', 'READY', 'DELETED')),
    upload_token_hash char(64) NOT NULL UNIQUE
        CHECK (upload_token_hash ~ '^[0-9a-f]{64}$'),
    upload_expires_at timestamptz NOT NULL,
    stored_at timestamptz,
    removed_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    created_by varchar(26) NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
    CONSTRAINT app_feedback_files_state_ck CHECK (
        (status = 'PENDING' AND stored_at IS NULL AND removed_at IS NULL)
        OR (status = 'READY' AND stored_at IS NOT NULL AND removed_at IS NULL)
        OR (status = 'DELETED' AND removed_at IS NOT NULL)
    )
);
CREATE INDEX app_feedback_files_creator_idx
    ON app_feedback_files (created_by, created_at DESC, id DESC);
CREATE INDEX app_feedback_files_cleanup_idx
    ON app_feedback_files (status, upload_expires_at, created_at, id);

ALTER TABLE app_feedback_attachments
    ADD COLUMN source varchar(16) NOT NULL DEFAULT 'VOU'
        CHECK (source IN ('VOU', 'FEEDBACK'));
CREATE UNIQUE INDEX app_feedback_attachment_feedback_file_uidx
    ON app_feedback_attachments (file_id)
    WHERE source = 'FEEDBACK';

-- +goose Down
DROP INDEX IF EXISTS app_feedback_attachment_feedback_file_uidx;
ALTER TABLE app_feedback_attachments DROP COLUMN source;
DROP TABLE app_feedback_files;

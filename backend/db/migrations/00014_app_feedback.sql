-- +goose Up
CREATE TABLE app_feedback (
    id varchar(26) PRIMARY KEY,
    user_id varchar(26) NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
    category varchar(16) NOT NULL CHECK (category IN ('BUG', 'SUGGESTION', 'OTHER')),
    title varchar(120) NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 120),
    content varchar(4000) NOT NULL CHECK (length(btrim(content)) BETWEEN 1 AND 4000),
    page_path varchar(256),
    client_version varchar(64),
    related_request_id varchar(128),
    status varchar(16) NOT NULL DEFAULT 'PENDING'
        CHECK (status IN ('PENDING', 'PROCESSING', 'PUBLISHED', 'FAILED')),
    attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count BETWEEN 0 AND 10),
    next_attempt_at timestamptz NOT NULL DEFAULT now(),
    lease_until timestamptz,
    last_error_code varchar(64),
    github_issue_number bigint,
    github_issue_url varchar(500),
    published_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT app_feedback_publication_ck CHECK (
        (status = 'PUBLISHED' AND github_issue_number IS NOT NULL
            AND github_issue_url IS NOT NULL AND published_at IS NOT NULL)
        OR
        (status <> 'PUBLISHED' AND github_issue_number IS NULL
            AND github_issue_url IS NULL AND published_at IS NULL)
    )
);
CREATE INDEX app_feedback_owner_idx
    ON app_feedback (user_id, created_at DESC, id DESC);
CREATE INDEX app_feedback_publish_queue_idx
    ON app_feedback (next_attempt_at, created_at, id)
    WHERE status IN ('PENDING', 'PROCESSING');

CREATE TABLE app_feedback_attachments (
    feedback_id varchar(26) NOT NULL REFERENCES app_feedback(id) ON DELETE CASCADE,
    file_id varchar(26) NOT NULL,
    original_name varchar(255) NOT NULL,
    content_type varchar(32) NOT NULL,
    declared_size bigint NOT NULL CHECK (declared_size BETWEEN 1 AND 10485760),
    sha256_hex char(64) NOT NULL CHECK (sha256_hex ~ '^[0-9a-f]{64}$'),
    position smallint NOT NULL CHECK (position BETWEEN 1 AND 3),
    PRIMARY KEY (feedback_id, file_id),
    UNIQUE (feedback_id, position)
);

-- +goose Down
DROP TABLE app_feedback_attachments;
DROP TABLE app_feedback;

-- +goose Up

CREATE TABLE IF NOT EXISTS approval_entries (
    id varchar(26) PRIMARY KEY,
    domain varchar(32) NOT NULL CHECK (domain ~ '^[a-z][a-z0-9-]{0,31}$'),
    entity varchar(64) NOT NULL CHECK (entity ~ '^[a-z][a-z0-9-]{0,63}$'),
    subject_id varchar(128) NOT NULL CHECK (length(btrim(subject_id)) >= 1),
    version_no integer CHECK (version_no IS NULL OR version_no >= 1),
    status varchar(16) NOT NULL CHECK (status IN ('DRAFT', 'PENDING', 'APPROVED')),
    revision bigint NOT NULL DEFAULT 1 CHECK (revision >= 1),
    created_by varchar(26) NOT NULL,
    created_at timestamptz NOT NULL,
    updated_by varchar(26) NOT NULL,
    updated_at timestamptz NOT NULL,
    submitted_by varchar(26),
    submitted_at timestamptz,
    approved_by varchar(26),
    approved_at timestamptz,
    CONSTRAINT approval_entries_metadata_check CHECK (
        (status = 'DRAFT' AND submitted_by IS NULL AND submitted_at IS NULL AND approved_by IS NULL AND approved_at IS NULL)
        OR (status = 'PENDING' AND submitted_by IS NOT NULL AND submitted_at IS NOT NULL AND approved_by IS NULL AND approved_at IS NULL)
        OR (status = 'APPROVED' AND submitted_by IS NOT NULL AND submitted_at IS NOT NULL AND approved_by IS NOT NULL AND approved_at IS NOT NULL AND approved_by <> submitted_by)
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS approval_entries_approval_only_unique
    ON approval_entries(domain, entity, subject_id)
    WHERE version_no IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS approval_entries_version_unique
    ON approval_entries(domain, entity, subject_id, version_no)
    WHERE version_no IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS approval_entries_open_version_unique
    ON approval_entries(domain, entity, subject_id)
    WHERE version_no IS NOT NULL AND status IN ('DRAFT', 'PENDING');
CREATE INDEX IF NOT EXISTS approval_entries_latest_approved_idx
    ON approval_entries(domain, entity, subject_id, version_no DESC)
    WHERE version_no IS NOT NULL AND status = 'APPROVED';

CREATE TABLE IF NOT EXISTS approval_events (
    id varchar(26) PRIMARY KEY,
    entry_id varchar(26) NOT NULL,
    domain varchar(32) NOT NULL CHECK (domain ~ '^[a-z][a-z0-9-]{0,31}$'),
    entity varchar(64) NOT NULL CHECK (entity ~ '^[a-z][a-z0-9-]{0,63}$'),
    subject_id varchar(128) NOT NULL CHECK (length(btrim(subject_id)) >= 1),
    version_no integer CHECK (version_no IS NULL OR version_no >= 1),
    action varchar(16) NOT NULL CHECK (action IN ('CREATED', 'SAVED', 'SUBMITTED', 'UNSUBMITTED', 'REJECTED', 'APPROVED', 'UNAPPROVED', 'DELETED')),
    from_status varchar(16) CHECK (from_status IS NULL OR from_status IN ('DRAFT', 'PENDING', 'APPROVED')),
    to_status varchar(16) CHECK (to_status IS NULL OR to_status IN ('DRAFT', 'PENDING', 'APPROVED')),
    from_revision bigint CHECK (from_revision IS NULL OR from_revision >= 1),
    to_revision bigint CHECK (to_revision IS NULL OR to_revision >= 1),
    actor_id varchar(26) NOT NULL,
    reason text,
    request_id varchar(128) NOT NULL CHECK (length(btrim(request_id)) >= 1),
    created_at timestamptz NOT NULL,
    CONSTRAINT approval_events_transition_shape_check CHECK (
        (action = 'CREATED' AND from_status IS NULL AND from_revision IS NULL AND to_status IS NOT NULL AND to_revision IS NOT NULL)
        OR (action = 'DELETED' AND from_status IS NOT NULL AND from_revision IS NOT NULL AND to_status IS NULL AND to_revision IS NULL)
        OR (action NOT IN ('CREATED', 'DELETED') AND from_status IS NOT NULL AND from_revision IS NOT NULL AND to_status IS NOT NULL AND to_revision IS NOT NULL)
    ),
    CONSTRAINT approval_events_reason_check CHECK (
        (action IN ('REJECTED', 'UNAPPROVED') AND reason IS NOT NULL AND length(btrim(reason)) > 0)
        OR (action NOT IN ('REJECTED', 'UNAPPROVED') AND reason IS NULL)
    )
);

CREATE INDEX IF NOT EXISTS approval_events_entry_created_idx
    ON approval_events(entry_id, created_at, id);

GRANT SELECT ON approval_entries, approval_events TO zerp_report_reader;

SELECT rpt_validate_current_reports();

-- +goose Down

-- The baseline always describes the current schema. Forward migrations are not
-- used as a recovery mechanism; rollback is restore-and-redeploy.
SELECT 1;

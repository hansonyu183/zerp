-- +goose Up

COMMENT ON COLUMN approval_entries.version_no IS
    'NULL for Approval-only entries; positive and required for Approval Version entries.';
COMMENT ON INDEX approval_entries_version_unique IS
    'One immutable version number per domain/entity/stable subject.';
COMMENT ON INDEX approval_entries_open_version_unique IS
    'At most one DRAFT or PENDING candidate per versioned stable subject.';
COMMENT ON INDEX approval_entries_latest_approved_idx IS
    'Supports highest approved version lookup without a current-version pointer.';

SELECT rpt_validate_current_reports();

-- +goose Down

-- The baseline always describes the current schema. Forward migrations are not
-- used as a recovery mechanism; rollback is restore-and-redeploy.
SELECT 1;

-- name: CreateApprovalEntry :one
INSERT INTO approval_entries(
  id, domain, entity, subject_id, version_no, status, revision,
  created_by, created_at, updated_by, updated_at,
  submitted_by, submitted_at, approved_by, approved_at
) VALUES (
  sqlc.arg(id), sqlc.arg(domain), sqlc.arg(entity), sqlc.arg(subject_id), NULL, 'DRAFT', 1,
  sqlc.arg(actor_id), sqlc.arg(occurred_at), sqlc.arg(actor_id), sqlc.arg(occurred_at),
  NULL, NULL, NULL, NULL
)
RETURNING *;

-- name: CreateApprovalVersion :one
INSERT INTO approval_entries(
  id, domain, entity, subject_id, version_no, status, revision,
  created_by, created_at, updated_by, updated_at,
  submitted_by, submitted_at, approved_by, approved_at
) VALUES (
  sqlc.arg(id), sqlc.arg(domain), sqlc.arg(entity), sqlc.arg(subject_id), sqlc.arg(version_no), 'DRAFT', 1,
  sqlc.arg(actor_id), sqlc.arg(occurred_at), sqlc.arg(actor_id), sqlc.arg(occurred_at),
  NULL, NULL, NULL, NULL
)
RETURNING *;

-- name: LockApprovalVersionSubject :exec
SELECT pg_advisory_xact_lock(hashtextextended(
  'approval.version:' || sqlc.arg(domain) || ':' || sqlc.arg(entity) || ':' || sqlc.arg(subject_id),
  0
));

-- name: GetApprovalEntry :one
SELECT *
FROM approval_entries
WHERE id = sqlc.arg(id) AND domain = sqlc.arg(domain) AND entity = sqlc.arg(entity);

-- name: LockApprovalEntry :one
SELECT *
FROM approval_entries
WHERE id = sqlc.arg(id) AND domain = sqlc.arg(domain) AND entity = sqlc.arg(entity)
FOR UPDATE;

-- name: GetLatestApprovedVersion :one
SELECT *
FROM approval_entries
WHERE domain = sqlc.arg(domain)
  AND entity = sqlc.arg(entity)
  AND subject_id = sqlc.arg(subject_id)
  AND version_no IS NOT NULL
  AND status = 'APPROVED'
ORDER BY version_no DESC
LIMIT 1;

-- name: LockLatestApprovedVersion :one
SELECT *
FROM approval_entries
WHERE domain = sqlc.arg(domain)
  AND entity = sqlc.arg(entity)
  AND subject_id = sqlc.arg(subject_id)
  AND version_no IS NOT NULL
  AND status = 'APPROVED'
ORDER BY version_no DESC
LIMIT 1
FOR UPDATE;

-- name: GetOpenApprovalVersion :one
SELECT *
FROM approval_entries
WHERE domain = sqlc.arg(domain)
  AND entity = sqlc.arg(entity)
  AND subject_id = sqlc.arg(subject_id)
  AND version_no IS NOT NULL
  AND status IN ('DRAFT', 'PENDING')
LIMIT 1;

-- name: ListApprovalVersions :many
SELECT *
FROM approval_entries
WHERE domain = sqlc.arg(domain)
  AND entity = sqlc.arg(entity)
  AND subject_id = sqlc.arg(subject_id)
  AND version_no IS NOT NULL
ORDER BY version_no DESC;

-- name: ApprovalVersionsExist :one
SELECT EXISTS(
  SELECT 1
  FROM approval_entries
  WHERE domain = sqlc.arg(domain)
    AND entity = sqlc.arg(entity)
    AND subject_id = sqlc.arg(subject_id)
    AND version_no IS NOT NULL
);

-- name: UpdateApprovalEntry :one
UPDATE approval_entries
SET status = sqlc.arg(status),
    revision = revision + 1,
    updated_by = sqlc.arg(actor_id),
    updated_at = sqlc.arg(occurred_at),
    submitted_by = sqlc.narg(submitted_by),
    submitted_at = sqlc.narg(submitted_at),
    approved_by = sqlc.narg(approved_by),
    approved_at = sqlc.narg(approved_at)
WHERE id = sqlc.arg(id)
  AND domain = sqlc.arg(domain)
  AND entity = sqlc.arg(entity)
  AND revision = sqlc.arg(expected_revision)
RETURNING *;

-- name: DeleteApprovalEntry :one
DELETE FROM approval_entries
WHERE id = sqlc.arg(id)
  AND domain = sqlc.arg(domain)
  AND entity = sqlc.arg(entity)
  AND revision = sqlc.arg(expected_revision)
  AND status = 'DRAFT'
RETURNING *;

-- name: InsertApprovalEvent :exec
INSERT INTO approval_events(
  id, entry_id, domain, entity, subject_id, version_no,
  action, from_status, to_status, from_revision, to_revision,
  actor_id, reason, request_id, created_at
) VALUES (
  sqlc.arg(id), sqlc.arg(entry_id), sqlc.arg(domain), sqlc.arg(entity), sqlc.arg(subject_id), sqlc.narg(version_no),
  sqlc.arg(action), sqlc.narg(from_status), sqlc.narg(to_status), sqlc.narg(from_revision), sqlc.narg(to_revision),
  sqlc.arg(actor_id), sqlc.narg(reason), sqlc.arg(request_id), sqlc.arg(created_at)
);

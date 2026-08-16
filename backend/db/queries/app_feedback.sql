-- name: LockAppFeedbackRateLimit :exec
SELECT pg_advisory_xact_lock(hashtextextended(sqlc.arg(user_id), 0));

-- name: CountRecentAppFeedback :one
SELECT count(*)
FROM app_feedback
WHERE user_id = sqlc.arg(user_id)
  AND created_at >= now() - interval '24 hours';

-- name: InsertAppFeedback :exec
INSERT INTO app_feedback (
    id, user_id, category, title, content, page_path, client_version,
    related_request_id
) VALUES (
    sqlc.arg(id), sqlc.arg(user_id), sqlc.arg(category), sqlc.arg(title),
    sqlc.arg(content), sqlc.narg(page_path), sqlc.narg(client_version),
    sqlc.narg(related_request_id)
);

-- name: InsertAppFeedbackAttachment :exec
INSERT INTO app_feedback_attachments (
    feedback_id, file_id, original_name, content_type, declared_size,
    sha256_hex, position, source
) VALUES (
    sqlc.arg(feedback_id), sqlc.arg(file_id), sqlc.arg(original_name),
    sqlc.arg(content_type), sqlc.arg(declared_size), sqlc.arg(sha256_hex),
    sqlc.arg(position), sqlc.arg(source)
);

-- name: LockAppFeedbackFileRateLimit :exec
SELECT pg_advisory_xact_lock(hashtextextended('feedback-file:' || sqlc.arg(user_id)::text, 0));

-- name: CountRecentAppFeedbackFiles :one
SELECT count(*)
FROM app_feedback_files
WHERE created_by = sqlc.arg(user_id)
  AND created_at >= now() - interval '24 hours';

-- name: CountActiveUnsubmittedAppFeedbackFiles :one
SELECT count(*)
FROM app_feedback_files f
WHERE f.created_by = sqlc.arg(user_id)
  AND (f.status = 'READY' OR (f.status = 'PENDING' AND f.upload_expires_at > now()))
  AND NOT EXISTS (
      SELECT 1
      FROM app_feedback_attachments a
      WHERE a.source = 'FEEDBACK' AND a.file_id = f.id
  );

-- name: InsertAppFeedbackFile :exec
INSERT INTO app_feedback_files (
    id, storage_key, original_name, content_type, declared_size, sha256_hex,
    upload_token_hash, upload_expires_at, created_by
) VALUES (
    sqlc.arg(id), sqlc.arg(storage_key), sqlc.arg(original_name),
    sqlc.arg(content_type), sqlc.arg(declared_size), sqlc.arg(sha256_hex),
    sqlc.arg(upload_token_hash), sqlc.arg(upload_expires_at), sqlc.arg(created_by)
);

-- name: LockPendingAppFeedbackUpload :one
SELECT *
FROM app_feedback_files
WHERE upload_token_hash = sqlc.arg(upload_token_hash)
  AND created_by = sqlc.arg(user_id)
  AND status = 'PENDING'
  AND upload_expires_at > now()
FOR UPDATE;

-- name: MarkAppFeedbackFileReady :execrows
UPDATE app_feedback_files
SET status = 'READY', stored_at = now()
WHERE id = sqlc.arg(id) AND status = 'PENDING';

-- name: ListReadyAppFeedbackFilesForCreate :many
SELECT *
FROM app_feedback_files
WHERE id = ANY(sqlc.arg(file_ids)::varchar(26)[])
  AND created_by = sqlc.arg(user_id)
  AND status = 'READY'
FOR UPDATE;

-- name: LockUnsubmittedAppFeedbackFile :one
SELECT f.*
FROM app_feedback_files f
WHERE f.id = sqlc.arg(file_id)
  AND f.created_by = sqlc.arg(user_id)
  AND f.status IN ('PENDING', 'READY')
  AND NOT EXISTS (
      SELECT 1
      FROM app_feedback_attachments a
      WHERE a.source = 'FEEDBACK' AND a.file_id = f.id
  )
FOR UPDATE;

-- name: MarkAppFeedbackFileDeleted :execrows
UPDATE app_feedback_files
SET status = 'DELETED', removed_at = now()
WHERE id = sqlc.arg(id) AND status IN ('PENDING', 'READY');

-- name: ListStaleAppFeedbackFiles :many
SELECT *
FROM app_feedback_files f
WHERE (
    (f.status = 'PENDING' AND f.upload_expires_at < now())
    OR (
        f.status = 'READY'
        AND f.created_at < sqlc.arg(orphan_before)
        AND NOT EXISTS (
            SELECT 1
            FROM app_feedback_attachments a
            WHERE a.source = 'FEEDBACK' AND a.file_id = f.id
        )
    )
    OR (f.status = 'DELETED' AND f.removed_at < sqlc.arg(orphan_before))
)
ORDER BY f.created_at, f.id
LIMIT sqlc.arg(batch_size)
FOR UPDATE SKIP LOCKED;

-- name: DeleteAppFeedbackFile :execrows
DELETE FROM app_feedback_files
WHERE id = sqlc.arg(id)
  AND NOT EXISTS (
      SELECT 1
      FROM app_feedback_attachments a
      WHERE a.source = 'FEEDBACK' AND a.file_id = app_feedback_files.id
  );

-- name: GetAppFeedbackByOwner :one
SELECT *
FROM app_feedback
WHERE id = sqlc.arg(id) AND user_id = sqlc.arg(user_id)
LIMIT 1;

-- name: ListAppFeedbackAttachments :many
SELECT *
FROM app_feedback_attachments
WHERE feedback_id = sqlc.arg(feedback_id)
ORDER BY position;

-- name: ClaimAppFeedbackForPublishing :one
WITH candidate AS (
    SELECT id
    FROM app_feedback
    WHERE (
        status = 'PENDING'
        OR (status = 'PROCESSING' AND lease_until < now())
    )
      AND next_attempt_at <= now()
      AND attempt_count < 10
    ORDER BY next_attempt_at, created_at, id
    FOR UPDATE SKIP LOCKED
    LIMIT 1
)
UPDATE app_feedback f
SET status = 'PROCESSING',
    attempt_count = f.attempt_count + 1,
    lease_until = now() + interval '2 minutes',
    updated_at = now()
FROM candidate
WHERE f.id = candidate.id
RETURNING f.*;

-- name: MarkAppFeedbackPublished :execrows
UPDATE app_feedback
SET status = 'PUBLISHED',
    github_issue_number = sqlc.arg(issue_number),
    github_issue_url = sqlc.arg(issue_url),
    published_at = now(),
    lease_until = NULL,
    last_error_code = NULL,
    updated_at = now()
WHERE id = sqlc.arg(id) AND status = 'PROCESSING';

-- name: RescheduleAppFeedback :execrows
UPDATE app_feedback
SET status = sqlc.arg(status),
    next_attempt_at = sqlc.arg(next_attempt_at),
    lease_until = NULL,
    last_error_code = sqlc.arg(error_code),
    updated_at = now()
WHERE id = sqlc.arg(id) AND status = 'PROCESSING';

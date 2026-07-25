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
    sha256_hex, position
) VALUES (
    sqlc.arg(feedback_id), sqlc.arg(file_id), sqlc.arg(original_name),
    sqlc.arg(content_type), sqlc.arg(declared_size), sqlc.arg(sha256_hex),
    sqlc.arg(position)
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

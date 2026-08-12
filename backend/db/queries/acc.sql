-- name: LockAccountingBooksForCreate :exec
LOCK TABLE acc_books IN SHARE ROW EXCLUSIVE MODE;

-- name: AccountingBookExists :one
SELECT EXISTS(SELECT 1 FROM acc_books);

-- name: NextAccountingBookNumber :one
INSERT INTO object_number_counters (domain, entity, last_value)
VALUES ('acc', 'book', 1)
ON CONFLICT (domain, entity)
DO UPDATE SET last_value = object_number_counters.last_value + 1
WHERE object_number_counters.last_value < 9999
RETURNING last_value;

-- name: CreateAccountingBook :exec
INSERT INTO acc_books (
  id, code, name, description, start_month, base_currency,
  control_book, subject_template, created_by, updated_by
) VALUES (
  sqlc.arg(id), sqlc.arg(code), sqlc.arg(name), sqlc.arg(description),
  to_date(sqlc.arg(start_month)::text, 'YYYY-MM'), sqlc.arg(base_currency),
  sqlc.arg(control_book), sqlc.arg(subject_template),
  sqlc.arg(actor_id), sqlc.arg(actor_id)
);

-- name: HasAccountingBookQueryAccess :one
SELECT EXISTS(
  SELECT 1 FROM acc_book_user_scopes
  WHERE book_id = sqlc.arg(book_id)
    AND user_id = sqlc.arg(user_id)
    AND query_access
);

-- name: HasAccountingBookOperateAccess :one
SELECT EXISTS(
  SELECT 1 FROM acc_book_user_scopes
  WHERE book_id = sqlc.arg(book_id)
    AND user_id = sqlc.arg(user_id)
    AND operate_access
);

-- name: GetAccountingBookUserScope :one
SELECT query_access, operate_access
FROM acc_book_user_scopes
WHERE book_id = sqlc.arg(book_id) AND user_id = sqlc.arg(user_id);

-- name: DeleteAccountingBookScopes :exec
DELETE FROM acc_book_user_scopes WHERE book_id = sqlc.arg(book_id);

-- name: GetAccountingAccessUserEnabled :one
SELECT status = 'ENABLED' AS enabled FROM app_users WHERE id = sqlc.arg(user_id);

-- name: CreateAccountingBookScope :exec
INSERT INTO acc_book_user_scopes (
  book_id, user_id, query_access, operate_access, created_by
) VALUES (
  sqlc.arg(book_id), sqlc.arg(user_id), sqlc.arg(query_access),
  sqlc.arg(operate_access), sqlc.arg(actor_id)
);

-- name: ListAccountingBooks :many
SELECT b.id, b.code, b.name, b.description,
       to_char(b.start_month, 'YYYY-MM') AS start_month,
       b.base_currency, b.control_book, b.subject_template,
       b.revision, count(*) OVER() AS total
FROM acc_books b
JOIN acc_book_user_scopes s ON s.book_id = b.id
WHERE s.user_id = sqlc.arg(user_id)
  AND s.query_access
  AND (
    sqlc.arg(keyword)::text = ''
    OR b.code ILIKE '%' || sqlc.arg(keyword) || '%'
    OR b.name ILIKE '%' || sqlc.arg(keyword) || '%'
  )
ORDER BY b.control_book DESC, b.code, b.id
OFFSET sqlc.arg(page_offset) LIMIT sqlc.arg(page_size);

-- name: GetAccountingBook :one
SELECT id, code, name, description,
       to_char(start_month, 'YYYY-MM') AS start_month,
       base_currency, control_book, subject_template, revision
FROM acc_books
WHERE id = sqlc.arg(book_id);

-- name: ListAccountingBookScopes :many
SELECT user_id, query_access, operate_access
FROM acc_book_user_scopes
WHERE book_id = sqlc.arg(book_id)
ORDER BY user_id;

-- name: UpdateAccountingBook :one
UPDATE acc_books SET
  name = sqlc.arg(name),
  description = sqlc.arg(description),
  base_currency = sqlc.arg(base_currency),
  revision = revision + 1,
  updated_at = now(),
  updated_by = sqlc.arg(actor_id)
WHERE id = sqlc.arg(book_id) AND revision = sqlc.arg(revision)
RETURNING revision;

-- name: GetAccountingBookDeletionState :one
SELECT control_book, revision
FROM acc_books
WHERE id = sqlc.arg(book_id)
FOR UPDATE;

-- name: DeleteAccountingBook :exec
DELETE FROM acc_books WHERE id = sqlc.arg(book_id);

-- name: InsertAccountingSubject :exec
INSERT INTO acc_subjects (
  id, book_id, code, name, parent_subject_id, balance_direction,
  enabled, inventory_quantity, settlement_purpose, created_by, updated_by
) VALUES (
  sqlc.arg(id), sqlc.arg(book_id), sqlc.arg(code), sqlc.arg(name),
  sqlc.narg(parent_subject_id), sqlc.arg(balance_direction), sqlc.arg(enabled),
  sqlc.arg(inventory_quantity), sqlc.arg(settlement_purpose),
  sqlc.arg(actor_id), sqlc.arg(actor_id)
);

-- name: InsertAccountingSubjectDimension :exec
INSERT INTO acc_subject_dimensions (subject_id, dimension)
VALUES (sqlc.arg(subject_id), sqlc.arg(dimension));

-- name: DeleteAccountingSubjectDimensions :exec
DELETE FROM acc_subject_dimensions WHERE subject_id = sqlc.arg(subject_id);

-- name: ListAccountingSubjectDimensions :many
SELECT dimension FROM acc_subject_dimensions
WHERE subject_id = sqlc.arg(subject_id)
ORDER BY dimension;

-- name: ListAccountingSubjects :many
SELECT s.id, s.book_id, s.code, s.name, s.parent_subject_id,
       s.balance_direction, s.enabled, s.inventory_quantity,
       s.settlement_purpose, s.revision,
       NOT EXISTS (
         SELECT 1 FROM acc_subjects child WHERE child.parent_subject_id = s.id
       ) AS leaf,
       EXISTS (
         SELECT 1 FROM acc_subject_usages usage WHERE usage.subject_id = s.id
       ) AS referenced,
       count(*) OVER() AS total
FROM acc_subjects s
WHERE s.book_id = sqlc.arg(book_id)
  AND (
    sqlc.arg(keyword)::text = ''
    OR s.code ILIKE '%' || sqlc.arg(keyword) || '%'
    OR s.name ILIKE '%' || sqlc.arg(keyword) || '%'
  )
ORDER BY s.code, s.id
OFFSET sqlc.arg(page_offset) LIMIT sqlc.arg(page_size);

-- name: GetAccountingSubject :one
SELECT s.id, s.book_id, s.code, s.name, s.parent_subject_id,
       s.balance_direction, s.enabled, s.inventory_quantity,
       s.settlement_purpose, s.revision,
       NOT EXISTS (
         SELECT 1 FROM acc_subjects child WHERE child.parent_subject_id = s.id
       ) AS leaf,
       EXISTS (
         SELECT 1 FROM acc_subject_usages usage WHERE usage.subject_id = s.id
       ) AS referenced
FROM acc_subjects s
WHERE s.book_id = sqlc.arg(book_id) AND s.id = sqlc.arg(subject_id);

-- name: GetAccountingSubjectStateForUpdate :one
SELECT s.id, s.book_id, s.code, s.name, s.parent_subject_id,
       s.balance_direction, s.enabled, s.inventory_quantity,
       s.settlement_purpose, s.revision,
       EXISTS (
         SELECT 1 FROM acc_subjects child WHERE child.parent_subject_id = s.id
       ) AS has_children,
       EXISTS (
         SELECT 1 FROM acc_subject_usages usage WHERE usage.subject_id = s.id
       ) AS referenced
FROM acc_subjects s
WHERE s.book_id = sqlc.arg(book_id) AND s.id = sqlc.arg(subject_id)
FOR UPDATE;

-- name: GetAccountingSubjectParent :one
SELECT parent_subject_id
FROM acc_subjects
WHERE book_id = sqlc.arg(book_id) AND id = sqlc.arg(subject_id);

-- name: UpdateAccountingSubject :one
UPDATE acc_subjects SET
  code = sqlc.arg(code),
  name = sqlc.arg(name),
  parent_subject_id = sqlc.narg(parent_subject_id),
  balance_direction = sqlc.arg(balance_direction),
  enabled = sqlc.arg(enabled),
  inventory_quantity = sqlc.arg(inventory_quantity),
  settlement_purpose = sqlc.arg(settlement_purpose),
  revision = revision + 1,
  updated_at = now(),
  updated_by = sqlc.arg(actor_id)
WHERE book_id = sqlc.arg(book_id)
  AND id = sqlc.arg(subject_id)
  AND revision = sqlc.arg(revision)
RETURNING revision;

-- name: DeleteAccountingSubject :exec
DELETE FROM acc_subjects
WHERE book_id = sqlc.arg(book_id) AND id = sqlc.arg(subject_id);

-- name: RegisterAccountingSubjectUsage :exec
INSERT INTO acc_subject_usages (subject_id, usage_type, usage_id)
VALUES (sqlc.arg(subject_id), sqlc.arg(usage_type), sqlc.arg(usage_id))
ON CONFLICT DO NOTHING;

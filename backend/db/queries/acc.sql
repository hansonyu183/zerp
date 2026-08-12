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
  control_book, created_by, updated_by
) VALUES (
  sqlc.arg(id), sqlc.arg(code), sqlc.arg(name), sqlc.arg(description),
  to_date(sqlc.arg(start_month)::text, 'YYYY-MM'), sqlc.arg(base_currency),
  sqlc.arg(control_book), sqlc.arg(actor_id), sqlc.arg(actor_id)
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
       b.base_currency, b.control_book, b.revision, count(*) OVER() AS total
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
       base_currency, control_book, revision
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

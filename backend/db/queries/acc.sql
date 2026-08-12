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

-- name: DeleteAccountingSubjectUsages :exec
DELETE FROM acc_subject_usages
WHERE usage_type = sqlc.arg(usage_type) AND usage_id = sqlc.arg(usage_id);

-- name: GetAccountingOpening :one
SELECT o.book_id, o.state, o.voucher_id, o.revision, o.approved_at, o.approved_by
FROM acc_openings o
WHERE o.book_id = sqlc.arg(book_id);

-- name: GetAccountingOpeningForUpdate :one
SELECT o.book_id, o.state, o.voucher_id, o.revision, o.approved_at, o.approved_by
FROM acc_openings o
WHERE o.book_id = sqlc.arg(book_id)
FOR UPDATE;

-- name: ListAccountingOpeningLines :many
SELECT id, book_id, subject_id, currency, debit_minor, credit_minor,
       quantity_micros, dimensions, line_order
FROM acc_opening_lines
WHERE book_id = sqlc.arg(book_id)
ORDER BY line_order;

-- name: CreateAccountingOpening :exec
INSERT INTO acc_openings (book_id, state, revision, created_by, updated_by)
VALUES (sqlc.arg(book_id), 'DRAFT', 1, sqlc.arg(actor_id), sqlc.arg(actor_id));

-- name: TouchAccountingOpeningDraft :one
UPDATE acc_openings SET
  revision = revision + 1, updated_at = now(), updated_by = sqlc.arg(actor_id)
WHERE book_id = sqlc.arg(book_id) AND state = 'DRAFT' AND revision = sqlc.arg(revision)
RETURNING revision;

-- name: DeleteAccountingOpeningLines :exec
DELETE FROM acc_opening_lines WHERE book_id = sqlc.arg(book_id);

-- name: InsertAccountingOpeningLine :exec
INSERT INTO acc_opening_lines (
  id, book_id, subject_id, currency, debit_minor, credit_minor,
  quantity_micros, dimensions, line_order
) VALUES (
  sqlc.arg(id), sqlc.arg(book_id), sqlc.arg(subject_id), sqlc.arg(currency),
  sqlc.arg(debit_minor), sqlc.arg(credit_minor), sqlc.narg(quantity_micros),
  sqlc.arg(dimensions), sqlc.arg(line_order)
);

-- name: CreateAccountingVoucher :exec
INSERT INTO acc_vouchers (id, book_id, source_type, source_id, business_date, created_by)
VALUES (
  sqlc.arg(id), sqlc.arg(book_id), sqlc.arg(source_type), sqlc.arg(source_id),
  sqlc.arg(business_date), sqlc.arg(actor_id)
);

-- name: InsertAccountingVoucherLine :exec
INSERT INTO acc_voucher_lines (
  id, book_id, voucher_id, subject_id, currency, debit_minor, credit_minor,
  quantity_micros, dimensions, source_line_id, line_order
) VALUES (
  sqlc.arg(id), sqlc.arg(book_id), sqlc.arg(voucher_id), sqlc.arg(subject_id), sqlc.arg(currency),
  sqlc.arg(debit_minor), sqlc.arg(credit_minor), sqlc.narg(quantity_micros),
  sqlc.arg(dimensions), sqlc.arg(source_line_id), sqlc.arg(line_order)
);

-- name: ApproveAccountingOpening :one
UPDATE acc_openings SET
  state = 'APPROVED', voucher_id = sqlc.arg(voucher_id),
  approved_at = now(), approved_by = sqlc.arg(actor_id),
  revision = revision + 1, updated_at = now(), updated_by = sqlc.arg(actor_id)
WHERE book_id = sqlc.arg(book_id) AND state = 'DRAFT' AND revision = sqlc.arg(revision)
RETURNING revision;

-- name: CreateApprovedZeroAccountingOpening :exec
INSERT INTO acc_openings (
  book_id, state, voucher_id, revision, approved_at, approved_by,
  created_by, updated_by
) VALUES (
  sqlc.arg(book_id), 'APPROVED', sqlc.arg(voucher_id), 1, now(), sqlc.arg(actor_id),
  sqlc.arg(actor_id), sqlc.arg(actor_id)
);

-- name: AccountingBookHasLaterFacts :one
SELECT EXISTS(
  SELECT 1 FROM acc_vouchers
  WHERE book_id = sqlc.arg(book_id) AND source_type <> 'OPENING'
);

-- name: DeleteAccountingVoucher :exec
DELETE FROM acc_vouchers WHERE book_id = sqlc.arg(book_id) AND id = sqlc.arg(voucher_id);

-- name: UnapproveAccountingOpening :one
UPDATE acc_openings SET
  state = 'DRAFT', voucher_id = NULL, approved_at = NULL, approved_by = NULL,
  revision = revision + 1, updated_at = now(), updated_by = sqlc.arg(actor_id)
WHERE book_id = sqlc.arg(book_id) AND state = 'APPROVED' AND revision = sqlc.arg(revision)
RETURNING revision;

-- name: IsAccountingBookReadyForPosting :one
SELECT EXISTS(
  SELECT 1 FROM acc_openings
  WHERE book_id = sqlc.arg(book_id) AND state = 'APPROVED'
);

-- name: NextAccountingMappingVersion :one
SELECT COALESCE(max(version), 0)::integer + 1
FROM acc_mapping_versions
WHERE book_id = sqlc.arg(book_id) AND vou_entity = sqlc.arg(vou_entity);

-- name: CreateAccountingMappingVersion :exec
INSERT INTO acc_mapping_versions (
  id, book_id, vou_entity, version, state, default_result, definition,
  created_by, updated_by
) VALUES (
  sqlc.arg(id), sqlc.arg(book_id), sqlc.arg(vou_entity), sqlc.arg(version),
  'DRAFT', sqlc.arg(default_result), sqlc.arg(definition),
  sqlc.arg(actor_id), sqlc.arg(actor_id)
);

-- name: ListAccountingMappings :many
SELECT id, book_id, vou_entity, version, state, default_result, definition,
       revision, approved_at, approved_by, count(*) OVER() AS total
FROM acc_mapping_versions
WHERE book_id = sqlc.arg(book_id)
  AND (sqlc.arg(vou_entity)::text = '' OR vou_entity = sqlc.arg(vou_entity))
ORDER BY vou_entity, version DESC
OFFSET sqlc.arg(page_offset) LIMIT sqlc.arg(page_size);

-- name: GetAccountingMapping :one
SELECT id, book_id, vou_entity, version, state, default_result, definition,
       revision, approved_at, approved_by
FROM acc_mapping_versions
WHERE book_id = sqlc.arg(book_id) AND id = sqlc.arg(mapping_id);

-- name: GetAccountingMappingForUpdate :one
SELECT m.id, m.book_id, m.vou_entity, m.version, m.state, m.default_result, m.definition,
       m.revision, m.approved_at, m.approved_by,
		 EXISTS(SELECT 1 FROM acc_vouchers v WHERE v.mapping_version_id = m.id) AS referenced
FROM acc_mapping_versions m
WHERE m.book_id = sqlc.arg(book_id) AND m.id = sqlc.arg(mapping_id)
FOR UPDATE;

-- name: UpdateAccountingMappingDraft :one
UPDATE acc_mapping_versions SET
  default_result = sqlc.arg(default_result), definition = sqlc.arg(definition),
  revision = revision + 1, updated_at = now(), updated_by = sqlc.arg(actor_id)
WHERE book_id = sqlc.arg(book_id) AND id = sqlc.arg(mapping_id)
  AND state = 'DRAFT' AND revision = sqlc.arg(revision)
RETURNING revision;

-- name: ApproveAccountingMapping :one
UPDATE acc_mapping_versions SET
  state = 'APPROVED', approved_at = now(), approved_by = sqlc.arg(actor_id),
  revision = revision + 1, updated_at = now(), updated_by = sqlc.arg(actor_id)
WHERE book_id = sqlc.arg(book_id) AND id = sqlc.arg(mapping_id)
  AND state = 'DRAFT' AND revision = sqlc.arg(revision)
RETURNING revision;

-- name: UnapproveAccountingMapping :one
UPDATE acc_mapping_versions SET
  state = 'DRAFT', approved_at = NULL, approved_by = NULL,
  revision = revision + 1, updated_at = now(), updated_by = sqlc.arg(actor_id)
WHERE book_id = sqlc.arg(book_id) AND id = sqlc.arg(mapping_id)
  AND state = 'APPROVED' AND revision = sqlc.arg(revision)
RETURNING revision;

-- name: GetCurrentApprovedAccountingMapping :one
SELECT id, book_id, vou_entity, version, state, default_result, definition,
       revision, approved_at, approved_by
FROM acc_mapping_versions
WHERE book_id = sqlc.arg(book_id) AND vou_entity = sqlc.arg(vou_entity)
  AND state = 'APPROVED'
ORDER BY version DESC
LIMIT 1;

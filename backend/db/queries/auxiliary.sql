-- name: QueryAuxReferenceCandidates :many
SELECT
    o.id AS object_id,
    a.id AS approval_entry_id,
    o.code,
    COALESCE(p.data->>'name', '')::text AS name
FROM aux_objects o
JOIN approval_entries a
  ON a.domain = 'aux'
 AND a.entity = o.entity
 AND a.subject_id = o.id
 AND a.status = 'APPROVED'
 AND NOT EXISTS (
     SELECT 1
     FROM approval_entries newer
     WHERE newer.domain = a.domain
       AND newer.entity = a.entity
       AND newer.subject_id = a.subject_id
       AND newer.status = 'APPROVED'
       AND newer.version_no > a.version_no
 )
JOIN aux_version_payloads p ON p.approval_entry_id = a.id
WHERE o.entity = sqlc.arg(entity)
  AND o.enabled
  AND (
      sqlc.arg(keyword)::text = ''
      OR o.code ILIKE '%' || sqlc.arg(keyword)::text || '%'
      OR COALESCE(p.data->>'name', '') ILIKE '%' || sqlc.arg(keyword)::text || '%'
  )
  AND (
      sqlc.arg(dictionary_type_code)::text = ''
      OR p.data->>'dictionaryTypeCode' = sqlc.arg(dictionary_type_code)::text
  )
ORDER BY COALESCE((p.data->>'sortOrder')::integer, 2147483647), o.code, o.id
LIMIT 20;

-- name: GetAuxVersionData :one
SELECT data
FROM aux_version_payloads
WHERE approval_entry_id = sqlc.arg(approval_entry_id)
  AND object_id = sqlc.arg(object_id)
  AND entity = sqlc.arg(entity);

-- name: IsBobCustomerPaymentMethodReferenced :one
SELECT EXISTS(
    SELECT 1
    FROM bob_customer_versions customer
    JOIN approval_entries entry
      ON entry.id = customer.version_id
     AND entry.domain = 'bob'
     AND entry.entity = 'customer-account'
     AND entry.status = 'APPROVED'
    WHERE customer.payment_method_id = sqlc.arg(object_id)::text
      AND NOT EXISTS (
          SELECT 1 FROM approval_entries newer
          WHERE newer.domain = entry.domain
            AND newer.entity = entry.entity
            AND newer.subject_id = entry.subject_id
            AND newer.status = 'APPROVED'
            AND newer.version_no > entry.version_no
      )
);

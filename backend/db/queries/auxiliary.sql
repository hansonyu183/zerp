-- name: QueryAuxReferenceCandidates :many
SELECT
    o.id AS object_id,
    v.id AS version_id,
    o.code,
    COALESCE(v.data->>'name', '')::text AS name
FROM aux_objects o
JOIN aux_versions v ON v.id = o.current_version_id
WHERE o.entity = sqlc.arg(entity)
  AND o.enabled
  AND (
      sqlc.arg(keyword)::text = ''
      OR o.code ILIKE '%' || sqlc.arg(keyword)::text || '%'
      OR COALESCE(v.data->>'name', '') ILIKE '%' || sqlc.arg(keyword)::text || '%'
  )
  AND (
      sqlc.arg(dictionary_type_code)::text = ''
      OR v.data->>'dictionaryTypeCode' = sqlc.arg(dictionary_type_code)::text
  )
ORDER BY COALESCE((v.data->>'sortOrder')::integer, 2147483647), o.code, o.id
LIMIT 20;

-- name: GetAuxVersionData :one
SELECT data
FROM aux_versions
WHERE id = sqlc.arg(version_id)
  AND object_id = sqlc.arg(object_id)
  AND entity = sqlc.arg(entity);

-- name: IsBobCustomerPaymentMethodReferenced :one
SELECT EXISTS(
    SELECT 1
    FROM bob_customer_versions
    WHERE payment_method_id = sqlc.arg(object_id)::text
);

-- AUX is stable-ID current data. These queries intentionally expose no
-- Approval entry, candidate, version, or historical payload identity.

-- name: QueryAuxReferenceCandidates :many
SELECT id AS object_id, code, CAST(COALESCE(data->>'name','') AS text) AS name
FROM aux_objects
WHERE entity=sqlc.arg(entity)
  AND enabled
  AND (sqlc.arg(keyword)::text='' OR code ILIKE '%'||sqlc.arg(keyword)::text||'%' OR COALESCE(data->>'name','') ILIKE '%'||sqlc.arg(keyword)::text||'%')
  AND (sqlc.arg(dictionary_type_code)::text='' OR data->>'dictionaryTypeCode'=sqlc.arg(dictionary_type_code)::text)
ORDER BY COALESCE((data->>'sortOrder')::integer,2147483647),code,id
LIMIT 20;

-- name: GetAuxObjectData :one
SELECT data FROM aux_objects
WHERE id=sqlc.arg(object_id) AND entity=sqlc.arg(entity);

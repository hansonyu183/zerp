-- name: LockCustomerAttachmentRelationship :one
SELECT id,revision FROM bob_objects WHERE id=sqlc.arg(owner_id) AND entity='customer' FOR UPDATE;

-- name: LockCustomerAttachmentVersion :one
SELECT id,subject_id AS object_id,status,revision
FROM approval_entries
WHERE id=sqlc.arg(owner_id) AND domain='bob' AND entity='customer-account'
FOR UPDATE;

-- name: ResolveCustomerDocumentCategory :one
SELECT object.id AS object_id,entry.id AS approval_entry_id,object.code,
       CAST(payload.data->>'name' AS text) AS name
FROM aux_objects object
JOIN approval_entries entry ON entry.domain='aux' AND entry.entity='dictionary-item'
    AND entry.subject_id=object.id AND entry.status='APPROVED'
JOIN aux_version_payloads payload ON payload.approval_entry_id=entry.id
WHERE object.id=sqlc.arg(object_id) AND object.entity='dictionary-item'
  AND object.enabled=true
  AND payload.data->>'dictionaryTypeCode'='DCT-0003'
  AND NOT EXISTS (
      SELECT 1 FROM approval_entries newer
      WHERE newer.domain='aux' AND newer.entity=entry.entity AND newer.subject_id=entry.subject_id
        AND newer.status='APPROVED' AND newer.version_no>entry.version_no
  );

-- name: CountCustomerRelationshipAttachments :one
SELECT count(*) FROM bob_customer_relationship_attachments WHERE customer_relationship_id=sqlc.arg(owner_id);

-- name: CountCustomerVersionAttachments :one
SELECT count(*) FROM bob_customer_version_attachments WHERE approval_entry_id=sqlc.arg(owner_id);

-- name: InsertCustomerFile :exec
INSERT INTO bob_customer_files(
    id,storage_key,original_name,content_type,declared_size,sha256_hex,
    upload_token_hash,upload_expires_at,created_by
) VALUES (
    sqlc.arg(id),sqlc.arg(storage_key),sqlc.arg(original_name),sqlc.arg(content_type),
    sqlc.arg(declared_size),sqlc.arg(sha256_hex),sqlc.arg(upload_token_hash),
    sqlc.arg(upload_expires_at),sqlc.arg(actor_id)
);

-- name: InsertCustomerRelationshipAttachment :exec
INSERT INTO bob_customer_relationship_attachments(
    customer_relationship_id,file_id,category_object_id,category_approval_entry_id,category_code,category_name,created_by
) VALUES (
    sqlc.arg(owner_id),sqlc.arg(file_id),sqlc.arg(category_object_id),sqlc.arg(category_approval_entry_id),
    sqlc.arg(category_code),sqlc.arg(category_name),sqlc.arg(actor_id)
);

-- name: InsertCustomerVersionAttachment :exec
INSERT INTO bob_customer_version_attachments(
    approval_entry_id,file_id,category_object_id,category_approval_entry_id,category_code,category_name,created_by
) VALUES (
    sqlc.arg(owner_id),sqlc.arg(file_id),sqlc.arg(category_object_id),sqlc.arg(category_approval_entry_id),
    sqlc.arg(category_code),sqlc.arg(category_name),sqlc.arg(actor_id)
);

-- name: TouchCustomerRelationshipAttachment :one
UPDATE bob_objects
SET revision=revision+1,updated_at=now(),updated_by=sqlc.arg(actor_id)
WHERE id=sqlc.arg(owner_id) AND entity='customer' AND revision=sqlc.arg(revision)
RETURNING revision;

-- name: ListCustomerRelationshipAttachments :many
SELECT file.id AS file_id,file.original_name AS file_name,file.content_type,file.declared_size,
       file.sha256_hex,file.status,file.stored_at,relation.category_object_id,
       relation.category_approval_entry_id,relation.category_code,relation.category_name,
       relation.created_at,relation.created_by
FROM bob_customer_relationship_attachments relation
JOIN bob_customer_files file ON file.id=relation.file_id
WHERE relation.customer_relationship_id=sqlc.arg(owner_id)
ORDER BY relation.created_at,relation.file_id;

-- name: ListCustomerVersionAttachments :many
SELECT file.id AS file_id,file.original_name AS file_name,file.content_type,file.declared_size,
       file.sha256_hex,file.status,file.stored_at,relation.category_object_id,
       relation.category_approval_entry_id,relation.category_code,relation.category_name,
       relation.created_at,relation.created_by
FROM bob_customer_version_attachments relation
JOIN bob_customer_files file ON file.id=relation.file_id
WHERE relation.approval_entry_id=sqlc.arg(owner_id)
ORDER BY relation.created_at,relation.file_id;

-- name: CopyCustomerVersionAttachments :exec
INSERT INTO bob_customer_version_attachments(
    approval_entry_id,file_id,category_object_id,category_approval_entry_id,category_code,category_name,created_at,created_by
)
SELECT sqlc.arg(target_approval_entry_id),source.file_id,source.category_object_id,source.category_approval_entry_id,
       source.category_code,source.category_name,source.created_at,source.created_by
FROM bob_customer_version_attachments source
WHERE source.approval_entry_id=sqlc.arg(source_approval_entry_id);

-- name: LockPendingCustomerUpload :one
SELECT file.id,file.storage_key,file.content_type,file.declared_size,file.sha256_hex,
       COALESCE(relationship_relation.customer_relationship_id,version_relation.approval_entry_id) AS owner_id,
       CASE WHEN relationship_relation.customer_relationship_id IS NOT NULL THEN 'RELATIONSHIP' ELSE 'ACCOUNT' END AS scope,
       relationship_owner.revision AS group_revision,version_owner.status AS version_status,
       version_owner.revision AS version_revision
FROM bob_customer_files file
LEFT JOIN bob_customer_relationship_attachments relationship_relation ON relationship_relation.file_id=file.id
LEFT JOIN bob_objects relationship_owner ON relationship_owner.id=relationship_relation.customer_relationship_id
LEFT JOIN bob_customer_version_attachments version_relation ON version_relation.file_id=file.id
LEFT JOIN approval_entries version_owner ON version_owner.id=version_relation.approval_entry_id AND version_owner.domain='bob'
WHERE file.upload_token_hash=sqlc.arg(token_hash) AND file.status='PENDING'
  AND file.upload_expires_at>now()
FOR UPDATE OF file;

-- name: MarkCustomerFileReady :execrows
UPDATE bob_customer_files SET status='READY',stored_at=now()
WHERE id=sqlc.arg(file_id) AND status='PENDING';

-- name: GetReadyCustomerRelationshipAttachment :one
SELECT file.id,file.storage_key,file.original_name,file.content_type,file.declared_size
FROM bob_customer_relationship_attachments relation
JOIN bob_customer_files file ON file.id=relation.file_id
WHERE relation.customer_relationship_id=sqlc.arg(owner_id) AND file.id=sqlc.arg(file_id) AND file.status='READY';

-- name: GetReadyCustomerVersionAttachment :one
SELECT file.id,file.storage_key,file.original_name,file.content_type,file.declared_size
FROM bob_customer_version_attachments relation
JOIN bob_customer_files file ON file.id=relation.file_id
WHERE relation.approval_entry_id=sqlc.arg(owner_id) AND file.id=sqlc.arg(file_id) AND file.status='READY';

-- name: InsertCustomerDownloadToken :exec
INSERT INTO bob_customer_download_tokens(token_hash,file_id,expires_at,created_by)
VALUES(sqlc.arg(token_hash),sqlc.arg(file_id),sqlc.arg(expires_at),sqlc.arg(actor_id));

-- name: ConsumeCustomerDownloadToken :one
UPDATE bob_customer_download_tokens token
SET used_at=now()
FROM bob_customer_files file
WHERE token.token_hash=sqlc.arg(token_hash) AND token.used_at IS NULL AND token.expires_at>now()
  AND file.id=token.file_id AND file.status='READY'
RETURNING file.storage_key,file.original_name,file.content_type,file.declared_size;

-- name: DeleteCustomerRelationshipAttachment :execrows
DELETE FROM bob_customer_relationship_attachments
WHERE customer_relationship_id=sqlc.arg(owner_id) AND file_id=sqlc.arg(file_id);

-- name: DeleteCustomerVersionAttachment :execrows
DELETE FROM bob_customer_version_attachments
WHERE approval_entry_id=sqlc.arg(owner_id) AND file_id=sqlc.arg(file_id);

-- name: CustomerFileReferenceCount :one
SELECT (SELECT count(*) FROM bob_customer_relationship_attachments relationship_relation WHERE relationship_relation.file_id=sqlc.arg(target_file_id))+
       (SELECT count(*) FROM bob_customer_version_attachments version_relation WHERE version_relation.file_id=sqlc.arg(target_file_id)) AS reference_count;

-- name: GetCustomerFileStorageKey :one
SELECT storage_key FROM bob_customer_files WHERE id=sqlc.arg(file_id);

-- name: ListAllCustomerStorageKeys :many
SELECT storage_key FROM bob_customer_files ORDER BY storage_key;

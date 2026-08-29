-- name: LockPartyMergeParty :one
SELECT party.id,current.kind,approval.id AS source_approval_entry_id,approval.revision,party.merged_into_party_id,
       EXISTS(SELECT 1 FROM approval_entries open_entry WHERE open_entry.domain='dcl' AND open_entry.entity='party' AND open_entry.subject_id=party.id AND open_entry.status IN ('DRAFT','PENDING')) AS has_open_candidate
FROM dcl_parties party
JOIN LATERAL (SELECT * FROM approval_entries entry WHERE entry.domain='dcl' AND entry.entity='party' AND entry.subject_id=party.id AND entry.status='APPROVED' ORDER BY entry.version_no DESC LIMIT 1) approval ON true
JOIN dcl_party_versions current ON current.approval_entry_id=approval.id
WHERE party.id=sqlc.arg(party_id)
FOR UPDATE;

-- name: ListPartyMergeRelationships :many
SELECT object.entity AS relationship_type, object.id AS object_id, object.code AS object_code,
       party_rel.operating_entity_id, operating_detail.legal_name AS operating_entity_name,
       true AS enabled,
       COALESCE(open_entry.id,'')::text AS open_approval_entry_id,
       approved.id AS latest_approved_entry_id,
       COALESCE(open_entry.status,approved.status)::text AS visible_status,
       COALESCE(open_entry.revision,approved.revision)::bigint AS visible_approval_revision,
       party_rel.merged_into_object_id
FROM dcl_party_relationship_endpoints party_rel
JOIN dcl_subjects object ON object.id=party_rel.object_id AND object.entity=party_rel.entity
JOIN LATERAL (
  SELECT id,status,revision FROM approval_entries
  WHERE domain='dcl' AND entity=object.entity AND subject_id=object.id AND status='APPROVED'
  ORDER BY version_no DESC LIMIT 1
) approved ON true
LEFT JOIN LATERAL (
  SELECT id,status,revision FROM approval_entries
  WHERE domain='dcl' AND entity=object.entity AND subject_id=object.id AND status IN ('DRAFT','PENDING')
  ORDER BY version_no DESC LIMIT 1
) open_entry ON true
JOIN dcl_subjects operating ON operating.id=party_rel.operating_entity_id AND operating.entity='operating-entity'
JOIN LATERAL (SELECT id FROM approval_entries WHERE domain='dcl' AND entity='operating-entity' AND subject_id=operating.id AND status='APPROVED' ORDER BY version_no DESC LIMIT 1) operating_entry ON true
JOIN dcl_operating_entity_versions operating_detail ON operating_detail.approval_entry_id=operating_entry.id
WHERE party_rel.party_id=sqlc.arg(party_id)
ORDER BY object.entity,party_rel.operating_entity_id,object.id;

-- name: LockPartyMergeObjects :many
SELECT id,entity,0::bigint AS revision,true AS enabled
FROM dcl_subjects
WHERE id=ANY(sqlc.arg(object_ids)::text[])
ORDER BY id
FOR UPDATE;

-- name: InsertPartyMergePreflight :exec
INSERT INTO dcl_party_merge_preflights(
    id,source_party_id,target_party_id,source_approval_entry_id,target_approval_entry_id,source_approval_revision,target_approval_revision,state_fingerprint,created_by,request_id
) VALUES (
    sqlc.arg(id),sqlc.arg(source_party_id),sqlc.arg(target_party_id),sqlc.arg(source_approval_entry_id),sqlc.arg(target_approval_entry_id),sqlc.arg(source_approval_revision),
    sqlc.arg(target_approval_revision),sqlc.arg(state_fingerprint),sqlc.arg(actor_id),sqlc.arg(request_id)
);

-- name: LockPartyMergePreflight :one
SELECT id,source_party_id,target_party_id,source_approval_entry_id,target_approval_entry_id,source_approval_revision,target_approval_revision,state_fingerprint,
       created_at,created_by,request_id,consumed_at,consumed_by
FROM dcl_party_merge_preflights
WHERE id=sqlc.arg(id)
FOR UPDATE;

-- name: ConsumePartyMergePreflight :execrows
UPDATE dcl_party_merge_preflights
SET consumed_at=now(),consumed_by=sqlc.arg(actor_id)
WHERE id=sqlc.arg(id) AND consumed_at IS NULL;

-- name: MarkPartyMerged :execrows
UPDATE dcl_parties
SET merged_into_party_id=sqlc.arg(target_party_id),merged_at=now()
WHERE id=sqlc.arg(source_party_id) AND merged_into_party_id IS NULL;

-- name: MoveCustomerRelationshipParty :execrows
UPDATE dcl_customer_relationships SET party_id=sqlc.arg(target_party_id)
WHERE object_id=sqlc.arg(source_object_id) AND party_id=sqlc.arg(source_party_id)
  AND merged_into_object_id IS NULL;

-- name: MoveSupplierRelationshipParty :execrows
UPDATE dcl_supplier_relationships SET party_id=sqlc.arg(target_party_id)
WHERE object_id=sqlc.arg(source_object_id) AND party_id=sqlc.arg(source_party_id)
  AND merged_into_object_id IS NULL;

-- name: MoveEmploymentRelationshipParty :execrows
UPDATE dcl_employment_relationships SET party_id=sqlc.arg(target_party_id)
WHERE object_id=sqlc.arg(source_object_id) AND party_id=sqlc.arg(source_party_id)
  AND merged_into_object_id IS NULL;

-- name: MoveServiceRelationshipParty :execrows
UPDATE dcl_service_relationships SET party_id=sqlc.arg(target_party_id)
WHERE object_id=sqlc.arg(source_object_id) AND party_id=sqlc.arg(source_party_id)
  AND merged_into_object_id IS NULL;

-- name: MoveSalesRelationshipParty :execrows
UPDATE dcl_sales_relationships SET party_id=sqlc.arg(target_party_id)
WHERE object_id=sqlc.arg(source_object_id) AND party_id=sqlc.arg(source_party_id)
  AND merged_into_object_id IS NULL;

-- name: MarkCustomerRelationshipMerged :execrows
UPDATE dcl_customer_relationships SET merged_into_object_id=sqlc.arg(target_object_id),merged_at=now()
WHERE object_id=sqlc.arg(source_object_id) AND party_id=sqlc.arg(source_party_id)
  AND merged_into_object_id IS NULL;

-- name: MoveCustomerAccountsToRetainedRelationship :execrows
UPDATE dcl_customer_accounts
SET customer_relationship_id=sqlc.arg(target_relationship_id)
WHERE customer_relationship_id=sqlc.arg(source_relationship_id);

-- name: MarkSupplierRelationshipMerged :execrows
UPDATE dcl_supplier_relationships SET merged_into_object_id=sqlc.arg(target_object_id),merged_at=now()
WHERE object_id=sqlc.arg(source_object_id) AND party_id=sqlc.arg(source_party_id)
  AND merged_into_object_id IS NULL;

-- name: MarkEmploymentRelationshipMerged :execrows
UPDATE dcl_employment_relationships SET merged_into_object_id=sqlc.arg(target_object_id),merged_at=now()
WHERE object_id=sqlc.arg(source_object_id) AND party_id=sqlc.arg(source_party_id)
  AND merged_into_object_id IS NULL;

-- name: MarkServiceRelationshipMerged :execrows
UPDATE dcl_service_relationships SET merged_into_object_id=sqlc.arg(target_object_id),merged_at=now()
WHERE object_id=sqlc.arg(source_object_id) AND party_id=sqlc.arg(source_party_id)
  AND merged_into_object_id IS NULL;

-- name: MarkSalesRelationshipMerged :execrows
UPDATE dcl_sales_relationships SET merged_into_object_id=sqlc.arg(target_object_id),merged_at=now()
WHERE object_id=sqlc.arg(source_object_id) AND party_id=sqlc.arg(source_party_id)
  AND merged_into_object_id IS NULL;

-- name: InsertPartyMergeEvent :exec
INSERT INTO dcl_party_merge_events(
    id,preflight_id,source_party_id,target_party_id,actor_id,request_id
) VALUES (
    sqlc.arg(id),sqlc.arg(preflight_id),sqlc.arg(source_party_id),sqlc.arg(target_party_id),
    sqlc.arg(actor_id),sqlc.arg(request_id)
);

-- name: InsertPartyRelationshipMergeEvent :exec
INSERT INTO dcl_party_relationship_merge_events(
    id,merge_event_id,relationship_type,source_object_id,target_object_id,operating_entity_id,action
) VALUES (
    sqlc.arg(id),sqlc.arg(merge_event_id),sqlc.arg(relationship_type),sqlc.arg(source_object_id),
    sqlc.narg(target_object_id),sqlc.arg(operating_entity_id),sqlc.arg(action)
);

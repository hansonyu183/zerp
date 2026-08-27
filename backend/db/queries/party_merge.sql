-- name: LockPartyMergeParty :one
SELECT party.id,current.kind,current.source_approval_entry_id,approval.revision,party.merged_into_party_id,
       EXISTS(SELECT 1 FROM approval_entries open_entry WHERE open_entry.domain='dcl' AND open_entry.entity='party' AND open_entry.subject_id=party.id AND open_entry.status IN ('DRAFT','PENDING')) AS has_open_candidate
FROM bob_parties party
JOIN bob_party_currents current ON current.party_id=party.id
JOIN approval_entries approval ON approval.id=current.source_approval_entry_id AND approval.domain='dcl' AND approval.entity='party' AND approval.status='APPROVED'
WHERE party.id=sqlc.arg(party_id)
FOR UPDATE;

-- name: ListPartyMergeRelationships :many
SELECT object.entity AS relationship_type, object.id AS object_id, object.code AS object_code,
       relation.operating_entity_id, operating_detail.legal_name AS operating_entity_name,
       object.revision AS object_revision, object.enabled,
       COALESCE(open_entry.id,'')::text AS open_approval_entry_id,
       approved.id AS latest_approved_entry_id,
       COALESCE(open_entry.status,approved.status)::text AS visible_status,
       COALESCE(open_entry.revision,approved.revision)::bigint AS visible_approval_revision,
       relation.merged_into_object_id
FROM bob_party_relationship_endpoints relation
JOIN bob_objects object ON object.id=relation.object_id
JOIN LATERAL (
  SELECT id,status,revision FROM approval_entries
  WHERE domain='bob' AND entity=object.entity AND subject_id=object.id AND status='APPROVED'
  ORDER BY version_no DESC LIMIT 1
) approved ON true
LEFT JOIN LATERAL (
  SELECT id,status,revision FROM approval_entries
  WHERE domain='bob' AND entity=object.entity AND subject_id=object.id AND status IN ('DRAFT','PENDING')
  ORDER BY version_no DESC LIMIT 1
) open_entry ON true
JOIN bob_operating_entities operating_detail ON operating_detail.object_id=relation.operating_entity_id
WHERE relation.party_id=sqlc.arg(party_id)
ORDER BY object.entity,relation.operating_entity_id,object.id;

-- name: LockPartyMergeObjects :many
SELECT id,entity,revision,enabled
FROM bob_objects
WHERE id=ANY(sqlc.arg(object_ids)::text[])
ORDER BY id
FOR UPDATE;

-- name: InsertPartyMergePreflight :exec
INSERT INTO bob_party_merge_preflights(
    id,source_party_id,target_party_id,source_approval_entry_id,target_approval_entry_id,source_approval_revision,target_approval_revision,state_fingerprint,created_by,request_id
) VALUES (
    sqlc.arg(id),sqlc.arg(source_party_id),sqlc.arg(target_party_id),sqlc.arg(source_approval_entry_id),sqlc.arg(target_approval_entry_id),sqlc.arg(source_approval_revision),
    sqlc.arg(target_approval_revision),sqlc.arg(state_fingerprint),sqlc.arg(actor_id),sqlc.arg(request_id)
);

-- name: LockPartyMergePreflight :one
SELECT id,source_party_id,target_party_id,source_approval_entry_id,target_approval_entry_id,source_approval_revision,target_approval_revision,state_fingerprint,
       created_at,created_by,request_id,consumed_at,consumed_by
FROM bob_party_merge_preflights
WHERE id=sqlc.arg(id)
FOR UPDATE;

-- name: ConsumePartyMergePreflight :execrows
UPDATE bob_party_merge_preflights
SET consumed_at=now(),consumed_by=sqlc.arg(actor_id)
WHERE id=sqlc.arg(id) AND consumed_at IS NULL;

-- name: MarkPartyMerged :execrows
UPDATE bob_parties
SET merged_into_party_id=sqlc.arg(target_party_id),merged_at=now()
WHERE id=sqlc.arg(source_party_id) AND merged_into_party_id IS NULL;

-- name: DeleteMergedPartyCurrent :execrows
DELETE FROM bob_party_currents WHERE party_id=sqlc.arg(source_party_id);

-- name: DeleteMergedPartyCurrentIdentifiers :execrows
DELETE FROM bob_party_identifiers WHERE party_id=sqlc.arg(source_party_id);

-- name: MoveCustomerRelationshipParty :execrows
UPDATE bob_customer_relationships SET party_id=sqlc.arg(target_party_id)
WHERE object_id=sqlc.arg(source_object_id) AND party_id=sqlc.arg(source_party_id)
  AND merged_into_object_id IS NULL;

-- name: MoveSupplierRelationshipParty :execrows
UPDATE bob_supplier_relationships SET party_id=sqlc.arg(target_party_id)
WHERE object_id=sqlc.arg(source_object_id) AND party_id=sqlc.arg(source_party_id)
  AND merged_into_object_id IS NULL;

-- name: MoveEmploymentRelationshipParty :execrows
UPDATE bob_employment_relationships SET party_id=sqlc.arg(target_party_id)
WHERE object_id=sqlc.arg(source_object_id) AND party_id=sqlc.arg(source_party_id)
  AND merged_into_object_id IS NULL;

-- name: MoveServiceRelationshipParty :execrows
UPDATE bob_service_relationships SET party_id=sqlc.arg(target_party_id)
WHERE object_id=sqlc.arg(source_object_id) AND party_id=sqlc.arg(source_party_id)
  AND merged_into_object_id IS NULL;

-- name: MoveSalesRelationshipParty :execrows
UPDATE bob_sales_relationships SET party_id=sqlc.arg(target_party_id)
WHERE object_id=sqlc.arg(source_object_id) AND party_id=sqlc.arg(source_party_id)
  AND merged_into_object_id IS NULL;

-- name: MarkCustomerRelationshipMerged :execrows
UPDATE bob_customer_relationships SET merged_into_object_id=sqlc.arg(target_object_id),merged_at=now()
WHERE object_id=sqlc.arg(source_object_id) AND party_id=sqlc.arg(source_party_id)
  AND merged_into_object_id IS NULL;

-- name: MoveCustomerAccountsToRetainedRelationship :execrows
UPDATE bob_customer_accounts
SET customer_relationship_id=sqlc.arg(target_relationship_id)
WHERE customer_relationship_id=sqlc.arg(source_relationship_id);

-- name: MarkSupplierRelationshipMerged :execrows
UPDATE bob_supplier_relationships SET merged_into_object_id=sqlc.arg(target_object_id),merged_at=now()
WHERE object_id=sqlc.arg(source_object_id) AND party_id=sqlc.arg(source_party_id)
  AND merged_into_object_id IS NULL;

-- name: MarkEmploymentRelationshipMerged :execrows
UPDATE bob_employment_relationships SET merged_into_object_id=sqlc.arg(target_object_id),merged_at=now()
WHERE object_id=sqlc.arg(source_object_id) AND party_id=sqlc.arg(source_party_id)
  AND merged_into_object_id IS NULL;

-- name: MarkServiceRelationshipMerged :execrows
UPDATE bob_service_relationships SET merged_into_object_id=sqlc.arg(target_object_id),merged_at=now()
WHERE object_id=sqlc.arg(source_object_id) AND party_id=sqlc.arg(source_party_id)
  AND merged_into_object_id IS NULL;

-- name: MarkSalesRelationshipMerged :execrows
UPDATE bob_sales_relationships SET merged_into_object_id=sqlc.arg(target_object_id),merged_at=now()
WHERE object_id=sqlc.arg(source_object_id) AND party_id=sqlc.arg(source_party_id)
  AND merged_into_object_id IS NULL;

-- name: DisableMergedPartyRelationshipObject :execrows
UPDATE bob_objects SET enabled=false,revision=revision+1,updated_at=now(),updated_by=sqlc.arg(actor_id)
WHERE id=sqlc.arg(object_id) AND entity=sqlc.arg(entity) AND revision=sqlc.arg(revision) AND enabled=true;

-- name: InsertPartyMergeEvent :exec
INSERT INTO bob_party_merge_events(
    id,preflight_id,source_party_id,target_party_id,actor_id,request_id
) VALUES (
    sqlc.arg(id),sqlc.arg(preflight_id),sqlc.arg(source_party_id),sqlc.arg(target_party_id),
    sqlc.arg(actor_id),sqlc.arg(request_id)
);

-- name: InsertPartyRelationshipMergeEvent :exec
INSERT INTO bob_party_relationship_merge_events(
    id,merge_event_id,relationship_type,source_object_id,target_object_id,operating_entity_id,action
) VALUES (
    sqlc.arg(id),sqlc.arg(merge_event_id),sqlc.arg(relationship_type),sqlc.arg(source_object_id),
    sqlc.narg(target_object_id),sqlc.arg(operating_entity_id),sqlc.arg(action)
);

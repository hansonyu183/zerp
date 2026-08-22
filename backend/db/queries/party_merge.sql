-- name: LockPartyMergeParty :one
SELECT id,kind,revision,merged_into_party_id
FROM bob_parties
WHERE id=sqlc.arg(party_id)
FOR UPDATE;

-- name: ListPartyMergeRelationships :many
SELECT 'customer'::text AS relationship_type,relation.object_id,object.code AS object_code,
       relation.operating_entity_id,operating.legal_name AS operating_entity_name,
       object.revision AS object_revision,object.enabled,object.current_version_id,
       object.effective_version_id,current_version.status AS current_status,
       current_version.revision AS current_revision,relation.merged_into_object_id
FROM bob_customer_relationships relation
JOIN bob_objects object ON object.id=relation.object_id AND object.entity='customer'
JOIN bob_versions current_version ON current_version.id=object.current_version_id
JOIN bob_operating_entity_versions operating ON operating.version_id=(SELECT effective_version_id FROM bob_objects WHERE id=relation.operating_entity_id AND entity='operating-entity')
WHERE relation.party_id=sqlc.arg(party_id)
UNION ALL
SELECT 'supplier'::text,relation.object_id,object.code,relation.operating_entity_id,operating.legal_name,
       object.revision,object.enabled,object.current_version_id,object.effective_version_id,
       current_version.status,current_version.revision,relation.merged_into_object_id
FROM bob_supplier_relationships relation
JOIN bob_objects object ON object.id=relation.object_id AND object.entity='supplier'
JOIN bob_versions current_version ON current_version.id=object.current_version_id
JOIN bob_operating_entity_versions operating ON operating.version_id=(SELECT effective_version_id FROM bob_objects WHERE id=relation.operating_entity_id AND entity='operating-entity')
WHERE relation.party_id=sqlc.arg(party_id)
UNION ALL
SELECT 'employee'::text,relation.object_id,object.code,relation.operating_entity_id,operating.legal_name,
       object.revision,object.enabled,object.current_version_id,object.effective_version_id,
       current_version.status,current_version.revision,relation.merged_into_object_id
FROM bob_employment_relationships relation
JOIN bob_objects object ON object.id=relation.object_id AND object.entity='employee'
JOIN bob_versions current_version ON current_version.id=object.current_version_id
JOIN bob_operating_entity_versions operating ON operating.version_id=(SELECT effective_version_id FROM bob_objects WHERE id=relation.operating_entity_id AND entity='operating-entity')
WHERE relation.party_id=sqlc.arg(party_id)
UNION ALL
SELECT 'other-unit'::text,relation.object_id,object.code,relation.operating_entity_id,operating.legal_name,
       object.revision,object.enabled,object.current_version_id,object.effective_version_id,
       current_version.status,current_version.revision,relation.merged_into_object_id
FROM bob_service_relationships relation
JOIN bob_objects object ON object.id=relation.object_id AND object.entity='other-unit'
JOIN bob_versions current_version ON current_version.id=object.current_version_id
JOIN bob_operating_entity_versions operating ON operating.version_id=(SELECT effective_version_id FROM bob_objects WHERE id=relation.operating_entity_id AND entity='operating-entity')
WHERE relation.party_id=sqlc.arg(party_id)
UNION ALL
SELECT 'sales-partner'::text,relation.object_id,object.code,relation.operating_entity_id,operating.legal_name,
       object.revision,object.enabled,object.current_version_id,object.effective_version_id,
       current_version.status,current_version.revision,relation.merged_into_object_id
FROM bob_sales_relationships relation
JOIN bob_objects object ON object.id=relation.object_id AND object.entity='sales-partner'
JOIN bob_versions current_version ON current_version.id=object.current_version_id
JOIN bob_operating_entity_versions operating ON operating.version_id=(SELECT effective_version_id FROM bob_objects WHERE id=relation.operating_entity_id AND entity='operating-entity')
WHERE relation.party_id=sqlc.arg(party_id)
ORDER BY relationship_type,operating_entity_id,object_id;

-- name: LockPartyMergeObjects :many
SELECT id,entity,revision,enabled,current_version_id,effective_version_id
FROM bob_objects
WHERE id=ANY(sqlc.arg(object_ids)::text[])
ORDER BY id
FOR UPDATE;

-- name: InsertPartyMergePreflight :exec
INSERT INTO bob_party_merge_preflights(
    id,source_party_id,target_party_id,source_revision,target_revision,state_fingerprint,created_by,request_id
) VALUES (
    sqlc.arg(id),sqlc.arg(source_party_id),sqlc.arg(target_party_id),sqlc.arg(source_revision),
    sqlc.arg(target_revision),sqlc.arg(state_fingerprint),sqlc.arg(actor_id),sqlc.arg(request_id)
);

-- name: LockPartyMergePreflight :one
SELECT id,source_party_id,target_party_id,source_revision,target_revision,state_fingerprint,
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
SET merged_into_party_id=sqlc.arg(target_party_id),merged_at=now(),revision=revision+1,
    updated_at=now(),updated_by=sqlc.arg(actor_id)
WHERE id=sqlc.arg(source_party_id) AND revision=sqlc.arg(revision) AND merged_into_party_id IS NULL;

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

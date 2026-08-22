-- name: InsertBobSalesRelationship :exec
INSERT INTO bob_sales_relationships(object_id,party_id,operating_entity_id,created_by)
VALUES(sqlc.arg(object_id),sqlc.arg(party_id),sqlc.arg(operating_entity_id),sqlc.arg(actor_id));

-- name: GetBobSalesRelationshipPartyID :one
SELECT party_id FROM bob_sales_relationships WHERE object_id=sqlc.arg(object_id);

-- name: DeleteBobSalesRelationship :execrows
DELETE FROM bob_sales_relationships WHERE object_id=sqlc.arg(object_id) AND party_id=sqlc.arg(party_id);

-- name: InsertBobSalesPartnerDetail :exec
INSERT INTO bob_sales_partner_versions(
  version_id,capabilities,contact_name,contact_phone,email,address,remark
) VALUES(
  sqlc.arg(version_id),sqlc.arg(capabilities)::varchar(32)[],sqlc.narg(contact_name),
  sqlc.narg(contact_phone),sqlc.narg(email),sqlc.narg(address),sqlc.narg(remark)
);

-- name: UpdateBobSalesPartnerDetail :execrows
UPDATE bob_sales_partner_versions SET
  capabilities=sqlc.arg(capabilities)::varchar(32)[],contact_name=sqlc.narg(contact_name),
  contact_phone=sqlc.narg(contact_phone),email=sqlc.narg(email),address=sqlc.narg(address),
  remark=sqlc.narg(remark)
WHERE version_id=sqlc.arg(version_id);

-- name: CopyBobSalesPartnerDetail :exec
INSERT INTO bob_sales_partner_versions(version_id,capabilities,contact_name,contact_phone,email,address,remark)
SELECT sqlc.arg(new_version_id),source.capabilities,source.contact_name,source.contact_phone,
  source.email,source.address,source.remark
FROM bob_sales_partner_versions source WHERE source.version_id=sqlc.arg(source_version_id);

-- name: DeleteBobSalesPartnerDetail :execrows
DELETE FROM bob_sales_partner_versions WHERE version_id=sqlc.arg(version_id);

-- name: GetStoredBobSalesPartnerDetail :one
SELECT capabilities,COALESCE(contact_name,'') AS contact_name,COALESCE(contact_phone,'') AS contact_phone,
  COALESCE(email,'') AS email,COALESCE(address,'') AS address,COALESCE(remark,'') AS remark
FROM bob_sales_partner_versions WHERE version_id=sqlc.arg(version_id);

-- name: GetBobSalesPartnerIdentity :one
SELECT relationship.party_id,party.kind AS party_kind,party.display_name AS party_display_name,
  relationship.operating_entity_id,operating.code AS operating_entity_code,
  operating_detail.legal_name AS operating_entity_name
FROM bob_sales_relationships relationship
JOIN bob_parties party ON party.id=relationship.party_id AND party.merged_into_party_id IS NULL
JOIN bob_objects operating ON operating.id=relationship.operating_entity_id
  AND operating.entity='operating-entity' AND operating.enabled
JOIN bob_operating_entity_versions operating_detail ON operating_detail.version_id=operating.effective_version_id
WHERE relationship.object_id=sqlc.arg(object_id) AND relationship.merged_into_object_id IS NULL;

-- name: GetBobSalesPartner :one
SELECT object.id AS object_id,object.code,object.revision AS object_revision,object.enabled,
  object.effective_version_id,object.current_version_id,object.updated_at,
  relationship.party_id,party.kind AS party_kind,party.display_name AS party_display_name,
  relationship.operating_entity_id,operating.code AS operating_entity_code,
  operating_detail.legal_name AS operating_entity_name
FROM bob_objects object
JOIN bob_sales_relationships relationship ON relationship.object_id=object.id
  AND relationship.merged_into_object_id IS NULL
JOIN bob_parties party ON party.id=relationship.party_id AND party.merged_into_party_id IS NULL
JOIN bob_objects operating ON operating.id=relationship.operating_entity_id AND operating.entity='operating-entity'
JOIN bob_operating_entity_versions operating_detail ON operating_detail.version_id=operating.effective_version_id
WHERE object.id=sqlc.arg(object_id) AND object.entity='sales-partner';

-- name: GetBobSalesPartnerVersion :one
SELECT version.id,version.version_no,version.status,version.revision,version.created_at,version.created_by,
  version.updated_at,version.updated_by,version.submitted_at,version.submitted_by,
  version.reviewed_at,version.reviewed_by,version.review_comment,
  detail.capabilities,COALESCE(detail.contact_name,'') AS contact_name,
  COALESCE(detail.contact_phone,'') AS contact_phone,COALESCE(detail.email,'') AS email,
  COALESCE(detail.address,'') AS address,COALESCE(detail.remark,'') AS remark
FROM bob_versions version
JOIN bob_sales_partner_versions detail ON detail.version_id=version.id
WHERE version.object_id=sqlc.arg(object_id) AND version.entity='sales-partner'
  AND version.id=sqlc.arg(version_id);

-- name: CountBobSalesPartners :one
SELECT count(*)
FROM bob_objects object
JOIN bob_sales_relationships relationship ON relationship.object_id=object.id
  AND relationship.merged_into_object_id IS NULL
JOIN bob_parties party ON party.id=relationship.party_id AND party.merged_into_party_id IS NULL
JOIN bob_versions current_version ON current_version.id=object.current_version_id
JOIN bob_sales_partner_versions current_detail ON current_detail.version_id=current_version.id
WHERE object.entity='sales-partner'
  AND (sqlc.arg(keyword)::text='' OR object.code ILIKE '%'||sqlc.arg(keyword)::text||'%'
       OR party.display_name ILIKE '%'||sqlc.arg(keyword)::text||'%')
  AND (cardinality(sqlc.arg(statuses)::text[])=0 OR current_version.status=ANY(sqlc.arg(statuses)::text[]))
  AND (sqlc.arg(enabled_filter)::integer=-1 OR object.enabled=(sqlc.arg(enabled_filter)::integer=1))
  AND (sqlc.arg(operating_entity_id)::text='' OR relationship.operating_entity_id=sqlc.arg(operating_entity_id)::text)
  AND (sqlc.arg(capability)::text='' OR sqlc.arg(capability)::text=ANY(current_detail.capabilities));

-- name: ListBobSalesPartners :many
SELECT object.id AS object_id,object.code,object.revision AS object_revision,object.enabled,object.updated_at,
  relationship.party_id,party.kind AS party_kind,party.display_name AS party_display_name,
  relationship.operating_entity_id,operating.code AS operating_entity_code,
  operating_detail.legal_name AS operating_entity_name,
  effective_version.id AS effective_version_id,effective_version.version_no AS effective_version_no,
  effective_version.status AS effective_status,effective_version.revision AS effective_revision,
  effective_detail.capabilities AS effective_capabilities,effective_version.submitted_by AS effective_submitted_by,
  candidate_version.id AS candidate_version_id,candidate_version.version_no AS candidate_version_no,
  candidate_version.status AS candidate_status,candidate_version.revision AS candidate_revision,
  candidate_detail.capabilities AS candidate_capabilities,candidate_version.submitted_by AS candidate_submitted_by
FROM bob_objects object
JOIN bob_sales_relationships relationship ON relationship.object_id=object.id
  AND relationship.merged_into_object_id IS NULL
JOIN bob_parties party ON party.id=relationship.party_id AND party.merged_into_party_id IS NULL
JOIN bob_objects operating ON operating.id=relationship.operating_entity_id AND operating.entity='operating-entity'
JOIN bob_operating_entity_versions operating_detail ON operating_detail.version_id=operating.effective_version_id
JOIN bob_versions current_version ON current_version.id=object.current_version_id
JOIN bob_sales_partner_versions current_detail ON current_detail.version_id=current_version.id
LEFT JOIN bob_versions effective_version ON effective_version.id=object.effective_version_id
LEFT JOIN bob_sales_partner_versions effective_detail ON effective_detail.version_id=effective_version.id
LEFT JOIN bob_versions candidate_version ON candidate_version.id=object.current_version_id
  AND (object.effective_version_id IS NULL OR object.current_version_id<>object.effective_version_id)
LEFT JOIN bob_sales_partner_versions candidate_detail ON candidate_detail.version_id=candidate_version.id
WHERE object.entity='sales-partner'
  AND (sqlc.arg(keyword)::text='' OR object.code ILIKE '%'||sqlc.arg(keyword)::text||'%'
       OR party.display_name ILIKE '%'||sqlc.arg(keyword)::text||'%')
  AND (cardinality(sqlc.arg(statuses)::text[])=0 OR current_version.status=ANY(sqlc.arg(statuses)::text[]))
  AND (sqlc.arg(enabled_filter)::integer=-1 OR object.enabled=(sqlc.arg(enabled_filter)::integer=1))
  AND (sqlc.arg(operating_entity_id)::text='' OR relationship.operating_entity_id=sqlc.arg(operating_entity_id)::text)
  AND (sqlc.arg(capability)::text='' OR sqlc.arg(capability)::text=ANY(current_detail.capabilities))
ORDER BY object.code ASC OFFSET sqlc.arg(row_offset) LIMIT sqlc.arg(row_limit);

-- name: RestoreBobSalesPartnerEffectiveVersion :execrows
UPDATE bob_objects SET current_version_id=effective_version_id,revision=revision+1,updated_at=now()
WHERE id=sqlc.arg(object_id) AND entity='sales-partner' AND revision=sqlc.arg(revision)
  AND current_version_id=sqlc.arg(version_id) AND effective_version_id=sqlc.arg(effective_version_id);

-- name: AdvanceBobSalesPartnerCandidate :execrows
UPDATE bob_objects SET current_version_id=sqlc.arg(version_id),next_version_no=next_version_no+1,
  revision=revision+1,updated_at=now(),updated_by=sqlc.arg(actor_id)
WHERE id=sqlc.arg(object_id) AND entity='sales-partner' AND revision=sqlc.arg(revision)
  AND current_version_id=sqlc.arg(current_version_id);

-- name: DeleteBobSalesPartnerVersion :execrows
DELETE FROM bob_versions WHERE id=sqlc.arg(version_id) AND object_id=sqlc.arg(object_id)
  AND entity='sales-partner' AND status IN ('DRAFT','PENDING');

-- name: ResolveBobEffectiveSalesPartnerReference :one
SELECT object.id AS object_id,object.entity,object.code,version.id AS version_id,
  party.id AS party_id,party.display_name AS name,relationship.operating_entity_id,
  detail.capabilities
FROM bob_objects object
JOIN bob_sales_relationships relationship ON relationship.object_id=object.id
  AND relationship.merged_into_object_id IS NULL
JOIN bob_parties party ON party.id=relationship.party_id AND party.merged_into_party_id IS NULL
JOIN bob_versions version ON version.id=object.effective_version_id AND version.status='EFFECTIVE'
JOIN bob_sales_partner_versions detail ON detail.version_id=version.id
WHERE object.id=sqlc.arg(object_id) AND object.entity='sales-partner' AND object.enabled
  AND version.id=sqlc.arg(version_id);

-- name: ResolveCurrentBobEffectiveSalesPartnerReference :one
SELECT object.id AS object_id,object.entity,object.code,version.id AS version_id,
  party.id AS party_id,party.display_name AS name,relationship.operating_entity_id,
  detail.capabilities
FROM bob_objects object
JOIN bob_sales_relationships relationship ON relationship.object_id=object.id
  AND relationship.merged_into_object_id IS NULL
JOIN bob_parties party ON party.id=relationship.party_id AND party.merged_into_party_id IS NULL
JOIN bob_versions version ON version.id=object.effective_version_id AND version.status='EFFECTIVE'
JOIN bob_sales_partner_versions detail ON detail.version_id=version.id
WHERE object.id=sqlc.arg(object_id) AND object.entity='sales-partner' AND object.enabled;

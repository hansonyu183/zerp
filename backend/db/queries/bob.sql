-- name: NextObjectNumberCounter :one
INSERT INTO object_number_counters (domain, entity, last_value)
VALUES (sqlc.arg(domain), sqlc.arg(entity), 1)
ON CONFLICT (domain, entity)
DO UPDATE SET last_value = object_number_counters.last_value + 1
WHERE object_number_counters.last_value < 9999
RETURNING last_value;

-- name: CountBobCustomers :one
SELECT count(*)
FROM bob_objects o
JOIN bob_customer_accounts account ON account.object_id = o.id
JOIN bob_versions current_version ON current_version.id = o.current_version_id
JOIN bob_customer_versions current_detail ON current_detail.version_id = current_version.id
LEFT JOIN bob_versions effective_version ON effective_version.id = o.effective_version_id
LEFT JOIN bob_customer_versions effective_detail ON effective_detail.version_id = effective_version.id
WHERE o.entity = 'customer-account'
  AND (
      sqlc.arg(keyword)::text = ''
      OR o.code ILIKE '%' || sqlc.arg(keyword)::text || '%'
      OR COALESCE(effective_detail.name, current_detail.name) ILIKE '%' || sqlc.arg(keyword)::text || '%'
  )
  AND (
      cardinality(sqlc.arg(statuses)::text[]) = 0
      OR current_version.status = ANY(sqlc.arg(statuses)::text[])
  )
  AND (
      sqlc.arg(enabled_filter)::integer = -1
      OR o.enabled = (sqlc.arg(enabled_filter)::integer = 1)
  )
  AND (
      sqlc.arg(customer_type)::text = ''
      OR COALESCE(effective_detail.customer_type, current_detail.customer_type) = sqlc.arg(customer_type)::text
  )
  AND (
      sqlc.arg(operating_entity_id)::text = ''
      OR COALESCE(effective_detail.operating_entity_id, current_detail.operating_entity_id) = sqlc.arg(operating_entity_id)::text
  )
  AND (
      sqlc.arg(sales_attribution_type)::text = ''
      OR COALESCE(effective_detail.primary_sales_attribution_type, current_detail.primary_sales_attribution_type) = sqlc.arg(sales_attribution_type)::text
  )
  AND (
      sqlc.arg(sales_attribution_subject_id)::text = ''
      OR COALESCE(effective_detail.primary_sales_subject_id, current_detail.primary_sales_subject_id) = sqlc.arg(sales_attribution_subject_id)::text
  );

-- name: ListBobCustomers :many
SELECT
    o.id AS object_id,
    o.code,
    o.revision AS object_revision,
    o.enabled,
    o.updated_at,
    effective_version.id AS effective_version_id,
    effective_version.version_no AS effective_version_no,
    effective_version.status AS effective_status,
    effective_version.revision AS effective_revision,
    effective_detail.name AS effective_name,
    effective_detail.customer_type AS effective_customer_type,
    COALESCE(effective_detail.operating_entity_name, '') AS effective_operating_entity_name,
    COALESCE(effective_detail.primary_sales_subject_name, '') AS effective_sales_attribution_name,
    effective_version.submitted_by AS effective_submitted_by,
    candidate_version.id AS candidate_version_id,
    candidate_version.version_no AS candidate_version_no,
    candidate_version.status AS candidate_status,
    candidate_version.revision AS candidate_revision,
    candidate_detail.name AS candidate_name,
    candidate_detail.customer_type AS candidate_customer_type,
    candidate_version.submitted_by AS candidate_submitted_by
FROM bob_objects o
JOIN bob_customer_accounts account ON account.object_id = o.id
JOIN bob_versions current_version ON current_version.id = o.current_version_id
JOIN bob_customer_versions current_detail ON current_detail.version_id = current_version.id
LEFT JOIN bob_versions effective_version ON effective_version.id = o.effective_version_id
LEFT JOIN bob_customer_versions effective_detail ON effective_detail.version_id = effective_version.id
LEFT JOIN bob_versions candidate_version
  ON candidate_version.id = o.current_version_id
  AND (o.effective_version_id IS NULL OR o.current_version_id <> o.effective_version_id)
LEFT JOIN bob_customer_versions candidate_detail ON candidate_detail.version_id = candidate_version.id
WHERE o.entity = 'customer-account'
  AND (
      sqlc.arg(keyword)::text = ''
      OR o.code ILIKE '%' || sqlc.arg(keyword)::text || '%'
      OR COALESCE(effective_detail.name, current_detail.name) ILIKE '%' || sqlc.arg(keyword)::text || '%'
  )
  AND (
      cardinality(sqlc.arg(statuses)::text[]) = 0
      OR current_version.status = ANY(sqlc.arg(statuses)::text[])
  )
  AND (
      sqlc.arg(enabled_filter)::integer = -1
      OR o.enabled = (sqlc.arg(enabled_filter)::integer = 1)
  )
  AND (
      sqlc.arg(customer_type)::text = ''
      OR COALESCE(effective_detail.customer_type, current_detail.customer_type) = sqlc.arg(customer_type)::text
  )
  AND (
      sqlc.arg(operating_entity_id)::text = ''
      OR COALESCE(effective_detail.operating_entity_id, current_detail.operating_entity_id) = sqlc.arg(operating_entity_id)::text
  )
  AND (
      sqlc.arg(sales_attribution_type)::text = ''
      OR COALESCE(effective_detail.primary_sales_attribution_type, current_detail.primary_sales_attribution_type) = sqlc.arg(sales_attribution_type)::text
  )
  AND (
      sqlc.arg(sales_attribution_subject_id)::text = ''
      OR COALESCE(effective_detail.primary_sales_subject_id, current_detail.primary_sales_subject_id) = sqlc.arg(sales_attribution_subject_id)::text
  )
ORDER BY o.code ASC
OFFSET sqlc.arg(row_offset)
LIMIT sqlc.arg(row_limit);

-- name: CountBobSuppliers :one
SELECT count(*)
FROM bob_objects o
JOIN bob_supplier_relationships relation ON relation.object_id=o.id AND relation.merged_into_object_id IS NULL
JOIN bob_parties party ON party.id=relation.party_id AND party.merged_into_party_id IS NULL
JOIN bob_versions current_version ON current_version.id=o.current_version_id
JOIN bob_supplier_versions current_detail ON current_detail.version_id=current_version.id
LEFT JOIN bob_supplier_versions effective_detail ON effective_detail.version_id=o.effective_version_id
WHERE o.entity='supplier'
  AND (sqlc.arg(keyword)::text='' OR o.code ILIKE '%'||sqlc.arg(keyword)::text||'%'
       OR party.display_name ILIKE '%'||sqlc.arg(keyword)::text||'%')
  AND (cardinality(sqlc.arg(statuses)::text[])=0 OR current_version.status=ANY(sqlc.arg(statuses)::text[]))
  AND (sqlc.arg(enabled_filter)::integer=-1 OR o.enabled=(sqlc.arg(enabled_filter)::integer=1))
  AND (sqlc.arg(default_purchaser_employee_id)::text='' OR COALESCE(effective_detail.default_purchaser_employee_id,current_detail.default_purchaser_employee_id)=sqlc.arg(default_purchaser_employee_id)::text);

-- name: ListBobSuppliers :many
SELECT o.id AS object_id,o.code,o.revision AS object_revision,o.enabled,o.updated_at,
  relation.party_id,party.kind AS party_kind,party.display_name AS party_display_name,
  relation.operating_entity_id,operating.code AS operating_entity_code,
  operating_detail.legal_name AS operating_entity_name,
  effective_version.id AS effective_version_id,effective_version.version_no AS effective_version_no,
  effective_version.status AS effective_status,effective_version.revision AS effective_revision,
  effective_detail.name AS effective_name,
  COALESCE(effective_purchaser.code,'') AS effective_default_purchaser_code,
  COALESCE(effective_purchaser_detail.name,'') AS effective_default_purchaser_name,
  effective_version.submitted_by AS effective_submitted_by,
  candidate_version.id AS candidate_version_id,candidate_version.version_no AS candidate_version_no,
  candidate_version.status AS candidate_status,candidate_version.revision AS candidate_revision,
  candidate_detail.name AS candidate_name,
  COALESCE(candidate_purchaser.code,'') AS candidate_default_purchaser_code,
  COALESCE(candidate_purchaser_detail.name,'') AS candidate_default_purchaser_name,
  candidate_version.submitted_by AS candidate_submitted_by
FROM bob_objects o
JOIN bob_supplier_relationships relation ON relation.object_id=o.id AND relation.merged_into_object_id IS NULL
JOIN bob_parties party ON party.id=relation.party_id AND party.merged_into_party_id IS NULL
JOIN bob_objects operating ON operating.id=relation.operating_entity_id AND operating.entity='operating-entity'
JOIN bob_operating_entity_versions operating_detail ON operating_detail.version_id=operating.current_version_id
JOIN bob_versions current_version ON current_version.id=o.current_version_id
JOIN bob_supplier_versions current_detail ON current_detail.version_id=current_version.id
LEFT JOIN bob_versions effective_version ON effective_version.id=o.effective_version_id
LEFT JOIN bob_supplier_versions effective_detail ON effective_detail.version_id=effective_version.id
LEFT JOIN bob_objects effective_purchaser ON effective_purchaser.id=effective_detail.default_purchaser_employee_id
LEFT JOIN bob_employee_versions effective_purchaser_detail ON effective_purchaser_detail.version_id=effective_purchaser.effective_version_id
LEFT JOIN bob_versions candidate_version ON candidate_version.id=o.current_version_id
  AND (o.effective_version_id IS NULL OR o.current_version_id<>o.effective_version_id)
LEFT JOIN bob_supplier_versions candidate_detail ON candidate_detail.version_id=candidate_version.id
LEFT JOIN bob_objects candidate_purchaser ON candidate_purchaser.id=candidate_detail.default_purchaser_employee_id
LEFT JOIN bob_employee_versions candidate_purchaser_detail ON candidate_purchaser_detail.version_id=candidate_purchaser.effective_version_id
WHERE o.entity='supplier'
  AND (sqlc.arg(keyword)::text='' OR o.code ILIKE '%'||sqlc.arg(keyword)::text||'%'
       OR party.display_name ILIKE '%'||sqlc.arg(keyword)::text||'%')
  AND (cardinality(sqlc.arg(statuses)::text[])=0 OR current_version.status=ANY(sqlc.arg(statuses)::text[]))
  AND (sqlc.arg(enabled_filter)::integer=-1 OR o.enabled=(sqlc.arg(enabled_filter)::integer=1))
  AND (sqlc.arg(default_purchaser_employee_id)::text='' OR COALESCE(effective_detail.default_purchaser_employee_id,current_detail.default_purchaser_employee_id)=sqlc.arg(default_purchaser_employee_id)::text)
ORDER BY o.code ASC
OFFSET sqlc.arg(row_offset) LIMIT sqlc.arg(row_limit);

-- name: InsertBobObject :exec
INSERT INTO bob_objects (
    id, entity, code, current_version_id, next_version_no, revision, created_by, updated_by
) VALUES (
    sqlc.arg(id), sqlc.arg(entity), sqlc.arg(code), sqlc.arg(current_version_id), 2, 1, sqlc.arg(actor_id), sqlc.arg(actor_id)
);

-- name: InsertBobParty :exec
INSERT INTO bob_parties (
    id,kind,legal_name,display_name,tax_number,phone,email,address,created_by,updated_by
) VALUES (
    sqlc.arg(id),sqlc.arg(kind),sqlc.arg(legal_name),sqlc.arg(display_name),
    sqlc.narg(tax_number),sqlc.narg(phone),sqlc.narg(email),sqlc.narg(address),
    sqlc.arg(actor_id),sqlc.arg(actor_id)
);

-- name: InsertBobPartyIdentifier :exec
INSERT INTO bob_party_identifiers(party_id,identifier_type,value,normalized_value)
VALUES (sqlc.arg(party_id),sqlc.arg(identifier_type),sqlc.arg(value),sqlc.arg(normalized_value));

-- name: FindBobPartyByIdentifier :one
SELECT p.id,p.kind,p.legal_name,p.display_name,p.tax_number,p.phone,p.email,p.address,
       p.revision,p.created_at,p.created_by,p.updated_at,p.updated_by,p.merged_into_party_id,p.merged_at
FROM bob_party_identifiers identifier
JOIN bob_parties p ON p.id=identifier.party_id
WHERE identifier.identifier_type=sqlc.arg(identifier_type)
  AND identifier.normalized_value=sqlc.arg(normalized_value)
  AND p.merged_into_party_id IS NULL;

-- name: AcquireBobPartyIdentifierLock :exec
SELECT pg_advisory_xact_lock(hashtextextended(sqlc.arg(lock_key),0));

-- name: GetBobParty :one
SELECT id,kind,legal_name,display_name,tax_number,phone,email,address,
       revision,created_at,created_by,updated_at,updated_by,merged_into_party_id,merged_at
FROM bob_parties WHERE id=sqlc.arg(party_id);

-- name: LockBobParty :one
SELECT id,kind,legal_name,display_name,tax_number,phone,email,address,
       revision,created_at,created_by,updated_at,updated_by,merged_into_party_id,merged_at
FROM bob_parties WHERE id=sqlc.arg(party_id) FOR UPDATE;

-- name: ListBobPartyIdentifiers :many
SELECT identifier_type,value
FROM bob_party_identifiers
WHERE party_id=sqlc.arg(party_id)
ORDER BY identifier_type,value;

-- name: CountBobParties :one
SELECT count(*) FROM bob_parties
WHERE (sqlc.arg(party_kind)::text='' OR kind=sqlc.arg(party_kind)::text)
  AND ((merged_into_party_id IS NOT NULL)=sqlc.arg(merged)::boolean)
  AND (sqlc.arg(keyword)::text=''
   OR legal_name ILIKE '%'||sqlc.arg(keyword)::text||'%'
   OR display_name ILIKE '%'||sqlc.arg(keyword)::text||'%'
   OR COALESCE(phone,'') ILIKE '%'||sqlc.arg(keyword)::text||'%'
   OR COALESCE(email,'') ILIKE '%'||sqlc.arg(keyword)::text||'%'
   OR COALESCE(address,'') ILIKE '%'||sqlc.arg(keyword)::text||'%');

-- name: ListBobParties :many
SELECT id,kind,legal_name,display_name,tax_number,phone,email,address,
       revision,created_at,created_by,updated_at,updated_by,merged_into_party_id,merged_at
FROM bob_parties
WHERE (sqlc.arg(party_kind)::text='' OR kind=sqlc.arg(party_kind)::text)
  AND ((merged_into_party_id IS NOT NULL)=sqlc.arg(merged)::boolean)
  AND (sqlc.arg(keyword)::text=''
   OR legal_name ILIKE '%'||sqlc.arg(keyword)::text||'%'
   OR display_name ILIKE '%'||sqlc.arg(keyword)::text||'%'
   OR COALESCE(phone,'') ILIKE '%'||sqlc.arg(keyword)::text||'%'
   OR COALESCE(email,'') ILIKE '%'||sqlc.arg(keyword)::text||'%'
   OR COALESCE(address,'') ILIKE '%'||sqlc.arg(keyword)::text||'%')
ORDER BY display_name ASC,id ASC
LIMIT sqlc.arg(page_size) OFFSET sqlc.arg(page_offset);

-- name: UpdateBobParty :execrows
UPDATE bob_parties SET
    kind=sqlc.arg(kind),legal_name=sqlc.arg(legal_name),display_name=sqlc.arg(display_name),
    tax_number=sqlc.narg(tax_number),phone=sqlc.narg(phone),email=sqlc.narg(email),
    address=sqlc.narg(address),revision=revision+1,updated_at=now(),updated_by=sqlc.arg(actor_id)
WHERE id=sqlc.arg(party_id) AND revision=sqlc.arg(revision);

-- name: DeleteBobPartyIdentifiers :exec
DELETE FROM bob_party_identifiers WHERE party_id=sqlc.arg(party_id);

-- name: InsertBobPartyAuditEvent :exec
INSERT INTO bob_party_audit_events(
    id,party_id,event_type,revision,actor_id,request_id,summary
) VALUES (
    sqlc.arg(id),sqlc.arg(party_id),sqlc.arg(event_type),sqlc.arg(revision),
    sqlc.arg(actor_id),sqlc.arg(request_id),sqlc.arg(summary)
);

-- name: ListBobPartyRelationshipCards :many
SELECT relation.object_id,object.code,object.entity,relation.operating_entity_id,
       operating.code AS operating_entity_code,operating_detail.legal_name AS operating_entity_name,
       object.enabled,current_version.status,current_version.version_no
FROM bob_party_relationship_endpoints relation
JOIN bob_objects object ON object.id=relation.object_id
JOIN bob_versions current_version ON current_version.id=object.current_version_id
JOIN bob_objects operating ON operating.id=relation.operating_entity_id AND operating.entity='operating-entity'
JOIN bob_operating_entity_versions operating_detail ON operating_detail.version_id=operating.current_version_id
WHERE relation.party_id=sqlc.arg(target_party_id) AND relation.merged_into_object_id IS NULL
ORDER BY object.code ASC;

-- name: CountBobPartyRelationships :one
SELECT
  (SELECT count(*) FROM bob_customer_relationships customer WHERE customer.party_id=sqlc.arg(target_party_id))+
  (SELECT count(*) FROM bob_supplier_relationships supplier WHERE supplier.party_id=sqlc.arg(target_party_id))+
  (SELECT count(*) FROM bob_employment_relationships employment WHERE employment.party_id=sqlc.arg(target_party_id))+
  (SELECT count(*) FROM bob_service_relationships service WHERE service.party_id=sqlc.arg(target_party_id))+
  (SELECT count(*) FROM bob_sales_relationships sales WHERE sales.party_id=sqlc.arg(target_party_id));

-- name: CountBobPartyAuditEvents :one
SELECT count(*) FROM bob_party_audit_events WHERE party_id=sqlc.arg(party_id);

-- name: DeleteBobPartyAuditEvents :exec
DELETE FROM bob_party_audit_events WHERE party_id=sqlc.arg(party_id);

-- name: DeleteBobParty :execrows
DELETE FROM bob_parties WHERE id=sqlc.arg(party_id) AND revision=sqlc.arg(revision);

-- name: InsertBobServiceRelationship :exec
INSERT INTO bob_service_relationships(
    object_id,party_id,operating_entity_id,created_by
) VALUES (
    sqlc.arg(object_id),sqlc.arg(party_id),sqlc.arg(operating_entity_id),sqlc.arg(actor_id)
);

-- name: InsertBobSupplierRelationship :exec
INSERT INTO bob_supplier_relationships(object_id,party_id,operating_entity_id,created_by)
VALUES(sqlc.arg(object_id),sqlc.arg(party_id),sqlc.arg(operating_entity_id),sqlc.arg(actor_id));

-- name: InsertBobEmploymentRelationship :exec
INSERT INTO bob_employment_relationships(object_id,party_id,operating_entity_id,created_by)
VALUES(sqlc.arg(object_id),sqlc.arg(party_id),sqlc.arg(operating_entity_id),sqlc.arg(actor_id));

-- name: GetBobEmploymentRelationshipIdentity :one
SELECT relation.party_id,party.kind AS party_kind,party.display_name AS party_display_name,
       relation.operating_entity_id,operating.code AS operating_entity_code,
       operating_detail.legal_name AS operating_entity_name
FROM bob_employment_relationships relation
JOIN bob_parties party ON party.id=relation.party_id
JOIN bob_objects operating ON operating.id=relation.operating_entity_id AND operating.entity='operating-entity'
JOIN bob_operating_entity_versions operating_detail ON operating_detail.version_id=operating.current_version_id
WHERE relation.object_id=sqlc.arg(object_id) AND relation.merged_into_object_id IS NULL
  AND party.merged_into_party_id IS NULL;

-- name: GetBobSupplierRelationshipIdentity :one
SELECT relation.party_id,party.kind AS party_kind,party.display_name AS party_display_name,
       relation.operating_entity_id,operating.code AS operating_entity_code,
       operating_detail.legal_name AS operating_entity_name
FROM bob_supplier_relationships relation
JOIN bob_parties party ON party.id=relation.party_id
JOIN bob_objects operating ON operating.id=relation.operating_entity_id AND operating.entity='operating-entity'
JOIN bob_operating_entity_versions operating_detail ON operating_detail.version_id=operating.current_version_id
WHERE relation.object_id=sqlc.arg(object_id) AND relation.merged_into_object_id IS NULL
  AND party.merged_into_party_id IS NULL;

-- name: GetBobServiceRelationshipPartyID :one
SELECT party_id FROM bob_service_relationships
WHERE object_id=sqlc.arg(object_id);

-- name: DeleteBobServiceRelationship :execrows
DELETE FROM bob_service_relationships
WHERE object_id=sqlc.arg(object_id) AND party_id=sqlc.arg(party_id);

-- name: GetBobSupplierRelationshipPartyID :one
SELECT party_id FROM bob_supplier_relationships WHERE object_id=sqlc.arg(object_id);

-- name: DeleteBobSupplierRelationship :execrows
DELETE FROM bob_supplier_relationships WHERE object_id=sqlc.arg(object_id) AND party_id=sqlc.arg(party_id);

-- name: GetBobEmploymentRelationshipPartyID :one
SELECT party_id FROM bob_employment_relationships WHERE object_id=sqlc.arg(object_id);

-- name: DeleteBobEmploymentRelationship :execrows
DELETE FROM bob_employment_relationships WHERE object_id=sqlc.arg(object_id) AND party_id=sqlc.arg(party_id);

-- name: InsertBobServiceRelationshipDetail :exec
INSERT INTO bob_service_relationship_versions(
    version_id,contact_name,contact_phone,email,address,settlement_method_id,
    settlement_method_code,settlement_method_name,settlement_term_code,
    settlement_rule_type,settlement_month_offset,settlement_day_of_month,
    settlement_day_offset,remark
) VALUES (
    sqlc.arg(version_id),sqlc.narg(contact_name),sqlc.narg(contact_phone),sqlc.narg(email),
    sqlc.narg(address),sqlc.narg(settlement_method_id),sqlc.narg(settlement_method_code),
    sqlc.narg(settlement_method_name),sqlc.narg(settlement_term_code),
    sqlc.narg(settlement_rule_type),sqlc.arg(settlement_month_offset),
    sqlc.arg(settlement_day_of_month),sqlc.arg(settlement_day_offset),sqlc.narg(remark)
);

-- name: UpdateBobServiceRelationshipDetail :execrows
UPDATE bob_service_relationship_versions SET
    contact_name=sqlc.narg(contact_name),contact_phone=sqlc.narg(contact_phone),
    email=sqlc.narg(email),address=sqlc.narg(address),
    settlement_method_id=sqlc.narg(settlement_method_id),
    settlement_method_code=sqlc.narg(settlement_method_code),
    settlement_method_name=sqlc.narg(settlement_method_name),
    settlement_term_code=sqlc.narg(settlement_term_code),
    settlement_rule_type=sqlc.narg(settlement_rule_type),
    settlement_month_offset=sqlc.arg(settlement_month_offset),
    settlement_day_of_month=sqlc.arg(settlement_day_of_month),
    settlement_day_offset=sqlc.arg(settlement_day_offset),remark=sqlc.narg(remark)
WHERE version_id=sqlc.arg(version_id);

-- name: CopyBobServiceRelationshipDetail :exec
INSERT INTO bob_service_relationship_versions(
    version_id,contact_name,contact_phone,email,address,settlement_method_id,
    settlement_method_code,settlement_method_name,settlement_term_code,
    settlement_rule_type,settlement_month_offset,settlement_day_of_month,
    settlement_day_offset,remark
)
SELECT sqlc.arg(new_version_id),source.contact_name,source.contact_phone,source.email,source.address,
       source.settlement_method_id,source.settlement_method_code,source.settlement_method_name,
       source.settlement_term_code,source.settlement_rule_type,source.settlement_month_offset,
       source.settlement_day_of_month,source.settlement_day_offset,source.remark
FROM bob_service_relationship_versions source
WHERE source.version_id=sqlc.arg(source_version_id);

-- name: DeleteBobServiceRelationshipDetail :execrows
DELETE FROM bob_service_relationship_versions WHERE version_id=sqlc.arg(version_id);

-- name: GetBobOtherUnit :one
SELECT object.id AS object_id,object.code,object.revision AS object_revision,object.enabled,
       version.id AS version_id,version.version_no,version.status,version.revision AS version_revision,
       version.submitted_by,object.effective_version_id,object.current_version_id,
       relation.party_id,party.kind AS party_kind,party.display_name AS party_display_name,
       relation.operating_entity_id,operating.code AS operating_entity_code,
       operating_detail.legal_name AS operating_entity_name,
       detail.contact_name,detail.contact_phone,detail.email,detail.address,
       detail.settlement_method_id,detail.settlement_method_code,detail.settlement_method_name,
       detail.settlement_term_code,detail.settlement_rule_type,
       detail.settlement_month_offset,detail.settlement_day_of_month,
       detail.settlement_day_offset,detail.remark,object.updated_at
FROM bob_objects object
JOIN bob_service_relationships relation ON relation.object_id=object.id
JOIN bob_parties party ON party.id=relation.party_id
JOIN bob_objects operating ON operating.id=relation.operating_entity_id AND operating.entity='operating-entity'
JOIN bob_operating_entity_versions operating_detail ON operating_detail.version_id=operating.current_version_id
JOIN bob_versions version ON version.object_id=object.id AND version.entity=object.entity
JOIN bob_service_relationship_versions detail ON detail.version_id=version.id
WHERE object.id=sqlc.arg(object_id) AND object.entity='other-unit'
  AND version.id=COALESCE(NULLIF(sqlc.arg(version_id)::text,''),object.current_version_id);

-- name: GetStoredBobServiceRelationshipDetail :one
SELECT contact_name,contact_phone,email,address,settlement_method_id,
       settlement_method_code,settlement_method_name,settlement_term_code,
       settlement_rule_type,settlement_month_offset,settlement_day_of_month,
       settlement_day_offset,remark
FROM bob_service_relationship_versions WHERE version_id=sqlc.arg(version_id);

-- name: ResolveBobEffectiveOtherUnitReference :one
SELECT object.id AS object_id,object.entity,object.code,version.id AS version_id,
       party.display_name AS name,detail.contact_name,detail.contact_phone,
       detail.email,detail.address,detail.settlement_method_id,
       detail.settlement_method_code,detail.settlement_method_name,
       detail.settlement_term_code,detail.settlement_rule_type,
       detail.settlement_month_offset,detail.settlement_day_of_month,
       detail.settlement_day_offset,relation.operating_entity_id
FROM bob_objects object
JOIN bob_versions version ON version.object_id=object.id AND version.entity=object.entity
JOIN bob_service_relationships relation ON relation.object_id=object.id
JOIN bob_parties party ON party.id=relation.party_id
JOIN bob_service_relationship_versions detail ON detail.version_id=version.id
WHERE object.id=sqlc.arg(object_id) AND object.entity='other-unit'
  AND version.id=sqlc.arg(version_id) AND object.effective_version_id=version.id
  AND version.status='EFFECTIVE' AND object.enabled
FOR SHARE OF object,version;

-- name: ResolveCurrentBobEffectiveOtherUnitReference :one
SELECT object.id AS object_id,object.entity,object.code,version.id AS version_id,
       party.display_name AS name,detail.contact_name,detail.contact_phone,
       detail.email,detail.address,detail.settlement_method_id,
       detail.settlement_method_code,detail.settlement_method_name,
       detail.settlement_term_code,detail.settlement_rule_type,
       detail.settlement_month_offset,detail.settlement_day_of_month,
       detail.settlement_day_offset,relation.operating_entity_id
FROM bob_objects object
JOIN bob_versions version ON version.id=object.effective_version_id
JOIN bob_service_relationships relation ON relation.object_id=object.id
JOIN bob_parties party ON party.id=relation.party_id
JOIN bob_service_relationship_versions detail ON detail.version_id=version.id
WHERE object.id=sqlc.arg(object_id) AND object.entity='other-unit'
  AND version.status='EFFECTIVE' AND object.enabled
FOR SHARE OF object,version;

-- name: CountBobOtherUnits :one
SELECT count(*)
FROM bob_objects object
JOIN bob_service_relationships relation ON relation.object_id=object.id
JOIN bob_parties party ON party.id=relation.party_id
JOIN bob_versions current_version ON current_version.id=object.current_version_id
WHERE object.entity='other-unit'
  AND (sqlc.arg(keyword)::text='' OR object.code ILIKE '%'||sqlc.arg(keyword)::text||'%'
       OR party.display_name ILIKE '%'||sqlc.arg(keyword)::text||'%')
  AND (sqlc.arg(operating_entity_id)::text=''
       OR relation.operating_entity_id=sqlc.arg(operating_entity_id)::text)
  AND (cardinality(sqlc.arg(statuses)::text[])=0
       OR current_version.status=ANY(sqlc.arg(statuses)::text[]));

-- name: ListBobOtherUnits :many
SELECT object.id AS object_id,object.code,object.revision AS object_revision,object.enabled,
       current_version.id AS version_id,current_version.version_no,current_version.status,
       current_version.revision AS version_revision,current_version.submitted_by,
       object.effective_version_id,object.current_version_id,
       relation.party_id,party.kind AS party_kind,party.display_name AS party_display_name,
       relation.operating_entity_id,operating.code AS operating_entity_code,
       operating_detail.legal_name AS operating_entity_name,
       current_detail.contact_name,current_detail.contact_phone,current_detail.email,
       current_detail.address,current_detail.settlement_method_id,
       current_detail.settlement_method_code,current_detail.settlement_method_name,
       current_detail.settlement_term_code,current_detail.settlement_rule_type,
       current_detail.settlement_month_offset,current_detail.settlement_day_of_month,
       current_detail.settlement_day_offset,current_detail.remark,object.updated_at
FROM bob_objects object
JOIN bob_service_relationships relation ON relation.object_id=object.id
JOIN bob_parties party ON party.id=relation.party_id
JOIN bob_objects operating ON operating.id=relation.operating_entity_id AND operating.entity='operating-entity'
JOIN bob_operating_entity_versions operating_detail ON operating_detail.version_id=operating.current_version_id
JOIN bob_versions current_version ON current_version.id=object.current_version_id
JOIN bob_service_relationship_versions current_detail ON current_detail.version_id=current_version.id
WHERE object.entity='other-unit'
  AND (sqlc.arg(keyword)::text='' OR object.code ILIKE '%'||sqlc.arg(keyword)::text||'%'
       OR party.display_name ILIKE '%'||sqlc.arg(keyword)::text||'%')
  AND (sqlc.arg(operating_entity_id)::text=''
       OR relation.operating_entity_id=sqlc.arg(operating_entity_id)::text)
  AND (cardinality(sqlc.arg(statuses)::text[])=0
       OR current_version.status=ANY(sqlc.arg(statuses)::text[]))
ORDER BY object.code ASC
LIMIT sqlc.arg(page_size) OFFSET sqlc.arg(page_offset);

-- name: ListBobOtherUnitVersions :many
SELECT version.id AS version_id,version.version_no,version.status,version.revision,
       version.created_at,version.created_by,version.updated_at,version.updated_by,
       version.submitted_at,version.submitted_by,version.reviewed_at,version.reviewed_by,
       version.review_comment,party.display_name AS party_display_name,
       relation.operating_entity_id,operating.code AS operating_entity_code,
       operating_detail.legal_name AS operating_entity_name,
       detail.contact_name,detail.contact_phone,detail.email,detail.address,
       detail.settlement_method_id,detail.remark
FROM bob_objects object
JOIN bob_service_relationships relation ON relation.object_id=object.id
JOIN bob_parties party ON party.id=relation.party_id
JOIN bob_objects operating ON operating.id=relation.operating_entity_id AND operating.entity='operating-entity'
JOIN bob_operating_entity_versions operating_detail ON operating_detail.version_id=operating.current_version_id
JOIN bob_versions version ON version.object_id=object.id AND version.entity='other-unit'
JOIN bob_service_relationship_versions detail ON detail.version_id=version.id
WHERE object.id=sqlc.arg(object_id) AND object.entity='other-unit'
ORDER BY version.version_no DESC
LIMIT sqlc.arg(page_size) OFFSET sqlc.arg(page_offset);

-- name: InsertBobVersion :exec
INSERT INTO bob_versions (
    id, object_id, entity, version_no, status, revision, created_by, updated_by
) VALUES (
    sqlc.arg(id), sqlc.arg(object_id), sqlc.arg(entity), sqlc.arg(version_no), 'DRAFT', 1, sqlc.arg(actor_id), sqlc.arg(actor_id)
);

-- name: InsertBobSupplierDetail :exec
INSERT INTO bob_supplier_versions (
    version_id, name, short_name, category_id, tax_number,
    contact_name, contact_phone, email, address, remark, settlement_method_id,
    settlement_method_code, settlement_method_name, settlement_term_code,
    settlement_rule_type, settlement_month_offset, settlement_day_of_month,
    settlement_day_offset, default_purchaser_employee_id
) VALUES (
    sqlc.arg(version_id), sqlc.arg(name),
    sqlc.narg(short_name), sqlc.narg(category_id), sqlc.narg(tax_number),
    sqlc.narg(contact_name), sqlc.narg(contact_phone), sqlc.narg(email),
    sqlc.narg(address), sqlc.narg(remark), sqlc.narg(settlement_method_id),
    sqlc.narg(settlement_method_code), sqlc.narg(settlement_method_name),
    sqlc.narg(settlement_term_code), sqlc.narg(settlement_rule_type),
    sqlc.arg(settlement_month_offset), sqlc.arg(settlement_day_of_month),
    sqlc.arg(settlement_day_offset), sqlc.narg(default_purchaser_employee_id)
);

-- name: InsertBobEmployeeDetail :exec
INSERT INTO bob_employee_versions (
    version_id, name, category_id, department_id, position_id, phone, email, hire_date, remark
) VALUES (
    sqlc.arg(version_id), sqlc.arg(name), sqlc.narg(category_id), sqlc.narg(department_id),
    sqlc.narg(position_id), sqlc.narg(phone), sqlc.narg(email),
    NULLIF(sqlc.arg(hire_date)::text, '')::date, sqlc.narg(remark)
);

-- name: InsertBobProductDetail :exec
INSERT INTO bob_product_versions (
    version_id, name, unit, container_type, quantity_per_container_micros,
    category_id, specification, model, barcode, remark, product_kind,
    inventory_unit_id, pricing_unit_id, pricing_quantity_per_inventory_unit_micros,
    returnable
) VALUES (
    sqlc.arg(version_id), sqlc.arg(name), sqlc.arg(unit), sqlc.arg(container_type),
    sqlc.narg(quantity_per_container_micros), sqlc.narg(category_id),
    sqlc.narg(specification), sqlc.narg(model), sqlc.narg(barcode), sqlc.narg(remark),
    sqlc.arg(product_kind), sqlc.arg(inventory_unit_id), sqlc.arg(pricing_unit_id),
    sqlc.arg(pricing_quantity_per_inventory_unit_micros), sqlc.arg(returnable)
);

-- name: InsertBobServiceDetail :exec
INSERT INTO bob_service_versions (version_id, name, unit, unit_id, category_id, description, remark)
VALUES (
    sqlc.arg(version_id), sqlc.arg(name), sqlc.arg(unit), sqlc.arg(unit_id), sqlc.narg(category_id),
    sqlc.narg(description), sqlc.narg(remark)
);

-- name: InsertBobWarehouseDetail :exec
INSERT INTO bob_warehouse_versions (
    version_id, name, category_id, address, contact_name, contact_phone, manager_employee_id, remark
) VALUES (
    sqlc.arg(version_id), sqlc.arg(name), sqlc.narg(category_id), sqlc.narg(address),
    sqlc.narg(contact_name), sqlc.narg(contact_phone), sqlc.narg(manager_employee_id), sqlc.narg(remark)
);

-- name: InsertBobVehicleDetail :exec
INSERT INTO bob_vehicle_versions (
    version_id, name, plate_number, vehicle_type, platform_object_id,
    category_id, vin, engine_number, load_capacity_kg, remark
)
VALUES (
    sqlc.arg(version_id), sqlc.arg(name), sqlc.arg(plate_number),
    sqlc.arg(vehicle_type), sqlc.arg(platform_object_id), sqlc.narg(category_id),
    sqlc.narg(vin), sqlc.narg(engine_number),
    NULLIF(sqlc.arg(load_capacity_kg)::text, '')::numeric(12,3), sqlc.narg(remark)
);

-- name: InsertBobFundAccountDetail :exec
INSERT INTO bob_fund_account_versions (
    version_id, name, currency, category_id, account_name, bank_name, bank_branch, account_number, remark,
    operating_entity_id, operating_entity_version_id, operating_entity_code, operating_entity_name
) VALUES (
    sqlc.arg(version_id), sqlc.arg(name), sqlc.arg(currency), sqlc.narg(category_id),
    sqlc.narg(account_name), sqlc.narg(bank_name), sqlc.narg(bank_branch),
    sqlc.narg(account_number), sqlc.narg(remark), sqlc.arg(operating_entity_id),
    sqlc.arg(operating_entity_version_id), sqlc.arg(operating_entity_code), sqlc.arg(operating_entity_name)
);

-- name: InsertBobCategoryDetail :exec
INSERT INTO bob_category_versions (version_id, name, target_entity, parent_id, description)
VALUES (
    sqlc.arg(version_id), sqlc.arg(name), sqlc.arg(target_entity),
    sqlc.narg(parent_id), sqlc.narg(description)
);

-- name: InsertBobDepartmentDetail :exec
INSERT INTO bob_department_versions (version_id, name, category_id, parent_id, description)
VALUES (
    sqlc.arg(version_id), sqlc.arg(name), sqlc.narg(category_id),
    sqlc.narg(parent_id), sqlc.narg(description)
);

-- name: InsertBobPositionDetail :exec
INSERT INTO bob_position_versions (version_id, name, category_id, description)
VALUES (
    sqlc.arg(version_id), sqlc.arg(name), sqlc.narg(category_id), sqlc.narg(description)
);

-- name: InsertBobSettlementMethodDetail :exec
INSERT INTO bob_settlement_method_versions (
    version_id, name, term_code, rule_type, month_offset, day_of_month, day_offset,
    default_sales_surcharge_cents, description
) VALUES (
    sqlc.arg(version_id), sqlc.arg(name), sqlc.arg(term_code), sqlc.arg(rule_type), sqlc.arg(month_offset),
    sqlc.narg(day_of_month), sqlc.arg(day_offset), sqlc.arg(default_sales_surcharge_cents), sqlc.narg(description)
);

-- name: InsertBobOperatingEntityDetail :exec
INSERT INTO bob_operating_entity_versions (
    version_id, legal_name, short_name, tax_number, address, phone, remark
) VALUES (
    sqlc.arg(version_id), sqlc.arg(legal_name), sqlc.narg(short_name),
    sqlc.narg(tax_number), sqlc.narg(address), sqlc.narg(phone), sqlc.narg(remark)
);

-- name: UpdateBobOperatingEntityDetail :execrows
UPDATE bob_operating_entity_versions SET
    legal_name = sqlc.arg(legal_name), short_name = sqlc.narg(short_name),
    tax_number = sqlc.narg(tax_number), address = sqlc.narg(address),
    phone = sqlc.narg(phone), remark = sqlc.narg(remark)
WHERE version_id = sqlc.arg(version_id);

-- name: CopyBobOperatingEntityDetail :exec
INSERT INTO bob_operating_entity_versions (
    version_id, legal_name, short_name, tax_number, address, phone, remark
)
SELECT sqlc.arg(new_version_id), source.legal_name, source.short_name, source.tax_number,
       source.address, source.phone, source.remark
FROM bob_operating_entity_versions source
WHERE source.version_id = sqlc.arg(source_version_id);

-- name: DeleteBobOperatingEntityDetail :execrows
DELETE FROM bob_operating_entity_versions WHERE version_id = sqlc.arg(version_id);

-- name: CopyBobSupplierDetail :exec
INSERT INTO bob_supplier_versions (
    version_id, name, short_name, category_id, tax_number,
    contact_name, contact_phone, email, address, remark, settlement_method_id,
    settlement_method_code, settlement_method_name, settlement_term_code,
    settlement_rule_type, settlement_month_offset, settlement_day_of_month,
    settlement_day_offset, default_purchaser_employee_id
)
SELECT sqlc.arg(new_version_id), d.name, d.short_name, d.category_id,
       d.tax_number, d.contact_name, d.contact_phone, d.email, d.address, d.remark,
       d.settlement_method_id, d.settlement_method_code, d.settlement_method_name,
       d.settlement_term_code, d.settlement_rule_type, d.settlement_month_offset,
       d.settlement_day_of_month, d.settlement_day_offset, d.default_purchaser_employee_id
FROM bob_supplier_versions d WHERE d.version_id = sqlc.arg(source_version_id);

-- name: CopyBobEmployeeDetail :exec
INSERT INTO bob_employee_versions (
    version_id, name, category_id, department_id, position_id, phone, email, hire_date, remark
)
SELECT sqlc.arg(new_version_id), d.name, d.category_id, d.department_id, d.position_id,
       d.phone, d.email, d.hire_date, d.remark
FROM bob_employee_versions d WHERE d.version_id = sqlc.arg(source_version_id);

-- name: CopyBobProductDetail :exec
INSERT INTO bob_product_versions (
    version_id, name, unit, container_type, quantity_per_container_micros,
    category_id, specification, model, barcode, remark, product_kind,
    inventory_unit_id, pricing_unit_id, pricing_quantity_per_inventory_unit_micros,
    returnable
)
SELECT sqlc.arg(new_version_id), d.name, d.unit, d.container_type, d.quantity_per_container_micros,
       d.category_id, d.specification,
       d.model, d.barcode, d.remark, d.product_kind, d.inventory_unit_id,
       d.pricing_unit_id, d.pricing_quantity_per_inventory_unit_micros, d.returnable
FROM bob_product_versions d WHERE d.version_id = sqlc.arg(source_version_id);

-- name: CopyBobServiceDetail :exec
INSERT INTO bob_service_versions (version_id, name, unit, unit_id, category_id, description, remark)
SELECT sqlc.arg(new_version_id), d.name, d.unit, d.unit_id, d.category_id, d.description, d.remark
FROM bob_service_versions d WHERE d.version_id = sqlc.arg(source_version_id);

-- name: CopyBobWarehouseDetail :exec
INSERT INTO bob_warehouse_versions (
    version_id, name, category_id, address, contact_name, contact_phone, manager_employee_id, remark
)
SELECT sqlc.arg(new_version_id), d.name, d.category_id, d.address, d.contact_name,
       d.contact_phone, d.manager_employee_id, d.remark
FROM bob_warehouse_versions d WHERE d.version_id = sqlc.arg(source_version_id);

-- name: CopyBobVehicleDetail :exec
INSERT INTO bob_vehicle_versions (
    version_id, name, plate_number, vehicle_type, platform_object_id,
    category_id, vin, engine_number, load_capacity_kg, remark
)
SELECT sqlc.arg(new_version_id), d.name, d.plate_number, d.vehicle_type, d.platform_object_id,
       d.category_id, d.vin, d.engine_number, d.load_capacity_kg, d.remark
FROM bob_vehicle_versions d WHERE d.version_id = sqlc.arg(source_version_id);

-- name: CopyBobFundAccountDetail :exec
INSERT INTO bob_fund_account_versions (
    version_id, name, currency, category_id, account_name, bank_name, bank_branch, account_number, remark,
    operating_entity_id, operating_entity_version_id, operating_entity_code, operating_entity_name
)
SELECT sqlc.arg(new_version_id), d.name, d.currency, d.category_id, d.account_name,
       d.bank_name, d.bank_branch, d.account_number, d.remark, d.operating_entity_id,
       d.operating_entity_version_id, d.operating_entity_code, d.operating_entity_name
FROM bob_fund_account_versions d WHERE d.version_id = sqlc.arg(source_version_id);

-- name: CopyBobCategoryDetail :exec
INSERT INTO bob_category_versions (version_id, name, target_entity, parent_id, description)
SELECT sqlc.arg(new_version_id), d.name, d.target_entity, d.parent_id, d.description
FROM bob_category_versions d WHERE d.version_id = sqlc.arg(source_version_id);

-- name: CopyBobDepartmentDetail :exec
INSERT INTO bob_department_versions (version_id, name, category_id, parent_id, description)
SELECT sqlc.arg(new_version_id), d.name, d.category_id, d.parent_id, d.description
FROM bob_department_versions d WHERE d.version_id = sqlc.arg(source_version_id);

-- name: CopyBobPositionDetail :exec
INSERT INTO bob_position_versions (version_id, name, category_id, description)
SELECT sqlc.arg(new_version_id), d.name, d.category_id, d.description
FROM bob_position_versions d WHERE d.version_id = sqlc.arg(source_version_id);

-- name: CopyBobSettlementMethodDetail :exec
INSERT INTO bob_settlement_method_versions (
    version_id, name, term_code, rule_type, month_offset, day_of_month, day_offset,
    default_sales_surcharge_cents, description
)
SELECT sqlc.arg(new_version_id), d.name, d.term_code, d.rule_type, d.month_offset,
       d.day_of_month, d.day_offset, d.default_sales_surcharge_cents, d.description
FROM bob_settlement_method_versions d WHERE d.version_id = sqlc.arg(source_version_id);

-- name: UpdateBobSupplierDetail :execrows
UPDATE bob_supplier_versions
SET name = sqlc.arg(name),
    short_name = sqlc.narg(short_name), category_id = sqlc.narg(category_id),
    tax_number = sqlc.narg(tax_number), contact_name = sqlc.narg(contact_name),
    contact_phone = sqlc.narg(contact_phone), email = sqlc.narg(email),
    address = sqlc.narg(address), remark = sqlc.narg(remark),
    settlement_method_id = sqlc.narg(settlement_method_id),
    settlement_method_code = sqlc.narg(settlement_method_code),
    settlement_method_name = sqlc.narg(settlement_method_name),
    settlement_term_code = sqlc.narg(settlement_term_code),
    settlement_rule_type = sqlc.narg(settlement_rule_type),
    settlement_month_offset = sqlc.arg(settlement_month_offset),
    settlement_day_of_month = sqlc.arg(settlement_day_of_month),
    settlement_day_offset = sqlc.arg(settlement_day_offset),
    default_purchaser_employee_id = sqlc.narg(default_purchaser_employee_id)
WHERE version_id = sqlc.arg(version_id);

-- name: UpdateBobEmployeeDetail :execrows
UPDATE bob_employee_versions
SET name = sqlc.arg(name), category_id = sqlc.narg(category_id),
    department_id = sqlc.narg(department_id), position_id = sqlc.narg(position_id),
    phone = sqlc.narg(phone), email = sqlc.narg(email),
    hire_date = NULLIF(sqlc.arg(hire_date)::text, '')::date, remark = sqlc.narg(remark)
WHERE version_id = sqlc.arg(version_id);

-- name: UpdateBobProductDetail :execrows
UPDATE bob_product_versions
SET name = sqlc.arg(name), unit = sqlc.arg(unit), container_type = sqlc.arg(container_type),
    quantity_per_container_micros = sqlc.narg(quantity_per_container_micros),
    category_id = sqlc.narg(category_id),
    specification = sqlc.narg(specification), model = sqlc.narg(model),
    barcode = sqlc.narg(barcode), remark = sqlc.narg(remark),
    product_kind = sqlc.arg(product_kind),
    inventory_unit_id = sqlc.arg(inventory_unit_id),
    pricing_unit_id = sqlc.arg(pricing_unit_id),
    pricing_quantity_per_inventory_unit_micros = sqlc.arg(pricing_quantity_per_inventory_unit_micros),
    returnable = sqlc.arg(returnable)
WHERE version_id = sqlc.arg(version_id);

-- name: UpdateBobServiceDetail :execrows
UPDATE bob_service_versions
SET name = sqlc.arg(name), unit = sqlc.arg(unit), unit_id = sqlc.arg(unit_id),
    category_id = sqlc.narg(category_id),
    description = sqlc.narg(description), remark = sqlc.narg(remark)
WHERE version_id = sqlc.arg(version_id);

-- name: UpdateBobWarehouseDetail :execrows
UPDATE bob_warehouse_versions
SET name = sqlc.arg(name), category_id = sqlc.narg(category_id), address = sqlc.narg(address),
    contact_name = sqlc.narg(contact_name), contact_phone = sqlc.narg(contact_phone),
    manager_employee_id = sqlc.narg(manager_employee_id), remark = sqlc.narg(remark)
WHERE version_id = sqlc.arg(version_id);

-- name: UpdateBobVehicleDetail :execrows
UPDATE bob_vehicle_versions
SET name = sqlc.arg(name), plate_number = sqlc.arg(plate_number),
    vehicle_type = sqlc.arg(vehicle_type), platform_object_id = sqlc.arg(platform_object_id),
    category_id = sqlc.narg(category_id), vin = sqlc.narg(vin),
    engine_number = sqlc.narg(engine_number),
    load_capacity_kg = NULLIF(sqlc.arg(load_capacity_kg)::text, '')::numeric(12,3),
    remark = sqlc.narg(remark)
WHERE version_id = sqlc.arg(version_id);

-- name: UpdateBobFundAccountDetail :execrows
UPDATE bob_fund_account_versions
SET name = sqlc.arg(name), currency = sqlc.arg(currency), category_id = sqlc.narg(category_id),
    account_name = sqlc.narg(account_name), bank_name = sqlc.narg(bank_name),
    bank_branch = sqlc.narg(bank_branch), account_number = sqlc.narg(account_number),
    remark = sqlc.narg(remark), operating_entity_id = sqlc.arg(operating_entity_id),
    operating_entity_version_id = sqlc.arg(operating_entity_version_id),
    operating_entity_code = sqlc.arg(operating_entity_code), operating_entity_name = sqlc.arg(operating_entity_name)
WHERE version_id = sqlc.arg(version_id);

-- name: UpdateBobCategoryDetail :execrows
UPDATE bob_category_versions
SET name = sqlc.arg(name), target_entity = sqlc.arg(target_entity),
    parent_id = sqlc.narg(parent_id), description = sqlc.narg(description)
WHERE version_id = sqlc.arg(version_id);

-- name: UpdateBobDepartmentDetail :execrows
UPDATE bob_department_versions
SET name = sqlc.arg(name), category_id = sqlc.narg(category_id),
    parent_id = sqlc.narg(parent_id), description = sqlc.narg(description)
WHERE version_id = sqlc.arg(version_id);

-- name: UpdateBobPositionDetail :execrows
UPDATE bob_position_versions
SET name = sqlc.arg(name), category_id = sqlc.narg(category_id), description = sqlc.narg(description)
WHERE version_id = sqlc.arg(version_id);

-- name: UpdateBobSettlementMethodDetail :execrows
UPDATE bob_settlement_method_versions
SET name = sqlc.arg(name), term_code = sqlc.arg(term_code), rule_type = sqlc.arg(rule_type),
    month_offset = sqlc.arg(month_offset), day_of_month = sqlc.narg(day_of_month),
    day_offset = sqlc.arg(day_offset),
    default_sales_surcharge_cents = sqlc.arg(default_sales_surcharge_cents),
    description = sqlc.narg(description)
WHERE version_id = sqlc.arg(version_id);

-- name: DeleteBobProductPackagingSpecs :exec
DELETE FROM bob_product_packaging_specs
WHERE product_version_id = sqlc.arg(product_version_id);

-- name: InsertBobProductPackagingSpec :exec
INSERT INTO bob_product_packaging_specs (
    product_version_id, packaging_product_object_id, packaging_product_version_id,
    content_quantity_micros, is_default
) VALUES (
    sqlc.arg(product_version_id), sqlc.arg(packaging_product_object_id),
    sqlc.arg(packaging_product_version_id), sqlc.arg(content_quantity_micros),
    sqlc.arg(is_default)
);

-- name: CopyBobProductPackagingSpecs :exec
INSERT INTO bob_product_packaging_specs (
    product_version_id, packaging_product_object_id, packaging_product_version_id,
    content_quantity_micros, is_default
)
SELECT sqlc.arg(new_version_id), source.packaging_product_object_id,
       source.packaging_product_version_id, source.content_quantity_micros, source.is_default
FROM bob_product_packaging_specs source
WHERE source.product_version_id = sqlc.arg(source_version_id);

-- name: DeleteBobProductFormula :exec
DELETE FROM bob_product_formulas
WHERE product_version_id = sqlc.arg(product_version_id);

-- name: InsertBobProductFormula :exec
INSERT INTO bob_product_formulas (
    product_version_id, base_output_quantity_micros
) VALUES (
    sqlc.arg(product_version_id), sqlc.arg(base_output_quantity_micros)
);

-- name: InsertBobProductFormulaLine :exec
INSERT INTO bob_product_formula_lines (
    product_version_id, line_no, material_object_id, material_version_id,
    quantity_micros
) VALUES (
    sqlc.arg(product_version_id), sqlc.arg(line_no),
    sqlc.arg(material_object_id), sqlc.arg(material_version_id),
    sqlc.arg(quantity_micros)
);

-- name: CopyBobProductFormula :exec
INSERT INTO bob_product_formulas (
    product_version_id, base_output_quantity_micros
)
SELECT sqlc.arg(new_version_id), source.base_output_quantity_micros
FROM bob_product_formulas source
WHERE source.product_version_id = sqlc.arg(source_version_id);

-- name: CopyBobProductFormulaLines :exec
INSERT INTO bob_product_formula_lines (
    product_version_id, line_no, material_object_id, material_version_id,
    quantity_micros
)
SELECT sqlc.arg(new_version_id), source.line_no, source.material_object_id,
       source.material_version_id, source.quantity_micros
FROM bob_product_formula_lines source
WHERE source.product_version_id = sqlc.arg(source_version_id);

-- name: GetBobProductFormula :one
SELECT base_output_quantity_micros
FROM bob_product_formulas
WHERE product_version_id = sqlc.arg(product_version_id);

-- name: ListBobProductFormulaLines :many
SELECT line.line_no, line.material_object_id, line.material_version_id,
       object.code AS material_code, detail.name AS material_name,
       detail.unit AS material_unit, detail.product_kind AS material_product_kind,
       line.quantity_micros
FROM bob_product_formula_lines line
JOIN bob_objects object
  ON object.id = line.material_object_id AND object.entity = 'product'
JOIN bob_product_versions detail
  ON detail.version_id = line.material_version_id
WHERE line.product_version_id = sqlc.arg(product_version_id)
ORDER BY line.line_no;

-- name: LockBobObject :one
SELECT id, entity, code, current_version_id, effective_version_id, enabled, next_version_no, revision, updated_at
FROM bob_objects
WHERE id = sqlc.arg(id) AND entity = sqlc.arg(entity)
FOR UPDATE;

-- name: GetBobObjectEnabled :one
SELECT enabled FROM bob_objects
WHERE id = sqlc.arg(id) AND entity = sqlc.arg(entity);

-- name: ListBobObjectsEnabled :many
SELECT id, enabled FROM bob_objects
WHERE id = ANY(sqlc.arg(ids)::text[]);

-- name: FindBobObjectIDByCode :one
SELECT id
FROM bob_objects
WHERE entity = sqlc.arg(entity) AND upper(code) = upper(sqlc.arg(code)::text)
LIMIT 1;

-- name: FindBobSeedObjectID :one
SELECT candidate.id
FROM (
    SELECT object.id, 0 AS priority, object.created_at
    FROM bob_audit_events audit
    JOIN bob_objects object ON object.id = audit.object_id AND object.entity = audit.entity
    WHERE audit.entity = sqlc.arg(entity)
      AND audit.request_id = 'seed-bob-' || sqlc.arg(seed_code)::text || '-create'
    UNION ALL
    SELECT object.id, 1 AS priority, object.created_at
    FROM identifier_object_renumber_history history
    JOIN bob_objects object ON object.id = history.object_id AND object.entity = history.entity
    WHERE history.domain = 'bob'
      AND history.entity = sqlc.arg(entity)
      AND history.old_code = sqlc.arg(seed_code)
    UNION ALL
    SELECT object.id, 0 AS priority, object.created_at
    FROM bob_objects object
    JOIN bob_settlement_method_versions method ON method.version_id=object.effective_version_id
    WHERE sqlc.arg(entity)::text = 'settlement-method'
      AND object.entity = 'settlement-method'
      AND method.term_code = sqlc.arg(seed_code)
) candidate
ORDER BY candidate.priority, candidate.created_at, candidate.id
LIMIT 1;

-- name: LockBobVersion :one
SELECT id, object_id, entity, version_no, status, revision,
       submitted_at, submitted_by, reviewed_at, reviewed_by
FROM bob_versions
WHERE id = sqlc.arg(id) AND object_id = sqlc.arg(object_id) AND entity = sqlc.arg(entity)
FOR UPDATE;

-- name: BobDraftAuditIsDeletable :one
SELECT count(*) >= 1
   AND count(*) FILTER (WHERE event_type = 'CREATED') = 1
   AND bool_and(event_type IN ('CREATED', 'SAVED'))
FROM bob_audit_events
WHERE object_id = sqlc.arg(object_id)
  AND version_id = sqlc.arg(version_id)
  AND entity = sqlc.arg(entity);

-- name: BobObjectHasExternalReferences :one
SELECT EXISTS (
    SELECT 1
    FROM bob_vehicle_versions vehicle
    WHERE vehicle.platform_object_id = sqlc.arg(target_object_id)
       OR vehicle.category_id = sqlc.arg(target_object_id)

    UNION ALL

    SELECT 1 FROM bob_customer_versions
    WHERE category_id = sqlc.arg(target_object_id)
       OR settlement_method_id = sqlc.arg(target_object_id)
       OR primary_sales_subject_id = sqlc.arg(target_object_id)

    UNION ALL

    SELECT 1 FROM bob_supplier_versions
    WHERE category_id = sqlc.arg(target_object_id)
       OR settlement_method_id = sqlc.arg(target_object_id)
       OR default_purchaser_employee_id = sqlc.arg(target_object_id)

    UNION ALL

    SELECT 1 FROM bob_employee_versions
    WHERE category_id = sqlc.arg(target_object_id)
       OR department_id = sqlc.arg(target_object_id)
       OR position_id = sqlc.arg(target_object_id)

    UNION ALL

    SELECT 1 FROM bob_product_versions
    WHERE category_id = sqlc.arg(target_object_id)

    UNION ALL

    SELECT 1 FROM bob_service_versions
    WHERE category_id = sqlc.arg(target_object_id)

    UNION ALL

    SELECT 1 FROM bob_warehouse_versions
    WHERE category_id = sqlc.arg(target_object_id)
       OR manager_employee_id = sqlc.arg(target_object_id)

    UNION ALL

    SELECT 1 FROM bob_fund_account_versions
    WHERE category_id = sqlc.arg(target_object_id)

    UNION ALL

    SELECT 1 FROM bob_category_versions
    WHERE parent_id = sqlc.arg(target_object_id)

    UNION ALL

    SELECT 1 FROM bob_department_versions
    WHERE category_id = sqlc.arg(target_object_id)
       OR parent_id = sqlc.arg(target_object_id)

    UNION ALL

    SELECT 1 FROM bob_position_versions
    WHERE category_id = sqlc.arg(target_object_id)

    UNION ALL

    SELECT 1
    FROM vou_sale_order_details sale_order
    WHERE sale_order.customer_object_id = sqlc.arg(target_object_id)
       OR sale_order.customer_version_id = sqlc.arg(target_version_id)
       OR sale_order.salesperson_object_id = sqlc.arg(target_object_id)
       OR sale_order.salesperson_version_id = sqlc.arg(target_version_id)
       OR sale_order.settlement_method_object_id = sqlc.arg(target_object_id)
       OR sale_order.settlement_method_version_id = sqlc.arg(target_version_id)

    UNION ALL

    SELECT 1
    FROM vou_sale_outbound_details outbound
    WHERE outbound.customer_object_id = sqlc.arg(target_object_id)
       OR outbound.customer_version_id = sqlc.arg(target_version_id)
       OR outbound.warehouse_object_id = sqlc.arg(target_object_id)
       OR outbound.warehouse_version_id = sqlc.arg(target_version_id)

    UNION ALL

    SELECT 1
    FROM vou_sale_delivery_details delivery
    WHERE delivery.customer_object_id = sqlc.arg(target_object_id)
       OR delivery.customer_version_id = sqlc.arg(target_version_id)
       OR delivery.platform_object_id = sqlc.arg(target_object_id)
       OR delivery.platform_version_id = sqlc.arg(target_version_id)
       OR delivery.vehicle_object_id = sqlc.arg(target_object_id)
       OR delivery.vehicle_version_id = sqlc.arg(target_version_id)

    UNION ALL

    SELECT 1
    FROM vou_sale_signoff_details signoff
    WHERE signoff.customer_object_id = sqlc.arg(target_object_id)
       OR signoff.customer_version_id = sqlc.arg(target_version_id)
       OR signoff.warehouse_object_id = sqlc.arg(target_object_id)
       OR signoff.warehouse_version_id = sqlc.arg(target_version_id)

    UNION ALL

    SELECT 1
    FROM vou_purchase_inquiry_details purchase_inquiry
    WHERE purchase_inquiry.supplier_object_id = sqlc.arg(target_object_id)
       OR purchase_inquiry.supplier_version_id = sqlc.arg(target_version_id)

    UNION ALL

    SELECT 1
    FROM vou_purchase_order_details purchase_order
    WHERE purchase_order.supplier_object_id = sqlc.arg(target_object_id)
       OR purchase_order.supplier_version_id = sqlc.arg(target_version_id)
       OR purchase_order.purchaser_object_id = sqlc.arg(target_object_id)
       OR purchase_order.purchaser_version_id = sqlc.arg(target_version_id)
       OR purchase_order.warehouse_object_id = sqlc.arg(target_object_id)
       OR purchase_order.warehouse_version_id = sqlc.arg(target_version_id)
       OR purchase_order.settlement_method_object_id = sqlc.arg(target_object_id)
       OR purchase_order.settlement_method_version_id = sqlc.arg(target_version_id)

    UNION ALL

    SELECT 1
    FROM vou_purchase_inbound_details purchase_inbound
    WHERE purchase_inbound.supplier_object_id = sqlc.arg(target_object_id)
       OR purchase_inbound.supplier_version_id = sqlc.arg(target_version_id)
       OR purchase_inbound.warehouse_object_id = sqlc.arg(target_object_id)
       OR purchase_inbound.warehouse_version_id = sqlc.arg(target_version_id)

    UNION ALL

    SELECT 1
    FROM vou_receipt_details receipt
    WHERE receipt.counterparty_object_id = sqlc.arg(target_object_id)
       OR receipt.counterparty_version_id = sqlc.arg(target_version_id)
       OR receipt.fund_account_object_id = sqlc.arg(target_object_id)
       OR receipt.fund_account_version_id = sqlc.arg(target_version_id)
       OR receipt.handler_object_id = sqlc.arg(target_object_id)
       OR receipt.handler_version_id = sqlc.arg(target_version_id)

    UNION ALL

    SELECT 1
    FROM vou_payment_details payment
    WHERE payment.counterparty_object_id = sqlc.arg(target_object_id)
       OR payment.counterparty_version_id = sqlc.arg(target_version_id)
       OR payment.fund_account_object_id = sqlc.arg(target_object_id)
       OR payment.fund_account_version_id = sqlc.arg(target_version_id)
       OR payment.handler_object_id = sqlc.arg(target_object_id)
       OR payment.handler_version_id = sqlc.arg(target_version_id)

    UNION ALL

    SELECT 1
    FROM vou_expense_reimbursement_details reimbursement
    WHERE reimbursement.employee_object_id = sqlc.arg(target_object_id)
       OR reimbursement.employee_version_id = sqlc.arg(target_version_id)

    UNION ALL

    SELECT 1
    FROM vou_employee_loan_writeoff_details writeoff
    WHERE writeoff.employee_object_id = sqlc.arg(target_object_id)
       OR writeoff.employee_version_id = sqlc.arg(target_version_id)

    UNION ALL

    SELECT 1
    FROM vou_other_income_details other_income
    WHERE other_income.counterparty_object_id = sqlc.arg(target_object_id)
       OR other_income.counterparty_version_id = sqlc.arg(target_version_id)
       OR other_income.fund_account_object_id = sqlc.arg(target_object_id)
       OR other_income.fund_account_version_id = sqlc.arg(target_version_id)
       OR other_income.handler_object_id = sqlc.arg(target_object_id)
       OR other_income.handler_version_id = sqlc.arg(target_version_id)

    UNION ALL

    SELECT 1
    FROM vou_price_lines price_line
    WHERE price_line.product_object_id = sqlc.arg(target_object_id)
       OR price_line.product_version_id = sqlc.arg(target_version_id)

    UNION ALL

    SELECT 1
    FROM vou_product_lines product_line
    WHERE product_line.product_object_id = sqlc.arg(target_object_id)
       OR product_line.product_version_id = sqlc.arg(target_version_id)

    UNION ALL

    SELECT 1
    FROM vou_sale_outbound_lines outbound_line
    WHERE outbound_line.product_object_id = sqlc.arg(target_object_id)
       OR outbound_line.product_version_id = sqlc.arg(target_version_id)

    UNION ALL

    SELECT 1
    FROM vou_sale_signoff_lines signoff_line
    WHERE signoff_line.product_object_id = sqlc.arg(target_object_id)
       OR signoff_line.product_version_id = sqlc.arg(target_version_id)
);

-- name: DeleteBobAuditEventsForDraft :execrows
DELETE FROM bob_audit_events
WHERE object_id = sqlc.arg(object_id)
  AND version_id = sqlc.arg(version_id)
  AND entity = sqlc.arg(entity)
  AND event_type IN ('CREATED', 'SAVED');

-- name: DeleteBobCustomerDetail :execrows
DELETE FROM bob_customer_versions WHERE version_id = sqlc.arg(version_id);

-- name: DeleteBobSupplierDetail :execrows
DELETE FROM bob_supplier_versions WHERE version_id = sqlc.arg(version_id);

-- name: DeleteBobEmployeeDetail :execrows
DELETE FROM bob_employee_versions WHERE version_id = sqlc.arg(version_id);

-- name: DeleteBobProductDetail :execrows
DELETE FROM bob_product_versions WHERE version_id = sqlc.arg(version_id);

-- name: DeleteBobServiceDetail :execrows
DELETE FROM bob_service_versions WHERE version_id = sqlc.arg(version_id);

-- name: DeleteBobWarehouseDetail :execrows
DELETE FROM bob_warehouse_versions WHERE version_id = sqlc.arg(version_id);

-- name: DeleteBobVehicleDetail :execrows
DELETE FROM bob_vehicle_versions WHERE version_id = sqlc.arg(version_id);

-- name: DeleteBobFundAccountDetail :execrows
DELETE FROM bob_fund_account_versions WHERE version_id = sqlc.arg(version_id);

-- name: DeleteBobCategoryDetail :execrows
DELETE FROM bob_category_versions WHERE version_id = sqlc.arg(version_id);

-- name: DeleteBobDepartmentDetail :execrows
DELETE FROM bob_department_versions WHERE version_id = sqlc.arg(version_id);

-- name: DeleteBobPositionDetail :execrows
DELETE FROM bob_position_versions WHERE version_id = sqlc.arg(version_id);

-- name: DeleteBobSettlementMethodDetail :execrows
DELETE FROM bob_settlement_method_versions WHERE version_id = sqlc.arg(version_id);

-- name: DeleteBobFirstVersion :execrows
DELETE FROM bob_versions
WHERE id = sqlc.arg(version_id)
  AND object_id = sqlc.arg(object_id)
  AND entity = sqlc.arg(entity)
  AND version_no = 1
  AND status = 'DRAFT'
  AND revision = sqlc.arg(revision)
  AND submitted_at IS NULL
  AND submitted_by IS NULL
  AND reviewed_at IS NULL
  AND reviewed_by IS NULL;

-- name: DeleteBobObject :execrows
DELETE FROM bob_objects
WHERE id = sqlc.arg(object_id)
  AND entity = sqlc.arg(entity)
  AND current_version_id = sqlc.arg(version_id)
  AND effective_version_id IS NULL
  AND next_version_no = 2
  AND revision = sqlc.arg(object_revision);

-- name: LockEffectiveServiceRelationship :one
SELECT o.id
FROM bob_objects o
JOIN bob_versions v
  ON v.id = o.effective_version_id
 AND v.object_id = o.id
 AND v.entity = o.entity
JOIN bob_service_relationships relation ON relation.object_id=o.id AND relation.merged_into_object_id IS NULL
WHERE o.id = sqlc.arg(platform_object_id)
  AND o.entity = 'other-unit'
  AND o.enabled
  AND v.status = 'EFFECTIVE'
FOR SHARE OF o;

-- name: LockEffectiveBobReference :one
SELECT o.id
FROM bob_objects o
JOIN bob_versions v
  ON v.id = o.effective_version_id
 AND v.object_id = o.id
 AND v.entity = o.entity
WHERE o.id = sqlc.arg(object_id)
  AND o.entity = sqlc.arg(entity)
  AND o.enabled
  AND v.status = 'EFFECTIVE'
FOR SHARE OF o;

-- name: LockEffectiveCategoryReference :one
SELECT detail.target_entity
FROM bob_objects o
JOIN bob_versions v
  ON v.id = o.effective_version_id
 AND v.object_id = o.id
 AND v.entity = o.entity
JOIN bob_category_versions detail ON detail.version_id = v.id
WHERE o.id = sqlc.arg(target_category_id)
  AND o.entity = 'category'
  AND o.enabled
  AND o.current_version_id = o.effective_version_id
  AND v.status = 'EFFECTIVE'
FOR SHARE OF o;

-- name: MarkBobVersionSaved :execrows
UPDATE bob_versions
SET revision = revision + 1, updated_at = now(), updated_by = sqlc.arg(actor_id)
WHERE id = sqlc.arg(id) AND object_id = sqlc.arg(object_id) AND entity = sqlc.arg(entity)
  AND revision = sqlc.arg(revision) AND status = 'DRAFT';

-- name: SubmitBobVersion :execrows
UPDATE bob_versions
SET status = 'PENDING', revision = revision + 1, submitted_at = now(), submitted_by = sqlc.arg(actor_id),
    reviewed_at = NULL, reviewed_by = NULL, review_comment = NULL, updated_at = now(), updated_by = sqlc.arg(actor_id)
WHERE id = sqlc.arg(id) AND object_id = sqlc.arg(object_id) AND entity = sqlc.arg(entity)
  AND revision = sqlc.arg(revision) AND status = 'DRAFT';

-- name: ApproveBobVersion :execrows
UPDATE bob_versions
SET status = 'EFFECTIVE', revision = revision + 1, reviewed_at = now(), reviewed_by = sqlc.arg(actor_id),
    review_comment = sqlc.narg(comment), updated_at = now(), updated_by = sqlc.arg(actor_id)
WHERE id = sqlc.arg(id) AND object_id = sqlc.arg(object_id) AND entity = sqlc.arg(entity)
  AND revision = sqlc.arg(revision) AND status = 'PENDING'
  AND (submitted_by <> sqlc.arg(actor_id)
       OR sqlc.arg(actor_id) = '01JAPPSYST3MACTR0000000000');

-- name: RejectBobVersion :execrows
UPDATE bob_versions
SET status = 'DRAFT', revision = revision + 1,
    submitted_at = NULL, submitted_by = NULL,
    reviewed_at = NULL, reviewed_by = NULL, review_comment = NULL,
    updated_at = now(), updated_by = sqlc.arg(actor_id)
WHERE id = sqlc.arg(id) AND object_id = sqlc.arg(object_id) AND entity = sqlc.arg(entity)
  AND revision = sqlc.arg(revision) AND status = 'PENDING'
  AND (submitted_by <> sqlc.arg(actor_id)
       OR sqlc.arg(actor_id) = '01JAPPSYST3MACTR0000000000');

-- name: UnsubmitBobVersion :execrows
UPDATE bob_versions
SET status = 'DRAFT', revision = revision + 1,
    submitted_at = NULL, submitted_by = NULL,
    reviewed_at = NULL, reviewed_by = NULL, review_comment = NULL,
    updated_at = now(), updated_by = sqlc.arg(actor_id)
WHERE id = sqlc.arg(id) AND object_id = sqlc.arg(object_id) AND entity = sqlc.arg(entity)
  AND revision = sqlc.arg(revision) AND status = 'PENDING';

-- name: MarkBobVersionPendingCopy :execrows
UPDATE bob_versions
SET status = 'PENDING', revision = revision + 1,
    submitted_at = sqlc.arg(submitted_at), submitted_by = sqlc.arg(submitted_by),
    updated_at = now(), updated_by = sqlc.arg(actor_id)
WHERE id = sqlc.arg(id) AND object_id = sqlc.arg(object_id) AND entity = sqlc.arg(entity)
  AND revision = 1 AND status = 'DRAFT';

-- name: InvalidateBobVersion :execrows
UPDATE bob_versions
SET status = 'INVALID', revision = revision + 1, updated_at = now(), updated_by = sqlc.arg(actor_id)
WHERE id = sqlc.arg(id) AND object_id = sqlc.arg(object_id) AND entity = sqlc.arg(entity)
  AND revision = sqlc.arg(revision) AND status = 'EFFECTIVE';

-- name: AdvanceBobObjectForUnapprove :execrows
UPDATE bob_objects
SET current_version_id = sqlc.arg(new_version_id), effective_version_id = NULL,
    next_version_no = next_version_no + 1, revision = revision + 1, updated_at = now(), updated_by = sqlc.arg(actor_id)
WHERE id = sqlc.arg(id) AND entity = sqlc.arg(entity) AND revision = sqlc.arg(revision)
  AND current_version_id = sqlc.arg(old_version_id) AND effective_version_id = sqlc.arg(old_version_id);

-- name: SetBobObjectEnabled :execrows
UPDATE bob_objects
SET enabled = sqlc.arg(enabled), revision = revision + 1,
    updated_at = now(), updated_by = sqlc.arg(actor_id)
WHERE id = sqlc.arg(id) AND entity = sqlc.arg(entity)
  AND revision = sqlc.arg(revision)
  AND (current_version_id = effective_version_id OR entity IN ('customer','supplier','other-unit','sales-partner'))
  AND effective_version_id IS NOT NULL
  AND enabled <> sqlc.arg(enabled);

-- name: SetBobObjectEffective :execrows
UPDATE bob_objects
SET effective_version_id = sqlc.arg(version_id), revision = revision + 1, updated_at = now(), updated_by = sqlc.arg(actor_id)
WHERE id = sqlc.arg(id) AND entity = sqlc.arg(entity) AND current_version_id = sqlc.arg(version_id)
  AND effective_version_id IS NULL AND revision = sqlc.arg(revision);

-- name: SwitchBobEffectiveCandidate :execrows
UPDATE bob_objects
SET effective_version_id = sqlc.arg(new_version_id), revision = revision + 1,
    updated_at = now(), updated_by = sqlc.arg(actor_id)
WHERE id = sqlc.arg(id) AND entity = sqlc.arg(entity)
  AND entity IN ('customer-account','supplier','other-unit','sales-partner')
  AND current_version_id = sqlc.arg(new_version_id)
  AND effective_version_id = sqlc.arg(old_version_id)
  AND revision = sqlc.arg(revision);

-- name: TouchBobObject :exec
UPDATE bob_objects SET updated_at = now(), updated_by = sqlc.arg(actor_id)
WHERE id = sqlc.arg(id) AND entity = sqlc.arg(entity);

-- name: InsertBobAuditEvent :exec
INSERT INTO bob_audit_events (
    id, object_id, version_id, entity, event_type, from_status, to_status, actor_id, comment, request_id, summary
) VALUES (
    sqlc.arg(id), sqlc.arg(object_id), sqlc.arg(version_id), sqlc.arg(entity), sqlc.arg(event_type),
    sqlc.narg(from_status), sqlc.arg(to_status), sqlc.arg(actor_id), sqlc.narg(comment), sqlc.arg(request_id), sqlc.arg(summary)
);

-- name: GetBobVersionView :one
SELECT * FROM bob_version_views
WHERE object_id = sqlc.arg(object_id) AND entity = sqlc.arg(entity)
  AND version_id = COALESCE(NULLIF(sqlc.arg(version_id)::text, ''), current_version_id);

-- name: CountBobObjects :one
SELECT count(*)
FROM bob_version_views view
WHERE view.entity = sqlc.arg(entity) AND view.version_id = view.current_version_id
  AND (view.entity <> 'settlement-method' OR view.settlement_term_code <> 'LEGACY')
  AND (cardinality(sqlc.arg(statuses)::text[]) = 0 OR view.status = ANY(sqlc.arg(statuses)::text[]))
  AND (
    sqlc.arg(enabled_filter)::integer = -1
    OR EXISTS (
      SELECT 1 FROM bob_objects filter_object
      WHERE filter_object.id = view.object_id
        AND filter_object.enabled = (sqlc.arg(enabled_filter)::integer = 1)
    )
  )
  AND (sqlc.arg(customer_type)::text = '' OR customer_type = sqlc.arg(customer_type))
  AND (sqlc.arg(category_id)::text = '' OR category_id = sqlc.arg(category_id))
  AND (sqlc.arg(department_id)::text = '' OR department_id = sqlc.arg(department_id))
  AND (sqlc.arg(position_id)::text = '' OR position_id = sqlc.arg(position_id))
  AND (sqlc.arg(salesperson_employee_id)::text = '' OR salesperson_employee_id = sqlc.arg(salesperson_employee_id))
  AND (sqlc.arg(currency)::text = '' OR currency = sqlc.arg(currency))
  AND (sqlc.arg(product_kind)::text = '' OR product_kind = sqlc.arg(product_kind))
  AND (sqlc.arg(target_entity)::text = '' OR target_entity = sqlc.arg(target_entity))
  AND (sqlc.arg(parent_id)::text = '' OR parent_id = sqlc.arg(parent_id))
  AND (NOT sqlc.arg(root_only)::boolean OR parent_id = '')
  AND (
      sqlc.arg(keyword)::text = ''
      OR code ILIKE '%' || sqlc.arg(keyword) || '%'
      OR name ILIKE '%' || sqlc.arg(keyword) || '%'
      OR (entity = 'vehicle' AND plate_number ILIKE '%' || sqlc.arg(keyword) || '%')
      OR short_name ILIKE '%' || sqlc.arg(keyword) || '%'
      OR tax_number ILIKE '%' || sqlc.arg(keyword) || '%'
      OR contact_name ILIKE '%' || sqlc.arg(keyword) || '%'
      OR contact_phone ILIKE '%' || sqlc.arg(keyword) || '%'
      OR email ILIKE '%' || sqlc.arg(keyword) || '%'
      OR address ILIKE '%' || sqlc.arg(keyword) || '%'
      OR phone ILIKE '%' || sqlc.arg(keyword) || '%'
      OR specification ILIKE '%' || sqlc.arg(keyword) || '%'
      OR model ILIKE '%' || sqlc.arg(keyword) || '%'
      OR barcode ILIKE '%' || sqlc.arg(keyword) || '%'
      OR vin ILIKE '%' || sqlc.arg(keyword) || '%'
      OR engine_number ILIKE '%' || sqlc.arg(keyword) || '%'
      OR account_name ILIKE '%' || sqlc.arg(keyword) || '%'
      OR bank_name ILIKE '%' || sqlc.arg(keyword) || '%'
      OR bank_branch ILIKE '%' || sqlc.arg(keyword) || '%'
  );

-- name: ListBobObjects :many
SELECT view.*
FROM bob_version_views view
WHERE view.entity = sqlc.arg(entity) AND view.version_id = view.current_version_id
  AND (view.entity <> 'settlement-method' OR view.settlement_term_code <> 'LEGACY')
  AND (cardinality(sqlc.arg(statuses)::text[]) = 0 OR view.status = ANY(sqlc.arg(statuses)::text[]))
  AND (
    sqlc.arg(enabled_filter)::integer = -1
    OR EXISTS (
      SELECT 1 FROM bob_objects filter_object
      WHERE filter_object.id = view.object_id
        AND filter_object.enabled = (sqlc.arg(enabled_filter)::integer = 1)
    )
  )
  AND (sqlc.arg(customer_type)::text = '' OR customer_type = sqlc.arg(customer_type))
  AND (sqlc.arg(category_id)::text = '' OR category_id = sqlc.arg(category_id))
  AND (sqlc.arg(department_id)::text = '' OR department_id = sqlc.arg(department_id))
  AND (sqlc.arg(position_id)::text = '' OR position_id = sqlc.arg(position_id))
  AND (sqlc.arg(salesperson_employee_id)::text = '' OR salesperson_employee_id = sqlc.arg(salesperson_employee_id))
  AND (sqlc.arg(currency)::text = '' OR currency = sqlc.arg(currency))
  AND (sqlc.arg(product_kind)::text = '' OR product_kind = sqlc.arg(product_kind))
  AND (sqlc.arg(target_entity)::text = '' OR target_entity = sqlc.arg(target_entity))
  AND (sqlc.arg(parent_id)::text = '' OR parent_id = sqlc.arg(parent_id))
  AND (NOT sqlc.arg(root_only)::boolean OR parent_id = '')
  AND (
      sqlc.arg(keyword)::text = ''
      OR code ILIKE '%' || sqlc.arg(keyword) || '%'
      OR name ILIKE '%' || sqlc.arg(keyword) || '%'
      OR (entity = 'vehicle' AND plate_number ILIKE '%' || sqlc.arg(keyword) || '%')
      OR short_name ILIKE '%' || sqlc.arg(keyword) || '%'
      OR tax_number ILIKE '%' || sqlc.arg(keyword) || '%'
      OR contact_name ILIKE '%' || sqlc.arg(keyword) || '%'
      OR contact_phone ILIKE '%' || sqlc.arg(keyword) || '%'
      OR email ILIKE '%' || sqlc.arg(keyword) || '%'
      OR address ILIKE '%' || sqlc.arg(keyword) || '%'
      OR phone ILIKE '%' || sqlc.arg(keyword) || '%'
      OR specification ILIKE '%' || sqlc.arg(keyword) || '%'
      OR model ILIKE '%' || sqlc.arg(keyword) || '%'
      OR barcode ILIKE '%' || sqlc.arg(keyword) || '%'
      OR vin ILIKE '%' || sqlc.arg(keyword) || '%'
      OR engine_number ILIKE '%' || sqlc.arg(keyword) || '%'
      OR account_name ILIKE '%' || sqlc.arg(keyword) || '%'
      OR bank_name ILIKE '%' || sqlc.arg(keyword) || '%'
      OR bank_branch ILIKE '%' || sqlc.arg(keyword) || '%'
  )
ORDER BY
  CASE WHEN sqlc.arg(sort_field)::text = 'updatedAt' AND sqlc.arg(sort_order)::text = 'asc' THEN object_updated_at END ASC,
  CASE WHEN sqlc.arg(sort_field)::text = 'updatedAt' AND sqlc.arg(sort_order)::text = 'desc' THEN object_updated_at END DESC,
  CASE WHEN sqlc.arg(sort_field)::text = 'code' AND sqlc.arg(sort_order)::text = 'asc' THEN code END ASC,
  CASE WHEN sqlc.arg(sort_field)::text = 'code' AND sqlc.arg(sort_order)::text = 'desc' THEN code END DESC,
  CASE WHEN sqlc.arg(sort_field)::text = 'name' AND sqlc.arg(sort_order)::text = 'asc' THEN name END ASC,
  CASE WHEN sqlc.arg(sort_field)::text = 'name' AND sqlc.arg(sort_order)::text = 'desc' THEN name END DESC,
  CASE WHEN sqlc.arg(sort_field)::text = 'status' AND sqlc.arg(sort_order)::text = 'asc' THEN status END ASC,
  CASE WHEN sqlc.arg(sort_field)::text = 'status' AND sqlc.arg(sort_order)::text = 'desc' THEN status END DESC,
  CASE WHEN sqlc.arg(sort_field)::text = 'version' AND sqlc.arg(sort_order)::text = 'asc' THEN version_no END ASC,
  CASE WHEN sqlc.arg(sort_field)::text = 'version' AND sqlc.arg(sort_order)::text = 'desc' THEN version_no END DESC,
  object_id DESC
LIMIT sqlc.arg(page_size) OFFSET sqlc.arg(page_offset);

-- name: CountBobVersions :one
SELECT count(*) FROM bob_versions WHERE object_id = sqlc.arg(object_id) AND entity = sqlc.arg(entity);

-- name: ListBobVersions :many
SELECT * FROM bob_version_views
WHERE object_id = sqlc.arg(object_id) AND entity = sqlc.arg(entity)
ORDER BY version_no DESC
LIMIT sqlc.arg(page_size) OFFSET sqlc.arg(page_offset);

-- name: CountBobAuditEvents :one
SELECT count(*) FROM bob_audit_events WHERE object_id = sqlc.arg(object_id) AND entity = sqlc.arg(entity);

-- name: ListBobAuditEvents :many
SELECT id, object_id, version_id, entity, event_type, from_status, to_status, actor_id,
       occurred_at, comment, request_id, summary
FROM bob_audit_events
WHERE object_id = sqlc.arg(object_id) AND entity = sqlc.arg(entity)
ORDER BY occurred_at DESC, id DESC
LIMIT sqlc.arg(page_size) OFFSET sqlc.arg(page_offset);

-- name: ResolveBobEffectiveReference :one
SELECT view.*
FROM bob_version_views view
JOIN bob_objects o ON o.id = view.object_id AND o.entity = view.entity
WHERE view.object_id = sqlc.arg(object_id) AND view.entity = sqlc.arg(entity)
  AND view.version_id = sqlc.arg(version_id)
  AND view.effective_version_id = view.version_id
  AND view.status = 'EFFECTIVE'
  AND o.enabled
FOR SHARE OF o;

-- name: ResolveCurrentBobEffectiveReference :one
SELECT view.*
FROM bob_version_views view
JOIN bob_objects o ON o.id = view.object_id AND o.entity = view.entity
WHERE view.object_id = sqlc.arg(object_id) AND view.entity = sqlc.arg(entity)
  AND view.version_id = o.effective_version_id
  AND view.status = 'EFFECTIVE'
  AND o.enabled
FOR SHARE OF o;

-- name: QueryBobReferenceCandidates :many
SELECT o.id AS object_id,o.effective_version_id AS version_id,o.code,
  (CASE
    WHEN o.entity='customer-account' THEN customer_account.name
    WHEN o.entity='operating-entity' THEN operating.legal_name
    WHEN o.entity='employee' THEN COALESCE(employee_party.display_name,employee_party.legal_name)
    WHEN o.entity='other-unit' THEN COALESCE(other_unit_party.display_name,other_unit_party.legal_name)
    WHEN o.entity='supplier' THEN COALESCE(supplier_party.display_name,supplier_party.legal_name)
    WHEN o.entity='sales-partner' THEN COALESCE(sales_party.display_name,sales_party.legal_name)
    WHEN o.entity='product' THEN product.name
  END)::text AS name
FROM bob_objects o
LEFT JOIN bob_customer_versions customer_account ON customer_account.version_id=o.effective_version_id AND customer_account.entity='customer-account'
LEFT JOIN bob_operating_entity_versions operating ON operating.version_id=o.effective_version_id
LEFT JOIN bob_employment_relationships employee_relation ON employee_relation.object_id=o.id AND o.entity='employee'
LEFT JOIN bob_parties employee_party ON employee_party.id=employee_relation.party_id
LEFT JOIN bob_service_relationships other_unit_relation ON other_unit_relation.object_id=o.id AND o.entity='other-unit'
LEFT JOIN bob_parties other_unit_party ON other_unit_party.id=other_unit_relation.party_id
LEFT JOIN bob_supplier_relationships supplier_relation ON supplier_relation.object_id=o.id AND o.entity='supplier'
LEFT JOIN bob_parties supplier_party ON supplier_party.id=supplier_relation.party_id
LEFT JOIN bob_sales_relationships sales_relation ON sales_relation.object_id=o.id AND o.entity='sales-partner'
LEFT JOIN bob_parties sales_party ON sales_party.id=sales_relation.party_id
LEFT JOIN bob_product_versions product ON product.version_id=o.effective_version_id
LEFT JOIN bob_objects source_object ON source_object.id=NULLIF(sqlc.arg(source_object_id)::text,'') AND source_object.entity=o.entity
LEFT JOIN bob_product_versions source_product ON source_product.version_id=source_object.effective_version_id
WHERE o.entity=sqlc.arg(entity) AND o.enabled AND o.effective_version_id IS NOT NULL
  AND (btrim(sqlc.arg(source_object_id)::text)='' OR o.id<>sqlc.arg(source_object_id))
  AND (o.entity<>'product' OR source_object.id IS NULL OR product.product_kind=source_product.product_kind)
  AND (
    btrim(sqlc.arg(keyword)::text)=''
    OR o.code ILIKE '%'||btrim(sqlc.arg(keyword)::text)||'%'
    OR CASE
      WHEN o.entity='customer-account' THEN customer_account.name
      WHEN o.entity='operating-entity' THEN operating.legal_name
      WHEN o.entity='employee' THEN COALESCE(employee_party.display_name,employee_party.legal_name)
      WHEN o.entity='other-unit' THEN COALESCE(other_unit_party.display_name,other_unit_party.legal_name)
      WHEN o.entity='supplier' THEN COALESCE(supplier_party.display_name,supplier_party.legal_name)
      WHEN o.entity='sales-partner' THEN COALESCE(sales_party.display_name,sales_party.legal_name)
      WHEN o.entity='product' THEN product.name
    END ILIKE '%'||btrim(sqlc.arg(keyword)::text)||'%'
  )
ORDER BY o.code ASC,o.id ASC
LIMIT 20;

-- name: CountBobOperatingEntities :one
SELECT count(*) FROM bob_objects o
JOIN bob_versions v ON v.id=o.current_version_id
JOIN bob_operating_entity_versions d ON d.version_id=v.id
WHERE o.entity='operating-entity' AND (sqlc.arg(statuses)::text[]='{}' OR v.status=ANY(sqlc.arg(statuses)::text[]))
  AND (sqlc.arg(keyword)::text='' OR o.code ILIKE '%'||sqlc.arg(keyword)::text||'%' OR d.legal_name ILIKE '%'||sqlc.arg(keyword)::text||'%')
  AND (sqlc.arg(enabled_filter)::integer=-1 OR o.enabled=(sqlc.arg(enabled_filter)::integer=1));

-- name: GetBobOperatingEntity :one
SELECT o.id,o.code,o.revision,o.enabled,o.current_version_id,o.effective_version_id,o.updated_at,
  v.id,v.version_no,v.status,v.revision,v.created_at,v.created_by,v.updated_at,v.updated_by,
  v.submitted_at,v.submitted_by,v.reviewed_at,v.reviewed_by,v.review_comment,
  d.legal_name,d.short_name,d.tax_number,d.address,d.phone,d.remark
FROM bob_objects o JOIN bob_versions v ON v.object_id=o.id AND v.id=COALESCE(NULLIF(sqlc.arg(version_id)::text,''),o.current_version_id)
JOIN bob_operating_entity_versions d ON d.version_id=v.id
WHERE o.id=sqlc.arg(object_id) AND o.entity='operating-entity';

-- name: LockReferenceTransferSource :one
SELECT entity,revision,enabled,current_version_id,effective_version_id
FROM bob_objects WHERE id=sqlc.arg(object_id) FOR UPDATE;

-- name: LockReferenceTransferTarget :one
SELECT effective_version_id FROM bob_objects
WHERE id=sqlc.arg(object_id) AND entity=sqlc.arg(entity) AND enabled AND effective_version_id IS NOT NULL
FOR SHARE;

-- name: ListCustomerSalesReferencesForEmployee :many
SELECT object.id AS object_id,object.entity,'customer-sales'::text AS role FROM bob_objects object JOIN bob_customer_versions customer_detail ON customer_detail.version_id=object.effective_version_id WHERE customer_detail.primary_sales_subject_id=sqlc.arg(source_object_id) AND customer_detail.primary_sales_attribution_type='INTERNAL_EMPLOYEE';

-- name: ListSupplierPurchaserReferencesForEmployee :many
SELECT object.id AS object_id,object.entity,'supplier-purchaser'::text AS role FROM bob_objects object JOIN bob_supplier_versions supplier_detail ON supplier_detail.version_id=object.effective_version_id WHERE supplier_detail.default_purchaser_employee_id=sqlc.arg(source_object_id);

-- name: ListWarehouseManagerReferencesForEmployee :many
SELECT object.id AS object_id,object.entity,'warehouse-manager'::text AS role FROM bob_objects object JOIN bob_warehouse_versions warehouse_detail ON warehouse_detail.version_id=object.effective_version_id WHERE warehouse_detail.manager_employee_id=sqlc.arg(source_object_id);

-- name: ListCustomerSalesReferencesForSalesPartner :many
SELECT object.id AS object_id,object.entity,
  CASE customer_detail.primary_sales_attribution_type
    WHEN 'EXTERNAL_PART_TIME' THEN 'customer-sales-external-part-time'
    WHEN 'CHANNEL_PARTNER' THEN 'customer-sales-channel-partner'
  END::text AS role
FROM bob_objects object
JOIN bob_customer_versions customer_detail ON customer_detail.version_id=object.effective_version_id
WHERE customer_detail.primary_sales_subject_id=sqlc.arg(source_object_id)
  AND customer_detail.primary_sales_attribution_type IN ('EXTERNAL_PART_TIME','CHANNEL_PARTNER');

-- name: ListCustomerOperatingReferences :many
SELECT object.id AS object_id,object.entity,'customer-operating'::text AS role FROM bob_objects object JOIN bob_customer_versions customer_detail ON customer_detail.version_id=object.effective_version_id WHERE customer_detail.operating_entity_id=sqlc.arg(source_object_id);

-- name: ListFundOperatingReferences :many
SELECT object.id AS object_id,object.entity,'fund-operating'::text AS role FROM bob_objects object JOIN bob_fund_account_versions fund_detail ON fund_detail.version_id=object.effective_version_id WHERE fund_detail.operating_entity_id=sqlc.arg(source_object_id);

-- name: ListVehiclePlatformReferences :many
SELECT object.id AS object_id,object.entity,'vehicle-platform'::text AS role FROM bob_objects object JOIN bob_vehicle_versions vehicle_detail ON vehicle_detail.version_id=object.effective_version_id WHERE vehicle_detail.platform_object_id=sqlc.arg(source_object_id);

-- name: ListFormulaMaterialReferences :many
SELECT object.id AS object_id,object.entity,'formula-material'::text AS role FROM bob_objects object JOIN bob_product_formula_lines formula_line ON formula_line.product_version_id=object.effective_version_id WHERE formula_line.material_object_id=sqlc.arg(source_object_id);

-- name: ListPackagingProductReferences :many
SELECT object.id AS object_id,object.entity,'packaging-product'::text AS role FROM bob_objects object JOIN bob_product_packaging_specs packaging_spec ON packaging_spec.product_version_id=object.effective_version_id WHERE packaging_spec.packaging_product_object_id=sqlc.arg(source_object_id);

-- name: DisableReferenceTransferSource :execrows
UPDATE bob_objects SET enabled=false,revision=revision+1,updated_at=now(),updated_by=sqlc.arg(actor_id)
WHERE id=sqlc.arg(object_id) AND entity=sqlc.arg(entity) AND revision=sqlc.arg(revision) AND enabled
  AND (current_version_id=effective_version_id OR (entity IN ('supplier','other-unit','sales-partner') AND effective_version_id IS NOT NULL));

-- name: ActivateReferenceTransferVersion :execrows
UPDATE bob_versions SET status='EFFECTIVE',revision=revision+1,
  submitted_at=now(),submitted_by=sqlc.arg(submitted_by),reviewed_at=now(),reviewed_by=sqlc.arg(actor_id),
  updated_at=now(),updated_by=sqlc.arg(actor_id)
WHERE id=sqlc.arg(version_id) AND object_id=sqlc.arg(object_id) AND entity=sqlc.arg(entity) AND status='DRAFT' AND revision=1;

-- name: SwitchReferenceTransferObject :execrows
UPDATE bob_objects SET current_version_id=sqlc.arg(new_version_id),effective_version_id=sqlc.arg(new_version_id),next_version_no=next_version_no+1,revision=revision+1,updated_at=now(),updated_by=sqlc.arg(actor_id)
WHERE id=sqlc.arg(object_id) AND entity=sqlc.arg(entity) AND revision=sqlc.arg(revision) AND current_version_id=sqlc.arg(old_version_id) AND effective_version_id=sqlc.arg(old_version_id);

-- name: GetReferenceTransferTargetProductKind :one
SELECT detail.product_kind FROM bob_objects object JOIN bob_product_versions detail ON detail.version_id=object.effective_version_id
WHERE object.id=sqlc.arg(object_id) AND object.entity='product' AND object.enabled AND object.effective_version_id=sqlc.arg(version_id)
FOR SHARE OF object;

-- name: ReferenceTransferTargetIsServiceRelationship :one
SELECT EXISTS(
  SELECT 1
  FROM bob_objects object
  JOIN bob_service_relationships relationship ON relationship.object_id=object.id
  WHERE object.id=sqlc.arg(object_id) AND object.entity='other-unit' AND object.enabled
    AND object.effective_version_id=sqlc.arg(version_id) AND relationship.merged_into_object_id IS NULL
) AS eligible;

-- name: ReferenceTransferTargetHasSalesCapability :one
SELECT EXISTS(
  SELECT 1
  FROM bob_objects object
  JOIN bob_sales_relationships relationship ON relationship.object_id=object.id
  JOIN bob_sales_partner_versions detail ON detail.version_id=object.effective_version_id
  WHERE object.id=sqlc.arg(object_id) AND object.entity='sales-partner' AND object.enabled
    AND object.effective_version_id=sqlc.arg(version_id) AND relationship.merged_into_object_id IS NULL
    AND sqlc.arg(capability)::text=ANY(detail.capabilities)
) AS eligible;

-- name: ReplaceCustomerOperatingEntityReference :exec
UPDATE bob_customer_versions SET operating_entity_id=sqlc.arg(target_object_id),operating_entity_code=sqlc.arg(code),operating_entity_name=sqlc.arg(name),operating_entity_tax_number=sqlc.arg(tax_number),operating_entity_address=sqlc.arg(address),operating_entity_phone=sqlc.arg(phone)
WHERE version_id=sqlc.arg(version_id);

-- name: ReplaceFundOperatingEntityReference :exec
UPDATE bob_fund_account_versions SET operating_entity_id=sqlc.arg(target_object_id),operating_entity_version_id=sqlc.arg(target_version_id),operating_entity_code=sqlc.arg(code),operating_entity_name=sqlc.arg(name)
WHERE version_id=sqlc.arg(version_id);

-- name: ReplaceCustomerSalesReference :exec
UPDATE bob_customer_versions SET primary_sales_subject_id=sqlc.arg(target_object_id),primary_sales_subject_version_id=sqlc.arg(target_version_id),primary_sales_subject_code=sqlc.arg(code),primary_sales_subject_name=sqlc.arg(name),salesperson_employee_id=CASE WHEN primary_sales_attribution_type='INTERNAL_EMPLOYEE' THEN sqlc.arg(target_object_id) ELSE salesperson_employee_id END
WHERE version_id=sqlc.arg(version_id);

-- name: ReplaceSupplierPurchaserReference :exec
UPDATE bob_supplier_versions SET default_purchaser_employee_id=sqlc.arg(target_object_id) WHERE version_id=sqlc.arg(version_id);

-- name: ReplaceWarehouseManagerReference :exec
UPDATE bob_warehouse_versions SET manager_employee_id=sqlc.arg(target_object_id) WHERE version_id=sqlc.arg(version_id);

-- name: ReplaceVehiclePlatformReference :exec
UPDATE bob_vehicle_versions SET platform_object_id=sqlc.arg(target_object_id) WHERE version_id=sqlc.arg(version_id);

-- name: ReplaceFormulaMaterialReference :exec
UPDATE bob_product_formula_lines SET material_object_id=sqlc.arg(target_object_id),material_version_id=sqlc.arg(target_version_id)
WHERE product_version_id=sqlc.arg(product_version_id) AND material_object_id=sqlc.arg(source_object_id);

-- name: ReplacePackagingProductReference :exec
UPDATE bob_product_packaging_specs SET packaging_product_object_id=sqlc.arg(target_object_id),packaging_product_version_id=sqlc.arg(target_version_id)
WHERE product_version_id=sqlc.arg(product_version_id) AND packaging_product_object_id=sqlc.arg(source_object_id);

-- name: RestoreBobCustomerEffectiveVersion :execrows
UPDATE bob_objects SET current_version_id=effective_version_id,revision=revision+1,updated_at=now()
WHERE id=sqlc.arg(object_id) AND entity='customer-account' AND revision=sqlc.arg(revision)
  AND current_version_id=sqlc.arg(version_id) AND effective_version_id=sqlc.arg(effective_version_id);

-- name: DeleteBobAuditEventsForVersion :exec
DELETE FROM bob_audit_events WHERE object_id=sqlc.arg(object_id) AND version_id=sqlc.arg(version_id) AND entity=sqlc.arg(entity);

-- name: DeleteBobCustomerCreditLimits :exec
DELETE FROM bob_customer_credit_limits WHERE version_id=sqlc.arg(version_id);

-- name: DeleteBobCustomerVersion :execrows
DELETE FROM bob_versions WHERE id=sqlc.arg(version_id) AND object_id=sqlc.arg(object_id) AND entity='customer-account';

-- name: BobObjectIsCustomerAccount :one
SELECT EXISTS(SELECT 1 FROM bob_customer_accounts WHERE object_id=sqlc.arg(object_id));

-- name: BobCustomerRelationshipVersionExists :one
SELECT EXISTS(SELECT 1 FROM bob_customer_relationship_versions WHERE version_id=sqlc.arg(version_id));

-- name: GetStoredBobOperatingEntityDetail :one
SELECT legal_name,COALESCE(short_name,''),COALESCE(tax_number,''),COALESCE(address,''),COALESCE(phone,''),COALESCE(remark,'')
FROM bob_operating_entity_versions WHERE version_id=sqlc.arg(version_id);

-- name: GetFundAccountOperatingDetail :one
SELECT COALESCE(operating_entity_id,''),COALESCE(operating_entity_version_id,''),COALESCE(operating_entity_code,''),COALESCE(operating_entity_name,'')
FROM bob_fund_account_versions WHERE version_id=sqlc.arg(version_id);

-- name: GetStoredCustomerSettlement :one
SELECT COALESCE(detail.settlement_method_id,''),COALESCE(detail.settlement_method_code,''),COALESCE(detail.settlement_method_name,''),COALESCE(detail.settlement_term_code,''),COALESCE(detail.settlement_rule_type,''),detail.settlement_due_days,detail.settlement_month_offset,detail.settlement_cutoff_day,detail.settlement_sales_surcharge_cents,
       COALESCE(detail.primary_sales_attribution_type,''),COALESCE(detail.primary_sales_subject_id,'')
FROM bob_customer_versions detail
JOIN bob_versions version ON version.id=detail.version_id AND version.object_id=sqlc.arg(object_id)
WHERE detail.version_id=sqlc.arg(version_id) AND detail.entity='customer-account';

-- name: ResolveFundAccountOperatingEntity :one
SELECT object.id,version.id,object.code,detail.legal_name
FROM bob_objects object JOIN bob_versions version ON version.id=object.effective_version_id
JOIN bob_operating_entity_versions detail ON detail.version_id=version.id
WHERE object.id=sqlc.arg(object_id) AND object.entity='operating-entity' AND object.enabled AND version.status='EFFECTIVE'
FOR SHARE OF object,version;

-- name: GetBobCustomerRelationshipDetail :one
SELECT o.id,o.code,o.revision,o.enabled,o.effective_version_id,o.current_version_id,o.updated_at,
       relation.party_id,party.kind AS party_kind,party.display_name AS party_display_name,
       relation.operating_entity_id,operating.code AS operating_entity_code,operating_detail.legal_name AS operating_entity_name
FROM bob_objects o
JOIN bob_customer_relationships relation ON relation.object_id=o.id AND relation.merged_into_object_id IS NULL
JOIN bob_parties party ON party.id=relation.party_id AND party.merged_into_party_id IS NULL
JOIN bob_objects operating ON operating.id=relation.operating_entity_id AND operating.entity='operating-entity'
JOIN bob_operating_entity_versions operating_detail ON operating_detail.version_id=operating.current_version_id
WHERE o.id=sqlc.arg(object_id) AND o.entity='customer';

-- name: ListBobCustomerAccounts :many
SELECT o.id,o.code,o.revision,o.enabled,o.effective_version_id,o.current_version_id,o.updated_at
FROM bob_customer_accounts account JOIN bob_objects o ON o.id=account.object_id
WHERE account.customer_relationship_id=sqlc.arg(customer_relationship_id) AND o.entity='customer-account'
ORDER BY o.code;

-- name: InsertBobCustomerRelationship :exec
INSERT INTO bob_customer_relationships(object_id,party_id,operating_entity_id,created_by)
VALUES(sqlc.arg(object_id),sqlc.arg(party_id),sqlc.arg(operating_entity_id),sqlc.arg(actor_id));

-- name: InsertBobCustomerRelationshipDetail :exec
INSERT INTO bob_customer_relationship_versions(version_id) VALUES(sqlc.arg(version_id));

-- name: InsertBobCustomerAccountRelationship :exec
INSERT INTO bob_customer_accounts(object_id,customer_relationship_id,created_by)
VALUES(sqlc.arg(object_id),sqlc.arg(customer_relationship_id),sqlc.arg(actor_id));

-- name: AdvanceBobCustomerAccountCandidate :execrows
UPDATE bob_objects SET current_version_id=sqlc.arg(version_id),next_version_no=next_version_no+1,
 revision=revision+1,updated_at=now(),updated_by=sqlc.arg(actor_id)
WHERE id=sqlc.arg(object_id) AND entity='customer-account' AND revision=sqlc.arg(revision)
 AND current_version_id=sqlc.arg(current_version_id);

-- name: GetBobCustomerAccountDetail :one
SELECT o.id,o.code,o.revision,o.enabled,o.effective_version_id,o.current_version_id,o.updated_at,account.customer_relationship_id
FROM bob_objects o JOIN bob_customer_accounts account ON account.object_id=o.id
WHERE o.id=sqlc.arg(object_id) AND o.entity='customer-account';

-- name: GetBobCustomerVersion :one
SELECT v.id,v.version_no,v.status,v.revision,v.created_at,v.created_by,v.updated_at,v.updated_by,v.submitted_at,v.submitted_by,v.reviewed_at,v.reviewed_by,v.review_comment,
 d.name,COALESCE(d.short_name,''),d.customer_type,COALESCE(d.contact_name,''),COALESCE(d.contact_phone,''),COALESCE(d.email,''),COALESCE(d.address,''),COALESCE(d.operating_entity_id,''),COALESCE(d.operating_entity_code,''),COALESCE(d.operating_entity_name,''),COALESCE(d.operating_entity_tax_number,''),COALESCE(d.operating_entity_address,''),COALESCE(d.operating_entity_phone,''),COALESCE(d.settlement_method_id,''),COALESCE(d.settlement_method_code,''),COALESCE(d.settlement_method_name,''),COALESCE(d.settlement_term_code,''),COALESCE(d.settlement_rule_type,''),d.settlement_due_days,d.settlement_month_offset,d.settlement_cutoff_day,d.settlement_sales_surcharge_cents,COALESCE(d.payment_method_id,''),COALESCE(d.payment_method_code,''),COALESCE(d.payment_method_name,''),d.payment_sales_surcharge_cents,COALESCE(d.default_transport_method_code,''),COALESCE(d.default_transport_method_name,''),d.transport_surcharge_cents,d.pricing_policy,d.primary_sales_attribution_type,d.primary_sales_subject_id,d.primary_sales_subject_version_id,d.primary_sales_subject_code,d.primary_sales_subject_name,COALESCE(d.internal_reminder,''),COALESCE(d.default_sales_order_remark,'')
FROM bob_versions v JOIN bob_customer_versions d ON d.version_id=v.id
WHERE v.object_id=sqlc.arg(object_id) AND v.entity='customer-account' AND v.id=sqlc.arg(version_id);

-- name: ListBobCustomerCreditLimits :many
SELECT currency,amount_cents FROM bob_customer_credit_limits WHERE version_id=sqlc.arg(version_id) ORDER BY currency;

-- name: GetStoredBobCustomerValidationData :one
SELECT customer_type,pricing_policy,COALESCE(operating_entity_id,''),COALESCE(operating_entity_code,''),COALESCE(operating_entity_name,''),COALESCE(settlement_method_id,''),COALESCE(settlement_method_code,''),COALESCE(settlement_method_name,''),COALESCE(payment_method_id,''),COALESCE(payment_method_code,''),COALESCE(payment_method_name,''),COALESCE(default_transport_method_code,''),COALESCE(default_transport_method_name,''),primary_sales_attribution_type,primary_sales_subject_id
FROM bob_customer_versions WHERE version_id=sqlc.arg(version_id);

-- name: ResolveCustomerOperatingEntity :one
SELECT o.id,o.code,v.id,d.legal_name,COALESCE(d.tax_number,''),COALESCE(d.address,''),COALESCE(d.phone,'')
FROM bob_objects o JOIN bob_versions v ON v.id=o.effective_version_id JOIN bob_operating_entity_versions d ON d.version_id=v.id
WHERE o.id=sqlc.arg(object_id) AND o.entity='operating-entity' AND o.enabled AND v.status='EFFECTIVE' FOR SHARE OF o,v;

-- name: InsertBobCustomerAccountData :exec
INSERT INTO bob_customer_versions(
 version_id,entity,name,customer_type,short_name,contact_name,contact_phone,email,address,salesperson_employee_id,rebate_unit_price_cents,
 operating_entity_id,operating_entity_code,operating_entity_name,operating_entity_tax_number,operating_entity_address,operating_entity_phone,
 settlement_method_id,settlement_method_code,settlement_method_name,settlement_term_code,settlement_rule_type,settlement_due_days,settlement_month_offset,settlement_cutoff_day,settlement_sales_surcharge_cents,
 payment_method_id,payment_method_code,payment_method_name,payment_sales_surcharge_cents,default_transport_method_code,default_transport_method_name,transport_surcharge_cents,pricing_policy,
 primary_sales_attribution_type,primary_sales_subject_id,primary_sales_subject_version_id,primary_sales_subject_code,primary_sales_subject_name,internal_reminder,default_sales_order_remark)
VALUES(sqlc.arg(version_id),'customer-account',sqlc.arg(name),sqlc.arg(customer_type),NULLIF(sqlc.arg(short_name)::text,''),NULLIF(sqlc.arg(contact_name)::text,''),NULLIF(sqlc.arg(contact_phone)::text,''),NULLIF(sqlc.arg(email)::text,''),NULLIF(sqlc.arg(address)::text,''),
 NULLIF(sqlc.arg(salesperson_employee_id)::text,''),0,NULLIF(sqlc.arg(operating_entity_id)::text,''),NULLIF(sqlc.arg(operating_entity_code)::text,''),NULLIF(sqlc.arg(operating_entity_name)::text,''),NULLIF(sqlc.arg(operating_entity_tax_number)::text,''),NULLIF(sqlc.arg(operating_entity_address)::text,''),NULLIF(sqlc.arg(operating_entity_phone)::text,''),
 NULLIF(sqlc.arg(settlement_method_id)::text,''),NULLIF(sqlc.arg(settlement_method_code)::text,''),NULLIF(sqlc.arg(settlement_method_name)::text,''),NULLIF(sqlc.arg(settlement_term_code)::text,''),NULLIF(sqlc.arg(settlement_rule_type)::text,''),sqlc.arg(settlement_due_days),sqlc.arg(settlement_month_offset),sqlc.arg(settlement_cutoff_day),sqlc.arg(settlement_sales_surcharge_cents),
 NULLIF(sqlc.arg(payment_method_id)::text,''),NULLIF(sqlc.arg(payment_method_code)::text,''),NULLIF(sqlc.arg(payment_method_name)::text,''),sqlc.arg(payment_sales_surcharge_cents),NULLIF(sqlc.arg(default_transport_method_code)::text,''),NULLIF(sqlc.arg(default_transport_method_name)::text,''),sqlc.arg(transport_surcharge_cents),sqlc.arg(pricing_policy),
 sqlc.arg(primary_sales_attribution_type),sqlc.arg(primary_sales_subject_id),sqlc.arg(primary_sales_subject_version_id),sqlc.arg(primary_sales_subject_code),sqlc.arg(primary_sales_subject_name),NULLIF(sqlc.arg(internal_reminder)::text,''),NULLIF(sqlc.arg(default_sales_order_remark)::text,''));

-- name: InsertBobCustomerCreditLimit :exec
INSERT INTO bob_customer_credit_limits(version_id,currency,amount_cents) VALUES(sqlc.arg(version_id),sqlc.arg(currency),sqlc.arg(amount_cents));
-- name: AdvanceBobOtherUnitCandidate :execrows
UPDATE bob_objects SET current_version_id=sqlc.arg(version_id),next_version_no=next_version_no+1,
  revision=revision+1,updated_at=now(),updated_by=sqlc.arg(actor_id)
WHERE id=sqlc.arg(object_id) AND entity='other-unit' AND revision=sqlc.arg(revision)
  AND current_version_id=sqlc.arg(current_version_id);

-- name: RestoreBobOtherUnitEffectiveVersion :execrows
UPDATE bob_objects SET current_version_id=effective_version_id,revision=revision+1,updated_at=now()
WHERE id=sqlc.arg(object_id) AND entity='other-unit' AND revision=sqlc.arg(revision)
  AND current_version_id=sqlc.arg(version_id) AND effective_version_id=sqlc.arg(effective_version_id);

-- name: RestoreBobSupplierEffectiveVersion :execrows
UPDATE bob_objects SET current_version_id=effective_version_id,revision=revision+1,updated_at=now()
WHERE id=sqlc.arg(object_id) AND entity='supplier' AND revision=sqlc.arg(revision)
  AND current_version_id=sqlc.arg(version_id) AND effective_version_id=sqlc.arg(effective_version_id);

-- name: DeleteBobOtherUnitVersion :execrows
DELETE FROM bob_versions WHERE id=sqlc.arg(version_id) AND object_id=sqlc.arg(object_id) AND entity='other-unit';

-- name: DeleteBobSupplierVersion :execrows
DELETE FROM bob_versions WHERE id=sqlc.arg(version_id) AND object_id=sqlc.arg(object_id) AND entity='supplier';

-- name: GetStoredBobSupplierValidationData :one
SELECT COALESCE(settlement_method_id,''),COALESCE(settlement_method_code,''),
  COALESCE(settlement_method_name,''),COALESCE(settlement_term_code,''),
  COALESCE(settlement_rule_type,''),settlement_month_offset,settlement_day_of_month,
  settlement_day_offset,COALESCE(default_purchaser_employee_id,'') AS default_purchaser_employee_id
FROM bob_supplier_versions WHERE version_id=sqlc.arg(version_id);

-- name: AdvanceBobSupplierCandidate :execrows
UPDATE bob_objects SET current_version_id=sqlc.arg(version_id),next_version_no=next_version_no+1,
  revision=revision+1,updated_at=now(),updated_by=sqlc.arg(actor_id)
WHERE id=sqlc.arg(object_id) AND entity='supplier' AND revision=sqlc.arg(revision)
  AND current_version_id=sqlc.arg(current_version_id);

-- name: GetBobSupplierDetail :one
SELECT id,code,revision,enabled,effective_version_id,current_version_id,updated_at
FROM bob_objects WHERE id=sqlc.arg(object_id) AND entity='supplier';

-- name: GetBobSupplierVersion :one
SELECT v.id,v.version_no,v.status,v.revision,v.created_at,v.created_by,v.updated_at,v.updated_by,
  v.submitted_at,v.submitted_by,v.reviewed_at,v.reviewed_by,v.review_comment,
  d.name,COALESCE(d.short_name,''),COALESCE(d.tax_number,''),
  COALESCE(d.contact_name,''),COALESCE(d.contact_phone,''),COALESCE(d.email,''),
  COALESCE(d.address,''),COALESCE(d.remark,''),COALESCE(d.settlement_method_id,''),
  COALESCE(d.settlement_method_code,''),COALESCE(d.settlement_method_name,''),
  COALESCE(d.settlement_term_code,''),COALESCE(d.settlement_rule_type,''),
  d.settlement_month_offset,d.settlement_day_of_month,d.settlement_day_offset,
  COALESCE(d.default_purchaser_employee_id,'') AS default_purchaser_employee_id
FROM bob_versions v JOIN bob_supplier_versions d ON d.version_id=v.id
WHERE v.object_id=sqlc.arg(object_id) AND v.entity='supplier' AND v.id=sqlc.arg(version_id);

-- name: GetBobCustomerAccountRelationshipParty :one
SELECT relation.party_id,relation.operating_entity_id
FROM bob_customer_accounts account
JOIN bob_customer_relationships relation ON relation.object_id=account.customer_relationship_id
WHERE account.object_id=sqlc.arg(object_id) AND relation.merged_into_object_id IS NULL
FOR SHARE;

-- name: LockBobCustomerAccountRelationship :one
SELECT account.customer_relationship_id
FROM bob_customer_accounts account
JOIN bob_customer_relationships relation ON relation.object_id=account.customer_relationship_id
WHERE account.object_id=sqlc.arg(object_id) AND relation.merged_into_object_id IS NULL
FOR UPDATE OF relation,account;

-- name: CountBobCustomerRelationshipAccounts :one
SELECT count(*) FROM bob_customer_accounts WHERE customer_relationship_id=sqlc.arg(customer_relationship_id);

-- name: DeleteBobCustomerAccountRelationship :execrows
DELETE FROM bob_customer_accounts WHERE object_id=sqlc.arg(object_id) AND customer_relationship_id=sqlc.arg(customer_relationship_id);

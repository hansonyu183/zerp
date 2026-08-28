-- DCL keeps one stable subject and one typed full snapshot per central
-- Approval Version.  It deliberately stores no current/base/next pointer.

-- name: InsertDCLSubject :exec
INSERT INTO dcl_subjects(id, entity, created_by)
VALUES(sqlc.arg(id), sqlc.arg(entity), sqlc.arg(actor_id));

-- name: GetDCLSubject :one
SELECT id, entity, created_at, created_by
FROM dcl_subjects
WHERE id=sqlc.arg(id) AND entity=sqlc.arg(entity);

-- name: DeleteDCLSubject :execrows
DELETE FROM dcl_subjects
WHERE id=sqlc.arg(id) AND entity=sqlc.arg(entity);

-- Party identity snapshots are DCL-owned. Strong identifiers are stored with
-- every immutable version, while the claims table serializes approved/open
-- ownership across all Party roots.
-- name: InsertDCLPartyVersion :exec
INSERT INTO dcl_party_versions(approval_entry_id,party_id,kind,legal_name,display_name,tax_number,phone,email,address)
VALUES(sqlc.arg(approval_entry_id),sqlc.arg(party_id),sqlc.arg(kind),sqlc.arg(legal_name),sqlc.arg(display_name),sqlc.narg(tax_number),sqlc.narg(phone),sqlc.narg(email),sqlc.narg(address));

-- name: CopyDCLPartyVersion :execrows
INSERT INTO dcl_party_versions(approval_entry_id,party_id,kind,legal_name,display_name,tax_number,phone,email,address)
SELECT sqlc.arg(new_approval_entry_id),source.party_id,source.kind,source.legal_name,source.display_name,source.tax_number,source.phone,source.email,source.address
FROM dcl_party_versions source WHERE source.approval_entry_id=sqlc.arg(source_approval_entry_id);

-- name: UpdateDCLPartyVersion :execrows
UPDATE dcl_party_versions SET kind=sqlc.arg(kind),legal_name=sqlc.arg(legal_name),display_name=sqlc.arg(display_name),tax_number=sqlc.narg(tax_number),phone=sqlc.narg(phone),email=sqlc.narg(email),address=sqlc.narg(address)
WHERE approval_entry_id=sqlc.arg(approval_entry_id);

-- name: GetDCLPartyVersion :one
SELECT approval_entry_id,party_id,kind,legal_name,display_name,tax_number,phone,email,address
FROM dcl_party_versions WHERE approval_entry_id=sqlc.arg(approval_entry_id);

-- name: DeleteDCLPartyVersion :execrows
DELETE FROM dcl_party_versions WHERE approval_entry_id=sqlc.arg(approval_entry_id);

-- name: InsertDCLPartyVersionIdentifier :exec
INSERT INTO dcl_party_version_identifiers(approval_entry_id,identifier_type,value,normalized_value)
VALUES(sqlc.arg(approval_entry_id),sqlc.arg(identifier_type),sqlc.arg(value),sqlc.arg(normalized_value));

-- name: ListDCLPartyVersionIdentifiers :many
SELECT identifier_type,value,normalized_value FROM dcl_party_version_identifiers
WHERE approval_entry_id=sqlc.arg(approval_entry_id) ORDER BY identifier_type,normalized_value;

-- name: CopyDCLPartyVersionIdentifiers :execrows
INSERT INTO dcl_party_version_identifiers(approval_entry_id,identifier_type,value,normalized_value)
SELECT sqlc.arg(new_approval_entry_id),source.identifier_type,source.value,source.normalized_value
FROM dcl_party_version_identifiers source WHERE source.approval_entry_id=sqlc.arg(source_approval_entry_id);

-- name: ReplaceDCLPartyVersionIdentifiers :execrows
DELETE FROM dcl_party_version_identifiers WHERE approval_entry_id=sqlc.arg(approval_entry_id);

-- DCL Party list keeps the latest approved and the single open candidate as
-- separate typed snapshots. Filter and sort use the candidate when present,
-- otherwise the approved snapshot, so draft-only roots are discoverable and
-- a page can be hydrated with a fixed number of batch reads.
-- name: CountDCLParties :one
WITH selected AS (
  SELECT subject.id
  FROM dcl_subjects subject
  JOIN bob_parties party ON party.id=subject.id
  LEFT JOIN LATERAL (
    SELECT id FROM approval_entries
    WHERE domain='dcl' AND entity='party' AND subject_id=subject.id
      AND status IN ('DRAFT','PENDING')
    ORDER BY version_no DESC LIMIT 1
  ) open_entry ON true
  LEFT JOIN LATERAL (
    SELECT id FROM approval_entries
    WHERE domain='dcl' AND entity='party' AND subject_id=subject.id
      AND status='APPROVED'
    ORDER BY version_no DESC LIMIT 1
  ) approved_entry ON true
  JOIN dcl_party_versions display ON display.approval_entry_id=COALESCE(open_entry.id,approved_entry.id)
  WHERE subject.entity='party'
    AND (sqlc.arg(kind)::text='' OR display.kind=sqlc.arg(kind)::text)
    AND (sqlc.arg(keyword)::text='' OR display.legal_name ILIKE '%'||sqlc.arg(keyword)::text||'%' OR display.display_name ILIKE '%'||sqlc.arg(keyword)::text||'%')
    AND ((sqlc.arg(merged)::boolean AND party.merged_into_party_id IS NOT NULL) OR (NOT sqlc.arg(merged)::boolean AND party.merged_into_party_id IS NULL))
)
SELECT count(*) FROM selected;

-- name: ListDCLParties :many
SELECT subject.id AS party_id,
       COALESCE(approved_entry.id,'')::text AS latest_approved_entry_id,
       COALESCE(open_entry.id,'')::text AS open_entry_id,
       COALESCE(open_entry.updated_at,approved_entry.updated_at) AS updated_at
FROM dcl_subjects subject
JOIN bob_parties party ON party.id=subject.id
LEFT JOIN LATERAL (
  SELECT id,updated_at FROM approval_entries
  WHERE domain='dcl' AND entity='party' AND subject_id=subject.id
    AND status IN ('DRAFT','PENDING')
  ORDER BY version_no DESC LIMIT 1
) open_entry ON true
LEFT JOIN LATERAL (
  SELECT id,updated_at FROM approval_entries
  WHERE domain='dcl' AND entity='party' AND subject_id=subject.id
    AND status='APPROVED'
  ORDER BY version_no DESC LIMIT 1
) approved_entry ON true
JOIN dcl_party_versions display ON display.approval_entry_id=COALESCE(open_entry.id,approved_entry.id)
WHERE subject.entity='party'
  AND (sqlc.arg(kind)::text='' OR display.kind=sqlc.arg(kind)::text)
  AND (sqlc.arg(keyword)::text='' OR display.legal_name ILIKE '%'||sqlc.arg(keyword)::text||'%' OR display.display_name ILIKE '%'||sqlc.arg(keyword)::text||'%')
  AND ((sqlc.arg(merged)::boolean AND party.merged_into_party_id IS NOT NULL) OR (NOT sqlc.arg(merged)::boolean AND party.merged_into_party_id IS NULL))
ORDER BY display.display_name ASC,subject.id ASC
LIMIT sqlc.arg(row_limit) OFFSET sqlc.arg(row_offset);

-- name: ListDCLPartyVersionsByEntryIDs :many
SELECT entry.id AS approval_entry_id,entry.domain,entry.entity,entry.subject_id,entry.version_no,
       entry.status,entry.revision,entry.created_by,entry.created_at,entry.updated_by,entry.updated_at,
       entry.submitted_by,entry.submitted_at,entry.approved_by,entry.approved_at,
       version.party_id,version.kind,version.legal_name,version.display_name,version.tax_number,
       version.phone,version.email,version.address
FROM approval_entries entry
JOIN dcl_party_versions version ON version.approval_entry_id=entry.id
WHERE entry.id=ANY(sqlc.arg(approval_entry_ids)::text[])
ORDER BY entry.id;

-- name: ListDCLPartyVersionIdentifiersByEntryIDs :many
SELECT approval_entry_id,identifier_type,value,normalized_value
FROM dcl_party_version_identifiers
WHERE approval_entry_id=ANY(sqlc.arg(approval_entry_ids)::text[])
ORDER BY approval_entry_id,identifier_type,normalized_value;

-- name: CountDCLPartyAuditEvents :one
SELECT
  (SELECT count(*) FROM approval_events WHERE domain='dcl' AND entity='party' AND subject_id=sqlc.arg(party_id))
  +
  (SELECT count(*) FROM bob_party_merge_events WHERE source_party_id=sqlc.arg(party_id) OR target_party_id=sqlc.arg(party_id));

-- name: ListDCLPartyAuditEvents :many
SELECT id,entry_id,domain,entity,subject_id,version_no,action,from_status,to_status,
       from_revision,to_revision,actor_id,reason,request_id,created_at
FROM (
  SELECT event.id,event.entry_id,event.domain,event.entity,event.subject_id,event.version_no,
         event.action,event.from_status,event.to_status,event.from_revision,event.to_revision,
         event.actor_id,event.reason,event.request_id,event.created_at
  FROM approval_events event
  WHERE event.domain='dcl' AND event.entity='party' AND event.subject_id=sqlc.arg(party_id)
  UNION ALL
  SELECT merge_event.id,
         CASE WHEN merge_event.source_party_id=sqlc.arg(party_id)
              THEN preflight.source_approval_entry_id
              ELSE preflight.target_approval_entry_id END AS entry_id,
         'dcl'::character varying AS domain,'party'::character varying AS entity,
         sqlc.arg(party_id)::character varying AS subject_id,NULL::integer AS version_no,
         'MERGED'::character varying AS action,NULL::character varying AS from_status,
         NULL::character varying AS to_status,NULL::bigint AS from_revision,
         NULL::bigint AS to_revision,merge_event.actor_id,NULL::text AS reason,
         merge_event.request_id,merge_event.occurred_at AS created_at
  FROM bob_party_merge_events merge_event
  JOIN bob_party_merge_preflights preflight ON preflight.id=merge_event.preflight_id
  WHERE merge_event.source_party_id=sqlc.arg(party_id) OR merge_event.target_party_id=sqlc.arg(party_id)
) audit
ORDER BY created_at DESC,id DESC LIMIT sqlc.arg(row_limit) OFFSET sqlc.arg(row_offset);

-- name: InsertDCLOperatingEntityVersion :exec
INSERT INTO dcl_operating_entity_versions(
  approval_entry_id, legal_name, short_name, tax_number, address, phone, remark, enabled
)
VALUES(
  sqlc.arg(approval_entry_id), sqlc.arg(legal_name), sqlc.narg(short_name),
  sqlc.narg(tax_number), sqlc.narg(address), sqlc.narg(phone), sqlc.narg(remark), sqlc.arg(enabled)
);

-- name: CopyDCLOperatingEntityVersion :execrows
INSERT INTO dcl_operating_entity_versions(
  approval_entry_id, legal_name, short_name, tax_number, address, phone, remark, enabled
)
SELECT sqlc.arg(new_approval_entry_id), legal_name, short_name, tax_number, address, phone, remark, enabled
FROM dcl_operating_entity_versions
WHERE dcl_operating_entity_versions.approval_entry_id=sqlc.arg(source_approval_entry_id);

-- name: UpdateDCLOperatingEntityVersion :execrows
UPDATE dcl_operating_entity_versions
SET legal_name=sqlc.arg(legal_name), short_name=sqlc.narg(short_name),
    tax_number=sqlc.narg(tax_number), address=sqlc.narg(address),
    phone=sqlc.narg(phone), remark=sqlc.narg(remark), enabled=sqlc.arg(enabled)
WHERE approval_entry_id=sqlc.arg(approval_entry_id);

-- name: GetDCLOperatingEntityVersion :one
SELECT approval_entry_id, legal_name, short_name, tax_number, address, phone, remark, enabled
FROM dcl_operating_entity_versions
WHERE approval_entry_id=sqlc.arg(approval_entry_id);

-- name: DeleteDCLOperatingEntityVersion :execrows
DELETE FROM dcl_operating_entity_versions
WHERE approval_entry_id=sqlc.arg(approval_entry_id);

-- name: CountDCLOperatingEntities :one
SELECT count(*)
FROM dcl_subjects subject
JOIN bob_objects object ON object.id=subject.id AND object.entity=subject.entity
LEFT JOIN LATERAL (
  SELECT entry.id, entry.status, entry.version_no, entry.updated_at
  FROM approval_entries entry
  WHERE entry.domain='dcl' AND entry.entity='operating-entity' AND entry.subject_id=subject.id
    AND entry.status IN ('DRAFT','PENDING')
  ORDER BY entry.version_no DESC LIMIT 1
) candidate ON true
LEFT JOIN LATERAL (
  SELECT entry.id, entry.status, entry.version_no, entry.updated_at
  FROM approval_entries entry
  WHERE entry.domain='dcl' AND entry.entity='operating-entity' AND entry.subject_id=subject.id
    AND entry.status='APPROVED'
  ORDER BY entry.version_no DESC LIMIT 1
) approved ON true
JOIN dcl_operating_entity_versions display
  ON display.approval_entry_id=COALESCE(candidate.id, approved.id)
WHERE subject.entity='operating-entity'
  AND (sqlc.arg(keyword)::text='' OR object.code ILIKE '%'||sqlc.arg(keyword)::text||'%'
       OR display.legal_name ILIKE '%'||sqlc.arg(keyword)::text||'%')
  AND (sqlc.arg(enabled_filter)::integer=-1 OR display.enabled=(sqlc.arg(enabled_filter)::integer=1))
  AND (cardinality(sqlc.arg(status_filter)::text[])=0
       OR COALESCE(candidate.status,approved.status)=ANY(sqlc.arg(status_filter)::text[]));

-- name: ListDCLOperatingEntities :many
SELECT object.id AS object_id, object.code, object.revision AS object_revision,
       display.enabled, COALESCE(candidate.updated_at,approved.updated_at) AS updated_at,
       COALESCE(approved.id,'')::text AS approved_entry_id,
       COALESCE(candidate.id,'')::text AS open_entry_id
FROM dcl_subjects subject
JOIN bob_objects object ON object.id=subject.id AND object.entity=subject.entity
LEFT JOIN LATERAL (
  SELECT entry.id, entry.status, entry.version_no, entry.updated_at
  FROM approval_entries entry
  WHERE entry.domain='dcl' AND entry.entity='operating-entity' AND entry.subject_id=subject.id
    AND entry.status IN ('DRAFT','PENDING')
  ORDER BY entry.version_no DESC LIMIT 1
) candidate ON true
LEFT JOIN LATERAL (
  SELECT entry.id, entry.status, entry.version_no, entry.updated_at
  FROM approval_entries entry
  WHERE entry.domain='dcl' AND entry.entity='operating-entity' AND entry.subject_id=subject.id
    AND entry.status='APPROVED'
  ORDER BY entry.version_no DESC LIMIT 1
) approved ON true
JOIN dcl_operating_entity_versions display
  ON display.approval_entry_id=COALESCE(candidate.id, approved.id)
WHERE subject.entity='operating-entity'
  AND (sqlc.arg(keyword)::text='' OR object.code ILIKE '%'||sqlc.arg(keyword)::text||'%'
       OR display.legal_name ILIKE '%'||sqlc.arg(keyword)::text||'%')
  AND (sqlc.arg(enabled_filter)::integer=-1 OR display.enabled=(sqlc.arg(enabled_filter)::integer=1))
  AND (cardinality(sqlc.arg(status_filter)::text[])=0
       OR COALESCE(candidate.status,approved.status)=ANY(sqlc.arg(status_filter)::text[]))
ORDER BY
  CASE WHEN sqlc.arg(sort_field)::text='updatedAt' AND sqlc.arg(sort_order)::text='asc' THEN COALESCE(candidate.updated_at,approved.updated_at) END ASC,
  CASE WHEN sqlc.arg(sort_field)::text='updatedAt' AND sqlc.arg(sort_order)::text='desc' THEN COALESCE(candidate.updated_at,approved.updated_at) END DESC,
  CASE WHEN sqlc.arg(sort_field)::text='code' AND sqlc.arg(sort_order)::text='asc' THEN object.code END ASC,
  CASE WHEN sqlc.arg(sort_field)::text='code' AND sqlc.arg(sort_order)::text='desc' THEN object.code END DESC,
  CASE WHEN sqlc.arg(sort_field)::text='name' AND sqlc.arg(sort_order)::text='asc' THEN display.legal_name END ASC,
  CASE WHEN sqlc.arg(sort_field)::text='name' AND sqlc.arg(sort_order)::text='desc' THEN display.legal_name END DESC,
  CASE WHEN sqlc.arg(sort_field)::text='status' AND sqlc.arg(sort_order)::text='asc' THEN COALESCE(candidate.status,approved.status) END ASC,
  CASE WHEN sqlc.arg(sort_field)::text='status' AND sqlc.arg(sort_order)::text='desc' THEN COALESCE(candidate.status,approved.status) END DESC,
  CASE WHEN sqlc.arg(sort_field)::text='version' AND sqlc.arg(sort_order)::text='asc' THEN COALESCE(candidate.version_no,approved.version_no) END ASC,
  CASE WHEN sqlc.arg(sort_field)::text='version' AND sqlc.arg(sort_order)::text='desc' THEN COALESCE(candidate.version_no,approved.version_no) END DESC,
  object.id DESC
LIMIT sqlc.arg(row_limit) OFFSET sqlc.arg(row_offset);

-- name: CountDCLOperatingEntityApprovalEvents :one
SELECT count(*)
FROM approval_events
WHERE domain='dcl' AND entity='operating-entity' AND subject_id=sqlc.arg(object_id);

-- name: ListDCLOperatingEntityApprovalEvents :many
SELECT id, entry_id, domain, entity, subject_id, version_no, action, from_status, to_status,
       from_revision, to_revision, actor_id, reason, request_id, created_at
FROM approval_events
WHERE domain='dcl' AND entity='operating-entity' AND subject_id=sqlc.arg(object_id)
ORDER BY created_at DESC, id DESC
LIMIT sqlc.arg(row_limit) OFFSET sqlc.arg(row_offset);

-- Supplier keeps its Party-to-operating-entity relationship in BOB. DCL owns
-- all mutable commercial facts and the exact snapshots used by purchasing.
-- name: InsertDCLSupplierVersion :exec
INSERT INTO dcl_supplier_versions(approval_entry_id,short_name,tax_number,contact_name,contact_phone,email,address,remark,settlement_method_id,settlement_method_approval_entry_id,settlement_method_code,settlement_method_name,settlement_term_code,settlement_rule_type,settlement_month_offset,settlement_day_of_month,settlement_day_offset,default_purchaser_employee_id,default_purchaser_employee_approval_entry_id,default_purchaser_employee_code,default_purchaser_employee_name,enabled)
VALUES(sqlc.arg(approval_entry_id),sqlc.narg(short_name),sqlc.narg(tax_number),sqlc.narg(contact_name),sqlc.narg(contact_phone),sqlc.narg(email),sqlc.narg(address),sqlc.narg(remark),sqlc.narg(settlement_method_id),sqlc.narg(settlement_method_approval_entry_id),sqlc.narg(settlement_method_code),sqlc.narg(settlement_method_name),sqlc.narg(settlement_term_code),sqlc.narg(settlement_rule_type),sqlc.arg(settlement_month_offset),sqlc.arg(settlement_day_of_month),sqlc.arg(settlement_day_offset),sqlc.narg(default_purchaser_employee_id),sqlc.narg(default_purchaser_employee_approval_entry_id),sqlc.narg(default_purchaser_employee_code),sqlc.narg(default_purchaser_employee_name),sqlc.arg(enabled));

-- name: CopyDCLSupplierVersion :execrows
INSERT INTO dcl_supplier_versions(approval_entry_id,short_name,tax_number,contact_name,contact_phone,email,address,remark,settlement_method_id,settlement_method_approval_entry_id,settlement_method_code,settlement_method_name,settlement_term_code,settlement_rule_type,settlement_month_offset,settlement_day_of_month,settlement_day_offset,default_purchaser_employee_id,default_purchaser_employee_approval_entry_id,default_purchaser_employee_code,default_purchaser_employee_name,enabled)
SELECT sqlc.arg(new_approval_entry_id),source.short_name,source.tax_number,source.contact_name,source.contact_phone,source.email,source.address,source.remark,source.settlement_method_id,source.settlement_method_approval_entry_id,source.settlement_method_code,source.settlement_method_name,source.settlement_term_code,source.settlement_rule_type,source.settlement_month_offset,source.settlement_day_of_month,source.settlement_day_offset,source.default_purchaser_employee_id,source.default_purchaser_employee_approval_entry_id,source.default_purchaser_employee_code,source.default_purchaser_employee_name,source.enabled FROM dcl_supplier_versions source WHERE source.approval_entry_id=sqlc.arg(source_approval_entry_id);

-- name: UpdateDCLSupplierVersion :execrows
UPDATE dcl_supplier_versions SET short_name=sqlc.narg(short_name),tax_number=sqlc.narg(tax_number),contact_name=sqlc.narg(contact_name),contact_phone=sqlc.narg(contact_phone),email=sqlc.narg(email),address=sqlc.narg(address),remark=sqlc.narg(remark),settlement_method_id=sqlc.narg(settlement_method_id),settlement_method_approval_entry_id=sqlc.narg(settlement_method_approval_entry_id),settlement_method_code=sqlc.narg(settlement_method_code),settlement_method_name=sqlc.narg(settlement_method_name),settlement_term_code=sqlc.narg(settlement_term_code),settlement_rule_type=sqlc.narg(settlement_rule_type),settlement_month_offset=sqlc.arg(settlement_month_offset),settlement_day_of_month=sqlc.arg(settlement_day_of_month),settlement_day_offset=sqlc.arg(settlement_day_offset),default_purchaser_employee_id=sqlc.narg(default_purchaser_employee_id),default_purchaser_employee_approval_entry_id=sqlc.narg(default_purchaser_employee_approval_entry_id),default_purchaser_employee_code=sqlc.narg(default_purchaser_employee_code),default_purchaser_employee_name=sqlc.narg(default_purchaser_employee_name),enabled=sqlc.arg(enabled) WHERE approval_entry_id=sqlc.arg(approval_entry_id);

-- name: GetDCLSupplierVersion :one
SELECT snapshot.*,relationship.party_id,party.kind AS party_kind,party.display_name,relationship.operating_entity_id,operating.code AS operating_entity_code,operating_current.legal_name AS operating_entity_name
FROM dcl_supplier_versions snapshot
JOIN approval_entries entry ON entry.id=snapshot.approval_entry_id AND entry.domain='dcl' AND entry.entity='supplier'
JOIN bob_supplier_relationships relationship ON relationship.object_id=entry.subject_id
JOIN bob_party_currents party ON party.party_id=relationship.party_id
JOIN bob_objects operating ON operating.id=relationship.operating_entity_id AND operating.entity='operating-entity'
JOIN bob_operating_entities operating_current ON operating_current.object_id=operating.id
WHERE snapshot.approval_entry_id=sqlc.arg(approval_entry_id) AND relationship.merged_into_object_id IS NULL;

-- name: DeleteDCLSupplierVersion :execrows
DELETE FROM dcl_supplier_versions WHERE approval_entry_id=sqlc.arg(approval_entry_id);

-- name: CountDCLSuppliers :one
SELECT count(*) FROM dcl_subjects subject
JOIN bob_objects object ON object.id=subject.id AND object.entity='supplier'
LEFT JOIN LATERAL (SELECT id,status,version_no,updated_at FROM approval_entries WHERE domain='dcl' AND entity='supplier' AND subject_id=subject.id AND status IN ('DRAFT','PENDING') ORDER BY version_no DESC LIMIT 1) candidate ON true
LEFT JOIN LATERAL (SELECT id,status,version_no,updated_at FROM approval_entries WHERE domain='dcl' AND entity='supplier' AND subject_id=subject.id AND status='APPROVED' ORDER BY version_no DESC LIMIT 1) approved ON true
JOIN dcl_supplier_versions display ON display.approval_entry_id=COALESCE(candidate.id,approved.id)
JOIN bob_supplier_relationships relationship ON relationship.object_id=subject.id AND relationship.merged_into_object_id IS NULL
JOIN bob_party_currents party ON party.party_id=relationship.party_id
WHERE subject.entity='supplier' AND (sqlc.arg(keyword)::text='' OR object.code ILIKE '%'||sqlc.arg(keyword)::text||'%' OR party.display_name ILIKE '%'||sqlc.arg(keyword)::text||'%') AND (sqlc.arg(enabled_filter)::integer=-1 OR display.enabled=(sqlc.arg(enabled_filter)::integer=1)) AND (sqlc.arg(operating_entity_id)::text='' OR relationship.operating_entity_id=sqlc.arg(operating_entity_id)) AND (cardinality(sqlc.arg(status_filter)::text[])=0 OR COALESCE(candidate.status,approved.status)=ANY(sqlc.arg(status_filter)::text[]));

-- name: ListDCLSuppliers :many
SELECT object.id AS object_id,object.code,object.revision AS object_revision,relationship.party_id,party.kind AS party_kind,party.display_name,relationship.operating_entity_id,operating.code AS operating_entity_code,operating_current.legal_name AS operating_entity_name,display.enabled,COALESCE(candidate.updated_at,approved.updated_at) AS updated_at,COALESCE(approved.id,'')::text AS latest_approved_entry_id,COALESCE(candidate.id,'')::text AS open_entry_id
FROM dcl_subjects subject
JOIN bob_objects object ON object.id=subject.id AND object.entity='supplier'
JOIN bob_supplier_relationships relationship ON relationship.object_id=subject.id AND relationship.merged_into_object_id IS NULL
JOIN bob_party_currents party ON party.party_id=relationship.party_id
JOIN bob_objects operating ON operating.id=relationship.operating_entity_id AND operating.entity='operating-entity'
JOIN bob_operating_entities operating_current ON operating_current.object_id=operating.id
LEFT JOIN LATERAL (SELECT id,status,version_no,updated_at FROM approval_entries WHERE domain='dcl' AND entity='supplier' AND subject_id=subject.id AND status IN ('DRAFT','PENDING') ORDER BY version_no DESC LIMIT 1) candidate ON true
LEFT JOIN LATERAL (SELECT id,status,version_no,updated_at FROM approval_entries WHERE domain='dcl' AND entity='supplier' AND subject_id=subject.id AND status='APPROVED' ORDER BY version_no DESC LIMIT 1) approved ON true
JOIN dcl_supplier_versions display ON display.approval_entry_id=COALESCE(candidate.id,approved.id)
WHERE subject.entity='supplier' AND (sqlc.arg(keyword)::text='' OR object.code ILIKE '%'||sqlc.arg(keyword)::text||'%' OR party.display_name ILIKE '%'||sqlc.arg(keyword)::text||'%') AND (sqlc.arg(enabled_filter)::integer=-1 OR display.enabled=(sqlc.arg(enabled_filter)::integer=1)) AND (sqlc.arg(operating_entity_id)::text='' OR relationship.operating_entity_id=sqlc.arg(operating_entity_id)) AND (cardinality(sqlc.arg(status_filter)::text[])=0 OR COALESCE(candidate.status,approved.status)=ANY(sqlc.arg(status_filter)::text[]))
ORDER BY CASE WHEN sqlc.arg(sort_field)::text='updatedAt' AND sqlc.arg(sort_order)::text='asc' THEN COALESCE(candidate.updated_at,approved.updated_at) END ASC,CASE WHEN sqlc.arg(sort_field)::text='updatedAt' AND sqlc.arg(sort_order)::text='desc' THEN COALESCE(candidate.updated_at,approved.updated_at) END DESC,CASE WHEN sqlc.arg(sort_field)::text='code' AND sqlc.arg(sort_order)::text='asc' THEN object.code END ASC,CASE WHEN sqlc.arg(sort_field)::text='code' AND sqlc.arg(sort_order)::text='desc' THEN object.code END DESC,CASE WHEN sqlc.arg(sort_field)::text='name' AND sqlc.arg(sort_order)::text='asc' THEN party.display_name END ASC,CASE WHEN sqlc.arg(sort_field)::text='name' AND sqlc.arg(sort_order)::text='desc' THEN party.display_name END DESC,object.id DESC LIMIT sqlc.arg(row_limit) OFFSET sqlc.arg(row_offset);

-- name: CountDCLSupplierApprovalEvents :one
SELECT count(*) FROM approval_events WHERE domain='dcl' AND entity='supplier' AND subject_id=sqlc.arg(object_id);

-- name: ListDCLSupplierApprovalEvents :many
SELECT id,entry_id,domain,entity,subject_id,version_no,action,from_status,to_status,from_revision,to_revision,actor_id,reason,request_id,created_at FROM approval_events WHERE domain='dcl' AND entity='supplier' AND subject_id=sqlc.arg(object_id) ORDER BY created_at DESC,id DESC LIMIT sqlc.arg(row_limit) OFFSET sqlc.arg(row_offset);

-- Customer is the DCL-owned declaration for the immutable Party x operating
-- entity relationship.  The stable relationship continues to live in BOB;
-- only DCL versions are eligible for candidate/list/read hydration.
-- name: CountDCLCustomers :one
SELECT count(*)
FROM dcl_subjects subject
JOIN bob_objects object ON object.id=subject.id AND object.entity='customer'
JOIN bob_customer_relationships relationship ON relationship.object_id=subject.id AND relationship.merged_into_object_id IS NULL
JOIN bob_party_currents party ON party.party_id=relationship.party_id
LEFT JOIN LATERAL (
  SELECT id,status,updated_at FROM approval_entries
  WHERE domain='dcl' AND entity='customer' AND subject_id=subject.id AND status IN ('DRAFT','PENDING')
  ORDER BY version_no DESC LIMIT 1
) candidate ON true
LEFT JOIN LATERAL (
  SELECT id,status,updated_at FROM approval_entries
  WHERE domain='dcl' AND entity='customer' AND subject_id=subject.id AND status='APPROVED'
  ORDER BY version_no DESC LIMIT 1
) approved ON true
JOIN dcl_customer_versions display ON display.approval_entry_id=COALESCE(candidate.id,approved.id)
WHERE subject.entity='customer'
  AND (sqlc.arg(keyword)::text='' OR object.code ILIKE '%'||sqlc.arg(keyword)::text||'%' OR party.display_name ILIKE '%'||sqlc.arg(keyword)::text||'%')
  AND (sqlc.arg(operating_entity_id)::text='' OR relationship.operating_entity_id=sqlc.arg(operating_entity_id))
  AND (sqlc.arg(party_id)::text='' OR relationship.party_id=sqlc.arg(party_id))
  AND (sqlc.arg(enabled_filter)::integer=-1 OR display.enabled=(sqlc.arg(enabled_filter)::integer=1))
  AND (cardinality(sqlc.arg(status_filter)::text[])=0 OR COALESCE(candidate.status,approved.status)=ANY(sqlc.arg(status_filter)::text[]));

-- name: ListDCLCustomers :many
SELECT object.id AS object_id,object.code,object.revision AS object_revision,
       relationship.party_id,party.kind AS party_kind,party.display_name,
       relationship.operating_entity_id,display.operating_entity_code,display.operating_entity_name,
       display.enabled,COALESCE(candidate.updated_at,approved.updated_at) AS updated_at,
       COALESCE(approved.id,'')::text AS latest_approved_entry_id,COALESCE(candidate.id,'')::text AS open_entry_id
FROM dcl_subjects subject
JOIN bob_objects object ON object.id=subject.id AND object.entity='customer'
JOIN bob_customer_relationships relationship ON relationship.object_id=subject.id AND relationship.merged_into_object_id IS NULL
JOIN bob_party_currents party ON party.party_id=relationship.party_id
LEFT JOIN LATERAL (
  SELECT id,status,updated_at FROM approval_entries
  WHERE domain='dcl' AND entity='customer' AND subject_id=subject.id AND status IN ('DRAFT','PENDING')
  ORDER BY version_no DESC LIMIT 1
) candidate ON true
LEFT JOIN LATERAL (
  SELECT id,status,updated_at FROM approval_entries
  WHERE domain='dcl' AND entity='customer' AND subject_id=subject.id AND status='APPROVED'
  ORDER BY version_no DESC LIMIT 1
) approved ON true
JOIN dcl_customer_versions display ON display.approval_entry_id=COALESCE(candidate.id,approved.id)
WHERE subject.entity='customer'
  AND (sqlc.arg(keyword)::text='' OR object.code ILIKE '%'||sqlc.arg(keyword)::text||'%' OR party.display_name ILIKE '%'||sqlc.arg(keyword)::text||'%')
  AND (sqlc.arg(operating_entity_id)::text='' OR relationship.operating_entity_id=sqlc.arg(operating_entity_id))
  AND (sqlc.arg(party_id)::text='' OR relationship.party_id=sqlc.arg(party_id))
  AND (sqlc.arg(enabled_filter)::integer=-1 OR display.enabled=(sqlc.arg(enabled_filter)::integer=1))
  AND (cardinality(sqlc.arg(status_filter)::text[])=0 OR COALESCE(candidate.status,approved.status)=ANY(sqlc.arg(status_filter)::text[]))
ORDER BY object.code ASC,object.id ASC
LIMIT sqlc.arg(row_limit) OFFSET sqlc.arg(row_offset);

-- name: GetDCLCustomerIdentity :one
SELECT object.id AS object_id,object.code,object.revision AS object_revision,
       relationship.party_id,party.kind AS party_kind,party.display_name,relationship.operating_entity_id
FROM bob_objects object
JOIN bob_customer_relationships relationship ON relationship.object_id=object.id AND relationship.merged_into_object_id IS NULL
JOIN bob_party_currents party ON party.party_id=relationship.party_id
WHERE object.id=sqlc.arg(object_id) AND object.entity='customer';

-- name: CountDCLCustomerApprovalEvents :one
SELECT count(*) FROM approval_events WHERE domain='dcl' AND entity='customer' AND subject_id=sqlc.arg(object_id);

-- name: ListDCLCustomerApprovalEvents :many
SELECT id,entry_id,domain,entity,subject_id,version_no,action,from_status,to_status,from_revision,to_revision,actor_id,reason,request_id,created_at
FROM approval_events WHERE domain='dcl' AND entity='customer' AND subject_id=sqlc.arg(object_id)
ORDER BY created_at DESC,id DESC LIMIT sqlc.arg(row_limit) OFFSET sqlc.arg(row_offset);

-- Employee keeps Party identity in BOB's immutable employment relationship;
-- this DCL declaration stores only its versioned employment facts.
-- name: InsertDCLEmployeeVersion :exec
INSERT INTO dcl_employee_versions(
  approval_entry_id,employee_category_id,employee_category_approval_entry_id,
  employee_category_code,employee_category_name,department_id,department_approval_entry_id,
  department_code,department_name,position_id,position_approval_entry_id,position_code,
  position_name,phone,email,hire_date,remark,enabled
) VALUES(
  sqlc.arg(approval_entry_id),sqlc.narg(employee_category_id),
  sqlc.narg(employee_category_approval_entry_id),sqlc.narg(employee_category_code),
  sqlc.narg(employee_category_name),sqlc.narg(department_id),
  sqlc.narg(department_approval_entry_id),sqlc.narg(department_code),
  sqlc.narg(department_name),sqlc.narg(position_id),
  sqlc.narg(position_approval_entry_id),sqlc.narg(position_code),
  sqlc.narg(position_name),sqlc.narg(phone),sqlc.narg(email),sqlc.narg(hire_date),
  sqlc.narg(remark),sqlc.arg(enabled)
);

-- name: CopyDCLEmployeeVersion :execrows
INSERT INTO dcl_employee_versions(
  approval_entry_id,employee_category_id,employee_category_approval_entry_id,
  employee_category_code,employee_category_name,department_id,department_approval_entry_id,
  department_code,department_name,position_id,position_approval_entry_id,position_code,
  position_name,phone,email,hire_date,remark,enabled
)
SELECT sqlc.arg(new_approval_entry_id),source.employee_category_id,
  source.employee_category_approval_entry_id,source.employee_category_code,source.employee_category_name,
  source.department_id,source.department_approval_entry_id,source.department_code,source.department_name,
  source.position_id,source.position_approval_entry_id,source.position_code,source.position_name,source.phone,source.email,
  source.hire_date,source.remark,source.enabled
FROM dcl_employee_versions source
WHERE source.approval_entry_id=sqlc.arg(source_approval_entry_id);

-- name: UpdateDCLEmployeeVersion :execrows
UPDATE dcl_employee_versions SET
  employee_category_id=sqlc.narg(employee_category_id),
  employee_category_approval_entry_id=sqlc.narg(employee_category_approval_entry_id),
  employee_category_code=sqlc.narg(employee_category_code),
  employee_category_name=sqlc.narg(employee_category_name),
  department_id=sqlc.narg(department_id),
  department_approval_entry_id=sqlc.narg(department_approval_entry_id),
  department_code=sqlc.narg(department_code),department_name=sqlc.narg(department_name),
  position_id=sqlc.narg(position_id),
  position_approval_entry_id=sqlc.narg(position_approval_entry_id),
  position_code=sqlc.narg(position_code),position_name=sqlc.narg(position_name),
  phone=sqlc.narg(phone),email=sqlc.narg(email),hire_date=sqlc.narg(hire_date),
  remark=sqlc.narg(remark),enabled=sqlc.arg(enabled)
WHERE approval_entry_id=sqlc.arg(approval_entry_id);

-- name: GetDCLEmployeeVersion :one
SELECT snapshot.*,relationship.party_id,party.kind AS party_kind,
       party.display_name,relationship.operating_entity_id,
       operating.code AS operating_entity_code,
       operating_current.legal_name AS operating_entity_name
FROM dcl_employee_versions snapshot
JOIN approval_entries entry ON entry.id=snapshot.approval_entry_id
  AND entry.domain='dcl' AND entry.entity='employee'
JOIN bob_employment_relationships relationship ON relationship.object_id=entry.subject_id
JOIN LATERAL (
  SELECT payload.kind,payload.display_name
  FROM approval_entries party_entry
  JOIN dcl_party_versions payload ON payload.approval_entry_id=party_entry.id
  WHERE party_entry.domain='dcl' AND party_entry.entity='party'
    AND party_entry.subject_id=relationship.party_id
    AND party_entry.status IN ('DRAFT','PENDING','APPROVED')
  ORDER BY (party_entry.status IN ('DRAFT','PENDING')) DESC,party_entry.version_no DESC
  LIMIT 1
) party ON true
JOIN bob_objects operating ON operating.id=relationship.operating_entity_id
  AND operating.entity='operating-entity'
JOIN bob_operating_entities operating_current ON operating_current.object_id=operating.id
WHERE snapshot.approval_entry_id=sqlc.arg(approval_entry_id)
  AND relationship.merged_into_object_id IS NULL;

-- name: DeleteDCLEmployeeVersion :execrows
DELETE FROM dcl_employee_versions WHERE approval_entry_id=sqlc.arg(approval_entry_id);

-- name: InsertDCLOtherUnitVersion :exec
INSERT INTO dcl_other_unit_versions(approval_entry_id,contact_name,contact_phone,email,address,settlement_method_id,settlement_method_approval_entry_id,settlement_method_code,settlement_method_name,settlement_term_code,settlement_rule_type,settlement_month_offset,settlement_day_of_month,settlement_day_offset,remark,enabled)
VALUES(sqlc.arg(approval_entry_id),sqlc.narg(contact_name),sqlc.narg(contact_phone),sqlc.narg(email),sqlc.narg(address),sqlc.narg(settlement_method_id),sqlc.narg(settlement_method_approval_entry_id),sqlc.narg(settlement_method_code),sqlc.narg(settlement_method_name),sqlc.narg(settlement_term_code),sqlc.narg(settlement_rule_type),sqlc.arg(settlement_month_offset),sqlc.arg(settlement_day_of_month),sqlc.arg(settlement_day_offset),sqlc.narg(remark),sqlc.arg(enabled));
-- name: CopyDCLOtherUnitVersion :execrows
INSERT INTO dcl_other_unit_versions(approval_entry_id,contact_name,contact_phone,email,address,settlement_method_id,settlement_method_approval_entry_id,settlement_method_code,settlement_method_name,settlement_term_code,settlement_rule_type,settlement_month_offset,settlement_day_of_month,settlement_day_offset,remark,enabled)
SELECT sqlc.arg(new_approval_entry_id),source.contact_name,source.contact_phone,source.email,source.address,source.settlement_method_id,source.settlement_method_approval_entry_id,source.settlement_method_code,source.settlement_method_name,source.settlement_term_code,source.settlement_rule_type,source.settlement_month_offset,source.settlement_day_of_month,source.settlement_day_offset,source.remark,source.enabled FROM dcl_other_unit_versions source WHERE source.approval_entry_id=sqlc.arg(source_approval_entry_id);
-- name: UpdateDCLOtherUnitVersion :execrows
UPDATE dcl_other_unit_versions SET contact_name=sqlc.narg(contact_name),contact_phone=sqlc.narg(contact_phone),email=sqlc.narg(email),address=sqlc.narg(address),settlement_method_id=sqlc.narg(settlement_method_id),settlement_method_approval_entry_id=sqlc.narg(settlement_method_approval_entry_id),settlement_method_code=sqlc.narg(settlement_method_code),settlement_method_name=sqlc.narg(settlement_method_name),settlement_term_code=sqlc.narg(settlement_term_code),settlement_rule_type=sqlc.narg(settlement_rule_type),settlement_month_offset=sqlc.arg(settlement_month_offset),settlement_day_of_month=sqlc.arg(settlement_day_of_month),settlement_day_offset=sqlc.arg(settlement_day_offset),remark=sqlc.narg(remark),enabled=sqlc.arg(enabled) WHERE approval_entry_id=sqlc.arg(approval_entry_id);
-- name: GetDCLOtherUnitVersion :one
SELECT * FROM dcl_other_unit_versions WHERE approval_entry_id=sqlc.arg(approval_entry_id);
-- name: DeleteDCLOtherUnitVersion :execrows
DELETE FROM dcl_other_unit_versions WHERE approval_entry_id=sqlc.arg(approval_entry_id);

-- name: InsertDCLSalesPartnerVersion :exec
INSERT INTO dcl_sales_partner_versions(approval_entry_id,capabilities,contact_name,contact_phone,email,address,remark,enabled)
VALUES(sqlc.arg(approval_entry_id),sqlc.arg(capabilities),sqlc.narg(contact_name),sqlc.narg(contact_phone),sqlc.narg(email),sqlc.narg(address),sqlc.narg(remark),sqlc.arg(enabled));
-- name: CopyDCLSalesPartnerVersion :execrows
INSERT INTO dcl_sales_partner_versions(approval_entry_id,capabilities,contact_name,contact_phone,email,address,remark,enabled)
SELECT sqlc.arg(new_approval_entry_id),source.capabilities,source.contact_name,source.contact_phone,source.email,source.address,source.remark,source.enabled FROM dcl_sales_partner_versions source WHERE source.approval_entry_id=sqlc.arg(source_approval_entry_id);
-- name: UpdateDCLSalesPartnerVersion :execrows
UPDATE dcl_sales_partner_versions SET capabilities=sqlc.arg(capabilities),contact_name=sqlc.narg(contact_name),contact_phone=sqlc.narg(contact_phone),email=sqlc.narg(email),address=sqlc.narg(address),remark=sqlc.narg(remark),enabled=sqlc.arg(enabled) WHERE approval_entry_id=sqlc.arg(approval_entry_id);
-- name: GetDCLSalesPartnerVersion :one
SELECT * FROM dcl_sales_partner_versions WHERE approval_entry_id=sqlc.arg(approval_entry_id);
-- name: DeleteDCLSalesPartnerVersion :execrows
DELETE FROM dcl_sales_partner_versions WHERE approval_entry_id=sqlc.arg(approval_entry_id);

-- name: CountDCLRelationships :one
WITH selected AS (
 SELECT subject.id FROM dcl_subjects subject JOIN bob_objects object ON object.id=subject.id AND object.entity=subject.entity
 LEFT JOIN LATERAL (SELECT id,status,updated_at FROM approval_entries WHERE domain='dcl' AND entity=subject.entity AND subject_id=subject.id AND status IN ('DRAFT','PENDING') ORDER BY version_no DESC LIMIT 1) candidate ON true
 LEFT JOIN LATERAL (SELECT id,status,updated_at FROM approval_entries WHERE domain='dcl' AND entity=subject.entity AND subject_id=subject.id AND status='APPROVED' ORDER BY version_no DESC LIMIT 1) approved ON true
 LEFT JOIN bob_service_relationships other_relation ON subject.entity='other-unit' AND other_relation.object_id=subject.id AND other_relation.merged_into_object_id IS NULL
 LEFT JOIN bob_sales_relationships sales_relation ON subject.entity='sales-partner' AND sales_relation.object_id=subject.id AND sales_relation.merged_into_object_id IS NULL
 JOIN bob_party_currents party ON party.party_id=COALESCE(other_relation.party_id,sales_relation.party_id)
 LEFT JOIN dcl_other_unit_versions other_snapshot ON subject.entity='other-unit' AND other_snapshot.approval_entry_id=COALESCE(candidate.id,approved.id)
 LEFT JOIN dcl_sales_partner_versions sales_snapshot ON subject.entity='sales-partner' AND sales_snapshot.approval_entry_id=COALESCE(candidate.id,approved.id)
 WHERE subject.entity=sqlc.arg(entity) AND (sqlc.arg(keyword)::text='' OR object.code ILIKE '%'||sqlc.arg(keyword)::text||'%' OR party.display_name ILIKE '%'||sqlc.arg(keyword)::text||'%')
 AND (sqlc.arg(enabled_filter)::integer=-1 OR COALESCE(other_snapshot.enabled,sales_snapshot.enabled)=(sqlc.arg(enabled_filter)::integer=1))
 AND (cardinality(sqlc.arg(status_filter)::text[])=0 OR COALESCE(candidate.status,approved.status)=ANY(sqlc.arg(status_filter)::text[]))
) SELECT count(*) FROM selected;

-- name: ListDCLRelationships :many
SELECT subject.id AS object_id,object.code,object.revision AS object_revision,party.party_id,party.kind AS party_kind,party.display_name,
 COALESCE(other_relation.operating_entity_id,sales_relation.operating_entity_id) AS operating_entity_id,
 COALESCE(other_snapshot.enabled,sales_snapshot.enabled) AS enabled,COALESCE(candidate.updated_at,approved.updated_at) AS updated_at,
 COALESCE(approved.id,'')::text AS approved_entry_id,COALESCE(candidate.id,'')::text AS open_entry_id
FROM dcl_subjects subject JOIN bob_objects object ON object.id=subject.id AND object.entity=subject.entity
LEFT JOIN LATERAL (SELECT id,status,version_no,updated_at FROM approval_entries WHERE domain='dcl' AND entity=subject.entity AND subject_id=subject.id AND status IN ('DRAFT','PENDING') ORDER BY version_no DESC LIMIT 1) candidate ON true
LEFT JOIN LATERAL (SELECT id,status,version_no,updated_at FROM approval_entries WHERE domain='dcl' AND entity=subject.entity AND subject_id=subject.id AND status='APPROVED' ORDER BY version_no DESC LIMIT 1) approved ON true
LEFT JOIN bob_service_relationships other_relation ON subject.entity='other-unit' AND other_relation.object_id=subject.id AND other_relation.merged_into_object_id IS NULL
LEFT JOIN bob_sales_relationships sales_relation ON subject.entity='sales-partner' AND sales_relation.object_id=subject.id AND sales_relation.merged_into_object_id IS NULL
JOIN bob_party_currents party ON party.party_id=COALESCE(other_relation.party_id,sales_relation.party_id)
LEFT JOIN dcl_other_unit_versions other_snapshot ON subject.entity='other-unit' AND other_snapshot.approval_entry_id=COALESCE(candidate.id,approved.id)
LEFT JOIN dcl_sales_partner_versions sales_snapshot ON subject.entity='sales-partner' AND sales_snapshot.approval_entry_id=COALESCE(candidate.id,approved.id)
WHERE subject.entity=sqlc.arg(entity) AND (sqlc.arg(keyword)::text='' OR object.code ILIKE '%'||sqlc.arg(keyword)::text||'%' OR party.display_name ILIKE '%'||sqlc.arg(keyword)::text||'%')
 AND (sqlc.arg(enabled_filter)::integer=-1 OR COALESCE(other_snapshot.enabled,sales_snapshot.enabled)=(sqlc.arg(enabled_filter)::integer=1))
 AND (cardinality(sqlc.arg(status_filter)::text[])=0 OR COALESCE(candidate.status,approved.status)=ANY(sqlc.arg(status_filter)::text[]))
ORDER BY COALESCE(candidate.updated_at,approved.updated_at) DESC,object.id DESC LIMIT sqlc.arg(row_limit) OFFSET sqlc.arg(row_offset);

-- name: CountDCLRelationshipApprovalEvents :one
SELECT count(*) FROM approval_events WHERE domain='dcl' AND entity=sqlc.arg(entity) AND subject_id=sqlc.arg(object_id);
-- name: ListDCLRelationshipApprovalEvents :many
SELECT id,entry_id,domain,entity,subject_id,version_no,action,from_status,to_status,from_revision,to_revision,actor_id,reason,request_id,created_at
FROM approval_events WHERE domain='dcl' AND entity=sqlc.arg(entity) AND subject_id=sqlc.arg(object_id)
ORDER BY created_at DESC,id DESC LIMIT sqlc.arg(row_limit) OFFSET sqlc.arg(row_offset);

-- name: GetLatestApprovedDCLEmployeeVersionExcluding :one
SELECT id,domain,entity,subject_id,version_no,status,revision,created_by,created_at,
       updated_by,updated_at,submitted_by,submitted_at,approved_by,approved_at
FROM approval_entries
WHERE domain='dcl' AND entity='employee' AND subject_id=sqlc.arg(object_id)
  AND status='APPROVED' AND id<>sqlc.arg(excluded_approval_entry_id)
ORDER BY version_no DESC
LIMIT 1;

-- name: CountDCLEmployees :one
SELECT count(*)
FROM dcl_subjects subject
JOIN bob_objects object ON object.id=subject.id AND object.entity='employee'
JOIN bob_employment_relationships relationship ON relationship.object_id=subject.id
JOIN LATERAL (
  SELECT payload.kind,payload.display_name
  FROM approval_entries party_entry
  JOIN dcl_party_versions payload ON payload.approval_entry_id=party_entry.id
  WHERE party_entry.domain='dcl' AND party_entry.entity='party'
    AND party_entry.subject_id=relationship.party_id
    AND party_entry.status IN ('DRAFT','PENDING','APPROVED')
  ORDER BY (party_entry.status IN ('DRAFT','PENDING')) DESC,party_entry.version_no DESC
  LIMIT 1
) party ON true
JOIN bob_objects operating ON operating.id=relationship.operating_entity_id
  AND operating.entity='operating-entity'
JOIN bob_operating_entities operating_current ON operating_current.object_id=operating.id
LEFT JOIN LATERAL (
  SELECT id,status,version_no,updated_at FROM approval_entries
  WHERE domain='dcl' AND entity='employee' AND subject_id=subject.id
    AND status IN ('DRAFT','PENDING') ORDER BY version_no DESC LIMIT 1
) candidate ON true
LEFT JOIN LATERAL (
  SELECT id,status,version_no,updated_at FROM approval_entries
  WHERE domain='dcl' AND entity='employee' AND subject_id=subject.id
    AND status='APPROVED' ORDER BY version_no DESC LIMIT 1
) approved ON true
JOIN dcl_employee_versions display ON display.approval_entry_id=COALESCE(candidate.id,approved.id)
WHERE subject.entity='employee' AND relationship.merged_into_object_id IS NULL
  AND (sqlc.arg(keyword)::text='' OR object.code ILIKE '%'||sqlc.arg(keyword)::text||'%' OR party.display_name ILIKE '%'||sqlc.arg(keyword)::text||'%')
  AND (sqlc.arg(enabled_filter)::integer=-1 OR display.enabled=(sqlc.arg(enabled_filter)::integer=1))
  AND (sqlc.arg(operating_entity_id)::text='' OR relationship.operating_entity_id=sqlc.arg(operating_entity_id)::text)
  AND (sqlc.arg(employee_category_id)::text='' OR display.employee_category_id=sqlc.arg(employee_category_id)::text)
  AND (sqlc.arg(department_id)::text='' OR display.department_id=sqlc.arg(department_id)::text)
  AND (sqlc.arg(position_id)::text='' OR display.position_id=sqlc.arg(position_id)::text)
  AND (cardinality(sqlc.arg(status_filter)::text[])=0 OR COALESCE(candidate.status,approved.status)=ANY(sqlc.arg(status_filter)::text[]));

-- name: ListDCLEmployees :many
SELECT object.id AS object_id,object.code,object.revision AS object_revision,
       relationship.party_id,party.kind AS party_kind,party.display_name,
       relationship.operating_entity_id,operating.code AS operating_entity_code,
       operating_current.legal_name AS operating_entity_name,display.enabled,
       COALESCE(approved.id,'')::text AS latest_approved_entry_id,
       COALESCE(candidate.id,'')::text AS open_entry_id,
       COALESCE(candidate.status,approved.status)::text AS display_status,
       COALESCE(candidate.version_no,approved.version_no) AS display_version_no,
       COALESCE(candidate.updated_at,approved.updated_at) AS updated_at
FROM dcl_subjects subject
JOIN bob_objects object ON object.id=subject.id AND object.entity='employee'
JOIN bob_employment_relationships relationship ON relationship.object_id=subject.id
JOIN LATERAL (
  SELECT payload.kind,payload.display_name
  FROM approval_entries party_entry
  JOIN dcl_party_versions payload ON payload.approval_entry_id=party_entry.id
  WHERE party_entry.domain='dcl' AND party_entry.entity='party'
    AND party_entry.subject_id=relationship.party_id
    AND party_entry.status IN ('DRAFT','PENDING','APPROVED')
  ORDER BY (party_entry.status IN ('DRAFT','PENDING')) DESC,party_entry.version_no DESC
  LIMIT 1
) party ON true
JOIN bob_objects operating ON operating.id=relationship.operating_entity_id
  AND operating.entity='operating-entity'
JOIN bob_operating_entities operating_current ON operating_current.object_id=operating.id
LEFT JOIN LATERAL (
  SELECT id,status,version_no,updated_at FROM approval_entries
  WHERE domain='dcl' AND entity='employee' AND subject_id=subject.id
    AND status IN ('DRAFT','PENDING') ORDER BY version_no DESC LIMIT 1
) candidate ON true
LEFT JOIN LATERAL (
  SELECT id,status,version_no,updated_at FROM approval_entries
  WHERE domain='dcl' AND entity='employee' AND subject_id=subject.id
    AND status='APPROVED' ORDER BY version_no DESC LIMIT 1
) approved ON true
JOIN dcl_employee_versions display ON display.approval_entry_id=COALESCE(candidate.id,approved.id)
WHERE subject.entity='employee' AND relationship.merged_into_object_id IS NULL
  AND (sqlc.arg(keyword)::text='' OR object.code ILIKE '%'||sqlc.arg(keyword)::text||'%' OR party.display_name ILIKE '%'||sqlc.arg(keyword)::text||'%')
  AND (sqlc.arg(enabled_filter)::integer=-1 OR display.enabled=(sqlc.arg(enabled_filter)::integer=1))
  AND (sqlc.arg(operating_entity_id)::text='' OR relationship.operating_entity_id=sqlc.arg(operating_entity_id)::text)
  AND (sqlc.arg(employee_category_id)::text='' OR display.employee_category_id=sqlc.arg(employee_category_id)::text)
  AND (sqlc.arg(department_id)::text='' OR display.department_id=sqlc.arg(department_id)::text)
  AND (sqlc.arg(position_id)::text='' OR display.position_id=sqlc.arg(position_id)::text)
  AND (cardinality(sqlc.arg(status_filter)::text[])=0 OR COALESCE(candidate.status,approved.status)=ANY(sqlc.arg(status_filter)::text[]))
ORDER BY CASE WHEN sqlc.arg(sort_field)::text='updatedAt' AND sqlc.arg(sort_order)::text='asc' THEN COALESCE(candidate.updated_at,approved.updated_at) END ASC,
  CASE WHEN sqlc.arg(sort_field)::text='updatedAt' AND sqlc.arg(sort_order)::text='desc' THEN COALESCE(candidate.updated_at,approved.updated_at) END DESC,
  CASE WHEN sqlc.arg(sort_field)::text='code' AND sqlc.arg(sort_order)::text='asc' THEN object.code END ASC,
  CASE WHEN sqlc.arg(sort_field)::text='code' AND sqlc.arg(sort_order)::text='desc' THEN object.code END DESC,
  CASE WHEN sqlc.arg(sort_field)::text='name' AND sqlc.arg(sort_order)::text='asc' THEN party.display_name END ASC,
  CASE WHEN sqlc.arg(sort_field)::text='name' AND sqlc.arg(sort_order)::text='desc' THEN party.display_name END DESC,
  object.id DESC
LIMIT sqlc.arg(row_limit) OFFSET sqlc.arg(row_offset);

-- name: CountDCLEmployeeApprovalEvents :one
SELECT count(*) FROM approval_events
WHERE domain='dcl' AND entity='employee' AND subject_id=sqlc.arg(object_id);

-- name: ListDCLEmployeeApprovalEvents :many
SELECT id,entry_id,domain,entity,subject_id,version_no,action,from_status,to_status,
       from_revision,to_revision,actor_id,reason,request_id,created_at
FROM approval_events
WHERE domain='dcl' AND entity='employee' AND subject_id=sqlc.arg(object_id)
ORDER BY created_at DESC,id DESC
LIMIT sqlc.arg(row_limit) OFFSET sqlc.arg(row_offset);

-- Warehouse is a DCL-owned declaration with a BOB current projection. Category
-- columns are retained only to preserve pre-cutover snapshots and are never
-- supplied by the Warehouse declaration API.
-- name: InsertDCLWarehouseVersion :exec
INSERT INTO dcl_warehouse_versions(
  approval_entry_id,name,address,contact_name,contact_phone,manager_employee_id,
  manager_employee_approval_entry_id,remark,enabled
) VALUES(
  sqlc.arg(approval_entry_id),sqlc.arg(name),sqlc.narg(address),sqlc.narg(contact_name),
  sqlc.narg(contact_phone),sqlc.narg(manager_employee_id),
  sqlc.narg(manager_employee_approval_entry_id),sqlc.narg(remark),sqlc.arg(enabled)
);

-- name: CopyDCLWarehouseVersion :execrows
INSERT INTO dcl_warehouse_versions(
  approval_entry_id,category_id,category_approval_entry_id,category_entity,name,address,
  contact_name,contact_phone,manager_employee_id,manager_employee_approval_entry_id,
  manager_employee_entity,remark,enabled
)
SELECT sqlc.arg(new_approval_entry_id),category_id,category_approval_entry_id,category_entity,
  name,address,contact_name,contact_phone,manager_employee_id,manager_employee_approval_entry_id,
  manager_employee_entity,remark,enabled
FROM dcl_warehouse_versions WHERE dcl_warehouse_versions.approval_entry_id=sqlc.arg(source_approval_entry_id);

-- name: UpdateDCLWarehouseVersion :execrows
UPDATE dcl_warehouse_versions SET
  name=sqlc.arg(name),address=sqlc.narg(address),contact_name=sqlc.narg(contact_name),
  contact_phone=sqlc.narg(contact_phone),manager_employee_id=sqlc.narg(manager_employee_id),
  manager_employee_approval_entry_id=sqlc.narg(manager_employee_approval_entry_id),
  remark=sqlc.narg(remark),enabled=sqlc.arg(enabled)
WHERE approval_entry_id=sqlc.arg(approval_entry_id);

-- name: GetDCLWarehouseVersion :one
SELECT * FROM dcl_warehouse_versions WHERE approval_entry_id=sqlc.arg(approval_entry_id);

-- name: GetLatestApprovedDCLWarehouseVersionExcluding :one
SELECT id,domain,entity,subject_id,version_no,status,revision,created_by,created_at,
       updated_by,updated_at,submitted_by,submitted_at,approved_by,approved_at
FROM approval_entries
WHERE domain='dcl' AND entity='warehouse' AND subject_id=sqlc.arg(object_id)
  AND status='APPROVED' AND id<>sqlc.arg(excluded_approval_entry_id)
ORDER BY version_no DESC
LIMIT 1;

-- name: DeleteDCLWarehouseVersion :execrows
DELETE FROM dcl_warehouse_versions WHERE approval_entry_id=sqlc.arg(approval_entry_id);

-- name: CountDCLWarehouses :one
SELECT count(*) FROM dcl_subjects subject
JOIN bob_objects object ON object.id=subject.id AND object.entity=subject.entity
LEFT JOIN LATERAL (SELECT id,status,version_no,updated_at FROM approval_entries
 WHERE domain='dcl' AND entity='warehouse' AND subject_id=subject.id AND status IN ('DRAFT','PENDING')
 ORDER BY version_no DESC LIMIT 1) candidate ON true
LEFT JOIN LATERAL (SELECT id,status,version_no,updated_at FROM approval_entries
 WHERE domain='dcl' AND entity='warehouse' AND subject_id=subject.id AND status='APPROVED'
 ORDER BY version_no DESC LIMIT 1) approved ON true
JOIN dcl_warehouse_versions display ON display.approval_entry_id=COALESCE(candidate.id,approved.id)
WHERE subject.entity='warehouse'
 AND (sqlc.arg(keyword)::text='' OR object.code ILIKE '%'||sqlc.arg(keyword)::text||'%' OR display.name ILIKE '%'||sqlc.arg(keyword)::text||'%')
 AND (sqlc.arg(enabled_filter)::integer=-1 OR display.enabled=(sqlc.arg(enabled_filter)::integer=1))
 AND (cardinality(sqlc.arg(status_filter)::text[])=0 OR COALESCE(candidate.status,approved.status)=ANY(sqlc.arg(status_filter)::text[]));

-- name: ListDCLWarehouses :many
SELECT object.id AS object_id,object.code,object.revision AS object_revision,display.enabled,
 COALESCE(candidate.updated_at,approved.updated_at) AS updated_at,
 COALESCE(approved.id,'')::text AS approved_entry_id,COALESCE(candidate.id,'')::text AS open_entry_id
FROM dcl_subjects subject
JOIN bob_objects object ON object.id=subject.id AND object.entity=subject.entity
LEFT JOIN LATERAL (SELECT id,status,version_no,updated_at FROM approval_entries
 WHERE domain='dcl' AND entity='warehouse' AND subject_id=subject.id AND status IN ('DRAFT','PENDING')
 ORDER BY version_no DESC LIMIT 1) candidate ON true
LEFT JOIN LATERAL (SELECT id,status,version_no,updated_at FROM approval_entries
 WHERE domain='dcl' AND entity='warehouse' AND subject_id=subject.id AND status='APPROVED'
 ORDER BY version_no DESC LIMIT 1) approved ON true
JOIN dcl_warehouse_versions display ON display.approval_entry_id=COALESCE(candidate.id,approved.id)
WHERE subject.entity='warehouse'
 AND (sqlc.arg(keyword)::text='' OR object.code ILIKE '%'||sqlc.arg(keyword)::text||'%' OR display.name ILIKE '%'||sqlc.arg(keyword)::text||'%')
 AND (sqlc.arg(enabled_filter)::integer=-1 OR display.enabled=(sqlc.arg(enabled_filter)::integer=1))
 AND (cardinality(sqlc.arg(status_filter)::text[])=0 OR COALESCE(candidate.status,approved.status)=ANY(sqlc.arg(status_filter)::text[]))
ORDER BY
 CASE WHEN sqlc.arg(sort_field)::text='updatedAt' AND sqlc.arg(sort_order)::text='asc' THEN COALESCE(candidate.updated_at,approved.updated_at) END ASC,
 CASE WHEN sqlc.arg(sort_field)::text='updatedAt' AND sqlc.arg(sort_order)::text='desc' THEN COALESCE(candidate.updated_at,approved.updated_at) END DESC,
 CASE WHEN sqlc.arg(sort_field)::text='code' AND sqlc.arg(sort_order)::text='asc' THEN object.code END ASC,
 CASE WHEN sqlc.arg(sort_field)::text='code' AND sqlc.arg(sort_order)::text='desc' THEN object.code END DESC,
 CASE WHEN sqlc.arg(sort_field)::text='name' AND sqlc.arg(sort_order)::text='asc' THEN display.name END ASC,
 CASE WHEN sqlc.arg(sort_field)::text='name' AND sqlc.arg(sort_order)::text='desc' THEN display.name END DESC,
 CASE WHEN sqlc.arg(sort_field)::text='status' AND sqlc.arg(sort_order)::text='asc' THEN COALESCE(candidate.status,approved.status) END ASC,
 CASE WHEN sqlc.arg(sort_field)::text='status' AND sqlc.arg(sort_order)::text='desc' THEN COALESCE(candidate.status,approved.status) END DESC,
 CASE WHEN sqlc.arg(sort_field)::text='version' AND sqlc.arg(sort_order)::text='asc' THEN COALESCE(candidate.version_no,approved.version_no) END ASC,
 CASE WHEN sqlc.arg(sort_field)::text='version' AND sqlc.arg(sort_order)::text='desc' THEN COALESCE(candidate.version_no,approved.version_no) END DESC,
 object.id DESC LIMIT sqlc.arg(row_limit) OFFSET sqlc.arg(row_offset);

-- name: CountDCLWarehouseApprovalEvents :one
SELECT count(*) FROM approval_events WHERE domain='dcl' AND entity='warehouse' AND subject_id=sqlc.arg(object_id);

-- name: ListDCLWarehouseApprovalEvents :many
SELECT id,entry_id,domain,entity,subject_id,version_no,action,from_status,to_status,from_revision,to_revision,actor_id,reason,request_id,created_at
FROM approval_events WHERE domain='dcl' AND entity='warehouse' AND subject_id=sqlc.arg(object_id)
ORDER BY created_at DESC,id DESC LIMIT sqlc.arg(row_limit) OFFSET sqlc.arg(row_offset);

-- name: InsertDCLVehicleVersion :exec
INSERT INTO dcl_vehicle_versions(approval_entry_id,name,plate_number,vehicle_type,vehicle_type_object_id,vehicle_type_approval_entry_id,vehicle_type_name,vin,engine_number,load_capacity_kg,remark,carrier_affiliation_type,carrier_operating_entity_id,carrier_operating_entity_approval_entry_id,carrier_service_relationship_object_id,carrier_service_relationship_approval_entry_id,bulk_liquid_capable,enabled)
VALUES(sqlc.arg(approval_entry_id),sqlc.arg(name),sqlc.arg(plate_number),sqlc.arg(vehicle_type),sqlc.arg(vehicle_type_object_id),sqlc.arg(vehicle_type_approval_entry_id),sqlc.arg(vehicle_type_name),sqlc.narg(vin),sqlc.narg(engine_number),sqlc.narg(load_capacity_kg),sqlc.narg(remark),sqlc.arg(carrier_affiliation_type),sqlc.narg(carrier_operating_entity_id),sqlc.narg(carrier_operating_entity_approval_entry_id),sqlc.narg(carrier_service_relationship_object_id),sqlc.narg(carrier_service_relationship_approval_entry_id),sqlc.arg(bulk_liquid_capable),sqlc.arg(enabled));
-- name: CopyDCLVehicleVersion :execrows
INSERT INTO dcl_vehicle_versions(approval_entry_id,entity,name,plate_number,vehicle_type,vehicle_type_object_id,vehicle_type_approval_entry_id,vehicle_type_name,vehicle_type_entity,vin,engine_number,load_capacity_kg,remark,carrier_affiliation_type,carrier_operating_entity_id,carrier_operating_entity_approval_entry_id,carrier_operating_entity,carrier_service_relationship_object_id,carrier_service_relationship_approval_entry_id,carrier_service_relationship_entity,bulk_liquid_capable,enabled)
SELECT sqlc.arg(new_approval_entry_id),source.entity,source.name,source.plate_number,source.vehicle_type,source.vehicle_type_object_id,source.vehicle_type_approval_entry_id,source.vehicle_type_name,source.vehicle_type_entity,source.vin,source.engine_number,source.load_capacity_kg,source.remark,source.carrier_affiliation_type,source.carrier_operating_entity_id,source.carrier_operating_entity_approval_entry_id,source.carrier_operating_entity,source.carrier_service_relationship_object_id,source.carrier_service_relationship_approval_entry_id,source.carrier_service_relationship_entity,source.bulk_liquid_capable,source.enabled FROM dcl_vehicle_versions source WHERE source.approval_entry_id=sqlc.arg(source_approval_entry_id);
-- name: UpdateDCLVehicleVersion :execrows
UPDATE dcl_vehicle_versions SET name=sqlc.arg(name),plate_number=sqlc.arg(plate_number),vehicle_type=sqlc.arg(vehicle_type),vehicle_type_object_id=sqlc.arg(vehicle_type_object_id),vehicle_type_approval_entry_id=sqlc.arg(vehicle_type_approval_entry_id),vehicle_type_name=sqlc.arg(vehicle_type_name),vin=sqlc.narg(vin),engine_number=sqlc.narg(engine_number),load_capacity_kg=sqlc.narg(load_capacity_kg),remark=sqlc.narg(remark),carrier_affiliation_type=sqlc.arg(carrier_affiliation_type),carrier_operating_entity_id=sqlc.narg(carrier_operating_entity_id),carrier_operating_entity_approval_entry_id=sqlc.narg(carrier_operating_entity_approval_entry_id),carrier_service_relationship_object_id=sqlc.narg(carrier_service_relationship_object_id),carrier_service_relationship_approval_entry_id=sqlc.narg(carrier_service_relationship_approval_entry_id),bulk_liquid_capable=sqlc.arg(bulk_liquid_capable),enabled=sqlc.arg(enabled) WHERE approval_entry_id=sqlc.arg(approval_entry_id);
-- name: GetDCLVehicleVersion :one
SELECT * FROM dcl_vehicle_versions WHERE approval_entry_id=sqlc.arg(approval_entry_id);

-- name: LockDCLVehicleIdentifierClaims :exec
SELECT pg_advisory_xact_lock(74155002);

-- name: FindDCLVehicleIdentifierConflict :one
WITH selected_entries AS (
  SELECT id,status FROM approval_entries
  WHERE domain='dcl' AND entity='vehicle' AND subject_id=sqlc.arg(object_id) AND status IN ('DRAFT','PENDING')
  UNION ALL
  (SELECT id,status FROM approval_entries
   WHERE domain='dcl' AND entity='vehicle' AND subject_id=sqlc.arg(object_id) AND status='APPROVED'
   ORDER BY version_no DESC LIMIT 1)
), selected_versions AS (
  SELECT version.* FROM selected_entries entry
  JOIN dcl_vehicle_versions version ON version.approval_entry_id=entry.id
), desired AS (
  SELECT 'PLATE'::text AS identifier_kind,upper(btrim(plate_number)) AS normalized_value FROM selected_versions
  UNION ALL
  SELECT 'VIN'::text AS identifier_kind,upper(btrim(vin)) AS normalized_value FROM selected_versions WHERE vin IS NOT NULL
)
SELECT desired.identifier_kind,desired.normalized_value
FROM desired JOIN dcl_vehicle_identifier_claims claim
  ON claim.identifier_kind=desired.identifier_kind AND claim.normalized_value=desired.normalized_value
WHERE claim.object_id<>sqlc.arg(object_id)
ORDER BY desired.identifier_kind LIMIT 1;

-- name: DeleteDCLVehicleIdentifierClaims :exec
DELETE FROM dcl_vehicle_identifier_claims WHERE object_id=sqlc.arg(object_id);

-- name: RebuildDCLVehicleIdentifierClaims :exec
WITH selected_entries AS (
  SELECT id,status FROM approval_entries
  WHERE domain='dcl' AND entity='vehicle' AND subject_id=sqlc.arg(object_id) AND status IN ('DRAFT','PENDING')
  UNION ALL
  (SELECT id,status FROM approval_entries
   WHERE domain='dcl' AND entity='vehicle' AND subject_id=sqlc.arg(object_id) AND status='APPROVED'
   ORDER BY version_no DESC LIMIT 1)
), selected_versions AS (
  SELECT version.*,entry.id AS selected_entry_id,entry.status AS selected_status
  FROM selected_entries entry
  JOIN dcl_vehicle_versions version ON version.approval_entry_id=entry.id
), identifiers AS (
  SELECT 'PLATE'::text AS identifier_kind,upper(btrim(plate_number)) AS normalized_value,selected_entry_id,selected_status FROM selected_versions
  UNION ALL
  SELECT 'VIN'::text AS identifier_kind,upper(btrim(vin)) AS normalized_value,selected_entry_id,selected_status FROM selected_versions WHERE vin IS NOT NULL
), desired AS (
  SELECT identifier_kind,normalized_value,
    max(selected_entry_id) FILTER (WHERE selected_status='APPROVED') AS approved_entry_id,
    max(selected_entry_id) FILTER (WHERE selected_status IN ('DRAFT','PENDING')) AS open_entry_id
  FROM identifiers GROUP BY identifier_kind,normalized_value
)
INSERT INTO dcl_vehicle_identifier_claims(identifier_kind,normalized_value,object_id,approved_entry_id,open_entry_id)
SELECT identifier_kind,normalized_value,sqlc.arg(object_id),approved_entry_id,open_entry_id FROM desired;
-- name: DeleteDCLVehicleVersion :execrows
DELETE FROM dcl_vehicle_versions WHERE approval_entry_id=sqlc.arg(approval_entry_id);
-- name: GetLatestApprovedDCLVehicleVersionExcluding :one
SELECT id,domain,entity,subject_id,version_no,status,revision,created_by,created_at,updated_by,updated_at,submitted_by,submitted_at,approved_by,approved_at FROM approval_entries WHERE domain='dcl' AND entity='vehicle' AND subject_id=sqlc.arg(object_id) AND status='APPROVED' AND id<>sqlc.arg(excluded_approval_entry_id) ORDER BY version_no DESC LIMIT 1;
-- name: CountDCLVehicles :one
SELECT count(*) FROM dcl_subjects subject JOIN bob_objects object ON object.id=subject.id AND object.entity=subject.entity LEFT JOIN LATERAL (SELECT id,status,version_no,updated_at FROM approval_entries WHERE domain='dcl' AND entity='vehicle' AND subject_id=subject.id AND status IN ('DRAFT','PENDING') ORDER BY version_no DESC LIMIT 1) candidate ON true LEFT JOIN LATERAL (SELECT id,status,version_no,updated_at FROM approval_entries WHERE domain='dcl' AND entity='vehicle' AND subject_id=subject.id AND status='APPROVED' ORDER BY version_no DESC LIMIT 1) approved ON true JOIN dcl_vehicle_versions display ON display.approval_entry_id=COALESCE(candidate.id,approved.id) WHERE subject.entity='vehicle' AND (sqlc.arg(keyword)::text='' OR object.code ILIKE '%'||sqlc.arg(keyword)::text||'%' OR display.name ILIKE '%'||sqlc.arg(keyword)::text||'%' OR display.plate_number ILIKE '%'||sqlc.arg(keyword)::text||'%') AND (sqlc.arg(enabled_filter)::integer=-1 OR display.enabled=(sqlc.arg(enabled_filter)::integer=1)) AND (cardinality(sqlc.arg(status_filter)::text[])=0 OR COALESCE(candidate.status,approved.status)=ANY(sqlc.arg(status_filter)::text[]));
-- name: ListDCLVehicles :many
SELECT object.id AS object_id,object.code,object.revision AS object_revision,display.enabled,COALESCE(candidate.updated_at,approved.updated_at) AS updated_at,COALESCE(approved.id,'')::text AS approved_entry_id,COALESCE(candidate.id,'')::text AS open_entry_id FROM dcl_subjects subject JOIN bob_objects object ON object.id=subject.id AND object.entity=subject.entity LEFT JOIN LATERAL (SELECT id,status,version_no,updated_at FROM approval_entries WHERE domain='dcl' AND entity='vehicle' AND subject_id=subject.id AND status IN ('DRAFT','PENDING') ORDER BY version_no DESC LIMIT 1) candidate ON true LEFT JOIN LATERAL (SELECT id,status,version_no,updated_at FROM approval_entries WHERE domain='dcl' AND entity='vehicle' AND subject_id=subject.id AND status='APPROVED' ORDER BY version_no DESC LIMIT 1) approved ON true JOIN dcl_vehicle_versions display ON display.approval_entry_id=COALESCE(candidate.id,approved.id) WHERE subject.entity='vehicle' AND (sqlc.arg(keyword)::text='' OR object.code ILIKE '%'||sqlc.arg(keyword)::text||'%' OR display.name ILIKE '%'||sqlc.arg(keyword)::text||'%' OR display.plate_number ILIKE '%'||sqlc.arg(keyword)::text||'%') AND (sqlc.arg(enabled_filter)::integer=-1 OR display.enabled=(sqlc.arg(enabled_filter)::integer=1)) AND (cardinality(sqlc.arg(status_filter)::text[])=0 OR COALESCE(candidate.status,approved.status)=ANY(sqlc.arg(status_filter)::text[]))
ORDER BY
 CASE WHEN sqlc.arg(sort_field)::text='updatedAt' AND sqlc.arg(sort_order)::text='asc' THEN COALESCE(candidate.updated_at,approved.updated_at) END ASC,
 CASE WHEN sqlc.arg(sort_field)::text='updatedAt' AND sqlc.arg(sort_order)::text='desc' THEN COALESCE(candidate.updated_at,approved.updated_at) END DESC,
 CASE WHEN sqlc.arg(sort_field)::text='code' AND sqlc.arg(sort_order)::text='asc' THEN object.code END ASC,
 CASE WHEN sqlc.arg(sort_field)::text='code' AND sqlc.arg(sort_order)::text='desc' THEN object.code END DESC,
 CASE WHEN sqlc.arg(sort_field)::text='name' AND sqlc.arg(sort_order)::text='asc' THEN display.name END ASC,
 CASE WHEN sqlc.arg(sort_field)::text='name' AND sqlc.arg(sort_order)::text='desc' THEN display.name END DESC,
 CASE WHEN sqlc.arg(sort_field)::text='status' AND sqlc.arg(sort_order)::text='asc' THEN COALESCE(candidate.status,approved.status) END ASC,
 CASE WHEN sqlc.arg(sort_field)::text='status' AND sqlc.arg(sort_order)::text='desc' THEN COALESCE(candidate.status,approved.status) END DESC,
 CASE WHEN sqlc.arg(sort_field)::text='version' AND sqlc.arg(sort_order)::text='asc' THEN COALESCE(candidate.version_no,approved.version_no) END ASC,
 CASE WHEN sqlc.arg(sort_field)::text='version' AND sqlc.arg(sort_order)::text='desc' THEN COALESCE(candidate.version_no,approved.version_no) END DESC,
 object.id DESC LIMIT sqlc.arg(row_limit) OFFSET sqlc.arg(row_offset);
-- name: CountDCLVehicleApprovalEvents :one
SELECT count(*) FROM approval_events WHERE domain='dcl' AND entity='vehicle' AND subject_id=sqlc.arg(object_id);
-- name: ListDCLVehicleApprovalEvents :many
SELECT id,entry_id,domain,entity,subject_id,version_no,action,from_status,to_status,from_revision,to_revision,actor_id,reason,request_id,created_at FROM approval_events WHERE domain='dcl' AND entity='vehicle' AND subject_id=sqlc.arg(object_id) ORDER BY created_at DESC,id DESC LIMIT sqlc.arg(row_limit) OFFSET sqlc.arg(row_offset);

-- name: InsertDCLFundAccountVersion :exec
INSERT INTO dcl_fund_account_versions(approval_entry_id,name,currency,account_name,bank_name,bank_branch,account_number,remark,operating_entity_id,operating_entity_approval_entry_id,operating_entity_code,operating_entity_name,enabled)
VALUES(sqlc.arg(approval_entry_id),sqlc.arg(name),sqlc.arg(currency),sqlc.narg(account_name),sqlc.narg(bank_name),sqlc.narg(bank_branch),sqlc.narg(account_number),sqlc.narg(remark),sqlc.arg(operating_entity_id),sqlc.arg(operating_entity_approval_entry_id),sqlc.arg(operating_entity_code),sqlc.arg(operating_entity_name),sqlc.arg(enabled));
-- name: CopyDCLFundAccountVersion :execrows
INSERT INTO dcl_fund_account_versions(approval_entry_id,entity,name,currency,account_name,bank_name,bank_branch,account_number,remark,operating_entity_id,operating_entity_approval_entry_id,operating_entity_code,operating_entity_name,enabled)
SELECT sqlc.arg(new_approval_entry_id),source.entity,source.name,source.currency,source.account_name,source.bank_name,source.bank_branch,source.account_number,source.remark,source.operating_entity_id,source.operating_entity_approval_entry_id,source.operating_entity_code,source.operating_entity_name,source.enabled FROM dcl_fund_account_versions source WHERE source.approval_entry_id=sqlc.arg(source_approval_entry_id);
-- name: UpdateDCLFundAccountVersion :execrows
UPDATE dcl_fund_account_versions SET name=sqlc.arg(name),currency=sqlc.arg(currency),account_name=sqlc.narg(account_name),bank_name=sqlc.narg(bank_name),bank_branch=sqlc.narg(bank_branch),account_number=sqlc.narg(account_number),remark=sqlc.narg(remark),operating_entity_id=sqlc.arg(operating_entity_id),operating_entity_approval_entry_id=sqlc.arg(operating_entity_approval_entry_id),operating_entity_code=sqlc.arg(operating_entity_code),operating_entity_name=sqlc.arg(operating_entity_name),enabled=sqlc.arg(enabled) WHERE approval_entry_id=sqlc.arg(approval_entry_id);
-- name: GetDCLFundAccountVersion :one
SELECT * FROM dcl_fund_account_versions WHERE approval_entry_id=sqlc.arg(approval_entry_id);
-- name: DeleteDCLFundAccountVersion :execrows
DELETE FROM dcl_fund_account_versions WHERE approval_entry_id=sqlc.arg(approval_entry_id);
-- name: LockDCLFundAccountIdentifierClaims :exec
SELECT pg_advisory_xact_lock(74155003);
-- name: FindDCLFundAccountIdentifierConflict :one
WITH selected AS (SELECT id,status FROM approval_entries WHERE domain='dcl' AND entity='fund-account' AND subject_id=sqlc.arg(object_id) AND status IN ('DRAFT','PENDING') UNION ALL (SELECT id,status FROM approval_entries WHERE domain='dcl' AND entity='fund-account' AND subject_id=sqlc.arg(object_id) AND status='APPROVED' ORDER BY version_no DESC LIMIT 1)), desired AS (SELECT upper(replace(replace(btrim(account_number),' ',''),'-','')) value FROM dcl_fund_account_versions v JOIN selected e ON e.id=v.approval_entry_id WHERE account_number IS NOT NULL AND upper(replace(replace(btrim(account_number),' ',''),'-',''))<>'') SELECT desired.value AS normalized_account_number FROM desired JOIN dcl_fund_account_identifier_claims c ON c.normalized_account_number=desired.value WHERE c.object_id<>sqlc.arg(object_id) LIMIT 1;
-- name: DeleteDCLFundAccountIdentifierClaims :exec
DELETE FROM dcl_fund_account_identifier_claims WHERE object_id=sqlc.arg(object_id);
-- name: RebuildDCLFundAccountIdentifierClaims :exec
WITH selected AS (SELECT id,status FROM approval_entries WHERE domain='dcl' AND entity='fund-account' AND subject_id=sqlc.arg(object_id) AND status IN ('DRAFT','PENDING') UNION ALL (SELECT id,status FROM approval_entries WHERE domain='dcl' AND entity='fund-account' AND subject_id=sqlc.arg(object_id) AND status='APPROVED' ORDER BY version_no DESC LIMIT 1)), desired AS (SELECT upper(replace(replace(btrim(v.account_number),' ',''),'-','')) value,e.id,e.status FROM dcl_fund_account_versions v JOIN selected e ON e.id=v.approval_entry_id WHERE v.account_number IS NOT NULL AND upper(replace(replace(btrim(v.account_number),' ',''),'-',''))<>'') INSERT INTO dcl_fund_account_identifier_claims(normalized_account_number,object_id,approved_entry_id,open_entry_id) SELECT value,sqlc.arg(object_id),max(id) FILTER (WHERE status='APPROVED'),max(id) FILTER (WHERE status IN ('DRAFT','PENDING')) FROM desired GROUP BY value;
-- name: CountDCLFundAccounts :one
SELECT count(*) FROM dcl_subjects s JOIN bob_objects o ON o.id=s.id AND o.entity=s.entity LEFT JOIN LATERAL (SELECT id,status,version_no,updated_at FROM approval_entries WHERE domain='dcl' AND entity='fund-account' AND subject_id=s.id AND status IN ('DRAFT','PENDING') ORDER BY version_no DESC LIMIT 1) c ON true LEFT JOIN LATERAL (SELECT id,status,version_no,updated_at FROM approval_entries WHERE domain='dcl' AND entity='fund-account' AND subject_id=s.id AND status='APPROVED' ORDER BY version_no DESC LIMIT 1) a ON true JOIN dcl_fund_account_versions d ON d.approval_entry_id=COALESCE(c.id,a.id) WHERE s.entity='fund-account' AND (sqlc.arg(keyword)::text='' OR o.code ILIKE '%'||sqlc.arg(keyword)::text||'%' OR d.name ILIKE '%'||sqlc.arg(keyword)::text||'%') AND (sqlc.arg(enabled_filter)::integer=-1 OR d.enabled=(sqlc.arg(enabled_filter)::integer=1)) AND (cardinality(sqlc.arg(status_filter)::text[])=0 OR COALESCE(c.status,a.status)=ANY(sqlc.arg(status_filter)::text[]));
-- name: ListDCLFundAccounts :many
SELECT o.id object_id,o.code,o.revision object_revision,d.enabled,COALESCE(c.updated_at,a.updated_at) updated_at,COALESCE(a.id,'')::text approved_entry_id,COALESCE(c.id,'')::text open_entry_id FROM dcl_subjects s JOIN bob_objects o ON o.id=s.id AND o.entity=s.entity LEFT JOIN LATERAL (SELECT id,status,version_no,updated_at FROM approval_entries WHERE domain='dcl' AND entity='fund-account' AND subject_id=s.id AND status IN ('DRAFT','PENDING') ORDER BY version_no DESC LIMIT 1) c ON true LEFT JOIN LATERAL (SELECT id,status,version_no,updated_at FROM approval_entries WHERE domain='dcl' AND entity='fund-account' AND subject_id=s.id AND status='APPROVED' ORDER BY version_no DESC LIMIT 1) a ON true JOIN dcl_fund_account_versions d ON d.approval_entry_id=COALESCE(c.id,a.id) WHERE s.entity='fund-account' AND (sqlc.arg(keyword)::text='' OR o.code ILIKE '%'||sqlc.arg(keyword)::text||'%' OR d.name ILIKE '%'||sqlc.arg(keyword)::text||'%') AND (sqlc.arg(enabled_filter)::integer=-1 OR d.enabled=(sqlc.arg(enabled_filter)::integer=1)) AND (cardinality(sqlc.arg(status_filter)::text[])=0 OR COALESCE(c.status,a.status)=ANY(sqlc.arg(status_filter)::text[])) ORDER BY CASE WHEN sqlc.arg(sort_field)::text='updatedAt' AND sqlc.arg(sort_order)::text='asc' THEN COALESCE(c.updated_at,a.updated_at) END ASC, CASE WHEN sqlc.arg(sort_field)::text='updatedAt' AND sqlc.arg(sort_order)::text='desc' THEN COALESCE(c.updated_at,a.updated_at) END DESC, CASE WHEN sqlc.arg(sort_field)::text='code' AND sqlc.arg(sort_order)::text='asc' THEN o.code END ASC, CASE WHEN sqlc.arg(sort_field)::text='code' AND sqlc.arg(sort_order)::text='desc' THEN o.code END DESC, CASE WHEN sqlc.arg(sort_field)::text='name' AND sqlc.arg(sort_order)::text='asc' THEN d.name END ASC, CASE WHEN sqlc.arg(sort_field)::text='name' AND sqlc.arg(sort_order)::text='desc' THEN d.name END DESC, CASE WHEN sqlc.arg(sort_field)::text='status' AND sqlc.arg(sort_order)::text='asc' THEN COALESCE(c.status,a.status) END ASC, CASE WHEN sqlc.arg(sort_field)::text='status' AND sqlc.arg(sort_order)::text='desc' THEN COALESCE(c.status,a.status) END DESC, CASE WHEN sqlc.arg(sort_field)::text='version' AND sqlc.arg(sort_order)::text='asc' THEN COALESCE(c.version_no,a.version_no) END ASC, CASE WHEN sqlc.arg(sort_field)::text='version' AND sqlc.arg(sort_order)::text='desc' THEN COALESCE(c.version_no,a.version_no) END DESC, o.id DESC LIMIT sqlc.arg(row_limit) OFFSET sqlc.arg(row_offset);
-- name: CountDCLFundAccountApprovalEvents :one
SELECT count(*) FROM approval_events WHERE domain='dcl' AND entity='fund-account' AND subject_id=sqlc.arg(object_id);
-- name: ListDCLFundAccountApprovalEvents :many
SELECT id,entry_id,domain,entity,subject_id,version_no,action,from_status,to_status,from_revision,to_revision,actor_id,reason,request_id,created_at FROM approval_events WHERE domain='dcl' AND entity='fund-account' AND subject_id=sqlc.arg(object_id) ORDER BY created_at DESC,id DESC LIMIT sqlc.arg(row_limit) OFFSET sqlc.arg(row_offset);

-- name: CountDCLProducts :one
SELECT count(*) FROM dcl_subjects s JOIN bob_objects o ON o.id=s.id AND o.entity=s.entity LEFT JOIN LATERAL (SELECT id,status,version_no,updated_at FROM approval_entries WHERE domain='dcl' AND entity='product' AND subject_id=s.id AND status IN ('DRAFT','PENDING') ORDER BY version_no DESC LIMIT 1) c ON true LEFT JOIN LATERAL (SELECT id,status,version_no,updated_at FROM approval_entries WHERE domain='dcl' AND entity='product' AND subject_id=s.id AND status='APPROVED' ORDER BY version_no DESC LIMIT 1) a ON true JOIN dcl_product_versions d ON d.approval_entry_id=COALESCE(c.id,a.id) WHERE s.entity='product' AND (sqlc.arg(keyword)::text='' OR o.code ILIKE '%'||sqlc.arg(keyword)::text||'%' OR d.name ILIKE '%'||sqlc.arg(keyword)::text||'%') AND (sqlc.arg(enabled_filter)::integer=-1 OR d.enabled=(sqlc.arg(enabled_filter)::integer=1)) AND (cardinality(sqlc.arg(status_filter)::text[])=0 OR COALESCE(c.status,a.status)=ANY(sqlc.arg(status_filter)::text[])) AND (sqlc.arg(product_type_id)::text='' OR d.product_type_id=sqlc.arg(product_type_id)::text) AND (sqlc.arg(category_id)::text='' OR d.category_id=sqlc.arg(category_id)::text);
-- name: ListDCLProducts :many
SELECT o.id object_id,o.code,o.revision object_revision,d.enabled,COALESCE(c.updated_at,a.updated_at) updated_at,COALESCE(a.id,'')::text approved_entry_id,COALESCE(c.id,'')::text open_entry_id FROM dcl_subjects s JOIN bob_objects o ON o.id=s.id AND o.entity=s.entity LEFT JOIN LATERAL (SELECT id,status,version_no,updated_at FROM approval_entries WHERE domain='dcl' AND entity='product' AND subject_id=s.id AND status IN ('DRAFT','PENDING') ORDER BY version_no DESC LIMIT 1) c ON true LEFT JOIN LATERAL (SELECT id,status,version_no,updated_at FROM approval_entries WHERE domain='dcl' AND entity='product' AND subject_id=s.id AND status='APPROVED' ORDER BY version_no DESC LIMIT 1) a ON true JOIN dcl_product_versions d ON d.approval_entry_id=COALESCE(c.id,a.id) WHERE s.entity='product' AND (sqlc.arg(keyword)::text='' OR o.code ILIKE '%'||sqlc.arg(keyword)::text||'%' OR d.name ILIKE '%'||sqlc.arg(keyword)::text||'%') AND (sqlc.arg(enabled_filter)::integer=-1 OR d.enabled=(sqlc.arg(enabled_filter)::integer=1)) AND (cardinality(sqlc.arg(status_filter)::text[])=0 OR COALESCE(c.status,a.status)=ANY(sqlc.arg(status_filter)::text[])) AND (sqlc.arg(product_type_id)::text='' OR d.product_type_id=sqlc.arg(product_type_id)::text) AND (sqlc.arg(category_id)::text='' OR d.category_id=sqlc.arg(category_id)::text) ORDER BY CASE WHEN sqlc.arg(sort_field)::text='updatedAt' AND sqlc.arg(sort_order)::text='asc' THEN COALESCE(c.updated_at,a.updated_at) END ASC, CASE WHEN sqlc.arg(sort_field)::text='updatedAt' AND sqlc.arg(sort_order)::text='desc' THEN COALESCE(c.updated_at,a.updated_at) END DESC, CASE WHEN sqlc.arg(sort_field)::text='code' AND sqlc.arg(sort_order)::text='asc' THEN o.code END ASC, CASE WHEN sqlc.arg(sort_field)::text='code' AND sqlc.arg(sort_order)::text='desc' THEN o.code END DESC, CASE WHEN sqlc.arg(sort_field)::text='name' AND sqlc.arg(sort_order)::text='asc' THEN d.name END ASC, CASE WHEN sqlc.arg(sort_field)::text='name' AND sqlc.arg(sort_order)::text='desc' THEN d.name END DESC, CASE WHEN sqlc.arg(sort_field)::text='status' AND sqlc.arg(sort_order)::text='asc' THEN COALESCE(c.status,a.status) END ASC, CASE WHEN sqlc.arg(sort_field)::text='status' AND sqlc.arg(sort_order)::text='desc' THEN COALESCE(c.status,a.status) END DESC, CASE WHEN sqlc.arg(sort_field)::text='version' AND sqlc.arg(sort_order)::text='asc' THEN COALESCE(c.version_no,a.version_no) END ASC, CASE WHEN sqlc.arg(sort_field)::text='version' AND sqlc.arg(sort_order)::text='desc' THEN COALESCE(c.version_no,a.version_no) END DESC, o.id DESC LIMIT sqlc.arg(row_limit) OFFSET sqlc.arg(row_offset);
-- name: LockDCLProductBarcodeClaims :exec
SELECT pg_advisory_xact_lock(74155004);
-- name: FindDCLProductBarcodeConflict :one
WITH selected AS (SELECT id,status FROM approval_entries WHERE domain='dcl' AND entity='product' AND subject_id=sqlc.arg(object_id) AND status IN ('DRAFT','PENDING') UNION ALL (SELECT id,status FROM approval_entries WHERE domain='dcl' AND entity='product' AND subject_id=sqlc.arg(object_id) AND status='APPROVED' ORDER BY version_no DESC LIMIT 1)), desired AS (SELECT upper(btrim(barcode)) value FROM dcl_product_versions v JOIN selected e ON e.id=v.approval_entry_id WHERE barcode IS NOT NULL AND upper(btrim(barcode))<>'') SELECT desired.value AS normalized_barcode FROM desired JOIN dcl_product_barcode_claims c ON c.normalized_barcode=desired.value WHERE c.object_id<>sqlc.arg(object_id) LIMIT 1;
-- name: DeleteDCLProductBarcodeClaims :exec
DELETE FROM dcl_product_barcode_claims WHERE object_id=sqlc.arg(object_id);
-- name: RebuildDCLProductBarcodeClaims :exec
WITH selected AS (SELECT id,status FROM approval_entries WHERE domain='dcl' AND entity='product' AND subject_id=sqlc.arg(object_id) AND status IN ('DRAFT','PENDING') UNION ALL (SELECT id,status FROM approval_entries WHERE domain='dcl' AND entity='product' AND subject_id=sqlc.arg(object_id) AND status='APPROVED' ORDER BY version_no DESC LIMIT 1)), desired AS (SELECT upper(btrim(v.barcode)) value,e.id,e.status FROM dcl_product_versions v JOIN selected e ON e.id=v.approval_entry_id WHERE v.barcode IS NOT NULL AND upper(btrim(v.barcode))<>'') INSERT INTO dcl_product_barcode_claims(normalized_barcode,object_id,approved_entry_id,open_entry_id) SELECT value,sqlc.arg(object_id),max(id) FILTER (WHERE status='APPROVED'),max(id) FILTER (WHERE status IN ('DRAFT','PENDING')) FROM desired GROUP BY value;
-- name: CountDCLProductApprovalEvents :one
SELECT count(*) FROM approval_events WHERE domain='dcl' AND entity='product' AND subject_id=sqlc.arg(object_id);
-- name: ListDCLProductApprovalEvents :many
SELECT id,entry_id,domain,entity,subject_id,version_no,action,from_status,to_status,from_revision,to_revision,actor_id,reason,request_id,created_at FROM approval_events WHERE domain='dcl' AND entity='product' AND subject_id=sqlc.arg(object_id) ORDER BY created_at DESC,id DESC LIMIT sqlc.arg(row_limit) OFFSET sqlc.arg(row_offset);

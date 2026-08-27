-- name: InsertVouServiceContractDetail :exec
INSERT INTO vou_service_contract_details(
 document_id,counterparty_entity,counterparty_object_id,counterparty_approval_entry_id,counterparty_code,counterparty_name,
 party_id,party_name,operating_entity_object_id,operating_entity_approval_entry_id,operating_entity_code,operating_entity_name,
 handler_object_id,handler_approval_entry_id,handler_code,handler_name,
 settlement_method_object_id,settlement_method_approval_entry_id,settlement_method_code,settlement_method_name,
 settlement_term_code,settlement_rule_type,settlement_month_offset,settlement_day_of_month,settlement_day_offset,
 capabilities,applicable_from,applicable_to,contract_terms
) VALUES (
 sqlc.arg(document_id),sqlc.arg(counterparty_entity),sqlc.arg(counterparty_object_id),sqlc.arg(counterparty_approval_entry_id),sqlc.arg(counterparty_code),sqlc.arg(counterparty_name),
 sqlc.arg(party_id),sqlc.arg(party_name),sqlc.arg(operating_entity_object_id),sqlc.arg(operating_entity_approval_entry_id),sqlc.arg(operating_entity_code),sqlc.arg(operating_entity_name),
 sqlc.arg(handler_object_id),sqlc.arg(handler_approval_entry_id),sqlc.arg(handler_code),sqlc.arg(handler_name),
 sqlc.narg(settlement_method_object_id),sqlc.narg(settlement_method_approval_entry_id),sqlc.narg(settlement_method_code),sqlc.narg(settlement_method_name),
 sqlc.narg(settlement_term_code),sqlc.narg(settlement_rule_type),sqlc.narg(settlement_month_offset),sqlc.narg(settlement_day_of_month),sqlc.narg(settlement_day_offset),
 sqlc.arg(capabilities),sqlc.narg(applicable_from),sqlc.narg(applicable_to),sqlc.arg(contract_terms)
);

-- name: ResolveVouContractCounterparty :one
SELECT object.id AS counterparty_object_id,object.entity AS counterparty_entity,
       version.id AS counterparty_approval_entry_id,object.code AS counterparty_code,
       party.id AS party_id,party_current.display_name AS party_name,
       operating.id AS operating_entity_object_id,operating_detail.source_approval_entry_id AS operating_entity_approval_entry_id,
       operating.code AS operating_entity_code,operating_detail.legal_name AS operating_entity_name,
       COALESCE(sales.capabilities,ARRAY[]::varchar(32)[]) AS capabilities,
       service_detail.settlement_method_id,service_detail.settlement_method_code,
       service_detail.settlement_method_name,service_detail.settlement_term_code,
       service_detail.settlement_rule_type,service_detail.settlement_month_offset,
       service_detail.settlement_day_of_month,service_detail.settlement_day_offset
       ,service_detail.settlement_method_approval_entry_id AS default_settlement_approval_entry_id
FROM bob_objects object
JOIN LATERAL (
  SELECT id FROM approval_entries
  WHERE domain='bob' AND entity=object.entity AND subject_id=object.id AND status='APPROVED'
  ORDER BY version_no DESC LIMIT 1
) version ON true
LEFT JOIN bob_service_relationships service_rel ON service_rel.object_id=object.id AND object.entity='other-unit'
LEFT JOIN bob_service_relationship_versions service_detail ON service_detail.approval_entry_id=version.id AND object.entity='other-unit'
LEFT JOIN bob_sales_relationships sales_rel ON sales_rel.object_id=object.id AND object.entity='sales-partner'
LEFT JOIN bob_sales_partner_versions sales ON sales.approval_entry_id=version.id AND object.entity='sales-partner'
JOIN bob_parties party ON party.id=COALESCE(service_rel.party_id,sales_rel.party_id)
JOIN bob_party_currents party_current ON party_current.party_id=party.id
JOIN bob_objects operating ON operating.id=COALESCE(service_rel.operating_entity_id,sales_rel.operating_entity_id)
JOIN bob_operating_entities operating_detail ON operating_detail.object_id=operating.id AND operating_detail.enabled
WHERE object.id=sqlc.arg(counterparty_object_id) AND object.entity=sqlc.arg(counterparty_entity)
  AND object.enabled
FOR SHARE OF object,party,operating;

-- name: UpdateVouServiceContractDetail :execrows
UPDATE vou_service_contract_details SET
 counterparty_entity=sqlc.arg(counterparty_entity),counterparty_object_id=sqlc.arg(counterparty_object_id),counterparty_approval_entry_id=sqlc.arg(counterparty_approval_entry_id),counterparty_code=sqlc.arg(counterparty_code),counterparty_name=sqlc.arg(counterparty_name),
 party_id=sqlc.arg(party_id),party_name=sqlc.arg(party_name),operating_entity_object_id=sqlc.arg(operating_entity_object_id),operating_entity_approval_entry_id=sqlc.arg(operating_entity_approval_entry_id),operating_entity_code=sqlc.arg(operating_entity_code),operating_entity_name=sqlc.arg(operating_entity_name),
 handler_object_id=sqlc.arg(handler_object_id),handler_approval_entry_id=sqlc.arg(handler_approval_entry_id),handler_code=sqlc.arg(handler_code),handler_name=sqlc.arg(handler_name),
 settlement_method_object_id=sqlc.narg(settlement_method_object_id),settlement_method_approval_entry_id=sqlc.narg(settlement_method_approval_entry_id),settlement_method_code=sqlc.narg(settlement_method_code),settlement_method_name=sqlc.narg(settlement_method_name),
 settlement_term_code=sqlc.narg(settlement_term_code),settlement_rule_type=sqlc.narg(settlement_rule_type),settlement_month_offset=sqlc.narg(settlement_month_offset),settlement_day_of_month=sqlc.narg(settlement_day_of_month),settlement_day_offset=sqlc.narg(settlement_day_offset),
 capabilities=sqlc.arg(capabilities),applicable_from=sqlc.narg(applicable_from),applicable_to=sqlc.narg(applicable_to),contract_terms=sqlc.arg(contract_terms)
WHERE document_id=sqlc.arg(document_id);

-- name: GetVouServiceContractDetail :one
SELECT * FROM vou_service_contract_details WHERE document_id=sqlc.arg(document_id);

-- name: LockVouServiceContractDetail :one
SELECT * FROM vou_service_contract_details WHERE document_id=sqlc.arg(document_id) FOR UPDATE;

-- name: FindLatestApplicableSalesContract :one
SELECT contract.*
FROM vou_service_contract_details contract
JOIN vou_documents document ON document.id=contract.document_id
JOIN approval_entries approval ON approval.id=document.approval_entry_id
  AND approval.domain='vou' AND approval.entity=document.entity AND approval.subject_id=document.id
WHERE contract.counterparty_entity='sales-partner'
  AND contract.counterparty_object_id=sqlc.arg(sales_partner_object_id)
  AND document.entity='service-contract' AND approval.status='APPROVED'
  AND sqlc.arg(capability)::text=ANY(contract.capabilities)
  AND contract.applicable_from<=sqlc.arg(business_date)::date
  AND (contract.applicable_to IS NULL OR contract.applicable_to>=sqlc.arg(business_date)::date)
ORDER BY contract.applicable_from DESC,approval.approved_at DESC,contract.document_id DESC
LIMIT 1;

-- name: InsertVouServiceAcceptanceDetail :exec
INSERT INTO vou_service_acceptance_details(
 document_id,contract_document_id,service_date,acceptance_date,settlement_direction,
 contract_snapshot,fulfillment_fact,acceptance_fact
) VALUES (
 sqlc.arg(document_id),sqlc.arg(contract_document_id),sqlc.arg(service_date),sqlc.arg(acceptance_date),
 sqlc.arg(settlement_direction),sqlc.arg(contract_snapshot),sqlc.arg(fulfillment_fact),sqlc.arg(acceptance_fact)
);

-- name: UpdateVouServiceAcceptanceDetail :execrows
UPDATE vou_service_acceptance_details SET
 contract_document_id=sqlc.arg(contract_document_id),service_date=sqlc.arg(service_date),acceptance_date=sqlc.arg(acceptance_date),
 settlement_direction=sqlc.arg(settlement_direction),contract_snapshot=sqlc.arg(contract_snapshot),
 fulfillment_fact=sqlc.arg(fulfillment_fact),acceptance_fact=sqlc.arg(acceptance_fact)
WHERE document_id=sqlc.arg(document_id);

-- name: GetVouServiceAcceptanceDetail :one
SELECT * FROM vou_service_acceptance_details WHERE document_id=sqlc.arg(document_id);

-- name: LockVouServiceAcceptanceContract :one
SELECT document.id,approval.status,contract.counterparty_entity
FROM vou_documents document JOIN vou_service_contract_details contract ON contract.document_id=document.id
JOIN approval_entries approval ON approval.id=document.approval_entry_id
  AND approval.domain='vou' AND approval.entity=document.entity AND approval.subject_id=document.id
WHERE document.id=sqlc.arg(contract_document_id) AND document.entity='service-contract'
FOR UPDATE OF document,contract;

-- name: FindLatestApplicableSalesContractSnapshot :one
SELECT contract.document_id,approval.revision AS document_revision,
       contract.applicable_from,contract.applicable_to,contract.contract_terms
FROM vou_service_contract_details contract
JOIN vou_documents document ON document.id=contract.document_id
JOIN approval_entries approval ON approval.id=document.approval_entry_id
  AND approval.domain='vou' AND approval.entity=document.entity AND approval.subject_id=document.id
WHERE contract.counterparty_entity='sales-partner'
  AND contract.counterparty_object_id=sqlc.arg(sales_partner_object_id)
  AND document.entity='service-contract' AND approval.status='APPROVED'
  AND sqlc.arg(capability)::text=ANY(contract.capabilities)
  AND contract.applicable_from<=sqlc.arg(business_date)::date
  AND (contract.applicable_to IS NULL OR contract.applicable_to>=sqlc.arg(business_date)::date)
ORDER BY contract.applicable_from DESC,approval.approved_at DESC,contract.document_id DESC
LIMIT 1
FOR SHARE OF contract,document;

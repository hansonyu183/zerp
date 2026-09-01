-- name: InsertVouServiceContractDetail :exec
INSERT INTO vou_service_contract_details(
 document_id,counterparty_entity,counterparty_object_id,counterparty_approval_entry_id,counterparty_code,counterparty_name,
 operating_entity_object_id,operating_entity_approval_entry_id,operating_entity_code,operating_entity_name,
 handler_object_id,handler_approval_entry_id,handler_code,handler_name,
 settlement_method_object_id,settlement_method_code,settlement_method_name,
 settlement_term_code,settlement_rule_type,settlement_month_offset,settlement_day_of_month,settlement_day_offset,
 capabilities,applicable_from,applicable_to,contract_terms
) VALUES (
 sqlc.arg(document_id),sqlc.arg(counterparty_entity),sqlc.arg(counterparty_object_id),sqlc.arg(counterparty_approval_entry_id),sqlc.arg(counterparty_code),sqlc.arg(counterparty_name),
 sqlc.arg(operating_entity_object_id),sqlc.arg(operating_entity_approval_entry_id),sqlc.arg(operating_entity_code),sqlc.arg(operating_entity_name),
 sqlc.arg(handler_object_id),sqlc.arg(handler_approval_entry_id),sqlc.arg(handler_code),sqlc.arg(handler_name),
 sqlc.narg(settlement_method_object_id),sqlc.narg(settlement_method_code),sqlc.narg(settlement_method_name),
 sqlc.narg(settlement_term_code),sqlc.narg(settlement_rule_type),sqlc.narg(settlement_month_offset),sqlc.narg(settlement_day_of_month),sqlc.narg(settlement_day_offset),
 sqlc.arg(capabilities),sqlc.narg(applicable_from),sqlc.narg(applicable_to),sqlc.arg(contract_terms)
);

-- name: ResolveVouContractCounterparty :one
SELECT object.id AS counterparty_object_id,object.entity AS counterparty_entity,
       version.id AS counterparty_approval_entry_id,object.code AS counterparty_code,
       operating.id AS operating_entity_object_id,operating_entry.id AS operating_entity_approval_entry_id,
       operating.code AS operating_entity_code,operating_detail.legal_name AS operating_entity_name,
       COALESCE(sales.capabilities,ARRAY[]::varchar(32)[]) AS capabilities,
       service_detail.settlement_method_id,service_detail.settlement_method_code,
       service_detail.settlement_method_name,service_detail.settlement_term_code,
       service_detail.settlement_rule_type,service_detail.settlement_month_offset,
       service_detail.settlement_day_of_month,service_detail.settlement_day_offset
FROM dcl_subjects object
JOIN LATERAL (
  SELECT id FROM approval_entries
  WHERE domain='dcl' AND entity=object.entity AND subject_id=object.id AND status='APPROVED'
  ORDER BY version_no DESC LIMIT 1
) version ON true
LEFT JOIN dcl_other_unit_versions service_detail ON service_detail.approval_entry_id=version.id AND object.entity='other-unit'
LEFT JOIN dcl_sales_partner_versions sales ON sales.approval_entry_id=version.id AND object.entity='sales-partner'
JOIN dcl_subjects operating ON operating.id=COALESCE(service_detail.default_operating_entity_id,sales.default_operating_entity_id) AND operating.entity='operating-entity'
JOIN LATERAL (SELECT id FROM approval_entries WHERE domain='dcl' AND entity='operating-entity' AND subject_id=operating.id AND status='APPROVED' ORDER BY version_no DESC LIMIT 1) operating_entry ON true
JOIN dcl_operating_entity_versions operating_detail ON operating_detail.approval_entry_id=operating_entry.id
  AND operating_entry.id=COALESCE(service_detail.default_operating_entity_approval_entry_id,sales.default_operating_entity_approval_entry_id)
  AND operating_detail.enabled
WHERE object.id=sqlc.arg(counterparty_object_id) AND object.entity=sqlc.arg(counterparty_entity)
  AND object.entity IN ('other-unit','sales-partner')
  AND COALESCE(service_detail.enabled,sales.enabled)
FOR SHARE OF object,operating;

-- name: UpdateVouServiceContractDetail :execrows
UPDATE vou_service_contract_details SET
 counterparty_entity=sqlc.arg(counterparty_entity),counterparty_object_id=sqlc.arg(counterparty_object_id),counterparty_approval_entry_id=sqlc.arg(counterparty_approval_entry_id),counterparty_code=sqlc.arg(counterparty_code),counterparty_name=sqlc.arg(counterparty_name),
 operating_entity_object_id=sqlc.arg(operating_entity_object_id),operating_entity_approval_entry_id=sqlc.arg(operating_entity_approval_entry_id),operating_entity_code=sqlc.arg(operating_entity_code),operating_entity_name=sqlc.arg(operating_entity_name),
 handler_object_id=sqlc.arg(handler_object_id),handler_approval_entry_id=sqlc.arg(handler_approval_entry_id),handler_code=sqlc.arg(handler_code),handler_name=sqlc.arg(handler_name),
	settlement_method_object_id=sqlc.narg(settlement_method_object_id),settlement_method_code=sqlc.narg(settlement_method_code),settlement_method_name=sqlc.narg(settlement_method_name),
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

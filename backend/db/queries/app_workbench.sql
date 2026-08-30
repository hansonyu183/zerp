-- name: CountWorkbenchBobItems :one
SELECT count(*)
FROM approval_entries entry
LEFT JOIN dcl_subjects subject ON subject.id=entry.subject_id AND subject.entity=entry.entity
LEFT JOIN acc_mappings mapping ON entry.entity='acc-mapping' AND mapping.id=entry.subject_id
LEFT JOIN acc_books mapping_book ON mapping_book.id=mapping.book_id
CROSS JOIN LATERAL (
  SELECT CASE entry.entity
    WHEN 'party' THEN (SELECT payload.display_name FROM dcl_party_versions payload WHERE payload.approval_entry_id=entry.id)
    WHEN 'customer' THEN (SELECT current.display_name FROM dcl_customer_relationships relationship JOIN LATERAL (SELECT payload.display_name FROM approval_entries party_entry JOIN dcl_party_versions payload ON payload.approval_entry_id=party_entry.id WHERE party_entry.domain='dcl' AND party_entry.entity='party' AND party_entry.subject_id=relationship.party_id AND party_entry.status='APPROVED' ORDER BY party_entry.version_no DESC LIMIT 1) current ON true WHERE relationship.object_id=entry.subject_id)
    WHEN 'customer-account' THEN (SELECT payload.name FROM dcl_customer_account_versions payload WHERE payload.approval_entry_id=entry.id)
    WHEN 'supplier' THEN (SELECT current.display_name FROM dcl_supplier_relationships relationship JOIN LATERAL (SELECT payload.display_name FROM approval_entries party_entry JOIN dcl_party_versions payload ON payload.approval_entry_id=party_entry.id WHERE party_entry.domain='dcl' AND party_entry.entity='party' AND party_entry.subject_id=relationship.party_id AND party_entry.status='APPROVED' ORDER BY party_entry.version_no DESC LIMIT 1) current ON true WHERE relationship.object_id=entry.subject_id)
    WHEN 'other-unit' THEN (SELECT current.display_name FROM dcl_service_relationships relationship JOIN LATERAL (SELECT payload.display_name FROM approval_entries party_entry JOIN dcl_party_versions payload ON payload.approval_entry_id=party_entry.id WHERE party_entry.domain='dcl' AND party_entry.entity='party' AND party_entry.subject_id=relationship.party_id AND party_entry.status='APPROVED' ORDER BY party_entry.version_no DESC LIMIT 1) current ON true WHERE relationship.object_id=entry.subject_id)
    WHEN 'employee' THEN (SELECT party.display_name FROM dcl_employment_relationships relationship JOIN LATERAL (SELECT payload.display_name FROM approval_entries party_entry JOIN dcl_party_versions payload ON payload.approval_entry_id=party_entry.id WHERE party_entry.domain='dcl' AND party_entry.entity='party' AND party_entry.subject_id=relationship.party_id AND party_entry.status='APPROVED' ORDER BY party_entry.version_no DESC LIMIT 1) party ON true WHERE relationship.object_id=entry.subject_id AND relationship.merged_into_object_id IS NULL)
    WHEN 'sales-partner' THEN (SELECT current.display_name FROM dcl_sales_relationships relationship JOIN LATERAL (SELECT payload.display_name FROM approval_entries party_entry JOIN dcl_party_versions payload ON payload.approval_entry_id=party_entry.id WHERE party_entry.domain='dcl' AND party_entry.entity='party' AND party_entry.subject_id=relationship.party_id AND party_entry.status='APPROVED' ORDER BY party_entry.version_no DESC LIMIT 1) current ON true WHERE relationship.object_id=entry.subject_id)
    WHEN 'product' THEN (SELECT payload.name FROM dcl_product_versions payload WHERE payload.approval_entry_id=entry.id)
    WHEN 'warehouse' THEN (SELECT payload.name FROM dcl_warehouse_versions payload WHERE payload.approval_entry_id=entry.id)
    WHEN 'vehicle' THEN (SELECT payload.name FROM dcl_vehicle_versions payload WHERE payload.approval_entry_id=entry.id)
    WHEN 'fund-account' THEN (SELECT payload.name FROM dcl_fund_account_versions payload WHERE payload.approval_entry_id=entry.id)
    WHEN 'operating-entity' THEN (SELECT payload.legal_name FROM dcl_operating_entity_versions payload WHERE payload.approval_entry_id=entry.id)
    WHEN 'acc-mapping' THEN mapping_book.name || ' · ' || mapping.vou_entity
    WHEN 'rpt-definition' THEN (SELECT payload.name FROM dcl_rpt_definition_versions payload WHERE payload.approval_entry_id=entry.id)
    ELSE ''
  END AS name
) named
WHERE entry.domain='dcl'
  AND entry.entity IN ('operating-entity','warehouse','vehicle','fund-account','product','party','employee','supplier','other-unit','sales-partner','customer','customer-account','acc-mapping','rpt-definition')
  AND (
    (entry.status = 'DRAFT' AND entry.entity = ANY(sqlc.arg(draft_entities)::text[]))
    OR (
      entry.status = 'PENDING'
      AND (
        (
          entry.entity = ANY(sqlc.arg(pending_entities)::text[])
          AND entry.submitted_by IS DISTINCT FROM sqlc.arg(actor_id)::text
        )
        OR entry.entity = ANY(sqlc.arg(unsubmit_entities)::text[])
      )
    )
  )
  AND (
    sqlc.arg(keyword)::text = ''
    OR subject.code ILIKE '%' || sqlc.arg(keyword) || '%'
    OR mapping.vou_entity ILIKE '%' || sqlc.arg(keyword) || '%'
    OR mapping_book.name ILIKE '%' || sqlc.arg(keyword) || '%'
    OR named.name ILIKE '%' || sqlc.arg(keyword) || '%'
  );

-- name: ListWorkbenchBobItems :many
SELECT entry.subject_id AS object_id, entry.entity,
       CASE
         WHEN entry.entity IN ('operating-entity','warehouse','vehicle','fund-account','product','employee','supplier','other-unit','sales-partner','customer','customer-account','rpt-definition')
           THEN dcl_require_subject_code(subject.code)
         WHEN entry.entity='acc-mapping' THEN mapping.vou_entity
         ELSE ''
       END AS code,
       named.name,
       COALESCE(mapping.book_id, '') AS book_id, COALESCE(mapping.vou_entity, '') AS vou_entity,
       entry.id AS approval_entry_id, entry.status, entry.revision AS approval_revision,
       COALESCE(subject.created_at, mapping.updated_at, entry.updated_at) AS object_updated_at,
       CASE
         WHEN entry.submitted_by = sqlc.arg(actor_id)::text THEN true
         ELSE false
       END AS is_submitted_by_actor
FROM approval_entries entry
LEFT JOIN dcl_subjects subject ON subject.id=entry.subject_id AND subject.entity=entry.entity
LEFT JOIN acc_mappings mapping ON entry.entity='acc-mapping' AND mapping.id=entry.subject_id
LEFT JOIN acc_books mapping_book ON mapping_book.id=mapping.book_id
CROSS JOIN LATERAL (
  SELECT CASE entry.entity
    WHEN 'party' THEN (SELECT payload.display_name FROM dcl_party_versions payload WHERE payload.approval_entry_id=entry.id)
    WHEN 'customer' THEN (SELECT current.display_name FROM dcl_customer_relationships relationship JOIN LATERAL (SELECT payload.display_name FROM approval_entries party_entry JOIN dcl_party_versions payload ON payload.approval_entry_id=party_entry.id WHERE party_entry.domain='dcl' AND party_entry.entity='party' AND party_entry.subject_id=relationship.party_id AND party_entry.status='APPROVED' ORDER BY party_entry.version_no DESC LIMIT 1) current ON true WHERE relationship.object_id=entry.subject_id)
    WHEN 'customer-account' THEN (SELECT payload.name FROM dcl_customer_account_versions payload WHERE payload.approval_entry_id=entry.id)
    WHEN 'supplier' THEN (SELECT current.display_name FROM dcl_supplier_relationships relationship JOIN LATERAL (SELECT payload.display_name FROM approval_entries party_entry JOIN dcl_party_versions payload ON payload.approval_entry_id=party_entry.id WHERE party_entry.domain='dcl' AND party_entry.entity='party' AND party_entry.subject_id=relationship.party_id AND party_entry.status='APPROVED' ORDER BY party_entry.version_no DESC LIMIT 1) current ON true WHERE relationship.object_id=entry.subject_id)
    WHEN 'other-unit' THEN (SELECT current.display_name FROM dcl_service_relationships relationship JOIN LATERAL (SELECT payload.display_name FROM approval_entries party_entry JOIN dcl_party_versions payload ON payload.approval_entry_id=party_entry.id WHERE party_entry.domain='dcl' AND party_entry.entity='party' AND party_entry.subject_id=relationship.party_id AND party_entry.status='APPROVED' ORDER BY party_entry.version_no DESC LIMIT 1) current ON true WHERE relationship.object_id=entry.subject_id)
    WHEN 'employee' THEN (SELECT party.display_name FROM dcl_employment_relationships relationship JOIN LATERAL (SELECT payload.display_name FROM approval_entries party_entry JOIN dcl_party_versions payload ON payload.approval_entry_id=party_entry.id WHERE party_entry.domain='dcl' AND party_entry.entity='party' AND party_entry.subject_id=relationship.party_id AND party_entry.status='APPROVED' ORDER BY party_entry.version_no DESC LIMIT 1) party ON true WHERE relationship.object_id=entry.subject_id AND relationship.merged_into_object_id IS NULL)
    WHEN 'sales-partner' THEN (SELECT current.display_name FROM dcl_sales_relationships relationship JOIN LATERAL (SELECT payload.display_name FROM approval_entries party_entry JOIN dcl_party_versions payload ON payload.approval_entry_id=party_entry.id WHERE party_entry.domain='dcl' AND party_entry.entity='party' AND party_entry.subject_id=relationship.party_id AND party_entry.status='APPROVED' ORDER BY party_entry.version_no DESC LIMIT 1) current ON true WHERE relationship.object_id=entry.subject_id)
    WHEN 'product' THEN (SELECT payload.name FROM dcl_product_versions payload WHERE payload.approval_entry_id=entry.id)
    WHEN 'warehouse' THEN (SELECT payload.name FROM dcl_warehouse_versions payload WHERE payload.approval_entry_id=entry.id)
    WHEN 'vehicle' THEN (SELECT payload.name FROM dcl_vehicle_versions payload WHERE payload.approval_entry_id=entry.id)
    WHEN 'fund-account' THEN (SELECT payload.name FROM dcl_fund_account_versions payload WHERE payload.approval_entry_id=entry.id)
    WHEN 'operating-entity' THEN (SELECT payload.legal_name FROM dcl_operating_entity_versions payload WHERE payload.approval_entry_id=entry.id)
    WHEN 'acc-mapping' THEN mapping_book.name || ' · ' || mapping.vou_entity
    WHEN 'rpt-definition' THEN (SELECT payload.name FROM dcl_rpt_definition_versions payload WHERE payload.approval_entry_id=entry.id)
    ELSE ''
  END AS name
) named
WHERE entry.domain='dcl'
  AND entry.entity IN ('operating-entity','warehouse','vehicle','fund-account','product','party','employee','supplier','other-unit','sales-partner','customer','customer-account','acc-mapping','rpt-definition')
  AND (
    (entry.status = 'DRAFT' AND entry.entity = ANY(sqlc.arg(draft_entities)::text[]))
    OR (
      entry.status = 'PENDING'
      AND (
        (
          entry.entity = ANY(sqlc.arg(pending_entities)::text[])
          AND entry.submitted_by IS DISTINCT FROM sqlc.arg(actor_id)::text
        )
        OR entry.entity = ANY(sqlc.arg(unsubmit_entities)::text[])
      )
    )
  )
  AND (
    sqlc.arg(keyword)::text = ''
    OR subject.code ILIKE '%' || sqlc.arg(keyword) || '%'
    OR mapping.vou_entity ILIKE '%' || sqlc.arg(keyword) || '%'
    OR mapping_book.name ILIKE '%' || sqlc.arg(keyword) || '%'
    OR named.name ILIKE '%' || sqlc.arg(keyword) || '%'
  )
ORDER BY COALESCE(subject.created_at,mapping.updated_at,entry.updated_at) DESC, entry.subject_id ASC
LIMIT sqlc.arg(page_size) OFFSET sqlc.arg(page_offset);

-- name: CountWorkbenchVouItems :one
SELECT count(*)
FROM vou_documents document
JOIN approval_entries approval
  ON approval.id=document.approval_entry_id
 AND approval.domain='vou' AND approval.entity=document.entity AND approval.subject_id=document.id
WHERE (
    (approval.status = 'DRAFT' AND document.entity = ANY(sqlc.arg(draft_entities)::text[]))
    OR (approval.status = 'PENDING' AND document.entity = ANY(sqlc.arg(pending_entities)::text[]))
  )
  AND (
    sqlc.arg(keyword)::text = ''
    OR document.document_no ILIKE '%' || sqlc.arg(keyword) || '%'
    OR EXISTS (
      SELECT 1
      FROM (
        SELECT customer_name AS party_name FROM vou_sale_order_details WHERE document_id = document.id
        UNION ALL SELECT customer_name FROM vou_sale_outbound_details WHERE document_id = document.id
        UNION ALL SELECT customer_name FROM vou_sale_delivery_details WHERE document_id = document.id
        UNION ALL SELECT customer_name FROM vou_sale_signoff_details WHERE document_id = document.id
        UNION ALL SELECT customer_name FROM vou_sale_return_details WHERE document_id = document.id
        UNION ALL SELECT supplier_name FROM vou_purchase_inquiry_details WHERE document_id = document.id
        UNION ALL SELECT supplier_name FROM vou_purchase_order_details WHERE document_id = document.id
        UNION ALL SELECT supplier_name FROM vou_purchase_inbound_details WHERE document_id = document.id
        UNION ALL SELECT supplier_name FROM vou_purchase_return_details WHERE document_id = document.id
        UNION ALL SELECT counterparty_name FROM vou_receipt_details WHERE document_id = document.id
        UNION ALL SELECT counterparty_name FROM vou_payment_details WHERE document_id = document.id
        UNION ALL SELECT employee_name FROM vou_expense_reimbursement_details WHERE document_id = document.id
        UNION ALL SELECT employee_name FROM vou_employee_loan_writeoff_details WHERE document_id = document.id
        UNION ALL SELECT COALESCE(NULLIF(counterparty_name, ''), source_name) FROM vou_other_income_details WHERE document_id = document.id
      ) parties
      WHERE parties.party_name ILIKE '%' || sqlc.arg(keyword) || '%'
    )
  );

-- name: ListWorkbenchVouItems :many
SELECT document.id AS document_id, document.entity, document.document_no,
       approval.status, approval.revision, document.business_date::text AS business_date,
       COALESCE(document.currency, '') AS currency, document.total_amount_cents,
       approval.updated_at,
       COALESCE(so.customer_name, sob.customer_name, sd.customer_name, ss.customer_name,
                sr.customer_name, pqi.supplier_name, po.supplier_name, pi.supplier_name, pr.supplier_name,
                receipt.counterparty_name, payment.counterparty_name, expense.employee_name, writeoff.employee_name,
                NULLIF(income.counterparty_name, ''), income.source_name, '') AS party_name
FROM vou_documents document
JOIN approval_entries approval
  ON approval.id=document.approval_entry_id
 AND approval.domain='vou' AND approval.entity=document.entity AND approval.subject_id=document.id
LEFT JOIN vou_sale_order_details so ON so.document_id = document.id
LEFT JOIN vou_sale_outbound_details sob ON sob.document_id = document.id
LEFT JOIN vou_sale_delivery_details sd ON sd.document_id = document.id
LEFT JOIN vou_sale_signoff_details ss ON ss.document_id = document.id
LEFT JOIN vou_sale_return_details sr ON sr.document_id = document.id
LEFT JOIN vou_purchase_inquiry_details pqi ON pqi.document_id = document.id
LEFT JOIN vou_purchase_order_details po ON po.document_id = document.id
LEFT JOIN vou_purchase_inbound_details pi ON pi.document_id = document.id
LEFT JOIN vou_purchase_return_details pr ON pr.document_id = document.id
LEFT JOIN vou_receipt_details receipt ON receipt.document_id = document.id
LEFT JOIN vou_payment_details payment ON payment.document_id = document.id
LEFT JOIN vou_expense_reimbursement_details expense ON expense.document_id = document.id
LEFT JOIN vou_employee_loan_writeoff_details writeoff ON writeoff.document_id = document.id
LEFT JOIN vou_other_income_details income ON income.document_id = document.id
WHERE (
    (approval.status = 'DRAFT' AND document.entity = ANY(sqlc.arg(draft_entities)::text[]))
    OR (approval.status = 'PENDING' AND document.entity = ANY(sqlc.arg(pending_entities)::text[]))
  )
  AND (
    sqlc.arg(keyword)::text = ''
    OR document.document_no ILIKE '%' || sqlc.arg(keyword) || '%'
    OR COALESCE(so.customer_name, sob.customer_name, sd.customer_name, ss.customer_name,
                sr.customer_name, pqi.supplier_name, po.supplier_name, pi.supplier_name, pr.supplier_name,
                receipt.counterparty_name, payment.counterparty_name, expense.employee_name, writeoff.employee_name,
                NULLIF(income.counterparty_name, ''), income.source_name, '')
       ILIKE '%' || sqlc.arg(keyword) || '%'
  )
ORDER BY approval.updated_at DESC, document.id ASC
LIMIT sqlc.arg(page_size) OFFSET sqlc.arg(page_offset);

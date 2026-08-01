-- name: CountWorkbenchBobItems :one
SELECT count(*)
FROM bob_version_views view
WHERE view.version_id = view.current_version_id
  AND (
    (view.status = 'DRAFT' AND view.entity = ANY(sqlc.arg(draft_entities)::text[]))
    OR (view.status = 'PENDING' AND view.entity = ANY(sqlc.arg(pending_entities)::text[]))
  )
  AND (
    sqlc.arg(keyword)::text = ''
    OR view.code ILIKE '%' || sqlc.arg(keyword) || '%'
    OR view.name ILIKE '%' || sqlc.arg(keyword) || '%'
  );

-- name: ListWorkbenchBobItems :many
SELECT view.object_id, view.entity, view.code, view.name, view.object_revision,
       view.version_id, view.status, view.version_revision, view.object_updated_at
FROM bob_version_views view
WHERE view.version_id = view.current_version_id
  AND (
    (view.status = 'DRAFT' AND view.entity = ANY(sqlc.arg(draft_entities)::text[]))
    OR (view.status = 'PENDING' AND view.entity = ANY(sqlc.arg(pending_entities)::text[]))
  )
  AND (
    sqlc.arg(keyword)::text = ''
    OR view.code ILIKE '%' || sqlc.arg(keyword) || '%'
    OR view.name ILIKE '%' || sqlc.arg(keyword) || '%'
  )
ORDER BY view.object_updated_at DESC, view.object_id ASC
LIMIT sqlc.arg(page_size) OFFSET sqlc.arg(page_offset);

-- name: CountWorkbenchVouItems :one
SELECT count(*)
FROM vou_documents document
WHERE (
    (document.status = 'DRAFT' AND document.entity = ANY(sqlc.arg(draft_entities)::text[]))
    OR (document.status = 'CHECKED' AND document.entity = ANY(sqlc.arg(checked_entities)::text[]))
    OR (document.status = 'APPROVED' AND document.entity = ANY(sqlc.arg(approved_entities)::text[]))
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
        UNION ALL SELECT supplier_name FROM vou_purchase_order_details WHERE document_id = document.id
        UNION ALL SELECT supplier_name FROM vou_purchase_inbound_details WHERE document_id = document.id
        UNION ALL SELECT supplier_name FROM vou_purchase_return_details WHERE document_id = document.id
        UNION ALL SELECT counterparty_name FROM vou_receipt_details WHERE document_id = document.id
        UNION ALL SELECT counterparty_name FROM vou_payment_details WHERE document_id = document.id
        UNION ALL SELECT employee_name FROM vou_expense_reimbursement_details WHERE document_id = document.id
        UNION ALL SELECT COALESCE(NULLIF(counterparty_name, ''), source_name) FROM vou_other_income_details WHERE document_id = document.id
      ) parties
      WHERE parties.party_name ILIKE '%' || sqlc.arg(keyword) || '%'
    )
  );

-- name: ListWorkbenchVouItems :many
SELECT document.id AS document_id, document.entity, document.document_no,
       document.status, document.revision, document.business_date::text AS business_date,
       COALESCE(document.currency, '') AS currency, document.total_amount_cents,
       document.updated_at,
       COALESCE(so.customer_name, sob.customer_name, sd.customer_name, ss.customer_name,
                sr.customer_name, po.supplier_name, pi.supplier_name, pr.supplier_name,
                receipt.counterparty_name, payment.counterparty_name, expense.employee_name,
                NULLIF(income.counterparty_name, ''), income.source_name, '') AS party_name
FROM vou_documents document
LEFT JOIN vou_sale_order_details so ON so.document_id = document.id
LEFT JOIN vou_sale_outbound_details sob ON sob.document_id = document.id
LEFT JOIN vou_sale_delivery_details sd ON sd.document_id = document.id
LEFT JOIN vou_sale_signoff_details ss ON ss.document_id = document.id
LEFT JOIN vou_sale_return_details sr ON sr.document_id = document.id
LEFT JOIN vou_purchase_order_details po ON po.document_id = document.id
LEFT JOIN vou_purchase_inbound_details pi ON pi.document_id = document.id
LEFT JOIN vou_purchase_return_details pr ON pr.document_id = document.id
LEFT JOIN vou_receipt_details receipt ON receipt.document_id = document.id
LEFT JOIN vou_payment_details payment ON payment.document_id = document.id
LEFT JOIN vou_expense_reimbursement_details expense ON expense.document_id = document.id
LEFT JOIN vou_other_income_details income ON income.document_id = document.id
WHERE (
    (document.status = 'DRAFT' AND document.entity = ANY(sqlc.arg(draft_entities)::text[]))
    OR (document.status = 'CHECKED' AND document.entity = ANY(sqlc.arg(checked_entities)::text[]))
    OR (document.status = 'APPROVED' AND document.entity = ANY(sqlc.arg(approved_entities)::text[]))
  )
  AND (
    sqlc.arg(keyword)::text = ''
    OR document.document_no ILIKE '%' || sqlc.arg(keyword) || '%'
    OR COALESCE(so.customer_name, sob.customer_name, sd.customer_name, ss.customer_name,
                sr.customer_name, po.supplier_name, pi.supplier_name, pr.supplier_name,
                receipt.counterparty_name, payment.counterparty_name, expense.employee_name,
                NULLIF(income.counterparty_name, ''), income.source_name, '')
       ILIKE '%' || sqlc.arg(keyword) || '%'
  )
ORDER BY document.updated_at DESC, document.id ASC
LIMIT sqlc.arg(page_size) OFFSET sqlc.arg(page_offset);

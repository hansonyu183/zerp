-- name: QueryAuxReferenceCandidates :many
SELECT
    o.id AS object_id,
    a.id AS approval_entry_id,
    o.code,
    COALESCE(p.data->>'name', '')::text AS name
FROM aux_objects o
JOIN approval_entries a
  ON a.domain = 'aux'
 AND a.entity = o.entity
 AND a.subject_id = o.id
 AND a.status = 'APPROVED'
 AND NOT EXISTS (
     SELECT 1
     FROM approval_entries newer
     WHERE newer.domain = a.domain
       AND newer.entity = a.entity
       AND newer.subject_id = a.subject_id
       AND newer.status = 'APPROVED'
       AND newer.version_no > a.version_no
 )
JOIN aux_version_payloads p ON p.approval_entry_id = a.id
WHERE o.entity = sqlc.arg(entity)
  AND o.enabled
  AND (
      sqlc.arg(keyword)::text = ''
      OR o.code ILIKE '%' || sqlc.arg(keyword)::text || '%'
      OR COALESCE(p.data->>'name', '') ILIKE '%' || sqlc.arg(keyword)::text || '%'
  )
  AND (
      sqlc.arg(dictionary_type_code)::text = ''
      OR p.data->>'dictionaryTypeCode' = sqlc.arg(dictionary_type_code)::text
  )
ORDER BY COALESCE((p.data->>'sortOrder')::integer, 2147483647), o.code, o.id
LIMIT 20;

-- name: GetAuxVersionData :one
SELECT data
FROM aux_version_payloads
WHERE approval_entry_id = sqlc.arg(approval_entry_id)
  AND object_id = sqlc.arg(object_id)
  AND entity = sqlc.arg(entity);

-- name: IsBobCustomerPaymentMethodReferenced :one
SELECT EXISTS(
    SELECT 1
FROM bob_customer_versions customer
    JOIN approval_entries entry
      ON entry.id = customer.approval_entry_id
     AND entry.domain = 'bob'
     AND entry.entity = 'customer-account'
     AND entry.status = 'APPROVED'
    WHERE customer.payment_method_id = sqlc.arg(object_id)::text
      AND NOT EXISTS (
          SELECT 1 FROM approval_entries newer
          WHERE newer.domain = entry.domain
            AND newer.entity = entry.entity
            AND newer.subject_id = entry.subject_id
            AND newer.status = 'APPROVED'
            AND newer.version_no > entry.version_no
      )
);

-- name: IsAuxApprovalEntryReferenced :one
WITH current_bob_entries AS (
    SELECT entry.id
    FROM approval_entries entry
    WHERE entry.domain='bob' AND entry.status='APPROVED'
      AND NOT EXISTS (
          SELECT 1 FROM approval_entries newer
          WHERE newer.domain=entry.domain AND newer.entity=entry.entity
            AND newer.subject_id=entry.subject_id AND newer.status='APPROVED'
            AND newer.version_no>entry.version_no
      )
), bob_refs AS (
    SELECT category_approval_entry_id AS entry_id FROM bob_customer_relationship_attachments
    UNION ALL SELECT attachment.category_approval_entry_id FROM bob_customer_version_attachments attachment JOIN current_bob_entries current_entry ON current_entry.id=attachment.approval_entry_id
    UNION ALL SELECT reference.entry_id FROM bob_customer_versions payload JOIN current_bob_entries current_entry ON current_entry.id=payload.approval_entry_id CROSS JOIN LATERAL unnest(ARRAY[payload.category_approval_entry_id,payload.settlement_method_approval_entry_id,payload.payment_method_approval_entry_id]) reference(entry_id)
    UNION ALL SELECT reference.entry_id FROM bob_employee_versions payload JOIN current_bob_entries current_entry ON current_entry.id=payload.approval_entry_id CROSS JOIN LATERAL unnest(ARRAY[payload.category_approval_entry_id,payload.department_approval_entry_id,payload.position_approval_entry_id]) reference(entry_id)
    UNION ALL SELECT payload.category_approval_entry_id FROM bob_fund_account_versions payload JOIN current_bob_entries current_entry ON current_entry.id=payload.approval_entry_id
    UNION ALL SELECT payload.entered_unit_approval_entry_id FROM bob_product_formula_lines payload JOIN current_bob_entries current_entry ON current_entry.id=payload.product_approval_entry_id
    UNION ALL SELECT payload.output_unit_approval_entry_id FROM bob_product_formulas payload JOIN current_bob_entries current_entry ON current_entry.id=payload.product_approval_entry_id
    UNION ALL SELECT payload.unit_approval_entry_id FROM bob_product_unit_conversions payload JOIN current_bob_entries current_entry ON current_entry.id=payload.product_approval_entry_id
    UNION ALL SELECT reference.entry_id FROM bob_product_versions payload JOIN current_bob_entries current_entry ON current_entry.id=payload.approval_entry_id CROSS JOIN LATERAL unnest(ARRAY[payload.category_approval_entry_id,payload.pricing_unit_approval_entry_id,payload.product_type_approval_entry_id,payload.default_input_unit_approval_entry_id]) reference(entry_id)
    UNION ALL SELECT payload.settlement_method_approval_entry_id FROM bob_service_relationship_versions payload JOIN current_bob_entries current_entry ON current_entry.id=payload.approval_entry_id
    UNION ALL SELECT reference.entry_id FROM bob_supplier_versions payload JOIN current_bob_entries current_entry ON current_entry.id=payload.approval_entry_id CROSS JOIN LATERAL unnest(ARRAY[payload.category_approval_entry_id,payload.settlement_method_approval_entry_id]) reference(entry_id)
    UNION ALL SELECT payload.vehicle_type_approval_entry_id FROM dcl_vehicle_versions payload JOIN approval_entries current_entry ON current_entry.id=payload.approval_entry_id WHERE current_entry.domain='dcl' AND current_entry.entity='vehicle' AND current_entry.status='APPROVED' AND NOT EXISTS (SELECT 1 FROM approval_entries newer WHERE newer.domain='dcl' AND newer.entity='vehicle' AND newer.subject_id=current_entry.subject_id AND newer.status='APPROVED' AND newer.version_no>current_entry.version_no)
    UNION ALL SELECT payload.category_approval_entry_id FROM dcl_warehouse_versions payload
      JOIN approval_entries current_entry ON current_entry.id=payload.approval_entry_id
       AND current_entry.domain='dcl' AND current_entry.entity='warehouse' AND current_entry.status='APPROVED'
      WHERE NOT EXISTS (SELECT 1 FROM approval_entries newer WHERE newer.domain='dcl' AND newer.entity='warehouse' AND newer.subject_id=current_entry.subject_id AND newer.status='APPROVED' AND newer.version_no>current_entry.version_no)
), vou_refs AS (
    SELECT reference.entry_id FROM vou_asset_acquisition_lines payload CROSS JOIN LATERAL unnest(ARRAY[payload.category_approval_entry_id,payload.department_approval_entry_id]) reference(entry_id)
    UNION ALL SELECT payload.entered_unit_approval_entry_id FROM vou_inventory_count_lines payload
    UNION ALL SELECT payload.product_type_approval_entry_id FROM vou_price_lines payload
    UNION ALL SELECT reference.entry_id FROM vou_product_lines payload CROSS JOIN LATERAL unnest(ARRAY[payload.entered_unit_approval_entry_id,payload.product_type_approval_entry_id]) reference(entry_id)
    UNION ALL SELECT payload.actual_entered_unit_approval_entry_id FROM vou_production_material_lines payload
    UNION ALL SELECT payload.entered_unit_approval_entry_id FROM vou_production_output_lines payload
    UNION ALL SELECT payload.settlement_method_approval_entry_id FROM vou_purchase_order_details payload
    UNION ALL SELECT payload.settlement_method_approval_entry_id FROM vou_sale_order_details payload
    UNION ALL SELECT payload.entered_unit_approval_entry_id FROM vou_sale_order_formula_lines payload
    UNION ALL SELECT payload.output_entered_unit_approval_entry_id FROM vou_sale_order_formulas payload
    UNION ALL SELECT payload.settlement_method_approval_entry_id FROM vou_service_contract_details payload
)
SELECT EXISTS(
    SELECT 1 FROM bob_refs WHERE entry_id=sqlc.arg(approval_entry_id)::text
    UNION ALL
    SELECT 1 FROM vou_refs WHERE entry_id=sqlc.arg(approval_entry_id)::text
);

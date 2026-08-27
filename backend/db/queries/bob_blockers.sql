-- Exact BOB Approval-entry blocker projection. Only the latest APPROVED
-- payload of each referencing object is a current formal reference; each row
-- is matched by the immutable snapshot entry rather than the stable object.
-- name: ListBobApprovalEntryReferenceCounts :many
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
), snapshot_references(entity, field, entry_id) AS (
    SELECT 'customer-account','customer-salesperson',payload.salesperson_employee_approval_entry_id
    FROM bob_customer_versions payload JOIN current_bob_entries current_entry ON current_entry.id=payload.approval_entry_id
    UNION ALL SELECT 'customer-account','customer-operating',payload.operating_entity_approval_entry_id
    FROM bob_customer_versions payload JOIN current_bob_entries current_entry ON current_entry.id=payload.approval_entry_id
    UNION ALL SELECT 'customer-account',CASE payload.primary_sales_attribution_type
        WHEN 'INTERNAL_EMPLOYEE' THEN 'customer-sales'
        WHEN 'EXTERNAL_PART_TIME' THEN 'customer-external-sales'
        ELSE 'customer-channel-sales' END,payload.primary_sales_subject_approval_entry_id
    FROM bob_customer_versions payload JOIN current_bob_entries current_entry ON current_entry.id=payload.approval_entry_id
    WHERE payload.primary_sales_attribution_type IS NOT NULL
    UNION ALL SELECT 'supplier','supplier-purchaser',payload.default_purchaser_employee_approval_entry_id
    FROM bob_supplier_versions payload JOIN current_bob_entries current_entry ON current_entry.id=payload.approval_entry_id
    UNION ALL SELECT 'fund-account','fund-operating',payload.operating_entity_approval_entry_id
    FROM dcl_fund_account_versions payload JOIN approval_entries current_entry ON current_entry.id=payload.approval_entry_id
    WHERE current_entry.domain='dcl' AND current_entry.entity='fund-account' AND current_entry.status='APPROVED'
      AND NOT EXISTS (SELECT 1 FROM approval_entries newer WHERE newer.domain='dcl' AND newer.entity='fund-account' AND newer.subject_id=current_entry.subject_id AND newer.status='APPROVED' AND newer.version_no>current_entry.version_no)
    UNION ALL SELECT 'product','formula-material',payload.material_approval_entry_id
    FROM bob_product_formula_lines payload JOIN current_bob_entries current_entry ON current_entry.id=payload.product_approval_entry_id
    UNION ALL SELECT 'vehicle','vehicle-carrier-operating',payload.carrier_operating_entity_approval_entry_id
    FROM dcl_vehicle_versions payload JOIN approval_entries current_entry ON current_entry.id=payload.approval_entry_id WHERE current_entry.domain='dcl' AND current_entry.entity='vehicle' AND current_entry.status='APPROVED' AND NOT EXISTS (SELECT 1 FROM approval_entries newer WHERE newer.domain='dcl' AND newer.entity='vehicle' AND newer.subject_id=current_entry.subject_id AND newer.status='APPROVED' AND newer.version_no>current_entry.version_no)
    UNION ALL SELECT 'vehicle','vehicle-carrier-service',payload.carrier_service_relationship_approval_entry_id
    FROM dcl_vehicle_versions payload JOIN approval_entries current_entry ON current_entry.id=payload.approval_entry_id WHERE current_entry.domain='dcl' AND current_entry.entity='vehicle' AND current_entry.status='APPROVED' AND NOT EXISTS (SELECT 1 FROM approval_entries newer WHERE newer.domain='dcl' AND newer.entity='vehicle' AND newer.subject_id=current_entry.subject_id AND newer.status='APPROVED' AND newer.version_no>current_entry.version_no)
    UNION ALL SELECT 'warehouse','warehouse-manager',payload.manager_employee_approval_entry_id
    FROM dcl_warehouse_versions payload JOIN approval_entries current_entry ON current_entry.id=payload.approval_entry_id
    WHERE current_entry.domain='dcl' AND current_entry.entity='warehouse' AND current_entry.status='APPROVED'
      AND NOT EXISTS (SELECT 1 FROM approval_entries newer WHERE newer.domain='dcl' AND newer.entity='warehouse' AND newer.subject_id=current_entry.subject_id AND newer.status='APPROVED' AND newer.version_no>current_entry.version_no)
)
SELECT entity::text, field::text, count(*)::bigint AS reference_count
FROM snapshot_references
WHERE entry_id=sqlc.arg(approval_entry_id)::text
GROUP BY entity,field
ORDER BY entity,field;

-- Exact VOU Approval-entry blocker projection. Every typed VOU snapshot
-- participates in all document states; physical deletion removes the row.
-- name: ListVouApprovalEntryReferenceCounts :many
WITH snapshot_references(entity, field, entry_id) AS (
    SELECT 'vou_asset_acquisition_details','snapshot',unnest(ARRAY[supplier_approval_entry_id]) FROM vou_asset_acquisition_details
    UNION ALL SELECT 'vou_asset_acquisition_lines','snapshot',unnest(ARRAY[category_approval_entry_id,department_approval_entry_id,custodian_approval_entry_id]) FROM vou_asset_acquisition_lines
    UNION ALL SELECT 'vou_asset_sale_details','snapshot',unnest(ARRAY[counterparty_approval_entry_id]) FROM vou_asset_sale_details
    UNION ALL SELECT 'vou_bill_cash_lines','snapshot',unnest(ARRAY[fund_account_approval_entry_id]) FROM vou_bill_cash_lines
    UNION ALL SELECT 'vou_bill_details','snapshot',unnest(ARRAY[counterparty_approval_entry_id,handler_approval_entry_id,interest_party_approval_entry_id]) FROM vou_bill_details
    UNION ALL SELECT 'vou_employee_loan_writeoff_details','snapshot',unnest(ARRAY[employee_approval_entry_id]) FROM vou_employee_loan_writeoff_details
    UNION ALL SELECT 'vou_expense_payment_details','snapshot',unnest(ARRAY[employee_approval_entry_id,fund_account_approval_entry_id]) FROM vou_expense_payment_details
    UNION ALL SELECT 'vou_expense_reimbursement_details','snapshot',unnest(ARRAY[employee_approval_entry_id]) FROM vou_expense_reimbursement_details
    UNION ALL SELECT 'vou_intermediary_calculation_summaries','snapshot',unnest(ARRAY[payee_approval_entry_id]) FROM vou_intermediary_calculation_summaries
    UNION ALL SELECT 'vou_inventory_count_details','snapshot',unnest(ARRAY[warehouse_approval_entry_id]) FROM vou_inventory_count_details
    UNION ALL SELECT 'vou_inventory_count_lines','snapshot',unnest(ARRAY[product_approval_entry_id,entered_unit_approval_entry_id]) FROM vou_inventory_count_lines
    UNION ALL SELECT 'vou_other_income_details','snapshot',unnest(ARRAY[counterparty_approval_entry_id,fund_account_approval_entry_id,handler_approval_entry_id]) FROM vou_other_income_details
    UNION ALL SELECT 'vou_payment_details','snapshot',unnest(ARRAY[counterparty_approval_entry_id,fund_account_approval_entry_id,handler_approval_entry_id]) FROM vou_payment_details
    UNION ALL SELECT 'vou_price_lines','snapshot',unnest(ARRAY[product_approval_entry_id,product_type_approval_entry_id]) FROM vou_price_lines
    UNION ALL SELECT 'vou_product_lines','snapshot',unnest(ARRAY[product_approval_entry_id,entered_unit_approval_entry_id,product_type_approval_entry_id]) FROM vou_product_lines
    UNION ALL SELECT 'vou_production_details','snapshot',unnest(ARRAY[material_warehouse_approval_entry_id,finished_warehouse_approval_entry_id]) FROM vou_production_details
    UNION ALL SELECT 'vou_production_material_lines','snapshot',unnest(ARRAY[formula_material_approval_entry_id,actual_material_approval_entry_id,actual_entered_unit_approval_entry_id]) FROM vou_production_material_lines
    UNION ALL SELECT 'vou_production_output_lines','snapshot',unnest(ARRAY[product_approval_entry_id,entered_unit_approval_entry_id]) FROM vou_production_output_lines
    UNION ALL SELECT 'vou_purchase_inbound_details','snapshot',unnest(ARRAY[supplier_approval_entry_id,warehouse_approval_entry_id]) FROM vou_purchase_inbound_details
    UNION ALL SELECT 'vou_purchase_inbound_lines','snapshot',unnest(ARRAY[product_approval_entry_id]) FROM vou_purchase_inbound_lines
    UNION ALL SELECT 'vou_purchase_inquiry_details','snapshot',unnest(ARRAY[supplier_approval_entry_id]) FROM vou_purchase_inquiry_details
    UNION ALL SELECT 'vou_purchase_order_details','snapshot',unnest(ARRAY[supplier_approval_entry_id,purchaser_approval_entry_id,warehouse_approval_entry_id,settlement_method_approval_entry_id]) FROM vou_purchase_order_details
    UNION ALL SELECT 'vou_purchase_return_details','snapshot',unnest(ARRAY[supplier_approval_entry_id,warehouse_approval_entry_id]) FROM vou_purchase_return_details
    UNION ALL SELECT 'vou_purchase_return_lines','snapshot',unnest(ARRAY[product_approval_entry_id]) FROM vou_purchase_return_lines
    UNION ALL SELECT 'vou_receipt_details','snapshot',unnest(ARRAY[counterparty_approval_entry_id,fund_account_approval_entry_id,handler_approval_entry_id]) FROM vou_receipt_details
    UNION ALL SELECT 'vou_sale_delivery_details','snapshot',unnest(ARRAY[customer_approval_entry_id,carrier_service_relationship_approval_entry_id,vehicle_approval_entry_id,carrier_operating_entity_approval_entry_id]) FROM vou_sale_delivery_details
    UNION ALL SELECT 'vou_sale_order_details','snapshot',unnest(ARRAY[customer_approval_entry_id,salesperson_approval_entry_id,settlement_method_approval_entry_id,warehouse_approval_entry_id,sales_attribution_subject_approval_entry_id]) FROM vou_sale_order_details
    UNION ALL SELECT 'vou_sale_order_formula_lines','snapshot',unnest(ARRAY[material_approval_entry_id,entered_unit_approval_entry_id]) FROM vou_sale_order_formula_lines
    UNION ALL SELECT 'vou_sale_order_formulas','snapshot',unnest(ARRAY[output_entered_unit_approval_entry_id]) FROM vou_sale_order_formulas
    UNION ALL SELECT 'vou_sale_outbound_details','snapshot',unnest(ARRAY[customer_approval_entry_id,warehouse_approval_entry_id]) FROM vou_sale_outbound_details
    UNION ALL SELECT 'vou_sale_outbound_lines','snapshot',unnest(ARRAY[product_approval_entry_id]) FROM vou_sale_outbound_lines
    UNION ALL SELECT 'vou_sale_return_details','snapshot',unnest(ARRAY[customer_approval_entry_id,warehouse_approval_entry_id]) FROM vou_sale_return_details
    UNION ALL SELECT 'vou_sale_return_lines','snapshot',unnest(ARRAY[product_approval_entry_id]) FROM vou_sale_return_lines
    UNION ALL SELECT 'vou_sale_signoff_details','snapshot',unnest(ARRAY[customer_approval_entry_id,warehouse_approval_entry_id]) FROM vou_sale_signoff_details
    UNION ALL SELECT 'vou_sale_signoff_lines','snapshot',unnest(ARRAY[product_approval_entry_id]) FROM vou_sale_signoff_lines
    UNION ALL SELECT 'vou_service_contract_details','snapshot',unnest(ARRAY[counterparty_approval_entry_id,operating_entity_approval_entry_id,handler_approval_entry_id,settlement_method_approval_entry_id]) FROM vou_service_contract_details
)
SELECT entity::text, field::text, count(*)::bigint AS reference_count
FROM snapshot_references
WHERE entry_id=sqlc.arg(approval_entry_id)::text
GROUP BY entity,field
ORDER BY entity,field;

-- name: GetVouIntermediaryScript :one
SELECT * FROM vou_intermediary_scripts WHERE singleton = true;

-- name: LockVouIntermediaryScript :one
SELECT * FROM vou_intermediary_scripts WHERE singleton = true FOR UPDATE;

-- name: UpdateVouIntermediaryScript :one
UPDATE vou_intermediary_scripts
SET revision = revision + 1,
    name = sqlc.arg(name),
    source = sqlc.arg(source),
    source_hash = sqlc.arg(source_hash),
    updated_at = now(),
    updated_by = sqlc.arg(updated_by)
WHERE singleton = true AND revision = sqlc.arg(revision)
RETURNING *;

-- name: InsertVouIntermediaryCalculationDetail :exec
INSERT INTO vou_intermediary_calculation_details(
    document_id,period_start,period_end,source_hash,source_snapshot,
    script_id,script_revision,script_name,script_source,script_hash,result_snapshot
) VALUES (
    sqlc.arg(document_id),sqlc.arg(period_start),sqlc.arg(period_end),
    sqlc.arg(source_hash),sqlc.arg(source_snapshot),sqlc.arg(script_id),
    sqlc.arg(script_revision),sqlc.arg(script_name),sqlc.arg(script_source),
    sqlc.arg(script_hash),sqlc.arg(result_snapshot)
);

-- name: UpdateVouIntermediaryCalculationDetail :execrows
UPDATE vou_intermediary_calculation_details
SET period_start=sqlc.arg(period_start),period_end=sqlc.arg(period_end),
    source_hash=sqlc.arg(source_hash),source_snapshot=sqlc.arg(source_snapshot),
    script_id=sqlc.arg(script_id),script_revision=sqlc.arg(script_revision),
    script_name=sqlc.arg(script_name),script_source=sqlc.arg(script_source),
    script_hash=sqlc.arg(script_hash),result_snapshot=sqlc.arg(result_snapshot)
WHERE document_id=sqlc.arg(document_id);

-- name: GetVouIntermediaryCalculationDetail :one
SELECT * FROM vou_intermediary_calculation_details
WHERE document_id=sqlc.arg(document_id);

-- name: DeleteVouIntermediaryCalculationLines :exec
DELETE FROM vou_intermediary_calculation_lines
WHERE document_id=sqlc.arg(document_id);

-- name: InsertVouIntermediaryCalculationLine :exec
INSERT INTO vou_intermediary_calculation_lines(
    id,document_id,line_no,source_signoff_line_id,result,
    employee_amount_cents,intermediary_amount_cents,rebate_amount_cents
) VALUES (
    sqlc.arg(id),sqlc.arg(document_id),sqlc.arg(line_no),
    sqlc.arg(source_signoff_line_id),sqlc.arg(result),
    sqlc.arg(employee_amount_cents),sqlc.arg(intermediary_amount_cents),
    sqlc.arg(rebate_amount_cents)
);

-- name: ListVouIntermediaryCalculationLines :many
SELECT * FROM vou_intermediary_calculation_lines
WHERE document_id=sqlc.arg(document_id) ORDER BY line_no;

-- name: DeleteVouIntermediaryCalculationBillAllocations :exec
DELETE FROM vou_intermediary_calculation_bill_allocations
WHERE document_id=sqlc.arg(document_id);

-- name: InsertVouIntermediaryCalculationBillAllocation :exec
INSERT INTO vou_intermediary_calculation_bill_allocations(
    document_id,bill_line_id,source_signoff_line_id
) VALUES (
    sqlc.arg(document_id),sqlc.arg(bill_line_id),sqlc.arg(source_signoff_line_id)
);

-- name: DeleteVouIntermediaryCalculationSummaries :exec
DELETE FROM vou_intermediary_calculation_summaries
WHERE document_id=sqlc.arg(document_id);

-- name: InsertVouIntermediaryCalculationSummary :exec
INSERT INTO vou_intermediary_calculation_summaries(
    id,document_id,line_no,category,payee_entity,payee_object_id,
    payee_version_id,payee_code,payee_name,amount_cents
) VALUES (
    sqlc.arg(id),sqlc.arg(document_id),sqlc.arg(line_no),sqlc.arg(category),
    sqlc.arg(payee_entity),sqlc.arg(payee_object_id),sqlc.arg(payee_version_id),
    sqlc.arg(payee_code),sqlc.arg(payee_name),sqlc.arg(amount_cents)
);

-- name: ListVouIntermediaryCalculationSummaries :many
SELECT * FROM vou_intermediary_calculation_summaries
WHERE document_id=sqlc.arg(document_id) ORDER BY line_no;

-- name: ListIntermediarySignoffSourceRows :many
WITH returned AS (
    SELECT return_line.source_signoff_line_id,
           sum(return_line.quantity_micros)::bigint AS quantity_micros,
           sum(return_line.line_amount_cents)::bigint AS amount_cents
    FROM vou_sale_return_lines return_line
    JOIN vou_sale_return_details return_detail
      ON return_detail.document_id=return_line.document_id
     AND return_detail.return_kind='AFTER_SALE'
    JOIN vou_documents return_document
      ON return_document.id=return_line.document_id
     AND return_document.entity='sale-return'
     AND return_document.status IN ('APPROVED','FINALIZED')
     AND return_document.business_date <= sqlc.arg(period_end)
    GROUP BY return_line.source_signoff_line_id
)
SELECT
    line.id AS source_signoff_line_id,
    signoff.id AS signoff_document_id,
    signoff.document_no AS signoff_document_no,
    signoff.business_date AS signoff_date,
    signoff.due_date AS due_date,
    order_document.id AS order_document_id,
    order_document.document_no AS order_document_no,
    order_document.business_date AS order_date,
    detail.customer_object_id,
    detail.customer_version_id,
    detail.customer_code,
    detail.customer_name,
    order_detail.salesperson_object_id,
    order_detail.salesperson_version_id,
    order_detail.salesperson_code,
    order_detail.salesperson_name,
    customer_version.intermediary_other_party_id,
    intermediary_object.effective_version_id AS intermediary_version_id,
    intermediary_object.code AS intermediary_code,
    intermediary_version.name AS intermediary_name,
    line.product_object_id,
    line.product_version_id,
    line.product_code,
    line.product_name,
    line.product_unit,
    order_line.product_kind,
    (line.signed_qty_micros-COALESCE(returned.quantity_micros,0))::bigint AS signed_qty_micros,
    order_line.pricing_quantity_per_inventory_unit_micros,
    line.unit_price_cents,
    order_line.reference_unit_price_cents,
    order_line.settlement_surcharge_cents,
    customer_version.rebate_unit_price_cents,
    (line.line_amount_cents-COALESCE(returned.amount_cents,0))::bigint AS line_amount_cents,
    order_detail.settlement_term_code,
    order_detail.special_approval
FROM vou_documents signoff
JOIN vou_sale_signoff_details detail ON detail.document_id=signoff.id
JOIN vou_sale_signoff_lines line ON line.document_id=signoff.id
JOIN vou_documents order_document ON order_document.id=detail.source_order_id
JOIN vou_sale_order_details order_detail ON order_detail.document_id=order_document.id
JOIN vou_product_lines order_line ON order_line.id=line.source_order_line_id
JOIN bob_customer_versions customer_version ON customer_version.version_id=detail.customer_version_id
LEFT JOIN bob_objects intermediary_object
  ON intermediary_object.id=customer_version.intermediary_other_party_id
 AND intermediary_object.entity='other-party'
LEFT JOIN bob_customer_versions intermediary_version
  ON intermediary_version.version_id=intermediary_object.effective_version_id
LEFT JOIN returned ON returned.source_signoff_line_id=line.id
WHERE signoff.entity='sale-signoff'
  AND signoff.status IN ('APPROVED','FINALIZED')
  AND signoff.business_date >= sqlc.arg(cutover_date)
  AND signoff.business_date <= sqlc.arg(period_end)
  AND signoff.currency='CNY'
  AND line.signed_qty_micros-COALESCE(returned.quantity_micros,0) > 0
ORDER BY detail.customer_object_id,signoff.business_date,signoff.document_no,line.line_no,line.id;

-- name: ListIntermediaryReturnAdjustmentRows :many
SELECT
    return_line.id AS return_line_id,
    return_line.source_signoff_line_id,
    return_line.quantity_micros,
    return_line.line_amount_cents,
    return_document.id AS return_document_id,
    return_document.document_no AS return_document_no,
    return_document.business_date AS return_date,
    original.document_id AS calculation_document_id,
    original.business_date AS calculation_date,
    original.result AS original_result,
    original.source_snapshot
FROM vou_sale_return_lines return_line
JOIN vou_sale_return_details return_detail
  ON return_detail.document_id=return_line.document_id
 AND return_detail.return_kind='AFTER_SALE'
JOIN vou_documents return_document
  ON return_document.id=return_line.document_id
 AND return_document.entity='sale-return'
 AND return_document.status IN ('APPROVED','FINALIZED')
JOIN LATERAL (
    SELECT calculation_document.id AS document_id,
           calculation_document.business_date,
           calculation_line.result,
           calculation_detail.source_snapshot
    FROM vou_intermediary_calculation_lines calculation_line
    JOIN vou_intermediary_calculation_details calculation_detail
      ON calculation_detail.document_id=calculation_line.document_id
    JOIN vou_documents calculation_document
      ON calculation_document.id=calculation_line.document_id
     AND calculation_document.entity='intermediary-calculation'
     AND calculation_document.status IN ('APPROVED','FINALIZED')
    WHERE calculation_line.source_signoff_line_id=return_line.source_signoff_line_id
      AND calculation_document.business_date < return_document.business_date
      AND (calculation_line.employee_amount_cents>0
        OR calculation_line.intermediary_amount_cents>0
        OR calculation_line.rebate_amount_cents>0)
    ORDER BY calculation_document.business_date,calculation_document.document_no
    LIMIT 1
) original ON true
WHERE return_document.business_date >= sqlc.arg(cutover_date)
  AND return_document.business_date <= sqlc.arg(period_end)
ORDER BY return_line.source_signoff_line_id,return_document.business_date,
         return_document.document_no,return_line.line_no,return_line.id;

-- name: ListIntermediaryCustomerTradeEvents :many
WITH trade AS (
    SELECT entry.*
    FROM led_party_entries entry
    WHERE entry.generation_id=sqlc.arg(generation_id)
      AND entry.account_type='TRADE'
      AND entry.counterparty_entity='customer'
      AND entry.currency='CNY'
), mapped AS (
    SELECT entry.counterparty_object_id,entry.effective_date,
           entry.amount_delta_cents
    FROM trade entry
    WHERE entry.source_entity NOT IN ('bill-receipt','sale-return')
    UNION ALL
    -- An after-sale return reduces the eligible signed quantity and its receivable
    -- at the return date; keeping it separate prevents treating returned quantity
    -- as a paid original sale.
    SELECT entry.counterparty_object_id,entry.effective_date,
           entry.amount_delta_cents
    FROM trade entry
    JOIN vou_sale_return_details return_detail
      ON return_detail.document_id=entry.source_document_id
     AND return_detail.return_kind='AFTER_SALE'
    WHERE entry.source_entity='sale-return'
    UNION ALL
    SELECT entry.counterparty_object_id,
           (CASE WHEN bill_line.bill_type='CHECK'
             THEN bill_line.maturity_date ELSE entry.effective_date END)::date,
           -bill_line.face_amount_cents
    FROM trade entry
    JOIN vou_bill_lines bill_line
      ON bill_line.document_id=entry.source_document_id
     AND bill_line.purpose='PRIMARY'
     AND bill_line.position_type='ASSET'
     AND bill_line.direction='IN'
    WHERE entry.source_entity='bill-receipt'
    UNION ALL
    SELECT entry.counterparty_object_id,entry.effective_date,
           entry.amount_delta_cents+COALESCE(sum(bill_line.face_amount_cents),0)::bigint
    FROM trade entry
    LEFT JOIN vou_bill_lines bill_line
      ON bill_line.document_id=entry.source_document_id
     AND bill_line.purpose='PRIMARY'
     AND bill_line.position_type='ASSET'
     AND bill_line.direction='IN'
    WHERE entry.source_entity='bill-receipt'
    GROUP BY entry.id,entry.counterparty_object_id,entry.effective_date,
             entry.amount_delta_cents
    HAVING entry.amount_delta_cents+COALESCE(sum(bill_line.face_amount_cents),0)<>0
)
SELECT counterparty_object_id,effective_date,sum(amount_delta_cents)::bigint AS amount_delta_cents
FROM mapped
WHERE effective_date <= sqlc.arg(period_end)
GROUP BY counterparty_object_id,effective_date
ORDER BY counterparty_object_id,effective_date;

-- name: ListIntermediaryBillSourceRows :many
SELECT
    bill_line.id AS bill_line_id,
    document.id AS receipt_document_id,
    document.document_no AS receipt_document_no,
    document.business_date AS receipt_date,
    detail.counterparty_object_id AS customer_object_id,
    detail.counterparty_version_id AS customer_version_id,
    detail.counterparty_code AS customer_code,
    detail.counterparty_name AS customer_name,
    employee_object.id AS salesperson_object_id,
    employee_object.effective_version_id AS salesperson_version_id,
    employee_object.code AS salesperson_code,
    employee_version.name AS salesperson_name,
    bill_line.bill_type,
    bill_line.face_amount_cents,
    bill_line.issue_date,
    bill_line.maturity_date
FROM vou_documents document
JOIN vou_bill_details detail ON detail.document_id=document.id
JOIN vou_bill_lines bill_line ON bill_line.document_id=document.id
JOIN bob_customer_versions customer_version
  ON customer_version.version_id=detail.counterparty_version_id
LEFT JOIN bob_objects employee_object
  ON employee_object.id=customer_version.salesperson_employee_id
 AND employee_object.entity='employee'
LEFT JOIN bob_employee_versions employee_version
  ON employee_version.version_id=employee_object.effective_version_id
WHERE document.entity='bill-receipt'
  AND document.status IN ('APPROVED','FINALIZED')
  AND document.business_date >= sqlc.arg(cutover_date)
  AND (CASE WHEN bill_line.bill_type='CHECK'
        THEN bill_line.maturity_date ELSE document.business_date END)
      <= sqlc.arg(period_end)::date
  AND bill_line.purpose='PRIMARY'
  AND bill_line.position_type='ASSET'
  AND bill_line.direction='IN'
  AND bill_line.currency='CNY'
  AND NOT EXISTS (
      SELECT 1
      FROM vou_intermediary_calculation_bill_allocations allocation
      JOIN vou_documents allocation_document
        ON allocation_document.id=allocation.document_id
       AND allocation_document.entity='intermediary-calculation'
       AND allocation_document.status IN ('APPROVED','FINALIZED')
      WHERE allocation.bill_line_id=bill_line.id
        AND allocation_document.business_date <> sqlc.arg(period_end)::date
  )
ORDER BY employee_object.id,document.business_date,document.document_no,bill_line.line_no;

-- name: HasLedOtherPayableBalanceBeforeCutover :one
SELECT EXISTS (
    SELECT 1
    FROM led_party_entries
    WHERE generation_id=sqlc.arg(generation_id)
      AND account_type='OTHER_PAYABLE'
      AND effective_date < sqlc.arg(cutover_date)
    GROUP BY counterparty_entity,counterparty_object_id,currency,payable_category
    HAVING sum(amount_delta_cents)<>0
)::boolean;

-- name: InsertLedOtherPayableEntry :exec
INSERT INTO led_party_entries(
    id,generation_id,entry_type,source_entity,source_document_id,source_document_no,
    source_line_id,source_revision,effective_date,occurred_at,actor_id,request_id,remark,
    counterparty_entity,counterparty_object_id,counterparty_version_id,counterparty_code,
    counterparty_name,currency,amount_delta_cents,account_type,payable_category
) VALUES (
    sqlc.arg(id),sqlc.arg(generation_id),sqlc.arg(entry_type),sqlc.arg(source_entity),
    sqlc.arg(source_document_id),sqlc.arg(source_document_no),sqlc.arg(source_line_id),
    sqlc.arg(source_revision),sqlc.arg(effective_date),sqlc.arg(occurred_at),
    sqlc.arg(actor_id),sqlc.arg(request_id),sqlc.narg(remark),
    sqlc.arg(counterparty_entity),sqlc.arg(counterparty_object_id),
    sqlc.arg(counterparty_version_id),sqlc.arg(counterparty_code),
    sqlc.arg(counterparty_name),sqlc.arg(currency),sqlc.arg(amount_delta_cents),
    'OTHER_PAYABLE',sqlc.arg(payable_category)
) ON CONFLICT DO NOTHING;

-- name: CountLedOtherPayableEntries :one
SELECT count(*) FROM led_party_entries
WHERE generation_id=sqlc.arg(generation_id) AND account_type='OTHER_PAYABLE'
  AND effective_date BETWEEN sqlc.arg(date_from) AND sqlc.arg(date_to)
  AND (sqlc.arg(object_id)::text='' OR counterparty_object_id=sqlc.arg(object_id))
  AND (sqlc.arg(source_entity)::text='' OR source_entity=sqlc.arg(source_entity))
  AND (sqlc.arg(document_no)::text='' OR source_document_no ILIKE '%'||sqlc.arg(document_no)||'%')
  AND (sqlc.arg(payable_category)::text='' OR payable_category=sqlc.arg(payable_category))
  AND (COALESCE(cardinality(sqlc.arg(directions)::text[]),0)=0
       OR (CASE WHEN amount_delta_cents<0 THEN 'CREDIT' ELSE 'DEBIT' END)=ANY(sqlc.arg(directions)::text[]));

-- name: ListLedOtherPayableEntries :many
SELECT * FROM led_party_entries
WHERE generation_id=sqlc.arg(generation_id) AND account_type='OTHER_PAYABLE'
  AND effective_date BETWEEN sqlc.arg(date_from) AND sqlc.arg(date_to)
  AND (sqlc.arg(object_id)::text='' OR counterparty_object_id=sqlc.arg(object_id))
  AND (sqlc.arg(source_entity)::text='' OR source_entity=sqlc.arg(source_entity))
  AND (sqlc.arg(document_no)::text='' OR source_document_no ILIKE '%'||sqlc.arg(document_no)||'%')
  AND (sqlc.arg(payable_category)::text='' OR payable_category=sqlc.arg(payable_category))
  AND (COALESCE(cardinality(sqlc.arg(directions)::text[]),0)=0
       OR (CASE WHEN amount_delta_cents<0 THEN 'CREDIT' ELSE 'DEBIT' END)=ANY(sqlc.arg(directions)::text[]))
ORDER BY
  CASE WHEN sqlc.arg(sort_field)::text='effectiveDate' AND sqlc.arg(sort_order)::text='asc' THEN effective_date END ASC,
  CASE WHEN sqlc.arg(sort_field)::text='effectiveDate' AND sqlc.arg(sort_order)::text='desc' THEN effective_date END DESC,
  CASE WHEN sqlc.arg(sort_field)::text='amount' AND sqlc.arg(sort_order)::text='asc' THEN abs(amount_delta_cents) END ASC,
  CASE WHEN sqlc.arg(sort_field)::text='amount' AND sqlc.arg(sort_order)::text='desc' THEN abs(amount_delta_cents) END DESC,
  effective_date DESC,occurred_at DESC,id DESC
LIMIT sqlc.arg(page_size) OFFSET sqlc.arg(page_offset);

-- name: CountLedOtherPayableBalances :one
SELECT count(*) FROM (
  SELECT payable_category,counterparty_entity,counterparty_object_id,currency
  FROM led_party_entries
  WHERE generation_id=sqlc.arg(generation_id) AND account_type='OTHER_PAYABLE'
    AND effective_date<=sqlc.arg(as_of_date)
    AND (sqlc.arg(object_id)::text='' OR counterparty_object_id=sqlc.arg(object_id))
  GROUP BY payable_category,counterparty_entity,counterparty_object_id,currency
  HAVING sum(amount_delta_cents)<>0
) balances;

-- name: ListLedOtherPayableBalances :many
SELECT payable_category,counterparty_entity,counterparty_object_id,
       (array_agg(counterparty_version_id ORDER BY effective_date DESC,occurred_at DESC,id DESC))[1]::varchar(26) AS counterparty_version_id,
       max(counterparty_code)::varchar(64) AS counterparty_code,
       (array_agg(counterparty_name ORDER BY effective_date DESC,occurred_at DESC,id DESC))[1]::varchar(200) AS counterparty_name,
       currency,sum(amount_delta_cents)::bigint AS balance_cents
FROM led_party_entries
WHERE generation_id=sqlc.arg(generation_id) AND account_type='OTHER_PAYABLE'
  AND effective_date<=sqlc.arg(as_of_date)
  AND (sqlc.arg(object_id)::text='' OR counterparty_object_id=sqlc.arg(object_id))
GROUP BY payable_category,counterparty_entity,counterparty_object_id,currency
HAVING sum(amount_delta_cents)<>0
ORDER BY counterparty_entity,counterparty_code,payable_category,currency
LIMIT sqlc.arg(page_size) OFFSET sqlc.arg(page_offset);

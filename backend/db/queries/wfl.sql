-- name: ListSalesWorkflowSummaries :many
SELECT p.id AS process_id,
       p.process_type,
       p.status,
       p.revision,
       p.root_document_id,
       d.document_no AS root_document_no,
       (CASE
         WHEN p.status IN ('COMPLETED', 'SHORT_CLOSED') THEN ''
         ELSE COALESCE((
           SELECT x.stage
           FROM wfl_process_documents x
           JOIN vou_documents child ON child.id = x.document_id
           WHERE x.process_id = p.id AND child.status <> 'FINALIZED'
           ORDER BY CASE x.stage
             WHEN 'SALE_ORDER' THEN 1 WHEN 'PRODUCTION' THEN 2
             WHEN 'OUTBOUND' THEN 3 WHEN 'DELIVERY' THEN 4
             WHEN 'SIGNOFF' THEN 5 ELSE 6 END DESC,
             x.sequence_no DESC
           LIMIT 1
         ), 'SALE_ORDER')
       END)::text AS current_stage,
       d.business_date,
       detail.customer_name AS party_name,
       COALESCE(d.currency, '')::text AS currency,
       d.total_amount_cents,
       p.updated_at
FROM wfl_process_instances p
JOIN vou_documents d ON d.id = p.root_document_id
JOIN vou_sale_order_details detail ON detail.document_id = p.root_document_id
WHERE p.process_type = 'SALES_FULFILLMENT'
  AND (sqlc.arg(keyword)::text = '' OR d.document_no ILIKE '%' || sqlc.arg(keyword)::text || '%')
  AND (COALESCE(cardinality(sqlc.arg(statuses)::text[]), 0) = 0
       OR p.status = ANY(sqlc.arg(statuses)::text[]))
ORDER BY p.updated_at DESC, p.id DESC
LIMIT sqlc.arg(page_size) OFFSET sqlc.arg(page_offset);

-- name: CountSalesWorkflowSummaries :one
SELECT count(*)
FROM wfl_process_instances p
JOIN vou_documents d ON d.id = p.root_document_id
WHERE p.process_type = 'SALES_FULFILLMENT'
  AND (sqlc.arg(keyword)::text = '' OR d.document_no ILIKE '%' || sqlc.arg(keyword)::text || '%')
  AND (COALESCE(cardinality(sqlc.arg(statuses)::text[]), 0) = 0
       OR p.status = ANY(sqlc.arg(statuses)::text[]));

-- name: ListSalesWorkflowProgress :many
WITH ordered AS (
  SELECT p.id AS process_id,
         line.product_unit,
         count(DISTINCT line.product_object_id)::integer AS product_count,
         sum(line.ordered_qty_micros)::bigint AS ordered_quantity
  FROM wfl_process_instances p
  JOIN vou_product_lines line ON line.document_id = p.root_document_id
  WHERE p.id = ANY(sqlc.arg(process_ids)::text[])
  GROUP BY p.id, line.product_unit
), outbound AS (
  SELECT p.id AS process_id,
         line.product_unit,
         COALESCE(sum(line.quantity_micros) FILTER (WHERE doc.status <> 'FINALIZED'), 0)::bigint
           AS processing_quantity,
         COALESCE(sum(line.quantity_micros) FILTER (WHERE doc.status = 'FINALIZED'), 0)::bigint
           AS finalized_quantity
  FROM wfl_process_instances p
  JOIN vou_sale_outbound_details detail ON detail.source_order_id = p.root_document_id
  JOIN vou_documents doc ON doc.id = detail.document_id
  JOIN vou_sale_outbound_lines line ON line.document_id = detail.document_id
  WHERE p.id = ANY(sqlc.arg(process_ids)::text[])
  GROUP BY p.id, line.product_unit
), signoff AS (
  SELECT p.id AS process_id,
         line.product_unit,
         COALESCE(sum(line.signed_qty_micros), 0)::bigint AS signed_quantity,
         COALESCE(sum(line.rejected_qty_micros), 0)::bigint AS rejected_quantity,
         COALESCE(sum(line.loss_qty_micros), 0)::bigint AS loss_quantity
  FROM wfl_process_instances p
  JOIN vou_sale_signoff_details detail ON detail.source_order_id = p.root_document_id
  JOIN vou_documents doc ON doc.id = detail.document_id AND doc.status = 'FINALIZED'
  JOIN vou_sale_signoff_lines line ON line.document_id = detail.document_id
  WHERE p.id = ANY(sqlc.arg(process_ids)::text[])
  GROUP BY p.id, line.product_unit
), returns AS (
  SELECT p.id AS process_id,
         line.product_unit,
         COALESCE(sum(line.quantity_micros) FILTER (
           WHERE detail.return_kind = 'REFUSAL' AND doc.status <> 'FINALIZED'), 0)::bigint
           AS refusal_processing_quantity,
         COALESCE(sum(line.quantity_micros) FILTER (
           WHERE detail.return_kind = 'REFUSAL' AND doc.status = 'FINALIZED'), 0)::bigint
           AS refusal_returned_quantity,
         COALESCE(sum(line.quantity_micros) FILTER (
           WHERE detail.return_kind = 'AFTER_SALE' AND doc.status <> 'FINALIZED'), 0)::bigint
           AS after_sale_processing_quantity,
         COALESCE(sum(line.quantity_micros) FILTER (
           WHERE detail.return_kind = 'AFTER_SALE' AND doc.status = 'FINALIZED'), 0)::bigint
           AS after_sale_returned_quantity
  FROM wfl_process_instances p
  JOIN vou_sale_return_details detail ON detail.source_order_id = p.root_document_id
  JOIN vou_documents doc ON doc.id = detail.document_id
  JOIN vou_sale_return_lines line ON line.document_id = detail.document_id
  WHERE p.id = ANY(sqlc.arg(process_ids)::text[])
  GROUP BY p.id, line.product_unit
)
SELECT ordered.process_id,
       ordered.product_unit,
       ordered.product_count,
       ordered.ordered_quantity,
       COALESCE(outbound.processing_quantity, 0)::bigint AS outbound_processing_quantity,
       COALESCE(outbound.finalized_quantity, 0)::bigint AS finalized_outbound_quantity,
       GREATEST(COALESCE(outbound.finalized_quantity, 0)
         - COALESCE(signoff.signed_quantity, 0)
         - COALESCE(signoff.rejected_quantity, 0)
         - COALESCE(signoff.loss_quantity, 0), 0)::bigint AS in_transit_quantity,
       COALESCE(signoff.signed_quantity, 0)::bigint AS signed_quantity,
       COALESCE(signoff.rejected_quantity, 0)::bigint AS rejected_quantity,
       COALESCE(signoff.loss_quantity, 0)::bigint AS loss_quantity,
       COALESCE(returns.refusal_processing_quantity, 0)::bigint AS refusal_return_processing_quantity,
       COALESCE(returns.refusal_returned_quantity, 0)::bigint AS refusal_returned_quantity,
       COALESCE(returns.after_sale_processing_quantity, 0)::bigint AS after_sale_return_processing_quantity,
       COALESCE(returns.after_sale_returned_quantity, 0)::bigint AS after_sale_returned_quantity,
       GREATEST(COALESCE(signoff.signed_quantity, 0)
         - COALESCE(returns.after_sale_returned_quantity, 0), 0)::bigint AS net_signed_quantity,
       GREATEST(ordered.ordered_quantity
         - COALESCE(signoff.signed_quantity, 0)
         - GREATEST(COALESCE(outbound.finalized_quantity, 0)
           - COALESCE(signoff.signed_quantity, 0)
           - COALESCE(signoff.rejected_quantity, 0)
           - COALESCE(signoff.loss_quantity, 0), 0), 0)::bigint AS remaining_quantity
FROM ordered
LEFT JOIN outbound USING (process_id, product_unit)
LEFT JOIN signoff USING (process_id, product_unit)
LEFT JOIN returns USING (process_id, product_unit)
ORDER BY ordered.process_id, ordered.product_unit;

-- name: ListPurchaseWorkflowSummaries :many
SELECT p.id AS process_id,
       p.process_type,
       p.status,
       p.revision,
       p.root_document_id,
       d.document_no AS root_document_no,
       CASE
         WHEN p.status IN ('COMPLETED', 'SHORT_CLOSED') THEN ''
         WHEN p.status = 'RETURNING' THEN 'PURCHASE_RETURN'
         WHEN p.status IN ('APPROVED', 'SHORT_CLOSE_REQUESTED') THEN 'PURCHASE_INBOUND'
         ELSE 'PURCHASE_ORDER'
       END AS current_stage,
       d.business_date,
       detail.supplier_name AS party_name,
       COALESCE(d.currency, '')::text AS currency,
       d.total_amount_cents,
       p.updated_at
FROM wfl_process_instances p
JOIN vou_documents d ON d.id = p.root_document_id
JOIN vou_purchase_order_details detail ON detail.document_id = p.root_document_id
WHERE p.process_type = 'PURCHASE_FULFILLMENT'
  AND (sqlc.arg(keyword)::text = '' OR d.document_no ILIKE '%' || sqlc.arg(keyword)::text || '%')
  AND (COALESCE(cardinality(sqlc.arg(statuses)::text[]), 0) = 0
       OR p.status = ANY(sqlc.arg(statuses)::text[]))
ORDER BY p.updated_at DESC, p.id DESC
LIMIT sqlc.arg(page_size) OFFSET sqlc.arg(page_offset);

-- name: CountPurchaseWorkflowSummaries :one
SELECT count(*)
FROM wfl_process_instances p
JOIN vou_documents d ON d.id = p.root_document_id
WHERE p.process_type = 'PURCHASE_FULFILLMENT'
  AND (sqlc.arg(keyword)::text = '' OR d.document_no ILIKE '%' || sqlc.arg(keyword)::text || '%')
  AND (COALESCE(cardinality(sqlc.arg(statuses)::text[]), 0) = 0
       OR p.status = ANY(sqlc.arg(statuses)::text[]));

-- name: ListPurchaseWorkflowProgress :many
WITH ordered AS (
  SELECT p.id AS process_id,
         line.product_unit,
         count(DISTINCT line.product_object_id)::integer AS product_count,
         sum(line.ordered_qty_micros)::bigint AS ordered_quantity
  FROM wfl_process_instances p
  JOIN vou_product_lines line ON line.document_id = p.root_document_id
  WHERE p.id = ANY(sqlc.arg(process_ids)::text[])
  GROUP BY p.id, line.product_unit
), inbound AS (
  SELECT p.id AS process_id,
         line.product_unit,
         COALESCE(sum(line.quantity_micros) FILTER (WHERE doc.status <> 'FINALIZED'), 0)::bigint
           AS processing_quantity,
         COALESCE(sum(line.quantity_micros) FILTER (WHERE doc.status = 'FINALIZED'), 0)::bigint
           AS finalized_quantity,
         COALESCE(sum(line.quantity_micros), 0)::bigint AS reserved_quantity
  FROM wfl_process_instances p
  JOIN vou_purchase_inbound_details detail ON detail.source_order_id = p.root_document_id
  JOIN vou_documents doc ON doc.id = detail.document_id
  JOIN vou_purchase_inbound_lines line ON line.document_id = detail.document_id
  WHERE p.id = ANY(sqlc.arg(process_ids)::text[])
  GROUP BY p.id, line.product_unit
), returns AS (
  SELECT p.id AS process_id,
         line.product_unit,
         COALESCE(sum(line.quantity_micros) FILTER (WHERE doc.status <> 'FINALIZED'), 0)::bigint
           AS processing_quantity,
         COALESCE(sum(line.quantity_micros) FILTER (WHERE doc.status = 'FINALIZED'), 0)::bigint
           AS returned_quantity
  FROM wfl_process_instances p
  JOIN vou_purchase_return_details detail ON detail.source_order_id = p.root_document_id
  JOIN vou_documents doc ON doc.id = detail.document_id
  JOIN vou_purchase_return_lines line ON line.document_id = detail.document_id
  WHERE p.id = ANY(sqlc.arg(process_ids)::text[])
  GROUP BY p.id, line.product_unit
)
SELECT ordered.process_id,
       ordered.product_unit,
       ordered.product_count,
       ordered.ordered_quantity,
       COALESCE(inbound.processing_quantity, 0)::bigint AS inbound_processing_quantity,
       COALESCE(inbound.finalized_quantity, 0)::bigint AS finalized_inbound_quantity,
       COALESCE(returns.processing_quantity, 0)::bigint AS return_processing_quantity,
       COALESCE(returns.returned_quantity, 0)::bigint AS returned_quantity,
       GREATEST(COALESCE(inbound.finalized_quantity, 0)
         - COALESCE(returns.returned_quantity, 0), 0)::bigint AS net_inbound_quantity,
       GREATEST(ordered.ordered_quantity
         - COALESCE(inbound.reserved_quantity, 0)
         + COALESCE(returns.returned_quantity, 0), 0)::bigint AS remaining_quantity
FROM ordered
LEFT JOIN inbound USING (process_id, product_unit)
LEFT JOIN returns USING (process_id, product_unit)
ORDER BY ordered.process_id, ordered.product_unit;

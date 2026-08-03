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

-- name: CountWorkflowDefinitions :one
SELECT count(*)
FROM wfl_process_definitions d
WHERE (sqlc.arg(keyword)::text = ''
       OR d.code ILIKE '%' || sqlc.arg(keyword)::text || '%'
       OR d.name ILIKE '%' || sqlc.arg(keyword)::text || '%')
  AND (COALESCE(cardinality(sqlc.arg(statuses)::text[]), 0) = 0
       OR d.status = ANY(sqlc.arg(statuses)::text[]));

-- name: ListWorkflowDefinitions :many
SELECT d.id,
       d.code,
       d.name,
       d.status,
       d.revision,
       n.document_entity,
       (SELECT count(*)
        FROM wfl_definition_nodes child
        WHERE child.definition_id = d.id AND NOT child.archived)::bigint AS node_count,
       d.updated_at
FROM wfl_process_definitions d
JOIN wfl_definition_nodes n ON n.id = d.root_node_id
WHERE (sqlc.arg(keyword)::text = ''
       OR d.code ILIKE '%' || sqlc.arg(keyword)::text || '%'
       OR d.name ILIKE '%' || sqlc.arg(keyword)::text || '%')
  AND (COALESCE(cardinality(sqlc.arg(statuses)::text[]), 0) = 0
       OR d.status = ANY(sqlc.arg(statuses)::text[]))
ORDER BY d.updated_at DESC, d.id DESC
LIMIT sqlc.arg(page_size) OFFSET sqlc.arg(page_offset);

-- name: GetWorkflowDefinition :one
SELECT id, code, name, status, revision, root_node_id, start_condition, updated_at
FROM wfl_process_definitions
WHERE id = $1;

-- name: ListWorkflowDefinitionNodes :many
SELECT id, node_key, name, document_entity, position_x, position_y, defaults
FROM wfl_definition_nodes
WHERE definition_id = $1 AND NOT archived
ORDER BY created_at, id;

-- name: ListWorkflowDefinitionEdges :many
SELECT id, source_node_id, target_node_id, converter_key, condition
FROM wfl_definition_edges
WHERE definition_id = $1 AND NOT archived
ORDER BY created_at, id;

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

-- name: ListSalesOrderKgSummaries :many
WITH ordered AS (
  SELECT line.document_id AS order_id,
         COALESCE(sum(round(line.ordered_qty_micros::numeric
           * line.pricing_quantity_per_inventory_unit_micros / 1000000)), 0)::bigint AS quantity_micros
  FROM vou_product_lines line
  WHERE line.document_id = ANY(sqlc.arg(order_ids)::text[]) AND line.product_kind <> 'PACKAGING'
  GROUP BY line.document_id
), active_orders AS (
  SELECT d.id AS order_id, d.business_date, d.document_no,
         detail.warehouse_object_id, false AS hypothetical
  FROM wfl_process_instances process
  JOIN vou_documents d ON d.id = process.root_document_id AND d.status = 'APPROVED'
  JOIN vou_sale_order_details detail ON detail.document_id = d.id
  WHERE process.process_type = 'SALES_FULFILLMENT'
    AND process.status NOT IN ('COMPLETED', 'SHORT_CLOSED')
    AND detail.warehouse_object_id IS NOT NULL
), target_orders AS (
  SELECT d.id AS order_id, d.business_date, d.document_no,
         detail.warehouse_object_id,
         NOT EXISTS (SELECT 1 FROM active_orders active WHERE active.order_id = d.id) AS hypothetical
  FROM vou_documents d
  JOIN vou_sale_order_details detail ON detail.document_id = d.id
  WHERE d.id = ANY(sqlc.arg(order_ids)::text[])
    AND detail.warehouse_object_id IS NOT NULL
), demand_orders AS (
  SELECT * FROM active_orders
  UNION ALL
  SELECT target.* FROM target_orders target
  WHERE NOT EXISTS (SELECT 1 FROM active_orders active WHERE active.order_id = target.order_id)
), finalized_outbound AS (
  SELECT line.source_order_line_id, sum(line.quantity_micros)::bigint AS quantity_micros
  FROM vou_sale_outbound_lines line
  JOIN vou_documents doc ON doc.id = line.document_id AND doc.status = 'FINALIZED'
  GROUP BY line.source_order_line_id
), demand_lines AS (
  SELECT orders.order_id, orders.business_date, orders.document_no,
         orders.warehouse_object_id, orders.hypothetical,
         line.id AS order_line_id, line.line_no, line.product_object_id,
         line.pricing_quantity_per_inventory_unit_micros AS conversion_micros,
         GREATEST(line.ordered_qty_micros - COALESCE(outbound.quantity_micros, 0), 0)::bigint AS demand_micros
  FROM demand_orders orders
  JOIN vou_product_lines line ON line.document_id = orders.order_id AND line.product_kind <> 'PACKAGING'
  LEFT JOIN finalized_outbound outbound ON outbound.source_order_line_id = line.id
), inventory AS (
  SELECT entry.warehouse_object_id, entry.product_object_id,
         sum(entry.quantity_delta_micros)::bigint AS balance_micros
  FROM led_inventory_entries entry
  JOIN led_control control ON control.singleton AND control.active_generation_id = entry.generation_id
  GROUP BY entry.warehouse_object_id, entry.product_object_id
), allocated AS (
  SELECT demand.*,
         COALESCE(inventory.balance_micros, 0)::bigint AS balance_micros,
         COALESCE(sum(demand.demand_micros) OVER (
           PARTITION BY demand.warehouse_object_id, demand.product_object_id
           ORDER BY demand.hypothetical, demand.business_date, demand.document_no, demand.order_id, demand.line_no
           ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
         ), 0)::bigint AS prior_demand_micros
  FROM demand_lines demand
  LEFT JOIN inventory USING (warehouse_object_id, product_object_id)
), shortage AS (
  SELECT order_id,
         COALESCE(sum(round(
           GREATEST(demand_micros - GREATEST(balance_micros - prior_demand_micros, 0), 0)::numeric
           * conversion_micros / 1000000
         )), 0)::bigint AS shortage_quantity_micros
  FROM allocated
  WHERE order_id = ANY(sqlc.arg(order_ids)::text[])
  GROUP BY order_id
), outbound AS (
  SELECT detail.source_order_id AS order_id,
         COALESCE(sum(round(line.quantity_micros::numeric
           * source.pricing_quantity_per_inventory_unit_micros / 1000000)), 0)::bigint AS quantity_micros
  FROM vou_sale_outbound_details detail
  JOIN vou_documents doc ON doc.id = detail.document_id AND doc.status = 'FINALIZED'
  JOIN vou_sale_outbound_lines line ON line.document_id = detail.document_id
  JOIN vou_product_lines source ON source.id = line.source_order_line_id AND source.product_kind <> 'PACKAGING'
  WHERE detail.source_order_id = ANY(sqlc.arg(order_ids)::text[])
  GROUP BY detail.source_order_id
), signoff AS (
  SELECT detail.source_order_id AS order_id,
         COALESCE(sum(round(line.signed_qty_micros::numeric
           * source.pricing_quantity_per_inventory_unit_micros / 1000000)), 0)::bigint AS signed_micros,
         COALESCE(sum(round((line.signed_qty_micros + line.rejected_qty_micros + line.loss_qty_micros)::numeric
           * source.pricing_quantity_per_inventory_unit_micros / 1000000)), 0)::bigint AS resolved_micros
  FROM vou_sale_signoff_details detail
  JOIN vou_documents doc ON doc.id = detail.document_id AND doc.status = 'FINALIZED'
  JOIN vou_sale_signoff_lines line ON line.document_id = detail.document_id
  JOIN vou_product_lines source ON source.id = line.source_order_line_id AND source.product_kind <> 'PACKAGING'
  WHERE detail.source_order_id = ANY(sqlc.arg(order_ids)::text[])
  GROUP BY detail.source_order_id
), returns AS (
  SELECT detail.source_order_id AS order_id,
         COALESCE(sum(round(line.quantity_micros::numeric
           * source.pricing_quantity_per_inventory_unit_micros / 1000000)), 0)::bigint AS quantity_micros
  FROM vou_sale_return_details detail
  JOIN vou_documents doc ON doc.id = detail.document_id AND doc.status = 'FINALIZED'
  JOIN vou_sale_return_lines line ON line.document_id = detail.document_id
  JOIN vou_sale_signoff_lines signoff_line ON signoff_line.id = line.source_signoff_line_id
  JOIN vou_product_lines source ON source.id = signoff_line.source_order_line_id AND source.product_kind <> 'PACKAGING'
  WHERE detail.source_order_id = ANY(sqlc.arg(order_ids)::text[])
    AND detail.return_kind = 'AFTER_SALE'
  GROUP BY detail.source_order_id
)
SELECT d.id AS order_id,
       (detail.warehouse_object_id IS NOT NULL)::boolean AS warehouse_available,
       EXISTS (SELECT 1 FROM vou_product_lines line WHERE line.document_id = d.id AND line.product_kind = 'PACKAGING') AS excluded_packaging,
       COALESCE(shortage.shortage_quantity_micros, 0)::bigint AS shortage_quantity_micros,
       COALESCE(ordered.quantity_micros, 0)::bigint AS ordered_quantity_micros,
       COALESCE(outbound.quantity_micros, 0)::bigint AS outbound_quantity_micros,
       GREATEST(COALESCE(outbound.quantity_micros, 0) - COALESCE(signoff.resolved_micros, 0), 0)::bigint AS in_transit_quantity_micros,
       COALESCE(signoff.signed_micros, 0)::bigint AS signed_quantity_micros,
       GREATEST(COALESCE(signoff.signed_micros, 0) - COALESCE(returns.quantity_micros, 0), 0)::bigint AS net_signed_quantity_micros
FROM vou_documents d
JOIN vou_sale_order_details detail ON detail.document_id = d.id
LEFT JOIN ordered ON ordered.order_id = d.id
LEFT JOIN shortage ON shortage.order_id = d.id
LEFT JOIN outbound ON outbound.order_id = d.id
LEFT JOIN signoff ON signoff.order_id = d.id
LEFT JOIN returns ON returns.order_id = d.id
WHERE d.id = ANY(sqlc.arg(order_ids)::text[])
ORDER BY d.id;

-- name: ListPurchaseOrderKgSummaries :many
WITH ordered AS (
  SELECT line.document_id AS order_id,
         COALESCE(sum(round(line.ordered_qty_micros::numeric
           * line.pricing_quantity_per_inventory_unit_micros / 1000000)), 0)::bigint AS quantity_micros
  FROM vou_product_lines line
  WHERE line.document_id = ANY(sqlc.arg(order_ids)::text[]) AND line.product_kind <> 'PACKAGING'
  GROUP BY line.document_id
), inbound AS (
  SELECT detail.source_order_id AS order_id,
         COALESCE(sum(round(line.quantity_micros::numeric
           * source.pricing_quantity_per_inventory_unit_micros / 1000000)), 0)::bigint AS quantity_micros
  FROM vou_purchase_inbound_details detail
  JOIN vou_documents doc ON doc.id = detail.document_id AND doc.status = 'FINALIZED'
  JOIN vou_purchase_inbound_lines line ON line.document_id = detail.document_id
  JOIN vou_product_lines source ON source.id = line.source_order_line_id AND source.product_kind <> 'PACKAGING'
  WHERE detail.source_order_id = ANY(sqlc.arg(order_ids)::text[])
  GROUP BY detail.source_order_id
), returns AS (
  SELECT detail.source_order_id AS order_id,
         COALESCE(sum(round(line.quantity_micros::numeric
           * source.pricing_quantity_per_inventory_unit_micros / 1000000)) FILTER (WHERE doc.status <> 'FINALIZED'), 0)::bigint AS processing_micros,
         COALESCE(sum(round(line.quantity_micros::numeric
           * source.pricing_quantity_per_inventory_unit_micros / 1000000)) FILTER (WHERE doc.status = 'FINALIZED'), 0)::bigint AS finalized_micros
  FROM vou_purchase_return_details detail
  JOIN vou_documents doc ON doc.id = detail.document_id
  JOIN vou_purchase_return_lines line ON line.document_id = detail.document_id
  JOIN vou_product_lines source ON source.id = line.source_order_line_id AND source.product_kind <> 'PACKAGING'
  WHERE detail.source_order_id = ANY(sqlc.arg(order_ids)::text[])
  GROUP BY detail.source_order_id
)
SELECT d.id AS order_id,
       EXISTS (SELECT 1 FROM vou_product_lines line WHERE line.document_id = d.id AND line.product_kind = 'PACKAGING') AS excluded_packaging,
       COALESCE(ordered.quantity_micros, 0)::bigint AS ordered_quantity_micros,
       COALESCE(inbound.quantity_micros, 0)::bigint AS inbound_quantity_micros,
       COALESCE(returns.processing_micros, 0)::bigint AS return_processing_quantity_micros,
       GREATEST(COALESCE(inbound.quantity_micros, 0) - COALESCE(returns.finalized_micros, 0), 0)::bigint AS net_inbound_quantity_micros
FROM vou_documents d
LEFT JOIN ordered ON ordered.order_id = d.id
LEFT JOIN inbound ON inbound.order_id = d.id
LEFT JOIN returns ON returns.order_id = d.id
WHERE d.id = ANY(sqlc.arg(order_ids)::text[])
ORDER BY d.id;

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

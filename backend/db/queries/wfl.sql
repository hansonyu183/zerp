-- name: ListSalesWorkflowSummaries :many
SELECT p.id AS process_id,
       p.process_type,
       p.status,
       p.revision,
       p.root_document_id,
       d.document_no AS root_document_no,
		 COALESCE((
           SELECT x.stage
           FROM wfl_process_documents x
           JOIN vou_documents child ON child.id = x.document_id
           WHERE x.process_id = p.id AND child.status <> 'APPROVED'
           ORDER BY CASE x.stage
             WHEN 'SALE_ORDER' THEN 1 WHEN 'PRODUCTION' THEN 2
             WHEN 'OUTBOUND' THEN 3 WHEN 'DELIVERY' THEN 4
             WHEN 'SIGNOFF' THEN 5 ELSE 6 END DESC,
             x.sequence_no DESC
           LIMIT 1
		 ), 'SALE_ORDER')::text AS current_stage,
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

-- name: CountDefinitionInstances :one
SELECT count(*)
FROM wfl_definition_instances i
JOIN vou_documents d ON d.id = i.root_document_id
JOIN wfl_process_definitions f ON f.id = i.definition_id
LEFT JOIN LATERAL (
  SELECT party_object_id, party_code, party_name
  FROM (
    SELECT customer_object_id AS party_object_id,
           customer_code AS party_code,
           customer_name AS party_name
    FROM vou_sale_order_details WHERE document_id = d.id
    UNION ALL SELECT customer_object_id, customer_code, customer_name
      FROM vou_sale_outbound_details WHERE document_id = d.id
    UNION ALL SELECT customer_object_id, customer_code, customer_name
      FROM vou_sale_delivery_details WHERE document_id = d.id
    UNION ALL SELECT customer_object_id, customer_code, customer_name
      FROM vou_sale_signoff_details WHERE document_id = d.id
    UNION ALL SELECT customer_object_id, customer_code, customer_name
      FROM vou_sale_return_details WHERE document_id = d.id
    UNION ALL SELECT supplier_object_id, supplier_code, supplier_name
      FROM vou_purchase_inquiry_details WHERE document_id = d.id
    UNION ALL SELECT supplier_object_id, supplier_code, supplier_name
      FROM vou_purchase_order_details WHERE document_id = d.id
    UNION ALL SELECT supplier_object_id, supplier_code, supplier_name
      FROM vou_purchase_inbound_details WHERE document_id = d.id
    UNION ALL SELECT supplier_object_id, supplier_code, supplier_name
      FROM vou_purchase_return_details WHERE document_id = d.id
    UNION ALL SELECT counterparty_object_id, counterparty_code, counterparty_name
      FROM vou_receipt_details WHERE document_id = d.id
    UNION ALL SELECT counterparty_object_id, counterparty_code, counterparty_name
      FROM vou_payment_details WHERE document_id = d.id
    UNION ALL SELECT employee_object_id, employee_code, employee_name
      FROM vou_expense_reimbursement_details WHERE document_id = d.id
    UNION ALL SELECT employee_object_id, employee_code, employee_name
      FROM vou_expense_payment_details WHERE document_id = d.id
    UNION ALL SELECT counterparty_object_id, COALESCE(counterparty_code, ''),
      COALESCE(NULLIF(counterparty_name, ''), source_name)
      FROM vou_other_income_details WHERE document_id = d.id
  ) parties
  LIMIT 1
) party ON true
WHERE (
    sqlc.arg(keyword)::text = ''
    OR party.party_code ILIKE '%' || sqlc.arg(keyword)::text || '%'
    OR party.party_name ILIKE '%' || sqlc.arg(keyword)::text || '%'
    OR EXISTS (
      SELECT 1
      FROM wfl_node_instances search_node
      WHERE search_node.process_id = i.id
        AND (
          EXISTS (SELECT 1 FROM vou_product_lines line
            WHERE line.document_id = search_node.document_id
              AND (line.product_code ILIKE '%' || sqlc.arg(keyword)::text || '%'
                OR line.product_name ILIKE '%' || sqlc.arg(keyword)::text || '%'))
          OR EXISTS (SELECT 1 FROM vou_sale_outbound_lines line
            WHERE line.document_id = search_node.document_id
              AND (line.product_code ILIKE '%' || sqlc.arg(keyword)::text || '%'
                OR line.product_name ILIKE '%' || sqlc.arg(keyword)::text || '%'))
          OR EXISTS (SELECT 1 FROM vou_sale_signoff_lines line
            WHERE line.document_id = search_node.document_id
              AND (line.product_code ILIKE '%' || sqlc.arg(keyword)::text || '%'
                OR line.product_name ILIKE '%' || sqlc.arg(keyword)::text || '%'))
          OR EXISTS (SELECT 1 FROM vou_sale_return_lines line
            WHERE line.document_id = search_node.document_id
              AND (line.product_code ILIKE '%' || sqlc.arg(keyword)::text || '%'
                OR line.product_name ILIKE '%' || sqlc.arg(keyword)::text || '%'))
          OR EXISTS (SELECT 1 FROM vou_purchase_inbound_lines line
            WHERE line.document_id = search_node.document_id
              AND (line.product_code ILIKE '%' || sqlc.arg(keyword)::text || '%'
                OR line.product_name ILIKE '%' || sqlc.arg(keyword)::text || '%'))
          OR EXISTS (SELECT 1 FROM vou_purchase_return_lines line
            WHERE line.document_id = search_node.document_id
              AND (line.product_code ILIKE '%' || sqlc.arg(keyword)::text || '%'
                OR line.product_name ILIKE '%' || sqlc.arg(keyword)::text || '%'))
          OR EXISTS (SELECT 1 FROM vou_production_output_lines line
            WHERE line.document_id = search_node.document_id
              AND (line.product_code ILIKE '%' || sqlc.arg(keyword)::text || '%'
                OR line.product_name ILIKE '%' || sqlc.arg(keyword)::text || '%'))
          OR EXISTS (SELECT 1
            FROM vou_production_material_lines material
            JOIN vou_production_output_lines output ON output.id = material.output_line_id
            WHERE output.document_id = search_node.document_id
              AND (material.formula_material_code ILIKE '%' || sqlc.arg(keyword)::text || '%'
                OR material.formula_material_name ILIKE '%' || sqlc.arg(keyword)::text || '%'
                OR material.actual_material_code ILIKE '%' || sqlc.arg(keyword)::text || '%'
                OR material.actual_material_name ILIKE '%' || sqlc.arg(keyword)::text || '%'))
        )
    )
  )
  AND (sqlc.arg(definition_id)::text = '' OR i.definition_id = sqlc.arg(definition_id))
  AND (sqlc.arg(party_object_id)::text = '' OR party.party_object_id = sqlc.arg(party_object_id));

-- name: ListDefinitionInstances :many
SELECT i.id AS process_id,
       i.definition_id,
       f.code AS definition_code,
       f.name AS definition_name,
       i.revision,
       i.root_document_id,
       d.document_no AS root_document_no,
       d.entity AS root_entity,
       COALESCE(party.party_code, '')::text AS party_code,
       COALESCE(party.party_name, '')::text AS party_name,
       i.updated_at
FROM wfl_definition_instances i
JOIN vou_documents d ON d.id = i.root_document_id
JOIN wfl_process_definitions f ON f.id = i.definition_id
LEFT JOIN LATERAL (
  SELECT party_object_id, party_code, party_name
  FROM (
    SELECT customer_object_id AS party_object_id,
           customer_code AS party_code,
           customer_name AS party_name
    FROM vou_sale_order_details WHERE document_id = d.id
    UNION ALL SELECT customer_object_id, customer_code, customer_name
      FROM vou_sale_outbound_details WHERE document_id = d.id
    UNION ALL SELECT customer_object_id, customer_code, customer_name
      FROM vou_sale_delivery_details WHERE document_id = d.id
    UNION ALL SELECT customer_object_id, customer_code, customer_name
      FROM vou_sale_signoff_details WHERE document_id = d.id
    UNION ALL SELECT customer_object_id, customer_code, customer_name
      FROM vou_sale_return_details WHERE document_id = d.id
    UNION ALL SELECT supplier_object_id, supplier_code, supplier_name
      FROM vou_purchase_inquiry_details WHERE document_id = d.id
    UNION ALL SELECT supplier_object_id, supplier_code, supplier_name
      FROM vou_purchase_order_details WHERE document_id = d.id
    UNION ALL SELECT supplier_object_id, supplier_code, supplier_name
      FROM vou_purchase_inbound_details WHERE document_id = d.id
    UNION ALL SELECT supplier_object_id, supplier_code, supplier_name
      FROM vou_purchase_return_details WHERE document_id = d.id
    UNION ALL SELECT counterparty_object_id, counterparty_code, counterparty_name
      FROM vou_receipt_details WHERE document_id = d.id
    UNION ALL SELECT counterparty_object_id, counterparty_code, counterparty_name
      FROM vou_payment_details WHERE document_id = d.id
    UNION ALL SELECT employee_object_id, employee_code, employee_name
      FROM vou_expense_reimbursement_details WHERE document_id = d.id
    UNION ALL SELECT employee_object_id, employee_code, employee_name
      FROM vou_expense_payment_details WHERE document_id = d.id
    UNION ALL SELECT counterparty_object_id, COALESCE(counterparty_code, ''),
      COALESCE(NULLIF(counterparty_name, ''), source_name)
      FROM vou_other_income_details WHERE document_id = d.id
  ) parties
  LIMIT 1
) party ON true
WHERE (
    sqlc.arg(keyword)::text = ''
    OR party.party_code ILIKE '%' || sqlc.arg(keyword)::text || '%'
    OR party.party_name ILIKE '%' || sqlc.arg(keyword)::text || '%'
    OR EXISTS (
      SELECT 1
      FROM wfl_node_instances search_node
      WHERE search_node.process_id = i.id
        AND (
          EXISTS (SELECT 1 FROM vou_product_lines line
            WHERE line.document_id = search_node.document_id
              AND (line.product_code ILIKE '%' || sqlc.arg(keyword)::text || '%'
                OR line.product_name ILIKE '%' || sqlc.arg(keyword)::text || '%'))
          OR EXISTS (SELECT 1 FROM vou_sale_outbound_lines line
            WHERE line.document_id = search_node.document_id
              AND (line.product_code ILIKE '%' || sqlc.arg(keyword)::text || '%'
                OR line.product_name ILIKE '%' || sqlc.arg(keyword)::text || '%'))
          OR EXISTS (SELECT 1 FROM vou_sale_signoff_lines line
            WHERE line.document_id = search_node.document_id
              AND (line.product_code ILIKE '%' || sqlc.arg(keyword)::text || '%'
                OR line.product_name ILIKE '%' || sqlc.arg(keyword)::text || '%'))
          OR EXISTS (SELECT 1 FROM vou_sale_return_lines line
            WHERE line.document_id = search_node.document_id
              AND (line.product_code ILIKE '%' || sqlc.arg(keyword)::text || '%'
                OR line.product_name ILIKE '%' || sqlc.arg(keyword)::text || '%'))
          OR EXISTS (SELECT 1 FROM vou_purchase_inbound_lines line
            WHERE line.document_id = search_node.document_id
              AND (line.product_code ILIKE '%' || sqlc.arg(keyword)::text || '%'
                OR line.product_name ILIKE '%' || sqlc.arg(keyword)::text || '%'))
          OR EXISTS (SELECT 1 FROM vou_purchase_return_lines line
            WHERE line.document_id = search_node.document_id
              AND (line.product_code ILIKE '%' || sqlc.arg(keyword)::text || '%'
                OR line.product_name ILIKE '%' || sqlc.arg(keyword)::text || '%'))
          OR EXISTS (SELECT 1 FROM vou_production_output_lines line
            WHERE line.document_id = search_node.document_id
              AND (line.product_code ILIKE '%' || sqlc.arg(keyword)::text || '%'
                OR line.product_name ILIKE '%' || sqlc.arg(keyword)::text || '%'))
          OR EXISTS (SELECT 1
            FROM vou_production_material_lines material
            JOIN vou_production_output_lines output ON output.id = material.output_line_id
            WHERE output.document_id = search_node.document_id
              AND (material.formula_material_code ILIKE '%' || sqlc.arg(keyword)::text || '%'
                OR material.formula_material_name ILIKE '%' || sqlc.arg(keyword)::text || '%'
                OR material.actual_material_code ILIKE '%' || sqlc.arg(keyword)::text || '%'
                OR material.actual_material_name ILIKE '%' || sqlc.arg(keyword)::text || '%'))
        )
    )
  )
  AND (sqlc.arg(definition_id)::text = '' OR i.definition_id = sqlc.arg(definition_id))
  AND (sqlc.arg(party_object_id)::text = '' OR party.party_object_id = sqlc.arg(party_object_id))
ORDER BY i.updated_at DESC, i.id DESC
LIMIT sqlc.arg(page_size) OFFSET sqlc.arg(page_offset);

-- name: GetDefinitionInstance :one
SELECT i.id AS process_id,
       i.definition_id,
       f.code AS definition_code,
       f.name AS definition_name,
       i.revision,
       i.root_document_id,
       d.document_no AS root_document_no,
       d.entity AS root_entity,
       i.updated_at,
       i.started_definition_revision
FROM wfl_definition_instances i
JOIN vou_documents d ON d.id = i.root_document_id
JOIN wfl_process_definitions f ON f.id = i.definition_id
WHERE i.id = $1;

-- name: ListWorkflowDefinitions :many
SELECT d.id,
       d.code,
       d.name,
       d.status,
       d.revision,
       d.source_kind,
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
SELECT id, code, name, status, revision, source_kind, draft_script, draft_diagnostic,
       root_node_id, start_condition, last_trial_revision, last_trial_at, updated_at
FROM wfl_process_definitions
WHERE id = $1;

-- name: CreateWorkflowDefinition :exec
INSERT INTO wfl_process_definitions (
  id, code, name, status, source_kind, draft_script, root_node_id,
  start_condition, created_by, updated_by
) VALUES (
  sqlc.arg(id), sqlc.arg(code), sqlc.arg(name), 'DRAFT',
  sqlc.arg(source_kind), sqlc.narg(draft_script), sqlc.arg(root_node_id),
  sqlc.arg(start_condition), sqlc.arg(actor_id), sqlc.arg(actor_id)
);

-- name: LockWorkflowDefinitionDraft :one
SELECT revision, status, code, source_kind, root_node_id
FROM wfl_process_definitions
WHERE id = $1
FOR UPDATE;

-- name: SaveWorkflowDefinitionDraft :exec
UPDATE wfl_process_definitions
SET name = sqlc.arg(name),
    root_node_id = sqlc.arg(root_node_id),
    start_condition = sqlc.arg(start_condition),
    draft_script = sqlc.narg(draft_script),
    draft_diagnostic = NULL,
    revision = revision + 1,
    last_trial_revision = NULL,
    last_trial_at = NULL,
    updated_at = now(),
    updated_by = sqlc.arg(actor_id)
WHERE id = sqlc.arg(id);

-- name: SaveWorkflowDefinitionScriptDiagnostic :exec
UPDATE wfl_process_definitions
SET draft_script = sqlc.arg(draft_script),
    draft_diagnostic = sqlc.arg(draft_diagnostic),
    revision = revision + 1,
    last_trial_revision = NULL,
    last_trial_at = NULL,
    updated_at = now(),
    updated_by = sqlc.arg(actor_id)
WHERE id = sqlc.arg(id);

-- name: ListWorkflowDefinitionNodeIdentities :many
SELECT id, node_key
FROM wfl_definition_nodes
WHERE definition_id = $1
ORDER BY archived, created_at, id;

-- name: ListWorkflowDefinitionEdgeIdentities :many
SELECT edge.id,
       source.node_key AS source_node_key,
       target.node_key AS target_node_key,
       edge.converter_key
FROM wfl_definition_edges edge
JOIN wfl_definition_nodes source ON source.id = edge.source_node_id
JOIN wfl_definition_nodes target ON target.id = edge.target_node_id
WHERE edge.definition_id = $1
ORDER BY edge.archived, edge.created_at, edge.id;

-- name: RecordWorkflowDefinitionTrial :execrows
UPDATE wfl_process_definitions
SET last_trial_revision = sqlc.arg(revision),
    last_trial_at = now()
WHERE id = sqlc.arg(definition_id)
  AND revision = sqlc.arg(revision);

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
	  AND detail.fulfillment_status = 'OPEN'
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
), approved_outbound AS (
  SELECT line.source_order_line_id, sum(line.quantity_micros)::bigint AS quantity_micros
  FROM vou_sale_outbound_lines line
  JOIN vou_documents doc ON doc.id = line.document_id AND doc.status = 'APPROVED'
  GROUP BY line.source_order_line_id
), demand_lines AS (
  SELECT orders.order_id, orders.business_date, orders.document_no,
         orders.warehouse_object_id, orders.hypothetical,
         line.id AS order_line_id, line.line_no, line.product_object_id,
         line.pricing_quantity_per_inventory_unit_micros AS conversion_micros,
         GREATEST(line.ordered_qty_micros - COALESCE(outbound.quantity_micros, 0), 0)::bigint AS demand_micros
  FROM demand_orders orders
  JOIN vou_product_lines line ON line.document_id = orders.order_id AND line.product_kind <> 'PACKAGING'
  LEFT JOIN approved_outbound outbound ON outbound.source_order_line_id = line.id
), inventory AS (
  SELECT entry.warehouse_id AS warehouse_object_id, entry.product_id AS product_object_id,
         sum(entry.quantity_delta_micros)::bigint AS balance_micros
  FROM acc_inventory_entries entry
  JOIN acc_books book ON book.id=entry.book_id AND book.control_book
  GROUP BY entry.warehouse_id, entry.product_id
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
  JOIN vou_documents doc ON doc.id = detail.document_id AND doc.status = 'APPROVED'
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
  JOIN vou_documents doc ON doc.id = detail.document_id AND doc.status = 'APPROVED'
  JOIN vou_sale_signoff_lines line ON line.document_id = detail.document_id
  JOIN vou_product_lines source ON source.id = line.source_order_line_id AND source.product_kind <> 'PACKAGING'
  WHERE detail.source_order_id = ANY(sqlc.arg(order_ids)::text[])
  GROUP BY detail.source_order_id
), returns AS (
  SELECT detail.source_order_id AS order_id,
         COALESCE(sum(round(line.quantity_micros::numeric
           * source.pricing_quantity_per_inventory_unit_micros / 1000000)), 0)::bigint AS quantity_micros
  FROM vou_sale_return_details detail
  JOIN vou_documents doc ON doc.id = detail.document_id AND doc.status = 'APPROVED'
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
  JOIN vou_documents doc ON doc.id = detail.document_id AND doc.status = 'APPROVED'
  JOIN vou_purchase_inbound_lines line ON line.document_id = detail.document_id
  JOIN vou_product_lines source ON source.id = line.source_order_line_id AND source.product_kind <> 'PACKAGING'
  WHERE detail.source_order_id = ANY(sqlc.arg(order_ids)::text[])
  GROUP BY detail.source_order_id
), returns AS (
  SELECT detail.source_order_id AS order_id,
         COALESCE(sum(round(line.quantity_micros::numeric
           * source.pricing_quantity_per_inventory_unit_micros / 1000000)) FILTER (WHERE doc.status <> 'APPROVED'), 0)::bigint AS processing_micros,
         COALESCE(sum(round(line.quantity_micros::numeric
           * source.pricing_quantity_per_inventory_unit_micros / 1000000)) FILTER (WHERE doc.status = 'APPROVED'), 0)::bigint AS approved_micros
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
       GREATEST(COALESCE(inbound.quantity_micros, 0) - COALESCE(returns.approved_micros, 0), 0)::bigint AS net_inbound_quantity_micros
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
		 WHEN p.status = 'APPROVED' THEN 'PURCHASE_INBOUND'
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

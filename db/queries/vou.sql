-- name: NextVouNumberCounter :one
INSERT INTO vou_number_counters (entity, business_date, last_value)
VALUES (sqlc.arg(entity), sqlc.arg(business_date), 1)
ON CONFLICT (entity, business_date)
DO UPDATE SET last_value = vou_number_counters.last_value + 1
RETURNING last_value;

-- name: InsertVouDocument :exec
INSERT INTO vou_documents (
    id, entity, document_no, business_date, currency, total_amount_cents, remark, created_by, updated_by
) VALUES (
    sqlc.arg(id), sqlc.arg(entity), sqlc.arg(document_no), sqlc.arg(business_date),
    sqlc.arg(currency), sqlc.arg(total_amount_cents), sqlc.narg(remark), sqlc.arg(actor_id), sqlc.arg(actor_id)
);

-- name: LockVouDocument :one
SELECT *
FROM vou_documents
WHERE id = sqlc.arg(id) AND entity = sqlc.arg(entity)
FOR UPDATE;

-- name: GetVouDocument :one
SELECT *
FROM vou_documents
WHERE id = sqlc.arg(id) AND entity = sqlc.arg(entity);

-- name: UpdateVouDraft :one
UPDATE vou_documents
SET business_date = sqlc.arg(business_date), currency = sqlc.arg(currency),
    total_amount_cents = sqlc.arg(total_amount_cents), remark = sqlc.narg(remark),
    revision = revision + 1, updated_at = now(), updated_by = sqlc.arg(actor_id)
WHERE id = sqlc.arg(id) AND entity = sqlc.arg(entity)
  AND revision = sqlc.arg(revision) AND status = 'DRAFT'
RETURNING revision;

-- name: ReviewVouDocument :one
UPDATE vou_documents
SET status = 'REVIEWED', revision = revision + 1,
    reviewed_at = now(), reviewed_by = sqlc.arg(actor_id),
    updated_at = now(), updated_by = sqlc.arg(actor_id)
WHERE id = sqlc.arg(id) AND entity = sqlc.arg(entity)
  AND revision = sqlc.arg(revision) AND status = 'DRAFT'
RETURNING revision;

-- name: UnreviewVouDocument :one
UPDATE vou_documents
SET status = 'DRAFT', revision = revision + 1,
    reviewed_at = NULL, reviewed_by = NULL,
    updated_at = now(), updated_by = sqlc.arg(actor_id)
WHERE id = sqlc.arg(id) AND entity = sqlc.arg(entity)
  AND revision = sqlc.arg(revision) AND status = 'REVIEWED'
RETURNING revision;

-- name: ApproveVouDocument :one
UPDATE vou_documents
SET status = 'APPROVED', revision = revision + 1,
    approved_at = now(), approved_by = sqlc.arg(actor_id),
    updated_at = now(), updated_by = sqlc.arg(actor_id)
WHERE id = sqlc.arg(id) AND entity = sqlc.arg(entity)
  AND revision = sqlc.arg(revision) AND status = 'REVIEWED'
RETURNING revision;

-- name: UnapproveVouDocument :one
UPDATE vou_documents
SET status = 'REVIEWED', revision = revision + 1,
    approved_at = NULL, approved_by = NULL,
    updated_at = now(), updated_by = sqlc.arg(actor_id)
WHERE id = sqlc.arg(id) AND entity = sqlc.arg(entity)
  AND revision = sqlc.arg(revision) AND status = 'APPROVED'
RETURNING revision;

-- name: ExecuteVouDocument :one
UPDATE vou_documents
SET status = 'EXECUTED', revision = revision + 1,
    executed_at = now(), executed_by = sqlc.arg(actor_id),
    updated_at = now(), updated_by = sqlc.arg(actor_id)
WHERE id = sqlc.arg(id) AND entity = sqlc.arg(entity)
  AND revision = sqlc.arg(revision) AND status = 'APPROVED'
RETURNING revision;

-- name: UnexecuteVouDocument :one
UPDATE vou_documents
SET status = 'APPROVED', revision = revision + 1,
    executed_at = NULL, executed_by = NULL,
    updated_at = now(), updated_by = sqlc.arg(actor_id)
WHERE id = sqlc.arg(id) AND entity = sqlc.arg(entity)
  AND revision = sqlc.arg(revision) AND status = 'EXECUTED'
RETURNING revision;

-- name: CountVouDocuments :one
SELECT count(*)
FROM vou_documents d
WHERE d.entity = sqlc.arg(entity)
  AND (COALESCE(cardinality(sqlc.arg(statuses)::text[]), 0) = 0 OR d.status = ANY(sqlc.arg(statuses)::text[]))
  AND (sqlc.narg(date_from)::date IS NULL OR d.business_date >= sqlc.narg(date_from)::date)
  AND (sqlc.narg(date_to)::date IS NULL OR d.business_date <= sqlc.narg(date_to)::date)
  AND (
      sqlc.arg(party_object_id)::text = ''
      OR EXISTS (SELECT 1 FROM vou_sale_order_details x WHERE x.document_id = d.id AND x.customer_object_id = sqlc.arg(party_object_id))
      OR EXISTS (SELECT 1 FROM vou_purchase_order_details x WHERE x.document_id = d.id AND x.supplier_object_id = sqlc.arg(party_object_id))
      OR EXISTS (SELECT 1 FROM vou_intermediary_sale_order_details x WHERE x.document_id = d.id
          AND (x.customer_object_id = sqlc.arg(party_object_id) OR x.supplier_object_id = sqlc.arg(party_object_id)))
      OR EXISTS (SELECT 1 FROM vou_intermediary_v2_details x WHERE x.document_id = d.id
          AND x.customer_object_id = sqlc.arg(party_object_id))
      OR EXISTS (SELECT 1 FROM vou_intermediary_children c
          JOIN vou_intermediary_procurements x ON x.child_id = c.id
          WHERE c.document_id = d.id AND x.supplier_object_id = sqlc.arg(party_object_id))
      OR EXISTS (SELECT 1 FROM vou_receipt_details x WHERE x.document_id = d.id AND x.counterparty_object_id = sqlc.arg(party_object_id))
      OR EXISTS (SELECT 1 FROM vou_payment_details x WHERE x.document_id = d.id AND x.counterparty_object_id = sqlc.arg(party_object_id))
      OR EXISTS (SELECT 1 FROM vou_other_income_details x WHERE x.document_id = d.id AND x.counterparty_object_id = sqlc.arg(party_object_id))
  )
  AND (
      sqlc.arg(keyword)::text = ''
      OR d.document_no ILIKE '%' || sqlc.arg(keyword) || '%'
      OR EXISTS (SELECT 1 FROM vou_sale_order_details x WHERE x.document_id = d.id
          AND (x.customer_code ILIKE '%' || sqlc.arg(keyword) || '%' OR x.customer_name ILIKE '%' || sqlc.arg(keyword) || '%'))
      OR EXISTS (SELECT 1 FROM vou_purchase_order_details x WHERE x.document_id = d.id
          AND (x.supplier_code ILIKE '%' || sqlc.arg(keyword) || '%' OR x.supplier_name ILIKE '%' || sqlc.arg(keyword) || '%'))
      OR EXISTS (SELECT 1 FROM vou_intermediary_sale_order_details x WHERE x.document_id = d.id
          AND (x.customer_name ILIKE '%' || sqlc.arg(keyword) || '%' OR x.supplier_name ILIKE '%' || sqlc.arg(keyword) || '%'))
      OR EXISTS (SELECT 1 FROM vou_intermediary_v2_details x WHERE x.document_id = d.id
          AND (x.customer_code ILIKE '%' || sqlc.arg(keyword) || '%' OR x.customer_name ILIKE '%' || sqlc.arg(keyword) || '%'))
      OR EXISTS (SELECT 1 FROM vou_intermediary_children c
          JOIN vou_intermediary_procurements x ON x.child_id = c.id
          WHERE c.document_id = d.id
            AND (x.supplier_code ILIKE '%' || sqlc.arg(keyword) || '%' OR x.supplier_name ILIKE '%' || sqlc.arg(keyword) || '%'))
      OR EXISTS (SELECT 1 FROM vou_receipt_details x WHERE x.document_id = d.id
          AND (x.counterparty_code ILIKE '%' || sqlc.arg(keyword) || '%' OR x.counterparty_name ILIKE '%' || sqlc.arg(keyword) || '%'))
      OR EXISTS (SELECT 1 FROM vou_payment_details x WHERE x.document_id = d.id
          AND (x.counterparty_code ILIKE '%' || sqlc.arg(keyword) || '%' OR x.counterparty_name ILIKE '%' || sqlc.arg(keyword) || '%'))
      OR EXISTS (SELECT 1 FROM vou_other_income_details x WHERE x.document_id = d.id
          AND (x.source_name ILIKE '%' || sqlc.arg(keyword) || '%' OR x.counterparty_name ILIKE '%' || sqlc.arg(keyword) || '%'))
  );

-- name: ListVouDocuments :many
SELECT d.*,
       COALESCE(so.customer_name, po.supplier_name, iso.customer_name, iso2.customer_name, r.counterparty_name,
                p.counterparty_name, er.employee_name, oi.counterparty_name, oi.source_name, '') AS party_name
FROM vou_documents d
LEFT JOIN vou_sale_order_details so ON so.document_id = d.id
LEFT JOIN vou_purchase_order_details po ON po.document_id = d.id
LEFT JOIN vou_intermediary_sale_order_details iso ON iso.document_id = d.id
LEFT JOIN vou_intermediary_v2_details iso2 ON iso2.document_id = d.id
LEFT JOIN vou_receipt_details r ON r.document_id = d.id
LEFT JOIN vou_payment_details p ON p.document_id = d.id
LEFT JOIN vou_expense_reimbursement_details er ON er.document_id = d.id
LEFT JOIN vou_other_income_details oi ON oi.document_id = d.id
WHERE d.entity = sqlc.arg(entity)
  AND (COALESCE(cardinality(sqlc.arg(statuses)::text[]), 0) = 0 OR d.status = ANY(sqlc.arg(statuses)::text[]))
  AND (sqlc.narg(date_from)::date IS NULL OR d.business_date >= sqlc.narg(date_from)::date)
  AND (sqlc.narg(date_to)::date IS NULL OR d.business_date <= sqlc.narg(date_to)::date)
  AND (
      sqlc.arg(party_object_id)::text = ''
      OR so.customer_object_id = sqlc.arg(party_object_id)
      OR po.supplier_object_id = sqlc.arg(party_object_id)
      OR iso.customer_object_id = sqlc.arg(party_object_id) OR iso.supplier_object_id = sqlc.arg(party_object_id)
      OR iso2.customer_object_id = sqlc.arg(party_object_id)
      OR EXISTS (SELECT 1 FROM vou_intermediary_children c
          JOIN vou_intermediary_procurements x ON x.child_id = c.id
          WHERE c.document_id = d.id AND x.supplier_object_id = sqlc.arg(party_object_id))
      OR r.counterparty_object_id = sqlc.arg(party_object_id)
      OR p.counterparty_object_id = sqlc.arg(party_object_id)
      OR oi.counterparty_object_id = sqlc.arg(party_object_id)
  )
  AND (
      sqlc.arg(keyword)::text = ''
      OR d.document_no ILIKE '%' || sqlc.arg(keyword) || '%'
      OR so.customer_code ILIKE '%' || sqlc.arg(keyword) || '%' OR so.customer_name ILIKE '%' || sqlc.arg(keyword) || '%'
      OR po.supplier_code ILIKE '%' || sqlc.arg(keyword) || '%' OR po.supplier_name ILIKE '%' || sqlc.arg(keyword) || '%'
      OR iso.customer_name ILIKE '%' || sqlc.arg(keyword) || '%' OR iso.supplier_name ILIKE '%' || sqlc.arg(keyword) || '%'
      OR iso2.customer_code ILIKE '%' || sqlc.arg(keyword) || '%' OR iso2.customer_name ILIKE '%' || sqlc.arg(keyword) || '%'
      OR EXISTS (SELECT 1 FROM vou_intermediary_children c
          JOIN vou_intermediary_procurements x ON x.child_id = c.id
          WHERE c.document_id = d.id
            AND (x.supplier_code ILIKE '%' || sqlc.arg(keyword) || '%' OR x.supplier_name ILIKE '%' || sqlc.arg(keyword) || '%'))
      OR r.counterparty_code ILIKE '%' || sqlc.arg(keyword) || '%' OR r.counterparty_name ILIKE '%' || sqlc.arg(keyword) || '%'
      OR p.counterparty_code ILIKE '%' || sqlc.arg(keyword) || '%' OR p.counterparty_name ILIKE '%' || sqlc.arg(keyword) || '%'
      OR oi.source_name ILIKE '%' || sqlc.arg(keyword) || '%' OR oi.counterparty_name ILIKE '%' || sqlc.arg(keyword) || '%'
  )
ORDER BY
  CASE WHEN sqlc.arg(sort_field)::text = 'updatedAt' AND sqlc.arg(sort_order)::text = 'asc' THEN d.updated_at END ASC,
  CASE WHEN sqlc.arg(sort_field)::text = 'updatedAt' AND sqlc.arg(sort_order)::text = 'desc' THEN d.updated_at END DESC,
  CASE WHEN sqlc.arg(sort_field)::text = 'documentNo' AND sqlc.arg(sort_order)::text = 'asc' THEN d.document_no END ASC,
  CASE WHEN sqlc.arg(sort_field)::text = 'documentNo' AND sqlc.arg(sort_order)::text = 'desc' THEN d.document_no END DESC,
  CASE WHEN sqlc.arg(sort_field)::text = 'businessDate' AND sqlc.arg(sort_order)::text = 'asc' THEN d.business_date END ASC,
  CASE WHEN sqlc.arg(sort_field)::text = 'businessDate' AND sqlc.arg(sort_order)::text = 'desc' THEN d.business_date END DESC,
  CASE WHEN sqlc.arg(sort_field)::text = 'status' AND sqlc.arg(sort_order)::text = 'asc' THEN d.status END ASC,
  CASE WHEN sqlc.arg(sort_field)::text = 'status' AND sqlc.arg(sort_order)::text = 'desc' THEN d.status END DESC,
  CASE WHEN sqlc.arg(sort_field)::text = 'amount' AND sqlc.arg(sort_order)::text = 'asc' THEN d.total_amount_cents END ASC,
  CASE WHEN sqlc.arg(sort_field)::text = 'amount' AND sqlc.arg(sort_order)::text = 'desc' THEN d.total_amount_cents END DESC,
  d.id DESC
LIMIT sqlc.arg(page_size) OFFSET sqlc.arg(page_offset);

-- name: InsertVouSaleOrderDetail :exec
INSERT INTO vou_sale_order_details (
    document_id, customer_object_id, customer_version_id, customer_code, customer_name,
    salesperson_object_id, salesperson_version_id, salesperson_code, salesperson_name,
    warehouse_object_id, warehouse_version_id, warehouse_code, warehouse_name,
    contact_name, contact_phone, delivery_address,
    settlement_method_object_id, settlement_method_version_id,
    settlement_method_code, settlement_method_name, settlement_rule_type,
    settlement_month_offset, settlement_day_of_month, settlement_day_offset,
    settlement_description
) VALUES (
    sqlc.arg(document_id), sqlc.arg(customer_object_id), sqlc.arg(customer_version_id),
    sqlc.arg(customer_code), sqlc.arg(customer_name),
    sqlc.arg(salesperson_object_id), sqlc.arg(salesperson_version_id),
    sqlc.arg(salesperson_code), sqlc.arg(salesperson_name),
    sqlc.arg(warehouse_object_id), sqlc.arg(warehouse_version_id),
    sqlc.arg(warehouse_code), sqlc.arg(warehouse_name),
    sqlc.narg(contact_name), sqlc.narg(contact_phone), sqlc.narg(delivery_address),
    sqlc.arg(settlement_method_object_id), sqlc.arg(settlement_method_version_id),
    sqlc.arg(settlement_method_code), sqlc.arg(settlement_method_name),
    sqlc.arg(settlement_rule_type), sqlc.arg(settlement_month_offset),
    sqlc.narg(settlement_day_of_month), sqlc.arg(settlement_day_offset),
    sqlc.narg(settlement_description)
);

-- name: UpdateVouSaleOrderDetail :execrows
UPDATE vou_sale_order_details
SET customer_object_id = sqlc.arg(customer_object_id), customer_version_id = sqlc.arg(customer_version_id),
    customer_code = sqlc.arg(customer_code), customer_name = sqlc.arg(customer_name),
    salesperson_object_id = sqlc.arg(salesperson_object_id),
    salesperson_version_id = sqlc.arg(salesperson_version_id),
    salesperson_code = sqlc.arg(salesperson_code), salesperson_name = sqlc.arg(salesperson_name),
    warehouse_object_id = sqlc.arg(warehouse_object_id),
    warehouse_version_id = sqlc.arg(warehouse_version_id),
    warehouse_code = sqlc.arg(warehouse_code), warehouse_name = sqlc.arg(warehouse_name),
    contact_name = sqlc.narg(contact_name), contact_phone = sqlc.narg(contact_phone),
    delivery_address = sqlc.narg(delivery_address),
    settlement_method_object_id = sqlc.arg(settlement_method_object_id),
    settlement_method_version_id = sqlc.arg(settlement_method_version_id),
    settlement_method_code = sqlc.arg(settlement_method_code),
    settlement_method_name = sqlc.arg(settlement_method_name),
    settlement_rule_type = sqlc.arg(settlement_rule_type),
    settlement_month_offset = sqlc.arg(settlement_month_offset),
    settlement_day_of_month = sqlc.narg(settlement_day_of_month),
    settlement_day_offset = sqlc.arg(settlement_day_offset),
    settlement_description = sqlc.narg(settlement_description)
WHERE document_id = sqlc.arg(document_id);

-- name: GetVouSaleOrderDetail :one
SELECT * FROM vou_sale_order_details WHERE document_id = sqlc.arg(document_id);

-- name: SetVouSaleOrderExecution :execrows
UPDATE vou_sale_order_details
SET outbound_date = sqlc.arg(outbound_date), signoff_date = sqlc.arg(signoff_date),
    platform_object_id = sqlc.arg(platform_object_id), platform_version_id = sqlc.arg(platform_version_id),
    platform_code = sqlc.arg(platform_code), platform_name = sqlc.arg(platform_name),
    vehicle_object_id = sqlc.arg(vehicle_object_id), vehicle_version_id = sqlc.arg(vehicle_version_id),
    vehicle_code = sqlc.arg(vehicle_code), vehicle_name = sqlc.arg(vehicle_name),
    vehicle_plate_number = sqlc.arg(vehicle_plate_number), difference_reason = sqlc.narg(difference_reason)
WHERE document_id = sqlc.arg(document_id);

-- name: ClearVouSaleOrderExecution :execrows
UPDATE vou_sale_order_details
SET outbound_date = NULL, signoff_date = NULL,
    platform_object_id = NULL, platform_version_id = NULL, platform_code = NULL, platform_name = NULL,
    vehicle_object_id = NULL, vehicle_version_id = NULL, vehicle_code = NULL, vehicle_name = NULL,
    vehicle_plate_number = NULL, difference_reason = NULL
WHERE document_id = sqlc.arg(document_id);

-- name: InsertVouPurchaseOrderDetail :exec
INSERT INTO vou_purchase_order_details (
    document_id, supplier_object_id, supplier_version_id, supplier_code, supplier_name,
    purchaser_object_id, purchaser_version_id, purchaser_code, purchaser_name,
    warehouse_object_id, warehouse_version_id, warehouse_code, warehouse_name,
    contact_name, contact_phone,
    settlement_method_object_id, settlement_method_version_id,
    settlement_method_code, settlement_method_name, settlement_rule_type,
    settlement_month_offset, settlement_day_of_month, settlement_day_offset,
    settlement_description
) VALUES (
    sqlc.arg(document_id), sqlc.arg(supplier_object_id), sqlc.arg(supplier_version_id),
    sqlc.arg(supplier_code), sqlc.arg(supplier_name),
    sqlc.arg(purchaser_object_id), sqlc.arg(purchaser_version_id),
    sqlc.arg(purchaser_code), sqlc.arg(purchaser_name),
    sqlc.arg(warehouse_object_id), sqlc.arg(warehouse_version_id),
    sqlc.arg(warehouse_code), sqlc.arg(warehouse_name),
    sqlc.narg(contact_name), sqlc.narg(contact_phone),
    sqlc.arg(settlement_method_object_id), sqlc.arg(settlement_method_version_id),
    sqlc.arg(settlement_method_code), sqlc.arg(settlement_method_name),
    sqlc.arg(settlement_rule_type), sqlc.arg(settlement_month_offset),
    sqlc.narg(settlement_day_of_month), sqlc.arg(settlement_day_offset),
    sqlc.narg(settlement_description)
);

-- name: UpdateVouPurchaseOrderDetail :execrows
UPDATE vou_purchase_order_details
SET supplier_object_id = sqlc.arg(supplier_object_id), supplier_version_id = sqlc.arg(supplier_version_id),
    supplier_code = sqlc.arg(supplier_code), supplier_name = sqlc.arg(supplier_name),
    purchaser_object_id = sqlc.arg(purchaser_object_id),
    purchaser_version_id = sqlc.arg(purchaser_version_id),
    purchaser_code = sqlc.arg(purchaser_code), purchaser_name = sqlc.arg(purchaser_name),
    warehouse_object_id = sqlc.arg(warehouse_object_id),
    warehouse_version_id = sqlc.arg(warehouse_version_id),
    warehouse_code = sqlc.arg(warehouse_code), warehouse_name = sqlc.arg(warehouse_name),
    contact_name = sqlc.narg(contact_name), contact_phone = sqlc.narg(contact_phone),
    settlement_method_object_id = sqlc.arg(settlement_method_object_id),
    settlement_method_version_id = sqlc.arg(settlement_method_version_id),
    settlement_method_code = sqlc.arg(settlement_method_code),
    settlement_method_name = sqlc.arg(settlement_method_name),
    settlement_rule_type = sqlc.arg(settlement_rule_type),
    settlement_month_offset = sqlc.arg(settlement_month_offset),
    settlement_day_of_month = sqlc.narg(settlement_day_of_month),
    settlement_day_offset = sqlc.arg(settlement_day_offset),
    settlement_description = sqlc.narg(settlement_description)
WHERE document_id = sqlc.arg(document_id);

-- name: GetVouPurchaseOrderDetail :one
SELECT * FROM vou_purchase_order_details WHERE document_id = sqlc.arg(document_id);

-- name: SetVouPurchaseOrderExecution :execrows
UPDATE vou_purchase_order_details
SET inbound_date = sqlc.arg(inbound_date), difference_reason = sqlc.narg(difference_reason)
WHERE document_id = sqlc.arg(document_id);

-- name: ClearVouPurchaseOrderExecution :execrows
UPDATE vou_purchase_order_details SET inbound_date = NULL, difference_reason = NULL
WHERE document_id = sqlc.arg(document_id);

-- name: InsertVouIntermediarySaleOrderDetail :exec
INSERT INTO vou_intermediary_sale_order_details (
    document_id, customer_object_id, customer_version_id, customer_code, customer_name,
    supplier_object_id, supplier_version_id, supplier_code, supplier_name,
    salesperson_object_id, salesperson_version_id, salesperson_code, salesperson_name,
    purchaser_object_id, purchaser_version_id, purchaser_code, purchaser_name,
    contact_name, contact_phone, delivery_address,
    customer_settlement_method_object_id, customer_settlement_method_version_id,
    customer_settlement_method_code, customer_settlement_method_name,
    customer_settlement_rule_type, customer_settlement_month_offset,
    customer_settlement_day_of_month, customer_settlement_day_offset,
    customer_settlement_description,
    supplier_settlement_method_object_id, supplier_settlement_method_version_id,
    supplier_settlement_method_code, supplier_settlement_method_name,
    supplier_settlement_rule_type, supplier_settlement_month_offset,
    supplier_settlement_day_of_month, supplier_settlement_day_offset,
    supplier_settlement_description
) VALUES (
    sqlc.arg(document_id), sqlc.arg(customer_object_id), sqlc.arg(customer_version_id),
    sqlc.arg(customer_code), sqlc.arg(customer_name), sqlc.arg(supplier_object_id),
    sqlc.arg(supplier_version_id), sqlc.arg(supplier_code), sqlc.arg(supplier_name),
    sqlc.arg(salesperson_object_id), sqlc.arg(salesperson_version_id),
    sqlc.arg(salesperson_code), sqlc.arg(salesperson_name),
    sqlc.arg(purchaser_object_id), sqlc.arg(purchaser_version_id),
    sqlc.arg(purchaser_code), sqlc.arg(purchaser_name),
    sqlc.narg(contact_name), sqlc.narg(contact_phone), sqlc.narg(delivery_address),
    sqlc.arg(customer_settlement_method_object_id),
    sqlc.arg(customer_settlement_method_version_id),
    sqlc.arg(customer_settlement_method_code), sqlc.arg(customer_settlement_method_name),
    sqlc.arg(customer_settlement_rule_type), sqlc.arg(customer_settlement_month_offset),
    sqlc.narg(customer_settlement_day_of_month), sqlc.arg(customer_settlement_day_offset),
    sqlc.narg(customer_settlement_description),
    sqlc.arg(supplier_settlement_method_object_id),
    sqlc.arg(supplier_settlement_method_version_id),
    sqlc.arg(supplier_settlement_method_code), sqlc.arg(supplier_settlement_method_name),
    sqlc.arg(supplier_settlement_rule_type), sqlc.arg(supplier_settlement_month_offset),
    sqlc.narg(supplier_settlement_day_of_month), sqlc.arg(supplier_settlement_day_offset),
    sqlc.narg(supplier_settlement_description)
);

-- name: UpdateVouIntermediarySaleOrderDetail :execrows
UPDATE vou_intermediary_sale_order_details
SET customer_object_id = sqlc.arg(customer_object_id), customer_version_id = sqlc.arg(customer_version_id),
    customer_code = sqlc.arg(customer_code), customer_name = sqlc.arg(customer_name),
    supplier_object_id = sqlc.arg(supplier_object_id), supplier_version_id = sqlc.arg(supplier_version_id),
    supplier_code = sqlc.arg(supplier_code), supplier_name = sqlc.arg(supplier_name),
    salesperson_object_id = sqlc.arg(salesperson_object_id),
    salesperson_version_id = sqlc.arg(salesperson_version_id),
    salesperson_code = sqlc.arg(salesperson_code), salesperson_name = sqlc.arg(salesperson_name),
    purchaser_object_id = sqlc.arg(purchaser_object_id),
    purchaser_version_id = sqlc.arg(purchaser_version_id),
    purchaser_code = sqlc.arg(purchaser_code), purchaser_name = sqlc.arg(purchaser_name),
    contact_name = sqlc.narg(contact_name), contact_phone = sqlc.narg(contact_phone),
    delivery_address = sqlc.narg(delivery_address),
    customer_settlement_method_object_id = sqlc.arg(customer_settlement_method_object_id),
    customer_settlement_method_version_id = sqlc.arg(customer_settlement_method_version_id),
    customer_settlement_method_code = sqlc.arg(customer_settlement_method_code),
    customer_settlement_method_name = sqlc.arg(customer_settlement_method_name),
    customer_settlement_rule_type = sqlc.arg(customer_settlement_rule_type),
    customer_settlement_month_offset = sqlc.arg(customer_settlement_month_offset),
    customer_settlement_day_of_month = sqlc.narg(customer_settlement_day_of_month),
    customer_settlement_day_offset = sqlc.arg(customer_settlement_day_offset),
    customer_settlement_description = sqlc.narg(customer_settlement_description),
    supplier_settlement_method_object_id = sqlc.arg(supplier_settlement_method_object_id),
    supplier_settlement_method_version_id = sqlc.arg(supplier_settlement_method_version_id),
    supplier_settlement_method_code = sqlc.arg(supplier_settlement_method_code),
    supplier_settlement_method_name = sqlc.arg(supplier_settlement_method_name),
    supplier_settlement_rule_type = sqlc.arg(supplier_settlement_rule_type),
    supplier_settlement_month_offset = sqlc.arg(supplier_settlement_month_offset),
    supplier_settlement_day_of_month = sqlc.narg(supplier_settlement_day_of_month),
    supplier_settlement_day_offset = sqlc.arg(supplier_settlement_day_offset),
    supplier_settlement_description = sqlc.narg(supplier_settlement_description)
WHERE document_id = sqlc.arg(document_id);

-- name: GetVouIntermediarySaleOrderDetail :one
SELECT * FROM vou_intermediary_sale_order_details WHERE document_id = sqlc.arg(document_id);

-- name: SetVouIntermediarySaleOrderExecution :execrows
UPDATE vou_intermediary_sale_order_details
SET outbound_date = sqlc.arg(outbound_date), signoff_date = sqlc.arg(signoff_date),
    platform_object_id = sqlc.arg(platform_object_id), platform_version_id = sqlc.arg(platform_version_id),
    platform_code = sqlc.arg(platform_code), platform_name = sqlc.arg(platform_name),
    vehicle_object_id = sqlc.arg(vehicle_object_id), vehicle_version_id = sqlc.arg(vehicle_version_id),
    vehicle_code = sqlc.arg(vehicle_code), vehicle_name = sqlc.arg(vehicle_name),
    vehicle_plate_number = sqlc.arg(vehicle_plate_number), difference_reason = sqlc.narg(difference_reason)
WHERE document_id = sqlc.arg(document_id);

-- name: ClearVouIntermediarySaleOrderExecution :execrows
UPDATE vou_intermediary_sale_order_details
SET outbound_date = NULL, signoff_date = NULL,
    platform_object_id = NULL, platform_version_id = NULL, platform_code = NULL, platform_name = NULL,
    vehicle_object_id = NULL, vehicle_version_id = NULL, vehicle_code = NULL, vehicle_name = NULL,
    vehicle_plate_number = NULL, difference_reason = NULL
WHERE document_id = sqlc.arg(document_id);

-- name: InsertVouReceiptDetail :exec
INSERT INTO vou_receipt_details (
    document_id, counterparty_entity, counterparty_object_id, counterparty_version_id,
    counterparty_code, counterparty_name, fund_account_object_id, fund_account_version_id,
    fund_account_code, fund_account_name,
    handler_object_id, handler_version_id, handler_code, handler_name
) VALUES (
    sqlc.arg(document_id), sqlc.arg(counterparty_entity), sqlc.arg(counterparty_object_id),
    sqlc.arg(counterparty_version_id), sqlc.arg(counterparty_code), sqlc.arg(counterparty_name),
    sqlc.arg(fund_account_object_id), sqlc.arg(fund_account_version_id),
    sqlc.arg(fund_account_code), sqlc.arg(fund_account_name),
    sqlc.arg(handler_object_id), sqlc.arg(handler_version_id),
    sqlc.arg(handler_code), sqlc.arg(handler_name)
);

-- name: UpdateVouReceiptDetail :execrows
UPDATE vou_receipt_details
SET counterparty_entity = sqlc.arg(counterparty_entity), counterparty_object_id = sqlc.arg(counterparty_object_id),
    counterparty_version_id = sqlc.arg(counterparty_version_id), counterparty_code = sqlc.arg(counterparty_code),
    counterparty_name = sqlc.arg(counterparty_name), fund_account_object_id = sqlc.arg(fund_account_object_id),
    fund_account_version_id = sqlc.arg(fund_account_version_id), fund_account_code = sqlc.arg(fund_account_code),
    fund_account_name = sqlc.arg(fund_account_name),
    handler_object_id = sqlc.arg(handler_object_id), handler_version_id = sqlc.arg(handler_version_id),
    handler_code = sqlc.arg(handler_code), handler_name = sqlc.arg(handler_name)
WHERE document_id = sqlc.arg(document_id);

-- name: GetVouReceiptDetail :one
SELECT * FROM vou_receipt_details WHERE document_id = sqlc.arg(document_id);

-- name: InsertVouPaymentDetail :exec
INSERT INTO vou_payment_details (
    document_id, counterparty_entity, counterparty_object_id, counterparty_version_id,
    counterparty_code, counterparty_name, fund_account_object_id, fund_account_version_id,
    fund_account_code, fund_account_name,
    handler_object_id, handler_version_id, handler_code, handler_name
) VALUES (
    sqlc.arg(document_id), sqlc.arg(counterparty_entity), sqlc.arg(counterparty_object_id),
    sqlc.arg(counterparty_version_id), sqlc.arg(counterparty_code), sqlc.arg(counterparty_name),
    sqlc.arg(fund_account_object_id), sqlc.arg(fund_account_version_id),
    sqlc.arg(fund_account_code), sqlc.arg(fund_account_name),
    sqlc.arg(handler_object_id), sqlc.arg(handler_version_id),
    sqlc.arg(handler_code), sqlc.arg(handler_name)
);

-- name: UpdateVouPaymentDetail :execrows
UPDATE vou_payment_details
SET counterparty_entity = sqlc.arg(counterparty_entity), counterparty_object_id = sqlc.arg(counterparty_object_id),
    counterparty_version_id = sqlc.arg(counterparty_version_id), counterparty_code = sqlc.arg(counterparty_code),
    counterparty_name = sqlc.arg(counterparty_name), fund_account_object_id = sqlc.arg(fund_account_object_id),
    fund_account_version_id = sqlc.arg(fund_account_version_id), fund_account_code = sqlc.arg(fund_account_code),
    fund_account_name = sqlc.arg(fund_account_name),
    handler_object_id = sqlc.arg(handler_object_id), handler_version_id = sqlc.arg(handler_version_id),
    handler_code = sqlc.arg(handler_code), handler_name = sqlc.arg(handler_name)
WHERE document_id = sqlc.arg(document_id);

-- name: GetVouPaymentDetail :one
SELECT * FROM vou_payment_details WHERE document_id = sqlc.arg(document_id);

-- name: InsertVouExpenseReimbursementDetail :exec
INSERT INTO vou_expense_reimbursement_details (
    document_id, employee_object_id, employee_version_id, employee_code, employee_name,
    fund_account_object_id, fund_account_version_id, fund_account_code, fund_account_name
) VALUES (
    sqlc.arg(document_id), sqlc.arg(employee_object_id), sqlc.arg(employee_version_id),
    sqlc.arg(employee_code), sqlc.arg(employee_name), sqlc.arg(fund_account_object_id),
    sqlc.arg(fund_account_version_id), sqlc.arg(fund_account_code), sqlc.arg(fund_account_name)
);

-- name: UpdateVouExpenseReimbursementDetail :execrows
UPDATE vou_expense_reimbursement_details
SET employee_object_id = sqlc.arg(employee_object_id), employee_version_id = sqlc.arg(employee_version_id),
    employee_code = sqlc.arg(employee_code), employee_name = sqlc.arg(employee_name),
    fund_account_object_id = sqlc.arg(fund_account_object_id),
    fund_account_version_id = sqlc.arg(fund_account_version_id),
    fund_account_code = sqlc.arg(fund_account_code), fund_account_name = sqlc.arg(fund_account_name)
WHERE document_id = sqlc.arg(document_id);

-- name: GetVouExpenseReimbursementDetail :one
SELECT * FROM vou_expense_reimbursement_details WHERE document_id = sqlc.arg(document_id);

-- name: InsertVouOtherIncomeDetail :exec
INSERT INTO vou_other_income_details (
    document_id, source_name, counterparty_entity, counterparty_object_id, counterparty_version_id,
    counterparty_code, counterparty_name, fund_account_object_id, fund_account_version_id,
    fund_account_code, fund_account_name,
    handler_object_id, handler_version_id, handler_code, handler_name
) VALUES (
    sqlc.arg(document_id), sqlc.arg(source_name), sqlc.narg(counterparty_entity),
    sqlc.narg(counterparty_object_id), sqlc.narg(counterparty_version_id),
    sqlc.narg(counterparty_code), sqlc.narg(counterparty_name),
    sqlc.arg(fund_account_object_id), sqlc.arg(fund_account_version_id),
    sqlc.arg(fund_account_code), sqlc.arg(fund_account_name),
    sqlc.arg(handler_object_id), sqlc.arg(handler_version_id),
    sqlc.arg(handler_code), sqlc.arg(handler_name)
);

-- name: UpdateVouOtherIncomeDetail :execrows
UPDATE vou_other_income_details
SET source_name = sqlc.arg(source_name), counterparty_entity = sqlc.narg(counterparty_entity),
    counterparty_object_id = sqlc.narg(counterparty_object_id),
    counterparty_version_id = sqlc.narg(counterparty_version_id),
    counterparty_code = sqlc.narg(counterparty_code), counterparty_name = sqlc.narg(counterparty_name),
    fund_account_object_id = sqlc.arg(fund_account_object_id),
    fund_account_version_id = sqlc.arg(fund_account_version_id),
    fund_account_code = sqlc.arg(fund_account_code), fund_account_name = sqlc.arg(fund_account_name),
    handler_object_id = sqlc.arg(handler_object_id), handler_version_id = sqlc.arg(handler_version_id),
    handler_code = sqlc.arg(handler_code), handler_name = sqlc.arg(handler_name)
WHERE document_id = sqlc.arg(document_id);

-- name: GetVouOtherIncomeDetail :one
SELECT * FROM vou_other_income_details WHERE document_id = sqlc.arg(document_id);

-- name: DeleteVouProductLines :exec
DELETE FROM vou_product_lines WHERE document_id = sqlc.arg(document_id);

-- name: InsertVouProductLine :exec
INSERT INTO vou_product_lines (
    id, document_id, document_entity, line_no, product_object_id, product_version_id,
    product_code, product_name, product_unit, ordered_qty_micros, unit_price_cents,
    line_amount_cents, purchase_unit_price_cents, remark
) VALUES (
    sqlc.arg(id), sqlc.arg(document_id), sqlc.arg(document_entity), sqlc.arg(line_no),
    sqlc.arg(product_object_id), sqlc.arg(product_version_id), sqlc.arg(product_code),
    sqlc.arg(product_name), sqlc.arg(product_unit), sqlc.arg(ordered_qty_micros),
    sqlc.arg(unit_price_cents), sqlc.arg(line_amount_cents),
    sqlc.narg(purchase_unit_price_cents), sqlc.narg(remark)
);

-- name: ListVouProductLines :many
SELECT * FROM vou_product_lines WHERE document_id = sqlc.arg(document_id) ORDER BY line_no;

-- name: SetVouSaleLineExecution :execrows
UPDATE vou_product_lines
SET outbound_qty_micros = sqlc.arg(outbound_qty_micros),
    signed_qty_micros = sqlc.arg(signed_qty_micros),
    rejected_qty_micros = sqlc.arg(rejected_qty_micros),
    loss_qty_micros = sqlc.arg(loss_qty_micros)
WHERE id = sqlc.arg(id) AND document_id = sqlc.arg(document_id)
  AND document_entity IN ('sale-order', 'intermediary-sale-order');

-- name: SetVouPurchaseLineExecution :execrows
UPDATE vou_product_lines
SET inbound_qty_micros = sqlc.arg(inbound_qty_micros)
WHERE id = sqlc.arg(id) AND document_id = sqlc.arg(document_id)
  AND document_entity = 'purchase-order';

-- name: ClearVouProductLineExecution :exec
UPDATE vou_product_lines
SET outbound_qty_micros = NULL, signed_qty_micros = NULL,
    rejected_qty_micros = NULL, loss_qty_micros = NULL, inbound_qty_micros = NULL
WHERE document_id = sqlc.arg(document_id);

-- name: DeleteVouExpenseLines :exec
DELETE FROM vou_expense_lines WHERE document_id = sqlc.arg(document_id);

-- name: InsertVouExpenseLine :exec
INSERT INTO vou_expense_lines (
    id, document_id, line_no, category, description, amount_cents, remark
) VALUES (
    sqlc.arg(id), sqlc.arg(document_id), sqlc.arg(line_no),
    sqlc.arg(category), sqlc.arg(description), sqlc.arg(amount_cents), sqlc.narg(remark)
);

-- name: ListVouExpenseLines :many
SELECT * FROM vou_expense_lines WHERE document_id = sqlc.arg(document_id) ORDER BY line_no;

-- name: InsertVouAuditEvent :exec
INSERT INTO vou_audit_events (
    id, document_id, entity, event_type, from_status, to_status, actor_id, reason, request_id, summary
) VALUES (
    sqlc.arg(id), sqlc.arg(document_id), sqlc.arg(entity), sqlc.arg(event_type),
    sqlc.narg(from_status), sqlc.arg(to_status), sqlc.arg(actor_id),
    sqlc.narg(reason), sqlc.arg(request_id), sqlc.arg(summary)
);

-- name: CountVouAuditEvents :one
SELECT count(*) FROM vou_audit_events
WHERE document_id = sqlc.arg(document_id) AND entity = sqlc.arg(entity);

-- name: ListVouAuditEvents :many
SELECT * FROM vou_audit_events
WHERE document_id = sqlc.arg(document_id) AND entity = sqlc.arg(entity)
ORDER BY occurred_at DESC, id DESC
LIMIT sqlc.arg(page_size) OFFSET sqlc.arg(page_offset);

-- name: CountVouAttachments :one
SELECT count(*) FROM vou_document_attachments WHERE document_id = sqlc.arg(document_id);

-- name: TouchVouDraftAttachment :one
UPDATE vou_documents
SET revision = revision + 1, updated_at = now(), updated_by = sqlc.arg(actor_id)
WHERE id = sqlc.arg(id) AND entity = sqlc.arg(entity)
  AND revision = sqlc.arg(revision) AND status = 'DRAFT'
RETURNING revision;

-- name: CountPendingVouAttachments :one
SELECT count(*)
FROM vou_document_attachments a
JOIN vou_files f ON f.id = a.file_id
WHERE a.document_id = sqlc.arg(document_id) AND f.status = 'PENDING';

-- name: InsertVouFile :exec
INSERT INTO vou_files (
    id, storage_key, original_name, content_type, declared_size, sha256_hex,
    upload_token_hash, upload_expires_at, created_by
) VALUES (
    sqlc.arg(id), sqlc.arg(storage_key), sqlc.arg(original_name), sqlc.arg(content_type),
    sqlc.arg(declared_size), sqlc.arg(sha256_hex), sqlc.arg(upload_token_hash),
    sqlc.arg(upload_expires_at), sqlc.arg(actor_id)
);

-- name: InsertVouDocumentAttachment :exec
INSERT INTO vou_document_attachments (document_id, file_id, created_by)
VALUES (sqlc.arg(document_id), sqlc.arg(file_id), sqlc.arg(actor_id));

-- name: ListVouAttachments :many
SELECT f.id, f.original_name, f.content_type, f.declared_size, f.sha256_hex,
       f.status, f.stored_at, a.created_at, a.created_by
FROM vou_document_attachments a
JOIN vou_files f ON f.id = a.file_id
WHERE a.document_id = sqlc.arg(document_id)
ORDER BY a.created_at, f.id;

-- name: LockPendingVouUpload :one
SELECT f.*, links.document_id, links.entity, links.document_status,
       links.child_id, links.child_no, links.stage
FROM vou_files f
JOIN LATERAL (
    SELECT a.document_id, d.entity, d.status AS document_status,
           ''::varchar AS child_id, ''::varchar AS child_no, ''::varchar AS stage
    FROM vou_document_attachments a JOIN vou_documents d ON d.id=a.document_id
    WHERE a.file_id=f.id
    UNION ALL
    SELECT c.document_id, d.entity, c.status AS document_status,
           c.id AS child_id, c.child_no, c.stage
    FROM vou_intermediary_child_attachments a
    JOIN vou_intermediary_children c ON c.id=a.child_id
    JOIN vou_documents d ON d.id=c.document_id
    WHERE a.file_id=f.id
) links ON true
WHERE f.upload_token_hash = sqlc.arg(upload_token_hash)
  AND f.status = 'PENDING' AND f.upload_expires_at > now()
FOR UPDATE OF f;

-- name: MarkVouFileReady :execrows
UPDATE vou_files
SET status = 'READY', stored_at = now()
WHERE id = sqlc.arg(id) AND status = 'PENDING';

-- name: GetReadyVouAttachment :one
SELECT f.*, a.document_id, d.entity
FROM vou_files f
JOIN vou_document_attachments a ON a.file_id = f.id
JOIN vou_documents d ON d.id = a.document_id
WHERE f.id = sqlc.arg(file_id) AND a.document_id = sqlc.arg(document_id) AND f.status = 'READY';

-- name: InsertVouDownloadToken :exec
INSERT INTO vou_download_tokens (token_hash, file_id, expires_at, created_by)
VALUES (sqlc.arg(token_hash), sqlc.arg(file_id), sqlc.arg(expires_at), sqlc.arg(actor_id));

-- name: ConsumeVouDownloadToken :one
UPDATE vou_download_tokens t
SET used_at = now()
FROM vou_files f
WHERE t.token_hash = sqlc.arg(token_hash) AND t.file_id = f.id
  AND t.used_at IS NULL AND t.expires_at > now() AND f.status = 'READY'
RETURNING f.id, f.storage_key, f.original_name, f.content_type, f.declared_size, f.sha256_hex;

-- name: LockVouAttachmentForRemoval :one
SELECT f.*, d.entity, d.status AS document_status
FROM vou_files f
JOIN vou_document_attachments a ON a.file_id = f.id
JOIN vou_documents d ON d.id = a.document_id
WHERE a.document_id = sqlc.arg(document_id) AND f.id = sqlc.arg(file_id)
FOR UPDATE OF f, d;

-- name: DeleteVouDocumentAttachment :execrows
DELETE FROM vou_document_attachments
WHERE document_id = sqlc.arg(document_id) AND file_id = sqlc.arg(file_id);

-- name: DeleteVouAttachmentByFileID :execrows
DELETE FROM vou_document_attachments WHERE file_id = sqlc.arg(file_id);

-- name: DeleteVouChildAttachmentByFileID :execrows
DELETE FROM vou_intermediary_child_attachments WHERE file_id = sqlc.arg(file_id);

-- name: DeleteVouFile :execrows
DELETE FROM vou_files WHERE id = sqlc.arg(id);

-- name: DeleteExpiredVouDownloadTokens :exec
DELETE FROM vou_download_tokens WHERE expires_at <= now() OR used_at IS NOT NULL;

-- name: ListExpiredPendingVouFiles :many
SELECT id, storage_key
FROM vou_files
WHERE status = 'PENDING' AND upload_expires_at <= now()
ORDER BY upload_expires_at
LIMIT sqlc.arg(batch_size);

-- name: LockExpiredPendingVouFile :one
SELECT storage_key
FROM vou_files
WHERE id = sqlc.arg(id) AND status = 'PENDING' AND upload_expires_at <= now()
FOR UPDATE;

-- name: ListAllVouStorageKeys :many
SELECT storage_key FROM vou_files;

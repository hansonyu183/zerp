-- name: NextVouNumberCounter :one
INSERT INTO vou_number_counters (entity, business_date, last_value)
VALUES (sqlc.arg(entity), sqlc.arg(business_date), 1)
ON CONFLICT (entity, business_date)
DO UPDATE SET last_value = vou_number_counters.last_value + 1
WHERE vou_number_counters.last_value < 9999
RETURNING last_value;

-- name: InsertVouInventoryCountDetail :exec
INSERT INTO vou_inventory_count_details(
    document_id,entity,warehouse_object_id,warehouse_version_id,warehouse_code,warehouse_name
) VALUES (
    sqlc.arg(document_id),'inventory-count',sqlc.arg(warehouse_object_id),
    sqlc.arg(warehouse_version_id),sqlc.arg(warehouse_code),sqlc.arg(warehouse_name)
);

-- name: UpdateVouInventoryCountDetail :execrows
UPDATE vou_inventory_count_details SET
    warehouse_object_id=sqlc.arg(warehouse_object_id),
    warehouse_version_id=sqlc.arg(warehouse_version_id),
    warehouse_code=sqlc.arg(warehouse_code),warehouse_name=sqlc.arg(warehouse_name)
WHERE document_id=sqlc.arg(document_id);

-- name: GetVouInventoryCountDetail :one
SELECT * FROM vou_inventory_count_details WHERE document_id=sqlc.arg(document_id);

-- name: DeleteVouInventoryCountLines :exec
DELETE FROM vou_inventory_count_lines WHERE document_id=sqlc.arg(document_id);

-- name: InsertVouInventoryCountLine :exec
INSERT INTO vou_inventory_count_lines(
    id,document_id,line_no,product_object_id,product_version_id,product_code,
    product_name,product_unit,actual_quantity_micros,remark
) VALUES (
    sqlc.arg(id),sqlc.arg(document_id),sqlc.arg(line_no),sqlc.arg(product_object_id),
    sqlc.arg(product_version_id),sqlc.arg(product_code),sqlc.arg(product_name),
    sqlc.arg(product_unit),sqlc.arg(actual_quantity_micros),sqlc.narg(remark)
);

-- name: ListVouInventoryCountLines :many
SELECT * FROM vou_inventory_count_lines
WHERE document_id=sqlc.arg(document_id) ORDER BY line_no;

-- name: SetVouInventoryCountResult :execrows
UPDATE vou_inventory_count_lines SET
    book_quantity_micros=sqlc.arg(book_quantity_micros),
    difference_quantity_micros=sqlc.arg(difference_quantity_micros)
WHERE id=sqlc.arg(id) AND document_id=sqlc.arg(document_id);

-- name: ClearVouInventoryCountResults :exec
UPDATE vou_inventory_count_lines
SET book_quantity_micros=NULL,difference_quantity_micros=NULL
WHERE document_id=sqlc.arg(document_id);

-- name: CountVouInventoryCountBookBalances :one
SELECT count(*) FROM (
    SELECT product_object_id
    FROM led_inventory_entries
    WHERE generation_id=sqlc.arg(generation_id)
      AND warehouse_object_id=sqlc.arg(warehouse_object_id)
      AND effective_date <= sqlc.arg(as_of_date)
    GROUP BY product_object_id
    HAVING sum(quantity_delta_micros) <> 0
) balances;

-- name: ListVouInventoryCountBookBalances :many
SELECT product_object_id,
       (array_agg(product_version_id ORDER BY effective_date DESC,occurred_at DESC,id DESC))[1]::varchar(26) AS product_version_id,
       max(product_code)::varchar(64) AS product_code,
       (array_agg(product_name ORDER BY effective_date DESC,occurred_at DESC,id DESC))[1]::varchar(200) AS product_name,
       (array_agg(product_unit ORDER BY effective_date DESC,occurred_at DESC,id DESC))[1]::varchar(32) AS product_unit,
       sum(quantity_delta_micros)::bigint AS quantity_micros
FROM led_inventory_entries
WHERE generation_id=sqlc.arg(generation_id)
  AND warehouse_object_id=sqlc.arg(warehouse_object_id)
  AND effective_date <= sqlc.arg(as_of_date)
GROUP BY product_object_id
HAVING sum(quantity_delta_micros) <> 0
ORDER BY max(product_code),product_object_id
LIMIT sqlc.arg(page_size) OFFSET sqlc.arg(page_offset);

-- name: GetVouInventoryCountBookQuantity :one
SELECT COALESCE(sum(quantity_delta_micros),0)::bigint
FROM led_inventory_entries
WHERE generation_id=sqlc.arg(generation_id)
  AND warehouse_object_id=sqlc.arg(warehouse_object_id)
  AND product_object_id=sqlc.arg(product_object_id)
  AND effective_date <= sqlc.arg(as_of_date);

-- name: GetVouInventoryCountClosingDate :one
SELECT closing_date FROM led_closings
WHERE id=sqlc.arg(id) AND status='ACTIVE';

-- name: InsertVouAssetAcquisitionDetail :exec
INSERT INTO vou_asset_acquisition_details(document_id,entity,supplier_object_id,supplier_version_id,supplier_code,supplier_name)
VALUES(sqlc.arg(document_id),'asset-acquisition',sqlc.arg(supplier_object_id),sqlc.arg(supplier_version_id),sqlc.arg(supplier_code),sqlc.arg(supplier_name));

-- name: UpdateVouAssetAcquisitionDetail :execrows
UPDATE vou_asset_acquisition_details SET supplier_object_id=sqlc.arg(supplier_object_id),supplier_version_id=sqlc.arg(supplier_version_id),supplier_code=sqlc.arg(supplier_code),supplier_name=sqlc.arg(supplier_name)
WHERE document_id=sqlc.arg(document_id);

-- name: GetVouAssetAcquisitionDetail :one
SELECT * FROM vou_asset_acquisition_details WHERE document_id=sqlc.arg(document_id);

-- name: DeleteVouAssetAcquisitionLines :exec
DELETE FROM vou_asset_acquisition_lines WHERE document_id=sqlc.arg(document_id);

-- name: InsertVouAssetAcquisitionLine :exec
INSERT INTO vou_asset_acquisition_lines(id,document_id,line_no,asset_name,specification,
 category_object_id,category_version_id,category_code,category_name,original_value_cents,useful_life_months,residual_rate_bps,
 department_object_id,department_version_id,department_code,department_name,
 custodian_object_id,custodian_version_id,custodian_code,custodian_name,location,remark)
VALUES(sqlc.arg(id),sqlc.arg(document_id),sqlc.arg(line_no),sqlc.arg(asset_name),sqlc.arg(specification),
 sqlc.arg(category_object_id),sqlc.arg(category_version_id),sqlc.arg(category_code),sqlc.arg(category_name),sqlc.arg(original_value_cents),sqlc.arg(useful_life_months),sqlc.arg(residual_rate_bps),
 sqlc.arg(department_object_id),sqlc.arg(department_version_id),sqlc.arg(department_code),sqlc.arg(department_name),
 sqlc.narg(custodian_object_id),sqlc.narg(custodian_version_id),sqlc.narg(custodian_code),sqlc.narg(custodian_name),sqlc.arg(location),sqlc.narg(remark));

-- name: ListVouAssetAcquisitionLines :many
SELECT * FROM vou_asset_acquisition_lines WHERE document_id=sqlc.arg(document_id) ORDER BY line_no;

-- name: InsertVouAssetDepreciationDetail :exec
INSERT INTO vou_asset_depreciation_details(document_id,entity,depreciation_month)
VALUES(sqlc.arg(document_id),'asset-depreciation',sqlc.arg(depreciation_month));

-- name: UpdateVouAssetDepreciationDetail :execrows
UPDATE vou_asset_depreciation_details SET depreciation_month=sqlc.arg(depreciation_month) WHERE document_id=sqlc.arg(document_id);

-- name: GetVouAssetDepreciationDetail :one
SELECT * FROM vou_asset_depreciation_details WHERE document_id=sqlc.arg(document_id);

-- name: DeleteVouAssetDepreciationLines :exec
DELETE FROM vou_asset_depreciation_lines WHERE document_id=sqlc.arg(document_id);

-- name: InsertVouAssetDepreciationLine :exec
INSERT INTO vou_asset_depreciation_lines(id,document_id,line_no,depreciation_month,asset_id,asset_no,asset_name,amount_cents,opening_accumulated_cents,closing_accumulated_cents,remark)
VALUES(sqlc.arg(id),sqlc.arg(document_id),sqlc.arg(line_no),sqlc.arg(depreciation_month),sqlc.arg(asset_id),sqlc.arg(asset_no),sqlc.arg(asset_name),sqlc.arg(amount_cents),sqlc.arg(opening_accumulated_cents),sqlc.arg(closing_accumulated_cents),sqlc.narg(remark));

-- name: ListVouAssetDepreciationLines :many
SELECT * FROM vou_asset_depreciation_lines WHERE document_id=sqlc.arg(document_id) ORDER BY line_no;

-- name: InsertVouAssetSaleDetail :exec
INSERT INTO vou_asset_sale_details(document_id,entity,counterparty_entity,counterparty_object_id,counterparty_version_id,counterparty_code,counterparty_name)
VALUES(sqlc.arg(document_id),'asset-sale',sqlc.arg(counterparty_entity),sqlc.arg(counterparty_object_id),sqlc.arg(counterparty_version_id),sqlc.arg(counterparty_code),sqlc.arg(counterparty_name));

-- name: UpdateVouAssetSaleDetail :execrows
UPDATE vou_asset_sale_details SET counterparty_entity=sqlc.arg(counterparty_entity),counterparty_object_id=sqlc.arg(counterparty_object_id),counterparty_version_id=sqlc.arg(counterparty_version_id),counterparty_code=sqlc.arg(counterparty_code),counterparty_name=sqlc.arg(counterparty_name)
WHERE document_id=sqlc.arg(document_id);

-- name: GetVouAssetSaleDetail :one
SELECT * FROM vou_asset_sale_details WHERE document_id=sqlc.arg(document_id);

-- name: DeleteVouAssetSaleLines :exec
DELETE FROM vou_asset_sale_lines WHERE document_id=sqlc.arg(document_id);

-- name: InsertVouAssetSaleLine :exec
INSERT INTO vou_asset_sale_lines(id,document_id,line_no,asset_id,asset_no,asset_name,sale_amount_cents,remark)
VALUES(sqlc.arg(id),sqlc.arg(document_id),sqlc.arg(line_no),sqlc.arg(asset_id),sqlc.arg(asset_no),sqlc.arg(asset_name),sqlc.arg(sale_amount_cents),sqlc.narg(remark));

-- name: ListVouAssetSaleLines :many
SELECT * FROM vou_asset_sale_lines WHERE document_id=sqlc.arg(document_id) ORDER BY line_no;

-- name: InsertVouAssetLiquidationDetail :exec
INSERT INTO vou_asset_liquidation_details(document_id,entity) VALUES(sqlc.arg(document_id),'asset-liquidation');

-- name: GetVouAssetLiquidationDetail :one
SELECT * FROM vou_asset_liquidation_details WHERE document_id=sqlc.arg(document_id);

-- name: DeleteVouAssetLiquidationLines :exec
DELETE FROM vou_asset_liquidation_lines WHERE document_id=sqlc.arg(document_id);

-- name: InsertVouAssetLiquidationLine :exec
INSERT INTO vou_asset_liquidation_lines(id,document_id,line_no,asset_id,asset_no,asset_name,reason,salvage_income_cents,disposal_expense_cents,remark)
VALUES(sqlc.arg(id),sqlc.arg(document_id),sqlc.arg(line_no),sqlc.arg(asset_id),sqlc.arg(asset_no),sqlc.arg(asset_name),sqlc.arg(reason),sqlc.arg(salvage_income_cents),sqlc.arg(disposal_expense_cents),sqlc.narg(remark));

-- name: ListVouAssetLiquidationLines :many
SELECT * FROM vou_asset_liquidation_lines WHERE document_id=sqlc.arg(document_id) ORDER BY line_no;

-- name: GetActiveLedAssetForVou :one
SELECT a.* FROM led_assets a JOIN led_control c ON c.active_generation_id=a.generation_id
WHERE c.singleton=true AND c.status='ACTIVE' AND a.id=sqlc.arg(asset_id);

-- name: ListDepreciableLedAssetsForVou :many
SELECT a.* FROM led_assets a JOIN led_control c ON c.active_generation_id=a.generation_id
WHERE c.singleton=true AND c.status='ACTIVE' AND a.status='ACTIVE'
  AND a.depreciation_start_month<=sqlc.arg(depreciation_month)
  AND ((a.last_depreciation_month IS NULL AND a.depreciation_start_month=sqlc.arg(depreciation_month))
    OR a.last_depreciation_month + interval '1 month'=sqlc.arg(depreciation_month))
  AND a.accumulated_depreciation_cents<a.original_value_cents-a.residual_value_cents
  AND (sqlc.arg(category_object_id)::text='' OR a.category_object_id=sqlc.arg(category_object_id))
  AND (sqlc.arg(department_object_id)::text='' OR a.department_object_id=sqlc.arg(department_object_id))
ORDER BY a.asset_no;

-- name: CountVouProductionAttributes :one
SELECT
    (SELECT count(*) FROM vou_production_output_lines production_output
     WHERE production_output.document_id = sqlc.arg(target_document_id)) AS outputs,
    (SELECT count(*)
     FROM vou_production_material_lines material
     JOIN vou_production_output_lines output ON output.id = material.output_line_id
     WHERE output.document_id = sqlc.arg(target_document_id)) AS materials;

-- name: InsertVouSalePricingDetail :exec
INSERT INTO vou_sale_pricing_details(document_id, entity)
VALUES (sqlc.arg(document_id), 'sale-pricing');

-- name: InsertVouPurchaseInquiryDetail :exec
INSERT INTO vou_purchase_inquiry_details(
    document_id, entity, supplier_object_id, supplier_version_id, supplier_code, supplier_name
) VALUES (
    sqlc.arg(document_id), 'purchase-inquiry', sqlc.arg(supplier_object_id),
    sqlc.arg(supplier_version_id), sqlc.arg(supplier_code), sqlc.arg(supplier_name)
);

-- name: UpdateVouPurchaseInquiryDetail :execrows
UPDATE vou_purchase_inquiry_details SET
    supplier_object_id=sqlc.arg(supplier_object_id), supplier_version_id=sqlc.arg(supplier_version_id),
    supplier_code=sqlc.arg(supplier_code), supplier_name=sqlc.arg(supplier_name)
WHERE document_id=sqlc.arg(document_id);

-- name: GetVouPurchaseInquiryDetail :one
SELECT * FROM vou_purchase_inquiry_details WHERE document_id=sqlc.arg(document_id);

-- name: DeleteVouPriceLines :exec
DELETE FROM vou_price_lines WHERE document_id=sqlc.arg(document_id);

-- name: InsertVouPriceLine :exec
INSERT INTO vou_price_lines(
    id,document_id,document_entity,line_no,product_object_id,product_version_id,
    product_code,product_name,product_unit,product_kind,
    pricing_quantity_per_inventory_unit_micros,unit_price_cents,remark
) VALUES (
    sqlc.arg(id),sqlc.arg(document_id),sqlc.arg(document_entity),sqlc.arg(line_no),
    sqlc.arg(product_object_id),sqlc.arg(product_version_id),sqlc.arg(product_code),
    sqlc.arg(product_name),sqlc.arg(product_unit),sqlc.arg(product_kind),
    sqlc.arg(pricing_quantity_per_inventory_unit_micros),sqlc.arg(unit_price_cents),sqlc.narg(remark)
);

-- name: ListVouPriceLines :many
SELECT * FROM vou_price_lines WHERE document_id=sqlc.arg(document_id) ORDER BY line_no;

-- name: FindVouSalePriceReference :one
SELECT line.id AS source_line_id, document.id AS source_document_id,
       document.document_no AS source_document_no, document.business_date,
       line.unit_price_cents
FROM vou_price_lines line
JOIN vou_documents document ON document.id=line.document_id
WHERE line.document_entity='sale-pricing'
  AND line.product_object_id=sqlc.arg(product_object_id)
  AND document.currency=sqlc.arg(currency)
  AND document.business_date <= sqlc.arg(business_date)
  AND document.status = 'APPROVED'
ORDER BY document.business_date DESC, document.document_no DESC
LIMIT 1;

-- name: FindVouPurchasePriceReference :one
SELECT line.id AS source_line_id, document.id AS source_document_id,
       document.document_no AS source_document_no, document.business_date,
       line.unit_price_cents
FROM vou_price_lines line
JOIN vou_documents document ON document.id=line.document_id
JOIN vou_purchase_inquiry_details inquiry ON inquiry.document_id=document.id
WHERE line.document_entity='purchase-inquiry'
  AND line.product_object_id=sqlc.arg(product_object_id)
  AND inquiry.supplier_object_id=sqlc.arg(supplier_object_id)
  AND document.currency=sqlc.arg(currency)
  AND document.business_date <= sqlc.arg(business_date)
  AND document.status = 'APPROVED'
ORDER BY document.business_date DESC, document.document_no DESC
LIMIT 1;

-- name: InsertVouDocument :exec
INSERT INTO vou_documents (
    id, entity, document_no, business_date, due_date, currency, total_amount_cents, remark,
    parent_entity, parent_document_id, created_by, updated_by
) VALUES (
    sqlc.arg(id), sqlc.arg(entity), sqlc.arg(document_no), sqlc.arg(business_date), sqlc.narg(due_date),
    sqlc.arg(currency), sqlc.arg(total_amount_cents), sqlc.narg(remark),
    sqlc.narg(parent_entity), sqlc.narg(parent_document_id),
    sqlc.arg(actor_id), sqlc.arg(actor_id)
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
SET business_date = sqlc.arg(business_date), due_date = sqlc.narg(due_date), currency = sqlc.arg(currency),
    total_amount_cents = sqlc.arg(total_amount_cents), remark = sqlc.narg(remark),
    revision = revision + 1, updated_at = now(), updated_by = sqlc.arg(actor_id)
WHERE id = sqlc.arg(id) AND entity = sqlc.arg(entity)
  AND revision = sqlc.arg(revision) AND status = 'DRAFT'
RETURNING revision;

-- name: CheckVouDocument :one
UPDATE vou_documents
SET status = 'CHECKED', revision = revision + 1,
    reviewed_at = now(), reviewed_by = sqlc.arg(actor_id),
    updated_at = now(), updated_by = sqlc.arg(actor_id)
WHERE id = sqlc.arg(id) AND entity = sqlc.arg(entity)
  AND revision = sqlc.arg(revision) AND status = 'DRAFT'
RETURNING revision;

-- name: UncheckVouDocument :one
UPDATE vou_documents
SET status = 'DRAFT', revision = revision + 1,
    reviewed_at = NULL, reviewed_by = NULL,
    updated_at = now(), updated_by = sqlc.arg(actor_id)
WHERE id = sqlc.arg(id) AND entity = sqlc.arg(entity)
  AND revision = sqlc.arg(revision) AND status = 'CHECKED'
RETURNING revision;

-- name: ApproveVouDocument :one
UPDATE vou_documents
SET status = 'APPROVED', revision = revision + 1,
    approved_at = now(), approved_by = sqlc.arg(actor_id),
    posted_at = now(), posted_by = sqlc.arg(actor_id),
    updated_at = now(), updated_by = sqlc.arg(actor_id)
WHERE id = sqlc.arg(id) AND entity = sqlc.arg(entity)
  AND revision = sqlc.arg(revision) AND status = 'CHECKED'
RETURNING revision;

-- name: UnapproveVouDocument :one
UPDATE vou_documents
SET status = 'CHECKED', revision = revision + 1,
    approved_at = NULL, approved_by = NULL,
    posted_at = NULL, posted_by = NULL,
    updated_at = now(), updated_by = sqlc.arg(actor_id)
WHERE id = sqlc.arg(id) AND entity = sqlc.arg(entity)
  AND revision = sqlc.arg(revision) AND status = 'APPROVED'
RETURNING revision;

-- name: IsVouDocumentInClosedPeriod :one
SELECT EXISTS(
    SELECT 1
    FROM vou_documents document
    JOIN led_control control ON control.singleton = true
    JOIN led_closings closing
      ON closing.id = control.last_closing_id AND closing.status = 'ACTIVE'
    WHERE document.id = $1
      AND document.business_date <= closing.closing_date
);

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
      OR EXISTS (SELECT 1 FROM vou_purchase_inquiry_details x WHERE x.document_id = d.id AND x.supplier_object_id = sqlc.arg(party_object_id))
      OR EXISTS (SELECT 1 FROM vou_sale_outbound_details x WHERE x.document_id = d.id AND x.customer_object_id = sqlc.arg(party_object_id))
      OR EXISTS (SELECT 1 FROM vou_sale_delivery_details x WHERE x.document_id = d.id AND x.customer_object_id = sqlc.arg(party_object_id))
      OR EXISTS (SELECT 1 FROM vou_sale_signoff_details x WHERE x.document_id = d.id AND x.customer_object_id = sqlc.arg(party_object_id))
      OR EXISTS (SELECT 1 FROM vou_sale_return_details x WHERE x.document_id = d.id AND x.customer_object_id = sqlc.arg(party_object_id))
      OR EXISTS (SELECT 1 FROM vou_purchase_order_details x WHERE x.document_id = d.id AND x.supplier_object_id = sqlc.arg(party_object_id))
      OR EXISTS (SELECT 1 FROM vou_purchase_inbound_details x WHERE x.document_id = d.id AND x.supplier_object_id = sqlc.arg(party_object_id))
      OR EXISTS (SELECT 1 FROM vou_purchase_return_details x WHERE x.document_id = d.id AND x.supplier_object_id = sqlc.arg(party_object_id))
      OR EXISTS (SELECT 1 FROM vou_receipt_details x WHERE x.document_id = d.id AND x.counterparty_object_id = sqlc.arg(party_object_id))
      OR EXISTS (SELECT 1 FROM vou_payment_details x WHERE x.document_id = d.id AND x.counterparty_object_id = sqlc.arg(party_object_id))
      OR EXISTS (SELECT 1 FROM vou_expense_payment_details x WHERE x.document_id = d.id AND x.employee_object_id = sqlc.arg(party_object_id))
      OR EXISTS (SELECT 1 FROM vou_employee_loan_writeoff_details x WHERE x.document_id = d.id AND x.employee_object_id = sqlc.arg(party_object_id))
      OR EXISTS (SELECT 1 FROM vou_other_income_details x WHERE x.document_id = d.id AND x.counterparty_object_id = sqlc.arg(party_object_id))
      OR EXISTS (SELECT 1 FROM vou_asset_acquisition_details x WHERE x.document_id = d.id AND x.supplier_object_id = sqlc.arg(party_object_id))
      OR EXISTS (SELECT 1 FROM vou_asset_sale_details x WHERE x.document_id = d.id AND x.counterparty_object_id = sqlc.arg(party_object_id))
      OR EXISTS (SELECT 1 FROM vou_bill_details x WHERE x.document_id = d.id AND x.counterparty_object_id = sqlc.arg(party_object_id))
  )
  AND (
      sqlc.arg(keyword)::text = ''
      OR d.document_no ILIKE '%' || sqlc.arg(keyword) || '%'
      OR EXISTS (SELECT 1 FROM vou_sale_order_details x WHERE x.document_id = d.id
          AND (x.customer_code ILIKE '%' || sqlc.arg(keyword) || '%' OR x.customer_name ILIKE '%' || sqlc.arg(keyword) || '%'))
      OR EXISTS (SELECT 1 FROM vou_purchase_inquiry_details x WHERE x.document_id = d.id
          AND (x.supplier_code ILIKE '%' || sqlc.arg(keyword) || '%' OR x.supplier_name ILIKE '%' || sqlc.arg(keyword) || '%'))
      OR EXISTS (SELECT 1 FROM vou_sale_outbound_details x WHERE x.document_id = d.id
          AND (x.customer_code ILIKE '%' || sqlc.arg(keyword) || '%' OR x.customer_name ILIKE '%' || sqlc.arg(keyword) || '%'))
      OR EXISTS (SELECT 1 FROM vou_sale_delivery_details x WHERE x.document_id = d.id
          AND (x.customer_code ILIKE '%' || sqlc.arg(keyword) || '%' OR x.customer_name ILIKE '%' || sqlc.arg(keyword) || '%'))
      OR EXISTS (SELECT 1 FROM vou_sale_signoff_details x WHERE x.document_id = d.id
          AND (x.customer_code ILIKE '%' || sqlc.arg(keyword) || '%' OR x.customer_name ILIKE '%' || sqlc.arg(keyword) || '%'))
      OR EXISTS (SELECT 1 FROM vou_sale_return_details x WHERE x.document_id = d.id
          AND (x.customer_code ILIKE '%' || sqlc.arg(keyword) || '%' OR x.customer_name ILIKE '%' || sqlc.arg(keyword) || '%'))
      OR EXISTS (SELECT 1 FROM vou_purchase_order_details x WHERE x.document_id = d.id
          AND (x.supplier_code ILIKE '%' || sqlc.arg(keyword) || '%' OR x.supplier_name ILIKE '%' || sqlc.arg(keyword) || '%'))
      OR EXISTS (SELECT 1 FROM vou_purchase_inbound_details x WHERE x.document_id = d.id
          AND (x.supplier_code ILIKE '%' || sqlc.arg(keyword) || '%' OR x.supplier_name ILIKE '%' || sqlc.arg(keyword) || '%'))
      OR EXISTS (SELECT 1 FROM vou_purchase_return_details x WHERE x.document_id = d.id
          AND (x.supplier_code ILIKE '%' || sqlc.arg(keyword) || '%' OR x.supplier_name ILIKE '%' || sqlc.arg(keyword) || '%'))
      OR EXISTS (SELECT 1 FROM vou_receipt_details x WHERE x.document_id = d.id
          AND (x.counterparty_code ILIKE '%' || sqlc.arg(keyword) || '%' OR x.counterparty_name ILIKE '%' || sqlc.arg(keyword) || '%'))
      OR EXISTS (SELECT 1 FROM vou_payment_details x WHERE x.document_id = d.id
          AND (x.counterparty_code ILIKE '%' || sqlc.arg(keyword) || '%' OR x.counterparty_name ILIKE '%' || sqlc.arg(keyword) || '%'))
      OR EXISTS (SELECT 1 FROM vou_expense_payment_details x WHERE x.document_id = d.id
          AND (x.employee_code ILIKE '%' || sqlc.arg(keyword) || '%' OR x.employee_name ILIKE '%' || sqlc.arg(keyword) || '%'))
      OR EXISTS (SELECT 1 FROM vou_employee_loan_writeoff_details x WHERE x.document_id = d.id
          AND (x.employee_code ILIKE '%' || sqlc.arg(keyword) || '%' OR x.employee_name ILIKE '%' || sqlc.arg(keyword) || '%'))
      OR EXISTS (SELECT 1 FROM vou_other_income_details x WHERE x.document_id = d.id
          AND (x.source_name ILIKE '%' || sqlc.arg(keyword) || '%' OR x.counterparty_name ILIKE '%' || sqlc.arg(keyword) || '%'))
      OR EXISTS (SELECT 1 FROM vou_asset_acquisition_details x WHERE x.document_id = d.id
          AND (x.supplier_code ILIKE '%' || sqlc.arg(keyword) || '%' OR x.supplier_name ILIKE '%' || sqlc.arg(keyword) || '%'))
      OR EXISTS (SELECT 1 FROM vou_asset_sale_details x WHERE x.document_id = d.id
          AND (x.counterparty_code ILIKE '%' || sqlc.arg(keyword) || '%' OR x.counterparty_name ILIKE '%' || sqlc.arg(keyword) || '%'))
      OR EXISTS (SELECT 1 FROM vou_bill_details x WHERE x.document_id = d.id
          AND (x.counterparty_code ILIKE '%' || sqlc.arg(keyword) || '%' OR x.counterparty_name ILIKE '%' || sqlc.arg(keyword) || '%'))
  );

-- name: ListVouDocuments :many
SELECT d.*,
       COALESCE(so.customer_name, sob.customer_name, sd.customer_name, ss.customer_name, sr.customer_name,
                pqi.supplier_name, po.supplier_name, pi.supplier_name, pr.supplier_name, r.counterparty_name,
                p.counterparty_name, er.employee_name, ep.employee_name, elw.employee_name, oi.counterparty_name,
                aa.supplier_name, asl.counterparty_name, bd.counterparty_name, oi.source_name, '') AS party_name
FROM vou_documents d
LEFT JOIN vou_sale_order_details so ON so.document_id = d.id
LEFT JOIN vou_sale_outbound_details sob ON sob.document_id = d.id
LEFT JOIN vou_sale_delivery_details sd ON sd.document_id = d.id
LEFT JOIN vou_sale_signoff_details ss ON ss.document_id = d.id
LEFT JOIN vou_sale_return_details sr ON sr.document_id = d.id
LEFT JOIN vou_purchase_inquiry_details pqi ON pqi.document_id = d.id
LEFT JOIN vou_purchase_order_details po ON po.document_id = d.id
LEFT JOIN vou_purchase_inbound_details pi ON pi.document_id = d.id
LEFT JOIN vou_purchase_return_details pr ON pr.document_id = d.id
LEFT JOIN vou_receipt_details r ON r.document_id = d.id
LEFT JOIN vou_payment_details p ON p.document_id = d.id
LEFT JOIN vou_expense_reimbursement_details er ON er.document_id = d.id
LEFT JOIN vou_expense_payment_details ep ON ep.document_id = d.id
LEFT JOIN vou_employee_loan_writeoff_details elw ON elw.document_id = d.id
LEFT JOIN vou_other_income_details oi ON oi.document_id = d.id
LEFT JOIN vou_asset_acquisition_details aa ON aa.document_id = d.id
LEFT JOIN vou_asset_sale_details asl ON asl.document_id = d.id
LEFT JOIN vou_bill_details bd ON bd.document_id = d.id
WHERE d.entity = sqlc.arg(entity)
  AND (COALESCE(cardinality(sqlc.arg(statuses)::text[]), 0) = 0 OR d.status = ANY(sqlc.arg(statuses)::text[]))
  AND (sqlc.narg(date_from)::date IS NULL OR d.business_date >= sqlc.narg(date_from)::date)
  AND (sqlc.narg(date_to)::date IS NULL OR d.business_date <= sqlc.narg(date_to)::date)
  AND (
      sqlc.arg(party_object_id)::text = ''
      OR so.customer_object_id = sqlc.arg(party_object_id)
      OR sob.customer_object_id = sqlc.arg(party_object_id)
      OR sd.customer_object_id = sqlc.arg(party_object_id)
      OR ss.customer_object_id = sqlc.arg(party_object_id)
      OR sr.customer_object_id = sqlc.arg(party_object_id)
      OR po.supplier_object_id = sqlc.arg(party_object_id)
      OR pi.supplier_object_id = sqlc.arg(party_object_id)
      OR pr.supplier_object_id = sqlc.arg(party_object_id)
      OR r.counterparty_object_id = sqlc.arg(party_object_id)
      OR p.counterparty_object_id = sqlc.arg(party_object_id)
      OR ep.employee_object_id = sqlc.arg(party_object_id)
      OR elw.employee_object_id = sqlc.arg(party_object_id)
      OR oi.counterparty_object_id = sqlc.arg(party_object_id)
      OR aa.supplier_object_id = sqlc.arg(party_object_id)
      OR asl.counterparty_object_id = sqlc.arg(party_object_id)
      OR bd.counterparty_object_id = sqlc.arg(party_object_id)
  )
  AND (
      sqlc.arg(keyword)::text = ''
      OR d.document_no ILIKE '%' || sqlc.arg(keyword) || '%'
      OR so.customer_code ILIKE '%' || sqlc.arg(keyword) || '%' OR so.customer_name ILIKE '%' || sqlc.arg(keyword) || '%'
      OR sob.customer_code ILIKE '%' || sqlc.arg(keyword) || '%' OR sob.customer_name ILIKE '%' || sqlc.arg(keyword) || '%'
      OR sd.customer_code ILIKE '%' || sqlc.arg(keyword) || '%' OR sd.customer_name ILIKE '%' || sqlc.arg(keyword) || '%'
      OR ss.customer_code ILIKE '%' || sqlc.arg(keyword) || '%' OR ss.customer_name ILIKE '%' || sqlc.arg(keyword) || '%'
      OR sr.customer_code ILIKE '%' || sqlc.arg(keyword) || '%' OR sr.customer_name ILIKE '%' || sqlc.arg(keyword) || '%'
      OR po.supplier_code ILIKE '%' || sqlc.arg(keyword) || '%' OR po.supplier_name ILIKE '%' || sqlc.arg(keyword) || '%'
      OR pi.supplier_code ILIKE '%' || sqlc.arg(keyword) || '%' OR pi.supplier_name ILIKE '%' || sqlc.arg(keyword) || '%'
      OR pr.supplier_code ILIKE '%' || sqlc.arg(keyword) || '%' OR pr.supplier_name ILIKE '%' || sqlc.arg(keyword) || '%'
      OR r.counterparty_code ILIKE '%' || sqlc.arg(keyword) || '%' OR r.counterparty_name ILIKE '%' || sqlc.arg(keyword) || '%'
      OR p.counterparty_code ILIKE '%' || sqlc.arg(keyword) || '%' OR p.counterparty_name ILIKE '%' || sqlc.arg(keyword) || '%'
      OR ep.employee_code ILIKE '%' || sqlc.arg(keyword) || '%' OR ep.employee_name ILIKE '%' || sqlc.arg(keyword) || '%'
      OR elw.employee_code ILIKE '%' || sqlc.arg(keyword) || '%' OR elw.employee_name ILIKE '%' || sqlc.arg(keyword) || '%'
      OR oi.source_name ILIKE '%' || sqlc.arg(keyword) || '%' OR oi.counterparty_name ILIKE '%' || sqlc.arg(keyword) || '%'
      OR aa.supplier_code ILIKE '%' || sqlc.arg(keyword) || '%' OR aa.supplier_name ILIKE '%' || sqlc.arg(keyword) || '%'
      OR asl.counterparty_code ILIKE '%' || sqlc.arg(keyword) || '%' OR asl.counterparty_name ILIKE '%' || sqlc.arg(keyword) || '%'
      OR bd.counterparty_code ILIKE '%' || sqlc.arg(keyword) || '%' OR bd.counterparty_name ILIKE '%' || sqlc.arg(keyword) || '%'
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
    settlement_due_days, settlement_cutoff_day,
    settlement_default_sales_surcharge_cents, settlement_term_code,
    settlement_description, special_approval
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
    sqlc.narg(settlement_due_days), sqlc.narg(settlement_cutoff_day),
    sqlc.arg(settlement_default_sales_surcharge_cents), sqlc.arg(settlement_term_code),
    sqlc.narg(settlement_description), sqlc.arg(special_approval)
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
    settlement_due_days = sqlc.narg(settlement_due_days),
    settlement_cutoff_day = sqlc.narg(settlement_cutoff_day),
    settlement_default_sales_surcharge_cents = sqlc.arg(settlement_default_sales_surcharge_cents),
    settlement_term_code = sqlc.arg(settlement_term_code),
    settlement_description = sqlc.narg(settlement_description),
    special_approval = sqlc.arg(special_approval)
WHERE document_id = sqlc.arg(document_id);

-- name: GetVouSaleOrderDetail :one
SELECT * FROM vou_sale_order_details WHERE document_id = sqlc.arg(document_id);

-- name: InsertVouPurchaseOrderDetail :exec
INSERT INTO vou_purchase_order_details (
    document_id, supplier_object_id, supplier_version_id, supplier_code, supplier_name,
    purchaser_object_id, purchaser_version_id, purchaser_code, purchaser_name,
    warehouse_object_id, warehouse_version_id, warehouse_code, warehouse_name,
    contact_name, contact_phone,
    settlement_method_object_id, settlement_method_version_id,
    settlement_method_code, settlement_method_name, settlement_rule_type,
    settlement_month_offset, settlement_day_of_month, settlement_day_offset,
    settlement_due_days, settlement_cutoff_day,
    settlement_default_sales_surcharge_cents, settlement_term_code,
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
    sqlc.narg(settlement_due_days), sqlc.narg(settlement_cutoff_day),
    sqlc.arg(settlement_default_sales_surcharge_cents), sqlc.arg(settlement_term_code),
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
    settlement_due_days = sqlc.narg(settlement_due_days),
    settlement_cutoff_day = sqlc.narg(settlement_cutoff_day),
    settlement_default_sales_surcharge_cents = sqlc.arg(settlement_default_sales_surcharge_cents),
    settlement_term_code = sqlc.arg(settlement_term_code),
    settlement_description = sqlc.narg(settlement_description)
WHERE document_id = sqlc.arg(document_id);

-- name: GetVouPurchaseOrderDetail :one
SELECT * FROM vou_purchase_order_details WHERE document_id = sqlc.arg(document_id);

-- name: InsertVouPurchaseInboundDetail :exec
INSERT INTO vou_purchase_inbound_details (
    document_id, source_order_id,
    supplier_object_id, supplier_version_id, supplier_code, supplier_name,
    warehouse_object_id, warehouse_version_id, warehouse_code, warehouse_name
) VALUES (
    sqlc.arg(document_id), sqlc.arg(source_order_id),
    sqlc.arg(supplier_object_id), sqlc.arg(supplier_version_id),
    sqlc.arg(supplier_code), sqlc.arg(supplier_name),
    sqlc.arg(warehouse_object_id), sqlc.arg(warehouse_version_id),
    sqlc.arg(warehouse_code), sqlc.arg(warehouse_name)
);

-- name: GetVouPurchaseInboundDetail :one
SELECT * FROM vou_purchase_inbound_details
WHERE document_id = sqlc.arg(document_id);

-- name: UpdateVouPurchaseInboundWarehouse :execrows
UPDATE vou_purchase_inbound_details
SET warehouse_object_id = sqlc.arg(warehouse_object_id),
    warehouse_version_id = sqlc.arg(warehouse_version_id),
    warehouse_code = sqlc.arg(warehouse_code),
    warehouse_name = sqlc.arg(warehouse_name)
WHERE document_id = sqlc.arg(document_id);

-- name: DeleteVouPurchaseInboundLines :exec
DELETE FROM vou_purchase_inbound_lines WHERE document_id = sqlc.arg(document_id);

-- name: InsertVouPurchaseInboundLine :exec
INSERT INTO vou_purchase_inbound_lines (
    id, document_id, source_order_line_id, line_no,
    product_object_id, product_version_id, product_code, product_name, product_unit,
    quantity_micros, unit_price_cents, line_amount_cents, remark
) VALUES (
    sqlc.arg(id), sqlc.arg(document_id), sqlc.arg(source_order_line_id), sqlc.arg(line_no),
    sqlc.arg(product_object_id), sqlc.arg(product_version_id),
    sqlc.arg(product_code), sqlc.arg(product_name), sqlc.arg(product_unit),
    sqlc.arg(quantity_micros), sqlc.arg(unit_price_cents),
    sqlc.arg(line_amount_cents), sqlc.narg(remark)
);

-- name: ListVouPurchaseInboundLines :many
SELECT * FROM vou_purchase_inbound_lines
WHERE document_id = sqlc.arg(document_id)
ORDER BY line_no;

-- name: InsertVouReceiptDetail :exec
INSERT INTO vou_receipt_details (
    document_id, entity, counterparty_entity, counterparty_object_id, counterparty_version_id,
    counterparty_code, counterparty_name, fund_account_object_id, fund_account_version_id,
    fund_account_code, fund_account_name, other_category,
    handler_object_id, handler_version_id, handler_code, handler_name
) VALUES (
    sqlc.arg(document_id), sqlc.arg(entity),
    sqlc.arg(counterparty_entity), sqlc.arg(counterparty_object_id),
    sqlc.arg(counterparty_version_id), sqlc.arg(counterparty_code), sqlc.arg(counterparty_name),
    sqlc.arg(fund_account_object_id), sqlc.arg(fund_account_version_id),
    sqlc.arg(fund_account_code), sqlc.arg(fund_account_name), sqlc.narg(other_category),
    sqlc.arg(handler_object_id), sqlc.arg(handler_version_id),
    sqlc.arg(handler_code), sqlc.arg(handler_name)
);

-- name: UpdateVouReceiptDetail :execrows
UPDATE vou_receipt_details
SET counterparty_entity = sqlc.arg(counterparty_entity), counterparty_object_id = sqlc.arg(counterparty_object_id),
    counterparty_version_id = sqlc.arg(counterparty_version_id), counterparty_code = sqlc.arg(counterparty_code),
    counterparty_name = sqlc.arg(counterparty_name), fund_account_object_id = sqlc.arg(fund_account_object_id),
    fund_account_version_id = sqlc.arg(fund_account_version_id), fund_account_code = sqlc.arg(fund_account_code),
    fund_account_name = sqlc.arg(fund_account_name), other_category = sqlc.narg(other_category),
    handler_object_id = sqlc.arg(handler_object_id), handler_version_id = sqlc.arg(handler_version_id),
    handler_code = sqlc.arg(handler_code), handler_name = sqlc.arg(handler_name)
WHERE document_id = sqlc.arg(document_id);

-- name: GetVouReceiptDetail :one
SELECT * FROM vou_receipt_details WHERE document_id = sqlc.arg(document_id);

-- name: InsertVouPaymentDetail :exec
INSERT INTO vou_payment_details (
    document_id, entity, counterparty_entity, counterparty_object_id, counterparty_version_id,
    counterparty_code, counterparty_name, fund_account_object_id, fund_account_version_id,
    fund_account_code, fund_account_name, other_category,
    handler_object_id, handler_version_id, handler_code, handler_name
) VALUES (
    sqlc.arg(document_id), sqlc.arg(entity),
    sqlc.arg(counterparty_entity), sqlc.arg(counterparty_object_id),
    sqlc.arg(counterparty_version_id), sqlc.arg(counterparty_code), sqlc.arg(counterparty_name),
    sqlc.arg(fund_account_object_id), sqlc.arg(fund_account_version_id),
    sqlc.arg(fund_account_code), sqlc.arg(fund_account_name), sqlc.narg(other_category),
    sqlc.arg(handler_object_id), sqlc.arg(handler_version_id),
    sqlc.arg(handler_code), sqlc.arg(handler_name)
);

-- name: UpdateVouPaymentDetail :execrows
UPDATE vou_payment_details
SET counterparty_entity = sqlc.arg(counterparty_entity), counterparty_object_id = sqlc.arg(counterparty_object_id),
    counterparty_version_id = sqlc.arg(counterparty_version_id), counterparty_code = sqlc.arg(counterparty_code),
    counterparty_name = sqlc.arg(counterparty_name), fund_account_object_id = sqlc.arg(fund_account_object_id),
    fund_account_version_id = sqlc.arg(fund_account_version_id), fund_account_code = sqlc.arg(fund_account_code),
    fund_account_name = sqlc.arg(fund_account_name), other_category = sqlc.narg(other_category),
    handler_object_id = sqlc.arg(handler_object_id), handler_version_id = sqlc.arg(handler_version_id),
    handler_code = sqlc.arg(handler_code), handler_name = sqlc.arg(handler_name)
WHERE document_id = sqlc.arg(document_id);

-- name: GetVouPaymentDetail :one
SELECT * FROM vou_payment_details WHERE document_id = sqlc.arg(document_id);

-- name: InsertVouExpenseReimbursementDetail :exec
INSERT INTO vou_expense_reimbursement_details (
    document_id, employee_object_id, employee_version_id, employee_code, employee_name,
    fund_account_object_id, fund_account_version_id, fund_account_code, fund_account_name,
    settlement_mode
) VALUES (
    sqlc.arg(document_id), sqlc.arg(employee_object_id), sqlc.arg(employee_version_id),
    sqlc.arg(employee_code), sqlc.arg(employee_name), sqlc.narg(fund_account_object_id),
    sqlc.narg(fund_account_version_id), sqlc.narg(fund_account_code), sqlc.narg(fund_account_name),
    'FLOW_PAYMENT'
);

-- name: UpdateVouExpenseReimbursementDetail :execrows
UPDATE vou_expense_reimbursement_details
SET employee_object_id = sqlc.arg(employee_object_id), employee_version_id = sqlc.arg(employee_version_id),
    employee_code = sqlc.arg(employee_code), employee_name = sqlc.arg(employee_name),
    fund_account_object_id = CASE WHEN settlement_mode='LEGACY_DIRECT' THEN sqlc.narg(fund_account_object_id) ELSE NULL END,
    fund_account_version_id = CASE WHEN settlement_mode='LEGACY_DIRECT' THEN sqlc.narg(fund_account_version_id) ELSE NULL END,
    fund_account_code = CASE WHEN settlement_mode='LEGACY_DIRECT' THEN sqlc.narg(fund_account_code) ELSE NULL END,
    fund_account_name = CASE WHEN settlement_mode='LEGACY_DIRECT' THEN sqlc.narg(fund_account_name) ELSE NULL END
WHERE document_id = sqlc.arg(document_id);

-- name: GetVouExpenseReimbursementDetail :one
SELECT * FROM vou_expense_reimbursement_details WHERE document_id = sqlc.arg(document_id);

-- name: InsertVouExpensePaymentDetail :exec
INSERT INTO vou_expense_payment_details (
    document_id, source_reimbursement_id,
    employee_object_id, employee_version_id, employee_code, employee_name,
    fund_account_object_id, fund_account_version_id, fund_account_code, fund_account_name
) VALUES (
    sqlc.arg(document_id), sqlc.arg(source_reimbursement_id),
    sqlc.arg(employee_object_id), sqlc.arg(employee_version_id),
    sqlc.arg(employee_code), sqlc.arg(employee_name),
    sqlc.arg(fund_account_object_id), sqlc.arg(fund_account_version_id),
    sqlc.arg(fund_account_code), sqlc.arg(fund_account_name)
);

-- name: UpdateVouExpensePaymentFundAccount :execrows
UPDATE vou_expense_payment_details
SET fund_account_object_id=sqlc.arg(fund_account_object_id),
    fund_account_version_id=sqlc.arg(fund_account_version_id),
    fund_account_code=sqlc.arg(fund_account_code),
    fund_account_name=sqlc.arg(fund_account_name)
WHERE document_id=sqlc.arg(document_id);

-- name: GetVouExpensePaymentDetail :one
SELECT * FROM vou_expense_payment_details WHERE document_id=sqlc.arg(document_id);

-- name: InsertVouEmployeeLoanWriteoffDetail :exec
INSERT INTO vou_employee_loan_writeoff_details (
    document_id, employee_object_id, employee_version_id, employee_code, employee_name
) VALUES (
    sqlc.arg(document_id), sqlc.arg(employee_object_id), sqlc.arg(employee_version_id),
    sqlc.arg(employee_code), sqlc.arg(employee_name)
);

-- name: UpdateVouEmployeeLoanWriteoffDetail :execrows
UPDATE vou_employee_loan_writeoff_details
SET employee_object_id=sqlc.arg(employee_object_id), employee_version_id=sqlc.arg(employee_version_id),
    employee_code=sqlc.arg(employee_code), employee_name=sqlc.arg(employee_name)
WHERE document_id=sqlc.arg(document_id);

-- name: GetVouEmployeeLoanWriteoffDetail :one
SELECT * FROM vou_employee_loan_writeoff_details WHERE document_id=sqlc.arg(document_id);

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
    product_code, product_name, product_unit, ordered_qty_micros,
    product_kind, pricing_quantity_per_inventory_unit_micros,
    base_unit_price_cents, settlement_surcharge_cents, unit_price_cents,
    line_amount_cents, purchase_unit_price_cents, remark,
    reference_unit_price_cents, reference_document_id, reference_document_no,
    reference_business_date, reference_line_id
) VALUES (
    sqlc.arg(id), sqlc.arg(document_id), sqlc.arg(document_entity), sqlc.arg(line_no),
    sqlc.arg(product_object_id), sqlc.arg(product_version_id), sqlc.arg(product_code),
    sqlc.arg(product_name), sqlc.arg(product_unit), sqlc.arg(ordered_qty_micros),
    sqlc.arg(product_kind), sqlc.arg(pricing_quantity_per_inventory_unit_micros),
    sqlc.arg(base_unit_price_cents), sqlc.arg(settlement_surcharge_cents),
    sqlc.arg(unit_price_cents), sqlc.arg(line_amount_cents),
    sqlc.narg(purchase_unit_price_cents), sqlc.narg(remark),
    sqlc.arg(reference_unit_price_cents), sqlc.narg(reference_document_id),
    sqlc.narg(reference_document_no), sqlc.narg(reference_business_date),
    sqlc.narg(reference_line_id)
);

-- name: ListVouProductLines :many
SELECT * FROM vou_product_lines WHERE document_id = sqlc.arg(document_id) ORDER BY line_no;

-- name: InsertVouSaleOrderFormula :exec
INSERT INTO vou_sale_order_formulas (
    product_line_id, source_type, source_document_id, source_document_no,
    base_output_quantity_micros
) VALUES (
    sqlc.arg(product_line_id), sqlc.arg(source_type),
    sqlc.narg(source_document_id), sqlc.narg(source_document_no),
    sqlc.arg(base_output_quantity_micros)
);

-- name: InsertVouSaleOrderFormulaLine :exec
INSERT INTO vou_sale_order_formula_lines (
    product_line_id, line_no, material_object_id, material_version_id,
    material_code, material_name, material_unit, quantity_micros
) VALUES (
    sqlc.arg(product_line_id), sqlc.arg(line_no), sqlc.arg(material_object_id),
    sqlc.arg(material_version_id), sqlc.arg(material_code),
    sqlc.arg(material_name), sqlc.arg(material_unit), sqlc.arg(quantity_micros)
);

-- name: GetVouSaleOrderFormula :one
SELECT product_line_id, source_type, source_document_id, source_document_no,
       base_output_quantity_micros
FROM vou_sale_order_formulas
WHERE product_line_id = sqlc.arg(product_line_id);

-- name: ListVouSaleOrderFormulaLines :many
SELECT line_no, material_object_id, material_version_id, material_code,
       material_name, material_unit, quantity_micros
FROM vou_sale_order_formula_lines
WHERE product_line_id = sqlc.arg(product_line_id)
ORDER BY line_no;

-- name: FindLatestCustomerSaleOrderFormula :one
SELECT formula.product_line_id, formula.base_output_quantity_micros,
       document.id AS source_document_id, document.document_no AS source_document_no
FROM vou_documents document
JOIN vou_sale_order_details detail ON detail.document_id = document.id
JOIN vou_product_lines product_line ON product_line.document_id = document.id
JOIN vou_sale_order_formulas formula ON formula.product_line_id = product_line.id
WHERE document.entity = 'sale-order'
  AND document.status IN ('CHECKED', 'APPROVED')
  AND detail.customer_object_id = sqlc.arg(customer_object_id)
  AND product_line.product_object_id = sqlc.arg(product_object_id)
ORDER BY document.business_date DESC, document.document_no DESC
LIMIT 1;

-- name: SetVouSaleLineExecution :execrows
UPDATE vou_product_lines
SET outbound_qty_micros = sqlc.arg(outbound_qty_micros),
    signed_qty_micros = sqlc.arg(signed_qty_micros),
    rejected_qty_micros = sqlc.arg(rejected_qty_micros),
    loss_qty_micros = sqlc.arg(loss_qty_micros)
WHERE id = sqlc.arg(id) AND document_id = sqlc.arg(document_id)
  AND document_entity = 'sale-order';

-- name: ClearVouProductLineExecution :exec
UPDATE vou_product_lines
SET outbound_qty_micros = NULL, signed_qty_micros = NULL,
    rejected_qty_micros = NULL, loss_qty_micros = NULL, inbound_qty_micros = NULL
WHERE document_id = sqlc.arg(document_id);

-- name: DeleteVouExpenseLines :exec
DELETE FROM vou_expense_lines WHERE document_id = sqlc.arg(document_id);

-- name: InsertVouExpenseLine :exec
INSERT INTO vou_expense_lines (
    id, document_id, document_entity, line_no, category, description, amount_cents, remark
) VALUES (
    sqlc.arg(id), sqlc.arg(document_id), sqlc.arg(document_entity), sqlc.arg(line_no),
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

-- name: InsertVouBillDetail :exec
INSERT INTO vou_bill_details(document_id,entity,counterparty_entity,counterparty_object_id,counterparty_version_id,counterparty_code,counterparty_name,handler_object_id,handler_version_id,handler_code,handler_name,internal_cost_rate_bps,maturity_type,interest_mode,interest_party_entity,interest_party_object_id,interest_party_version_id,interest_party_code,interest_party_name,with_recourse)
VALUES(sqlc.arg(document_id),sqlc.arg(entity),sqlc.arg(counterparty_entity),sqlc.arg(counterparty_object_id),sqlc.arg(counterparty_version_id),sqlc.arg(counterparty_code),sqlc.arg(counterparty_name),sqlc.narg(handler_object_id),sqlc.narg(handler_version_id),sqlc.narg(handler_code),sqlc.narg(handler_name),sqlc.arg(internal_cost_rate_bps),sqlc.arg(maturity_type),sqlc.arg(interest_mode),sqlc.narg(interest_party_entity),sqlc.narg(interest_party_object_id),sqlc.narg(interest_party_version_id),sqlc.narg(interest_party_code),sqlc.narg(interest_party_name),sqlc.arg(with_recourse));
-- name: GetVouBillDetail :one
SELECT * FROM vou_bill_details WHERE document_id=sqlc.arg(document_id);
-- name: DeleteVouBillDetails :exec
DELETE FROM vou_bill_details WHERE document_id=sqlc.arg(document_id);
-- name: DeleteVouBillLines :exec
DELETE FROM vou_bill_lines WHERE document_id=sqlc.arg(document_id);
-- name: DeleteVouBillCashLines :exec
DELETE FROM vou_bill_cash_lines WHERE document_id=sqlc.arg(document_id);
-- name: InsertVouBillLine :exec
INSERT INTO vou_bill_lines(id,document_id,line_no,bill_id,position_type,direction,purpose,bill_type,bill_no,medium,currency,face_amount_cents,issue_date,maturity_date,drawer,acceptor,payee,annual_rate_bps,interest_days,interest_amount_cents,customer_cost_amount_cents,remark)
VALUES(sqlc.arg(id),sqlc.arg(document_id),sqlc.arg(line_no),sqlc.arg(bill_id),sqlc.arg(position_type),sqlc.arg(direction),sqlc.arg(purpose),sqlc.arg(bill_type),sqlc.arg(bill_no),sqlc.arg(medium),sqlc.arg(currency),sqlc.arg(face_amount_cents),sqlc.arg(issue_date),sqlc.arg(maturity_date),sqlc.arg(drawer),sqlc.arg(acceptor),sqlc.arg(payee),sqlc.arg(annual_rate_bps),sqlc.arg(interest_days),sqlc.arg(interest_amount_cents),sqlc.arg(customer_cost_amount_cents),sqlc.narg(remark));
-- name: ListVouBillLines :many
SELECT * FROM vou_bill_lines WHERE document_id=sqlc.arg(document_id) ORDER BY line_no;
-- name: SumVouBillLineFaceAmounts :one
SELECT COALESCE(sum(face_amount_cents),0)::bigint FROM vou_bill_lines WHERE document_id=sqlc.arg(document_id);
-- name: UpdateVouBillDocumentTotal :exec
UPDATE vou_documents SET total_amount_cents=sqlc.arg(total_amount_cents),updated_at=now() WHERE id=sqlc.arg(id) AND entity=sqlc.arg(entity);
-- name: InsertVouBillCashLine :exec
INSERT INTO vou_bill_cash_lines(id,document_id,line_no,bill_line_id,fund_account_object_id,fund_account_version_id,fund_account_code,fund_account_name,direction,amount_type,amount_cents,remark)
VALUES(sqlc.arg(id),sqlc.arg(document_id),sqlc.arg(line_no),sqlc.narg(bill_line_id),sqlc.arg(fund_account_object_id),sqlc.arg(fund_account_version_id),sqlc.arg(fund_account_code),sqlc.arg(fund_account_name),sqlc.arg(direction),sqlc.arg(amount_type),sqlc.arg(amount_cents),sqlc.narg(remark));
-- name: ListVouBillCashLines :many
SELECT * FROM vou_bill_cash_lines WHERE document_id=sqlc.arg(document_id) ORDER BY line_no;

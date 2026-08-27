-- name: NextVouNumberCounter :one
INSERT INTO vou_number_counters (entity, business_date, last_value)
VALUES (sqlc.arg(entity), sqlc.arg(business_date), 1)
ON CONFLICT (entity, business_date)
DO UPDATE SET last_value = vou_number_counters.last_value + 1
WHERE vou_number_counters.last_value < 9999
RETURNING last_value;

-- name: InsertVouInventoryCountDetail :exec
INSERT INTO vou_inventory_count_details(
    document_id,entity,warehouse_object_id,warehouse_approval_entry_id,warehouse_code,warehouse_name
) VALUES (
    sqlc.arg(document_id),'inventory-count',sqlc.arg(warehouse_object_id),
    sqlc.arg(warehouse_approval_entry_id),sqlc.arg(warehouse_code),sqlc.arg(warehouse_name)
);

-- name: UpdateVouInventoryCountDetail :execrows
UPDATE vou_inventory_count_details SET
    warehouse_object_id=sqlc.arg(warehouse_object_id),
    warehouse_approval_entry_id=sqlc.arg(warehouse_approval_entry_id),
    warehouse_code=sqlc.arg(warehouse_code),warehouse_name=sqlc.arg(warehouse_name)
WHERE document_id=sqlc.arg(document_id);

-- name: GetVouInventoryCountDetail :one
SELECT * FROM vou_inventory_count_details WHERE document_id=sqlc.arg(document_id);

-- name: DeleteVouInventoryCountLines :exec
DELETE FROM vou_inventory_count_lines WHERE document_id=sqlc.arg(document_id);

-- name: InsertVouInventoryCountLine :exec
INSERT INTO vou_inventory_count_lines(
    id,document_id,line_no,product_object_id,product_approval_entry_id,product_code,
    product_name,entered_quantity_micros,entered_unit_object_id,entered_unit_approval_entry_id,
    entered_unit_code,entered_unit_name,entered_unit_symbol,actual_base_quantity_micros,remark
) VALUES (
    sqlc.arg(id),sqlc.arg(document_id),sqlc.arg(line_no),sqlc.arg(product_object_id),
    sqlc.arg(product_approval_entry_id),sqlc.arg(product_code),sqlc.arg(product_name),
    sqlc.arg(entered_quantity_micros),sqlc.arg(entered_unit_object_id),
    sqlc.arg(entered_unit_approval_entry_id),sqlc.arg(entered_unit_code),sqlc.arg(entered_unit_name),
    sqlc.arg(entered_unit_symbol),sqlc.arg(actual_base_quantity_micros),sqlc.narg(remark)
);

-- name: ListVouInventoryCountLines :many
SELECT * FROM vou_inventory_count_lines
WHERE document_id=sqlc.arg(document_id) ORDER BY line_no;

-- name: SetVouInventoryCountResult :execrows
UPDATE vou_inventory_count_lines SET
    book_base_quantity_micros=sqlc.arg(book_base_quantity_micros),
    difference_base_quantity_micros=sqlc.arg(difference_base_quantity_micros)
WHERE id=sqlc.arg(id) AND document_id=sqlc.arg(document_id);

-- name: ClearVouInventoryCountResults :exec
UPDATE vou_inventory_count_lines
SET book_base_quantity_micros=NULL,difference_base_quantity_micros=NULL
WHERE document_id=sqlc.arg(document_id);

-- name: CountVouInventoryCountBookBalances :one
SELECT count(*) FROM (
    SELECT entry.product_id
    FROM acc_inventory_entries entry
    JOIN acc_books book ON book.id=entry.book_id AND book.control_book
    WHERE entry.warehouse_id=sqlc.arg(warehouse_object_id)
      AND entry.business_date <= sqlc.arg(as_of_date)
    GROUP BY entry.product_id
    HAVING sum(quantity_delta_micros) <> 0
) balances;

-- name: ListVouInventoryCountBookBalances :many
SELECT entry.product_id AS product_object_id,
	   snapshot.product_approval_entry_id,
	   snapshot.product_code,
	   snapshot.product_name,
	   conversion.unit_symbol AS entered_unit_symbol,
	   sum(entry.quantity_delta_micros)::bigint AS base_quantity_micros
FROM acc_inventory_entries entry
JOIN acc_books book ON book.id=entry.book_id AND book.control_book
JOIN LATERAL (
	SELECT source.product_approval_entry_id,source.product_code,source.product_name
	FROM acc_inventory_entries source
	WHERE source.product_id=entry.product_id
	  AND source.warehouse_id=entry.warehouse_id
	  AND source.book_id=entry.book_id
	  AND source.business_date <= sqlc.arg(as_of_date)
	ORDER BY source.business_date DESC,source.id DESC
	LIMIT 1
) snapshot ON true
JOIN dcl_product_versions version ON version.approval_entry_id=snapshot.product_approval_entry_id
JOIN dcl_product_unit_conversions conversion
	ON conversion.product_approval_entry_id=version.approval_entry_id
 AND conversion.unit_object_id=version.default_input_unit_id
WHERE entry.warehouse_id=sqlc.arg(warehouse_object_id)
  AND entry.business_date <= sqlc.arg(as_of_date)
GROUP BY entry.product_id,snapshot.product_approval_entry_id,snapshot.product_code,snapshot.product_name,conversion.unit_symbol
HAVING sum(entry.quantity_delta_micros) <> 0
ORDER BY snapshot.product_code,entry.product_id
LIMIT sqlc.arg(page_size) OFFSET sqlc.arg(page_offset);

-- name: GetVouInventoryCountBookQuantity :one
SELECT COALESCE(sum(quantity_delta_micros),0)::bigint
FROM acc_inventory_entries entry
JOIN acc_books book ON book.id=entry.book_id AND book.control_book
WHERE entry.warehouse_id=sqlc.arg(warehouse_object_id)
  AND entry.product_id=sqlc.arg(product_object_id)
  AND entry.business_date <= sqlc.arg(as_of_date);

-- name: GetAccountingControlBookForVou :one
SELECT id,start_month FROM acc_books WHERE control_book;

-- name: LockAccountingControlBookForVou :one
SELECT id,start_month FROM acc_books WHERE control_book FOR UPDATE;

-- name: InsertVouAssetAcquisitionDetail :exec
INSERT INTO vou_asset_acquisition_details(document_id,entity,supplier_object_id,supplier_approval_entry_id,supplier_code,supplier_name)
VALUES(sqlc.arg(document_id),'asset-acquisition',sqlc.arg(supplier_object_id),sqlc.arg(supplier_approval_entry_id),sqlc.arg(supplier_code),sqlc.arg(supplier_name));

-- name: UpdateVouAssetAcquisitionDetail :execrows
UPDATE vou_asset_acquisition_details SET supplier_object_id=sqlc.arg(supplier_object_id),supplier_approval_entry_id=sqlc.arg(supplier_approval_entry_id),supplier_code=sqlc.arg(supplier_code),supplier_name=sqlc.arg(supplier_name)
WHERE document_id=sqlc.arg(document_id);

-- name: GetVouAssetAcquisitionDetail :one
SELECT * FROM vou_asset_acquisition_details WHERE document_id=sqlc.arg(document_id);

-- name: DeleteVouAssetAcquisitionLines :exec
DELETE FROM vou_asset_acquisition_lines WHERE document_id=sqlc.arg(document_id);

-- name: InsertVouAssetAcquisitionLine :exec
INSERT INTO vou_asset_acquisition_lines(id,document_id,line_no,asset_name,specification,
 category_object_id,category_approval_entry_id,category_code,category_name,original_value_cents,useful_life_months,residual_rate_bps,
 department_object_id,department_approval_entry_id,department_code,department_name,
 custodian_object_id,custodian_approval_entry_id,custodian_code,custodian_name,location,remark)
VALUES(sqlc.arg(id),sqlc.arg(document_id),sqlc.arg(line_no),sqlc.arg(asset_name),sqlc.arg(specification),
 sqlc.arg(category_object_id),sqlc.arg(category_approval_entry_id),sqlc.arg(category_code),sqlc.arg(category_name),sqlc.arg(original_value_cents),sqlc.arg(useful_life_months),sqlc.arg(residual_rate_bps),
 sqlc.arg(department_object_id),sqlc.arg(department_approval_entry_id),sqlc.arg(department_code),sqlc.arg(department_name),
 sqlc.narg(custodian_object_id),sqlc.narg(custodian_approval_entry_id),sqlc.narg(custodian_code),sqlc.narg(custodian_name),sqlc.arg(location),sqlc.narg(remark));

-- name: ListVouAssetAcquisitionLines :many
SELECT * FROM vou_asset_acquisition_lines WHERE document_id=sqlc.arg(document_id) ORDER BY line_no;

-- name: InsertVouAssetSaleDetail :exec
INSERT INTO vou_asset_sale_details(document_id,entity,counterparty_entity,counterparty_object_id,counterparty_approval_entry_id,counterparty_code,counterparty_name)
VALUES(sqlc.arg(document_id),'asset-sale',sqlc.arg(counterparty_entity),sqlc.arg(counterparty_object_id),sqlc.arg(counterparty_approval_entry_id),sqlc.arg(counterparty_code),sqlc.arg(counterparty_name));

-- name: UpdateVouAssetSaleDetail :execrows
UPDATE vou_asset_sale_details SET counterparty_entity=sqlc.arg(counterparty_entity),counterparty_object_id=sqlc.arg(counterparty_object_id),counterparty_approval_entry_id=sqlc.arg(counterparty_approval_entry_id),counterparty_code=sqlc.arg(counterparty_code),counterparty_name=sqlc.arg(counterparty_name)
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

-- name: GetActiveAccountingAssetForVou :one
SELECT id,asset_no,name,acquired_on,state,disposed_on
FROM acc_assets
WHERE id=sqlc.arg(asset_id) AND state='ACTIVE';

-- name: LockAccountingBillForVou :one
SELECT bill.id,bill.bill_no,bill.bill_type,bill.position_type,bill.currency,
       bill.medium,bill.face_amount_minor AS face_amount_cents,
       bill.issue_date,bill.maturity_date,bill.drawer,bill.acceptor,bill.payee,
       bill.annual_rate_bps,bill.interest_days,bill.interest_amount_minor AS interest_amount_cents,
       bill.customer_cost_amount_minor AS customer_cost_amount_cents,bill.state,bill.source_document_id,
       bill.settled_by_document_id
FROM acc_bills bill
WHERE bill.id=sqlc.arg(bill_id)
FOR UPDATE OF bill;

-- name: GetAccountingBillAvailableBalance :one
SELECT CASE WHEN EXISTS (
  SELECT 1 FROM acc_bills bill
  LEFT JOIN vou_documents settlement ON settlement.id=bill.settled_by_document_id
  WHERE bill.id=sqlc.arg(bill_id)
    AND bill.position_type=sqlc.arg(position_type)
    AND bill.issue_date<=sqlc.arg(as_of_date)
    AND (bill.state='AVAILABLE' OR settlement.business_date>sqlc.arg(as_of_date))
) THEN 1::bigint ELSE 0::bigint END;

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
    document_id, entity, supplier_object_id, supplier_approval_entry_id, supplier_code, supplier_name
) VALUES (
    sqlc.arg(document_id), 'purchase-inquiry', sqlc.arg(supplier_object_id),
    sqlc.arg(supplier_approval_entry_id), sqlc.arg(supplier_code), sqlc.arg(supplier_name)
);

-- name: UpdateVouPurchaseInquiryDetail :execrows
UPDATE vou_purchase_inquiry_details SET
    supplier_object_id=sqlc.arg(supplier_object_id), supplier_approval_entry_id=sqlc.arg(supplier_approval_entry_id),
    supplier_code=sqlc.arg(supplier_code), supplier_name=sqlc.arg(supplier_name)
WHERE document_id=sqlc.arg(document_id);

-- name: GetVouPurchaseInquiryDetail :one
SELECT * FROM vou_purchase_inquiry_details WHERE document_id=sqlc.arg(document_id);

-- name: DeleteVouPriceLines :exec
DELETE FROM vou_price_lines WHERE document_id=sqlc.arg(document_id);

-- name: InsertVouPriceLine :exec
INSERT INTO vou_price_lines(
    id,document_id,document_entity,line_no,product_object_id,product_approval_entry_id,
    product_code,product_name,default_input_unit_symbol,behavior_profile,
    product_type_object_id,product_type_approval_entry_id,product_type_code,product_type_name,
    unit_price_cents,remark
) VALUES (
    sqlc.arg(id),sqlc.arg(document_id),sqlc.arg(document_entity),sqlc.arg(line_no),
    sqlc.arg(product_object_id),sqlc.arg(product_approval_entry_id),sqlc.arg(product_code),
    sqlc.arg(product_name),sqlc.arg(default_input_unit_symbol),sqlc.arg(behavior_profile),
    sqlc.arg(product_type_object_id),sqlc.arg(product_type_approval_entry_id),
    sqlc.arg(product_type_code),sqlc.arg(product_type_name),
    sqlc.arg(unit_price_cents),sqlc.narg(remark)
);

-- name: ListVouPriceLines :many
SELECT * FROM vou_price_lines WHERE document_id=sqlc.arg(document_id) ORDER BY line_no;

-- name: FindVouSalePriceReference :one
SELECT line.id AS source_line_id, document.id AS source_document_id,
       document.document_no AS source_document_no, document.business_date,
       line.unit_price_cents
FROM vou_price_lines line
JOIN vou_documents document ON document.id=line.document_id
JOIN approval_entries approval ON approval.id=document.approval_entry_id
WHERE line.document_entity='sale-pricing'
  AND line.product_object_id=sqlc.arg(product_object_id)
  AND document.currency=sqlc.arg(currency)
  AND document.business_date <= sqlc.arg(business_date)
  AND approval.status = 'APPROVED'
ORDER BY document.business_date DESC, document.document_no DESC
LIMIT 1;

-- name: FindVouPurchasePriceReference :one
SELECT line.id AS source_line_id, document.id AS source_document_id,
       document.document_no AS source_document_no, document.business_date,
       line.unit_price_cents
FROM vou_price_lines line
JOIN vou_documents document ON document.id=line.document_id
JOIN approval_entries approval ON approval.id=document.approval_entry_id
JOIN vou_purchase_inquiry_details inquiry ON inquiry.document_id=document.id
WHERE line.document_entity='purchase-inquiry'
  AND line.product_object_id=sqlc.arg(product_object_id)
  AND inquiry.supplier_object_id=sqlc.arg(supplier_object_id)
  AND document.currency=sqlc.arg(currency)
  AND document.business_date <= sqlc.arg(business_date)
  AND approval.status = 'APPROVED'
ORDER BY document.business_date DESC, document.document_no DESC
LIMIT 1;

-- name: InsertVouDocument :exec
INSERT INTO vou_documents (
    id, entity, document_no, approval_entry_id, business_date, due_date, currency, total_amount_cents, remark,
    parent_entity, parent_document_id
) VALUES (
    sqlc.arg(id), sqlc.arg(entity), sqlc.arg(document_no), sqlc.arg(approval_entry_id), sqlc.arg(business_date), sqlc.narg(due_date),
    sqlc.arg(currency), sqlc.arg(total_amount_cents), sqlc.narg(remark),
    sqlc.narg(parent_entity), sqlc.narg(parent_document_id)
);

-- name: LockVouDocument :one
SELECT sqlc.embed(document), sqlc.embed(approval)
FROM vou_documents document
JOIN approval_entries approval ON approval.id=document.approval_entry_id
WHERE document.id = sqlc.arg(id) AND document.entity = sqlc.arg(entity)
  AND approval.domain='vou' AND approval.entity=document.entity AND approval.subject_id=document.id
FOR UPDATE OF approval, document;

-- name: GetVouDocument :one
SELECT sqlc.embed(document), sqlc.embed(approval)
FROM vou_documents document
JOIN approval_entries approval ON approval.id=document.approval_entry_id
WHERE document.id = sqlc.arg(id) AND document.entity = sqlc.arg(entity)
  AND approval.domain='vou' AND approval.entity=document.entity AND approval.subject_id=document.id;

-- name: UpdateVouDraft :one
UPDATE vou_documents
SET business_date = sqlc.arg(business_date), due_date = sqlc.narg(due_date), currency = sqlc.arg(currency),
    total_amount_cents = sqlc.arg(total_amount_cents), remark = sqlc.narg(remark)
WHERE id = sqlc.arg(id) AND entity = sqlc.arg(entity)
RETURNING id;

-- name: IsVouDocumentInClosedPeriod :one
SELECT EXISTS(
    SELECT 1
    FROM vou_documents document
    JOIN acc_periods period
      ON period.period_month=date_trunc('month',document.business_date)::date
     AND period.state='LOCKED'
    WHERE document.id = $1
);

-- name: VouEntityExistsOnBusinessDate :one
SELECT EXISTS(
  SELECT 1
  FROM vou_documents
  WHERE entity = sqlc.arg(entity)
    AND business_date = sqlc.arg(business_date)::date
);

-- name: CountVouDocumentsByEntity :one
SELECT count(*)
FROM vou_documents
WHERE entity = sqlc.arg(entity);

-- name: CountVouDocumentsByParentAndEntity :one
SELECT count(*)
FROM vou_documents
WHERE parent_document_id = sqlc.arg(parent_document_id)
  AND entity = sqlc.arg(entity);

-- name: CountVouDocuments :one
SELECT count(*)
FROM vou_documents d
JOIN approval_entries approval ON approval.id=d.approval_entry_id
WHERE d.entity = sqlc.arg(entity)
  AND approval.domain='vou' AND approval.entity=d.entity AND approval.subject_id=d.id
  AND (COALESCE(cardinality(sqlc.arg(statuses)::text[]), 0) = 0 OR approval.status = ANY(sqlc.arg(statuses)::text[]))
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
SELECT d.*, approval.status, approval.revision, approval.updated_at,
       COALESCE(so.customer_name, sob.customer_name, sd.customer_name, ss.customer_name, sr.customer_name,
                pqi.supplier_name, po.supplier_name, pi.supplier_name, pr.supplier_name, r.counterparty_name,
                p.counterparty_name, er.employee_name, ep.employee_name, elw.employee_name, oi.counterparty_name,
                aa.supplier_name, asl.counterparty_name, bd.counterparty_name, oi.source_name, '') AS party_name
FROM vou_documents d
JOIN approval_entries approval ON approval.id=d.approval_entry_id
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
  AND approval.domain='vou' AND approval.entity=d.entity AND approval.subject_id=d.id
  AND (COALESCE(cardinality(sqlc.arg(statuses)::text[]), 0) = 0 OR approval.status = ANY(sqlc.arg(statuses)::text[]))
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
  CASE WHEN sqlc.arg(sort_field)::text = 'updatedAt' AND sqlc.arg(sort_order)::text = 'asc' THEN approval.updated_at END ASC,
  CASE WHEN sqlc.arg(sort_field)::text = 'updatedAt' AND sqlc.arg(sort_order)::text = 'desc' THEN approval.updated_at END DESC,
  CASE WHEN sqlc.arg(sort_field)::text = 'documentNo' AND sqlc.arg(sort_order)::text = 'asc' THEN d.document_no END ASC,
  CASE WHEN sqlc.arg(sort_field)::text = 'documentNo' AND sqlc.arg(sort_order)::text = 'desc' THEN d.document_no END DESC,
  CASE WHEN sqlc.arg(sort_field)::text = 'businessDate' AND sqlc.arg(sort_order)::text = 'asc' THEN d.business_date END ASC,
  CASE WHEN sqlc.arg(sort_field)::text = 'businessDate' AND sqlc.arg(sort_order)::text = 'desc' THEN d.business_date END DESC,
  CASE WHEN sqlc.arg(sort_field)::text = 'status' AND sqlc.arg(sort_order)::text = 'asc' THEN approval.status END ASC,
  CASE WHEN sqlc.arg(sort_field)::text = 'status' AND sqlc.arg(sort_order)::text = 'desc' THEN approval.status END DESC,
  CASE WHEN sqlc.arg(sort_field)::text = 'amount' AND sqlc.arg(sort_order)::text = 'asc' THEN d.total_amount_cents END ASC,
  CASE WHEN sqlc.arg(sort_field)::text = 'amount' AND sqlc.arg(sort_order)::text = 'desc' THEN d.total_amount_cents END DESC,
  d.id DESC
LIMIT sqlc.arg(page_size) OFFSET sqlc.arg(page_offset);

-- name: InsertVouSaleOrderDetail :exec
INSERT INTO vou_sale_order_details (
    document_id, customer_object_id, customer_approval_entry_id, customer_code, customer_name,
    salesperson_object_id, salesperson_approval_entry_id, salesperson_code, salesperson_name,
    sales_attribution_type, sales_attribution_subject_object_id, sales_attribution_subject_approval_entry_id,
    sales_attribution_subject_code, sales_attribution_subject_name,
    warehouse_object_id, warehouse_approval_entry_id, warehouse_code, warehouse_name,
    contact_name, contact_phone, delivery_address,
    settlement_method_object_id, settlement_method_approval_entry_id,
    settlement_method_code, settlement_method_name, settlement_rule_type,
    settlement_month_offset, settlement_day_of_month, settlement_day_offset,
    settlement_due_days, settlement_cutoff_day,
    settlement_default_sales_surcharge_cents, settlement_term_code,
    settlement_description, special_approval
) VALUES (
    sqlc.arg(document_id), sqlc.arg(customer_object_id), sqlc.arg(customer_approval_entry_id),
    sqlc.arg(customer_code), sqlc.arg(customer_name),
    sqlc.arg(salesperson_object_id), sqlc.arg(salesperson_approval_entry_id),
    sqlc.arg(salesperson_code), sqlc.arg(salesperson_name),
    sqlc.arg(sales_attribution_type), sqlc.arg(sales_attribution_subject_object_id),
    sqlc.arg(sales_attribution_subject_approval_entry_id), sqlc.arg(sales_attribution_subject_code),
    sqlc.arg(sales_attribution_subject_name),
    sqlc.arg(warehouse_object_id), sqlc.arg(warehouse_approval_entry_id),
    sqlc.arg(warehouse_code), sqlc.arg(warehouse_name),
    sqlc.narg(contact_name), sqlc.narg(contact_phone), sqlc.narg(delivery_address),
    sqlc.arg(settlement_method_object_id), sqlc.arg(settlement_method_approval_entry_id),
    sqlc.arg(settlement_method_code), sqlc.arg(settlement_method_name),
    sqlc.arg(settlement_rule_type), sqlc.arg(settlement_month_offset),
    sqlc.narg(settlement_day_of_month), sqlc.arg(settlement_day_offset),
    sqlc.narg(settlement_due_days), sqlc.narg(settlement_cutoff_day),
    sqlc.arg(settlement_default_sales_surcharge_cents), sqlc.arg(settlement_term_code),
    sqlc.narg(settlement_description), sqlc.arg(special_approval)
);

-- name: UpdateVouSaleOrderDetail :execrows
UPDATE vou_sale_order_details
SET customer_object_id = sqlc.arg(customer_object_id), customer_approval_entry_id = sqlc.arg(customer_approval_entry_id),
    customer_code = sqlc.arg(customer_code), customer_name = sqlc.arg(customer_name),
    salesperson_object_id = sqlc.arg(salesperson_object_id),
    salesperson_approval_entry_id = sqlc.arg(salesperson_approval_entry_id),
    salesperson_code = sqlc.arg(salesperson_code), salesperson_name = sqlc.arg(salesperson_name),
    sales_attribution_type = sqlc.arg(sales_attribution_type),
    sales_attribution_subject_object_id = sqlc.arg(sales_attribution_subject_object_id),
    sales_attribution_subject_approval_entry_id = sqlc.arg(sales_attribution_subject_approval_entry_id),
    sales_attribution_subject_code = sqlc.arg(sales_attribution_subject_code),
    sales_attribution_subject_name = sqlc.arg(sales_attribution_subject_name),
    warehouse_object_id = sqlc.arg(warehouse_object_id),
    warehouse_approval_entry_id = sqlc.arg(warehouse_approval_entry_id),
    warehouse_code = sqlc.arg(warehouse_code), warehouse_name = sqlc.arg(warehouse_name),
    contact_name = sqlc.narg(contact_name), contact_phone = sqlc.narg(contact_phone),
    delivery_address = sqlc.narg(delivery_address),
    settlement_method_object_id = sqlc.arg(settlement_method_object_id),
    settlement_method_approval_entry_id = sqlc.arg(settlement_method_approval_entry_id),
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
    document_id, supplier_object_id, supplier_approval_entry_id, supplier_code, supplier_name,
    purchaser_object_id, purchaser_approval_entry_id, purchaser_code, purchaser_name,
    warehouse_object_id, warehouse_approval_entry_id, warehouse_code, warehouse_name,
    contact_name, contact_phone,
    settlement_method_object_id, settlement_method_approval_entry_id,
    settlement_method_code, settlement_method_name, settlement_rule_type,
    settlement_month_offset, settlement_day_of_month, settlement_day_offset,
    settlement_due_days, settlement_cutoff_day,
    settlement_default_sales_surcharge_cents, settlement_term_code,
    settlement_description
) VALUES (
    sqlc.arg(document_id), sqlc.arg(supplier_object_id), sqlc.arg(supplier_approval_entry_id),
    sqlc.arg(supplier_code), sqlc.arg(supplier_name),
    sqlc.arg(purchaser_object_id), sqlc.arg(purchaser_approval_entry_id),
    sqlc.arg(purchaser_code), sqlc.arg(purchaser_name),
    sqlc.arg(warehouse_object_id), sqlc.arg(warehouse_approval_entry_id),
    sqlc.arg(warehouse_code), sqlc.arg(warehouse_name),
    sqlc.narg(contact_name), sqlc.narg(contact_phone),
    sqlc.arg(settlement_method_object_id), sqlc.arg(settlement_method_approval_entry_id),
    sqlc.arg(settlement_method_code), sqlc.arg(settlement_method_name),
    sqlc.arg(settlement_rule_type), sqlc.arg(settlement_month_offset),
    sqlc.narg(settlement_day_of_month), sqlc.arg(settlement_day_offset),
    sqlc.narg(settlement_due_days), sqlc.narg(settlement_cutoff_day),
    sqlc.arg(settlement_default_sales_surcharge_cents), sqlc.arg(settlement_term_code),
    sqlc.narg(settlement_description)
);

-- name: UpdateVouPurchaseOrderDetail :execrows
UPDATE vou_purchase_order_details
SET supplier_object_id = sqlc.arg(supplier_object_id), supplier_approval_entry_id = sqlc.arg(supplier_approval_entry_id),
    supplier_code = sqlc.arg(supplier_code), supplier_name = sqlc.arg(supplier_name),
    purchaser_object_id = sqlc.arg(purchaser_object_id),
    purchaser_approval_entry_id = sqlc.arg(purchaser_approval_entry_id),
    purchaser_code = sqlc.arg(purchaser_code), purchaser_name = sqlc.arg(purchaser_name),
    warehouse_object_id = sqlc.arg(warehouse_object_id),
    warehouse_approval_entry_id = sqlc.arg(warehouse_approval_entry_id),
    warehouse_code = sqlc.arg(warehouse_code), warehouse_name = sqlc.arg(warehouse_name),
    contact_name = sqlc.narg(contact_name), contact_phone = sqlc.narg(contact_phone),
    settlement_method_object_id = sqlc.arg(settlement_method_object_id),
    settlement_method_approval_entry_id = sqlc.arg(settlement_method_approval_entry_id),
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
    supplier_object_id, supplier_approval_entry_id, supplier_code, supplier_name,
    warehouse_object_id, warehouse_approval_entry_id, warehouse_code, warehouse_name
) VALUES (
    sqlc.arg(document_id), sqlc.arg(source_order_id),
    sqlc.arg(supplier_object_id), sqlc.arg(supplier_approval_entry_id),
    sqlc.arg(supplier_code), sqlc.arg(supplier_name),
    sqlc.arg(warehouse_object_id), sqlc.arg(warehouse_approval_entry_id),
    sqlc.arg(warehouse_code), sqlc.arg(warehouse_name)
);

-- name: GetVouPurchaseInboundDetail :one
SELECT * FROM vou_purchase_inbound_details
WHERE document_id = sqlc.arg(document_id);

-- name: UpdateVouPurchaseInboundWarehouse :execrows
UPDATE vou_purchase_inbound_details
SET warehouse_object_id = sqlc.arg(warehouse_object_id),
    warehouse_approval_entry_id = sqlc.arg(warehouse_approval_entry_id),
    warehouse_code = sqlc.arg(warehouse_code),
    warehouse_name = sqlc.arg(warehouse_name)
WHERE document_id = sqlc.arg(document_id);

-- name: DeleteVouPurchaseInboundLines :exec
DELETE FROM vou_purchase_inbound_lines WHERE document_id = sqlc.arg(document_id);

-- name: InsertVouPurchaseInboundLine :exec
INSERT INTO vou_purchase_inbound_lines (
    id, document_id, source_order_line_id, line_no,
    product_object_id, product_approval_entry_id, product_code, product_name, entered_unit_symbol,
    base_quantity_micros, unit_price_cents, line_amount_cents, remark
) VALUES (
    sqlc.arg(id), sqlc.arg(document_id), sqlc.arg(source_order_line_id), sqlc.arg(line_no),
    sqlc.arg(product_object_id), sqlc.arg(product_approval_entry_id),
    sqlc.arg(product_code), sqlc.arg(product_name), sqlc.arg(entered_unit_symbol),
    sqlc.arg(base_quantity_micros), sqlc.arg(unit_price_cents),
    sqlc.arg(line_amount_cents), sqlc.narg(remark)
);

-- name: ListVouPurchaseInboundLines :many
SELECT * FROM vou_purchase_inbound_lines
WHERE document_id = sqlc.arg(document_id)
ORDER BY line_no;

-- name: InsertVouReceiptDetail :exec
INSERT INTO vou_receipt_details (
    document_id, entity, counterparty_entity, counterparty_object_id, counterparty_approval_entry_id,
    counterparty_code, counterparty_name, fund_account_object_id, fund_account_approval_entry_id,
    fund_account_code, fund_account_name, other_category,
    handler_object_id, handler_approval_entry_id, handler_code, handler_name
) VALUES (
    sqlc.arg(document_id), sqlc.arg(entity),
    sqlc.arg(counterparty_entity), sqlc.arg(counterparty_object_id),
    sqlc.arg(counterparty_approval_entry_id), sqlc.arg(counterparty_code), sqlc.arg(counterparty_name),
    sqlc.arg(fund_account_object_id), sqlc.arg(fund_account_approval_entry_id),
    sqlc.arg(fund_account_code), sqlc.arg(fund_account_name), sqlc.narg(other_category),
    sqlc.arg(handler_object_id), sqlc.arg(handler_approval_entry_id),
    sqlc.arg(handler_code), sqlc.arg(handler_name)
);

-- name: UpdateVouReceiptDetail :execrows
UPDATE vou_receipt_details
SET counterparty_entity = sqlc.arg(counterparty_entity), counterparty_object_id = sqlc.arg(counterparty_object_id),
    counterparty_approval_entry_id = sqlc.arg(counterparty_approval_entry_id), counterparty_code = sqlc.arg(counterparty_code),
    counterparty_name = sqlc.arg(counterparty_name), fund_account_object_id = sqlc.arg(fund_account_object_id),
    fund_account_approval_entry_id = sqlc.arg(fund_account_approval_entry_id), fund_account_code = sqlc.arg(fund_account_code),
    fund_account_name = sqlc.arg(fund_account_name), other_category = sqlc.narg(other_category),
    handler_object_id = sqlc.arg(handler_object_id), handler_approval_entry_id = sqlc.arg(handler_approval_entry_id),
    handler_code = sqlc.arg(handler_code), handler_name = sqlc.arg(handler_name)
WHERE document_id = sqlc.arg(document_id);

-- name: GetVouReceiptDetail :one
SELECT * FROM vou_receipt_details WHERE document_id = sqlc.arg(document_id);

-- name: InsertVouPaymentDetail :exec
INSERT INTO vou_payment_details (
    document_id, entity, counterparty_entity, counterparty_object_id, counterparty_approval_entry_id,
    counterparty_code, counterparty_name, fund_account_object_id, fund_account_approval_entry_id,
    fund_account_code, fund_account_name, other_category,
    handler_object_id, handler_approval_entry_id, handler_code, handler_name
) VALUES (
    sqlc.arg(document_id), sqlc.arg(entity),
    sqlc.arg(counterparty_entity), sqlc.arg(counterparty_object_id),
    sqlc.arg(counterparty_approval_entry_id), sqlc.arg(counterparty_code), sqlc.arg(counterparty_name),
    sqlc.arg(fund_account_object_id), sqlc.arg(fund_account_approval_entry_id),
    sqlc.arg(fund_account_code), sqlc.arg(fund_account_name), sqlc.narg(other_category),
    sqlc.arg(handler_object_id), sqlc.arg(handler_approval_entry_id),
    sqlc.arg(handler_code), sqlc.arg(handler_name)
);

-- name: UpdateVouPaymentDetail :execrows
UPDATE vou_payment_details
SET counterparty_entity = sqlc.arg(counterparty_entity), counterparty_object_id = sqlc.arg(counterparty_object_id),
    counterparty_approval_entry_id = sqlc.arg(counterparty_approval_entry_id), counterparty_code = sqlc.arg(counterparty_code),
    counterparty_name = sqlc.arg(counterparty_name), fund_account_object_id = sqlc.arg(fund_account_object_id),
    fund_account_approval_entry_id = sqlc.arg(fund_account_approval_entry_id), fund_account_code = sqlc.arg(fund_account_code),
    fund_account_name = sqlc.arg(fund_account_name), other_category = sqlc.narg(other_category),
    handler_object_id = sqlc.arg(handler_object_id), handler_approval_entry_id = sqlc.arg(handler_approval_entry_id),
    handler_code = sqlc.arg(handler_code), handler_name = sqlc.arg(handler_name)
WHERE document_id = sqlc.arg(document_id);

-- name: GetVouPaymentDetail :one
SELECT * FROM vou_payment_details WHERE document_id = sqlc.arg(document_id);

-- name: InsertVouExpenseReimbursementDetail :exec
INSERT INTO vou_expense_reimbursement_details (
    document_id, employee_object_id, employee_approval_entry_id, employee_code, employee_name
) VALUES (
    sqlc.arg(document_id), sqlc.arg(employee_object_id), sqlc.arg(employee_approval_entry_id),
    sqlc.arg(employee_code), sqlc.arg(employee_name)
);

-- name: UpdateVouExpenseReimbursementDetail :execrows
UPDATE vou_expense_reimbursement_details
SET employee_object_id = sqlc.arg(employee_object_id), employee_approval_entry_id = sqlc.arg(employee_approval_entry_id),
    employee_code = sqlc.arg(employee_code), employee_name = sqlc.arg(employee_name)
WHERE document_id = sqlc.arg(document_id);

-- name: GetVouExpenseReimbursementDetail :one
SELECT * FROM vou_expense_reimbursement_details WHERE document_id = sqlc.arg(document_id);

-- name: InsertVouExpensePaymentDetail :exec
INSERT INTO vou_expense_payment_details (
    document_id, source_reimbursement_id,
    employee_object_id, employee_approval_entry_id, employee_code, employee_name,
    fund_account_object_id, fund_account_approval_entry_id, fund_account_code, fund_account_name
) VALUES (
    sqlc.arg(document_id), sqlc.arg(source_reimbursement_id),
    sqlc.arg(employee_object_id), sqlc.arg(employee_approval_entry_id),
    sqlc.arg(employee_code), sqlc.arg(employee_name),
    sqlc.arg(fund_account_object_id), sqlc.arg(fund_account_approval_entry_id),
    sqlc.arg(fund_account_code), sqlc.arg(fund_account_name)
);

-- name: UpdateVouExpensePaymentFundAccount :execrows
UPDATE vou_expense_payment_details
SET fund_account_object_id=sqlc.arg(fund_account_object_id),
    fund_account_approval_entry_id=sqlc.arg(fund_account_approval_entry_id),
    fund_account_code=sqlc.arg(fund_account_code),
    fund_account_name=sqlc.arg(fund_account_name)
WHERE document_id=sqlc.arg(document_id);

-- name: GetVouExpensePaymentDetail :one
SELECT * FROM vou_expense_payment_details WHERE document_id=sqlc.arg(document_id);

-- name: InsertVouEmployeeLoanWriteoffDetail :exec
INSERT INTO vou_employee_loan_writeoff_details (
    document_id, employee_object_id, employee_approval_entry_id, employee_code, employee_name
) VALUES (
    sqlc.arg(document_id), sqlc.arg(employee_object_id), sqlc.arg(employee_approval_entry_id),
    sqlc.arg(employee_code), sqlc.arg(employee_name)
);

-- name: UpdateVouEmployeeLoanWriteoffDetail :execrows
UPDATE vou_employee_loan_writeoff_details
SET employee_object_id=sqlc.arg(employee_object_id), employee_approval_entry_id=sqlc.arg(employee_approval_entry_id),
    employee_code=sqlc.arg(employee_code), employee_name=sqlc.arg(employee_name)
WHERE document_id=sqlc.arg(document_id);

-- name: GetVouEmployeeLoanWriteoffDetail :one
SELECT * FROM vou_employee_loan_writeoff_details WHERE document_id=sqlc.arg(document_id);

-- name: InsertVouOtherIncomeDetail :exec
INSERT INTO vou_other_income_details (
    document_id, source_name, counterparty_entity, counterparty_object_id, counterparty_approval_entry_id,
    counterparty_code, counterparty_name, fund_account_object_id, fund_account_approval_entry_id,
    fund_account_code, fund_account_name,
    handler_object_id, handler_approval_entry_id, handler_code, handler_name
) VALUES (
    sqlc.arg(document_id), sqlc.arg(source_name), sqlc.narg(counterparty_entity),
    sqlc.narg(counterparty_object_id), sqlc.narg(counterparty_approval_entry_id),
    sqlc.narg(counterparty_code), sqlc.narg(counterparty_name),
    sqlc.arg(fund_account_object_id), sqlc.arg(fund_account_approval_entry_id),
    sqlc.arg(fund_account_code), sqlc.arg(fund_account_name),
    sqlc.arg(handler_object_id), sqlc.arg(handler_approval_entry_id),
    sqlc.arg(handler_code), sqlc.arg(handler_name)
);

-- name: UpdateVouOtherIncomeDetail :execrows
UPDATE vou_other_income_details
SET source_name = sqlc.arg(source_name), counterparty_entity = sqlc.narg(counterparty_entity),
    counterparty_object_id = sqlc.narg(counterparty_object_id),
    counterparty_approval_entry_id = sqlc.narg(counterparty_approval_entry_id),
    counterparty_code = sqlc.narg(counterparty_code), counterparty_name = sqlc.narg(counterparty_name),
    fund_account_object_id = sqlc.arg(fund_account_object_id),
    fund_account_approval_entry_id = sqlc.arg(fund_account_approval_entry_id),
    fund_account_code = sqlc.arg(fund_account_code), fund_account_name = sqlc.arg(fund_account_name),
    handler_object_id = sqlc.arg(handler_object_id), handler_approval_entry_id = sqlc.arg(handler_approval_entry_id),
    handler_code = sqlc.arg(handler_code), handler_name = sqlc.arg(handler_name)
WHERE document_id = sqlc.arg(document_id);

-- name: GetVouOtherIncomeDetail :one
SELECT * FROM vou_other_income_details WHERE document_id = sqlc.arg(document_id);

-- name: DeleteVouProductLines :exec
DELETE FROM vou_product_lines WHERE document_id = sqlc.arg(document_id);

-- name: InsertVouProductLine :exec
INSERT INTO vou_product_lines (
    id, document_id, document_entity, line_no, product_object_id, product_approval_entry_id,
    product_code, product_name, entered_quantity_micros,
    entered_unit_object_id, entered_unit_approval_entry_id, entered_unit_code,
    entered_unit_name, entered_unit_symbol, base_quantity_micros,
    product_type_object_id, product_type_approval_entry_id, product_type_code,
    product_type_name, behavior_profile, default_packaging_spec_micros,
    base_unit_price_cents, settlement_surcharge_cents, unit_price_cents,
    line_amount_cents, purchase_unit_price_cents, remark,
    reference_unit_price_cents, reference_document_id, reference_document_no,
    reference_business_date, reference_line_id, delivery_specification_type
) VALUES (
    sqlc.arg(id), sqlc.arg(document_id), sqlc.arg(document_entity), sqlc.arg(line_no),
    sqlc.arg(product_object_id), sqlc.arg(product_approval_entry_id), sqlc.arg(product_code),
    sqlc.arg(product_name), sqlc.arg(entered_quantity_micros),
    sqlc.arg(entered_unit_object_id), sqlc.arg(entered_unit_approval_entry_id),
    sqlc.arg(entered_unit_code), sqlc.arg(entered_unit_name),
    sqlc.arg(entered_unit_symbol), sqlc.arg(base_quantity_micros),
    sqlc.arg(product_type_object_id), sqlc.arg(product_type_approval_entry_id),
    sqlc.arg(product_type_code), sqlc.arg(product_type_name),
    sqlc.arg(behavior_profile), sqlc.narg(default_packaging_spec_micros),
    sqlc.arg(base_unit_price_cents), sqlc.arg(settlement_surcharge_cents),
    sqlc.arg(unit_price_cents), sqlc.arg(line_amount_cents),
    sqlc.narg(purchase_unit_price_cents), sqlc.narg(remark),
    sqlc.arg(reference_unit_price_cents), sqlc.narg(reference_document_id),
    sqlc.narg(reference_document_no), sqlc.narg(reference_business_date),
    sqlc.narg(reference_line_id), sqlc.arg(delivery_specification_type)
);

-- name: ListVouProductLines :many
SELECT * FROM vou_product_lines WHERE document_id = sqlc.arg(document_id) ORDER BY line_no;

-- name: InsertVouSaleOrderFormula :exec
INSERT INTO vou_sale_order_formulas (
    product_line_id, source_type, source_document_id, source_document_no,
    output_entered_quantity_micros, output_entered_unit_object_id,
    output_entered_unit_approval_entry_id, output_entered_unit_code,
    output_entered_unit_name, output_entered_unit_symbol, output_base_quantity_micros
) VALUES (
    sqlc.arg(product_line_id), sqlc.arg(source_type),
    sqlc.narg(source_document_id), sqlc.narg(source_document_no),
    sqlc.arg(output_entered_quantity_micros), sqlc.arg(output_entered_unit_object_id),
    sqlc.arg(output_entered_unit_approval_entry_id), sqlc.arg(output_entered_unit_code),
    sqlc.arg(output_entered_unit_name), sqlc.arg(output_entered_unit_symbol),
    sqlc.arg(output_base_quantity_micros)
);

-- name: InsertVouSaleOrderFormulaLine :exec
INSERT INTO vou_sale_order_formula_lines (
    product_line_id, line_no, material_object_id, material_approval_entry_id,
    material_code, material_name, entered_quantity_micros,
    entered_unit_object_id, entered_unit_approval_entry_id, entered_unit_code,
    entered_unit_name, entered_unit_symbol, base_quantity_micros
) VALUES (
    sqlc.arg(product_line_id), sqlc.arg(line_no), sqlc.arg(material_object_id),
    sqlc.arg(material_approval_entry_id), sqlc.arg(material_code),
    sqlc.arg(material_name), sqlc.arg(entered_quantity_micros),
    sqlc.arg(entered_unit_object_id), sqlc.arg(entered_unit_approval_entry_id),
    sqlc.arg(entered_unit_code), sqlc.arg(entered_unit_name),
    sqlc.arg(entered_unit_symbol), sqlc.arg(base_quantity_micros)
);

-- name: GetVouSaleOrderFormula :one
SELECT product_line_id, source_type, source_document_id, source_document_no,
       output_entered_quantity_micros, output_entered_unit_object_id,
       output_entered_unit_approval_entry_id, output_entered_unit_code,
       output_entered_unit_name, output_entered_unit_symbol, output_base_quantity_micros
FROM vou_sale_order_formulas
WHERE product_line_id = sqlc.arg(product_line_id);

-- name: ListVouSaleOrderFormulaLines :many
SELECT line_no, material_object_id, material_approval_entry_id, material_code,
       material_name, entered_quantity_micros, entered_unit_object_id,
       entered_unit_approval_entry_id, entered_unit_code, entered_unit_name,
       entered_unit_symbol, base_quantity_micros
FROM vou_sale_order_formula_lines
WHERE product_line_id = sqlc.arg(product_line_id)
ORDER BY line_no;

-- name: FindLatestCustomerSaleOrderFormula :one
SELECT formula.product_line_id, formula.output_base_quantity_micros,
       document.id AS source_document_id, document.document_no AS source_document_no
FROM vou_documents document
JOIN approval_entries approval ON approval.id=document.approval_entry_id
JOIN vou_sale_order_details detail ON detail.document_id = document.id
JOIN vou_product_lines product_line ON product_line.document_id = document.id
JOIN vou_sale_order_formulas formula ON formula.product_line_id = product_line.id
WHERE document.entity = 'sale-order'
  AND approval.status IN ('PENDING', 'APPROVED')
  AND detail.customer_object_id = sqlc.arg(customer_object_id)
  AND product_line.product_object_id = sqlc.arg(product_object_id)
ORDER BY document.business_date DESC, document.document_no DESC
LIMIT 1;

-- name: SetVouSaleLineExecution :execrows
UPDATE vou_product_lines
SET outbound_base_quantity_micros = sqlc.arg(outbound_base_quantity_micros),
    signed_base_quantity_micros = sqlc.arg(signed_base_quantity_micros),
    rejected_base_quantity_micros = sqlc.arg(rejected_base_quantity_micros),
    loss_base_quantity_micros = sqlc.arg(loss_base_quantity_micros)
WHERE id = sqlc.arg(id) AND document_id = sqlc.arg(document_id)
  AND document_entity = 'sale-order';

-- name: ClearVouProductLineExecution :exec
UPDATE vou_product_lines
SET outbound_base_quantity_micros = NULL, signed_base_quantity_micros = NULL,
    rejected_base_quantity_micros = NULL, loss_base_quantity_micros = NULL, inbound_base_quantity_micros = NULL
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

-- name: CountVouAttachments :one
SELECT count(*) FROM vou_document_attachments WHERE document_id = sqlc.arg(document_id);

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
    SELECT a.document_id, d.entity, approval.status AS document_status,
           ''::varchar AS child_id, ''::varchar AS child_no, ''::varchar AS stage
    FROM vou_document_attachments a
    JOIN vou_documents d ON d.id=a.document_id
    JOIN approval_entries approval ON approval.id=d.approval_entry_id
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
SELECT f.*, d.entity, approval.status AS document_status
FROM vou_files f
JOIN vou_document_attachments a ON a.file_id = f.id
JOIN vou_documents d ON d.id = a.document_id
JOIN approval_entries approval ON approval.id=d.approval_entry_id
WHERE a.document_id = sqlc.arg(document_id) AND f.id = sqlc.arg(file_id)
FOR UPDATE OF f, d, approval;

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
INSERT INTO vou_bill_details(document_id,entity,counterparty_entity,counterparty_object_id,counterparty_approval_entry_id,counterparty_code,counterparty_name,handler_object_id,handler_approval_entry_id,handler_code,handler_name,internal_cost_rate_bps,maturity_type,interest_mode,interest_party_entity,interest_party_object_id,interest_party_approval_entry_id,interest_party_code,interest_party_name,with_recourse)
VALUES(sqlc.arg(document_id),sqlc.arg(entity),sqlc.arg(counterparty_entity),sqlc.arg(counterparty_object_id),sqlc.arg(counterparty_approval_entry_id),sqlc.arg(counterparty_code),sqlc.arg(counterparty_name),sqlc.narg(handler_object_id),sqlc.narg(handler_approval_entry_id),sqlc.narg(handler_code),sqlc.narg(handler_name),sqlc.arg(internal_cost_rate_bps),sqlc.arg(maturity_type),sqlc.arg(interest_mode),sqlc.narg(interest_party_entity),sqlc.narg(interest_party_object_id),sqlc.narg(interest_party_approval_entry_id),sqlc.narg(interest_party_code),sqlc.narg(interest_party_name),sqlc.arg(with_recourse));
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
UPDATE vou_documents SET total_amount_cents=sqlc.arg(total_amount_cents) WHERE id=sqlc.arg(id) AND entity=sqlc.arg(entity);
-- name: InsertVouBillCashLine :exec
INSERT INTO vou_bill_cash_lines(id,document_id,line_no,bill_line_id,fund_account_object_id,fund_account_approval_entry_id,fund_account_code,fund_account_name,direction,amount_type,amount_cents,remark)
VALUES(sqlc.arg(id),sqlc.arg(document_id),sqlc.arg(line_no),sqlc.narg(bill_line_id),sqlc.arg(fund_account_object_id),sqlc.arg(fund_account_approval_entry_id),sqlc.arg(fund_account_code),sqlc.arg(fund_account_name),sqlc.arg(direction),sqlc.arg(amount_type),sqlc.arg(amount_cents),sqlc.narg(remark));
-- name: ListVouBillCashLines :many
SELECT * FROM vou_bill_cash_lines WHERE document_id=sqlc.arg(document_id) ORDER BY line_no;

-- name: FindWorkflowVouChild :one
SELECT document.id,document.document_no,approval.status,approval.revision
FROM vou_documents document
JOIN approval_entries approval ON approval.id=document.approval_entry_id
WHERE document.parent_document_id=sqlc.arg(source_document_id) AND document.entity=sqlc.arg(entity)
ORDER BY approval.created_at,document.id LIMIT 1 FOR UPDATE OF document,approval;

-- name: LockWorkflowExpenseReimbursement :one
SELECT d.id,d.entity,d.document_no,approval.status,approval.revision,d.business_date,d.currency,
       d.total_amount_cents,d.remark,approval.created_at,approval.created_by,approval.updated_at,approval.updated_by,
       x.employee_object_id,x.employee_approval_entry_id,x.employee_code,x.employee_name
FROM vou_documents d
JOIN approval_entries approval ON approval.id=d.approval_entry_id
JOIN vou_expense_reimbursement_details x ON x.document_id=d.id
WHERE d.id=sqlc.arg(reimbursement_id)
FOR UPDATE OF d,approval;

-- name: ListGeneratedWorkflowChildrenForUpdate :many
SELECT document.id,document.entity,approval.status,approval.revision,approval.created_by,
       EXISTS(SELECT 1 FROM vou_document_attachments attachment WHERE attachment.document_id=document.id) AS has_attachments
FROM vou_documents document
JOIN approval_entries approval ON approval.id=document.approval_entry_id
WHERE document.parent_document_id=sqlc.arg(parent_document_id) FOR UPDATE OF document,approval;

-- name: DeleteVouSaleOutboundLines :exec
DELETE FROM vou_sale_outbound_lines WHERE document_id=sqlc.arg(document_id);
-- name: DeleteVouSaleOutboundDetails :exec
DELETE FROM vou_sale_outbound_details WHERE document_id=sqlc.arg(document_id);
-- name: DeleteVouSaleOrderDetails :exec
DELETE FROM vou_sale_order_details WHERE document_id=sqlc.arg(document_id);
-- name: DeleteVouSaleDeliveryDetails :exec
DELETE FROM vou_sale_delivery_details WHERE document_id=sqlc.arg(document_id);
-- name: DeleteVouSaleSignoffLines :exec
DELETE FROM vou_sale_signoff_lines WHERE document_id=sqlc.arg(document_id);
-- name: DeleteVouSaleSignoffDetails :exec
DELETE FROM vou_sale_signoff_details WHERE document_id=sqlc.arg(document_id);
-- name: DeleteVouPurchaseInboundDetails :exec
DELETE FROM vou_purchase_inbound_details WHERE document_id=sqlc.arg(document_id);
-- name: DeleteVouExpensePaymentDetails :exec
DELETE FROM vou_expense_payment_details WHERE document_id=sqlc.arg(document_id);
-- name: DeleteVouEmployeeLoanWriteoffDetails :exec
DELETE FROM vou_employee_loan_writeoff_details WHERE document_id=sqlc.arg(document_id);
-- name: DeleteVouReceiptDetails :exec
DELETE FROM vou_receipt_details WHERE document_id=sqlc.arg(document_id);
-- name: DeleteVouPaymentDetails :exec
DELETE FROM vou_payment_details WHERE document_id=sqlc.arg(document_id);
-- name: DeleteVouSaleReturnLines :exec
DELETE FROM vou_sale_return_lines WHERE document_id=sqlc.arg(document_id);
-- name: DeleteVouSaleReturnDetails :exec
DELETE FROM vou_sale_return_details WHERE document_id=sqlc.arg(document_id);

-- name: VouSaleOutboundRequiresBulkLiquidVehicle :one
SELECT EXISTS(
    SELECT 1
    FROM vou_sale_outbound_lines AS outbound_line
    JOIN vou_product_lines AS order_line ON order_line.id=outbound_line.source_order_line_id
    WHERE outbound_line.document_id=sqlc.arg(document_id)
      AND order_line.delivery_specification_type='BULK_LIQUID'
);

-- name: LockVouSaleDeliveryCarrierSnapshot :one
SELECT source_outbound_id,carrier_type,
       carrier_operating_entity_object_id,carrier_operating_entity_approval_entry_id,
       carrier_service_relationship_object_id,carrier_service_relationship_approval_entry_id,
       vehicle_object_id,vehicle_approval_entry_id
FROM vou_sale_delivery_details
WHERE document_id=sqlc.arg(document_id)
FOR UPDATE;

-- name: LockVouSaleOutboundSource :one
SELECT document.document_no,approval.status,document.business_date,
       COALESCE(document.currency,'') AS currency,document.total_amount_cents,
       outbound.customer_object_id,outbound.customer_approval_entry_id,
       outbound.customer_code,outbound.customer_name,
       outbound.warehouse_object_id,outbound.warehouse_approval_entry_id,
       outbound.warehouse_code,outbound.warehouse_name,
       relationship.operating_entity_id
FROM vou_documents AS document
JOIN approval_entries approval ON approval.id=document.approval_entry_id
JOIN vou_sale_outbound_details AS outbound ON outbound.document_id=document.id
JOIN bob_customer_accounts AS account ON account.object_id=outbound.customer_object_id
JOIN bob_customer_relationships AS relationship ON relationship.object_id=account.customer_relationship_id
WHERE document.id=sqlc.arg(document_id) AND document.entity='sale-outbound'
FOR UPDATE OF document,approval,outbound;

-- name: InsertVouSaleDeliveryDetail :exec
INSERT INTO vou_sale_delivery_details(
    document_id,source_outbound_id,customer_object_id,customer_approval_entry_id,customer_code,customer_name,
    carrier_type,
    carrier_operating_entity_object_id,carrier_operating_entity_approval_entry_id,
    carrier_operating_entity_code,carrier_operating_entity_name,
    carrier_service_relationship_object_id,carrier_service_relationship_approval_entry_id,
    carrier_service_relationship_code,carrier_service_relationship_name,
    vehicle_object_id,vehicle_approval_entry_id,vehicle_code,vehicle_name,
    vehicle_plate_number,vehicle_bulk_liquid_capable
) VALUES(
    sqlc.arg(document_id),sqlc.arg(source_outbound_id),sqlc.arg(customer_object_id),
    sqlc.arg(customer_approval_entry_id),sqlc.arg(customer_code),sqlc.arg(customer_name),
    sqlc.arg(carrier_type),sqlc.narg(carrier_operating_entity_object_id),
    sqlc.narg(carrier_operating_entity_approval_entry_id),sqlc.narg(carrier_operating_entity_code),
    sqlc.narg(carrier_operating_entity_name),sqlc.narg(carrier_service_relationship_object_id),
    sqlc.narg(carrier_service_relationship_approval_entry_id),sqlc.narg(carrier_service_relationship_code),
    sqlc.narg(carrier_service_relationship_name),sqlc.arg(vehicle_object_id),
    sqlc.arg(vehicle_approval_entry_id),sqlc.arg(vehicle_code),sqlc.arg(vehicle_name),
    sqlc.arg(vehicle_plate_number),sqlc.arg(vehicle_bulk_liquid_capable)
);

-- name: UpdateVouSaleDeliveryCarrierSnapshot :execrows
UPDATE vou_sale_delivery_details SET
    carrier_type=sqlc.arg(carrier_type),
    carrier_operating_entity_object_id=sqlc.narg(carrier_operating_entity_object_id),
    carrier_operating_entity_approval_entry_id=sqlc.narg(carrier_operating_entity_approval_entry_id),
    carrier_operating_entity_code=sqlc.narg(carrier_operating_entity_code),
    carrier_operating_entity_name=sqlc.narg(carrier_operating_entity_name),
    carrier_service_relationship_object_id=sqlc.narg(carrier_service_relationship_object_id),
    carrier_service_relationship_approval_entry_id=sqlc.narg(carrier_service_relationship_approval_entry_id),
    carrier_service_relationship_code=sqlc.narg(carrier_service_relationship_code),
    carrier_service_relationship_name=sqlc.narg(carrier_service_relationship_name),
    vehicle_object_id=sqlc.arg(vehicle_object_id),vehicle_approval_entry_id=sqlc.arg(vehicle_approval_entry_id),
    vehicle_code=sqlc.arg(vehicle_code),vehicle_name=sqlc.arg(vehicle_name),
    vehicle_plate_number=sqlc.arg(vehicle_plate_number),
    vehicle_bulk_liquid_capable=sqlc.arg(vehicle_bulk_liquid_capable)
WHERE document_id=sqlc.arg(document_id);

-- name: GetVouSaleDeliveryView :one
SELECT delivery.source_outbound_id,source.document_no AS source_document_no,
       delivery.customer_object_id,delivery.customer_approval_entry_id,
       delivery.customer_code,delivery.customer_name,delivery.carrier_type,
       COALESCE(delivery.carrier_operating_entity_object_id,'') AS carrier_operating_entity_object_id,
       COALESCE(delivery.carrier_operating_entity_approval_entry_id,'') AS carrier_operating_entity_approval_entry_id,
       COALESCE(delivery.carrier_operating_entity_code,'') AS carrier_operating_entity_code,
       COALESCE(delivery.carrier_operating_entity_name,'') AS carrier_operating_entity_name,
       COALESCE(delivery.carrier_service_relationship_object_id,'') AS carrier_service_relationship_object_id,
       COALESCE(delivery.carrier_service_relationship_approval_entry_id,'') AS carrier_service_relationship_approval_entry_id,
       COALESCE(delivery.carrier_service_relationship_code,'') AS carrier_service_relationship_code,
       COALESCE(delivery.carrier_service_relationship_name,'') AS carrier_service_relationship_name,
       COALESCE(delivery.vehicle_object_id,'') AS vehicle_object_id,
       COALESCE(delivery.vehicle_approval_entry_id,'') AS vehicle_approval_entry_id,
       COALESCE(delivery.vehicle_code,'') AS vehicle_code,
       COALESCE(delivery.vehicle_name,'') AS vehicle_name,
       COALESCE(delivery.vehicle_plate_number,'') AS vehicle_plate_number,
       delivery.vehicle_bulk_liquid_capable
FROM vou_sale_delivery_details AS delivery
JOIN vou_documents AS source ON source.id=delivery.source_outbound_id
WHERE delivery.document_id=sqlc.arg(document_id);

-- name: ListVouSaleOutboundStateLines :many
SELECT id,source_order_line_id,line_no,
       product_object_id,product_approval_entry_id,product_code,product_name,entered_unit_symbol,
       base_quantity_micros,unit_price_cents,line_amount_cents,remark
FROM vou_sale_outbound_lines
WHERE document_id=sqlc.arg(document_id)
ORDER BY line_no;

-- name: GetVouSaleDeliveryStoredState :one
SELECT approval.status AS source_status,1::bigint AS line_count,
       delivery.carrier_type IS NOT NULL AND delivery.vehicle_object_id IS NOT NULL AS complete
FROM vou_sale_delivery_details AS delivery
JOIN vou_documents AS source ON source.id=delivery.source_outbound_id
JOIN approval_entries approval ON approval.id=source.approval_entry_id
WHERE delivery.document_id=sqlc.arg(document_id);

-- name: FindVouRefusalReturnDocument :one
SELECT document_id
FROM vou_sale_return_details
WHERE source_signoff_id=sqlc.arg(source_signoff_id) AND return_kind='REFUSAL';

-- name: LockVouRefusalReturnSource :one
SELECT detail.source_order_id,document.business_date,approval.status,document.currency,
       detail.customer_object_id,detail.customer_approval_entry_id,detail.customer_code,detail.customer_name,
       detail.warehouse_object_id,detail.warehouse_approval_entry_id,detail.warehouse_code,detail.warehouse_name
FROM vou_sale_signoff_details detail
JOIN vou_documents document ON document.id=detail.document_id
JOIN approval_entries approval ON approval.id=document.approval_entry_id
WHERE detail.document_id=sqlc.arg(document_id)
FOR UPDATE OF document,approval;

-- name: ListVouRefusalReturnSourceLines :many
SELECT id,product_object_id,product_approval_entry_id,product_code,product_name,entered_unit_symbol,
       rejected_base_quantity_micros,unit_price_cents,COALESCE(remark,'') AS remark
FROM vou_sale_signoff_lines
WHERE document_id=sqlc.arg(document_id) AND rejected_base_quantity_micros>0
ORDER BY line_no;

-- name: InsertVouSaleReturnDetail :exec
INSERT INTO vou_sale_return_details(
    document_id,source_order_id,source_signoff_id,return_kind,return_reason,
    customer_object_id,customer_approval_entry_id,customer_code,customer_name,
    warehouse_object_id,warehouse_approval_entry_id,warehouse_code,warehouse_name
) VALUES(
    sqlc.arg(document_id),sqlc.arg(source_order_id),sqlc.narg(source_signoff_id),
    sqlc.arg(return_kind),sqlc.arg(return_reason),sqlc.arg(customer_object_id),
    sqlc.arg(customer_approval_entry_id),sqlc.arg(customer_code),sqlc.arg(customer_name),
    sqlc.arg(warehouse_object_id),sqlc.arg(warehouse_approval_entry_id),sqlc.arg(warehouse_code),
    sqlc.arg(warehouse_name)
);

-- name: InsertVouSaleReturnLine :exec
INSERT INTO vou_sale_return_lines(
    id,document_id,source_signoff_line_id,source_signoff_id,line_no,
    product_object_id,product_approval_entry_id,product_code,product_name,entered_unit_symbol,
    base_quantity_micros,unit_price_cents,line_amount_cents,remark
) VALUES(
    sqlc.arg(id),sqlc.arg(document_id),sqlc.arg(source_signoff_line_id),
    sqlc.arg(source_signoff_id),sqlc.arg(line_no),sqlc.arg(product_object_id),
    sqlc.arg(product_approval_entry_id),sqlc.arg(product_code),sqlc.arg(product_name),
    sqlc.arg(entered_unit_symbol),sqlc.arg(base_quantity_micros),sqlc.arg(unit_price_cents),
    sqlc.arg(line_amount_cents),sqlc.narg(remark)
);
-- name: DeleteVouDocument :exec
DELETE FROM vou_documents WHERE id=sqlc.arg(document_id);

-- name: GetSaleSignoffSettlementSource :one
SELECT detail.source_order_id,document.total_amount_cents
FROM vou_sale_signoff_details detail JOIN vou_documents document ON document.id=detail.document_id
WHERE detail.document_id=sqlc.arg(document_id);
-- name: GetPurchaseInboundSettlementSource :one
SELECT detail.source_order_id,document.total_amount_cents
FROM vou_purchase_inbound_details detail JOIN vou_documents document ON document.id=detail.document_id
WHERE detail.document_id=sqlc.arg(document_id);
-- name: LockVouSettlementBalance :exec
SELECT pg_advisory_xact_lock(hashtextextended(sqlc.arg(lock_key),0));
-- name: GetSaleOrderSettlementGate :one
SELECT detail.settlement_term_code,COALESCE(detail.settlement_method_name,'') AS settlement_method_name,
       COALESCE(detail.settlement_rule_type,'') AS settlement_rule_type,
       COALESCE(detail.settlement_month_offset,0) AS settlement_month_offset,
       COALESCE(detail.settlement_day_offset,0) AS settlement_day_offset,
       detail.customer_object_id,COALESCE(document.currency,'') AS currency,document.total_amount_cents
FROM vou_documents document JOIN vou_sale_order_details detail ON detail.document_id=document.id
WHERE document.id=sqlc.arg(order_id);

-- name: LockVouDocumentStatusForShare :one
SELECT approval.status FROM vou_documents document
JOIN approval_entries approval ON approval.id=document.approval_entry_id
WHERE document.id=sqlc.arg(document_id) FOR SHARE OF document,approval;
-- name: HasVouPurchaseInboundLines :one
SELECT EXISTS(SELECT 1 FROM vou_purchase_inbound_lines WHERE document_id=sqlc.arg(document_id));
-- name: HasVouPurchaseReturnLines :one
SELECT EXISTS(SELECT 1 FROM vou_purchase_return_lines WHERE document_id=sqlc.arg(document_id));
-- name: IsVouSaleOutboundReady :one
SELECT x.warehouse_object_id IS NOT NULL AND x.warehouse_approval_entry_id IS NOT NULL
       AND EXISTS(SELECT 1 FROM vou_sale_outbound_lines l WHERE l.document_id=x.document_id AND l.base_quantity_micros>0)
FROM vou_sale_outbound_details x WHERE x.document_id=sqlc.arg(document_id);
-- name: IsVouSaleDeliveryReady :one
SELECT x.carrier_type IN ('INTERNAL','EXTERNAL')
       AND x.vehicle_object_id IS NOT NULL AND x.vehicle_approval_entry_id IS NOT NULL
FROM vou_sale_delivery_details x WHERE x.document_id=sqlc.arg(document_id);
-- name: IsVouSaleSignoffReady :one
SELECT EXISTS(SELECT 1 FROM vou_sale_signoff_lines l WHERE l.document_id=sqlc.arg(document_id)
              AND l.signed_base_quantity_micros+l.rejected_base_quantity_micros>=0);
-- name: ListVouWorkflowChildrenForShare :many
SELECT document.id,document.entity,approval.status FROM vou_documents document
JOIN approval_entries approval ON approval.id=document.approval_entry_id
WHERE document.parent_document_id=sqlc.arg(parent_document_id) FOR SHARE OF document,approval;
-- name: GetPurchaseOrderSettlementGate :one
SELECT detail.settlement_term_code,COALESCE(detail.settlement_method_name,'') AS settlement_method_name,
       COALESCE(detail.settlement_rule_type,'') AS settlement_rule_type,
       COALESCE(detail.settlement_month_offset,0) AS settlement_month_offset,
       COALESCE(detail.settlement_day_offset,0) AS settlement_day_offset,
       detail.supplier_object_id,COALESCE(document.currency,'') AS currency,document.total_amount_cents
FROM vou_documents document JOIN vou_purchase_order_details detail ON detail.document_id=document.id
WHERE document.id=sqlc.arg(order_id);

-- name: GetVouSalesAttributionSnapshot :one
SELECT primary_sales_attribution_type,primary_sales_subject_id,
       primary_sales_subject_approval_entry_id,primary_sales_subject_code,primary_sales_subject_name
FROM bob_customer_versions
JOIN approval_entries entry ON entry.id=bob_customer_versions.approval_entry_id
WHERE bob_customer_versions.approval_entry_id=sqlc.arg(customer_approval_entry_id)
  AND entry.domain='bob' AND entry.entity='customer-account' AND entry.status='APPROVED'
  AND entry.id=(SELECT latest.id FROM approval_entries latest WHERE latest.domain='bob' AND latest.entity=entry.entity AND latest.subject_id=entry.subject_id AND latest.status='APPROVED' ORDER BY latest.version_no DESC LIMIT 1);

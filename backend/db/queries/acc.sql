-- name: LockAccountingBooksForCreate :exec
LOCK TABLE acc_books IN SHARE ROW EXCLUSIVE MODE;

-- name: AccountingBookExists :one
SELECT EXISTS(SELECT 1 FROM acc_books);

-- name: FindAccountingBookIDByDescription :one
SELECT id
FROM acc_books
WHERE description = sqlc.arg(description)
ORDER BY created_at, id
LIMIT 1;

-- name: NextAccountingBookNumber :one
INSERT INTO object_number_counters (domain, entity, last_value)
VALUES ('acc', 'book', 1)
ON CONFLICT (domain, entity)
DO UPDATE SET last_value = object_number_counters.last_value + 1
WHERE object_number_counters.last_value < 9999
RETURNING last_value;

-- name: CreateAccountingBook :exec
INSERT INTO acc_books (
  id, code, name, description, start_month, base_currency,
  control_book, subject_template, created_by, updated_by
) VALUES (
  sqlc.arg(id), sqlc.arg(code), sqlc.arg(name), sqlc.arg(description),
  to_date(sqlc.arg(start_month)::text, 'YYYY-MM'), sqlc.arg(base_currency),
  sqlc.arg(control_book), sqlc.arg(subject_template),
  sqlc.arg(actor_id), sqlc.arg(actor_id)
);

-- name: HasAccountingBookQueryAccess :one
SELECT EXISTS(
  SELECT 1 FROM acc_book_user_scopes
  WHERE book_id = sqlc.arg(book_id)
    AND user_id = sqlc.arg(user_id)
    AND query_access
);

-- name: HasAccountingBookOperateAccess :one
SELECT EXISTS(
  SELECT 1 FROM acc_book_user_scopes
  WHERE book_id = sqlc.arg(book_id)
    AND user_id = sqlc.arg(user_id)
    AND operate_access
);

-- name: GetAccountingBookUserScope :one
SELECT query_access, operate_access
FROM acc_book_user_scopes
WHERE book_id = sqlc.arg(book_id) AND user_id = sqlc.arg(user_id);

-- name: DeleteAccountingBookScopes :exec
DELETE FROM acc_book_user_scopes WHERE book_id = sqlc.arg(book_id);

-- name: GetAccountingAccessUserEnabled :one
SELECT status = 'ENABLED' AS enabled FROM app_users WHERE id = sqlc.arg(user_id);

-- name: CreateAccountingBookScope :exec
INSERT INTO acc_book_user_scopes (
  book_id, user_id, query_access, operate_access, created_by
) VALUES (
  sqlc.arg(book_id), sqlc.arg(user_id), sqlc.arg(query_access),
  sqlc.arg(operate_access), sqlc.arg(actor_id)
);

-- name: ListAccountingBooks :many
SELECT b.id, b.code, b.name, b.description,
       to_char(b.start_month, 'YYYY-MM') AS start_month,
       b.base_currency, b.control_book, b.subject_template,
       b.revision, count(*) OVER() AS total
FROM acc_books b
JOIN acc_book_user_scopes s ON s.book_id = b.id
WHERE s.user_id = sqlc.arg(user_id)
  AND s.query_access
  AND (
    sqlc.arg(keyword)::text = ''
    OR b.code ILIKE '%' || sqlc.arg(keyword) || '%'
    OR b.name ILIKE '%' || sqlc.arg(keyword) || '%'
  )
ORDER BY b.control_book DESC, b.code, b.id
OFFSET sqlc.arg(page_offset) LIMIT sqlc.arg(page_size);

-- name: GetAccountingBook :one
SELECT id, code, name, description,
       to_char(start_month, 'YYYY-MM') AS start_month,
       base_currency, control_book, subject_template, revision
FROM acc_books
WHERE id = sqlc.arg(book_id);

-- name: ListAccountingBookScopes :many
SELECT user_id, query_access, operate_access
FROM acc_book_user_scopes
WHERE book_id = sqlc.arg(book_id)
ORDER BY user_id;

-- name: UpdateAccountingBook :one
UPDATE acc_books SET
  name = sqlc.arg(name),
  description = sqlc.arg(description),
  base_currency = sqlc.arg(base_currency),
  revision = revision + 1,
  updated_at = now(),
  updated_by = sqlc.arg(actor_id)
WHERE id = sqlc.arg(book_id) AND revision = sqlc.arg(revision)
RETURNING revision;

-- name: GetReadyControlAccountingBookID :one
SELECT book.id
FROM acc_books book
JOIN acc_openings opening ON opening.book_id = book.id
JOIN approval_entries approval
  ON approval.domain='acc' AND approval.entity='opening' AND approval.subject_id=opening.book_id
 AND approval.status='APPROVED'
WHERE book.control_book
FOR SHARE OF book, opening, approval;

-- name: LockAccountingBalanceKey :exec
SELECT pg_advisory_xact_lock(hashtextextended(sqlc.arg(lock_key), 0));

-- name: GetAccountingPartyBalance :one
SELECT COALESCE(sum((sqlc.arg(debit_multiplier)::bigint) * (line.debit_minor-line.credit_minor)),0)::bigint
FROM acc_voucher_lines line
JOIN acc_vouchers voucher ON voucher.book_id=line.book_id AND voucher.id=line.voucher_id
JOIN acc_subjects subject ON subject.book_id=line.book_id AND subject.id=line.subject_id
WHERE line.book_id=sqlc.arg(book_id)
  AND subject.settlement_purpose=sqlc.arg(settlement_purpose)
  AND line.currency=sqlc.arg(currency)
  AND line.dimensions->>(sqlc.arg(dimension)::text)=sqlc.arg(object_id)::text
  AND voucher.business_date<=sqlc.arg(as_of_date)::date
  AND (COALESCE(cardinality(sqlc.arg(source_document_ids)::text[]),0)=0
       OR voucher.source_id=ANY(sqlc.arg(source_document_ids)::text[]));

-- name: ListAffectedAccountingFunds :many
SELECT (line.dimensions->>'FUND_ACCOUNT')::text AS fund_account_id,
       line.currency, sum(line.debit_minor-line.credit_minor)::bigint AS delta
FROM acc_voucher_lines line
WHERE line.book_id=sqlc.arg(book_id) AND line.voucher_id=sqlc.arg(voucher_id)
  AND line.dimensions ? 'FUND_ACCOUNT'
GROUP BY line.dimensions->>'FUND_ACCOUNT',line.currency
HAVING sum(line.debit_minor-line.credit_minor)<0;

-- name: GetMinimumAccountingFundBalance :one
WITH daily AS (
  SELECT voucher.business_date,
         sum(line.debit_minor-line.credit_minor)::bigint AS delta
  FROM acc_voucher_lines line
  JOIN acc_vouchers voucher ON voucher.book_id=line.book_id AND voucher.id=line.voucher_id
  WHERE line.book_id=sqlc.arg(book_id) AND line.currency=sqlc.arg(currency)
    AND line.dimensions->>'FUND_ACCOUNT'=sqlc.arg(fund_account_id)::text
  GROUP BY voucher.business_date
), running AS (
  SELECT sum(delta) OVER (ORDER BY business_date ROWS UNBOUNDED PRECEDING)::bigint AS balance
  FROM daily
)
SELECT COALESCE(min(balance),0)::bigint FROM running;

-- name: AccountingPeriodHasUnfinishedVOU :one
SELECT EXISTS(
  SELECT 1
  FROM vou_documents document
  JOIN approval_entries approval
    ON approval.id=document.approval_entry_id
   AND approval.domain='vou' AND approval.entity=document.entity AND approval.subject_id=document.id
  WHERE document.business_date >= sqlc.arg(period_start) AND document.business_date < sqlc.arg(period_end)
    AND approval.status <> 'APPROVED'
);

-- name: AccountingPeriodHasMissingMappings :one
SELECT EXISTS(
  SELECT 1 FROM vou_documents document
  JOIN approval_entries approval
    ON approval.id=document.approval_entry_id
   AND approval.domain='vou' AND approval.entity=document.entity AND approval.subject_id=document.id
  WHERE document.business_date >= sqlc.arg(period_start)
    AND document.business_date < sqlc.arg(period_end)
    AND approval.status = 'APPROVED'
    AND NOT EXISTS (
      SELECT 1
      FROM acc_mappings mapping
      JOIN approval_entries mapping_approval
        ON mapping_approval.domain='dcl' AND mapping_approval.entity='acc-mapping'
       AND mapping_approval.subject_id=mapping.id AND mapping_approval.status='APPROVED'
      WHERE mapping.book_id=sqlc.arg(book_id) AND mapping.vou_entity=document.entity
    )
);

-- name: AccountingPeriodHasNegativeInventory :one
SELECT EXISTS(
  SELECT 1 FROM acc_inventory_entries WHERE book_id=sqlc.arg(book_id)
  GROUP BY subject_id, product_id, warehouse_id
  HAVING sum(quantity_delta_micros) FILTER (WHERE business_date < sqlc.arg(period_end)) < 0
);

-- name: AccountingTrialBalanceFails :one
SELECT EXISTS(
  SELECT 1 FROM acc_voucher_lines line
  JOIN acc_vouchers voucher ON voucher.id=line.voucher_id
  WHERE voucher.book_id=sqlc.arg(book_id) AND voucher.business_date < sqlc.arg(before_date)
  GROUP BY line.currency HAVING sum(line.debit_minor) <> sum(line.credit_minor)
);

-- name: DeleteAccountingInventoryCostAllocations :exec
DELETE FROM acc_inventory_cost_allocations
WHERE book_id=sqlc.arg(book_id) AND period_month=sqlc.arg(period_month);

-- name: ListAccountingInventoryCostFacts :many
SELECT entry.id,entry.voucher_id,entry.subject_id,entry.product_id,entry.warehouse_id,
       entry.quantity_delta_micros,voucher.business_date,line.currency,
       (line.debit_minor-line.credit_minor)::bigint AS direct_value,
       COALESCE(voucher.source_entity,'') AS source_entity,voucher.source_id,
       entry.source_line_id,line.dimensions,line.dimension_references,entry.cost_counterpart_subject_id,
       entry.cost_counterpart_dimensions,entry.cost_counterpart_dimension_references,entry.origin_source_document_id,
       entry.origin_source_line_id
FROM acc_inventory_entries entry
JOIN acc_vouchers voucher ON voucher.book_id=entry.book_id AND voucher.id=entry.voucher_id
JOIN acc_voucher_lines line ON line.id=entry.voucher_line_id
WHERE entry.book_id=sqlc.arg(book_id) AND voucher.business_date<sqlc.arg(before_date)
ORDER BY voucher.business_date,
  CASE WHEN COALESCE(voucher.source_entity,'') IN ('order-production','self-production')
            AND entry.quantity_delta_micros<0 THEN 0 ELSE 1 END,
  voucher.created_at,voucher.id,line.line_order,entry.id;

-- name: InsertAccountingInventoryCostAllocation :exec
INSERT INTO acc_inventory_cost_allocations(
  entry_id,book_id,period_month,quantity_micros,cost_minor,
  source_cost_entry_id,system_voucher_id
) VALUES (
  sqlc.arg(entry_id),sqlc.arg(book_id),sqlc.arg(period_month),
  sqlc.arg(quantity_micros),sqlc.arg(cost_minor),sqlc.narg(source_cost_entry_id),
  sqlc.narg(system_voucher_id)
);

-- name: RegisterAccountingGlobalEvent :one
INSERT INTO acc_register_events (source_entity, source_document_id, source_revision)
VALUES (sqlc.arg(source_entity),sqlc.arg(source_document_id),sqlc.arg(source_revision))
ON CONFLICT DO NOTHING RETURNING true;

-- name: DeleteAccountingGlobalEvent :execrows
DELETE FROM acc_register_events
WHERE source_entity=sqlc.arg(source_entity)
  AND source_document_id=sqlc.arg(source_document_id)
  AND source_revision=sqlc.arg(source_revision);

-- name: CreateAccountingAsset :exec
INSERT INTO acc_assets (
  id,asset_no,source_document_id,source_line_id,name,category_id,department_id,
  useful_life_months,residual_rate_bps,acquired_on,state
) VALUES (
  sqlc.arg(id),sqlc.arg(asset_no),sqlc.arg(source_document_id),sqlc.arg(source_line_id),
  sqlc.arg(name),sqlc.arg(category_id),sqlc.arg(department_id),
  sqlc.arg(useful_life_months),sqlc.arg(residual_rate_bps),sqlc.arg(acquired_on),'ACTIVE'
);

-- name: AccountingAssetExists :one
SELECT EXISTS(SELECT 1 FROM acc_assets WHERE id=sqlc.arg(asset_id));

-- name: AccountingAssetIsActive :one
SELECT state='ACTIVE' FROM acc_assets WHERE id=sqlc.arg(asset_id);

-- name: ListAccountingAssetIDsBySourceDocument :many
SELECT id
FROM acc_assets
WHERE source_document_id = sqlc.arg(source_document_id)
ORDER BY asset_no;

-- name: CreateAccountingAssetBookValue :exec
INSERT INTO acc_asset_book_values (
  book_id,asset_id,currency,original_minor,accumulated_depreciation_minor,
  asset_subject_id,asset_dimensions,asset_dimension_references,
  accumulated_subject_id,accumulated_dimensions,accumulated_dimension_references,
  expense_subject_id,expense_dimensions,expense_dimension_references
) VALUES (
  sqlc.arg(book_id),sqlc.arg(asset_id),sqlc.arg(currency),sqlc.arg(original_minor),
  sqlc.arg(accumulated_minor),sqlc.arg(asset_subject_id),sqlc.arg(asset_dimensions),sqlc.arg(asset_dimension_references),
  sqlc.arg(accumulated_subject_id),sqlc.arg(accumulated_dimensions),sqlc.arg(accumulated_dimension_references),
  sqlc.arg(expense_subject_id),sqlc.arg(expense_dimensions),sqlc.arg(expense_dimension_references)
);

-- name: DisposeAccountingAsset :execrows
UPDATE acc_assets SET state=sqlc.arg(state),disposed_by_document_id=sqlc.arg(document_id),
  disposed_on=sqlc.arg(disposed_on)
WHERE id=sqlc.arg(asset_id) AND state='ACTIVE';

-- name: CreateAccountingBill :exec
INSERT INTO acc_bills (
  id,bill_no,bill_type,position_type,currency,medium,face_amount_minor,
  issue_date,maturity_date,drawer,acceptor,payee,annual_rate_bps,interest_days,
  interest_amount_minor,customer_cost_amount_minor,origin_counterparty_entity,
  origin_counterparty_object_id,origin_counterparty_customer_id,origin_counterparty_approval_entry_id,origin_counterparty_code,origin_counterparty_name,
  state,source_document_id,source_line_id
) VALUES (
  sqlc.arg(id),sqlc.arg(bill_no),sqlc.arg(bill_type),sqlc.arg(position_type),
  sqlc.arg(currency),sqlc.arg(medium),sqlc.arg(face_amount_minor),sqlc.arg(issue_date),
  sqlc.arg(maturity_date),sqlc.arg(drawer),sqlc.arg(acceptor),sqlc.arg(payee),
  sqlc.arg(annual_rate_bps),sqlc.arg(interest_days),sqlc.arg(interest_amount_minor),
  sqlc.arg(customer_cost_amount_minor),sqlc.narg(origin_counterparty_entity),
  sqlc.narg(origin_counterparty_object_id),sqlc.narg(origin_counterparty_customer_id),sqlc.narg(origin_counterparty_approval_entry_id),
  sqlc.narg(origin_counterparty_code),sqlc.narg(origin_counterparty_name),'AVAILABLE',
  sqlc.arg(source_document_id),sqlc.arg(source_line_id)
);

-- name: AccountingBillExists :one
SELECT EXISTS(SELECT 1 FROM acc_bills WHERE id=sqlc.arg(bill_id));

-- name: AccountingBillIsAvailable :one
SELECT state='AVAILABLE' FROM acc_bills WHERE id=sqlc.arg(bill_id);

-- name: FindAccountingBillIDBySourceDocument :one
SELECT id
FROM acc_bills
WHERE source_document_id = sqlc.arg(source_document_id)
ORDER BY id
LIMIT 1;

-- name: CreateAccountingBillBookValue :exec
INSERT INTO acc_bill_book_values (book_id,bill_id,value_minor)
VALUES (sqlc.arg(book_id),sqlc.arg(bill_id),sqlc.arg(value_minor));

-- name: SettleAccountingBill :execrows
UPDATE acc_bills SET state='SETTLED',settled_by_document_id=sqlc.arg(document_id)
WHERE id=sqlc.arg(bill_id) AND state='AVAILABLE';

-- name: CreateAccountingContainerEntry :exec
INSERT INTO acc_container_entries (
  id,customer_id,container_type,quantity_delta,source_document_id,source_revision
) VALUES (
  sqlc.arg(id),sqlc.arg(customer_id),sqlc.arg(container_type),sqlc.arg(quantity_delta),
  sqlc.arg(source_document_id),sqlc.arg(source_revision)
);

-- name: DeleteActiveAccountingAssetsBySource :exec
DELETE FROM acc_assets WHERE source_document_id=sqlc.arg(document_id) AND state='ACTIVE';

-- name: RestoreAccountingAssetsByDisposal :exec
UPDATE acc_assets SET state='ACTIVE',disposed_by_document_id=NULL,disposed_on=NULL
WHERE disposed_by_document_id=sqlc.arg(document_id);

-- name: DeleteAvailableAccountingBillsBySource :exec
DELETE FROM acc_bills WHERE source_document_id=sqlc.arg(document_id) AND state='AVAILABLE';

-- name: RestoreAccountingBillsBySettlement :exec
UPDATE acc_bills SET state='AVAILABLE',settled_by_document_id=NULL
WHERE settled_by_document_id=sqlc.arg(document_id);

-- name: DeleteAccountingContainerEntriesBySource :exec
DELETE FROM acc_container_entries
WHERE source_document_id=sqlc.arg(document_id) AND source_revision=sqlc.arg(source_revision);

-- name: DeleteAccountingOpeningAssets :exec
DELETE FROM acc_opening_assets WHERE book_id=sqlc.arg(book_id);

-- name: DeleteAccountingOpeningBills :exec
DELETE FROM acc_opening_bills WHERE book_id=sqlc.arg(book_id);

-- name: DeleteAccountingOpeningContainers :exec
DELETE FROM acc_opening_containers WHERE book_id=sqlc.arg(book_id);

-- name: InsertAccountingOpeningAsset :exec
INSERT INTO acc_opening_assets(
  book_id,line_order,asset_id,create_object,asset_no,name,category_id,department_id,
  useful_life_months,residual_rate_bps,acquired_on,currency,original_minor,accumulated_minor
) VALUES (
  sqlc.arg(book_id),sqlc.arg(line_order),sqlc.arg(asset_id),sqlc.arg(create_object),
  sqlc.narg(asset_no),sqlc.narg(name),sqlc.narg(category_id),sqlc.narg(department_id),
  sqlc.narg(useful_life_months),sqlc.narg(residual_rate_bps),sqlc.narg(acquired_on),
  sqlc.arg(currency),sqlc.arg(original_minor),sqlc.arg(accumulated_minor)
);

-- name: InsertAccountingOpeningBill :exec
INSERT INTO acc_opening_bills(
  book_id,line_order,bill_id,create_object,bill_no,bill_type,position_type,medium,currency,
  face_amount_minor,issue_date,maturity_date,drawer,acceptor,payee,annual_rate_bps,
  interest_days,interest_amount_minor,customer_cost_amount_minor,origin_counterparty_entity,
  origin_counterparty_object_id,origin_counterparty_customer_id,origin_counterparty_approval_entry_id,origin_counterparty_code,origin_counterparty_name,value_minor
) VALUES (
  sqlc.arg(book_id),sqlc.arg(line_order),sqlc.arg(bill_id),sqlc.arg(create_object),
  sqlc.narg(bill_no),sqlc.narg(bill_type),sqlc.narg(position_type),sqlc.narg(medium),
  sqlc.arg(currency),sqlc.narg(face_amount_minor),sqlc.narg(issue_date),sqlc.narg(maturity_date),
  sqlc.narg(drawer),sqlc.narg(acceptor),sqlc.narg(payee),sqlc.narg(annual_rate_bps),
  sqlc.narg(interest_days),sqlc.narg(interest_amount_minor),sqlc.narg(customer_cost_amount_minor),
  sqlc.narg(origin_counterparty_entity),sqlc.narg(origin_counterparty_object_id),sqlc.narg(origin_counterparty_customer_id),sqlc.narg(origin_counterparty_approval_entry_id),
  sqlc.narg(origin_counterparty_code),sqlc.narg(origin_counterparty_name),sqlc.arg(value_minor)
);

-- name: InsertAccountingOpeningContainer :exec
INSERT INTO acc_opening_containers(book_id,line_order,customer_id,container_type,quantity)
VALUES(sqlc.arg(book_id),sqlc.arg(line_order),sqlc.arg(customer_id),sqlc.arg(container_type),sqlc.arg(quantity));

-- name: ListAccountingOpeningAssets :many
SELECT asset_id,create_object,COALESCE(asset_no,'') AS asset_no,COALESCE(name,'') AS name,
  COALESCE(category_id,'') AS category_id,COALESCE(department_id,'') AS department_id,
  COALESCE(useful_life_months,0)::integer AS useful_life_months,
  COALESCE(residual_rate_bps,0)::integer AS residual_rate_bps,acquired_on,currency,
  original_minor,accumulated_minor
FROM acc_opening_assets WHERE book_id=sqlc.arg(book_id) ORDER BY line_order;

-- name: ListAccountingOpeningBills :many
SELECT bill_id,create_object,COALESCE(bill_no,'') AS bill_no,COALESCE(bill_type,'') AS bill_type,
  COALESCE(position_type,'') AS position_type,COALESCE(medium,'') AS medium,currency,
  COALESCE(face_amount_minor,0)::bigint AS face_amount_minor,issue_date,maturity_date,
  COALESCE(drawer,'') AS drawer,COALESCE(acceptor,'') AS acceptor,COALESCE(payee,'') AS payee,
  COALESCE(annual_rate_bps,0)::integer AS annual_rate_bps,
  COALESCE(interest_days,0)::integer AS interest_days,
  COALESCE(interest_amount_minor,0)::bigint AS interest_amount_minor,
  COALESCE(customer_cost_amount_minor,0)::bigint AS customer_cost_amount_minor,
  COALESCE(origin_counterparty_entity,'') AS origin_counterparty_entity,
  COALESCE(origin_counterparty_object_id,'') AS origin_counterparty_object_id,
  COALESCE(origin_counterparty_customer_id,'') AS origin_counterparty_customer_id,
  COALESCE(origin_counterparty_approval_entry_id,'') AS origin_counterparty_approval_entry_id,
  COALESCE(origin_counterparty_code,'') AS origin_counterparty_code,COALESCE(origin_counterparty_name,'') AS origin_counterparty_name,
  value_minor
FROM acc_opening_bills WHERE book_id=sqlc.arg(book_id) ORDER BY line_order;

-- name: ListAccountingOpeningContainers :many
SELECT customer_id,container_type,quantity
FROM acc_opening_containers WHERE book_id=sqlc.arg(book_id) ORDER BY line_order;

-- name: ListAccountingOpeningAssetsForApproval :many
SELECT asset_id,create_object,asset_no,name,category_id,department_id,useful_life_months,
  residual_rate_bps,acquired_on,currency,original_minor,accumulated_minor
FROM acc_opening_assets WHERE book_id=sqlc.arg(book_id);

-- name: ListAccountingOpeningBillsForApproval :many
SELECT bill_id,create_object,bill_no,bill_type,position_type,medium,currency,
  face_amount_minor,issue_date,maturity_date,drawer,acceptor,payee,annual_rate_bps,
  interest_days,interest_amount_minor,customer_cost_amount_minor,origin_counterparty_entity,
  origin_counterparty_object_id,origin_counterparty_customer_id,origin_counterparty_approval_entry_id,origin_counterparty_code,origin_counterparty_name,value_minor
FROM acc_opening_bills WHERE book_id=sqlc.arg(book_id);

-- name: CreateAccountingOpeningContainerBalances :exec
INSERT INTO acc_container_entries(id,customer_id,container_type,quantity_delta,source_document_id,source_revision)
SELECT substr(md5(book_id||customer_id||container_type),1,26),customer_id,container_type,quantity,book_id,0
FROM acc_opening_containers WHERE book_id=sqlc.arg(book_id);

-- name: AccountingOpeningObjectsReferencedByOtherBooks :one
SELECT (EXISTS(
  SELECT 1 FROM acc_opening_assets opening
  JOIN acc_asset_book_values value ON value.asset_id=opening.asset_id
  WHERE opening.book_id=sqlc.arg(book_id) AND opening.create_object AND value.book_id<>sqlc.arg(book_id)
) OR EXISTS(
  SELECT 1 FROM acc_opening_bills opening
  JOIN acc_bill_book_values value ON value.bill_id=opening.bill_id
  WHERE opening.book_id=sqlc.arg(book_id) AND opening.create_object AND value.book_id<>sqlc.arg(book_id)
))::boolean AS referenced;

-- name: DeleteAccountingOpeningContainerBalances :exec
DELETE FROM acc_container_entries WHERE source_document_id=sqlc.arg(book_id) AND source_revision=0;

-- name: DeleteAccountingAssetBookValues :exec
DELETE FROM acc_asset_book_values WHERE book_id=sqlc.arg(book_id);

-- name: DeleteAccountingBillBookValues :exec
DELETE FROM acc_bill_book_values WHERE book_id=sqlc.arg(book_id);

-- name: DeleteAccountingOpeningCreatedAssets :exec
DELETE FROM acc_assets WHERE source_document_id=sqlc.arg(book_id)
  AND id IN(SELECT asset_id FROM acc_opening_assets WHERE book_id=sqlc.arg(book_id) AND create_object);

-- name: DeleteAccountingOpeningCreatedBills :exec
DELETE FROM acc_bills WHERE source_document_id=sqlc.arg(book_id)
  AND id IN(SELECT bill_id FROM acc_opening_bills WHERE book_id=sqlc.arg(book_id) AND create_object);

-- name: ListAccountingDepreciationCandidates :many
SELECT value.asset_id,value.currency,value.original_minor,value.accumulated_depreciation_minor,
  asset.residual_rate_bps,asset.useful_life_months,asset.acquired_on,
  COALESCE(value.accumulated_subject_id,'')::text AS accumulated_subject_id,
  value.accumulated_dimensions,value.accumulated_dimension_references,
  COALESCE(value.expense_subject_id,'')::text AS expense_subject_id,
  value.expense_dimensions,value.expense_dimension_references
FROM acc_asset_book_values value JOIN acc_assets asset ON asset.id=value.asset_id
WHERE value.book_id=sqlc.arg(book_id) AND asset.acquired_on<sqlc.arg(period_month)
  AND (asset.disposed_on IS NULL OR asset.disposed_on>=sqlc.arg(period_month))
  AND value.accumulated_subject_id IS NOT NULL AND value.expense_subject_id IS NOT NULL
ORDER BY asset.acquired_on,asset.id FOR UPDATE OF value;

-- name: InsertAccountingDepreciationEntry :exec
INSERT INTO acc_depreciation_entries(id,book_id,asset_id,period_month,amount_minor,system_voucher_id)
VALUES(sqlc.arg(id),sqlc.arg(book_id),sqlc.arg(asset_id),sqlc.arg(period_month),sqlc.arg(amount_minor),sqlc.arg(system_voucher_id));

-- name: AddAccountingAssetDepreciation :exec
UPDATE acc_asset_book_values
SET accumulated_depreciation_minor=accumulated_depreciation_minor+sqlc.arg(amount_minor)
WHERE book_id=sqlc.arg(book_id) AND asset_id=sqlc.arg(asset_id);

-- name: DeleteAccountingPeriodBalances :exec
DELETE FROM acc_period_balances WHERE book_id=sqlc.arg(book_id) AND period_month=sqlc.arg(period_month);

-- name: BuildAccountingPeriodBalances :exec
INSERT INTO acc_period_balances(
  id,book_id,period_month,subject_id,currency,dimensions,dimension_key,
  opening_balance_minor,debit_turnover_minor,credit_turnover_minor,closing_balance_minor)
SELECT substr(md5(sqlc.arg(book_id)||':'||sqlc.arg(period_month)::date::text||':'||line.subject_id||':'||line.currency||':'||line.dimensions::text),1,26),
  sqlc.arg(book_id),sqlc.arg(period_month)::date,line.subject_id,line.currency,line.dimensions,line.dimensions::text,
  COALESCE(sum(line.debit_minor-line.credit_minor) FILTER(WHERE voucher.business_date<sqlc.arg(period_month)::date),0)::bigint,
  COALESCE(sum(line.debit_minor) FILTER(WHERE voucher.business_date>=sqlc.arg(period_month)::date AND voucher.business_date<sqlc.arg(period_end)::date),0)::bigint,
  COALESCE(sum(line.credit_minor) FILTER(WHERE voucher.business_date>=sqlc.arg(period_month)::date AND voucher.business_date<sqlc.arg(period_end)::date),0)::bigint,
  sum(line.debit_minor-line.credit_minor)::bigint
FROM acc_voucher_lines line JOIN acc_vouchers voucher ON voucher.book_id=line.book_id AND voucher.id=line.voucher_id
WHERE line.book_id=sqlc.arg(book_id) AND voucher.business_date<sqlc.arg(period_end)::date
GROUP BY line.subject_id,line.currency,line.dimensions;

-- name: ReverseAccountingAssetDepreciation :exec
UPDATE acc_asset_book_values value
SET accumulated_depreciation_minor=value.accumulated_depreciation_minor-source.amount
FROM (
  SELECT asset_id,sum(amount_minor)::bigint amount FROM acc_depreciation_entries
  WHERE book_id=sqlc.arg(book_id) AND period_month=sqlc.arg(period_month) GROUP BY asset_id
) source
WHERE value.book_id=sqlc.arg(book_id) AND value.asset_id=source.asset_id;

-- name: DeleteAccountingDepreciationEntries :exec
DELETE FROM acc_depreciation_entries WHERE book_id=sqlc.arg(book_id) AND period_month=sqlc.arg(period_month);

-- name: DeleteAccountingPeriodSystemVouchers :exec
DELETE FROM acc_vouchers
WHERE book_id=sqlc.arg(book_id) AND source_type IN ('COST_SETTLEMENT','DEPRECIATION')
  AND source_id=sqlc.arg(source_id);

-- name: GetAccountingBookDeletionState :one
SELECT control_book, revision
FROM acc_books
WHERE id = sqlc.arg(book_id)
FOR UPDATE;

-- name: DeleteAccountingBook :exec
DELETE FROM acc_books WHERE id = sqlc.arg(book_id);

-- name: InsertAccountingSubject :exec
INSERT INTO acc_subjects (
  id, book_id, code, name, parent_subject_id, balance_direction,
  enabled, inventory_quantity, settlement_purpose, created_by, updated_by
) VALUES (
  sqlc.arg(id), sqlc.arg(book_id), sqlc.arg(code), sqlc.arg(name),
  sqlc.narg(parent_subject_id), sqlc.arg(balance_direction), sqlc.arg(enabled),
  sqlc.arg(inventory_quantity), sqlc.arg(settlement_purpose),
  sqlc.arg(actor_id), sqlc.arg(actor_id)
);

-- name: InsertAccountingSubjectDimension :exec
INSERT INTO acc_subject_dimensions (subject_id, dimension)
VALUES (sqlc.arg(subject_id), sqlc.arg(dimension));

-- name: DeleteAccountingSubjectDimensions :exec
DELETE FROM acc_subject_dimensions WHERE subject_id = sqlc.arg(subject_id);

-- name: ListAccountingSubjectDimensions :many
SELECT dimension FROM acc_subject_dimensions
WHERE subject_id = sqlc.arg(subject_id)
ORDER BY dimension;

-- name: ListAccountingSubjects :many
SELECT s.id, s.book_id, s.code, s.name, s.parent_subject_id,
       s.balance_direction, s.enabled, s.inventory_quantity,
       s.settlement_purpose, s.revision,
       NOT EXISTS (
         SELECT 1 FROM acc_subjects child WHERE child.parent_subject_id = s.id
       ) AS leaf,
       EXISTS (
         SELECT 1 FROM acc_subject_usages usage WHERE usage.subject_id = s.id
       ) AS referenced,
       count(*) OVER() AS total
FROM acc_subjects s
WHERE s.book_id = sqlc.arg(book_id)
  AND (
    sqlc.arg(keyword)::text = ''
    OR s.code ILIKE '%' || sqlc.arg(keyword) || '%'
    OR s.name ILIKE '%' || sqlc.arg(keyword) || '%'
  )
ORDER BY s.code, s.id
OFFSET sqlc.arg(page_offset) LIMIT sqlc.arg(page_size);

-- name: GetAccountingSubject :one
SELECT s.id, s.book_id, s.code, s.name, s.parent_subject_id,
       s.balance_direction, s.enabled, s.inventory_quantity,
       s.settlement_purpose, s.revision,
       NOT EXISTS (
         SELECT 1 FROM acc_subjects child WHERE child.parent_subject_id = s.id
       ) AS leaf,
       EXISTS (
         SELECT 1 FROM acc_subject_usages usage WHERE usage.subject_id = s.id
       ) AS referenced
FROM acc_subjects s
WHERE s.book_id = sqlc.arg(book_id) AND s.id = sqlc.arg(subject_id);

-- name: GetAccountingSubjectStateForUpdate :one
SELECT s.id, s.book_id, s.code, s.name, s.parent_subject_id,
       s.balance_direction, s.enabled, s.inventory_quantity,
       s.settlement_purpose, s.revision,
       EXISTS (
         SELECT 1 FROM acc_subjects child WHERE child.parent_subject_id = s.id
       ) AS has_children,
       EXISTS (
         SELECT 1 FROM acc_subject_usages usage WHERE usage.subject_id = s.id
       ) AS referenced
FROM acc_subjects s
WHERE s.book_id = sqlc.arg(book_id) AND s.id = sqlc.arg(subject_id)
FOR UPDATE;

-- name: GetAccountingSubjectParent :one
SELECT parent_subject_id
FROM acc_subjects
WHERE book_id = sqlc.arg(book_id) AND id = sqlc.arg(subject_id);

-- name: UpdateAccountingSubject :one
UPDATE acc_subjects SET
  code = sqlc.arg(code),
  name = sqlc.arg(name),
  parent_subject_id = sqlc.narg(parent_subject_id),
  balance_direction = sqlc.arg(balance_direction),
  enabled = sqlc.arg(enabled),
  inventory_quantity = sqlc.arg(inventory_quantity),
  settlement_purpose = sqlc.arg(settlement_purpose),
  revision = revision + 1,
  updated_at = now(),
  updated_by = sqlc.arg(actor_id)
WHERE book_id = sqlc.arg(book_id)
  AND id = sqlc.arg(subject_id)
  AND revision = sqlc.arg(revision)
RETURNING revision;

-- name: DeleteAccountingSubject :exec
DELETE FROM acc_subjects
WHERE book_id = sqlc.arg(book_id) AND id = sqlc.arg(subject_id);

-- name: RegisterAccountingSubjectUsage :exec
INSERT INTO acc_subject_usages (subject_id, usage_type, usage_id)
VALUES (sqlc.arg(subject_id), sqlc.arg(usage_type), sqlc.arg(usage_id))
ON CONFLICT DO NOTHING;

-- name: DeleteAccountingSubjectUsages :exec
DELETE FROM acc_subject_usages
WHERE usage_type = sqlc.arg(usage_type) AND usage_id = sqlc.arg(usage_id);

-- name: GetAccountingOpening :one
SELECT o.book_id, o.voucher_id
FROM acc_openings o
WHERE o.book_id = sqlc.arg(book_id);

-- name: ListAccountingOpeningLines :many
SELECT id, book_id, subject_id, currency, debit_minor, credit_minor,
       quantity_micros, dimensions, dimension_references, line_order
FROM acc_opening_lines
WHERE book_id = sqlc.arg(book_id)
ORDER BY line_order;

-- name: CreateAccountingOpening :exec
INSERT INTO acc_openings (book_id, created_by, updated_by)
VALUES (sqlc.arg(book_id), sqlc.arg(actor_id), sqlc.arg(actor_id));

-- name: TouchAccountingOpening :exec
UPDATE acc_openings SET
  updated_at = now(), updated_by = sqlc.arg(actor_id)
WHERE book_id = sqlc.arg(book_id);

-- name: DeleteAccountingOpeningLines :exec
DELETE FROM acc_opening_lines WHERE book_id = sqlc.arg(book_id);

-- name: InsertAccountingOpeningLine :exec
INSERT INTO acc_opening_lines (
  id, book_id, subject_id, currency, debit_minor, credit_minor,
  quantity_micros, dimensions, dimension_references, line_order
) VALUES (
  sqlc.arg(id), sqlc.arg(book_id), sqlc.arg(subject_id), sqlc.arg(currency),
  sqlc.arg(debit_minor), sqlc.arg(credit_minor), sqlc.narg(quantity_micros),
  sqlc.arg(dimensions), sqlc.arg(dimension_references), sqlc.arg(line_order)
);

-- name: CreateAccountingVoucher :exec
INSERT INTO acc_vouchers (id, book_id, source_type, source_id, business_date, created_by)
VALUES (
  sqlc.arg(id), sqlc.arg(book_id), sqlc.arg(source_type), sqlc.arg(source_id),
  sqlc.arg(business_date), sqlc.arg(actor_id)
);

-- name: InsertAccountingVoucherLine :exec
INSERT INTO acc_voucher_lines (
  id, book_id, voucher_id, subject_id, currency, debit_minor, credit_minor,
  quantity_micros, dimensions, dimension_references, source_line_id, line_order
) VALUES (
  sqlc.arg(id), sqlc.arg(book_id), sqlc.arg(voucher_id), sqlc.arg(subject_id), sqlc.arg(currency),
  sqlc.arg(debit_minor), sqlc.arg(credit_minor), sqlc.narg(quantity_micros),
  sqlc.arg(dimensions), sqlc.arg(dimension_references), sqlc.arg(source_line_id), sqlc.arg(line_order)
);

-- name: SetAccountingOpeningVoucher :exec
UPDATE acc_openings SET
  voucher_id = sqlc.arg(voucher_id), updated_at = now(), updated_by = sqlc.arg(actor_id)
WHERE book_id = sqlc.arg(book_id);

-- name: AccountingBookHasLaterFacts :one
SELECT EXISTS(
  SELECT 1 FROM acc_vouchers
  WHERE book_id = sqlc.arg(book_id) AND source_type <> 'OPENING'
);

-- name: DeleteAccountingVoucher :exec
DELETE FROM acc_vouchers WHERE book_id = sqlc.arg(book_id) AND id = sqlc.arg(voucher_id);

-- name: ClearAccountingOpeningVoucher :exec
UPDATE acc_openings SET
  voucher_id = NULL, updated_at = now(), updated_by = sqlc.arg(actor_id)
WHERE book_id = sqlc.arg(book_id);

-- name: IsAccountingBookReadyForPosting :one
SELECT EXISTS(
  SELECT 1
  FROM acc_openings opening
  JOIN approval_entries approval
    ON approval.domain='acc' AND approval.entity='opening' AND approval.subject_id=opening.book_id
  WHERE opening.book_id = sqlc.arg(book_id) AND approval.status = 'APPROVED'
);

-- name: ListAccountingMappings :many
SELECT mapping.id AS mapping_id, mapping.book_id, mapping.vou_entity,
       entry.id AS approval_entry_id, entry.version_no, entry.status,
       entry.revision, entry.created_by, entry.created_at, entry.updated_by, entry.updated_at,
       entry.submitted_by, entry.submitted_at, entry.approved_by, entry.approved_at,
       payload.default_result, payload.definition, count(*) OVER() AS total
FROM acc_mappings mapping
JOIN LATERAL (
  SELECT approved.*
  FROM approval_entries approved
  WHERE approved.domain='dcl' AND approved.entity='acc-mapping' AND approved.subject_id=mapping.id
    AND approved.status='APPROVED'
  ORDER BY approved.version_no DESC
  LIMIT 1
) entry ON true
JOIN dcl_acc_mapping_versions payload ON payload.approval_entry_id=entry.id
WHERE mapping.book_id = sqlc.arg(book_id)
  AND (sqlc.arg(vou_entity)::text = '' OR mapping.vou_entity = sqlc.arg(vou_entity))
ORDER BY mapping.vou_entity
OFFSET sqlc.arg(page_offset) LIMIT sqlc.arg(page_size);

-- name: ListAccountingMappingVersions :many
SELECT mapping.id AS mapping_id, mapping.book_id, mapping.vou_entity,
       entry.id AS approval_entry_id, entry.version_no, entry.status,
       entry.revision, entry.created_by, entry.created_at, entry.updated_by, entry.updated_at,
       entry.submitted_by, entry.submitted_at, entry.approved_by, entry.approved_at,
       payload.default_result, payload.definition, count(*) OVER() AS total
FROM acc_mappings mapping
JOIN approval_entries entry
  ON entry.domain='dcl' AND entry.entity='acc-mapping' AND entry.subject_id=mapping.id
JOIN dcl_acc_mapping_versions payload ON payload.approval_entry_id=entry.id
WHERE mapping.book_id=sqlc.arg(book_id) AND mapping.vou_entity=sqlc.arg(vou_entity)
ORDER BY entry.version_no DESC
OFFSET sqlc.arg(page_offset) LIMIT sqlc.arg(page_size);

-- name: GetAccountingMappingVersion :one
SELECT mapping.id AS mapping_id, mapping.book_id, mapping.vou_entity,
       payload.approval_entry_id, payload.default_result, payload.definition
FROM dcl_acc_mapping_versions payload
JOIN acc_mappings mapping ON mapping.id=payload.mapping_id
WHERE mapping.book_id=sqlc.arg(book_id) AND mapping.vou_entity=sqlc.arg(vou_entity)
  AND payload.approval_entry_id=sqlc.arg(approval_entry_id);

-- name: GetPreferredAccountingMappingVersion :one
SELECT mapping.id AS mapping_id, mapping.book_id, mapping.vou_entity,
       entry.id AS approval_entry_id, payload.default_result, payload.definition
FROM acc_mappings mapping
JOIN LATERAL (
  SELECT approved.id
  FROM approval_entries approved
  WHERE approved.domain='dcl' AND approved.entity='acc-mapping' AND approved.subject_id=mapping.id
    AND approved.status='APPROVED'
  ORDER BY approved.version_no DESC
  LIMIT 1
) entry ON true
JOIN dcl_acc_mapping_versions payload ON payload.approval_entry_id=entry.id
WHERE mapping.book_id=sqlc.arg(book_id) AND mapping.vou_entity=sqlc.arg(vou_entity);

-- name: GetCurrentApprovedAccountingMapping :one
SELECT payload.approval_entry_id, mapping.id AS mapping_id, mapping.book_id,
       mapping.vou_entity, payload.default_result, payload.definition
FROM acc_mappings mapping
JOIN approval_entries entry
  ON entry.domain='dcl' AND entry.entity='acc-mapping' AND entry.subject_id=mapping.id
 AND entry.status='APPROVED'
JOIN dcl_acc_mapping_versions payload ON payload.approval_entry_id=entry.id
WHERE mapping.book_id=sqlc.arg(book_id) AND mapping.vou_entity=sqlc.arg(vou_entity)
ORDER BY entry.version_no DESC
LIMIT 1;

-- name: LockApprovedAccountingMappingVersion :one
SELECT id
FROM approval_entries
WHERE id=sqlc.arg(approval_entry_id)
  AND domain='dcl'
  AND entity='acc-mapping'
  AND status='APPROVED'
FOR SHARE;

-- name: ListAccountingPostingBooks :many
SELECT b.id, b.control_book
FROM acc_books b
JOIN acc_openings opening ON opening.book_id = b.id
JOIN approval_entries approval
  ON approval.domain='acc' AND approval.entity='opening' AND approval.subject_id=opening.book_id
 AND approval.status='APPROVED'
WHERE b.start_month <= sqlc.arg(business_date)::date
ORDER BY b.code
FOR SHARE OF b, opening, approval;

-- name: GetAutomaticAccountingVoucher :one
SELECT id, source_revision
FROM acc_vouchers
WHERE book_id = sqlc.arg(book_id)
  AND source_type = 'VOU'
  AND source_entity = sqlc.arg(source_entity)
  AND source_id = sqlc.arg(source_id);

-- name: CreateAutomaticAccountingVoucher :exec
INSERT INTO acc_vouchers (
  id, book_id, source_type, source_id, source_entity, source_revision,
  source_document_no, business_date, mapping_approval_entry_id, created_by
) VALUES (
  sqlc.arg(id), sqlc.arg(book_id), 'VOU', sqlc.arg(source_id),
  sqlc.arg(source_entity), sqlc.arg(source_revision), sqlc.arg(source_document_no),
  sqlc.arg(business_date), sqlc.arg(mapping_approval_entry_id), sqlc.arg(actor_id)
);

-- name: DeleteAutomaticAccountingVoucher :many
DELETE FROM acc_vouchers
WHERE source_type = 'VOU'
  AND source_entity = sqlc.arg(source_entity)
  AND source_id = sqlc.arg(source_id)
  AND source_revision = sqlc.arg(source_revision)
RETURNING id;

-- name: InsertAccountingInventoryEntry :exec
INSERT INTO acc_inventory_entries (
	id, book_id, voucher_id, voucher_line_id, subject_id, product_id,
	product_approval_entry_id, product_code, product_name,
	warehouse_id, business_date, quantity_delta_micros, source_line_id,
  cost_counterpart_subject_id, cost_counterpart_dimensions, cost_counterpart_dimension_references,
  origin_source_document_id, origin_source_line_id
) VALUES (
  sqlc.arg(id), sqlc.arg(book_id), sqlc.arg(voucher_id), sqlc.arg(voucher_line_id),
	sqlc.arg(subject_id), sqlc.arg(product_id), sqlc.arg(product_approval_entry_id),
	sqlc.arg(product_code), sqlc.arg(product_name), sqlc.arg(warehouse_id),
  sqlc.arg(business_date), sqlc.arg(quantity_delta_micros), sqlc.arg(source_line_id),
  sqlc.narg(cost_counterpart_subject_id), sqlc.arg(cost_counterpart_dimensions), sqlc.arg(cost_counterpart_dimension_references),
  sqlc.narg(origin_source_document_id), sqlc.narg(origin_source_line_id)
);

-- name: GetAccountingProductCurrentSnapshot :one
SELECT subject.id AS product_id,entry.id AS product_approval_entry_id,
       subject.code AS product_code,version.name AS product_name
FROM dcl_subjects subject
JOIN LATERAL (SELECT id FROM approval_entries WHERE domain='dcl' AND entity='product' AND subject_id=subject.id AND status='APPROVED' ORDER BY version_no DESC LIMIT 1) entry ON true
JOIN dcl_product_versions version ON version.approval_entry_id=entry.id
WHERE subject.id=sqlc.arg(product_id) AND subject.entity='product' AND version.enabled;

-- name: LockAccountingInventory :exec
SELECT pg_advisory_xact_lock(hashtextextended(sqlc.arg(lock_key), 0));

-- name: GetAccountingInventoryQuantity :one
SELECT COALESCE(sum(quantity_delta_micros), 0)::bigint
FROM acc_inventory_entries
WHERE book_id = sqlc.arg(book_id)
  AND subject_id = sqlc.arg(subject_id)
  AND product_id = sqlc.arg(product_id)
  AND warehouse_id = sqlc.arg(warehouse_id)
  AND business_date <= sqlc.arg(business_date);

-- name: GetMinimumAccountingInventoryQuantity :one
SELECT COALESCE(min(running_quantity), 0)::bigint
FROM (
  SELECT sum(sum(quantity_delta_micros)) OVER (ORDER BY business_date) AS running_quantity
  FROM acc_inventory_entries
  WHERE book_id = sqlc.arg(book_id)
    AND subject_id = sqlc.arg(subject_id)
    AND product_id = sqlc.arg(product_id)
    AND warehouse_id = sqlc.arg(warehouse_id)
  GROUP BY business_date
) daily_balances;

-- name: ListAccountingPeriods :many
SELECT to_char(period_month, 'YYYY-MM') AS period_month, state, revision,
       locked_at, locked_by
FROM acc_periods
WHERE book_id = sqlc.arg(book_id)
ORDER BY period_month DESC;

-- name: GetLatestLockedAccountingPeriod :one
SELECT period_month, revision
FROM acc_periods
WHERE book_id = sqlc.arg(book_id) AND state = 'LOCKED'
ORDER BY period_month DESC
LIMIT 1
FOR UPDATE;

-- name: LockAccountingPeriodRow :one
INSERT INTO acc_periods (
  book_id, period_month, state, locked_at, locked_by, updated_by
) VALUES (
  sqlc.arg(book_id), sqlc.arg(period_month), 'LOCKED', now(), sqlc.arg(actor_id), sqlc.arg(actor_id)
)
ON CONFLICT (book_id, period_month) DO UPDATE SET
  state = 'LOCKED', revision = acc_periods.revision + 1,
  locked_at = now(), locked_by = sqlc.arg(actor_id),
  updated_at = now(), updated_by = sqlc.arg(actor_id)
WHERE acc_periods.state = 'UNLOCKED' AND acc_periods.revision = sqlc.arg(revision)
RETURNING revision, locked_at;

-- name: UnlockAccountingPeriodRow :one
UPDATE acc_periods SET
  state = 'UNLOCKED', revision = revision + 1,
  locked_at = NULL, locked_by = NULL, updated_at = now(), updated_by = sqlc.arg(actor_id)
WHERE book_id = sqlc.arg(book_id) AND period_month = sqlc.arg(period_month)
  AND state = 'LOCKED' AND revision = sqlc.arg(revision)
RETURNING revision;

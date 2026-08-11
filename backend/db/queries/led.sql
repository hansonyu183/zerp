-- name: GetLedControl :one
SELECT * FROM led_control WHERE singleton = true;

-- name: LockLedControl :one
SELECT * FROM led_control WHERE singleton = true FOR UPDATE;

-- name: SaveLedDraftControl :one
UPDATE led_control
SET cutover_date = sqlc.arg(cutover_date), revision = revision + 1,
    updated_at = now(), updated_by = sqlc.arg(actor_id)
WHERE singleton = true
  AND revision = sqlc.arg(revision)
  AND status IN ('DRAFT', 'REOPENING')
RETURNING revision;

-- name: ReopenLedControl :one
UPDATE led_control
SET status = 'REOPENING', revision = revision + 1,
    updated_at = now(), updated_by = sqlc.arg(actor_id)
WHERE singleton = true AND status = 'ACTIVE' AND revision = sqlc.arg(revision)
RETURNING revision;

-- name: CancelLedReopen :one
UPDATE led_control AS c
SET status = 'ACTIVE', cutover_date = g.cutover_date, revision = c.revision + 1,
    updated_at = now(), updated_by = sqlc.arg(actor_id)
FROM led_generations g
WHERE c.singleton = true AND c.status = 'REOPENING'
  AND c.revision = sqlc.arg(revision) AND g.id = c.active_generation_id
RETURNING c.revision;

-- name: ActivateLedControl :one
UPDATE led_control
SET status = 'ACTIVE', cutover_date = sqlc.arg(cutover_date),
    active_generation_id = sqlc.arg(generation_id), revision = revision + 1,
    updated_at = now(), updated_by = sqlc.arg(actor_id)
WHERE singleton = true AND revision = sqlc.arg(revision)
  AND status IN ('DRAFT', 'REOPENING')
RETURNING revision;

-- name: DeleteLedDraftInventory :exec
DELETE FROM led_draft_inventory;

-- name: DeleteLedDraftFund :exec
DELETE FROM led_draft_fund;

-- name: DeleteLedDraftParty :exec
DELETE FROM led_draft_party;

-- name: DeleteLedDraftContainer :exec
DELETE FROM led_draft_container;

-- name: InsertLedDraftInventory :exec
INSERT INTO led_draft_inventory (
    id, warehouse_object_id, warehouse_version_id, warehouse_code, warehouse_name,
    product_object_id, product_version_id, product_code, product_name, product_unit,
    quantity_micros, currency, unit_price_cents, amount_cents
) VALUES (
    sqlc.arg(id), sqlc.arg(warehouse_object_id), sqlc.arg(warehouse_version_id),
    sqlc.arg(warehouse_code), sqlc.arg(warehouse_name), sqlc.arg(product_object_id),
    sqlc.arg(product_version_id), sqlc.arg(product_code), sqlc.arg(product_name),
    sqlc.arg(product_unit), sqlc.arg(quantity_micros), sqlc.arg(currency),
    sqlc.arg(unit_price_cents), sqlc.arg(amount_cents)
);

-- name: InsertLedDraftFund :exec
INSERT INTO led_draft_fund (
    id, fund_account_object_id, fund_account_version_id, fund_account_code,
    fund_account_name, currency, amount_cents
) VALUES (
    sqlc.arg(id), sqlc.arg(fund_account_object_id), sqlc.arg(fund_account_version_id),
    sqlc.arg(fund_account_code), sqlc.arg(fund_account_name), sqlc.arg(currency),
    sqlc.arg(amount_cents)
);

-- name: InsertLedDraftParty :exec
INSERT INTO led_draft_party (
    id, counterparty_entity, counterparty_object_id, counterparty_version_id,
    counterparty_code,counterparty_name,currency,amount_cents,account_type
) VALUES (
    sqlc.arg(id), sqlc.arg(counterparty_entity), sqlc.arg(counterparty_object_id),
    sqlc.arg(counterparty_version_id), sqlc.arg(counterparty_code),
    sqlc.arg(counterparty_name),sqlc.arg(currency),sqlc.arg(amount_cents),sqlc.arg(account_type)
);

-- name: InsertLedDraftContainer :exec
INSERT INTO led_draft_container(
    id, customer_object_id, customer_version_id, customer_code, customer_name,
    container_type, quantity
) VALUES (
    sqlc.arg(id), sqlc.arg(customer_object_id), sqlc.arg(customer_version_id),
    sqlc.arg(customer_code), sqlc.arg(customer_name), sqlc.arg(container_type),
    sqlc.arg(quantity)
);

-- name: ListLedDraftInventory :many
SELECT * FROM led_draft_inventory ORDER BY warehouse_code, product_code, id;

-- name: HasIncompleteLedDraftInventoryPricing :one
SELECT EXISTS (
    SELECT 1
    FROM led_draft_inventory
    WHERE currency IS NULL OR unit_price_cents IS NULL OR amount_cents IS NULL
)::boolean;

-- name: ListLedDraftFund :many
SELECT * FROM led_draft_fund ORDER BY fund_account_code, id;

-- name: ListLedDraftParty :many
SELECT * FROM led_draft_party ORDER BY account_type,counterparty_entity,counterparty_code,currency,id;

-- name: ListLedDraftContainer :many
SELECT * FROM led_draft_container ORDER BY customer_code, container_type, id;

-- name: ListLedOpeningInventory :many
SELECT * FROM led_opening_inventory
WHERE generation_id = sqlc.arg(generation_id)
ORDER BY warehouse_code, product_code, id;

-- name: ListLedOpeningFund :many
SELECT * FROM led_opening_fund
WHERE generation_id = sqlc.arg(generation_id)
ORDER BY fund_account_code, id;

-- name: ListLedOpeningParty :many
SELECT * FROM led_opening_party
WHERE generation_id = sqlc.arg(generation_id)
ORDER BY account_type,counterparty_entity,counterparty_code,currency,id;

-- name: ListLedOpeningContainer :many
SELECT * FROM led_opening_container
WHERE generation_id = sqlc.arg(generation_id)
ORDER BY customer_code, container_type, id;

-- name: CopyLedOpeningToDraftInventory :exec
INSERT INTO led_draft_inventory
SELECT id, warehouse_object_id, warehouse_version_id, warehouse_code, warehouse_name,
       product_object_id, product_version_id, product_code, product_name, product_unit,
       quantity_micros, currency, unit_price_cents, amount_cents
FROM led_opening_inventory WHERE generation_id = sqlc.arg(generation_id);

-- name: CopyLedOpeningToDraftFund :exec
INSERT INTO led_draft_fund
SELECT id, fund_account_object_id, fund_account_version_id, fund_account_code,
       fund_account_name, currency, amount_cents
FROM led_opening_fund WHERE generation_id = sqlc.arg(generation_id);

-- name: CopyLedOpeningToDraftParty :exec
INSERT INTO led_draft_party(
    id,counterparty_entity,counterparty_object_id,counterparty_version_id,
    counterparty_code,counterparty_name,currency,amount_cents,account_type
)
SELECT id,counterparty_entity,counterparty_object_id,counterparty_version_id,
       counterparty_code,counterparty_name,currency,amount_cents,account_type
FROM led_opening_party WHERE generation_id = sqlc.arg(generation_id);

-- name: CopyLedOpeningToDraftContainer :exec
INSERT INTO led_draft_container
SELECT id, customer_object_id, customer_version_id, customer_code, customer_name,
       container_type, quantity
FROM led_opening_container WHERE generation_id = sqlc.arg(generation_id);

-- name: InsertLedGeneration :exec
INSERT INTO led_generations (id, cutover_date, status, activated_by, request_id)
VALUES (sqlc.arg(id), sqlc.arg(cutover_date), 'ACTIVE', sqlc.arg(actor_id), sqlc.arg(request_id));

-- name: ArchiveActiveLedGeneration :exec
UPDATE led_generations SET status = 'ARCHIVED'
WHERE id = sqlc.arg(generation_id) AND status = 'ACTIVE';

-- name: InsertLedOpeningInventoryFromDraft :exec
INSERT INTO led_opening_inventory (
    id, generation_id, warehouse_object_id, warehouse_version_id, warehouse_code, warehouse_name,
    product_object_id, product_version_id, product_code, product_name, product_unit,
    quantity_micros, currency, unit_price_cents, amount_cents
)
SELECT id, sqlc.arg(generation_id), warehouse_object_id, warehouse_version_id, warehouse_code, warehouse_name,
       product_object_id, product_version_id, product_code, product_name, product_unit,
       quantity_micros, currency, unit_price_cents, amount_cents
FROM led_draft_inventory;

-- name: InsertLedOpeningFundFromDraft :exec
INSERT INTO led_opening_fund (
    id, generation_id, fund_account_object_id, fund_account_version_id,
    fund_account_code, fund_account_name, currency, amount_cents
)
SELECT id, sqlc.arg(generation_id), fund_account_object_id, fund_account_version_id,
       fund_account_code, fund_account_name, currency, amount_cents
FROM led_draft_fund;

-- name: InsertLedOpeningPartyFromDraft :exec
INSERT INTO led_opening_party (
    id, generation_id, counterparty_entity, counterparty_object_id, counterparty_version_id,
    counterparty_code,counterparty_name,currency,amount_cents,account_type
)
SELECT id, sqlc.arg(generation_id), counterparty_entity, counterparty_object_id, counterparty_version_id,
       counterparty_code,counterparty_name,currency,amount_cents,account_type
FROM led_draft_party;

-- name: InsertLedOpeningContainerFromDraft :exec
INSERT INTO led_opening_container(
    id,generation_id,customer_object_id,customer_version_id,customer_code,customer_name,
    container_type,quantity
)
SELECT id,sqlc.arg(generation_id),customer_object_id,customer_version_id,customer_code,
       customer_name,container_type,quantity
FROM led_draft_container;

-- name: InsertLedOpeningInventoryEntries :exec
INSERT INTO led_inventory_entries (
    id, generation_id, entry_type, source_entity, source_line_id, effective_date,
    occurred_at, actor_id, request_id, warehouse_object_id, warehouse_version_id,
    warehouse_code, warehouse_name, product_object_id, product_version_id,
    product_code, product_name, product_unit, quantity_delta_micros,
    currency, unit_price_cents, amount_cents
)
SELECT id, sqlc.arg(generation_id), 'OPENING', 'opening', id, sqlc.arg(cutover_date),
       sqlc.arg(occurred_at), sqlc.arg(actor_id), sqlc.arg(request_id),
       warehouse_object_id, warehouse_version_id, warehouse_code, warehouse_name,
       product_object_id, product_version_id, product_code, product_name, product_unit,
       quantity_micros, currency, unit_price_cents, amount_cents
FROM led_draft_inventory WHERE quantity_micros <> 0;

-- name: InsertLedOpeningFundEntries :exec
INSERT INTO led_fund_entries (
    id, generation_id, entry_type, source_entity, source_line_id, effective_date,
    occurred_at, actor_id, request_id, fund_account_object_id, fund_account_version_id,
    fund_account_code, fund_account_name, currency, amount_delta_cents
)
SELECT id, sqlc.arg(generation_id), 'OPENING', 'opening', id, sqlc.arg(cutover_date),
       sqlc.arg(occurred_at), sqlc.arg(actor_id), sqlc.arg(request_id),
       fund_account_object_id, fund_account_version_id, fund_account_code,
       fund_account_name, currency, amount_cents
FROM led_draft_fund WHERE amount_cents <> 0;

-- name: InsertLedOpeningPartyEntries :exec
INSERT INTO led_party_entries (
    id, generation_id, entry_type, source_entity, source_line_id, effective_date,
    occurred_at, actor_id, request_id, counterparty_entity, counterparty_object_id,
    counterparty_version_id,counterparty_code,counterparty_name,currency,amount_delta_cents,account_type
)
SELECT id, sqlc.arg(generation_id), 'OPENING', 'opening', id, sqlc.arg(cutover_date),
       sqlc.arg(occurred_at), sqlc.arg(actor_id), sqlc.arg(request_id),
       counterparty_entity, counterparty_object_id, counterparty_version_id,
       counterparty_code,counterparty_name,currency,amount_cents,account_type
FROM led_draft_party WHERE amount_cents <> 0;

-- name: InsertLedOpeningContainerEntries :exec
INSERT INTO led_container_entries(
    id,generation_id,entry_type,source_entity,source_line_id,effective_date,
    occurred_at,actor_id,request_id,customer_object_id,customer_version_id,
    customer_code,customer_name,container_type,quantity_delta
)
SELECT id,sqlc.arg(generation_id),'OPENING','opening',id,sqlc.arg(cutover_date),
       sqlc.arg(occurred_at),sqlc.arg(actor_id),sqlc.arg(request_id),
       customer_object_id,customer_version_id,customer_code,customer_name,
       container_type,quantity
FROM led_draft_container WHERE quantity <> 0;

-- name: ListPostedVouDocumentsForLed :many
SELECT * FROM vou_documents
WHERE status = 'APPROVED'
  AND entity IN (
    'sale-outbound', 'sale-signoff', 'sale-return',
    'purchase-inbound', 'purchase-return',
    'order-production', 'self-production', 'inventory-count',
    'sales-receipt','sales-refund','purchase-payment','purchase-refund',
    'other-receipt','other-payment',
    'employee-loan', 'employee-repayment', 'employee-loan-writeoff',
    'expense-reimbursement', 'expense-payment', 'other-income',
    'asset-acquisition', 'asset-depreciation', 'asset-sale', 'asset-liquidation',
    'bill-receipt', 'bill-payment', 'bill-issue', 'bill-discount', 'bill-maturity',
    'intermediary-calculation'
  )
ORDER BY posted_at, id;

-- name: InsertLedInventoryEntry :exec
INSERT INTO led_inventory_entries (
    id, generation_id, entry_type, source_entity, source_document_id, source_document_no,
    source_line_id, source_revision, effective_date, occurred_at, actor_id, request_id, remark,
    warehouse_object_id, warehouse_version_id, warehouse_code, warehouse_name,
    product_object_id, product_version_id, product_code, product_name, product_unit,
    quantity_delta_micros, currency, unit_price_cents, amount_cents
) VALUES (
    sqlc.arg(id), sqlc.arg(generation_id), sqlc.arg(entry_type), sqlc.arg(source_entity),
    sqlc.arg(source_document_id), sqlc.arg(source_document_no), sqlc.arg(source_line_id),
    sqlc.arg(source_revision), sqlc.arg(effective_date), sqlc.arg(occurred_at),
    sqlc.arg(actor_id), sqlc.arg(request_id), sqlc.narg(remark),
    sqlc.arg(warehouse_object_id), sqlc.arg(warehouse_version_id), sqlc.arg(warehouse_code),
    sqlc.arg(warehouse_name), sqlc.arg(product_object_id), sqlc.arg(product_version_id),
    sqlc.arg(product_code), sqlc.arg(product_name), sqlc.arg(product_unit),
    sqlc.arg(quantity_delta_micros), sqlc.arg(currency), sqlc.arg(unit_price_cents),
    sqlc.arg(amount_cents)
) ON CONFLICT DO NOTHING;

-- name: InsertLedFundEntry :exec
INSERT INTO led_fund_entries (
    id, generation_id, entry_type, source_entity, source_document_id, source_document_no,
    source_line_id, source_revision, effective_date, occurred_at, actor_id, request_id, remark,
    fund_account_object_id, fund_account_version_id, fund_account_code, fund_account_name,
    currency, amount_delta_cents
) VALUES (
    sqlc.arg(id), sqlc.arg(generation_id), sqlc.arg(entry_type), sqlc.arg(source_entity),
    sqlc.arg(source_document_id), sqlc.arg(source_document_no), sqlc.arg(source_line_id),
    sqlc.arg(source_revision), sqlc.arg(effective_date), sqlc.arg(occurred_at),
    sqlc.arg(actor_id), sqlc.arg(request_id), sqlc.narg(remark),
    sqlc.arg(fund_account_object_id), sqlc.arg(fund_account_version_id),
    sqlc.arg(fund_account_code), sqlc.arg(fund_account_name), sqlc.arg(currency),
    sqlc.arg(amount_delta_cents)
) ON CONFLICT DO NOTHING;

-- name: InsertLedPartyEntry :exec
INSERT INTO led_party_entries (
    id, generation_id, entry_type, source_entity, source_document_id, source_document_no,
    source_line_id, source_revision, effective_date, occurred_at, actor_id, request_id, remark,
    counterparty_entity, counterparty_object_id, counterparty_version_id,
    counterparty_code, counterparty_name, currency, amount_delta_cents
) VALUES (
    sqlc.arg(id), sqlc.arg(generation_id), sqlc.arg(entry_type), sqlc.arg(source_entity),
    sqlc.arg(source_document_id), sqlc.arg(source_document_no), sqlc.arg(source_line_id),
    sqlc.arg(source_revision), sqlc.arg(effective_date), sqlc.arg(occurred_at),
    sqlc.arg(actor_id), sqlc.arg(request_id), sqlc.narg(remark),
    sqlc.arg(counterparty_entity), sqlc.arg(counterparty_object_id),
    sqlc.arg(counterparty_version_id), sqlc.arg(counterparty_code),
    sqlc.arg(counterparty_name), sqlc.arg(currency), sqlc.arg(amount_delta_cents)
) ON CONFLICT DO NOTHING;

-- name: NextLedAssetNumber :one
INSERT INTO led_asset_number_counters(business_date,last_value) VALUES(sqlc.arg(business_date),1)
ON CONFLICT(business_date) DO UPDATE SET last_value=led_asset_number_counters.last_value+1
WHERE led_asset_number_counters.last_value<9999 RETURNING last_value;

-- name: FindLedAssetNoBySourceLine :one
SELECT asset_no FROM led_asset_number_assignments WHERE source_line_id=sqlc.arg(source_line_id);

-- name: InsertLedAssetNumberAssignment :exec
INSERT INTO led_asset_number_assignments(source_line_id,asset_no)
VALUES(sqlc.arg(source_line_id),sqlc.arg(asset_no));

-- name: InsertLedAsset :exec
INSERT INTO led_assets(generation_id,id,asset_no,asset_name,specification,
 category_object_id,category_version_id,category_code,category_name,
 department_object_id,department_version_id,department_code,department_name,
 custodian_object_id,custodian_version_id,custodian_code,custodian_name,location,
 acquisition_date,depreciation_start_month,original_value_cents,residual_value_cents,useful_life_months,
 source_document_id,source_line_id,source_revision,remark)
VALUES(sqlc.arg(generation_id),sqlc.arg(id),sqlc.arg(asset_no),sqlc.arg(asset_name),sqlc.arg(specification),
 sqlc.arg(category_object_id),sqlc.arg(category_version_id),sqlc.arg(category_code),sqlc.arg(category_name),
 sqlc.arg(department_object_id),sqlc.arg(department_version_id),sqlc.arg(department_code),sqlc.arg(department_name),
 sqlc.narg(custodian_object_id),sqlc.narg(custodian_version_id),sqlc.narg(custodian_code),sqlc.narg(custodian_name),sqlc.arg(location),
 sqlc.arg(acquisition_date),sqlc.arg(depreciation_start_month),sqlc.arg(original_value_cents),sqlc.arg(residual_value_cents),sqlc.arg(useful_life_months),
 sqlc.arg(source_document_id),sqlc.arg(source_line_id),sqlc.arg(source_revision),sqlc.narg(remark));

-- name: InsertLedAssetEntry :exec
INSERT INTO led_asset_entries(id,generation_id,asset_id,entry_type,source_entity,source_document_id,source_document_no,
 source_line_id,source_revision,effective_date,occurred_at,amount_cents,status_from,status_to,actor_id,request_id,summary)
VALUES(sqlc.arg(id),sqlc.arg(generation_id),sqlc.arg(asset_id),sqlc.arg(entry_type),sqlc.arg(source_entity),sqlc.arg(source_document_id),sqlc.arg(source_document_no),
 sqlc.arg(source_line_id),sqlc.arg(source_revision),sqlc.arg(effective_date),sqlc.arg(occurred_at),sqlc.arg(amount_cents),sqlc.narg(status_from),sqlc.arg(status_to),sqlc.arg(actor_id),sqlc.arg(request_id),sqlc.arg(summary));

-- name: LockLedAsset :one
SELECT * FROM led_assets WHERE generation_id=sqlc.arg(generation_id) AND id=sqlc.arg(asset_id) FOR UPDATE;

-- name: ApplyLedAssetDepreciation :execrows
UPDATE led_assets SET accumulated_depreciation_cents=accumulated_depreciation_cents+sqlc.arg(amount_cents),
 last_depreciation_month=sqlc.arg(depreciation_month)
WHERE generation_id=sqlc.arg(generation_id) AND id=sqlc.arg(asset_id) AND status='ACTIVE'
 AND accumulated_depreciation_cents=sqlc.arg(opening_accumulated_cents);

-- name: SetLedAssetStatus :execrows
UPDATE led_assets SET status=sqlc.arg(status)
WHERE generation_id=sqlc.arg(generation_id) AND id=sqlc.arg(asset_id) AND status='ACTIVE';

-- name: HasLaterLedAssetEntries :one
SELECT EXISTS(SELECT 1 FROM led_asset_entries WHERE generation_id=sqlc.arg(generation_id)
 AND asset_id=sqlc.arg(asset_id) AND source_document_id<>sqlc.arg(source_document_id)
 AND effective_date>=sqlc.arg(effective_date))::boolean;

-- name: DeleteLedAssetsBySource :exec
DELETE FROM led_assets WHERE generation_id=sqlc.arg(generation_id) AND source_document_id=sqlc.arg(source_document_id);

-- name: ReverseLedAssetDepreciation :execrows
UPDATE led_assets a SET accumulated_depreciation_cents=a.accumulated_depreciation_cents-x.amount,
 last_depreciation_month=(SELECT max(e.effective_date) FROM led_asset_entries e WHERE e.generation_id=a.generation_id AND e.asset_id=a.id AND e.entry_type='DEPRECIATION' AND e.source_document_id<>sqlc.arg(source_document_id))
FROM (SELECT asset_id,sum(amount_cents)::bigint amount FROM led_asset_entries WHERE generation_id=sqlc.arg(generation_id) AND source_document_id=sqlc.arg(source_document_id) GROUP BY asset_id) x
WHERE a.generation_id=sqlc.arg(generation_id) AND a.id=x.asset_id AND a.status='ACTIVE';

-- name: RestoreLedAssetStatusBySource :execrows
UPDATE led_assets a SET status='ACTIVE' FROM led_asset_entries e
WHERE e.generation_id=sqlc.arg(generation_id) AND e.source_document_id=sqlc.arg(source_document_id)
 AND e.asset_id=a.id AND a.generation_id=e.generation_id AND a.status=e.status_to;

-- name: DeleteLedAssetEntriesBySource :exec
DELETE FROM led_asset_entries WHERE generation_id=sqlc.arg(generation_id) AND source_document_id=sqlc.arg(source_document_id);

-- name: CountLedAssets :one
SELECT count(*) FROM led_assets a JOIN led_control c ON c.active_generation_id=a.generation_id
WHERE c.singleton=true AND c.status='ACTIVE'
 AND (sqlc.arg(keyword)::text='' OR a.asset_no ILIKE '%'||sqlc.arg(keyword)||'%' OR a.asset_name ILIKE '%'||sqlc.arg(keyword)||'%')
 AND (COALESCE(cardinality(sqlc.arg(statuses)::text[]),0)=0 OR a.status=ANY(sqlc.arg(statuses)::text[]))
 AND (sqlc.arg(category_object_id)::text='' OR a.category_object_id=sqlc.arg(category_object_id))
 AND (sqlc.arg(department_object_id)::text='' OR a.department_object_id=sqlc.arg(department_object_id))
 AND (sqlc.arg(custodian_object_id)::text='' OR a.custodian_object_id=sqlc.arg(custodian_object_id));

-- name: ListLedAssets :many
SELECT a.* FROM led_assets a JOIN led_control c ON c.active_generation_id=a.generation_id
WHERE c.singleton=true AND c.status='ACTIVE'
 AND (sqlc.arg(keyword)::text='' OR a.asset_no ILIKE '%'||sqlc.arg(keyword)||'%' OR a.asset_name ILIKE '%'||sqlc.arg(keyword)||'%')
 AND (COALESCE(cardinality(sqlc.arg(statuses)::text[]),0)=0 OR a.status=ANY(sqlc.arg(statuses)::text[]))
 AND (sqlc.arg(category_object_id)::text='' OR a.category_object_id=sqlc.arg(category_object_id))
 AND (sqlc.arg(department_object_id)::text='' OR a.department_object_id=sqlc.arg(department_object_id))
 AND (sqlc.arg(custodian_object_id)::text='' OR a.custodian_object_id=sqlc.arg(custodian_object_id))
ORDER BY a.asset_no LIMIT sqlc.arg(page_size) OFFSET sqlc.arg(page_offset);

-- name: GetActiveLedAsset :one
SELECT a.* FROM led_assets a JOIN led_control c ON c.active_generation_id=a.generation_id
WHERE c.singleton=true AND c.status='ACTIVE' AND a.id=sqlc.arg(asset_id);

-- name: ListLedAssetHistory :many
SELECT e.* FROM led_asset_entries e JOIN led_control c ON c.active_generation_id=e.generation_id
WHERE c.singleton=true AND c.status='ACTIVE' AND e.asset_id=sqlc.arg(asset_id)
ORDER BY e.effective_date,e.id;

-- name: ListLedInventoryEntriesBySource :many
SELECT * FROM led_inventory_entries
WHERE generation_id = sqlc.arg(generation_id)
  AND source_document_id = sqlc.arg(source_document_id)
  AND entry_type = 'POSTING'
ORDER BY id;

-- name: ListLedFundEntriesBySource :many
SELECT * FROM led_fund_entries
WHERE generation_id = sqlc.arg(generation_id)
  AND source_document_id = sqlc.arg(source_document_id)
  AND entry_type = 'POSTING'
ORDER BY id;

-- name: ListLedPartyEntriesBySource :many
SELECT * FROM led_party_entries
WHERE generation_id = sqlc.arg(generation_id)
  AND source_document_id = sqlc.arg(source_document_id)
  AND entry_type = 'POSTING'
ORDER BY id;

-- name: DeleteLedInventoryEntriesBySource :exec
DELETE FROM led_inventory_entries
WHERE generation_id = sqlc.arg(generation_id)
  AND source_document_id = sqlc.arg(source_document_id);

-- name: DeleteLedFundEntriesBySource :exec
DELETE FROM led_fund_entries
WHERE generation_id = sqlc.arg(generation_id)
  AND source_document_id = sqlc.arg(source_document_id);

-- name: DeleteLedPartyEntriesBySource :exec
DELETE FROM led_party_entries
WHERE generation_id = sqlc.arg(generation_id)
  AND source_document_id = sqlc.arg(source_document_id);

-- name: DeleteLedContainerEntriesBySource :exec
DELETE FROM led_container_entries
WHERE generation_id = sqlc.arg(generation_id)
  AND source_document_id = sqlc.arg(source_document_id);

-- name: HasLedEntriesForSource :one
SELECT (
    EXISTS (SELECT 1 FROM led_inventory_entries i WHERE i.generation_id = sqlc.arg(target_generation_id) AND i.source_document_id = sqlc.arg(target_document_id))
    OR EXISTS (SELECT 1 FROM led_fund_entries f WHERE f.generation_id = sqlc.arg(target_generation_id) AND f.source_document_id = sqlc.arg(target_document_id))
    OR EXISTS (SELECT 1 FROM led_party_entries p WHERE p.generation_id = sqlc.arg(target_generation_id) AND p.source_document_id = sqlc.arg(target_document_id))
    OR EXISTS (SELECT 1 FROM led_container_entries c WHERE c.generation_id = sqlc.arg(target_generation_id) AND c.source_document_id = sqlc.arg(target_document_id))
    OR EXISTS (SELECT 1 FROM led_asset_entries a WHERE a.generation_id = sqlc.arg(target_generation_id) AND a.source_document_id = sqlc.arg(target_document_id))
    OR EXISTS (SELECT 1 FROM led_bill_entries b WHERE b.generation_id = sqlc.arg(target_generation_id) AND b.source_document_id = sqlc.arg(target_document_id))
)::boolean;

-- name: HasNegativeLedInventoryTimeline :one
SELECT EXISTS (
    SELECT 1
    FROM (
        SELECT sum(quantity_delta_micros) OVER (
            PARTITION BY warehouse_object_id, product_object_id
            ORDER BY effective_date,
                     CASE WHEN entry_type = 'OPENING' THEN 0 ELSE 1 END,
                     occurred_at, id
            ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
        ) AS running_quantity
        FROM led_inventory_entries
        WHERE generation_id = sqlc.arg(generation_id)
    ) timeline
    WHERE running_quantity < 0
)::boolean;

-- name: CountLedInventoryEntries :one
SELECT count(*) FROM led_inventory_entries
WHERE generation_id = sqlc.arg(generation_id)
  AND effective_date >= sqlc.arg(date_from) AND effective_date <= sqlc.arg(date_to)
  AND (sqlc.arg(object_id)::text = '' OR warehouse_object_id = sqlc.arg(object_id) OR product_object_id = sqlc.arg(object_id))
  AND (sqlc.arg(source_entity)::text = '' OR source_entity = sqlc.arg(source_entity))
  AND (sqlc.arg(document_no)::text = '' OR source_document_no ILIKE '%' || sqlc.arg(document_no) || '%')
  AND (COALESCE(cardinality(sqlc.arg(directions)::text[]), 0) = 0
       OR CASE WHEN quantity_delta_micros > 0 THEN 'IN' ELSE 'OUT' END = ANY(sqlc.arg(directions)::text[]));

-- name: ListLedInventoryEntries :many
SELECT * FROM led_inventory_entries
WHERE generation_id = sqlc.arg(generation_id)
  AND effective_date >= sqlc.arg(date_from) AND effective_date <= sqlc.arg(date_to)
  AND (sqlc.arg(object_id)::text = '' OR warehouse_object_id = sqlc.arg(object_id) OR product_object_id = sqlc.arg(object_id))
  AND (sqlc.arg(source_entity)::text = '' OR source_entity = sqlc.arg(source_entity))
  AND (sqlc.arg(document_no)::text = '' OR source_document_no ILIKE '%' || sqlc.arg(document_no) || '%')
  AND (COALESCE(cardinality(sqlc.arg(directions)::text[]), 0) = 0
       OR CASE WHEN quantity_delta_micros > 0 THEN 'IN' ELSE 'OUT' END = ANY(sqlc.arg(directions)::text[]))
ORDER BY
  CASE WHEN sqlc.arg(sort_field)::text = 'effectiveDate' AND sqlc.arg(sort_order)::text = 'asc' THEN effective_date END ASC,
  CASE WHEN sqlc.arg(sort_field)::text = 'effectiveDate' AND sqlc.arg(sort_order)::text = 'desc' THEN effective_date END DESC,
  CASE WHEN sqlc.arg(sort_field)::text = 'occurredAt' AND sqlc.arg(sort_order)::text = 'asc' THEN occurred_at END ASC,
  CASE WHEN sqlc.arg(sort_field)::text = 'occurredAt' AND sqlc.arg(sort_order)::text = 'desc' THEN occurred_at END DESC,
  CASE WHEN sqlc.arg(sort_field)::text = 'documentNo' AND sqlc.arg(sort_order)::text = 'asc' THEN source_document_no END ASC,
  CASE WHEN sqlc.arg(sort_field)::text = 'documentNo' AND sqlc.arg(sort_order)::text = 'desc' THEN source_document_no END DESC,
  effective_date DESC, occurred_at DESC, id DESC
LIMIT sqlc.arg(page_size) OFFSET sqlc.arg(page_offset);

-- name: CountLedFundEntries :one
SELECT count(*) FROM led_fund_entries
WHERE generation_id = sqlc.arg(generation_id)
  AND effective_date >= sqlc.arg(date_from) AND effective_date <= sqlc.arg(date_to)
  AND (sqlc.arg(object_id)::text = '' OR fund_account_object_id = sqlc.arg(object_id))
  AND (sqlc.arg(source_entity)::text = '' OR source_entity = sqlc.arg(source_entity))
  AND (sqlc.arg(document_no)::text = '' OR source_document_no ILIKE '%' || sqlc.arg(document_no) || '%')
  AND (COALESCE(cardinality(sqlc.arg(directions)::text[]), 0) = 0
       OR CASE WHEN amount_delta_cents > 0 THEN 'IN' ELSE 'OUT' END = ANY(sqlc.arg(directions)::text[]));

-- name: ListLedFundEntries :many
SELECT * FROM led_fund_entries
WHERE generation_id = sqlc.arg(generation_id)
  AND effective_date >= sqlc.arg(date_from) AND effective_date <= sqlc.arg(date_to)
  AND (sqlc.arg(object_id)::text = '' OR fund_account_object_id = sqlc.arg(object_id))
  AND (sqlc.arg(source_entity)::text = '' OR source_entity = sqlc.arg(source_entity))
  AND (sqlc.arg(document_no)::text = '' OR source_document_no ILIKE '%' || sqlc.arg(document_no) || '%')
  AND (COALESCE(cardinality(sqlc.arg(directions)::text[]), 0) = 0
       OR CASE WHEN amount_delta_cents > 0 THEN 'IN' ELSE 'OUT' END = ANY(sqlc.arg(directions)::text[]))
ORDER BY
  CASE WHEN sqlc.arg(sort_field)::text = 'effectiveDate' AND sqlc.arg(sort_order)::text = 'asc' THEN effective_date END ASC,
  CASE WHEN sqlc.arg(sort_field)::text = 'effectiveDate' AND sqlc.arg(sort_order)::text = 'desc' THEN effective_date END DESC,
  CASE WHEN sqlc.arg(sort_field)::text = 'occurredAt' AND sqlc.arg(sort_order)::text = 'asc' THEN occurred_at END ASC,
  CASE WHEN sqlc.arg(sort_field)::text = 'occurredAt' AND sqlc.arg(sort_order)::text = 'desc' THEN occurred_at END DESC,
  CASE WHEN sqlc.arg(sort_field)::text = 'documentNo' AND sqlc.arg(sort_order)::text = 'asc' THEN source_document_no END ASC,
  CASE WHEN sqlc.arg(sort_field)::text = 'documentNo' AND sqlc.arg(sort_order)::text = 'desc' THEN source_document_no END DESC,
  effective_date DESC, occurred_at DESC, id DESC
LIMIT sqlc.arg(page_size) OFFSET sqlc.arg(page_offset);

-- name: CountLedPartyEntries :one
SELECT count(*) FROM led_party_entries
WHERE generation_id = sqlc.arg(generation_id) AND account_type = 'TRADE'
  AND (sqlc.arg(counterparty_entity)::text = '' OR counterparty_entity = sqlc.arg(counterparty_entity))
  AND effective_date >= sqlc.arg(date_from) AND effective_date <= sqlc.arg(date_to)
  AND (sqlc.arg(object_id)::text = '' OR counterparty_object_id = sqlc.arg(object_id))
  AND (sqlc.arg(source_entity)::text = '' OR source_entity = sqlc.arg(source_entity))
  AND (sqlc.arg(document_no)::text = '' OR source_document_no ILIKE '%' || sqlc.arg(document_no) || '%')
  AND (COALESCE(cardinality(sqlc.arg(directions)::text[]), 0) = 0
       OR CASE WHEN amount_delta_cents > 0 THEN 'DEBIT' ELSE 'CREDIT' END = ANY(sqlc.arg(directions)::text[]));

-- name: ListLedPartyEntries :many
SELECT * FROM led_party_entries
WHERE generation_id = sqlc.arg(generation_id) AND account_type = 'TRADE'
  AND (sqlc.arg(counterparty_entity)::text = '' OR counterparty_entity = sqlc.arg(counterparty_entity))
  AND effective_date >= sqlc.arg(date_from) AND effective_date <= sqlc.arg(date_to)
  AND (sqlc.arg(object_id)::text = '' OR counterparty_object_id = sqlc.arg(object_id))
  AND (sqlc.arg(source_entity)::text = '' OR source_entity = sqlc.arg(source_entity))
  AND (sqlc.arg(document_no)::text = '' OR source_document_no ILIKE '%' || sqlc.arg(document_no) || '%')
  AND (COALESCE(cardinality(sqlc.arg(directions)::text[]), 0) = 0
       OR CASE WHEN amount_delta_cents > 0 THEN 'DEBIT' ELSE 'CREDIT' END = ANY(sqlc.arg(directions)::text[]))
ORDER BY
  CASE WHEN sqlc.arg(sort_field)::text = 'effectiveDate' AND sqlc.arg(sort_order)::text = 'asc' THEN effective_date END ASC,
  CASE WHEN sqlc.arg(sort_field)::text = 'effectiveDate' AND sqlc.arg(sort_order)::text = 'desc' THEN effective_date END DESC,
  CASE WHEN sqlc.arg(sort_field)::text = 'occurredAt' AND sqlc.arg(sort_order)::text = 'asc' THEN occurred_at END ASC,
  CASE WHEN sqlc.arg(sort_field)::text = 'occurredAt' AND sqlc.arg(sort_order)::text = 'desc' THEN occurred_at END DESC,
  CASE WHEN sqlc.arg(sort_field)::text = 'documentNo' AND sqlc.arg(sort_order)::text = 'asc' THEN source_document_no END ASC,
  CASE WHEN sqlc.arg(sort_field)::text = 'documentNo' AND sqlc.arg(sort_order)::text = 'desc' THEN source_document_no END DESC,
  effective_date DESC, occurred_at DESC, id DESC
LIMIT sqlc.arg(page_size) OFFSET sqlc.arg(page_offset);

-- name: CountLedInventoryBalances :one
SELECT count(*) FROM (
    SELECT warehouse_object_id, product_object_id
    FROM led_inventory_entries
    WHERE generation_id = sqlc.arg(generation_id) AND effective_date <= sqlc.arg(as_of_date)
      AND (sqlc.arg(object_id)::text = '' OR warehouse_object_id = sqlc.arg(object_id) OR product_object_id = sqlc.arg(object_id))
    GROUP BY warehouse_object_id, product_object_id
) balances;

-- name: ListLedInventoryBalances :many
SELECT warehouse_object_id,
       (array_agg(warehouse_version_id ORDER BY effective_date DESC, occurred_at DESC, id DESC))[1]::varchar(26) AS warehouse_version_id,
       max(warehouse_code)::varchar(64) AS warehouse_code,
       (array_agg(warehouse_name ORDER BY effective_date DESC, occurred_at DESC, id DESC))[1]::varchar(200) AS warehouse_name,
       product_object_id,
       (array_agg(product_version_id ORDER BY effective_date DESC, occurred_at DESC, id DESC))[1]::varchar(26) AS product_version_id,
       max(product_code)::varchar(64) AS product_code,
       (array_agg(product_name ORDER BY effective_date DESC, occurred_at DESC, id DESC))[1]::varchar(200) AS product_name,
       (array_agg(product_unit ORDER BY effective_date DESC, occurred_at DESC, id DESC))[1]::varchar(32) AS product_unit,
       sum(quantity_delta_micros)::bigint AS balance_micros
FROM led_inventory_entries
WHERE generation_id = sqlc.arg(generation_id) AND effective_date <= sqlc.arg(as_of_date)
  AND (sqlc.arg(object_id)::text = '' OR warehouse_object_id = sqlc.arg(object_id) OR product_object_id = sqlc.arg(object_id))
GROUP BY warehouse_object_id, product_object_id
ORDER BY max(warehouse_code), max(product_code), warehouse_object_id, product_object_id
LIMIT sqlc.arg(page_size) OFFSET sqlc.arg(page_offset);

-- name: CountLedFundBalances :one
SELECT count(*) FROM (
    SELECT fund_account_object_id, currency
    FROM led_fund_entries
    WHERE generation_id = sqlc.arg(generation_id) AND effective_date <= sqlc.arg(as_of_date)
      AND (sqlc.arg(object_id)::text = '' OR fund_account_object_id = sqlc.arg(object_id))
    GROUP BY fund_account_object_id, currency
) balances;

-- name: ListLedFundBalances :many
SELECT fund_account_object_id,
       (array_agg(fund_account_version_id ORDER BY effective_date DESC, occurred_at DESC, id DESC))[1]::varchar(26) AS fund_account_version_id,
       max(fund_account_code)::varchar(64) AS fund_account_code,
       (array_agg(fund_account_name ORDER BY effective_date DESC, occurred_at DESC, id DESC))[1]::varchar(200) AS fund_account_name,
       currency, sum(amount_delta_cents)::bigint AS balance_cents
FROM led_fund_entries
WHERE generation_id = sqlc.arg(generation_id) AND effective_date <= sqlc.arg(as_of_date)
  AND (sqlc.arg(object_id)::text = '' OR fund_account_object_id = sqlc.arg(object_id))
GROUP BY fund_account_object_id, currency
ORDER BY max(fund_account_code), currency, fund_account_object_id
LIMIT sqlc.arg(page_size) OFFSET sqlc.arg(page_offset);

-- name: CountLedPartyBalances :one
SELECT count(*) FROM (
    SELECT counterparty_entity, counterparty_object_id, currency
    FROM led_party_entries
    WHERE generation_id = sqlc.arg(generation_id) AND account_type = 'TRADE'
      AND (sqlc.arg(counterparty_entity)::text = '' OR counterparty_entity = sqlc.arg(counterparty_entity))
      AND effective_date <= sqlc.arg(as_of_date)
      AND (sqlc.arg(object_id)::text = '' OR counterparty_object_id = sqlc.arg(object_id))
    GROUP BY counterparty_entity, counterparty_object_id, currency
) balances;

-- name: GetLedPartyBalanceAtDate :one
SELECT COALESCE(sum(amount_delta_cents), 0)::bigint
FROM led_party_entries
WHERE generation_id=sqlc.arg(generation_id) AND account_type = 'TRADE'
  AND counterparty_entity=sqlc.arg(counterparty_entity)
  AND counterparty_object_id=sqlc.arg(counterparty_object_id)
  AND currency=sqlc.arg(currency)
  AND effective_date<=sqlc.arg(as_of_date);

-- name: GetLedOtherBalanceAtDate :one
SELECT COALESCE(sum(amount_delta_cents),0)::bigint
FROM led_party_entries
WHERE generation_id=sqlc.arg(generation_id) AND account_type='OTHER'
  AND counterparty_entity=sqlc.arg(counterparty_entity)
  AND counterparty_object_id=sqlc.arg(counterparty_object_id)
  AND currency=sqlc.arg(currency)
  AND effective_date<=sqlc.arg(as_of_date);

-- name: HasInvalidEmployeeWriteoffTimeline :one
SELECT EXISTS (
    SELECT 1
    FROM led_party_entries writeoff
    WHERE writeoff.generation_id=sqlc.arg(generation_id) AND writeoff.account_type='OTHER'
      AND writeoff.counterparty_entity='employee'
      AND writeoff.source_entity='employee-loan-writeoff'
      AND (
          SELECT COALESCE(sum(entry.amount_delta_cents), 0)
          FROM led_party_entries entry
          WHERE entry.generation_id=writeoff.generation_id AND entry.account_type='OTHER'
            AND entry.counterparty_entity=writeoff.counterparty_entity
            AND entry.counterparty_object_id=writeoff.counterparty_object_id
            AND entry.currency=writeoff.currency
            AND entry.effective_date<=writeoff.effective_date
      ) < 0
);

-- name: ListLedPartyBalances :many
SELECT counterparty_entity, counterparty_object_id,
       (array_agg(counterparty_version_id ORDER BY effective_date DESC, occurred_at DESC, id DESC))[1]::varchar(26) AS counterparty_version_id,
       max(counterparty_code)::varchar(64) AS counterparty_code,
       (array_agg(counterparty_name ORDER BY effective_date DESC, occurred_at DESC, id DESC))[1]::varchar(200) AS counterparty_name,
       currency, sum(amount_delta_cents)::bigint AS balance_cents
FROM led_party_entries
WHERE generation_id = sqlc.arg(generation_id) AND account_type = 'TRADE'
  AND (sqlc.arg(counterparty_entity)::text = '' OR counterparty_entity = sqlc.arg(counterparty_entity))
  AND effective_date <= sqlc.arg(as_of_date)
  AND (sqlc.arg(object_id)::text = '' OR counterparty_object_id = sqlc.arg(object_id))
GROUP BY counterparty_entity, counterparty_object_id, currency
ORDER BY counterparty_entity, max(counterparty_code), currency, counterparty_object_id
LIMIT sqlc.arg(page_size) OFFSET sqlc.arg(page_offset);

-- name: InsertLedAuditEvent :exec
INSERT INTO led_audit_events (
    id, event_type, from_status, to_status, generation_id, revision,
    actor_id, reason, request_id, summary
) VALUES (
    sqlc.arg(id), sqlc.arg(event_type), sqlc.narg(from_status), sqlc.arg(to_status),
    sqlc.narg(generation_id), sqlc.arg(revision), sqlc.arg(actor_id),
    sqlc.narg(reason), sqlc.arg(request_id), sqlc.arg(summary)
);

-- name: CountLedAuditEvents :one
SELECT count(*) FROM led_audit_events;

-- name: ListLedAuditEvents :many
SELECT * FROM led_audit_events ORDER BY occurred_at DESC, id DESC
LIMIT sqlc.arg(page_size) OFFSET sqlc.arg(page_offset);

-- name: LockLedBill :one
SELECT *
FROM led_bills
WHERE id = sqlc.arg(id)
FOR UPDATE;

-- name: GetLedBillAvailableBalance :one
SELECT COALESCE(sum(CASE entry.direction WHEN 'IN' THEN 1 ELSE -1 END), 0)::bigint
FROM led_bill_entries AS entry
WHERE entry.generation_id = sqlc.arg(generation_id)
  AND entry.bill_id = sqlc.arg(bill_id)
  AND entry.position_type = sqlc.arg(position_type)
  AND (
    entry.direction = 'OUT'
    OR entry.effective_date <= sqlc.arg(as_of_date)::date
  )
;

-- name: CountLedBillDownstreamEntries :one
WITH source AS (
  SELECT entry.bill_id, max(entry.occurred_at) AS occurred_at
  FROM led_bill_entries AS entry
  JOIN led_control AS control
    ON control.active_generation_id = entry.generation_id
  WHERE entry.source_document_id = sqlc.arg(source_document_id)
    AND control.status = 'ACTIVE'
  GROUP BY entry.bill_id
)
SELECT count(*)
FROM led_bill_entries AS downstream
JOIN led_control AS control
  ON control.active_generation_id = downstream.generation_id
JOIN source
  ON source.bill_id = downstream.bill_id
WHERE downstream.source_document_id <> sqlc.arg(source_document_id)
  AND downstream.occurred_at > source.occurred_at
  AND control.status = 'ACTIVE';

-- name: EnsureLedBill :execrows
INSERT INTO led_bills (
  id, position_type, bill_type, bill_no, medium, currency, face_amount_cents,
  issue_date, maturity_date, drawer, acceptor, payee, annual_rate_bps,
  interest_days, interest_amount_cents, customer_cost_amount_cents,
  origin_party_entity, origin_party_object_id, origin_party_version_id,
  origin_party_code, origin_party_name, source_document_id, source_line_id
) VALUES (
  sqlc.arg(id), sqlc.arg(position_type), sqlc.arg(bill_type), sqlc.arg(bill_no),
  sqlc.arg(medium), sqlc.arg(currency), sqlc.arg(face_amount_cents),
  sqlc.arg(issue_date), sqlc.arg(maturity_date), sqlc.arg(drawer),
  sqlc.arg(acceptor), sqlc.arg(payee), sqlc.arg(annual_rate_bps),
  sqlc.arg(interest_days), sqlc.arg(interest_amount_cents),
  sqlc.arg(customer_cost_amount_cents), sqlc.narg(origin_party_entity),
  sqlc.narg(origin_party_object_id), sqlc.narg(origin_party_version_id),
  sqlc.narg(origin_party_code), sqlc.narg(origin_party_name),
  sqlc.arg(source_document_id), sqlc.arg(source_line_id)
)
ON CONFLICT (id) DO UPDATE SET id = excluded.id
WHERE led_bills.position_type = excluded.position_type
  AND led_bills.bill_type = excluded.bill_type
  AND led_bills.bill_no = excluded.bill_no
  AND led_bills.medium = excluded.medium
  AND led_bills.currency = excluded.currency
  AND led_bills.face_amount_cents = excluded.face_amount_cents
  AND led_bills.issue_date = excluded.issue_date
  AND led_bills.maturity_date = excluded.maturity_date
  AND led_bills.drawer = excluded.drawer
  AND led_bills.acceptor = excluded.acceptor
  AND led_bills.payee = excluded.payee
  AND led_bills.annual_rate_bps = excluded.annual_rate_bps
  AND led_bills.interest_days = excluded.interest_days
  AND led_bills.interest_amount_cents = excluded.interest_amount_cents
  AND led_bills.customer_cost_amount_cents = excluded.customer_cost_amount_cents
  AND led_bills.origin_party_entity IS NOT DISTINCT FROM excluded.origin_party_entity
  AND led_bills.origin_party_object_id IS NOT DISTINCT FROM excluded.origin_party_object_id
  AND led_bills.origin_party_version_id IS NOT DISTINCT FROM excluded.origin_party_version_id
  AND led_bills.origin_party_code IS NOT DISTINCT FROM excluded.origin_party_code
  AND led_bills.origin_party_name IS NOT DISTINCT FROM excluded.origin_party_name
  AND led_bills.source_document_id = excluded.source_document_id
  AND led_bills.source_line_id = excluded.source_line_id;

-- name: InsertLedBillEntry :exec
INSERT INTO led_bill_entries (
  id, generation_id, bill_id, source_entity, source_document_id, source_line_id,
  position_type, direction, purpose, effective_date, occurred_at
) VALUES (
  sqlc.arg(id), sqlc.arg(generation_id), sqlc.arg(bill_id),
  sqlc.arg(source_entity), sqlc.arg(source_document_id), sqlc.arg(source_line_id),
  sqlc.arg(position_type), sqlc.arg(direction), sqlc.arg(purpose),
  sqlc.arg(effective_date), sqlc.arg(occurred_at)
);

-- name: DeleteLedBillEntriesBySource :exec
DELETE FROM led_bill_entries
WHERE generation_id = sqlc.arg(generation_id)
  AND source_document_id = sqlc.arg(source_document_id);

-- name: DeleteLedBillsBySource :exec
DELETE FROM led_bills AS bill
WHERE bill.source_document_id = sqlc.arg(source_document_id)
  AND NOT EXISTS (
    SELECT 1
    FROM led_bill_entries AS entry
    WHERE entry.bill_id = bill.id
  );

-- name: ListLedBills :many
WITH bill_positions AS (
  SELECT
    bill.*,
    document.entity AS source_entity,
    document.document_no AS source_document_no,
    COALESCE(sum(CASE entry.direction WHEN 'IN' THEN 1 ELSE -1 END), 0)::bigint AS available_balance
  FROM led_bills AS bill
  JOIN vou_documents AS document ON document.id = bill.source_document_id
  LEFT JOIN led_bill_entries AS entry
    ON entry.bill_id = bill.id
   AND entry.generation_id = sqlc.arg(generation_id)
   AND (
     entry.direction = 'OUT'
     OR entry.effective_date <= sqlc.arg(as_of_date)::date
   )
  GROUP BY bill.id, document.entity, document.document_no
), filtered AS (
  SELECT
    bill_positions.*,
    CASE
      WHEN available_balance = 1 AND maturity_date < sqlc.arg(as_of_date)::date THEN 'MATURED'
      WHEN available_balance = 1 THEN 'AVAILABLE'
      ELSE 'USED'
    END::text AS availability
  FROM bill_positions
  WHERE (sqlc.arg(position_type)::text = '' OR position_type = sqlc.arg(position_type))
    AND (sqlc.arg(bill_type)::text = '' OR bill_type = sqlc.arg(bill_type))
    AND (sqlc.arg(bill_no)::text = '' OR bill_no ILIKE '%' || sqlc.arg(bill_no) || '%')
    AND (
      sqlc.arg(maturity_date_from)::text = ''
      OR maturity_date >= sqlc.arg(maturity_date_from)::date
    )
    AND (
      sqlc.arg(maturity_date_to)::text = ''
      OR maturity_date <= sqlc.arg(maturity_date_to)::date
    )
    AND (
      sqlc.arg(originating_party_entity)::text = ''
      OR origin_party_entity = sqlc.arg(originating_party_entity)
    )
    AND (
      sqlc.arg(originating_party_object_id)::text = ''
      OR origin_party_object_id = sqlc.arg(originating_party_object_id)
    )
    AND (sqlc.arg(source_entity)::text = '' OR source_entity = sqlc.arg(source_entity))
)
SELECT filtered.*, count(*) OVER()::bigint AS total_count
FROM filtered
WHERE sqlc.arg(availability)::text = ''
   OR availability = sqlc.arg(availability)
   OR (sqlc.arg(availability)::text = 'HELD' AND availability IN ('AVAILABLE', 'MATURED'))
ORDER BY
  CASE WHEN sqlc.arg(sort_field)::text = 'maturityDate' AND sqlc.arg(sort_order)::text = 'asc' THEN maturity_date END ASC,
  CASE WHEN sqlc.arg(sort_field)::text = 'maturityDate' AND sqlc.arg(sort_order)::text = 'desc' THEN maturity_date END DESC,
  CASE WHEN sqlc.arg(sort_field)::text = 'billNo' AND sqlc.arg(sort_order)::text = 'asc' THEN bill_no END ASC,
  CASE WHEN sqlc.arg(sort_field)::text = 'billNo' AND sqlc.arg(sort_order)::text = 'desc' THEN bill_no END DESC,
  CASE WHEN sqlc.arg(sort_field)::text = 'faceAmount' AND sqlc.arg(sort_order)::text = 'asc' THEN face_amount_cents END ASC,
  CASE WHEN sqlc.arg(sort_field)::text = 'faceAmount' AND sqlc.arg(sort_order)::text = 'desc' THEN face_amount_cents END DESC,
  CASE WHEN sqlc.arg(sort_field)::text = 'sourceDocumentNo' AND sqlc.arg(sort_order)::text = 'asc' THEN source_document_no END ASC,
  CASE WHEN sqlc.arg(sort_field)::text = 'sourceDocumentNo' AND sqlc.arg(sort_order)::text = 'desc' THEN source_document_no END DESC,
  id
LIMIT sqlc.arg(page_size) OFFSET sqlc.arg(page_offset);

-- name: CountLedBills :one
WITH bill_positions AS (
  SELECT
    bill.*,
    document.entity AS source_entity,
    COALESCE(sum(CASE entry.direction WHEN 'IN' THEN 1 ELSE -1 END), 0)::bigint AS available_balance
  FROM led_bills AS bill
  JOIN vou_documents AS document ON document.id = bill.source_document_id
  LEFT JOIN led_bill_entries AS entry
    ON entry.bill_id = bill.id
   AND entry.generation_id = sqlc.arg(generation_id)
   AND (
     entry.direction = 'OUT'
     OR entry.effective_date <= sqlc.arg(as_of_date)::date
   )
  GROUP BY bill.id, document.entity
), filtered AS (
  SELECT
    bill_positions.*,
    CASE
      WHEN available_balance = 1 AND maturity_date < sqlc.arg(as_of_date)::date THEN 'MATURED'
      WHEN available_balance = 1 THEN 'AVAILABLE'
      ELSE 'USED'
    END::text AS availability
  FROM bill_positions
  WHERE (sqlc.arg(position_type)::text = '' OR position_type = sqlc.arg(position_type))
    AND (sqlc.arg(bill_type)::text = '' OR bill_type = sqlc.arg(bill_type))
    AND (sqlc.arg(bill_no)::text = '' OR bill_no ILIKE '%' || sqlc.arg(bill_no) || '%')
    AND (
      sqlc.arg(maturity_date_from)::text = ''
      OR maturity_date >= sqlc.arg(maturity_date_from)::date
    )
    AND (
      sqlc.arg(maturity_date_to)::text = ''
      OR maturity_date <= sqlc.arg(maturity_date_to)::date
    )
    AND (
      sqlc.arg(originating_party_entity)::text = ''
      OR origin_party_entity = sqlc.arg(originating_party_entity)
    )
    AND (
      sqlc.arg(originating_party_object_id)::text = ''
      OR origin_party_object_id = sqlc.arg(originating_party_object_id)
    )
    AND (sqlc.arg(source_entity)::text = '' OR source_entity = sqlc.arg(source_entity))
)
SELECT count(*)::bigint
FROM filtered
WHERE sqlc.arg(availability)::text = ''
   OR availability = sqlc.arg(availability)
   OR (sqlc.arg(availability)::text = 'HELD' AND availability IN ('AVAILABLE', 'MATURED'));

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
    counterparty_code, counterparty_name, currency, amount_cents
) VALUES (
    sqlc.arg(id), sqlc.arg(counterparty_entity), sqlc.arg(counterparty_object_id),
    sqlc.arg(counterparty_version_id), sqlc.arg(counterparty_code),
    sqlc.arg(counterparty_name), sqlc.arg(currency), sqlc.arg(amount_cents)
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
SELECT * FROM led_draft_party ORDER BY counterparty_entity, counterparty_code, currency, id;

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
ORDER BY counterparty_entity, counterparty_code, currency, id;

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
INSERT INTO led_draft_party
SELECT id, counterparty_entity, counterparty_object_id, counterparty_version_id,
       counterparty_code, counterparty_name, currency, amount_cents
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
    counterparty_code, counterparty_name, currency, amount_cents
)
SELECT id, sqlc.arg(generation_id), counterparty_entity, counterparty_object_id, counterparty_version_id,
       counterparty_code, counterparty_name, currency, amount_cents
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
    counterparty_version_id, counterparty_code, counterparty_name, currency, amount_delta_cents
)
SELECT id, sqlc.arg(generation_id), 'OPENING', 'opening', id, sqlc.arg(cutover_date),
       sqlc.arg(occurred_at), sqlc.arg(actor_id), sqlc.arg(request_id),
       counterparty_entity, counterparty_object_id, counterparty_version_id,
       counterparty_code, counterparty_name, currency, amount_cents
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

-- name: ListFinalizedVouDocumentsForLed :many
SELECT * FROM vou_documents WHERE status = 'FINALIZED' ORDER BY executed_at, id;

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
WHERE generation_id = sqlc.arg(generation_id)
  AND effective_date >= sqlc.arg(date_from) AND effective_date <= sqlc.arg(date_to)
  AND (sqlc.arg(object_id)::text = '' OR counterparty_object_id = sqlc.arg(object_id))
  AND (sqlc.arg(source_entity)::text = '' OR source_entity = sqlc.arg(source_entity))
  AND (sqlc.arg(document_no)::text = '' OR source_document_no ILIKE '%' || sqlc.arg(document_no) || '%')
  AND (COALESCE(cardinality(sqlc.arg(directions)::text[]), 0) = 0
       OR CASE WHEN amount_delta_cents > 0 THEN 'DEBIT' ELSE 'CREDIT' END = ANY(sqlc.arg(directions)::text[]));

-- name: ListLedPartyEntries :many
SELECT * FROM led_party_entries
WHERE generation_id = sqlc.arg(generation_id)
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
    WHERE generation_id = sqlc.arg(generation_id) AND effective_date <= sqlc.arg(as_of_date)
      AND (sqlc.arg(object_id)::text = '' OR counterparty_object_id = sqlc.arg(object_id))
    GROUP BY counterparty_entity, counterparty_object_id, currency
) balances;

-- name: ListLedPartyBalances :many
SELECT counterparty_entity, counterparty_object_id,
       (array_agg(counterparty_version_id ORDER BY effective_date DESC, occurred_at DESC, id DESC))[1]::varchar(26) AS counterparty_version_id,
       max(counterparty_code)::varchar(64) AS counterparty_code,
       (array_agg(counterparty_name ORDER BY effective_date DESC, occurred_at DESC, id DESC))[1]::varchar(200) AS counterparty_name,
       currency, sum(amount_delta_cents)::bigint AS balance_cents
FROM led_party_entries
WHERE generation_id = sqlc.arg(generation_id) AND effective_date <= sqlc.arg(as_of_date)
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

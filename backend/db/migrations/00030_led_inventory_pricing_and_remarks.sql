-- +goose Up
ALTER TABLE led_draft_inventory
    ADD COLUMN currency varchar(3),
    ADD COLUMN unit_price_cents bigint,
    ADD COLUMN amount_cents bigint,
    ADD CONSTRAINT led_draft_inventory_pricing_ck CHECK (
        (currency IS NULL AND unit_price_cents IS NULL AND amount_cents IS NULL)
        OR (
            currency ~ '^[A-Z]{3}$'
            AND unit_price_cents > 0
            AND amount_cents >= 0
        )
    );

ALTER TABLE led_opening_inventory
    ADD COLUMN currency varchar(3),
    ADD COLUMN unit_price_cents bigint,
    ADD COLUMN amount_cents bigint,
    ADD CONSTRAINT led_opening_inventory_pricing_ck CHECK (
        (currency IS NULL AND unit_price_cents IS NULL AND amount_cents IS NULL)
        OR (
            currency ~ '^[A-Z]{3}$'
            AND unit_price_cents > 0
            AND amount_cents >= 0
        )
    );

ALTER TABLE led_inventory_entries
    RENAME COLUMN reason TO remark;

ALTER TABLE led_inventory_entries
    ADD COLUMN currency varchar(3),
    ADD COLUMN unit_price_cents bigint,
    ADD COLUMN amount_cents bigint,
    ADD CONSTRAINT led_inventory_entries_pricing_ck CHECK (
        (currency IS NULL AND unit_price_cents IS NULL AND amount_cents IS NULL)
        OR (
            currency ~ '^[A-Z]{3}$'
            AND unit_price_cents > 0
            AND amount_cents >= 0
        )
    );

ALTER TABLE led_fund_entries RENAME COLUMN reason TO remark;
ALTER TABLE led_party_entries RENAME COLUMN reason TO remark;
ALTER TABLE led_container_entries RENAME COLUMN reason TO remark;

UPDATE led_inventory_entries entry
SET currency = document.currency,
    unit_price_cents = line.unit_price_cents,
    amount_cents = line.line_amount_cents,
    remark = COALESCE(line.remark, document.remark, entry.remark)
FROM vou_documents document,
     vou_sale_outbound_lines line
WHERE entry.source_entity = 'sale-outbound'
  AND entry.source_document_id = document.id
  AND entry.source_line_id = line.id;

UPDATE led_inventory_entries entry
SET currency = document.currency,
    unit_price_cents = line.unit_price_cents,
    amount_cents = line.line_amount_cents,
    remark = COALESCE(line.remark, document.remark, entry.remark)
FROM vou_documents document,
     vou_sale_return_lines line
WHERE entry.source_entity = 'sale-return'
  AND entry.source_document_id = document.id
  AND entry.source_line_id = line.id;

UPDATE led_inventory_entries entry
SET currency = document.currency,
    unit_price_cents = line.unit_price_cents,
    amount_cents = line.line_amount_cents,
    remark = COALESCE(line.remark, document.remark, entry.remark)
FROM vou_documents document,
     vou_purchase_inbound_lines line
WHERE entry.source_entity = 'purchase-inbound'
  AND entry.source_document_id = document.id
  AND entry.source_line_id = line.id;

UPDATE led_inventory_entries entry
SET currency = document.currency,
    unit_price_cents = line.unit_price_cents,
    amount_cents = line.line_amount_cents,
    remark = COALESCE(line.remark, document.remark, entry.remark)
FROM vou_documents document,
     vou_purchase_return_lines line
WHERE entry.source_entity = 'purchase-return'
  AND entry.source_document_id = document.id
  AND entry.source_line_id = line.id;

-- +goose Down
ALTER TABLE led_container_entries RENAME COLUMN remark TO reason;
ALTER TABLE led_party_entries RENAME COLUMN remark TO reason;
ALTER TABLE led_fund_entries RENAME COLUMN remark TO reason;

ALTER TABLE led_inventory_entries
    DROP CONSTRAINT led_inventory_entries_pricing_ck,
    DROP COLUMN amount_cents,
    DROP COLUMN unit_price_cents,
    DROP COLUMN currency;

ALTER TABLE led_inventory_entries RENAME COLUMN remark TO reason;

ALTER TABLE led_opening_inventory
    DROP CONSTRAINT led_opening_inventory_pricing_ck,
    DROP COLUMN amount_cents,
    DROP COLUMN unit_price_cents,
    DROP COLUMN currency;

ALTER TABLE led_draft_inventory
    DROP CONSTRAINT led_draft_inventory_pricing_ck,
    DROP COLUMN amount_cents,
    DROP COLUMN unit_price_cents,
    DROP COLUMN currency;

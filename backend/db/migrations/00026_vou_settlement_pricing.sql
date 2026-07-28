-- +goose Up

ALTER TABLE vou_documents ADD COLUMN due_date date;

UPDATE vou_documents d
SET due_date = CASE
    WHEN snapshot.rule_type = 'RELATIVE_DAYS'
        THEN d.business_date + snapshot.day_offset
    WHEN snapshot.rule_type = 'MONTH_END'
        THEN (
            date_trunc('month', d.business_date)
            + make_interval(months => snapshot.month_offset + 1)
            - interval '1 day'
            + make_interval(days => snapshot.day_offset)
        )::date
    WHEN snapshot.rule_type = 'FIXED_DAY'
        THEN (
            date_trunc('month', d.business_date)
            + make_interval(months => snapshot.month_offset)
            + make_interval(days => LEAST(
                snapshot.day_of_month,
                EXTRACT(day FROM (
                    date_trunc('month', d.business_date)
                    + make_interval(months => snapshot.month_offset + 1)
                    - interval '1 day'
                ))::integer
            ) - 1 + snapshot.day_offset)
        )::date
END
FROM (
    SELECT document_id, settlement_rule_type AS rule_type,
           settlement_month_offset AS month_offset,
           COALESCE(settlement_day_of_month, 1) AS day_of_month,
           settlement_day_offset AS day_offset
    FROM vou_sale_order_details
    UNION ALL
    SELECT document_id, settlement_rule_type,
           settlement_month_offset,
           COALESCE(settlement_day_of_month, 1),
           settlement_day_offset
    FROM vou_purchase_order_details
) snapshot
WHERE snapshot.document_id = d.id;

ALTER TABLE vou_sale_order_details
    ADD COLUMN settlement_due_days integer,
    ADD COLUMN settlement_cutoff_day integer,
    ADD COLUMN settlement_default_sales_surcharge_cents bigint NOT NULL DEFAULT 0;

ALTER TABLE vou_purchase_order_details
    ADD COLUMN settlement_due_days integer,
    ADD COLUMN settlement_cutoff_day integer,
    ADD COLUMN settlement_default_sales_surcharge_cents bigint NOT NULL DEFAULT 0;

UPDATE vou_sale_order_details
SET settlement_due_days = CASE
        WHEN settlement_rule_type = 'RELATIVE_DAYS' THEN settlement_day_offset
    END,
    settlement_cutoff_day = CASE
        WHEN settlement_rule_type = 'FIXED_DAY' THEN settlement_day_of_month
        WHEN settlement_rule_type = 'MONTH_END' THEN 31
    END;

UPDATE vou_purchase_order_details
SET settlement_due_days = CASE
        WHEN settlement_rule_type = 'RELATIVE_DAYS' THEN settlement_day_offset
    END,
    settlement_cutoff_day = CASE
        WHEN settlement_rule_type = 'FIXED_DAY' THEN settlement_day_of_month
        WHEN settlement_rule_type = 'MONTH_END' THEN 31
    END;

ALTER TABLE vou_sale_order_details
    DROP CONSTRAINT vou_sale_order_settlement_ck,
    ADD CONSTRAINT vou_sale_order_settlement_ck CHECK (
        (settlement_method_object_id IS NULL
            AND settlement_method_version_id IS NULL
            AND settlement_method_code IS NULL
            AND settlement_method_name IS NULL
            AND settlement_rule_type IS NULL
            AND settlement_month_offset IS NULL
            AND settlement_day_of_month IS NULL
            AND settlement_day_offset IS NULL
            AND settlement_description IS NULL)
        OR (
            settlement_method_object_id IS NOT NULL
            AND settlement_method_version_id IS NOT NULL
            AND settlement_method_code IS NOT NULL
            AND settlement_method_name IS NOT NULL
            AND settlement_rule_type IN ('DUE_DAYS', 'RELATIVE_DAYS', 'MONTH_END', 'FIXED_DAY')
            AND settlement_month_offset BETWEEN 0 AND 120
            AND settlement_day_offset BETWEEN -3650 AND 3650
            AND (
                (settlement_rule_type = 'DUE_DAYS'
                    AND settlement_month_offset = 0 AND settlement_day_of_month IS NULL
                    AND settlement_due_days BETWEEN 0 AND 3650)
                OR (settlement_rule_type = 'RELATIVE_DAYS'
                    AND settlement_month_offset = 0 AND settlement_day_of_month IS NULL)
                OR (settlement_rule_type = 'MONTH_END' AND settlement_day_of_month IS NULL
                    AND settlement_cutoff_day BETWEEN 1 AND 31)
                OR (settlement_rule_type = 'FIXED_DAY' AND settlement_day_of_month BETWEEN 1 AND 31)
            )
        )
    );

ALTER TABLE vou_purchase_order_details
    DROP CONSTRAINT vou_purchase_order_settlement_ck,
    ADD CONSTRAINT vou_purchase_order_settlement_ck CHECK (
        (settlement_method_object_id IS NULL
            AND settlement_method_version_id IS NULL
            AND settlement_method_code IS NULL
            AND settlement_method_name IS NULL
            AND settlement_rule_type IS NULL
            AND settlement_month_offset IS NULL
            AND settlement_day_of_month IS NULL
            AND settlement_day_offset IS NULL
            AND settlement_description IS NULL)
        OR (
            settlement_method_object_id IS NOT NULL
            AND settlement_method_version_id IS NOT NULL
            AND settlement_method_code IS NOT NULL
            AND settlement_method_name IS NOT NULL
            AND settlement_rule_type IN ('DUE_DAYS', 'RELATIVE_DAYS', 'MONTH_END', 'FIXED_DAY')
            AND settlement_month_offset BETWEEN 0 AND 120
            AND settlement_day_offset BETWEEN -3650 AND 3650
            AND (
                (settlement_rule_type = 'DUE_DAYS'
                    AND settlement_month_offset = 0 AND settlement_day_of_month IS NULL
                    AND settlement_due_days BETWEEN 0 AND 3650)
                OR (settlement_rule_type = 'RELATIVE_DAYS'
                    AND settlement_month_offset = 0 AND settlement_day_of_month IS NULL)
                OR (settlement_rule_type = 'MONTH_END' AND settlement_day_of_month IS NULL
                    AND settlement_cutoff_day BETWEEN 1 AND 31)
                OR (settlement_rule_type = 'FIXED_DAY' AND settlement_day_of_month BETWEEN 1 AND 31)
            )
        )
    );

ALTER TABLE vou_product_lines
    ADD COLUMN base_unit_price_cents bigint,
    ADD COLUMN settlement_surcharge_cents bigint,
    ADD COLUMN product_kind varchar(32) NOT NULL DEFAULT 'RAW_MATERIAL',
    ADD COLUMN pricing_quantity_per_inventory_unit_micros bigint NOT NULL DEFAULT 1000000;

UPDATE vou_product_lines
SET base_unit_price_cents = unit_price_cents,
    settlement_surcharge_cents = 0;

ALTER TABLE vou_product_lines
    ALTER COLUMN base_unit_price_cents SET NOT NULL,
    ALTER COLUMN settlement_surcharge_cents SET NOT NULL,
    ADD CONSTRAINT vou_product_lines_base_price_ck CHECK (base_unit_price_cents > 0),
    ADD CONSTRAINT vou_product_lines_surcharge_ck CHECK (settlement_surcharge_cents >= 0),
    ADD CONSTRAINT vou_product_lines_effective_price_ck
        CHECK (unit_price_cents = base_unit_price_cents + settlement_surcharge_cents);

-- +goose Down

UPDATE vou_sale_order_details
SET settlement_rule_type = 'RELATIVE_DAYS'
WHERE settlement_rule_type = 'DUE_DAYS';
UPDATE vou_purchase_order_details
SET settlement_rule_type = 'RELATIVE_DAYS'
WHERE settlement_rule_type = 'DUE_DAYS';

ALTER TABLE vou_sale_order_details
    DROP CONSTRAINT vou_sale_order_settlement_ck,
    ADD CONSTRAINT vou_sale_order_settlement_ck CHECK (
        (settlement_method_object_id IS NULL
            AND settlement_method_version_id IS NULL
            AND settlement_method_code IS NULL
            AND settlement_method_name IS NULL
            AND settlement_rule_type IS NULL
            AND settlement_month_offset IS NULL
            AND settlement_day_of_month IS NULL
            AND settlement_day_offset IS NULL
            AND settlement_description IS NULL)
        OR (
            settlement_method_object_id IS NOT NULL
            AND settlement_method_version_id IS NOT NULL
            AND settlement_method_code IS NOT NULL
            AND settlement_method_name IS NOT NULL
            AND settlement_rule_type IN ('RELATIVE_DAYS', 'MONTH_END', 'FIXED_DAY')
            AND settlement_month_offset BETWEEN 0 AND 120
            AND settlement_day_offset BETWEEN -3650 AND 3650
            AND (
                (settlement_rule_type = 'RELATIVE_DAYS'
                    AND settlement_month_offset = 0 AND settlement_day_of_month IS NULL)
                OR (settlement_rule_type = 'MONTH_END' AND settlement_day_of_month IS NULL)
                OR (settlement_rule_type = 'FIXED_DAY' AND settlement_day_of_month BETWEEN 1 AND 31)
            )
        )
    );

ALTER TABLE vou_purchase_order_details
    DROP CONSTRAINT vou_purchase_order_settlement_ck,
    ADD CONSTRAINT vou_purchase_order_settlement_ck CHECK (
        (settlement_method_object_id IS NULL
            AND settlement_method_version_id IS NULL
            AND settlement_method_code IS NULL
            AND settlement_method_name IS NULL
            AND settlement_rule_type IS NULL
            AND settlement_month_offset IS NULL
            AND settlement_day_of_month IS NULL
            AND settlement_day_offset IS NULL
            AND settlement_description IS NULL)
        OR (
            settlement_method_object_id IS NOT NULL
            AND settlement_method_version_id IS NOT NULL
            AND settlement_method_code IS NOT NULL
            AND settlement_method_name IS NOT NULL
            AND settlement_rule_type IN ('RELATIVE_DAYS', 'MONTH_END', 'FIXED_DAY')
            AND settlement_month_offset BETWEEN 0 AND 120
            AND settlement_day_offset BETWEEN -3650 AND 3650
            AND (
                (settlement_rule_type = 'RELATIVE_DAYS'
                    AND settlement_month_offset = 0 AND settlement_day_of_month IS NULL)
                OR (settlement_rule_type = 'MONTH_END' AND settlement_day_of_month IS NULL)
                OR (settlement_rule_type = 'FIXED_DAY' AND settlement_day_of_month BETWEEN 1 AND 31)
            )
        )
    );

ALTER TABLE vou_product_lines
    DROP CONSTRAINT vou_product_lines_effective_price_ck,
    DROP CONSTRAINT vou_product_lines_surcharge_ck,
    DROP CONSTRAINT vou_product_lines_base_price_ck,
    DROP COLUMN settlement_surcharge_cents,
    DROP COLUMN base_unit_price_cents,
    DROP COLUMN IF EXISTS pricing_quantity_per_inventory_unit_micros,
    DROP COLUMN IF EXISTS product_kind;

ALTER TABLE vou_purchase_order_details
    DROP COLUMN settlement_default_sales_surcharge_cents,
    DROP COLUMN settlement_cutoff_day,
    DROP COLUMN settlement_due_days;

ALTER TABLE vou_sale_order_details
    DROP COLUMN settlement_default_sales_surcharge_cents,
    DROP COLUMN settlement_cutoff_day,
    DROP COLUMN settlement_due_days;

ALTER TABLE vou_documents
    DROP COLUMN due_date;

-- +goose Up

ALTER TABLE vou_sale_order_details
    ADD COLUMN warehouse_object_id varchar(26),
    ADD COLUMN warehouse_version_id varchar(26),
    ADD COLUMN warehouse_code varchar(64),
    ADD COLUMN warehouse_name varchar(200);

ALTER TABLE vou_sale_order_details
    ADD CONSTRAINT vou_sale_order_warehouse_ck CHECK (
        (warehouse_object_id IS NULL AND warehouse_version_id IS NULL
            AND warehouse_code IS NULL AND warehouse_name IS NULL)
        OR (warehouse_object_id IS NOT NULL AND warehouse_version_id IS NOT NULL
            AND warehouse_code IS NOT NULL AND warehouse_name IS NOT NULL)
    );

WITH unique_orders AS (
    SELECT source_order_id
    FROM vou_sale_outbound_details
    GROUP BY source_order_id
    HAVING count(DISTINCT warehouse_object_id) = 1
), unique_warehouse AS (
    SELECT DISTINCT ON (detail.source_order_id)
           detail.source_order_id,
           detail.warehouse_object_id,
           detail.warehouse_version_id,
           detail.warehouse_code,
           detail.warehouse_name
    FROM vou_sale_outbound_details detail
    JOIN unique_orders eligible USING (source_order_id)
    JOIN vou_documents document ON document.id = detail.document_id
    ORDER BY detail.source_order_id, document.updated_at DESC, detail.document_id DESC
)
UPDATE vou_sale_order_details order_detail
SET warehouse_object_id = source.warehouse_object_id,
    warehouse_version_id = source.warehouse_version_id,
    warehouse_code = source.warehouse_code,
    warehouse_name = source.warehouse_name
FROM unique_warehouse source
WHERE source.source_order_id = order_detail.document_id;

-- +goose Down

ALTER TABLE vou_sale_order_details
    DROP CONSTRAINT vou_sale_order_warehouse_ck,
    DROP COLUMN warehouse_name,
    DROP COLUMN warehouse_code,
    DROP COLUMN warehouse_version_id,
    DROP COLUMN warehouse_object_id;

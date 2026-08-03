DO $$
BEGIN
    IF to_regclass('vou_inventory_count_details') IS NULL OR
       to_regclass('vou_inventory_count_lines') IS NULL THEN
        RAISE EXCEPTION 'migration 00042 did not create inventory count tables';
    END IF;
    IF (SELECT count(*) FROM app_permissions
        WHERE domain='vou' AND entity='inventory-count') <> 16 THEN
        RAISE EXCEPTION 'migration 00042 did not create inventory count permissions';
    END IF;
END
$$;

BEGIN;
INSERT INTO vou_documents(
    id,entity,document_no,business_date,currency,total_amount_cents,created_by,updated_by
) VALUES (
    '01J00000000000000000000420','inventory-count','IVC-20260804-9001',
    '2026-08-04','CNY',0,'01JAPPSYST3MACTR0000000000','01JAPPSYST3MACTR0000000000'
);
INSERT INTO vou_inventory_count_details(
    document_id,warehouse_object_id,warehouse_version_id,warehouse_code,warehouse_name
) VALUES (
    '01J00000000000000000000420','01J0000000000000000000420A',
    '01J0000000000000000000420B','WH-9001','迁移测试仓库'
);
INSERT INTO vou_inventory_count_lines(
    id,document_id,line_no,product_object_id,product_version_id,product_code,
    product_name,product_unit,actual_quantity_micros
) VALUES (
    '01J0000000000000000000420C','01J00000000000000000000420',1,
    '01J0000000000000000000420D','01J0000000000000000000420E',
    'PRD-9001','迁移测试商品','KG',0
);
ROLLBACK;

BEGIN;

INSERT INTO led_generations(id,cutover_date,status,activated_by,request_id)
VALUES('01JACC72LEDGEN000000000001','2026-01-01','ACTIVE','01JAPPSYST3MACTR0000000000','migration-72');
UPDATE led_control
SET status='ACTIVE',cutover_date='2026-01-01',active_generation_id='01JACC72LEDGEN000000000001',
    updated_by='01JAPPSYST3MACTR0000000000'
WHERE singleton;
INSERT INTO led_draft_inventory(
    id,warehouse_object_id,warehouse_version_id,warehouse_code,warehouse_name,
    product_object_id,product_version_id,product_code,product_name,product_unit,quantity_micros
) VALUES (
    '01JACC72LEDDRAFT0000000001','01JACC72WAREHOUSE000000001','01JACC72WAREHOUSEVER000001',
    'OLD-WH','Legacy warehouse','01JACC72PRODUCT0000000001','01JACC72PRODUCTVER0000001',
    'OLD-PRODUCT','Legacy product','kg',1000000
);

INSERT INTO vou_documents(
    id,entity,document_no,status,business_date,currency,total_amount_cents,
    created_by,updated_by
) VALUES (
    '01JACC72DEPRECIATION000001','asset-depreciation','DEP-20260131-0001','DRAFT',
    '2026-01-31','CNY',100,'01JAPPSYST3MACTR0000000000','01JAPPSYST3MACTR0000000000'
);
INSERT INTO vou_asset_depreciation_details(document_id,depreciation_month)
VALUES('01JACC72DEPRECIATION000001','2026-01-01');
INSERT INTO vou_asset_depreciation_lines(
    id,document_id,line_no,depreciation_month,asset_id,asset_no,asset_name,
    amount_cents,opening_accumulated_cents,closing_accumulated_cents
) VALUES (
    '01JACC72DEPLINE00000000001','01JACC72DEPRECIATION000001',1,'2026-01-01',
    '01JACC72ASSET000000000001','OLD-ASSET','Legacy asset',100,0,100
);
SET CONSTRAINTS ALL IMMEDIATE;
COMMIT;

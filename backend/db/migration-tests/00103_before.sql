BEGIN;
SET CONSTRAINTS ALL DEFERRED;

-- Workflow-created sale-delivery drafts may legitimately predate transport
-- selection. Preserve that all-null draft branch during the direct cutover.
INSERT INTO vou_documents(
    id,entity,document_no,status,business_date,currency,total_amount_cents,created_by,updated_by
) VALUES
    ('01J0000000000000000000300','sale-order','SOR-20260824-0103','DRAFT','2026-08-24','CNY',100,'migration-fixture','migration-fixture'),
    ('01J0000000000000000000301','sale-outbound','SOB-20260824-0103','DRAFT','2026-08-24','CNY',100,'migration-fixture','migration-fixture'),
    ('01J0000000000000000000302','sale-delivery','SDL-20260824-0103','DRAFT','2026-08-24','CNY',100,'migration-fixture','migration-fixture');

INSERT INTO vou_sale_order_details(
    document_id,customer_object_id,customer_version_id,customer_code,customer_name,
    sales_attribution_type,sales_attribution_subject_object_id,sales_attribution_subject_version_id,
    sales_attribution_subject_code,sales_attribution_subject_name
) VALUES (
    '01J0000000000000000000300','01J0000000000000000000310','01J0000000000000000000311',
    'CUS-00103','Fixture customer','INTERNAL_EMPLOYEE','01J0000000000000000000312',
    '01J0000000000000000000313','EMP-00103','Fixture employee'
);

INSERT INTO vou_sale_outbound_details(
    document_id,source_order_id,customer_object_id,customer_version_id,customer_code,customer_name
) VALUES (
    '01J0000000000000000000301','01J0000000000000000000300',
    '01J0000000000000000000310','01J0000000000000000000311','CUS-00103','Fixture customer'
);

INSERT INTO vou_sale_delivery_details(
    document_id,source_outbound_id,customer_object_id,customer_version_id,customer_code,customer_name
) VALUES (
    '01J0000000000000000000302','01J0000000000000000000301',
    '01J0000000000000000000310','01J0000000000000000000311','CUS-00103','Fixture customer'
);

SET CONSTRAINTS ALL IMMEDIATE;
COMMIT;

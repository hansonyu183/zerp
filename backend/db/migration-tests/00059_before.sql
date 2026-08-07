DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM app_permissions
        WHERE domain='led' AND entity IN ('employee','other-payable')
    ) THEN
        RAISE EXCEPTION 'legacy ledger permissions are missing';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema='public' AND table_name='led_party_entries'
          AND column_name='payable_category'
    ) OR to_regclass('public.led_closing_other_payable') IS NULL THEN
        RAISE EXCEPTION 'legacy other payable schema is missing';
    END IF;
END $$;

INSERT INTO app_role_permissions(role_id,permission_id,created_by)
SELECT role.id,permission.id,'01JAPPSYST3MACTR0000000000'
FROM (SELECT id FROM app_roles ORDER BY id LIMIT 1) role
JOIN app_permissions permission
  ON permission.domain='led' AND permission.entity='employee'
 AND permission.action IN ('query','balance')
ON CONFLICT DO NOTHING;

INSERT INTO led_draft_party(
    id,counterparty_entity,counterparty_object_id,counterparty_version_id,
    counterparty_code,counterparty_name,currency,amount_cents
) VALUES (
    '00000000000000000000005902','other-party',
    '00000000000000000000005903','00000000000000000000005904',
    'OTH-5902','Draft other party','CNY',300
);

BEGIN;
SET CONSTRAINTS ALL DEFERRED;
INSERT INTO vou_documents(
    id,entity,document_no,status,revision,business_date,currency,total_amount_cents,
    parent_entity,parent_document_id,created_by,updated_by
) VALUES (
    '00000000000000000000005901','customer-receipt','REC-20590101-0001',
    'DRAFT',1,'2059-01-01','CNY',100,
    NULL,NULL,
    '01JAPPSYST3MACTR0000000000','01JAPPSYST3MACTR0000000000'
), (
    '00000000000000000000005908','asset-acquisition','AST-20590101-0001',
    'DRAFT',1,'2059-01-01','CNY',100,
    'customer-receipt','00000000000000000000005901',
    '01JAPPSYST3MACTR0000000000','01JAPPSYST3MACTR0000000000'
), (
    '00000000000000000000005934','asset-sale','ASL-20590101-0001',
    'DRAFT',1,'2059-01-01','CNY',100,
    NULL,NULL,
    '01JAPPSYST3MACTR0000000000','01JAPPSYST3MACTR0000000000'
), (
    '00000000000000000000005950','asset-sale','ASL-20590101-0002',
    'DRAFT',1,'2059-01-01','CNY',100,
    NULL,NULL,
    '01JAPPSYST3MACTR0000000000','01JAPPSYST3MACTR0000000000'
), (
    '00000000000000000000005953','asset-acquisition','AST-20590101-0002',
    'DRAFT',1,'2059-01-01','CNY',100,
    NULL,NULL,
    '01JAPPSYST3MACTR0000000000','01JAPPSYST3MACTR0000000000'
);
INSERT INTO vou_receipt_details(
    document_id,entity,counterparty_entity,counterparty_object_id,
    counterparty_version_id,counterparty_code,counterparty_name,
    fund_account_object_id,fund_account_version_id,fund_account_code,
    fund_account_name
) VALUES (
    '00000000000000000000005901','customer-receipt','customer',
    '00000000000000000000005911','00000000000000000000005912',
    'CUS-5901','Migration customer','00000000000000000000005913',
    '00000000000000000000005914','FUND-5901','Migration fund'
);
INSERT INTO vou_asset_acquisition_details(
    document_id,entity,supplier_object_id,supplier_version_id,
    supplier_code,supplier_name
) VALUES (
    '00000000000000000000005908','asset-acquisition',
    '00000000000000000000005915','00000000000000000000005916',
    'SUP-5901','Migration supplier'
), (
    '00000000000000000000005953','asset-acquisition',
    '00000000000000000000005954','00000000000000000000005955',
    'SUP-5902','Draft asset supplier'
);
INSERT INTO vou_asset_sale_details(
    document_id,entity,counterparty_entity,counterparty_object_id,
    counterparty_version_id,counterparty_code,counterparty_name
) VALUES (
    '00000000000000000000005934','asset-sale','other-party',
    '00000000000000000000005935','00000000000000000000005936',
    'OTH-5904','Migration asset buyer'
), (
    '00000000000000000000005950','asset-sale','customer',
    '00000000000000000000005951','00000000000000000000005952',
    'CUS-5902','Draft asset buyer'
);
UPDATE vou_documents SET
    status='APPROVED',
    reviewed_at='2059-01-01 09:00:00+00',
    reviewed_by='01JAPPSYST3MACTR0000000000',
    approved_at='2059-01-01 10:00:00+00',
    approved_by='01JAPPSYST3MACTR0000000000',
    posted_at='2059-01-01 10:00:00+00',
    posted_by='01JAPPSYST3MACTR0000000000'
WHERE id IN ('00000000000000000000005908','00000000000000000000005934');
SET CONSTRAINTS ALL IMMEDIATE;
COMMIT;

INSERT INTO led_generations(
    id,cutover_date,status,activated_by,request_id
) VALUES (
    '00000000000000000000005920','2059-01-01','ACTIVE',
    '01JAPPSYST3MACTR0000000000','migration-00059-generation'
);
UPDATE led_control SET
    status='ACTIVE',cutover_date='2059-01-01',
    active_generation_id='00000000000000000000005920',
    rebuild_required=false
WHERE singleton=true;

INSERT INTO led_opening_party(
    id,generation_id,counterparty_entity,counterparty_object_id,
    counterparty_version_id,counterparty_code,counterparty_name,currency,
    amount_cents
) VALUES (
    '00000000000000000000005905','00000000000000000000005920',
    'other-party','00000000000000000000005906',
    '00000000000000000000005907','OTH-5903','Opening other party','CNY',400
);

INSERT INTO led_party_entries(
    id,generation_id,entry_type,source_entity,source_document_id,
    source_document_no,source_revision,effective_date,occurred_at,actor_id,
    request_id,counterparty_entity,counterparty_object_id,
    counterparty_version_id,counterparty_code,counterparty_name,currency,
    amount_delta_cents,account_type,payable_category
) VALUES (
    '00000000000000000000005921','00000000000000000000005920',
    'POSTING','intermediary-calculation','00000000000000000000005922',
    'ICL-20590131-0001',1,'2059-01-31','2059-01-31 12:00:00+00',
    '01JAPPSYST3MACTR0000000000','migration-00059-entry','employee',
    '00000000000000000000005923','00000000000000000000005924',
    'EMP-5901','Migration employee','CNY',-100,'OTHER_PAYABLE','COMMISSION'
), (
    '00000000000000000000005925','00000000000000000000005920',
    'POSTING','other-receipt','00000000000000000000005926',
    'REC-20590115-0001',1,'2059-01-15','2059-01-15 12:00:00+00',
    '01JAPPSYST3MACTR0000000000','migration-00059-other-entry','other-party',
    '00000000000000000000005927','00000000000000000000005928',
    'OTH-5901','Migration other party','CNY',-200,'TRADE',NULL
), (
    '00000000000000000000005931','00000000000000000000005920',
    'POSTING','asset-acquisition','00000000000000000000005908',
    'AST-20590101-0001',1,'2059-01-01','2059-01-01 12:00:00+00',
    '01JAPPSYST3MACTR0000000000','migration-00059-asset-entry','supplier',
    '00000000000000000000005915','00000000000000000000005916',
    'SUP-5901','Migration supplier','CNY',-100,'TRADE',NULL
), (
    '00000000000000000000005932','00000000000000000000005920',
    'POSTING','supplier-payment','00000000000000000000005933',
    'PAY-20590101-0001',1,'2059-01-01','2059-01-01 13:00:00+00',
    '01JAPPSYST3MACTR0000000000','migration-00059-payment-entry','supplier',
    '00000000000000000000005915','00000000000000000000005916',
    'SUP-5901','Migration supplier','CNY',100,'TRADE',NULL
), (
    '00000000000000000000005937','00000000000000000000005920',
    'POSTING','asset-sale','00000000000000000000005934',
    'ASL-20590101-0001',1,'2059-01-01','2059-01-01 14:00:00+00',
    '01JAPPSYST3MACTR0000000000','migration-00059-asset-sale-entry','other-party',
    '00000000000000000000005935','00000000000000000000005936',
    'OTH-5904','Migration asset buyer','CNY',100,'TRADE',NULL
);

INSERT INTO led_closings(
    id,closing_date,opening_date,status,revision,closed_by,request_id
) VALUES (
    '00000000000000000000005930','2059-01-31','2059-02-01','ACTIVE',1,
    '01JAPPSYST3MACTR0000000000','migration-00059-closing'
);
INSERT INTO led_closing_other_payable(
    closing_id,payable_category,counterparty_entity,counterparty_object_id,
    counterparty_version_id,counterparty_code,counterparty_name,currency,
    amount_cents
) VALUES
    ('00000000000000000000005930','COMMISSION','employee',
     '00000000000000000000005923','00000000000000000000005924',
     'EMP-5901','Migration employee','CNY',-100),
    ('00000000000000000000005930','INTERMEDIARY','employee',
     '00000000000000000000005923','00000000000000000000005924',
     'EMP-5901','Migration employee','CNY',-50);

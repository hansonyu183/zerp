BEGIN;
INSERT INTO vou_documents(id,entity,document_no,business_date,currency,total_amount_cents,created_by,updated_by)
VALUES
('01J00000000000000000000411','receipt','REC-20260803-9001','2026-08-03','CNY',10000,'01JAPPSYST3MACTR0000000000','01JAPPSYST3MACTR0000000000'),
('01J00000000000000000000412','payment','PAY-20260803-9001','2026-08-03','CNY',5000,'01JAPPSYST3MACTR0000000000','01JAPPSYST3MACTR0000000000');
INSERT INTO vou_receipt_details(document_id,counterparty_entity,counterparty_object_id,counterparty_version_id,counterparty_code,counterparty_name,fund_account_object_id,fund_account_version_id,fund_account_code,fund_account_name)
VALUES('01J00000000000000000000411','customer','01J0000000000000000000411A','01J0000000000000000000411B','CUS-9001','迁移客户','01J0000000000000000000411C','01J0000000000000000000411D','FAC-9001','迁移账户');
INSERT INTO vou_payment_details(document_id,counterparty_entity,counterparty_object_id,counterparty_version_id,counterparty_code,counterparty_name,fund_account_object_id,fund_account_version_id,fund_account_code,fund_account_name)
VALUES('01J00000000000000000000412','supplier','01J0000000000000000000412A','01J0000000000000000000412B','SUP-9001','迁移供应商','01J0000000000000000000412C','01J0000000000000000000412D','FAC-9001','迁移账户');
COMMIT;

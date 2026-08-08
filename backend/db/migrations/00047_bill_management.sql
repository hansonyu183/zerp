-- +goose Up
ALTER TABLE vou_documents DROP CONSTRAINT vou_documents_entity_check;
ALTER TABLE vou_documents ADD CONSTRAINT vou_documents_entity_check CHECK (entity IN (
 'sale-pricing','sale-order','sale-outbound','sale-delivery','sale-signoff','sale-return',
 'purchase-inquiry','purchase-order','purchase-inbound','purchase-return','order-production','self-production','inventory-count',
 'receipt','payment','customer-receipt','supplier-receipt','other-receipt','customer-payment','supplier-payment','other-payment',
 'employee-loan','employee-repayment','employee-loan-writeoff','expense-reimbursement','expense-payment','other-income',
 'asset-acquisition','asset-depreciation','asset-sale','asset-liquidation',
 'bill-receipt','bill-payment','bill-issue','bill-discount','bill-maturity',
 'customer-order','procurement-order','goods-receipt','delivery-note','signoff-note'
));

CREATE TABLE vou_bill_details (
 document_id varchar(26) PRIMARY KEY,
 entity varchar(32) NOT NULL CHECK(entity IN ('bill-receipt','bill-payment','bill-issue','bill-discount','bill-maturity')),
 counterparty_entity varchar(16) CHECK(counterparty_entity IN ('customer','supplier','other-party')),
 counterparty_object_id varchar(26),
 counterparty_version_id varchar(26),
 counterparty_code varchar(64),
 counterparty_name varchar(200),
 handler_object_id varchar(26),
 handler_version_id varchar(26),
 handler_code varchar(64),
 handler_name varchar(200),
 internal_cost_rate_bps integer NOT NULL CHECK(internal_cost_rate_bps BETWEEN 0 AND 100000),
 maturity_type varchar(32) NOT NULL DEFAULT 'NONE' CHECK(maturity_type IN ('NONE','RECEIPT','PAYMENT')),
 interest_mode varchar(32) NOT NULL DEFAULT 'NONE' CHECK(interest_mode IN ('NONE','BANK_DEDUCTED','THIRD_PARTY_PAYABLE')),
 interest_party_entity varchar(16) CHECK(interest_party_entity = 'other-party'),
 interest_party_object_id varchar(26),
 interest_party_version_id varchar(26),
 interest_party_code varchar(64),
 interest_party_name varchar(200),
 with_recourse boolean NOT NULL DEFAULT false,
 FOREIGN KEY(document_id,entity) REFERENCES vou_documents(id,entity) ON DELETE RESTRICT,
 CHECK (
   (counterparty_entity IS NULL AND counterparty_object_id IS NULL AND counterparty_version_id IS NULL AND counterparty_code IS NULL AND counterparty_name IS NULL)
   OR
   (counterparty_entity IS NOT NULL AND counterparty_object_id IS NOT NULL AND counterparty_version_id IS NOT NULL AND counterparty_code IS NOT NULL AND counterparty_name IS NOT NULL)
 ),
 CHECK (
   (handler_object_id IS NULL AND handler_version_id IS NULL AND handler_code IS NULL AND handler_name IS NULL)
   OR
   (handler_object_id IS NOT NULL AND handler_version_id IS NOT NULL AND handler_code IS NOT NULL AND handler_name IS NOT NULL)
 ),
 CHECK (
   (interest_party_entity IS NULL AND interest_party_object_id IS NULL AND interest_party_version_id IS NULL AND interest_party_code IS NULL AND interest_party_name IS NULL)
   OR
   (interest_party_entity = 'other-party' AND interest_party_object_id IS NOT NULL AND interest_party_version_id IS NOT NULL AND interest_party_code IS NOT NULL AND interest_party_name IS NOT NULL)
 ),
 CHECK (
   (interest_mode = 'THIRD_PARTY_PAYABLE' AND interest_party_entity = 'other-party')
   OR
   (interest_mode <> 'THIRD_PARTY_PAYABLE' AND interest_party_entity IS NULL)
 ),
 CHECK (
   entity <> 'bill-receipt'
   OR (
     counterparty_entity = 'customer'
     AND handler_object_id IS NOT NULL
     AND maturity_type = 'NONE'
     AND interest_mode = 'NONE'
     AND interest_party_entity IS NULL
     AND with_recourse = false
   )
 )
);
CREATE TABLE vou_bill_lines (
 id varchar(26) PRIMARY KEY, document_id varchar(26) NOT NULL REFERENCES vou_bill_details(document_id) ON DELETE RESTRICT,
 line_no integer NOT NULL CHECK(line_no BETWEEN 1 AND 20), bill_id varchar(26) NOT NULL, position_type varchar(16) NOT NULL CHECK(position_type IN ('ASSET','LIABILITY')), direction varchar(16) NOT NULL CHECK(direction IN ('IN','OUT')), purpose varchar(16) NOT NULL CHECK(purpose IN ('PRIMARY','CHANGE')),
 bill_type varchar(32) NOT NULL CHECK(bill_type IN ('BANK_ACCEPTANCE','COMMERCIAL_ACCEPTANCE','CHECK','OTHER')), bill_no varchar(200) NOT NULL CHECK(bill_no<>''), medium varchar(16) NOT NULL CHECK(medium IN ('PAPER','ELECTRONIC')), currency varchar(3) NOT NULL CHECK(currency ~ '^[A-Z]{3}$'), face_amount_cents bigint NOT NULL CHECK(face_amount_cents>0), issue_date date NOT NULL, maturity_date date NOT NULL, drawer varchar(200) NOT NULL CHECK(drawer<>''), acceptor varchar(200) NOT NULL CHECK(acceptor<>''), payee varchar(200) NOT NULL CHECK(payee<>''),
 annual_rate_bps integer NOT NULL CHECK(annual_rate_bps BETWEEN 0 AND 100000), interest_days integer NOT NULL CHECK(interest_days>=0), interest_amount_cents bigint NOT NULL CHECK(interest_amount_cents>=0), customer_cost_amount_cents bigint NOT NULL CHECK(customer_cost_amount_cents>=0), remark varchar(1000), UNIQUE(document_id,line_no), UNIQUE(document_id,id), CHECK(issue_date<=maturity_date)
);
CREATE TABLE vou_bill_cash_lines (
 id varchar(26) PRIMARY KEY, document_id varchar(26) NOT NULL REFERENCES vou_bill_details(document_id) ON DELETE RESTRICT,
 line_no integer NOT NULL CHECK(line_no BETWEEN 1 AND 20), bill_line_id varchar(26), fund_account_object_id varchar(26) NOT NULL, fund_account_version_id varchar(26) NOT NULL, fund_account_code varchar(64) NOT NULL, fund_account_name varchar(200) NOT NULL,
 direction varchar(3) NOT NULL CHECK(direction IN ('IN','OUT')), amount_type varchar(16) NOT NULL CHECK(amount_type IN ('PRINCIPAL','INTEREST','FEE','MARGIN','OTHER')), amount_cents bigint NOT NULL CHECK(amount_cents>0), remark varchar(1000), UNIQUE(document_id,line_no), FOREIGN KEY(document_id,bill_line_id) REFERENCES vou_bill_lines(document_id,id)
);
CREATE TABLE led_bills (
 id varchar(26) PRIMARY KEY, position_type varchar(16) NOT NULL CHECK(position_type IN ('ASSET','LIABILITY')), bill_type varchar(32) NOT NULL CHECK(bill_type IN ('BANK_ACCEPTANCE','COMMERCIAL_ACCEPTANCE','CHECK','OTHER')), bill_no varchar(200) NOT NULL CHECK(bill_no<>''), medium varchar(16) NOT NULL CHECK(medium IN ('PAPER','ELECTRONIC')), currency varchar(3) NOT NULL CHECK(currency ~ '^[A-Z]{3}$'), face_amount_cents bigint NOT NULL CHECK(face_amount_cents>0), issue_date date NOT NULL, maturity_date date NOT NULL CHECK(issue_date<=maturity_date), drawer varchar(200) NOT NULL CHECK(drawer<>''), acceptor varchar(200) NOT NULL CHECK(acceptor<>''), payee varchar(200) NOT NULL CHECK(payee<>''), annual_rate_bps integer NOT NULL CHECK(annual_rate_bps BETWEEN 0 AND 100000), interest_days integer NOT NULL CHECK(interest_days>=0), interest_amount_cents bigint NOT NULL CHECK(interest_amount_cents>=0), customer_cost_amount_cents bigint NOT NULL CHECK(customer_cost_amount_cents>=0),
 origin_party_entity varchar(16) CHECK(origin_party_entity IN ('customer','supplier','other-party')), origin_party_object_id varchar(26), origin_party_version_id varchar(26), origin_party_code varchar(64), origin_party_name varchar(200), source_document_id varchar(26) NOT NULL REFERENCES vou_documents(id) ON DELETE RESTRICT, source_line_id varchar(26) NOT NULL UNIQUE, created_at timestamptz NOT NULL DEFAULT now(), CONSTRAINT led_bills_business_key UNIQUE(bill_type,bill_no,acceptor,face_amount_cents,maturity_date), CHECK((origin_party_entity IS NULL AND origin_party_object_id IS NULL AND origin_party_version_id IS NULL AND origin_party_code IS NULL AND origin_party_name IS NULL) OR (origin_party_entity IS NOT NULL AND origin_party_object_id IS NOT NULL AND origin_party_version_id IS NOT NULL AND origin_party_code IS NOT NULL AND origin_party_name IS NOT NULL))
);
CREATE TABLE led_bill_entries (
 id varchar(26) PRIMARY KEY, generation_id varchar(26) NOT NULL REFERENCES led_generations(id) ON DELETE RESTRICT, bill_id varchar(26) NOT NULL REFERENCES led_bills(id) ON DELETE RESTRICT, source_entity varchar(32) NOT NULL, source_document_id varchar(26) NOT NULL, source_line_id varchar(26) NOT NULL, position_type varchar(16) NOT NULL CHECK(position_type IN ('ASSET','LIABILITY')), direction varchar(3) NOT NULL CHECK(direction IN ('IN','OUT')), purpose varchar(16) NOT NULL CHECK(purpose IN ('PRIMARY','CHANGE')), effective_date date NOT NULL, occurred_at timestamptz NOT NULL, UNIQUE(generation_id,source_document_id,source_line_id,position_type,direction)
);
CREATE INDEX led_bill_entries_source_idx ON led_bill_entries(source_document_id);

-- +goose StatementBegin
CREATE OR REPLACE FUNCTION vou_validate_document_detail() RETURNS trigger AS $$
DECLARE target_id varchar(26); detail_count integer;
BEGIN
 IF TG_TABLE_NAME='vou_documents' THEN target_id:=CASE WHEN TG_OP='DELETE' THEN OLD.id ELSE NEW.id END;
 ELSE target_id:=CASE WHEN TG_OP='DELETE' THEN OLD.document_id ELSE NEW.document_id END; END IF;
 IF NOT EXISTS (SELECT 1 FROM vou_documents WHERE id=target_id) THEN RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END; END IF;
 SELECT (SELECT count(*) FROM vou_sale_pricing_details WHERE document_id=target_id)+(SELECT count(*) FROM vou_purchase_inquiry_details WHERE document_id=target_id)+(SELECT count(*) FROM vou_sale_order_details WHERE document_id=target_id)+(SELECT count(*) FROM vou_sale_outbound_details WHERE document_id=target_id)+(SELECT count(*) FROM vou_sale_delivery_details WHERE document_id=target_id)+(SELECT count(*) FROM vou_sale_signoff_details WHERE document_id=target_id)+(SELECT count(*) FROM vou_sale_return_details WHERE document_id=target_id)+(SELECT count(*) FROM vou_purchase_order_details WHERE document_id=target_id)+(SELECT count(*) FROM vou_purchase_inbound_details WHERE document_id=target_id)+(SELECT count(*) FROM vou_purchase_return_details WHERE document_id=target_id)+(SELECT count(*) FROM vou_production_details WHERE document_id=target_id)+(SELECT count(*) FROM vou_inventory_count_details WHERE document_id=target_id)+(SELECT count(*) FROM vou_receipt_details WHERE document_id=target_id)+(SELECT count(*) FROM vou_payment_details WHERE document_id=target_id)+(SELECT count(*) FROM vou_expense_reimbursement_details WHERE document_id=target_id)+(SELECT count(*) FROM vou_expense_payment_details WHERE document_id=target_id)+(SELECT count(*) FROM vou_employee_loan_writeoff_details WHERE document_id=target_id)+(SELECT count(*) FROM vou_other_income_details WHERE document_id=target_id)+(SELECT count(*) FROM vou_asset_acquisition_details WHERE document_id=target_id)+(SELECT count(*) FROM vou_asset_depreciation_details WHERE document_id=target_id)+(SELECT count(*) FROM vou_asset_sale_details WHERE document_id=target_id)+(SELECT count(*) FROM vou_asset_liquidation_details WHERE document_id=target_id)+(SELECT count(*) FROM vou_bill_details WHERE document_id=target_id) INTO detail_count;
 IF detail_count<>1 THEN RAISE EXCEPTION 'VOU document must have exactly one typed detail row' USING ERRCODE='23514'; END IF;
 RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END; $$ LANGUAGE plpgsql;
-- +goose StatementEnd
CREATE CONSTRAINT TRIGGER vou_bill_detail_ck AFTER INSERT OR UPDATE OR DELETE ON vou_bill_details DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION vou_validate_document_detail();

INSERT INTO app_permissions(id,path,domain,entity,action,description,status)
SELECT 'BIL'||substring(md5('/vou/bill-receipt/'||action),1,23),'/vou/bill-receipt/'||action,'vou','bill-receipt',action,description,'ENABLED'
FROM (VALUES ('query','查询收票单'),('get','查看收票单'),('create','创建收票单'),('save','保存收票单'),('check','检查收票单'),('uncheck','反检查收票单'),('approve','批准收票单'),('unapprove','反批准收票单'),('finalize','完成收票单'),('unfinalize','反完成收票单'),('delete','删除收票单'),('audit-history','查看收票单审计'),('attachment-initiate','上传收票单附件'),('attachment-download','下载收票单附件'),('attachment-remove','删除收票单附件')) AS x(action,description)
ON CONFLICT(path) DO NOTHING;


INSERT INTO app_role_permissions(role_id,permission_id,created_by)
SELECT role.id,permission.id,role.updated_by FROM app_roles role CROSS JOIN app_permissions permission WHERE role.code='superadmin' AND permission.domain='vou' AND permission.entity='bill-receipt' ON CONFLICT DO NOTHING;
INSERT INTO app_permissions(id,path,domain,entity,action,description,status) VALUES('BILLED00000000000000000001','/led/bill/query','led','bill','query','查询票据台账','ENABLED') ON CONFLICT(path) DO NOTHING;
INSERT INTO app_role_permissions(role_id,permission_id,created_by) SELECT role.id,permission.id,role.updated_by FROM app_roles role CROSS JOIN app_permissions permission WHERE role.code='superadmin' AND permission.path='/led/bill/query' ON CONFLICT DO NOTHING;

-- +goose Down
-- +goose StatementBegin
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM vou_documents WHERE entity IN ('bill-receipt','bill-payment','bill-issue','bill-discount','bill-maturity')) OR EXISTS(SELECT 1 FROM led_bills) THEN RAISE EXCEPTION 'cannot roll back bill management while bill data exists'; END IF;
END $$;
-- +goose StatementEnd
DELETE FROM app_role_permissions WHERE permission_id IN (SELECT id FROM app_permissions WHERE (domain='vou' AND entity='bill-receipt') OR path='/led/bill/query');
DELETE FROM app_permissions WHERE (domain='vou' AND entity='bill-receipt') OR path='/led/bill/query';
DROP TRIGGER vou_bill_detail_ck ON vou_bill_details;
DROP TABLE led_bill_entries; DROP TABLE led_bills; DROP TABLE vou_bill_cash_lines; DROP TABLE vou_bill_lines; DROP TABLE vou_bill_details;
ALTER TABLE vou_documents DROP CONSTRAINT vou_documents_entity_check;
ALTER TABLE vou_documents ADD CONSTRAINT vou_documents_entity_check CHECK (entity IN ('sale-pricing','sale-order','sale-outbound','sale-delivery','sale-signoff','sale-return','purchase-inquiry','purchase-order','purchase-inbound','purchase-return','order-production','self-production','inventory-count','receipt','payment','customer-receipt','supplier-receipt','other-receipt','customer-payment','supplier-payment','other-payment','employee-loan','employee-repayment','employee-loan-writeoff','expense-reimbursement','expense-payment','other-income','asset-acquisition','asset-depreciation','asset-sale','asset-liquidation','customer-order','procurement-order','goods-receipt','delivery-note','signoff-note'));
-- +goose StatementBegin
CREATE OR REPLACE FUNCTION vou_validate_document_detail() RETURNS trigger AS $$
DECLARE target_id varchar(26); detail_count integer;
BEGIN
 IF TG_TABLE_NAME='vou_documents' THEN target_id:=CASE WHEN TG_OP='DELETE' THEN OLD.id ELSE NEW.id END; ELSE target_id:=CASE WHEN TG_OP='DELETE' THEN OLD.document_id ELSE NEW.document_id END; END IF;
 IF NOT EXISTS (SELECT 1 FROM vou_documents WHERE id=target_id) THEN RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END; END IF;
 SELECT (SELECT count(*) FROM vou_sale_pricing_details WHERE document_id=target_id)+(SELECT count(*) FROM vou_purchase_inquiry_details WHERE document_id=target_id)+(SELECT count(*) FROM vou_sale_order_details WHERE document_id=target_id)+(SELECT count(*) FROM vou_sale_outbound_details WHERE document_id=target_id)+(SELECT count(*) FROM vou_sale_delivery_details WHERE document_id=target_id)+(SELECT count(*) FROM vou_sale_signoff_details WHERE document_id=target_id)+(SELECT count(*) FROM vou_sale_return_details WHERE document_id=target_id)+(SELECT count(*) FROM vou_purchase_order_details WHERE document_id=target_id)+(SELECT count(*) FROM vou_purchase_inbound_details WHERE document_id=target_id)+(SELECT count(*) FROM vou_purchase_return_details WHERE document_id=target_id)+(SELECT count(*) FROM vou_production_details WHERE document_id=target_id)+(SELECT count(*) FROM vou_inventory_count_details WHERE document_id=target_id)+(SELECT count(*) FROM vou_receipt_details WHERE document_id=target_id)+(SELECT count(*) FROM vou_payment_details WHERE document_id=target_id)+(SELECT count(*) FROM vou_expense_reimbursement_details WHERE document_id=target_id)+(SELECT count(*) FROM vou_expense_payment_details WHERE document_id=target_id)+(SELECT count(*) FROM vou_employee_loan_writeoff_details WHERE document_id=target_id)+(SELECT count(*) FROM vou_other_income_details WHERE document_id=target_id)+(SELECT count(*) FROM vou_asset_acquisition_details WHERE document_id=target_id)+(SELECT count(*) FROM vou_asset_depreciation_details WHERE document_id=target_id)+(SELECT count(*) FROM vou_asset_sale_details WHERE document_id=target_id)+(SELECT count(*) FROM vou_asset_liquidation_details WHERE document_id=target_id) INTO detail_count;
 IF detail_count<>1 THEN RAISE EXCEPTION 'VOU document must have exactly one typed detail row' USING ERRCODE='23514'; END IF; RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END; $$ LANGUAGE plpgsql;
-- +goose StatementEnd

-- +goose Up

ALTER TABLE aux_objects DROP CONSTRAINT aux_objects_entity_check;
ALTER TABLE aux_objects ADD CONSTRAINT aux_objects_entity_check CHECK (entity IN (
    'product-category','department','position','settlement-method','dictionary-type',
    'dictionary-item','measurement-unit','income-expense-type','account-subject','asset-category'
));

ALTER TABLE vou_documents
    DROP CONSTRAINT vou_documents_entity_check,
    ADD CONSTRAINT vou_documents_entity_check CHECK (entity IN (
        'sale-pricing','sale-order','sale-outbound','sale-delivery','sale-signoff','sale-return',
        'purchase-inquiry','purchase-order','purchase-inbound','purchase-return',
        'order-production','self-production','receipt','payment',
        'customer-receipt','supplier-receipt','other-receipt',
        'customer-payment','supplier-payment','other-payment',
        'expense-reimbursement','expense-payment','other-income',
        'asset-acquisition','asset-depreciation','asset-sale','asset-liquidation',
        'customer-order','procurement-order','goods-receipt','delivery-note','signoff-note'
    )),
    DROP CONSTRAINT vou_documents_total_amount_ck,
    ADD CONSTRAINT vou_documents_total_amount_ck CHECK (
        (entity IN ('sale-pricing','purchase-inquiry','sale-order','sale-outbound','sale-delivery',
                    'sale-signoff','sale-return','purchase-order','purchase-inbound','purchase-return',
                    'order-production','self-production','asset-liquidation') AND total_amount_cents >= 0)
        OR (entity NOT IN ('sale-pricing','purchase-inquiry','sale-order','sale-outbound','sale-delivery',
                           'sale-signoff','sale-return','purchase-order','purchase-inbound','purchase-return',
                           'order-production','self-production','asset-liquidation') AND total_amount_cents > 0)
    );

CREATE TABLE vou_asset_acquisition_details (
    document_id varchar(26) PRIMARY KEY,
    entity varchar(32) NOT NULL DEFAULT 'asset-acquisition' CHECK (entity='asset-acquisition'),
    supplier_object_id varchar(26) NOT NULL,
    supplier_version_id varchar(26) NOT NULL,
    supplier_code varchar(64) NOT NULL,
    supplier_name varchar(200) NOT NULL,
    FOREIGN KEY(document_id,entity) REFERENCES vou_documents(id,entity) ON DELETE RESTRICT
);

CREATE TABLE vou_asset_acquisition_lines (
    id varchar(26) PRIMARY KEY,
    document_id varchar(26) NOT NULL REFERENCES vou_asset_acquisition_details(document_id) ON DELETE RESTRICT,
    line_no integer NOT NULL CHECK(line_no>0),
    asset_name varchar(200) NOT NULL,
    specification varchar(200) NOT NULL DEFAULT '',
    category_object_id varchar(26) NOT NULL,
    category_version_id varchar(26) NOT NULL,
    category_code varchar(64) NOT NULL,
    category_name varchar(200) NOT NULL,
    original_value_cents bigint NOT NULL CHECK(original_value_cents>0),
    useful_life_months integer NOT NULL CHECK(useful_life_months BETWEEN 1 AND 1200),
    residual_rate_bps integer NOT NULL CHECK(residual_rate_bps BETWEEN 0 AND 9999),
    department_object_id varchar(26) NOT NULL,
    department_version_id varchar(26) NOT NULL,
    department_code varchar(64) NOT NULL,
    department_name varchar(200) NOT NULL,
    custodian_object_id varchar(26),
    custodian_version_id varchar(26),
    custodian_code varchar(64),
    custodian_name varchar(200),
    location varchar(200) NOT NULL DEFAULT '',
    remark varchar(1000),
    UNIQUE(document_id,line_no)
);

CREATE TABLE vou_asset_depreciation_details (
    document_id varchar(26) PRIMARY KEY,
    entity varchar(32) NOT NULL DEFAULT 'asset-depreciation' CHECK(entity='asset-depreciation'),
    depreciation_month date NOT NULL CHECK(depreciation_month=date_trunc('month',depreciation_month)::date),
    FOREIGN KEY(document_id,entity) REFERENCES vou_documents(id,entity) ON DELETE RESTRICT
);

CREATE TABLE vou_asset_depreciation_lines (
    id varchar(26) PRIMARY KEY,
    document_id varchar(26) NOT NULL REFERENCES vou_asset_depreciation_details(document_id) ON DELETE RESTRICT,
    line_no integer NOT NULL CHECK(line_no>0),
    depreciation_month date NOT NULL CHECK(depreciation_month=date_trunc('month',depreciation_month)::date),
    asset_id varchar(26) NOT NULL,
    asset_no varchar(32) NOT NULL,
    asset_name varchar(200) NOT NULL,
    amount_cents bigint NOT NULL CHECK(amount_cents>0),
    opening_accumulated_cents bigint NOT NULL CHECK(opening_accumulated_cents>=0),
    closing_accumulated_cents bigint NOT NULL CHECK(closing_accumulated_cents=opening_accumulated_cents+amount_cents),
    remark varchar(1000),
    UNIQUE(document_id,line_no), UNIQUE(document_id,asset_id), UNIQUE(asset_id,depreciation_month)
);

CREATE TABLE vou_asset_sale_details (
    document_id varchar(26) PRIMARY KEY,
    entity varchar(32) NOT NULL DEFAULT 'asset-sale' CHECK(entity='asset-sale'),
    counterparty_entity varchar(16) NOT NULL CHECK(counterparty_entity IN ('customer','other-party')),
    counterparty_object_id varchar(26) NOT NULL,
    counterparty_version_id varchar(26) NOT NULL,
    counterparty_code varchar(64) NOT NULL,
    counterparty_name varchar(200) NOT NULL,
    FOREIGN KEY(document_id,entity) REFERENCES vou_documents(id,entity) ON DELETE RESTRICT
);

CREATE TABLE vou_asset_sale_lines (
    id varchar(26) PRIMARY KEY,
    document_id varchar(26) NOT NULL REFERENCES vou_asset_sale_details(document_id) ON DELETE RESTRICT,
    line_no integer NOT NULL CHECK(line_no>0),
    asset_id varchar(26) NOT NULL,
    asset_no varchar(32) NOT NULL,
    asset_name varchar(200) NOT NULL,
    sale_amount_cents bigint NOT NULL CHECK(sale_amount_cents>0),
    remark varchar(1000),
    UNIQUE(document_id,line_no), UNIQUE(document_id,asset_id)
);

CREATE TABLE vou_asset_liquidation_details (
    document_id varchar(26) PRIMARY KEY,
    entity varchar(32) NOT NULL DEFAULT 'asset-liquidation' CHECK(entity='asset-liquidation'),
    FOREIGN KEY(document_id,entity) REFERENCES vou_documents(id,entity) ON DELETE RESTRICT
);

CREATE TABLE vou_asset_liquidation_lines (
    id varchar(26) PRIMARY KEY,
    document_id varchar(26) NOT NULL REFERENCES vou_asset_liquidation_details(document_id) ON DELETE RESTRICT,
    line_no integer NOT NULL CHECK(line_no>0),
    asset_id varchar(26) NOT NULL,
    asset_no varchar(32) NOT NULL,
    asset_name varchar(200) NOT NULL,
    reason varchar(1000) NOT NULL CHECK(length(btrim(reason)) BETWEEN 1 AND 1000),
    salvage_income_cents bigint NOT NULL DEFAULT 0 CHECK(salvage_income_cents>=0),
    disposal_expense_cents bigint NOT NULL DEFAULT 0 CHECK(disposal_expense_cents>=0),
    remark varchar(1000),
    UNIQUE(document_id,line_no), UNIQUE(document_id,asset_id)
);

CREATE TABLE led_asset_number_counters (
    business_date date PRIMARY KEY,
    last_value integer NOT NULL CHECK(last_value BETWEEN 1 AND 9999)
);
CREATE TABLE led_asset_number_assignments (
    source_line_id varchar(26) PRIMARY KEY,
    asset_no varchar(32) NOT NULL UNIQUE
);

CREATE TABLE led_assets (
    generation_id varchar(26) NOT NULL REFERENCES led_generations(id) ON DELETE RESTRICT,
    id varchar(26) NOT NULL,
    asset_no varchar(32) NOT NULL,
    asset_name varchar(200) NOT NULL,
    specification varchar(200) NOT NULL DEFAULT '',
    category_object_id varchar(26) NOT NULL,
    category_version_id varchar(26) NOT NULL,
    category_code varchar(64) NOT NULL,
    category_name varchar(200) NOT NULL,
    department_object_id varchar(26) NOT NULL,
    department_version_id varchar(26) NOT NULL,
    department_code varchar(64) NOT NULL,
    department_name varchar(200) NOT NULL,
    custodian_object_id varchar(26),
    custodian_version_id varchar(26),
    custodian_code varchar(64),
    custodian_name varchar(200),
    location varchar(200) NOT NULL DEFAULT '',
    acquisition_date date NOT NULL,
    depreciation_start_month date NOT NULL,
    original_value_cents bigint NOT NULL CHECK(original_value_cents>0),
    residual_value_cents bigint NOT NULL CHECK(residual_value_cents>=0 AND residual_value_cents<original_value_cents),
    useful_life_months integer NOT NULL CHECK(useful_life_months BETWEEN 1 AND 1200),
    accumulated_depreciation_cents bigint NOT NULL DEFAULT 0 CHECK(accumulated_depreciation_cents>=0),
    last_depreciation_month date,
    status varchar(16) NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','SOLD','RETIRED')),
    source_document_id varchar(26) NOT NULL,
    source_line_id varchar(26) NOT NULL,
    source_revision bigint NOT NULL,
    remark varchar(1000),
    PRIMARY KEY(generation_id,id), UNIQUE(generation_id,asset_no), UNIQUE(generation_id,source_line_id),
    CHECK(accumulated_depreciation_cents<=original_value_cents-residual_value_cents)
);
CREATE INDEX led_assets_query_idx ON led_assets(generation_id,status,asset_no);

CREATE TABLE led_asset_entries (
    id varchar(26) NOT NULL,
    generation_id varchar(26) NOT NULL REFERENCES led_generations(id) ON DELETE RESTRICT,
    asset_id varchar(26) NOT NULL,
    entry_type varchar(16) NOT NULL CHECK(entry_type IN ('ACQUISITION','DEPRECIATION','SALE','LIQUIDATION')),
    source_entity varchar(32) NOT NULL,
    source_document_id varchar(26) NOT NULL,
    source_document_no varchar(32) NOT NULL,
    source_line_id varchar(26) NOT NULL,
    source_revision bigint NOT NULL,
    effective_date date NOT NULL,
    occurred_at timestamptz NOT NULL,
    amount_cents bigint NOT NULL DEFAULT 0,
    status_from varchar(16),
    status_to varchar(16) NOT NULL CHECK(status_to IN ('ACTIVE','SOLD','RETIRED')),
    actor_id varchar(26) NOT NULL,
    request_id varchar(128) NOT NULL,
    summary jsonb NOT NULL DEFAULT '{}'::jsonb,
    PRIMARY KEY(generation_id,id),
    UNIQUE(generation_id,source_document_id,source_line_id,source_revision)
);
CREATE INDEX led_asset_entries_history_idx ON led_asset_entries(generation_id,asset_id,effective_date,id);

-- +goose StatementBegin
CREATE OR REPLACE FUNCTION vou_validate_document_detail() RETURNS trigger AS $$
DECLARE target_id varchar(26); detail_count integer;
BEGIN
    IF TG_TABLE_NAME='vou_documents' THEN target_id:=CASE WHEN TG_OP='DELETE' THEN OLD.id ELSE NEW.id END;
    ELSE target_id:=CASE WHEN TG_OP='DELETE' THEN OLD.document_id ELSE NEW.document_id END; END IF;
    IF NOT EXISTS(SELECT 1 FROM vou_documents WHERE id=target_id) THEN RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END; END IF;
    SELECT (SELECT count(*) FROM vou_sale_pricing_details WHERE document_id=target_id)
         + (SELECT count(*) FROM vou_purchase_inquiry_details WHERE document_id=target_id)
         + (SELECT count(*) FROM vou_sale_order_details WHERE document_id=target_id)
         + (SELECT count(*) FROM vou_sale_outbound_details WHERE document_id=target_id)
         + (SELECT count(*) FROM vou_sale_delivery_details WHERE document_id=target_id)
         + (SELECT count(*) FROM vou_sale_signoff_details WHERE document_id=target_id)
         + (SELECT count(*) FROM vou_sale_return_details WHERE document_id=target_id)
         + (SELECT count(*) FROM vou_purchase_order_details WHERE document_id=target_id)
         + (SELECT count(*) FROM vou_purchase_inbound_details WHERE document_id=target_id)
         + (SELECT count(*) FROM vou_purchase_return_details WHERE document_id=target_id)
         + (SELECT count(*) FROM vou_production_details WHERE document_id=target_id)
         + (SELECT count(*) FROM vou_receipt_details WHERE document_id=target_id)
         + (SELECT count(*) FROM vou_payment_details WHERE document_id=target_id)
         + (SELECT count(*) FROM vou_expense_reimbursement_details WHERE document_id=target_id)
         + (SELECT count(*) FROM vou_expense_payment_details WHERE document_id=target_id)
         + (SELECT count(*) FROM vou_other_income_details WHERE document_id=target_id)
         + (SELECT count(*) FROM vou_asset_acquisition_details WHERE document_id=target_id)
         + (SELECT count(*) FROM vou_asset_depreciation_details WHERE document_id=target_id)
         + (SELECT count(*) FROM vou_asset_sale_details WHERE document_id=target_id)
         + (SELECT count(*) FROM vou_asset_liquidation_details WHERE document_id=target_id) INTO detail_count;
    IF detail_count<>1 THEN RAISE EXCEPTION 'VOU document must have exactly one typed detail row' USING ERRCODE='23514'; END IF;
    RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END;
$$ LANGUAGE plpgsql;
-- +goose StatementEnd

CREATE CONSTRAINT TRIGGER vou_asset_acquisition_detail_ck AFTER INSERT OR UPDATE OR DELETE ON vou_asset_acquisition_details DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION vou_validate_document_detail();
CREATE CONSTRAINT TRIGGER vou_asset_depreciation_detail_ck AFTER INSERT OR UPDATE OR DELETE ON vou_asset_depreciation_details DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION vou_validate_document_detail();
CREATE CONSTRAINT TRIGGER vou_asset_sale_detail_ck AFTER INSERT OR UPDATE OR DELETE ON vou_asset_sale_details DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION vou_validate_document_detail();
CREATE CONSTRAINT TRIGGER vou_asset_liquidation_detail_ck AFTER INSERT OR UPDATE OR DELETE ON vou_asset_liquidation_details DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION vou_validate_document_detail();

INSERT INTO app_permissions(id,path,domain,entity,action,description,status)
SELECT 'FA'||substring(md5('/aux/asset-category/'||action),1,24),'/aux/asset-category/'||action,
       'aux','asset-category',action,description,'ENABLED'
FROM (VALUES ('query','查询资产类别'),('get','查看资产类别'),('create','创建资产类别'),
 ('save','保存资产类别'),('enable','启用资产类别'),('disable','停用资产类别'),('delete','删除资产类别'),
 ('versions','查看资产类别版本'),('audit-history','查看资产类别审计')) v(action,description);

INSERT INTO app_permissions(id,path,domain,entity,action,description,status)
SELECT 'FV'||substring(md5('/vou/'||entity||'/'||action),1,24),'/vou/'||entity||'/'||action,
       'vou',entity,action,description,'ENABLED'
FROM (VALUES ('asset-acquisition','资产购置'),('asset-depreciation','资产折旧'),
             ('asset-sale','资产出让'),('asset-liquidation','资产清算')) e(entity,label)
CROSS JOIN (VALUES ('query','查询'),('get','查看'),('create','创建'),('save','保存'),('delete','删除'),
 ('check','核对'),('uncheck','撤销核对'),('approve','批准'),('unapprove','撤销批准'),
 ('finalize','最终处理'),('unfinalize','撤销最终处理'),('audit-history','查看审计'),
 ('attachment-initiate','发起附件上传'),('attachment-download','下载附件'),('attachment-remove','移除附件')) a(action,prefix)
CROSS JOIN LATERAL (SELECT prefix||label AS description) d;

INSERT INTO app_permissions(id,path,domain,entity,action,description,status) VALUES
('FL'||substring(md5('/led/asset/query'),1,24),'/led/asset/query','led','asset','query','查询固定资产台账','ENABLED'),
('FL'||substring(md5('/led/asset/get'),1,24),'/led/asset/get','led','asset','get','查看固定资产台账','ENABLED');
INSERT INTO app_permissions(id,path,domain,entity,action,description,status) VALUES
('FV'||substring(md5('/vou/asset-depreciation/preview'),1,24),'/vou/asset-depreciation/preview','vou','asset-depreciation','preview','预览资产折旧','ENABLED');

INSERT INTO app_role_permissions(role_id,permission_id,created_by)
SELECT r.id,p.id,'01JAPPSYST3MACTR0000000000' FROM app_roles r CROSS JOIN app_permissions p
WHERE r.code='superadmin' AND ((p.domain='aux' AND p.entity='asset-category')
 OR (p.domain='vou' AND p.entity LIKE 'asset-%') OR (p.domain='led' AND p.entity='asset'))
ON CONFLICT DO NOTHING;

-- +goose Down
-- Fixed-asset rollback is intentionally guarded once business data exists.
-- +goose StatementBegin
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM vou_documents WHERE entity LIKE 'asset-%') THEN
   RAISE EXCEPTION 'cannot roll back fixed assets while asset documents exist';
 END IF;
END $$;
-- +goose StatementEnd

DELETE FROM app_role_permissions WHERE permission_id IN (SELECT id FROM app_permissions WHERE (domain='aux' AND entity='asset-category') OR (domain='vou' AND entity LIKE 'asset-%') OR (domain='led' AND entity='asset'));
DELETE FROM app_permissions WHERE (domain='aux' AND entity='asset-category') OR (domain='vou' AND entity LIKE 'asset-%') OR (domain='led' AND entity='asset');
DROP TRIGGER vou_asset_liquidation_detail_ck ON vou_asset_liquidation_details;
DROP TRIGGER vou_asset_sale_detail_ck ON vou_asset_sale_details;
DROP TRIGGER vou_asset_depreciation_detail_ck ON vou_asset_depreciation_details;
DROP TRIGGER vou_asset_acquisition_detail_ck ON vou_asset_acquisition_details;
-- +goose StatementBegin
CREATE OR REPLACE FUNCTION vou_validate_document_detail() RETURNS trigger AS $$
DECLARE target_id varchar(26); detail_count integer;
BEGIN
    IF TG_TABLE_NAME='vou_documents' THEN target_id:=CASE WHEN TG_OP='DELETE' THEN OLD.id ELSE NEW.id END;
    ELSE target_id:=CASE WHEN TG_OP='DELETE' THEN OLD.document_id ELSE NEW.document_id END; END IF;
    IF NOT EXISTS(SELECT 1 FROM vou_documents WHERE id=target_id) THEN RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END; END IF;
    SELECT (SELECT count(*) FROM vou_sale_pricing_details WHERE document_id=target_id)
         + (SELECT count(*) FROM vou_purchase_inquiry_details WHERE document_id=target_id)
         + (SELECT count(*) FROM vou_sale_order_details WHERE document_id=target_id)
         + (SELECT count(*) FROM vou_sale_outbound_details WHERE document_id=target_id)
         + (SELECT count(*) FROM vou_sale_delivery_details WHERE document_id=target_id)
         + (SELECT count(*) FROM vou_sale_signoff_details WHERE document_id=target_id)
         + (SELECT count(*) FROM vou_sale_return_details WHERE document_id=target_id)
         + (SELECT count(*) FROM vou_purchase_order_details WHERE document_id=target_id)
         + (SELECT count(*) FROM vou_purchase_inbound_details WHERE document_id=target_id)
         + (SELECT count(*) FROM vou_purchase_return_details WHERE document_id=target_id)
         + (SELECT count(*) FROM vou_production_details WHERE document_id=target_id)
         + (SELECT count(*) FROM vou_receipt_details WHERE document_id=target_id)
         + (SELECT count(*) FROM vou_payment_details WHERE document_id=target_id)
         + (SELECT count(*) FROM vou_expense_reimbursement_details WHERE document_id=target_id)
         + (SELECT count(*) FROM vou_expense_payment_details WHERE document_id=target_id)
         + (SELECT count(*) FROM vou_other_income_details WHERE document_id=target_id) INTO detail_count;
    IF detail_count<>1 THEN RAISE EXCEPTION 'VOU document must have exactly one typed detail row' USING ERRCODE='23514'; END IF;
    RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END;
$$ LANGUAGE plpgsql;
-- +goose StatementEnd
DROP TABLE led_asset_entries;
DROP TABLE led_assets;
DROP TABLE led_asset_number_assignments;
DROP TABLE led_asset_number_counters;
DROP TABLE vou_asset_liquidation_lines;
DROP TABLE vou_asset_liquidation_details;
DROP TABLE vou_asset_sale_lines;
DROP TABLE vou_asset_sale_details;
DROP TABLE vou_asset_depreciation_lines;
DROP TABLE vou_asset_depreciation_details;
DROP TABLE vou_asset_acquisition_lines;
DROP TABLE vou_asset_acquisition_details;

ALTER TABLE vou_documents
    DROP CONSTRAINT vou_documents_total_amount_ck,
    ADD CONSTRAINT vou_documents_total_amount_ck CHECK (
        (entity IN ('sale-pricing','purchase-inquiry','sale-order','sale-outbound','sale-delivery',
                    'sale-signoff','sale-return','purchase-order','purchase-inbound','purchase-return',
                    'order-production','self-production') AND total_amount_cents >= 0)
        OR (entity NOT IN ('sale-pricing','purchase-inquiry','sale-order','sale-outbound','sale-delivery',
                           'sale-signoff','sale-return','purchase-order','purchase-inbound','purchase-return',
                           'order-production','self-production') AND total_amount_cents > 0)
    ),
    DROP CONSTRAINT vou_documents_entity_check,
    ADD CONSTRAINT vou_documents_entity_check CHECK (entity IN (
        'sale-pricing','sale-order','sale-outbound','sale-delivery','sale-signoff','sale-return',
        'purchase-inquiry','purchase-order','purchase-inbound','purchase-return',
        'order-production','self-production','receipt','payment',
        'customer-receipt','supplier-receipt','other-receipt',
        'customer-payment','supplier-payment','other-payment',
        'expense-reimbursement','expense-payment','other-income',
        'customer-order','procurement-order','goods-receipt','delivery-note','signoff-note'
    ));
ALTER TABLE aux_objects DROP CONSTRAINT aux_objects_entity_check;
ALTER TABLE aux_objects ADD CONSTRAINT aux_objects_entity_check CHECK (entity IN (
    'product-category','department','position','settlement-method','dictionary-type',
    'dictionary-item','measurement-unit','income-expense-type','account-subject'
));

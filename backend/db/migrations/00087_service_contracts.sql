-- +goose Up

-- Service contracts are VOU facts.  They deliberately keep both the typed
-- relationship reference and the Party/operating-entity facts used when the
-- contract was made; neither is read back from BOB for historical documents.
ALTER TABLE vou_documents
    DROP CONSTRAINT vou_documents_entity_check,
    ADD CONSTRAINT vou_documents_entity_check CHECK (entity IN (
        'sale-pricing','sale-order','sale-outbound','sale-delivery','sale-signoff','sale-return',
        'purchase-inquiry','purchase-order','purchase-inbound','purchase-return',
        'order-production','self-production','inventory-count',
        'sales-receipt','sales-refund','purchase-payment','purchase-refund',
        'other-receipt','other-payment','employee-loan','employee-repayment','employee-loan-writeoff',
        'expense-reimbursement','expense-payment','other-income',
        'asset-acquisition','asset-sale','asset-liquidation',
        'bill-receipt','bill-payment','bill-issue','bill-discount','bill-maturity',
        'intermediary-calculation','service-contract','service-acceptance',
        'customer-order','procurement-order','goods-receipt','delivery-note','signoff-note'
    )),
    DROP CONSTRAINT vou_documents_total_amount_ck,
    ADD CONSTRAINT vou_documents_total_amount_ck CHECK (
        entity IN ('intermediary-calculation','service-contract')
        OR (entity IN ('sale-pricing','purchase-inquiry','sale-order','sale-outbound','sale-delivery',
                       'sale-signoff','sale-return','purchase-order','purchase-inbound','purchase-return',
                       'order-production','self-production','inventory-count','asset-liquidation')
            AND total_amount_cents >= 0)
        OR (entity NOT IN ('intermediary-calculation','service-contract','sale-pricing','purchase-inquiry',
                           'sale-order','sale-outbound','sale-delivery','sale-signoff','sale-return',
                           'purchase-order','purchase-inbound','purchase-return','order-production',
                           'self-production','inventory-count','asset-liquidation')
            AND total_amount_cents > 0)
    );

CREATE TABLE vou_service_contract_details (
    document_id varchar(26) PRIMARY KEY REFERENCES vou_documents(id) ON DELETE RESTRICT,
    entity varchar(32) NOT NULL DEFAULT 'service-contract' CHECK (entity='service-contract'),
    counterparty_entity varchar(32) NOT NULL CHECK (counterparty_entity IN ('other-unit','sales-partner')),
    counterparty_object_id varchar(26) NOT NULL,
    counterparty_version_id varchar(26) NOT NULL,
    counterparty_code varchar(64) NOT NULL,
    counterparty_name varchar(200) NOT NULL,
    party_id varchar(26) NOT NULL,
    party_name varchar(200) NOT NULL,
    operating_entity_object_id varchar(26) NOT NULL,
    operating_entity_version_id varchar(26) NOT NULL,
    operating_entity_code varchar(64) NOT NULL,
    operating_entity_name varchar(200) NOT NULL,
    handler_object_id varchar(26) NOT NULL,
    handler_version_id varchar(26) NOT NULL,
    handler_code varchar(64) NOT NULL,
    handler_name varchar(200) NOT NULL,
    settlement_method_object_id varchar(26),
    settlement_method_version_id varchar(26),
    settlement_method_code varchar(64),
    settlement_method_name varchar(200),
    settlement_term_code varchar(32),
    settlement_rule_type varchar(32),
    settlement_month_offset integer,
    settlement_day_of_month integer,
    settlement_day_offset integer,
    capabilities varchar(32)[] NOT NULL DEFAULT '{}',
    applicable_from date,
    applicable_to date,
    contract_terms text NOT NULL DEFAULT '',
    FOREIGN KEY(document_id,entity) REFERENCES vou_documents(id,entity) ON DELETE RESTRICT,
    CHECK (length(btrim(contract_terms))<=10000),
    CHECK (capabilities <@ ARRAY['EXTERNAL_PART_TIME','CHANNEL_PARTNER']::varchar(32)[]),
    CHECK (
      (counterparty_entity='other-unit' AND cardinality(capabilities)=0
       AND applicable_from IS NULL AND applicable_to IS NULL)
      OR
      (counterparty_entity='sales-partner' AND cardinality(capabilities)>0
       AND applicable_from IS NOT NULL
       AND (applicable_to IS NULL OR applicable_to>=applicable_from)
       AND settlement_method_object_id IS NULL AND settlement_method_version_id IS NULL
       AND settlement_method_code IS NULL AND settlement_method_name IS NULL
       AND settlement_term_code IS NULL AND settlement_rule_type IS NULL
       AND settlement_month_offset IS NULL AND settlement_day_of_month IS NULL
       AND settlement_day_offset IS NULL)
    ),
    CHECK (
      (counterparty_entity='other-unit' AND settlement_method_object_id IS NOT NULL
       AND settlement_method_version_id IS NOT NULL AND settlement_method_code IS NOT NULL
       AND settlement_method_name IS NOT NULL AND settlement_term_code IS NOT NULL
       AND settlement_rule_type IS NOT NULL AND settlement_month_offset IS NOT NULL
       AND settlement_day_offset IS NOT NULL)
      OR counterparty_entity='sales-partner'
    )
);
CREATE INDEX vou_service_contract_partner_idx ON vou_service_contract_details(
    counterparty_entity,counterparty_object_id,applicable_from DESC,document_id DESC
);

CREATE TABLE vou_service_acceptance_details (
    document_id varchar(26) PRIMARY KEY REFERENCES vou_documents(id) ON DELETE RESTRICT,
    entity varchar(32) NOT NULL DEFAULT 'service-acceptance' CHECK (entity='service-acceptance'),
    contract_document_id varchar(26) NOT NULL REFERENCES vou_service_contract_details(document_id) ON DELETE RESTRICT,
    service_date date NOT NULL,
    acceptance_date date NOT NULL,
    settlement_direction varchar(16) NOT NULL CHECK (settlement_direction IN ('PAYABLE','RECEIVABLE')),
    contract_snapshot jsonb NOT NULL CHECK (jsonb_typeof(contract_snapshot)='object'),
    fulfillment_fact text NOT NULL DEFAULT '',
    acceptance_fact text NOT NULL DEFAULT '',
    CHECK (acceptance_date>=service_date),
    CHECK (length(btrim(fulfillment_fact))<=10000),
    CHECK (length(btrim(acceptance_fact))<=10000),
    FOREIGN KEY(document_id,entity) REFERENCES vou_documents(id,entity) ON DELETE RESTRICT
);
CREATE INDEX vou_service_acceptance_contract_idx ON vou_service_acceptance_details(contract_document_id);

-- The generic deferred detail invariant must know about both new detail
-- tables.  This remains a single VOU detail row, rather than a second model.
-- +goose StatementBegin
CREATE OR REPLACE FUNCTION vou_validate_document_detail() RETURNS trigger AS $$
DECLARE target_id varchar(26); detail_count integer;
BEGIN
 IF TG_TABLE_NAME='vou_documents' THEN target_id:=CASE WHEN TG_OP='DELETE' THEN OLD.id ELSE NEW.id END;
 ELSE target_id:=CASE WHEN TG_OP='DELETE' THEN OLD.document_id ELSE NEW.document_id END; END IF;
 IF NOT EXISTS (SELECT 1 FROM vou_documents WHERE id=target_id) THEN RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END; END IF;
 SELECT (SELECT count(*) FROM vou_sale_pricing_details WHERE document_id=target_id)+(SELECT count(*) FROM vou_purchase_inquiry_details WHERE document_id=target_id)+(SELECT count(*) FROM vou_sale_order_details WHERE document_id=target_id)+(SELECT count(*) FROM vou_sale_outbound_details WHERE document_id=target_id)+(SELECT count(*) FROM vou_sale_delivery_details WHERE document_id=target_id)+(SELECT count(*) FROM vou_sale_signoff_details WHERE document_id=target_id)+(SELECT count(*) FROM vou_sale_return_details WHERE document_id=target_id)+(SELECT count(*) FROM vou_purchase_order_details WHERE document_id=target_id)+(SELECT count(*) FROM vou_purchase_inbound_details WHERE document_id=target_id)+(SELECT count(*) FROM vou_purchase_return_details WHERE document_id=target_id)+(SELECT count(*) FROM vou_production_details WHERE document_id=target_id)+(SELECT count(*) FROM vou_inventory_count_details WHERE document_id=target_id)+(SELECT count(*) FROM vou_receipt_details WHERE document_id=target_id)+(SELECT count(*) FROM vou_payment_details WHERE document_id=target_id)+(SELECT count(*) FROM vou_expense_reimbursement_details WHERE document_id=target_id)+(SELECT count(*) FROM vou_expense_payment_details WHERE document_id=target_id)+(SELECT count(*) FROM vou_employee_loan_writeoff_details WHERE document_id=target_id)+(SELECT count(*) FROM vou_other_income_details WHERE document_id=target_id)+(SELECT count(*) FROM vou_asset_acquisition_details WHERE document_id=target_id)+(SELECT count(*) FROM vou_asset_sale_details WHERE document_id=target_id)+(SELECT count(*) FROM vou_asset_liquidation_details WHERE document_id=target_id)+(SELECT count(*) FROM vou_bill_details WHERE document_id=target_id)+(SELECT count(*) FROM vou_intermediary_calculation_details WHERE document_id=target_id)+(SELECT count(*) FROM vou_service_contract_details WHERE document_id=target_id)+(SELECT count(*) FROM vou_service_acceptance_details WHERE document_id=target_id) INTO detail_count;
 IF detail_count<>1 THEN RAISE EXCEPTION 'VOU document must have exactly one typed detail row' USING ERRCODE='23514'; END IF;
 RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END; $$ LANGUAGE plpgsql;
-- +goose StatementEnd

-- Exact permissions are seeded deliberately; existing roles only receive them
-- where the seed explicitly names superadmin.
WITH permissions(entity,action,description,ordinal) AS (
 VALUES
 ('service-contract','query','查询服务合同',1),('service-contract','get','查看服务合同',2),
 ('service-contract','create','创建服务合同',3),('service-contract','save','保存服务合同',4),
 ('service-contract','check','核对服务合同',5),('service-contract','uncheck','反核对服务合同',6),
 ('service-contract','approve','批准服务合同',7),('service-contract','unapprove','反批准服务合同',8),
 ('service-contract','delete','删除服务合同草稿',9),('service-contract','audit-history','查看服务合同审计',10),
 ('service-acceptance','query','查询履约验收',11),('service-acceptance','get','查看履约验收',12),
 ('service-acceptance','create','创建履约验收',13),('service-acceptance','save','保存履约验收',14),
 ('service-acceptance','check','核对履约验收',15),('service-acceptance','uncheck','反核对履约验收',16),
 ('service-acceptance','approve','批准履约验收',17),('service-acceptance','unapprove','反批准履约验收',18),
 ('service-acceptance','delete','删除履约验收草稿',19),('service-acceptance','audit-history','查看履约验收审计',20)
)
INSERT INTO app_permissions(id,path,domain,entity,action,description,status)
SELECT '01JVOU87'||lpad(ordinal::text,18,'0'),'/vou/'||entity||'/'||action,
       'vou',entity,action,description,'ENABLED' FROM permissions;
INSERT INTO app_role_permissions(role_id,permission_id,created_by)
SELECT role.id,permission.id,role.updated_by FROM app_roles role JOIN app_permissions permission
 ON permission.domain='vou' AND permission.entity IN ('service-contract','service-acceptance')
WHERE role.code='superadmin' ON CONFLICT DO NOTHING;

SELECT rpt_validate_current_reports();

-- +goose Down
-- +goose StatementBegin
DO $$ BEGIN RAISE EXCEPTION '00087 service contracts is a direct cutover'; END $$;
-- +goose StatementEnd

-- +goose Up

ALTER TABLE vou_documents
    DROP CONSTRAINT vou_documents_entity_check,
    ADD CONSTRAINT vou_documents_entity_check CHECK (entity IN (
        'sale-pricing','sale-order','sale-outbound','sale-delivery','sale-signoff','sale-return',
        'purchase-inquiry','purchase-order','purchase-inbound','purchase-return',
        'order-production','self-production','inventory-count','receipt','payment',
        'customer-receipt','supplier-receipt','other-receipt',
        'customer-payment','supplier-payment','other-payment',
        'employee-loan','employee-repayment','employee-loan-writeoff',
        'expense-reimbursement','expense-payment','other-income',
        'asset-acquisition','asset-depreciation','asset-sale','asset-liquidation',
        'bill-receipt','bill-payment','bill-issue','bill-discount','bill-maturity',
        'intermediary-calculation',
        'customer-order','procurement-order','goods-receipt','delivery-note','signoff-note'
    )),
    DROP CONSTRAINT vou_documents_total_amount_ck,
    ADD CONSTRAINT vou_documents_total_amount_ck CHECK (
        (entity IN ('sale-pricing','purchase-inquiry','sale-order','sale-outbound','sale-delivery',
                    'sale-signoff','sale-return','purchase-order','purchase-inbound','purchase-return',
                    'order-production','self-production','inventory-count','asset-liquidation',
                    'intermediary-calculation') AND total_amount_cents >= 0)
        OR (entity NOT IN ('sale-pricing','purchase-inquiry','sale-order','sale-outbound','sale-delivery',
                           'sale-signoff','sale-return','purchase-order','purchase-inbound','purchase-return',
                           'order-production','self-production','inventory-count','asset-liquidation',
                           'intermediary-calculation') AND total_amount_cents > 0)
    );

ALTER TABLE vou_sale_order_details
    ADD COLUMN special_approval boolean NOT NULL DEFAULT false;

CREATE TABLE vou_intermediary_scripts (
    id varchar(26) PRIMARY KEY,
    singleton boolean NOT NULL DEFAULT true UNIQUE CHECK (singleton),
    revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
    name varchar(200) NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 200),
    source text NOT NULL CHECK (length(source) BETWEEN 1 AND 100000),
    source_hash char(64) NOT NULL CHECK (source_hash ~ '^[a-f0-9]{64}$'),
    updated_at timestamptz NOT NULL DEFAULT now(),
    updated_by varchar(26) NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT
);

CREATE TABLE vou_intermediary_calculation_details (
    document_id varchar(26) PRIMARY KEY,
    entity varchar(32) NOT NULL DEFAULT 'intermediary-calculation'
        CHECK (entity = 'intermediary-calculation'),
    period_start date NOT NULL,
    period_end date NOT NULL,
    source_hash char(64) NOT NULL CHECK (source_hash ~ '^[a-f0-9]{64}$'),
    source_snapshot jsonb NOT NULL CHECK (jsonb_typeof(source_snapshot) = 'object'),
    script_id varchar(26) NOT NULL,
    script_revision bigint NOT NULL CHECK (script_revision > 0),
    script_name varchar(200) NOT NULL CHECK (length(btrim(script_name)) BETWEEN 1 AND 200),
    script_source text NOT NULL CHECK (length(script_source) BETWEEN 1 AND 100000),
    script_hash char(64) NOT NULL CHECK (script_hash ~ '^[a-f0-9]{64}$'),
    result_snapshot jsonb NOT NULL CHECK (jsonb_typeof(result_snapshot) = 'object'),
    FOREIGN KEY (document_id, entity) REFERENCES vou_documents(id, entity) ON DELETE RESTRICT,
    CHECK (period_start = date_trunc('month', period_end)::date),
    CHECK (period_end = (date_trunc('month', period_end) + interval '1 month - 1 day')::date)
);

CREATE UNIQUE INDEX vou_intermediary_calculation_period_uq
    ON vou_documents (business_date)
    WHERE entity = 'intermediary-calculation';

CREATE TABLE vou_intermediary_calculation_lines (
    id varchar(26) PRIMARY KEY,
    document_id varchar(26) NOT NULL
        REFERENCES vou_intermediary_calculation_details(document_id) ON DELETE RESTRICT,
    line_no integer NOT NULL CHECK (line_no > 0),
    source_signoff_line_id varchar(26) NOT NULL
        REFERENCES vou_sale_signoff_lines(id) ON DELETE RESTRICT,
    result jsonb NOT NULL CHECK (jsonb_typeof(result) = 'object'),
    employee_amount_cents bigint NOT NULL CHECK (employee_amount_cents >= 0),
    intermediary_amount_cents bigint NOT NULL CHECK (intermediary_amount_cents >= 0),
    rebate_amount_cents bigint NOT NULL CHECK (rebate_amount_cents >= 0),
    UNIQUE (document_id, line_no),
    UNIQUE (document_id, source_signoff_line_id)
);

CREATE TABLE vou_intermediary_calculation_summaries (
    id varchar(26) PRIMARY KEY,
    document_id varchar(26) NOT NULL
        REFERENCES vou_intermediary_calculation_details(document_id) ON DELETE RESTRICT,
    line_no integer NOT NULL CHECK (line_no > 0),
    category varchar(32) NOT NULL CHECK (category IN ('COMMISSION','INTERMEDIARY','REBATE')),
    payee_entity varchar(16) NOT NULL CHECK (payee_entity IN ('customer','employee','other-party')),
    payee_object_id varchar(26) NOT NULL,
    payee_version_id varchar(26) NOT NULL,
    payee_code varchar(64) NOT NULL,
    payee_name varchar(200) NOT NULL,
    amount_cents bigint NOT NULL CHECK (amount_cents > 0),
    UNIQUE (document_id, line_no),
    UNIQUE (document_id, category, payee_entity, payee_object_id)
);

ALTER TABLE led_party_entries
    ADD COLUMN account_type varchar(32) NOT NULL DEFAULT 'TRADE'
        CHECK (account_type IN ('TRADE','OTHER_PAYABLE')),
    ADD COLUMN payable_category varchar(32)
        CHECK (payable_category IN ('COMMISSION','INTERMEDIARY','REBATE')),
    ADD CONSTRAINT led_party_entries_account_shape_ck CHECK (
        (account_type = 'TRADE' AND payable_category IS NULL)
        OR (account_type = 'OTHER_PAYABLE' AND payable_category IS NOT NULL)
    );

CREATE INDEX led_party_entries_other_payable_query_idx
    ON led_party_entries(generation_id, effective_date, payable_category, counterparty_object_id)
    WHERE account_type = 'OTHER_PAYABLE';

CREATE TABLE led_closing_other_payable (
    closing_id varchar(26) NOT NULL REFERENCES led_closings(id) ON DELETE RESTRICT,
    payable_category varchar(32) NOT NULL
        CHECK (payable_category IN ('COMMISSION','INTERMEDIARY','REBATE')),
    counterparty_entity varchar(16) NOT NULL
        CHECK (counterparty_entity IN ('customer','employee','other-party')),
    counterparty_object_id varchar(26) NOT NULL,
    counterparty_version_id varchar(26) NOT NULL,
    counterparty_code varchar(64) NOT NULL,
    counterparty_name varchar(200) NOT NULL,
    currency varchar(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
    amount_cents bigint NOT NULL CHECK (amount_cents < 0),
    PRIMARY KEY (closing_id, payable_category, counterparty_entity, counterparty_object_id, currency)
);

-- +goose StatementBegin
CREATE OR REPLACE FUNCTION vou_validate_document_detail() RETURNS trigger AS $$
DECLARE target_id varchar(26); detail_count integer;
BEGIN
 IF TG_TABLE_NAME='vou_documents' THEN target_id:=CASE WHEN TG_OP='DELETE' THEN OLD.id ELSE NEW.id END;
 ELSE target_id:=CASE WHEN TG_OP='DELETE' THEN OLD.document_id ELSE NEW.document_id END; END IF;
 IF NOT EXISTS (SELECT 1 FROM vou_documents WHERE id=target_id) THEN RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END; END IF;
 SELECT (SELECT count(*) FROM vou_sale_pricing_details WHERE document_id=target_id)+(SELECT count(*) FROM vou_purchase_inquiry_details WHERE document_id=target_id)+(SELECT count(*) FROM vou_sale_order_details WHERE document_id=target_id)+(SELECT count(*) FROM vou_sale_outbound_details WHERE document_id=target_id)+(SELECT count(*) FROM vou_sale_delivery_details WHERE document_id=target_id)+(SELECT count(*) FROM vou_sale_signoff_details WHERE document_id=target_id)+(SELECT count(*) FROM vou_sale_return_details WHERE document_id=target_id)+(SELECT count(*) FROM vou_purchase_order_details WHERE document_id=target_id)+(SELECT count(*) FROM vou_purchase_inbound_details WHERE document_id=target_id)+(SELECT count(*) FROM vou_purchase_return_details WHERE document_id=target_id)+(SELECT count(*) FROM vou_production_details WHERE document_id=target_id)+(SELECT count(*) FROM vou_inventory_count_details WHERE document_id=target_id)+(SELECT count(*) FROM vou_receipt_details WHERE document_id=target_id)+(SELECT count(*) FROM vou_payment_details WHERE document_id=target_id)+(SELECT count(*) FROM vou_expense_reimbursement_details WHERE document_id=target_id)+(SELECT count(*) FROM vou_expense_payment_details WHERE document_id=target_id)+(SELECT count(*) FROM vou_employee_loan_writeoff_details WHERE document_id=target_id)+(SELECT count(*) FROM vou_other_income_details WHERE document_id=target_id)+(SELECT count(*) FROM vou_asset_acquisition_details WHERE document_id=target_id)+(SELECT count(*) FROM vou_asset_depreciation_details WHERE document_id=target_id)+(SELECT count(*) FROM vou_asset_sale_details WHERE document_id=target_id)+(SELECT count(*) FROM vou_asset_liquidation_details WHERE document_id=target_id)+(SELECT count(*) FROM vou_bill_details WHERE document_id=target_id)+(SELECT count(*) FROM vou_intermediary_calculation_details WHERE document_id=target_id) INTO detail_count;
 IF detail_count<>1 THEN RAISE EXCEPTION 'VOU document must have exactly one typed detail row' USING ERRCODE='23514'; END IF;
 RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END; $$ LANGUAGE plpgsql;
-- +goose StatementEnd

CREATE CONSTRAINT TRIGGER vou_intermediary_calculation_detail_ck
    AFTER INSERT OR UPDATE OR DELETE ON vou_intermediary_calculation_details
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION vou_validate_document_detail();

-- +goose StatementBegin
WITH initial(source) AS (VALUES ($script$
globalThis.calculate = function calculate(input) {
  const number = (value) => Number(value || 0);
  const money = (value) => (Math.round((value + Number.EPSILON) * 100) / 100).toFixed(2);
  const quantity = (value) => (Math.round((value + Number.EPSILON) * 1000000) / 1000000).toString();
  const byEmployee = new Map();
  const byCustomerEmployee = new Map();
  const delayedRates = (term, delay, lowPrice) => {
    let baseRate = lowPrice ? 0 : 8;
    let lowRate = lowPrice ? 3 : 0;
    let premiumAllowed = true;
    if (term === 'MONTHLY_CURRENT') {
      baseRate = lowPrice ? 0 : 5;
      if (delay > 7) { baseRate = lowPrice ? 0 : 3; lowRate = 0; }
      if (delay > 20) { baseRate = 0; lowRate = 0; premiumAllowed = false; }
    } else if (term === 'ARRIVAL_30') {
      if (delay > 7) baseRate = lowPrice ? 0 : 3;
      if (delay > 15) { baseRate = 0; lowRate = 0; }
      if (delay > 20) premiumAllowed = false;
    } else if (term === 'MONTHLY_30') {
      if (delay > 7) baseRate = lowPrice ? 0 : 5;
      if (delay > 10) baseRate = lowPrice ? 0 : 3;
      if (delay > 20) { baseRate = 0; lowRate = 0; }
      if (delay > 30) premiumAllowed = false;
    } else if (term === 'MONTHLY_60') {
      if (delay > 0) baseRate = lowPrice ? 0 : 5;
      if (delay > 7) baseRate = lowPrice ? 0 : 3;
      if (delay > 30) { baseRate = 0; lowRate = 0; premiumAllowed = false; }
    } else if (term === 'MONTHLY_90') {
      baseRate = 0; lowRate = 0; premiumAllowed = false;
    } else {
      if (delay > 7) { baseRate = 0; lowRate = 0; }
      if (delay > 15) premiumAllowed = false;
    }
    return { baseRate, lowRate, premiumAllowed };
  };
  const rows = input.lines.map((line) => {
    const unitPrice = number(line.unitPrice);
    const referencePrice = number(line.referenceUnitPrice);
    const surcharge = number(line.settlementSurcharge);
    const rebatePrice = number(line.rebateUnitPrice);
    const pricingQuantity = number(line.pricingQuantity);
    const barrels = number(line.barrelQuantity);
    const premium = unitPrice - referencePrice - surcharge - rebatePrice;
    const special = line.specialApproval === true;
    const lowPrice = special || premium < 0;
    const rates = delayedRates(line.settlementTermCode, Number(line.collectionDelayDays), lowPrice);
    const base = barrels * rates.baseRate;
    const low = barrels * rates.lowRate;
    const premiumCommission = !lowPrice && !line.intermediary && rates.premiumAllowed
      ? barrels * Math.floor((premium + 0.000000001) / 0.05) * 2.5
      : 0;
    const maintenance = special ? 0 : barrels * 2;
    const intermediary = line.intermediary && premium > 0 && rates.premiumAllowed
      ? premium * pricingQuantity / 1.13
      : 0;
    const rebate = rebatePrice * pricingQuantity;
    const gross = base + low + premiumCommission + maintenance;
    const row = {
      sourceSignoffLineId: line.sourceSignoffLineId,
      premiumUnitPrice: money(premium),
      barrelQuantity: quantity(barrels),
      baseCommission: money(base),
      premiumCommission: money(premiumCommission),
      lowPriceCommission: money(low),
      marketMaintenanceSubsidy: money(maintenance),
      marketDevelopmentSubsidy: '0.00',
      billCost: '0.00',
      employeeAmount: money(gross),
      intermediaryAmount: money(intermediary),
      rebateAmount: money(rebate),
      note: [special ? '特批销售' : (lowPrice ? '低价销售' : ''),
        line.collectionDelayDays > 0 ? '延期' + line.collectionDelayDays + '天' : '',
        line.settlementTermCode === 'MONTHLY_90' ? '月结90天需单独审批' : ''].filter(Boolean).join('；')
    };
    const item = { source: line, result: row };
    const employeeKey = line.salesperson.objectId;
    const employeeGroup = byEmployee.get(employeeKey) || { lines: [], barrels: 0 };
    employeeGroup.lines.push(item);
    if (!special) employeeGroup.barrels += barrels;
    byEmployee.set(employeeKey, employeeGroup);
    const costKey = line.customer.objectId + ':' + line.salesperson.objectId;
    const costGroup = byCustomerEmployee.get(costKey) || { lines: [], bills: 0 };
    costGroup.lines.push(item);
    byCustomerEmployee.set(costKey, costGroup);
    return row;
  });
  for (const bill of input.bills) {
    const key = bill.customer.objectId + ':' + bill.salesperson.objectId;
    const group = byCustomerEmployee.get(key);
    if (group) group.bills += number(bill.faceAmount) * 0.03 * Number(bill.costDays) / 365;
  }
  for (const group of byEmployee.values()) {
    const ordinary = group.lines.find((item) => item.source.specialApproval !== true);
    const development = ordinary
      ? 1800 + Math.max(0, Math.floor((group.barrels - 300) / 100)) * 200
      : 0;
    if (ordinary) {
      ordinary.result.marketDevelopmentSubsidy = money(development);
      ordinary.result.employeeAmount = money(number(ordinary.result.employeeAmount) + development);
    }
  }
  for (const group of byCustomerEmployee.values()) {
    let remainingCost = group.bills;
    for (const item of group.lines) {
      const available = number(item.result.employeeAmount);
      const deducted = Math.min(available, remainingCost);
      item.result.billCost = money(deducted);
      item.result.employeeAmount = money(available - deducted);
      remainingCost -= deducted;
    }
    if (remainingCost > 0 && group.lines.length) {
      group.lines[0].result.billCost = money(number(group.lines[0].result.billCost) + remainingCost);
    }
  }
  const summaries = new Map();
  const add = (payee, category, amount) => {
    const rounded = number(money(number(amount)));
    if (!payee || rounded <= 0) return;
    const key = category + ':' + payee.entity + ':' + payee.objectId;
    const current = summaries.get(key);
    summaries.set(key, { payee, category, amount: money((current ? number(current.amount) : 0) + rounded) });
  };
  rows.forEach((row, index) => {
    const source = input.lines[index];
    add(source.salesperson, 'COMMISSION', row.employeeAmount);
    add(source.intermediary, 'INTERMEDIARY', row.intermediaryAmount);
    add(source.customer, 'REBATE', row.rebateAmount);
  });
  return { lines: rows, summaries: Array.from(summaries.values()) };
};
$script$))
INSERT INTO vou_intermediary_scripts(id,name,source,source_hash,updated_by)
SELECT '00000000000000000000005701','2026 居间计算规则',source,
       encode(sha256(convert_to(source,'UTF8')),'hex'),'01JAPPSYST3MACTR0000000000'
FROM initial;
-- +goose StatementEnd

INSERT INTO app_permissions(id,path,domain,entity,action,description,status,menu_order)
SELECT 'ICL'||substring(md5('/vou/intermediary-calculation/'||action),1,23),
       '/vou/intermediary-calculation/'||action,'vou','intermediary-calculation',action,
       description,'ENABLED',CASE WHEN action='query' THEN 45 ELSE NULL END
FROM (VALUES
    ('query','查询居间计算'),('get','查看居间计算'),('create','创建居间计算'),
    ('save','保存居间计算'),('check','核对居间计算'),('uncheck','反核对居间计算'),
    ('approve','批准居间计算'),('unapprove','反批准居间计算'),('delete','删除居间计算'),
    ('audit-history','查看居间计算审计'),('attachment-initiate','上传居间计算附件'),
    ('attachment-download','下载居间计算附件'),('attachment-remove','删除居间计算附件'),
    ('source','生成居间计算来源'),('script-get','读取居间计算脚本'),('script-save','保存居间计算脚本')
) AS x(action,description)
ON CONFLICT(path) DO NOTHING;

INSERT INTO app_permissions(id,path,domain,entity,action,description,status,menu_order)
VALUES
('00000000000000000000005702','/led/other-payable/query','led','other-payable','query','查询其它应付','ENABLED',44),
('00000000000000000000005703','/led/other-payable/balance','led','other-payable','balance','查询其它应付余额','ENABLED',NULL)
ON CONFLICT(path) DO NOTHING;

INSERT INTO app_role_permissions(role_id,permission_id,created_by)
SELECT role.id,permission.id,role.updated_by
FROM app_roles role CROSS JOIN app_permissions permission
WHERE role.code='superadmin'
  AND ((permission.domain='vou' AND permission.entity='intermediary-calculation')
       OR (permission.domain='led' AND permission.entity='other-payable'))
ON CONFLICT DO NOTHING;

INSERT INTO app_business_menu_items(
    id,parent_id,item_type,item_level,sort_order,display_name,icon,enabled,
    route_key,permission_code,revision,created_by,updated_by
) VALUES
('menu-route-intermediary-calculation','menu-group-sales','ROUTE',2,45,'居间计算','mdi-calculator-variant-outline',true,
 'vou/intermediary-calculation','/vou/intermediary-calculation/query',1,'01JAPPSYST3MACTR0000000000','01JAPPSYST3MACTR0000000000'),
('menu-route-other-payable','menu-group-accounting','ROUTE',2,20,'其它应付','mdi-account-cash-outline',true,
 'led/other-payable','/led/other-payable/query',1,'01JAPPSYST3MACTR0000000000','01JAPPSYST3MACTR0000000000')
ON CONFLICT(id) DO NOTHING;

-- +goose Down
-- +goose StatementBegin
DO $$
BEGIN
    RAISE EXCEPTION 'migration 00057 is irreversible; restore the database and previous image';
END
$$;
-- +goose StatementEnd

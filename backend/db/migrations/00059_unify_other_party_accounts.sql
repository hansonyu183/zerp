-- +goose Up

ALTER TABLE vou_documents DROP CONSTRAINT vou_documents_entity_check;
ALTER TABLE vou_documents DISABLE TRIGGER vou_parent_ck;
ALTER TABLE vou_audit_events DROP CONSTRAINT vou_audit_events_document_id_entity_fkey;
ALTER TABLE vou_receipt_details
    DROP CONSTRAINT vou_receipt_details_document_id_entity_fkey,
    DROP CONSTRAINT vou_receipt_details_entity_check,
    DROP CONSTRAINT vou_receipt_details_entity_party_check,
    ADD COLUMN other_category varchar(32)
        CHECK (other_category IN ('COMMISSION','INTERMEDIARY','REBATE')),
    ADD CONSTRAINT vou_receipt_details_other_category_ck CHECK (
        other_category IS NULL OR entity='other-receipt'
    );

ALTER TABLE vou_payment_details
    DROP CONSTRAINT vou_payment_details_document_id_entity_fkey,
    DROP CONSTRAINT vou_payment_details_entity_check,
    DROP CONSTRAINT vou_payment_details_entity_party_check,
    ADD COLUMN other_category varchar(32)
        CHECK (other_category IN ('COMMISSION','INTERMEDIARY','REBATE')),
    ADD CONSTRAINT vou_payment_details_other_category_ck CHECK (
        other_category IS NULL OR entity='other-payment'
    );

UPDATE vou_receipt_details SET entity=CASE entity
    WHEN 'customer-receipt' THEN 'sales-receipt'
    WHEN 'supplier-receipt' THEN 'purchase-refund'
    ELSE entity END;
UPDATE vou_payment_details SET entity=CASE entity
    WHEN 'customer-payment' THEN 'sales-refund'
    WHEN 'supplier-payment' THEN 'purchase-payment'
    ELSE entity END;
UPDATE vou_documents SET entity=CASE entity
    WHEN 'customer-receipt' THEN 'sales-receipt'
    WHEN 'supplier-receipt' THEN 'purchase-refund'
    WHEN 'customer-payment' THEN 'sales-refund'
    WHEN 'supplier-payment' THEN 'purchase-payment'
    ELSE entity END;
UPDATE vou_documents SET parent_entity=CASE parent_entity
    WHEN 'customer-receipt' THEN 'sales-receipt'
    WHEN 'supplier-receipt' THEN 'purchase-refund'
    WHEN 'customer-payment' THEN 'sales-refund'
    WHEN 'supplier-payment' THEN 'purchase-payment'
    ELSE parent_entity END;
UPDATE vou_audit_events SET entity=CASE entity
    WHEN 'customer-receipt' THEN 'sales-receipt'
    WHEN 'supplier-receipt' THEN 'purchase-refund'
    WHEN 'customer-payment' THEN 'sales-refund'
    WHEN 'supplier-payment' THEN 'purchase-payment'
    ELSE entity END;
UPDATE wfl_definition_nodes SET document_entity=CASE document_entity
    WHEN 'customer-receipt' THEN 'sales-receipt'
    WHEN 'supplier-receipt' THEN 'purchase-refund'
    WHEN 'customer-payment' THEN 'sales-refund'
    WHEN 'supplier-payment' THEN 'purchase-payment'
    ELSE document_entity END;
UPDATE wfl_node_instances SET document_entity=CASE document_entity
    WHEN 'customer-receipt' THEN 'sales-receipt'
    WHEN 'supplier-receipt' THEN 'purchase-refund'
    WHEN 'customer-payment' THEN 'sales-refund'
    WHEN 'supplier-payment' THEN 'purchase-payment'
    ELSE document_entity END;
DELETE FROM vou_number_counters WHERE entity IN (
    'receipt','payment','customer-receipt','supplier-receipt',
    'customer-payment','supplier-payment'
);

SET CONSTRAINTS ALL IMMEDIATE;
ALTER TABLE vou_documents ENABLE TRIGGER vou_parent_ck;

ALTER TABLE vou_documents
    ADD CONSTRAINT vou_documents_entity_check CHECK (entity IN (
        'sale-pricing','sale-order','sale-outbound','sale-delivery','sale-signoff','sale-return',
        'purchase-inquiry','purchase-order','purchase-inbound','purchase-return',
        'order-production','self-production','inventory-count',
        'sales-receipt','sales-refund','purchase-payment','purchase-refund',
        'other-receipt','other-payment','employee-loan','employee-repayment','employee-loan-writeoff',
        'expense-reimbursement','expense-payment','other-income',
        'asset-acquisition','asset-depreciation','asset-sale','asset-liquidation',
        'bill-receipt','bill-payment','bill-issue','bill-discount','bill-maturity',
        'intermediary-calculation','customer-order','procurement-order','goods-receipt',
        'delivery-note','signoff-note'
    ));
ALTER TABLE vou_receipt_details
    ADD CONSTRAINT vou_receipt_details_entity_check CHECK (entity IN (
        'sales-receipt','purchase-refund','other-receipt','employee-repayment'
    )),
    ADD CONSTRAINT vou_receipt_details_entity_party_check CHECK (
        (entity='sales-receipt' AND counterparty_entity='customer') OR
        (entity='purchase-refund' AND counterparty_entity='supplier') OR
        (entity='other-receipt' AND counterparty_entity IN ('customer','supplier','other-party','employee')) OR
        (entity='employee-repayment' AND counterparty_entity='employee')
    ),
    ADD CONSTRAINT vou_receipt_details_document_id_entity_fkey
        FOREIGN KEY(document_id,entity) REFERENCES vou_documents(id,entity) ON DELETE RESTRICT;
ALTER TABLE vou_payment_details
    ADD CONSTRAINT vou_payment_details_entity_check CHECK (entity IN (
        'sales-refund','purchase-payment','other-payment','employee-loan'
    )),
    ADD CONSTRAINT vou_payment_details_entity_party_check CHECK (
        (entity='sales-refund' AND counterparty_entity='customer') OR
        (entity='purchase-payment' AND counterparty_entity='supplier') OR
        (entity='other-payment' AND counterparty_entity IN ('customer','supplier','other-party','employee')) OR
        (entity='employee-loan' AND counterparty_entity='employee')
    ),
    ADD CONSTRAINT vou_payment_details_document_id_entity_fkey
        FOREIGN KEY(document_id,entity) REFERENCES vou_documents(id,entity) ON DELETE RESTRICT;
ALTER TABLE vou_audit_events
    ADD CONSTRAINT vou_audit_events_document_id_entity_fkey
        FOREIGN KEY(document_id,entity) REFERENCES vou_documents(id,entity) ON DELETE RESTRICT;

ALTER TABLE vou_asset_acquisition_details ADD COLUMN party_account_type varchar(16);
UPDATE vou_asset_acquisition_details detail
SET party_account_type=CASE
    WHEN document.status IN ('APPROVED','FINALIZED') THEN 'TRADE'
    ELSE 'OTHER'
END
FROM vou_documents document
WHERE document.id=detail.document_id;
ALTER TABLE vou_asset_acquisition_details
    ALTER COLUMN party_account_type SET DEFAULT 'OTHER',
    ALTER COLUMN party_account_type SET NOT NULL,
    ADD CONSTRAINT vou_asset_acquisition_details_party_account_type_check
        CHECK (party_account_type IN ('TRADE','OTHER'));
ALTER TABLE vou_asset_sale_details ADD COLUMN party_account_type varchar(16);
UPDATE vou_asset_sale_details detail
SET party_account_type=CASE
    WHEN document.status IN ('APPROVED','FINALIZED')
         AND detail.counterparty_entity='customer' THEN 'TRADE'
    ELSE 'OTHER'
END
FROM vou_documents document
WHERE document.id=detail.document_id;
ALTER TABLE vou_asset_sale_details
    ALTER COLUMN party_account_type SET DEFAULT 'OTHER',
    ALTER COLUMN party_account_type SET NOT NULL,
    ADD CONSTRAINT vou_asset_sale_details_party_account_type_check
        CHECK (party_account_type IN ('TRADE','OTHER'));

ALTER TABLE led_party_entries
    DROP CONSTRAINT led_party_entries_account_shape_ck,
    DROP CONSTRAINT led_party_entries_account_type_check,
    DROP CONSTRAINT led_party_entries_payable_category_check;
DROP INDEX led_party_entries_other_payable_query_idx;
ALTER TABLE led_party_entries RENAME COLUMN payable_category TO other_category;
UPDATE led_party_entries SET account_type='OTHER' WHERE account_type='OTHER_PAYABLE';
UPDATE led_party_entries SET source_entity=CASE source_entity
    WHEN 'customer-receipt' THEN 'sales-receipt'
    WHEN 'supplier-receipt' THEN 'purchase-refund'
    WHEN 'customer-payment' THEN 'sales-refund'
    WHEN 'supplier-payment' THEN 'purchase-payment'
    ELSE source_entity END;
UPDATE led_party_entries SET account_type='OTHER'
WHERE source_entity IN (
    'other-receipt','other-payment','employee-loan','employee-repayment',
    'employee-loan-writeoff','expense-reimbursement','expense-payment'
) OR counterparty_entity IN ('other-party','employee')
  OR (source_entity IN ('bill-issue','bill-discount') AND source_line_id='interest');
ALTER TABLE led_party_entries
    ADD CONSTRAINT led_party_entries_account_type_check CHECK (account_type IN ('TRADE','OTHER')),
    ADD CONSTRAINT led_party_entries_other_category_check
        CHECK (other_category IN ('COMMISSION','INTERMEDIARY','REBATE')),
    ADD CONSTRAINT led_party_entries_account_shape_ck CHECK (
        (account_type='TRADE' AND other_category IS NULL
            AND counterparty_entity IN ('customer','supplier'))
        OR (account_type='OTHER'
            AND counterparty_entity IN ('customer','supplier','other-party','employee'))
    );
CREATE INDEX led_party_entries_other_query_idx
    ON led_party_entries(generation_id,effective_date,other_category,counterparty_entity,counterparty_object_id)
    WHERE account_type='OTHER';

ALTER TABLE led_draft_party
    DROP CONSTRAINT led_draft_party_counterparty_entity_check,
    DROP CONSTRAINT led_draft_party_counterparty_entity_counterparty_object_id__key,
    ADD COLUMN account_type varchar(16) NOT NULL DEFAULT 'TRADE'
        CHECK (account_type IN ('TRADE','OTHER')),
    ADD CONSTRAINT led_draft_party_counterparty_entity_check
        CHECK (counterparty_entity IN ('customer','supplier','other-party','employee'));
UPDATE led_draft_party SET account_type='OTHER'
WHERE counterparty_entity IN ('other-party','employee');
ALTER TABLE led_draft_party
    ADD CONSTRAINT led_draft_party_account_shape_ck CHECK (
        account_type='OTHER' OR counterparty_entity IN ('customer','supplier')
    ),
    ADD CONSTRAINT led_draft_party_dimension_uq
        UNIQUE(account_type,counterparty_entity,counterparty_object_id,currency);

ALTER TABLE led_opening_party
    DROP CONSTRAINT led_opening_party_counterparty_entity_check,
    DROP CONSTRAINT led_opening_party_generation_id_counterparty_entity_counter_key,
    ADD COLUMN account_type varchar(16) NOT NULL DEFAULT 'TRADE'
        CHECK (account_type IN ('TRADE','OTHER')),
    ADD CONSTRAINT led_opening_party_counterparty_entity_check
        CHECK (counterparty_entity IN ('customer','supplier','other-party','employee'));
UPDATE led_opening_party SET account_type='OTHER'
WHERE counterparty_entity IN ('other-party','employee');
ALTER TABLE led_opening_party
    ADD CONSTRAINT led_opening_party_account_shape_ck CHECK (
        account_type='OTHER' OR counterparty_entity IN ('customer','supplier')
    ),
    ADD CONSTRAINT led_opening_party_dimension_uq
        UNIQUE(generation_id,account_type,counterparty_entity,counterparty_object_id,currency);

ALTER TABLE led_closing_party
    DROP CONSTRAINT led_closing_party_pkey,
    DROP CONSTRAINT led_closing_party_counterparty_entity_check,
    ADD COLUMN account_type varchar(16) NOT NULL DEFAULT 'TRADE'
        CHECK (account_type IN ('TRADE','OTHER')),
    ADD CONSTRAINT led_closing_party_counterparty_entity_check
        CHECK (counterparty_entity IN ('customer','supplier','other-party','employee')),
    ADD CONSTRAINT led_closing_party_account_shape_ck CHECK (
        account_type='OTHER' OR counterparty_entity IN ('customer','supplier')
    ),
    ADD PRIMARY KEY(closing_id,account_type,counterparty_entity,counterparty_object_id,currency);

INSERT INTO led_closing_party(
    closing_id,counterparty_entity,counterparty_object_id,counterparty_version_id,
    counterparty_code,counterparty_name,currency,amount_cents,account_type
)
SELECT closing_id,counterparty_entity,counterparty_object_id,
       max(counterparty_version_id),max(counterparty_code),max(counterparty_name),currency,
       sum(amount_cents)::bigint,'OTHER'
FROM led_closing_other_payable
GROUP BY closing_id,counterparty_entity,counterparty_object_id,currency
HAVING sum(amount_cents)<>0;
DROP TABLE led_closing_other_payable;

WITH replacement AS (
    SELECT id FROM app_permissions
    WHERE domain='led' AND entity='other' AND action IN ('query','balance')
), affected_roles AS (
    SELECT DISTINCT role_permission.role_id,replacement.id AS permission_id,
           role_permission.created_by
    FROM app_role_permissions role_permission
    JOIN app_permissions old_permission ON old_permission.id=role_permission.permission_id
    CROSS JOIN replacement
    WHERE old_permission.domain='led'
      AND old_permission.entity IN ('employee','other-payable')
      AND old_permission.action=(SELECT action FROM app_permissions WHERE id=replacement.id)
)
INSERT INTO app_role_permissions(role_id,permission_id,created_by)
SELECT role_id,permission_id,created_by FROM affected_roles
ON CONFLICT DO NOTHING;

DELETE FROM app_role_permissions WHERE permission_id IN (
    SELECT id FROM app_permissions
    WHERE domain='led' AND entity IN ('employee','other-payable')
);
DELETE FROM app_permissions
WHERE domain='led' AND entity IN ('employee','other-payable');
UPDATE app_permissions
SET description=CASE action WHEN 'query' THEN '查询其他往来' ELSE '查询其他往来余额' END,
    menu_order=CASE action WHEN 'query' THEN 42 ELSE NULL END
WHERE domain='led' AND entity='other' AND action IN ('query','balance');

UPDATE app_permissions SET
    entity=CASE entity
        WHEN 'customer-receipt' THEN 'sales-receipt'
        WHEN 'supplier-receipt' THEN 'purchase-refund'
        WHEN 'customer-payment' THEN 'sales-refund'
        WHEN 'supplier-payment' THEN 'purchase-payment'
        ELSE entity END,
    path='/'||domain||'/'||(CASE entity
        WHEN 'customer-receipt' THEN 'sales-receipt'
        WHEN 'supplier-receipt' THEN 'purchase-refund'
        WHEN 'customer-payment' THEN 'sales-refund'
        WHEN 'supplier-payment' THEN 'purchase-payment'
        ELSE entity END)||'/'||action,
    description=replace(replace(replace(replace(description,
        '往来收款-客户','销售收款'),'往来收款-供应商','采购退款'),
        '往来付款-客户','销售退款'),'往来付款-供应商','采购付款')
WHERE domain='vou' AND entity IN (
    'customer-receipt','supplier-receipt','customer-payment','supplier-payment'
);

DELETE FROM app_business_menu_items
WHERE route_key IN ('led/employee','led/other-payable');
UPDATE app_business_menu_items
SET display_name='其他往来',permission_code='/led/other/query',updated_at=now(),
    updated_by='01JAPPSYST3MACTR0000000000'
WHERE route_key='led/other';
UPDATE app_business_menu_items SET
    route_key=CASE route_key
        WHEN 'vou/customer-receipt' THEN 'vou/sales-receipt'
        WHEN 'vou/supplier-receipt' THEN 'vou/purchase-refund'
        WHEN 'vou/customer-payment' THEN 'vou/sales-refund'
        WHEN 'vou/supplier-payment' THEN 'vou/purchase-payment'
        ELSE route_key END,
    permission_code=CASE permission_code
        WHEN '/vou/customer-receipt/query' THEN '/vou/sales-receipt/query'
        WHEN '/vou/supplier-receipt/query' THEN '/vou/purchase-refund/query'
        WHEN '/vou/customer-payment/query' THEN '/vou/sales-refund/query'
        WHEN '/vou/supplier-payment/query' THEN '/vou/purchase-payment/query'
        ELSE permission_code END,
    display_name=CASE route_key
        WHEN 'vou/customer-receipt' THEN '销售收款'
        WHEN 'vou/supplier-receipt' THEN '采购退款'
        WHEN 'vou/customer-payment' THEN '销售退款'
        WHEN 'vou/supplier-payment' THEN '采购付款'
        ELSE display_name END,
    updated_at=now(),updated_by='01JAPPSYST3MACTR0000000000'
WHERE route_key IN (
    'vou/customer-receipt','vou/supplier-receipt','vou/customer-payment','vou/supplier-payment'
);

UPDATE led_control
SET rebuild_required=true,revision=revision+1,updated_at=now(),
    updated_by='01JAPPSYST3MACTR0000000000'
WHERE singleton=true;

-- +goose Down
-- +goose StatementBegin
DO $$
BEGIN
    RAISE EXCEPTION 'migration 00059 is irreversible; restore the database and previous image';
END
$$;
-- +goose StatementEnd

-- +goose Up

ALTER TABLE vou_documents
    DROP CONSTRAINT vou_documents_entity_check,
    ADD CONSTRAINT vou_documents_entity_check CHECK (entity IN (
        'sale-pricing', 'sale-order', 'sale-outbound', 'sale-delivery', 'sale-signoff', 'sale-return',
        'purchase-inquiry', 'purchase-order', 'purchase-inbound', 'purchase-return',
        'order-production', 'self-production', 'inventory-count',
        'receipt', 'payment',
        'customer-receipt', 'supplier-receipt', 'other-receipt',
        'customer-payment', 'supplier-payment', 'other-payment',
        'employee-loan', 'employee-repayment', 'employee-loan-writeoff',
        'expense-reimbursement', 'expense-payment', 'other-income',
        'customer-order', 'procurement-order', 'goods-receipt', 'delivery-note', 'signoff-note'
    ));

ALTER TABLE vou_receipt_details
    DROP CONSTRAINT vou_receipt_details_document_id_entity_fkey,
    DROP CONSTRAINT vou_receipt_details_entity_check,
    DROP CONSTRAINT vou_receipt_details_counterparty_entity_check,
    DROP CONSTRAINT vou_receipt_details_entity_party_check;
ALTER TABLE vou_receipt_details
    ADD CONSTRAINT vou_receipt_details_entity_check CHECK (entity IN (
        'receipt','customer-receipt','supplier-receipt','other-receipt','employee-repayment'
    )),
    ADD CONSTRAINT vou_receipt_details_counterparty_entity_check CHECK (
        counterparty_entity IN ('customer','supplier','other-party','employee')
    ),
    ADD CONSTRAINT vou_receipt_details_entity_party_check CHECK (
        (entity='customer-receipt' AND counterparty_entity='customer') OR
        (entity='supplier-receipt' AND counterparty_entity='supplier') OR
        (entity='other-receipt' AND counterparty_entity='other-party') OR
        (entity='employee-repayment' AND counterparty_entity='employee') OR
        (entity='receipt' AND counterparty_entity IN ('customer','supplier'))
    ),
    ADD CONSTRAINT vou_receipt_details_document_id_entity_fkey
        FOREIGN KEY(document_id,entity) REFERENCES vou_documents(id,entity) ON DELETE RESTRICT;

ALTER TABLE vou_payment_details
    DROP CONSTRAINT vou_payment_details_document_id_entity_fkey,
    DROP CONSTRAINT vou_payment_details_entity_check,
    DROP CONSTRAINT vou_payment_details_counterparty_entity_check,
    DROP CONSTRAINT vou_payment_details_entity_party_check;
ALTER TABLE vou_payment_details
    ADD CONSTRAINT vou_payment_details_entity_check CHECK (entity IN (
        'payment','customer-payment','supplier-payment','other-payment','employee-loan'
    )),
    ADD CONSTRAINT vou_payment_details_counterparty_entity_check CHECK (
        counterparty_entity IN ('customer','supplier','other-party','employee')
    ),
    ADD CONSTRAINT vou_payment_details_entity_party_check CHECK (
        (entity='customer-payment' AND counterparty_entity='customer') OR
        (entity='supplier-payment' AND counterparty_entity='supplier') OR
        (entity='other-payment' AND counterparty_entity='other-party') OR
        (entity='employee-loan' AND counterparty_entity='employee') OR
        (entity='payment' AND counterparty_entity IN ('customer','supplier'))
    ),
    ADD CONSTRAINT vou_payment_details_document_id_entity_fkey
        FOREIGN KEY(document_id,entity) REFERENCES vou_documents(id,entity) ON DELETE RESTRICT;

CREATE TABLE vou_employee_loan_writeoff_details (
    document_id varchar(26) PRIMARY KEY,
    entity varchar(32) NOT NULL DEFAULT 'employee-loan-writeoff'
        CHECK (entity='employee-loan-writeoff'),
    employee_object_id varchar(26) NOT NULL,
    employee_version_id varchar(26) NOT NULL,
    employee_code varchar(64) NOT NULL,
    employee_name varchar(200) NOT NULL,
    FOREIGN KEY(document_id,entity) REFERENCES vou_documents(id,entity) ON DELETE RESTRICT
);

ALTER TABLE vou_expense_lines
    DROP CONSTRAINT vou_expense_lines_document_entity_check,
    ADD CONSTRAINT vou_expense_lines_document_entity_check CHECK (
        document_entity IN ('expense-reimbursement','employee-loan-writeoff')
    );

-- +goose StatementBegin
CREATE OR REPLACE FUNCTION vou_validate_document_detail() RETURNS trigger AS $$
DECLARE target_id varchar(26); detail_count integer;
BEGIN
    IF TG_TABLE_NAME='vou_documents' THEN target_id:=CASE WHEN TG_OP='DELETE' THEN OLD.id ELSE NEW.id END;
    ELSE target_id:=CASE WHEN TG_OP='DELETE' THEN OLD.document_id ELSE NEW.document_id END; END IF;
    IF NOT EXISTS (SELECT 1 FROM vou_documents WHERE id=target_id) THEN RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END; END IF;
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
         + (SELECT count(*) FROM vou_inventory_count_details WHERE document_id=target_id)
         + (SELECT count(*) FROM vou_receipt_details WHERE document_id=target_id)
         + (SELECT count(*) FROM vou_payment_details WHERE document_id=target_id)
         + (SELECT count(*) FROM vou_expense_reimbursement_details WHERE document_id=target_id)
         + (SELECT count(*) FROM vou_expense_payment_details WHERE document_id=target_id)
         + (SELECT count(*) FROM vou_employee_loan_writeoff_details WHERE document_id=target_id)
         + (SELECT count(*) FROM vou_other_income_details WHERE document_id=target_id) INTO detail_count;
    IF detail_count<>1 THEN RAISE EXCEPTION 'VOU document must have exactly one typed detail row' USING ERRCODE='23514'; END IF;
    RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END;
$$ LANGUAGE plpgsql;
-- +goose StatementEnd

CREATE CONSTRAINT TRIGGER vou_employee_loan_writeoff_detail_ck
    AFTER INSERT OR UPDATE OR DELETE ON vou_employee_loan_writeoff_details
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION vou_validate_document_detail();

ALTER TABLE led_party_entries DROP CONSTRAINT led_party_entries_counterparty_entity_check;
ALTER TABLE led_party_entries ADD CONSTRAINT led_party_entries_counterparty_entity_check
    CHECK (counterparty_entity IN ('customer','supplier','other-party','employee'));

INSERT INTO app_permissions(id,path,domain,entity,action,description,status)
SELECT 'PS' || substring(md5('/' || target.domain || '/' || target.entity || '/' || source.action),1,24),
       '/' || target.domain || '/' || target.entity || '/' || source.action,
       target.domain,target.entity,source.action,source.description,'ENABLED'
FROM app_permissions source
CROSS JOIN (VALUES
    ('vou','other-payment','employee-loan'),
    ('vou','other-receipt','employee-repayment'),
    ('vou','expense-reimbursement','employee-loan-writeoff'),
    ('led','other','employee')
) target(domain,source_entity,entity)
WHERE source.domain=target.domain AND source.entity=target.source_entity
ON CONFLICT(path) DO NOTHING;

-- +goose Down

-- +goose StatementBegin
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM vou_documents WHERE entity IN ('employee-loan','employee-repayment','employee-loan-writeoff')) OR
       EXISTS (SELECT 1 FROM led_party_entries WHERE counterparty_entity='employee') THEN
        RAISE EXCEPTION 'cannot roll back employee loans while employee transaction data exists';
    END IF;
END $$;
-- +goose StatementEnd

DELETE FROM app_role_permissions WHERE permission_id IN (
    SELECT id FROM app_permissions WHERE
      (domain='vou' AND entity IN ('employee-loan','employee-repayment','employee-loan-writeoff')) OR
      (domain='led' AND entity='employee')
);
DELETE FROM app_permissions WHERE
  (domain='vou' AND entity IN ('employee-loan','employee-repayment','employee-loan-writeoff')) OR
  (domain='led' AND entity='employee');

ALTER TABLE led_party_entries DROP CONSTRAINT led_party_entries_counterparty_entity_check;
ALTER TABLE led_party_entries ADD CONSTRAINT led_party_entries_counterparty_entity_check
    CHECK (counterparty_entity IN ('customer','supplier','other-party'));

DROP TRIGGER vou_employee_loan_writeoff_detail_ck ON vou_employee_loan_writeoff_details;
DROP TABLE vou_employee_loan_writeoff_details;
ALTER TABLE vou_expense_lines
    DROP CONSTRAINT vou_expense_lines_document_entity_check,
    ADD CONSTRAINT vou_expense_lines_document_entity_check CHECK (document_entity='expense-reimbursement');

-- +goose StatementBegin
CREATE OR REPLACE FUNCTION vou_validate_document_detail() RETURNS trigger AS $$
DECLARE target_id varchar(26); detail_count integer;
BEGIN
    IF TG_TABLE_NAME='vou_documents' THEN target_id:=CASE WHEN TG_OP='DELETE' THEN OLD.id ELSE NEW.id END;
    ELSE target_id:=CASE WHEN TG_OP='DELETE' THEN OLD.document_id ELSE NEW.document_id END; END IF;
    IF NOT EXISTS (SELECT 1 FROM vou_documents WHERE id=target_id) THEN RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END; END IF;
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
         + (SELECT count(*) FROM vou_inventory_count_details WHERE document_id=target_id)
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

ALTER TABLE vou_receipt_details
    DROP CONSTRAINT vou_receipt_details_document_id_entity_fkey,
    DROP CONSTRAINT vou_receipt_details_entity_check,
    DROP CONSTRAINT vou_receipt_details_counterparty_entity_check,
    DROP CONSTRAINT vou_receipt_details_entity_party_check;
ALTER TABLE vou_receipt_details
    ADD CONSTRAINT vou_receipt_details_entity_check CHECK (entity IN ('receipt','customer-receipt','supplier-receipt','other-receipt')),
    ADD CONSTRAINT vou_receipt_details_counterparty_entity_check CHECK (counterparty_entity IN ('customer','supplier','other-party')),
    ADD CONSTRAINT vou_receipt_details_entity_party_check CHECK (
        (entity='customer-receipt' AND counterparty_entity='customer') OR
        (entity='supplier-receipt' AND counterparty_entity='supplier') OR
        (entity='other-receipt' AND counterparty_entity='other-party') OR
        (entity='receipt' AND counterparty_entity IN ('customer','supplier'))
    ),
    ADD CONSTRAINT vou_receipt_details_document_id_entity_fkey
        FOREIGN KEY(document_id,entity) REFERENCES vou_documents(id,entity) ON DELETE RESTRICT;

ALTER TABLE vou_payment_details
    DROP CONSTRAINT vou_payment_details_document_id_entity_fkey,
    DROP CONSTRAINT vou_payment_details_entity_check,
    DROP CONSTRAINT vou_payment_details_counterparty_entity_check,
    DROP CONSTRAINT vou_payment_details_entity_party_check;
ALTER TABLE vou_payment_details
    ADD CONSTRAINT vou_payment_details_entity_check CHECK (entity IN ('payment','customer-payment','supplier-payment','other-payment')),
    ADD CONSTRAINT vou_payment_details_counterparty_entity_check CHECK (counterparty_entity IN ('customer','supplier','other-party')),
    ADD CONSTRAINT vou_payment_details_entity_party_check CHECK (
        (entity='customer-payment' AND counterparty_entity='customer') OR
        (entity='supplier-payment' AND counterparty_entity='supplier') OR
        (entity='other-payment' AND counterparty_entity='other-party') OR
        (entity='payment' AND counterparty_entity IN ('customer','supplier'))
    ),
    ADD CONSTRAINT vou_payment_details_document_id_entity_fkey
        FOREIGN KEY(document_id,entity) REFERENCES vou_documents(id,entity) ON DELETE RESTRICT;

ALTER TABLE vou_documents
    DROP CONSTRAINT vou_documents_entity_check,
    ADD CONSTRAINT vou_documents_entity_check CHECK (entity IN (
        'sale-pricing', 'sale-order', 'sale-outbound', 'sale-delivery', 'sale-signoff', 'sale-return',
        'purchase-inquiry', 'purchase-order', 'purchase-inbound', 'purchase-return',
        'order-production', 'self-production', 'inventory-count', 'receipt', 'payment',
        'customer-receipt', 'supplier-receipt', 'other-receipt',
        'customer-payment', 'supplier-payment', 'other-payment',
        'expense-reimbursement', 'expense-payment', 'other-income',
        'customer-order', 'procurement-order', 'goods-receipt', 'delivery-note', 'signoff-note'
    ));

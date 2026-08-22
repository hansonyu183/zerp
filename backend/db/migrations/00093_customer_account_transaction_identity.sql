-- +goose Up

-- Customer Account is the only transactional customer identity.  Relationship
-- objects remain master-data lifecycle records and cannot be persisted in VOU.
ALTER TABLE vou_receipt_details
    DROP CONSTRAINT vou_receipt_details_counterparty_entity_check,
    DROP CONSTRAINT vou_receipt_details_entity_party_check,
    ADD CONSTRAINT vou_receipt_details_counterparty_entity_check
        CHECK (counterparty_entity IN ('customer-account','supplier','other-unit','employee')),
    ADD CONSTRAINT vou_receipt_details_entity_party_check CHECK (
        (entity='sales-receipt' AND counterparty_entity='customer-account') OR
        (entity='purchase-refund' AND counterparty_entity='supplier') OR
        (entity='other-receipt' AND counterparty_entity IN ('customer-account','supplier','other-unit','employee')) OR
        (entity='employee-repayment' AND counterparty_entity='employee')
    );
ALTER TABLE vou_payment_details
    DROP CONSTRAINT vou_payment_details_counterparty_entity_check,
    DROP CONSTRAINT vou_payment_details_entity_party_check,
    ADD CONSTRAINT vou_payment_details_counterparty_entity_check
        CHECK (counterparty_entity IN ('customer-account','supplier','other-unit','employee')),
    ADD CONSTRAINT vou_payment_details_entity_party_check CHECK (
        (entity='sales-refund' AND counterparty_entity='customer-account') OR
        (entity='purchase-payment' AND counterparty_entity='supplier') OR
        (entity='other-payment' AND counterparty_entity IN ('customer-account','supplier','other-unit','employee')) OR
        (entity='employee-loan' AND counterparty_entity='employee')
    );
ALTER TABLE vou_other_income_details
    DROP CONSTRAINT vou_other_income_details_counterparty_entity_check,
    ADD CONSTRAINT vou_other_income_details_counterparty_entity_check
        CHECK (counterparty_entity IN ('customer-account','supplier'));
ALTER TABLE vou_asset_sale_details
    DROP CONSTRAINT vou_asset_sale_details_counterparty_entity_check,
    ADD CONSTRAINT vou_asset_sale_details_counterparty_entity_check
        CHECK (counterparty_entity IN ('customer-account','other-unit'));
ALTER TABLE vou_bill_details
    DROP CONSTRAINT vou_bill_details_counterparty_entity_check,
    DROP CONSTRAINT vou_bill_details_check4,
    ADD CONSTRAINT vou_bill_details_counterparty_entity_check
        CHECK (counterparty_entity IN ('customer-account','supplier','other-unit')),
    ADD CONSTRAINT vou_bill_details_customer_receipt_ck CHECK (
        entity<>'bill-receipt' OR (
            counterparty_entity='customer-account' AND handler_object_id IS NOT NULL
            AND maturity_type='NONE' AND interest_mode='NONE'
            AND interest_party_entity IS NULL AND with_recourse=false
        )
    );
ALTER TABLE vou_intermediary_calculation_summaries
    DROP CONSTRAINT vou_intermediary_calculation_summaries_payee_entity_check,
    ADD CONSTRAINT vou_intermediary_calculation_summaries_payee_entity_check
        CHECK (payee_entity IN ('customer-account','employee','sales-partner','other-unit'));

SELECT rpt_validate_current_reports();

-- +goose Down
-- +goose StatementBegin
DO $$ BEGIN RAISE EXCEPTION '00093 customer account transaction cutover is irreversible'; END $$;
-- +goose StatementEnd

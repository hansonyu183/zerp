-- +goose Up

-- Sales Relationship remains the settlement identity after intermediary
-- income is approved. Other receipts and payments therefore accept the same
-- typed relationship instead of falling back to Party or Service Relationship.
ALTER TABLE vou_receipt_details
    DROP CONSTRAINT vou_receipt_details_counterparty_entity_check,
    DROP CONSTRAINT vou_receipt_details_entity_party_check,
    ADD CONSTRAINT vou_receipt_details_counterparty_entity_check
        CHECK (counterparty_entity IN ('customer-account','supplier','other-unit','employee','sales-partner')),
    ADD CONSTRAINT vou_receipt_details_entity_party_check CHECK (
        (entity='sales-receipt' AND counterparty_entity='customer-account') OR
        (entity='purchase-refund' AND counterparty_entity='supplier') OR
        (entity='other-receipt' AND counterparty_entity IN ('customer-account','supplier','other-unit','employee','sales-partner')) OR
        (entity='employee-repayment' AND counterparty_entity='employee')
    );

ALTER TABLE vou_payment_details
    DROP CONSTRAINT vou_payment_details_counterparty_entity_check,
    DROP CONSTRAINT vou_payment_details_entity_party_check,
    ADD CONSTRAINT vou_payment_details_counterparty_entity_check
        CHECK (counterparty_entity IN ('customer-account','supplier','other-unit','employee','sales-partner')),
    ADD CONSTRAINT vou_payment_details_entity_party_check CHECK (
        (entity='sales-refund' AND counterparty_entity='customer-account') OR
        (entity='purchase-payment' AND counterparty_entity='supplier') OR
        (entity='other-payment' AND counterparty_entity IN ('customer-account','supplier','other-unit','employee','sales-partner')) OR
        (entity='employee-loan' AND counterparty_entity='employee')
    );

SELECT rpt_validate_current_reports();

-- +goose Down
-- +goose StatementBegin
DO $$ BEGIN RAISE EXCEPTION '00096 sales-partner settlement cutover is irreversible'; END $$;
-- +goose StatementEnd

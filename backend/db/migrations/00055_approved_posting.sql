-- +goose Up
ALTER TABLE vou_documents
    ADD COLUMN posted_at timestamptz,
    ADD COLUMN posted_by varchar(26);

ALTER TABLE vou_documents
    ADD CONSTRAINT vou_documents_posting_audit_ck CHECK (
        (status IN ('DRAFT', 'CHECKED') AND posted_at IS NULL AND posted_by IS NULL)
        OR
        (status IN ('APPROVED', 'FINALIZED') AND posted_at IS NOT NULL AND posted_by IS NOT NULL)
    ) NOT VALID;

ALTER TABLE vou_documents DISABLE TRIGGER vou_documents_closing_guard;

UPDATE vou_documents
SET status = 'CHECKED',
    revision = revision + 1,
    approved_at = NULL,
    approved_by = NULL,
    updated_at = now(),
    updated_by = '01JAPPSYST3MACTR0000000000'
WHERE status = 'APPROVED'
  AND entity IN (
    'sale-outbound', 'sale-delivery', 'sale-signoff', 'sale-return',
    'purchase-inbound', 'purchase-return',
    'order-production', 'self-production', 'inventory-count',
    'receipt', 'payment',
    'customer-receipt', 'supplier-receipt', 'other-receipt',
    'customer-payment', 'supplier-payment', 'other-payment',
    'employee-loan', 'employee-repayment', 'employee-loan-writeoff',
    'expense-reimbursement', 'expense-payment', 'other-income',
    'asset-acquisition', 'asset-depreciation', 'asset-sale', 'asset-liquidation',
    'bill-receipt', 'bill-payment', 'bill-issue', 'bill-discount', 'bill-maturity'
  );

UPDATE vou_documents
SET posted_at = CASE status
        WHEN 'APPROVED' THEN approved_at
        ELSE executed_at
    END,
    posted_by = CASE status
        WHEN 'APPROVED' THEN approved_by
        ELSE executed_by
    END
WHERE status IN ('APPROVED', 'FINALIZED');

SET CONSTRAINTS vou_documents_detail_ck IMMEDIATE;

ALTER TABLE vou_documents ENABLE TRIGGER vou_documents_closing_guard;

ALTER TABLE vou_documents
    VALIDATE CONSTRAINT vou_documents_posting_audit_ck;

CREATE INDEX vou_documents_posted_replay_idx
    ON vou_documents(posted_at, id)
    WHERE status IN ('APPROVED', 'FINALIZED');

DELETE FROM app_role_permissions
WHERE permission_id IN (
    SELECT id FROM app_permissions
    WHERE domain = 'vou' AND action IN ('finalize', 'unfinalize')
);

DELETE FROM app_permissions
WHERE domain = 'vou' AND action IN ('finalize', 'unfinalize');

UPDATE led_control
SET rebuild_required = true,
    updated_at = now(),
    updated_by = '01JAPPSYST3MACTR0000000000'
WHERE singleton = true;

-- +goose Down
-- +goose StatementBegin
DO $$
BEGIN
    RAISE EXCEPTION
        'migration 00055 is irreversible; restore the database and previous image';
END
$$;
-- +goose StatementEnd

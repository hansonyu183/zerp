DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'vou_documents'
          AND column_name IN ('posted_at', 'posted_by')
    ) THEN
        RAISE EXCEPTION 'posting audit columns exist before migration';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM app_permissions
        WHERE domain = 'vou' AND action IN ('finalize', 'unfinalize')
    ) THEN
        RAISE EXCEPTION 'legacy completion permissions are missing before migration';
    END IF;
END $$;

UPDATE led_control
SET rebuild_required = false
WHERE singleton = true;

BEGIN;
SET CONSTRAINTS ALL DEFERRED;
INSERT INTO vou_documents (
    id, entity, document_no, status, business_date, currency, total_amount_cents,
    reviewed_at, reviewed_by, approved_at, approved_by, executed_at, executed_by,
    created_by, updated_by
) VALUES
    ('00000000000000000000000551', 'other-income', 'OIN-20550101-0001', 'DRAFT',
     '2055-01-01', 'CNY', 1, NULL, NULL, NULL, NULL, NULL, NULL,
     '01JAPPSYST3MACTR0000000000', '01JAPPSYST3MACTR0000000000'),
    ('00000000000000000000000552', 'other-income', 'OIN-20550101-0002', 'CHECKED',
     '2055-01-01', 'CNY', 1, '2055-01-01 01:00:00+00', '01JAPPSYST3MACTR0000000000',
     NULL, NULL, NULL, NULL,
     '01JAPPSYST3MACTR0000000000', '01JAPPSYST3MACTR0000000000'),
    ('00000000000000000000000553', 'other-income', 'OIN-20550101-0003', 'APPROVED',
     '2055-01-01', 'CNY', 1, '2055-01-01 01:00:00+00', '01JAPPSYST3MACTR0000000000',
     '2055-01-01 02:00:00+00', '01JAPPSYST3MACTR0000000000', NULL, NULL,
     '01JAPPSYST3MACTR0000000000', '01JAPPSYST3MACTR0000000000'),
    ('00000000000000000000000554', 'other-income', 'OIN-20550101-0004', 'FINALIZED',
     '2054-12-31', 'CNY', 1, '2054-12-31 01:00:00+00', '01JAPPSYST3MACTR0000000000',
     '2055-01-01 02:00:00+00', '01JAPPSYST3MACTR0000000000',
     '2055-01-01 03:00:00+00', '01JAPPSYST3MACTR0000000000',
     '01JAPPSYST3MACTR0000000000', '01JAPPSYST3MACTR0000000000'),
    ('00000000000000000000000555', 'sale-order', 'SOR-20550101-0001', 'APPROVED',
     '2055-01-01', 'CNY', 1, '2055-01-01 01:00:00+00', '01JAPPSYST3MACTR0000000000',
     '2055-01-01 02:00:00+00', '01JAPPSYST3MACTR0000000000', NULL, NULL,
     '01JAPPSYST3MACTR0000000000', '01JAPPSYST3MACTR0000000000');

INSERT INTO vou_other_income_details (
    document_id, source_name, fund_account_object_id, fund_account_version_id,
    fund_account_code, fund_account_name
) VALUES
    ('00000000000000000000000551', 'Migration fixture 1', '00000000000000000000001551', '00000000000000000000002551', 'FAC-551', 'Migration account'),
    ('00000000000000000000000552', 'Migration fixture 2', '00000000000000000000001551', '00000000000000000000002551', 'FAC-551', 'Migration account'),
    ('00000000000000000000000553', 'Migration fixture 3', '00000000000000000000001551', '00000000000000000000002551', 'FAC-551', 'Migration account'),
    ('00000000000000000000000554', 'Migration fixture 4', '00000000000000000000001551', '00000000000000000000002551', 'FAC-551', 'Migration account');

INSERT INTO vou_sale_order_details (
    document_id, customer_object_id, customer_version_id, customer_code, customer_name
) VALUES (
    '00000000000000000000000555', '00000000000000000000001555',
    '00000000000000000000002555', 'CUS-555', 'Migration customer'
);

SET CONSTRAINTS ALL IMMEDIATE;
COMMIT;

INSERT INTO led_closings (
    id, closing_date, opening_date, status, revision, closed_by, request_id
) VALUES (
    '00000000000000000000005501', '2054-12-31', '2055-01-01', 'ACTIVE', 1,
    '01JAPPSYST3MACTR0000000000', 'migration-00055-closed-period'
);

UPDATE led_control
SET last_closing_id = '00000000000000000000005501'
WHERE singleton = true;

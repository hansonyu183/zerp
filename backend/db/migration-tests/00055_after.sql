DO $$
DECLARE
    approved_status varchar(16);
    approved_revision bigint;
    legacy_approved_at timestamptz;
    legacy_approved_by varchar(26);
    approved_posted_at timestamptz;
    approved_posted_by varchar(26);
    finalized_posted_at timestamptz;
    finalized_posted_by varchar(26);
BEGIN
    IF (SELECT count(*) FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'vou_documents'
          AND column_name IN ('posted_at', 'posted_by')) <> 2 THEN
        RAISE EXCEPTION 'posting audit columns are missing after migration';
    END IF;

    IF EXISTS (
        SELECT 1 FROM vou_documents
        WHERE id IN ('00000000000000000000000551', '00000000000000000000000552')
          AND (posted_at IS NOT NULL OR posted_by IS NOT NULL)
    ) THEN
        RAISE EXCEPTION 'unposted documents received posting audit values';
    END IF;

    SELECT status, revision, approved_at, approved_by, posted_at, posted_by
    INTO approved_status, approved_revision, legacy_approved_at, legacy_approved_by,
         approved_posted_at, approved_posted_by
    FROM vou_documents WHERE id = '00000000000000000000000553';
    IF approved_status <> 'CHECKED' OR approved_revision <> 2
       OR legacy_approved_at IS NOT NULL OR legacy_approved_by IS NOT NULL
       OR approved_posted_at IS NOT NULL OR approved_posted_by IS NOT NULL THEN
        RAISE EXCEPTION 'legacy approved document was not returned for safe reapproval';
    END IF;

    IF (SELECT status FROM vou_documents
        WHERE id = '00000000000000000000000555') <> 'APPROVED'
       OR (SELECT posted_at FROM vou_documents
           WHERE id = '00000000000000000000000555') <>
          '2055-01-01 02:00:00+00'::timestamptz
       OR NOT (SELECT active FROM vou_settlement_reservations
               WHERE order_id = '00000000000000000000000555')
       OR (SELECT reserved_amount_cents FROM vou_settlement_reservations
           WHERE order_id = '00000000000000000000000555') <> 1 THEN
        RAISE EXCEPTION 'ledger-neutral approved order was not preserved';
    END IF;

    SELECT posted_at, posted_by
    INTO finalized_posted_at, finalized_posted_by
    FROM vou_documents WHERE id = '00000000000000000000000554';
    IF finalized_posted_at <> '2055-01-01 03:00:00+00'::timestamptz
       OR finalized_posted_by <> '01JAPPSYST3MACTR0000000000' THEN
        RAISE EXCEPTION 'finalized document posting audit was not backfilled from execution';
    END IF;

    IF EXISTS (
        SELECT 1 FROM app_permissions
        WHERE domain = 'vou' AND action IN ('finalize', 'unfinalize')
    ) THEN
        RAISE EXCEPTION 'legacy completion permissions remain after migration';
    END IF;

    IF NOT (SELECT rebuild_required FROM led_control WHERE singleton = true) THEN
        RAISE EXCEPTION 'ledger rebuild was not requested';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE schemaname = 'public'
          AND indexname = 'vou_documents_posted_replay_idx'
    ) THEN
        RAISE EXCEPTION 'posted replay index is missing';
    END IF;

    BEGIN
        UPDATE vou_documents
        SET posted_at = now(), posted_by = '01JAPPSYST3MACTR0000000000'
        WHERE id = '00000000000000000000000551';
        RAISE EXCEPTION 'draft document accepts posting audit values';
    EXCEPTION WHEN check_violation THEN NULL;
    END;

    BEGIN
        UPDATE vou_documents
        SET status = 'APPROVED',
            approved_at = '2055-01-01 02:00:00+00',
            approved_by = '01JAPPSYST3MACTR0000000000',
            posted_at = NULL,
            posted_by = NULL
        WHERE id = '00000000000000000000000553';
        RAISE EXCEPTION 'approved document accepts missing posting audit values';
    EXCEPTION WHEN check_violation THEN NULL;
    END;
END $$;

UPDATE led_control
SET last_closing_id = NULL
WHERE singleton = true;

DELETE FROM led_closings
WHERE id = '00000000000000000000005501';

BEGIN;
SET CONSTRAINTS ALL DEFERRED;
DELETE FROM vou_settlement_reservations
WHERE order_id = '00000000000000000000000555';

DELETE FROM vou_sale_order_details
WHERE document_id = '00000000000000000000000555';

DELETE FROM vou_other_income_details
WHERE document_id IN (
    '00000000000000000000000551',
    '00000000000000000000000552',
    '00000000000000000000000553',
    '00000000000000000000000554'
);

DELETE FROM vou_documents
WHERE id IN (
    '00000000000000000000000551',
    '00000000000000000000000552',
    '00000000000000000000000553',
    '00000000000000000000000554',
    '00000000000000000000000555'
);
SET CONSTRAINTS ALL IMMEDIATE;
COMMIT;

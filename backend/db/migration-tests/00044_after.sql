DO $$
BEGIN
    IF (SELECT count(*) FROM app_permissions
        WHERE domain='vou' AND entity IN ('employee-loan','employee-repayment','employee-loan-writeoff')) <> 45 THEN
        RAISE EXCEPTION 'migration 00044 did not create all employee voucher permissions';
    END IF;
    IF (SELECT count(*) FROM app_permissions
        WHERE domain='led' AND entity='employee' AND action IN ('query','balance')) <> 2 THEN
        RAISE EXCEPTION 'migration 00044 did not create employee ledger permissions';
    END IF;
    IF EXISTS (
        SELECT 1 FROM app_role_permissions rp
        JOIN app_permissions permission ON permission.id=rp.permission_id
        WHERE rp.role_id='01J0000000000000000000044R'
          AND ((permission.domain='vou' AND permission.entity IN ('employee-loan','employee-repayment','employee-loan-writeoff'))
            OR (permission.domain='led' AND permission.entity='employee'))
    ) THEN
        RAISE EXCEPTION 'migration 00044 unexpectedly granted employee transaction permissions';
    END IF;
    IF to_regclass('public.vou_employee_loan_writeoff_details') IS NULL THEN
        RAISE EXCEPTION 'migration 00044 did not create writeoff details';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname='vou_documents_entity_check'
          AND pg_get_constraintdef(oid) LIKE '%employee-loan-writeoff%'
          AND pg_get_constraintdef(oid) LIKE '%asset-liquidation%'
    ) THEN
        RAISE EXCEPTION 'migration 00044 did not preserve fixed asset voucher entities';
    END IF;
    IF pg_get_functiondef('vou_validate_document_detail()'::regprocedure)
        NOT LIKE '%vou_employee_loan_writeoff_details%'
       OR pg_get_functiondef('vou_validate_document_detail()'::regprocedure)
        NOT LIKE '%vou_asset_acquisition_details%' THEN
        RAISE EXCEPTION 'migration 00044 did not preserve typed-detail validation';
    END IF;
END
$$;

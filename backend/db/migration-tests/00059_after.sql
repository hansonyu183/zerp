DO $$
DECLARE
    fixture_role_id varchar(26);
BEGIN
    IF EXISTS (
        SELECT 1 FROM app_permissions
        WHERE domain='led' AND entity IN ('employee','other-payable')
    ) THEN
        RAISE EXCEPTION 'legacy ledger permissions remain';
    END IF;
    IF (SELECT count(*) FROM app_permissions
        WHERE domain='led' AND entity='other' AND action IN ('query','balance')) <> 2 THEN
        RAISE EXCEPTION 'unified other ledger permissions are incomplete';
    END IF;

    SELECT id INTO fixture_role_id FROM app_roles ORDER BY id LIMIT 1;
    IF (SELECT count(*) FROM app_role_permissions role_permission
        JOIN app_permissions permission ON permission.id=role_permission.permission_id
        WHERE role_permission.role_id=fixture_role_id
          AND permission.domain='led' AND permission.entity='other'
          AND permission.action IN ('query','balance')) <> 2 THEN
        RAISE EXCEPTION 'legacy ledger role permissions were not migrated';
    END IF;

    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema='public' AND table_name='led_party_entries'
          AND column_name='payable_category'
    ) OR NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema='public' AND table_name='led_party_entries'
          AND column_name='other_category'
    ) OR to_regclass('public.led_closing_other_payable') IS NOT NULL THEN
        RAISE EXCEPTION 'unified other ledger schema is incomplete';
    END IF;

    IF (SELECT entity FROM vou_documents
        WHERE id='00000000000000000000005901') <> 'sales-receipt'
       OR (SELECT entity FROM vou_receipt_details
           WHERE document_id='00000000000000000000005901') <> 'sales-receipt' THEN
        RAISE EXCEPTION 'sales receipt data was not renamed';
    END IF;

    IF (SELECT parent_entity FROM vou_documents
        WHERE id='00000000000000000000005908') <> 'sales-receipt'
       OR (SELECT parent_document_id FROM vou_documents
           WHERE id='00000000000000000000005908') <> '00000000000000000000005901' THEN
        RAISE EXCEPTION 'renamed parent reference was not preserved';
    END IF;
    IF (SELECT tgenabled FROM pg_trigger
        WHERE tgrelid='vou_documents'::regclass AND tgname='vou_parent_ck') <> 'O' THEN
        RAISE EXCEPTION 'parent immutability trigger was not restored';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM led_party_entries
        WHERE generation_id='00000000000000000000005920'
          AND id='00000000000000000000005921'
          AND account_type='OTHER' AND other_category='COMMISSION'
    ) THEN
        RAISE EXCEPTION 'other payable entry was not migrated';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM led_party_entries
        WHERE generation_id='00000000000000000000005920'
          AND id='00000000000000000000005925'
          AND account_type='OTHER' AND other_category IS NULL
    ) THEN
        RAISE EXCEPTION 'legacy unclassified other transaction was not migrated';
    END IF;

    IF (SELECT party_account_type FROM vou_asset_acquisition_details
        WHERE document_id='00000000000000000000005908') <> 'TRADE' THEN
        RAISE EXCEPTION 'legacy asset acquisition account type was not preserved';
    END IF;
    IF (SELECT party_account_type FROM vou_asset_acquisition_details
        WHERE document_id='00000000000000000000005953') <> 'OTHER' THEN
        RAISE EXCEPTION 'unposted asset acquisition did not adopt other account type';
    END IF;

    IF (SELECT party_account_type FROM vou_asset_sale_details
        WHERE document_id='00000000000000000000005934') <> 'OTHER'
       OR NOT EXISTS (
           SELECT 1 FROM led_party_entries
           WHERE generation_id='00000000000000000000005920'
             AND id='00000000000000000000005937'
             AND counterparty_entity='other-party'
             AND account_type='OTHER'
       ) THEN
        RAISE EXCEPTION 'legacy other-party asset sale was not preserved as other';
    END IF;

    IF (SELECT party_account_type FROM vou_asset_sale_details
        WHERE document_id='00000000000000000000005950') <> 'OTHER' THEN
        RAISE EXCEPTION 'unposted customer asset sale did not adopt other account type';
    END IF;

    IF (SELECT count(*) FROM led_party_entries
        WHERE generation_id='00000000000000000000005920'
          AND counterparty_entity='supplier'
          AND counterparty_object_id='00000000000000000000005915'
          AND account_type='TRADE') <> 2
       OR (SELECT COALESCE(sum(amount_delta_cents),0) FROM led_party_entries
           WHERE generation_id='00000000000000000000005920'
             AND counterparty_entity='supplier'
             AND counterparty_object_id='00000000000000000000005915'
             AND account_type='TRADE') <> 0
       OR EXISTS (
           SELECT 1 FROM led_party_entries
           WHERE generation_id='00000000000000000000005920'
             AND counterparty_entity='supplier'
             AND counterparty_object_id='00000000000000000000005915'
             AND account_type='OTHER'
       ) THEN
        RAISE EXCEPTION 'legacy settled asset transaction was split across account types';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM led_draft_party
        WHERE id='00000000000000000000005902'
          AND account_type='OTHER' AND counterparty_entity='other-party'
    ) THEN
        RAISE EXCEPTION 'legacy other-party draft balance was not migrated';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM led_opening_party
        WHERE generation_id='00000000000000000000005920'
          AND id='00000000000000000000005905'
          AND account_type='OTHER' AND counterparty_entity='other-party'
    ) THEN
        RAISE EXCEPTION 'legacy other-party opening balance was not migrated';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM led_closing_party
        WHERE closing_id='00000000000000000000005930'
          AND account_type='OTHER' AND counterparty_entity='employee'
          AND counterparty_object_id='00000000000000000000005923'
          AND currency='CNY' AND amount_cents=-150
    ) THEN
        RAISE EXCEPTION 'other payable closing balance was not merged';
    END IF;

    IF NOT (SELECT rebuild_required FROM led_control WHERE singleton=true) THEN
        RAISE EXCEPTION 'ledger rebuild was not requested';
    END IF;

    BEGIN
        INSERT INTO led_draft_party(
            id,account_type,counterparty_entity,counterparty_object_id,
            counterparty_version_id,counterparty_code,counterparty_name,
            currency,amount_cents
        ) VALUES (
            '00000000000000000000005940','TRADE','employee',
            '00000000000000000000005941','00000000000000000000005942',
            'EMP-INVALID','Invalid trade employee','CNY',100
        );
        RAISE EXCEPTION 'trade opening accepted an employee';
    EXCEPTION WHEN check_violation THEN NULL;
    END;

    INSERT INTO led_draft_party(
        id,account_type,counterparty_entity,counterparty_object_id,
        counterparty_version_id,counterparty_code,counterparty_name,
        currency,amount_cents
    ) VALUES (
        '00000000000000000000005943','OTHER','employee',
        '00000000000000000000005941','00000000000000000000005942',
        'EMP-OTHER','Other employee','CNY',100
    );
END $$;

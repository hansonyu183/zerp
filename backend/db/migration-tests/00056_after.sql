DO $$
BEGIN
    IF (SELECT rebate_unit_price_cents
        FROM bob_customer_versions
        WHERE version_id = '01J0000000000000000000566') <> 0 THEN
        RAISE EXCEPTION 'customer rebate unit price default is not zero';
    END IF;

    UPDATE bob_customer_versions
    SET rebate_unit_price_cents = 35,
        intermediary_other_party_id = '01J0000000000000000000563'
    WHERE version_id = '01J0000000000000000000566';

    IF NOT EXISTS (
        SELECT 1 FROM bob_version_views
        WHERE version_id = '01J0000000000000000000566'
          AND rebate_unit_price_cents = 35
          AND intermediary_other_party_id = '01J0000000000000000000563'
    ) THEN
        RAISE EXCEPTION 'customer intermediary attributes are not exposed by bob view';
    END IF;

    BEGIN
        UPDATE bob_customer_versions
        SET rebate_unit_price_cents = -1
        WHERE version_id = '01J0000000000000000000566';
        RAISE EXCEPTION 'negative rebate unit price was accepted';
    EXCEPTION WHEN check_violation THEN NULL;
    END;

    BEGIN
        UPDATE bob_customer_versions
        SET intermediary_other_party_id = '01J0000000000000000000599'
        WHERE version_id = '01J0000000000000000000566';
        SET CONSTRAINTS ALL IMMEDIATE;
        RAISE EXCEPTION 'missing intermediary object was accepted';
    EXCEPTION WHEN foreign_key_violation THEN
        SET CONSTRAINTS ALL DEFERRED;
    END;
END $$;

BEGIN;
SET CONSTRAINTS ALL DEFERRED;
DELETE FROM bob_customer_versions
WHERE version_id IN ('01J0000000000000000000564', '01J0000000000000000000566');
DELETE FROM bob_employee_versions
WHERE version_id = '01J0000000000000000000562';
DELETE FROM bob_versions
WHERE id IN (
    '01J0000000000000000000562',
    '01J0000000000000000000564',
    '01J0000000000000000000566'
);
DELETE FROM bob_objects
WHERE id IN (
    '01J0000000000000000000561',
    '01J0000000000000000000563',
    '01J0000000000000000000565'
);
COMMIT;

DO $$
BEGIN
    IF to_regclass('vou_service_contract_details') IS NULL
       OR to_regclass('vou_service_acceptance_details') IS NULL THEN
        RAISE EXCEPTION 'service-contract tables are missing';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM app_permissions WHERE path='/vou/service-contract/approve')
       OR NOT EXISTS (SELECT 1 FROM app_permissions WHERE path='/vou/service-acceptance/approve') THEN
        RAISE EXCEPTION 'service-contract permissions are missing';
    END IF;
END
$$;

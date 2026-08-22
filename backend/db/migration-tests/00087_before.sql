DO $$
BEGIN
    IF to_regclass('vou_service_contract_details') IS NOT NULL
       OR to_regclass('vou_service_acceptance_details') IS NOT NULL THEN
        RAISE EXCEPTION '00087 fixture requires no service-contract tables';
    END IF;
END
$$;

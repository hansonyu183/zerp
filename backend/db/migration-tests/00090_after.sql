DO $$
DECLARE definition text;
BEGIN
    SELECT pg_get_constraintdef(oid) INTO definition
    FROM pg_constraint
    WHERE conname = 'acc_subject_dimensions_dimension_check';
    IF definition IS NULL
       OR position('CUSTOMER_ACCOUNT' in definition) = 0
       OR position('SALES_RELATIONSHIP' in definition) = 0
       OR position('OTHER_PARTY' in definition) <> 0 THEN
        RAISE EXCEPTION '00090 typed accounting dimensions are incomplete';
    END IF;
END
$$;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM rpt_versions version
        JOIN rpt_definitions definition ON definition.id=version.definition_id
        WHERE definition.code IN ('customer-aging','supplier-aging','containers','employee-loans')
          AND (version.sql_text ~ '''(CUSTOMER|SUPPLIER|EMPLOYEE)'''
               OR version.parameters::text ~ '"referenceType": "(CUSTOMER|SUPPLIER|EMPLOYEE)"')
    ) THEN
        RAISE EXCEPTION '00090 built-in reports retain legacy relationship dimensions';
    END IF;
END
$$;

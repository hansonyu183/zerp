-- +goose Up

UPDATE acc_subject_dimensions
SET dimension = CASE dimension
    WHEN 'CUSTOMER' THEN 'CUSTOMER_ACCOUNT'
    WHEN 'SUPPLIER' THEN 'SUPPLIER_RELATIONSHIP'
    WHEN 'OTHER_PARTY' THEN 'SERVICE_RELATIONSHIP'
    WHEN 'EMPLOYEE' THEN 'EMPLOYMENT_RELATIONSHIP'
    ELSE dimension
END
WHERE dimension IN ('CUSTOMER', 'SUPPLIER', 'OTHER_PARTY', 'EMPLOYEE');

ALTER TABLE acc_subject_dimensions
    DROP CONSTRAINT acc_subject_dimensions_dimension_check;
ALTER TABLE acc_subject_dimensions
    ADD CONSTRAINT acc_subject_dimensions_dimension_check CHECK (dimension IN (
        'CUSTOMER_ACCOUNT', 'SUPPLIER_RELATIONSHIP', 'SERVICE_RELATIONSHIP',
        'EMPLOYMENT_RELATIONSHIP', 'SALES_RELATIONSHIP', 'DEPARTMENT',
        'PRODUCT', 'WAREHOUSE', 'FUND_ACCOUNT', 'ASSET', 'BILL'
    ));

-- Built-in reports are executable versioned SQL, so the dimension cutover must
-- update their stored definitions and reference parameter contracts together.
UPDATE rpt_versions
SET sql_text = replace(
        replace(
            replace(
                replace(sql_text, '''CUSTOMER''', '''CUSTOMER_ACCOUNT'''),
                '''SUPPLIER''', '''SUPPLIER_RELATIONSHIP'''),
            '''EMPLOYEE''', '''EMPLOYMENT_RELATIONSHIP'''),
        'entity=''customer''', 'entity=''customer-account'''),
    parameters = (
        SELECT coalesce(jsonb_agg(
            CASE parameter->>'referenceType'
                WHEN 'CUSTOMER' THEN jsonb_set(parameter, '{referenceType}', '"CUSTOMER_ACCOUNT"')
                WHEN 'SUPPLIER' THEN jsonb_set(parameter, '{referenceType}', '"SUPPLIER_RELATIONSHIP"')
                WHEN 'EMPLOYEE' THEN jsonb_set(parameter, '{referenceType}', '"EMPLOYMENT_RELATIONSHIP"')
                ELSE parameter
            END ORDER BY ordinal
        ), '[]'::jsonb)
        FROM jsonb_array_elements(rpt_versions.parameters) WITH ORDINALITY AS item(parameter, ordinal)
    )
WHERE definition_id IN (
    SELECT id FROM rpt_definitions
    WHERE code IN ('customer-aging','supplier-aging','containers','employee-loans')
);

SELECT rpt_validate_current_reports();

-- +goose Down

ALTER TABLE acc_subject_dimensions
    DROP CONSTRAINT acc_subject_dimensions_dimension_check;
ALTER TABLE acc_subject_dimensions
    ADD CONSTRAINT acc_subject_dimensions_dimension_check CHECK (dimension IN (
        'CUSTOMER_ACCOUNT', 'SUPPLIER_RELATIONSHIP', 'SERVICE_RELATIONSHIP',
        'EMPLOYMENT_RELATIONSHIP', 'DEPARTMENT', 'PRODUCT', 'WAREHOUSE',
        'FUND_ACCOUNT', 'ASSET', 'BILL'
    ));

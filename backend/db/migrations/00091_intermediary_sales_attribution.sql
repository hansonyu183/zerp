-- +goose Up

-- Sales attribution is an order fact.  Intermediary calculation must not
-- rediscover it from a customer or a mutable relationship.
ALTER TABLE vou_sale_order_details
    ADD COLUMN sales_attribution_type varchar(32),
    ADD COLUMN sales_attribution_subject_object_id varchar(26),
    ADD COLUMN sales_attribution_subject_version_id varchar(26),
    ADD COLUMN sales_attribution_subject_code varchar(64),
    ADD COLUMN sales_attribution_subject_name varchar(200);

UPDATE vou_sale_order_details order_detail
SET sales_attribution_type=customer.primary_sales_attribution_type,
    sales_attribution_subject_object_id=customer.primary_sales_subject_id,
    sales_attribution_subject_version_id=customer.primary_sales_subject_version_id,
    sales_attribution_subject_code=customer.primary_sales_subject_code,
    sales_attribution_subject_name=customer.primary_sales_subject_name
FROM bob_customer_versions customer
WHERE customer.version_id=order_detail.customer_version_id;

ALTER TABLE vou_sale_order_details
    ALTER COLUMN sales_attribution_type SET NOT NULL,
    ALTER COLUMN sales_attribution_subject_object_id SET NOT NULL,
    ALTER COLUMN sales_attribution_subject_version_id SET NOT NULL,
    ALTER COLUMN sales_attribution_subject_code SET NOT NULL,
    ALTER COLUMN sales_attribution_subject_name SET NOT NULL,
    ADD CONSTRAINT vou_sale_order_sales_attribution_ck CHECK (
        (sales_attribution_type='INTERNAL_EMPLOYEE')
        OR (sales_attribution_type IN ('EXTERNAL_PART_TIME','CHANNEL_PARTNER'))
    );

ALTER TABLE vou_intermediary_calculation_summaries
    DROP CONSTRAINT vou_intermediary_calculation_summaries_category_check,
    DROP CONSTRAINT vou_intermediary_calculation_summaries_payee_entity_check,
    ADD CONSTRAINT vou_intermediary_calculation_summaries_category_check
        CHECK (category IN ('COMMISSION','EXTERNAL_PART_TIME','CHANNEL_PARTNER','INTERMEDIARY','REBATE')),
    ADD CONSTRAINT vou_intermediary_calculation_summaries_payee_entity_check
        CHECK (payee_entity IN ('customer','employee','sales-partner','other-unit'));

-- The system script must consume the same source contract as the API. Bill
-- allocation is customer-scoped because bill receipts no longer rediscover a
-- mutable salesperson, while sales-partner summaries use their explicit
-- attribution capability as the payable classification.
-- +goose StatementBegin
DO $$
DECLARE updated_source text;
BEGIN
    SELECT source INTO updated_source
    FROM vou_intermediary_scripts
    WHERE id='00000000000000000000005701'
    FOR UPDATE;
    updated_source := replace(updated_source, 'byCustomerEmployee', 'byCustomer');
    updated_source := replace(updated_source,
        $find$line.customer.objectId + ':' + line.salesperson.objectId$find$,
        'line.customer.objectId');
    updated_source := replace(updated_source,
        $find$bill.customer.objectId + ':' + bill.salesperson.objectId$find$,
        'bill.customer.objectId');
    updated_source := replace(updated_source,
        'add(source.salesperson, ''COMMISSION'', row.employeeAmount);',
        'add(source.salesperson, source.salesAttributionType === ''INTERNAL_EMPLOYEE'' ? ''COMMISSION'' : source.salesAttributionType, row.employeeAmount);');
    UPDATE vou_intermediary_scripts
    SET source=updated_source,
        source_hash=encode(sha256(convert_to(updated_source,'UTF8')),'hex'),
        revision=revision+1,
        updated_at=now(),
        updated_by='01JAPPSYST3MACTR0000000000'
    WHERE id='00000000000000000000005701';
END $$;
-- +goose StatementEnd

SELECT rpt_validate_current_reports();

-- +goose Down
-- +goose StatementBegin
DO $$ BEGIN RAISE EXCEPTION '00091 intermediary sales attribution is a direct cutover'; END $$;
-- +goose StatementEnd

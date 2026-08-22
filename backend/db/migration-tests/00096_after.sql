DO $$
DECLARE receipt_definition text;
DECLARE payment_definition text;
BEGIN
    SELECT pg_get_constraintdef(oid) INTO receipt_definition
    FROM pg_constraint
    WHERE conrelid='vou_receipt_details'::regclass
      AND conname='vou_receipt_details_counterparty_entity_check';
    SELECT pg_get_constraintdef(oid) INTO payment_definition
    FROM pg_constraint
    WHERE conrelid='vou_payment_details'::regclass
      AND conname='vou_payment_details_counterparty_entity_check';
    IF receipt_definition NOT LIKE '%sales-partner%' OR payment_definition NOT LIKE '%sales-partner%' THEN
        RAISE EXCEPTION '00096 sales-partner receipt/payment constraints were not installed';
    END IF;
END
$$;

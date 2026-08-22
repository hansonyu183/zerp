DO $$
DECLARE definition text;
BEGIN
    SELECT pg_get_constraintdef(oid) INTO definition FROM pg_constraint
    WHERE conname='vou_receipt_details_counterparty_entity_check';
    IF definition IS NULL OR position('customer-account' in definition)=0 OR
       position('''customer''' in definition)<>0 THEN
        RAISE EXCEPTION '00093 customer account transaction identity is incomplete';
    END IF;
END
$$;

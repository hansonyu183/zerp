DO $$
DECLARE definition text;
BEGIN
    SELECT pg_get_constraintdef(oid) INTO definition FROM pg_constraint
    WHERE conname='vou_receipt_details_counterparty_entity_check';
    IF definition IS NULL OR position('customer' in definition)=0 THEN
        RAISE EXCEPTION '00093 fixture expects legacy customer transaction identity';
    END IF;
END
$$;

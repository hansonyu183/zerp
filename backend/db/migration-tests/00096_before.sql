DO $$
DECLARE definition text;
BEGIN
    SELECT pg_get_constraintdef(oid) INTO definition
    FROM pg_constraint
    WHERE conrelid='vou_payment_details'::regclass
      AND conname='vou_payment_details_counterparty_entity_check';
    IF definition LIKE '%sales-partner%' THEN
        RAISE EXCEPTION '00096 fixture expects sales-partner payment settlement to be unavailable';
    END IF;
END
$$;

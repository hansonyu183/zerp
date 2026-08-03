DO $$
BEGIN
    IF (SELECT entity FROM vou_documents WHERE id='01J00000000000000000000411') <> 'customer-receipt' OR
       (SELECT entity FROM vou_receipt_details WHERE document_id='01J00000000000000000000411') <> 'customer-receipt' THEN
        RAISE EXCEPTION 'migration 00041 did not classify the customer receipt';
    END IF;
    IF (SELECT entity FROM vou_documents WHERE id='01J00000000000000000000412') <> 'supplier-payment' OR
       (SELECT entity FROM vou_payment_details WHERE document_id='01J00000000000000000000412') <> 'supplier-payment' THEN
        RAISE EXCEPTION 'migration 00041 did not classify the supplier payment';
    END IF;
    IF EXISTS (SELECT 1 FROM app_permissions WHERE (domain='vou' AND entity IN ('receipt','payment')) OR (domain='led' AND entity='party')) THEN
        RAISE EXCEPTION 'migration 00041 left legacy permissions enabled';
    END IF;
    IF (SELECT count(*) FROM app_permissions WHERE domain='led' AND entity IN ('customer','supplier','other') AND action IN ('query','balance')) <> 6 THEN
        RAISE EXCEPTION 'migration 00041 did not create split ledger permissions';
    END IF;
END
$$;

DO $$
DECLARE
    lifecycle_definition text;
    process_definition text;
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND (
              (table_name = 'vou_documents'
               AND column_name IN ('executed_at', 'executed_by', 'completed_at'))
              OR (table_name IN ('vou_sale_order_details', 'vou_purchase_order_details')
                  AND column_name IN ('short_close_requested_by', 'short_close_reason'))
              OR (table_name = 'wfl_definition_instances'
                  AND column_name IN ('status', 'completed_at'))
              OR (table_name = 'wfl_process_instances'
                  AND column_name = 'completed_at')
          )
    ) THEN
        RAISE EXCEPTION 'migration 00061 legacy lifecycle columns remain';
    END IF;

    SELECT pg_get_constraintdef(oid) INTO lifecycle_definition
    FROM pg_constraint
    WHERE conname = 'vou_documents_status_ck';
    IF lifecycle_definition IS NULL
       OR lifecycle_definition LIKE '%FINALIZED%'
       OR lifecycle_definition NOT LIKE '%APPROVED%' THEN
        RAISE EXCEPTION 'migration 00061 VOU lifecycle constraint is invalid';
    END IF;

    SELECT pg_get_constraintdef(oid) INTO process_definition
    FROM pg_constraint
    WHERE conname = 'wfl_process_instances_status_check';
    IF process_definition IS NULL
       OR process_definition LIKE '%COMPLETED%'
       OR process_definition LIKE '%SHORT_CLOSE%'
       OR process_definition NOT LIKE '%APPROVED%' THEN
        RAISE EXCEPTION 'migration 00061 workflow lifecycle constraint is invalid';
    END IF;

    IF EXISTS (
        SELECT 1 FROM app_permissions
        WHERE domain = 'wfl' AND action LIKE 'short-close-%'
    ) THEN
        RAISE EXCEPTION 'migration 00061 short-close permissions remain';
    END IF;

    IF EXISTS (
        SELECT 1 FROM vou_audit_events
        WHERE event_type NOT IN (
                'CREATED', 'SAVED', 'DELETED', 'CHECKED', 'UNCHECKED',
                'APPROVED', 'UNAPPROVED', 'ATTACHMENT_INITIATED',
                'ATTACHMENT_UPLOADED', 'ATTACHMENT_REMOVED'
            )
           OR (from_status IS NOT NULL
               AND from_status NOT IN ('DRAFT', 'CHECKED', 'APPROVED'))
           OR to_status NOT IN ('DRAFT', 'CHECKED', 'APPROVED')
    ) THEN
        RAISE EXCEPTION 'migration 00061 legacy VOU audit lifecycle remains';
    END IF;
END
$$;

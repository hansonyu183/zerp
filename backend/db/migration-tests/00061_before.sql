DO $$
BEGIN
    IF (
        SELECT count(*) FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'vou_documents'
          AND column_name IN ('executed_at', 'executed_by', 'completed_at')
    ) <> 3 THEN
        RAISE EXCEPTION 'migration 00061 legacy VOU lifecycle columns are missing';
    END IF;
    IF (
        SELECT count(*) FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name IN ('vou_sale_order_details', 'vou_purchase_order_details')
          AND column_name IN ('short_close_requested_by', 'short_close_reason')
    ) <> 4 THEN
        RAISE EXCEPTION 'migration 00061 legacy short-close columns are missing';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'wfl_definition_instances'
          AND column_name = 'status'
    ) THEN
        RAISE EXCEPTION 'migration 00061 legacy instance status is missing';
    END IF;
END
$$;

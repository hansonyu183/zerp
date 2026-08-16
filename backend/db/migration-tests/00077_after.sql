DO $$
BEGIN
    IF to_regclass('public.wfl_definition_edges') IS NOT NULL
       OR to_regclass('public.wfl_process_instances') IS NOT NULL
       OR to_regclass('public.vou_settlement_reservations') IS NOT NULL THEN
        RAISE EXCEPTION 'removed workflow or settlement-reservation tables remain';
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns
        WHERE table_schema='public' AND table_name='vou_expense_reimbursement_details'
          AND column_name IN ('settlement_mode','fund_account_object_id','fund_account_version_id','fund_account_code','fund_account_name')) THEN
        RAISE EXCEPTION 'legacy direct expense settlement columns remain';
    END IF;
    IF to_regclass('public.wfl_definition_revisions') IS NULL
       OR to_regclass('public.wfl_action_executions') IS NULL
       OR to_regclass('public.wfl_create_child_requests') IS NULL THEN
        RAISE EXCEPTION 'Starlark runtime tables are incomplete';
    END IF;
    IF (SELECT count(*) FROM wfl_process_definitions
        WHERE status='DRAFT' AND published_revision IS NULL) <> 3
       OR EXISTS (SELECT 1 FROM wfl_definition_instances) THEN
        RAISE EXCEPTION 'ordinary workflow seeds are not three unused drafts';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM app_permissions
        WHERE path='/wfl/process-definition/publish' AND status='ENABLED')
       OR EXISTS (SELECT 1 FROM app_permissions
        WHERE path IN ('/wfl/process-definition/catalog','/vou/purchase-inbound/create')) THEN
        RAISE EXCEPTION 'workflow permission catalog is invalid';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM app_role_permissions role_permission
        JOIN app_permissions permission ON permission.id=role_permission.permission_id
        WHERE permission.path='/wfl/process-definition/query') THEN
        RAISE EXCEPTION 'existing workflow role grant was not preserved';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM wfl_process_definitions
        WHERE code='sales-fulfillment'
          AND draft_compiled @> '{"edges":[{"actionName":"sale_return"}]}'::jsonb) THEN
        RAISE EXCEPTION 'standard sales draft does not include refusal return';
    END IF;
END
$$;

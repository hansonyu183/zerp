\set ON_ERROR_STOP on

-- Issue #315 is intentionally fail-closed. It only normalizes a blank term
-- when its persisted rule and offsets identify exactly one closed-term value.
-- PREPAID and CASH_ON_DELIVERY share zero offsets and therefore must already
-- be explicit; names are never used as migration input.
BEGIN;

LOCK TABLE dcl_customer_account_versions, dcl_supplier_versions, dcl_other_unit_versions,
    vou_sale_order_details, vou_purchase_order_details, vou_documents, approval_entries IN ACCESS EXCLUSIVE MODE;

CREATE FUNCTION pg_temp.issue_315_relation_term(rule_type text, month_offset integer, day_offset integer)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
    SELECT CASE
        WHEN rule_type IN ('RELATIVE_DAYS','DUE_DAYS') AND month_offset=0 AND day_offset=3 THEN 'ARRIVAL_3'
        WHEN rule_type IN ('RELATIVE_DAYS','DUE_DAYS') AND month_offset=0 AND day_offset=5 THEN 'ARRIVAL_5'
        WHEN rule_type IN ('RELATIVE_DAYS','DUE_DAYS') AND month_offset=0 AND day_offset=7 THEN 'ARRIVAL_7'
        WHEN rule_type IN ('RELATIVE_DAYS','DUE_DAYS') AND month_offset=0 AND day_offset=15 THEN 'ARRIVAL_15'
        WHEN rule_type IN ('RELATIVE_DAYS','DUE_DAYS') AND month_offset=0 AND day_offset=30 THEN 'ARRIVAL_30'
        WHEN rule_type='MONTH_END' AND month_offset=0 AND day_offset=0 THEN 'MONTHLY_CURRENT'
        WHEN rule_type='MONTH_END' AND month_offset=1 AND day_offset=0 THEN 'MONTHLY_30'
        WHEN rule_type='MONTH_END' AND month_offset=2 AND day_offset=0 THEN 'MONTHLY_60'
        WHEN rule_type='MONTH_END' AND month_offset=3 AND day_offset=0 THEN 'MONTHLY_90'
    END
$$;

CREATE FUNCTION pg_temp.issue_315_customer_term(rule_type text, month_offset integer, due_days integer)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
    SELECT CASE
        WHEN rule_type IN ('RELATIVE_DAYS','DUE_DAYS') AND month_offset=0 AND due_days=3 THEN 'ARRIVAL_3'
        WHEN rule_type IN ('RELATIVE_DAYS','DUE_DAYS') AND month_offset=0 AND due_days=5 THEN 'ARRIVAL_5'
        WHEN rule_type IN ('RELATIVE_DAYS','DUE_DAYS') AND month_offset=0 AND due_days=7 THEN 'ARRIVAL_7'
        WHEN rule_type IN ('RELATIVE_DAYS','DUE_DAYS') AND month_offset=0 AND due_days=15 THEN 'ARRIVAL_15'
        WHEN rule_type IN ('RELATIVE_DAYS','DUE_DAYS') AND month_offset=0 AND due_days=30 THEN 'ARRIVAL_30'
        WHEN rule_type='MONTH_END' AND month_offset=0 AND due_days=0 THEN 'MONTHLY_CURRENT'
        WHEN rule_type='MONTH_END' AND month_offset=1 AND due_days=0 THEN 'MONTHLY_30'
        WHEN rule_type='MONTH_END' AND month_offset=2 AND due_days=0 THEN 'MONTHLY_60'
        WHEN rule_type='MONTH_END' AND month_offset=3 AND due_days=0 THEN 'MONTHLY_90'
    END
$$;

CREATE FUNCTION pg_temp.issue_315_order_term(rule_type text, month_offset integer, day_offset integer, due_days integer)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
    SELECT pg_temp.issue_315_relation_term(rule_type, month_offset,
      CASE WHEN day_offset IS NULL THEN due_days WHEN due_days IS NULL OR due_days=day_offset THEN day_offset END)
$$;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM dcl_other_unit_versions
        WHERE (settlement_method_id IS NULL) <> (settlement_method_code IS NULL)
           OR (settlement_method_id IS NULL) <> (settlement_method_name IS NULL)
           OR (settlement_method_id IS NULL) <> (settlement_term_code IS NULL)
           OR (settlement_method_id IS NULL) <> (settlement_rule_type IS NULL)
           OR (settlement_method_id IS NULL AND (settlement_month_offset<>0 OR settlement_day_of_month<>0 OR settlement_day_offset<>0))
           OR (settlement_method_id IS NOT NULL AND (
                settlement_day_of_month<>0 OR
                (NULLIF(settlement_term_code,'') IS NULL AND pg_temp.issue_315_relation_term(settlement_rule_type,settlement_month_offset,settlement_day_offset) IS NULL) OR
                (NULLIF(settlement_term_code,'') IS NOT NULL AND NOT (
                    (settlement_term_code IN ('PREPAID','CASH_ON_DELIVERY') AND settlement_rule_type IN ('RELATIVE_DAYS','DUE_DAYS') AND settlement_month_offset=0 AND settlement_day_offset=0)
                    OR settlement_term_code=pg_temp.issue_315_relation_term(settlement_rule_type,settlement_month_offset,settlement_day_offset)
                ))
           ))
    ) THEN RAISE EXCEPTION 'issue-315 preflight: other-unit settlement snapshots are ambiguous or invalid'; END IF;

    IF EXISTS (
        SELECT 1 FROM dcl_supplier_versions
        WHERE (settlement_method_id IS NULL) <> (settlement_method_code IS NULL)
           OR (settlement_method_id IS NULL) <> (settlement_method_name IS NULL)
           OR (settlement_method_id IS NULL) <> (settlement_term_code IS NULL)
           OR (settlement_method_id IS NULL) <> (settlement_rule_type IS NULL)
           OR (settlement_method_id IS NULL AND (settlement_month_offset<>0 OR settlement_day_of_month<>0 OR settlement_day_offset<>0))
           OR (settlement_method_id IS NOT NULL AND (
                settlement_day_of_month<>0 OR
                (NULLIF(settlement_term_code,'') IS NULL AND pg_temp.issue_315_relation_term(settlement_rule_type,settlement_month_offset,settlement_day_offset) IS NULL) OR
                (NULLIF(settlement_term_code,'') IS NOT NULL AND NOT (
                    (settlement_term_code IN ('PREPAID','CASH_ON_DELIVERY') AND settlement_rule_type IN ('RELATIVE_DAYS','DUE_DAYS') AND settlement_month_offset=0 AND settlement_day_offset=0)
                    OR settlement_term_code=pg_temp.issue_315_relation_term(settlement_rule_type,settlement_month_offset,settlement_day_offset)
                ))
           ))
    ) THEN RAISE EXCEPTION 'issue-315 preflight: supplier settlement snapshots are ambiguous or invalid'; END IF;

    IF EXISTS (
        SELECT 1 FROM dcl_customer_account_versions
        WHERE (settlement_method_id IS NULL) <> (settlement_method_code IS NULL)
           OR (settlement_method_id IS NULL) <> (settlement_method_name IS NULL)
           OR (settlement_method_id IS NULL) <> (settlement_term_code IS NULL)
           OR (settlement_method_id IS NULL) <> (settlement_rule_type IS NULL)
           OR (settlement_method_id IS NULL AND (settlement_due_days<>0 OR settlement_month_offset<>0 OR settlement_cutoff_day<>0 OR settlement_sales_surcharge_cents<>0))
           OR (settlement_method_id IS NOT NULL AND (
                (NULLIF(settlement_term_code,'') IS NULL AND (pg_temp.issue_315_customer_term(settlement_rule_type,settlement_month_offset,settlement_due_days) IS NULL OR settlement_cutoff_day<>0)) OR
                (NULLIF(settlement_term_code,'') IS NOT NULL AND NOT (
                    (settlement_term_code IN ('PREPAID','CASH_ON_DELIVERY') AND settlement_rule_type IN ('RELATIVE_DAYS','DUE_DAYS') AND settlement_due_days=0 AND settlement_month_offset=0 AND settlement_cutoff_day=0)
                    OR (settlement_term_code=pg_temp.issue_315_customer_term(settlement_rule_type,settlement_month_offset,settlement_due_days) AND settlement_cutoff_day=0)
                ))
           ))
    ) THEN RAISE EXCEPTION 'issue-315 preflight: customer-account settlement snapshots are ambiguous or invalid'; END IF;

    IF EXISTS (
        SELECT 1 FROM vou_sale_order_details
        WHERE settlement_method_object_id IS NULL OR settlement_method_code IS NULL OR settlement_method_name IS NULL
           OR (NULLIF(settlement_term_code,'') IS NULL AND pg_temp.issue_315_order_term(settlement_rule_type,settlement_month_offset,settlement_day_offset,settlement_due_days) IS NULL)
           OR (NULLIF(settlement_term_code,'') IS NOT NULL AND NOT (
              (settlement_term_code IN ('PREPAID','CASH_ON_DELIVERY') AND settlement_rule_type IN ('RELATIVE_DAYS','DUE_DAYS') AND settlement_month_offset=0 AND settlement_day_offset=0 AND settlement_due_days=0 AND settlement_cutoff_day IS NULL)
              OR (settlement_term_code=pg_temp.issue_315_order_term(settlement_rule_type,settlement_month_offset,settlement_day_offset,settlement_due_days)
                  AND ((settlement_term_code LIKE 'MONTHLY_%' AND settlement_cutoff_day BETWEEN 1 AND 31) OR (settlement_term_code NOT LIKE 'MONTHLY_%' AND settlement_cutoff_day IS NULL)))
           ))
    ) THEN RAISE EXCEPTION 'issue-315 preflight: sale-order settlement snapshots are ambiguous or invalid'; END IF;

    IF EXISTS (
        SELECT 1 FROM vou_purchase_order_details
        WHERE settlement_method_object_id IS NULL OR settlement_method_code IS NULL OR settlement_method_name IS NULL
           OR (NULLIF(settlement_term_code,'') IS NULL AND pg_temp.issue_315_order_term(settlement_rule_type,settlement_month_offset,settlement_day_offset,settlement_due_days) IS NULL)
           OR (NULLIF(settlement_term_code,'') IS NOT NULL AND NOT (
              (settlement_term_code IN ('PREPAID','CASH_ON_DELIVERY') AND settlement_rule_type IN ('RELATIVE_DAYS','DUE_DAYS') AND settlement_month_offset=0 AND settlement_day_offset=0 AND settlement_due_days=0 AND settlement_cutoff_day IS NULL)
              OR (settlement_term_code=pg_temp.issue_315_order_term(settlement_rule_type,settlement_month_offset,settlement_day_offset,settlement_due_days)
                  AND ((settlement_term_code LIKE 'MONTHLY_%' AND settlement_cutoff_day BETWEEN 1 AND 31) OR (settlement_term_code NOT LIKE 'MONTHLY_%' AND settlement_cutoff_day IS NULL)))
           ))
    ) THEN RAISE EXCEPTION 'issue-315 preflight: purchase-order settlement snapshots are ambiguous or invalid'; END IF;
END $$;

UPDATE dcl_other_unit_versions SET settlement_term_code=pg_temp.issue_315_relation_term(settlement_rule_type,settlement_month_offset,settlement_day_offset)
 WHERE settlement_method_id IS NOT NULL AND NULLIF(settlement_term_code,'') IS NULL;
UPDATE dcl_supplier_versions SET settlement_term_code=pg_temp.issue_315_relation_term(settlement_rule_type,settlement_month_offset,settlement_day_offset)
 WHERE settlement_method_id IS NOT NULL AND NULLIF(settlement_term_code,'') IS NULL;
UPDATE dcl_customer_account_versions SET settlement_term_code=pg_temp.issue_315_customer_term(settlement_rule_type,settlement_month_offset,settlement_due_days)
 WHERE settlement_method_id IS NOT NULL AND NULLIF(settlement_term_code,'') IS NULL;
UPDATE vou_sale_order_details SET settlement_term_code=pg_temp.issue_315_order_term(settlement_rule_type,settlement_month_offset,settlement_day_offset,settlement_due_days)
 WHERE NULLIF(settlement_term_code,'') IS NULL;
UPDATE vou_purchase_order_details SET settlement_term_code=pg_temp.issue_315_order_term(settlement_rule_type,settlement_month_offset,settlement_day_offset,settlement_due_days)
 WHERE NULLIF(settlement_term_code,'') IS NULL;

UPDATE dcl_other_unit_versions SET settlement_rule_type='RELATIVE_DAYS' WHERE settlement_rule_type='DUE_DAYS';
UPDATE dcl_supplier_versions SET settlement_rule_type='RELATIVE_DAYS' WHERE settlement_rule_type='DUE_DAYS';
UPDATE dcl_customer_account_versions SET settlement_rule_type='RELATIVE_DAYS' WHERE settlement_rule_type='DUE_DAYS';
UPDATE vou_sale_order_details SET settlement_rule_type='RELATIVE_DAYS' WHERE settlement_rule_type='DUE_DAYS';
UPDATE vou_purchase_order_details SET settlement_rule_type='RELATIVE_DAYS' WHERE settlement_rule_type='DUE_DAYS';

ALTER TABLE dcl_other_unit_versions DROP CONSTRAINT IF EXISTS dcl_other_unit_settlement_ck;
ALTER TABLE dcl_supplier_versions DROP CONSTRAINT IF EXISTS dcl_supplier_settlement_snapshot_ck;
ALTER TABLE dcl_customer_account_versions DROP CONSTRAINT IF EXISTS dcl_customer_account_settlement_ck;
ALTER TABLE dcl_other_unit_versions ADD CONSTRAINT dcl_other_unit_settlement_ck CHECK (
  (settlement_method_id IS NULL)=(settlement_method_code IS NULL) AND (settlement_method_id IS NULL)=(settlement_method_name IS NULL)
  AND (settlement_method_id IS NULL)=(settlement_term_code IS NULL) AND (settlement_method_id IS NULL)=(settlement_rule_type IS NULL)
  AND (settlement_method_id IS NOT NULL OR (settlement_month_offset=0 AND settlement_day_of_month=0 AND settlement_day_offset=0))
  AND (settlement_method_id IS NULL OR CASE settlement_term_code
    WHEN 'PREPAID' THEN settlement_rule_type='RELATIVE_DAYS' AND settlement_month_offset=0 AND settlement_day_of_month=0 AND settlement_day_offset=0
    WHEN 'CASH_ON_DELIVERY' THEN settlement_rule_type='RELATIVE_DAYS' AND settlement_month_offset=0 AND settlement_day_of_month=0 AND settlement_day_offset=0
    WHEN 'ARRIVAL_3' THEN settlement_rule_type='RELATIVE_DAYS' AND settlement_month_offset=0 AND settlement_day_of_month=0 AND settlement_day_offset=3
    WHEN 'ARRIVAL_5' THEN settlement_rule_type='RELATIVE_DAYS' AND settlement_month_offset=0 AND settlement_day_of_month=0 AND settlement_day_offset=5
    WHEN 'ARRIVAL_7' THEN settlement_rule_type='RELATIVE_DAYS' AND settlement_month_offset=0 AND settlement_day_of_month=0 AND settlement_day_offset=7
    WHEN 'ARRIVAL_15' THEN settlement_rule_type='RELATIVE_DAYS' AND settlement_month_offset=0 AND settlement_day_of_month=0 AND settlement_day_offset=15
    WHEN 'ARRIVAL_30' THEN settlement_rule_type='RELATIVE_DAYS' AND settlement_month_offset=0 AND settlement_day_of_month=0 AND settlement_day_offset=30
    WHEN 'MONTHLY_CURRENT' THEN settlement_rule_type='MONTH_END' AND settlement_month_offset=0 AND settlement_day_of_month=0 AND settlement_day_offset=0
    WHEN 'MONTHLY_30' THEN settlement_rule_type='MONTH_END' AND settlement_month_offset=1 AND settlement_day_of_month=0 AND settlement_day_offset=0
    WHEN 'MONTHLY_60' THEN settlement_rule_type='MONTH_END' AND settlement_month_offset=2 AND settlement_day_of_month=0 AND settlement_day_offset=0
    WHEN 'MONTHLY_90' THEN settlement_rule_type='MONTH_END' AND settlement_month_offset=3 AND settlement_day_of_month=0 AND settlement_day_offset=0
    ELSE false END)
);
ALTER TABLE dcl_supplier_versions ADD CONSTRAINT dcl_supplier_settlement_snapshot_ck CHECK (
  (settlement_method_id IS NULL)=(settlement_method_code IS NULL) AND (settlement_method_id IS NULL)=(settlement_method_name IS NULL)
  AND (settlement_method_id IS NULL)=(settlement_term_code IS NULL) AND (settlement_method_id IS NULL)=(settlement_rule_type IS NULL)
  AND (settlement_method_id IS NOT NULL OR (settlement_month_offset=0 AND settlement_day_of_month=0 AND settlement_day_offset=0))
  AND (settlement_method_id IS NULL OR CASE settlement_term_code
    WHEN 'PREPAID' THEN settlement_rule_type='RELATIVE_DAYS' AND settlement_month_offset=0 AND settlement_day_of_month=0 AND settlement_day_offset=0
    WHEN 'CASH_ON_DELIVERY' THEN settlement_rule_type='RELATIVE_DAYS' AND settlement_month_offset=0 AND settlement_day_of_month=0 AND settlement_day_offset=0
    WHEN 'ARRIVAL_3' THEN settlement_rule_type='RELATIVE_DAYS' AND settlement_month_offset=0 AND settlement_day_of_month=0 AND settlement_day_offset=3
    WHEN 'ARRIVAL_5' THEN settlement_rule_type='RELATIVE_DAYS' AND settlement_month_offset=0 AND settlement_day_of_month=0 AND settlement_day_offset=5
    WHEN 'ARRIVAL_7' THEN settlement_rule_type='RELATIVE_DAYS' AND settlement_month_offset=0 AND settlement_day_of_month=0 AND settlement_day_offset=7
    WHEN 'ARRIVAL_15' THEN settlement_rule_type='RELATIVE_DAYS' AND settlement_month_offset=0 AND settlement_day_of_month=0 AND settlement_day_offset=15
    WHEN 'ARRIVAL_30' THEN settlement_rule_type='RELATIVE_DAYS' AND settlement_month_offset=0 AND settlement_day_of_month=0 AND settlement_day_offset=30
    WHEN 'MONTHLY_CURRENT' THEN settlement_rule_type='MONTH_END' AND settlement_month_offset=0 AND settlement_day_of_month=0 AND settlement_day_offset=0
    WHEN 'MONTHLY_30' THEN settlement_rule_type='MONTH_END' AND settlement_month_offset=1 AND settlement_day_of_month=0 AND settlement_day_offset=0
    WHEN 'MONTHLY_60' THEN settlement_rule_type='MONTH_END' AND settlement_month_offset=2 AND settlement_day_of_month=0 AND settlement_day_offset=0
    WHEN 'MONTHLY_90' THEN settlement_rule_type='MONTH_END' AND settlement_month_offset=3 AND settlement_day_of_month=0 AND settlement_day_offset=0
    ELSE false END)
);
ALTER TABLE dcl_customer_account_versions ADD CONSTRAINT dcl_customer_account_settlement_ck CHECK (
  (settlement_method_id IS NULL)=(settlement_method_code IS NULL) AND (settlement_method_id IS NULL)=(settlement_method_name IS NULL)
  AND (settlement_method_id IS NULL)=(settlement_term_code IS NULL) AND (settlement_method_id IS NULL)=(settlement_rule_type IS NULL)
  AND (settlement_method_id IS NOT NULL OR (settlement_due_days=0 AND settlement_month_offset=0 AND settlement_cutoff_day=0 AND settlement_sales_surcharge_cents=0))
  AND (settlement_method_id IS NULL OR CASE settlement_term_code
    WHEN 'PREPAID' THEN settlement_rule_type='RELATIVE_DAYS' AND settlement_due_days=0 AND settlement_month_offset=0 AND settlement_cutoff_day=0
    WHEN 'CASH_ON_DELIVERY' THEN settlement_rule_type='RELATIVE_DAYS' AND settlement_due_days=0 AND settlement_month_offset=0 AND settlement_cutoff_day=0
    WHEN 'ARRIVAL_3' THEN settlement_rule_type='RELATIVE_DAYS' AND settlement_due_days=3 AND settlement_month_offset=0 AND settlement_cutoff_day=0
    WHEN 'ARRIVAL_5' THEN settlement_rule_type='RELATIVE_DAYS' AND settlement_due_days=5 AND settlement_month_offset=0 AND settlement_cutoff_day=0
    WHEN 'ARRIVAL_7' THEN settlement_rule_type='RELATIVE_DAYS' AND settlement_due_days=7 AND settlement_month_offset=0 AND settlement_cutoff_day=0
    WHEN 'ARRIVAL_15' THEN settlement_rule_type='RELATIVE_DAYS' AND settlement_due_days=15 AND settlement_month_offset=0 AND settlement_cutoff_day=0
    WHEN 'ARRIVAL_30' THEN settlement_rule_type='RELATIVE_DAYS' AND settlement_due_days=30 AND settlement_month_offset=0 AND settlement_cutoff_day=0
    WHEN 'MONTHLY_CURRENT' THEN settlement_rule_type='MONTH_END' AND settlement_due_days=0 AND settlement_month_offset=0 AND settlement_cutoff_day=0
    WHEN 'MONTHLY_30' THEN settlement_rule_type='MONTH_END' AND settlement_due_days=0 AND settlement_month_offset=1 AND settlement_cutoff_day=0
    WHEN 'MONTHLY_60' THEN settlement_rule_type='MONTH_END' AND settlement_due_days=0 AND settlement_month_offset=2 AND settlement_cutoff_day=0
    WHEN 'MONTHLY_90' THEN settlement_rule_type='MONTH_END' AND settlement_due_days=0 AND settlement_month_offset=3 AND settlement_cutoff_day=0
    ELSE false END)
);

ALTER TABLE vou_sale_order_details DROP CONSTRAINT IF EXISTS vou_sale_order_settlement_ck;
ALTER TABLE vou_purchase_order_details DROP CONSTRAINT IF EXISTS vou_purchase_order_settlement_ck;
ALTER TABLE vou_sale_order_details ALTER COLUMN settlement_term_code DROP DEFAULT;
ALTER TABLE vou_purchase_order_details ALTER COLUMN settlement_term_code DROP DEFAULT;
ALTER TABLE vou_sale_order_details ADD CONSTRAINT vou_sale_order_settlement_ck CHECK (
  settlement_method_object_id IS NOT NULL AND settlement_method_code IS NOT NULL AND settlement_method_name IS NOT NULL
  AND settlement_term_code IN ('PREPAID','CASH_ON_DELIVERY','ARRIVAL_3','ARRIVAL_5','ARRIVAL_7','ARRIVAL_15','ARRIVAL_30','MONTHLY_CURRENT','MONTHLY_30','MONTHLY_60','MONTHLY_90')
  AND ((settlement_term_code IN ('PREPAID','CASH_ON_DELIVERY') AND settlement_rule_type='RELATIVE_DAYS' AND settlement_month_offset=0 AND settlement_day_of_month IS NULL AND settlement_day_offset=0 AND settlement_due_days=0 AND settlement_cutoff_day IS NULL)
    OR (settlement_term_code='ARRIVAL_3' AND settlement_rule_type='RELATIVE_DAYS' AND settlement_month_offset=0 AND settlement_day_of_month IS NULL AND settlement_day_offset=3 AND settlement_due_days=3 AND settlement_cutoff_day IS NULL)
    OR (settlement_term_code='ARRIVAL_5' AND settlement_rule_type='RELATIVE_DAYS' AND settlement_month_offset=0 AND settlement_day_of_month IS NULL AND settlement_day_offset=5 AND settlement_due_days=5 AND settlement_cutoff_day IS NULL)
    OR (settlement_term_code='ARRIVAL_7' AND settlement_rule_type='RELATIVE_DAYS' AND settlement_month_offset=0 AND settlement_day_of_month IS NULL AND settlement_day_offset=7 AND settlement_due_days=7 AND settlement_cutoff_day IS NULL)
    OR (settlement_term_code='ARRIVAL_15' AND settlement_rule_type='RELATIVE_DAYS' AND settlement_month_offset=0 AND settlement_day_of_month IS NULL AND settlement_day_offset=15 AND settlement_due_days=15 AND settlement_cutoff_day IS NULL)
    OR (settlement_term_code='ARRIVAL_30' AND settlement_rule_type='RELATIVE_DAYS' AND settlement_month_offset=0 AND settlement_day_of_month IS NULL AND settlement_day_offset=30 AND settlement_due_days=30 AND settlement_cutoff_day IS NULL)
    OR (settlement_term_code='MONTHLY_CURRENT' AND settlement_rule_type='MONTH_END' AND settlement_month_offset=0 AND settlement_day_of_month IS NULL AND settlement_day_offset=0 AND settlement_due_days IS NULL AND settlement_cutoff_day BETWEEN 1 AND 31)
    OR (settlement_term_code='MONTHLY_30' AND settlement_rule_type='MONTH_END' AND settlement_month_offset=1 AND settlement_day_of_month IS NULL AND settlement_day_offset=0 AND settlement_due_days IS NULL AND settlement_cutoff_day BETWEEN 1 AND 31)
    OR (settlement_term_code='MONTHLY_60' AND settlement_rule_type='MONTH_END' AND settlement_month_offset=2 AND settlement_day_of_month IS NULL AND settlement_day_offset=0 AND settlement_due_days IS NULL AND settlement_cutoff_day BETWEEN 1 AND 31)
    OR (settlement_term_code='MONTHLY_90' AND settlement_rule_type='MONTH_END' AND settlement_month_offset=3 AND settlement_day_of_month IS NULL AND settlement_day_offset=0 AND settlement_due_days IS NULL AND settlement_cutoff_day BETWEEN 1 AND 31))
);
ALTER TABLE vou_purchase_order_details ADD CONSTRAINT vou_purchase_order_settlement_ck CHECK (
  settlement_method_object_id IS NOT NULL AND settlement_method_code IS NOT NULL AND settlement_method_name IS NOT NULL
  AND settlement_term_code IN ('PREPAID','CASH_ON_DELIVERY','ARRIVAL_3','ARRIVAL_5','ARRIVAL_7','ARRIVAL_15','ARRIVAL_30','MONTHLY_CURRENT','MONTHLY_30','MONTHLY_60','MONTHLY_90')
  AND ((settlement_term_code IN ('PREPAID','CASH_ON_DELIVERY') AND settlement_rule_type='RELATIVE_DAYS' AND settlement_month_offset=0 AND settlement_day_of_month IS NULL AND settlement_day_offset=0 AND settlement_due_days=0 AND settlement_cutoff_day IS NULL)
    OR (settlement_term_code='ARRIVAL_3' AND settlement_rule_type='RELATIVE_DAYS' AND settlement_month_offset=0 AND settlement_day_of_month IS NULL AND settlement_day_offset=3 AND settlement_due_days=3 AND settlement_cutoff_day IS NULL)
    OR (settlement_term_code='ARRIVAL_5' AND settlement_rule_type='RELATIVE_DAYS' AND settlement_month_offset=0 AND settlement_day_of_month IS NULL AND settlement_day_offset=5 AND settlement_due_days=5 AND settlement_cutoff_day IS NULL)
    OR (settlement_term_code='ARRIVAL_7' AND settlement_rule_type='RELATIVE_DAYS' AND settlement_month_offset=0 AND settlement_day_of_month IS NULL AND settlement_day_offset=7 AND settlement_due_days=7 AND settlement_cutoff_day IS NULL)
    OR (settlement_term_code='ARRIVAL_15' AND settlement_rule_type='RELATIVE_DAYS' AND settlement_month_offset=0 AND settlement_day_of_month IS NULL AND settlement_day_offset=15 AND settlement_due_days=15 AND settlement_cutoff_day IS NULL)
    OR (settlement_term_code='ARRIVAL_30' AND settlement_rule_type='RELATIVE_DAYS' AND settlement_month_offset=0 AND settlement_day_of_month IS NULL AND settlement_day_offset=30 AND settlement_due_days=30 AND settlement_cutoff_day IS NULL)
    OR (settlement_term_code='MONTHLY_CURRENT' AND settlement_rule_type='MONTH_END' AND settlement_month_offset=0 AND settlement_day_of_month IS NULL AND settlement_day_offset=0 AND settlement_due_days IS NULL AND settlement_cutoff_day BETWEEN 1 AND 31)
    OR (settlement_term_code='MONTHLY_30' AND settlement_rule_type='MONTH_END' AND settlement_month_offset=1 AND settlement_day_of_month IS NULL AND settlement_day_offset=0 AND settlement_due_days IS NULL AND settlement_cutoff_day BETWEEN 1 AND 31)
    OR (settlement_term_code='MONTHLY_60' AND settlement_rule_type='MONTH_END' AND settlement_month_offset=2 AND settlement_day_of_month IS NULL AND settlement_day_offset=0 AND settlement_due_days IS NULL AND settlement_cutoff_day BETWEEN 1 AND 31)
    OR (settlement_term_code='MONTHLY_90' AND settlement_rule_type='MONTH_END' AND settlement_month_offset=3 AND settlement_day_of_month IS NULL AND settlement_day_offset=0 AND settlement_due_days IS NULL AND settlement_cutoff_day BETWEEN 1 AND 31))
);

CREATE OR REPLACE FUNCTION public.vou_reject_non_draft_order_detail_mutation() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE document_status varchar(32); document_id varchar(26);
BEGIN
    document_id := CASE WHEN TG_OP='DELETE' THEN OLD.document_id ELSE NEW.document_id END;
    SELECT entry.status INTO document_status
      FROM vou_documents document JOIN approval_entries entry ON entry.id=document.approval_entry_id
     WHERE document.id=document_id;
    IF document_status IS NULL OR document_status='DRAFT' THEN
        RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
    END IF;
    IF TG_OP='DELETE' THEN
        RAISE EXCEPTION 'non-draft order detail cannot be deleted' USING ERRCODE='23514';
    END IF;
    IF (to_jsonb(NEW)-'fulfillment_status') IS DISTINCT FROM (to_jsonb(OLD)-'fulfillment_status') THEN
        RAISE EXCEPTION 'non-draft order detail is immutable except fulfillment_status' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS vou_sale_order_non_draft_immutable ON vou_sale_order_details;
DROP TRIGGER IF EXISTS vou_purchase_order_non_draft_immutable ON vou_purchase_order_details;
CREATE TRIGGER vou_sale_order_non_draft_immutable BEFORE DELETE OR UPDATE ON vou_sale_order_details FOR EACH ROW EXECUTE FUNCTION public.vou_reject_non_draft_order_detail_mutation();
CREATE TRIGGER vou_purchase_order_non_draft_immutable BEFORE DELETE OR UPDATE ON vou_purchase_order_details FOR EACH ROW EXECUTE FUNCTION public.vou_reject_non_draft_order_detail_mutation();

COMMIT;

-- The report reader is cluster-scoped while schema initialization is database-scoped.
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='zerp_report_reader') THEN
        CREATE ROLE zerp_report_reader NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
    END IF;
END $$;
GRANT USAGE ON SCHEMA public TO zerp_report_reader;
--
-- PostgreSQL database dump
--


-- Dumped from database version 18.6
-- Dumped by pg_dump version 18.4 (Homebrew)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--



--
-- Name: dcl_reject_merged_party_relationship(); Type: FUNCTION; Schema: public; Owner: -
--

-- Relationship creation and Party merge run in separate service transactions.
-- This guard closes the race in which a relationship is inserted after merge has
-- locked and inspected the Party but before the source Party becomes read-only.
CREATE FUNCTION public.dcl_reject_merged_party_relationship() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    IF EXISTS (SELECT 1 FROM dcl_parties WHERE id=NEW.party_id AND merged_into_party_id IS NOT NULL) THEN
        RAISE EXCEPTION 'merged Party cannot start a new relationship' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
END;
$$;


--
-- Name: reject_locked_vou_attachment_period(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.reject_locked_vou_attachment_period() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
    target_document_id varchar(26);
    target_date date;
BEGIN
    target_document_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.document_id ELSE NEW.document_id END;
    SELECT business_date INTO target_date FROM vou_documents WHERE id = target_document_id;
    IF target_date IS NOT NULL AND EXISTS (
        SELECT 1 FROM acc_periods
        WHERE state = 'LOCKED'
          AND period_month = date_trunc('month', target_date)::date
    ) THEN
        RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'accounting period is locked';
    END IF;
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END
$$;


--
-- Name: reject_locked_vou_period(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.reject_locked_vou_period() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
    target_date date;
BEGIN
    target_date := CASE WHEN TG_OP = 'DELETE' THEN OLD.business_date ELSE NEW.business_date END;
    IF EXISTS (
        SELECT 1 FROM acc_periods
        WHERE state = 'LOCKED'
          AND period_month = date_trunc('month', target_date)::date
    ) THEN
        RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'accounting period is locked';
    END IF;
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END
$$;


--
-- Name: reject_locked_vou_approval_period(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.reject_locked_vou_approval_period() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
    target_domain varchar(32);
    target_entity varchar(64);
    target_subject_id varchar(128);
    target_entry_id varchar(26);
    target_date date;
BEGIN
    target_domain := CASE WHEN TG_OP = 'DELETE' THEN OLD.domain ELSE NEW.domain END;
    target_entity := CASE WHEN TG_OP = 'DELETE' THEN OLD.entity ELSE NEW.entity END;
    target_subject_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.subject_id ELSE NEW.subject_id END;
    target_entry_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.id ELSE NEW.id END;
    IF target_domain <> 'vou' THEN
        RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
    END IF;
    SELECT business_date INTO target_date
    FROM vou_documents
    WHERE id = target_subject_id
      AND entity = target_entity
      AND approval_entry_id = target_entry_id;
    IF target_date IS NOT NULL AND EXISTS (
        SELECT 1 FROM acc_periods
        WHERE state = 'LOCKED'
          AND period_month = date_trunc('month', target_date)::date
    ) THEN
        RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'accounting period is locked';
    END IF;
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END
$$;


--
-- Name: rpt_validate_current_reports(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.rpt_validate_current_reports() RETURNS void
    LANGUAGE plpgsql
    AS $_$
DECLARE
    report record;
    parameter record;
    column_contract record;
    rewritten_sql text;
    validation_view text := 'rpt_migration_validation_view';
    actual_name text;
    actual_oid oid;
    expected_oid_kind text;
    actual_count integer;
BEGIN
    FOR report IN
        SELECT d.code,v.sql_text,v.parameters,v.columns
        FROM dcl_subjects d
        JOIN LATERAL (
            SELECT payload.enabled,payload.sql_text,payload.parameters,payload.columns
            FROM approval_entries entry
            JOIN dcl_rpt_definition_versions payload ON payload.approval_entry_id=entry.id
            JOIN rpt_definition_validities validity ON validity.approval_entry_id=entry.id AND validity.validity='VALID'
            WHERE entry.domain='dcl' AND entry.entity='rpt-definition'
              AND entry.subject_id=d.id AND entry.status='APPROVED'
            ORDER BY entry.version_no DESC
            LIMIT 1
        ) v ON true
        WHERE d.entity='rpt-definition' AND v.enabled
        ORDER BY d.code
    LOOP
        rewritten_sql := report.sql_text;
        FOR parameter IN
            SELECT value, ordinality
            FROM jsonb_array_elements(report.parameters) WITH ORDINALITY
            ORDER BY ordinality DESC
        LOOP
            rewritten_sql := replace(
                rewritten_sql,
                '$'||parameter.ordinality,
                CASE parameter.value->>'type'
                    WHEN 'INTEGER' THEN 'NULL::bigint'
                    WHEN 'DECIMAL' THEN 'NULL::numeric'
                    WHEN 'BOOLEAN' THEN 'NULL::boolean'
                    WHEN 'DATE' THEN 'NULL::date'
                    WHEN 'DATE_RANGE' THEN 'NULL::daterange'
                    ELSE 'NULL::text'
                END
            );
        END LOOP;
        EXECUTE 'EXPLAIN '||rewritten_sql;
        EXECUTE format('DROP VIEW IF EXISTS pg_temp.%I',validation_view);
        EXECUTE format('CREATE TEMP VIEW %I AS SELECT * FROM (%s) rpt_validation LIMIT 0',validation_view,rewritten_sql);

        SELECT count(*) INTO actual_count
        FROM pg_attribute
        WHERE attrelid=('pg_temp.'||validation_view)::regclass AND attnum>0 AND NOT attisdropped;
        IF actual_count <> jsonb_array_length(report.columns) THEN
            RAISE EXCEPTION 'RPT report % result column count changed',report.code USING ERRCODE='P0001';
        END IF;
        FOR column_contract IN
            SELECT value,ordinality FROM jsonb_array_elements(report.columns) WITH ORDINALITY ORDER BY ordinality
        LOOP
            SELECT attname,atttypid INTO actual_name,actual_oid
            FROM pg_attribute
            WHERE attrelid=('pg_temp.'||validation_view)::regclass AND attnum=column_contract.ordinality AND NOT attisdropped;
            IF actual_name <> column_contract.value->>'alias' THEN
                RAISE EXCEPTION 'RPT report % result column alias changed',report.code USING ERRCODE='P0001';
            END IF;
            expected_oid_kind := column_contract.value->>'type';
            IF NOT (CASE expected_oid_kind
                WHEN 'BOOLEAN' THEN actual_oid='boolean'::regtype
                WHEN 'INTEGER' THEN actual_oid IN ('smallint'::regtype,'integer'::regtype,'bigint'::regtype)
                WHEN 'DECIMAL' THEN actual_oid IN ('numeric'::regtype,'real'::regtype,'double precision'::regtype)
                WHEN 'DATE' THEN actual_oid='date'::regtype
                WHEN 'DATETIME' THEN actual_oid IN ('timestamp'::regtype,'timestamptz'::regtype)
                WHEN 'TEXT' THEN actual_oid IN ('text'::regtype,'varchar'::regtype,'char'::regtype,'uuid'::regtype)
                WHEN 'ID' THEN actual_oid IN ('text'::regtype,'varchar'::regtype,'char'::regtype,'uuid'::regtype)
                ELSE false
            END) THEN
                RAISE EXCEPTION 'RPT report % result column type changed',report.code USING ERRCODE='P0001';
            END IF;
        END LOOP;
        EXECUTE format('DROP VIEW pg_temp.%I',validation_view);
    END LOOP;
END;
$_$;


--
-- Name: vou_validate_document_detail(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.vou_validate_document_detail() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE target_id varchar(26); detail_count integer;
BEGIN
 IF TG_TABLE_NAME='vou_documents' THEN target_id:=CASE WHEN TG_OP='DELETE' THEN OLD.id ELSE NEW.id END;
 ELSE target_id:=CASE WHEN TG_OP='DELETE' THEN OLD.document_id ELSE NEW.document_id END; END IF;
 IF NOT EXISTS (SELECT 1 FROM vou_documents WHERE id=target_id) THEN RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END; END IF;
 SELECT (SELECT count(*) FROM vou_sale_pricing_details WHERE document_id=target_id)+(SELECT count(*) FROM vou_purchase_inquiry_details WHERE document_id=target_id)+(SELECT count(*) FROM vou_sale_order_details WHERE document_id=target_id)+(SELECT count(*) FROM vou_sale_outbound_details WHERE document_id=target_id)+(SELECT count(*) FROM vou_sale_delivery_details WHERE document_id=target_id)+(SELECT count(*) FROM vou_sale_signoff_details WHERE document_id=target_id)+(SELECT count(*) FROM vou_sale_return_details WHERE document_id=target_id)+(SELECT count(*) FROM vou_purchase_order_details WHERE document_id=target_id)+(SELECT count(*) FROM vou_purchase_inbound_details WHERE document_id=target_id)+(SELECT count(*) FROM vou_purchase_return_details WHERE document_id=target_id)+(SELECT count(*) FROM vou_production_details WHERE document_id=target_id)+(SELECT count(*) FROM vou_inventory_count_details WHERE document_id=target_id)+(SELECT count(*) FROM vou_receipt_details WHERE document_id=target_id)+(SELECT count(*) FROM vou_payment_details WHERE document_id=target_id)+(SELECT count(*) FROM vou_expense_reimbursement_details WHERE document_id=target_id)+(SELECT count(*) FROM vou_expense_payment_details WHERE document_id=target_id)+(SELECT count(*) FROM vou_employee_loan_writeoff_details WHERE document_id=target_id)+(SELECT count(*) FROM vou_other_income_details WHERE document_id=target_id)+(SELECT count(*) FROM vou_asset_acquisition_details WHERE document_id=target_id)+(SELECT count(*) FROM vou_asset_sale_details WHERE document_id=target_id)+(SELECT count(*) FROM vou_asset_liquidation_details WHERE document_id=target_id)+(SELECT count(*) FROM vou_bill_details WHERE document_id=target_id)+(SELECT count(*) FROM vou_intermediary_calculation_details WHERE document_id=target_id)+(SELECT count(*) FROM vou_service_contract_details WHERE document_id=target_id)+(SELECT count(*) FROM vou_service_acceptance_details WHERE document_id=target_id) INTO detail_count;
 IF detail_count<>1 THEN RAISE EXCEPTION 'VOU document must have exactly one typed detail row' USING ERRCODE='23514'; END IF;
 RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END; $$;


--
-- Name: vou_validate_parent(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.vou_validate_parent() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE actual_entity varchar(32);
BEGIN
    IF TG_OP = 'UPDATE'
       AND (NEW.parent_entity, NEW.parent_document_id)
           IS DISTINCT FROM (OLD.parent_entity, OLD.parent_document_id) THEN
        RAISE EXCEPTION 'document parent is immutable';
    END IF;
    IF NEW.parent_document_id IS NULL THEN
        RETURN NEW;
    END IF;
    IF NEW.parent_document_id = NEW.id THEN
        RAISE EXCEPTION 'document cannot reference itself as parent';
    END IF;
    SELECT entity INTO actual_entity
    FROM vou_documents
    WHERE id = NEW.parent_document_id;
    IF actual_entity IS NULL OR actual_entity <> NEW.parent_entity THEN
        RAISE EXCEPTION 'parent document does not match parent entity';
    END IF;
    RETURN NEW;
END;
$$;


--
-- Name: vou_validate_wfl_parent(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.vou_validate_wfl_parent() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE parent_entity varchar(32);
BEGIN
    IF NEW.control_domain = 'VOU' THEN
        IF NEW.parent_document_id IS NULL THEN RETURN NEW; END IF;
        SELECT entity INTO parent_entity FROM vou_documents WHERE id = NEW.parent_document_id;
        IF (NEW.entity = 'sale-outbound' AND parent_entity = 'sale-order')
           OR (NEW.entity = 'sale-delivery' AND parent_entity = 'sale-outbound')
           OR (NEW.entity = 'sale-signoff' AND parent_entity = 'sale-delivery')
           OR (NEW.entity = 'order-production' AND parent_entity = 'sale-order') THEN
            RETURN NEW;
        END IF;
        RAISE EXCEPTION 'invalid VOU document parent';
    END IF;
    IF NEW.entity IN ('customer-order', 'sale-order', 'purchase-order')
       AND NEW.parent_document_id IS NULL THEN
        RETURN NEW;
    END IF;
    IF NEW.parent_document_id IS NULL THEN
        RAISE EXCEPTION 'WFL child requires parent';
    END IF;
    SELECT entity INTO parent_entity FROM vou_documents WHERE id = NEW.parent_document_id;
    IF (NEW.entity = 'procurement-order' AND parent_entity = 'customer-order')
       OR (NEW.entity = 'goods-receipt' AND parent_entity = 'procurement-order')
       OR (NEW.entity = 'delivery-note' AND parent_entity = 'customer-order')
       OR (NEW.entity = 'signoff-note' AND parent_entity = 'delivery-note')
       OR (NEW.entity = 'sale-outbound' AND parent_entity = 'sale-order')
       OR (NEW.entity = 'sale-delivery' AND parent_entity = 'sale-outbound')
       OR (NEW.entity = 'sale-signoff' AND parent_entity = 'sale-delivery')
       OR (NEW.entity = 'purchase-inbound' AND parent_entity = 'purchase-order') THEN
        RETURN NEW;
    END IF;
    RAISE EXCEPTION 'invalid WFL document parent';
END;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: acc_asset_book_values; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.acc_asset_book_values (
    book_id character varying(26) NOT NULL,
    asset_id character varying(26) NOT NULL,
    currency character varying(3) NOT NULL,
    original_minor bigint NOT NULL,
    accumulated_depreciation_minor bigint DEFAULT 0 NOT NULL,
    asset_subject_id character varying(26),
    asset_dimensions jsonb DEFAULT '{}'::jsonb NOT NULL,
    accumulated_subject_id character varying(26),
    accumulated_dimensions jsonb DEFAULT '{}'::jsonb NOT NULL,
    expense_subject_id character varying(26),
    expense_dimensions jsonb DEFAULT '{}'::jsonb NOT NULL,
    CONSTRAINT acc_asset_book_values_accumulated_depreciation_minor_check CHECK ((accumulated_depreciation_minor >= 0)),
    CONSTRAINT acc_asset_book_values_accumulated_dimensions_check CHECK ((jsonb_typeof(accumulated_dimensions) = 'object'::text)),
    CONSTRAINT acc_asset_book_values_asset_dimensions_check CHECK ((jsonb_typeof(asset_dimensions) = 'object'::text)),
    CONSTRAINT acc_asset_book_values_expense_dimensions_check CHECK ((jsonb_typeof(expense_dimensions) = 'object'::text)),
    CONSTRAINT acc_asset_book_values_original_minor_check CHECK ((original_minor >= 0))
);


--
-- Name: acc_assets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.acc_assets (
    id character varying(26) NOT NULL,
    asset_no character varying(32) NOT NULL,
    source_document_id character varying(26) NOT NULL,
    source_line_id character varying(26) NOT NULL,
    name character varying(200) NOT NULL,
    category_id character varying(26) NOT NULL,
    department_id character varying(26) NOT NULL,
    useful_life_months integer NOT NULL,
    residual_rate_bps integer NOT NULL,
    acquired_on date NOT NULL,
    state character varying(8) NOT NULL,
    disposed_by_document_id character varying(26),
    disposed_on date,
    CONSTRAINT acc_assets_residual_rate_bps_check CHECK (((residual_rate_bps >= 0) AND (residual_rate_bps <= 10000))),
    CONSTRAINT acc_assets_state_check CHECK (((state)::text = ANY ((ARRAY['ACTIVE'::character varying, 'SOLD'::character varying, 'RETIRED'::character varying])::text[]))),
    CONSTRAINT acc_assets_useful_life_months_check CHECK ((useful_life_months > 0))
);


--
-- Name: acc_bill_book_values; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.acc_bill_book_values (
    book_id character varying(26) NOT NULL,
    bill_id character varying(26) NOT NULL,
    value_minor bigint NOT NULL,
    CONSTRAINT acc_bill_book_values_value_minor_check CHECK ((value_minor >= 0))
);


--
-- Name: acc_bills; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.acc_bills (
    id character varying(26) NOT NULL,
    bill_no character varying(64) NOT NULL,
    bill_type character varying(32) NOT NULL,
    position_type character varying(16) NOT NULL,
    currency character varying(3) NOT NULL,
    medium character varying(16) NOT NULL,
    face_amount_minor bigint NOT NULL,
    issue_date date NOT NULL,
    maturity_date date NOT NULL,
    drawer character varying(200) NOT NULL,
    acceptor character varying(200) NOT NULL,
    payee character varying(200) NOT NULL,
    annual_rate_bps integer NOT NULL,
    interest_days integer NOT NULL,
    interest_amount_minor bigint NOT NULL,
    customer_cost_amount_minor bigint NOT NULL,
    origin_party_entity character varying(16),
    origin_party_object_id character varying(26),
    origin_party_approval_entry_id character varying(26),
    origin_party_code character varying(64),
    origin_party_name character varying(200),
    state character varying(12) NOT NULL,
    source_document_id character varying(26) NOT NULL,
    source_line_id character varying(26) NOT NULL,
    settled_by_document_id character varying(26),
    CONSTRAINT acc_bills_annual_rate_bps_check CHECK (((annual_rate_bps >= 0) AND (annual_rate_bps <= 100000))),
    CONSTRAINT acc_bills_customer_cost_amount_minor_check CHECK ((customer_cost_amount_minor >= 0)),
    CONSTRAINT acc_bills_face_amount_minor_check CHECK ((face_amount_minor > 0)),
    CONSTRAINT acc_bills_interest_amount_minor_check CHECK ((interest_amount_minor >= 0)),
    CONSTRAINT acc_bills_interest_days_check CHECK ((interest_days >= 0)),
    CONSTRAINT acc_bills_medium_check CHECK (((medium)::text = ANY ((ARRAY['PAPER'::character varying, 'ELECTRONIC'::character varying])::text[]))),
    CONSTRAINT acc_bills_position_type_check CHECK (((position_type)::text = ANY ((ARRAY['ASSET'::character varying, 'LIABILITY'::character varying])::text[]))),
    CONSTRAINT acc_bills_state_check CHECK (((state)::text = ANY ((ARRAY['AVAILABLE'::character varying, 'SETTLED'::character varying])::text[])))
);


--
-- Name: acc_book_user_scopes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.acc_book_user_scopes (
    book_id character varying(26) NOT NULL,
    user_id character varying(26) NOT NULL,
    query_access boolean DEFAULT false NOT NULL,
    operate_access boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by character varying(26) NOT NULL,
    CONSTRAINT acc_book_user_scopes_check CHECK ((query_access OR operate_access))
);


--
-- Name: acc_books; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.acc_books (
    id character varying(26) NOT NULL,
    code character varying(64) NOT NULL,
    data jsonb NOT NULL DEFAULT '{}'::jsonb,
    name character varying(200) NOT NULL,
    description character varying(1000) DEFAULT ''::character varying NOT NULL,
    start_month date NOT NULL,
    base_currency character varying(3) NOT NULL,
    control_book boolean DEFAULT false NOT NULL,
    revision bigint DEFAULT 1 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by character varying(26) NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by character varying(26) NOT NULL,
    subject_template character varying(20) DEFAULT 'EMPTY'::character varying NOT NULL,
    CONSTRAINT acc_books_base_currency_check CHECK (((base_currency)::text ~ '^[A-Z]{3}$'::text)),
    CONSTRAINT acc_books_code_check CHECK (((code)::text ~ '^[A-Z0-9][A-Z0-9._-]{0,63}$'::text)),
    CONSTRAINT acc_books_name_check CHECK ((btrim((name)::text) <> ''::text)),
    CONSTRAINT acc_books_revision_check CHECK ((revision >= 1)),
    CONSTRAINT acc_books_start_month_check CHECK ((start_month = (date_trunc('month'::text, (start_month)::timestamp with time zone))::date)),
    CONSTRAINT acc_books_subject_template_check CHECK (((subject_template)::text = ANY ((ARRAY['ENTERPRISE'::character varying, 'SMALL_BUSINESS'::character varying, 'EMPTY'::character varying])::text[])))
);


--
-- Name: acc_container_entries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.acc_container_entries (
    id character varying(26) NOT NULL,
    customer_id character varying(26) NOT NULL,
    container_type character varying(8) NOT NULL,
    quantity_delta bigint NOT NULL,
    source_document_id character varying(26) NOT NULL,
    source_revision bigint NOT NULL,
    CONSTRAINT acc_container_entries_container_type_check CHECK (((container_type)::text = ANY ((ARRAY['SOLVENT'::character varying, 'RESIN'::character varying])::text[]))),
    CONSTRAINT acc_container_entries_quantity_delta_check CHECK ((quantity_delta <> 0))
);


--
-- Name: acc_depreciation_entries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.acc_depreciation_entries (
    id character varying(26) NOT NULL,
    book_id character varying(26) NOT NULL,
    asset_id character varying(26) NOT NULL,
    period_month date NOT NULL,
    amount_minor bigint NOT NULL,
    system_voucher_id character varying(26) NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT acc_depreciation_entries_amount_minor_check CHECK ((amount_minor > 0)),
    CONSTRAINT acc_depreciation_entries_period_month_check CHECK ((period_month = (date_trunc('month'::text, (period_month)::timestamp with time zone))::date))
);


--
-- Name: acc_inventory_cost_allocations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.acc_inventory_cost_allocations (
    entry_id character varying(26) NOT NULL,
    book_id character varying(26) NOT NULL,
    period_month date NOT NULL,
    quantity_micros bigint NOT NULL,
    cost_minor bigint NOT NULL,
    source_cost_entry_id character varying(26),
    system_voucher_id character varying(26),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT acc_inventory_cost_allocations_cost_minor_check CHECK ((cost_minor > 0)),
    CONSTRAINT acc_inventory_cost_allocations_period_month_check CHECK ((period_month = (date_trunc('month'::text, (period_month)::timestamp with time zone))::date)),
    CONSTRAINT acc_inventory_cost_allocations_quantity_micros_check CHECK ((quantity_micros > 0))
);


--
-- Name: acc_inventory_entries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.acc_inventory_entries (
    id character varying(26) NOT NULL,
    book_id character varying(26) NOT NULL,
    voucher_id character varying(26) NOT NULL,
    voucher_line_id character varying(26) NOT NULL,
	subject_id character varying(26) NOT NULL,
	product_id character varying(26) NOT NULL,
	product_approval_entry_id character varying(26) NOT NULL,
	product_code character varying(64) NOT NULL,
	product_name character varying(200) NOT NULL,
	warehouse_id character varying(26) NOT NULL,
    business_date date NOT NULL,
    quantity_delta_micros bigint NOT NULL,
    source_line_id character varying(64) NOT NULL,
    cost_counterpart_subject_id character varying(26),
    cost_counterpart_dimensions jsonb DEFAULT '{}'::jsonb NOT NULL,
    origin_source_document_id character varying(26),
    origin_source_line_id character varying(64),
    CONSTRAINT acc_inventory_entries_cost_counterpart_dimensions_check CHECK ((jsonb_typeof(cost_counterpart_dimensions) = 'object'::text)),
    CONSTRAINT acc_inventory_entries_quantity_delta_micros_check CHECK ((quantity_delta_micros <> 0))
);


--
-- Name: acc_mappings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.acc_mappings (
    id character varying(26) NOT NULL,
    book_id character varying(26) NOT NULL,
    vou_entity character varying(64) NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by character varying(26) NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by character varying(26) NOT NULL,
    CONSTRAINT acc_mappings_vou_entity_check CHECK (((vou_entity)::text ~ '^[a-z0-9]+(-[a-z0-9]+)*$'::text))
);


--
-- Name: dcl_acc_mapping_versions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.dcl_acc_mapping_versions (
    approval_entry_id character varying(26) NOT NULL,
    mapping_id character varying(26) NOT NULL,
    default_result character varying(7) NOT NULL,
    definition jsonb NOT NULL,
    CONSTRAINT dcl_acc_mapping_versions_default_result_check CHECK (((default_result)::text = ANY ((ARRAY['POST'::character varying, 'UN_POST'::character varying])::text[]))),
    CONSTRAINT dcl_acc_mapping_versions_definition_check CHECK ((jsonb_typeof(definition) = 'object'::text))
);


--
-- Name: acc_opening_assets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.acc_opening_assets (
    book_id character varying(26) NOT NULL,
    line_order integer NOT NULL,
    asset_id character varying(26) NOT NULL,
    create_object boolean NOT NULL,
    asset_no character varying(32),
    name character varying(200),
    category_id character varying(26),
    department_id character varying(26),
    useful_life_months integer,
    residual_rate_bps integer,
    acquired_on date,
    currency character varying(3) NOT NULL,
    original_minor bigint NOT NULL,
    accumulated_minor bigint NOT NULL,
    CONSTRAINT acc_opening_assets_check CHECK (((accumulated_minor >= 0) AND (accumulated_minor <= original_minor))),
    CONSTRAINT acc_opening_assets_check1 CHECK (((NOT create_object) OR ((asset_no IS NOT NULL) AND (btrim((asset_no)::text) <> ''::text) AND (name IS NOT NULL) AND (btrim((name)::text) <> ''::text) AND (category_id IS NOT NULL) AND (department_id IS NOT NULL) AND (useful_life_months > 0) AND ((residual_rate_bps >= 0) AND (residual_rate_bps <= 10000)) AND (acquired_on IS NOT NULL)))),
    CONSTRAINT acc_opening_assets_line_order_check CHECK ((line_order >= 0)),
    CONSTRAINT acc_opening_assets_original_minor_check CHECK ((original_minor > 0))
);


--
-- Name: acc_opening_bills; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.acc_opening_bills (
    book_id character varying(26) NOT NULL,
    line_order integer NOT NULL,
    bill_id character varying(26) NOT NULL,
    create_object boolean NOT NULL,
    bill_no character varying(64),
    bill_type character varying(32),
    position_type character varying(16),
    medium character varying(16),
    currency character varying(3) NOT NULL,
    face_amount_minor bigint,
    issue_date date,
    maturity_date date,
    drawer character varying(200),
    acceptor character varying(200),
    payee character varying(200),
    annual_rate_bps integer,
    interest_days integer,
    interest_amount_minor bigint,
    customer_cost_amount_minor bigint,
    origin_party_entity character varying(16),
    origin_party_object_id character varying(26),
    origin_party_approval_entry_id character varying(26),
    origin_party_code character varying(64),
    origin_party_name character varying(200),
    value_minor bigint NOT NULL,
    CONSTRAINT acc_opening_bills_check CHECK (((NOT create_object) OR ((bill_no IS NOT NULL) AND (btrim((bill_no)::text) <> ''::text) AND (bill_type IS NOT NULL) AND ((position_type)::text = ANY ((ARRAY['ASSET'::character varying, 'LIABILITY'::character varying])::text[])) AND ((medium)::text = ANY ((ARRAY['PAPER'::character varying, 'ELECTRONIC'::character varying])::text[])) AND (face_amount_minor > 0) AND (issue_date IS NOT NULL) AND (maturity_date >= issue_date) AND (drawer IS NOT NULL) AND (acceptor IS NOT NULL) AND (payee IS NOT NULL) AND ((annual_rate_bps >= 0) AND (annual_rate_bps <= 100000)) AND (interest_days >= 0) AND (interest_amount_minor >= 0) AND (customer_cost_amount_minor >= 0)))),
    CONSTRAINT acc_opening_bills_line_order_check CHECK ((line_order >= 0)),
    CONSTRAINT acc_opening_bills_value_minor_check CHECK ((value_minor > 0))
);


--
-- Name: acc_opening_containers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.acc_opening_containers (
    book_id character varying(26) NOT NULL,
    line_order integer NOT NULL,
    customer_id character varying(26) NOT NULL,
    container_type character varying(8) NOT NULL,
    quantity bigint NOT NULL,
    CONSTRAINT acc_opening_containers_container_type_check CHECK (((container_type)::text = ANY ((ARRAY['SOLVENT'::character varying, 'RESIN'::character varying])::text[]))),
    CONSTRAINT acc_opening_containers_line_order_check CHECK ((line_order >= 0)),
    CONSTRAINT acc_opening_containers_quantity_check CHECK ((quantity <> 0))
);


--
-- Name: acc_opening_lines; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.acc_opening_lines (
    id character varying(26) NOT NULL,
    book_id character varying(26) NOT NULL,
    subject_id character varying(26) NOT NULL,
    currency character varying(3) NOT NULL,
    debit_minor bigint DEFAULT 0 NOT NULL,
    credit_minor bigint DEFAULT 0 NOT NULL,
    quantity_micros bigint,
    dimensions jsonb DEFAULT '{}'::jsonb NOT NULL,
    line_order integer NOT NULL,
    CONSTRAINT acc_opening_lines_check CHECK ((((debit_minor > 0) AND (credit_minor = 0)) OR ((credit_minor > 0) AND (debit_minor = 0)))),
    CONSTRAINT acc_opening_lines_credit_minor_check CHECK ((credit_minor >= 0)),
    CONSTRAINT acc_opening_lines_currency_check CHECK (((currency)::text ~ '^[A-Z]{3}$'::text)),
    CONSTRAINT acc_opening_lines_debit_minor_check CHECK ((debit_minor >= 0)),
    CONSTRAINT acc_opening_lines_dimensions_check CHECK ((jsonb_typeof(dimensions) = 'object'::text)),
    CONSTRAINT acc_opening_lines_line_order_check CHECK ((line_order >= 0)),
    CONSTRAINT acc_opening_lines_quantity_micros_check CHECK ((quantity_micros > 0))
);


--
-- Name: acc_openings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.acc_openings (
    book_id character varying(26) NOT NULL,
    voucher_id character varying(26),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by character varying(26) NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by character varying(26) NOT NULL
);


--
-- Name: acc_period_balances; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.acc_period_balances (
    id character varying(26) NOT NULL,
    book_id character varying(26) NOT NULL,
    period_month date NOT NULL,
    subject_id character varying(26) NOT NULL,
    currency character varying(3) NOT NULL,
    dimensions jsonb NOT NULL,
    dimension_key text NOT NULL,
    opening_balance_minor bigint NOT NULL,
    debit_turnover_minor bigint NOT NULL,
    credit_turnover_minor bigint NOT NULL,
    closing_balance_minor bigint NOT NULL,
    CONSTRAINT acc_period_balances_credit_turnover_minor_check CHECK ((credit_turnover_minor >= 0)),
    CONSTRAINT acc_period_balances_debit_turnover_minor_check CHECK ((debit_turnover_minor >= 0)),
    CONSTRAINT acc_period_balances_dimensions_check CHECK ((jsonb_typeof(dimensions) = 'object'::text)),
    CONSTRAINT acc_period_balances_period_month_check CHECK ((period_month = (date_trunc('month'::text, (period_month)::timestamp with time zone))::date))
);


--
-- Name: acc_periods; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.acc_periods (
    book_id character varying(26) NOT NULL,
    period_month date NOT NULL,
    state character varying(8) NOT NULL,
    revision bigint DEFAULT 1 NOT NULL,
    locked_at timestamp with time zone,
    locked_by character varying(26),
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by character varying(26) NOT NULL,
    CONSTRAINT acc_periods_check CHECK (((((state)::text = 'LOCKED'::text) AND (locked_at IS NOT NULL) AND (locked_by IS NOT NULL)) OR (((state)::text = 'UNLOCKED'::text) AND (locked_at IS NULL) AND (locked_by IS NULL)))),
    CONSTRAINT acc_periods_period_month_check CHECK ((period_month = (date_trunc('month'::text, (period_month)::timestamp with time zone))::date)),
    CONSTRAINT acc_periods_revision_check CHECK ((revision >= 1)),
    CONSTRAINT acc_periods_state_check CHECK (((state)::text = ANY ((ARRAY['UNLOCKED'::character varying, 'LOCKED'::character varying])::text[])))
);


--
-- Name: acc_register_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.acc_register_events (
    source_entity character varying(64) NOT NULL,
    source_document_id character varying(26) NOT NULL,
    source_revision bigint NOT NULL
);


--
-- Name: acc_subject_dimensions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.acc_subject_dimensions (
    subject_id character varying(26) NOT NULL,
    dimension character varying(32) NOT NULL,
    CONSTRAINT acc_subject_dimensions_dimension_check CHECK (((dimension)::text = ANY (ARRAY[('CUSTOMER_ACCOUNT'::character varying)::text, ('SUPPLIER_RELATIONSHIP'::character varying)::text, ('SERVICE_RELATIONSHIP'::character varying)::text, ('EMPLOYMENT_RELATIONSHIP'::character varying)::text, ('SALES_RELATIONSHIP'::character varying)::text, ('DEPARTMENT'::character varying)::text, ('PRODUCT'::character varying)::text, ('WAREHOUSE'::character varying)::text, ('FUND_ACCOUNT'::character varying)::text, ('ASSET'::character varying)::text, ('BILL'::character varying)::text])))
);


--
-- Name: acc_subject_usages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.acc_subject_usages (
    subject_id character varying(26) NOT NULL,
    usage_type character varying(32) NOT NULL,
    usage_id character varying(64) NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT acc_subject_usages_usage_id_check CHECK ((btrim((usage_id)::text) <> ''::text)),
    CONSTRAINT acc_subject_usages_usage_type_check CHECK (((usage_type)::text ~ '^[A-Z][A-Z0-9_]{0,31}$'::text))
);


--
-- Name: acc_subjects; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.acc_subjects (
    id character varying(26) NOT NULL,
    book_id character varying(26) NOT NULL,
    code character varying(32) NOT NULL,
    name character varying(200) NOT NULL,
    parent_subject_id character varying(26),
    balance_direction character varying(6) NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    inventory_quantity boolean DEFAULT false NOT NULL,
    settlement_purpose character varying(20) DEFAULT 'NONE'::character varying NOT NULL,
    revision bigint DEFAULT 1 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by character varying(26) NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by character varying(26) NOT NULL,
    CONSTRAINT acc_subjects_balance_direction_check CHECK (((balance_direction)::text = ANY ((ARRAY['DEBIT'::character varying, 'CREDIT'::character varying])::text[]))),
    CONSTRAINT acc_subjects_code_check CHECK (((code)::text ~ '^[A-Z0-9][A-Z0-9.-]{0,31}$'::text)),
    CONSTRAINT acc_subjects_name_check CHECK ((btrim((name)::text) <> ''::text)),
    CONSTRAINT acc_subjects_revision_check CHECK ((revision >= 1)),
    CONSTRAINT acc_subjects_settlement_purpose_check CHECK (((settlement_purpose)::text = ANY ((ARRAY['NONE'::character varying, 'RECEIVABLE'::character varying, 'PREPAID'::character varying, 'PAYABLE'::character varying, 'ADVANCE_RECEIPT'::character varying, 'OTHER'::character varying])::text[])))
);


--
-- Name: acc_voucher_lines; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.acc_voucher_lines (
    id character varying(26) NOT NULL,
    book_id character varying(26) NOT NULL,
    voucher_id character varying(26) NOT NULL,
    subject_id character varying(26) NOT NULL,
    currency character varying(3) NOT NULL,
    debit_minor bigint DEFAULT 0 NOT NULL,
    credit_minor bigint DEFAULT 0 NOT NULL,
    quantity_micros bigint,
    dimensions jsonb DEFAULT '{}'::jsonb NOT NULL,
    source_line_id character varying(64) NOT NULL,
    line_order integer NOT NULL,
    CONSTRAINT acc_voucher_lines_credit_minor_check CHECK ((credit_minor >= 0)),
    CONSTRAINT acc_voucher_lines_currency_check CHECK (((currency)::text ~ '^[A-Z]{3}$'::text)),
    CONSTRAINT acc_voucher_lines_debit_minor_check CHECK ((debit_minor >= 0)),
    CONSTRAINT acc_voucher_lines_dimensions_check CHECK ((jsonb_typeof(dimensions) = 'object'::text)),
    CONSTRAINT acc_voucher_lines_line_order_check CHECK ((line_order >= 0)),
    CONSTRAINT acc_voucher_lines_quantity_micros_check CHECK ((quantity_micros > 0)),
    CONSTRAINT acc_voucher_lines_source_line_id_check CHECK ((btrim((source_line_id)::text) <> ''::text)),
    CONSTRAINT acc_voucher_lines_value_check CHECK ((((debit_minor > 0) AND (credit_minor = 0)) OR ((credit_minor > 0) AND (debit_minor = 0)) OR ((debit_minor = 0) AND (credit_minor = 0) AND (quantity_micros IS NOT NULL))))
);


--
-- Name: acc_vouchers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.acc_vouchers (
    id character varying(26) NOT NULL,
    book_id character varying(26) NOT NULL,
    source_type character varying(24) NOT NULL,
    source_id character varying(64) NOT NULL,
    business_date date NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by character varying(26) NOT NULL,
    mapping_approval_entry_id character varying(26),
    source_entity character varying(64),
    source_revision bigint,
    source_document_no character varying(64),
    CONSTRAINT acc_vouchers_source_id_check CHECK ((btrim((source_id)::text) <> ''::text)),
    CONSTRAINT acc_vouchers_source_type_check CHECK (((source_type)::text = ANY ((ARRAY['OPENING'::character varying, 'VOU'::character varying, 'COST_SETTLEMENT'::character varying, 'DEPRECIATION'::character varying])::text[]))),
    CONSTRAINT acc_vouchers_vou_source_check CHECK ((((source_type)::text <> 'VOU'::text) OR ((source_entity IS NOT NULL) AND (source_revision IS NOT NULL) AND (source_revision >= 1) AND (source_document_no IS NOT NULL) AND (btrim((source_document_no)::text) <> ''::text) AND (mapping_approval_entry_id IS NOT NULL))))
);


--
-- Name: app_audit_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_audit_events (
    id character varying(26) NOT NULL,
    event_type character varying(64) NOT NULL,
    actor_user_id character varying(26),
    target_type character varying(64),
    target_id character varying(26),
    result character varying(16) NOT NULL,
    request_id character varying(128),
    summary jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by character varying(26),
    CONSTRAINT app_audit_events_result_check CHECK (((result)::text = ANY ((ARRAY['SUCCESS'::character varying, 'FAILURE'::character varying])::text[])))
);


--
-- Name: app_business_menu_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_business_menu_items (
    id character varying(64) NOT NULL,
    parent_id character varying(64),
    item_type character varying(8) NOT NULL,
    item_level smallint NOT NULL,
    sort_order integer NOT NULL,
    display_name character varying(128) NOT NULL,
    icon character varying(128),
    enabled boolean DEFAULT true NOT NULL,
    route_key character varying(128),
    permission_code character varying(256),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by character varying(26),
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by character varying(26),
    CONSTRAINT app_business_menu_items_display_name_check CHECK ((btrim((display_name)::text) <> ''::text)),
    CONSTRAINT app_business_menu_items_item_level_check CHECK ((item_level = ANY (ARRAY[1, 2]))),
    CONSTRAINT app_business_menu_items_item_type_check CHECK (((item_type)::text = ANY ((ARRAY['GROUP'::character varying, 'ROUTE'::character varying])::text[]))),
    CONSTRAINT app_business_menu_items_shape CHECK (((((item_type)::text = 'GROUP'::text) AND (item_level = 1) AND (parent_id IS NULL) AND (route_key IS NULL) AND (permission_code IS NULL)) OR (((item_type)::text = 'ROUTE'::text) AND (item_level = 1) AND (parent_id IS NULL) AND (route_key IS NOT NULL) AND (permission_code IS NOT NULL)) OR (((item_type)::text = 'ROUTE'::text) AND (item_level = 2) AND (parent_id IS NOT NULL) AND (route_key IS NOT NULL) AND (permission_code IS NOT NULL)))),
    CONSTRAINT app_business_menu_items_sort_order_check CHECK ((sort_order >= 0))
);


--
-- Name: app_menu_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_menu_settings (
    id smallint DEFAULT 1 NOT NULL,
    menu_mode character varying(16) DEFAULT 'DEFAULT'::character varying NOT NULL,
    revision bigint DEFAULT 1 NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by character varying(26),
    CONSTRAINT app_menu_settings_id_check CHECK ((id = 1)),
    CONSTRAINT app_menu_settings_mode_check CHECK (((menu_mode)::text = ANY ((ARRAY['DEFAULT'::character varying, 'BUSINESS'::character varying])::text[]))),
    CONSTRAINT app_menu_settings_revision_check CHECK ((revision > 0))
);


--
-- Name: app_permissions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_permissions (
    id character varying(26) NOT NULL,
    path character varying(255) NOT NULL,
    domain character varying(64) NOT NULL,
    entity character varying(64) NOT NULL,
    action character varying(64) NOT NULL,
    description text,
    status character varying(16) NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by character varying(26),
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by character varying(26),
    revision bigint DEFAULT 1 NOT NULL,
    menu_order integer,
    CONSTRAINT app_permissions_action_format CHECK (((action)::text ~ '^[a-z0-9]+(-[a-z0-9]+)*$'::text)),
    CONSTRAINT app_permissions_check CHECK (((menu_order IS NULL) OR ((action)::text = 'query'::text))),
    CONSTRAINT app_permissions_domain_format CHECK (((domain)::text ~ '^[a-z0-9]+(-[a-z0-9]+)*$'::text)),
    CONSTRAINT app_permissions_entity_format CHECK (((entity)::text ~ '^[a-z0-9]+(-[a-z0-9]+)*$'::text)),
    CONSTRAINT app_permissions_path_matches_parts CHECK (((path)::text = ((((('/'::text || (domain)::text) || '/'::text) || (entity)::text) || '/'::text) || (action)::text))),
    CONSTRAINT app_permissions_revision_check CHECK ((revision >= 1)),
    CONSTRAINT app_permissions_status_check CHECK (((status)::text = ANY ((ARRAY['ENABLED'::character varying, 'DISABLED'::character varying])::text[])))
);


--
-- Name: app_role_code_counters; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_role_code_counters (
    counter_key text NOT NULL,
    next_value integer NOT NULL,
    CONSTRAINT app_role_code_counters_next_value_check CHECK (((next_value >= 0) AND (next_value <= 9999)))
);

--
-- Name: dcl_rpt_definition_code_counters; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.dcl_rpt_definition_code_counters (
    counter_key text NOT NULL,
    next_value integer NOT NULL,
    CONSTRAINT dcl_rpt_definition_code_counters_next_value_check CHECK (((next_value >= 0) AND (next_value <= 999999)))
);


--
-- Name: app_role_permissions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_role_permissions (
    role_id character varying(26) NOT NULL,
    permission_id character varying(26) NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by character varying(26)
);


--
-- Name: app_roles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_roles (
    id character varying(26) NOT NULL,
    code character varying(64) NOT NULL,
    name character varying(128) NOT NULL,
    description text,
    status character varying(16) NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by character varying(26),
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by character varying(26),
    revision bigint DEFAULT 1 NOT NULL,
    CONSTRAINT app_roles_revision_check CHECK ((revision >= 1)),
    CONSTRAINT app_roles_status_check CHECK (((status)::text = ANY ((ARRAY['ENABLED'::character varying, 'DISABLED'::character varying])::text[])))
);


--
-- Name: app_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_sessions (
    id character varying(26) NOT NULL,
    user_id character varying(26) NOT NULL,
    token_hash bytea NOT NULL,
    csrf_token_hash bytea NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    last_seen_at timestamp with time zone NOT NULL,
    idle_expires_at timestamp with time zone NOT NULL,
    absolute_expires_at timestamp with time zone NOT NULL,
    revoked_at timestamp with time zone,
    revoked_reason character varying(64),
    CONSTRAINT app_sessions_csrf_token_hash_check CHECK ((octet_length(csrf_token_hash) = 32)),
    CONSTRAINT app_sessions_expiry_order CHECK ((idle_expires_at <= absolute_expires_at)),
    CONSTRAINT app_sessions_token_hash_check CHECK ((octet_length(token_hash) = 32))
);


--
-- Name: app_system_parameters; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_system_parameters (
    parameter_key character varying(128) NOT NULL,
    name character varying(128) NOT NULL,
    description text,
    value_type character varying(16) NOT NULL,
    configured_value text CONSTRAINT app_system_parameters_current_value_not_null NOT NULL,
    default_value text NOT NULL,
    editable boolean DEFAULT true NOT NULL,
    revision bigint DEFAULT 1 NOT NULL,
    constraints jsonb,
    CONSTRAINT app_system_parameters_constraints_shape CHECK (((constraints IS NULL) OR (jsonb_typeof(constraints) = 'object'::text))),
    CONSTRAINT app_system_parameters_editable_constraints CHECK (((NOT editable) OR (constraints IS NOT NULL))),
    CONSTRAINT app_system_parameters_key_format CHECK (((parameter_key)::text ~ '^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)+$'::text)),
    CONSTRAINT app_system_parameters_revision_check CHECK ((revision > 0)),
    CONSTRAINT app_system_parameters_value_type CHECK (((value_type)::text = ANY ((ARRAY['STRING'::character varying, 'INTEGER'::character varying, 'DECIMAL'::character varying, 'BOOLEAN'::character varying])::text[])))
);


--
-- Name: app_user_profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_user_profiles (
    user_id character varying(26) NOT NULL,
    avatar_url character varying(500) NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by character varying(26),
    CONSTRAINT app_user_profiles_avatar_url_check CHECK (((length(btrim((avatar_url)::text)) >= 1) AND (length(btrim((avatar_url)::text)) <= 500)))
);


--
-- Name: app_user_roles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_user_roles (
    user_id character varying(26) NOT NULL,
    role_id character varying(26) NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by character varying(26)
);


--
-- Name: app_users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_users (
    id character varying(26) NOT NULL,
    username character varying(64) NOT NULL,
    display_name character varying(128) NOT NULL,
    password_hash text NOT NULL,
    status character varying(16) NOT NULL,
    failed_signin_count integer DEFAULT 0 NOT NULL,
    locked_until timestamp with time zone,
    password_changed_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by character varying(26),
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by character varying(26),
    revision bigint DEFAULT 1 NOT NULL,
    password_change_required boolean DEFAULT true NOT NULL,
    CONSTRAINT app_users_failed_signin_count_check CHECK ((failed_signin_count >= 0)),
    CONSTRAINT app_users_revision_check CHECK ((revision >= 1)),
    CONSTRAINT app_users_status_check CHECK (((status)::text = ANY ((ARRAY['ENABLED'::character varying, 'DISABLED'::character varying])::text[])))
);


--
-- Name: aux_objects; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.aux_objects (
    id character varying(26) NOT NULL,
    entity character varying(32) NOT NULL,
    code character varying(64) NOT NULL,
    data jsonb NOT NULL DEFAULT '{}'::jsonb,
    enabled boolean DEFAULT true NOT NULL,
    revision bigint DEFAULT 1 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by character varying(26) NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by character varying(26) NOT NULL,
    CONSTRAINT aux_objects_code_check CHECK (((code)::text ~ '^[A-Z]{3}-[0-9]{4}$'::text)),
    CONSTRAINT aux_objects_entity_check CHECK (((entity)::text = ANY ((ARRAY['product-category'::character varying, 'product-type'::character varying, 'employee-category'::character varying, 'department'::character varying, 'position'::character varying, 'settlement-method'::character varying, 'payment-method'::character varying, 'dictionary-type'::character varying, 'dictionary-item'::character varying, 'measurement-unit'::character varying, 'income-expense-type'::character varying, 'asset-category'::character varying])::text[]))),
    CONSTRAINT aux_objects_revision_check CHECK ((revision >= 1))
    ,CONSTRAINT aux_objects_data_object_check CHECK ((jsonb_typeof(data) = 'object'::text))
);


-- Central Approval persistence. Domain subjects remain owned by their Domain;
-- subject_id is intentionally a controlled logical foreign key.
--
CREATE TABLE public.approval_entries (
    id character varying(26) NOT NULL,
    domain character varying(32) NOT NULL,
    entity character varying(64) NOT NULL,
    subject_id character varying(128) NOT NULL,
    version_no integer,
    status character varying(16) NOT NULL,
    revision bigint DEFAULT 1 NOT NULL,
    created_by character varying(26) NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_by character varying(26) NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    submitted_by character varying(26),
    submitted_at timestamp with time zone,
    approved_by character varying(26),
    approved_at timestamp with time zone,
    CONSTRAINT approval_entries_pkey PRIMARY KEY (id),
    CONSTRAINT approval_entries_domain_check CHECK (((domain)::text ~ '^[a-z][a-z0-9-]{0,31}$'::text)),
    CONSTRAINT approval_entries_entity_check CHECK (((entity)::text ~ '^[a-z][a-z0-9-]{0,63}$'::text)),
    CONSTRAINT approval_entries_subject_id_check CHECK ((length(btrim((subject_id)::text)) >= 1)),
    CONSTRAINT approval_entries_version_no_check CHECK (((version_no IS NULL) OR (version_no >= 1))),
    CONSTRAINT approval_entries_status_check CHECK (((status)::text = ANY ((ARRAY['DRAFT'::character varying, 'PENDING'::character varying, 'APPROVED'::character varying])::text[]))),
    CONSTRAINT approval_entries_revision_check CHECK ((revision >= 1)),
    CONSTRAINT approval_entries_metadata_check CHECK (
        (((status)::text = 'DRAFT'::text) AND submitted_by IS NULL AND submitted_at IS NULL AND approved_by IS NULL AND approved_at IS NULL)
        OR (((status)::text = 'PENDING'::text) AND submitted_by IS NOT NULL AND submitted_at IS NOT NULL AND approved_by IS NULL AND approved_at IS NULL)
        OR (((status)::text = 'APPROVED'::text) AND submitted_by IS NOT NULL AND submitted_at IS NOT NULL AND approved_by IS NOT NULL AND approved_at IS NOT NULL AND approved_by <> submitted_by)
    )
);
CREATE UNIQUE INDEX approval_entries_approval_only_unique
    ON public.approval_entries USING btree (domain, entity, subject_id)
    WHERE (version_no IS NULL);
CREATE UNIQUE INDEX approval_entries_version_unique
    ON public.approval_entries USING btree (domain, entity, subject_id, version_no)
    WHERE (version_no IS NOT NULL);
CREATE UNIQUE INDEX approval_entries_open_version_unique
    ON public.approval_entries USING btree (domain, entity, subject_id)
    WHERE ((version_no IS NOT NULL) AND ((status)::text = ANY ((ARRAY['DRAFT'::character varying, 'PENDING'::character varying])::text[])));
CREATE INDEX approval_entries_latest_approved_idx
    ON public.approval_entries USING btree (domain, entity, subject_id, version_no DESC)
    WHERE ((version_no IS NOT NULL) AND ((status)::text = 'APPROVED'::text));

COMMENT ON COLUMN public.approval_entries.version_no IS
    'NULL for Approval-only entries; positive and required for Approval Version entries.';
COMMENT ON INDEX public.approval_entries_version_unique IS
    'One immutable version number per domain/entity/stable subject.';
COMMENT ON INDEX public.approval_entries_open_version_unique IS
    'At most one DRAFT or PENDING candidate per versioned stable subject.';
COMMENT ON INDEX public.approval_entries_latest_approved_idx IS
    'Supports highest approved version lookup without a current-version pointer.';

-- DCL owns stable versioned declaration subjects.  Each concrete entity keeps
-- its own typed snapshot table; lifecycle and version numbers stay exclusively
-- in approval_entries.
CREATE TABLE public.dcl_subjects (
    id character varying(26) NOT NULL,
    entity character varying(64) NOT NULL,
    code character varying(64),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by character varying(26) NOT NULL,
    CONSTRAINT dcl_subjects_pkey PRIMARY KEY (id),
    CONSTRAINT dcl_subjects_id_entity_key UNIQUE (id, entity),
    CONSTRAINT dcl_subjects_code_check CHECK (((entity)::text = 'rpt-definition'::character varying AND (code IS NOT NULL) AND ((code)::text ~ '^[a-z][a-z0-9-]{1,62}[a-z0-9]$'::text))
        OR ((entity)::text <> 'rpt-definition'::character varying AND ((code IS NULL) OR ((code)::text ~ '^[A-Z]{3}-[0-9]{4}$'::text)))),
    CONSTRAINT dcl_subjects_core_code_required_ck CHECK (((entity)::text <> 'rpt-definition'::character varying) OR (code IS NOT NULL)),
    CONSTRAINT dcl_subjects_entity_check CHECK (((entity)::text = ANY ((ARRAY['operating-entity'::character varying, 'warehouse'::character varying, 'vehicle'::character varying, 'fund-account'::character varying, 'product'::character varying, 'party'::character varying, 'employee'::character varying, 'other-unit'::character varying, 'sales-partner'::character varying, 'supplier'::character varying, 'customer'::character varying, 'customer-account'::character varying, 'acc-mapping'::character varying, 'rpt-definition'::character varying, 'wfl-process-definition'::character varying])::text[])))
);

CREATE TABLE public.dcl_operating_entity_versions (
    approval_entry_id character varying(26) NOT NULL,
    legal_name character varying(200) NOT NULL,
    short_name character varying(100),
    tax_number character varying(100),
    address character varying(500),
    phone character varying(100),
    remark character varying(1000),
    enabled boolean NOT NULL,
    CONSTRAINT dcl_operating_entity_versions_pkey PRIMARY KEY (approval_entry_id),
    CONSTRAINT dcl_operating_entity_versions_legal_name_check CHECK (((length(btrim((legal_name)::text)) >= 1) AND (length(btrim((legal_name)::text)) <= 200)))
);

-- Party and every typed Party-to-operating-entity relationship are DCL-owned
-- stable roots.  Mutable data remains in the typed approval snapshots below.
CREATE TABLE public.dcl_parties (
    id character varying(26) NOT NULL,
    entity character varying(16) DEFAULT 'party'::character varying NOT NULL,
    merged_into_party_id character varying(26),
    merged_at timestamp with time zone,
    CONSTRAINT dcl_parties_pkey PRIMARY KEY (id),
    CONSTRAINT dcl_parties_entity_ck CHECK (entity='party'),
    CONSTRAINT dcl_parties_merge_state_ck CHECK ((((merged_into_party_id IS NULL) AND (merged_at IS NULL)) OR ((merged_into_party_id IS NOT NULL) AND (merged_at IS NOT NULL) AND ((merged_into_party_id)::text <> (id)::text))))
);

CREATE TABLE public.dcl_customer_relationships (
    object_id character varying(26) NOT NULL, object_entity character varying(16) DEFAULT 'customer'::character varying NOT NULL,
    party_id character varying(26) NOT NULL,
    operating_entity_id character varying(26) NOT NULL, operating_entity_entity character varying(16) DEFAULT 'operating-entity'::character varying NOT NULL,
    merged_into_object_id character varying(26), merged_at timestamp with time zone,
    CONSTRAINT dcl_customer_relationships_pkey PRIMARY KEY (object_id),
    CONSTRAINT dcl_customer_relationships_entity_ck CHECK (object_entity='customer' AND operating_entity_entity='operating-entity'),
    CONSTRAINT dcl_customer_relationships_merge_ck CHECK ((((merged_into_object_id IS NULL) AND (merged_at IS NULL)) OR ((merged_into_object_id IS NOT NULL) AND (merged_at IS NOT NULL) AND ((merged_into_object_id)::text <> (object_id)::text))))
);
CREATE TABLE public.dcl_employment_relationships (
    object_id character varying(26) NOT NULL, object_entity character varying(16) DEFAULT 'employee'::character varying NOT NULL, party_id character varying(26) NOT NULL, operating_entity_id character varying(26) NOT NULL, operating_entity_entity character varying(16) DEFAULT 'operating-entity'::character varying NOT NULL,
    merged_into_object_id character varying(26), merged_at timestamp with time zone,
    CONSTRAINT dcl_employment_relationships_pkey PRIMARY KEY (object_id),
    CONSTRAINT dcl_employment_relationships_entity_ck CHECK (object_entity='employee' AND operating_entity_entity='operating-entity'),
    CONSTRAINT dcl_employment_relationships_merge_ck CHECK ((((merged_into_object_id IS NULL) AND (merged_at IS NULL)) OR ((merged_into_object_id IS NOT NULL) AND (merged_at IS NOT NULL) AND ((merged_into_object_id)::text <> (object_id)::text))))
);
CREATE TABLE public.dcl_supplier_relationships (
    object_id character varying(26) NOT NULL, object_entity character varying(16) DEFAULT 'supplier'::character varying NOT NULL, party_id character varying(26) NOT NULL, operating_entity_id character varying(26) NOT NULL, operating_entity_entity character varying(16) DEFAULT 'operating-entity'::character varying NOT NULL,
    merged_into_object_id character varying(26), merged_at timestamp with time zone,
    CONSTRAINT dcl_supplier_relationships_pkey PRIMARY KEY (object_id),
    CONSTRAINT dcl_supplier_relationships_entity_ck CHECK (object_entity='supplier' AND operating_entity_entity='operating-entity'),
    CONSTRAINT dcl_supplier_relationships_merge_ck CHECK ((((merged_into_object_id IS NULL) AND (merged_at IS NULL)) OR ((merged_into_object_id IS NOT NULL) AND (merged_at IS NOT NULL) AND ((merged_into_object_id)::text <> (object_id)::text))))
);
CREATE TABLE public.dcl_service_relationships (
    object_id character varying(26) NOT NULL, object_entity character varying(16) DEFAULT 'other-unit'::character varying NOT NULL, party_id character varying(26) NOT NULL, operating_entity_id character varying(26) NOT NULL, operating_entity_entity character varying(16) DEFAULT 'operating-entity'::character varying NOT NULL,
    merged_into_object_id character varying(26), merged_at timestamp with time zone,
    CONSTRAINT dcl_service_relationships_pkey PRIMARY KEY (object_id),
    CONSTRAINT dcl_service_relationships_entity_ck CHECK (object_entity='other-unit' AND operating_entity_entity='operating-entity'),
    CONSTRAINT dcl_service_relationships_merge_ck CHECK ((((merged_into_object_id IS NULL) AND (merged_at IS NULL)) OR ((merged_into_object_id IS NOT NULL) AND (merged_at IS NOT NULL) AND ((merged_into_object_id)::text <> (object_id)::text))))
);
CREATE TABLE public.dcl_sales_relationships (
    object_id character varying(26) NOT NULL, object_entity character varying(16) DEFAULT 'sales-partner'::character varying NOT NULL, party_id character varying(26) NOT NULL, operating_entity_id character varying(26) NOT NULL, operating_entity_entity character varying(16) DEFAULT 'operating-entity'::character varying NOT NULL,
    merged_into_object_id character varying(26), merged_at timestamp with time zone,
    CONSTRAINT dcl_sales_relationships_pkey PRIMARY KEY (object_id),
    CONSTRAINT dcl_sales_relationships_entity_ck CHECK (object_entity='sales-partner' AND operating_entity_entity='operating-entity'),
    CONSTRAINT dcl_sales_relationships_merge_ck CHECK ((((merged_into_object_id IS NULL) AND (merged_at IS NULL)) OR ((merged_into_object_id IS NOT NULL) AND (merged_at IS NOT NULL) AND ((merged_into_object_id)::text <> (object_id)::text))))
);
CREATE TABLE public.dcl_customer_accounts (
    object_id character varying(26) NOT NULL, object_entity character varying(16) DEFAULT 'customer-account'::character varying NOT NULL, customer_relationship_id character varying(26) NOT NULL,
    CONSTRAINT dcl_customer_accounts_pkey PRIMARY KEY (object_id),
    CONSTRAINT dcl_customer_accounts_entity_ck CHECK (object_entity='customer-account')
);
CREATE VIEW public.dcl_party_relationship_endpoints AS
  SELECT object_id,party_id,operating_entity_id,merged_into_object_id,'customer'::text AS entity FROM public.dcl_customer_relationships
  UNION ALL SELECT object_id,party_id,operating_entity_id,merged_into_object_id,'supplier'::text FROM public.dcl_supplier_relationships
  UNION ALL SELECT object_id,party_id,operating_entity_id,merged_into_object_id,'employee'::text FROM public.dcl_employment_relationships
  UNION ALL SELECT object_id,party_id,operating_entity_id,merged_into_object_id,'other-unit'::text FROM public.dcl_service_relationships
  UNION ALL SELECT object_id,party_id,operating_entity_id,merged_into_object_id,'sales-partner'::text FROM public.dcl_sales_relationships;
CREATE TABLE public.dcl_party_merge_preflights (
    id character varying(26) NOT NULL, source_party_id character varying(26) NOT NULL, target_party_id character varying(26) NOT NULL,
    source_approval_entry_id character varying(26) NOT NULL, target_approval_entry_id character varying(26) NOT NULL,
    source_approval_revision bigint NOT NULL, target_approval_revision bigint NOT NULL, state_fingerprint character(64) NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL, created_by character varying(26) NOT NULL, request_id character varying(128) NOT NULL,
    consumed_at timestamp with time zone, consumed_by character varying(26),
    CONSTRAINT dcl_party_merge_preflights_pkey PRIMARY KEY (id),
    CONSTRAINT dcl_party_merge_preflights_distinct_ck CHECK (source_party_id <> target_party_id),
    CONSTRAINT dcl_party_merge_preflights_consumed_ck CHECK (((consumed_at IS NULL) AND (consumed_by IS NULL)) OR ((consumed_at IS NOT NULL) AND (consumed_by IS NOT NULL))),
    CONSTRAINT dcl_party_merge_preflights_revision_ck CHECK (source_approval_revision >= 1 AND target_approval_revision >= 1),
    CONSTRAINT dcl_party_merge_preflights_fingerprint_ck CHECK (state_fingerprint ~ '^[0-9a-f]{64}$')
);
CREATE TABLE public.dcl_party_merge_events (
    id character varying(26) NOT NULL, preflight_id character varying(26) NOT NULL,
    source_party_id character varying(26) NOT NULL, target_party_id character varying(26) NOT NULL,
    actor_id character varying(26) NOT NULL, request_id character varying(128) NOT NULL,
    occurred_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT dcl_party_merge_events_pkey PRIMARY KEY (id),
    CONSTRAINT dcl_party_merge_events_preflight_id_key UNIQUE (preflight_id),
    CONSTRAINT dcl_party_merge_events_distinct_ck CHECK (source_party_id <> target_party_id)
);
CREATE TABLE public.dcl_party_relationship_merge_events (
    id character varying(26) NOT NULL, merge_event_id character varying(26) NOT NULL,
    relationship_type character varying(16) NOT NULL, source_object_id character varying(26) NOT NULL,
    target_object_id character varying(26), operating_entity_id character varying(26) NOT NULL,
    operating_entity_entity character varying(16) DEFAULT 'operating-entity'::character varying NOT NULL,
    action character varying(16) NOT NULL, occurred_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT dcl_party_relationship_merge_events_pkey PRIMARY KEY (id),
    CONSTRAINT dcl_party_relationship_merge_events_action_ck CHECK (action IN ('TRANSFERRED','MERGED')),
    CONSTRAINT dcl_party_relationship_merge_events_shape_ck CHECK (((action='TRANSFERRED') AND target_object_id IS NULL) OR ((action='MERGED') AND target_object_id IS NOT NULL)),
    CONSTRAINT dcl_party_relationship_merge_events_type_ck CHECK (relationship_type IN ('customer','supplier','employee','other-unit','sales-partner')),
    CONSTRAINT dcl_party_relationship_merge_events_operating_entity_ck CHECK (operating_entity_entity='operating-entity')
);

-- This DCL payload intentionally contains no Party identity data.
CREATE TABLE public.dcl_employee_versions (
    approval_entry_id character varying(26) NOT NULL,
    employee_category_id character varying(26),
    employee_category_code character varying(64),
    employee_category_name character varying(200),
    department_id character varying(26),
    department_code character varying(64),
    department_name character varying(200),
    position_id character varying(26),
    position_code character varying(64),
    position_name character varying(200),
    phone character varying(32),
    email character varying(254),
    hire_date date,
    remark character varying(1000),
    enabled boolean NOT NULL,
    CONSTRAINT dcl_employee_versions_pkey PRIMARY KEY (approval_entry_id),
    CONSTRAINT dcl_employee_versions_employee_category_snapshot_check CHECK (((employee_category_id IS NULL) = (employee_category_code IS NULL)) AND ((employee_category_id IS NULL) = (employee_category_name IS NULL))),
    CONSTRAINT dcl_employee_versions_department_snapshot_check CHECK (((department_id IS NULL) = (department_code IS NULL)) AND ((department_id IS NULL) = (department_name IS NULL))),
    CONSTRAINT dcl_employee_versions_position_snapshot_check CHECK (((position_id IS NULL) = (position_code IS NULL)) AND ((position_id IS NULL) = (position_name IS NULL)))
);

-- Other Unit and Sales Partner keep their immutable Party-to-operating-entity
-- identities in typed DCL roots alongside their declaration snapshots.
CREATE TABLE public.dcl_other_unit_versions (
    approval_entry_id character varying(26) NOT NULL,
    contact_name character varying(100),
    contact_phone character varying(32),
    email character varying(254),
    address character varying(500),
    settlement_method_id character varying(26),
    settlement_method_code character varying(32),
    settlement_method_name character varying(200),
    settlement_term_code character varying(32),
    settlement_rule_type character varying(32),
    settlement_month_offset integer DEFAULT 0 NOT NULL,
    settlement_day_of_month integer DEFAULT 0 NOT NULL,
    settlement_day_offset integer DEFAULT 0 NOT NULL,
    remark character varying(1000),
    enabled boolean NOT NULL,
    CONSTRAINT dcl_other_unit_versions_pkey PRIMARY KEY (approval_entry_id),
    CONSTRAINT dcl_other_unit_settlement_ck CHECK (((settlement_method_id IS NULL) = (settlement_method_code IS NULL)) AND ((settlement_method_id IS NULL) = (settlement_method_name IS NULL)) AND ((settlement_method_id IS NULL) = (settlement_term_code IS NULL)) AND ((settlement_method_id IS NULL) = (settlement_rule_type IS NULL)) AND ((settlement_method_id IS NOT NULL) OR ((settlement_month_offset = 0) AND (settlement_day_of_month = 0) AND (settlement_day_offset = 0)))),
    CONSTRAINT dcl_other_unit_day_of_month_ck CHECK ((settlement_day_of_month >= 0) AND (settlement_day_of_month <= 31)),
    CONSTRAINT dcl_other_unit_day_offset_ck CHECK (settlement_day_offset >= 0),
    CONSTRAINT dcl_other_unit_month_offset_ck CHECK (settlement_month_offset >= 0)
);

CREATE TABLE public.dcl_sales_partner_versions (
    approval_entry_id character varying(26) NOT NULL,
    capabilities character varying(32)[] DEFAULT '{}'::character varying[] NOT NULL,
    contact_name character varying(100),
    contact_phone character varying(32),
    email character varying(254),
    address character varying(500),
    remark character varying(1000),
    enabled boolean NOT NULL,
    CONSTRAINT dcl_sales_partner_versions_pkey PRIMARY KEY (approval_entry_id),
    CONSTRAINT dcl_sales_partner_capabilities_ck CHECK ((capabilities <@ ARRAY['EXTERNAL_PART_TIME'::character varying(32), 'CHANNEL_PARTNER'::character varying(32)]) AND cardinality(capabilities) <= 2 AND (cardinality(capabilities) < 2 OR capabilities[1] <> capabilities[2]))
);

CREATE TABLE public.dcl_supplier_versions (
    approval_entry_id character varying(26) NOT NULL,
    short_name character varying(100), tax_number character varying(50),
    contact_name character varying(100), contact_phone character varying(32), email character varying(254),
    address character varying(500), remark character varying(1000),
    settlement_method_id character varying(26),
    settlement_method_code character varying(32), settlement_method_name character varying(200),
    settlement_term_code character varying(32), settlement_rule_type character varying(32),
    settlement_month_offset integer NOT NULL DEFAULT 0, settlement_day_of_month integer NOT NULL DEFAULT 0,
    settlement_day_offset integer NOT NULL DEFAULT 0,
    default_purchaser_employee_id character varying(26), default_purchaser_employee_entity character varying(16) DEFAULT 'employee'::character varying NOT NULL, default_purchaser_employee_approval_entry_id character varying(26),
    default_purchaser_employee_code character varying(64), default_purchaser_employee_name character varying(200),
    enabled boolean NOT NULL,
    CONSTRAINT dcl_supplier_versions_pkey PRIMARY KEY (approval_entry_id),
    CONSTRAINT dcl_supplier_settlement_snapshot_ck CHECK (
      (settlement_method_id IS NULL)=(settlement_method_code IS NULL)
      AND (settlement_method_id IS NULL)=(settlement_method_name IS NULL)
      AND (settlement_method_id IS NULL)=(settlement_term_code IS NULL)
      AND (settlement_method_id IS NULL)=(settlement_rule_type IS NULL)
      AND (settlement_method_id IS NOT NULL OR (settlement_month_offset=0 AND settlement_day_of_month=0 AND settlement_day_offset=0))
    ),
    CONSTRAINT dcl_supplier_default_purchaser_snapshot_ck CHECK (
      (default_purchaser_employee_id IS NULL)=(default_purchaser_employee_approval_entry_id IS NULL)
      AND (default_purchaser_employee_id IS NULL)=(default_purchaser_employee_code IS NULL)
      AND (default_purchaser_employee_id IS NULL)=(default_purchaser_employee_name IS NULL)
    ),
    CONSTRAINT dcl_supplier_default_purchaser_employee_entity_ck CHECK (default_purchaser_employee_entity='employee')
);

-- Party keeps a stable typed DCL root because every relationship refers to it;
-- identity data is visible to BOB only from the highest approved DCL snapshot.
CREATE TABLE public.dcl_party_versions (
    approval_entry_id character varying(26) NOT NULL,
    party_id character varying(26) NOT NULL,
    kind character varying(16) NOT NULL,
    legal_name character varying(200) NOT NULL,
    display_name character varying(200) NOT NULL,
    tax_number character varying(100),
    phone character varying(32),
    email character varying(254),
    address character varying(500),
    CONSTRAINT dcl_party_versions_pkey PRIMARY KEY (approval_entry_id),
    CONSTRAINT dcl_party_versions_kind_check CHECK ((kind)::text = ANY ((ARRAY['PERSON'::character varying, 'ORGANIZATION'::character varying])::text[])),
    CONSTRAINT dcl_party_versions_legal_name_check CHECK ((length(btrim((legal_name)::text)) >= 1) AND (length(btrim((legal_name)::text)) <= 200)),
    CONSTRAINT dcl_party_versions_display_name_check CHECK ((length(btrim((display_name)::text)) >= 1) AND (length(btrim((display_name)::text)) <= 200))
);

CREATE TABLE public.dcl_party_version_identifiers (
    approval_entry_id character varying(26) NOT NULL,
    identifier_type character varying(40) NOT NULL,
    value character varying(100) NOT NULL,
    normalized_value character varying(100) NOT NULL,
    CONSTRAINT dcl_party_version_identifiers_pkey PRIMARY KEY (approval_entry_id, identifier_type, normalized_value),
    CONSTRAINT dcl_party_version_identifiers_type_check CHECK ((identifier_type)::text = ANY ((ARRAY['PERSON_ID'::character varying, 'UNIFIED_SOCIAL_CREDIT_CODE'::character varying, 'TAX_NUMBER'::character varying])::text[]))
);

-- A claim holds the latest approved value plus the sole open candidate. The
-- unique key is deliberately shared by both states so no candidate can race a
-- currently approved Party identity.
CREATE TABLE public.dcl_party_identifier_claims (
    identifier_type character varying(40) NOT NULL,
    normalized_value character varying(100) NOT NULL,
    approved_party_id character varying(26),
    approved_approval_entry_id character varying(26),
    open_party_id character varying(26),
    open_approval_entry_id character varying(26),
    CONSTRAINT dcl_party_identifier_claims_pkey PRIMARY KEY (identifier_type, normalized_value),
    CONSTRAINT dcl_party_identifier_claims_approved_pair_check CHECK ((approved_party_id IS NULL) = (approved_approval_entry_id IS NULL)),
    CONSTRAINT dcl_party_identifier_claims_open_pair_check CHECK ((open_party_id IS NULL) = (open_approval_entry_id IS NULL))
);

CREATE TABLE public.dcl_warehouse_versions (
    approval_entry_id character varying(26) NOT NULL,
    -- Retained only for the #279 in-place cutover. Warehouse no longer
    -- exposes category as a writable declaration field.
	category_id character varying(26),
	category_entity character varying(16) DEFAULT 'category'::character varying NOT NULL,
    name character varying(200) NOT NULL,
    address character varying(500),
    contact_name character varying(100),
    contact_phone character varying(32),
    manager_employee_id character varying(26),
    manager_employee_approval_entry_id character varying(26),
    manager_employee_entity character varying(16) DEFAULT 'employee'::character varying NOT NULL,
    remark character varying(1000),
    enabled boolean NOT NULL,
    CONSTRAINT dcl_warehouse_versions_pkey PRIMARY KEY (approval_entry_id),
    CONSTRAINT dcl_warehouse_versions_category_entity_check CHECK (((category_entity)::text = 'category'::text)),
    CONSTRAINT dcl_warehouse_versions_manager_employee_entity_check CHECK (((manager_employee_entity)::text = 'employee'::text)),
    CONSTRAINT dcl_warehouse_versions_name_check CHECK (((length(btrim((name)::text)) >= 1) AND (length(btrim((name)::text)) <= 200)))
);

CREATE TABLE public.approval_events (
    id character varying(26) NOT NULL,
    entry_id character varying(26) NOT NULL,
    domain character varying(32) NOT NULL,
    entity character varying(64) NOT NULL,
    subject_id character varying(128) NOT NULL,
    version_no integer,
    action character varying(16) NOT NULL,
    from_status character varying(16),
    to_status character varying(16),
    from_revision bigint,
    to_revision bigint,
    actor_id character varying(26) NOT NULL,
    reason text,
    request_id character varying(128) NOT NULL,
    created_at timestamp with time zone NOT NULL,
    CONSTRAINT approval_events_pkey PRIMARY KEY (id),
    CONSTRAINT approval_events_action_check CHECK (((action)::text = ANY ((ARRAY['CREATED'::character varying, 'SAVED'::character varying, 'SUBMITTED'::character varying, 'UNSUBMITTED'::character varying, 'REJECTED'::character varying, 'APPROVED'::character varying, 'UNAPPROVED'::character varying, 'DELETED'::character varying])::text[]))),
    CONSTRAINT approval_events_domain_check CHECK (((domain)::text ~ '^[a-z][a-z0-9-]{0,31}$'::text)),
    CONSTRAINT approval_events_entity_check CHECK (((entity)::text ~ '^[a-z][a-z0-9-]{0,63}$'::text)),
    CONSTRAINT approval_events_subject_id_check CHECK ((length(btrim((subject_id)::text)) >= 1)),
    CONSTRAINT approval_events_version_no_check CHECK (((version_no IS NULL) OR (version_no >= 1))),
    CONSTRAINT approval_events_status_check CHECK ((((from_status IS NULL) OR ((from_status)::text = ANY ((ARRAY['DRAFT'::character varying, 'PENDING'::character varying, 'APPROVED'::character varying])::text[]))) AND ((to_status IS NULL) OR ((to_status)::text = ANY ((ARRAY['DRAFT'::character varying, 'PENDING'::character varying, 'APPROVED'::character varying])::text[]))))),
    CONSTRAINT approval_events_revision_check CHECK (((from_revision IS NULL OR from_revision >= 1) AND (to_revision IS NULL OR to_revision >= 1))),
    CONSTRAINT approval_events_transition_shape_check CHECK ((((action)::text = 'CREATED'::text AND from_status IS NULL AND from_revision IS NULL AND to_status IS NOT NULL AND to_revision IS NOT NULL) OR ((action)::text = 'DELETED'::text AND from_status IS NOT NULL AND from_revision IS NOT NULL AND to_status IS NULL AND to_revision IS NULL) OR ((action)::text <> ALL ((ARRAY['CREATED'::character varying, 'DELETED'::character varying])::text[]) AND from_status IS NOT NULL AND from_revision IS NOT NULL AND to_status IS NOT NULL AND to_revision IS NOT NULL))),
    CONSTRAINT approval_events_reason_check CHECK (((((action)::text = ANY ((ARRAY['REJECTED'::character varying, 'UNAPPROVED'::character varying])::text[])) AND reason IS NOT NULL AND length(btrim(reason)) > 0) OR (((action)::text <> ALL ((ARRAY['REJECTED'::character varying, 'UNAPPROVED'::character varying])::text[])) AND reason IS NULL))),
    CONSTRAINT approval_events_request_id_check CHECK ((length(btrim((request_id)::text)) >= 1))
);

CREATE INDEX approval_events_entry_created_idx
    ON public.approval_events USING btree (entry_id, created_at, id);


-- DCL owns the independent customer relationship approval payload; its typed
-- stable relationship root is dcl_customer_relationships.
CREATE TABLE public.dcl_customer_versions (
    approval_entry_id character varying(26) NOT NULL,
    entity character varying(16) DEFAULT 'customer'::character varying NOT NULL,
    operating_entity_approval_entry_id character varying(26) NOT NULL,
    operating_entity_code character varying(16) NOT NULL,
    operating_entity_name character varying(200) NOT NULL,
    enabled boolean NOT NULL,
    CONSTRAINT dcl_customer_versions_pkey PRIMARY KEY (approval_entry_id),
    CONSTRAINT dcl_customer_versions_entity_check CHECK (((entity)::text = 'customer'::text))
);

-- DCL owns the complete customer-account approval payload. The typed stable
-- identity is dcl_customer_accounts; BOB reads the highest approved snapshot
-- directly and does not maintain a current projection.
CREATE TABLE public.dcl_customer_account_versions (
    approval_entry_id character varying(26) NOT NULL,
    entity character varying(32) DEFAULT 'customer-account'::character varying NOT NULL,
    name character varying(200) NOT NULL,
    customer_type character varying(26) DEFAULT '01JAVX00000000000000000005'::character varying NOT NULL,
    customer_type_code character varying(32) NOT NULL,
    customer_type_name character varying(200) NOT NULL,
    short_name character varying(100), tax_number character varying(50), contact_name character varying(100), contact_phone character varying(32), email character varying(254), address character varying(500), remark character varying(1000),
    settlement_method_id character varying(26), settlement_method_code character varying(32), settlement_method_name character varying(200), settlement_term_code character varying(32), settlement_rule_type character varying(32), settlement_due_days integer DEFAULT 0 NOT NULL, settlement_month_offset integer DEFAULT 0 NOT NULL, settlement_cutoff_day integer DEFAULT 0 NOT NULL, settlement_sales_surcharge_cents bigint DEFAULT 0 NOT NULL,
    payment_method_id character varying(26), payment_method_code character varying(32), payment_method_name character varying(200), payment_sales_surcharge_cents bigint DEFAULT 0 NOT NULL,
    operating_entity_id character varying(26) NOT NULL, operating_entity_approval_entry_id character varying(26) NOT NULL, operating_entity_code character varying(16) NOT NULL, operating_entity_name character varying(200) NOT NULL, operating_entity_tax_number character varying(100), operating_entity_address character varying(500), operating_entity_phone character varying(100),
    default_transport_method_code character varying(32), default_transport_method_name character varying(100), transport_surcharge_cents bigint DEFAULT 0 NOT NULL,
    pricing_policy jsonb DEFAULT '{"costItems": [], "defaultPremiumUnitPrice": "0.00", "defaultDiscountUnitPrice": "0.00", "thirdPartyIntermediaryFixedUnitCost": "0.00", "thirdPartyIntermediaryVariableUnitCost": "0.00"}'::jsonb NOT NULL,
    primary_sales_attribution_type character varying(32), primary_sales_subject_id character varying(26), primary_sales_subject_approval_entry_id character varying(26), primary_sales_subject_code character varying(32), primary_sales_subject_name character varying(200),
    internal_reminder character varying(1000), default_sales_order_remark character varying(1000), enabled boolean NOT NULL,
    CONSTRAINT dcl_customer_account_versions_pkey PRIMARY KEY (approval_entry_id),
    CONSTRAINT dcl_customer_account_versions_entity_check CHECK (((entity)::text = 'customer-account'::text)),
    CONSTRAINT dcl_customer_account_versions_name_check CHECK ((length(btrim((name)::text)) >= 1)),
    CONSTRAINT dcl_customer_account_versions_pricing_policy_ck CHECK ((jsonb_typeof(pricing_policy) = 'object'::text))
);

-- Credit limits and attachments are version-owned DCL snapshots.  The file
-- object itself remains storage infrastructure, not an approval owner.
CREATE TABLE public.dcl_customer_account_credit_limits (
    approval_entry_id character varying(26) NOT NULL,
    currency character varying(3) NOT NULL,
    amount_cents bigint NOT NULL,
    CONSTRAINT dcl_customer_account_credit_limits_pkey PRIMARY KEY (approval_entry_id, currency),
    CONSTRAINT dcl_customer_account_credit_limits_amount_cents_check CHECK ((amount_cents >= 0)),
    CONSTRAINT dcl_customer_account_credit_limits_currency_check CHECK (((currency)::text = 'CNY'::text))
);

CREATE TABLE public.dcl_customer_attachments (
    approval_entry_id character varying(26) NOT NULL,
    file_id character varying(26) NOT NULL,
    category_object_id character varying(26) NOT NULL,
    category_code character varying(16) NOT NULL,
    category_name character varying(100) NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by character varying(26) NOT NULL,
    CONSTRAINT dcl_customer_attachments_pkey PRIMARY KEY (approval_entry_id, file_id)
);

CREATE TABLE public.dcl_customer_account_attachments (
    approval_entry_id character varying(26) NOT NULL,
    file_id character varying(26) NOT NULL,
    category_object_id character varying(26) NOT NULL,
    category_code character varying(16) NOT NULL,
    category_name character varying(100) NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by character varying(26) NOT NULL,
    CONSTRAINT dcl_customer_account_attachments_pkey PRIMARY KEY (approval_entry_id, file_id)
);


--
-- Name: dcl_customer_download_tokens; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.dcl_customer_download_tokens (
    token_hash character(64) NOT NULL,
    file_id character varying(26) NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    used_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by character varying(26) NOT NULL,
    CONSTRAINT dcl_customer_download_tokens_token_hash_check CHECK ((token_hash ~ '^[0-9a-f]{64}$'::text))
);


--
-- Name: dcl_customer_files; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.dcl_customer_files (
    id character varying(26) NOT NULL,
    storage_key character varying(255) NOT NULL,
    original_name character varying(255) NOT NULL,
    content_type character varying(32) NOT NULL,
    declared_size bigint NOT NULL,
    sha256_hex character(64) NOT NULL,
    status character varying(16) DEFAULT 'PENDING'::character varying NOT NULL,
    upload_token_hash character(64) NOT NULL,
    upload_expires_at timestamp with time zone NOT NULL,
    stored_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by character varying(26) NOT NULL,
    CONSTRAINT dcl_customer_files_content_type_check CHECK (((content_type)::text = ANY ((ARRAY['application/pdf'::character varying, 'image/jpeg'::character varying, 'image/png'::character varying])::text[]))),
    CONSTRAINT dcl_customer_files_declared_size_check CHECK (((declared_size >= 1) AND (declared_size <= 10485760))),
    CONSTRAINT dcl_customer_files_sha256_hex_check CHECK ((sha256_hex ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT dcl_customer_files_status_check CHECK (((status)::text = ANY ((ARRAY['PENDING'::character varying, 'READY'::character varying])::text[]))),
    CONSTRAINT dcl_customer_files_status_ck CHECK (((((status)::text = 'PENDING'::text) AND (stored_at IS NULL)) OR (((status)::text = 'READY'::text) AND (stored_at IS NOT NULL)))),
    CONSTRAINT dcl_customer_files_upload_token_hash_check CHECK ((upload_token_hash ~ '^[0-9a-f]{64}$'::text))
);



--
-- Name: dcl_fund_account_versions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.dcl_fund_account_versions (
    approval_entry_id character varying(26) NOT NULL,
    entity character varying(16) DEFAULT 'fund-account'::character varying NOT NULL,
    name character varying(200) NOT NULL,
    currency character varying(3) NOT NULL,
    account_name character varying(200),
    bank_name character varying(200),
    bank_branch character varying(200),
    account_number character varying(64),
    remark character varying(1000),
    operating_entity_id character varying(26) NOT NULL,
	operating_entity_entity character varying(16) DEFAULT 'operating-entity'::character varying NOT NULL,
    operating_entity_approval_entry_id character varying(26) NOT NULL,
    operating_entity_code character varying(16) NOT NULL,
    operating_entity_name character varying(200) NOT NULL,
    enabled boolean NOT NULL,
    CONSTRAINT dcl_fund_account_versions_currency_check CHECK (((currency)::text ~ '^[A-Z]{3}$'::text)),
    CONSTRAINT dcl_fund_account_versions_entity_check CHECK (((entity)::text = 'fund-account'::text)),
	CONSTRAINT dcl_fund_account_versions_operating_entity_check CHECK (((operating_entity_entity)::text = 'operating-entity'::text)),
    CONSTRAINT dcl_fund_account_versions_name_check CHECK (((length(btrim((name)::text)) >= 1) AND (length(btrim((name)::text)) <= 200)))
);

CREATE TABLE public.dcl_fund_account_identifier_claims (
    normalized_account_number character varying(64) NOT NULL PRIMARY KEY,
    object_id character varying(26) NOT NULL,
	object_entity character varying(16) DEFAULT 'fund-account'::character varying NOT NULL,
    approved_entry_id character varying(26),
    open_entry_id character varying(26),
	CONSTRAINT dcl_fund_account_identifier_claims_source_ck CHECK (approved_entry_id IS NOT NULL OR open_entry_id IS NOT NULL),
	CONSTRAINT dcl_fund_account_identifier_claims_object_entity_ck CHECK ((object_entity)::text = 'fund-account'::text)
);

--
-- Name: dcl_product_formula_lines; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.dcl_product_formula_lines (
    product_approval_entry_id character varying(26) NOT NULL,
    line_no integer NOT NULL,
    material_object_id character varying(26) NOT NULL,
	material_entity character varying(16) DEFAULT 'product'::character varying NOT NULL,
    material_approval_entry_id character varying(26) NOT NULL,
    base_quantity_micros bigint CONSTRAINT dcl_product_formula_lines_quantity_micros_not_null NOT NULL,
    entered_quantity_micros bigint NOT NULL,
    entered_unit_object_id character varying(26) NOT NULL,
    entered_unit_code character varying(64) NOT NULL,
    entered_unit_name character varying(200) NOT NULL,
    entered_unit_symbol character varying(32) NOT NULL,
    entered_unit_quantity_scale integer NOT NULL,
    resolution_status character varying(16) DEFAULT 'CURRENT'::character varying NOT NULL,
    requires_confirmation boolean DEFAULT false NOT NULL,
    CONSTRAINT dcl_product_formula_lines_line_no_check CHECK ((line_no >= 1)),
    CONSTRAINT dcl_product_formula_lines_quantity_micros_check CHECK ((base_quantity_micros > 0)),
    CONSTRAINT dcl_product_formula_lines_quantity_scale_check CHECK (((entered_unit_quantity_scale >= 0) AND (entered_unit_quantity_scale <= 6))),
	CONSTRAINT dcl_product_formula_lines_resolution_status_check CHECK (((resolution_status)::text = ANY ((ARRAY['CURRENT'::character varying, 'UNRESOLVED'::character varying])::text[]))),
	CONSTRAINT dcl_product_formula_lines_material_entity_ck CHECK ((material_entity)::text = 'product'::text)
);


--
-- Name: dcl_product_formulas; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.dcl_product_formulas (
    product_approval_entry_id character varying(26) NOT NULL,
    output_base_quantity_micros bigint CONSTRAINT dcl_product_formulas_base_output_quantity_micros_not_null NOT NULL,
    output_entered_quantity_micros bigint NOT NULL,
    output_unit_object_id character varying(26) NOT NULL,
    output_unit_code character varying(64) NOT NULL,
    output_unit_name character varying(200) NOT NULL,
    output_unit_symbol character varying(32) NOT NULL,
    output_unit_quantity_scale integer NOT NULL,
    CONSTRAINT dcl_product_formulas_base_output_quantity_micros_check CHECK ((output_base_quantity_micros > 0)),
    CONSTRAINT dcl_product_formulas_quantity_scale_check CHECK (((output_unit_quantity_scale >= 0) AND (output_unit_quantity_scale <= 6)))
);


--
-- Name: dcl_product_unit_conversions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.dcl_product_unit_conversions (
    product_approval_entry_id character varying(26) NOT NULL,
    unit_object_id character varying(26) NOT NULL,
    unit_code character varying(64) NOT NULL,
    unit_name character varying(200) NOT NULL,
    unit_symbol character varying(32) NOT NULL,
    unit_quantity_scale integer NOT NULL,
    factor_micros bigint NOT NULL,
    CONSTRAINT dcl_product_unit_conversions_factor_micros_check CHECK ((factor_micros > 0)),
    CONSTRAINT dcl_product_unit_conversions_quantity_scale_check CHECK (((unit_quantity_scale >= 0) AND (unit_quantity_scale <= 6)))
);


--
-- Name: dcl_product_versions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.dcl_product_versions (
    approval_entry_id character varying(26) NOT NULL,
    entity character varying(16) DEFAULT 'product'::character varying NOT NULL,
    name character varying(200) NOT NULL,
	category_id character varying(26),
	category_code character varying(64),
	category_name character varying(200),
	category_entity character varying(16) DEFAULT 'category'::character varying NOT NULL,
    specification character varying(200),
    model character varying(200),
    barcode character varying(64),
    remark character varying(1000),
    pricing_unit_id character varying(26),
    returnable boolean DEFAULT false NOT NULL,
    default_packaging_spec_micros bigint,
    product_type_id character varying(26),
    product_type_code character varying(64),
    product_type_name character varying(200),
    behavior_profile character varying(32),
    default_input_unit_id character varying(26),
    enabled boolean DEFAULT true NOT NULL,
    CONSTRAINT dcl_product_default_packaging_spec_ck CHECK (((default_packaging_spec_micros IS NULL) OR (((behavior_profile)::text <> 'PACKAGING'::text) AND (default_packaging_spec_micros > 0)))),
    CONSTRAINT dcl_product_versions_category_entity_check CHECK (((category_entity)::text = 'category'::text)),
    CONSTRAINT dcl_product_versions_entity_check CHECK (((entity)::text = 'product'::text)),
    CONSTRAINT dcl_product_versions_name_check CHECK (((length(btrim((name)::text)) >= 1) AND (length(btrim((name)::text)) <= 200)))
);

CREATE TABLE public.dcl_product_barcode_claims (
    normalized_barcode character varying(64) NOT NULL PRIMARY KEY,
    object_id character varying(26) NOT NULL,
	object_entity character varying(16) DEFAULT 'product'::character varying NOT NULL,
    approved_entry_id character varying(26),
    open_entry_id character varying(26),
	CONSTRAINT dcl_product_barcode_claims_source_ck CHECK (approved_entry_id IS NOT NULL OR open_entry_id IS NOT NULL),
	CONSTRAINT dcl_product_barcode_claims_object_entity_ck CHECK ((object_entity)::text = 'product'::text)
);


--
-- Name: dcl_vehicle_versions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.dcl_vehicle_versions (
    approval_entry_id character varying(26) NOT NULL,
    entity character varying(16) DEFAULT 'vehicle'::character varying NOT NULL,
    name character varying(200) NOT NULL,
    plate_number character varying(32) NOT NULL,
    vehicle_type character varying(64) NOT NULL,
    vehicle_type_object_id character varying(26) NOT NULL,
    vehicle_type_name character varying(200) NOT NULL,
    vehicle_type_entity character varying(32) DEFAULT 'dictionary-item'::character varying NOT NULL,
    vin character varying(17),
    engine_number character varying(64),
    load_capacity_kg numeric(12,3),
    remark character varying(1000),
    carrier_affiliation_type character varying(16) NOT NULL,
    carrier_operating_entity_id character varying(26),
    carrier_operating_entity_approval_entry_id character varying(26),
    carrier_operating_entity character varying(16) DEFAULT 'operating-entity'::character varying NOT NULL,
    carrier_service_relationship_object_id character varying(26),
    carrier_service_relationship_approval_entry_id character varying(26),
    carrier_service_relationship_entity character varying(16) DEFAULT 'other-unit'::character varying CONSTRAINT dcl_vehicle_versions_carrier_service_relationship_enti_not_null NOT NULL,
    bulk_liquid_capable boolean DEFAULT false NOT NULL,
    enabled boolean NOT NULL,
    CONSTRAINT dcl_vehicle_versions_carrier_affiliation_shape_ck CHECK (((((carrier_affiliation_type)::text = 'INTERNAL'::text) AND (carrier_operating_entity_id IS NOT NULL) AND (carrier_service_relationship_object_id IS NULL)) OR (((carrier_affiliation_type)::text = 'EXTERNAL'::text) AND (carrier_operating_entity_id IS NULL) AND (carrier_service_relationship_object_id IS NOT NULL)))),
    CONSTRAINT dcl_vehicle_versions_carrier_affiliation_type_ck CHECK (((carrier_affiliation_type)::text = ANY ((ARRAY['INTERNAL'::character varying, 'EXTERNAL'::character varying])::text[]))),
    CONSTRAINT dcl_vehicle_versions_carrier_operating_entity_check CHECK (((carrier_operating_entity)::text = 'operating-entity'::text)),
    CONSTRAINT dcl_vehicle_versions_carrier_service_relationship_entity_check CHECK (((carrier_service_relationship_entity)::text = 'other-unit'::text)),
    CONSTRAINT dcl_vehicle_versions_vehicle_type_entity_check CHECK (((vehicle_type_entity)::text = 'dictionary-item'::text)),
    CONSTRAINT dcl_vehicle_versions_entity_check CHECK (((entity)::text = 'vehicle'::text)),
    CONSTRAINT dcl_vehicle_versions_load_capacity_kg_check CHECK (((load_capacity_kg IS NULL) OR (load_capacity_kg > (0)::numeric))),
    CONSTRAINT dcl_vehicle_versions_name_check CHECK (((length(btrim((name)::text)) >= 1) AND (length(btrim((name)::text)) <= 200))),
    CONSTRAINT dcl_vehicle_versions_plate_number_check CHECK ((((length(btrim((plate_number)::text)) >= 1) AND (length(btrim((plate_number)::text)) <= 32)) AND ((plate_number)::text = upper(btrim((plate_number)::text))))),
    CONSTRAINT dcl_vehicle_versions_vehicle_type_check CHECK (((length(btrim((vehicle_type)::text)) >= 1) AND (length(btrim((vehicle_type)::text)) <= 64))),
    CONSTRAINT dcl_vehicle_versions_vehicle_type_name_check CHECK (((length(btrim((vehicle_type_name)::text)) >= 1) AND (length(btrim((vehicle_type_name)::text)) <= 200))),
    CONSTRAINT dcl_vehicle_versions_vin_check CHECK (((vin IS NULL) OR ((vin)::text ~ '^[A-HJ-NPR-Z0-9]{17}$'::text)))
);

CREATE TABLE public.dcl_vehicle_identifier_claims (
    identifier_kind character varying(8) NOT NULL CHECK (((identifier_kind)::text = ANY ((ARRAY['PLATE'::character varying, 'VIN'::character varying])::text[]))),
    normalized_value character varying(64) NOT NULL CHECK (length(btrim(normalized_value)) > 0),
    object_id character varying(26) NOT NULL,
	object_entity character varying(16) DEFAULT 'vehicle'::character varying NOT NULL,
    approved_entry_id character varying(26),
    open_entry_id character varying(26),
    CONSTRAINT dcl_vehicle_identifier_claims_pkey PRIMARY KEY (identifier_kind, normalized_value),
	CONSTRAINT dcl_vehicle_identifier_claims_source_ck CHECK (approved_entry_id IS NOT NULL OR open_entry_id IS NOT NULL),
	CONSTRAINT dcl_vehicle_identifier_claims_object_entity_ck CHECK ((object_entity)::text = 'vehicle'::text)
);


--
-- Name: object_number_counters; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.object_number_counters (
    domain character varying(3) NOT NULL,
    entity character varying(32) NOT NULL,
    last_value integer NOT NULL,
    CONSTRAINT object_number_counters_domain_check CHECK (((domain)::text = ANY ((ARRAY['bob'::character varying, 'aux'::character varying, 'acc'::character varying, 'dcl'::character varying])::text[]))),
    CONSTRAINT object_number_counters_last_value_check CHECK (((last_value >= 1) AND (last_value <= 9999)))
);


--
-- Name: rpt_runtime_audit_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.rpt_runtime_audit_events (
    id character varying(26) NOT NULL,
    definition_id character varying(26),
    report_code character varying(64) NOT NULL,
    approval_entry_id character varying(26),
    event_type character varying(32) NOT NULL,
    actor_id character varying(26) NOT NULL,
    request_id character varying(128) NOT NULL,
    occurred_at timestamp with time zone DEFAULT now() NOT NULL,
    summary jsonb DEFAULT '{}'::jsonb NOT NULL
);



--
-- Name: dcl_rpt_definition_versions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.dcl_rpt_definition_versions (
    approval_entry_id character varying(26) NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    name character varying(200) NOT NULL,
    description character varying(1000) DEFAULT ''::character varying NOT NULL,
    sql_text text NOT NULL,
    parameters jsonb NOT NULL,
    columns jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by character varying(26) NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by character varying(26) NOT NULL,
    CONSTRAINT dcl_rpt_definition_versions_columns_check CHECK ((jsonb_typeof(columns) = 'array'::text)),
    CONSTRAINT dcl_rpt_definition_versions_name_check CHECK ((btrim((name)::text) <> ''::text)),
    CONSTRAINT dcl_rpt_definition_versions_parameters_check CHECK ((jsonb_typeof(parameters) = 'array'::text)),
    CONSTRAINT dcl_rpt_definition_versions_sql_text_check CHECK ((btrim(sql_text) <> ''::text))
);


--
-- Name: rpt_definition_validities; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.rpt_definition_validities (
    approval_entry_id character varying(26) NOT NULL,
    validity character varying(16) DEFAULT 'VALID'::character varying NOT NULL,
    invalidated_at timestamp with time zone,
    invalid_reason character varying(200),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by character varying(26) NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by character varying(26) NOT NULL,
    CONSTRAINT rpt_definition_validities_pkey PRIMARY KEY (approval_entry_id),
    CONSTRAINT rpt_definition_validities_validity_check CHECK (((validity)::text = ANY ((ARRAY['VALID'::character varying, 'INVALID'::character varying])::text[])))
);


--
-- Name: vou_asset_acquisition_details; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.vou_asset_acquisition_details (
    document_id character varying(26) NOT NULL,
    entity character varying(32) DEFAULT 'asset-acquisition'::character varying NOT NULL,
    supplier_object_id character varying(26) NOT NULL,
    supplier_approval_entry_id character varying(26) NOT NULL,
    supplier_code character varying(64) NOT NULL,
    supplier_name character varying(200) NOT NULL,
    party_account_type character varying(16) DEFAULT 'OTHER'::character varying NOT NULL,
    CONSTRAINT vou_asset_acquisition_details_entity_check CHECK (((entity)::text = 'asset-acquisition'::text)),
    CONSTRAINT vou_asset_acquisition_details_party_account_type_check CHECK (((party_account_type)::text = ANY ((ARRAY['TRADE'::character varying, 'OTHER'::character varying])::text[])))
);


--
-- Name: vou_asset_acquisition_lines; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.vou_asset_acquisition_lines (
    id character varying(26) NOT NULL,
    document_id character varying(26) NOT NULL,
    line_no integer NOT NULL,
    asset_name character varying(200) NOT NULL,
    specification character varying(200) DEFAULT ''::character varying NOT NULL,
    category_object_id character varying(26) NOT NULL,
    category_code character varying(64) NOT NULL,
    category_name character varying(200) NOT NULL,
    category_default_useful_life_months integer NOT NULL,
    category_default_residual_rate_bps integer NOT NULL,
    original_value_cents bigint NOT NULL,
    useful_life_months integer NOT NULL,
    residual_rate_bps integer NOT NULL,
    department_object_id character varying(26) NOT NULL,
    department_code character varying(64) NOT NULL,
    department_name character varying(200) NOT NULL,
    custodian_object_id character varying(26),
    custodian_approval_entry_id character varying(26),
    custodian_code character varying(64),
    custodian_name character varying(200),
    location character varying(200) DEFAULT ''::character varying NOT NULL,
    remark character varying(1000),
    CONSTRAINT vou_asset_acquisition_lines_line_no_check CHECK ((line_no > 0)),
    CONSTRAINT vou_asset_acquisition_lines_original_value_cents_check CHECK ((original_value_cents > 0)),
    CONSTRAINT vou_asset_acquisition_lines_category_default_residual_rate_bps_check CHECK (((category_default_residual_rate_bps >= 0) AND (category_default_residual_rate_bps <= 9999))),
    CONSTRAINT vou_asset_acquisition_lines_category_default_useful_life_months_check CHECK (((category_default_useful_life_months >= 1) AND (category_default_useful_life_months <= 1200))),
    CONSTRAINT vou_asset_acquisition_lines_residual_rate_bps_check CHECK (((residual_rate_bps >= 0) AND (residual_rate_bps <= 9999))),
    CONSTRAINT vou_asset_acquisition_lines_useful_life_months_check CHECK (((useful_life_months >= 1) AND (useful_life_months <= 1200)))
);


--
-- Name: vou_asset_liquidation_details; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.vou_asset_liquidation_details (
    document_id character varying(26) NOT NULL,
    entity character varying(32) DEFAULT 'asset-liquidation'::character varying NOT NULL,
    CONSTRAINT vou_asset_liquidation_details_entity_check CHECK (((entity)::text = 'asset-liquidation'::text))
);


--
-- Name: vou_asset_liquidation_lines; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.vou_asset_liquidation_lines (
    id character varying(26) NOT NULL,
    document_id character varying(26) NOT NULL,
    line_no integer NOT NULL,
    asset_id character varying(26) NOT NULL,
    asset_no character varying(32) NOT NULL,
    asset_name character varying(200) NOT NULL,
    reason character varying(1000) NOT NULL,
    salvage_income_cents bigint DEFAULT 0 NOT NULL,
    disposal_expense_cents bigint DEFAULT 0 NOT NULL,
    remark character varying(1000),
    CONSTRAINT vou_asset_liquidation_lines_disposal_expense_cents_check CHECK ((disposal_expense_cents >= 0)),
    CONSTRAINT vou_asset_liquidation_lines_line_no_check CHECK ((line_no > 0)),
    CONSTRAINT vou_asset_liquidation_lines_reason_check CHECK (((length(btrim((reason)::text)) >= 1) AND (length(btrim((reason)::text)) <= 1000))),
    CONSTRAINT vou_asset_liquidation_lines_salvage_income_cents_check CHECK ((salvage_income_cents >= 0))
);


--
-- Name: vou_asset_sale_details; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.vou_asset_sale_details (
    document_id character varying(26) NOT NULL,
    entity character varying(32) DEFAULT 'asset-sale'::character varying NOT NULL,
    counterparty_entity character varying(16) NOT NULL,
    counterparty_object_id character varying(26) NOT NULL,
    counterparty_approval_entry_id character varying(26) NOT NULL,
    counterparty_code character varying(64) NOT NULL,
    counterparty_name character varying(200) NOT NULL,
    party_account_type character varying(16) DEFAULT 'OTHER'::character varying NOT NULL,
    CONSTRAINT vou_asset_sale_details_counterparty_entity_check CHECK (((counterparty_entity)::text = ANY ((ARRAY['customer-account'::character varying, 'other-unit'::character varying])::text[]))),
    CONSTRAINT vou_asset_sale_details_entity_check CHECK (((entity)::text = 'asset-sale'::text)),
    CONSTRAINT vou_asset_sale_details_party_account_type_check CHECK (((party_account_type)::text = ANY ((ARRAY['TRADE'::character varying, 'OTHER'::character varying])::text[])))
);


--
-- Name: vou_asset_sale_lines; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.vou_asset_sale_lines (
    id character varying(26) NOT NULL,
    document_id character varying(26) NOT NULL,
    line_no integer NOT NULL,
    asset_id character varying(26) NOT NULL,
    asset_no character varying(32) NOT NULL,
    asset_name character varying(200) NOT NULL,
    sale_amount_cents bigint NOT NULL,
    remark character varying(1000),
    CONSTRAINT vou_asset_sale_lines_line_no_check CHECK ((line_no > 0)),
    CONSTRAINT vou_asset_sale_lines_sale_amount_cents_check CHECK ((sale_amount_cents > 0))
);


--
-- Name: vou_bill_cash_lines; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.vou_bill_cash_lines (
    id character varying(26) NOT NULL,
    document_id character varying(26) NOT NULL,
    line_no integer NOT NULL,
    bill_line_id character varying(26),
    fund_account_object_id character varying(26) NOT NULL,
    fund_account_approval_entry_id character varying(26) NOT NULL,
    fund_account_code character varying(64) NOT NULL,
    fund_account_name character varying(200) NOT NULL,
    direction character varying(3) NOT NULL,
    amount_type character varying(16) NOT NULL,
    amount_cents bigint NOT NULL,
    remark character varying(1000),
    CONSTRAINT vou_bill_cash_lines_amount_cents_check CHECK ((amount_cents > 0)),
    CONSTRAINT vou_bill_cash_lines_amount_type_check CHECK (((amount_type)::text = ANY ((ARRAY['PRINCIPAL'::character varying, 'INTEREST'::character varying, 'FEE'::character varying, 'MARGIN'::character varying, 'OTHER'::character varying])::text[]))),
    CONSTRAINT vou_bill_cash_lines_direction_check CHECK (((direction)::text = ANY ((ARRAY['IN'::character varying, 'OUT'::character varying])::text[]))),
    CONSTRAINT vou_bill_cash_lines_line_no_check CHECK (((line_no >= 1) AND (line_no <= 20)))
);


--
-- Name: vou_bill_details; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.vou_bill_details (
    document_id character varying(26) NOT NULL,
    entity character varying(32) NOT NULL,
    counterparty_entity character varying(16),
    counterparty_object_id character varying(26),
    counterparty_approval_entry_id character varying(26),
    counterparty_code character varying(64),
    counterparty_name character varying(200),
    handler_object_id character varying(26),
    handler_approval_entry_id character varying(26),
    handler_code character varying(64),
    handler_name character varying(200),
    internal_cost_rate_bps integer NOT NULL,
    maturity_type character varying(32) DEFAULT 'NONE'::character varying NOT NULL,
    interest_mode character varying(32) DEFAULT 'NONE'::character varying NOT NULL,
    interest_party_entity character varying(16),
    interest_party_object_id character varying(26),
    interest_party_approval_entry_id character varying(26),
    interest_party_code character varying(64),
    interest_party_name character varying(200),
    with_recourse boolean DEFAULT false NOT NULL,
    CONSTRAINT vou_bill_details_check CHECK ((((counterparty_entity IS NULL) AND (counterparty_object_id IS NULL) AND (counterparty_approval_entry_id IS NULL) AND (counterparty_code IS NULL) AND (counterparty_name IS NULL)) OR ((counterparty_entity IS NOT NULL) AND (counterparty_object_id IS NOT NULL) AND (counterparty_approval_entry_id IS NOT NULL) AND (counterparty_code IS NOT NULL) AND (counterparty_name IS NOT NULL)))),
    CONSTRAINT vou_bill_details_check1 CHECK ((((handler_object_id IS NULL) AND (handler_approval_entry_id IS NULL) AND (handler_code IS NULL) AND (handler_name IS NULL)) OR ((handler_object_id IS NOT NULL) AND (handler_approval_entry_id IS NOT NULL) AND (handler_code IS NOT NULL) AND (handler_name IS NOT NULL)))),
    CONSTRAINT vou_bill_details_counterparty_entity_check CHECK (((counterparty_entity)::text = ANY ((ARRAY['customer-account'::character varying, 'supplier'::character varying, 'other-unit'::character varying])::text[]))),
    CONSTRAINT vou_bill_details_customer_receipt_ck CHECK ((((entity)::text <> 'bill-receipt'::text) OR (((counterparty_entity)::text = 'customer-account'::text) AND (handler_object_id IS NOT NULL) AND ((maturity_type)::text = 'NONE'::text) AND ((interest_mode)::text = 'NONE'::text) AND (interest_party_entity IS NULL) AND (with_recourse = false)))),
    CONSTRAINT vou_bill_details_entity_check CHECK (((entity)::text = ANY ((ARRAY['bill-receipt'::character varying, 'bill-payment'::character varying, 'bill-issue'::character varying, 'bill-discount'::character varying, 'bill-maturity'::character varying])::text[]))),
    CONSTRAINT vou_bill_details_interest_mode_check CHECK (((interest_mode)::text = ANY ((ARRAY['NONE'::character varying, 'BANK_DEDUCTED'::character varying, 'THIRD_PARTY_PAYABLE'::character varying])::text[]))),
    CONSTRAINT vou_bill_details_interest_mode_party_ck CHECK (((((interest_mode)::text = 'THIRD_PARTY_PAYABLE'::text) AND ((interest_party_entity)::text = 'other-unit'::text)) OR (((interest_mode)::text <> 'THIRD_PARTY_PAYABLE'::text) AND (interest_party_entity IS NULL)))),
    CONSTRAINT vou_bill_details_interest_party_entity_check CHECK (((interest_party_entity)::text = 'other-unit'::text)),
    CONSTRAINT vou_bill_details_interest_party_reference_ck CHECK ((((interest_party_entity IS NULL) AND (interest_party_object_id IS NULL) AND (interest_party_approval_entry_id IS NULL) AND (interest_party_code IS NULL) AND (interest_party_name IS NULL)) OR (((interest_party_entity)::text = 'other-unit'::text) AND (interest_party_object_id IS NOT NULL) AND (interest_party_approval_entry_id IS NOT NULL) AND (interest_party_code IS NOT NULL) AND (interest_party_name IS NOT NULL)))),
    CONSTRAINT vou_bill_details_internal_cost_rate_bps_check CHECK (((internal_cost_rate_bps >= 0) AND (internal_cost_rate_bps <= 100000))),
    CONSTRAINT vou_bill_details_maturity_type_check CHECK (((maturity_type)::text = ANY ((ARRAY['NONE'::character varying, 'RECEIPT'::character varying, 'PAYMENT'::character varying])::text[])))
);


--
-- Name: vou_bill_lines; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.vou_bill_lines (
    id character varying(26) NOT NULL,
    document_id character varying(26) NOT NULL,
    line_no integer NOT NULL,
    bill_id character varying(26) NOT NULL,
    position_type character varying(16) NOT NULL,
    direction character varying(16) NOT NULL,
    purpose character varying(16) NOT NULL,
    bill_type character varying(32) NOT NULL,
    bill_no character varying(200) NOT NULL,
    medium character varying(16) NOT NULL,
    currency character varying(3) NOT NULL,
    face_amount_cents bigint NOT NULL,
    issue_date date NOT NULL,
    maturity_date date NOT NULL,
    drawer character varying(200) NOT NULL,
    acceptor character varying(200) NOT NULL,
    payee character varying(200) NOT NULL,
    annual_rate_bps integer NOT NULL,
    interest_days integer NOT NULL,
    interest_amount_cents bigint NOT NULL,
    customer_cost_amount_cents bigint NOT NULL,
    remark character varying(1000),
    CONSTRAINT vou_bill_lines_acceptor_check CHECK (((acceptor)::text <> ''::text)),
    CONSTRAINT vou_bill_lines_annual_rate_bps_check CHECK (((annual_rate_bps >= 0) AND (annual_rate_bps <= 100000))),
    CONSTRAINT vou_bill_lines_bill_no_check CHECK (((bill_no)::text <> ''::text)),
    CONSTRAINT vou_bill_lines_bill_type_check CHECK (((bill_type)::text = ANY ((ARRAY['BANK_ACCEPTANCE'::character varying, 'COMMERCIAL_ACCEPTANCE'::character varying, 'CHECK'::character varying, 'OTHER'::character varying])::text[]))),
    CONSTRAINT vou_bill_lines_check CHECK ((issue_date <= maturity_date)),
    CONSTRAINT vou_bill_lines_currency_check CHECK (((currency)::text ~ '^[A-Z]{3}$'::text)),
    CONSTRAINT vou_bill_lines_customer_cost_amount_cents_check CHECK ((customer_cost_amount_cents >= 0)),
    CONSTRAINT vou_bill_lines_direction_check CHECK (((direction)::text = ANY ((ARRAY['IN'::character varying, 'OUT'::character varying])::text[]))),
    CONSTRAINT vou_bill_lines_drawer_check CHECK (((drawer)::text <> ''::text)),
    CONSTRAINT vou_bill_lines_face_amount_cents_check CHECK ((face_amount_cents > 0)),
    CONSTRAINT vou_bill_lines_interest_amount_cents_check CHECK ((interest_amount_cents >= 0)),
    CONSTRAINT vou_bill_lines_interest_days_check CHECK ((interest_days >= 0)),
    CONSTRAINT vou_bill_lines_line_no_check CHECK (((line_no >= 1) AND (line_no <= 20))),
    CONSTRAINT vou_bill_lines_medium_check CHECK (((medium)::text = ANY ((ARRAY['PAPER'::character varying, 'ELECTRONIC'::character varying])::text[]))),
    CONSTRAINT vou_bill_lines_payee_check CHECK (((payee)::text <> ''::text)),
    CONSTRAINT vou_bill_lines_position_type_check CHECK (((position_type)::text = ANY ((ARRAY['ASSET'::character varying, 'LIABILITY'::character varying])::text[]))),
    CONSTRAINT vou_bill_lines_purpose_check CHECK (((purpose)::text = ANY ((ARRAY['PRIMARY'::character varying, 'CHANGE'::character varying])::text[])))
);


--
-- Name: vou_document_attachments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.vou_document_attachments (
    document_id character varying(26) NOT NULL,
    file_id character varying(26) NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by character varying(26) NOT NULL
);


--
-- Name: vou_documents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.vou_documents (
    id character varying(26) NOT NULL,
    entity character varying(32) NOT NULL,
    document_no character varying(32) NOT NULL,
    approval_entry_id character varying(26) NOT NULL,
    business_date date NOT NULL,
    currency character varying(3),
    total_amount_cents bigint NOT NULL,
    remark character varying(1000),
    parent_document_id character varying(26),
    parent_entity character varying(32),
    due_date date,
    CONSTRAINT vou_documents_currency_check CHECK (((currency)::text ~ '^[A-Z]{3}$'::text)),
    CONSTRAINT vou_documents_entity_check CHECK (((entity)::text = ANY ((ARRAY['sale-pricing'::character varying, 'sale-order'::character varying, 'sale-outbound'::character varying, 'sale-delivery'::character varying, 'sale-signoff'::character varying, 'sale-return'::character varying, 'purchase-inquiry'::character varying, 'purchase-order'::character varying, 'purchase-inbound'::character varying, 'purchase-return'::character varying, 'order-production'::character varying, 'self-production'::character varying, 'inventory-count'::character varying, 'sales-receipt'::character varying, 'sales-refund'::character varying, 'purchase-payment'::character varying, 'purchase-refund'::character varying, 'other-receipt'::character varying, 'other-payment'::character varying, 'employee-loan'::character varying, 'employee-repayment'::character varying, 'employee-loan-writeoff'::character varying, 'expense-reimbursement'::character varying, 'expense-payment'::character varying, 'other-income'::character varying, 'asset-acquisition'::character varying, 'asset-sale'::character varying, 'asset-liquidation'::character varying, 'bill-receipt'::character varying, 'bill-payment'::character varying, 'bill-issue'::character varying, 'bill-discount'::character varying, 'bill-maturity'::character varying, 'intermediary-calculation'::character varying, 'service-contract'::character varying, 'service-acceptance'::character varying, 'customer-order'::character varying, 'procurement-order'::character varying, 'goods-receipt'::character varying, 'delivery-note'::character varying, 'signoff-note'::character varying])::text[]))),
    CONSTRAINT vou_documents_not_self_parent_ck CHECK (((parent_document_id IS NULL) OR ((parent_document_id)::text <> (id)::text))),
    CONSTRAINT vou_documents_number_format_check CHECK (((document_no)::text ~ '^[A-Z]{3}-[0-9]{8}-[0-9]{4}$'::text)),
    CONSTRAINT vou_documents_parent_pair_ck CHECK (((parent_entity IS NULL) = (parent_document_id IS NULL))),
    CONSTRAINT vou_documents_production_money_ck CHECK (((((entity)::text = ANY ((ARRAY['order-production'::character varying, 'self-production'::character varying])::text[])) AND (currency IS NULL) AND (total_amount_cents = 0)) OR (((entity)::text <> ALL ((ARRAY['order-production'::character varying, 'self-production'::character varying])::text[])) AND (currency IS NOT NULL)))),
    CONSTRAINT vou_documents_total_amount_ck CHECK ((((entity)::text = ANY ((ARRAY['intermediary-calculation'::character varying, 'service-contract'::character varying])::text[])) OR (((entity)::text = ANY ((ARRAY['sale-pricing'::character varying, 'purchase-inquiry'::character varying, 'sale-order'::character varying, 'sale-outbound'::character varying, 'sale-delivery'::character varying, 'sale-signoff'::character varying, 'sale-return'::character varying, 'purchase-order'::character varying, 'purchase-inbound'::character varying, 'purchase-return'::character varying, 'order-production'::character varying, 'self-production'::character varying, 'inventory-count'::character varying, 'asset-liquidation'::character varying])::text[])) AND (total_amount_cents >= 0)) OR (((entity)::text <> ALL ((ARRAY['intermediary-calculation'::character varying, 'service-contract'::character varying, 'sale-pricing'::character varying, 'purchase-inquiry'::character varying, 'sale-order'::character varying, 'sale-outbound'::character varying, 'sale-delivery'::character varying, 'sale-signoff'::character varying, 'sale-return'::character varying, 'purchase-order'::character varying, 'purchase-inbound'::character varying, 'purchase-return'::character varying, 'order-production'::character varying, 'self-production'::character varying, 'inventory-count'::character varying, 'asset-liquidation'::character varying])::text[])) AND (total_amount_cents > 0))))
);


--
-- Name: vou_download_tokens; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.vou_download_tokens (
    token_hash character(64) NOT NULL,
    file_id character varying(26) NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    used_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by character varying(26) NOT NULL,
    CONSTRAINT vou_download_tokens_token_hash_check CHECK ((token_hash ~ '^[0-9a-f]{64}$'::text))
);


--
-- Name: vou_employee_loan_writeoff_details; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.vou_employee_loan_writeoff_details (
    document_id character varying(26) NOT NULL,
    entity character varying(32) DEFAULT 'employee-loan-writeoff'::character varying NOT NULL,
    employee_object_id character varying(26) NOT NULL,
    employee_approval_entry_id character varying(26) NOT NULL,
    employee_code character varying(64) NOT NULL,
    employee_name character varying(200) NOT NULL,
    CONSTRAINT vou_employee_loan_writeoff_details_entity_check CHECK (((entity)::text = 'employee-loan-writeoff'::text))
);


--
-- Name: vou_expense_lines; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.vou_expense_lines (
    id character varying(26) NOT NULL,
    document_id character varying(26) NOT NULL,
    document_entity character varying(32) DEFAULT 'expense-reimbursement'::character varying NOT NULL,
    line_no integer NOT NULL,
    category character varying(100) NOT NULL,
    description character varying(500) NOT NULL,
    amount_cents bigint NOT NULL,
    remark character varying(1000),
    CONSTRAINT vou_expense_lines_amount_cents_check CHECK ((amount_cents > 0)),
    CONSTRAINT vou_expense_lines_category_check CHECK (((length(btrim((category)::text)) >= 1) AND (length(btrim((category)::text)) <= 100))),
    CONSTRAINT vou_expense_lines_description_check CHECK (((length(btrim((description)::text)) >= 1) AND (length(btrim((description)::text)) <= 500))),
    CONSTRAINT vou_expense_lines_document_entity_check CHECK (((document_entity)::text = ANY ((ARRAY['expense-reimbursement'::character varying, 'employee-loan-writeoff'::character varying])::text[]))),
    CONSTRAINT vou_expense_lines_line_no_check CHECK ((line_no >= 1)),
    CONSTRAINT vou_expense_lines_remark_ck CHECK (((remark IS NULL) OR ((length(btrim((remark)::text)) >= 1) AND (length(btrim((remark)::text)) <= 1000))))
);


--
-- Name: vou_expense_payment_details; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.vou_expense_payment_details (
    document_id character varying(26) NOT NULL,
    entity character varying(32) DEFAULT 'expense-payment'::character varying NOT NULL,
    source_reimbursement_id character varying(26) NOT NULL,
    employee_object_id character varying(26) NOT NULL,
    employee_approval_entry_id character varying(26) NOT NULL,
    employee_code character varying(64) NOT NULL,
    employee_name character varying(200) NOT NULL,
    fund_account_object_id character varying(26) NOT NULL,
    fund_account_approval_entry_id character varying(26) NOT NULL,
    fund_account_code character varying(64) NOT NULL,
    fund_account_name character varying(200) NOT NULL,
    CONSTRAINT vou_expense_payment_details_entity_check CHECK (((entity)::text = 'expense-payment'::text))
);


--
-- Name: vou_expense_reimbursement_details; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.vou_expense_reimbursement_details (
    document_id character varying(26) NOT NULL,
    entity character varying(32) DEFAULT 'expense-reimbursement'::character varying NOT NULL,
    employee_object_id character varying(26) NOT NULL,
    employee_approval_entry_id character varying(26) NOT NULL,
    employee_code character varying(64) NOT NULL,
    employee_name character varying(200) NOT NULL,
    CONSTRAINT vou_expense_reimbursement_details_entity_check CHECK (((entity)::text = 'expense-reimbursement'::text))
);


--
-- Name: vou_files; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.vou_files (
    id character varying(26) NOT NULL,
    storage_key character varying(255) NOT NULL,
    original_name character varying(255) NOT NULL,
    content_type character varying(32) NOT NULL,
    declared_size bigint NOT NULL,
    sha256_hex character(64) NOT NULL,
    status character varying(16) DEFAULT 'PENDING'::character varying NOT NULL,
    upload_token_hash character(64) NOT NULL,
    upload_expires_at timestamp with time zone NOT NULL,
    stored_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by character varying(26) NOT NULL,
    CONSTRAINT vou_files_content_type_check CHECK (((content_type)::text = ANY ((ARRAY['application/pdf'::character varying, 'image/jpeg'::character varying, 'image/png'::character varying])::text[]))),
    CONSTRAINT vou_files_declared_size_check CHECK (((declared_size >= 1) AND (declared_size <= 10485760))),
    CONSTRAINT vou_files_sha256_hex_check CHECK ((sha256_hex ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT vou_files_status_check CHECK (((status)::text = ANY ((ARRAY['PENDING'::character varying, 'READY'::character varying])::text[]))),
    CONSTRAINT vou_files_status_ck CHECK (((((status)::text = 'PENDING'::text) AND (stored_at IS NULL)) OR (((status)::text = 'READY'::text) AND (stored_at IS NOT NULL)))),
    CONSTRAINT vou_files_upload_token_hash_check CHECK ((upload_token_hash ~ '^[0-9a-f]{64}$'::text))
);


--
-- Name: vou_intermediary_calculation_bill_allocations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.vou_intermediary_calculation_bill_allocations (
    document_id character varying(26) CONSTRAINT vou_intermediary_calculation_bill_allocati_document_id_not_null NOT NULL,
    bill_line_id character varying(26) CONSTRAINT vou_intermediary_calculation_bill_allocat_bill_line_id_not_null NOT NULL,
    source_signoff_line_id character varying(26) CONSTRAINT vou_intermediary_calculation_bi_source_signoff_line_id_not_null NOT NULL
);


--
-- Name: vou_intermediary_calculation_details; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.vou_intermediary_calculation_details (
    document_id character varying(26) NOT NULL,
    entity character varying(32) DEFAULT 'intermediary-calculation'::character varying NOT NULL,
    period_start date NOT NULL,
    period_end date NOT NULL,
    source_hash character(64) NOT NULL,
    source_snapshot jsonb NOT NULL,
    script_id character varying(26) NOT NULL,
    script_revision bigint NOT NULL,
    script_name character varying(200) NOT NULL,
    script_source text NOT NULL,
    script_hash character(64) NOT NULL,
    result_snapshot jsonb NOT NULL,
    CONSTRAINT vou_intermediary_calculation_details_check CHECK ((period_start = (date_trunc('month'::text, (period_end)::timestamp with time zone))::date)),
    CONSTRAINT vou_intermediary_calculation_details_entity_check CHECK (((entity)::text = 'intermediary-calculation'::text)),
    CONSTRAINT vou_intermediary_calculation_details_period_end_check CHECK ((period_end = ((date_trunc('month'::text, (period_end)::timestamp with time zone) + '1 mon -1 days'::interval))::date)),
    CONSTRAINT vou_intermediary_calculation_details_result_snapshot_check CHECK ((jsonb_typeof(result_snapshot) = 'object'::text)),
    CONSTRAINT vou_intermediary_calculation_details_script_hash_check CHECK ((script_hash ~ '^[a-f0-9]{64}$'::text)),
    CONSTRAINT vou_intermediary_calculation_details_script_name_check CHECK (((length(btrim((script_name)::text)) >= 1) AND (length(btrim((script_name)::text)) <= 200))),
    CONSTRAINT vou_intermediary_calculation_details_script_revision_check CHECK ((script_revision > 0)),
    CONSTRAINT vou_intermediary_calculation_details_script_source_check CHECK (((length(script_source) >= 1) AND (length(script_source) <= 100000))),
    CONSTRAINT vou_intermediary_calculation_details_source_hash_check CHECK ((source_hash ~ '^[a-f0-9]{64}$'::text)),
    CONSTRAINT vou_intermediary_calculation_details_source_snapshot_check CHECK ((jsonb_typeof(source_snapshot) = 'object'::text))
);


--
-- Name: vou_intermediary_calculation_lines; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.vou_intermediary_calculation_lines (
    id character varying(26) NOT NULL,
    document_id character varying(26) NOT NULL,
    line_no integer NOT NULL,
    source_signoff_line_id character varying(26) CONSTRAINT vou_intermediary_calculation_li_source_signoff_line_id_not_null NOT NULL,
    source_calculation_document_id character varying(26),
    result jsonb NOT NULL,
    employee_amount_cents bigint CONSTRAINT vou_intermediary_calculation_lin_employee_amount_cents_not_null NOT NULL,
    intermediary_amount_cents bigint CONSTRAINT vou_intermediary_calculation_intermediary_amount_cents_not_null NOT NULL,
    CONSTRAINT vou_intermediary_calculation_lines_check CHECK (((source_calculation_document_id IS NULL) OR ((source_calculation_document_id)::text <> (document_id)::text))),
    CONSTRAINT vou_intermediary_calculation_lines_line_no_check CHECK ((line_no > 0)),
    CONSTRAINT vou_intermediary_calculation_lines_result_check CHECK ((jsonb_typeof(result) = 'object'::text))
);


--
-- Name: vou_intermediary_calculation_summaries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.vou_intermediary_calculation_summaries (
    id character varying(26) NOT NULL,
    document_id character varying(26) NOT NULL,
    line_no integer NOT NULL,
    category character varying(32) NOT NULL,
    payee_entity character varying(16) NOT NULL,
    payee_object_id character varying(26) NOT NULL,
    payee_approval_entry_id character varying(26) CONSTRAINT vou_intermediary_calc_payee_entry_nn NOT NULL,
    payee_code character varying(64) NOT NULL,
    payee_name character varying(200) NOT NULL,
    amount_cents bigint NOT NULL,
    CONSTRAINT vou_intermediary_calculation_summaries_amount_cents_check CHECK ((amount_cents <> 0)),
    CONSTRAINT vou_intermediary_calculation_summaries_category_check CHECK (((category)::text = ANY ((ARRAY['COMMISSION'::character varying, 'EXTERNAL_PART_TIME'::character varying, 'CHANNEL_PARTNER'::character varying, 'INTERMEDIARY'::character varying])::text[]))),
    CONSTRAINT vou_intermediary_calculation_summaries_line_no_check CHECK ((line_no > 0)),
    CONSTRAINT vou_intermediary_calculation_summaries_payee_entity_check CHECK (((payee_entity)::text = ANY ((ARRAY['customer-account'::character varying, 'employee'::character varying, 'sales-partner'::character varying, 'other-unit'::character varying])::text[])))
);


--
-- Name: vou_intermediary_scripts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.vou_intermediary_scripts (
    id character varying(26) NOT NULL,
    singleton boolean DEFAULT true NOT NULL,
    revision bigint DEFAULT 1 NOT NULL,
    name character varying(200) NOT NULL,
    source text NOT NULL,
    source_hash character(64) NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by character varying(26) NOT NULL,
    CONSTRAINT vou_intermediary_scripts_name_check CHECK (((length(btrim((name)::text)) >= 1) AND (length(btrim((name)::text)) <= 200))),
    CONSTRAINT vou_intermediary_scripts_revision_check CHECK ((revision > 0)),
    CONSTRAINT vou_intermediary_scripts_singleton_check CHECK (singleton),
    CONSTRAINT vou_intermediary_scripts_source_check CHECK (((length(source) >= 1) AND (length(source) <= 100000))),
    CONSTRAINT vou_intermediary_scripts_source_hash_check CHECK ((source_hash ~ '^[a-f0-9]{64}$'::text))
);


--
-- Name: vou_inventory_count_details; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.vou_inventory_count_details (
    document_id character varying(26) NOT NULL,
    entity character varying(32) DEFAULT 'inventory-count'::character varying NOT NULL,
    warehouse_object_id character varying(26) NOT NULL,
    warehouse_approval_entry_id character varying(26) NOT NULL,
    warehouse_code character varying(64) NOT NULL,
    warehouse_name character varying(200) NOT NULL,
    CONSTRAINT vou_inventory_count_details_entity_check CHECK (((entity)::text = 'inventory-count'::text))
);


--
-- Name: vou_inventory_count_lines; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.vou_inventory_count_lines (
    id character varying(26) NOT NULL,
    document_id character varying(26) NOT NULL,
    line_no integer NOT NULL,
    product_object_id character varying(26) NOT NULL,
    product_approval_entry_id character varying(26) NOT NULL,
    product_code character varying(64) NOT NULL,
    product_name character varying(200) NOT NULL,
    entered_unit_symbol character varying(32) CONSTRAINT vou_inventory_count_lines_product_unit_not_null NOT NULL,
    actual_base_quantity_micros bigint CONSTRAINT vou_inventory_count_lines_actual_quantity_micros_not_null NOT NULL,
    book_base_quantity_micros bigint,
    difference_base_quantity_micros bigint,
    remark character varying(1000),
    entered_quantity_micros bigint NOT NULL,
    entered_unit_object_id character varying(26) NOT NULL,
    entered_unit_code character varying(64) NOT NULL,
    entered_unit_name character varying(200) NOT NULL,
    CONSTRAINT vou_inventory_count_lines_actual_quantity_micros_check CHECK ((actual_base_quantity_micros >= 0)),
    CONSTRAINT vou_inventory_count_lines_check CHECK ((((book_base_quantity_micros IS NULL) AND (difference_base_quantity_micros IS NULL)) OR ((book_base_quantity_micros IS NOT NULL) AND (book_base_quantity_micros >= 0) AND (difference_base_quantity_micros = (actual_base_quantity_micros - book_base_quantity_micros))))),
    CONSTRAINT vou_inventory_count_lines_line_no_check CHECK (((line_no >= 1) AND (line_no <= 200)))
);


--
-- Name: vou_number_counters; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.vou_number_counters (
    entity character varying(32) NOT NULL,
    business_date date NOT NULL,
    last_value integer NOT NULL,
    CONSTRAINT vou_number_counters_last_value_check CHECK (((last_value >= 1) AND (last_value <= 9999)))
);


--
-- Name: vou_other_income_details; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.vou_other_income_details (
    document_id character varying(26) NOT NULL,
    entity character varying(32) DEFAULT 'other-income'::character varying NOT NULL,
    source_name character varying(200) NOT NULL,
    counterparty_entity character varying(16),
    counterparty_object_id character varying(26),
    counterparty_approval_entry_id character varying(26),
    counterparty_code character varying(64),
    counterparty_name character varying(200),
    fund_account_object_id character varying(26) NOT NULL,
    fund_account_approval_entry_id character varying(26) NOT NULL,
    fund_account_code character varying(64) NOT NULL,
    fund_account_name character varying(200) NOT NULL,
    handler_object_id character varying(26),
    handler_approval_entry_id character varying(26),
    handler_code character varying(64),
    handler_name character varying(200),
    CONSTRAINT vou_other_income_counterparty_ck CHECK ((((counterparty_entity IS NULL) AND (counterparty_object_id IS NULL) AND (counterparty_approval_entry_id IS NULL) AND (counterparty_code IS NULL) AND (counterparty_name IS NULL)) OR ((counterparty_entity IS NOT NULL) AND (counterparty_object_id IS NOT NULL) AND (counterparty_approval_entry_id IS NOT NULL) AND (counterparty_code IS NOT NULL) AND (counterparty_name IS NOT NULL)))),
    CONSTRAINT vou_other_income_details_counterparty_entity_check CHECK (((counterparty_entity)::text = ANY ((ARRAY['customer-account'::character varying, 'supplier'::character varying])::text[]))),
    CONSTRAINT vou_other_income_details_entity_check CHECK (((entity)::text = 'other-income'::text)),
    CONSTRAINT vou_other_income_details_source_name_check CHECK (((length(btrim((source_name)::text)) >= 1) AND (length(btrim((source_name)::text)) <= 200))),
    CONSTRAINT vou_other_income_handler_ck CHECK ((((handler_object_id IS NULL) AND (handler_approval_entry_id IS NULL) AND (handler_code IS NULL) AND (handler_name IS NULL)) OR ((handler_object_id IS NOT NULL) AND (handler_approval_entry_id IS NOT NULL) AND (handler_code IS NOT NULL) AND (handler_name IS NOT NULL))))
);


--
-- Name: vou_payment_details; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.vou_payment_details (
    document_id character varying(26) NOT NULL,
    entity character varying(32) DEFAULT 'payment'::character varying NOT NULL,
    counterparty_entity character varying(16) NOT NULL,
    counterparty_object_id character varying(26) NOT NULL,
    counterparty_approval_entry_id character varying(26) NOT NULL,
    counterparty_code character varying(64) NOT NULL,
    counterparty_name character varying(200) NOT NULL,
    fund_account_object_id character varying(26) NOT NULL,
    fund_account_approval_entry_id character varying(26) NOT NULL,
    fund_account_code character varying(64) NOT NULL,
    fund_account_name character varying(200) NOT NULL,
    handler_object_id character varying(26),
    handler_approval_entry_id character varying(26),
    handler_code character varying(64),
    handler_name character varying(200),
    other_category character varying(32),
    CONSTRAINT vou_payment_details_counterparty_entity_check CHECK (((counterparty_entity)::text = ANY ((ARRAY['customer-account'::character varying, 'supplier'::character varying, 'other-unit'::character varying, 'employee'::character varying, 'sales-partner'::character varying])::text[]))),
    CONSTRAINT vou_payment_details_entity_check CHECK (((entity)::text = ANY ((ARRAY['sales-refund'::character varying, 'purchase-payment'::character varying, 'other-payment'::character varying, 'employee-loan'::character varying])::text[]))),
    CONSTRAINT vou_payment_details_entity_party_check CHECK (((((entity)::text = 'sales-refund'::text) AND ((counterparty_entity)::text = 'customer-account'::text)) OR (((entity)::text = 'purchase-payment'::text) AND ((counterparty_entity)::text = 'supplier'::text)) OR (((entity)::text = 'other-payment'::text) AND ((counterparty_entity)::text = ANY ((ARRAY['customer-account'::character varying, 'supplier'::character varying, 'other-unit'::character varying, 'employee'::character varying, 'sales-partner'::character varying])::text[]))) OR (((entity)::text = 'employee-loan'::text) AND ((counterparty_entity)::text = 'employee'::text)))),
    CONSTRAINT vou_payment_details_other_category_check CHECK (((other_category)::text = ANY ((ARRAY['COMMISSION'::character varying, 'INTERMEDIARY'::character varying])::text[]))),
    CONSTRAINT vou_payment_details_other_category_ck CHECK (((other_category IS NULL) OR ((entity)::text = 'other-payment'::text))),
    CONSTRAINT vou_payment_handler_ck CHECK ((((handler_object_id IS NULL) AND (handler_approval_entry_id IS NULL) AND (handler_code IS NULL) AND (handler_name IS NULL)) OR ((handler_object_id IS NOT NULL) AND (handler_approval_entry_id IS NOT NULL) AND (handler_code IS NOT NULL) AND (handler_name IS NOT NULL))))
);


--
-- Name: vou_price_lines; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.vou_price_lines (
    id character varying(26) NOT NULL,
    document_id character varying(26) NOT NULL,
    document_entity character varying(32) NOT NULL,
    line_no integer NOT NULL,
    product_object_id character varying(26) NOT NULL,
    product_approval_entry_id character varying(26) NOT NULL,
    product_code character varying(64) NOT NULL,
    product_name character varying(200) NOT NULL,
    default_input_unit_symbol character varying(32) CONSTRAINT vou_price_lines_product_unit_not_null NOT NULL,
    behavior_profile character varying(32) CONSTRAINT vou_price_lines_product_kind_not_null NOT NULL,
    unit_price_cents bigint NOT NULL,
    remark character varying(1000),
    product_type_object_id character varying(26) NOT NULL,
    product_type_code character varying(64) NOT NULL,
    product_type_name character varying(200) NOT NULL,
    CONSTRAINT vou_price_lines_document_entity_check CHECK (((document_entity)::text = ANY ((ARRAY['sale-pricing'::character varying, 'purchase-inquiry'::character varying])::text[]))),
    CONSTRAINT vou_price_lines_line_no_check CHECK ((line_no > 0)),
    CONSTRAINT vou_price_lines_unit_price_cents_check CHECK ((unit_price_cents >= 0))
);


--
-- Name: vou_product_lines; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.vou_product_lines (
    id character varying(26) NOT NULL,
    document_id character varying(26) NOT NULL,
    document_entity character varying(32) NOT NULL,
    line_no integer NOT NULL,
    product_object_id character varying(26) NOT NULL,
    product_approval_entry_id character varying(26) NOT NULL,
    product_code character varying(64) NOT NULL,
    product_name character varying(200) NOT NULL,
    entered_unit_symbol character varying(32) CONSTRAINT vou_product_lines_product_unit_not_null NOT NULL,
    base_quantity_micros bigint CONSTRAINT vou_product_lines_ordered_qty_micros_not_null NOT NULL,
    unit_price_cents bigint NOT NULL,
    line_amount_cents bigint NOT NULL,
    outbound_base_quantity_micros bigint,
    signed_base_quantity_micros bigint,
    rejected_base_quantity_micros bigint,
    loss_base_quantity_micros bigint,
    inbound_base_quantity_micros bigint,
    remark character varying(1000),
    purchase_unit_price_cents bigint,
    base_unit_price_cents bigint NOT NULL,
    settlement_surcharge_cents bigint NOT NULL,
    behavior_profile character varying(32) DEFAULT 'RAW_MATERIAL'::character varying CONSTRAINT vou_product_lines_product_kind_not_null NOT NULL,
    reference_unit_price_cents bigint DEFAULT 0 NOT NULL,
    reference_document_id character varying(26),
    reference_document_no character varying(32),
    reference_business_date date,
    reference_line_id character varying(26),
    entered_quantity_micros bigint NOT NULL,
    entered_unit_object_id character varying(26) NOT NULL,
    entered_unit_code character varying(64) NOT NULL,
    entered_unit_name character varying(200) NOT NULL,
    product_type_object_id character varying(26) NOT NULL,
    product_type_code character varying(64) NOT NULL,
    product_type_name character varying(200) NOT NULL,
    default_packaging_spec_micros bigint,
    delivery_specification_type character varying(16) DEFAULT 'PACKAGED'::character varying NOT NULL,
    CONSTRAINT vou_product_lines_base_price_ck CHECK ((base_unit_price_cents >= 0)),
    CONSTRAINT vou_product_lines_delivery_specification_type_check CHECK (((delivery_specification_type)::text = ANY ((ARRAY['PACKAGED'::character varying, 'BULK_LIQUID'::character varying])::text[]))),
    CONSTRAINT vou_product_lines_document_entity_check CHECK (((document_entity)::text = ANY ((ARRAY['sale-order'::character varying, 'purchase-order'::character varying])::text[]))),
    CONSTRAINT vou_product_lines_effective_price_ck CHECK ((unit_price_cents = (base_unit_price_cents + settlement_surcharge_cents))),
    CONSTRAINT vou_product_lines_execution_ck CHECK (((((document_entity)::text = 'purchase-order'::text) AND (outbound_base_quantity_micros IS NULL) AND (signed_base_quantity_micros IS NULL) AND (rejected_base_quantity_micros IS NULL) AND (loss_base_quantity_micros IS NULL) AND (inbound_base_quantity_micros IS NULL)) OR (((document_entity)::text = 'sale-order'::text) AND (inbound_base_quantity_micros IS NULL)))),
    CONSTRAINT vou_product_lines_inbound_qty_micros_check CHECK ((inbound_base_quantity_micros > 0)),
    CONSTRAINT vou_product_lines_line_amount_ck CHECK ((line_amount_cents >= 0)),
    CONSTRAINT vou_product_lines_line_no_check CHECK ((line_no >= 1)),
    CONSTRAINT vou_product_lines_loss_qty_micros_check CHECK ((loss_base_quantity_micros >= 0)),
    CONSTRAINT vou_product_lines_ordered_qty_micros_check CHECK ((base_quantity_micros > 0)),
    CONSTRAINT vou_product_lines_outbound_qty_micros_check CHECK ((outbound_base_quantity_micros > 0)),
    CONSTRAINT vou_product_lines_purchase_unit_price_cents_check CHECK (((purchase_unit_price_cents IS NULL) OR (purchase_unit_price_cents > 0))),
    CONSTRAINT vou_product_lines_reference_ck CHECK ((((reference_document_id IS NULL) AND (reference_document_no IS NULL) AND (reference_business_date IS NULL) AND (reference_line_id IS NULL) AND (reference_unit_price_cents = 0)) OR ((reference_document_id IS NOT NULL) AND (reference_document_no IS NOT NULL) AND (reference_business_date IS NOT NULL) AND (reference_line_id IS NOT NULL)))),
    CONSTRAINT vou_product_lines_reference_unit_price_cents_check CHECK ((reference_unit_price_cents >= 0)),
    CONSTRAINT vou_product_lines_rejected_qty_micros_check CHECK ((rejected_base_quantity_micros >= 0)),
    CONSTRAINT vou_product_lines_remark_ck CHECK (((remark IS NULL) OR ((length(btrim((remark)::text)) >= 1) AND (length(btrim((remark)::text)) <= 1000)))),
    CONSTRAINT vou_product_lines_signed_qty_micros_check CHECK ((signed_base_quantity_micros >= 0)),
    CONSTRAINT vou_product_lines_surcharge_ck CHECK ((settlement_surcharge_cents >= 0)),
    CONSTRAINT vou_product_lines_unit_price_ck CHECK ((unit_price_cents >= 0))
);


--
-- Name: vou_production_details; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.vou_production_details (
    document_id character varying(26) NOT NULL,
    entity character varying(32) NOT NULL,
    material_warehouse_object_id character varying(26) NOT NULL,
    material_warehouse_approval_entry_id character varying(26) NOT NULL,
    material_warehouse_code character varying(64) NOT NULL,
    material_warehouse_name character varying(200) NOT NULL,
    finished_warehouse_object_id character varying(26) NOT NULL,
    finished_warehouse_approval_entry_id character varying(26) NOT NULL,
    finished_warehouse_code character varying(64) NOT NULL,
    finished_warehouse_name character varying(200) NOT NULL,
    CONSTRAINT vou_production_details_entity_check CHECK (((entity)::text = ANY ((ARRAY['order-production'::character varying, 'self-production'::character varying])::text[])))
);


--
-- Name: vou_production_material_lines; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.vou_production_material_lines (
    id character varying(26) NOT NULL,
    output_line_id character varying(26) NOT NULL,
    line_no integer NOT NULL,
    formula_material_object_id character varying(26) CONSTRAINT vou_production_material_lin_formula_material_object_id_not_null NOT NULL,
    formula_material_approval_entry_id character varying(26) CONSTRAINT vou_production_material_line_formula_approval_entry_not_null NOT NULL,
    formula_material_code character varying(64) NOT NULL,
    formula_material_name character varying(200) NOT NULL,
    formula_entered_unit_symbol character varying(32) CONSTRAINT vou_production_material_lines_formula_material_unit_not_null NOT NULL,
    formula_base_quantity_micros bigint CONSTRAINT vou_production_material_lines_formula_quantity_micros_not_null NOT NULL,
    suggested_base_quantity_micros bigint CONSTRAINT vou_production_material_line_suggested_quantity_micros_not_null NOT NULL,
    actual_material_object_id character varying(26) CONSTRAINT vou_production_material_line_actual_material_object_id_not_null NOT NULL,
    actual_material_approval_entry_id character varying(26) CONSTRAINT vou_production_material_actual_entry_nn NOT NULL,
    actual_material_code character varying(64) NOT NULL,
    actual_material_name character varying(200) NOT NULL,
    actual_entered_unit_symbol character varying(32) CONSTRAINT vou_production_material_lines_actual_material_unit_not_null NOT NULL,
    actual_base_quantity_micros bigint CONSTRAINT vou_production_material_lines_actual_quantity_micros_not_null NOT NULL,
    adjustment_reason character varying(1000),
    actual_entered_quantity_micros bigint CONSTRAINT vou_production_material_lin_actual_entered_quantity_mi_not_null NOT NULL,
    actual_entered_unit_object_id character varying(26) CONSTRAINT vou_production_material_lin_actual_entered_unit_object_not_null NOT NULL,
    actual_entered_unit_code character varying(64) NOT NULL,
    actual_entered_unit_name character varying(200) NOT NULL,
    CONSTRAINT vou_production_material_adjustment_ck CHECK (((((formula_material_object_id)::text = (actual_material_object_id)::text) AND ((formula_material_approval_entry_id)::text = (actual_material_approval_entry_id)::text) AND (suggested_base_quantity_micros = actual_base_quantity_micros)) OR (length(btrim((COALESCE(adjustment_reason, ''::character varying))::text)) > 0))),
    CONSTRAINT vou_production_material_lines_actual_quantity_micros_check CHECK ((actual_base_quantity_micros > 0)),
    CONSTRAINT vou_production_material_lines_formula_quantity_micros_check CHECK ((formula_base_quantity_micros > 0)),
    CONSTRAINT vou_production_material_lines_line_no_check CHECK ((line_no > 0)),
    CONSTRAINT vou_production_material_lines_suggested_quantity_micros_check CHECK ((suggested_base_quantity_micros > 0))
);


--
-- Name: vou_production_output_lines; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.vou_production_output_lines (
    id character varying(26) NOT NULL,
    document_id character varying(26) NOT NULL,
    line_no integer NOT NULL,
    source_order_line_id character varying(26),
    product_object_id character varying(26) NOT NULL,
    product_approval_entry_id character varying(26) NOT NULL,
    product_code character varying(64) NOT NULL,
    product_name character varying(200) NOT NULL,
    entered_unit_symbol character varying(32) CONSTRAINT vou_production_output_lines_product_unit_not_null NOT NULL,
    behavior_profile character varying(32) CONSTRAINT vou_production_output_lines_product_kind_not_null NOT NULL,
    base_quantity_micros bigint CONSTRAINT vou_production_output_lines_output_quantity_micros_not_null NOT NULL,
    loss_rate_micros bigint NOT NULL,
    formula_base_quantity_micros bigint CONSTRAINT vou_production_output_lines_formula_base_output_quanti_not_null NOT NULL,
    remark character varying(1000),
    entered_quantity_micros bigint NOT NULL,
    entered_unit_object_id character varying(26) NOT NULL,
    entered_unit_code character varying(64) NOT NULL,
    entered_unit_name character varying(200) NOT NULL,
    CONSTRAINT vou_production_output_lines_formula_base_output_quantity__check CHECK ((formula_base_quantity_micros > 0)),
    CONSTRAINT vou_production_output_lines_line_no_check CHECK ((line_no > 0)),
    CONSTRAINT vou_production_output_lines_loss_rate_micros_check CHECK (((loss_rate_micros >= 0) AND (loss_rate_micros <= 100000000))),
    CONSTRAINT vou_production_output_lines_output_quantity_micros_check CHECK ((base_quantity_micros > 0)),
    CONSTRAINT vou_production_output_lines_product_kind_check CHECK (((behavior_profile)::text = ANY ((ARRAY['STANDARD_FINISHED'::character varying, 'CUSTOM_FINISHED'::character varying])::text[])))
);


--
-- Name: vou_purchase_inbound_details; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.vou_purchase_inbound_details (
    document_id character varying(26) NOT NULL,
    entity character varying(32) DEFAULT 'purchase-inbound'::character varying NOT NULL,
    source_order_id character varying(26) NOT NULL,
    supplier_object_id character varying(26) NOT NULL,
    supplier_approval_entry_id character varying(26) NOT NULL,
    supplier_code character varying(64) NOT NULL,
    supplier_name character varying(200) NOT NULL,
    warehouse_object_id character varying(26) NOT NULL,
    warehouse_approval_entry_id character varying(26) NOT NULL,
    warehouse_code character varying(64) NOT NULL,
    warehouse_name character varying(200) NOT NULL,
    CONSTRAINT vou_purchase_inbound_details_entity_check CHECK (((entity)::text = 'purchase-inbound'::text))
);


--
-- Name: vou_purchase_inbound_lines; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.vou_purchase_inbound_lines (
    id character varying(26) NOT NULL,
    document_id character varying(26) NOT NULL,
    source_order_line_id character varying(26) NOT NULL,
    line_no integer NOT NULL,
    product_object_id character varying(26) NOT NULL,
    product_approval_entry_id character varying(26) NOT NULL,
    product_code character varying(64) NOT NULL,
    product_name character varying(200) NOT NULL,
    entered_unit_symbol character varying(32) CONSTRAINT vou_purchase_inbound_lines_product_unit_not_null NOT NULL,
    base_quantity_micros bigint CONSTRAINT vou_purchase_inbound_lines_quantity_micros_not_null NOT NULL,
    unit_price_cents bigint NOT NULL,
    line_amount_cents bigint NOT NULL,
    remark character varying(1000),
    CONSTRAINT vou_purchase_inbound_lines_line_amount_ck CHECK ((line_amount_cents >= 0)),
    CONSTRAINT vou_purchase_inbound_lines_line_no_check CHECK ((line_no > 0)),
    CONSTRAINT vou_purchase_inbound_lines_quantity_micros_check CHECK ((base_quantity_micros > 0)),
    CONSTRAINT vou_purchase_inbound_lines_unit_price_ck CHECK ((unit_price_cents >= 0))
);


--
-- Name: vou_purchase_inquiry_details; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.vou_purchase_inquiry_details (
    document_id character varying(26) NOT NULL,
    entity character varying(32) DEFAULT 'purchase-inquiry'::character varying NOT NULL,
    supplier_object_id character varying(26) NOT NULL,
    supplier_approval_entry_id character varying(26) NOT NULL,
    supplier_code character varying(64) NOT NULL,
    supplier_name character varying(200) NOT NULL,
    CONSTRAINT vou_purchase_inquiry_details_entity_check CHECK (((entity)::text = 'purchase-inquiry'::text))
);


--
-- Name: vou_purchase_order_details; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.vou_purchase_order_details (
    document_id character varying(26) NOT NULL,
    entity character varying(32) DEFAULT 'purchase-order'::character varying NOT NULL,
    supplier_object_id character varying(26) NOT NULL,
    supplier_approval_entry_id character varying(26) NOT NULL,
    supplier_code character varying(64) NOT NULL,
    supplier_name character varying(200) NOT NULL,
    purchaser_object_id character varying(26),
    purchaser_approval_entry_id character varying(26),
    purchaser_code character varying(64),
    purchaser_name character varying(200),
    warehouse_object_id character varying(26),
    warehouse_approval_entry_id character varying(26),
    warehouse_code character varying(64),
    warehouse_name character varying(200),
    contact_name character varying(100),
    contact_phone character varying(32),
    settlement_method_object_id character varying(26),
    settlement_method_code character varying(64),
    settlement_method_name character varying(200),
    settlement_rule_type character varying(32),
    settlement_month_offset integer,
    settlement_day_of_month integer,
    settlement_day_offset integer,
    settlement_description character varying(1000),
    fulfillment_status character varying(32) DEFAULT 'OPEN'::character varying NOT NULL,
    settlement_due_days integer,
    settlement_cutoff_day integer,
    settlement_default_sales_surcharge_cents bigint DEFAULT 0 CONSTRAINT vou_purchase_order_details_settlement_default_sales_su_not_null NOT NULL,
    settlement_term_code character varying(32) DEFAULT ''::character varying NOT NULL,
    CONSTRAINT vou_purchase_order_details_entity_check CHECK (((entity)::text = 'purchase-order'::text)),
    CONSTRAINT vou_purchase_order_fulfillment_status_ck CHECK (((fulfillment_status)::text = ANY ((ARRAY['OPEN'::character varying, 'FULFILLED'::character varying])::text[]))),
    CONSTRAINT vou_purchase_order_purchaser_ck CHECK ((((purchaser_object_id IS NULL) AND (purchaser_approval_entry_id IS NULL) AND (purchaser_code IS NULL) AND (purchaser_name IS NULL)) OR ((purchaser_object_id IS NOT NULL) AND (purchaser_approval_entry_id IS NOT NULL) AND (purchaser_code IS NOT NULL) AND (purchaser_name IS NOT NULL)))),
    CONSTRAINT vou_purchase_order_settlement_ck CHECK ((settlement_method_object_id IS NULL) = (settlement_method_code IS NULL) AND (settlement_method_object_id IS NULL) = (settlement_method_name IS NULL)),
    CONSTRAINT vou_purchase_order_warehouse_ck CHECK (((warehouse_object_id IS NOT NULL) AND (warehouse_approval_entry_id IS NOT NULL) AND (warehouse_code IS NOT NULL) AND (warehouse_name IS NOT NULL)))
);


--
-- Name: vou_purchase_return_details; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.vou_purchase_return_details (
    document_id character varying(26) NOT NULL,
    entity character varying(32) DEFAULT 'purchase-return'::character varying NOT NULL,
    source_order_id character varying(26) NOT NULL,
    return_reason character varying(1000) NOT NULL,
    supplier_object_id character varying(26) NOT NULL,
    supplier_approval_entry_id character varying(26) NOT NULL,
    supplier_code character varying(64) NOT NULL,
    supplier_name character varying(200) NOT NULL,
    warehouse_object_id character varying(26) NOT NULL,
    warehouse_approval_entry_id character varying(26) NOT NULL,
    warehouse_code character varying(64) NOT NULL,
    warehouse_name character varying(200) NOT NULL,
    CONSTRAINT vou_purchase_return_details_entity_check CHECK (((entity)::text = 'purchase-return'::text)),
    CONSTRAINT vou_purchase_return_details_return_reason_check CHECK ((length(btrim((return_reason)::text)) > 0))
);


--
-- Name: vou_purchase_return_lines; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.vou_purchase_return_lines (
    id character varying(26) NOT NULL,
    document_id character varying(26) NOT NULL,
    source_inbound_line_id character varying(26) NOT NULL,
    source_inbound_id character varying(26) NOT NULL,
    source_order_line_id character varying(26) NOT NULL,
    line_no integer NOT NULL,
    product_object_id character varying(26) NOT NULL,
    product_approval_entry_id character varying(26) NOT NULL,
    product_code character varying(64) NOT NULL,
    product_name character varying(200) NOT NULL,
    entered_unit_symbol character varying(32) CONSTRAINT vou_purchase_return_lines_product_unit_not_null NOT NULL,
    base_quantity_micros bigint CONSTRAINT vou_purchase_return_lines_quantity_micros_not_null NOT NULL,
    unit_price_cents bigint NOT NULL,
    line_amount_cents bigint NOT NULL,
    remark character varying(1000),
    CONSTRAINT vou_purchase_return_lines_line_amount_ck CHECK ((line_amount_cents >= 0)),
    CONSTRAINT vou_purchase_return_lines_line_no_check CHECK ((line_no > 0)),
    CONSTRAINT vou_purchase_return_lines_quantity_micros_check CHECK ((base_quantity_micros > 0)),
    CONSTRAINT vou_purchase_return_lines_unit_price_ck CHECK ((unit_price_cents >= 0))
);


--
-- Name: vou_receipt_details; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.vou_receipt_details (
    document_id character varying(26) NOT NULL,
    entity character varying(32) DEFAULT 'receipt'::character varying NOT NULL,
    counterparty_entity character varying(16) NOT NULL,
    counterparty_object_id character varying(26) NOT NULL,
    counterparty_approval_entry_id character varying(26) NOT NULL,
    counterparty_code character varying(64) NOT NULL,
    counterparty_name character varying(200) NOT NULL,
    fund_account_object_id character varying(26) NOT NULL,
    fund_account_approval_entry_id character varying(26) NOT NULL,
    fund_account_code character varying(64) NOT NULL,
    fund_account_name character varying(200) NOT NULL,
    handler_object_id character varying(26),
    handler_approval_entry_id character varying(26),
    handler_code character varying(64),
    handler_name character varying(200),
    other_category character varying(32),
    CONSTRAINT vou_receipt_details_counterparty_entity_check CHECK (((counterparty_entity)::text = ANY ((ARRAY['customer-account'::character varying, 'supplier'::character varying, 'other-unit'::character varying, 'employee'::character varying, 'sales-partner'::character varying])::text[]))),
    CONSTRAINT vou_receipt_details_entity_check CHECK (((entity)::text = ANY ((ARRAY['sales-receipt'::character varying, 'purchase-refund'::character varying, 'other-receipt'::character varying, 'employee-repayment'::character varying])::text[]))),
    CONSTRAINT vou_receipt_details_entity_party_check CHECK (((((entity)::text = 'sales-receipt'::text) AND ((counterparty_entity)::text = 'customer-account'::text)) OR (((entity)::text = 'purchase-refund'::text) AND ((counterparty_entity)::text = 'supplier'::text)) OR (((entity)::text = 'other-receipt'::text) AND ((counterparty_entity)::text = ANY ((ARRAY['customer-account'::character varying, 'supplier'::character varying, 'other-unit'::character varying, 'employee'::character varying, 'sales-partner'::character varying])::text[]))) OR (((entity)::text = 'employee-repayment'::text) AND ((counterparty_entity)::text = 'employee'::text)))),
    CONSTRAINT vou_receipt_details_other_category_check CHECK (((other_category)::text = ANY ((ARRAY['COMMISSION'::character varying, 'INTERMEDIARY'::character varying])::text[]))),
    CONSTRAINT vou_receipt_details_other_category_ck CHECK (((other_category IS NULL) OR ((entity)::text = 'other-receipt'::text))),
    CONSTRAINT vou_receipt_handler_ck CHECK ((((handler_object_id IS NULL) AND (handler_approval_entry_id IS NULL) AND (handler_code IS NULL) AND (handler_name IS NULL)) OR ((handler_object_id IS NOT NULL) AND (handler_approval_entry_id IS NOT NULL) AND (handler_code IS NOT NULL) AND (handler_name IS NOT NULL))))
);


--
-- Name: vou_sale_delivery_details; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.vou_sale_delivery_details (
    document_id character varying(26) NOT NULL,
    entity character varying(32) DEFAULT 'sale-delivery'::character varying NOT NULL,
    source_outbound_id character varying(26) NOT NULL,
    customer_object_id character varying(26) NOT NULL,
    customer_approval_entry_id character varying(26) NOT NULL,
    customer_code character varying(64) NOT NULL,
    customer_name character varying(200) NOT NULL,
    carrier_service_relationship_object_id character varying(26),
    carrier_service_relationship_approval_entry_id character varying(26),
    carrier_service_relationship_code character varying(64),
    carrier_service_relationship_name character varying(200),
    vehicle_object_id character varying(26),
    vehicle_approval_entry_id character varying(26),
    vehicle_code character varying(64),
    vehicle_name character varying(200),
    vehicle_plate_number character varying(32),
    carrier_type character varying(16) NOT NULL,
    carrier_operating_entity_object_id character varying(26),
    carrier_operating_entity_approval_entry_id character varying(26),
    carrier_operating_entity_code character varying(64),
    carrier_operating_entity_name character varying(200),
    vehicle_bulk_liquid_capable boolean DEFAULT false NOT NULL,
    CONSTRAINT vou_sale_delivery_carrier_type_ck CHECK (((carrier_type)::text = ANY ((ARRAY['INTERNAL'::character varying, 'EXTERNAL'::character varying])::text[]))),
    CONSTRAINT vou_sale_delivery_details_entity_check CHECK (((entity)::text = 'sale-delivery'::text)),
    CONSTRAINT vou_sale_delivery_transport_snapshot_ck CHECK ((((vehicle_object_id IS NULL) AND (vehicle_approval_entry_id IS NULL) AND (vehicle_code IS NULL) AND (vehicle_name IS NULL) AND (vehicle_plate_number IS NULL) AND (carrier_operating_entity_object_id IS NULL) AND (carrier_operating_entity_approval_entry_id IS NULL) AND (carrier_operating_entity_code IS NULL) AND (carrier_operating_entity_name IS NULL) AND (carrier_service_relationship_object_id IS NULL) AND (carrier_service_relationship_approval_entry_id IS NULL) AND (carrier_service_relationship_code IS NULL) AND (carrier_service_relationship_name IS NULL)) OR ((vehicle_object_id IS NOT NULL) AND (vehicle_approval_entry_id IS NOT NULL) AND (vehicle_code IS NOT NULL) AND (vehicle_name IS NOT NULL) AND (vehicle_plate_number IS NOT NULL) AND ((((carrier_type)::text = 'INTERNAL'::text) AND (carrier_operating_entity_object_id IS NOT NULL) AND (carrier_operating_entity_approval_entry_id IS NOT NULL) AND (carrier_operating_entity_code IS NOT NULL) AND (carrier_operating_entity_name IS NOT NULL) AND (carrier_service_relationship_object_id IS NULL) AND (carrier_service_relationship_approval_entry_id IS NULL) AND (carrier_service_relationship_code IS NULL) AND (carrier_service_relationship_name IS NULL)) OR (((carrier_type)::text = 'EXTERNAL'::text) AND (carrier_operating_entity_object_id IS NULL) AND (carrier_operating_entity_approval_entry_id IS NULL) AND (carrier_operating_entity_code IS NULL) AND (carrier_operating_entity_name IS NULL) AND (carrier_service_relationship_object_id IS NOT NULL) AND (carrier_service_relationship_approval_entry_id IS NOT NULL) AND (carrier_service_relationship_code IS NOT NULL) AND (carrier_service_relationship_name IS NOT NULL))))))
);


--
-- Name: vou_sale_order_details; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.vou_sale_order_details (
    document_id character varying(26) NOT NULL,
    entity character varying(32) DEFAULT 'sale-order'::character varying NOT NULL,
    customer_object_id character varying(26) NOT NULL,
    customer_approval_entry_id character varying(26) NOT NULL,
    customer_code character varying(64) NOT NULL,
    customer_name character varying(200) NOT NULL,
    salesperson_object_id character varying(26),
    salesperson_approval_entry_id character varying(26),
    salesperson_code character varying(64),
    salesperson_name character varying(200),
    contact_name character varying(100),
    contact_phone character varying(32),
    delivery_address character varying(500),
    settlement_method_object_id character varying(26),
    settlement_method_code character varying(64),
    settlement_method_name character varying(200),
    settlement_rule_type character varying(32),
    settlement_month_offset integer,
    settlement_day_of_month integer,
    settlement_day_offset integer,
    settlement_description character varying(1000),
    fulfillment_status character varying(32) DEFAULT 'OPEN'::character varying NOT NULL,
    settlement_due_days integer,
    settlement_cutoff_day integer,
    settlement_default_sales_surcharge_cents bigint DEFAULT 0 CONSTRAINT vou_sale_order_details_settlement_default_sales_surcha_not_null NOT NULL,
    warehouse_object_id character varying(26),
    warehouse_approval_entry_id character varying(26),
    warehouse_code character varying(64),
    warehouse_name character varying(200),
    settlement_term_code character varying(32) DEFAULT ''::character varying NOT NULL,
    special_approval boolean DEFAULT false NOT NULL,
    sales_attribution_type character varying(32) NOT NULL,
    sales_attribution_subject_object_id character varying(26) CONSTRAINT vou_sale_order_details_sales_attribution_subject_objec_not_null NOT NULL,
    sales_attribution_subject_approval_entry_id character varying(26) CONSTRAINT vou_sale_order_details_sales_subject_entry_not_null NOT NULL,
    sales_attribution_subject_code character varying(64) NOT NULL,
    sales_attribution_subject_name character varying(200) NOT NULL,
    CONSTRAINT vou_sale_order_details_entity_check CHECK (((entity)::text = 'sale-order'::text)),
    CONSTRAINT vou_sale_order_fulfillment_status_ck CHECK (((fulfillment_status)::text = ANY ((ARRAY['OPEN'::character varying, 'FULFILLED'::character varying])::text[]))),
    CONSTRAINT vou_sale_order_sales_attribution_ck CHECK ((((sales_attribution_type)::text = 'INTERNAL_EMPLOYEE'::text) OR ((sales_attribution_type)::text = ANY ((ARRAY['EXTERNAL_PART_TIME'::character varying, 'CHANNEL_PARTNER'::character varying])::text[])))),
    CONSTRAINT vou_sale_order_salesperson_ck CHECK ((((salesperson_object_id IS NULL) AND (salesperson_approval_entry_id IS NULL) AND (salesperson_code IS NULL) AND (salesperson_name IS NULL)) OR ((salesperson_object_id IS NOT NULL) AND (salesperson_approval_entry_id IS NOT NULL) AND (salesperson_code IS NOT NULL) AND (salesperson_name IS NOT NULL)))),
    CONSTRAINT vou_sale_order_settlement_ck CHECK ((((settlement_method_object_id IS NULL) AND (settlement_method_code IS NULL) AND (settlement_method_name IS NULL) AND (settlement_rule_type IS NULL) AND (settlement_month_offset IS NULL) AND (settlement_day_of_month IS NULL) AND (settlement_day_offset IS NULL) AND (settlement_description IS NULL)) OR ((settlement_method_object_id IS NOT NULL) AND (settlement_method_code IS NOT NULL) AND (settlement_method_name IS NOT NULL) AND ((settlement_rule_type)::text = ANY ((ARRAY['DUE_DAYS'::character varying, 'RELATIVE_DAYS'::character varying, 'MONTH_END'::character varying, 'FIXED_DAY'::character varying])::text[])) AND ((settlement_month_offset >= 0) AND (settlement_month_offset <= 120)) AND ((settlement_day_offset >= '-3650'::integer) AND (settlement_day_offset <= 3650)) AND ((((settlement_rule_type)::text = 'DUE_DAYS'::text) AND (settlement_month_offset = 0) AND (settlement_day_of_month IS NULL) AND ((settlement_due_days >= 0) AND (settlement_due_days <= 3650))) OR (((settlement_rule_type)::text = 'RELATIVE_DAYS'::text) AND (settlement_month_offset = 0) AND (settlement_day_of_month IS NULL)) OR (((settlement_rule_type)::text = 'MONTH_END'::text) AND (settlement_day_of_month IS NULL) AND ((settlement_cutoff_day >= 1) AND (settlement_cutoff_day <= 31))) OR (((settlement_rule_type)::text = 'FIXED_DAY'::text) AND ((settlement_day_of_month >= 1) AND (settlement_day_of_month <= 31))))))),
    CONSTRAINT vou_sale_order_warehouse_ck CHECK ((((warehouse_object_id IS NULL) AND (warehouse_approval_entry_id IS NULL) AND (warehouse_code IS NULL) AND (warehouse_name IS NULL)) OR ((warehouse_object_id IS NOT NULL) AND (warehouse_approval_entry_id IS NOT NULL) AND (warehouse_code IS NOT NULL) AND (warehouse_name IS NOT NULL))))
);


--
-- Name: vou_sale_order_formula_lines; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.vou_sale_order_formula_lines (
    product_line_id character varying(26) NOT NULL,
    line_no integer NOT NULL,
    material_object_id character varying(26) NOT NULL,
    material_approval_entry_id character varying(26) NOT NULL,
    material_code character varying(64) NOT NULL,
    material_name character varying(200) NOT NULL,
    entered_unit_symbol character varying(32) CONSTRAINT vou_sale_order_formula_lines_material_unit_not_null NOT NULL,
    base_quantity_micros bigint CONSTRAINT vou_sale_order_formula_lines_quantity_micros_not_null NOT NULL,
    entered_quantity_micros bigint NOT NULL,
    entered_unit_object_id character varying(26) NOT NULL,
    entered_unit_code character varying(64) NOT NULL,
    entered_unit_name character varying(200) NOT NULL,
    CONSTRAINT vou_sale_order_formula_lines_line_no_check CHECK ((line_no >= 1)),
    CONSTRAINT vou_sale_order_formula_lines_quantity_micros_check CHECK ((base_quantity_micros > 0))
);


--
-- Name: vou_sale_order_formulas; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.vou_sale_order_formulas (
    product_line_id character varying(26) NOT NULL,
    source_type character varying(32) NOT NULL,
    source_document_id character varying(26),
    source_document_no character varying(64),
    output_base_quantity_micros bigint CONSTRAINT vou_sale_order_formulas_base_output_quantity_micros_not_null NOT NULL,
    output_entered_quantity_micros bigint NOT NULL,
    output_entered_unit_object_id character varying(26) NOT NULL,
    output_entered_unit_code character varying(64) NOT NULL,
    output_entered_unit_name character varying(200) NOT NULL,
    output_entered_unit_symbol character varying(32) NOT NULL,
    CONSTRAINT vou_sale_order_formula_source_ck CHECK (((((source_type)::text = 'CUSTOMER_LATEST'::text) AND (source_document_id IS NOT NULL) AND (source_document_no IS NOT NULL)) OR (((source_type)::text <> 'CUSTOMER_LATEST'::text) AND (source_document_id IS NULL) AND (source_document_no IS NULL)))),
    CONSTRAINT vou_sale_order_formulas_base_output_quantity_micros_check CHECK ((output_base_quantity_micros > 0)),
    CONSTRAINT vou_sale_order_formulas_source_type_check CHECK (((source_type)::text = ANY ((ARRAY['RAW_SELF'::character varying, 'PRODUCT_FIXED'::character varying, 'CUSTOMER_LATEST'::character varying, 'MANUAL'::character varying])::text[])))
);


--
-- Name: vou_sale_outbound_details; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.vou_sale_outbound_details (
    document_id character varying(26) NOT NULL,
    entity character varying(32) DEFAULT 'sale-outbound'::character varying NOT NULL,
    source_order_id character varying(26) NOT NULL,
    customer_object_id character varying(26) NOT NULL,
    customer_approval_entry_id character varying(26) NOT NULL,
    customer_code character varying(64) NOT NULL,
    customer_name character varying(200) NOT NULL,
    warehouse_object_id character varying(26),
    warehouse_approval_entry_id character varying(26),
    warehouse_code character varying(64),
    warehouse_name character varying(200),
    CONSTRAINT vou_sale_outbound_details_entity_check CHECK (((entity)::text = 'sale-outbound'::text)),
    CONSTRAINT vou_sale_outbound_warehouse_draft_ck CHECK ((((warehouse_object_id IS NULL) AND (warehouse_approval_entry_id IS NULL) AND (warehouse_code IS NULL) AND (warehouse_name IS NULL)) OR ((warehouse_object_id IS NOT NULL) AND (warehouse_approval_entry_id IS NOT NULL) AND (warehouse_code IS NOT NULL) AND (warehouse_name IS NOT NULL))))
);


--
-- Name: vou_sale_outbound_lines; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.vou_sale_outbound_lines (
    id character varying(26) NOT NULL,
    document_id character varying(26) NOT NULL,
    source_order_line_id character varying(26) NOT NULL,
    line_no integer NOT NULL,
    product_object_id character varying(26) NOT NULL,
    product_approval_entry_id character varying(26) NOT NULL,
    product_code character varying(64) NOT NULL,
    product_name character varying(200) NOT NULL,
    entered_unit_symbol character varying(32) CONSTRAINT vou_sale_outbound_lines_product_unit_not_null NOT NULL,
    base_quantity_micros bigint CONSTRAINT vou_sale_outbound_lines_quantity_micros_not_null NOT NULL,
    unit_price_cents bigint NOT NULL,
    line_amount_cents bigint NOT NULL,
    remark character varying(1000),
    CONSTRAINT vou_sale_outbound_lines_line_amount_ck CHECK ((line_amount_cents >= 0)),
    CONSTRAINT vou_sale_outbound_lines_line_no_check CHECK ((line_no > 0)),
    CONSTRAINT vou_sale_outbound_lines_quantity_micros_check CHECK ((base_quantity_micros > 0)),
    CONSTRAINT vou_sale_outbound_lines_unit_price_ck CHECK ((unit_price_cents >= 0))
);


--
-- Name: vou_sale_pricing_details; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.vou_sale_pricing_details (
    document_id character varying(26) NOT NULL,
    entity character varying(32) DEFAULT 'sale-pricing'::character varying NOT NULL,
    CONSTRAINT vou_sale_pricing_details_entity_check CHECK (((entity)::text = 'sale-pricing'::text))
);


--
-- Name: vou_sale_return_details; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.vou_sale_return_details (
    document_id character varying(26) NOT NULL,
    entity character varying(32) DEFAULT 'sale-return'::character varying NOT NULL,
    source_order_id character varying(26) NOT NULL,
    source_signoff_id character varying(26),
    return_kind character varying(16) NOT NULL,
    return_reason character varying(1000) NOT NULL,
    customer_object_id character varying(26) NOT NULL,
    customer_approval_entry_id character varying(26) NOT NULL,
    customer_code character varying(64) NOT NULL,
    customer_name character varying(200) NOT NULL,
    warehouse_object_id character varying(26) NOT NULL,
    warehouse_approval_entry_id character varying(26) NOT NULL,
    warehouse_code character varying(64) NOT NULL,
    warehouse_name character varying(200) NOT NULL,
    CONSTRAINT vou_sale_return_details_entity_check CHECK (((entity)::text = 'sale-return'::text)),
    CONSTRAINT vou_sale_return_details_return_kind_check CHECK (((return_kind)::text = ANY ((ARRAY['REFUSAL'::character varying, 'AFTER_SALE'::character varying])::text[]))),
    CONSTRAINT vou_sale_return_details_return_reason_check CHECK ((length(btrim((return_reason)::text)) > 0)),
    CONSTRAINT vou_sale_return_source_kind_ck CHECK (((((return_kind)::text = 'REFUSAL'::text) AND (source_signoff_id IS NOT NULL)) OR (((return_kind)::text = 'AFTER_SALE'::text) AND (source_signoff_id IS NULL))))
);


--
-- Name: vou_sale_return_lines; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.vou_sale_return_lines (
    id character varying(26) NOT NULL,
    document_id character varying(26) NOT NULL,
    source_signoff_line_id character varying(26) NOT NULL,
    source_signoff_id character varying(26) NOT NULL,
    line_no integer NOT NULL,
    product_object_id character varying(26) NOT NULL,
    product_approval_entry_id character varying(26) NOT NULL,
    product_code character varying(64) NOT NULL,
    product_name character varying(200) NOT NULL,
    entered_unit_symbol character varying(32) CONSTRAINT vou_sale_return_lines_product_unit_not_null NOT NULL,
    base_quantity_micros bigint CONSTRAINT vou_sale_return_lines_quantity_micros_not_null NOT NULL,
    unit_price_cents bigint NOT NULL,
    line_amount_cents bigint NOT NULL,
    remark character varying(1000),
    CONSTRAINT vou_sale_return_lines_line_amount_ck CHECK ((line_amount_cents >= 0)),
    CONSTRAINT vou_sale_return_lines_line_no_check CHECK ((line_no > 0)),
    CONSTRAINT vou_sale_return_lines_quantity_micros_check CHECK ((base_quantity_micros > 0)),
    CONSTRAINT vou_sale_return_lines_unit_price_ck CHECK ((unit_price_cents >= 0))
);


--
-- Name: vou_sale_signoff_details; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.vou_sale_signoff_details (
    document_id character varying(26) NOT NULL,
    entity character varying(32) DEFAULT 'sale-signoff'::character varying NOT NULL,
    source_delivery_id character varying(26) NOT NULL,
    source_outbound_id character varying(26) NOT NULL,
    source_order_id character varying(26) NOT NULL,
    customer_object_id character varying(26) NOT NULL,
    customer_approval_entry_id character varying(26) NOT NULL,
    customer_code character varying(64) NOT NULL,
    customer_name character varying(200) NOT NULL,
    warehouse_object_id character varying(26) NOT NULL,
    warehouse_approval_entry_id character varying(26) NOT NULL,
    warehouse_code character varying(64) NOT NULL,
    warehouse_name character varying(200) NOT NULL,
    CONSTRAINT vou_sale_signoff_details_entity_check CHECK (((entity)::text = 'sale-signoff'::text))
);


--
-- Name: vou_sale_signoff_lines; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.vou_sale_signoff_lines (
    id character varying(26) NOT NULL,
    document_id character varying(26) NOT NULL,
    source_outbound_line_id character varying(26) NOT NULL,
    source_order_line_id character varying(26) NOT NULL,
    line_no integer NOT NULL,
    product_object_id character varying(26) NOT NULL,
    product_approval_entry_id character varying(26) NOT NULL,
    product_code character varying(64) NOT NULL,
    product_name character varying(200) NOT NULL,
    entered_unit_symbol character varying(32) CONSTRAINT vou_sale_signoff_lines_product_unit_not_null NOT NULL,
    signed_base_quantity_micros bigint CONSTRAINT vou_sale_signoff_lines_signed_qty_micros_not_null NOT NULL,
    rejected_base_quantity_micros bigint CONSTRAINT vou_sale_signoff_lines_rejected_qty_micros_not_null NOT NULL,
    loss_base_quantity_micros bigint CONSTRAINT vou_sale_signoff_lines_loss_qty_micros_not_null NOT NULL,
    unit_price_cents bigint NOT NULL,
    line_amount_cents bigint NOT NULL,
    remark character varying(1000),
    CONSTRAINT vou_sale_signoff_lines_line_amount_cents_check CHECK ((line_amount_cents >= 0)),
    CONSTRAINT vou_sale_signoff_lines_line_no_check CHECK ((line_no > 0)),
    CONSTRAINT vou_sale_signoff_lines_loss_qty_micros_check CHECK ((loss_base_quantity_micros >= 0)),
    CONSTRAINT vou_sale_signoff_lines_rejected_qty_micros_check CHECK ((rejected_base_quantity_micros >= 0)),
    CONSTRAINT vou_sale_signoff_lines_signed_qty_micros_check CHECK ((signed_base_quantity_micros >= 0)),
    CONSTRAINT vou_sale_signoff_lines_unit_price_ck CHECK ((unit_price_cents >= 0))
);


--
-- Name: vou_service_acceptance_details; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.vou_service_acceptance_details (
    document_id character varying(26) NOT NULL,
    entity character varying(32) DEFAULT 'service-acceptance'::character varying NOT NULL,
    contract_document_id character varying(26) NOT NULL,
    service_date date NOT NULL,
    acceptance_date date NOT NULL,
    settlement_direction character varying(16) NOT NULL,
    contract_snapshot jsonb NOT NULL,
    fulfillment_fact text DEFAULT ''::text NOT NULL,
    acceptance_fact text DEFAULT ''::text NOT NULL,
    CONSTRAINT vou_service_acceptance_details_acceptance_fact_check CHECK ((length(btrim(acceptance_fact)) <= 10000)),
    CONSTRAINT vou_service_acceptance_details_check CHECK ((acceptance_date >= service_date)),
    CONSTRAINT vou_service_acceptance_details_contract_snapshot_check CHECK ((jsonb_typeof(contract_snapshot) = 'object'::text)),
    CONSTRAINT vou_service_acceptance_details_entity_check CHECK (((entity)::text = 'service-acceptance'::text)),
    CONSTRAINT vou_service_acceptance_details_fulfillment_fact_check CHECK ((length(btrim(fulfillment_fact)) <= 10000)),
    CONSTRAINT vou_service_acceptance_details_settlement_direction_check CHECK (((settlement_direction)::text = ANY ((ARRAY['PAYABLE'::character varying, 'RECEIVABLE'::character varying])::text[])))
);


--
-- Name: vou_service_contract_details; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.vou_service_contract_details (
    document_id character varying(26) NOT NULL,
    entity character varying(32) DEFAULT 'service-contract'::character varying NOT NULL,
    counterparty_entity character varying(32) NOT NULL,
    counterparty_object_id character varying(26) NOT NULL,
    counterparty_approval_entry_id character varying(26) NOT NULL,
    counterparty_code character varying(64) NOT NULL,
    counterparty_name character varying(200) NOT NULL,
    party_id character varying(26) NOT NULL,
    party_name character varying(200) NOT NULL,
    operating_entity_object_id character varying(26) CONSTRAINT vou_service_contract_detail_operating_entity_object_id_not_null NOT NULL,
    operating_entity_approval_entry_id character varying(26) CONSTRAINT vou_service_contract_detail_operating_entry_not_null NOT NULL,
    operating_entity_code character varying(64) NOT NULL,
    operating_entity_name character varying(200) NOT NULL,
    handler_object_id character varying(26) NOT NULL,
    handler_approval_entry_id character varying(26) NOT NULL,
    handler_code character varying(64) NOT NULL,
    handler_name character varying(200) NOT NULL,
    settlement_method_object_id character varying(26),
    settlement_method_code character varying(64),
    settlement_method_name character varying(200),
    settlement_term_code character varying(32),
    settlement_rule_type character varying(32),
    settlement_month_offset integer,
    settlement_day_of_month integer,
    settlement_day_offset integer,
    capabilities character varying(32)[] DEFAULT '{}'::character varying[] NOT NULL,
    applicable_from date,
    applicable_to date,
    contract_terms text DEFAULT ''::text NOT NULL,
    CONSTRAINT vou_service_contract_details_capabilities_check CHECK ((capabilities <@ ARRAY['EXTERNAL_PART_TIME'::character varying(32), 'CHANNEL_PARTNER'::character varying(32)])),
    CONSTRAINT vou_service_contract_details_check CHECK (((((counterparty_entity)::text = 'other-unit'::text) AND (cardinality(capabilities) = 0) AND (applicable_from IS NULL) AND (applicable_to IS NULL)) OR (((counterparty_entity)::text = 'sales-partner'::text) AND (cardinality(capabilities) > 0) AND (applicable_from IS NOT NULL) AND ((applicable_to IS NULL) OR (applicable_to >= applicable_from)) AND (settlement_method_object_id IS NULL) AND (settlement_method_code IS NULL) AND (settlement_method_name IS NULL) AND (settlement_term_code IS NULL) AND (settlement_rule_type IS NULL) AND (settlement_month_offset IS NULL) AND (settlement_day_of_month IS NULL) AND (settlement_day_offset IS NULL)))),
    CONSTRAINT vou_service_contract_details_check1 CHECK (((((counterparty_entity)::text = 'other-unit'::text) AND (settlement_method_object_id IS NOT NULL) AND (settlement_method_code IS NOT NULL) AND (settlement_method_name IS NOT NULL) AND (settlement_term_code IS NOT NULL) AND (settlement_rule_type IS NOT NULL) AND (settlement_month_offset IS NOT NULL) AND (settlement_day_offset IS NOT NULL)) OR ((counterparty_entity)::text = 'sales-partner'::text))),
    CONSTRAINT vou_service_contract_details_contract_terms_check CHECK ((length(btrim(contract_terms)) <= 10000)),
    CONSTRAINT vou_service_contract_details_counterparty_entity_check CHECK (((counterparty_entity)::text = ANY ((ARRAY['other-unit'::character varying, 'sales-partner'::character varying])::text[]))),
    CONSTRAINT vou_service_contract_details_entity_check CHECK (((entity)::text = 'service-contract'::text))
);


--
-- Name: wfl_action_executions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.wfl_action_executions (
    id character varying(26) NOT NULL,
    process_id character varying(26) NOT NULL,
    source_node_instance_id character varying(26) NOT NULL,
    target_node_key character varying(64) NOT NULL,
    relation_name character varying(64) NOT NULL,
    action_name character varying(64) NOT NULL,
    action_fingerprint character varying(64) NOT NULL,
    target_node_instance_id character varying(26),
    executed_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: wfl_create_child_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.wfl_create_child_requests (
    definition_id character varying(26) NOT NULL,
    request_key character varying(64) NOT NULL,
    process_id character varying(26) NOT NULL,
    parent_node_instance_id character varying(26) NOT NULL,
    target_node_key character varying(64) NOT NULL,
    action_execution_id character varying(26),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT wfl_create_child_requests_request_key_check CHECK (((length((request_key)::text) >= 16) AND (length((request_key)::text) <= 64)))
);


--
-- Name: wfl_definition_instances; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.wfl_definition_instances (
    id character varying(26) NOT NULL,
    definition_id character varying(26) NOT NULL,
    root_document_id character varying(26),
    root_document_no character varying(32) NOT NULL,
    root_entity character varying(32) NOT NULL,
    party_object_id character varying(26),
    party_code character varying(64),
    party_name character varying(200),
    definition_code character varying(64) NOT NULL,
    definition_name character varying(100) NOT NULL,
    definition_approval_entry_id character varying(26) NOT NULL,
    revision bigint DEFAULT 1 NOT NULL,
    root_deleted_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by character varying(26) NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by character varying(26) NOT NULL,
    CONSTRAINT wfl_definition_instances_revision_check CHECK ((revision > 0))
);


--
-- Name: dcl_wfl_process_definition_versions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.dcl_wfl_process_definition_versions (
    approval_entry_id character varying(26) NOT NULL,
    definition_id character varying(26) NOT NULL,
    script text NOT NULL,
    diagnostic text,
    compiled jsonb NOT NULL,
    last_trial_approval_revision bigint,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by character varying(26) NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by character varying(26) NOT NULL,
    CONSTRAINT dcl_wfl_process_definition_versions_trial_revision_check CHECK (((last_trial_approval_revision IS NULL) OR (last_trial_approval_revision > 0)))
);


--
-- Name: wfl_node_instances; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.wfl_node_instances (
    id character varying(26) NOT NULL,
    process_id character varying(26) NOT NULL,
    parent_node_instance_id character varying(26),
    node_key character varying(64) NOT NULL,
    node_name character varying(100) NOT NULL,
    document_id character varying(26),
    document_no character varying(32) NOT NULL,
    document_entity character varying(32) NOT NULL,
    business_parent_entity character varying(32),
    business_parent_document_id character varying(26),
    relation_name character varying(64),
    trigger_event character varying(64) NOT NULL,
    action_name character varying(64),
    evaluated_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: wfl_process_definitions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.wfl_process_definitions (
    id character varying(26) NOT NULL,
    code character varying(64) NOT NULL,
    enabled boolean DEFAULT false NOT NULL,
    revision bigint DEFAULT 1 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by character varying(26) NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by character varying(26) NOT NULL,
    CONSTRAINT wfl_process_definitions_code_check CHECK (((code)::text ~ '^[a-z][a-z0-9-]{1,62}[a-z0-9]$'::text)),
    CONSTRAINT wfl_process_definitions_revision_check CHECK ((revision > 0))
);


--
-- Name: wfl_runtime_audit_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.wfl_runtime_audit_events (
    id character varying(26) NOT NULL,
    process_id character varying(26),
    definition_id character varying(26) NOT NULL,
    definition_approval_entry_id character varying(26) NOT NULL,
    event_type character varying(48) NOT NULL,
    node_instance_id character varying(26),
    document_id character varying(26),
    document_no character varying(32),
    actor_id character varying(26) NOT NULL,
    request_id character varying(128) NOT NULL,
    summary jsonb DEFAULT '{}'::jsonb NOT NULL,
    occurred_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Data for Name: acc_asset_book_values; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: acc_assets; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: acc_bill_book_values; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: acc_bills; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: acc_book_user_scopes; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: acc_books; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: acc_container_entries; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: acc_depreciation_entries; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: acc_inventory_cost_allocations; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: acc_inventory_entries; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: dcl_acc_mapping_versions; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: acc_opening_assets; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: acc_opening_bills; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: acc_opening_containers; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: acc_opening_lines; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: acc_openings; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: acc_period_balances; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: acc_periods; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: acc_register_events; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: acc_subject_dimensions; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: acc_subject_usages; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: acc_subjects; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: acc_voucher_lines; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: acc_vouchers; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: app_audit_events; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: app_business_menu_items; Type: TABLE DATA; Schema: public; Owner: -
--


INSERT INTO public.app_menu_settings VALUES (1, 'DEFAULT', 1, '2026-08-24 15:23:49.677744+00', '01JAPPSYST3MACTR0000000000');

--
-- Data for Name: app_permissions; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.app_permissions VALUES ('01JVOU00000000000000000002', '/vou/sale-order/get', 'vou', 'sale-order', 'get', '查看销售订单', 'ENABLED', '2026-08-24 15:23:48.959532+00', NULL, '2026-08-24 15:23:48.959532+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JVOU00000000000000000016', '/vou/purchase-order/get', 'vou', 'purchase-order', 'get', '查看采购订单', 'ENABLED', '2026-08-24 15:23:48.959532+00', NULL, '2026-08-24 15:23:48.959532+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JVOU00000000000000000072', '/vou/expense-reimbursement/get', 'vou', 'expense-reimbursement', 'get', '查看费用报销', 'ENABLED', '2026-08-24 15:23:48.959532+00', NULL, '2026-08-24 15:23:48.959532+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JVOU00000000000000000086', '/vou/other-income/get', 'vou', 'other-income', 'get', '查看其他收入', 'ENABLED', '2026-08-24 15:23:48.959532+00', NULL, '2026-08-24 15:23:48.959532+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JVOU00000000000000000003', '/vou/sale-order/create', 'vou', 'sale-order', 'create', '创建销售订单', 'ENABLED', '2026-08-24 15:23:48.959532+00', NULL, '2026-08-24 15:23:48.959532+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JVOU00000000000000000073', '/vou/expense-reimbursement/create', 'vou', 'expense-reimbursement', 'create', '创建费用报销', 'ENABLED', '2026-08-24 15:23:48.959532+00', NULL, '2026-08-24 15:23:48.959532+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JVOU00000000000000000087', '/vou/other-income/create', 'vou', 'other-income', 'create', '创建其他收入', 'ENABLED', '2026-08-24 15:23:48.959532+00', NULL, '2026-08-24 15:23:48.959532+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JVOU00000000000000000004', '/vou/sale-order/save', 'vou', 'sale-order', 'save', '保存销售订单', 'ENABLED', '2026-08-24 15:23:48.959532+00', NULL, '2026-08-24 15:23:48.959532+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JVOU00000000000000000071', '/vou/expense-reimbursement/query', 'vou', 'expense-reimbursement', 'query', '查询费用报销', 'ENABLED', '2026-08-24 15:23:48.959532+00', NULL, '2026-08-24 15:23:48.959532+00', NULL, 1, 100);
INSERT INTO public.app_permissions VALUES ('01JVOU00000000000000000085', '/vou/other-income/query', 'vou', 'other-income', 'query', '查询其他收入', 'ENABLED', '2026-08-24 15:23:48.959532+00', NULL, '2026-08-24 15:23:48.959532+00', NULL, 1, 110);
INSERT INTO public.app_permissions VALUES ('01JVOU00000000000000000078', '/vou/expense-reimbursement/unapprove', 'vou', 'expense-reimbursement', 'unapprove', '反批准费用报销', 'ENABLED', '2026-08-24 15:23:48.959532+00', NULL, '2026-08-24 15:23:48.959532+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JVOU00000000000000000092', '/vou/other-income/unapprove', 'vou', 'other-income', 'unapprove', '反批准其他收入', 'ENABLED', '2026-08-24 15:23:48.959532+00', NULL, '2026-08-24 15:23:48.959532+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JVOU00000000000000000011', '/vou/sale-order/audit-history', 'vou', 'sale-order', 'audit-history', '查看审计销售订单', 'ENABLED', '2026-08-24 15:23:48.959532+00', NULL, '2026-08-24 15:23:48.959532+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JVOU00000000000000000025', '/vou/purchase-order/audit-history', 'vou', 'purchase-order', 'audit-history', '查看审计采购订单', 'ENABLED', '2026-08-24 15:23:48.959532+00', NULL, '2026-08-24 15:23:48.959532+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JVOU00000000000000000081', '/vou/expense-reimbursement/audit-history', 'vou', 'expense-reimbursement', 'audit-history', '查看审计费用报销', 'ENABLED', '2026-08-24 15:23:48.959532+00', NULL, '2026-08-24 15:23:48.959532+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JVOU00000000000000000095', '/vou/other-income/audit-history', 'vou', 'other-income', 'audit-history', '查看审计其他收入', 'ENABLED', '2026-08-24 15:23:48.959532+00', NULL, '2026-08-24 15:23:48.959532+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JVOU00000000000000000012', '/vou/sale-order/attachment-initiate', 'vou', 'sale-order', 'attachment-initiate', '发起附件上传销售订单', 'ENABLED', '2026-08-24 15:23:48.959532+00', NULL, '2026-08-24 15:23:48.959532+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JAPP00000000000000000002', '/app/user/query', 'app', 'user', 'query', '查询用户', 'ENABLED', '2026-08-24 15:23:48.884197+00', NULL, '2026-08-24 15:23:48.884197+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JAPP00000000000000000003', '/app/user/get', 'app', 'user', 'get', '查看用户', 'ENABLED', '2026-08-24 15:23:48.884197+00', NULL, '2026-08-24 15:23:48.884197+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JAPP00000000000000000004', '/app/user/create', 'app', 'user', 'create', '创建用户', 'ENABLED', '2026-08-24 15:23:48.884197+00', NULL, '2026-08-24 15:23:48.884197+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JAPP00000000000000000005', '/app/user/save', 'app', 'user', 'save', '修改用户', 'ENABLED', '2026-08-24 15:23:48.884197+00', NULL, '2026-08-24 15:23:48.884197+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JAPP00000000000000000006', '/app/user/enable', 'app', 'user', 'enable', '启用用户', 'ENABLED', '2026-08-24 15:23:48.884197+00', NULL, '2026-08-24 15:23:48.884197+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JAPP00000000000000000007', '/app/user/disable', 'app', 'user', 'disable', '停用用户', 'ENABLED', '2026-08-24 15:23:48.884197+00', NULL, '2026-08-24 15:23:48.884197+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JAPP00000000000000000008', '/app/role/query', 'app', 'role', 'query', '查询角色', 'ENABLED', '2026-08-24 15:23:48.884197+00', NULL, '2026-08-24 15:23:48.884197+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JAPP00000000000000000009', '/app/role/get', 'app', 'role', 'get', '查看角色', 'ENABLED', '2026-08-24 15:23:48.884197+00', NULL, '2026-08-24 15:23:48.884197+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JAPP00000000000000000010', '/app/role/create', 'app', 'role', 'create', '创建角色', 'ENABLED', '2026-08-24 15:23:48.884197+00', NULL, '2026-08-24 15:23:48.884197+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JAPP00000000000000000011', '/app/role/save', 'app', 'role', 'save', '修改角色', 'ENABLED', '2026-08-24 15:23:48.884197+00', NULL, '2026-08-24 15:23:48.884197+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JAPP00000000000000000012', '/app/role/enable', 'app', 'role', 'enable', '启用角色', 'ENABLED', '2026-08-24 15:23:48.884197+00', NULL, '2026-08-24 15:23:48.884197+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JAPP00000000000000000013', '/app/role/disable', 'app', 'role', 'disable', '停用角色', 'ENABLED', '2026-08-24 15:23:48.884197+00', NULL, '2026-08-24 15:23:48.884197+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JAPP00000000000000000014', '/app/permission/query', 'app', 'permission', 'query', '查询权限目录', 'ENABLED', '2026-08-24 15:23:48.884197+00', NULL, '2026-08-24 15:23:48.884197+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JAPP00000000000000000015', '/app/permission/get', 'app', 'permission', 'get', '查看权限', 'ENABLED', '2026-08-24 15:23:48.884197+00', NULL, '2026-08-24 15:23:48.884197+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JBOB00000000000000000005', '/bob/customer/get', 'bob', 'customer', 'get', '查看客户', 'ENABLED', '2026-08-24 15:23:48.912973+00', NULL, '2026-08-24 15:23:48.912973+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JBOB00000000000000000021', '/dcl/employee/approve', 'dcl', 'employee', 'approve', '审核通过员工声明', 'ENABLED', '2026-08-24 15:23:48.912973+00', NULL, '2026-08-24 15:23:48.912973+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JBOB00000000000000000022', '/dcl/employee/audit-history', 'dcl', 'employee', 'audit-history', '查看审核记录员工声明', 'ENABLED', '2026-08-24 15:23:48.912973+00', NULL, '2026-08-24 15:23:48.912973+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JBOB00000000000000000023', '/dcl/employee/create', 'dcl', 'employee', 'create', '创建员工声明', 'ENABLED', '2026-08-24 15:23:48.912973+00', NULL, '2026-08-24 15:23:48.912973+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JBOB00000000000000000025', '/bob/employee/get', 'bob', 'employee', 'get', '查看员工', 'ENABLED', '2026-08-24 15:23:48.912973+00', NULL, '2026-08-24 15:23:48.912973+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JBOB00000000000000000027', '/dcl/employee/reject', 'dcl', 'employee', 'reject', '审核驳回员工声明', 'ENABLED', '2026-08-24 15:23:48.912973+00', NULL, '2026-08-24 15:23:48.912973+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JBOB00000000000000000028', '/dcl/employee/save', 'dcl', 'employee', 'save', '保存员工声明草稿', 'ENABLED', '2026-08-24 15:23:48.912973+00', NULL, '2026-08-24 15:23:48.912973+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JBOB00000000000000000029', '/dcl/employee/submit', 'dcl', 'employee', 'submit', '提交员工声明审核', 'ENABLED', '2026-08-24 15:23:48.912973+00', NULL, '2026-08-24 15:23:48.912973+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JBOB00000000000000000030', '/dcl/employee/versions', 'dcl', 'employee', 'versions', '查看员工声明版本', 'ENABLED', '2026-08-24 15:23:48.912973+00', NULL, '2026-08-24 15:23:48.912973+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JBOB00000000000000000051', '/dcl/fund-account/approve', 'dcl', 'fund-account', 'approve', '审核通过资金账户', 'ENABLED', '2026-08-24 15:23:48.912973+00', NULL, '2026-08-24 15:23:48.912973+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JBOB00000000000000000052', '/dcl/fund-account/audit-history', 'dcl', 'fund-account', 'audit-history', '查看审核记录资金账户', 'ENABLED', '2026-08-24 15:23:48.912973+00', NULL, '2026-08-24 15:23:48.912973+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JBOB00000000000000000053', '/dcl/fund-account/create', 'dcl', 'fund-account', 'create', '创建资金账户', 'ENABLED', '2026-08-24 15:23:48.912973+00', NULL, '2026-08-24 15:23:48.912973+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JBOB00000000000000000055', '/bob/fund-account/get', 'bob', 'fund-account', 'get', '查看资金账户', 'ENABLED', '2026-08-24 15:23:48.912973+00', NULL, '2026-08-24 15:23:48.912973+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JBOB00000000000000000057', '/dcl/fund-account/reject', 'dcl', 'fund-account', 'reject', '审核驳回资金账户', 'ENABLED', '2026-08-24 15:23:48.912973+00', NULL, '2026-08-24 15:23:48.912973+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JBOB00000000000000000058', '/dcl/fund-account/save', 'dcl', 'fund-account', 'save', '保存草稿资金账户', 'ENABLED', '2026-08-24 15:23:48.912973+00', NULL, '2026-08-24 15:23:48.912973+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JBOB00000000000000000059', '/dcl/fund-account/submit', 'dcl', 'fund-account', 'submit', '提交审核资金账户', 'ENABLED', '2026-08-24 15:23:48.912973+00', NULL, '2026-08-24 15:23:48.912973+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JBOB00000000000000000060', '/dcl/fund-account/versions', 'dcl', 'fund-account', 'versions', '查看版本资金账户', 'ENABLED', '2026-08-24 15:23:48.912973+00', NULL, '2026-08-24 15:23:48.912973+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JBOB00000000000000000006', '/bob/customer/query', 'bob', 'customer', 'query', '查询客户', 'ENABLED', '2026-08-24 15:23:48.912973+00', NULL, '2026-08-24 15:23:48.912973+00', NULL, 1, 10);
INSERT INTO public.app_permissions VALUES ('01JBOB00000000000000000026', '/bob/employee/query', 'bob', 'employee', 'query', '查询员工', 'ENABLED', '2026-08-24 15:23:48.912973+00', NULL, '2026-08-24 15:23:48.912973+00', NULL, 1, 30);
INSERT INTO public.app_permissions VALUES ('01JBOB00000000000000000056', '/bob/fund-account/query', 'bob', 'fund-account', 'query', '查询资金账户', 'ENABLED', '2026-08-24 15:23:48.912973+00', NULL, '2026-08-24 15:23:48.912973+00', NULL, 1, 80);
INSERT INTO public.app_permissions VALUES ('01JBOB00000000000000000031', '/dcl/product/approve', 'dcl', 'product', 'approve', '审核通过产品', 'ENABLED', '2026-08-24 15:23:48.912973+00', NULL, '2026-08-24 15:23:48.912973+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JBOB00000000000000000032', '/dcl/product/audit-history', 'dcl', 'product', 'audit-history', '查看审核记录产品', 'ENABLED', '2026-08-24 15:23:48.912973+00', NULL, '2026-08-24 15:23:48.912973+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JBOB00000000000000000033', '/dcl/product/create', 'dcl', 'product', 'create', '创建产品', 'ENABLED', '2026-08-24 15:23:48.912973+00', NULL, '2026-08-24 15:23:48.912973+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JBOB00000000000000000035', '/bob/product/get', 'bob', 'product', 'get', '查看产品', 'ENABLED', '2026-08-24 15:23:48.912973+00', NULL, '2026-08-24 15:23:48.912973+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JBOB00000000000000000037', '/dcl/product/reject', 'dcl', 'product', 'reject', '审核驳回产品', 'ENABLED', '2026-08-24 15:23:48.912973+00', NULL, '2026-08-24 15:23:48.912973+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JBOB00000000000000000038', '/dcl/product/save', 'dcl', 'product', 'save', '保存草稿产品', 'ENABLED', '2026-08-24 15:23:48.912973+00', NULL, '2026-08-24 15:23:48.912973+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JBOB00000000000000000039', '/dcl/product/submit', 'dcl', 'product', 'submit', '提交审核产品', 'ENABLED', '2026-08-24 15:23:48.912973+00', NULL, '2026-08-24 15:23:48.912973+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JBOB00000000000000000040', '/dcl/product/versions', 'dcl', 'product', 'versions', '查看版本产品', 'ENABLED', '2026-08-24 15:23:48.912973+00', NULL, '2026-08-24 15:23:48.912973+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JBOB00000000000000000011', '/dcl/supplier/approve', 'dcl', 'supplier', 'approve', '审核通过供应商声明', 'ENABLED', '2026-08-24 15:23:48.912973+00', NULL, '2026-08-24 15:23:48.912973+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JBOB00000000000000000012', '/dcl/supplier/audit-history', 'dcl', 'supplier', 'audit-history', '查看供应商声明审核记录', 'ENABLED', '2026-08-24 15:23:48.912973+00', NULL, '2026-08-24 15:23:48.912973+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JBOB00000000000000000013', '/dcl/supplier/create', 'dcl', 'supplier', 'create', '创建供应商声明', 'ENABLED', '2026-08-24 15:23:48.912973+00', NULL, '2026-08-24 15:23:48.912973+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JBOB00000000000000000015', '/bob/supplier/get', 'bob', 'supplier', 'get', '查看供应商', 'ENABLED', '2026-08-24 15:23:48.912973+00', NULL, '2026-08-24 15:23:48.912973+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JBOB00000000000000000017', '/dcl/supplier/reject', 'dcl', 'supplier', 'reject', '审核驳回供应商声明', 'ENABLED', '2026-08-24 15:23:48.912973+00', NULL, '2026-08-24 15:23:48.912973+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JBOB00000000000000000018', '/dcl/supplier/save', 'dcl', 'supplier', 'save', '保存供应商声明草稿', 'ENABLED', '2026-08-24 15:23:48.912973+00', NULL, '2026-08-24 15:23:48.912973+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JBOB00000000000000000019', '/dcl/supplier/submit', 'dcl', 'supplier', 'submit', '提交供应商声明审核', 'ENABLED', '2026-08-24 15:23:48.912973+00', NULL, '2026-08-24 15:23:48.912973+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JBOB00000000000000000020', '/dcl/supplier/versions', 'dcl', 'supplier', 'versions', '查看供应商声明版本', 'ENABLED', '2026-08-24 15:23:48.912973+00', NULL, '2026-08-24 15:23:48.912973+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JDCL00000000000000000285', '/dcl/supplier/query', 'dcl', 'supplier', 'query', '查询供应商声明', 'ENABLED', '2026-08-28 00:00:00+00', NULL, '2026-08-28 00:00:00+00', NULL, 1, 20);
INSERT INTO public.app_permissions VALUES ('01JDCL00000000000000000286', '/dcl/supplier/get', 'dcl', 'supplier', 'get', '查看供应商声明', 'ENABLED', '2026-08-28 00:00:00+00', NULL, '2026-08-28 00:00:00+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JDCL00000000000000000287', '/dcl/customer/create', 'dcl', 'customer', 'create', '创建客户声明', 'ENABLED', '2026-08-28 00:00:00+00', NULL, '2026-08-28 00:00:00+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JDCL00000000000000000288', '/dcl/customer/save', 'dcl', 'customer', 'save', '保存客户声明', 'ENABLED', '2026-08-28 00:00:00+00', NULL, '2026-08-28 00:00:00+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JDCL00000000000000000289', '/dcl/customer/submit', 'dcl', 'customer', 'submit', '提交客户声明', 'ENABLED', '2026-08-28 00:00:00+00', NULL, '2026-08-28 00:00:00+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JDCL00000000000000000290', '/dcl/customer/unsubmit', 'dcl', 'customer', 'unsubmit', '撤回客户声明', 'ENABLED', '2026-08-28 00:00:00+00', NULL, '2026-08-28 00:00:00+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JDCL00000000000000000291', '/dcl/customer/reject', 'dcl', 'customer', 'reject', '驳回客户声明', 'ENABLED', '2026-08-28 00:00:00+00', NULL, '2026-08-28 00:00:00+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JDCL00000000000000000292', '/dcl/customer/approve', 'dcl', 'customer', 'approve', '批准客户声明', 'ENABLED', '2026-08-28 00:00:00+00', NULL, '2026-08-28 00:00:00+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JDCL00000000000000000293', '/dcl/customer/unapprove', 'dcl', 'customer', 'unapprove', '反批客户声明', 'ENABLED', '2026-08-28 00:00:00+00', NULL, '2026-08-28 00:00:00+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JDCL00000000000000000294', '/dcl/customer/delete', 'dcl', 'customer', 'delete', '删除客户声明草稿', 'ENABLED', '2026-08-28 00:00:00+00', NULL, '2026-08-28 00:00:00+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JDCL00000000000000000295', '/dcl/customer/query', 'dcl', 'customer', 'query', '查询客户声明', 'ENABLED', '2026-08-28 00:00:00+00', NULL, '2026-08-28 00:00:00+00', NULL, 1, 20);
INSERT INTO public.app_permissions VALUES ('01JDCL00000000000000000296', '/dcl/customer/get', 'dcl', 'customer', 'get', '查看客户声明', 'ENABLED', '2026-08-28 00:00:00+00', NULL, '2026-08-28 00:00:00+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JDCL00000000000000000297', '/dcl/customer/versions', 'dcl', 'customer', 'versions', '查看客户声明版本', 'ENABLED', '2026-08-28 00:00:00+00', NULL, '2026-08-28 00:00:00+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JDCL00000000000000000298', '/dcl/customer/audit-history', 'dcl', 'customer', 'audit-history', '查看客户声明审计', 'ENABLED', '2026-08-28 00:00:00+00', NULL, '2026-08-28 00:00:00+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JDCL00000000000000000299', '/dcl/customer-account/create', 'dcl', 'customer-account', 'create', '创建客户账户声明', 'ENABLED', '2026-08-28 00:00:00+00', NULL, '2026-08-28 00:00:00+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JDCL00000000000000000300', '/dcl/customer-account/save', 'dcl', 'customer-account', 'save', '保存客户账户声明', 'ENABLED', '2026-08-28 00:00:00+00', NULL, '2026-08-28 00:00:00+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JDCL00000000000000000301', '/dcl/customer-account/submit', 'dcl', 'customer-account', 'submit', '提交客户账户声明', 'ENABLED', '2026-08-28 00:00:00+00', NULL, '2026-08-28 00:00:00+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JDCL00000000000000000302', '/dcl/customer-account/unsubmit', 'dcl', 'customer-account', 'unsubmit', '撤回客户账户声明', 'ENABLED', '2026-08-28 00:00:00+00', NULL, '2026-08-28 00:00:00+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JDCL00000000000000000303', '/dcl/customer-account/reject', 'dcl', 'customer-account', 'reject', '驳回客户账户声明', 'ENABLED', '2026-08-28 00:00:00+00', NULL, '2026-08-28 00:00:00+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JDCL00000000000000000304', '/dcl/customer-account/approve', 'dcl', 'customer-account', 'approve', '批准客户账户声明', 'ENABLED', '2026-08-28 00:00:00+00', NULL, '2026-08-28 00:00:00+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JDCL00000000000000000305', '/dcl/customer-account/unapprove', 'dcl', 'customer-account', 'unapprove', '反批客户账户声明', 'ENABLED', '2026-08-28 00:00:00+00', NULL, '2026-08-28 00:00:00+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JDCL00000000000000000306', '/dcl/customer-account/delete', 'dcl', 'customer-account', 'delete', '删除客户账户声明草稿', 'ENABLED', '2026-08-28 00:00:00+00', NULL, '2026-08-28 00:00:00+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JDCL00000000000000000307', '/dcl/customer-account/query', 'dcl', 'customer-account', 'query', '查询客户账户声明', 'ENABLED', '2026-08-28 00:00:00+00', NULL, '2026-08-28 00:00:00+00', NULL, 1, 20);
INSERT INTO public.app_permissions VALUES ('01JDCL00000000000000000308', '/dcl/customer-account/get', 'dcl', 'customer-account', 'get', '查看客户账户声明', 'ENABLED', '2026-08-28 00:00:00+00', NULL, '2026-08-28 00:00:00+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JDCL00000000000000000309', '/dcl/customer-account/versions', 'dcl', 'customer-account', 'versions', '查看客户账户声明版本', 'ENABLED', '2026-08-28 00:00:00+00', NULL, '2026-08-28 00:00:00+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JDCL00000000000000000310', '/dcl/customer-account/audit-history', 'dcl', 'customer-account', 'audit-history', '查看客户账户声明审计', 'ENABLED', '2026-08-28 00:00:00+00', NULL, '2026-08-28 00:00:00+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JDCL00000000000000000311', '/dcl/customer/attachment-initiate', 'dcl', 'customer', 'attachment-initiate', '上传客户声明附件', 'ENABLED', '2026-08-28 00:00:00+00', NULL, '2026-08-28 00:00:00+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JDCL00000000000000000312', '/dcl/customer/attachment-download', 'dcl', 'customer', 'attachment-download', '下载客户声明附件', 'ENABLED', '2026-08-28 00:00:00+00', NULL, '2026-08-28 00:00:00+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JDCL00000000000000000313', '/dcl/customer/attachment-remove', 'dcl', 'customer', 'attachment-remove', '移除客户声明附件', 'ENABLED', '2026-08-28 00:00:00+00', NULL, '2026-08-28 00:00:00+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JBOB00000000000000000061', '/dcl/warehouse/approve', 'dcl', 'warehouse', 'approve', '审核通过仓库声明', 'ENABLED', '2026-08-24 15:23:48.940595+00', NULL, '2026-08-24 15:23:48.940595+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JBOB00000000000000000062', '/dcl/warehouse/audit-history', 'dcl', 'warehouse', 'audit-history', '查看仓库声明审核记录', 'ENABLED', '2026-08-24 15:23:48.940595+00', NULL, '2026-08-24 15:23:48.940595+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JBOB00000000000000000063', '/dcl/warehouse/create', 'dcl', 'warehouse', 'create', '创建仓库声明', 'ENABLED', '2026-08-24 15:23:48.940595+00', NULL, '2026-08-24 15:23:48.940595+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JBOB00000000000000000065', '/bob/warehouse/get', 'bob', 'warehouse', 'get', '查看仓库', 'ENABLED', '2026-08-24 15:23:48.940595+00', NULL, '2026-08-24 15:23:48.940595+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JBOB00000000000000000067', '/dcl/warehouse/reject', 'dcl', 'warehouse', 'reject', '审核驳回仓库声明', 'ENABLED', '2026-08-24 15:23:48.940595+00', NULL, '2026-08-24 15:23:48.940595+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JBOB00000000000000000068', '/dcl/warehouse/save', 'dcl', 'warehouse', 'save', '保存仓库声明草稿', 'ENABLED', '2026-08-24 15:23:48.940595+00', NULL, '2026-08-24 15:23:48.940595+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JBOB00000000000000000069', '/dcl/warehouse/submit', 'dcl', 'warehouse', 'submit', '提交仓库声明审核', 'ENABLED', '2026-08-24 15:23:48.940595+00', NULL, '2026-08-24 15:23:48.940595+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JBOB00000000000000000070', '/dcl/warehouse/versions', 'dcl', 'warehouse', 'versions', '查看仓库声明版本', 'ENABLED', '2026-08-24 15:23:48.940595+00', NULL, '2026-08-24 15:23:48.940595+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JBOB00000000000000000071', '/dcl/vehicle/approve', 'dcl', 'vehicle', 'approve', '审核通过车辆声明', 'ENABLED', '2026-08-24 15:23:48.948237+00', NULL, '2026-08-24 15:23:48.948237+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JBOB00000000000000000072', '/dcl/vehicle/audit-history', 'dcl', 'vehicle', 'audit-history', '查看车辆声明审核记录', 'ENABLED', '2026-08-24 15:23:48.948237+00', NULL, '2026-08-24 15:23:48.948237+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JBOB00000000000000000073', '/dcl/vehicle/create', 'dcl', 'vehicle', 'create', '创建车辆声明', 'ENABLED', '2026-08-24 15:23:48.948237+00', NULL, '2026-08-24 15:23:48.948237+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JBOB00000000000000000075', '/bob/vehicle/get', 'bob', 'vehicle', 'get', '查看车辆', 'ENABLED', '2026-08-24 15:23:48.948237+00', NULL, '2026-08-24 15:23:48.948237+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JBOB00000000000000000077', '/dcl/vehicle/reject', 'dcl', 'vehicle', 'reject', '审核驳回车辆声明', 'ENABLED', '2026-08-24 15:23:48.948237+00', NULL, '2026-08-24 15:23:48.948237+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JBOB00000000000000000078', '/dcl/vehicle/save', 'dcl', 'vehicle', 'save', '保存车辆声明草稿', 'ENABLED', '2026-08-24 15:23:48.948237+00', NULL, '2026-08-24 15:23:48.948237+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JBOB00000000000000000079', '/dcl/vehicle/submit', 'dcl', 'vehicle', 'submit', '提交车辆声明审核', 'ENABLED', '2026-08-24 15:23:48.948237+00', NULL, '2026-08-24 15:23:48.948237+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JBOB00000000000000000080', '/dcl/vehicle/versions', 'dcl', 'vehicle', 'versions', '查看车辆声明版本', 'ENABLED', '2026-08-24 15:23:48.948237+00', NULL, '2026-08-24 15:23:48.948237+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JBOB00000000000000000016', '/bob/supplier/query', 'bob', 'supplier', 'query', '查询供应商', 'ENABLED', '2026-08-24 15:23:48.912973+00', NULL, '2026-08-24 15:23:48.912973+00', NULL, 1, 20);
INSERT INTO public.app_permissions VALUES ('01JBOB00000000000000000036', '/bob/product/query', 'bob', 'product', 'query', '查询产品', 'ENABLED', '2026-08-24 15:23:48.912973+00', NULL, '2026-08-24 15:23:48.912973+00', NULL, 1, 40);
INSERT INTO public.app_permissions VALUES ('01JBOB00000000000000000066', '/bob/warehouse/query', 'bob', 'warehouse', 'query', '查询仓库', 'ENABLED', '2026-08-24 15:23:48.940595+00', NULL, '2026-08-24 15:23:48.940595+00', NULL, 1, 60);
INSERT INTO public.app_permissions VALUES ('01JBOB00000000000000000076', '/bob/vehicle/query', 'bob', 'vehicle', 'query', '查询车辆', 'ENABLED', '2026-08-24 15:23:48.948237+00', NULL, '2026-08-24 15:23:48.948237+00', NULL, 1, 70);
INSERT INTO public.app_permissions VALUES ('01JBOB00000000000000000082', '/dcl/supplier/delete', 'dcl', 'supplier', 'delete', '删除首版草稿供应商声明', 'ENABLED', '2026-08-24 15:23:48.99178+00', NULL, '2026-08-24 15:23:48.99178+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JBOB00000000000000000083', '/dcl/employee/delete', 'dcl', 'employee', 'delete', '删除首版员工声明草稿', 'ENABLED', '2026-08-24 15:23:48.99178+00', NULL, '2026-08-24 15:23:48.99178+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JBOB00000000000000000084', '/dcl/product/delete', 'dcl', 'product', 'delete', '删除首版草稿产品', 'ENABLED', '2026-08-24 15:23:48.99178+00', NULL, '2026-08-24 15:23:48.99178+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JBOB00000000000000000086', '/dcl/warehouse/delete', 'dcl', 'warehouse', 'delete', '删除首版仓库声明草稿', 'ENABLED', '2026-08-24 15:23:48.99178+00', NULL, '2026-08-24 15:23:48.99178+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JBOB00000000000000000087', '/dcl/vehicle/delete', 'dcl', 'vehicle', 'delete', '删除首版车辆声明草稿', 'ENABLED', '2026-08-24 15:23:48.99178+00', NULL, '2026-08-24 15:23:48.99178+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JBOB00000000000000000088', '/dcl/fund-account/delete', 'dcl', 'fund-account', 'delete', '删除首版草稿资金账户', 'ENABLED', '2026-08-24 15:23:48.99178+00', NULL, '2026-08-24 15:23:48.99178+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JVOU00000000000000000101', '/vou/sale-outbound/get', 'vou', 'sale-outbound', 'get', '查看销售出库', 'ENABLED', '2026-08-24 15:23:49.226715+00', NULL, '2026-08-24 15:23:49.226715+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JVOU00000000000000000116', '/vou/sale-delivery/get', 'vou', 'sale-delivery', 'get', '查看销售送货', 'ENABLED', '2026-08-24 15:23:49.226715+00', NULL, '2026-08-24 15:23:49.226715+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JVOU00000000000000000131', '/vou/sale-signoff/get', 'vou', 'sale-signoff', 'get', '查看销售签收', 'ENABLED', '2026-08-24 15:23:49.226715+00', NULL, '2026-08-24 15:23:49.226715+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('VI38cb6fc3c9401f69a085c96e', '/vou/purchase-inbound/get', 'vou', 'purchase-inbound', 'get', '查看采购入库', 'ENABLED', '2026-08-24 15:23:49.271068+00', NULL, '2026-08-24 15:23:49.271068+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01CEF1C502071A43F66819A1A9', '/vou/purchase-order/create', 'vou', 'purchase-order', 'create', '创建采购订单', 'ENABLED', '2026-08-24 15:23:49.29388+00', NULL, '2026-08-24 15:23:49.29388+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JVOU00000000000000000103', '/vou/sale-outbound/save', 'vou', 'sale-outbound', 'save', '保存销售出库', 'ENABLED', '2026-08-24 15:23:49.226715+00', NULL, '2026-08-24 15:23:49.226715+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JVOU00000000000000000118', '/vou/sale-delivery/save', 'vou', 'sale-delivery', 'save', '保存销售送货', 'ENABLED', '2026-08-24 15:23:49.226715+00', NULL, '2026-08-24 15:23:49.226715+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JVOU00000000000000000133', '/vou/sale-signoff/save', 'vou', 'sale-signoff', 'save', '保存销售签收', 'ENABLED', '2026-08-24 15:23:49.226715+00', NULL, '2026-08-24 15:23:49.226715+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('0195F3F40C902891D0DEA0C9CD', '/vou/purchase-order/save', 'vou', 'purchase-order', 'save', '保存采购订单', 'ENABLED', '2026-08-24 15:23:49.29388+00', NULL, '2026-08-24 15:23:49.29388+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('017DEAA463D7E35F6C0654AD4C', '/vou/purchase-inbound/save', 'vou', 'purchase-inbound', 'save', '保存采购入库', 'ENABLED', '2026-08-24 15:23:49.29388+00', NULL, '2026-08-24 15:23:49.29388+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JVOU00000000000000000074', '/vou/expense-reimbursement/save', 'vou', 'expense-reimbursement', 'save', '保存费用报销', 'ENABLED', '2026-08-24 15:23:48.959532+00', NULL, '2026-08-24 15:23:48.959532+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JVOU00000000000000000088', '/vou/other-income/save', 'vou', 'other-income', 'save', '保存其他收入', 'ENABLED', '2026-08-24 15:23:48.959532+00', NULL, '2026-08-24 15:23:48.959532+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('014A6975F3E7CC0AE5AB54E323', '/vou/sale-order/delete', 'vou', 'sale-order', 'delete', '删除草稿销售订单', 'ENABLED', '2026-08-24 15:23:49.29388+00', NULL, '2026-08-24 15:23:49.29388+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JVOU00000000000000000114', '/vou/sale-outbound/delete', 'vou', 'sale-outbound', 'delete', '删除草稿销售出库', 'ENABLED', '2026-08-24 15:23:49.226715+00', NULL, '2026-08-24 15:23:49.226715+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JVOU00000000000000000129', '/vou/sale-delivery/delete', 'vou', 'sale-delivery', 'delete', '删除草稿销售送货', 'ENABLED', '2026-08-24 15:23:49.226715+00', NULL, '2026-08-24 15:23:49.226715+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JVOU00000000000000000144', '/vou/sale-signoff/delete', 'vou', 'sale-signoff', 'delete', '删除草稿销售签收', 'ENABLED', '2026-08-24 15:23:49.226715+00', NULL, '2026-08-24 15:23:49.226715+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01EED8E19FAA60F6384E7483D4', '/vou/purchase-order/delete', 'vou', 'purchase-order', 'delete', '删除草稿采购订单', 'ENABLED', '2026-08-24 15:23:49.29388+00', NULL, '2026-08-24 15:23:49.29388+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01B0755E22254AFA047D3FFBA3', '/vou/purchase-inbound/delete', 'vou', 'purchase-inbound', 'delete', '删除草稿采购入库', 'ENABLED', '2026-08-24 15:23:49.29388+00', NULL, '2026-08-24 15:23:49.29388+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JVOU00000000000000000001', '/vou/sale-order/query', 'vou', 'sale-order', 'query', '查询销售订单', 'ENABLED', '2026-08-24 15:23:48.959532+00', NULL, '2026-08-24 15:23:48.959532+00', NULL, 1, 10);
INSERT INTO public.app_permissions VALUES ('01JVOU00000000000000000100', '/vou/sale-outbound/query', 'vou', 'sale-outbound', 'query', '查询销售出库', 'ENABLED', '2026-08-24 15:23:49.226715+00', NULL, '2026-08-24 15:23:49.226715+00', NULL, 1, 20);
INSERT INTO public.app_permissions VALUES ('01JVOU00000000000000000115', '/vou/sale-delivery/query', 'vou', 'sale-delivery', 'query', '查询销售送货', 'ENABLED', '2026-08-24 15:23:49.226715+00', NULL, '2026-08-24 15:23:49.226715+00', NULL, 1, 30);
INSERT INTO public.app_permissions VALUES ('01JVOU00000000000000000130', '/vou/sale-signoff/query', 'vou', 'sale-signoff', 'query', '查询销售签收', 'ENABLED', '2026-08-24 15:23:49.226715+00', NULL, '2026-08-24 15:23:49.226715+00', NULL, 1, 40);
INSERT INTO public.app_permissions VALUES ('01JVOU00000000000000000015', '/vou/purchase-order/query', 'vou', 'purchase-order', 'query', '查询采购订单', 'ENABLED', '2026-08-24 15:23:48.959532+00', NULL, '2026-08-24 15:23:48.959532+00', NULL, 1, 60);
INSERT INTO public.app_permissions VALUES ('VI11596452ba9fcf5681378779', '/vou/purchase-inbound/query', 'vou', 'purchase-inbound', 'query', '查询采购入库', 'ENABLED', '2026-08-24 15:23:49.271068+00', NULL, '2026-08-24 15:23:49.271068+00', NULL, 1, 70);
INSERT INTO public.app_permissions VALUES ('018942C078FF73D2116AAF37DB', '/vou/expense-reimbursement/delete', 'vou', 'expense-reimbursement', 'delete', '删除草稿费用报销', 'ENABLED', '2026-08-24 15:23:49.29388+00', NULL, '2026-08-24 15:23:49.29388+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('017F2CBB1F173D9CCF0784173A', '/vou/other-income/delete', 'vou', 'other-income', 'delete', '删除草稿其他收入', 'ENABLED', '2026-08-24 15:23:49.29388+00', NULL, '2026-08-24 15:23:49.29388+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JVOU00000000000000000005', '/vou/sale-order/submit', 'vou', 'sale-order', 'submit', '提交销售订单', 'ENABLED', '2026-08-24 15:23:48.959532+00', NULL, '2026-08-24 15:23:48.959532+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JVOU00000000000000000104', '/vou/sale-outbound/submit', 'vou', 'sale-outbound', 'submit', '提交销售出库', 'ENABLED', '2026-08-24 15:23:49.226715+00', NULL, '2026-08-24 15:23:49.226715+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JVOU00000000000000000119', '/vou/sale-delivery/submit', 'vou', 'sale-delivery', 'submit', '提交销售送货', 'ENABLED', '2026-08-24 15:23:49.226715+00', NULL, '2026-08-24 15:23:49.226715+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JVOU00000000000000000134', '/vou/sale-signoff/submit', 'vou', 'sale-signoff', 'submit', '提交销售签收', 'ENABLED', '2026-08-24 15:23:49.226715+00', NULL, '2026-08-24 15:23:49.226715+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01292F5F8B1FA77933B8CE6CC8', '/vou/purchase-order/submit', 'vou', 'purchase-order', 'submit', '提交采购订单', 'ENABLED', '2026-08-24 15:23:49.29388+00', NULL, '2026-08-24 15:23:49.29388+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01CD9A7B21FD613A09709E5A1C', '/vou/purchase-inbound/submit', 'vou', 'purchase-inbound', 'submit', '提交采购入库', 'ENABLED', '2026-08-24 15:23:49.29388+00', NULL, '2026-08-24 15:23:49.29388+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JVOU00000000000000000075', '/vou/expense-reimbursement/submit', 'vou', 'expense-reimbursement', 'submit', '提交费用报销', 'ENABLED', '2026-08-24 15:23:48.959532+00', NULL, '2026-08-24 15:23:48.959532+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JVOU00000000000000000089', '/vou/other-income/submit', 'vou', 'other-income', 'submit', '提交其他收入', 'ENABLED', '2026-08-24 15:23:48.959532+00', NULL, '2026-08-24 15:23:48.959532+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JVOU00000000000000000006', '/vou/sale-order/unsubmit', 'vou', 'sale-order', 'unsubmit', '撤销提交销售订单', 'ENABLED', '2026-08-24 15:23:48.959532+00', NULL, '2026-08-24 15:23:48.959532+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JVOU00000000000000000105', '/vou/sale-outbound/unsubmit', 'vou', 'sale-outbound', 'unsubmit', '撤销提交销售出库', 'ENABLED', '2026-08-24 15:23:49.226715+00', NULL, '2026-08-24 15:23:49.226715+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JVOU00000000000000000120', '/vou/sale-delivery/unsubmit', 'vou', 'sale-delivery', 'unsubmit', '撤销提交销售送货', 'ENABLED', '2026-08-24 15:23:49.226715+00', NULL, '2026-08-24 15:23:49.226715+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JVOU00000000000000000135', '/vou/sale-signoff/unsubmit', 'vou', 'sale-signoff', 'unsubmit', '撤销提交销售签收', 'ENABLED', '2026-08-24 15:23:49.226715+00', NULL, '2026-08-24 15:23:49.226715+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('0146FE50B2D6000DFF4272DA0E', '/vou/purchase-order/unsubmit', 'vou', 'purchase-order', 'unsubmit', '撤销提交采购订单', 'ENABLED', '2026-08-24 15:23:49.29388+00', NULL, '2026-08-24 15:23:49.29388+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01327AFEC8544172B16AD95C6B', '/vou/purchase-inbound/unsubmit', 'vou', 'purchase-inbound', 'unsubmit', '撤销提交采购入库', 'ENABLED', '2026-08-24 15:23:49.29388+00', NULL, '2026-08-24 15:23:49.29388+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JVOU00000000000000000076', '/vou/expense-reimbursement/unsubmit', 'vou', 'expense-reimbursement', 'unsubmit', '撤销提交费用报销', 'ENABLED', '2026-08-24 15:23:48.959532+00', NULL, '2026-08-24 15:23:48.959532+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JVOU00000000000000000090', '/vou/other-income/unsubmit', 'vou', 'other-income', 'unsubmit', '撤销提交其他收入', 'ENABLED', '2026-08-24 15:23:48.959532+00', NULL, '2026-08-24 15:23:48.959532+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JVOU00000000000000000007', '/vou/sale-order/approve', 'vou', 'sale-order', 'approve', '批准销售订单', 'ENABLED', '2026-08-24 15:23:48.959532+00', NULL, '2026-08-24 15:23:48.959532+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JVOU00000000000000000106', '/vou/sale-outbound/approve', 'vou', 'sale-outbound', 'approve', '批准销售出库', 'ENABLED', '2026-08-24 15:23:49.226715+00', NULL, '2026-08-24 15:23:49.226715+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JVOU00000000000000000121', '/vou/sale-delivery/approve', 'vou', 'sale-delivery', 'approve', '批准销售送货', 'ENABLED', '2026-08-24 15:23:49.226715+00', NULL, '2026-08-24 15:23:49.226715+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JVOU00000000000000000136', '/vou/sale-signoff/approve', 'vou', 'sale-signoff', 'approve', '批准销售签收', 'ENABLED', '2026-08-24 15:23:49.226715+00', NULL, '2026-08-24 15:23:49.226715+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('019149CEC41AAE6F74B33DA457', '/vou/purchase-order/approve', 'vou', 'purchase-order', 'approve', '批准采购订单', 'ENABLED', '2026-08-24 15:23:49.29388+00', NULL, '2026-08-24 15:23:49.29388+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('010EB48E787DFCE5F9F4A25153', '/vou/purchase-inbound/approve', 'vou', 'purchase-inbound', 'approve', '批准采购入库', 'ENABLED', '2026-08-24 15:23:49.29388+00', NULL, '2026-08-24 15:23:49.29388+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JVOU00000000000000000077', '/vou/expense-reimbursement/approve', 'vou', 'expense-reimbursement', 'approve', '批准费用报销', 'ENABLED', '2026-08-24 15:23:48.959532+00', NULL, '2026-08-24 15:23:48.959532+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JVOU00000000000000000091', '/vou/other-income/approve', 'vou', 'other-income', 'approve', '批准其他收入', 'ENABLED', '2026-08-24 15:23:48.959532+00', NULL, '2026-08-24 15:23:48.959532+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JVOU00000000000000000008', '/vou/sale-order/unapprove', 'vou', 'sale-order', 'unapprove', '反批准销售订单', 'ENABLED', '2026-08-24 15:23:48.959532+00', NULL, '2026-08-24 15:23:48.959532+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JVOU00000000000000000107', '/vou/sale-outbound/unapprove', 'vou', 'sale-outbound', 'unapprove', '反批准销售出库', 'ENABLED', '2026-08-24 15:23:49.226715+00', NULL, '2026-08-24 15:23:49.226715+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JVOU00000000000000000122', '/vou/sale-delivery/unapprove', 'vou', 'sale-delivery', 'unapprove', '反批准销售送货', 'ENABLED', '2026-08-24 15:23:49.226715+00', NULL, '2026-08-24 15:23:49.226715+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JVOU00000000000000000137', '/vou/sale-signoff/unapprove', 'vou', 'sale-signoff', 'unapprove', '反批准销售签收', 'ENABLED', '2026-08-24 15:23:49.226715+00', NULL, '2026-08-24 15:23:49.226715+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01342D830F03D07F0AAF31024D', '/vou/purchase-order/unapprove', 'vou', 'purchase-order', 'unapprove', '反批准采购订单', 'ENABLED', '2026-08-24 15:23:49.29388+00', NULL, '2026-08-24 15:23:49.29388+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('0199CB0C1546B90978020023AA', '/vou/purchase-inbound/unapprove', 'vou', 'purchase-inbound', 'unapprove', '反批准采购入库', 'ENABLED', '2026-08-24 15:23:49.29388+00', NULL, '2026-08-24 15:23:49.29388+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JVOU00000000000000000110', '/vou/sale-outbound/audit-history', 'vou', 'sale-outbound', 'audit-history', '查看审计销售出库', 'ENABLED', '2026-08-24 15:23:49.226715+00', NULL, '2026-08-24 15:23:49.226715+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JVOU00000000000000000125', '/vou/sale-delivery/audit-history', 'vou', 'sale-delivery', 'audit-history', '查看审计销售送货', 'ENABLED', '2026-08-24 15:23:49.226715+00', NULL, '2026-08-24 15:23:49.226715+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JVOU00000000000000000140', '/vou/sale-signoff/audit-history', 'vou', 'sale-signoff', 'audit-history', '查看审计销售签收', 'ENABLED', '2026-08-24 15:23:49.226715+00', NULL, '2026-08-24 15:23:49.226715+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('VIe06a2b3afca730c3f5a073b5', '/vou/purchase-inbound/audit-history', 'vou', 'purchase-inbound', 'audit-history', '查看审计采购入库', 'ENABLED', '2026-08-24 15:23:49.271068+00', NULL, '2026-08-24 15:23:49.271068+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JVOU00000000000000000111', '/vou/sale-outbound/attachment-initiate', 'vou', 'sale-outbound', 'attachment-initiate', '发起附件上传销售出库', 'ENABLED', '2026-08-24 15:23:49.226715+00', NULL, '2026-08-24 15:23:49.226715+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JVOU00000000000000000126', '/vou/sale-delivery/attachment-initiate', 'vou', 'sale-delivery', 'attachment-initiate', '发起附件上传销售送货', 'ENABLED', '2026-08-24 15:23:49.226715+00', NULL, '2026-08-24 15:23:49.226715+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JVOU00000000000000000141', '/vou/sale-signoff/attachment-initiate', 'vou', 'sale-signoff', 'attachment-initiate', '发起附件上传销售签收', 'ENABLED', '2026-08-24 15:23:49.226715+00', NULL, '2026-08-24 15:23:49.226715+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01CB5B5DF8C7149F9E916754D1', '/vou/purchase-order/attachment-initiate', 'vou', 'purchase-order', 'attachment-initiate', '发起附件上传采购订单', 'ENABLED', '2026-08-24 15:23:49.29388+00', NULL, '2026-08-24 15:23:49.29388+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01B70A898C3236A8DB63660FB9', '/vou/purchase-inbound/attachment-initiate', 'vou', 'purchase-inbound', 'attachment-initiate', '发起附件上传采购入库', 'ENABLED', '2026-08-24 15:23:49.29388+00', NULL, '2026-08-24 15:23:49.29388+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JVOU00000000000000000082', '/vou/expense-reimbursement/attachment-initiate', 'vou', 'expense-reimbursement', 'attachment-initiate', '发起附件上传费用报销', 'ENABLED', '2026-08-24 15:23:48.959532+00', NULL, '2026-08-24 15:23:48.959532+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JVOU00000000000000000096', '/vou/other-income/attachment-initiate', 'vou', 'other-income', 'attachment-initiate', '发起附件上传其他收入', 'ENABLED', '2026-08-24 15:23:48.959532+00', NULL, '2026-08-24 15:23:48.959532+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JVOU00000000000000000013', '/vou/sale-order/attachment-download', 'vou', 'sale-order', 'attachment-download', '下载附件销售订单', 'ENABLED', '2026-08-24 15:23:48.959532+00', NULL, '2026-08-24 15:23:48.959532+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JVOU00000000000000000112', '/vou/sale-outbound/attachment-download', 'vou', 'sale-outbound', 'attachment-download', '下载附件销售出库', 'ENABLED', '2026-08-24 15:23:49.226715+00', NULL, '2026-08-24 15:23:49.226715+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JVOU00000000000000000127', '/vou/sale-delivery/attachment-download', 'vou', 'sale-delivery', 'attachment-download', '下载附件销售送货', 'ENABLED', '2026-08-24 15:23:49.226715+00', NULL, '2026-08-24 15:23:49.226715+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JVOU00000000000000000142', '/vou/sale-signoff/attachment-download', 'vou', 'sale-signoff', 'attachment-download', '下载附件销售签收', 'ENABLED', '2026-08-24 15:23:49.226715+00', NULL, '2026-08-24 15:23:49.226715+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JVOU00000000000000000027', '/vou/purchase-order/attachment-download', 'vou', 'purchase-order', 'attachment-download', '下载附件采购订单', 'ENABLED', '2026-08-24 15:23:48.959532+00', NULL, '2026-08-24 15:23:48.959532+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('VI1e30868772d8346533eaeed4', '/vou/purchase-inbound/attachment-download', 'vou', 'purchase-inbound', 'attachment-download', '下载附件采购入库', 'ENABLED', '2026-08-24 15:23:49.271068+00', NULL, '2026-08-24 15:23:49.271068+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JVOU00000000000000000083', '/vou/expense-reimbursement/attachment-download', 'vou', 'expense-reimbursement', 'attachment-download', '下载附件费用报销', 'ENABLED', '2026-08-24 15:23:48.959532+00', NULL, '2026-08-24 15:23:48.959532+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JVOU00000000000000000097', '/vou/other-income/attachment-download', 'vou', 'other-income', 'attachment-download', '下载附件其他收入', 'ENABLED', '2026-08-24 15:23:48.959532+00', NULL, '2026-08-24 15:23:48.959532+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JVOU00000000000000000014', '/vou/sale-order/attachment-remove', 'vou', 'sale-order', 'attachment-remove', '移除附件销售订单', 'ENABLED', '2026-08-24 15:23:48.959532+00', NULL, '2026-08-24 15:23:48.959532+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JVOU00000000000000000113', '/vou/sale-outbound/attachment-remove', 'vou', 'sale-outbound', 'attachment-remove', '移除附件销售出库', 'ENABLED', '2026-08-24 15:23:49.226715+00', NULL, '2026-08-24 15:23:49.226715+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JVOU00000000000000000128', '/vou/sale-delivery/attachment-remove', 'vou', 'sale-delivery', 'attachment-remove', '移除附件销售送货', 'ENABLED', '2026-08-24 15:23:49.226715+00', NULL, '2026-08-24 15:23:49.226715+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JVOU00000000000000000143', '/vou/sale-signoff/attachment-remove', 'vou', 'sale-signoff', 'attachment-remove', '移除附件销售签收', 'ENABLED', '2026-08-24 15:23:49.226715+00', NULL, '2026-08-24 15:23:49.226715+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01A0EBEF17996DDEF1123DF7D4', '/vou/purchase-order/attachment-remove', 'vou', 'purchase-order', 'attachment-remove', '移除附件采购订单', 'ENABLED', '2026-08-24 15:23:49.29388+00', NULL, '2026-08-24 15:23:49.29388+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('011D67C86BD1ECDB4C9FBEE7AF', '/vou/purchase-inbound/attachment-remove', 'vou', 'purchase-inbound', 'attachment-remove', '移除附件采购入库', 'ENABLED', '2026-08-24 15:23:49.29388+00', NULL, '2026-08-24 15:23:49.29388+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JACC00000000000000000106', '/acc/opening/query', 'acc', 'opening', 'query', '查看账簿期初', 'ENABLED', '2026-08-24 15:23:49.781829+00', NULL, '2026-08-24 15:23:49.781829+00', NULL, 1, 30);
INSERT INTO public.app_permissions VALUES ('01JACC00000000000000000107', '/acc/opening/save', 'acc', 'opening', 'save', '保存账簿期初', 'ENABLED', '2026-08-24 15:23:49.781829+00', NULL, '2026-08-24 15:23:49.781829+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JACC00000000000000000108', '/acc/opening/approve', 'acc', 'opening', 'approve', '批准账簿期初', 'ENABLED', '2026-08-24 15:23:49.781829+00', NULL, '2026-08-24 15:23:49.781829+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JACC00000000000000000109', '/acc/opening/unapprove', 'acc', 'opening', 'unapprove', '反批准账簿期初', 'ENABLED', '2026-08-24 15:23:49.781829+00', NULL, '2026-08-24 15:23:49.781829+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JACC00000000000000000201', '/acc/opening/submit', 'acc', 'opening', 'submit', '提交账簿期初', 'ENABLED', '2026-08-24 15:23:49.781829+00', NULL, '2026-08-24 15:23:49.781829+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JACC00000000000000000202', '/acc/opening/unsubmit', 'acc', 'opening', 'unsubmit', '撤回账簿期初', 'ENABLED', '2026-08-24 15:23:49.781829+00', NULL, '2026-08-24 15:23:49.781829+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JACC00000000000000000203', '/acc/opening/reject', 'acc', 'opening', 'reject', '驳回账簿期初', 'ENABLED', '2026-08-24 15:23:49.781829+00', NULL, '2026-08-24 15:23:49.781829+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JACC00000000000000000204', '/acc/opening/create', 'acc', 'opening', 'create', '建立账簿期初审批', 'ENABLED', '2026-08-24 15:23:49.781829+00', NULL, '2026-08-24 15:23:49.781829+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JACC00000000000000000110', '/acc/mapping/query', 'acc', 'mapping', 'query', '查询当前会计映射', 'ENABLED', '2026-08-24 15:23:49.791438+00', NULL, '2026-08-24 15:23:49.791438+00', NULL, 1, 40);
INSERT INTO public.app_permissions VALUES ('01JACC00000000000000000111', '/acc/mapping/get', 'acc', 'mapping', 'get', '查看当前会计映射', 'ENABLED', '2026-08-24 15:23:49.791438+00', NULL, '2026-08-24 15:23:49.791438+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JACC00000000000000000112', '/dcl/acc-mapping/create', 'dcl', 'acc-mapping', 'create', '创建会计映射声明', 'ENABLED', '2026-08-24 15:23:49.791438+00', NULL, '2026-08-24 15:23:49.791438+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JVOU00000000000000000084', '/vou/expense-reimbursement/attachment-remove', 'vou', 'expense-reimbursement', 'attachment-remove', '移除附件费用报销', 'ENABLED', '2026-08-24 15:23:48.959532+00', NULL, '2026-08-24 15:23:48.959532+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JVOU00000000000000000098', '/vou/other-income/attachment-remove', 'vou', 'other-income', 'attachment-remove', '移除附件其他收入', 'ENABLED', '2026-08-24 15:23:48.959532+00', NULL, '2026-08-24 15:23:48.959532+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JAUX00000000000000000022', '/aux/product-category/get', 'aux', 'product-category', 'get', '查看产品分类', 'ENABLED', '2026-08-24 15:23:49.336221+00', NULL, '2026-08-24 15:23:49.336221+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JAUX00000000000000000023', '/aux/product-category/create', 'aux', 'product-category', 'create', '创建产品分类', 'ENABLED', '2026-08-24 15:23:49.336221+00', NULL, '2026-08-24 15:23:49.336221+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JAUX00000000000000000024', '/aux/product-category/save', 'aux', 'product-category', 'save', '保存产品分类', 'ENABLED', '2026-08-24 15:23:49.336221+00', NULL, '2026-08-24 15:23:49.336221+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JAUX00000000000000000025', '/aux/product-category/enable', 'aux', 'product-category', 'enable', '启用产品分类', 'ENABLED', '2026-08-24 15:23:49.336221+00', NULL, '2026-08-24 15:23:49.336221+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JAUX00000000000000000026', '/aux/product-category/disable', 'aux', 'product-category', 'disable', '停用产品分类', 'ENABLED', '2026-08-24 15:23:49.336221+00', NULL, '2026-08-24 15:23:49.336221+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JAUX00000000000000000027', '/aux/product-category/delete', 'aux', 'product-category', 'delete', '删除产品分类', 'ENABLED', '2026-08-24 15:23:49.336221+00', NULL, '2026-08-24 15:23:49.336221+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JAUX00000000000000000042', '/aux/department/get', 'aux', 'department', 'get', '查看部门', 'ENABLED', '2026-08-24 15:23:49.336221+00', NULL, '2026-08-24 15:23:49.336221+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JAUX00000000000000000043', '/aux/department/create', 'aux', 'department', 'create', '创建部门', 'ENABLED', '2026-08-24 15:23:49.336221+00', NULL, '2026-08-24 15:23:49.336221+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JAUX00000000000000000044', '/aux/department/save', 'aux', 'department', 'save', '保存部门', 'ENABLED', '2026-08-24 15:23:49.336221+00', NULL, '2026-08-24 15:23:49.336221+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JAUX00000000000000000045', '/aux/department/enable', 'aux', 'department', 'enable', '启用部门', 'ENABLED', '2026-08-24 15:23:49.336221+00', NULL, '2026-08-24 15:23:49.336221+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JAUX00000000000000000046', '/aux/department/disable', 'aux', 'department', 'disable', '停用部门', 'ENABLED', '2026-08-24 15:23:49.336221+00', NULL, '2026-08-24 15:23:49.336221+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JAUX00000000000000000047', '/aux/department/delete', 'aux', 'department', 'delete', '删除部门', 'ENABLED', '2026-08-24 15:23:49.336221+00', NULL, '2026-08-24 15:23:49.336221+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JAUX00000000000000000062', '/aux/position/get', 'aux', 'position', 'get', '查看岗位', 'ENABLED', '2026-08-24 15:23:49.336221+00', NULL, '2026-08-24 15:23:49.336221+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JAUX00000000000000000063', '/aux/position/create', 'aux', 'position', 'create', '创建岗位', 'ENABLED', '2026-08-24 15:23:49.336221+00', NULL, '2026-08-24 15:23:49.336221+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JAUX00000000000000000064', '/aux/position/save', 'aux', 'position', 'save', '保存岗位', 'ENABLED', '2026-08-24 15:23:49.336221+00', NULL, '2026-08-24 15:23:49.336221+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JAUX00000000000000000065', '/aux/position/enable', 'aux', 'position', 'enable', '启用岗位', 'ENABLED', '2026-08-24 15:23:49.336221+00', NULL, '2026-08-24 15:23:49.336221+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JAUX00000000000000000066', '/aux/position/disable', 'aux', 'position', 'disable', '停用岗位', 'ENABLED', '2026-08-24 15:23:49.336221+00', NULL, '2026-08-24 15:23:49.336221+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JAUX00000000000000000067', '/aux/position/delete', 'aux', 'position', 'delete', '删除岗位', 'ENABLED', '2026-08-24 15:23:49.336221+00', NULL, '2026-08-24 15:23:49.336221+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JAUX00000000000000000021', '/aux/product-category/query', 'aux', 'product-category', 'query', '查询产品分类', 'ENABLED', '2026-08-24 15:23:49.336221+00', NULL, '2026-08-24 15:23:49.336221+00', NULL, 1, 10);
INSERT INTO public.app_permissions VALUES ('01JAUX00000000000000000041', '/aux/department/query', 'aux', 'department', 'query', '查询部门', 'ENABLED', '2026-08-24 15:23:49.336221+00', NULL, '2026-08-24 15:23:49.336221+00', NULL, 1, 20);
INSERT INTO public.app_permissions VALUES ('01JAUX00000000000000000102', '/aux/dictionary-type/get', 'aux', 'dictionary-type', 'get', '查看字典类型', 'ENABLED', '2026-08-24 15:23:49.336221+00', NULL, '2026-08-24 15:23:49.336221+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JAUX00000000000000000103', '/aux/dictionary-type/create', 'aux', 'dictionary-type', 'create', '创建字典类型', 'ENABLED', '2026-08-24 15:23:49.336221+00', NULL, '2026-08-24 15:23:49.336221+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JAUX00000000000000000104', '/aux/dictionary-type/save', 'aux', 'dictionary-type', 'save', '保存字典类型', 'ENABLED', '2026-08-24 15:23:49.336221+00', NULL, '2026-08-24 15:23:49.336221+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JAUX00000000000000000105', '/aux/dictionary-type/enable', 'aux', 'dictionary-type', 'enable', '启用字典类型', 'ENABLED', '2026-08-24 15:23:49.336221+00', NULL, '2026-08-24 15:23:49.336221+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JAUX00000000000000000106', '/aux/dictionary-type/disable', 'aux', 'dictionary-type', 'disable', '停用字典类型', 'ENABLED', '2026-08-24 15:23:49.336221+00', NULL, '2026-08-24 15:23:49.336221+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JAUX00000000000000000107', '/aux/dictionary-type/delete', 'aux', 'dictionary-type', 'delete', '删除字典类型', 'ENABLED', '2026-08-24 15:23:49.336221+00', NULL, '2026-08-24 15:23:49.336221+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JAUX00000000000000000122', '/aux/dictionary-item/get', 'aux', 'dictionary-item', 'get', '查看字典项', 'ENABLED', '2026-08-24 15:23:49.336221+00', NULL, '2026-08-24 15:23:49.336221+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JAUX00000000000000000123', '/aux/dictionary-item/create', 'aux', 'dictionary-item', 'create', '创建字典项', 'ENABLED', '2026-08-24 15:23:49.336221+00', NULL, '2026-08-24 15:23:49.336221+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JAUX00000000000000000124', '/aux/dictionary-item/save', 'aux', 'dictionary-item', 'save', '保存字典项', 'ENABLED', '2026-08-24 15:23:49.336221+00', NULL, '2026-08-24 15:23:49.336221+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JAUX00000000000000000125', '/aux/dictionary-item/enable', 'aux', 'dictionary-item', 'enable', '启用字典项', 'ENABLED', '2026-08-24 15:23:49.336221+00', NULL, '2026-08-24 15:23:49.336221+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JAUX00000000000000000126', '/aux/dictionary-item/disable', 'aux', 'dictionary-item', 'disable', '停用字典项', 'ENABLED', '2026-08-24 15:23:49.336221+00', NULL, '2026-08-24 15:23:49.336221+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JAUX00000000000000000127', '/aux/dictionary-item/delete', 'aux', 'dictionary-item', 'delete', '删除字典项', 'ENABLED', '2026-08-24 15:23:49.336221+00', NULL, '2026-08-24 15:23:49.336221+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JAUX00000000000000000142', '/aux/measurement-unit/get', 'aux', 'measurement-unit', 'get', '查看计量单位', 'ENABLED', '2026-08-24 15:23:49.336221+00', NULL, '2026-08-24 15:23:49.336221+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JAUX00000000000000000143', '/aux/measurement-unit/create', 'aux', 'measurement-unit', 'create', '创建计量单位', 'ENABLED', '2026-08-24 15:23:49.336221+00', NULL, '2026-08-24 15:23:49.336221+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JAUX00000000000000000144', '/aux/measurement-unit/save', 'aux', 'measurement-unit', 'save', '保存计量单位', 'ENABLED', '2026-08-24 15:23:49.336221+00', NULL, '2026-08-24 15:23:49.336221+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JAUX00000000000000000145', '/aux/measurement-unit/enable', 'aux', 'measurement-unit', 'enable', '启用计量单位', 'ENABLED', '2026-08-24 15:23:49.336221+00', NULL, '2026-08-24 15:23:49.336221+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JAUX00000000000000000146', '/aux/measurement-unit/disable', 'aux', 'measurement-unit', 'disable', '停用计量单位', 'ENABLED', '2026-08-24 15:23:49.336221+00', NULL, '2026-08-24 15:23:49.336221+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JAUX00000000000000000147', '/aux/measurement-unit/delete', 'aux', 'measurement-unit', 'delete', '删除计量单位', 'ENABLED', '2026-08-24 15:23:49.336221+00', NULL, '2026-08-24 15:23:49.336221+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JAUX00000000000000000162', '/aux/income-expense-type/get', 'aux', 'income-expense-type', 'get', '查看收支类型', 'ENABLED', '2026-08-24 15:23:49.336221+00', NULL, '2026-08-24 15:23:49.336221+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JAUX00000000000000000163', '/aux/income-expense-type/create', 'aux', 'income-expense-type', 'create', '创建收支类型', 'ENABLED', '2026-08-24 15:23:49.336221+00', NULL, '2026-08-24 15:23:49.336221+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JAUX00000000000000000164', '/aux/income-expense-type/save', 'aux', 'income-expense-type', 'save', '保存收支类型', 'ENABLED', '2026-08-24 15:23:49.336221+00', NULL, '2026-08-24 15:23:49.336221+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JAUX00000000000000000165', '/aux/income-expense-type/enable', 'aux', 'income-expense-type', 'enable', '启用收支类型', 'ENABLED', '2026-08-24 15:23:49.336221+00', NULL, '2026-08-24 15:23:49.336221+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JAUX00000000000000000166', '/aux/income-expense-type/disable', 'aux', 'income-expense-type', 'disable', '停用收支类型', 'ENABLED', '2026-08-24 15:23:49.336221+00', NULL, '2026-08-24 15:23:49.336221+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JAUX00000000000000000167', '/aux/income-expense-type/delete', 'aux', 'income-expense-type', 'delete', '删除收支类型', 'ENABLED', '2026-08-24 15:23:49.336221+00', NULL, '2026-08-24 15:23:49.336221+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JAUX00000000000000000141', '/aux/measurement-unit/query', 'aux', 'measurement-unit', 'query', '查询计量单位', 'ENABLED', '2026-08-24 15:23:49.336221+00', NULL, '2026-08-24 15:23:49.336221+00', NULL, 1, 50);
INSERT INTO public.app_permissions VALUES ('01JAUX00000000000000000101', '/aux/dictionary-type/query', 'aux', 'dictionary-type', 'query', '查询字典类型', 'ENABLED', '2026-08-24 15:23:49.336221+00', NULL, '2026-08-24 15:23:49.336221+00', NULL, 1, 60);
INSERT INTO public.app_permissions VALUES ('01JAUX00000000000000000121', '/aux/dictionary-item/query', 'aux', 'dictionary-item', 'query', '查询字典项', 'ENABLED', '2026-08-24 15:23:49.336221+00', NULL, '2026-08-24 15:23:49.336221+00', NULL, 1, 70);
INSERT INTO public.app_permissions VALUES ('01JAUX00000000000000000161', '/aux/income-expense-type/query', 'aux', 'income-expense-type', 'query', '查询收支类型', 'ENABLED', '2026-08-24 15:23:49.336221+00', NULL, '2026-08-24 15:23:49.336221+00', NULL, 1, 80);
INSERT INTO public.app_permissions VALUES ('01JAUX00000000000000000202', '/aux/product-type/get', 'aux', 'product-type', 'get', '查看产品类型', 'ENABLED', '2026-08-24 15:23:49.336221+00', NULL, '2026-08-24 15:23:49.336221+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JAUX00000000000000000203', '/aux/product-type/create', 'aux', 'product-type', 'create', '创建产品类型', 'ENABLED', '2026-08-24 15:23:49.336221+00', NULL, '2026-08-24 15:23:49.336221+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JAUX00000000000000000204', '/aux/product-type/save', 'aux', 'product-type', 'save', '保存产品类型', 'ENABLED', '2026-08-24 15:23:49.336221+00', NULL, '2026-08-24 15:23:49.336221+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JAUX00000000000000000205', '/aux/product-type/enable', 'aux', 'product-type', 'enable', '启用产品类型', 'ENABLED', '2026-08-24 15:23:49.336221+00', NULL, '2026-08-24 15:23:49.336221+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JAUX00000000000000000206', '/aux/product-type/disable', 'aux', 'product-type', 'disable', '停用产品类型', 'ENABLED', '2026-08-24 15:23:49.336221+00', NULL, '2026-08-24 15:23:49.336221+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JAUX00000000000000000207', '/aux/product-type/delete', 'aux', 'product-type', 'delete', '删除产品类型', 'ENABLED', '2026-08-24 15:23:49.336221+00', NULL, '2026-08-24 15:23:49.336221+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JVOU00000000000000000149', '/vou/sale-order/formula-default', 'vou', 'sale-order', 'formula-default', '解析销售订单默认配方', 'ENABLED', '2026-08-24 15:23:49.383111+00', NULL, '2026-08-24 15:23:49.383111+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('SR2e3f53fb55b6f0c87524c566', '/vou/sale-return/get', 'vou', 'sale-return', 'get', '查看销售退货', 'ENABLED', '2026-08-24 15:23:49.390761+00', NULL, '2026-08-24 15:23:49.390761+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('SR14074cf0ec69a8d22bfcad1b', '/vou/sale-return/create', 'vou', 'sale-return', 'create', '创建销售退货', 'ENABLED', '2026-08-24 15:23:49.390761+00', NULL, '2026-08-24 15:23:49.390761+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('SR5781a9f73050e25af584e583', '/vou/sale-return/save', 'vou', 'sale-return', 'save', '保存销售退货', 'ENABLED', '2026-08-24 15:23:49.390761+00', NULL, '2026-08-24 15:23:49.390761+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('SR3d9f811dd94e25552882125c', '/vou/sale-return/delete', 'vou', 'sale-return', 'delete', '删除销售退货', 'ENABLED', '2026-08-24 15:23:49.390761+00', NULL, '2026-08-24 15:23:49.390761+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('SR1df765da38ce9fd430db8e22', '/vou/sale-return/submit', 'vou', 'sale-return', 'submit', '提交销售退货', 'ENABLED', '2026-08-24 15:23:49.390761+00', NULL, '2026-08-24 15:23:49.390761+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('SR9c79a4eea70e976098f6a9d0', '/vou/sale-return/unsubmit', 'vou', 'sale-return', 'unsubmit', '撤销提交销售退货', 'ENABLED', '2026-08-24 15:23:49.390761+00', NULL, '2026-08-24 15:23:49.390761+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('SR4bed86cfc7015da6c48fa05a', '/vou/sale-return/approve', 'vou', 'sale-return', 'approve', '批准销售退货', 'ENABLED', '2026-08-24 15:23:49.390761+00', NULL, '2026-08-24 15:23:49.390761+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('SRa040dac8bd143466ccfe89b5', '/vou/sale-return/unapprove', 'vou', 'sale-return', 'unapprove', '反批准销售退货', 'ENABLED', '2026-08-24 15:23:49.390761+00', NULL, '2026-08-24 15:23:49.390761+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('SRfa9b2f4da24460e29fb56659', '/vou/sale-return/audit-history', 'vou', 'sale-return', 'audit-history', '查看销售退货审计', 'ENABLED', '2026-08-24 15:23:49.390761+00', NULL, '2026-08-24 15:23:49.390761+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('SR0ff8e705586452fd55657377', '/vou/sale-return/attachment-initiate', 'vou', 'sale-return', 'attachment-initiate', '上传销售退货附件', 'ENABLED', '2026-08-24 15:23:49.390761+00', NULL, '2026-08-24 15:23:49.390761+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('SR96a217236817f403a3d63c62', '/vou/sale-return/attachment-download', 'vou', 'sale-return', 'attachment-download', '下载销售退货附件', 'ENABLED', '2026-08-24 15:23:49.390761+00', NULL, '2026-08-24 15:23:49.390761+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('SR97f21aac57c959f67c3bb260', '/vou/sale-return/attachment-remove', 'vou', 'sale-return', 'attachment-remove', '删除销售退货附件', 'ENABLED', '2026-08-24 15:23:49.390761+00', NULL, '2026-08-24 15:23:49.390761+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('PR718b4d715d7438d0a4d984ae', '/vou/purchase-return/get', 'vou', 'purchase-return', 'get', '查看采购退货', 'ENABLED', '2026-08-24 15:23:49.401432+00', NULL, '2026-08-24 15:23:49.401432+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('PR81adbfc09038ad1333b9600e', '/vou/purchase-return/create', 'vou', 'purchase-return', 'create', '创建采购退货', 'ENABLED', '2026-08-24 15:23:49.401432+00', NULL, '2026-08-24 15:23:49.401432+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('PR32c9168b4669b803a6733a57', '/vou/purchase-return/save', 'vou', 'purchase-return', 'save', '保存采购退货', 'ENABLED', '2026-08-24 15:23:49.401432+00', NULL, '2026-08-24 15:23:49.401432+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('PRe0c8092db4e288e700dfd47a', '/vou/purchase-return/delete', 'vou', 'purchase-return', 'delete', '删除采购退货', 'ENABLED', '2026-08-24 15:23:49.401432+00', NULL, '2026-08-24 15:23:49.401432+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('PR44dfea7f682a9cb8e554c6a9', '/vou/purchase-return/submit', 'vou', 'purchase-return', 'submit', '提交采购退货', 'ENABLED', '2026-08-24 15:23:49.401432+00', NULL, '2026-08-24 15:23:49.401432+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('PR54368ec7e5f650bc88ed7d3f', '/vou/purchase-return/unsubmit', 'vou', 'purchase-return', 'unsubmit', '撤销提交采购退货', 'ENABLED', '2026-08-24 15:23:49.401432+00', NULL, '2026-08-24 15:23:49.401432+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('PR2d5f333eb8d5ee269aebdc3c', '/vou/purchase-return/approve', 'vou', 'purchase-return', 'approve', '批准采购退货', 'ENABLED', '2026-08-24 15:23:49.401432+00', NULL, '2026-08-24 15:23:49.401432+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('PR20dd55fd646d58fb64fd0e07', '/vou/purchase-return/unapprove', 'vou', 'purchase-return', 'unapprove', '反批准采购退货', 'ENABLED', '2026-08-24 15:23:49.401432+00', NULL, '2026-08-24 15:23:49.401432+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('PR8fa22cce8900d86d95c3831c', '/vou/purchase-return/audit-history', 'vou', 'purchase-return', 'audit-history', '查看采购退货审计', 'ENABLED', '2026-08-24 15:23:49.401432+00', NULL, '2026-08-24 15:23:49.401432+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('PRfb3a931ce05303741e198779', '/vou/purchase-return/attachment-initiate', 'vou', 'purchase-return', 'attachment-initiate', '上传采购退货附件', 'ENABLED', '2026-08-24 15:23:49.401432+00', NULL, '2026-08-24 15:23:49.401432+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('PR95d172f7fb4c048dacea27ee', '/vou/purchase-return/attachment-download', 'vou', 'purchase-return', 'attachment-download', '下载采购退货附件', 'ENABLED', '2026-08-24 15:23:49.401432+00', NULL, '2026-08-24 15:23:49.401432+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('PR483f3924561b474ce71af2b6', '/vou/purchase-return/attachment-remove', 'vou', 'purchase-return', 'attachment-remove', '删除采购退货附件', 'ENABLED', '2026-08-24 15:23:49.401432+00', NULL, '2026-08-24 15:23:49.401432+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('PD0e5618fdbf79c5eb4895db0b', '/vou/order-production/get', 'vou', 'order-production', 'get', '查看生产配货', 'ENABLED', '2026-08-24 15:23:49.454799+00', NULL, '2026-08-24 15:23:49.454799+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('PD627da930843a36c9e20c581d', '/vou/order-production/create', 'vou', 'order-production', 'create', '创建生产配货', 'ENABLED', '2026-08-24 15:23:49.454799+00', NULL, '2026-08-24 15:23:49.454799+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('PD4a89d5bb71f3900823731dbc', '/vou/order-production/save', 'vou', 'order-production', 'save', '保存生产配货', 'ENABLED', '2026-08-24 15:23:49.454799+00', NULL, '2026-08-24 15:23:49.454799+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('PDd6d2526111b69fde070a60b1', '/vou/order-production/delete', 'vou', 'order-production', 'delete', '删除生产配货', 'ENABLED', '2026-08-24 15:23:49.454799+00', NULL, '2026-08-24 15:23:49.454799+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('PD8591f7d39010ae784bbe15a1', '/vou/order-production/submit', 'vou', 'order-production', 'submit', '提交生产配货', 'ENABLED', '2026-08-24 15:23:49.454799+00', NULL, '2026-08-24 15:23:49.454799+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('PDf275e87ca4ea42daa9a86374', '/vou/order-production/unsubmit', 'vou', 'order-production', 'unsubmit', '撤销提交生产配货', 'ENABLED', '2026-08-24 15:23:49.454799+00', NULL, '2026-08-24 15:23:49.454799+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('PD855a7b6e895bf69b670fc209', '/vou/order-production/approve', 'vou', 'order-production', 'approve', '批准生产配货', 'ENABLED', '2026-08-24 15:23:49.454799+00', NULL, '2026-08-24 15:23:49.454799+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('PDebacd886a97c5e986646bb95', '/vou/order-production/unapprove', 'vou', 'order-production', 'unapprove', '反批准生产配货', 'ENABLED', '2026-08-24 15:23:49.454799+00', NULL, '2026-08-24 15:23:49.454799+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('PDcca2dfc81078ff0151814e3d', '/vou/order-production/audit-history', 'vou', 'order-production', 'audit-history', '查看审计生产配货', 'ENABLED', '2026-08-24 15:23:49.454799+00', NULL, '2026-08-24 15:23:49.454799+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('PD05de716c7a23ee19ee20966d', '/vou/order-production/attachment-initiate', 'vou', 'order-production', 'attachment-initiate', '上传附件生产配货', 'ENABLED', '2026-08-24 15:23:49.454799+00', NULL, '2026-08-24 15:23:49.454799+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('PDec1db9d9034bf8b591997894', '/vou/order-production/query', 'vou', 'order-production', 'query', '查询生产配货', 'ENABLED', '2026-08-24 15:23:49.454799+00', NULL, '2026-08-24 15:23:49.454799+00', NULL, 1, 55);
INSERT INTO public.app_permissions VALUES ('PD4ffe28b5247d9c4b22c8c799', '/vou/order-production/attachment-download', 'vou', 'order-production', 'attachment-download', '下载附件生产配货', 'ENABLED', '2026-08-24 15:23:49.454799+00', NULL, '2026-08-24 15:23:49.454799+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('PD2c035e2b06eb5a74fe756813', '/vou/order-production/attachment-remove', 'vou', 'order-production', 'attachment-remove', '删除附件生产配货', 'ENABLED', '2026-08-24 15:23:49.454799+00', NULL, '2026-08-24 15:23:49.454799+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('PD07d06b8b200c4e34c1aa0882', '/vou/self-production/get', 'vou', 'self-production', 'get', '查看生产自制品', 'ENABLED', '2026-08-24 15:23:49.454799+00', NULL, '2026-08-24 15:23:49.454799+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('PD35ea7fe74494070596ab83bc', '/vou/self-production/create', 'vou', 'self-production', 'create', '创建生产自制品', 'ENABLED', '2026-08-24 15:23:49.454799+00', NULL, '2026-08-24 15:23:49.454799+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('PD182c9e3adda920516ed6f5b1', '/vou/self-production/save', 'vou', 'self-production', 'save', '保存生产自制品', 'ENABLED', '2026-08-24 15:23:49.454799+00', NULL, '2026-08-24 15:23:49.454799+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('PDc669846d1fdca741ec56ca72', '/vou/self-production/delete', 'vou', 'self-production', 'delete', '删除生产自制品', 'ENABLED', '2026-08-24 15:23:49.454799+00', NULL, '2026-08-24 15:23:49.454799+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('PD1e31f24a0c58d5d872d26e51', '/vou/self-production/submit', 'vou', 'self-production', 'submit', '提交生产自制品', 'ENABLED', '2026-08-24 15:23:49.454799+00', NULL, '2026-08-24 15:23:49.454799+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('PDb5419ac78da76c793d5d27b9', '/vou/self-production/unsubmit', 'vou', 'self-production', 'unsubmit', '撤销提交生产自制品', 'ENABLED', '2026-08-24 15:23:49.454799+00', NULL, '2026-08-24 15:23:49.454799+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('PD827db941d616789e12f75098', '/vou/self-production/approve', 'vou', 'self-production', 'approve', '批准生产自制品', 'ENABLED', '2026-08-24 15:23:49.454799+00', NULL, '2026-08-24 15:23:49.454799+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('PD7e4a9852bb2b2a3c13e79a5f', '/vou/self-production/unapprove', 'vou', 'self-production', 'unapprove', '反批准生产自制品', 'ENABLED', '2026-08-24 15:23:49.454799+00', NULL, '2026-08-24 15:23:49.454799+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('PDf5a97f37dc20172c1ba57274', '/vou/self-production/audit-history', 'vou', 'self-production', 'audit-history', '查看审计生产自制品', 'ENABLED', '2026-08-24 15:23:49.454799+00', NULL, '2026-08-24 15:23:49.454799+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('PDb2a98e8fb2cd7eb437a0ed01', '/vou/self-production/attachment-initiate', 'vou', 'self-production', 'attachment-initiate', '上传附件生产自制品', 'ENABLED', '2026-08-24 15:23:49.454799+00', NULL, '2026-08-24 15:23:49.454799+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('PD36f8ca0b2e755094c9faa2d7', '/vou/self-production/attachment-download', 'vou', 'self-production', 'attachment-download', '下载附件生产自制品', 'ENABLED', '2026-08-24 15:23:49.454799+00', NULL, '2026-08-24 15:23:49.454799+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('PDecc2b00e53ada5195190d933', '/vou/self-production/attachment-remove', 'vou', 'self-production', 'attachment-remove', '删除附件生产自制品', 'ENABLED', '2026-08-24 15:23:49.454799+00', NULL, '2026-08-24 15:23:49.454799+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('PD6ca5f678f658d974c8003eb7', '/vou/self-production/formula-default', 'vou', 'self-production', 'formula-default', '解析生产自制品默认配方', 'ENABLED', '2026-08-24 15:23:49.454799+00', NULL, '2026-08-24 15:23:49.454799+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JBOB00000000000000000137', '/dcl/supplier/unsubmit', 'dcl', 'supplier', 'unsubmit', '撤回供应商声明审核', 'ENABLED', '2026-08-24 15:23:49.487716+00', NULL, '2026-08-24 15:23:49.487716+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JBOB00000000000000000138', '/dcl/supplier/unapprove', 'dcl', 'supplier', 'unapprove', '反批供应商声明', 'ENABLED', '2026-08-24 15:23:49.487716+00', NULL, '2026-08-24 15:23:49.487716+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JBOB00000000000000000141', '/dcl/employee/unsubmit', 'dcl', 'employee', 'unsubmit', '撤回员工声明审核', 'ENABLED', '2026-08-24 15:23:49.487716+00', NULL, '2026-08-24 15:23:49.487716+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JBOB00000000000000000142', '/dcl/employee/unapprove', 'dcl', 'employee', 'unapprove', '反审核员工声明', 'ENABLED', '2026-08-24 15:23:49.487716+00', NULL, '2026-08-24 15:23:49.487716+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JBOB00000000000000000143', '/dcl/employee/query', 'dcl', 'employee', 'query', '查询员工声明', 'ENABLED', '2026-08-24 15:23:49.487716+00', NULL, '2026-08-28 00:00:00+00', NULL, 2, 30);
INSERT INTO public.app_permissions VALUES ('01JBOB00000000000000000144', '/dcl/employee/get', 'dcl', 'employee', 'get', '查看员工声明', 'ENABLED', '2026-08-24 15:23:49.487716+00', NULL, '2026-08-28 00:00:00+00', NULL, 2, NULL);
INSERT INTO public.app_permissions VALUES ('01JBOB00000000000000000145', '/dcl/product/unsubmit', 'dcl', 'product', 'unsubmit', 'unsubmit product', 'ENABLED', '2026-08-24 15:23:49.487716+00', NULL, '2026-08-24 15:23:49.487716+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JBOB00000000000000000146', '/dcl/product/unapprove', 'dcl', 'product', 'unapprove', 'unapprove product', 'ENABLED', '2026-08-24 15:23:49.487716+00', NULL, '2026-08-24 15:23:49.487716+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JDCL28200000000000000001', '/dcl/product/get', 'dcl', 'product', 'get', '查看产品声明', 'ENABLED', '2026-08-28 00:00:00+00', NULL, '2026-08-28 00:00:00+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JDCL28200000000000000002', '/dcl/product/query', 'dcl', 'product', 'query', '查询产品声明', 'ENABLED', '2026-08-28 00:00:00+00', NULL, '2026-08-28 00:00:00+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JBOB00000000000000000153', '/dcl/warehouse/unsubmit', 'dcl', 'warehouse', 'unsubmit', '撤回仓库声明审核', 'ENABLED', '2026-08-24 15:23:49.487716+00', NULL, '2026-08-24 15:23:49.487716+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JBOB00000000000000000154', '/dcl/warehouse/unapprove', 'dcl', 'warehouse', 'unapprove', '反审核仓库声明', 'ENABLED', '2026-08-24 15:23:49.487716+00', NULL, '2026-08-24 15:23:49.487716+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JBOB00000000000000000155', '/dcl/warehouse/get', 'dcl', 'warehouse', 'get', '查看仓库声明', 'ENABLED', '2026-08-24 15:23:49.487716+00', NULL, '2026-08-24 15:23:49.487716+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JBOB00000000000000000156', '/dcl/warehouse/query', 'dcl', 'warehouse', 'query', '查询仓库声明', 'ENABLED', '2026-08-24 15:23:49.487716+00', NULL, '2026-08-24 15:23:49.487716+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JBOB00000000000000000157', '/dcl/vehicle/unsubmit', 'dcl', 'vehicle', 'unsubmit', '撤回车辆声明审核', 'ENABLED', '2026-08-24 15:23:49.487716+00', NULL, '2026-08-24 15:23:49.487716+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JBOB00000000000000000158', '/dcl/vehicle/unapprove', 'dcl', 'vehicle', 'unapprove', '反审核车辆声明', 'ENABLED', '2026-08-24 15:23:49.487716+00', NULL, '2026-08-24 15:23:49.487716+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JBOB00000000000000000159', '/dcl/vehicle/get', 'dcl', 'vehicle', 'get', '查看车辆声明', 'ENABLED', '2026-08-24 15:23:49.487716+00', NULL, '2026-08-24 15:23:49.487716+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JBOB00000000000000000160', '/dcl/vehicle/query', 'dcl', 'vehicle', 'query', '查询车辆声明', 'ENABLED', '2026-08-24 15:23:49.487716+00', NULL, '2026-08-24 15:23:49.487716+00', NULL, 1, 70);
INSERT INTO public.app_permissions VALUES ('PDcfd012a8326be3c56244dddc', '/vou/self-production/query', 'vou', 'self-production', 'query', '查询生产自制品', 'ENABLED', '2026-08-24 15:23:49.454799+00', NULL, '2026-08-24 15:23:49.454799+00', NULL, 1, 56);
INSERT INTO public.app_permissions VALUES ('01JBOB00000000000000000161', '/dcl/fund-account/unsubmit', 'dcl', 'fund-account', 'unsubmit', 'unsubmit fund-account', 'ENABLED', '2026-08-24 15:23:49.487716+00', NULL, '2026-08-24 15:23:49.487716+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JBOB00000000000000000162', '/dcl/fund-account/unapprove', 'dcl', 'fund-account', 'unapprove', 'unapprove fund-account', 'ENABLED', '2026-08-24 15:23:49.487716+00', NULL, '2026-08-24 15:23:49.487716+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JBOB00000000000000000163', '/dcl/fund-account/get', 'dcl', 'fund-account', 'get', '查看资金账户声明', 'ENABLED', '2026-08-24 15:23:49.487716+00', NULL, '2026-08-24 15:23:49.487716+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JBOB00000000000000000164', '/dcl/fund-account/query', 'dcl', 'fund-account', 'query', '查询资金账户声明', 'ENABLED', '2026-08-24 15:23:49.487716+00', NULL, '2026-08-24 15:23:49.487716+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('PR604ef4230754ae77eeaf3138', '/vou/sale-pricing/get', 'vou', 'sale-pricing', 'get', '查看销售定价', 'ENABLED', '2026-08-24 15:23:49.505114+00', NULL, '2026-08-24 15:23:49.505114+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('PR2ea215e473f97405024e07e7', '/vou/purchase-inquiry/get', 'vou', 'purchase-inquiry', 'get', '查看采购询价', 'ENABLED', '2026-08-24 15:23:49.505114+00', NULL, '2026-08-24 15:23:49.505114+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('PR65b897558a7ebd11ed8db67b', '/vou/sale-pricing/create', 'vou', 'sale-pricing', 'create', '创建销售定价', 'ENABLED', '2026-08-24 15:23:49.505114+00', NULL, '2026-08-24 15:23:49.505114+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('PRac1bd6d2784c98982c5db8f9', '/vou/purchase-inquiry/create', 'vou', 'purchase-inquiry', 'create', '创建采购询价', 'ENABLED', '2026-08-24 15:23:49.505114+00', NULL, '2026-08-24 15:23:49.505114+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('PR64a5516e8bf28a9e86d6948d', '/vou/sale-pricing/save', 'vou', 'sale-pricing', 'save', '保存销售定价', 'ENABLED', '2026-08-24 15:23:49.505114+00', NULL, '2026-08-24 15:23:49.505114+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('PR4623bc852b27715da2794781', '/vou/purchase-inquiry/save', 'vou', 'purchase-inquiry', 'save', '保存采购询价', 'ENABLED', '2026-08-24 15:23:49.505114+00', NULL, '2026-08-24 15:23:49.505114+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('PR4ae55fae1c46708ea6627566', '/vou/sale-pricing/delete', 'vou', 'sale-pricing', 'delete', '删除销售定价', 'ENABLED', '2026-08-24 15:23:49.505114+00', NULL, '2026-08-24 15:23:49.505114+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('PRd516191dd4b3a1a8932a0c14', '/vou/purchase-inquiry/delete', 'vou', 'purchase-inquiry', 'delete', '删除采购询价', 'ENABLED', '2026-08-24 15:23:49.505114+00', NULL, '2026-08-24 15:23:49.505114+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('PR113886ebe9f50966895d4bd8', '/vou/sale-pricing/submit', 'vou', 'sale-pricing', 'submit', '提交销售定价', 'ENABLED', '2026-08-24 15:23:49.505114+00', NULL, '2026-08-24 15:23:49.505114+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('PR02d39fbef186f450d356ab86', '/vou/purchase-inquiry/submit', 'vou', 'purchase-inquiry', 'submit', '提交采购询价', 'ENABLED', '2026-08-24 15:23:49.505114+00', NULL, '2026-08-24 15:23:49.505114+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('PR8601392480a4956e0265e3ba', '/vou/sale-pricing/unsubmit', 'vou', 'sale-pricing', 'unsubmit', '撤销提交销售定价', 'ENABLED', '2026-08-24 15:23:49.505114+00', NULL, '2026-08-24 15:23:49.505114+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('PR4535924d0cb3a50f06d34cbf', '/vou/purchase-inquiry/unsubmit', 'vou', 'purchase-inquiry', 'unsubmit', '撤销提交采购询价', 'ENABLED', '2026-08-24 15:23:49.505114+00', NULL, '2026-08-24 15:23:49.505114+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('PR44a5d79fc99a80e589b1f57d', '/vou/sale-pricing/approve', 'vou', 'sale-pricing', 'approve', '批准销售定价', 'ENABLED', '2026-08-24 15:23:49.505114+00', NULL, '2026-08-24 15:23:49.505114+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('PRfd72130ec6cbdb39622887a4', '/vou/purchase-inquiry/approve', 'vou', 'purchase-inquiry', 'approve', '批准采购询价', 'ENABLED', '2026-08-24 15:23:49.505114+00', NULL, '2026-08-24 15:23:49.505114+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('PR71c15e7ba2ba48595a2291b7', '/vou/sale-pricing/unapprove', 'vou', 'sale-pricing', 'unapprove', '反批准销售定价', 'ENABLED', '2026-08-24 15:23:49.505114+00', NULL, '2026-08-24 15:23:49.505114+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('PR34c75e15ad2b3cf6a731f8ad', '/vou/purchase-inquiry/unapprove', 'vou', 'purchase-inquiry', 'unapprove', '反批准采购询价', 'ENABLED', '2026-08-24 15:23:49.505114+00', NULL, '2026-08-24 15:23:49.505114+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('PRde119f522378fcaa7fb2100c', '/vou/sale-pricing/audit-history', 'vou', 'sale-pricing', 'audit-history', '查看审计销售定价', 'ENABLED', '2026-08-24 15:23:49.505114+00', NULL, '2026-08-24 15:23:49.505114+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('PRf754e53b937bdaa5b3876d4d', '/vou/purchase-inquiry/audit-history', 'vou', 'purchase-inquiry', 'audit-history', '查看审计采购询价', 'ENABLED', '2026-08-24 15:23:49.505114+00', NULL, '2026-08-24 15:23:49.505114+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('PRea9dba7e8b63ee7928c556d7', '/vou/sale-pricing/attachment-initiate', 'vou', 'sale-pricing', 'attachment-initiate', '上传附件销售定价', 'ENABLED', '2026-08-24 15:23:49.505114+00', NULL, '2026-08-24 15:23:49.505114+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('PR353ba6e53e278fee4d50844c', '/vou/purchase-inquiry/attachment-initiate', 'vou', 'purchase-inquiry', 'attachment-initiate', '上传附件采购询价', 'ENABLED', '2026-08-24 15:23:49.505114+00', NULL, '2026-08-24 15:23:49.505114+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('PR1a82fdb04d260983d903b6fd', '/vou/sale-pricing/attachment-download', 'vou', 'sale-pricing', 'attachment-download', '下载附件销售定价', 'ENABLED', '2026-08-24 15:23:49.505114+00', NULL, '2026-08-24 15:23:49.505114+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('PRe7c8776fbec3741d2b898394', '/vou/purchase-inquiry/attachment-download', 'vou', 'purchase-inquiry', 'attachment-download', '下载附件采购询价', 'ENABLED', '2026-08-24 15:23:49.505114+00', NULL, '2026-08-24 15:23:49.505114+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('PRa7ac94538cca382291b2c4bf', '/vou/sale-pricing/attachment-remove', 'vou', 'sale-pricing', 'attachment-remove', '删除附件销售定价', 'ENABLED', '2026-08-24 15:23:49.505114+00', NULL, '2026-08-24 15:23:49.505114+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('PR368237ea43d461d2f10853b5', '/vou/purchase-inquiry/attachment-remove', 'vou', 'purchase-inquiry', 'attachment-remove', '删除附件采购询价', 'ENABLED', '2026-08-24 15:23:49.505114+00', NULL, '2026-08-24 15:23:49.505114+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('PR12172b138550ec14f3f50594', '/vou/sale-order/price-reference', 'vou', 'sale-order', 'price-reference', '解析销售参考价', 'ENABLED', '2026-08-24 15:23:49.505114+00', NULL, '2026-08-24 15:23:49.505114+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('PR43225f79219cbcd86326e4f7', '/vou/purchase-order/price-reference', 'vou', 'purchase-order', 'price-reference', '解析采购参考价', 'ENABLED', '2026-08-24 15:23:49.505114+00', NULL, '2026-08-24 15:23:49.505114+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('WG97a91cf1d6594be99cbcc468', '/wfl/process-definition/get', 'wfl', 'process-definition', 'get', '读取流程定义', 'ENABLED', '2026-08-24 15:23:49.521804+00', NULL, '2026-08-24 15:23:50.02923+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('VE70b2c2b2f72e9ba6e39a8b11', '/vou/expense-payment/get', 'vou', 'expense-payment', 'get', '读取费用付款', 'ENABLED', '2026-08-24 15:23:49.521804+00', NULL, '2026-08-24 15:23:49.521804+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('VE78afc21477bcad85cec9a8b7', '/vou/expense-payment/save', 'vou', 'expense-payment', 'save', '保存费用付款', 'ENABLED', '2026-08-24 15:23:49.521804+00', NULL, '2026-08-24 15:23:49.521804+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('VE82ca63143d458d5531c729c2', '/vou/expense-payment/delete', 'vou', 'expense-payment', 'delete', '删除费用付款', 'ENABLED', '2026-08-24 15:23:49.521804+00', NULL, '2026-08-24 15:23:49.521804+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('VE90db9897c7247dc41e124f9c', '/vou/expense-payment/submit', 'vou', 'expense-payment', 'submit', '提交费用付款', 'ENABLED', '2026-08-24 15:23:49.521804+00', NULL, '2026-08-24 15:23:49.521804+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('VE0ce3ae91a4d9c396f3dcbd98', '/vou/expense-payment/unsubmit', 'vou', 'expense-payment', 'unsubmit', '撤销提交费用付款', 'ENABLED', '2026-08-24 15:23:49.521804+00', NULL, '2026-08-24 15:23:49.521804+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('VE6cde2c465fd17de1a340cfbd', '/vou/expense-payment/approve', 'vou', 'expense-payment', 'approve', '批准费用付款', 'ENABLED', '2026-08-24 15:23:49.521804+00', NULL, '2026-08-24 15:23:49.521804+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('VE46e22b8f297e54cb85f80ae3', '/vou/expense-payment/unapprove', 'vou', 'expense-payment', 'unapprove', '撤销批准费用付款', 'ENABLED', '2026-08-24 15:23:49.521804+00', NULL, '2026-08-24 15:23:49.521804+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('VEa3f6979037c4a98b6177a4c6', '/vou/expense-payment/audit-history', 'vou', 'expense-payment', 'audit-history', '查询费用付款审计', 'ENABLED', '2026-08-24 15:23:49.521804+00', NULL, '2026-08-24 15:23:49.521804+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('VE5caf9bdddaadd641a3a0d6b0', '/vou/expense-payment/attachment-initiate', 'vou', 'expense-payment', 'attachment-initiate', '发起费用付款附件上传', 'ENABLED', '2026-08-24 15:23:49.521804+00', NULL, '2026-08-24 15:23:49.521804+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('VEb961ae470aa56d55e47ab78e', '/vou/expense-payment/attachment-download', 'vou', 'expense-payment', 'attachment-download', '下载费用付款附件', 'ENABLED', '2026-08-24 15:23:49.521804+00', NULL, '2026-08-24 15:23:49.521804+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('VE9d4cbcaf208ba7e33f7165d0', '/vou/expense-payment/attachment-remove', 'vou', 'expense-payment', 'attachment-remove', '删除费用付款附件', 'ENABLED', '2026-08-24 15:23:49.521804+00', NULL, '2026-08-24 15:23:49.521804+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('PS8def9c43a83a8894b0053920', '/vou/other-receipt/get', 'vou', 'other-receipt', 'get', '查看往来收款', 'ENABLED', '2026-08-24 15:23:49.547238+00', NULL, '2026-08-24 15:23:49.547238+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('PS6846504e11c0797239899710', '/vou/other-payment/get', 'vou', 'other-payment', 'get', '查看往来付款', 'ENABLED', '2026-08-24 15:23:49.547238+00', NULL, '2026-08-24 15:23:49.547238+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('PS048bee2df73c730d05b0079a', '/vou/other-receipt/create', 'vou', 'other-receipt', 'create', '创建往来收款', 'ENABLED', '2026-08-24 15:23:49.547238+00', NULL, '2026-08-24 15:23:49.547238+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('PS20808590cb4900c3bb730649', '/vou/other-payment/create', 'vou', 'other-payment', 'create', '创建往来付款', 'ENABLED', '2026-08-24 15:23:49.547238+00', NULL, '2026-08-24 15:23:49.547238+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('PS40914bb9b0c3c46cec192368', '/vou/other-receipt/unapprove', 'vou', 'other-receipt', 'unapprove', '反批准往来收款', 'ENABLED', '2026-08-24 15:23:49.547238+00', NULL, '2026-08-24 15:23:49.547238+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('PS706bbf8dbb7e0875f1af97a0', '/vou/other-payment/unapprove', 'vou', 'other-payment', 'unapprove', '反批准往来付款', 'ENABLED', '2026-08-24 15:23:49.547238+00', NULL, '2026-08-24 15:23:49.547238+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('PS89fadfb19ca89caeb3675071', '/vou/other-receipt/audit-history', 'vou', 'other-receipt', 'audit-history', '查看审计往来收款', 'ENABLED', '2026-08-24 15:23:49.547238+00', NULL, '2026-08-24 15:23:49.547238+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('PS6d7556e724d13db82eaba45f', '/vou/other-payment/audit-history', 'vou', 'other-payment', 'audit-history', '查看审计往来付款', 'ENABLED', '2026-08-24 15:23:49.547238+00', NULL, '2026-08-24 15:23:49.547238+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('PS92f8c403ffb4fac77501ebfc', '/vou/other-receipt/attachment-initiate', 'vou', 'other-receipt', 'attachment-initiate', '发起附件上传往来收款', 'ENABLED', '2026-08-24 15:23:49.547238+00', NULL, '2026-08-24 15:23:49.547238+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('PSb1546c5739600a35281242cb', '/vou/other-payment/attachment-initiate', 'vou', 'other-payment', 'attachment-initiate', '发起附件上传往来付款', 'ENABLED', '2026-08-24 15:23:49.547238+00', NULL, '2026-08-24 15:23:49.547238+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('PS6979da2b5bf974fc0bb21e1c', '/vou/purchase-refund/get', 'vou', 'purchase-refund', 'get', '查看往来收款', 'ENABLED', '2026-08-24 15:23:49.547238+00', NULL, '2026-08-24 15:23:49.547238+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('PS64dbb5ba056f4f9f2c5c48e1', '/vou/sales-receipt/get', 'vou', 'sales-receipt', 'get', '查看往来收款', 'ENABLED', '2026-08-24 15:23:49.547238+00', NULL, '2026-08-24 15:23:49.547238+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('PSf6af4ba0552bac9c36a650b7', '/vou/purchase-payment/get', 'vou', 'purchase-payment', 'get', '查看往来付款', 'ENABLED', '2026-08-24 15:23:49.547238+00', NULL, '2026-08-24 15:23:49.547238+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('WG063b9aa72968f8d3fa9d30bf', '/wfl/process-instance/get', 'wfl', 'process-instance', 'get', '读取流程实例', 'ENABLED', '2026-08-24 15:23:49.521804+00', NULL, '2026-08-24 15:23:50.02923+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('WGa42b9e9f1442a7616b2ec7bb', '/wfl/process-instance/audit-history', 'wfl', 'process-instance', 'audit-history', '查询流程实例审计', 'ENABLED', '2026-08-24 15:23:49.521804+00', NULL, '2026-08-24 15:23:50.02923+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('PS64390d02f8468f4536efd158', '/vou/other-receipt/save', 'vou', 'other-receipt', 'save', '保存往来收款', 'ENABLED', '2026-08-24 15:23:49.547238+00', NULL, '2026-08-24 15:23:49.547238+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('PSc1fede872c8793848f383d86', '/vou/other-payment/save', 'vou', 'other-payment', 'save', '保存往来付款', 'ENABLED', '2026-08-24 15:23:49.547238+00', NULL, '2026-08-24 15:23:49.547238+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('PS62427bd8230f0a6512fdcf20', '/vou/other-receipt/delete', 'vou', 'other-receipt', 'delete', '删除草稿往来收款', 'ENABLED', '2026-08-24 15:23:49.547238+00', NULL, '2026-08-24 15:23:49.547238+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('PS212666f5154bbdac0995c15b', '/vou/other-payment/delete', 'vou', 'other-payment', 'delete', '删除草稿往来付款', 'ENABLED', '2026-08-24 15:23:49.547238+00', NULL, '2026-08-24 15:23:49.547238+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('PS62d8e67e77119d1fa217bf97', '/vou/other-receipt/submit', 'vou', 'other-receipt', 'submit', '提交往来收款', 'ENABLED', '2026-08-24 15:23:49.547238+00', NULL, '2026-08-24 15:23:49.547238+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('PS8d370ef94537c52810e55a02', '/vou/other-payment/submit', 'vou', 'other-payment', 'submit', '提交往来付款', 'ENABLED', '2026-08-24 15:23:49.547238+00', NULL, '2026-08-24 15:23:49.547238+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('PS824938e8f987438aa4c4830e', '/vou/other-receipt/unsubmit', 'vou', 'other-receipt', 'unsubmit', '撤销提交往来收款', 'ENABLED', '2026-08-24 15:23:49.547238+00', NULL, '2026-08-24 15:23:49.547238+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('PS9ed097e4c956f3ec3c6d1f43', '/vou/other-payment/unsubmit', 'vou', 'other-payment', 'unsubmit', '撤销提交往来付款', 'ENABLED', '2026-08-24 15:23:49.547238+00', NULL, '2026-08-24 15:23:49.547238+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('PS4699e1bd3fc16e206d488809', '/vou/purchase-payment/attachment-initiate', 'vou', 'purchase-payment', 'attachment-initiate', '发起附件上传往来付款', 'ENABLED', '2026-08-24 15:23:49.547238+00', NULL, '2026-08-24 15:23:49.547238+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('PSe202a67f152925f5d26289f3', '/vou/sales-refund/attachment-initiate', 'vou', 'sales-refund', 'attachment-initiate', '发起附件上传往来付款', 'ENABLED', '2026-08-24 15:23:49.547238+00', NULL, '2026-08-24 15:23:49.547238+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('PSe0438bda35e6b2a534839c38', '/vou/purchase-refund/save', 'vou', 'purchase-refund', 'save', '保存往来收款', 'ENABLED', '2026-08-24 15:23:49.547238+00', NULL, '2026-08-24 15:23:49.547238+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('PSb54c3f97fb23308153243585', '/vou/sales-receipt/save', 'vou', 'sales-receipt', 'save', '保存往来收款', 'ENABLED', '2026-08-24 15:23:49.547238+00', NULL, '2026-08-24 15:23:49.547238+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('PS36e65a714041688996ca4010', '/vou/purchase-payment/save', 'vou', 'purchase-payment', 'save', '保存往来付款', 'ENABLED', '2026-08-24 15:23:49.547238+00', NULL, '2026-08-24 15:23:49.547238+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('PSf6c4d61de211a4dc2cc40556', '/vou/sales-refund/save', 'vou', 'sales-refund', 'save', '保存往来付款', 'ENABLED', '2026-08-24 15:23:49.547238+00', NULL, '2026-08-24 15:23:49.547238+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('PSe86177faa584f57ec49e05b7', '/vou/purchase-refund/delete', 'vou', 'purchase-refund', 'delete', '删除草稿往来收款', 'ENABLED', '2026-08-24 15:23:49.547238+00', NULL, '2026-08-24 15:23:49.547238+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('PS31ad9cc5f7b9a08ae536f9aa', '/vou/sales-receipt/delete', 'vou', 'sales-receipt', 'delete', '删除草稿往来收款', 'ENABLED', '2026-08-24 15:23:49.547238+00', NULL, '2026-08-24 15:23:49.547238+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('PS3b484920c2a57ea1431332d8', '/vou/other-receipt/approve', 'vou', 'other-receipt', 'approve', '批准往来收款', 'ENABLED', '2026-08-24 15:23:49.547238+00', NULL, '2026-08-24 15:23:49.547238+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('PSfd95af7a14ce39affaff9ecb', '/vou/other-payment/approve', 'vou', 'other-payment', 'approve', '批准往来付款', 'ENABLED', '2026-08-24 15:23:49.547238+00', NULL, '2026-08-24 15:23:49.547238+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('PSb192c6fc508994341426bc47', '/vou/other-receipt/attachment-download', 'vou', 'other-receipt', 'attachment-download', '下载附件往来收款', 'ENABLED', '2026-08-24 15:23:49.547238+00', NULL, '2026-08-24 15:23:49.547238+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('PSb4379ddfd0f2f75a651b4767', '/vou/other-payment/attachment-download', 'vou', 'other-payment', 'attachment-download', '下载附件往来付款', 'ENABLED', '2026-08-24 15:23:49.547238+00', NULL, '2026-08-24 15:23:49.547238+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('PSf6b8840ac41942b786357776', '/vou/other-receipt/attachment-remove', 'vou', 'other-receipt', 'attachment-remove', '移除附件往来收款', 'ENABLED', '2026-08-24 15:23:49.547238+00', NULL, '2026-08-24 15:23:49.547238+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('PS476c4ca76fec3a376537c477', '/vou/other-payment/attachment-remove', 'vou', 'other-payment', 'attachment-remove', '移除附件往来付款', 'ENABLED', '2026-08-24 15:23:49.547238+00', NULL, '2026-08-24 15:23:49.547238+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('IC12ba0549d16b9ac69c22029d', '/vou/inventory-count/get', 'vou', 'inventory-count', 'get', '查看库存盘点单', 'ENABLED', '2026-08-24 15:23:49.566641+00', NULL, '2026-08-24 15:23:49.566641+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('IC96820eeaa97ae8c728512e81', '/vou/inventory-count/book-balance', 'vou', 'inventory-count', 'book-balance', '读取库存盘点账面数量', 'ENABLED', '2026-08-24 15:23:49.566641+00', NULL, '2026-08-24 15:23:49.566641+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('IC264a0b8eedd0287be356892c', '/vou/inventory-count/create', 'vou', 'inventory-count', 'create', '创建库存盘点单', 'ENABLED', '2026-08-24 15:23:49.566641+00', NULL, '2026-08-24 15:23:49.566641+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('IC47596cf5a310b9914ee61fa0', '/vou/inventory-count/save', 'vou', 'inventory-count', 'save', '保存库存盘点单', 'ENABLED', '2026-08-24 15:23:49.566641+00', NULL, '2026-08-24 15:23:49.566641+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('IC1a5f8641cb72d7152bc24c76', '/vou/inventory-count/delete', 'vou', 'inventory-count', 'delete', '删除库存盘点单', 'ENABLED', '2026-08-24 15:23:49.566641+00', NULL, '2026-08-24 15:23:49.566641+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('IC35cc3dfe5063f691a83b6a5b', '/vou/inventory-count/submit', 'vou', 'inventory-count', 'submit', '提交库存盘点单', 'ENABLED', '2026-08-24 15:23:49.566641+00', NULL, '2026-08-24 15:23:49.566641+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('ICc983cb066a2325b2bb3b22ee', '/vou/inventory-count/unsubmit', 'vou', 'inventory-count', 'unsubmit', '撤销提交库存盘点单', 'ENABLED', '2026-08-24 15:23:49.566641+00', NULL, '2026-08-24 15:23:49.566641+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('PSa89b88052b70458c92abd85d', '/vou/sales-refund/unsubmit', 'vou', 'sales-refund', 'unsubmit', '撤销提交往来付款', 'ENABLED', '2026-08-24 15:23:49.547238+00', NULL, '2026-08-24 15:23:49.547238+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('PS4c5b77734757aaf501198040', '/vou/purchase-refund/approve', 'vou', 'purchase-refund', 'approve', '批准往来收款', 'ENABLED', '2026-08-24 15:23:49.547238+00', NULL, '2026-08-24 15:23:49.547238+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('PSbb2a462131e160ee3af3c49d', '/vou/sales-receipt/approve', 'vou', 'sales-receipt', 'approve', '批准往来收款', 'ENABLED', '2026-08-24 15:23:49.547238+00', NULL, '2026-08-24 15:23:49.547238+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('PS195300f49a35714b96ab4b02', '/vou/purchase-payment/approve', 'vou', 'purchase-payment', 'approve', '批准往来付款', 'ENABLED', '2026-08-24 15:23:49.547238+00', NULL, '2026-08-24 15:23:49.547238+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('PS527ab65e6fdf8b606cf143a9', '/vou/sales-refund/approve', 'vou', 'sales-refund', 'approve', '批准往来付款', 'ENABLED', '2026-08-24 15:23:49.547238+00', NULL, '2026-08-24 15:23:49.547238+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('PSa4914d7b889e526ae6c86936', '/vou/purchase-refund/attachment-download', 'vou', 'purchase-refund', 'attachment-download', '下载附件往来收款', 'ENABLED', '2026-08-24 15:23:49.547238+00', NULL, '2026-08-24 15:23:49.547238+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('PS86352a9a98bdc70abcdda773', '/vou/sales-receipt/attachment-download', 'vou', 'sales-receipt', 'attachment-download', '下载附件往来收款', 'ENABLED', '2026-08-24 15:23:49.547238+00', NULL, '2026-08-24 15:23:49.547238+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('PSd6de444eb5a51f5f9010af2c', '/vou/purchase-payment/attachment-download', 'vou', 'purchase-payment', 'attachment-download', '下载附件往来付款', 'ENABLED', '2026-08-24 15:23:49.547238+00', NULL, '2026-08-24 15:23:49.547238+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('PS2d622411d64d5ab5aa4329da', '/vou/sales-refund/attachment-download', 'vou', 'sales-refund', 'attachment-download', '下载附件往来付款', 'ENABLED', '2026-08-24 15:23:49.547238+00', NULL, '2026-08-24 15:23:49.547238+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('PSc6ff6c06b8b9dd33c88ba55b', '/vou/purchase-refund/attachment-remove', 'vou', 'purchase-refund', 'attachment-remove', '移除附件往来收款', 'ENABLED', '2026-08-24 15:23:49.547238+00', NULL, '2026-08-24 15:23:49.547238+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('PS11ae625eb752937b178c6bea', '/vou/sales-receipt/attachment-remove', 'vou', 'sales-receipt', 'attachment-remove', '移除附件往来收款', 'ENABLED', '2026-08-24 15:23:49.547238+00', NULL, '2026-08-24 15:23:49.547238+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('PS468d8138ce6b47ea734c2513', '/vou/purchase-payment/attachment-remove', 'vou', 'purchase-payment', 'attachment-remove', '移除附件往来付款', 'ENABLED', '2026-08-24 15:23:49.547238+00', NULL, '2026-08-24 15:23:49.547238+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('PS9e0997ec2b6ae4e8b3c8a58e', '/vou/sales-refund/attachment-remove', 'vou', 'sales-refund', 'attachment-remove', '移除附件往来付款', 'ENABLED', '2026-08-24 15:23:49.547238+00', NULL, '2026-08-24 15:23:49.547238+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JACC00000000000000000113', '/dcl/acc-mapping/save', 'dcl', 'acc-mapping', 'save', '保存会计映射声明草稿', 'ENABLED', '2026-08-24 15:23:49.791438+00', NULL, '2026-08-24 15:23:49.791438+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JACC00000000000000000114', '/dcl/acc-mapping/approve', 'dcl', 'acc-mapping', 'approve', '审核通过会计映射声明', 'ENABLED', '2026-08-24 15:23:49.791438+00', NULL, '2026-08-24 15:23:49.791438+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JACC00000000000000000115', '/dcl/acc-mapping/unapprove', 'dcl', 'acc-mapping', 'unapprove', '反审核会计映射声明', 'ENABLED', '2026-08-24 15:23:49.791438+00', NULL, '2026-08-24 15:23:49.791438+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JACC00000000000000000116', '/acc/mapping/catalog', 'acc', 'mapping', 'catalog', '查看 VOU 映射字段目录', 'ENABLED', '2026-08-24 15:23:49.791438+00', NULL, '2026-08-24 15:23:49.791438+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JACC00000000000000000211', '/dcl/acc-mapping/versions', 'dcl', 'acc-mapping', 'versions', '查看会计映射声明版本', 'ENABLED', '2026-08-24 15:23:49.791438+00', NULL, '2026-08-24 15:23:49.791438+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JACC00000000000000000213', '/dcl/acc-mapping/submit', 'dcl', 'acc-mapping', 'submit', '提交会计映射声明审核', 'ENABLED', '2026-08-24 15:23:49.791438+00', NULL, '2026-08-24 15:23:49.791438+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JACC00000000000000000214', '/dcl/acc-mapping/unsubmit', 'dcl', 'acc-mapping', 'unsubmit', '撤回会计映射声明审核', 'ENABLED', '2026-08-24 15:23:49.791438+00', NULL, '2026-08-24 15:23:49.791438+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JACC00000000000000000215', '/dcl/acc-mapping/reject', 'dcl', 'acc-mapping', 'reject', '审核驳回会计映射声明', 'ENABLED', '2026-08-24 15:23:49.791438+00', NULL, '2026-08-24 15:23:49.791438+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JACC00000000000000000216', '/dcl/acc-mapping/create-next', 'dcl', 'acc-mapping', 'create-next', '创建下一会计映射声明版本', 'ENABLED', '2026-08-24 15:23:49.791438+00', NULL, '2026-08-24 15:23:49.791438+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JACC00000000000000000217', '/dcl/acc-mapping/delete-version', 'dcl', 'acc-mapping', 'delete-version', '删除会计映射声明草稿版本', 'ENABLED', '2026-08-24 15:23:49.791438+00', NULL, '2026-08-24 15:23:49.791438+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JACC00000000000000000218', '/dcl/acc-mapping/query', 'dcl', 'acc-mapping', 'query', '查询会计映射声明', 'ENABLED', '2026-08-24 15:23:49.791438+00', NULL, '2026-08-24 15:23:49.791438+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JACC00000000000000000219', '/dcl/acc-mapping/get', 'dcl', 'acc-mapping', 'get', '查看会计映射声明', 'ENABLED', '2026-08-24 15:23:49.791438+00', NULL, '2026-08-24 15:23:49.791438+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JACC00000000000000000220', '/dcl/acc-mapping/audit-history', 'dcl', 'acc-mapping', 'audit-history', '查看会计映射声明审核记录', 'ENABLED', '2026-08-24 15:23:49.791438+00', NULL, '2026-08-24 15:23:49.791438+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JACC00000000000000000117', '/acc/period/query', 'acc', 'period', 'query', '查询会计期间', 'ENABLED', '2026-08-24 15:23:49.803268+00', NULL, '2026-08-24 15:23:49.803268+00', NULL, 1, 50);
INSERT INTO public.app_permissions VALUES ('01JACC00000000000000000118', '/acc/period/lock', 'acc', 'period', 'lock', '锁定会计期间', 'ENABLED', '2026-08-24 15:23:49.803268+00', NULL, '2026-08-24 15:23:49.803268+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JACC00000000000000000119', '/acc/period/unlock', 'acc', 'period', 'unlock', '解锁会计期间', 'ENABLED', '2026-08-24 15:23:49.803268+00', NULL, '2026-08-24 15:23:49.803268+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01KRPT00000000000000000003', '/dcl/rpt-definition/create', 'dcl', 'rpt-definition', 'create', '创建报表定义声明', 'ENABLED', '2026-08-24 15:23:49.887333+00', NULL, '2026-08-29 00:00:00+00', NULL, 2, NULL);
INSERT INTO public.app_permissions VALUES ('01KRPT00000000000000000005', '/dcl/rpt-definition/save', 'dcl', 'rpt-definition', 'save', '保存报表定义声明草稿', 'ENABLED', '2026-08-24 15:23:49.887333+00', NULL, '2026-08-29 00:00:00+00', NULL, 2, NULL);
INSERT INTO public.app_permissions VALUES ('01KRPT00000000000000000006', '/dcl/rpt-definition/approve', 'dcl', 'rpt-definition', 'approve', '审核通过报表定义声明', 'ENABLED', '2026-08-24 15:23:49.887333+00', NULL, '2026-08-29 00:00:00+00', NULL, 2, NULL);
INSERT INTO public.app_permissions VALUES ('01KRPT00000000000000000007', '/dcl/rpt-definition/unapprove', 'dcl', 'rpt-definition', 'unapprove', '反审核报表定义声明', 'ENABLED', '2026-08-24 15:23:49.887333+00', NULL, '2026-08-29 00:00:00+00', NULL, 2, NULL);
INSERT INTO public.app_permissions VALUES ('01KRPT00000000000000000008', '/dcl/rpt-definition/enable', 'dcl', 'rpt-definition', 'enable', '启用报表定义', 'ENABLED', '2026-08-24 15:23:49.887333+00', NULL, '2026-08-29 00:00:00+00', NULL, 2, NULL);
INSERT INTO public.app_permissions VALUES ('01KRPT00000000000000000009', '/dcl/rpt-definition/disable', 'dcl', 'rpt-definition', 'disable', '停用报表定义', 'ENABLED', '2026-08-24 15:23:49.887333+00', NULL, '2026-08-29 00:00:00+00', NULL, 2, NULL);
INSERT INTO public.app_permissions VALUES ('01KRPT00000000000000000011', '/dcl/rpt-definition/versions', 'dcl', 'rpt-definition', 'versions', '查看报表定义声明版本', 'ENABLED', '2026-08-24 15:23:49.887333+00', NULL, '2026-08-29 00:00:00+00', NULL, 2, NULL);
INSERT INTO public.app_permissions VALUES ('01KRPT00000000000000000012', '/dcl/rpt-definition/submit', 'dcl', 'rpt-definition', 'submit', '提交报表定义声明审核', 'ENABLED', '2026-08-24 15:23:49.887333+00', NULL, '2026-08-29 00:00:00+00', NULL, 2, NULL);
INSERT INTO public.app_permissions VALUES ('01KRPT00000000000000000013', '/dcl/rpt-definition/unsubmit', 'dcl', 'rpt-definition', 'unsubmit', '撤回报表定义声明审核', 'ENABLED', '2026-08-24 15:23:49.887333+00', NULL, '2026-08-29 00:00:00+00', NULL, 2, NULL);
INSERT INTO public.app_permissions VALUES ('01KRPT00000000000000000014', '/dcl/rpt-definition/reject', 'dcl', 'rpt-definition', 'reject', '审核驳回报表定义声明', 'ENABLED', '2026-08-24 15:23:49.887333+00', NULL, '2026-08-29 00:00:00+00', NULL, 2, NULL);
INSERT INTO public.app_permissions VALUES ('01KRPT00000000000000000015', '/dcl/rpt-definition/create-next', 'dcl', 'rpt-definition', 'create-next', '创建下一报表定义声明版本', 'ENABLED', '2026-08-24 15:23:49.887333+00', NULL, '2026-08-29 00:00:00+00', NULL, 2, NULL);
INSERT INTO public.app_permissions VALUES ('01KRPT00000000000000000016', '/dcl/rpt-definition/delete-version', 'dcl', 'rpt-definition', 'delete-version', '删除报表定义声明草稿版本', 'ENABLED', '2026-08-24 15:23:49.887333+00', NULL, '2026-08-29 00:00:00+00', NULL, 2, NULL);
INSERT INTO public.app_permissions VALUES ('01KRPT00000000000000000017', '/dcl/rpt-definition/audit-history', 'dcl', 'rpt-definition', 'audit-history', '查看报表定义声明审核记录', 'ENABLED', '2026-08-29 00:00:00+00', NULL, '2026-08-29 00:00:00+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01KWFL00000000000000000010', '/dcl/wfl-process-definition/create', 'dcl', 'wfl-process-definition', 'create', '创建流程定义声明', 'ENABLED', '2026-08-29 00:00:00+00', NULL, '2026-08-29 00:00:00+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01KWFL00000000000000000011', '/dcl/wfl-process-definition/save', 'dcl', 'wfl-process-definition', 'save', '保存流程定义声明草稿', 'ENABLED', '2026-08-29 00:00:00+00', NULL, '2026-08-29 00:00:00+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01KWFL00000000000000000012', '/dcl/wfl-process-definition/submit', 'dcl', 'wfl-process-definition', 'submit', '提交流程定义声明审核', 'ENABLED', '2026-08-29 00:00:00+00', NULL, '2026-08-29 00:00:00+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01KWFL00000000000000000013', '/dcl/wfl-process-definition/unsubmit', 'dcl', 'wfl-process-definition', 'unsubmit', '撤回流程定义声明审核', 'ENABLED', '2026-08-29 00:00:00+00', NULL, '2026-08-29 00:00:00+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01KWFL00000000000000000014', '/dcl/wfl-process-definition/reject', 'dcl', 'wfl-process-definition', 'reject', '审核驳回流程定义声明', 'ENABLED', '2026-08-29 00:00:00+00', NULL, '2026-08-29 00:00:00+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01KWFL00000000000000000015', '/dcl/wfl-process-definition/approve', 'dcl', 'wfl-process-definition', 'approve', '审核通过流程定义声明', 'ENABLED', '2026-08-29 00:00:00+00', NULL, '2026-08-29 00:00:00+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01KWFL00000000000000000016', '/dcl/wfl-process-definition/unapprove', 'dcl', 'wfl-process-definition', 'unapprove', '反审核流程定义声明', 'ENABLED', '2026-08-29 00:00:00+00', NULL, '2026-08-29 00:00:00+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01KWFL00000000000000000017', '/dcl/wfl-process-definition/enable', 'dcl', 'wfl-process-definition', 'enable', '启用流程定义', 'ENABLED', '2026-08-29 00:00:00+00', NULL, '2026-08-29 00:00:00+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01KWFL00000000000000000018', '/dcl/wfl-process-definition/disable', 'dcl', 'wfl-process-definition', 'disable', '停用流程定义', 'ENABLED', '2026-08-29 00:00:00+00', NULL, '2026-08-29 00:00:00+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01KWFL00000000000000000019', '/dcl/wfl-process-definition/create-next', 'dcl', 'wfl-process-definition', 'create-next', '创建下一流程定义声明版本', 'ENABLED', '2026-08-29 00:00:00+00', NULL, '2026-08-29 00:00:00+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01KWFL00000000000000000020', '/dcl/wfl-process-definition/delete-version', 'dcl', 'wfl-process-definition', 'delete-version', '删除流程定义声明草稿版本', 'ENABLED', '2026-08-29 00:00:00+00', NULL, '2026-08-29 00:00:00+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01KWFL00000000000000000021', '/dcl/wfl-process-definition/versions', 'dcl', 'wfl-process-definition', 'versions', '查看流程定义声明版本', 'ENABLED', '2026-08-29 00:00:00+00', NULL, '2026-08-29 00:00:00+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01KWFL00000000000000000022', '/dcl/wfl-process-definition/audit-history', 'dcl', 'wfl-process-definition', 'audit-history', '查看流程定义声明审核记录', 'ENABLED', '2026-08-29 00:00:00+00', NULL, '2026-08-29 00:00:00+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('IC2c4435f69ea3212ccae40054', '/vou/inventory-count/approve', 'vou', 'inventory-count', 'approve', '批准库存盘点单', 'ENABLED', '2026-08-24 15:23:49.566641+00', NULL, '2026-08-24 15:23:49.566641+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('ICffc1d3e27a63c4e98cdc5492', '/vou/inventory-count/unapprove', 'vou', 'inventory-count', 'unapprove', '反批准库存盘点单', 'ENABLED', '2026-08-24 15:23:49.566641+00', NULL, '2026-08-24 15:23:49.566641+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('IC36e546bc5758280fefe3ef6e', '/vou/inventory-count/audit-history', 'vou', 'inventory-count', 'audit-history', '查看库存盘点单审计', 'ENABLED', '2026-08-24 15:23:49.566641+00', NULL, '2026-08-24 15:23:49.566641+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('ICb68222f86419244d6782b862', '/vou/inventory-count/attachment-initiate', 'vou', 'inventory-count', 'attachment-initiate', '发起库存盘点单附件上传', 'ENABLED', '2026-08-24 15:23:49.566641+00', NULL, '2026-08-24 15:23:49.566641+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('IC5df63fa782c679b49b371e01', '/vou/inventory-count/attachment-download', 'vou', 'inventory-count', 'attachment-download', '下载库存盘点单附件', 'ENABLED', '2026-08-24 15:23:49.566641+00', NULL, '2026-08-24 15:23:49.566641+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('ICf12404a3925cf2704dec682b', '/vou/inventory-count/attachment-remove', 'vou', 'inventory-count', 'attachment-remove', '移除库存盘点单附件', 'ENABLED', '2026-08-24 15:23:49.566641+00', NULL, '2026-08-24 15:23:49.566641+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('FAec71758c9dd2e622e2eeb9c1', '/aux/asset-category/get', 'aux', 'asset-category', 'get', '查看资产类别', 'ENABLED', '2026-08-24 15:23:49.574507+00', NULL, '2026-08-24 15:23:49.574507+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('FA42db85ca3ac1900888a5314a', '/aux/asset-category/create', 'aux', 'asset-category', 'create', '创建资产类别', 'ENABLED', '2026-08-24 15:23:49.574507+00', NULL, '2026-08-24 15:23:49.574507+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('FA191e8bf32c35b796790a0387', '/aux/asset-category/save', 'aux', 'asset-category', 'save', '保存资产类别', 'ENABLED', '2026-08-24 15:23:49.574507+00', NULL, '2026-08-24 15:23:49.574507+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('FA1cea6f4036a871113d7ab4e2', '/aux/asset-category/enable', 'aux', 'asset-category', 'enable', '启用资产类别', 'ENABLED', '2026-08-24 15:23:49.574507+00', NULL, '2026-08-24 15:23:49.574507+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('FA7663c7387d23b863bf054179', '/aux/asset-category/disable', 'aux', 'asset-category', 'disable', '停用资产类别', 'ENABLED', '2026-08-24 15:23:49.574507+00', NULL, '2026-08-24 15:23:49.574507+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('FA28b5d1a0401791ba3f34666e', '/aux/asset-category/delete', 'aux', 'asset-category', 'delete', '删除资产类别', 'ENABLED', '2026-08-24 15:23:49.574507+00', NULL, '2026-08-24 15:23:49.574507+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('FV268cd66e0d84485a309c5b3f', '/vou/asset-acquisition/get', 'vou', 'asset-acquisition', 'get', '查看资产购置', 'ENABLED', '2026-08-24 15:23:49.574507+00', NULL, '2026-08-24 15:23:49.574507+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('FVdfd888005612e6510d5193e8', '/vou/asset-sale/get', 'vou', 'asset-sale', 'get', '查看资产出让', 'ENABLED', '2026-08-24 15:23:49.574507+00', NULL, '2026-08-24 15:23:49.574507+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('FV95a60809edd06e22cd114a2b', '/vou/asset-liquidation/get', 'vou', 'asset-liquidation', 'get', '查看资产清算', 'ENABLED', '2026-08-24 15:23:49.574507+00', NULL, '2026-08-24 15:23:49.574507+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('FV9908517a6fd6db5638b0060f', '/vou/asset-acquisition/create', 'vou', 'asset-acquisition', 'create', '创建资产购置', 'ENABLED', '2026-08-24 15:23:49.574507+00', NULL, '2026-08-24 15:23:49.574507+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('FV99dc4694cfc8e480680d762b', '/vou/asset-sale/create', 'vou', 'asset-sale', 'create', '创建资产出让', 'ENABLED', '2026-08-24 15:23:49.574507+00', NULL, '2026-08-24 15:23:49.574507+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('FVc87924d1dadd9070b33665ed', '/vou/asset-liquidation/create', 'vou', 'asset-liquidation', 'create', '创建资产清算', 'ENABLED', '2026-08-24 15:23:49.574507+00', NULL, '2026-08-24 15:23:49.574507+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('FV3532e8bdcdbad8dd7dd72154', '/vou/asset-acquisition/save', 'vou', 'asset-acquisition', 'save', '保存资产购置', 'ENABLED', '2026-08-24 15:23:49.574507+00', NULL, '2026-08-24 15:23:49.574507+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('FV643b3af6c5133680012db40a', '/vou/asset-sale/save', 'vou', 'asset-sale', 'save', '保存资产出让', 'ENABLED', '2026-08-24 15:23:49.574507+00', NULL, '2026-08-24 15:23:49.574507+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('FV5be4fcb4959d795b4b6fd976', '/vou/asset-liquidation/save', 'vou', 'asset-liquidation', 'save', '保存资产清算', 'ENABLED', '2026-08-24 15:23:49.574507+00', NULL, '2026-08-24 15:23:49.574507+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('FV28e03f951f5f2ee3b6775e44', '/vou/asset-acquisition/delete', 'vou', 'asset-acquisition', 'delete', '删除资产购置', 'ENABLED', '2026-08-24 15:23:49.574507+00', NULL, '2026-08-24 15:23:49.574507+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('FV2857dcde30161d7381db0f53', '/vou/asset-sale/delete', 'vou', 'asset-sale', 'delete', '删除资产出让', 'ENABLED', '2026-08-24 15:23:49.574507+00', NULL, '2026-08-24 15:23:49.574507+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('FV77302146e745528b23f4eb75', '/vou/asset-liquidation/delete', 'vou', 'asset-liquidation', 'delete', '删除资产清算', 'ENABLED', '2026-08-24 15:23:49.574507+00', NULL, '2026-08-24 15:23:49.574507+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('FVfec420a9e5a4f00e3333198d', '/vou/asset-acquisition/submit', 'vou', 'asset-acquisition', 'submit', '提交资产购置', 'ENABLED', '2026-08-24 15:23:49.574507+00', NULL, '2026-08-24 15:23:49.574507+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('FVee18a275d852377e9d59d11b', '/vou/asset-sale/submit', 'vou', 'asset-sale', 'submit', '提交资产出让', 'ENABLED', '2026-08-24 15:23:49.574507+00', NULL, '2026-08-24 15:23:49.574507+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('FV45aebc56dc1b58b17b165a87', '/vou/asset-liquidation/submit', 'vou', 'asset-liquidation', 'submit', '提交资产清算', 'ENABLED', '2026-08-24 15:23:49.574507+00', NULL, '2026-08-24 15:23:49.574507+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('FV889700557551578b0e85298d', '/vou/asset-acquisition/unsubmit', 'vou', 'asset-acquisition', 'unsubmit', '撤销提交资产购置', 'ENABLED', '2026-08-24 15:23:49.574507+00', NULL, '2026-08-24 15:23:49.574507+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('FV19418a9c9c0456d39e544c25', '/vou/asset-sale/unsubmit', 'vou', 'asset-sale', 'unsubmit', '撤销提交资产出让', 'ENABLED', '2026-08-24 15:23:49.574507+00', NULL, '2026-08-24 15:23:49.574507+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('FV76646cfc58ea0e2a420f1915', '/vou/asset-liquidation/unsubmit', 'vou', 'asset-liquidation', 'unsubmit', '撤销提交资产清算', 'ENABLED', '2026-08-24 15:23:49.574507+00', NULL, '2026-08-24 15:23:49.574507+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('FV7ebbe6cd8fe309adf031758e', '/vou/asset-acquisition/approve', 'vou', 'asset-acquisition', 'approve', '批准资产购置', 'ENABLED', '2026-08-24 15:23:49.574507+00', NULL, '2026-08-24 15:23:49.574507+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('FVf425305135f8baa6d8343d83', '/vou/asset-sale/approve', 'vou', 'asset-sale', 'approve', '批准资产出让', 'ENABLED', '2026-08-24 15:23:49.574507+00', NULL, '2026-08-24 15:23:49.574507+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('FV623f01638bdd98c3c5cb592c', '/vou/asset-liquidation/approve', 'vou', 'asset-liquidation', 'approve', '批准资产清算', 'ENABLED', '2026-08-24 15:23:49.574507+00', NULL, '2026-08-24 15:23:49.574507+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('FVc48487fea4d87228be34588f', '/vou/asset-acquisition/unapprove', 'vou', 'asset-acquisition', 'unapprove', '撤销批准资产购置', 'ENABLED', '2026-08-24 15:23:49.574507+00', NULL, '2026-08-24 15:23:49.574507+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('FV949cdce411f508889c872e4f', '/vou/asset-sale/unapprove', 'vou', 'asset-sale', 'unapprove', '撤销批准资产出让', 'ENABLED', '2026-08-24 15:23:49.574507+00', NULL, '2026-08-24 15:23:49.574507+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('FVa9ea59188357248ab15505e0', '/vou/asset-liquidation/unapprove', 'vou', 'asset-liquidation', 'unapprove', '撤销批准资产清算', 'ENABLED', '2026-08-24 15:23:49.574507+00', NULL, '2026-08-24 15:23:49.574507+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('FV204dc1f33b0cc36159e1c98c', '/vou/asset-acquisition/audit-history', 'vou', 'asset-acquisition', 'audit-history', '查看审计资产购置', 'ENABLED', '2026-08-24 15:23:49.574507+00', NULL, '2026-08-24 15:23:49.574507+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('FV0f740c1c7843d18db6a2edc9', '/vou/asset-sale/audit-history', 'vou', 'asset-sale', 'audit-history', '查看审计资产出让', 'ENABLED', '2026-08-24 15:23:49.574507+00', NULL, '2026-08-24 15:23:49.574507+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('FV456e155139214d804ea51d70', '/vou/asset-liquidation/audit-history', 'vou', 'asset-liquidation', 'audit-history', '查看审计资产清算', 'ENABLED', '2026-08-24 15:23:49.574507+00', NULL, '2026-08-24 15:23:49.574507+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('FV471116609415ace0cf9d2ff3', '/vou/asset-acquisition/attachment-initiate', 'vou', 'asset-acquisition', 'attachment-initiate', '发起附件上传资产购置', 'ENABLED', '2026-08-24 15:23:49.574507+00', NULL, '2026-08-24 15:23:49.574507+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('FV8d304c23304f79a4e9e9b6f7', '/vou/asset-sale/attachment-initiate', 'vou', 'asset-sale', 'attachment-initiate', '发起附件上传资产出让', 'ENABLED', '2026-08-24 15:23:49.574507+00', NULL, '2026-08-24 15:23:49.574507+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('FV8ace2dae6afa7b5bb0246769', '/vou/asset-liquidation/attachment-initiate', 'vou', 'asset-liquidation', 'attachment-initiate', '发起附件上传资产清算', 'ENABLED', '2026-08-24 15:23:49.574507+00', NULL, '2026-08-24 15:23:49.574507+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('FVa634886f2e6c6c768b564558', '/vou/asset-acquisition/attachment-download', 'vou', 'asset-acquisition', 'attachment-download', '下载附件资产购置', 'ENABLED', '2026-08-24 15:23:49.574507+00', NULL, '2026-08-24 15:23:49.574507+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('FVb9d48a8857c884164fec4cc2', '/vou/asset-sale/attachment-download', 'vou', 'asset-sale', 'attachment-download', '下载附件资产出让', 'ENABLED', '2026-08-24 15:23:49.574507+00', NULL, '2026-08-24 15:23:49.574507+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('FVd071d6b4195f5de3e5f87e93', '/vou/asset-liquidation/attachment-download', 'vou', 'asset-liquidation', 'attachment-download', '下载附件资产清算', 'ENABLED', '2026-08-24 15:23:49.574507+00', NULL, '2026-08-24 15:23:49.574507+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('FV541c83c0535b187a9a5b2ee8', '/vou/asset-acquisition/attachment-remove', 'vou', 'asset-acquisition', 'attachment-remove', '移除附件资产购置', 'ENABLED', '2026-08-24 15:23:49.574507+00', NULL, '2026-08-24 15:23:49.574507+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('FV0353fd50a5b6e877012a155d', '/vou/asset-sale/attachment-remove', 'vou', 'asset-sale', 'attachment-remove', '移除附件资产出让', 'ENABLED', '2026-08-24 15:23:49.574507+00', NULL, '2026-08-24 15:23:49.574507+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('FV233e92f1e9c4a9ffaff93d00', '/vou/asset-liquidation/attachment-remove', 'vou', 'asset-liquidation', 'attachment-remove', '移除附件资产清算', 'ENABLED', '2026-08-24 15:23:49.574507+00', NULL, '2026-08-24 15:23:49.574507+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('PS2d7e89d98b3ed559967cdb55', '/vou/employee-loan-writeoff/get', 'vou', 'employee-loan-writeoff', 'get', '查看费用报销', 'ENABLED', '2026-08-24 15:23:49.601051+00', NULL, '2026-08-24 15:23:49.601051+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('PS58158c0b8be918803c4dfec1', '/vou/employee-loan-writeoff/create', 'vou', 'employee-loan-writeoff', 'create', '创建费用报销', 'ENABLED', '2026-08-24 15:23:49.601051+00', NULL, '2026-08-24 15:23:49.601051+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('PS86e7fbe12e63e2095dd8e5e2', '/vou/employee-loan-writeoff/unapprove', 'vou', 'employee-loan-writeoff', 'unapprove', '反批准费用报销', 'ENABLED', '2026-08-24 15:23:49.601051+00', NULL, '2026-08-24 15:23:49.601051+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('PScae571d259f6217d6d430a0a', '/vou/employee-loan-writeoff/audit-history', 'vou', 'employee-loan-writeoff', 'audit-history', '查看审计费用报销', 'ENABLED', '2026-08-24 15:23:49.601051+00', NULL, '2026-08-24 15:23:49.601051+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('PS4b65b9d72c11d66bb1e7912d', '/vou/employee-loan-writeoff/save', 'vou', 'employee-loan-writeoff', 'save', '保存费用报销', 'ENABLED', '2026-08-24 15:23:49.601051+00', NULL, '2026-08-24 15:23:49.601051+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('PSc52688f125855c0d3767c9ea', '/vou/employee-loan-writeoff/delete', 'vou', 'employee-loan-writeoff', 'delete', '删除草稿费用报销', 'ENABLED', '2026-08-24 15:23:49.601051+00', NULL, '2026-08-24 15:23:49.601051+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('PS8aebb592584e826d71ee60a1', '/vou/employee-loan-writeoff/submit', 'vou', 'employee-loan-writeoff', 'submit', '提交费用报销', 'ENABLED', '2026-08-24 15:23:49.601051+00', NULL, '2026-08-24 15:23:49.601051+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('PS3c3ae981eb3942ec66ac1930', '/vou/employee-loan-writeoff/unsubmit', 'vou', 'employee-loan-writeoff', 'unsubmit', '撤销提交费用报销', 'ENABLED', '2026-08-24 15:23:49.601051+00', NULL, '2026-08-24 15:23:49.601051+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('PS20dff83e98f088f2bde0dcde', '/vou/employee-loan-writeoff/approve', 'vou', 'employee-loan-writeoff', 'approve', '批准费用报销', 'ENABLED', '2026-08-24 15:23:49.601051+00', NULL, '2026-08-24 15:23:49.601051+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('PS160b73ab07849088fec8ffb5', '/vou/employee-loan-writeoff/attachment-initiate', 'vou', 'employee-loan-writeoff', 'attachment-initiate', '发起附件上传费用报销', 'ENABLED', '2026-08-24 15:23:49.601051+00', NULL, '2026-08-24 15:23:49.601051+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('PS3104fd9c196534214e961325', '/vou/employee-loan-writeoff/attachment-download', 'vou', 'employee-loan-writeoff', 'attachment-download', '下载附件费用报销', 'ENABLED', '2026-08-24 15:23:49.601051+00', NULL, '2026-08-24 15:23:49.601051+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('PSda3ce1d083f1a1e888fa98a7', '/vou/employee-loan-writeoff/attachment-remove', 'vou', 'employee-loan-writeoff', 'attachment-remove', '移除附件费用报销', 'ENABLED', '2026-08-24 15:23:49.601051+00', NULL, '2026-08-24 15:23:49.601051+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('PSef7c8d419b41d5e9fbd96f09', '/vou/employee-repayment/get', 'vou', 'employee-repayment', 'get', '查看往来收款', 'ENABLED', '2026-08-24 15:23:49.601051+00', NULL, '2026-08-24 15:23:49.601051+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('PSb789d4b15f39e4c693df0ee5', '/vou/employee-loan/get', 'vou', 'employee-loan', 'get', '查看往来付款', 'ENABLED', '2026-08-24 15:23:49.601051+00', NULL, '2026-08-24 15:23:49.601051+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('PS4eb27210b4a0dd7d22c5c25c', '/vou/employee-repayment/create', 'vou', 'employee-repayment', 'create', '创建往来收款', 'ENABLED', '2026-08-24 15:23:49.601051+00', NULL, '2026-08-24 15:23:49.601051+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('PS1804d402eb6c4f2a82afaa79', '/vou/employee-loan/create', 'vou', 'employee-loan', 'create', '创建往来付款', 'ENABLED', '2026-08-24 15:23:49.601051+00', NULL, '2026-08-24 15:23:49.601051+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('PSe71ecbc21b16318baea6f0b1', '/vou/employee-repayment/unapprove', 'vou', 'employee-repayment', 'unapprove', '反批准往来收款', 'ENABLED', '2026-08-24 15:23:49.601051+00', NULL, '2026-08-24 15:23:49.601051+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('PS93f2e82ea70de9cafe6a9d08', '/vou/employee-loan/unapprove', 'vou', 'employee-loan', 'unapprove', '反批准往来付款', 'ENABLED', '2026-08-24 15:23:49.601051+00', NULL, '2026-08-24 15:23:49.601051+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('PS498998a9fc612f4a1f46401e', '/vou/employee-repayment/audit-history', 'vou', 'employee-repayment', 'audit-history', '查看审计往来收款', 'ENABLED', '2026-08-24 15:23:49.601051+00', NULL, '2026-08-24 15:23:49.601051+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('PS4c60dd5a72643035b88ead97', '/vou/employee-loan/audit-history', 'vou', 'employee-loan', 'audit-history', '查看审计往来付款', 'ENABLED', '2026-08-24 15:23:49.601051+00', NULL, '2026-08-24 15:23:49.601051+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('PS26888bdbe4ab4753402f46df', '/vou/employee-repayment/attachment-initiate', 'vou', 'employee-repayment', 'attachment-initiate', '发起附件上传往来收款', 'ENABLED', '2026-08-24 15:23:49.601051+00', NULL, '2026-08-24 15:23:49.601051+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('PSa2df3e193eb0f1ad04e9ce63', '/vou/employee-loan/attachment-initiate', 'vou', 'employee-loan', 'attachment-initiate', '发起附件上传往来付款', 'ENABLED', '2026-08-24 15:23:49.601051+00', NULL, '2026-08-24 15:23:49.601051+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('PS5e282ca9420c5bae87175f5a', '/vou/employee-repayment/save', 'vou', 'employee-repayment', 'save', '保存往来收款', 'ENABLED', '2026-08-24 15:23:49.601051+00', NULL, '2026-08-24 15:23:49.601051+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('PSd69e054cad26b026b3df402f', '/vou/employee-loan/save', 'vou', 'employee-loan', 'save', '保存往来付款', 'ENABLED', '2026-08-24 15:23:49.601051+00', NULL, '2026-08-24 15:23:49.601051+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('PSc29cff3db564bd3bc4111188', '/vou/employee-repayment/delete', 'vou', 'employee-repayment', 'delete', '删除草稿往来收款', 'ENABLED', '2026-08-24 15:23:49.601051+00', NULL, '2026-08-24 15:23:49.601051+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('PS92972bd359c8476b54086741', '/vou/employee-loan/delete', 'vou', 'employee-loan', 'delete', '删除草稿往来付款', 'ENABLED', '2026-08-24 15:23:49.601051+00', NULL, '2026-08-24 15:23:49.601051+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('PS06d93a2e11e107552ef25be8', '/vou/employee-repayment/submit', 'vou', 'employee-repayment', 'submit', '提交往来收款', 'ENABLED', '2026-08-24 15:23:49.601051+00', NULL, '2026-08-24 15:23:49.601051+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('PSbabdae667dc2369677c1a526', '/vou/employee-loan/submit', 'vou', 'employee-loan', 'submit', '提交往来付款', 'ENABLED', '2026-08-24 15:23:49.601051+00', NULL, '2026-08-24 15:23:49.601051+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('PSeaa9fba996ceeae8c43bf015', '/vou/employee-repayment/unsubmit', 'vou', 'employee-repayment', 'unsubmit', '撤销提交往来收款', 'ENABLED', '2026-08-24 15:23:49.601051+00', NULL, '2026-08-24 15:23:49.601051+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('PS240f04218506a963b79b45b6', '/vou/employee-loan/unsubmit', 'vou', 'employee-loan', 'unsubmit', '撤销提交往来付款', 'ENABLED', '2026-08-24 15:23:49.601051+00', NULL, '2026-08-24 15:23:49.601051+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('PS428969ebd959b202a7cb2a8a', '/vou/employee-repayment/approve', 'vou', 'employee-repayment', 'approve', '批准往来收款', 'ENABLED', '2026-08-24 15:23:49.601051+00', NULL, '2026-08-24 15:23:49.601051+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('PS882e083892bde64c6030165d', '/vou/employee-loan/approve', 'vou', 'employee-loan', 'approve', '批准往来付款', 'ENABLED', '2026-08-24 15:23:49.601051+00', NULL, '2026-08-24 15:23:49.601051+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('PS0df4bd2763812f898b1cc05a', '/vou/employee-repayment/attachment-download', 'vou', 'employee-repayment', 'attachment-download', '下载附件往来收款', 'ENABLED', '2026-08-24 15:23:49.601051+00', NULL, '2026-08-24 15:23:49.601051+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('PSb6b9cdbca6193def45c36203', '/vou/employee-loan/attachment-download', 'vou', 'employee-loan', 'attachment-download', '下载附件往来付款', 'ENABLED', '2026-08-24 15:23:49.601051+00', NULL, '2026-08-24 15:23:49.601051+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('PS9f13fbfae9a142a7aba70c12', '/vou/employee-repayment/attachment-remove', 'vou', 'employee-repayment', 'attachment-remove', '移除附件往来收款', 'ENABLED', '2026-08-24 15:23:49.601051+00', NULL, '2026-08-24 15:23:49.601051+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('PS2fade3ab3b03ec9619235cbf', '/vou/employee-loan/attachment-remove', 'vou', 'employee-loan', 'attachment-remove', '移除附件往来付款', 'ENABLED', '2026-08-24 15:23:49.601051+00', NULL, '2026-08-24 15:23:49.601051+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('BIL1db2a82a850442aaae2b556', '/vou/bill-receipt/get', 'vou', 'bill-receipt', 'get', '查看收票单', 'ENABLED', '2026-08-24 15:23:49.649049+00', NULL, '2026-08-24 15:23:49.649049+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('BILf2d9299f9a39d3a43faea58', '/vou/bill-receipt/create', 'vou', 'bill-receipt', 'create', '创建收票单', 'ENABLED', '2026-08-24 15:23:49.649049+00', NULL, '2026-08-24 15:23:49.649049+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('BIL24a2d27aa1ba62d2a0341aa', '/vou/bill-receipt/save', 'vou', 'bill-receipt', 'save', '保存收票单', 'ENABLED', '2026-08-24 15:23:49.649049+00', NULL, '2026-08-24 15:23:49.649049+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('BIL831ab1b776ce580f7b81544', '/vou/bill-receipt/submit', 'vou', 'bill-receipt', 'submit', '提交收票单', 'ENABLED', '2026-08-24 15:23:49.649049+00', NULL, '2026-08-24 15:23:49.649049+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('BIL20085cedb2039b2d52c1e4c', '/vou/bill-receipt/unsubmit', 'vou', 'bill-receipt', 'unsubmit', '撤销提交收票单', 'ENABLED', '2026-08-24 15:23:49.649049+00', NULL, '2026-08-24 15:23:49.649049+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('BILdc16693ac5e98178451c547', '/vou/bill-receipt/approve', 'vou', 'bill-receipt', 'approve', '批准收票单', 'ENABLED', '2026-08-24 15:23:49.649049+00', NULL, '2026-08-24 15:23:49.649049+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('BIL88cb6e9e1c372dd3df2c5e1', '/vou/bill-receipt/unapprove', 'vou', 'bill-receipt', 'unapprove', '反批准收票单', 'ENABLED', '2026-08-24 15:23:49.649049+00', NULL, '2026-08-24 15:23:49.649049+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('BILa573198ef6fca1ecb3d3972', '/vou/bill-receipt/delete', 'vou', 'bill-receipt', 'delete', '删除收票单', 'ENABLED', '2026-08-24 15:23:49.649049+00', NULL, '2026-08-24 15:23:49.649049+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('BILcc0cb1f7025f724217cd4ff', '/vou/bill-receipt/audit-history', 'vou', 'bill-receipt', 'audit-history', '查看收票单审计', 'ENABLED', '2026-08-24 15:23:49.649049+00', NULL, '2026-08-24 15:23:49.649049+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('BIL0656d7ae57aa551b0750366', '/vou/bill-receipt/attachment-initiate', 'vou', 'bill-receipt', 'attachment-initiate', '上传收票单附件', 'ENABLED', '2026-08-24 15:23:49.649049+00', NULL, '2026-08-24 15:23:49.649049+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('BILfcf6b24b82d4560bc0fca7c', '/vou/bill-receipt/attachment-download', 'vou', 'bill-receipt', 'attachment-download', '下载收票单附件', 'ENABLED', '2026-08-24 15:23:49.649049+00', NULL, '2026-08-24 15:23:49.649049+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('BILeff613d46eefc6d7babe163', '/vou/bill-receipt/attachment-remove', 'vou', 'bill-receipt', 'attachment-remove', '删除收票单附件', 'ENABLED', '2026-08-24 15:23:49.649049+00', NULL, '2026-08-24 15:23:49.649049+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('BLPd3ad5b01bfdd5c076821000', '/vou/bill-payment/get', 'vou', 'bill-payment', 'get', '查看付票单', 'ENABLED', '2026-08-24 15:23:49.666178+00', NULL, '2026-08-24 15:23:49.666178+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('BLP69cc1d5a9aa89dd7d275512', '/vou/bill-payment/create', 'vou', 'bill-payment', 'create', '创建付票单', 'ENABLED', '2026-08-24 15:23:49.666178+00', NULL, '2026-08-24 15:23:49.666178+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('BLP7900c1cc988a3dee5c6439a', '/vou/bill-payment/save', 'vou', 'bill-payment', 'save', '保存付票单', 'ENABLED', '2026-08-24 15:23:49.666178+00', NULL, '2026-08-24 15:23:49.666178+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('BLP4b7151a3b304955ba2854d7', '/vou/bill-payment/submit', 'vou', 'bill-payment', 'submit', '提交付票单', 'ENABLED', '2026-08-24 15:23:49.666178+00', NULL, '2026-08-24 15:23:49.666178+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('BLP84a2abb53e594631c66ecda', '/vou/bill-payment/unsubmit', 'vou', 'bill-payment', 'unsubmit', '撤销提交付票单', 'ENABLED', '2026-08-24 15:23:49.666178+00', NULL, '2026-08-24 15:23:49.666178+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('BLPffcc3c392247936d80a592e', '/vou/bill-payment/approve', 'vou', 'bill-payment', 'approve', '批准付票单', 'ENABLED', '2026-08-24 15:23:49.666178+00', NULL, '2026-08-24 15:23:49.666178+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('BLPffbd5d7b535bc9d779d1329', '/vou/bill-payment/unapprove', 'vou', 'bill-payment', 'unapprove', '反批准付票单', 'ENABLED', '2026-08-24 15:23:49.666178+00', NULL, '2026-08-24 15:23:49.666178+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('BLP500b54c120ea9d74ddf301e', '/vou/bill-payment/delete', 'vou', 'bill-payment', 'delete', '删除付票单', 'ENABLED', '2026-08-24 15:23:49.666178+00', NULL, '2026-08-24 15:23:49.666178+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('BLP82f7e1e5a6f4225aca776ab', '/vou/bill-payment/audit-history', 'vou', 'bill-payment', 'audit-history', '查看付票单审计', 'ENABLED', '2026-08-24 15:23:49.666178+00', NULL, '2026-08-24 15:23:49.666178+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('BLP276c83c7091b83fbc9d450f', '/vou/bill-payment/attachment-initiate', 'vou', 'bill-payment', 'attachment-initiate', '上传付票单附件', 'ENABLED', '2026-08-24 15:23:49.666178+00', NULL, '2026-08-24 15:23:49.666178+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('BLP565829a6249c42eb50ff50b', '/vou/bill-payment/attachment-download', 'vou', 'bill-payment', 'attachment-download', '下载付票单附件', 'ENABLED', '2026-08-24 15:23:49.666178+00', NULL, '2026-08-24 15:23:49.666178+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('BLPd81c4dd2f3c6ab116b47756', '/vou/bill-payment/attachment-remove', 'vou', 'bill-payment', 'attachment-remove', '删除付票单附件', 'ENABLED', '2026-08-24 15:23:49.666178+00', NULL, '2026-08-24 15:23:49.666178+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('BLIce4afc6784eaa28b2af42e5', '/vou/bill-issue/get', 'vou', 'bill-issue', 'get', '查看开票单', 'ENABLED', '2026-08-24 15:23:49.668473+00', NULL, '2026-08-24 15:23:49.668473+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('BLI331f7dd8227d22ef3ed3f58', '/vou/bill-issue/create', 'vou', 'bill-issue', 'create', '创建开票单', 'ENABLED', '2026-08-24 15:23:49.668473+00', NULL, '2026-08-24 15:23:49.668473+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('BLI053b97469b03ef3da791a94', '/vou/bill-issue/save', 'vou', 'bill-issue', 'save', '保存开票单', 'ENABLED', '2026-08-24 15:23:49.668473+00', NULL, '2026-08-24 15:23:49.668473+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('BLI7800f916cfd33395d78023c', '/vou/bill-issue/submit', 'vou', 'bill-issue', 'submit', '提交开票单', 'ENABLED', '2026-08-24 15:23:49.668473+00', NULL, '2026-08-24 15:23:49.668473+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('BLI058489be49de1c40c29b77e', '/vou/bill-issue/unsubmit', 'vou', 'bill-issue', 'unsubmit', '撤销提交开票单', 'ENABLED', '2026-08-24 15:23:49.668473+00', NULL, '2026-08-24 15:23:49.668473+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('BLIe1b89781396dea7851a61a4', '/vou/bill-issue/approve', 'vou', 'bill-issue', 'approve', '批准开票单', 'ENABLED', '2026-08-24 15:23:49.668473+00', NULL, '2026-08-24 15:23:49.668473+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('BLIc03bc649078bc3114b006bb', '/vou/bill-issue/unapprove', 'vou', 'bill-issue', 'unapprove', '反批准开票单', 'ENABLED', '2026-08-24 15:23:49.668473+00', NULL, '2026-08-24 15:23:49.668473+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('BLIfdbd22a519f6d2b83bb9c7c', '/vou/bill-issue/delete', 'vou', 'bill-issue', 'delete', '删除开票单', 'ENABLED', '2026-08-24 15:23:49.668473+00', NULL, '2026-08-24 15:23:49.668473+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('BLIa209e323763e03e38a0babb', '/vou/bill-issue/audit-history', 'vou', 'bill-issue', 'audit-history', '查看开票单审计', 'ENABLED', '2026-08-24 15:23:49.668473+00', NULL, '2026-08-24 15:23:49.668473+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('BLI33551e3bb62a78334d5de74', '/vou/bill-issue/attachment-initiate', 'vou', 'bill-issue', 'attachment-initiate', '上传开票单附件', 'ENABLED', '2026-08-24 15:23:49.668473+00', NULL, '2026-08-24 15:23:49.668473+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('BLI8c52032bf1e4817aabf17c2', '/vou/bill-issue/attachment-download', 'vou', 'bill-issue', 'attachment-download', '下载开票单附件', 'ENABLED', '2026-08-24 15:23:49.668473+00', NULL, '2026-08-24 15:23:49.668473+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('BLI2958cb55cdee8d362a5f1dd', '/vou/bill-issue/attachment-remove', 'vou', 'bill-issue', 'attachment-remove', '删除开票单附件', 'ENABLED', '2026-08-24 15:23:49.668473+00', NULL, '2026-08-24 15:23:49.668473+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('BLDef8c210e4def067672ccc48', '/vou/bill-discount/get', 'vou', 'bill-discount', 'get', '查看贴现单', 'ENABLED', '2026-08-24 15:23:49.670459+00', NULL, '2026-08-24 15:23:49.670459+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('BLD670416d3dd58d865d754a48', '/vou/bill-discount/create', 'vou', 'bill-discount', 'create', '创建贴现单', 'ENABLED', '2026-08-24 15:23:49.670459+00', NULL, '2026-08-24 15:23:49.670459+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('BLD4c5fc405d992a4d92800132', '/vou/bill-discount/save', 'vou', 'bill-discount', 'save', '保存贴现单', 'ENABLED', '2026-08-24 15:23:49.670459+00', NULL, '2026-08-24 15:23:49.670459+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('BLD8c3e5f3bc9ddfb923924de2', '/vou/bill-discount/submit', 'vou', 'bill-discount', 'submit', '提交贴现单', 'ENABLED', '2026-08-24 15:23:49.670459+00', NULL, '2026-08-24 15:23:49.670459+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('BLDf426f96ed1bacbefdb4ae7d', '/vou/bill-discount/unsubmit', 'vou', 'bill-discount', 'unsubmit', '撤销提交贴现单', 'ENABLED', '2026-08-24 15:23:49.670459+00', NULL, '2026-08-24 15:23:49.670459+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('BLD7140237899399e80efc0452', '/vou/bill-discount/approve', 'vou', 'bill-discount', 'approve', '批准贴现单', 'ENABLED', '2026-08-24 15:23:49.670459+00', NULL, '2026-08-24 15:23:49.670459+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('BLD4738da1d51561c2db596cb6', '/vou/bill-discount/unapprove', 'vou', 'bill-discount', 'unapprove', '反批准贴现单', 'ENABLED', '2026-08-24 15:23:49.670459+00', NULL, '2026-08-24 15:23:49.670459+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('BLD3e079a49974af2a8ad84d63', '/vou/bill-discount/delete', 'vou', 'bill-discount', 'delete', '删除贴现单', 'ENABLED', '2026-08-24 15:23:49.670459+00', NULL, '2026-08-24 15:23:49.670459+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('BLD03195ced7fb54332dddc9c9', '/vou/bill-discount/audit-history', 'vou', 'bill-discount', 'audit-history', '查看贴现单审计', 'ENABLED', '2026-08-24 15:23:49.670459+00', NULL, '2026-08-24 15:23:49.670459+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('BLDd6a4704b792cef1c6ef8bbf', '/vou/bill-discount/attachment-initiate', 'vou', 'bill-discount', 'attachment-initiate', '上传贴现单附件', 'ENABLED', '2026-08-24 15:23:49.670459+00', NULL, '2026-08-24 15:23:49.670459+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('BLDc27933da07ba87477b0e0de', '/vou/bill-discount/attachment-download', 'vou', 'bill-discount', 'attachment-download', '下载贴现单附件', 'ENABLED', '2026-08-24 15:23:49.670459+00', NULL, '2026-08-24 15:23:49.670459+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('BLDeba6558f85cd28c35337b48', '/vou/bill-discount/attachment-remove', 'vou', 'bill-discount', 'attachment-remove', '删除贴现单附件', 'ENABLED', '2026-08-24 15:23:49.670459+00', NULL, '2026-08-24 15:23:49.670459+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('BLMf3d6599a0367c05ed5ee4dc', '/vou/bill-maturity/get', 'vou', 'bill-maturity', 'get', '查看到期单', 'ENABLED', '2026-08-24 15:23:49.672191+00', NULL, '2026-08-24 15:23:49.672191+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('BLM404392ddb242d28bdeb4368', '/vou/bill-maturity/create', 'vou', 'bill-maturity', 'create', '创建到期单', 'ENABLED', '2026-08-24 15:23:49.672191+00', NULL, '2026-08-24 15:23:49.672191+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('BLM774f0ab4de296ce3bd9e22a', '/vou/bill-maturity/save', 'vou', 'bill-maturity', 'save', '保存到期单', 'ENABLED', '2026-08-24 15:23:49.672191+00', NULL, '2026-08-24 15:23:49.672191+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('BLM23e5e27ef07f112e3e2b7e8', '/vou/bill-maturity/submit', 'vou', 'bill-maturity', 'submit', '提交到期单', 'ENABLED', '2026-08-24 15:23:49.672191+00', NULL, '2026-08-24 15:23:49.672191+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('BLMdd19830965bb179e21139ce', '/vou/bill-maturity/unsubmit', 'vou', 'bill-maturity', 'unsubmit', '撤销提交到期单', 'ENABLED', '2026-08-24 15:23:49.672191+00', NULL, '2026-08-24 15:23:49.672191+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('BLMccc20408da12e6cd3e1cfcd', '/vou/bill-maturity/approve', 'vou', 'bill-maturity', 'approve', '批准到期单', 'ENABLED', '2026-08-24 15:23:49.672191+00', NULL, '2026-08-24 15:23:49.672191+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('BLM1651a266f0717ff95f5b927', '/vou/bill-maturity/unapprove', 'vou', 'bill-maturity', 'unapprove', '反批准到期单', 'ENABLED', '2026-08-24 15:23:49.672191+00', NULL, '2026-08-24 15:23:49.672191+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('BLMd71156b4e025fac02bd234f', '/vou/bill-maturity/delete', 'vou', 'bill-maturity', 'delete', '删除到期单', 'ENABLED', '2026-08-24 15:23:49.672191+00', NULL, '2026-08-24 15:23:49.672191+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('BLM53f8457404967b82477a58b', '/vou/bill-maturity/audit-history', 'vou', 'bill-maturity', 'audit-history', '查看到期单审计', 'ENABLED', '2026-08-24 15:23:49.672191+00', NULL, '2026-08-24 15:23:49.672191+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('BLMfb726ab2e00fe482748d897', '/vou/bill-maturity/attachment-initiate', 'vou', 'bill-maturity', 'attachment-initiate', '上传到期单附件', 'ENABLED', '2026-08-24 15:23:49.672191+00', NULL, '2026-08-24 15:23:49.672191+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('BLMcbaa62f3e2a06ba2bc13971', '/vou/bill-maturity/attachment-download', 'vou', 'bill-maturity', 'attachment-download', '下载到期单附件', 'ENABLED', '2026-08-24 15:23:49.672191+00', NULL, '2026-08-24 15:23:49.672191+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('BLM3ef2b857d560a968255eb17', '/vou/bill-maturity/attachment-remove', 'vou', 'bill-maturity', 'attachment-remove', '删除到期单附件', 'ENABLED', '2026-08-24 15:23:49.672191+00', NULL, '2026-08-24 15:23:49.672191+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JAPPSYSPARAM000000000001', '/app/system-parameter/query', 'app', 'system-parameter', 'query', '查询系统参数', 'ENABLED', '2026-08-24 15:23:49.673922+00', NULL, '2026-08-24 15:23:49.673922+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JAPPSYSPARAM000000000002', '/app/system-parameter/get', 'app', 'system-parameter', 'get', '查看系统参数', 'ENABLED', '2026-08-24 15:23:49.673922+00', NULL, '2026-08-24 15:23:49.673922+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JAPPSYSPARAM000000000003', '/app/system-parameter/save', 'app', 'system-parameter', 'save', '修改系统参数', 'ENABLED', '2026-08-24 15:23:49.673922+00', NULL, '2026-08-24 15:23:49.673922+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JAPPSYSPARAM000000000004', '/app/system-parameter/reset', 'app', 'system-parameter', 'reset', '恢复系统参数默认值', 'ENABLED', '2026-08-24 15:23:49.673922+00', NULL, '2026-08-24 15:23:49.673922+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('FA8828b93f923b7bbf4ca5f57e', '/aux/asset-category/query', 'aux', 'asset-category', 'query', '查询资产类别', 'ENABLED', '2026-08-24 15:23:49.574507+00', NULL, '2026-08-24 15:23:49.574507+00', NULL, 1, 5);
INSERT INTO public.app_permissions VALUES ('01JAUX00000000000000000201', '/aux/product-type/query', 'aux', 'product-type', 'query', '查询产品类型', 'ENABLED', '2026-08-24 15:23:49.336221+00', NULL, '2026-08-24 15:23:49.336221+00', NULL, 1, 15);
INSERT INTO public.app_permissions VALUES ('01JAUX00000000000000000061', '/aux/position/query', 'aux', 'position', 'query', '查询岗位', 'ENABLED', '2026-08-24 15:23:49.336221+00', NULL, '2026-08-24 15:23:49.336221+00', NULL, 1, 30);
INSERT INTO public.app_permissions VALUES ('PR84f28f848bfed30cda4ffe25', '/vou/sale-pricing/query', 'vou', 'sale-pricing', 'query', '查询销售定价', 'ENABLED', '2026-08-24 15:23:49.505114+00', NULL, '2026-08-24 15:23:49.505114+00', NULL, 1, 5);
INSERT INTO public.app_permissions VALUES ('SR0cc7b2b2279ff51918671cb7', '/vou/sale-return/query', 'vou', 'sale-return', 'query', '查询销售退货', 'ENABLED', '2026-08-24 15:23:49.390761+00', NULL, '2026-08-24 15:23:49.390761+00', NULL, 1, 50);
INSERT INTO public.app_permissions VALUES ('IC89f093f10c462c09d1ae38d4', '/vou/inventory-count/query', 'vou', 'inventory-count', 'query', '查询库存盘点单', 'ENABLED', '2026-08-24 15:23:49.566641+00', NULL, '2026-08-24 15:23:49.566641+00', NULL, 1, 57);
INSERT INTO public.app_permissions VALUES ('PRdae51a6d56564990ca38e555', '/vou/purchase-inquiry/query', 'vou', 'purchase-inquiry', 'query', '查询采购询价', 'ENABLED', '2026-08-24 15:23:49.505114+00', NULL, '2026-08-24 15:23:49.505114+00', NULL, 1, 58);
INSERT INTO public.app_permissions VALUES ('PR432235621d55950d1a55077a', '/vou/purchase-return/query', 'vou', 'purchase-return', 'query', '查询采购退货', 'ENABLED', '2026-08-24 15:23:49.401432+00', NULL, '2026-08-24 15:23:49.401432+00', NULL, 1, 75);
INSERT INTO public.app_permissions VALUES ('PS739f85425193b918425f6cdb', '/vou/other-receipt/query', 'vou', 'other-receipt', 'query', '查询往来收款', 'ENABLED', '2026-08-24 15:23:49.547238+00', NULL, '2026-08-24 15:23:49.547238+00', NULL, 1, 82);
INSERT INTO public.app_permissions VALUES ('PS42d976e946fd0924ef4afe2e', '/vou/other-payment/query', 'vou', 'other-payment', 'query', '查询往来付款', 'ENABLED', '2026-08-24 15:23:49.547238+00', NULL, '2026-08-24 15:23:49.547238+00', NULL, 1, 92);
INSERT INTO public.app_permissions VALUES ('PS5e212b1d141c1c3c2d509660', '/vou/employee-loan/query', 'vou', 'employee-loan', 'query', '查询往来付款', 'ENABLED', '2026-08-24 15:23:49.601051+00', NULL, '2026-08-24 15:23:49.601051+00', NULL, 1, 95);
INSERT INTO public.app_permissions VALUES ('PS3bd947b83fdff1c25cb715f1', '/vou/employee-repayment/query', 'vou', 'employee-repayment', 'query', '查询往来收款', 'ENABLED', '2026-08-24 15:23:49.601051+00', NULL, '2026-08-24 15:23:49.601051+00', NULL, 1, 96);
INSERT INTO public.app_permissions VALUES ('PS5b015983b59d204a89b0d42d', '/vou/employee-loan-writeoff/query', 'vou', 'employee-loan-writeoff', 'query', '查询费用报销', 'ENABLED', '2026-08-24 15:23:49.601051+00', NULL, '2026-08-24 15:23:49.601051+00', NULL, 1, 97);
INSERT INTO public.app_permissions VALUES ('VE40feac753fda38eef3f23497', '/vou/expense-payment/query', 'vou', 'expense-payment', 'query', '查询费用付款', 'ENABLED', '2026-08-24 15:23:49.521804+00', NULL, '2026-08-24 15:23:49.521804+00', NULL, 1, 105);
INSERT INTO public.app_permissions VALUES ('FVe3c81cd3834511d642b9fed3', '/vou/asset-acquisition/query', 'vou', 'asset-acquisition', 'query', '查询资产购置', 'ENABLED', '2026-08-24 15:23:49.574507+00', NULL, '2026-08-24 15:23:49.574507+00', NULL, 1, 120);
INSERT INTO public.app_permissions VALUES ('FV0857f02549d36fb095486e1b', '/vou/asset-sale/query', 'vou', 'asset-sale', 'query', '查询资产出让', 'ENABLED', '2026-08-24 15:23:49.574507+00', NULL, '2026-08-24 15:23:49.574507+00', NULL, 1, 122);
INSERT INTO public.app_permissions VALUES ('FV88eb25c53eccf4fc7fa4acc9', '/vou/asset-liquidation/query', 'vou', 'asset-liquidation', 'query', '查询资产清算', 'ENABLED', '2026-08-24 15:23:49.574507+00', NULL, '2026-08-24 15:23:49.574507+00', NULL, 1, 123);
INSERT INTO public.app_permissions VALUES ('BIL595c3b05b51a4dac9f8aad3', '/vou/bill-receipt/query', 'vou', 'bill-receipt', 'query', '查询收票单', 'ENABLED', '2026-08-24 15:23:49.649049+00', NULL, '2026-08-24 15:23:49.649049+00', NULL, 1, 130);
INSERT INTO public.app_permissions VALUES ('BLPce0c5b635d5e95ff6bc3d56', '/vou/bill-payment/query', 'vou', 'bill-payment', 'query', '查询付票单', 'ENABLED', '2026-08-24 15:23:49.666178+00', NULL, '2026-08-24 15:23:49.666178+00', NULL, 1, 131);
INSERT INTO public.app_permissions VALUES ('BLI3b69ce040432ecb10281b2a', '/vou/bill-issue/query', 'vou', 'bill-issue', 'query', '查询开票单', 'ENABLED', '2026-08-24 15:23:49.668473+00', NULL, '2026-08-24 15:23:49.668473+00', NULL, 1, 132);
INSERT INTO public.app_permissions VALUES ('BLD4ee74dc89503298cca0a37c', '/vou/bill-discount/query', 'vou', 'bill-discount', 'query', '查询贴现单', 'ENABLED', '2026-08-24 15:23:49.670459+00', NULL, '2026-08-24 15:23:49.670459+00', NULL, 1, 133);
INSERT INTO public.app_permissions VALUES ('BLMb480f70b23ca0ffe77a53d2', '/vou/bill-maturity/query', 'vou', 'bill-maturity', 'query', '查询到期单', 'ENABLED', '2026-08-24 15:23:49.672191+00', NULL, '2026-08-24 15:23:49.672191+00', NULL, 1, 134);
INSERT INTO public.app_permissions VALUES ('01JAPPMENU0000000000000001', '/app/menu/save-business', 'app', 'menu', 'save-business', '保存业务菜单模板', 'ENABLED', '2026-08-24 15:23:49.677744+00', NULL, '2026-08-24 15:23:49.677744+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JAPPMENU0000000000000002', '/app/menu/activate', 'app', 'menu', 'activate', '切换菜单模式', 'ENABLED', '2026-08-24 15:23:49.677744+00', NULL, '2026-08-24 15:23:49.677744+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JAPPMENU0000000000000003', '/app/menu/reset-business', 'app', 'menu', 'reset-business', '恢复初始业务菜单模板', 'ENABLED', '2026-08-24 15:23:49.677744+00', NULL, '2026-08-24 15:23:49.677744+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('ICL9d55f48b21cad0f87fab6a6', '/vou/intermediary-calculation/query', 'vou', 'intermediary-calculation', 'query', '查询居间计算', 'ENABLED', '2026-08-24 15:23:49.702898+00', NULL, '2026-08-24 15:23:49.702898+00', NULL, 1, 45);
INSERT INTO public.app_permissions VALUES ('ICL45e2c4ff2d01a74555c738a', '/vou/intermediary-calculation/get', 'vou', 'intermediary-calculation', 'get', '查看居间计算', 'ENABLED', '2026-08-24 15:23:49.702898+00', NULL, '2026-08-24 15:23:49.702898+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('ICL6b1ae1572c634727d7ad83e', '/vou/intermediary-calculation/create', 'vou', 'intermediary-calculation', 'create', '创建居间计算', 'ENABLED', '2026-08-24 15:23:49.702898+00', NULL, '2026-08-24 15:23:49.702898+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('ICLcf85f025cd59eb2a6814683', '/vou/intermediary-calculation/save', 'vou', 'intermediary-calculation', 'save', '保存居间计算', 'ENABLED', '2026-08-24 15:23:49.702898+00', NULL, '2026-08-24 15:23:49.702898+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('ICLe467079dc4817527662e2fa', '/vou/intermediary-calculation/submit', 'vou', 'intermediary-calculation', 'submit', '提交居间计算', 'ENABLED', '2026-08-24 15:23:49.702898+00', NULL, '2026-08-24 15:23:49.702898+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('ICL42cbb05a7d25bbeb4669a01', '/vou/intermediary-calculation/unsubmit', 'vou', 'intermediary-calculation', 'unsubmit', '撤销提交居间计算', 'ENABLED', '2026-08-24 15:23:49.702898+00', NULL, '2026-08-24 15:23:49.702898+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('ICL470dd41074d392b2aa91f76', '/vou/intermediary-calculation/approve', 'vou', 'intermediary-calculation', 'approve', '批准居间计算', 'ENABLED', '2026-08-24 15:23:49.702898+00', NULL, '2026-08-24 15:23:49.702898+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('ICL83a8bc3e4565344e325fcff', '/vou/intermediary-calculation/unapprove', 'vou', 'intermediary-calculation', 'unapprove', '反批准居间计算', 'ENABLED', '2026-08-24 15:23:49.702898+00', NULL, '2026-08-24 15:23:49.702898+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('ICLe1c76a1b072cc6ced980918', '/vou/intermediary-calculation/delete', 'vou', 'intermediary-calculation', 'delete', '删除居间计算', 'ENABLED', '2026-08-24 15:23:49.702898+00', NULL, '2026-08-24 15:23:49.702898+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('ICLd6d44977e2b9b544bd1f967', '/vou/intermediary-calculation/audit-history', 'vou', 'intermediary-calculation', 'audit-history', '查看居间计算审计', 'ENABLED', '2026-08-24 15:23:49.702898+00', NULL, '2026-08-24 15:23:49.702898+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('ICL034026cc7f826e657bbd7bf', '/vou/intermediary-calculation/attachment-initiate', 'vou', 'intermediary-calculation', 'attachment-initiate', '上传居间计算附件', 'ENABLED', '2026-08-24 15:23:49.702898+00', NULL, '2026-08-24 15:23:49.702898+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('WG766d7129dcc7b17ec75871ae', '/wfl/process-definition/query', 'wfl', 'process-definition', 'query', '查询流程定义', 'ENABLED', '2026-08-24 15:23:49.521804+00', NULL, '2026-08-24 15:23:50.02923+00', NULL, 1, 10);
INSERT INTO public.app_permissions VALUES ('WGec1f75a2e7c1f36f93ff1291', '/wfl/process-instance/query', 'wfl', 'process-instance', 'query', '查询流程实例', 'ENABLED', '2026-08-24 15:23:49.521804+00', NULL, '2026-08-24 15:23:50.02923+00', NULL, 1, 20);
INSERT INTO public.app_permissions VALUES ('ICL53397473ded1713af5d286e', '/vou/intermediary-calculation/attachment-download', 'vou', 'intermediary-calculation', 'attachment-download', '下载居间计算附件', 'ENABLED', '2026-08-24 15:23:49.702898+00', NULL, '2026-08-24 15:23:49.702898+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('ICL473528590f3c565785f40e3', '/vou/intermediary-calculation/attachment-remove', 'vou', 'intermediary-calculation', 'attachment-remove', '删除居间计算附件', 'ENABLED', '2026-08-24 15:23:49.702898+00', NULL, '2026-08-24 15:23:49.702898+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('ICL26de58f01335b9bc8d85958', '/vou/intermediary-calculation/source', 'vou', 'intermediary-calculation', 'source', '生成居间计算来源', 'ENABLED', '2026-08-24 15:23:49.702898+00', NULL, '2026-08-24 15:23:49.702898+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('ICLf57ef9d7b581b521d2f6071', '/vou/intermediary-calculation/script-get', 'vou', 'intermediary-calculation', 'script-get', '读取居间计算脚本', 'ENABLED', '2026-08-24 15:23:49.702898+00', NULL, '2026-08-24 15:23:49.702898+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('ICL42b7850485903f370d37b7e', '/vou/intermediary-calculation/script-save', 'vou', 'intermediary-calculation', 'script-save', '保存居间计算脚本', 'ENABLED', '2026-08-24 15:23:49.702898+00', NULL, '2026-08-24 15:23:49.702898+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('PS42bbf2385bfcbb22ad66db73', '/vou/sales-refund/get', 'vou', 'sales-refund', 'get', '查看往来付款', 'ENABLED', '2026-08-24 15:23:49.547238+00', NULL, '2026-08-24 15:23:49.547238+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('PSba789d9bdab734526f8ac453', '/vou/purchase-refund/create', 'vou', 'purchase-refund', 'create', '创建往来收款', 'ENABLED', '2026-08-24 15:23:49.547238+00', NULL, '2026-08-24 15:23:49.547238+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('PS6fcb1136d1d42d00581844e0', '/vou/sales-receipt/create', 'vou', 'sales-receipt', 'create', '创建往来收款', 'ENABLED', '2026-08-24 15:23:49.547238+00', NULL, '2026-08-24 15:23:49.547238+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('PS6c642de752b974586aaf2dc1', '/vou/purchase-payment/create', 'vou', 'purchase-payment', 'create', '创建往来付款', 'ENABLED', '2026-08-24 15:23:49.547238+00', NULL, '2026-08-24 15:23:49.547238+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('PSa5ee49cb12c32e2da9f5fc37', '/vou/sales-refund/create', 'vou', 'sales-refund', 'create', '创建往来付款', 'ENABLED', '2026-08-24 15:23:49.547238+00', NULL, '2026-08-24 15:23:49.547238+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('PSba2c5a0626dbab8be2d76fb6', '/vou/purchase-refund/unapprove', 'vou', 'purchase-refund', 'unapprove', '反批准往来收款', 'ENABLED', '2026-08-24 15:23:49.547238+00', NULL, '2026-08-24 15:23:49.547238+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('PSfef82c34ad389cabe0b91316', '/vou/sales-receipt/unapprove', 'vou', 'sales-receipt', 'unapprove', '反批准往来收款', 'ENABLED', '2026-08-24 15:23:49.547238+00', NULL, '2026-08-24 15:23:49.547238+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('PS6540f31fe23f98ae13441fab', '/vou/purchase-payment/unapprove', 'vou', 'purchase-payment', 'unapprove', '反批准往来付款', 'ENABLED', '2026-08-24 15:23:49.547238+00', NULL, '2026-08-24 15:23:49.547238+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('PScde9bbc60c088003c4a2cce8', '/vou/sales-refund/unapprove', 'vou', 'sales-refund', 'unapprove', '反批准往来付款', 'ENABLED', '2026-08-24 15:23:49.547238+00', NULL, '2026-08-24 15:23:49.547238+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('PSaee89278fe0ab28b3366f846', '/vou/purchase-refund/audit-history', 'vou', 'purchase-refund', 'audit-history', '查看审计往来收款', 'ENABLED', '2026-08-24 15:23:49.547238+00', NULL, '2026-08-24 15:23:49.547238+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('PS7341bd89c26c805405ca5311', '/vou/sales-receipt/audit-history', 'vou', 'sales-receipt', 'audit-history', '查看审计往来收款', 'ENABLED', '2026-08-24 15:23:49.547238+00', NULL, '2026-08-24 15:23:49.547238+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('PS6f150470831dfedcecb7ab20', '/vou/purchase-payment/audit-history', 'vou', 'purchase-payment', 'audit-history', '查看审计往来付款', 'ENABLED', '2026-08-24 15:23:49.547238+00', NULL, '2026-08-24 15:23:49.547238+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('PS2b45f28cbea8ca266e299ac2', '/vou/sales-refund/audit-history', 'vou', 'sales-refund', 'audit-history', '查看审计往来付款', 'ENABLED', '2026-08-24 15:23:49.547238+00', NULL, '2026-08-24 15:23:49.547238+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('PS633cdf0848f9557711f046cd', '/vou/purchase-refund/attachment-initiate', 'vou', 'purchase-refund', 'attachment-initiate', '发起附件上传往来收款', 'ENABLED', '2026-08-24 15:23:49.547238+00', NULL, '2026-08-24 15:23:49.547238+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('PS86fb7a6ff1857037d7c059d2', '/vou/sales-receipt/attachment-initiate', 'vou', 'sales-receipt', 'attachment-initiate', '发起附件上传往来收款', 'ENABLED', '2026-08-24 15:23:49.547238+00', NULL, '2026-08-24 15:23:49.547238+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('PS9f66cf0946c5ce37ee03daa5', '/vou/purchase-payment/delete', 'vou', 'purchase-payment', 'delete', '删除草稿往来付款', 'ENABLED', '2026-08-24 15:23:49.547238+00', NULL, '2026-08-24 15:23:49.547238+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('PS62f6db80b8434a70c38c8a88', '/vou/sales-refund/delete', 'vou', 'sales-refund', 'delete', '删除草稿往来付款', 'ENABLED', '2026-08-24 15:23:49.547238+00', NULL, '2026-08-24 15:23:49.547238+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('PS5df45b2c63006c32c92b22fb', '/vou/purchase-refund/submit', 'vou', 'purchase-refund', 'submit', '提交往来收款', 'ENABLED', '2026-08-24 15:23:49.547238+00', NULL, '2026-08-24 15:23:49.547238+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('PS474cb3c6975555a19b0a46bc', '/vou/sales-receipt/submit', 'vou', 'sales-receipt', 'submit', '提交往来收款', 'ENABLED', '2026-08-24 15:23:49.547238+00', NULL, '2026-08-24 15:23:49.547238+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('PSf73d05e41b40564c0ad5178f', '/vou/purchase-payment/submit', 'vou', 'purchase-payment', 'submit', '提交往来付款', 'ENABLED', '2026-08-24 15:23:49.547238+00', NULL, '2026-08-24 15:23:49.547238+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('PS06c7f3cf914ac8df278d28ee', '/vou/sales-refund/submit', 'vou', 'sales-refund', 'submit', '提交往来付款', 'ENABLED', '2026-08-24 15:23:49.547238+00', NULL, '2026-08-24 15:23:49.547238+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('PS4222795453181f926b5e09d4', '/vou/purchase-refund/unsubmit', 'vou', 'purchase-refund', 'unsubmit', '撤销提交往来收款', 'ENABLED', '2026-08-24 15:23:49.547238+00', NULL, '2026-08-24 15:23:49.547238+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('PS691e162c5e052efeff772258', '/vou/sales-receipt/unsubmit', 'vou', 'sales-receipt', 'unsubmit', '撤销提交往来收款', 'ENABLED', '2026-08-24 15:23:49.547238+00', NULL, '2026-08-24 15:23:49.547238+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('PS6db352d644573dae90511096', '/vou/purchase-payment/unsubmit', 'vou', 'purchase-payment', 'unsubmit', '撤销提交往来付款', 'ENABLED', '2026-08-24 15:23:49.547238+00', NULL, '2026-08-24 15:23:49.547238+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('PSb95efcac53484f97efa9e36c', '/vou/sales-receipt/query', 'vou', 'sales-receipt', 'query', '查询往来收款', 'ENABLED', '2026-08-24 15:23:49.547238+00', NULL, '2026-08-24 15:23:49.547238+00', NULL, 1, 80);
INSERT INTO public.app_permissions VALUES ('PSde0ef0300803f46bdf52656d', '/vou/purchase-refund/query', 'vou', 'purchase-refund', 'query', '查询往来收款', 'ENABLED', '2026-08-24 15:23:49.547238+00', NULL, '2026-08-24 15:23:49.547238+00', NULL, 1, 81);
INSERT INTO public.app_permissions VALUES ('PS6be909c8a6361edee9988053', '/vou/sales-refund/query', 'vou', 'sales-refund', 'query', '查询往来付款', 'ENABLED', '2026-08-24 15:23:49.547238+00', NULL, '2026-08-24 15:23:49.547238+00', NULL, 1, 90);
INSERT INTO public.app_permissions VALUES ('PSd89abba3dddbbab1e37b77a2', '/vou/purchase-payment/query', 'vou', 'purchase-payment', 'query', '查询往来付款', 'ENABLED', '2026-08-24 15:23:49.547238+00', NULL, '2026-08-24 15:23:49.547238+00', NULL, 1, 91);
INSERT INTO public.app_permissions VALUES ('01JACCBOOK0000000000000001', '/acc/book/query', 'acc', 'book', 'query', '查询会计账簿', 'ENABLED', '2026-08-24 15:23:49.765844+00', NULL, '2026-08-24 15:23:49.765844+00', NULL, 1, 10);
INSERT INTO public.app_permissions VALUES ('01JACCBOOK0000000000000002', '/acc/book/get', 'acc', 'book', 'get', '查看会计账簿', 'ENABLED', '2026-08-24 15:23:49.765844+00', NULL, '2026-08-24 15:23:49.765844+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JACCBOOK0000000000000003', '/acc/book/create', 'acc', 'book', 'create', '创建会计账簿', 'ENABLED', '2026-08-24 15:23:49.765844+00', NULL, '2026-08-24 15:23:49.765844+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JACCBOOK0000000000000004', '/acc/book/save', 'acc', 'book', 'save', '修改会计账簿', 'ENABLED', '2026-08-24 15:23:49.765844+00', NULL, '2026-08-24 15:23:49.765844+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JACCBOOK0000000000000005', '/acc/book/delete', 'acc', 'book', 'delete', '删除会计账簿', 'ENABLED', '2026-08-24 15:23:49.765844+00', NULL, '2026-08-24 15:23:49.765844+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JACC00000000000000000101', '/acc/subject/query', 'acc', 'subject', 'query', '查询会计科目', 'ENABLED', '2026-08-24 15:23:49.772282+00', NULL, '2026-08-24 15:23:49.772282+00', NULL, 1, 20);
INSERT INTO public.app_permissions VALUES ('01JACC00000000000000000102', '/acc/subject/get', 'acc', 'subject', 'get', '查看会计科目', 'ENABLED', '2026-08-24 15:23:49.772282+00', NULL, '2026-08-24 15:23:49.772282+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JACC00000000000000000103', '/acc/subject/create', 'acc', 'subject', 'create', '创建会计科目', 'ENABLED', '2026-08-24 15:23:49.772282+00', NULL, '2026-08-24 15:23:49.772282+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JACC00000000000000000104', '/acc/subject/save', 'acc', 'subject', 'save', '修改会计科目', 'ENABLED', '2026-08-24 15:23:49.772282+00', NULL, '2026-08-24 15:23:49.772282+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JACC00000000000000000105', '/acc/subject/delete', 'acc', 'subject', 'delete', '删除会计科目', 'ENABLED', '2026-08-24 15:23:49.772282+00', NULL, '2026-08-24 15:23:49.772282+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01KRPT00000000000000000001', '/dcl/rpt-definition/query', 'dcl', 'rpt-definition', 'query', '查询报表定义声明', 'ENABLED', '2026-08-24 15:23:49.887333+00', NULL, '2026-08-29 00:00:00+00', NULL, 2, 80);
INSERT INTO public.app_permissions VALUES ('01KRPT00000000000000000002', '/dcl/rpt-definition/get', 'dcl', 'rpt-definition', 'get', '查看报表定义声明', 'ENABLED', '2026-08-24 15:23:49.887333+00', NULL, '2026-08-29 00:00:00+00', NULL, 2, NULL);
INSERT INTO public.app_permissions VALUES ('01KWFL00000000000000000008', '/dcl/wfl-process-definition/query', 'dcl', 'wfl-process-definition', 'query', '查询流程定义声明', 'ENABLED', '2026-08-29 00:00:00+00', NULL, '2026-08-29 00:00:00+00', NULL, 1, 90);
INSERT INTO public.app_permissions VALUES ('01KWFL00000000000000000009', '/dcl/wfl-process-definition/get', 'dcl', 'wfl-process-definition', 'get', '查看流程定义声明', 'ENABLED', '2026-08-29 00:00:00+00', NULL, '2026-08-29 00:00:00+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('RPP7a626dbdbe5d3a35df07791', '/rpt/account-journal/query', 'rpt', 'account-journal', 'query', '查询科目流水', 'ENABLED', '2026-08-24 15:23:49.887333+00', NULL, '2026-08-24 15:23:49.887333+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('RPPec001420157de7fdaba47ff', '/rpt/account-journal/export', 'rpt', 'account-journal', 'export', '导出科目流水', 'ENABLED', '2026-08-24 15:23:49.887333+00', NULL, '2026-08-24 15:23:49.887333+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('RPPd42dcb1aab9083fd01a9dd8', '/rpt/subject-balance/query', 'rpt', 'subject-balance', 'query', '查询科目余额', 'ENABLED', '2026-08-24 15:23:49.887333+00', NULL, '2026-08-24 15:23:49.887333+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('RPPe1b13cf217aeb543ad5a90d', '/rpt/subject-balance/export', 'rpt', 'subject-balance', 'export', '导出科目余额', 'ENABLED', '2026-08-24 15:23:49.887333+00', NULL, '2026-08-24 15:23:49.887333+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('RPP68c9efd581302ee194168f6', '/rpt/customer-aging/query', 'rpt', 'customer-aging', 'query', '查询客户应收预收账龄', 'ENABLED', '2026-08-24 15:23:49.887333+00', NULL, '2026-08-24 15:23:49.887333+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('RPP8239475c92c916625193bd0', '/rpt/customer-aging/export', 'rpt', 'customer-aging', 'export', '导出客户应收预收账龄', 'ENABLED', '2026-08-24 15:23:49.887333+00', NULL, '2026-08-24 15:23:49.887333+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('RPPf619c6cbdb6203e0705296b', '/rpt/supplier-aging/query', 'rpt', 'supplier-aging', 'query', '查询供应商应付预付账龄', 'ENABLED', '2026-08-24 15:23:49.887333+00', NULL, '2026-08-24 15:23:49.887333+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('RPP0cb3674c1bfa269fff4dac4', '/rpt/supplier-aging/export', 'rpt', 'supplier-aging', 'export', '导出供应商应付预付账龄', 'ENABLED', '2026-08-24 15:23:49.887333+00', NULL, '2026-08-24 15:23:49.887333+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('RPP8ad5fde0ba4ffbf239b0690', '/rpt/inventory-movement/query', 'rpt', 'inventory-movement', 'query', '查询库存收发存', 'ENABLED', '2026-08-24 15:23:49.887333+00', NULL, '2026-08-24 15:23:49.887333+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('RPP698564d8e4f6d36e2d836a1', '/rpt/inventory-movement/export', 'rpt', 'inventory-movement', 'export', '导出库存收发存', 'ENABLED', '2026-08-24 15:23:49.887333+00', NULL, '2026-08-24 15:23:49.887333+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('RPP7274e7bf019ba2c579572c3', '/rpt/bills/query', 'rpt', 'bills', 'query', '查询票据', 'ENABLED', '2026-08-24 15:23:49.887333+00', NULL, '2026-08-24 15:23:49.887333+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('RPP2a3289681fbbf6c6cf5e955', '/rpt/bills/export', 'rpt', 'bills', 'export', '导出票据', 'ENABLED', '2026-08-24 15:23:49.887333+00', NULL, '2026-08-24 15:23:49.887333+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('RPP2a20b274f98486167acb01c', '/rpt/containers/query', 'rpt', 'containers', 'query', '查询空桶', 'ENABLED', '2026-08-24 15:23:49.887333+00', NULL, '2026-08-24 15:23:49.887333+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('RPP5bfdb608acbab759dc0b3fe', '/rpt/containers/export', 'rpt', 'containers', 'export', '导出空桶', 'ENABLED', '2026-08-24 15:23:49.887333+00', NULL, '2026-08-24 15:23:49.887333+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('RPPd42093b4298e81be2fc6b08', '/rpt/employee-loans/query', 'rpt', 'employee-loans', 'query', '查询员工借款', 'ENABLED', '2026-08-24 15:23:49.887333+00', NULL, '2026-08-24 15:23:49.887333+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('RPP0fb2a60a22a29999551000b', '/rpt/employee-loans/export', 'rpt', 'employee-loans', 'export', '导出员工借款', 'ENABLED', '2026-08-24 15:23:49.887333+00', NULL, '2026-08-24 15:23:49.887333+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JAPP00000000000000000018', '/app/user/reset-password', 'app', 'user', 'reset-password', '重置用户密码', 'ENABLED', '2026-08-24 15:23:50.002937+00', NULL, '2026-08-24 15:23:50.002937+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('WG6ba149ae2772987659e7e433', '/wfl/process-definition/trial', 'wfl', 'process-definition', 'trial', '试算流程定义', 'ENABLED', '2026-08-24 15:23:50.02923+00', NULL, '2026-08-24 15:23:50.02923+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JAUX00000000000000000911', '/aux/settlement-method/query', 'aux', 'settlement-method', 'query', '查询结算方式', 'ENABLED', '2026-08-24 15:23:50.195722+00', NULL, '2026-08-24 15:23:50.195722+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JAUX00000000000000000921', '/aux/payment-method/query', 'aux', 'payment-method', 'query', '查询收款方式', 'ENABLED', '2026-08-24 15:23:50.195722+00', NULL, '2026-08-24 15:23:50.195722+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JAUX00000000000000000912', '/aux/settlement-method/get', 'aux', 'settlement-method', 'get', '查看结算方式', 'ENABLED', '2026-08-24 15:23:50.195722+00', NULL, '2026-08-24 15:23:50.195722+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JAUX00000000000000000922', '/aux/payment-method/get', 'aux', 'payment-method', 'get', '查看收款方式', 'ENABLED', '2026-08-24 15:23:50.195722+00', NULL, '2026-08-24 15:23:50.195722+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JAUX00000000000000000913', '/aux/settlement-method/create', 'aux', 'settlement-method', 'create', '创建结算方式', 'ENABLED', '2026-08-24 15:23:50.195722+00', NULL, '2026-08-24 15:23:50.195722+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JAUX00000000000000000923', '/aux/payment-method/create', 'aux', 'payment-method', 'create', '创建收款方式', 'ENABLED', '2026-08-24 15:23:50.195722+00', NULL, '2026-08-24 15:23:50.195722+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JAUX00000000000000000914', '/aux/settlement-method/save', 'aux', 'settlement-method', 'save', '保存结算方式', 'ENABLED', '2026-08-24 15:23:50.195722+00', NULL, '2026-08-24 15:23:50.195722+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JAUX00000000000000000924', '/aux/payment-method/save', 'aux', 'payment-method', 'save', '保存收款方式', 'ENABLED', '2026-08-24 15:23:50.195722+00', NULL, '2026-08-24 15:23:50.195722+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JAUX00000000000000000915', '/aux/settlement-method/enable', 'aux', 'settlement-method', 'enable', '启用结算方式', 'ENABLED', '2026-08-24 15:23:50.195722+00', NULL, '2026-08-24 15:23:50.195722+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JAUX00000000000000000925', '/aux/payment-method/enable', 'aux', 'payment-method', 'enable', '启用收款方式', 'ENABLED', '2026-08-24 15:23:50.195722+00', NULL, '2026-08-24 15:23:50.195722+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JAUX00000000000000000916', '/aux/settlement-method/disable', 'aux', 'settlement-method', 'disable', '停用结算方式', 'ENABLED', '2026-08-24 15:23:50.195722+00', NULL, '2026-08-24 15:23:50.195722+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JAUX00000000000000000926', '/aux/payment-method/disable', 'aux', 'payment-method', 'disable', '停用收款方式', 'ENABLED', '2026-08-24 15:23:50.195722+00', NULL, '2026-08-24 15:23:50.195722+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JAUX00000000000000000917', '/aux/settlement-method/delete', 'aux', 'settlement-method', 'delete', '删除结算方式', 'ENABLED', '2026-08-24 15:23:50.195722+00', NULL, '2026-08-24 15:23:50.195722+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JAUX00000000000000000927', '/aux/payment-method/delete', 'aux', 'payment-method', 'delete', '删除收款方式', 'ENABLED', '2026-08-24 15:23:50.195722+00', NULL, '2026-08-24 15:23:50.195722+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JBOB83000000000000000001', '/dcl/operating-entity/approve', 'dcl', 'operating-entity', 'approve', '审核经营主体', 'ENABLED', '2026-08-24 15:23:50.224888+00', NULL, '2026-08-24 15:23:50.224888+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JBOB83000000000000000002', '/dcl/operating-entity/audit-history', 'dcl', 'operating-entity', 'audit-history', '查看经营主体审计', 'ENABLED', '2026-08-24 15:23:50.224888+00', NULL, '2026-08-24 15:23:50.224888+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JBOB83000000000000000003', '/dcl/operating-entity/create', 'dcl', 'operating-entity', 'create', '创建经营主体', 'ENABLED', '2026-08-24 15:23:50.224888+00', NULL, '2026-08-24 15:23:50.224888+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JBOB83000000000000000004', '/dcl/operating-entity/delete', 'dcl', 'operating-entity', 'delete', '删除经营主体', 'ENABLED', '2026-08-24 15:23:50.224888+00', NULL, '2026-08-24 15:23:50.224888+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JBOB83000000000000000005', '/dcl/operating-entity/get', 'dcl', 'operating-entity', 'get', '查看经营主体申报版本', 'ENABLED', '2026-08-24 15:23:50.224888+00', NULL, '2026-08-24 15:23:50.224888+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JBOB83000000000000000006', '/dcl/operating-entity/query', 'dcl', 'operating-entity', 'query', '查询经营主体申报', 'ENABLED', '2026-08-24 15:23:50.224888+00', NULL, '2026-08-24 15:23:50.224888+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JBOB83000000000000000007', '/bob/operating-entity/get', 'bob', 'operating-entity', 'get', '查看经营主体', 'ENABLED', '2026-08-24 15:23:50.224888+00', NULL, '2026-08-24 15:23:50.224888+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JBOB83000000000000000008', '/bob/operating-entity/query', 'bob', 'operating-entity', 'query', '查询经营主体', 'ENABLED', '2026-08-24 15:23:50.224888+00', NULL, '2026-08-24 15:23:50.224888+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JBOB83000000000000000009', '/dcl/operating-entity/reject', 'dcl', 'operating-entity', 'reject', '驳回经营主体', 'ENABLED', '2026-08-24 15:23:50.224888+00', NULL, '2026-08-24 15:23:50.224888+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JBOB83000000000000000010', '/dcl/operating-entity/save', 'dcl', 'operating-entity', 'save', '保存经营主体', 'ENABLED', '2026-08-24 15:23:50.224888+00', NULL, '2026-08-24 15:23:50.224888+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JBOB83000000000000000011', '/dcl/operating-entity/submit', 'dcl', 'operating-entity', 'submit', '提交经营主体', 'ENABLED', '2026-08-24 15:23:50.224888+00', NULL, '2026-08-24 15:23:50.224888+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JBOB83000000000000000012', '/dcl/operating-entity/unapprove', 'dcl', 'operating-entity', 'unapprove', '反审核经营主体', 'ENABLED', '2026-08-24 15:23:50.224888+00', NULL, '2026-08-24 15:23:50.224888+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JBOB83000000000000000013', '/dcl/operating-entity/unsubmit', 'dcl', 'operating-entity', 'unsubmit', '撤回经营主体', 'ENABLED', '2026-08-24 15:23:50.224888+00', NULL, '2026-08-24 15:23:50.224888+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JBOB83000000000000000014', '/dcl/operating-entity/versions', 'dcl', 'operating-entity', 'versions', '查看经营主体版本', 'ENABLED', '2026-08-24 15:23:50.224888+00', NULL, '2026-08-24 15:23:50.224888+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JBOB85000000000000000001', '/bob/party/query', 'bob', 'party', 'query', '查询主体', 'ENABLED', '2026-08-24 15:23:50.307347+00', NULL, '2026-08-24 15:23:50.307347+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JBOB85000000000000000002', '/bob/party/get', 'bob', 'party', 'get', '查看主体', 'ENABLED', '2026-08-24 15:23:50.307347+00', NULL, '2026-08-24 15:23:50.307347+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JBOB85000000000000000003', '/dcl/party/create', 'dcl', 'party', 'create', '随首条关系创建主体声明', 'ENABLED', '2026-08-28 00:00:00+00', NULL, '2026-08-28 00:00:00+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JBOB85000000000000000004', '/dcl/party/save', 'dcl', 'party', 'save', '保存主体声明', 'ENABLED', '2026-08-28 00:00:00+00', NULL, '2026-08-28 00:00:00+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JDCLPTY00000000000000003', '/dcl/party/submit', 'dcl', 'party', 'submit', '提交主体声明', 'ENABLED', '2026-08-28 00:00:00+00', NULL, '2026-08-28 00:00:00+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JDCLPTY00000000000000004', '/dcl/party/unsubmit', 'dcl', 'party', 'unsubmit', '撤回主体声明', 'ENABLED', '2026-08-28 00:00:00+00', NULL, '2026-08-28 00:00:00+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JDCLPTY00000000000000005', '/dcl/party/reject', 'dcl', 'party', 'reject', '驳回主体声明', 'ENABLED', '2026-08-28 00:00:00+00', NULL, '2026-08-28 00:00:00+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JDCLPTY00000000000000006', '/dcl/party/approve', 'dcl', 'party', 'approve', '审核主体声明', 'ENABLED', '2026-08-28 00:00:00+00', NULL, '2026-08-28 00:00:00+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JDCLPTY00000000000000007', '/dcl/party/unapprove', 'dcl', 'party', 'unapprove', '反审核主体声明', 'ENABLED', '2026-08-28 00:00:00+00', NULL, '2026-08-28 00:00:00+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JDCLPTY00000000000000008', '/dcl/party/delete', 'dcl', 'party', 'delete', '删除主体候选草稿', 'ENABLED', '2026-08-28 00:00:00+00', NULL, '2026-08-28 00:00:00+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JDCLPTY00000000000000009', '/dcl/party/get', 'dcl', 'party', 'get', '查看主体声明', 'ENABLED', '2026-08-28 00:00:00+00', NULL, '2026-08-28 00:00:00+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JDCLPTY00000000000000010', '/dcl/party/query', 'dcl', 'party', 'query', '查询主体声明', 'ENABLED', '2026-08-28 00:00:00+00', NULL, '2026-08-28 00:00:00+00', NULL, 1, 90);
INSERT INTO public.app_permissions VALUES ('01JDCLPTY00000000000000011', '/dcl/party/versions', 'dcl', 'party', 'versions', '查看主体声明版本', 'ENABLED', '2026-08-28 00:00:00+00', NULL, '2026-08-28 00:00:00+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JBOB85000000000000000005', '/dcl/party/audit-history', 'dcl', 'party', 'audit-history', '查看主体声明审计', 'ENABLED', '2026-08-28 00:00:00+00', NULL, '2026-08-28 00:00:00+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JBOB88MRG000000000000001', '/dcl/party/merge-preflight', 'dcl', 'party', 'merge-preflight', '预检主体合并', 'ENABLED', '2026-08-28 00:00:00+00', NULL, '2026-08-28 00:00:00+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JBOB88MRG000000000000002', '/dcl/party/merge-confirm', 'dcl', 'party', 'merge-confirm', '确认主体合并', 'ENABLED', '2026-08-28 00:00:00+00', NULL, '2026-08-28 00:00:00+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JBOB85000000000000000006', '/bob/other-unit/query', 'bob', 'other-unit', 'query', '查询其他单位', 'ENABLED', '2026-08-24 15:23:50.307347+00', NULL, '2026-08-24 15:23:50.307347+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JBOB85000000000000000007', '/bob/other-unit/get', 'bob', 'other-unit', 'get', '查看其他单位', 'ENABLED', '2026-08-24 15:23:50.307347+00', NULL, '2026-08-24 15:23:50.307347+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JBOB85000000000000000008', '/dcl/other-unit/create', 'dcl', 'other-unit', 'create', '创建其他单位', 'ENABLED', '2026-08-24 15:23:50.307347+00', NULL, '2026-08-24 15:23:50.307347+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JBOB85000000000000000009', '/dcl/other-unit/save', 'dcl', 'other-unit', 'save', '保存其他单位', 'ENABLED', '2026-08-24 15:23:50.307347+00', NULL, '2026-08-24 15:23:50.307347+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JBOB85000000000000000010', '/dcl/other-unit/delete', 'dcl', 'other-unit', 'delete', '删除其他单位草稿', 'ENABLED', '2026-08-24 15:23:50.307347+00', NULL, '2026-08-24 15:23:50.307347+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JBOB85000000000000000011', '/dcl/other-unit/submit', 'dcl', 'other-unit', 'submit', '提交其他单位', 'ENABLED', '2026-08-24 15:23:50.307347+00', NULL, '2026-08-24 15:23:50.307347+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JBOB85000000000000000012', '/dcl/other-unit/unsubmit', 'dcl', 'other-unit', 'unsubmit', '撤回其他单位', 'ENABLED', '2026-08-24 15:23:50.307347+00', NULL, '2026-08-24 15:23:50.307347+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JBOB85000000000000000013', '/dcl/other-unit/approve', 'dcl', 'other-unit', 'approve', '审核其他单位', 'ENABLED', '2026-08-24 15:23:50.307347+00', NULL, '2026-08-24 15:23:50.307347+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JBOB85000000000000000014', '/dcl/other-unit/reject', 'dcl', 'other-unit', 'reject', '驳回其他单位', 'ENABLED', '2026-08-24 15:23:50.307347+00', NULL, '2026-08-24 15:23:50.307347+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JBOB85000000000000000017', '/dcl/other-unit/versions', 'dcl', 'other-unit', 'versions', '查看其他单位版本', 'ENABLED', '2026-08-24 15:23:50.307347+00', NULL, '2026-08-24 15:23:50.307347+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JBOB85000000000000000018', '/dcl/other-unit/audit-history', 'dcl', 'other-unit', 'audit-history', '查看其他单位审计', 'ENABLED', '2026-08-24 15:23:50.307347+00', NULL, '2026-08-24 15:23:50.307347+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JBOB85000000000000000015', '/dcl/other-unit/query', 'dcl', 'other-unit', 'query', '查询其他单位声明', 'ENABLED', '2026-08-28 00:00:00+00', NULL, '2026-08-28 00:00:00+00', NULL, 1, 40);
INSERT INTO public.app_permissions VALUES ('01JBOB85000000000000000016', '/dcl/other-unit/get', 'dcl', 'other-unit', 'get', '查看其他单位声明', 'ENABLED', '2026-08-28 00:00:00+00', NULL, '2026-08-28 00:00:00+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JBOB86SLP000000000000001', '/bob/sales-partner/query', 'bob', 'sales-partner', 'query', '查询销售合作方', 'ENABLED', '2026-08-24 15:23:50.347482+00', NULL, '2026-08-24 15:23:50.347482+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JBOB86SLP000000000000002', '/bob/sales-partner/get', 'bob', 'sales-partner', 'get', '查看销售合作方', 'ENABLED', '2026-08-24 15:23:50.347482+00', NULL, '2026-08-24 15:23:50.347482+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JBOB86SLP000000000000003', '/dcl/sales-partner/create', 'dcl', 'sales-partner', 'create', '创建销售合作方', 'ENABLED', '2026-08-24 15:23:50.347482+00', NULL, '2026-08-24 15:23:50.347482+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JBOB86SLP000000000000004', '/dcl/sales-partner/save', 'dcl', 'sales-partner', 'save', '保存销售合作方', 'ENABLED', '2026-08-24 15:23:50.347482+00', NULL, '2026-08-24 15:23:50.347482+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JBOB86SLP000000000000005', '/dcl/sales-partner/delete', 'dcl', 'sales-partner', 'delete', '删除销售合作方草稿', 'ENABLED', '2026-08-24 15:23:50.347482+00', NULL, '2026-08-24 15:23:50.347482+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JBOB86SLP000000000000006', '/dcl/sales-partner/submit', 'dcl', 'sales-partner', 'submit', '提交销售合作方', 'ENABLED', '2026-08-24 15:23:50.347482+00', NULL, '2026-08-24 15:23:50.347482+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JBOB86SLP000000000000007', '/dcl/sales-partner/unsubmit', 'dcl', 'sales-partner', 'unsubmit', '撤回销售合作方', 'ENABLED', '2026-08-24 15:23:50.347482+00', NULL, '2026-08-24 15:23:50.347482+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JBOB86SLP000000000000008', '/dcl/sales-partner/approve', 'dcl', 'sales-partner', 'approve', '审核销售合作方', 'ENABLED', '2026-08-24 15:23:50.347482+00', NULL, '2026-08-24 15:23:50.347482+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JBOB86SLP000000000000009', '/dcl/sales-partner/reject', 'dcl', 'sales-partner', 'reject', '驳回销售合作方', 'ENABLED', '2026-08-24 15:23:50.347482+00', NULL, '2026-08-24 15:23:50.347482+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JBOB86SLP000000000000012', '/dcl/sales-partner/versions', 'dcl', 'sales-partner', 'versions', '查看销售合作方版本', 'ENABLED', '2026-08-24 15:23:50.347482+00', NULL, '2026-08-24 15:23:50.347482+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JBOB86SLP000000000000013', '/dcl/sales-partner/audit-history', 'dcl', 'sales-partner', 'audit-history', '查看销售合作方审计', 'ENABLED', '2026-08-24 15:23:50.347482+00', NULL, '2026-08-24 15:23:50.347482+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JBOB86SLP000000000000010', '/dcl/sales-partner/query', 'dcl', 'sales-partner', 'query', '查询销售合作方声明', 'ENABLED', '2026-08-28 00:00:00+00', NULL, '2026-08-28 00:00:00+00', NULL, 1, 50);
INSERT INTO public.app_permissions VALUES ('01JBOB86SLP000000000000011', '/dcl/sales-partner/get', 'dcl', 'sales-partner', 'get', '查看销售合作方声明', 'ENABLED', '2026-08-28 00:00:00+00', NULL, '2026-08-28 00:00:00+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JVOU87000000000000000001', '/vou/service-contract/query', 'vou', 'service-contract', 'query', '查询服务合同', 'ENABLED', '2026-08-24 15:23:50.387239+00', NULL, '2026-08-24 15:23:50.387239+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JVOU87000000000000000002', '/vou/service-contract/get', 'vou', 'service-contract', 'get', '查看服务合同', 'ENABLED', '2026-08-24 15:23:50.387239+00', NULL, '2026-08-24 15:23:50.387239+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JVOU87000000000000000003', '/vou/service-contract/create', 'vou', 'service-contract', 'create', '创建服务合同', 'ENABLED', '2026-08-24 15:23:50.387239+00', NULL, '2026-08-24 15:23:50.387239+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JVOU87000000000000000004', '/vou/service-contract/save', 'vou', 'service-contract', 'save', '保存服务合同', 'ENABLED', '2026-08-24 15:23:50.387239+00', NULL, '2026-08-24 15:23:50.387239+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JVOU87000000000000000005', '/vou/service-contract/submit', 'vou', 'service-contract', 'submit', '提交服务合同', 'ENABLED', '2026-08-24 15:23:50.387239+00', NULL, '2026-08-24 15:23:50.387239+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JVOU87000000000000000006', '/vou/service-contract/unsubmit', 'vou', 'service-contract', 'unsubmit', '撤销提交服务合同', 'ENABLED', '2026-08-24 15:23:50.387239+00', NULL, '2026-08-24 15:23:50.387239+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JVOU87000000000000000007', '/vou/service-contract/approve', 'vou', 'service-contract', 'approve', '批准服务合同', 'ENABLED', '2026-08-24 15:23:50.387239+00', NULL, '2026-08-24 15:23:50.387239+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JVOU87000000000000000008', '/vou/service-contract/unapprove', 'vou', 'service-contract', 'unapprove', '反批准服务合同', 'ENABLED', '2026-08-24 15:23:50.387239+00', NULL, '2026-08-24 15:23:50.387239+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JVOU87000000000000000009', '/vou/service-contract/delete', 'vou', 'service-contract', 'delete', '删除服务合同草稿', 'ENABLED', '2026-08-24 15:23:50.387239+00', NULL, '2026-08-24 15:23:50.387239+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JVOU87000000000000000010', '/vou/service-contract/audit-history', 'vou', 'service-contract', 'audit-history', '查看服务合同审计', 'ENABLED', '2026-08-24 15:23:50.387239+00', NULL, '2026-08-24 15:23:50.387239+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JVOU87000000000000000011', '/vou/service-acceptance/query', 'vou', 'service-acceptance', 'query', '查询履约验收', 'ENABLED', '2026-08-24 15:23:50.387239+00', NULL, '2026-08-24 15:23:50.387239+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JVOU87000000000000000012', '/vou/service-acceptance/get', 'vou', 'service-acceptance', 'get', '查看履约验收', 'ENABLED', '2026-08-24 15:23:50.387239+00', NULL, '2026-08-24 15:23:50.387239+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JVOU87000000000000000013', '/vou/service-acceptance/create', 'vou', 'service-acceptance', 'create', '创建履约验收', 'ENABLED', '2026-08-24 15:23:50.387239+00', NULL, '2026-08-24 15:23:50.387239+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JVOU87000000000000000014', '/vou/service-acceptance/save', 'vou', 'service-acceptance', 'save', '保存履约验收', 'ENABLED', '2026-08-24 15:23:50.387239+00', NULL, '2026-08-24 15:23:50.387239+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JVOU87000000000000000015', '/vou/service-acceptance/submit', 'vou', 'service-acceptance', 'submit', '提交履约验收', 'ENABLED', '2026-08-24 15:23:50.387239+00', NULL, '2026-08-24 15:23:50.387239+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JVOU87000000000000000016', '/vou/service-acceptance/unsubmit', 'vou', 'service-acceptance', 'unsubmit', '撤销提交履约验收', 'ENABLED', '2026-08-24 15:23:50.387239+00', NULL, '2026-08-24 15:23:50.387239+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JVOU87000000000000000017', '/vou/service-acceptance/approve', 'vou', 'service-acceptance', 'approve', '批准履约验收', 'ENABLED', '2026-08-24 15:23:50.387239+00', NULL, '2026-08-24 15:23:50.387239+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JVOU87000000000000000018', '/vou/service-acceptance/unapprove', 'vou', 'service-acceptance', 'unapprove', '反批准履约验收', 'ENABLED', '2026-08-24 15:23:50.387239+00', NULL, '2026-08-24 15:23:50.387239+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JVOU87000000000000000019', '/vou/service-acceptance/delete', 'vou', 'service-acceptance', 'delete', '删除履约验收草稿', 'ENABLED', '2026-08-24 15:23:50.387239+00', NULL, '2026-08-24 15:23:50.387239+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JVOU87000000000000000020', '/vou/service-acceptance/audit-history', 'vou', 'service-acceptance', 'audit-history', '查看履约验收审计', 'ENABLED', '2026-08-24 15:23:50.387239+00', NULL, '2026-08-24 15:23:50.387239+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JBOB89CAC000000000000001', '/bob/customer-account/query', 'bob', 'customer-account', 'query', '查询客户账户', 'ENABLED', '2026-08-24 15:23:50.451904+00', NULL, '2026-08-24 15:23:50.451904+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JBOB89CAC000000000000002', '/bob/customer-account/get', 'bob', 'customer-account', 'get', '查看客户账户', 'ENABLED', '2026-08-24 15:23:50.451904+00', NULL, '2026-08-24 15:23:50.451904+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JPR3BOB00000000000000002', '/dcl/other-unit/unapprove', 'dcl', 'other-unit', 'unapprove', '反审核其他单位', 'ENABLED', '2026-08-24 15:23:50.451904+00', NULL, '2026-08-24 15:23:50.451904+00', NULL, 1, NULL);
INSERT INTO public.app_permissions VALUES ('01JPR3BOB00000000000000003', '/dcl/sales-partner/unapprove', 'dcl', 'sales-partner', 'unapprove', '反审核销售合作关系', 'ENABLED', '2026-08-24 15:23:50.451904+00', NULL, '2026-08-24 15:23:50.451904+00', NULL, 1, NULL);


--
-- Data for Name: app_role_code_counters; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.app_role_code_counters VALUES ('default', 0);

--
-- Data for Name: dcl_rpt_definition_code_counters; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.dcl_rpt_definition_code_counters VALUES ('default', 0);


--
-- Data for Name: app_role_permissions; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: app_roles; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.app_roles VALUES ('01JAPPSYST3MR0X30000000000', 'system', '系统角色', '系统内部自动化专用，不授予接口权限且不可人工维护', 'ENABLED', '2026-08-24 15:23:49.496142+00', '01JAPPSYST3MACTR0000000000', '2026-08-24 15:23:49.496142+00', '01JAPPSYST3MACTR0000000000', 1);


--
-- Data for Name: app_sessions; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: app_system_parameters; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: app_user_profiles; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: app_user_roles; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.app_user_roles VALUES ('01JAPPSYST3MACTR0000000000', '01JAPPSYST3MR0X30000000000', '2026-08-24 15:23:49.496142+00', '01JAPPSYST3MACTR0000000000');


--
-- Data for Name: app_users; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.app_users VALUES ('01JAPPSYST3MACTR0000000000', 'system', '系统用户', '!system-login-disabled!', 'DISABLED', 0, NULL, '2026-08-24 15:23:49.496142+00', '2026-08-24 15:23:49.496142+00', '01JAPPSYST3MACTR0000000000', '2026-08-24 15:23:49.496142+00', '01JAPPSYST3MACTR0000000000', 1, false);


--
-- Data for Name: aux_objects; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.aux_objects (id, entity, code, enabled, revision, created_at, created_by, updated_at, updated_by) VALUES
    ('01JAVX00000000000000000001', 'dictionary-type', 'DCT-0001', true, 1, '2026-08-24 15:23:49.336221+00', '00000000000000000000000000', '2026-08-24 15:23:49.336221+00', '00000000000000000000000000'),
    ('01JAVX00000000000000000003', 'dictionary-type', 'DCT-0002', true, 1, '2026-08-24 15:23:49.336221+00', '00000000000000000000000000', '2026-08-24 15:23:49.336221+00', '00000000000000000000000000'),
    ('01JAVX00000000000000000005', 'dictionary-item', 'DIT-0001', true, 1, '2026-08-24 15:23:49.336221+00', '00000000000000000000000000', '2026-08-24 15:23:49.336221+00', '00000000000000000000000000'),
    ('01JAVX00000000000000000007', 'dictionary-item', 'DIT-0002', true, 1, '2026-08-24 15:23:49.336221+00', '00000000000000000000000000', '2026-08-24 15:23:49.336221+00', '00000000000000000000000000'),
    ('01JAVX00000000000000000009', 'dictionary-item', 'DIT-0003', true, 1, '2026-08-24 15:23:49.336221+00', '00000000000000000000000000', '2026-08-24 15:23:49.336221+00', '00000000000000000000000000'),
    ('01JAVX00000000000000000011', 'measurement-unit', 'UNT-0001', true, 1, '2026-08-24 15:23:49.336221+00', '00000000000000000000000000', '2026-08-24 15:23:49.336221+00', '00000000000000000000000000'),
    ('01JAVX00000000000000000013', 'measurement-unit', 'UNT-0002', true, 1, '2026-08-24 15:23:49.336221+00', '00000000000000000000000000', '2026-08-24 15:23:49.336221+00', '00000000000000000000000000'),
    ('01JAVX00000000000000000015', 'measurement-unit', 'UNT-0003', true, 1, '2026-08-24 15:23:49.336221+00', '00000000000000000000000000', '2026-08-24 15:23:49.336221+00', '00000000000000000000000000'),
    ('01JAVX00000000000000000017', 'measurement-unit', 'UNT-0004', true, 1, '2026-08-24 15:23:49.336221+00', '00000000000000000000000000', '2026-08-24 15:23:49.336221+00', '00000000000000000000000000'),
    ('01JAVX00000000000000000025', 'measurement-unit', 'UNT-0005', true, 1, '2026-08-24 15:23:49.336221+00', '00000000000000000000000000', '2026-08-24 15:23:49.336221+00', '00000000000000000000000000'),
    ('01JAVX00000000000000000027', 'measurement-unit', 'UNT-0006', true, 1, '2026-08-24 15:23:49.336221+00', '00000000000000000000000000', '2026-08-24 15:23:49.336221+00', '00000000000000000000000000'),
    ('01JPTP00000000000000000001', 'product-type', 'PTP-0001', true, 1, '2026-08-24 15:23:50.195722+00', '00000000000000000000000000', '2026-08-24 15:23:50.195722+00', '00000000000000000000000000'),
    ('01JPTP00000000000000000003', 'product-type', 'PTP-0002', true, 1, '2026-08-24 15:23:50.195722+00', '00000000000000000000000000', '2026-08-24 15:23:50.195722+00', '00000000000000000000000000'),
    ('01JPTP00000000000000000005', 'product-type', 'PTP-0003', true, 1, '2026-08-24 15:23:50.195722+00', '00000000000000000000000000', '2026-08-24 15:23:50.195722+00', '00000000000000000000000000'),
    ('01JPTP00000000000000000007', 'product-type', 'PTP-0004', true, 1, '2026-08-24 15:23:50.195722+00', '00000000000000000000000000', '2026-08-24 15:23:50.195722+00', '00000000000000000000000000'),
    ('01JSMT00000000000000000001', 'settlement-method', 'STM-0001', true, 1, '2026-08-24 15:23:50.195722+00', '00000000000000000000000000', '2026-08-24 15:23:50.195722+00', '00000000000000000000000000'),
    ('01JSMT00000000000000000003', 'settlement-method', 'STM-0002', true, 1, '2026-08-24 15:23:50.195722+00', '00000000000000000000000000', '2026-08-24 15:23:50.195722+00', '00000000000000000000000000'),
    ('01JSMT00000000000000000005', 'settlement-method', 'STM-0003', true, 1, '2026-08-24 15:23:50.195722+00', '00000000000000000000000000', '2026-08-24 15:23:50.195722+00', '00000000000000000000000000'),
    ('01JSMT00000000000000000007', 'settlement-method', 'STM-0004', true, 1, '2026-08-24 15:23:50.195722+00', '00000000000000000000000000', '2026-08-24 15:23:50.195722+00', '00000000000000000000000000'),
    ('01JSMT00000000000000000009', 'settlement-method', 'STM-0005', true, 1, '2026-08-24 15:23:50.195722+00', '00000000000000000000000000', '2026-08-24 15:23:50.195722+00', '00000000000000000000000000'),
    ('01JSMT00000000000000000011', 'settlement-method', 'STM-0006', true, 1, '2026-08-24 15:23:50.195722+00', '00000000000000000000000000', '2026-08-24 15:23:50.195722+00', '00000000000000000000000000'),
    ('01JSMT00000000000000000013', 'settlement-method', 'STM-0007', true, 1, '2026-08-24 15:23:50.195722+00', '00000000000000000000000000', '2026-08-24 15:23:50.195722+00', '00000000000000000000000000'),
    ('01JSMT00000000000000000015', 'settlement-method', 'STM-0008', true, 1, '2026-08-24 15:23:50.195722+00', '00000000000000000000000000', '2026-08-24 15:23:50.195722+00', '00000000000000000000000000'),
    ('01JSMT00000000000000000017', 'settlement-method', 'STM-0009', true, 1, '2026-08-24 15:23:50.195722+00', '00000000000000000000000000', '2026-08-24 15:23:50.195722+00', '00000000000000000000000000'),
    ('01JSMT00000000000000000019', 'settlement-method', 'STM-0010', true, 1, '2026-08-24 15:23:50.195722+00', '00000000000000000000000000', '2026-08-24 15:23:50.195722+00', '00000000000000000000000000'),
    ('01JSMT00000000000000000021', 'settlement-method', 'STM-0011', true, 1, '2026-08-24 15:23:50.195722+00', '00000000000000000000000000', '2026-08-24 15:23:50.195722+00', '00000000000000000000000000'),
    ('01JCDT00000000000000000001', 'dictionary-type', 'DCT-0003', true, 1, '2026-08-24 15:23:50.224888+00', '00000000000000000000000000', '2026-08-24 15:23:50.224888+00', '00000000000000000000000000'),
    ('01JCDT00000000000000000003', 'dictionary-item', 'DIT-0004', true, 1, '2026-08-24 15:23:50.224888+00', '00000000000000000000000000', '2026-08-24 15:23:50.224888+00', '00000000000000000000000000'),
    ('01JCDT00000000000000000005', 'dictionary-item', 'DIT-0005', true, 1, '2026-08-24 15:23:50.224888+00', '00000000000000000000000000', '2026-08-24 15:23:50.224888+00', '00000000000000000000000000'),
    ('01JCDT00000000000000000007', 'dictionary-item', 'DIT-0006', true, 1, '2026-08-24 15:23:50.224888+00', '00000000000000000000000000', '2026-08-24 15:23:50.224888+00', '00000000000000000000000000'),
    ('01JCDT00000000000000000009', 'dictionary-item', 'DIT-0007', true, 1, '2026-08-24 15:23:50.224888+00', '00000000000000000000000000', '2026-08-24 15:23:50.224888+00', '00000000000000000000000000'),
    ('01JCDT00000000000000000011', 'dictionary-item', 'DIT-0008', true, 1, '2026-08-24 15:23:50.224888+00', '00000000000000000000000000', '2026-08-24 15:23:50.224888+00', '00000000000000000000000000'),
    ('01JCDT00000000000000000013', 'dictionary-item', 'DIT-0009', true, 1, '2026-08-24 15:23:50.224888+00', '00000000000000000000000000', '2026-08-24 15:23:50.224888+00', '00000000000000000000000000'),
    ('01JCDT00000000000000000015', 'dictionary-item', 'DIT-0010', true, 1, '2026-08-24 15:23:50.224888+00', '00000000000000000000000000', '2026-08-24 15:23:50.224888+00', '00000000000000000000000000');
-- AUX current payload baseline.
UPDATE public.aux_objects object
SET data=payload.data
FROM (VALUES
    ('01JAVX00000000000000000001','dictionary-type', '{"name": "客户类型", "description": "客户展示和筛选类型"}'::jsonb),
    ('01JAVX00000000000000000003','dictionary-type', '{"name": "车辆类型", "description": "车辆展示和筛选类型"}'::jsonb),
    ('01JAVX00000000000000000011','measurement-unit', '{"name": "千克", "symbol": "kg", "quantityScale": 6}'::jsonb),
    ('01JAVX00000000000000000013','measurement-unit', '{"name": "件", "symbol": "件", "quantityScale": 0}'::jsonb),
    ('01JAVX00000000000000000015','measurement-unit', '{"name": "年", "symbol": "年", "quantityScale": 6}'::jsonb),
    ('01JAVX00000000000000000017','measurement-unit', '{"name": "次", "symbol": "次", "quantityScale": 6}'::jsonb),
    ('01JAVX00000000000000000025','measurement-unit', '{"name": "小时", "symbol": "h", "quantityScale": 6}'::jsonb),
    ('01JAVX00000000000000000027','measurement-unit', '{"name": "吨", "symbol": "t", "quantityScale": 6}'::jsonb),
    ('01JAVX00000000000000000005','dictionary-item', '{"name": "终端客户", "sortOrder": 10, "dictionaryTypeId": "01JAVX00000000000000000001", "dictionaryTypeCode": "DCT-0001", "dictionaryTypeName": "客户类型"}'::jsonb),
    ('01JAVX00000000000000000007','dictionary-item', '{"name": "经销商", "sortOrder": 20, "dictionaryTypeId": "01JAVX00000000000000000001", "dictionaryTypeCode": "DCT-0001", "dictionaryTypeName": "客户类型"}'::jsonb),
    ('01JAVX00000000000000000009','dictionary-item', '{"name": "厢式货车", "sortOrder": 10, "dictionaryTypeId": "01JAVX00000000000000000003", "dictionaryTypeCode": "DCT-0002", "dictionaryTypeName": "车辆类型"}'::jsonb),
    ('01JPTP00000000000000000001','product-type', '{"name": "原材料", "description": "系统初始产品类型", "behaviorProfile": "RAW_MATERIAL"}'::jsonb),
    ('01JPTP00000000000000000003','product-type', '{"name": "标准成品", "description": "系统初始产品类型", "behaviorProfile": "STANDARD_FINISHED"}'::jsonb),
    ('01JPTP00000000000000000005','product-type', '{"name": "定制成品", "description": "系统初始产品类型", "behaviorProfile": "CUSTOM_FINISHED"}'::jsonb),
    ('01JPTP00000000000000000007','product-type', '{"name": "包装物", "description": "系统初始产品类型", "behaviorProfile": "PACKAGING"}'::jsonb),
    ('01JSMT00000000000000000001','settlement-method', '{"name": "预付", "ruleType": "RELATIVE_DAYS", "termCode": "PREPAID", "dayOffset": 0, "dayOfMonth": 0, "description": "系统固定结算方式", "monthOffset": 0, "defaultSalesSurcharge": "0.00"}'::jsonb),
    ('01JSMT00000000000000000003','settlement-method', '{"name": "现结", "ruleType": "RELATIVE_DAYS", "termCode": "CASH_ON_DELIVERY", "dayOffset": 0, "dayOfMonth": 0, "description": "系统固定结算方式", "monthOffset": 0, "defaultSalesSurcharge": "0.00"}'::jsonb),
    ('01JSMT00000000000000000005','settlement-method', '{"name": "货到3天", "ruleType": "RELATIVE_DAYS", "termCode": "ARRIVAL_3", "dayOffset": 3, "dayOfMonth": 0, "description": "系统固定结算方式", "monthOffset": 0, "defaultSalesSurcharge": "0.00"}'::jsonb),
    ('01JSMT00000000000000000007','settlement-method', '{"name": "货到5天", "ruleType": "RELATIVE_DAYS", "termCode": "ARRIVAL_5", "dayOffset": 5, "dayOfMonth": 0, "description": "系统固定结算方式", "monthOffset": 0, "defaultSalesSurcharge": "0.00"}'::jsonb),
    ('01JSMT00000000000000000009','settlement-method', '{"name": "货到7天", "ruleType": "RELATIVE_DAYS", "termCode": "ARRIVAL_7", "dayOffset": 7, "dayOfMonth": 0, "description": "系统固定结算方式", "monthOffset": 0, "defaultSalesSurcharge": "0.00"}'::jsonb),
    ('01JSMT00000000000000000011','settlement-method', '{"name": "货到15天", "ruleType": "RELATIVE_DAYS", "termCode": "ARRIVAL_15", "dayOffset": 15, "dayOfMonth": 0, "description": "系统固定结算方式", "monthOffset": 0, "defaultSalesSurcharge": "0.00"}'::jsonb),
    ('01JSMT00000000000000000013','settlement-method', '{"name": "货到30天", "ruleType": "RELATIVE_DAYS", "termCode": "ARRIVAL_30", "dayOffset": 30, "dayOfMonth": 0, "description": "系统固定结算方式", "monthOffset": 0, "defaultSalesSurcharge": "0.10"}'::jsonb),
    ('01JSMT00000000000000000015','settlement-method', '{"name": "当月结", "ruleType": "MONTH_END", "termCode": "MONTHLY_CURRENT", "dayOffset": 0, "dayOfMonth": 0, "description": "系统固定结算方式", "monthOffset": 0, "defaultSalesSurcharge": "0.05"}'::jsonb),
    ('01JSMT00000000000000000017','settlement-method', '{"name": "月结30天", "ruleType": "MONTH_END", "termCode": "MONTHLY_30", "dayOffset": 0, "dayOfMonth": 0, "description": "系统固定结算方式", "monthOffset": 1, "defaultSalesSurcharge": "0.10"}'::jsonb),
    ('01JSMT00000000000000000019','settlement-method', '{"name": "月结60天", "ruleType": "MONTH_END", "termCode": "MONTHLY_60", "dayOffset": 0, "dayOfMonth": 0, "description": "系统固定结算方式", "monthOffset": 2, "defaultSalesSurcharge": "0.20"}'::jsonb),
    ('01JSMT00000000000000000021','settlement-method', '{"name": "月结90天", "ruleType": "MONTH_END", "termCode": "MONTHLY_90", "dayOffset": 0, "dayOfMonth": 0, "description": "系统固定结算方式", "monthOffset": 3, "defaultSalesSurcharge": "0.30"}'::jsonb),
    ('01JCDT00000000000000000001','dictionary-type', '{"name": "客户资料类别", "description": "客户集团与结算子账户附件分类"}'::jsonb),
    ('01JCDT00000000000000000003','dictionary-item', '{"name": "营业执照", "sortOrder": 10, "dictionaryTypeId": "01JCDT00000000000000000001", "dictionaryTypeCode": "DCT-0003", "dictionaryTypeName": "客户资料类别"}'::jsonb),
    ('01JCDT00000000000000000005','dictionary-item', '{"name": "税务资料", "sortOrder": 20, "dictionaryTypeId": "01JCDT00000000000000000001", "dictionaryTypeCode": "DCT-0003", "dictionaryTypeName": "客户资料类别"}'::jsonb),
    ('01JCDT00000000000000000007','dictionary-item', '{"name": "开票资料", "sortOrder": 30, "dictionaryTypeId": "01JCDT00000000000000000001", "dictionaryTypeCode": "DCT-0003", "dictionaryTypeName": "客户资料类别"}'::jsonb),
    ('01JCDT00000000000000000009','dictionary-item', '{"name": "合同", "sortOrder": 40, "dictionaryTypeId": "01JCDT00000000000000000001", "dictionaryTypeCode": "DCT-0003", "dictionaryTypeName": "客户资料类别"}'::jsonb),
    ('01JCDT00000000000000000011','dictionary-item', '{"name": "价格约定", "sortOrder": 50, "dictionaryTypeId": "01JCDT00000000000000000001", "dictionaryTypeCode": "DCT-0003", "dictionaryTypeName": "客户资料类别"}'::jsonb),
    ('01JCDT00000000000000000013','dictionary-item', '{"name": "交付约定", "sortOrder": 60, "dictionaryTypeId": "01JCDT00000000000000000001", "dictionaryTypeCode": "DCT-0003", "dictionaryTypeName": "客户资料类别"}'::jsonb),
    ('01JCDT00000000000000000015','dictionary-item', '{"name": "其他", "sortOrder": 70, "dictionaryTypeId": "01JCDT00000000000000000001", "dictionaryTypeCode": "DCT-0003", "dictionaryTypeName": "客户资料类别"}'::jsonb)
) AS payload(object_id,entity,data)
WHERE payload.object_id=object.id AND payload.entity=object.entity;
-- Data for Name: dcl_customer_accounts; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: dcl_customer_download_tokens; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: dcl_customer_files; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: dcl_customer_relationships; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: dcl_employment_relationships; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: dcl_fund_account_versions; Type: TABLE DATA; Schema: public; Owner: -
--



-- Data for Name: bob_operating_entities; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: dcl_parties; Type: TABLE DATA; Schema: public; Owner: -
--





--
-- Data for Name: dcl_party_identifier_claims; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: dcl_party_merge_events; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: dcl_party_merge_preflights; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: dcl_party_relationship_merge_events; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: dcl_product_formula_lines; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: dcl_product_formulas; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: dcl_product_unit_conversions; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: dcl_product_versions; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: dcl_sales_relationships; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: dcl_service_relationships; Type: TABLE DATA; Schema: public; Owner: -
--



--

--
-- Data for Name: dcl_vehicle_versions; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: object_number_counters; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.object_number_counters VALUES ('aux', 'measurement-unit', 6);
INSERT INTO public.object_number_counters VALUES ('aux', 'settlement-method', 11);
INSERT INTO public.object_number_counters VALUES ('aux', 'dictionary-type', 3);
INSERT INTO public.object_number_counters VALUES ('aux', 'dictionary-item', 10);
INSERT INTO public.object_number_counters VALUES ('aux', 'product-type', 4);


--
-- Data for Name: rpt_runtime_audit_events; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Built-in report definitions are DCL subjects. Report state lives on the
-- approved version payload, not on a separate root table.
--

INSERT INTO public.dcl_subjects (id, entity, code, created_at, created_by) VALUES
    ('RPD1e68c4c93e49d8d1e1877f9', 'rpt-definition', 'account-journal', '2026-08-24 15:23:49.887333+00', 'SYSTEM'),
    ('RPDb40033a1ed0a842d50c23f1', 'rpt-definition', 'subject-balance', '2026-08-24 15:23:49.887333+00', 'SYSTEM'),
    ('RPD43189400de7a6fe5d7978ed', 'rpt-definition', 'customer-aging', '2026-08-24 15:23:49.887333+00', 'SYSTEM'),
    ('RPD24d57c02d870b62329517d0', 'rpt-definition', 'supplier-aging', '2026-08-24 15:23:49.887333+00', 'SYSTEM'),
    ('RPDef5b48e5bf2909eebd39609', 'rpt-definition', 'inventory-movement', '2026-08-24 15:23:49.887333+00', 'SYSTEM'),
    ('RPDb5237b6a7892a42a4a7a60f', 'rpt-definition', 'bills', '2026-08-24 15:23:49.887333+00', 'SYSTEM'),
    ('RPD57bcbf1d2df6010d41816c0', 'rpt-definition', 'containers', '2026-08-24 15:23:49.887333+00', 'SYSTEM'),
    ('RPD517f80b4080608d1ef8ce23', 'rpt-definition', 'employee-loans', '2026-08-24 15:23:49.887333+00', 'SYSTEM');


--
-- Data for Name: dcl_rpt_definition_versions; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.dcl_rpt_definition_versions (approval_entry_id, enabled, name, description, sql_text, parameters, columns, created_by, updated_by) VALUES ('RPV1e68c4c93e49d8d1e1877f9', true, '科目流水', '系统预置报表', '
    SELECT b.code::text AS book_code,s.code::text AS subject_code,v.business_date::date AS business_date,
        v.id::text AS voucher_id,v.source_document_no::text AS source_document_no,e.currency::text AS currency,
        CASE WHEN e.debit_minor>0 THEN ''DEBIT'' ELSE ''CREDIT'' END::text AS direction,
        (greatest(e.debit_minor,e.credit_minor)::numeric/100) AS amount,
        coalesce(v.source_entity,v.source_type)::text AS source_entity,v.source_id::text AS source_document_id
    FROM acc_voucher_lines e
    JOIN acc_vouchers v ON v.id=e.voucher_id
    JOIN acc_books b ON b.id=e.book_id
    JOIN acc_subjects s ON s.id=e.subject_id AND s.book_id=e.book_id
    WHERE ($1::text='''' OR b.id=$1) AND ($2::text='''' OR s.id=$2)
      AND ($3::text='''' OR e.currency=$3) AND v.business_date <@ $4::daterange
    ORDER BY v.business_date,v.id,e.line_order
    ', '[{"key": "bookId", "name": "会计账簿", "type": "REFERENCE", "required": false, "defaultValue": "", "referenceType": "ACCOUNTING_BOOK"}, {"key": "subjectId", "name": "会计科目", "type": "REFERENCE", "required": false, "defaultValue": "", "referenceType": "ACCOUNT_SUBJECT"}, {"key": "currency", "name": "币种", "type": "TEXT", "required": false, "defaultValue": ""}, {"key": "dateRange", "name": "日期范围", "type": "DATE_RANGE", "required": false, "defaultValue": ["1900-01-01", "9999-12-31"]}]', '[{"name": "账簿", "type": "TEXT", "alias": "book_code", "order": 1, "width": 100, "visible": true}, {"name": "科目", "type": "TEXT", "alias": "subject_code", "order": 2, "width": 100, "visible": true}, {"name": "日期", "type": "DATE", "alias": "business_date", "order": 3, "width": 110, "format": "date", "visible": true}, {"name": "凭证", "type": "ID", "alias": "voucher_id", "order": 4, "width": 180, "visible": false}, {"name": "来源单号", "type": "TEXT", "alias": "source_document_no", "order": 5, "width": 150, "visible": true}, {"name": "币种", "type": "TEXT", "alias": "currency", "order": 6, "width": 80, "visible": true}, {"name": "方向", "type": "TEXT", "alias": "direction", "order": 7, "width": 80, "visible": true}, {"name": "金额", "type": "DECIMAL", "alias": "amount", "order": 8, "width": 120, "format": "money", "visible": true}, {"name": "来源类型", "type": "TEXT", "alias": "source_entity", "order": 9, "width": 130, "visible": true}, {"name": "来源单据", "type": "ID", "alias": "source_document_id", "order": 10, "width": 100, "visible": true, "drilldownEntity": "VOU"}]', 'SYSTEM', 'SYSTEM');
INSERT INTO public.dcl_rpt_definition_versions (approval_entry_id, enabled, name, description, sql_text, parameters, columns, created_by, updated_by) VALUES ('RPVb40033a1ed0a842d50c23f1', true, '科目余额', '系统预置报表', '
    SELECT b.code::text AS book_code,s.code::text AS subject_code,e.currency::text AS currency,
      (sum(CASE WHEN v.business_date<lower($4::daterange) THEN e.debit_minor-e.credit_minor ELSE 0 END)::numeric/100) AS opening_balance,
      (sum(CASE WHEN v.business_date <@ $4::daterange THEN e.debit_minor ELSE 0 END)::numeric/100) AS debit_amount,
      (sum(CASE WHEN v.business_date <@ $4::daterange THEN e.credit_minor ELSE 0 END)::numeric/100) AS credit_amount,
      (sum(CASE WHEN v.business_date<upper($4::daterange) THEN e.debit_minor-e.credit_minor ELSE 0 END)::numeric/100) AS ending_balance,
      (CASE WHEN sum(CASE WHEN v.business_date<upper($4::daterange) THEN e.debit_minor-e.credit_minor ELSE 0 END)>=0 THEN ''DEBIT'' ELSE ''CREDIT'' END)::text AS balance_direction
    FROM acc_voucher_lines e JOIN acc_vouchers v ON v.id=e.voucher_id
    JOIN acc_books b ON b.id=e.book_id JOIN acc_subjects s ON s.id=e.subject_id AND s.book_id=e.book_id
    WHERE ($1::text='''' OR b.id=$1) AND ($2::text='''' OR s.id=$2) AND ($3::text='''' OR e.currency=$3)
      AND v.business_date<upper($4::daterange)
    GROUP BY b.code,s.code,e.currency ORDER BY b.code,s.code,e.currency
    ', '[{"key": "bookId", "name": "会计账簿", "type": "REFERENCE", "required": false, "defaultValue": "", "referenceType": "ACCOUNTING_BOOK"}, {"key": "subjectId", "name": "会计科目", "type": "REFERENCE", "required": false, "defaultValue": "", "referenceType": "ACCOUNT_SUBJECT"}, {"key": "currency", "name": "币种", "type": "TEXT", "required": false, "defaultValue": ""}, {"key": "dateRange", "name": "期间", "type": "DATE_RANGE", "required": false, "defaultValue": ["1900-01-01", "9999-12-31"]}]', '[{"name": "账簿", "type": "TEXT", "alias": "book_code", "order": 1, "width": 100, "visible": true}, {"name": "科目", "type": "TEXT", "alias": "subject_code", "order": 2, "width": 100, "visible": true}, {"name": "币种", "type": "TEXT", "alias": "currency", "order": 3, "width": 80, "visible": true}, {"name": "期初余额", "type": "DECIMAL", "alias": "opening_balance", "order": 4, "width": 130, "format": "money", "visible": true}, {"name": "借方发生", "type": "DECIMAL", "alias": "debit_amount", "order": 5, "width": 130, "format": "money", "visible": true}, {"name": "贷方发生", "type": "DECIMAL", "alias": "credit_amount", "order": 6, "width": 130, "format": "money", "visible": true}, {"name": "期末余额", "type": "DECIMAL", "alias": "ending_balance", "order": 7, "width": 130, "format": "money", "visible": true}, {"name": "余额方向", "type": "TEXT", "alias": "balance_direction", "order": 8, "width": 90, "visible": true}]', 'SYSTEM', 'SYSTEM');
INSERT INTO public.dcl_rpt_definition_versions (approval_entry_id, enabled, name, description, sql_text, parameters, columns, created_by, updated_by) VALUES ('RPVef5b48e5bf2909eebd39609', true, '库存收发存', '系统预置报表', '
    SELECT b.code::text AS book_code,s.code::text AS subject_code,i.warehouse_id::text AS warehouse_id,
      i.product_id::text AS product_id,
      (sum(CASE WHEN i.business_date<date_trunc(''month'',$5::date)::date THEN i.quantity_delta_micros ELSE 0 END)::numeric/1000000) AS opening_quantity,
      (sum(CASE WHEN i.business_date>=date_trunc(''month'',$5::date)::date AND i.business_date<=$5::date AND i.quantity_delta_micros>0 THEN i.quantity_delta_micros ELSE 0 END)::numeric/1000000) AS inbound_quantity,
      (sum(CASE WHEN i.business_date>=date_trunc(''month'',$5::date)::date AND i.business_date<=$5::date AND i.quantity_delta_micros<0 THEN -i.quantity_delta_micros ELSE 0 END)::numeric/1000000) AS outbound_quantity,
      (sum(CASE WHEN i.business_date<=$5::date THEN i.quantity_delta_micros ELSE 0 END)::numeric/1000000) AS ending_quantity,
      CASE WHEN sum(CASE WHEN i.business_date<=$5::date THEN i.quantity_delta_micros ELSE 0 END)=0 THEN NULL
        ELSE (sum(CASE WHEN i.business_date<=$5::date THEN CASE WHEN i.quantity_delta_micros>0 THEN greatest(vl.debit_minor,vl.credit_minor) ELSE -coalesce(c.cost_minor,0) END ELSE 0 END)::numeric/100)
          /(sum(CASE WHEN i.business_date<=$5::date THEN i.quantity_delta_micros ELSE 0 END)::numeric/1000000) END AS average_unit_cost,
      (sum(CASE WHEN i.business_date<=$5::date THEN CASE WHEN i.quantity_delta_micros>0 THEN greatest(vl.debit_minor,vl.credit_minor) ELSE -coalesce(c.cost_minor,0) END ELSE 0 END)::numeric/100) AS ending_amount,
      CASE WHEN count(DISTINCT v.source_id)=1 THEN min(coalesce(v.source_entity,v.source_type)) ELSE '''' END::text AS source_entity,
      CASE WHEN count(DISTINCT v.source_id)=1 THEN min(v.source_id) ELSE '''' END::text AS source_document_id
    FROM acc_inventory_entries i JOIN acc_books b ON b.id=i.book_id
    JOIN acc_subjects s ON s.id=i.subject_id AND s.book_id=i.book_id
    JOIN acc_voucher_lines vl ON vl.id=i.voucher_line_id
    JOIN acc_vouchers v ON v.id=i.voucher_id
    LEFT JOIN acc_inventory_cost_allocations c ON c.entry_id=i.id
    WHERE ($1::text='''' OR i.book_id=$1) AND ($2::text='''' OR i.subject_id=$2)
      AND ($3::text='''' OR i.warehouse_id=$3) AND ($4::text='''' OR i.product_id=$4) AND i.business_date<=$5::date
    GROUP BY b.code,s.code,i.warehouse_id,i.product_id ORDER BY b.code,s.code,i.warehouse_id,i.product_id
    ', '[{"key": "bookId", "name": "会计账簿", "type": "REFERENCE", "required": false, "defaultValue": "", "referenceType": "ACCOUNTING_BOOK"}, {"key": "subjectId", "name": "库存科目", "type": "REFERENCE", "required": false, "defaultValue": "", "referenceType": "ACCOUNT_SUBJECT"}, {"key": "warehouseId", "name": "仓库", "type": "REFERENCE", "required": false, "defaultValue": "", "referenceType": "WAREHOUSE"}, {"key": "productId", "name": "产品", "type": "REFERENCE", "required": false, "defaultValue": "", "referenceType": "PRODUCT"}, {"key": "asOfDate", "name": "截止日", "type": "DATE", "required": false, "defaultValue": "9999-12-31"}]', '[{"name": "账簿", "type": "TEXT", "alias": "book_code", "order": 1, "width": 100, "visible": true}, {"name": "库存科目", "type": "TEXT", "alias": "subject_code", "order": 2, "width": 100, "visible": true}, {"name": "仓库", "type": "ID", "alias": "warehouse_id", "order": 3, "width": 180, "visible": true}, {"name": "产品", "type": "ID", "alias": "product_id", "order": 4, "width": 180, "visible": true}, {"name": "期初数量", "type": "DECIMAL", "alias": "opening_quantity", "order": 5, "width": 120, "format": "quantity", "visible": true}, {"name": "入库数量", "type": "DECIMAL", "alias": "inbound_quantity", "order": 6, "width": 120, "format": "quantity", "visible": true}, {"name": "出库数量", "type": "DECIMAL", "alias": "outbound_quantity", "order": 7, "width": 120, "format": "quantity", "visible": true}, {"name": "期末数量", "type": "DECIMAL", "alias": "ending_quantity", "order": 8, "width": 120, "format": "quantity", "visible": true}, {"name": "移动平均单价", "type": "DECIMAL", "alias": "average_unit_cost", "order": 9, "width": 140, "format": "money", "visible": true}, {"name": "期末金额", "type": "DECIMAL", "alias": "ending_amount", "order": 10, "width": 130, "format": "money", "visible": true}, {"name": "来源类型", "type": "TEXT", "alias": "source_entity", "order": 11, "width": 130, "visible": false}, {"name": "来源单据", "type": "ID", "alias": "source_document_id", "order": 12, "width": 100, "visible": true, "drilldownEntity": "VOU"}]', 'SYSTEM', 'SYSTEM');
INSERT INTO public.dcl_rpt_definition_versions (approval_entry_id, enabled, name, description, sql_text, parameters, columns, created_by, updated_by) VALUES ('RPVb5237b6a7892a42a4a7a60f', true, '票据', '系统预置报表', '
    SELECT book.code::text AS book_code,bill.id::text AS bill_id,bill.bill_no::text AS bill_no,
      CASE WHEN settled.business_date IS NOT NULL AND settled.business_date<=$6::date THEN ''SETTLED'' ELSE ''AVAILABLE'' END::text AS business_status,
      bill.position_type::text AS position_type,bill.currency::text AS currency,
      (bill.face_amount_minor::numeric/100) AS original_amount,
      (value.value_minor::numeric/100) AS carrying_amount,bill.maturity_date::date AS maturity_date,
      coalesce(bill.origin_party_object_id,'''')::text AS party_id,
      coalesce(source.entity,''OPENING'')::text AS source_entity,bill.source_document_id::text AS source_document_id
    FROM acc_bills bill
    JOIN acc_bill_book_values value ON value.bill_id=bill.id
    JOIN acc_books book ON book.id=value.book_id
    LEFT JOIN vou_documents source ON source.id=bill.source_document_id
    LEFT JOIN vou_documents settled ON settled.id=bill.settled_by_document_id
    WHERE ($1::text='''' OR value.book_id=$1) AND ($2::text='''' OR bill.id=$2)
      AND ($3::text='''' OR bill.origin_party_object_id=$3)
      AND ($4::text='''' OR CASE WHEN settled.business_date IS NOT NULL AND settled.business_date<=$6::date THEN ''SETTLED'' ELSE ''AVAILABLE'' END=$4)
      AND bill.maturity_date <@ $5::daterange AND bill.issue_date<=$6::date
    ORDER BY book.code,bill.bill_no,bill.id
    ', '[{"key": "bookId", "name": "会计账簿", "type": "REFERENCE", "required": false, "defaultValue": "", "referenceType": "ACCOUNTING_BOOK"}, {"key": "billId", "name": "票据", "type": "REFERENCE", "required": false, "defaultValue": "", "referenceType": "BILL"}, {"key": "partyId", "name": "往来方", "type": "REFERENCE", "required": false, "defaultValue": "", "referenceType": "OTHER_PARTY"}, {"key": "status", "name": "状态", "type": "ENUM", "required": false, "enumValues": ["", "AVAILABLE", "SETTLED"], "defaultValue": ""}, {"key": "maturityRange", "name": "到期日范围", "type": "DATE_RANGE", "required": false, "defaultValue": ["1900-01-01", "9999-12-31"]}, {"key": "asOfDate", "name": "截止日", "type": "DATE", "required": false, "defaultValue": "9999-12-31"}]', '[{"name": "账簿", "type": "TEXT", "alias": "book_code", "order": 1, "width": 100, "visible": true}, {"name": "票据ID", "type": "ID", "alias": "bill_id", "order": 2, "width": 180, "visible": false}, {"name": "票据号", "type": "TEXT", "alias": "bill_no", "order": 3, "width": 160, "visible": true}, {"name": "业务状态", "type": "TEXT", "alias": "business_status", "order": 4, "width": 110, "visible": true}, {"name": "账簿方向", "type": "TEXT", "alias": "position_type", "order": 5, "width": 100, "visible": true}, {"name": "币种", "type": "TEXT", "alias": "currency", "order": 6, "width": 80, "visible": true}, {"name": "原值", "type": "DECIMAL", "alias": "original_amount", "order": 7, "width": 130, "format": "money", "visible": true}, {"name": "账面金额", "type": "DECIMAL", "alias": "carrying_amount", "order": 8, "width": 130, "format": "money", "visible": true}, {"name": "到期日", "type": "DATE", "alias": "maturity_date", "order": 9, "width": 110, "format": "date", "visible": true}, {"name": "往来方", "type": "ID", "alias": "party_id", "order": 10, "width": 180, "visible": false}, {"name": "来源类型", "type": "TEXT", "alias": "source_entity", "order": 11, "width": 130, "visible": false}, {"name": "来源单据", "type": "ID", "alias": "source_document_id", "order": 12, "width": 100, "visible": true, "drilldownEntity": "VOU"}]', 'SYSTEM', 'SYSTEM');
INSERT INTO public.dcl_rpt_definition_versions (approval_entry_id, enabled, name, description, sql_text, parameters, columns, created_by, updated_by) VALUES ('RPV43189400de7a6fe5d7978ed', true, '客户应收预收账龄', '系统预置报表', '
    WITH facts AS (
      SELECT e.id,e.voucher_id,e.line_order,e.book_id,e.currency,e.dimensions->>''CUSTOMER_ACCOUNT'' AS party_id,v.business_date,
        coalesce(d.due_date,v.business_date) AS due_date,s.settlement_purpose,
        (e.debit_minor-e.credit_minor) AS signed_minor
      FROM acc_voucher_lines e JOIN acc_vouchers v ON v.id=e.voucher_id
      JOIN acc_subjects s ON s.id=e.subject_id AND s.book_id=e.book_id
      LEFT JOIN vou_documents d ON v.source_type=''VOU'' AND d.id=v.source_id
      WHERE s.settlement_purpose IN (''RECEIVABLE'',''ADVANCE_RECEIPT'') AND e.dimensions ? ''CUSTOMER_ACCOUNT''
        AND ($1::text='''' OR e.book_id=$1) AND ($2::text='''' OR e.dimensions->>''CUSTOMER_ACCOUNT''=$2)
        AND ($3::text='''' OR e.currency=$3) AND v.business_date<=$4::date
    ), ranked AS (
      SELECT f.*,
        sum(greatest(f.signed_minor,0)) OVER party AS total_positive,
        sum(greatest(-f.signed_minor,0)) OVER party AS total_negative,
        coalesce(sum(greatest(f.signed_minor,0)) OVER fifo_before,0) AS prior_positive,
        coalesce(sum(greatest(-f.signed_minor,0)) OVER fifo_before,0) AS prior_negative
      FROM facts f
      WINDOW party AS (PARTITION BY f.book_id,f.party_id,f.currency),
        fifo_before AS (PARTITION BY f.book_id,f.party_id,f.currency
          ORDER BY f.due_date,f.business_date,f.voucher_id,f.line_order,f.id ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING)
    ), residuals AS (
      SELECT r.*,
        CASE WHEN r.total_positive>r.total_negative AND r.signed_minor>0
          THEN greatest(r.signed_minor-greatest(r.total_negative-r.prior_positive,0),0)
          WHEN r.total_negative>r.total_positive AND r.signed_minor<0
          THEN greatest(-r.signed_minor-greatest(r.total_positive-r.prior_negative,0),0)
          ELSE 0 END AS residual_minor
      FROM ranked r
    ), balances AS (
      SELECT r.book_id,r.party_id,r.currency,
        sum(CASE WHEN r.settlement_purpose=''RECEIVABLE'' AND r.signed_minor>0 THEN r.signed_minor ELSE 0 END) AS receivable_minor,
        sum(CASE WHEN r.settlement_purpose=''ADVANCE_RECEIPT'' AND r.signed_minor<0 THEN -r.signed_minor ELSE 0 END) AS advance_minor,
        sum(r.signed_minor) AS net_minor,min(r.due_date) FILTER (WHERE r.residual_minor>0) AS oldest_due_date
      FROM residuals r GROUP BY r.book_id,r.party_id,r.currency HAVING sum(r.signed_minor)<>0
    )
    SELECT b.code::text AS book_code,x.party_id::text AS customer_id,coalesce(p.code,x.party_id)::text AS customer_code,
      x.party_id::text AS customer_name,x.currency::text AS currency,
      (x.receivable_minor::numeric/100) AS receivable_amount,(x.advance_minor::numeric/100) AS advance_amount,
      (x.net_minor::numeric/100) AS net_amount,(abs(x.net_minor)::numeric/100) AS unsettled_amount,
      greatest(($4::date-x.oldest_due_date)::bigint,0::bigint) AS oldest_age_days
    FROM balances x JOIN acc_books b ON b.id=x.book_id
    LEFT JOIN dcl_subjects p ON p.id=x.party_id AND p.entity=''customer-account''
    WHERE greatest(($4::date-x.oldest_due_date)::bigint,0::bigint)>=$5::bigint
    ORDER BY b.code,customer_code,x.currency
    ', '[{"key": "bookId", "name": "会计账簿", "type": "REFERENCE", "required": false, "defaultValue": "", "referenceType": "ACCOUNTING_BOOK"}, {"key": "customerId", "name": "客户", "type": "REFERENCE", "required": false, "defaultValue": "", "referenceType": "CUSTOMER_ACCOUNT"}, {"key": "currency", "name": "币种", "type": "TEXT", "required": false, "defaultValue": ""}, {"key": "asOfDate", "name": "截止日", "type": "DATE", "required": false, "defaultValue": "9999-12-31"}, {"key": "minAgeDays", "name": "最小账龄天数", "type": "INTEGER", "required": false, "defaultValue": 0}]', '[{"name": "账簿", "type": "TEXT", "alias": "book_code", "order": 1, "width": 100, "visible": true}, {"name": "客户ID", "type": "ID", "alias": "customer_id", "order": 2, "width": 180, "visible": false}, {"name": "客户编码", "type": "TEXT", "alias": "customer_code", "order": 3, "width": 120, "visible": true}, {"name": "客户名称", "type": "TEXT", "alias": "customer_name", "order": 4, "width": 180, "visible": true}, {"name": "币种", "type": "TEXT", "alias": "currency", "order": 5, "width": 80, "visible": true}, {"name": "应收原额", "type": "DECIMAL", "alias": "receivable_amount", "order": 6, "width": 130, "format": "money", "visible": true}, {"name": "预收原额", "type": "DECIMAL", "alias": "advance_amount", "order": 7, "width": 130, "format": "money", "visible": true}, {"name": "净额", "type": "DECIMAL", "alias": "net_amount", "order": 8, "width": 130, "format": "money", "visible": true}, {"name": "未结金额", "type": "DECIMAL", "alias": "unsettled_amount", "order": 9, "width": 130, "format": "money", "visible": true}, {"name": "最长账龄天数", "type": "INTEGER", "alias": "oldest_age_days", "order": 10, "width": 120, "visible": true}]', 'SYSTEM', 'SYSTEM');
INSERT INTO public.dcl_rpt_definition_versions (approval_entry_id, enabled, name, description, sql_text, parameters, columns, created_by, updated_by) VALUES ('RPV24d57c02d870b62329517d0', true, '供应商应付预付账龄', '系统预置报表', '
    WITH facts AS (
      SELECT e.id,e.voucher_id,e.line_order,e.book_id,e.currency,e.dimensions->>''SUPPLIER_RELATIONSHIP'' AS party_id,v.business_date,
        coalesce(d.due_date,v.business_date) AS due_date,s.settlement_purpose,
        (e.credit_minor-e.debit_minor) AS signed_minor
      FROM acc_voucher_lines e JOIN acc_vouchers v ON v.id=e.voucher_id
      JOIN acc_subjects s ON s.id=e.subject_id AND s.book_id=e.book_id
      LEFT JOIN vou_documents d ON v.source_type=''VOU'' AND d.id=v.source_id
      WHERE s.settlement_purpose IN (''PAYABLE'',''PREPAID'') AND e.dimensions ? ''SUPPLIER_RELATIONSHIP''
        AND ($1::text='''' OR e.book_id=$1) AND ($2::text='''' OR e.dimensions->>''SUPPLIER_RELATIONSHIP''=$2)
        AND ($3::text='''' OR e.currency=$3) AND v.business_date<=$4::date
    ), ranked AS (
      SELECT f.*,
        sum(greatest(f.signed_minor,0)) OVER party AS total_positive,
        sum(greatest(-f.signed_minor,0)) OVER party AS total_negative,
        coalesce(sum(greatest(f.signed_minor,0)) OVER fifo_before,0) AS prior_positive,
        coalesce(sum(greatest(-f.signed_minor,0)) OVER fifo_before,0) AS prior_negative
      FROM facts f
      WINDOW party AS (PARTITION BY f.book_id,f.party_id,f.currency),
        fifo_before AS (PARTITION BY f.book_id,f.party_id,f.currency
          ORDER BY f.due_date,f.business_date,f.voucher_id,f.line_order,f.id ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING)
    ), residuals AS (
      SELECT r.*,
        CASE WHEN r.total_positive>r.total_negative AND r.signed_minor>0
          THEN greatest(r.signed_minor-greatest(r.total_negative-r.prior_positive,0),0)
          WHEN r.total_negative>r.total_positive AND r.signed_minor<0
          THEN greatest(-r.signed_minor-greatest(r.total_positive-r.prior_negative,0),0)
          ELSE 0 END AS residual_minor
      FROM ranked r
    ), balances AS (
      SELECT r.book_id,r.party_id,r.currency,
        sum(CASE WHEN r.settlement_purpose=''PAYABLE'' AND r.signed_minor>0 THEN r.signed_minor ELSE 0 END) AS payable_minor,
        sum(CASE WHEN r.settlement_purpose=''PREPAID'' AND r.signed_minor<0 THEN -r.signed_minor ELSE 0 END) AS advance_minor,
        sum(r.signed_minor) AS net_minor,min(r.due_date) FILTER (WHERE r.residual_minor>0) AS oldest_due_date
      FROM residuals r GROUP BY r.book_id,r.party_id,r.currency HAVING sum(r.signed_minor)<>0
    )
    SELECT b.code::text AS book_code,x.party_id::text AS supplier_id,coalesce(p.code,x.party_id)::text AS supplier_code,
      x.party_id::text AS supplier_name,x.currency::text AS currency,
      (x.payable_minor::numeric/100) AS payable_amount,(x.advance_minor::numeric/100) AS advance_amount,
      (x.net_minor::numeric/100) AS net_amount,(abs(x.net_minor)::numeric/100) AS unsettled_amount,
      greatest(($4::date-x.oldest_due_date)::bigint,0::bigint) AS oldest_age_days
    FROM balances x JOIN acc_books b ON b.id=x.book_id
    LEFT JOIN dcl_subjects p ON p.id=x.party_id AND p.entity=''supplier''
    WHERE greatest(($4::date-x.oldest_due_date)::bigint,0::bigint)>=$5::bigint
    ORDER BY b.code,supplier_code,x.currency
    ', '[{"key": "bookId", "name": "会计账簿", "type": "REFERENCE", "required": false, "defaultValue": "", "referenceType": "ACCOUNTING_BOOK"}, {"key": "supplierId", "name": "供应商", "type": "REFERENCE", "required": false, "defaultValue": "", "referenceType": "SUPPLIER_RELATIONSHIP"}, {"key": "currency", "name": "币种", "type": "TEXT", "required": false, "defaultValue": ""}, {"key": "asOfDate", "name": "截止日", "type": "DATE", "required": false, "defaultValue": "9999-12-31"}, {"key": "minAgeDays", "name": "最小账龄天数", "type": "INTEGER", "required": false, "defaultValue": 0}]', '[{"name": "账簿", "type": "TEXT", "alias": "book_code", "order": 1, "width": 100, "visible": true}, {"name": "供应商ID", "type": "ID", "alias": "supplier_id", "order": 2, "width": 180, "visible": false}, {"name": "供应商编码", "type": "TEXT", "alias": "supplier_code", "order": 3, "width": 120, "visible": true}, {"name": "供应商名称", "type": "TEXT", "alias": "supplier_name", "order": 4, "width": 180, "visible": true}, {"name": "币种", "type": "TEXT", "alias": "currency", "order": 5, "width": 80, "visible": true}, {"name": "应付原额", "type": "DECIMAL", "alias": "payable_amount", "order": 6, "width": 130, "format": "money", "visible": true}, {"name": "预付原额", "type": "DECIMAL", "alias": "advance_amount", "order": 7, "width": 130, "format": "money", "visible": true}, {"name": "净额", "type": "DECIMAL", "alias": "net_amount", "order": 8, "width": 130, "format": "money", "visible": true}, {"name": "未结金额", "type": "DECIMAL", "alias": "unsettled_amount", "order": 9, "width": 130, "format": "money", "visible": true}, {"name": "最长账龄天数", "type": "INTEGER", "alias": "oldest_age_days", "order": 10, "width": 120, "visible": true}]', 'SYSTEM', 'SYSTEM');
INSERT INTO public.dcl_rpt_definition_versions (approval_entry_id, enabled, name, description, sql_text, parameters, columns, created_by, updated_by) VALUES ('RPV57bcbf1d2df6010d41816c0', true, '空桶', '系统预置报表', '
    WITH facts AS (
      SELECT book.id AS book_id,book.code,e.customer_id,e.container_type,e.quantity_delta,
        coalesce(source.business_date,book.start_month) AS business_date,e.source_revision
      FROM acc_container_entries e
      JOIN acc_books book ON
        (e.source_revision=0 AND e.source_document_id=book.id)
        OR (e.source_revision>0 AND EXISTS(
          SELECT 1 FROM acc_vouchers voucher
          WHERE voucher.book_id=book.id AND voucher.source_id=e.source_document_id
        ))
      LEFT JOIN LATERAL (
        SELECT voucher.business_date FROM acc_vouchers voucher
        WHERE voucher.book_id=book.id AND voucher.source_id=e.source_document_id
        ORDER BY voucher.id LIMIT 1
      ) source ON true
      WHERE ($1::text='''' OR book.id=$1) AND ($2::text='''' OR e.customer_id=$2)
        AND ($3::text='''' OR e.container_type=$3)
        AND coalesce(source.business_date,book.start_month)<=$4::date
    ), movements AS (
      SELECT book_id,code,customer_id,container_type,
        sum(CASE WHEN business_date<date_trunc(''month'',$4::date)::date THEN quantity_delta ELSE 0 END) AS opening_quantity,
        sum(CASE WHEN business_date>=date_trunc(''month'',$4::date)::date AND quantity_delta>0 THEN quantity_delta ELSE 0 END) AS issued_quantity,
        sum(CASE WHEN business_date>=date_trunc(''month'',$4::date)::date AND quantity_delta<0 THEN -quantity_delta ELSE 0 END) AS returned_quantity,
        0::bigint AS adjusted_quantity,sum(quantity_delta) AS balance_quantity
      FROM facts GROUP BY book_id,code,customer_id,container_type
    )
    SELECT m.code::text AS book_code,m.customer_id::text AS customer_id,
      coalesce(customer.code,m.customer_id)::text AS customer_code,
      m.customer_id::text AS customer_name,m.container_type::text AS container_type,
      m.opening_quantity::numeric AS opening_quantity,m.issued_quantity::numeric AS issued_quantity,
      m.returned_quantity::numeric AS returned_quantity,m.adjusted_quantity::numeric AS adjusted_quantity,
      m.balance_quantity::numeric AS balance_quantity,NULL::numeric AS amount
    FROM movements m
    LEFT JOIN dcl_subjects customer ON customer.id=m.customer_id AND customer.entity=''customer-account''
    ORDER BY m.code,customer_code,m.container_type
    ', '[{"key": "bookId", "name": "会计账簿", "type": "REFERENCE", "required": false, "defaultValue": "", "referenceType": "ACCOUNTING_BOOK"}, {"key": "customerId", "name": "客户", "type": "REFERENCE", "required": false, "defaultValue": "", "referenceType": "CUSTOMER_ACCOUNT"}, {"key": "containerType", "name": "桶型", "type": "ENUM", "required": false, "enumValues": ["", "SOLVENT", "RESIN"], "defaultValue": ""}, {"key": "asOfDate", "name": "截止日", "type": "DATE", "required": false, "defaultValue": "9999-12-31"}]', '[{"name": "账簿", "type": "TEXT", "alias": "book_code", "order": 1, "width": 100, "visible": true}, {"name": "客户ID", "type": "ID", "alias": "customer_id", "order": 2, "width": 180, "visible": false}, {"name": "客户编码", "type": "TEXT", "alias": "customer_code", "order": 3, "width": 120, "visible": true}, {"name": "客户名称", "type": "TEXT", "alias": "customer_name", "order": 4, "width": 180, "visible": true}, {"name": "桶型", "type": "TEXT", "alias": "container_type", "order": 5, "width": 100, "visible": true}, {"name": "期初", "type": "DECIMAL", "alias": "opening_quantity", "order": 6, "width": 110, "format": "quantity", "visible": true}, {"name": "发出", "type": "DECIMAL", "alias": "issued_quantity", "order": 7, "width": 110, "format": "quantity", "visible": true}, {"name": "收回", "type": "DECIMAL", "alias": "returned_quantity", "order": 8, "width": 110, "format": "quantity", "visible": true}, {"name": "调整", "type": "DECIMAL", "alias": "adjusted_quantity", "order": 9, "width": 110, "format": "quantity", "visible": true}, {"name": "欠桶余额", "type": "DECIMAL", "alias": "balance_quantity", "order": 10, "width": 120, "format": "quantity", "visible": true}, {"name": "核算金额", "type": "DECIMAL", "alias": "amount", "order": 11, "width": 130, "format": "money", "visible": true}]', 'SYSTEM', 'SYSTEM');
INSERT INTO public.dcl_rpt_definition_versions (approval_entry_id, enabled, name, description, sql_text, parameters, columns, created_by, updated_by) VALUES ('RPV517f80b4080608d1ef8ce23', true, '员工借款', '系统预置报表', '
    WITH facts AS (
      SELECT e.id,e.voucher_id,e.line_order,e.book_id,e.currency,e.dimensions->>''EMPLOYMENT_RELATIONSHIP'' AS employee_id,v.business_date,v.source_entity,
        (e.debit_minor-e.credit_minor) AS signed_minor
      FROM acc_voucher_lines e JOIN acc_vouchers v ON v.id=e.voucher_id
      WHERE e.dimensions ? ''EMPLOYMENT_RELATIONSHIP'' AND v.source_entity IN (''employee-loan'',''employee-repayment'',''employee-loan-writeoff'')
        AND ($1::text='''' OR e.book_id=$1) AND ($2::text='''' OR e.dimensions->>''EMPLOYMENT_RELATIONSHIP''=$2)
        AND ($3::text='''' OR e.currency=$3) AND v.business_date<=$4::date
    ), ranked AS (
      SELECT f.*,
        sum(greatest(f.signed_minor,0)) OVER party AS total_positive,
        sum(greatest(-f.signed_minor,0)) OVER party AS total_negative,
        coalesce(sum(greatest(f.signed_minor,0)) OVER fifo_before,0) AS prior_positive,
        coalesce(sum(greatest(-f.signed_minor,0)) OVER fifo_before,0) AS prior_negative
      FROM facts f
      WINDOW party AS (PARTITION BY f.book_id,f.employee_id,f.currency),
        fifo_before AS (PARTITION BY f.book_id,f.employee_id,f.currency
          ORDER BY f.business_date,f.voucher_id,f.line_order,f.id ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING)
    ), residuals AS (
      SELECT r.*,
        CASE WHEN r.total_positive>r.total_negative AND r.signed_minor>0
          THEN greatest(r.signed_minor-greatest(r.total_negative-r.prior_positive,0),0)
          WHEN r.total_negative>r.total_positive AND r.signed_minor<0
          THEN greatest(-r.signed_minor-greatest(r.total_positive-r.prior_negative,0),0)
          ELSE 0 END AS residual_minor
      FROM ranked r
    ), balances AS (
      SELECT r.book_id,r.employee_id,r.currency,
        sum(CASE WHEN r.source_entity=''employee-loan'' AND r.signed_minor>0 THEN r.signed_minor ELSE 0 END) AS loan_minor,
        sum(CASE WHEN r.source_entity=''employee-repayment'' THEN abs(r.signed_minor) ELSE 0 END) AS repayment_minor,
        sum(CASE WHEN r.source_entity=''employee-loan-writeoff'' THEN abs(r.signed_minor) ELSE 0 END) AS writeoff_minor,
        sum(r.signed_minor) AS balance_minor,min(r.business_date) FILTER (WHERE r.residual_minor>0) AS oldest_date
      FROM residuals r GROUP BY r.book_id,r.employee_id,r.currency HAVING sum(r.signed_minor)<>0
    )
    SELECT b.code::text AS book_code,x.employee_id::text AS employee_id,coalesce(p.code,x.employee_id)::text AS employee_code,
      x.employee_id::text AS employee_name,x.currency::text AS currency,
      (x.loan_minor::numeric/100) AS loan_amount,(x.repayment_minor::numeric/100) AS repayment_amount,
      (x.writeoff_minor::numeric/100) AS writeoff_amount,(x.balance_minor::numeric/100) AS balance,
      (abs(x.balance_minor)::numeric/100) AS unsettled_amount,greatest(($4::date-x.oldest_date)::bigint,0::bigint) AS oldest_age_days,
      (CASE WHEN x.balance_minor<0 THEN ''PAYABLE_TO_EMPLOYEE'' ELSE ''RECEIVABLE_FROM_EMPLOYEE'' END)::text AS balance_meaning
    FROM balances x JOIN acc_books b ON b.id=x.book_id
    LEFT JOIN dcl_subjects p ON p.id=x.employee_id AND p.entity=''employee''
    ORDER BY b.code,employee_code,x.currency
    ', '[{"key": "bookId", "name": "会计账簿", "type": "REFERENCE", "required": false, "defaultValue": "", "referenceType": "ACCOUNTING_BOOK"}, {"key": "employeeId", "name": "员工", "type": "REFERENCE", "required": false, "defaultValue": "", "referenceType": "EMPLOYMENT_RELATIONSHIP"}, {"key": "currency", "name": "币种", "type": "TEXT", "required": false, "defaultValue": ""}, {"key": "asOfDate", "name": "截止日", "type": "DATE", "required": false, "defaultValue": "9999-12-31"}]', '[{"name": "账簿", "type": "TEXT", "alias": "book_code", "order": 1, "width": 100, "visible": true}, {"name": "员工ID", "type": "ID", "alias": "employee_id", "order": 2, "width": 180, "visible": false}, {"name": "员工编码", "type": "TEXT", "alias": "employee_code", "order": 3, "width": 120, "visible": true}, {"name": "员工姓名", "type": "TEXT", "alias": "employee_name", "order": 4, "width": 150, "visible": true}, {"name": "币种", "type": "TEXT", "alias": "currency", "order": 5, "width": 80, "visible": true}, {"name": "借款", "type": "DECIMAL", "alias": "loan_amount", "order": 6, "width": 120, "format": "money", "visible": true}, {"name": "还款", "type": "DECIMAL", "alias": "repayment_amount", "order": 7, "width": 120, "format": "money", "visible": true}, {"name": "费用核销", "type": "DECIMAL", "alias": "writeoff_amount", "order": 8, "width": 120, "format": "money", "visible": true}, {"name": "余额", "type": "DECIMAL", "alias": "balance", "order": 9, "width": 120, "format": "money", "visible": true}, {"name": "未结金额", "type": "DECIMAL", "alias": "unsettled_amount", "order": 10, "width": 120, "format": "money", "visible": true}, {"name": "最长账龄天数", "type": "INTEGER", "alias": "oldest_age_days", "order": 11, "width": 120, "visible": true}, {"name": "余额含义", "type": "TEXT", "alias": "balance_meaning", "order": 12, "width": 170, "visible": true}]', 'SYSTEM', 'SYSTEM');

INSERT INTO public.rpt_definition_validities (approval_entry_id, validity, created_by, updated_by)
SELECT approval_entry_id, 'VALID', 'SYSTEM', 'SYSTEM'
FROM public.dcl_rpt_definition_versions;


--
-- Data for Name: vou_asset_acquisition_details; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: vou_asset_acquisition_lines; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: vou_asset_liquidation_details; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: vou_asset_liquidation_lines; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: vou_asset_sale_details; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: vou_asset_sale_lines; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: vou_bill_cash_lines; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: vou_bill_details; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: vou_bill_lines; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: vou_document_attachments; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: vou_documents; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: vou_download_tokens; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: vou_employee_loan_writeoff_details; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: vou_expense_lines; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: vou_expense_payment_details; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: vou_expense_reimbursement_details; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: vou_files; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: vou_intermediary_calculation_bill_allocations; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: vou_intermediary_calculation_details; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: vou_intermediary_calculation_lines; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: vou_intermediary_calculation_summaries; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: vou_intermediary_scripts; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.vou_intermediary_scripts VALUES ('00000000000000000000005701', true, 3, '2026 居间计算规则', '
globalThis.calculate = function calculate(input) {
  const number = (value) => Number(value || 0);
  const money = (value) => (Math.round((value + Number.EPSILON) * 100) / 100).toFixed(2);
  const quantity = (value) => (Math.round((value + Number.EPSILON) * 1000000) / 1000000).toString();
  const byEmployee = new Map();
  const byCustomer = new Map();
  const delayedRates = (term, delay, lowPrice) => {
    let baseRate = lowPrice ? 0 : 8;
    let lowRate = lowPrice ? 3 : 0;
    let premiumAllowed = true;
    if (term === ''MONTHLY_CURRENT'') {
      baseRate = lowPrice ? 0 : 5;
      if (delay > 7) { baseRate = lowPrice ? 0 : 3; lowRate = 0; }
      if (delay > 20) { baseRate = 0; lowRate = 0; premiumAllowed = false; }
    } else if (term === ''ARRIVAL_30'') {
      if (delay > 7) baseRate = lowPrice ? 0 : 3;
      if (delay > 15) { baseRate = 0; lowRate = 0; }
      if (delay > 20) premiumAllowed = false;
    } else if (term === ''MONTHLY_30'') {
      if (delay > 7) baseRate = lowPrice ? 0 : 5;
      if (delay > 10) baseRate = lowPrice ? 0 : 3;
      if (delay > 20) { baseRate = 0; lowRate = 0; }
      if (delay > 30) premiumAllowed = false;
    } else if (term === ''MONTHLY_60'') {
      if (delay > 0) baseRate = lowPrice ? 0 : 5;
      if (delay > 7) baseRate = lowPrice ? 0 : 3;
      if (delay > 30) { baseRate = 0; lowRate = 0; premiumAllowed = false; }
    } else if (term === ''MONTHLY_90'') {
      baseRate = 0; lowRate = 0; premiumAllowed = false;
    } else {
      if (delay > 7) { baseRate = 0; lowRate = 0; }
      if (delay > 15) premiumAllowed = false;
    }
    return { baseRate, lowRate, premiumAllowed };
  };
  const rows = input.lines.map((line) => {
    if (line.sourceKind === ''RETURN_ADJUSTMENT'') {
      return {
        sourceSignoffLineId: line.sourceSignoffLineId,
        premiumUnitPrice: ''0.00'',
        standardPieceQuantity: line.standardPieceQuantity,
        baseCommission: ''0.00'',
        premiumCommission: ''0.00'',
        lowPriceCommission: ''0.00'',
        marketMaintenanceSubsidy: ''0.00'',
        marketDevelopmentSubsidy: ''0.00'',
        billCost: ''0.00'',
        billLineIds: [],
        employeeAmount: money(-number(line.adjustmentEmployeeAmount)),
        intermediaryAmount: money(-number(line.adjustmentIntermediaryAmount)),
        note: ''跨月退货冲回：'' + (line.returnDocumentNos || []).join(''、'')
      };
    }
    const unitPrice = number(line.unitPrice);
    const referencePrice = number(line.referenceUnitPrice);
    const surcharge = number(line.settlementSurcharge);
    const pricingQuantity = number(line.pricingQuantity);
	const standardPieces = number(line.standardPieceQuantity);
    const premium = unitPrice - referencePrice - surcharge;
    const special = line.specialApproval === true;
    const lowPrice = special || premium < 0;
    const rates = delayedRates(line.settlementTermCode, Number(line.collectionDelayDays), lowPrice);
	const base = standardPieces * rates.baseRate;
	const low = standardPieces * rates.lowRate;
    const premiumCommission = !lowPrice && !line.intermediary && rates.premiumAllowed
	  ? standardPieces * Math.floor((premium + 0.000000001) / 0.05) * 2.5
      : 0;
	const maintenance = special ? 0 : standardPieces * 2;
    const intermediary = line.intermediary && premium > 0 && rates.premiumAllowed
      ? premium * pricingQuantity / 1.13
      : 0;
    const gross = base + low + premiumCommission + maintenance;
    const row = {
      sourceSignoffLineId: line.sourceSignoffLineId,
      premiumUnitPrice: money(premium),
	  standardPieceQuantity: quantity(standardPieces),
      baseCommission: money(base),
      premiumCommission: money(premiumCommission),
      lowPriceCommission: money(low),
      marketMaintenanceSubsidy: money(maintenance),
      marketDevelopmentSubsidy: ''0.00'',
      billCost: ''0.00'',
      billLineIds: [],
      employeeAmount: money(gross),
      intermediaryAmount: money(intermediary),
      note: [special ? ''特批销售'' : (lowPrice ? ''低价销售'' : ''''),
        line.collectionDelayDays > 0 ? ''延期'' + line.collectionDelayDays + ''天'' : '''',
        line.settlementTermCode === ''MONTHLY_90'' ? ''月结90天需单独审批'' : ''''].filter(Boolean).join(''；'')
    };
    const item = { source: line, result: row };
    const employeeKey = line.salesperson.objectId;
	const employeeGroup = byEmployee.get(employeeKey) || { lines: [], standardPieces: 0 };
    employeeGroup.lines.push(item);
	if (!special) employeeGroup.standardPieces += standardPieces;
    byEmployee.set(employeeKey, employeeGroup);
    const costKey = line.customer.objectId;
    const costGroup = byCustomer.get(costKey) || { lines: [], bills: [] };
    costGroup.lines.push(item);
    byCustomer.set(costKey, costGroup);
    return row;
  });
  for (const bill of input.bills) {
    const key = bill.customer.objectId;
    const group = byCustomer.get(key);
    if (group) {
      group.bills.push({
        billLineId: bill.billLineId,
        cost: number(money(number(bill.faceAmount) * 0.03 * Number(bill.costDays) / 365))
      });
    }
  }
  for (const group of byEmployee.values()) {
    const ordinary = group.lines.find((item) => item.source.specialApproval !== true);
    const development = ordinary
	  ? 1800 + Math.max(0, Math.floor((group.standardPieces - 300) / 100)) * 200
      : 0;
    if (ordinary) {
      ordinary.result.marketDevelopmentSubsidy = money(development);
      ordinary.result.employeeAmount = money(number(ordinary.result.employeeAmount) + development);
    }
  }
  for (const group of byCustomer.values()) {
    let available = number(money(group.lines.reduce(
      (sum, item) => sum + number(item.result.employeeAmount), 0
    )));
    const allocatedBillLineIds = [];
    for (const bill of group.bills) {
      if (bill.cost <= 0) continue;
      if (bill.cost > available) break;
      allocatedBillLineIds.push(bill.billLineId);
      available = number(money(available - bill.cost));
      let remainingCost = bill.cost;
      for (const item of group.lines) {
        if (remainingCost <= 0) break;
        const lineAvailable = number(item.result.employeeAmount);
        const deducted = Math.min(lineAvailable, remainingCost);
        item.result.billCost = money(number(item.result.billCost) + deducted);
        item.result.employeeAmount = money(lineAvailable - deducted);
        remainingCost = number(money(remainingCost - deducted));
      }
    }
    if (group.lines.length) group.lines[0].result.billLineIds = allocatedBillLineIds;
  }
  const summaries = new Map();
  const add = (payee, category, amount) => {
    const rounded = number(money(number(amount)));
    if (!payee || rounded === 0) return;
    const key = category + '':'' + payee.entity + '':'' + payee.objectId;
    const current = summaries.get(key);
    summaries.set(key, { payee, category, amount: money((current ? number(current.amount) : 0) + rounded) });
  };
  rows.forEach((row, index) => {
    const source = input.lines[index];
    add(source.salesperson, source.salesAttributionType === ''INTERNAL_EMPLOYEE'' ? ''COMMISSION'' : source.salesAttributionType, row.employeeAmount);
    add(source.intermediary, ''INTERMEDIARY'', row.intermediaryAmount);
  });
  return { lines: rows, summaries: Array.from(summaries.values()).filter((item) => number(item.amount) !== 0) };
};
', '1a6f100072b930328e05f4aed42d143cbc29169f483110bfaaff5517bd4a0281', '2026-08-24 15:23:50.719182+00', '01JAPPSYST3MACTR0000000000');


--
-- Data for Name: vou_inventory_count_details; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: vou_inventory_count_lines; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: vou_number_counters; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: vou_other_income_details; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: vou_payment_details; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: vou_price_lines; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: vou_product_lines; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: vou_production_details; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: vou_production_material_lines; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: vou_production_output_lines; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: vou_purchase_inbound_details; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: vou_purchase_inbound_lines; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: vou_purchase_inquiry_details; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: vou_purchase_order_details; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: vou_purchase_return_details; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: vou_purchase_return_lines; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: vou_receipt_details; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: vou_sale_delivery_details; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: vou_sale_order_details; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: vou_sale_order_formula_lines; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: vou_sale_order_formulas; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: vou_sale_outbound_details; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: vou_sale_outbound_lines; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: vou_sale_pricing_details; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: vou_sale_return_details; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: vou_sale_return_lines; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: vou_sale_signoff_details; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: vou_sale_signoff_lines; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: vou_service_acceptance_details; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: vou_service_contract_details; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: wfl_action_executions; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: wfl_create_child_requests; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: wfl_definition_instances; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: dcl_wfl_process_definition_versions; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: wfl_node_instances; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: wfl_process_definitions; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.wfl_process_definitions (id, code, enabled, revision, created_by, updated_by) VALUES
    ('WFD0f7b734eecb146455d2f051', 'expense-payment', false, 1, '01JAPPSYST3MACTR0000000000', '01JAPPSYST3MACTR0000000000'),
    ('WFD811182d17c4453955c72f85', 'purchase-fulfillment', false, 1, '01JAPPSYST3MACTR0000000000', '01JAPPSYST3MACTR0000000000'),
    ('WFDcd6f1eaebf0d5b6055c58fe', 'sales-fulfillment', false, 1, '01JAPPSYST3MACTR0000000000', '01JAPPSYST3MACTR0000000000');
INSERT INTO public.dcl_wfl_process_definition_versions (approval_entry_id, definition_id, script, diagnostic, compiled, last_trial_approval_revision, created_by, updated_by) VALUES ('WVE0f7b734eecb146455d2f051', 'WFD0f7b734eecb146455d2f051', 'reimbursement = node(key="reimbursement", name="费用报销", entity="expense-reimbursement")
payment = node(key="payment", name="费用付款", entity="expense-payment")
workflow(code="expense-payment", name="费用报销付款", root=reimbursement, edges=[edge(source=reimbursement, target=payment, relation="payment", action=expense_payment(initial={"fundAccountObjectId": ""}))])', NULL, '{"edges": [{"relation": "payment", "sourceKey": "reimbursement", "targetKey": "payment", "actionName": "expense_payment"}], "nodes": [{"key": "reimbursement", "name": "费用报销", "entity": "expense-reimbursement"}, {"key": "payment", "name": "费用付款", "entity": "expense-payment"}], "rootKey": "reimbursement"}', NULL, '01JAPPSYST3MACTR0000000000', '01JAPPSYST3MACTR0000000000');
INSERT INTO public.dcl_wfl_process_definition_versions (approval_entry_id, definition_id, script, diagnostic, compiled, last_trial_approval_revision, created_by, updated_by) VALUES ('WVE811182d17c4453955c72f85', 'WFD811182d17c4453955c72f85', 'purchase = node(key="purchase-order", name="采购订单", entity="purchase-order")
inbound = node(key="purchase-inbound", name="采购入库", entity="purchase-inbound")
workflow(code="purchase-fulfillment", name="采购履约", root=purchase, edges=[edge(source=purchase, target=inbound, relation="inbound", action=purchase_inbound(initial={}))])', NULL, '{"edges": [{"relation": "inbound", "sourceKey": "purchase-order", "targetKey": "purchase-inbound", "actionName": "purchase_inbound"}], "nodes": [{"key": "purchase-order", "name": "采购订单", "entity": "purchase-order"}, {"key": "purchase-inbound", "name": "采购入库", "entity": "purchase-inbound"}], "rootKey": "purchase-order"}', NULL, '01JAPPSYST3MACTR0000000000', '01JAPPSYST3MACTR0000000000');
INSERT INTO public.dcl_wfl_process_definition_versions (approval_entry_id, definition_id, script, diagnostic, compiled, last_trial_approval_revision, created_by, updated_by) VALUES ('WVEcd6f1eaebf0d5b6055c58fe', 'WFDcd6f1eaebf0d5b6055c58fe', 'order = node(key="sale-order", name="销售订单", entity="sale-order")
outbound = node(key="sale-outbound", name="销售出库", entity="sale-outbound")
delivery = node(key="sale-delivery", name="销售送货", entity="sale-delivery")
signoff = node(key="sale-signoff", name="销售签收", entity="sale-signoff")
refusal_return = node(key="sale-return", name="拒收退货", entity="sale-return")
workflow(code="sales-fulfillment", name="销售履约", root=order, edges=[edge(source=order, target=outbound, relation="outbound", action=sale_outbound(initial={})), edge(source=outbound, target=delivery, relation="delivery", action=sale_delivery(initial={"carrierServiceRelationshipObjectId":"","vehicleObjectId":""})), edge(source=delivery, target=signoff, relation="signoff", action=sale_signoff(initial={})), edge(source=signoff, target=refusal_return, relation="refusal-return", action=sale_return(initial={}))])', NULL, '{"edges": [{"relation": "outbound", "sourceKey": "sale-order", "targetKey": "sale-outbound", "actionName": "sale_outbound"}, {"relation": "delivery", "sourceKey": "sale-outbound", "targetKey": "sale-delivery", "actionName": "sale_delivery"}, {"relation": "signoff", "sourceKey": "sale-delivery", "targetKey": "sale-signoff", "actionName": "sale_signoff"}, {"relation": "refusal-return", "sourceKey": "sale-signoff", "targetKey": "sale-return", "actionName": "sale_return"}], "nodes": [{"key": "sale-order", "name": "销售订单", "entity": "sale-order"}, {"key": "sale-outbound", "name": "销售出库", "entity": "sale-outbound"}, {"key": "sale-delivery", "name": "销售送货", "entity": "sale-delivery"}, {"key": "sale-signoff", "name": "销售签收", "entity": "sale-signoff"}, {"key": "sale-return", "name": "拒收退货", "entity": "sale-return"}], "rootKey": "sale-order"}', NULL, '01JAPPSYST3MACTR0000000000', '01JAPPSYST3MACTR0000000000');
UPDATE public.dcl_wfl_process_definition_versions
SET compiled=jsonb_set(compiled, '{name}', to_jsonb(CASE definition_id
    WHEN 'WFD0f7b734eecb146455d2f051' THEN '费用报销付款'
    WHEN 'WFD811182d17c4453955c72f85' THEN '采购履约'
    WHEN 'WFDcd6f1eaebf0d5b6055c58fe' THEN '销售履约'
END::text));


--
-- Data for Name: wfl_runtime_audit_events; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Name: acc_asset_book_values acc_asset_book_values_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_asset_book_values
    ADD CONSTRAINT acc_asset_book_values_pkey PRIMARY KEY (book_id, asset_id);


--
-- Name: acc_assets acc_assets_asset_no_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_assets
    ADD CONSTRAINT acc_assets_asset_no_key UNIQUE (asset_no);


--
-- Name: acc_assets acc_assets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_assets
    ADD CONSTRAINT acc_assets_pkey PRIMARY KEY (id);


--
-- Name: acc_assets acc_assets_source_line_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_assets
    ADD CONSTRAINT acc_assets_source_line_id_key UNIQUE (source_line_id);


--
-- Name: acc_bill_book_values acc_bill_book_values_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_bill_book_values
    ADD CONSTRAINT acc_bill_book_values_pkey PRIMARY KEY (book_id, bill_id);


--
-- Name: acc_bills acc_bills_bill_no_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_bills
    ADD CONSTRAINT acc_bills_bill_no_key UNIQUE (bill_no);


--
-- Name: acc_bills acc_bills_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_bills
    ADD CONSTRAINT acc_bills_pkey PRIMARY KEY (id);


--
-- Name: acc_bills acc_bills_source_line_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_bills
    ADD CONSTRAINT acc_bills_source_line_id_key UNIQUE (source_line_id);


--
-- Name: acc_book_user_scopes acc_book_user_scopes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_book_user_scopes
    ADD CONSTRAINT acc_book_user_scopes_pkey PRIMARY KEY (book_id, user_id);


--
-- Name: acc_books acc_books_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_books
    ADD CONSTRAINT acc_books_code_key UNIQUE (code);


--
-- Name: acc_books acc_books_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_books
    ADD CONSTRAINT acc_books_pkey PRIMARY KEY (id);


--
-- Name: acc_container_entries acc_container_entries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_container_entries
    ADD CONSTRAINT acc_container_entries_pkey PRIMARY KEY (id);


--
-- Name: acc_container_entries acc_container_entries_source_document_id_customer_id_contai_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_container_entries
    ADD CONSTRAINT acc_container_entries_source_document_id_customer_id_contai_key UNIQUE (source_document_id, customer_id, container_type);


--
-- Name: acc_depreciation_entries acc_depreciation_entries_book_id_asset_id_period_month_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_depreciation_entries
    ADD CONSTRAINT acc_depreciation_entries_book_id_asset_id_period_month_key UNIQUE (book_id, asset_id, period_month);


--
-- Name: acc_depreciation_entries acc_depreciation_entries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_depreciation_entries
    ADD CONSTRAINT acc_depreciation_entries_pkey PRIMARY KEY (id);


--
-- Name: acc_inventory_cost_allocations acc_inventory_cost_allocations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_inventory_cost_allocations
    ADD CONSTRAINT acc_inventory_cost_allocations_pkey PRIMARY KEY (entry_id);


--
-- Name: acc_inventory_entries acc_inventory_entries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_inventory_entries
    ADD CONSTRAINT acc_inventory_entries_pkey PRIMARY KEY (id);


--
-- Name: acc_inventory_entries acc_inventory_entries_voucher_line_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_inventory_entries
    ADD CONSTRAINT acc_inventory_entries_voucher_line_id_key UNIQUE (voucher_line_id);


--
-- Name: acc_mappings acc_mappings_book_id_vou_entity_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_mappings
    ADD CONSTRAINT acc_mappings_book_id_vou_entity_key UNIQUE (book_id, vou_entity);


--
-- Name: acc_mappings acc_mappings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_mappings
    ADD CONSTRAINT acc_mappings_pkey PRIMARY KEY (id);


--
-- Name: dcl_acc_mapping_versions dcl_acc_mapping_versions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dcl_acc_mapping_versions
    ADD CONSTRAINT dcl_acc_mapping_versions_pkey PRIMARY KEY (approval_entry_id);


--
-- Name: acc_opening_assets acc_opening_assets_book_id_line_order_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_opening_assets
    ADD CONSTRAINT acc_opening_assets_book_id_line_order_key UNIQUE (book_id, line_order);


--
-- Name: acc_opening_assets acc_opening_assets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_opening_assets
    ADD CONSTRAINT acc_opening_assets_pkey PRIMARY KEY (book_id, asset_id);


--
-- Name: acc_opening_bills acc_opening_bills_book_id_line_order_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_opening_bills
    ADD CONSTRAINT acc_opening_bills_book_id_line_order_key UNIQUE (book_id, line_order);


--
-- Name: acc_opening_bills acc_opening_bills_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_opening_bills
    ADD CONSTRAINT acc_opening_bills_pkey PRIMARY KEY (book_id, bill_id);


--
-- Name: acc_opening_containers acc_opening_containers_book_id_line_order_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_opening_containers
    ADD CONSTRAINT acc_opening_containers_book_id_line_order_key UNIQUE (book_id, line_order);


--
-- Name: acc_opening_containers acc_opening_containers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_opening_containers
    ADD CONSTRAINT acc_opening_containers_pkey PRIMARY KEY (book_id, customer_id, container_type);


--
-- Name: acc_opening_lines acc_opening_lines_book_id_line_order_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_opening_lines
    ADD CONSTRAINT acc_opening_lines_book_id_line_order_key UNIQUE (book_id, line_order);


--
-- Name: acc_opening_lines acc_opening_lines_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_opening_lines
    ADD CONSTRAINT acc_opening_lines_pkey PRIMARY KEY (id);


--
-- Name: acc_openings acc_openings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_openings
    ADD CONSTRAINT acc_openings_pkey PRIMARY KEY (book_id);


--
-- Name: acc_period_balances acc_period_balances_book_id_period_month_subject_id_currenc_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_period_balances
    ADD CONSTRAINT acc_period_balances_book_id_period_month_subject_id_currenc_key UNIQUE (book_id, period_month, subject_id, currency, dimension_key);


--
-- Name: acc_period_balances acc_period_balances_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_period_balances
    ADD CONSTRAINT acc_period_balances_pkey PRIMARY KEY (id);


--
-- Name: acc_periods acc_periods_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_periods
    ADD CONSTRAINT acc_periods_pkey PRIMARY KEY (book_id, period_month);


--
-- Name: acc_register_events acc_register_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_register_events
    ADD CONSTRAINT acc_register_events_pkey PRIMARY KEY (source_entity, source_document_id);


--
-- Name: acc_subject_dimensions acc_subject_dimensions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_subject_dimensions
    ADD CONSTRAINT acc_subject_dimensions_pkey PRIMARY KEY (subject_id, dimension);


--
-- Name: acc_subject_usages acc_subject_usages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_subject_usages
    ADD CONSTRAINT acc_subject_usages_pkey PRIMARY KEY (subject_id, usage_type, usage_id);


--
-- Name: acc_subjects acc_subjects_book_id_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_subjects
    ADD CONSTRAINT acc_subjects_book_id_code_key UNIQUE (book_id, code);


--
-- Name: acc_subjects acc_subjects_book_id_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_subjects
    ADD CONSTRAINT acc_subjects_book_id_id_key UNIQUE (book_id, id);


--
-- Name: acc_subjects acc_subjects_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_subjects
    ADD CONSTRAINT acc_subjects_pkey PRIMARY KEY (id);


--
-- Name: acc_voucher_lines acc_voucher_lines_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_voucher_lines
    ADD CONSTRAINT acc_voucher_lines_pkey PRIMARY KEY (id);


--
-- Name: acc_voucher_lines acc_voucher_lines_voucher_id_line_order_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_voucher_lines
    ADD CONSTRAINT acc_voucher_lines_voucher_id_line_order_key UNIQUE (voucher_id, line_order);


--
-- Name: acc_vouchers acc_vouchers_book_id_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_vouchers
    ADD CONSTRAINT acc_vouchers_book_id_id_key UNIQUE (book_id, id);


--
-- Name: acc_vouchers acc_vouchers_book_id_source_type_source_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_vouchers
    ADD CONSTRAINT acc_vouchers_book_id_source_type_source_id_key UNIQUE (book_id, source_type, source_id);


--
-- Name: acc_vouchers acc_vouchers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_vouchers
    ADD CONSTRAINT acc_vouchers_pkey PRIMARY KEY (id);


--
-- Name: app_audit_events app_audit_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_audit_events
    ADD CONSTRAINT app_audit_events_pkey PRIMARY KEY (id);


--
-- Name: app_business_menu_items app_business_menu_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_business_menu_items
    ADD CONSTRAINT app_business_menu_items_pkey PRIMARY KEY (id);


--
-- Name: app_menu_settings app_menu_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_menu_settings
    ADD CONSTRAINT app_menu_settings_pkey PRIMARY KEY (id);


--
--
-- Name: app_permissions app_permissions_path_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_permissions
    ADD CONSTRAINT app_permissions_path_key UNIQUE (path);


--
-- Name: app_permissions app_permissions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_permissions
    ADD CONSTRAINT app_permissions_pkey PRIMARY KEY (id);


--
-- Name: app_role_code_counters app_role_code_counters_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_role_code_counters
    ADD CONSTRAINT app_role_code_counters_pkey PRIMARY KEY (counter_key);

--
-- Name: dcl_rpt_definition_code_counters dcl_rpt_definition_code_counters_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dcl_rpt_definition_code_counters
    ADD CONSTRAINT dcl_rpt_definition_code_counters_pkey PRIMARY KEY (counter_key);


--
-- Name: app_role_permissions app_role_permissions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_role_permissions
    ADD CONSTRAINT app_role_permissions_pkey PRIMARY KEY (role_id, permission_id);


--
-- Name: app_roles app_roles_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_roles
    ADD CONSTRAINT app_roles_code_key UNIQUE (code);


--
-- Name: app_roles app_roles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_roles
    ADD CONSTRAINT app_roles_pkey PRIMARY KEY (id);


--
-- Name: app_sessions app_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_sessions
    ADD CONSTRAINT app_sessions_pkey PRIMARY KEY (id);


--
-- Name: app_sessions app_sessions_token_hash_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_sessions
    ADD CONSTRAINT app_sessions_token_hash_key UNIQUE (token_hash);


--
-- Name: app_system_parameters app_system_parameters_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_system_parameters
    ADD CONSTRAINT app_system_parameters_pkey PRIMARY KEY (parameter_key);


--
-- Name: app_user_profiles app_user_profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_user_profiles
    ADD CONSTRAINT app_user_profiles_pkey PRIMARY KEY (user_id);


--
-- Name: app_user_roles app_user_roles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_user_roles
    ADD CONSTRAINT app_user_roles_pkey PRIMARY KEY (user_id, role_id);


--
-- Name: app_users app_users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_users
    ADD CONSTRAINT app_users_pkey PRIMARY KEY (id);


--
-- Name: aux_objects aux_objects_id_entity_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aux_objects
    ADD CONSTRAINT aux_objects_id_entity_key UNIQUE (id, entity);


--
-- Name: aux_objects aux_objects_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aux_objects
    ADD CONSTRAINT aux_objects_pkey PRIMARY KEY (id);



--
-- Name: dcl_customer_accounts dcl_customer_accounts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--


--
-- Name: dcl_customer_download_tokens dcl_customer_download_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dcl_customer_download_tokens
    ADD CONSTRAINT dcl_customer_download_tokens_pkey PRIMARY KEY (token_hash);


--
-- Name: dcl_customer_files dcl_customer_files_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dcl_customer_files
    ADD CONSTRAINT dcl_customer_files_pkey PRIMARY KEY (id);


--
-- Name: dcl_customer_files dcl_customer_files_storage_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dcl_customer_files
    ADD CONSTRAINT dcl_customer_files_storage_key_key UNIQUE (storage_key);


--
-- Name: dcl_customer_files dcl_customer_files_upload_token_hash_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dcl_customer_files
    ADD CONSTRAINT dcl_customer_files_upload_token_hash_key UNIQUE (upload_token_hash);


--
-- Name: dcl_customer_relationships dcl_customer_relationships_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--


--
-- Name: dcl_employment_relationships dcl_employment_relationships_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--


--
-- Name: dcl_fund_account_versions dcl_fund_account_versions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dcl_fund_account_versions
    ADD CONSTRAINT dcl_fund_account_versions_pkey PRIMARY KEY (approval_entry_id);


--
--
-- Name: dcl_parties dcl_parties_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: dcl_party_identifier_claims dcl_party_identifier_claims_identifier_type_normalized_value_key; Type: CONSTRAINT; Schema: public; Owner: -
--


--
-- Name: dcl_party_identifier_claims dcl_party_identifier_claims_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--


--
-- Name: dcl_party_merge_events dcl_party_merge_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--


--
-- Name: dcl_party_merge_events dcl_party_merge_events_preflight_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--


--
-- Name: dcl_party_merge_preflights dcl_party_merge_preflights_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--


--
-- Name: dcl_party_relationship_merge_events dcl_party_relationship_merge_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--


--
-- Name: dcl_product_formula_lines dcl_product_formula_lines_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dcl_product_formula_lines
    ADD CONSTRAINT dcl_product_formula_lines_pkey PRIMARY KEY (product_approval_entry_id, line_no);


--
-- Name: dcl_product_formula_lines dcl_product_formula_lines_product_entry_material_object_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dcl_product_formula_lines
    ADD CONSTRAINT dcl_product_formula_lines_product_entry_material_object_key UNIQUE (product_approval_entry_id, material_object_id);


--
-- Name: dcl_product_formulas dcl_product_formulas_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dcl_product_formulas
    ADD CONSTRAINT dcl_product_formulas_pkey PRIMARY KEY (product_approval_entry_id);


--
-- Name: dcl_product_unit_conversions dcl_product_unit_conversions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dcl_product_unit_conversions
    ADD CONSTRAINT dcl_product_unit_conversions_pkey PRIMARY KEY (product_approval_entry_id, unit_object_id);


--
-- Name: dcl_product_versions dcl_product_versions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dcl_product_versions
    ADD CONSTRAINT dcl_product_versions_pkey PRIMARY KEY (approval_entry_id);



--
-- Name: dcl_sales_relationships dcl_sales_relationships_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: dcl_service_relationships dcl_service_relationships_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--


--
-- Name: dcl_supplier_relationships dcl_supplier_relationships_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--


--
--
-- Name: dcl_vehicle_versions dcl_vehicle_versions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dcl_vehicle_versions
    ADD CONSTRAINT dcl_vehicle_versions_pkey PRIMARY KEY (approval_entry_id);


--
-- Name: dcl_warehouse_versions primary key is declared with its table; no
-- separate ALTER statement is needed in this baseline dump.
--

--
-- Name: object_number_counters object_number_counters_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.object_number_counters
    ADD CONSTRAINT object_number_counters_pkey PRIMARY KEY (domain, entity);


--
-- Name: rpt_runtime_audit_events rpt_runtime_audit_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rpt_runtime_audit_events
    ADD CONSTRAINT rpt_runtime_audit_events_pkey PRIMARY KEY (id);


--
--
-- Name: dcl_rpt_definition_versions dcl_rpt_definition_versions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dcl_rpt_definition_versions
    ADD CONSTRAINT dcl_rpt_definition_versions_pkey PRIMARY KEY (approval_entry_id);


--
-- Name: vou_asset_acquisition_details vou_asset_acquisition_details_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vou_asset_acquisition_details
    ADD CONSTRAINT vou_asset_acquisition_details_pkey PRIMARY KEY (document_id);


--
-- Name: vou_asset_acquisition_lines vou_asset_acquisition_lines_document_id_line_no_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vou_asset_acquisition_lines
    ADD CONSTRAINT vou_asset_acquisition_lines_document_id_line_no_key UNIQUE (document_id, line_no);


--
-- Name: vou_asset_acquisition_lines vou_asset_acquisition_lines_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vou_asset_acquisition_lines
    ADD CONSTRAINT vou_asset_acquisition_lines_pkey PRIMARY KEY (id);


--
-- Name: vou_asset_liquidation_details vou_asset_liquidation_details_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vou_asset_liquidation_details
    ADD CONSTRAINT vou_asset_liquidation_details_pkey PRIMARY KEY (document_id);


--
-- Name: vou_asset_liquidation_lines vou_asset_liquidation_lines_document_id_asset_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vou_asset_liquidation_lines
    ADD CONSTRAINT vou_asset_liquidation_lines_document_id_asset_id_key UNIQUE (document_id, asset_id);


--
-- Name: vou_asset_liquidation_lines vou_asset_liquidation_lines_document_id_line_no_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vou_asset_liquidation_lines
    ADD CONSTRAINT vou_asset_liquidation_lines_document_id_line_no_key UNIQUE (document_id, line_no);


--
-- Name: vou_asset_liquidation_lines vou_asset_liquidation_lines_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vou_asset_liquidation_lines
    ADD CONSTRAINT vou_asset_liquidation_lines_pkey PRIMARY KEY (id);


--
-- Name: vou_asset_sale_details vou_asset_sale_details_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vou_asset_sale_details
    ADD CONSTRAINT vou_asset_sale_details_pkey PRIMARY KEY (document_id);


--
-- Name: vou_asset_sale_lines vou_asset_sale_lines_document_id_asset_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vou_asset_sale_lines
    ADD CONSTRAINT vou_asset_sale_lines_document_id_asset_id_key UNIQUE (document_id, asset_id);


--
-- Name: vou_asset_sale_lines vou_asset_sale_lines_document_id_line_no_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vou_asset_sale_lines
    ADD CONSTRAINT vou_asset_sale_lines_document_id_line_no_key UNIQUE (document_id, line_no);


--
-- Name: vou_asset_sale_lines vou_asset_sale_lines_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vou_asset_sale_lines
    ADD CONSTRAINT vou_asset_sale_lines_pkey PRIMARY KEY (id);


--
-- Name: vou_bill_cash_lines vou_bill_cash_lines_document_id_line_no_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vou_bill_cash_lines
    ADD CONSTRAINT vou_bill_cash_lines_document_id_line_no_key UNIQUE (document_id, line_no);


--
-- Name: vou_bill_cash_lines vou_bill_cash_lines_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vou_bill_cash_lines
    ADD CONSTRAINT vou_bill_cash_lines_pkey PRIMARY KEY (id);


--
-- Name: vou_bill_details vou_bill_details_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vou_bill_details
    ADD CONSTRAINT vou_bill_details_pkey PRIMARY KEY (document_id);


--
-- Name: vou_bill_lines vou_bill_lines_document_id_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vou_bill_lines
    ADD CONSTRAINT vou_bill_lines_document_id_id_key UNIQUE (document_id, id);


--
-- Name: vou_bill_lines vou_bill_lines_document_id_line_no_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vou_bill_lines
    ADD CONSTRAINT vou_bill_lines_document_id_line_no_key UNIQUE (document_id, line_no);


--
-- Name: vou_bill_lines vou_bill_lines_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vou_bill_lines
    ADD CONSTRAINT vou_bill_lines_pkey PRIMARY KEY (id);


--
-- Name: vou_document_attachments vou_document_attachments_file_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vou_document_attachments
    ADD CONSTRAINT vou_document_attachments_file_id_key UNIQUE (file_id);


--
-- Name: vou_document_attachments vou_document_attachments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vou_document_attachments
    ADD CONSTRAINT vou_document_attachments_pkey PRIMARY KEY (document_id, file_id);


--
-- Name: vou_documents vou_documents_document_no_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vou_documents
    ADD CONSTRAINT vou_documents_document_no_key UNIQUE (document_no);


--
-- Name: vou_documents vou_documents_id_entity_uq; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vou_documents
    ADD CONSTRAINT vou_documents_id_entity_uq UNIQUE (id, entity);


--
-- Name: vou_documents vou_documents_approval_entry_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vou_documents
    ADD CONSTRAINT vou_documents_approval_entry_id_key UNIQUE (approval_entry_id);


--
-- Name: vou_documents vou_documents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vou_documents
    ADD CONSTRAINT vou_documents_pkey PRIMARY KEY (id);


--
-- Name: vou_download_tokens vou_download_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vou_download_tokens
    ADD CONSTRAINT vou_download_tokens_pkey PRIMARY KEY (token_hash);


--
-- Name: vou_employee_loan_writeoff_details vou_employee_loan_writeoff_details_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vou_employee_loan_writeoff_details
    ADD CONSTRAINT vou_employee_loan_writeoff_details_pkey PRIMARY KEY (document_id);


--
-- Name: vou_expense_lines vou_expense_lines_document_id_line_no_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vou_expense_lines
    ADD CONSTRAINT vou_expense_lines_document_id_line_no_key UNIQUE (document_id, line_no);


--
-- Name: vou_expense_lines vou_expense_lines_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vou_expense_lines
    ADD CONSTRAINT vou_expense_lines_pkey PRIMARY KEY (id);


--
-- Name: vou_expense_payment_details vou_expense_payment_details_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vou_expense_payment_details
    ADD CONSTRAINT vou_expense_payment_details_pkey PRIMARY KEY (document_id);


--
-- Name: vou_expense_payment_details vou_expense_payment_details_source_reimbursement_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vou_expense_payment_details
    ADD CONSTRAINT vou_expense_payment_details_source_reimbursement_id_key UNIQUE (source_reimbursement_id);


--
-- Name: vou_expense_reimbursement_details vou_expense_reimbursement_details_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vou_expense_reimbursement_details
    ADD CONSTRAINT vou_expense_reimbursement_details_pkey PRIMARY KEY (document_id);


--
-- Name: vou_files vou_files_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vou_files
    ADD CONSTRAINT vou_files_pkey PRIMARY KEY (id);


--
-- Name: vou_files vou_files_storage_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vou_files
    ADD CONSTRAINT vou_files_storage_key_key UNIQUE (storage_key);


--
-- Name: vou_files vou_files_upload_token_hash_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vou_files
    ADD CONSTRAINT vou_files_upload_token_hash_key UNIQUE (upload_token_hash);


--
-- Name: vou_intermediary_calculation_summaries vou_intermediary_calculation__document_id_category_payee_en_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vou_intermediary_calculation_summaries
    ADD CONSTRAINT vou_intermediary_calculation__document_id_category_payee_en_key UNIQUE (document_id, category, payee_entity, payee_object_id);


--
-- Name: vou_intermediary_calculation_lines vou_intermediary_calculation__document_id_source_signoff_li_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vou_intermediary_calculation_lines
    ADD CONSTRAINT vou_intermediary_calculation__document_id_source_signoff_li_key UNIQUE (document_id, source_signoff_line_id);


--
-- Name: vou_intermediary_calculation_bill_allocations vou_intermediary_calculation_bill_allocations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vou_intermediary_calculation_bill_allocations
    ADD CONSTRAINT vou_intermediary_calculation_bill_allocations_pkey PRIMARY KEY (document_id, bill_line_id);


--
-- Name: vou_intermediary_calculation_details vou_intermediary_calculation_details_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vou_intermediary_calculation_details
    ADD CONSTRAINT vou_intermediary_calculation_details_pkey PRIMARY KEY (document_id);


--
-- Name: vou_intermediary_calculation_lines vou_intermediary_calculation_lines_document_id_line_no_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vou_intermediary_calculation_lines
    ADD CONSTRAINT vou_intermediary_calculation_lines_document_id_line_no_key UNIQUE (document_id, line_no);


--
-- Name: vou_intermediary_calculation_lines vou_intermediary_calculation_lines_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vou_intermediary_calculation_lines
    ADD CONSTRAINT vou_intermediary_calculation_lines_pkey PRIMARY KEY (id);


--
-- Name: vou_intermediary_calculation_summaries vou_intermediary_calculation_summaries_document_id_line_no_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vou_intermediary_calculation_summaries
    ADD CONSTRAINT vou_intermediary_calculation_summaries_document_id_line_no_key UNIQUE (document_id, line_no);


--
-- Name: vou_intermediary_calculation_summaries vou_intermediary_calculation_summaries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vou_intermediary_calculation_summaries
    ADD CONSTRAINT vou_intermediary_calculation_summaries_pkey PRIMARY KEY (id);


--
-- Name: vou_intermediary_scripts vou_intermediary_scripts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vou_intermediary_scripts
    ADD CONSTRAINT vou_intermediary_scripts_pkey PRIMARY KEY (id);


--
-- Name: vou_intermediary_scripts vou_intermediary_scripts_singleton_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vou_intermediary_scripts
    ADD CONSTRAINT vou_intermediary_scripts_singleton_key UNIQUE (singleton);


--
-- Name: vou_inventory_count_details vou_inventory_count_details_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vou_inventory_count_details
    ADD CONSTRAINT vou_inventory_count_details_pkey PRIMARY KEY (document_id);


--
-- Name: vou_inventory_count_lines vou_inventory_count_lines_document_id_line_no_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vou_inventory_count_lines
    ADD CONSTRAINT vou_inventory_count_lines_document_id_line_no_key UNIQUE (document_id, line_no);


--
-- Name: vou_inventory_count_lines vou_inventory_count_lines_document_id_product_object_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vou_inventory_count_lines
    ADD CONSTRAINT vou_inventory_count_lines_document_id_product_object_id_key UNIQUE (document_id, product_object_id);


--
-- Name: vou_inventory_count_lines vou_inventory_count_lines_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vou_inventory_count_lines
    ADD CONSTRAINT vou_inventory_count_lines_pkey PRIMARY KEY (id);


--
-- Name: vou_number_counters vou_number_counters_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vou_number_counters
    ADD CONSTRAINT vou_number_counters_pkey PRIMARY KEY (entity, business_date);


--
-- Name: vou_other_income_details vou_other_income_details_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vou_other_income_details
    ADD CONSTRAINT vou_other_income_details_pkey PRIMARY KEY (document_id);


--
-- Name: vou_payment_details vou_payment_details_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vou_payment_details
    ADD CONSTRAINT vou_payment_details_pkey PRIMARY KEY (document_id);


--
-- Name: vou_price_lines vou_price_lines_document_id_line_no_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vou_price_lines
    ADD CONSTRAINT vou_price_lines_document_id_line_no_key UNIQUE (document_id, line_no);


--
-- Name: vou_price_lines vou_price_lines_document_id_product_object_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vou_price_lines
    ADD CONSTRAINT vou_price_lines_document_id_product_object_id_key UNIQUE (document_id, product_object_id);


--
-- Name: vou_price_lines vou_price_lines_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vou_price_lines
    ADD CONSTRAINT vou_price_lines_pkey PRIMARY KEY (id);


--
-- Name: vou_product_lines vou_product_lines_document_id_line_no_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vou_product_lines
    ADD CONSTRAINT vou_product_lines_document_id_line_no_key UNIQUE (document_id, line_no);


--
-- Name: vou_product_lines vou_product_lines_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vou_product_lines
    ADD CONSTRAINT vou_product_lines_pkey PRIMARY KEY (id);


--
-- Name: vou_production_details vou_production_details_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vou_production_details
    ADD CONSTRAINT vou_production_details_pkey PRIMARY KEY (document_id);


--
-- Name: vou_production_material_lines vou_production_material_lines_output_line_id_line_no_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vou_production_material_lines
    ADD CONSTRAINT vou_production_material_lines_output_line_id_line_no_key UNIQUE (output_line_id, line_no);


--
-- Name: vou_production_material_lines vou_production_material_lines_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vou_production_material_lines
    ADD CONSTRAINT vou_production_material_lines_pkey PRIMARY KEY (id);


--
-- Name: vou_production_output_lines vou_production_output_lines_document_id_line_no_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vou_production_output_lines
    ADD CONSTRAINT vou_production_output_lines_document_id_line_no_key UNIQUE (document_id, line_no);


--
-- Name: vou_production_output_lines vou_production_output_lines_document_id_product_object_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vou_production_output_lines
    ADD CONSTRAINT vou_production_output_lines_document_id_product_object_id_key UNIQUE (document_id, product_object_id);


--
-- Name: vou_production_output_lines vou_production_output_lines_document_id_source_order_line_i_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vou_production_output_lines
    ADD CONSTRAINT vou_production_output_lines_document_id_source_order_line_i_key UNIQUE (document_id, source_order_line_id);


--
-- Name: vou_production_output_lines vou_production_output_lines_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vou_production_output_lines
    ADD CONSTRAINT vou_production_output_lines_pkey PRIMARY KEY (id);


--
-- Name: vou_purchase_inbound_details vou_purchase_inbound_details_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vou_purchase_inbound_details
    ADD CONSTRAINT vou_purchase_inbound_details_pkey PRIMARY KEY (document_id);


--
-- Name: vou_purchase_inbound_lines vou_purchase_inbound_lines_document_id_line_no_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vou_purchase_inbound_lines
    ADD CONSTRAINT vou_purchase_inbound_lines_document_id_line_no_key UNIQUE (document_id, line_no);


--
-- Name: vou_purchase_inbound_lines vou_purchase_inbound_lines_document_id_source_order_line_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vou_purchase_inbound_lines
    ADD CONSTRAINT vou_purchase_inbound_lines_document_id_source_order_line_id_key UNIQUE (document_id, source_order_line_id);


--
-- Name: vou_purchase_inbound_lines vou_purchase_inbound_lines_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vou_purchase_inbound_lines
    ADD CONSTRAINT vou_purchase_inbound_lines_pkey PRIMARY KEY (id);


--
-- Name: vou_purchase_inquiry_details vou_purchase_inquiry_details_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vou_purchase_inquiry_details
    ADD CONSTRAINT vou_purchase_inquiry_details_pkey PRIMARY KEY (document_id);


--
-- Name: vou_purchase_order_details vou_purchase_order_details_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vou_purchase_order_details
    ADD CONSTRAINT vou_purchase_order_details_pkey PRIMARY KEY (document_id);


--
-- Name: vou_purchase_return_details vou_purchase_return_details_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vou_purchase_return_details
    ADD CONSTRAINT vou_purchase_return_details_pkey PRIMARY KEY (document_id);


--
-- Name: vou_purchase_return_lines vou_purchase_return_lines_document_id_line_no_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vou_purchase_return_lines
    ADD CONSTRAINT vou_purchase_return_lines_document_id_line_no_key UNIQUE (document_id, line_no);


--
-- Name: vou_purchase_return_lines vou_purchase_return_lines_document_id_source_inbound_line_i_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vou_purchase_return_lines
    ADD CONSTRAINT vou_purchase_return_lines_document_id_source_inbound_line_i_key UNIQUE (document_id, source_inbound_line_id);


--
-- Name: vou_purchase_return_lines vou_purchase_return_lines_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vou_purchase_return_lines
    ADD CONSTRAINT vou_purchase_return_lines_pkey PRIMARY KEY (id);


--
-- Name: vou_receipt_details vou_receipt_details_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vou_receipt_details
    ADD CONSTRAINT vou_receipt_details_pkey PRIMARY KEY (document_id);


--
-- Name: vou_sale_delivery_details vou_sale_delivery_details_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vou_sale_delivery_details
    ADD CONSTRAINT vou_sale_delivery_details_pkey PRIMARY KEY (document_id);


--
-- Name: vou_sale_delivery_details vou_sale_delivery_details_source_outbound_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vou_sale_delivery_details
    ADD CONSTRAINT vou_sale_delivery_details_source_outbound_id_key UNIQUE (source_outbound_id);


--
-- Name: vou_sale_order_details vou_sale_order_details_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vou_sale_order_details
    ADD CONSTRAINT vou_sale_order_details_pkey PRIMARY KEY (document_id);


--
-- Name: vou_sale_order_formula_lines vou_sale_order_formula_lines_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vou_sale_order_formula_lines
    ADD CONSTRAINT vou_sale_order_formula_lines_pkey PRIMARY KEY (product_line_id, line_no);


--
-- Name: vou_sale_order_formula_lines vou_sale_order_formula_lines_product_line_id_material_objec_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vou_sale_order_formula_lines
    ADD CONSTRAINT vou_sale_order_formula_lines_product_line_id_material_objec_key UNIQUE (product_line_id, material_object_id);


--
-- Name: vou_sale_order_formulas vou_sale_order_formulas_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vou_sale_order_formulas
    ADD CONSTRAINT vou_sale_order_formulas_pkey PRIMARY KEY (product_line_id);


--
-- Name: vou_sale_outbound_details vou_sale_outbound_details_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vou_sale_outbound_details
    ADD CONSTRAINT vou_sale_outbound_details_pkey PRIMARY KEY (document_id);


--
-- Name: vou_sale_outbound_lines vou_sale_outbound_lines_document_id_line_no_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vou_sale_outbound_lines
    ADD CONSTRAINT vou_sale_outbound_lines_document_id_line_no_key UNIQUE (document_id, line_no);


--
-- Name: vou_sale_outbound_lines vou_sale_outbound_lines_document_id_source_order_line_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vou_sale_outbound_lines
    ADD CONSTRAINT vou_sale_outbound_lines_document_id_source_order_line_id_key UNIQUE (document_id, source_order_line_id);


--
-- Name: vou_sale_outbound_lines vou_sale_outbound_lines_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vou_sale_outbound_lines
    ADD CONSTRAINT vou_sale_outbound_lines_pkey PRIMARY KEY (id);


--
-- Name: vou_sale_pricing_details vou_sale_pricing_details_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vou_sale_pricing_details
    ADD CONSTRAINT vou_sale_pricing_details_pkey PRIMARY KEY (document_id);


--
-- Name: vou_sale_return_details vou_sale_return_details_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vou_sale_return_details
    ADD CONSTRAINT vou_sale_return_details_pkey PRIMARY KEY (document_id);


--
-- Name: vou_sale_return_lines vou_sale_return_lines_document_id_line_no_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vou_sale_return_lines
    ADD CONSTRAINT vou_sale_return_lines_document_id_line_no_key UNIQUE (document_id, line_no);


--
-- Name: vou_sale_return_lines vou_sale_return_lines_document_id_source_signoff_line_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vou_sale_return_lines
    ADD CONSTRAINT vou_sale_return_lines_document_id_source_signoff_line_id_key UNIQUE (document_id, source_signoff_line_id);


--
-- Name: vou_sale_return_lines vou_sale_return_lines_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vou_sale_return_lines
    ADD CONSTRAINT vou_sale_return_lines_pkey PRIMARY KEY (id);


--
-- Name: vou_sale_signoff_details vou_sale_signoff_details_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vou_sale_signoff_details
    ADD CONSTRAINT vou_sale_signoff_details_pkey PRIMARY KEY (document_id);


--
-- Name: vou_sale_signoff_details vou_sale_signoff_details_source_delivery_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vou_sale_signoff_details
    ADD CONSTRAINT vou_sale_signoff_details_source_delivery_id_key UNIQUE (source_delivery_id);


--
-- Name: vou_sale_signoff_lines vou_sale_signoff_lines_document_id_line_no_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vou_sale_signoff_lines
    ADD CONSTRAINT vou_sale_signoff_lines_document_id_line_no_key UNIQUE (document_id, line_no);


--
-- Name: vou_sale_signoff_lines vou_sale_signoff_lines_document_id_source_outbound_line_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vou_sale_signoff_lines
    ADD CONSTRAINT vou_sale_signoff_lines_document_id_source_outbound_line_id_key UNIQUE (document_id, source_outbound_line_id);


--
-- Name: vou_sale_signoff_lines vou_sale_signoff_lines_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vou_sale_signoff_lines
    ADD CONSTRAINT vou_sale_signoff_lines_pkey PRIMARY KEY (id);


--
-- Name: vou_service_acceptance_details vou_service_acceptance_details_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vou_service_acceptance_details
    ADD CONSTRAINT vou_service_acceptance_details_pkey PRIMARY KEY (document_id);


--
-- Name: vou_service_contract_details vou_service_contract_details_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vou_service_contract_details
    ADD CONSTRAINT vou_service_contract_details_pkey PRIMARY KEY (document_id);


--
-- Name: wfl_action_executions wfl_action_executions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wfl_action_executions
    ADD CONSTRAINT wfl_action_executions_pkey PRIMARY KEY (id);


--
-- Name: wfl_action_executions wfl_action_executions_process_id_source_node_instance_id_ac_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wfl_action_executions
    ADD CONSTRAINT wfl_action_executions_process_id_source_node_instance_id_ac_key UNIQUE (process_id, source_node_instance_id, action_fingerprint);


--
-- Name: wfl_action_executions wfl_action_executions_process_id_source_node_instance_id_ta_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wfl_action_executions
    ADD CONSTRAINT wfl_action_executions_process_id_source_node_instance_id_ta_key UNIQUE (process_id, source_node_instance_id, target_node_key, relation_name);


--
-- Name: wfl_create_child_requests wfl_create_child_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wfl_create_child_requests
    ADD CONSTRAINT wfl_create_child_requests_pkey PRIMARY KEY (definition_id, request_key);


--
-- Name: wfl_definition_instances wfl_definition_instances_definition_id_root_document_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wfl_definition_instances
    ADD CONSTRAINT wfl_definition_instances_definition_id_root_document_id_key UNIQUE (definition_id, root_document_id);


--
-- Name: wfl_definition_instances wfl_definition_instances_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wfl_definition_instances
    ADD CONSTRAINT wfl_definition_instances_pkey PRIMARY KEY (id);


--
-- Name: dcl_wfl_process_definition_versions dcl_wfl_process_definition_versions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dcl_wfl_process_definition_versions
    ADD CONSTRAINT dcl_wfl_process_definition_versions_pkey PRIMARY KEY (approval_entry_id);


--
-- Name: wfl_node_instances wfl_node_instances_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wfl_node_instances
    ADD CONSTRAINT wfl_node_instances_pkey PRIMARY KEY (id);


--
-- Name: wfl_node_instances wfl_node_instances_process_id_node_key_document_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wfl_node_instances
    ADD CONSTRAINT wfl_node_instances_process_id_node_key_document_id_key UNIQUE (process_id, node_key, document_id);


--
-- Name: wfl_process_definitions wfl_process_definitions_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wfl_process_definitions
    ADD CONSTRAINT wfl_process_definitions_code_key UNIQUE (code);


--
-- Name: wfl_process_definitions wfl_process_definitions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wfl_process_definitions
    ADD CONSTRAINT wfl_process_definitions_pkey PRIMARY KEY (id);


--
-- Name: wfl_runtime_audit_events wfl_runtime_audit_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wfl_runtime_audit_events
    ADD CONSTRAINT wfl_runtime_audit_events_pkey PRIMARY KEY (id);


--
-- Name: acc_book_user_scopes_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX acc_book_user_scopes_user_idx ON public.acc_book_user_scopes USING btree (user_id, book_id);


--
-- Name: acc_books_single_control_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX acc_books_single_control_uq ON public.acc_books USING btree (control_book) WHERE control_book;


--
-- Name: acc_container_entries_balance_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX acc_container_entries_balance_idx ON public.acc_container_entries USING btree (customer_id, container_type);


--
-- Name: acc_inventory_cost_allocations_period_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX acc_inventory_cost_allocations_period_idx ON public.acc_inventory_cost_allocations USING btree (book_id, period_month, entry_id);


--
-- Name: acc_inventory_entries_balance_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX acc_inventory_entries_balance_idx ON public.acc_inventory_entries USING btree (book_id, subject_id, warehouse_id, product_id, business_date);


--
--
-- Name: acc_subjects_parent_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX acc_subjects_parent_idx ON public.acc_subjects USING btree (book_id, parent_subject_id, code);


--
-- Name: acc_vouchers_vou_source_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX acc_vouchers_vou_source_idx ON public.acc_vouchers USING btree (book_id, source_entity, source_id) WHERE ((source_type)::text = 'VOU'::text);


--
-- Name: app_audit_events_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX app_audit_events_created_at_idx ON public.app_audit_events USING btree (created_at DESC);


--
-- Name: app_business_menu_items_parent_order_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX app_business_menu_items_parent_order_idx ON public.app_business_menu_items USING btree (parent_id, sort_order, id);


--
-- Name: app_business_menu_items_route_key_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX app_business_menu_items_route_key_idx ON public.app_business_menu_items USING btree (route_key) WHERE ((item_type)::text = 'ROUTE'::text);


--
-- Name: app_business_menu_items_workbench_route_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX app_business_menu_items_workbench_route_idx ON public.app_business_menu_items USING btree (route_key) WHERE ((route_key)::text = 'home/dashboard'::text);


--
--
-- Name: app_sessions_user_active_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX app_sessions_user_active_idx ON public.app_sessions USING btree (user_id, absolute_expires_at) WHERE (revoked_at IS NULL);


--
-- Name: app_users_username_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX app_users_username_uq ON public.app_users USING btree (lower((username)::text));


--
-- Name: aux_objects_entity_code_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX aux_objects_entity_code_uq ON public.aux_objects USING btree (entity, upper((code)::text));


--
-- Name: aux_objects_entity_updated_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX aux_objects_entity_updated_idx ON public.aux_objects USING btree (entity, updated_at DESC, id DESC);


--
-- Name: dcl_customer_accounts_relationship_idx; Type: INDEX; Schema: public; Owner: -
--


--
-- Name: dcl_customer_download_tokens_expiry_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX dcl_customer_download_tokens_expiry_idx ON public.dcl_customer_download_tokens USING btree (expires_at);


--
-- Name: dcl_customer_files_pending_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX dcl_customer_files_pending_idx ON public.dcl_customer_files USING btree (upload_expires_at) WHERE ((status)::text = 'PENDING'::text);


--
-- Name: dcl_customer_relationships_active_party_operating_key; Type: INDEX; Schema: public; Owner: -
--


--
-- Name: dcl_employment_relationships_active_party_operating_key; Type: INDEX; Schema: public; Owner: -
--


--

--
-- Name: dcl_subjects_entity_code_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX dcl_subjects_entity_code_uq ON public.dcl_subjects USING btree (entity, upper((code)::text)) WHERE (code IS NOT NULL);


--
-- Name: dcl_parties_name_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX dcl_party_versions_display_name_idx ON public.dcl_party_versions USING btree (upper((display_name)::text), party_id);

CREATE INDEX dcl_party_versions_party_idx ON public.dcl_party_versions USING btree (party_id, approval_entry_id);

CREATE INDEX dcl_party_identifier_claims_approved_party_idx ON public.dcl_party_identifier_claims USING btree (approved_party_id) WHERE (approved_party_id IS NOT NULL);

CREATE INDEX dcl_party_identifier_claims_open_party_idx ON public.dcl_party_identifier_claims USING btree (open_party_id) WHERE (open_party_id IS NOT NULL);


--
-- Name: dcl_party_merge_preflights_open_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX dcl_party_merge_preflights_open_idx ON public.dcl_party_merge_preflights USING btree (source_party_id, target_party_id, created_at DESC) WHERE (consumed_at IS NULL);


--
-- Name: dcl_party_relationship_merge_events_source_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX dcl_party_relationship_merge_events_source_idx ON public.dcl_party_relationship_merge_events USING btree (source_object_id, occurred_at DESC) INCLUDE (merge_event_id);


--
-- Name: dcl_product_versions_category_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX dcl_product_versions_category_idx ON public.dcl_product_versions USING btree (category_id);


--
--
--
-- Name: dcl_vehicle_versions_carrier_operating_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX dcl_vehicle_versions_carrier_operating_idx ON public.dcl_vehicle_versions USING btree (carrier_operating_entity_id);


--
-- Name: dcl_vehicle_versions_carrier_service_relationship_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX dcl_vehicle_versions_carrier_service_relationship_idx ON public.dcl_vehicle_versions USING btree (carrier_service_relationship_object_id);


--
-- Name: dcl_vehicle_versions_category_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX dcl_vehicle_versions_vehicle_type_idx ON public.dcl_vehicle_versions USING btree (vehicle_type_object_id);


--
-- Name: dcl_warehouse_versions_category_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX dcl_warehouse_versions_category_idx ON public.dcl_warehouse_versions USING btree (category_id);


--
-- Name: dcl_warehouse_versions_manager_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX dcl_warehouse_versions_manager_idx ON public.dcl_warehouse_versions USING btree (manager_employee_id);


--
-- Name: rpt_runtime_audit_events_report_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX rpt_runtime_audit_events_report_idx ON public.rpt_runtime_audit_events USING btree (report_code, occurred_at DESC, id DESC);


--
-- Name: vou_documents_parent_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX vou_documents_parent_idx ON public.vou_documents USING btree (parent_document_id) WHERE (parent_document_id IS NOT NULL);


--
-- Name: vou_documents_query_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX vou_documents_query_idx ON public.vou_documents USING btree (entity, business_date DESC, id DESC);


--
-- Name: vou_download_tokens_expiry_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX vou_download_tokens_expiry_idx ON public.vou_download_tokens USING btree (expires_at);


--
-- Name: vou_files_pending_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX vou_files_pending_idx ON public.vou_files USING btree (upload_expires_at) WHERE ((status)::text = 'PENDING'::text);


--
-- Name: vou_intermediary_bill_allocation_source_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX vou_intermediary_bill_allocation_source_idx ON public.vou_intermediary_calculation_bill_allocations USING btree (source_signoff_line_id);


--
-- Name: vou_intermediary_calculation_line_source_calculation_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX vou_intermediary_calculation_line_source_calculation_idx ON public.vou_intermediary_calculation_lines USING btree (source_calculation_document_id) WHERE (source_calculation_document_id IS NOT NULL);


--
-- Name: vou_intermediary_calculation_period_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX vou_intermediary_calculation_period_uq ON public.vou_documents USING btree (business_date) WHERE ((entity)::text = 'intermediary-calculation'::text);


--
-- Name: vou_price_lines_lookup_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX vou_price_lines_lookup_idx ON public.vou_price_lines USING btree (document_entity, product_object_id, document_id);


--
-- Name: vou_product_lines_document_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX vou_product_lines_document_idx ON public.vou_product_lines USING btree (document_id, line_no);


--
-- Name: vou_production_material_actual_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX vou_production_material_actual_idx ON public.vou_production_material_lines USING btree (actual_material_object_id, actual_material_approval_entry_id);


--
-- Name: vou_production_output_source_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX vou_production_output_source_idx ON public.vou_production_output_lines USING btree (source_order_line_id) WHERE (source_order_line_id IS NOT NULL);


--
-- Name: vou_purchase_inbound_lines_source_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX vou_purchase_inbound_lines_source_idx ON public.vou_purchase_inbound_lines USING btree (source_order_line_id);


--
-- Name: vou_purchase_inquiry_supplier_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX vou_purchase_inquiry_supplier_idx ON public.vou_purchase_inquiry_details USING btree (supplier_object_id, document_id);


--
-- Name: vou_purchase_return_lines_order_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX vou_purchase_return_lines_order_idx ON public.vou_purchase_return_lines USING btree (source_order_line_id);


--
-- Name: vou_purchase_return_lines_source_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX vou_purchase_return_lines_source_idx ON public.vou_purchase_return_lines USING btree (source_inbound_line_id);


--
-- Name: vou_sale_order_formula_material_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX vou_sale_order_formula_material_idx ON public.vou_sale_order_formula_lines USING btree (material_object_id, material_approval_entry_id);


--
-- Name: vou_sale_outbound_lines_source_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX vou_sale_outbound_lines_source_idx ON public.vou_sale_outbound_lines USING btree (source_order_line_id);


--
-- Name: vou_sale_return_lines_source_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX vou_sale_return_lines_source_idx ON public.vou_sale_return_lines USING btree (source_signoff_line_id);


--
-- Name: vou_sale_return_refusal_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX vou_sale_return_refusal_uq ON public.vou_sale_return_details USING btree (source_signoff_id) WHERE ((return_kind)::text = 'REFUSAL'::text);


--
-- Name: vou_sale_signoff_lines_order_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX vou_sale_signoff_lines_order_idx ON public.vou_sale_signoff_lines USING btree (source_order_line_id);


--
-- Name: vou_service_acceptance_contract_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX vou_service_acceptance_contract_idx ON public.vou_service_acceptance_details USING btree (contract_document_id);


--
-- Name: vou_service_contract_partner_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX vou_service_contract_partner_idx ON public.vou_service_contract_details USING btree (counterparty_entity, counterparty_object_id, applicable_from DESC, document_id DESC);


--
-- Name: wfl_definition_instances_query_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX wfl_definition_instances_query_idx ON public.wfl_definition_instances USING btree (updated_at DESC, id DESC) WHERE (root_deleted_at IS NULL);


--
-- Name: wfl_node_instances_document_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX wfl_node_instances_document_idx ON public.wfl_node_instances USING btree (document_id);


--
-- Name: wfl_runtime_audit_history_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX wfl_runtime_audit_history_idx ON public.wfl_runtime_audit_events USING btree (process_id, occurred_at DESC, id DESC);


--
-- Name: dcl_customer_relationships bob_customer_relationship_merged_party_ck; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER dcl_customer_relationship_merged_party_ck BEFORE INSERT OR UPDATE OF party_id ON public.dcl_customer_relationships FOR EACH ROW EXECUTE FUNCTION public.dcl_reject_merged_party_relationship();


--
-- Name: dcl_employment_relationships bob_employment_relationship_merged_party_ck; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER dcl_employment_relationship_merged_party_ck BEFORE INSERT OR UPDATE OF party_id ON public.dcl_employment_relationships FOR EACH ROW EXECUTE FUNCTION public.dcl_reject_merged_party_relationship();


--
-- Name: dcl_sales_relationships bob_sales_relationship_merged_party_ck; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER dcl_sales_relationship_merged_party_ck BEFORE INSERT OR UPDATE OF party_id ON public.dcl_sales_relationships FOR EACH ROW EXECUTE FUNCTION public.dcl_reject_merged_party_relationship();


--
-- Name: dcl_service_relationships bob_service_relationship_merged_party_ck; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER dcl_service_relationship_merged_party_ck BEFORE INSERT OR UPDATE OF party_id ON public.dcl_service_relationships FOR EACH ROW EXECUTE FUNCTION public.dcl_reject_merged_party_relationship();


--
-- Name: dcl_supplier_relationships bob_supplier_relationship_merged_party_ck; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER dcl_supplier_relationship_merged_party_ck BEFORE INSERT OR UPDATE OF party_id ON public.dcl_supplier_relationships FOR EACH ROW EXECUTE FUNCTION public.dcl_reject_merged_party_relationship();


--
-- Name: approval_entries vou_approval_locked_period_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER vou_approval_locked_period_guard BEFORE UPDATE OR DELETE ON public.approval_entries FOR EACH ROW EXECUTE FUNCTION public.reject_locked_vou_approval_period();


--
-- Name: vou_asset_acquisition_details vou_asset_acquisition_detail_ck; Type: TRIGGER; Schema: public; Owner: -
--

CREATE CONSTRAINT TRIGGER vou_asset_acquisition_detail_ck AFTER INSERT OR DELETE OR UPDATE ON public.vou_asset_acquisition_details DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.vou_validate_document_detail();


--
-- Name: vou_asset_liquidation_details vou_asset_liquidation_detail_ck; Type: TRIGGER; Schema: public; Owner: -
--

CREATE CONSTRAINT TRIGGER vou_asset_liquidation_detail_ck AFTER INSERT OR DELETE OR UPDATE ON public.vou_asset_liquidation_details DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.vou_validate_document_detail();


--
-- Name: vou_asset_sale_details vou_asset_sale_detail_ck; Type: TRIGGER; Schema: public; Owner: -
--

CREATE CONSTRAINT TRIGGER vou_asset_sale_detail_ck AFTER INSERT OR DELETE OR UPDATE ON public.vou_asset_sale_details DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.vou_validate_document_detail();


--
-- Name: vou_bill_details vou_bill_detail_ck; Type: TRIGGER; Schema: public; Owner: -
--

CREATE CONSTRAINT TRIGGER vou_bill_detail_ck AFTER INSERT OR DELETE OR UPDATE ON public.vou_bill_details DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.vou_validate_document_detail();


--
-- Name: vou_document_attachments vou_document_attachments_locked_period_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER vou_document_attachments_locked_period_guard BEFORE INSERT OR DELETE ON public.vou_document_attachments FOR EACH ROW EXECUTE FUNCTION public.reject_locked_vou_attachment_period();


--
-- Name: vou_documents vou_documents_detail_ck; Type: TRIGGER; Schema: public; Owner: -
--

CREATE CONSTRAINT TRIGGER vou_documents_detail_ck AFTER INSERT OR UPDATE ON public.vou_documents DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.vou_validate_document_detail();


--
-- Name: vou_documents vou_documents_locked_period_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER vou_documents_locked_period_guard BEFORE INSERT OR DELETE OR UPDATE ON public.vou_documents FOR EACH ROW EXECUTE FUNCTION public.reject_locked_vou_period();


--
-- Name: vou_employee_loan_writeoff_details vou_employee_loan_writeoff_detail_ck; Type: TRIGGER; Schema: public; Owner: -
--

CREATE CONSTRAINT TRIGGER vou_employee_loan_writeoff_detail_ck AFTER INSERT OR DELETE OR UPDATE ON public.vou_employee_loan_writeoff_details DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.vou_validate_document_detail();


--
-- Name: vou_expense_payment_details vou_expense_payment_detail_ck; Type: TRIGGER; Schema: public; Owner: -
--

CREATE CONSTRAINT TRIGGER vou_expense_payment_detail_ck AFTER INSERT OR DELETE OR UPDATE ON public.vou_expense_payment_details DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.vou_validate_document_detail();


--
-- Name: vou_expense_reimbursement_details vou_expense_reimbursement_detail_ck; Type: TRIGGER; Schema: public; Owner: -
--

CREATE CONSTRAINT TRIGGER vou_expense_reimbursement_detail_ck AFTER INSERT OR DELETE OR UPDATE ON public.vou_expense_reimbursement_details DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.vou_validate_document_detail();


--
-- Name: vou_intermediary_calculation_details vou_intermediary_calculation_detail_ck; Type: TRIGGER; Schema: public; Owner: -
--

CREATE CONSTRAINT TRIGGER vou_intermediary_calculation_detail_ck AFTER INSERT OR DELETE OR UPDATE ON public.vou_intermediary_calculation_details DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.vou_validate_document_detail();


--
-- Name: vou_inventory_count_details vou_inventory_count_detail_ck; Type: TRIGGER; Schema: public; Owner: -
--

CREATE CONSTRAINT TRIGGER vou_inventory_count_detail_ck AFTER INSERT OR DELETE OR UPDATE ON public.vou_inventory_count_details DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.vou_validate_document_detail();


--
-- Name: vou_other_income_details vou_other_income_detail_ck; Type: TRIGGER; Schema: public; Owner: -
--

CREATE CONSTRAINT TRIGGER vou_other_income_detail_ck AFTER INSERT OR DELETE OR UPDATE ON public.vou_other_income_details DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.vou_validate_document_detail();


--
-- Name: vou_documents vou_parent_ck; Type: TRIGGER; Schema: public; Owner: -
--

CREATE CONSTRAINT TRIGGER vou_parent_ck AFTER INSERT OR UPDATE OF parent_entity, parent_document_id ON public.vou_documents DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.vou_validate_parent();


--
-- Name: vou_payment_details vou_payment_detail_ck; Type: TRIGGER; Schema: public; Owner: -
--

CREATE CONSTRAINT TRIGGER vou_payment_detail_ck AFTER INSERT OR DELETE OR UPDATE ON public.vou_payment_details DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.vou_validate_document_detail();


--
-- Name: vou_production_details vou_production_detail_ck; Type: TRIGGER; Schema: public; Owner: -
--

CREATE CONSTRAINT TRIGGER vou_production_detail_ck AFTER INSERT OR DELETE OR UPDATE ON public.vou_production_details DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.vou_validate_document_detail();


--
-- Name: vou_purchase_inbound_details vou_purchase_inbound_detail_ck; Type: TRIGGER; Schema: public; Owner: -
--

CREATE CONSTRAINT TRIGGER vou_purchase_inbound_detail_ck AFTER INSERT OR DELETE OR UPDATE ON public.vou_purchase_inbound_details DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.vou_validate_document_detail();


--
-- Name: vou_purchase_inquiry_details vou_purchase_inquiry_detail_ck; Type: TRIGGER; Schema: public; Owner: -
--

CREATE CONSTRAINT TRIGGER vou_purchase_inquiry_detail_ck AFTER INSERT OR DELETE OR UPDATE ON public.vou_purchase_inquiry_details DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.vou_validate_document_detail();


--
-- Name: vou_purchase_order_details vou_purchase_order_detail_ck; Type: TRIGGER; Schema: public; Owner: -
--

CREATE CONSTRAINT TRIGGER vou_purchase_order_detail_ck AFTER INSERT OR DELETE OR UPDATE ON public.vou_purchase_order_details DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.vou_validate_document_detail();


--
-- Name: vou_purchase_return_details vou_purchase_return_detail_ck; Type: TRIGGER; Schema: public; Owner: -
--

CREATE CONSTRAINT TRIGGER vou_purchase_return_detail_ck AFTER INSERT OR DELETE OR UPDATE ON public.vou_purchase_return_details DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.vou_validate_document_detail();


--
-- Name: vou_receipt_details vou_receipt_detail_ck; Type: TRIGGER; Schema: public; Owner: -
--

CREATE CONSTRAINT TRIGGER vou_receipt_detail_ck AFTER INSERT OR DELETE OR UPDATE ON public.vou_receipt_details DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.vou_validate_document_detail();


--
-- Name: vou_sale_delivery_details vou_sale_delivery_detail_ck; Type: TRIGGER; Schema: public; Owner: -
--

CREATE CONSTRAINT TRIGGER vou_sale_delivery_detail_ck AFTER INSERT OR DELETE OR UPDATE ON public.vou_sale_delivery_details DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.vou_validate_document_detail();


--
-- Name: vou_sale_order_details vou_sale_order_detail_ck; Type: TRIGGER; Schema: public; Owner: -
--

CREATE CONSTRAINT TRIGGER vou_sale_order_detail_ck AFTER INSERT OR DELETE OR UPDATE ON public.vou_sale_order_details DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.vou_validate_document_detail();


--
-- Name: vou_sale_outbound_details vou_sale_outbound_detail_ck; Type: TRIGGER; Schema: public; Owner: -
--

CREATE CONSTRAINT TRIGGER vou_sale_outbound_detail_ck AFTER INSERT OR DELETE OR UPDATE ON public.vou_sale_outbound_details DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.vou_validate_document_detail();


--
-- Name: vou_sale_pricing_details vou_sale_pricing_detail_ck; Type: TRIGGER; Schema: public; Owner: -
--

CREATE CONSTRAINT TRIGGER vou_sale_pricing_detail_ck AFTER INSERT OR DELETE OR UPDATE ON public.vou_sale_pricing_details DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.vou_validate_document_detail();


--
-- Name: vou_sale_return_details vou_sale_return_detail_ck; Type: TRIGGER; Schema: public; Owner: -
--

CREATE CONSTRAINT TRIGGER vou_sale_return_detail_ck AFTER INSERT OR DELETE OR UPDATE ON public.vou_sale_return_details DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.vou_validate_document_detail();


--
-- Name: vou_sale_signoff_details vou_sale_signoff_detail_ck; Type: TRIGGER; Schema: public; Owner: -
--

CREATE CONSTRAINT TRIGGER vou_sale_signoff_detail_ck AFTER INSERT OR DELETE OR UPDATE ON public.vou_sale_signoff_details DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.vou_validate_document_detail();


--
-- Name: acc_asset_book_values acc_asset_book_accumulated_subject_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_asset_book_values
    ADD CONSTRAINT acc_asset_book_accumulated_subject_fk FOREIGN KEY (book_id, accumulated_subject_id) REFERENCES public.acc_subjects(book_id, id) ON DELETE RESTRICT;


--
-- Name: acc_asset_book_values acc_asset_book_asset_subject_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_asset_book_values
    ADD CONSTRAINT acc_asset_book_asset_subject_fk FOREIGN KEY (book_id, asset_subject_id) REFERENCES public.acc_subjects(book_id, id) ON DELETE RESTRICT;


--
-- Name: acc_asset_book_values acc_asset_book_expense_subject_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_asset_book_values
    ADD CONSTRAINT acc_asset_book_expense_subject_fk FOREIGN KEY (book_id, expense_subject_id) REFERENCES public.acc_subjects(book_id, id) ON DELETE RESTRICT;


--
-- Name: acc_asset_book_values acc_asset_book_values_asset_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_asset_book_values
    ADD CONSTRAINT acc_asset_book_values_asset_id_fkey FOREIGN KEY (asset_id) REFERENCES public.acc_assets(id) ON DELETE CASCADE;


--
-- Name: acc_asset_book_values acc_asset_book_values_book_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_asset_book_values
    ADD CONSTRAINT acc_asset_book_values_book_id_fkey FOREIGN KEY (book_id) REFERENCES public.acc_books(id) ON DELETE CASCADE;


--
-- Name: acc_bill_book_values acc_bill_book_values_bill_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_bill_book_values
    ADD CONSTRAINT acc_bill_book_values_bill_id_fkey FOREIGN KEY (bill_id) REFERENCES public.acc_bills(id) ON DELETE CASCADE;


--
-- Name: acc_bill_book_values acc_bill_book_values_book_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_bill_book_values
    ADD CONSTRAINT acc_bill_book_values_book_id_fkey FOREIGN KEY (book_id) REFERENCES public.acc_books(id) ON DELETE CASCADE;


--
-- Name: acc_book_user_scopes acc_book_user_scopes_book_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_book_user_scopes
    ADD CONSTRAINT acc_book_user_scopes_book_id_fkey FOREIGN KEY (book_id) REFERENCES public.acc_books(id) ON DELETE CASCADE;


--
-- Name: acc_book_user_scopes acc_book_user_scopes_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_book_user_scopes
    ADD CONSTRAINT acc_book_user_scopes_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.app_users(id) ON DELETE RESTRICT;


--
-- Name: acc_book_user_scopes acc_book_user_scopes_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_book_user_scopes
    ADD CONSTRAINT acc_book_user_scopes_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.app_users(id) ON DELETE CASCADE;


--
-- Name: acc_books acc_books_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_books
    ADD CONSTRAINT acc_books_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.app_users(id) ON DELETE RESTRICT;


--
-- Name: acc_books acc_books_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_books
    ADD CONSTRAINT acc_books_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.app_users(id) ON DELETE RESTRICT;


--
-- Name: acc_depreciation_entries acc_depreciation_entries_asset_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_depreciation_entries
    ADD CONSTRAINT acc_depreciation_entries_asset_id_fkey FOREIGN KEY (asset_id) REFERENCES public.acc_assets(id) ON DELETE RESTRICT;


--
-- Name: acc_depreciation_entries acc_depreciation_entries_book_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_depreciation_entries
    ADD CONSTRAINT acc_depreciation_entries_book_id_fkey FOREIGN KEY (book_id) REFERENCES public.acc_books(id) ON DELETE CASCADE;


--
-- Name: acc_depreciation_entries acc_depreciation_entries_book_id_system_voucher_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_depreciation_entries
    ADD CONSTRAINT acc_depreciation_entries_book_id_system_voucher_id_fkey FOREIGN KEY (book_id, system_voucher_id) REFERENCES public.acc_vouchers(book_id, id) ON DELETE CASCADE;


--
-- Name: acc_inventory_cost_allocations acc_inventory_cost_allocations_book_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_inventory_cost_allocations
    ADD CONSTRAINT acc_inventory_cost_allocations_book_id_fkey FOREIGN KEY (book_id) REFERENCES public.acc_books(id) ON DELETE CASCADE;


--
-- Name: acc_inventory_cost_allocations acc_inventory_cost_allocations_book_id_system_voucher_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_inventory_cost_allocations
    ADD CONSTRAINT acc_inventory_cost_allocations_book_id_system_voucher_id_fkey FOREIGN KEY (book_id, system_voucher_id) REFERENCES public.acc_vouchers(book_id, id) ON DELETE CASCADE;


--
-- Name: acc_inventory_cost_allocations acc_inventory_cost_allocations_entry_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_inventory_cost_allocations
    ADD CONSTRAINT acc_inventory_cost_allocations_entry_id_fkey FOREIGN KEY (entry_id) REFERENCES public.acc_inventory_entries(id) ON DELETE CASCADE;


--
-- Name: acc_inventory_cost_allocations acc_inventory_cost_allocations_source_cost_entry_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_inventory_cost_allocations
    ADD CONSTRAINT acc_inventory_cost_allocations_source_cost_entry_id_fkey FOREIGN KEY (source_cost_entry_id) REFERENCES public.acc_inventory_entries(id) ON DELETE RESTRICT;


--
-- Name: acc_inventory_entries acc_inventory_entries_book_id_subject_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_inventory_entries
    ADD CONSTRAINT acc_inventory_entries_book_id_subject_id_fkey FOREIGN KEY (book_id, subject_id) REFERENCES public.acc_subjects(book_id, id) ON DELETE RESTRICT;


--
-- Name: acc_inventory_entries acc_inventory_entries_book_id_voucher_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_inventory_entries
    ADD CONSTRAINT acc_inventory_entries_book_id_voucher_id_fkey FOREIGN KEY (book_id, voucher_id) REFERENCES public.acc_vouchers(book_id, id) ON DELETE CASCADE;


--
-- Name: acc_inventory_entries acc_inventory_entries_cost_subject_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_inventory_entries
    ADD CONSTRAINT acc_inventory_entries_cost_subject_fk FOREIGN KEY (book_id, cost_counterpart_subject_id) REFERENCES public.acc_subjects(book_id, id) ON DELETE RESTRICT;


--
-- Name: acc_inventory_entries acc_inventory_entries_voucher_line_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_inventory_entries
    ADD CONSTRAINT acc_inventory_entries_voucher_line_id_fkey FOREIGN KEY (voucher_line_id) REFERENCES public.acc_voucher_lines(id) ON DELETE CASCADE;


--
-- Name: acc_mappings acc_mappings_book_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_mappings
    ADD CONSTRAINT acc_mappings_book_id_fkey FOREIGN KEY (book_id) REFERENCES public.acc_books(id) ON DELETE CASCADE;


--
-- Name: acc_mappings acc_mappings_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_mappings
    ADD CONSTRAINT acc_mappings_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.app_users(id) ON DELETE RESTRICT;


--
-- Name: acc_mappings acc_mappings_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_mappings
    ADD CONSTRAINT acc_mappings_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.app_users(id) ON DELETE RESTRICT;


--
-- Name: dcl_acc_mapping_versions dcl_acc_mapping_versions_mapping_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dcl_acc_mapping_versions
    ADD CONSTRAINT dcl_acc_mapping_versions_mapping_id_fkey FOREIGN KEY (mapping_id) REFERENCES public.acc_mappings(id) ON DELETE CASCADE;


--
-- Name: dcl_acc_mapping_versions dcl_acc_mapping_versions_approval_entry_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dcl_acc_mapping_versions
    ADD CONSTRAINT dcl_acc_mapping_versions_approval_entry_id_fkey FOREIGN KEY (approval_entry_id) REFERENCES public.approval_entries(id) ON DELETE RESTRICT;


--
-- Name: acc_opening_assets acc_opening_assets_book_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_opening_assets
    ADD CONSTRAINT acc_opening_assets_book_id_fkey FOREIGN KEY (book_id) REFERENCES public.acc_openings(book_id) ON DELETE CASCADE;


--
-- Name: acc_opening_bills acc_opening_bills_book_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_opening_bills
    ADD CONSTRAINT acc_opening_bills_book_id_fkey FOREIGN KEY (book_id) REFERENCES public.acc_openings(book_id) ON DELETE CASCADE;


--
-- Name: acc_opening_containers acc_opening_containers_book_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_opening_containers
    ADD CONSTRAINT acc_opening_containers_book_id_fkey FOREIGN KEY (book_id) REFERENCES public.acc_openings(book_id) ON DELETE CASCADE;


--
-- Name: acc_opening_lines acc_opening_lines_book_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_opening_lines
    ADD CONSTRAINT acc_opening_lines_book_id_fkey FOREIGN KEY (book_id) REFERENCES public.acc_openings(book_id) ON DELETE CASCADE;


--
-- Name: acc_opening_lines acc_opening_lines_book_id_subject_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_opening_lines
    ADD CONSTRAINT acc_opening_lines_book_id_subject_id_fkey FOREIGN KEY (book_id, subject_id) REFERENCES public.acc_subjects(book_id, id) ON DELETE RESTRICT;


--
--
-- Name: acc_openings acc_openings_book_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_openings
    ADD CONSTRAINT acc_openings_book_id_fkey FOREIGN KEY (book_id) REFERENCES public.acc_books(id) ON DELETE CASCADE;


--
-- Name: acc_openings acc_openings_book_id_voucher_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_openings
    ADD CONSTRAINT acc_openings_book_id_voucher_id_fkey FOREIGN KEY (book_id, voucher_id) REFERENCES public.acc_vouchers(book_id, id) ON DELETE SET NULL;


--
-- Name: acc_openings acc_openings_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_openings
    ADD CONSTRAINT acc_openings_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.app_users(id) ON DELETE RESTRICT;


--
-- Name: acc_openings acc_openings_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_openings
    ADD CONSTRAINT acc_openings_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.app_users(id) ON DELETE RESTRICT;


--
-- Name: acc_period_balances acc_period_balances_book_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_period_balances
    ADD CONSTRAINT acc_period_balances_book_id_fkey FOREIGN KEY (book_id) REFERENCES public.acc_books(id) ON DELETE CASCADE;


--
-- Name: acc_period_balances acc_period_balances_book_id_subject_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_period_balances
    ADD CONSTRAINT acc_period_balances_book_id_subject_id_fkey FOREIGN KEY (book_id, subject_id) REFERENCES public.acc_subjects(book_id, id) ON DELETE RESTRICT;


--
-- Name: acc_periods acc_periods_book_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_periods
    ADD CONSTRAINT acc_periods_book_id_fkey FOREIGN KEY (book_id) REFERENCES public.acc_books(id) ON DELETE CASCADE;


--
-- Name: acc_periods acc_periods_locked_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_periods
    ADD CONSTRAINT acc_periods_locked_by_fkey FOREIGN KEY (locked_by) REFERENCES public.app_users(id) ON DELETE RESTRICT;


--
-- Name: acc_periods acc_periods_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_periods
    ADD CONSTRAINT acc_periods_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.app_users(id) ON DELETE RESTRICT;


--
-- Name: acc_subject_dimensions acc_subject_dimensions_subject_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_subject_dimensions
    ADD CONSTRAINT acc_subject_dimensions_subject_id_fkey FOREIGN KEY (subject_id) REFERENCES public.acc_subjects(id) ON DELETE CASCADE;


--
-- Name: acc_subject_usages acc_subject_usages_subject_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_subject_usages
    ADD CONSTRAINT acc_subject_usages_subject_id_fkey FOREIGN KEY (subject_id) REFERENCES public.acc_subjects(id) ON DELETE RESTRICT;


--
-- Name: acc_subjects acc_subjects_book_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_subjects
    ADD CONSTRAINT acc_subjects_book_id_fkey FOREIGN KEY (book_id) REFERENCES public.acc_books(id) ON DELETE CASCADE;


--
-- Name: acc_subjects acc_subjects_book_id_parent_subject_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_subjects
    ADD CONSTRAINT acc_subjects_book_id_parent_subject_id_fkey FOREIGN KEY (book_id, parent_subject_id) REFERENCES public.acc_subjects(book_id, id) ON DELETE RESTRICT;


--
-- Name: acc_subjects acc_subjects_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_subjects
    ADD CONSTRAINT acc_subjects_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.app_users(id) ON DELETE RESTRICT;


--
-- Name: acc_subjects acc_subjects_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_subjects
    ADD CONSTRAINT acc_subjects_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.app_users(id) ON DELETE RESTRICT;


--
-- Name: acc_voucher_lines acc_voucher_lines_book_id_subject_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_voucher_lines
    ADD CONSTRAINT acc_voucher_lines_book_id_subject_id_fkey FOREIGN KEY (book_id, subject_id) REFERENCES public.acc_subjects(book_id, id) ON DELETE RESTRICT;


--
-- Name: acc_voucher_lines acc_voucher_lines_book_id_voucher_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_voucher_lines
    ADD CONSTRAINT acc_voucher_lines_book_id_voucher_id_fkey FOREIGN KEY (book_id, voucher_id) REFERENCES public.acc_vouchers(book_id, id) ON DELETE CASCADE;


--
-- Name: acc_vouchers acc_vouchers_book_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_vouchers
    ADD CONSTRAINT acc_vouchers_book_id_fkey FOREIGN KEY (book_id) REFERENCES public.acc_books(id) ON DELETE RESTRICT;


--
-- Name: acc_vouchers acc_vouchers_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_vouchers
    ADD CONSTRAINT acc_vouchers_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.app_users(id) ON DELETE RESTRICT;


--
-- Name: acc_vouchers acc_vouchers_mapping_approval_entry_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acc_vouchers
    ADD CONSTRAINT acc_vouchers_mapping_approval_entry_fk FOREIGN KEY (mapping_approval_entry_id) REFERENCES public.dcl_acc_mapping_versions(approval_entry_id) ON DELETE RESTRICT;


--
-- Name: app_audit_events app_audit_events_actor_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_audit_events
    ADD CONSTRAINT app_audit_events_actor_user_id_fkey FOREIGN KEY (actor_user_id) REFERENCES public.app_users(id) ON DELETE SET NULL;


--
-- Name: app_business_menu_items app_business_menu_items_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_business_menu_items
    ADD CONSTRAINT app_business_menu_items_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.app_users(id) ON DELETE RESTRICT;


--
-- Name: app_business_menu_items app_business_menu_items_parent_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_business_menu_items
    ADD CONSTRAINT app_business_menu_items_parent_fk FOREIGN KEY (parent_id) REFERENCES public.app_business_menu_items(id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED;


--
-- Name: app_business_menu_items app_business_menu_items_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_business_menu_items
    ADD CONSTRAINT app_business_menu_items_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.app_users(id) ON DELETE RESTRICT;


--
-- Name: app_menu_settings app_menu_settings_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_menu_settings
    ADD CONSTRAINT app_menu_settings_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.app_users(id) ON DELETE RESTRICT;


--
--
-- Name: app_role_permissions app_role_permissions_permission_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_role_permissions
    ADD CONSTRAINT app_role_permissions_permission_id_fkey FOREIGN KEY (permission_id) REFERENCES public.app_permissions(id) ON DELETE RESTRICT;


--
-- Name: app_role_permissions app_role_permissions_role_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_role_permissions
    ADD CONSTRAINT app_role_permissions_role_id_fkey FOREIGN KEY (role_id) REFERENCES public.app_roles(id) ON DELETE CASCADE;


--
-- Name: app_sessions app_sessions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_sessions
    ADD CONSTRAINT app_sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.app_users(id) ON DELETE CASCADE;


--
-- Name: app_user_profiles app_user_profiles_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_user_profiles
    ADD CONSTRAINT app_user_profiles_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.app_users(id) ON DELETE CASCADE;


--
-- Name: app_user_roles app_user_roles_role_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_user_roles
    ADD CONSTRAINT app_user_roles_role_id_fkey FOREIGN KEY (role_id) REFERENCES public.app_roles(id) ON DELETE RESTRICT;


--
-- Name: app_user_roles app_user_roles_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_user_roles
    ADD CONSTRAINT app_user_roles_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.app_users(id) ON DELETE CASCADE;


--
-- Name: dcl_customer_accounts dcl_customer_accounts_customer_relationship_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--


--
-- Name: dcl_customer_accounts dcl_customer_accounts_object_id_object_entity_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--


--
-- Name: dcl_customer_download_tokens dcl_customer_download_tokens_file_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dcl_customer_download_tokens
    ADD CONSTRAINT dcl_customer_download_tokens_file_id_fkey FOREIGN KEY (file_id) REFERENCES public.dcl_customer_files(id) ON DELETE CASCADE;


--
-- Name: dcl_customer_relationships dcl_customer_relationships_merged_into_object_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--


--
-- Name: dcl_customer_relationships dcl_customer_relationships_object_id_object_entity_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--


--
-- Name: dcl_customer_relationships dcl_customer_relationships_operating_entity_id_operating_e_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--


--
-- Name: dcl_customer_relationships dcl_customer_relationships_party_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--


--
-- Name: dcl_employment_relationships dcl_employment_relationships_merged_into_object_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--


--
-- Name: dcl_employment_relationships dcl_employment_relationships_object_id_object_entity_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--


--
-- Name: dcl_employment_relationships dcl_employment_relationships_operating_entity_id_operating_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--


--
-- Name: dcl_employment_relationships dcl_employment_relationships_party_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--


--
-- Name: dcl_fund_account_versions dcl_fund_account_operating_object_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dcl_fund_account_versions
    ADD CONSTRAINT dcl_fund_account_operating_object_fk FOREIGN KEY (operating_entity_id, operating_entity_entity) REFERENCES public.dcl_subjects(id, entity) ON DELETE RESTRICT;


--
-- Name: dcl_fund_account_versions dcl_fund_account_operating_version_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dcl_fund_account_versions
    ADD CONSTRAINT dcl_fund_account_operating_version_fk FOREIGN KEY (operating_entity_approval_entry_id) REFERENCES public.approval_entries(id) ON DELETE RESTRICT;


--

--
-- Name: dcl_fund_account_versions dcl_fund_account_versions_approval_entry_id_entity_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dcl_fund_account_versions
    ADD CONSTRAINT dcl_fund_account_versions_approval_entry_id_entity_fkey FOREIGN KEY (approval_entry_id) REFERENCES public.approval_entries(id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.dcl_fund_account_identifier_claims
    ADD CONSTRAINT dcl_fund_account_identifier_claims_object_fkey FOREIGN KEY (object_id, object_entity) REFERENCES public.dcl_subjects(id, entity) ON DELETE CASCADE;
ALTER TABLE ONLY public.dcl_fund_account_identifier_claims
    ADD CONSTRAINT dcl_fund_account_identifier_claims_approved_fkey FOREIGN KEY (approved_entry_id) REFERENCES public.approval_entries(id) ON DELETE RESTRICT;
ALTER TABLE ONLY public.dcl_fund_account_identifier_claims
    ADD CONSTRAINT dcl_fund_account_identifier_claims_open_fkey FOREIGN KEY (open_entry_id) REFERENCES public.approval_entries(id) ON DELETE RESTRICT;
ALTER TABLE ONLY public.dcl_product_barcode_claims
    ADD CONSTRAINT dcl_product_barcode_claims_object_fkey FOREIGN KEY (object_id, object_entity) REFERENCES public.dcl_subjects(id, entity) ON DELETE CASCADE;
ALTER TABLE ONLY public.dcl_product_barcode_claims
    ADD CONSTRAINT dcl_product_barcode_claims_approved_fkey FOREIGN KEY (approved_entry_id) REFERENCES public.approval_entries(id) ON DELETE RESTRICT;
ALTER TABLE ONLY public.dcl_product_barcode_claims
    ADD CONSTRAINT dcl_product_barcode_claims_open_fkey FOREIGN KEY (open_entry_id) REFERENCES public.approval_entries(id) ON DELETE RESTRICT;
ALTER TABLE ONLY public.dcl_operating_entity_versions
    ADD CONSTRAINT dcl_operating_entity_versions_approval_entry_id_fkey FOREIGN KEY (approval_entry_id) REFERENCES public.approval_entries(id) ON DELETE RESTRICT;


--
-- Name: dcl_parties dcl_parties_merged_into_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dcl_party_versions
    ADD CONSTRAINT dcl_party_versions_approval_entry_id_fkey FOREIGN KEY (approval_entry_id) REFERENCES public.approval_entries(id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.dcl_party_versions
    ADD CONSTRAINT dcl_party_versions_party_id_fkey FOREIGN KEY (party_id) REFERENCES public.dcl_parties(id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.dcl_party_version_identifiers
    ADD CONSTRAINT dcl_party_version_identifiers_approval_entry_id_fkey FOREIGN KEY (approval_entry_id) REFERENCES public.dcl_party_versions(approval_entry_id) ON DELETE CASCADE;

ALTER TABLE ONLY public.dcl_party_identifier_claims
    ADD CONSTRAINT dcl_party_identifier_claims_approved_party_id_fkey FOREIGN KEY (approved_party_id) REFERENCES public.dcl_parties(id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.dcl_party_identifier_claims
    ADD CONSTRAINT dcl_party_identifier_claims_approved_approval_entry_id_fkey FOREIGN KEY (approved_approval_entry_id) REFERENCES public.approval_entries(id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.dcl_party_identifier_claims
    ADD CONSTRAINT dcl_party_identifier_claims_open_party_id_fkey FOREIGN KEY (open_party_id) REFERENCES public.dcl_parties(id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.dcl_party_identifier_claims
    ADD CONSTRAINT dcl_party_identifier_claims_open_approval_entry_id_fkey FOREIGN KEY (open_approval_entry_id) REFERENCES public.approval_entries(id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.dcl_parties
    ADD CONSTRAINT dcl_parties_subject_fkey FOREIGN KEY (id, entity) REFERENCES public.dcl_subjects(id, entity) ON DELETE RESTRICT;
ALTER TABLE ONLY public.dcl_parties
    ADD CONSTRAINT dcl_parties_merged_into_fkey FOREIGN KEY (merged_into_party_id) REFERENCES public.dcl_parties(id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.dcl_customer_relationships
    ADD CONSTRAINT dcl_customer_relationships_subject_fkey FOREIGN KEY (object_id, object_entity) REFERENCES public.dcl_subjects(id, entity) ON DELETE RESTRICT;
ALTER TABLE ONLY public.dcl_customer_relationships
    ADD CONSTRAINT dcl_customer_relationships_party_fkey FOREIGN KEY (party_id) REFERENCES public.dcl_parties(id) ON DELETE RESTRICT;
ALTER TABLE ONLY public.dcl_customer_relationships
    ADD CONSTRAINT dcl_customer_relationships_operating_fkey FOREIGN KEY (operating_entity_id, operating_entity_entity) REFERENCES public.dcl_subjects(id, entity) ON DELETE RESTRICT;
ALTER TABLE ONLY public.dcl_customer_relationships
    ADD CONSTRAINT dcl_customer_relationships_merged_fkey FOREIGN KEY (merged_into_object_id) REFERENCES public.dcl_customer_relationships(object_id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.dcl_employment_relationships
    ADD CONSTRAINT dcl_employment_relationships_subject_fkey FOREIGN KEY (object_id, object_entity) REFERENCES public.dcl_subjects(id, entity) ON DELETE RESTRICT;
ALTER TABLE ONLY public.dcl_employment_relationships
    ADD CONSTRAINT dcl_employment_relationships_party_fkey FOREIGN KEY (party_id) REFERENCES public.dcl_parties(id) ON DELETE RESTRICT;
ALTER TABLE ONLY public.dcl_employment_relationships
    ADD CONSTRAINT dcl_employment_relationships_operating_fkey FOREIGN KEY (operating_entity_id, operating_entity_entity) REFERENCES public.dcl_subjects(id, entity) ON DELETE RESTRICT;
ALTER TABLE ONLY public.dcl_employment_relationships
    ADD CONSTRAINT dcl_employment_relationships_merged_fkey FOREIGN KEY (merged_into_object_id) REFERENCES public.dcl_employment_relationships(object_id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.dcl_supplier_relationships
    ADD CONSTRAINT dcl_supplier_relationships_subject_fkey FOREIGN KEY (object_id, object_entity) REFERENCES public.dcl_subjects(id, entity) ON DELETE RESTRICT;
ALTER TABLE ONLY public.dcl_supplier_relationships
    ADD CONSTRAINT dcl_supplier_relationships_party_fkey FOREIGN KEY (party_id) REFERENCES public.dcl_parties(id) ON DELETE RESTRICT;
ALTER TABLE ONLY public.dcl_supplier_relationships
    ADD CONSTRAINT dcl_supplier_relationships_operating_fkey FOREIGN KEY (operating_entity_id, operating_entity_entity) REFERENCES public.dcl_subjects(id, entity) ON DELETE RESTRICT;
ALTER TABLE ONLY public.dcl_supplier_relationships
    ADD CONSTRAINT dcl_supplier_relationships_merged_fkey FOREIGN KEY (merged_into_object_id) REFERENCES public.dcl_supplier_relationships(object_id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.dcl_service_relationships
    ADD CONSTRAINT dcl_service_relationships_subject_fkey FOREIGN KEY (object_id, object_entity) REFERENCES public.dcl_subjects(id, entity) ON DELETE RESTRICT;
ALTER TABLE ONLY public.dcl_service_relationships
    ADD CONSTRAINT dcl_service_relationships_party_fkey FOREIGN KEY (party_id) REFERENCES public.dcl_parties(id) ON DELETE RESTRICT;
ALTER TABLE ONLY public.dcl_service_relationships
    ADD CONSTRAINT dcl_service_relationships_operating_fkey FOREIGN KEY (operating_entity_id, operating_entity_entity) REFERENCES public.dcl_subjects(id, entity) ON DELETE RESTRICT;
ALTER TABLE ONLY public.dcl_service_relationships
    ADD CONSTRAINT dcl_service_relationships_merged_fkey FOREIGN KEY (merged_into_object_id) REFERENCES public.dcl_service_relationships(object_id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.dcl_sales_relationships
    ADD CONSTRAINT dcl_sales_relationships_subject_fkey FOREIGN KEY (object_id, object_entity) REFERENCES public.dcl_subjects(id, entity) ON DELETE RESTRICT;
ALTER TABLE ONLY public.dcl_sales_relationships
    ADD CONSTRAINT dcl_sales_relationships_party_fkey FOREIGN KEY (party_id) REFERENCES public.dcl_parties(id) ON DELETE RESTRICT;
ALTER TABLE ONLY public.dcl_sales_relationships
    ADD CONSTRAINT dcl_sales_relationships_operating_fkey FOREIGN KEY (operating_entity_id, operating_entity_entity) REFERENCES public.dcl_subjects(id, entity) ON DELETE RESTRICT;
ALTER TABLE ONLY public.dcl_sales_relationships
    ADD CONSTRAINT dcl_sales_relationships_merged_fkey FOREIGN KEY (merged_into_object_id) REFERENCES public.dcl_sales_relationships(object_id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.dcl_customer_accounts
    ADD CONSTRAINT dcl_customer_accounts_subject_fkey FOREIGN KEY (object_id, object_entity) REFERENCES public.dcl_subjects(id, entity) ON DELETE RESTRICT;
ALTER TABLE ONLY public.dcl_customer_accounts
    ADD CONSTRAINT dcl_customer_accounts_relationship_fkey FOREIGN KEY (customer_relationship_id) REFERENCES public.dcl_customer_relationships(object_id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.dcl_party_merge_preflights
    ADD CONSTRAINT dcl_party_merge_preflights_source_fkey FOREIGN KEY (source_party_id) REFERENCES public.dcl_parties(id) ON DELETE RESTRICT;
ALTER TABLE ONLY public.dcl_party_merge_preflights
    ADD CONSTRAINT dcl_party_merge_preflights_target_fkey FOREIGN KEY (target_party_id) REFERENCES public.dcl_parties(id) ON DELETE RESTRICT;
ALTER TABLE ONLY public.dcl_party_merge_preflights
    ADD CONSTRAINT dcl_party_merge_preflights_source_entry_fkey FOREIGN KEY (source_approval_entry_id) REFERENCES public.approval_entries(id) ON DELETE RESTRICT;
ALTER TABLE ONLY public.dcl_party_merge_preflights
    ADD CONSTRAINT dcl_party_merge_preflights_target_entry_fkey FOREIGN KEY (target_approval_entry_id) REFERENCES public.approval_entries(id) ON DELETE RESTRICT;
ALTER TABLE ONLY public.dcl_party_merge_events
    ADD CONSTRAINT dcl_party_merge_events_preflight_fkey FOREIGN KEY (preflight_id) REFERENCES public.dcl_party_merge_preflights(id) ON DELETE RESTRICT;
ALTER TABLE ONLY public.dcl_party_merge_events
    ADD CONSTRAINT dcl_party_merge_events_source_fkey FOREIGN KEY (source_party_id) REFERENCES public.dcl_parties(id) ON DELETE RESTRICT;
ALTER TABLE ONLY public.dcl_party_merge_events
    ADD CONSTRAINT dcl_party_merge_events_target_fkey FOREIGN KEY (target_party_id) REFERENCES public.dcl_parties(id) ON DELETE RESTRICT;
ALTER TABLE ONLY public.dcl_party_relationship_merge_events
    ADD CONSTRAINT dcl_party_relationship_merge_events_merge_fkey FOREIGN KEY (merge_event_id) REFERENCES public.dcl_party_merge_events(id) ON DELETE RESTRICT;
ALTER TABLE ONLY public.dcl_party_relationship_merge_events
    ADD CONSTRAINT dcl_party_relationship_merge_events_operating_fkey FOREIGN KEY (operating_entity_id, operating_entity_entity) REFERENCES public.dcl_subjects(id, entity) ON DELETE RESTRICT;



--
-- Name: dcl_party_identifier_claims dcl_party_identifier_claims_party_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--


--
-- Name: dcl_party_merge_events dcl_party_merge_events_preflight_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--


--
-- Name: dcl_party_merge_events dcl_party_merge_events_source_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--


--
-- Name: dcl_party_merge_events dcl_party_merge_events_target_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--


--
-- Name: dcl_party_merge_preflights dcl_party_merge_preflights_source_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--


--
-- Name: dcl_party_merge_preflights dcl_party_merge_preflights_source_entry_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--


--
-- Name: dcl_party_merge_preflights dcl_party_merge_preflights_target_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--


--
-- Name: dcl_party_merge_preflights dcl_party_merge_preflights_target_entry_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--


--
-- Name: dcl_party_relationship_merge_events dcl_party_relationship_merge_events_merge_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--


--
-- Name: dcl_party_relationship_merge_events dcl_party_relationship_merge_events_operating_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--


--
-- Name: dcl_party_relationship_merge_events source object has immutable historical identity; Type: FK CONSTRAINT; Schema: public; Owner: -
--


--
-- Name: dcl_party_relationship_merge_events target object has immutable historical identity; Type: FK CONSTRAINT; Schema: public; Owner: -
--


--
-- Name: dcl_product_formula_lines dcl_product_formula_lines_material_object_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dcl_product_formula_lines
    ADD CONSTRAINT dcl_product_formula_lines_material_object_id_fkey FOREIGN KEY (material_object_id, material_entity) REFERENCES public.dcl_subjects(id, entity) ON DELETE RESTRICT;


--
-- Name: dcl_product_formula_lines dcl_product_formula_lines_material_approval_entry_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dcl_product_formula_lines
    ADD CONSTRAINT dcl_product_formula_lines_material_approval_entry_id_fkey FOREIGN KEY (material_approval_entry_id) REFERENCES public.approval_entries(id) ON DELETE RESTRICT;


--
-- Name: dcl_product_formula_lines dcl_product_formula_lines_product_approval_entry_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dcl_product_formula_lines
    ADD CONSTRAINT dcl_product_formula_lines_product_approval_entry_id_fkey FOREIGN KEY (product_approval_entry_id) REFERENCES public.dcl_product_formulas(product_approval_entry_id) ON DELETE CASCADE;


--
-- Name: dcl_product_formulas dcl_product_formulas_product_approval_entry_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dcl_product_formulas
    ADD CONSTRAINT dcl_product_formulas_product_approval_entry_id_fkey FOREIGN KEY (product_approval_entry_id) REFERENCES public.dcl_product_versions(approval_entry_id) ON DELETE RESTRICT;


--
-- Name: dcl_product_unit_conversions dcl_product_unit_conversions_product_approval_entry_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dcl_product_unit_conversions
    ADD CONSTRAINT dcl_product_unit_conversions_product_approval_entry_id_fkey FOREIGN KEY (product_approval_entry_id) REFERENCES public.dcl_product_versions(approval_entry_id) ON DELETE CASCADE;


--
-- Name: dcl_product_unit_conversions dcl_product_unit_conversions_unit_object_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dcl_product_unit_conversions
    ADD CONSTRAINT dcl_product_unit_conversions_unit_object_id_fkey FOREIGN KEY (unit_object_id) REFERENCES public.aux_objects(id) ON DELETE RESTRICT;


--
-- Name: dcl_product_versions dcl_product_versions_approval_entry_id_entity_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dcl_product_versions
    ADD CONSTRAINT dcl_product_versions_approval_entry_id_entity_fkey FOREIGN KEY (approval_entry_id) REFERENCES public.approval_entries(id) ON DELETE RESTRICT;



--
-- Name: dcl_sales_relationships dcl_sales_relationships_merged_into_object_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--


--
-- Name: dcl_sales_relationships dcl_sales_relationships_object_id_object_entity_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--


--
-- Name: dcl_sales_relationships dcl_sales_relationships_operating_entity_id_operating_enti_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--


--
-- Name: dcl_sales_relationships dcl_sales_relationships_party_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--


--
-- Name: dcl_service_relationships bob_service_relationship_merged_into_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: dcl_service_relationships dcl_service_relationships_object_id_object_entity_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--


--
-- Name: dcl_service_relationships dcl_service_relationships_operating_entity_id_operating_en_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--


--
-- Name: dcl_service_relationships dcl_service_relationships_party_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--


--
-- Name: dcl_supplier_relationships dcl_supplier_relationships_merged_into_object_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--


--
-- Name: dcl_supplier_relationships dcl_supplier_relationships_object_id_object_entity_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--


--
-- Name: dcl_supplier_relationships dcl_supplier_relationships_operating_entity_id_operating_e_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--


--
-- Name: dcl_supplier_relationships dcl_supplier_relationships_party_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--


--
--
--
--
-- Name: dcl_vehicle_versions dcl_vehicle_versions_carrier_operating_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dcl_vehicle_versions
    ADD CONSTRAINT dcl_vehicle_versions_carrier_operating_fk FOREIGN KEY (carrier_operating_entity_id, carrier_operating_entity) REFERENCES public.dcl_subjects(id, entity) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;


--
-- Name: dcl_vehicle_versions dcl_vehicle_versions_carrier_service_relationship_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dcl_vehicle_versions
    ADD CONSTRAINT dcl_vehicle_versions_carrier_service_relationship_fk FOREIGN KEY (carrier_service_relationship_object_id, carrier_service_relationship_entity) REFERENCES public.dcl_subjects(id, entity) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;


--
-- Name: dcl_vehicle_versions dcl_vehicle_versions_vehicle_type_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dcl_vehicle_versions
    ADD CONSTRAINT dcl_vehicle_versions_vehicle_type_fk FOREIGN KEY (vehicle_type_object_id, vehicle_type_entity) REFERENCES public.aux_objects(id, entity) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;


--
-- Name: dcl_vehicle_versions dcl_vehicle_versions_approval_entry_id_entity_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dcl_vehicle_versions
    ADD CONSTRAINT dcl_vehicle_versions_approval_entry_id_entity_fkey FOREIGN KEY (approval_entry_id) REFERENCES public.approval_entries(id) ON DELETE RESTRICT;


--
-- Name: dcl_warehouse_versions dcl_warehouse_versions_category_id_category_entity_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dcl_warehouse_versions
    ADD CONSTRAINT dcl_warehouse_versions_category_id_category_entity_fkey FOREIGN KEY (category_id, category_entity) REFERENCES public.aux_objects(id, entity) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;


--
-- Name: dcl_warehouse_versions dcl_warehouse_versions_manager_employee_id_manager_employee_entity_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dcl_warehouse_versions
    ADD CONSTRAINT dcl_warehouse_versions_manager_employee_id_manager_employee_entity_fkey FOREIGN KEY (manager_employee_id, manager_employee_entity) REFERENCES public.dcl_subjects(id, entity) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;


--
-- Name: dcl_warehouse_versions dcl_warehouse_versions_approval_entry_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dcl_warehouse_versions
    ADD CONSTRAINT dcl_warehouse_versions_approval_entry_id_fkey FOREIGN KEY (approval_entry_id) REFERENCES public.approval_entries(id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.dcl_vehicle_identifier_claims
    ADD CONSTRAINT dcl_vehicle_identifier_claims_object_id_fkey FOREIGN KEY (object_id, object_entity) REFERENCES public.dcl_subjects(id, entity) ON DELETE CASCADE;

ALTER TABLE ONLY public.dcl_vehicle_identifier_claims
    ADD CONSTRAINT dcl_vehicle_identifier_claims_approved_entry_id_fkey FOREIGN KEY (approved_entry_id) REFERENCES public.approval_entries(id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.dcl_vehicle_identifier_claims
    ADD CONSTRAINT dcl_vehicle_identifier_claims_open_entry_id_fkey FOREIGN KEY (open_entry_id) REFERENCES public.approval_entries(id) ON DELETE RESTRICT;


--
-- Name: rpt_runtime_audit_events rpt_runtime_audit_events_definition_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rpt_runtime_audit_events
    ADD CONSTRAINT rpt_runtime_audit_events_definition_id_fkey FOREIGN KEY (definition_id) REFERENCES public.dcl_subjects(id) ON DELETE SET NULL;


--
--
-- Name: vou_asset_acquisition_details vou_asset_acquisition_details_document_id_entity_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vou_asset_acquisition_details
    ADD CONSTRAINT vou_asset_acquisition_details_document_id_entity_fkey FOREIGN KEY (document_id, entity) REFERENCES public.vou_documents(id, entity) ON DELETE RESTRICT;


--
-- Name: vou_asset_acquisition_lines vou_asset_acquisition_lines_document_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vou_asset_acquisition_lines
    ADD CONSTRAINT vou_asset_acquisition_lines_document_id_fkey FOREIGN KEY (document_id) REFERENCES public.vou_asset_acquisition_details(document_id) ON DELETE RESTRICT;


--
-- Name: vou_asset_liquidation_details vou_asset_liquidation_details_document_id_entity_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vou_asset_liquidation_details
    ADD CONSTRAINT vou_asset_liquidation_details_document_id_entity_fkey FOREIGN KEY (document_id, entity) REFERENCES public.vou_documents(id, entity) ON DELETE RESTRICT;


--
-- Name: vou_asset_liquidation_lines vou_asset_liquidation_lines_document_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vou_asset_liquidation_lines
    ADD CONSTRAINT vou_asset_liquidation_lines_document_id_fkey FOREIGN KEY (document_id) REFERENCES public.vou_asset_liquidation_details(document_id) ON DELETE RESTRICT;


--
-- Name: vou_asset_sale_details vou_asset_sale_details_document_id_entity_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vou_asset_sale_details
    ADD CONSTRAINT vou_asset_sale_details_document_id_entity_fkey FOREIGN KEY (document_id, entity) REFERENCES public.vou_documents(id, entity) ON DELETE RESTRICT;


--
-- Name: vou_asset_sale_lines vou_asset_sale_lines_document_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vou_asset_sale_lines
    ADD CONSTRAINT vou_asset_sale_lines_document_id_fkey FOREIGN KEY (document_id) REFERENCES public.vou_asset_sale_details(document_id) ON DELETE RESTRICT;


--
-- Name: vou_bill_cash_lines vou_bill_cash_lines_document_id_bill_line_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vou_bill_cash_lines
    ADD CONSTRAINT vou_bill_cash_lines_document_id_bill_line_id_fkey FOREIGN KEY (document_id, bill_line_id) REFERENCES public.vou_bill_lines(document_id, id);


--
-- Name: vou_bill_cash_lines vou_bill_cash_lines_document_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vou_bill_cash_lines
    ADD CONSTRAINT vou_bill_cash_lines_document_id_fkey FOREIGN KEY (document_id) REFERENCES public.vou_bill_details(document_id) ON DELETE RESTRICT;


--
-- Name: vou_bill_details vou_bill_details_document_id_entity_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vou_bill_details
    ADD CONSTRAINT vou_bill_details_document_id_entity_fkey FOREIGN KEY (document_id, entity) REFERENCES public.vou_documents(id, entity) ON DELETE RESTRICT;


--
-- Name: vou_bill_lines vou_bill_lines_document_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vou_bill_lines
    ADD CONSTRAINT vou_bill_lines_document_id_fkey FOREIGN KEY (document_id) REFERENCES public.vou_bill_details(document_id) ON DELETE RESTRICT;


--
-- Name: vou_document_attachments vou_document_attachments_document_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vou_document_attachments
    ADD CONSTRAINT vou_document_attachments_document_id_fkey FOREIGN KEY (document_id) REFERENCES public.vou_documents(id) ON DELETE RESTRICT;


--
-- Name: vou_document_attachments vou_document_attachments_file_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vou_document_attachments
    ADD CONSTRAINT vou_document_attachments_file_id_fkey FOREIGN KEY (file_id) REFERENCES public.vou_files(id) ON DELETE RESTRICT;


--
-- Name: vou_documents vou_documents_parent_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vou_documents
    ADD CONSTRAINT vou_documents_parent_fk FOREIGN KEY (parent_document_id) REFERENCES public.vou_documents(id) ON DELETE RESTRICT;


--
-- Name: vou_documents vou_documents_approval_entry_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vou_documents
    ADD CONSTRAINT vou_documents_approval_entry_id_fkey FOREIGN KEY (approval_entry_id) REFERENCES public.approval_entries(id) ON DELETE RESTRICT;


--
-- Name: vou_download_tokens vou_download_tokens_file_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vou_download_tokens
    ADD CONSTRAINT vou_download_tokens_file_id_fkey FOREIGN KEY (file_id) REFERENCES public.vou_files(id) ON DELETE CASCADE;


--
-- Name: vou_employee_loan_writeoff_details vou_employee_loan_writeoff_details_document_id_entity_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vou_employee_loan_writeoff_details
    ADD CONSTRAINT vou_employee_loan_writeoff_details_document_id_entity_fkey FOREIGN KEY (document_id, entity) REFERENCES public.vou_documents(id, entity) ON DELETE RESTRICT;


--
-- Name: vou_expense_lines vou_expense_lines_document_id_document_entity_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vou_expense_lines
    ADD CONSTRAINT vou_expense_lines_document_id_document_entity_fkey FOREIGN KEY (document_id, document_entity) REFERENCES public.vou_documents(id, entity) ON DELETE RESTRICT;


--
-- Name: vou_expense_payment_details vou_expense_payment_details_document_id_entity_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vou_expense_payment_details
    ADD CONSTRAINT vou_expense_payment_details_document_id_entity_fkey FOREIGN KEY (document_id, entity) REFERENCES public.vou_documents(id, entity) ON DELETE RESTRICT;


--
-- Name: vou_expense_payment_details vou_expense_payment_details_source_reimbursement_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vou_expense_payment_details
    ADD CONSTRAINT vou_expense_payment_details_source_reimbursement_id_fkey FOREIGN KEY (source_reimbursement_id) REFERENCES public.vou_expense_reimbursement_details(document_id) ON DELETE RESTRICT;


--
-- Name: vou_expense_reimbursement_details vou_expense_reimbursement_details_document_id_entity_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vou_expense_reimbursement_details
    ADD CONSTRAINT vou_expense_reimbursement_details_document_id_entity_fkey FOREIGN KEY (document_id, entity) REFERENCES public.vou_documents(id, entity) ON DELETE RESTRICT;


--
-- Name: vou_intermediary_calculation_lines vou_intermediary_calculation__source_calculation_document__fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vou_intermediary_calculation_lines
    ADD CONSTRAINT vou_intermediary_calculation__source_calculation_document__fkey FOREIGN KEY (source_calculation_document_id) REFERENCES public.vou_intermediary_calculation_details(document_id) ON DELETE RESTRICT;


--
-- Name: vou_intermediary_calculation_bill_allocations vou_intermediary_calculation_bill_a_source_signoff_line_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vou_intermediary_calculation_bill_allocations
    ADD CONSTRAINT vou_intermediary_calculation_bill_a_source_signoff_line_id_fkey FOREIGN KEY (source_signoff_line_id) REFERENCES public.vou_sale_signoff_lines(id) ON DELETE RESTRICT;


--
-- Name: vou_intermediary_calculation_bill_allocations vou_intermediary_calculation_bill_allocations_bill_line_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vou_intermediary_calculation_bill_allocations
    ADD CONSTRAINT vou_intermediary_calculation_bill_allocations_bill_line_id_fkey FOREIGN KEY (bill_line_id) REFERENCES public.vou_bill_lines(id) ON DELETE RESTRICT;


--
-- Name: vou_intermediary_calculation_bill_allocations vou_intermediary_calculation_bill_allocations_document_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vou_intermediary_calculation_bill_allocations
    ADD CONSTRAINT vou_intermediary_calculation_bill_allocations_document_id_fkey FOREIGN KEY (document_id) REFERENCES public.vou_intermediary_calculation_details(document_id) ON DELETE RESTRICT;


--
-- Name: vou_intermediary_calculation_details vou_intermediary_calculation_details_document_id_entity_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vou_intermediary_calculation_details
    ADD CONSTRAINT vou_intermediary_calculation_details_document_id_entity_fkey FOREIGN KEY (document_id, entity) REFERENCES public.vou_documents(id, entity) ON DELETE RESTRICT;


--
-- Name: vou_intermediary_calculation_lines vou_intermediary_calculation_lines_document_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vou_intermediary_calculation_lines
    ADD CONSTRAINT vou_intermediary_calculation_lines_document_id_fkey FOREIGN KEY (document_id) REFERENCES public.vou_intermediary_calculation_details(document_id) ON DELETE RESTRICT;


--
-- Name: vou_intermediary_calculation_lines vou_intermediary_calculation_lines_source_signoff_line_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vou_intermediary_calculation_lines
    ADD CONSTRAINT vou_intermediary_calculation_lines_source_signoff_line_id_fkey FOREIGN KEY (source_signoff_line_id) REFERENCES public.vou_sale_signoff_lines(id) ON DELETE RESTRICT;


--
-- Name: vou_intermediary_calculation_summaries vou_intermediary_calculation_summaries_document_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vou_intermediary_calculation_summaries
    ADD CONSTRAINT vou_intermediary_calculation_summaries_document_id_fkey FOREIGN KEY (document_id) REFERENCES public.vou_intermediary_calculation_details(document_id) ON DELETE RESTRICT;


--
-- Name: vou_intermediary_scripts vou_intermediary_scripts_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vou_intermediary_scripts
    ADD CONSTRAINT vou_intermediary_scripts_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.app_users(id) ON DELETE RESTRICT;


--
-- Name: vou_inventory_count_details vou_inventory_count_details_document_id_entity_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vou_inventory_count_details
    ADD CONSTRAINT vou_inventory_count_details_document_id_entity_fkey FOREIGN KEY (document_id, entity) REFERENCES public.vou_documents(id, entity) ON DELETE RESTRICT;


--
-- Name: vou_inventory_count_lines vou_inventory_count_lines_document_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vou_inventory_count_lines
    ADD CONSTRAINT vou_inventory_count_lines_document_id_fkey FOREIGN KEY (document_id) REFERENCES public.vou_inventory_count_details(document_id) ON DELETE RESTRICT;


--
-- Name: vou_other_income_details vou_other_income_details_document_id_entity_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vou_other_income_details
    ADD CONSTRAINT vou_other_income_details_document_id_entity_fkey FOREIGN KEY (document_id, entity) REFERENCES public.vou_documents(id, entity) ON DELETE RESTRICT;


--
-- Name: vou_payment_details vou_payment_details_document_id_entity_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vou_payment_details
    ADD CONSTRAINT vou_payment_details_document_id_entity_fkey FOREIGN KEY (document_id, entity) REFERENCES public.vou_documents(id, entity) ON DELETE RESTRICT;


--
-- Name: vou_price_lines vou_price_lines_document_id_document_entity_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vou_price_lines
    ADD CONSTRAINT vou_price_lines_document_id_document_entity_fkey FOREIGN KEY (document_id, document_entity) REFERENCES public.vou_documents(id, entity) ON DELETE RESTRICT;


--
-- Name: vou_product_lines vou_product_lines_document_id_document_entity_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vou_product_lines
    ADD CONSTRAINT vou_product_lines_document_id_document_entity_fkey FOREIGN KEY (document_id, document_entity) REFERENCES public.vou_documents(id, entity) ON DELETE RESTRICT;


--
-- Name: vou_production_details vou_production_details_document_id_entity_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vou_production_details
    ADD CONSTRAINT vou_production_details_document_id_entity_fkey FOREIGN KEY (document_id, entity) REFERENCES public.vou_documents(id, entity) ON DELETE RESTRICT;


--
-- Name: vou_production_material_lines vou_production_material_lines_output_line_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vou_production_material_lines
    ADD CONSTRAINT vou_production_material_lines_output_line_id_fkey FOREIGN KEY (output_line_id) REFERENCES public.vou_production_output_lines(id) ON DELETE RESTRICT;


--
-- Name: vou_production_output_lines vou_production_output_lines_document_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vou_production_output_lines
    ADD CONSTRAINT vou_production_output_lines_document_id_fkey FOREIGN KEY (document_id) REFERENCES public.vou_production_details(document_id) ON DELETE RESTRICT;


--
-- Name: vou_production_output_lines vou_production_output_lines_source_order_line_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vou_production_output_lines
    ADD CONSTRAINT vou_production_output_lines_source_order_line_id_fkey FOREIGN KEY (source_order_line_id) REFERENCES public.vou_product_lines(id) ON DELETE RESTRICT;


--
-- Name: vou_purchase_inbound_details vou_purchase_inbound_details_document_id_entity_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vou_purchase_inbound_details
    ADD CONSTRAINT vou_purchase_inbound_details_document_id_entity_fkey FOREIGN KEY (document_id, entity) REFERENCES public.vou_documents(id, entity) ON DELETE RESTRICT;


--
-- Name: vou_purchase_inbound_details vou_purchase_inbound_details_source_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vou_purchase_inbound_details
    ADD CONSTRAINT vou_purchase_inbound_details_source_order_id_fkey FOREIGN KEY (source_order_id) REFERENCES public.vou_purchase_order_details(document_id) ON DELETE RESTRICT;


--
-- Name: vou_purchase_inbound_lines vou_purchase_inbound_lines_document_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vou_purchase_inbound_lines
    ADD CONSTRAINT vou_purchase_inbound_lines_document_id_fkey FOREIGN KEY (document_id) REFERENCES public.vou_purchase_inbound_details(document_id) ON DELETE RESTRICT;


--
-- Name: vou_purchase_inbound_lines vou_purchase_inbound_lines_source_order_line_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vou_purchase_inbound_lines
    ADD CONSTRAINT vou_purchase_inbound_lines_source_order_line_id_fkey FOREIGN KEY (source_order_line_id) REFERENCES public.vou_product_lines(id) ON DELETE RESTRICT;


--
-- Name: vou_purchase_inquiry_details vou_purchase_inquiry_details_document_id_entity_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vou_purchase_inquiry_details
    ADD CONSTRAINT vou_purchase_inquiry_details_document_id_entity_fkey FOREIGN KEY (document_id, entity) REFERENCES public.vou_documents(id, entity) ON DELETE RESTRICT;


--
-- Name: vou_purchase_order_details vou_purchase_order_details_document_id_entity_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vou_purchase_order_details
    ADD CONSTRAINT vou_purchase_order_details_document_id_entity_fkey FOREIGN KEY (document_id, entity) REFERENCES public.vou_documents(id, entity) ON DELETE RESTRICT;


--
-- Name: vou_purchase_return_details vou_purchase_return_details_document_id_entity_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vou_purchase_return_details
    ADD CONSTRAINT vou_purchase_return_details_document_id_entity_fkey FOREIGN KEY (document_id, entity) REFERENCES public.vou_documents(id, entity) ON DELETE RESTRICT;


--
-- Name: vou_purchase_return_details vou_purchase_return_details_source_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vou_purchase_return_details
    ADD CONSTRAINT vou_purchase_return_details_source_order_id_fkey FOREIGN KEY (source_order_id) REFERENCES public.vou_purchase_order_details(document_id) ON DELETE RESTRICT;


--
-- Name: vou_purchase_return_lines vou_purchase_return_lines_document_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vou_purchase_return_lines
    ADD CONSTRAINT vou_purchase_return_lines_document_id_fkey FOREIGN KEY (document_id) REFERENCES public.vou_purchase_return_details(document_id) ON DELETE RESTRICT;


--
-- Name: vou_purchase_return_lines vou_purchase_return_lines_source_inbound_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vou_purchase_return_lines
    ADD CONSTRAINT vou_purchase_return_lines_source_inbound_id_fkey FOREIGN KEY (source_inbound_id) REFERENCES public.vou_purchase_inbound_details(document_id) ON DELETE RESTRICT;


--
-- Name: vou_purchase_return_lines vou_purchase_return_lines_source_inbound_line_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vou_purchase_return_lines
    ADD CONSTRAINT vou_purchase_return_lines_source_inbound_line_id_fkey FOREIGN KEY (source_inbound_line_id) REFERENCES public.vou_purchase_inbound_lines(id) ON DELETE RESTRICT;


--
-- Name: vou_purchase_return_lines vou_purchase_return_lines_source_order_line_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vou_purchase_return_lines
    ADD CONSTRAINT vou_purchase_return_lines_source_order_line_id_fkey FOREIGN KEY (source_order_line_id) REFERENCES public.vou_product_lines(id) ON DELETE RESTRICT;


--
-- Name: vou_receipt_details vou_receipt_details_document_id_entity_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vou_receipt_details
    ADD CONSTRAINT vou_receipt_details_document_id_entity_fkey FOREIGN KEY (document_id, entity) REFERENCES public.vou_documents(id, entity) ON DELETE RESTRICT;


--
-- Name: vou_sale_delivery_details vou_sale_delivery_details_document_id_entity_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vou_sale_delivery_details
    ADD CONSTRAINT vou_sale_delivery_details_document_id_entity_fkey FOREIGN KEY (document_id, entity) REFERENCES public.vou_documents(id, entity) ON DELETE RESTRICT;


--
-- Name: vou_sale_delivery_details vou_sale_delivery_details_source_outbound_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vou_sale_delivery_details
    ADD CONSTRAINT vou_sale_delivery_details_source_outbound_id_fkey FOREIGN KEY (source_outbound_id) REFERENCES public.vou_sale_outbound_details(document_id) ON DELETE RESTRICT;


--
-- Name: vou_sale_order_details vou_sale_order_details_document_id_entity_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vou_sale_order_details
    ADD CONSTRAINT vou_sale_order_details_document_id_entity_fkey FOREIGN KEY (document_id, entity) REFERENCES public.vou_documents(id, entity) ON DELETE RESTRICT;


--
-- Name: vou_sale_order_formula_lines vou_sale_order_formula_lines_product_line_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vou_sale_order_formula_lines
    ADD CONSTRAINT vou_sale_order_formula_lines_product_line_id_fkey FOREIGN KEY (product_line_id) REFERENCES public.vou_sale_order_formulas(product_line_id) ON DELETE CASCADE;


--
-- Name: vou_sale_order_formulas vou_sale_order_formulas_product_line_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vou_sale_order_formulas
    ADD CONSTRAINT vou_sale_order_formulas_product_line_id_fkey FOREIGN KEY (product_line_id) REFERENCES public.vou_product_lines(id) ON DELETE CASCADE;


--
-- Name: vou_sale_order_formulas vou_sale_order_formulas_source_document_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vou_sale_order_formulas
    ADD CONSTRAINT vou_sale_order_formulas_source_document_id_fkey FOREIGN KEY (source_document_id) REFERENCES public.vou_documents(id) ON DELETE RESTRICT;


--
-- Name: vou_sale_outbound_details vou_sale_outbound_details_document_id_entity_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vou_sale_outbound_details
    ADD CONSTRAINT vou_sale_outbound_details_document_id_entity_fkey FOREIGN KEY (document_id, entity) REFERENCES public.vou_documents(id, entity) ON DELETE RESTRICT;


--
-- Name: vou_sale_outbound_details vou_sale_outbound_details_source_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vou_sale_outbound_details
    ADD CONSTRAINT vou_sale_outbound_details_source_order_id_fkey FOREIGN KEY (source_order_id) REFERENCES public.vou_sale_order_details(document_id) ON DELETE RESTRICT;


--
-- Name: vou_sale_outbound_lines vou_sale_outbound_lines_document_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vou_sale_outbound_lines
    ADD CONSTRAINT vou_sale_outbound_lines_document_id_fkey FOREIGN KEY (document_id) REFERENCES public.vou_sale_outbound_details(document_id) ON DELETE RESTRICT;


--
-- Name: vou_sale_outbound_lines vou_sale_outbound_lines_source_order_line_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vou_sale_outbound_lines
    ADD CONSTRAINT vou_sale_outbound_lines_source_order_line_id_fkey FOREIGN KEY (source_order_line_id) REFERENCES public.vou_product_lines(id) ON DELETE RESTRICT;


--
-- Name: vou_sale_pricing_details vou_sale_pricing_details_document_id_entity_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vou_sale_pricing_details
    ADD CONSTRAINT vou_sale_pricing_details_document_id_entity_fkey FOREIGN KEY (document_id, entity) REFERENCES public.vou_documents(id, entity) ON DELETE RESTRICT;


--
-- Name: vou_sale_return_details vou_sale_return_details_document_id_entity_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vou_sale_return_details
    ADD CONSTRAINT vou_sale_return_details_document_id_entity_fkey FOREIGN KEY (document_id, entity) REFERENCES public.vou_documents(id, entity) ON DELETE RESTRICT;


--
-- Name: vou_sale_return_details vou_sale_return_details_source_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vou_sale_return_details
    ADD CONSTRAINT vou_sale_return_details_source_order_id_fkey FOREIGN KEY (source_order_id) REFERENCES public.vou_sale_order_details(document_id) ON DELETE RESTRICT;


--
-- Name: vou_sale_return_details vou_sale_return_details_source_signoff_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vou_sale_return_details
    ADD CONSTRAINT vou_sale_return_details_source_signoff_id_fkey FOREIGN KEY (source_signoff_id) REFERENCES public.vou_sale_signoff_details(document_id) ON DELETE RESTRICT;


--
-- Name: vou_sale_return_lines vou_sale_return_lines_document_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vou_sale_return_lines
    ADD CONSTRAINT vou_sale_return_lines_document_id_fkey FOREIGN KEY (document_id) REFERENCES public.vou_sale_return_details(document_id) ON DELETE RESTRICT;


--
-- Name: vou_sale_return_lines vou_sale_return_lines_source_signoff_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vou_sale_return_lines
    ADD CONSTRAINT vou_sale_return_lines_source_signoff_id_fkey FOREIGN KEY (source_signoff_id) REFERENCES public.vou_sale_signoff_details(document_id) ON DELETE RESTRICT;


--
-- Name: vou_sale_return_lines vou_sale_return_lines_source_signoff_line_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vou_sale_return_lines
    ADD CONSTRAINT vou_sale_return_lines_source_signoff_line_id_fkey FOREIGN KEY (source_signoff_line_id) REFERENCES public.vou_sale_signoff_lines(id) ON DELETE RESTRICT;


--
-- Name: vou_sale_signoff_details vou_sale_signoff_details_document_id_entity_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vou_sale_signoff_details
    ADD CONSTRAINT vou_sale_signoff_details_document_id_entity_fkey FOREIGN KEY (document_id, entity) REFERENCES public.vou_documents(id, entity) ON DELETE RESTRICT;


--
-- Name: vou_sale_signoff_details vou_sale_signoff_details_source_delivery_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vou_sale_signoff_details
    ADD CONSTRAINT vou_sale_signoff_details_source_delivery_id_fkey FOREIGN KEY (source_delivery_id) REFERENCES public.vou_sale_delivery_details(document_id) ON DELETE RESTRICT;


--
-- Name: vou_sale_signoff_details vou_sale_signoff_details_source_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vou_sale_signoff_details
    ADD CONSTRAINT vou_sale_signoff_details_source_order_id_fkey FOREIGN KEY (source_order_id) REFERENCES public.vou_sale_order_details(document_id) ON DELETE RESTRICT;


--
-- Name: vou_sale_signoff_details vou_sale_signoff_details_source_outbound_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vou_sale_signoff_details
    ADD CONSTRAINT vou_sale_signoff_details_source_outbound_id_fkey FOREIGN KEY (source_outbound_id) REFERENCES public.vou_sale_outbound_details(document_id) ON DELETE RESTRICT;


--
-- Name: vou_sale_signoff_lines vou_sale_signoff_lines_document_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vou_sale_signoff_lines
    ADD CONSTRAINT vou_sale_signoff_lines_document_id_fkey FOREIGN KEY (document_id) REFERENCES public.vou_sale_signoff_details(document_id) ON DELETE RESTRICT;


--
-- Name: vou_sale_signoff_lines vou_sale_signoff_lines_source_order_line_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vou_sale_signoff_lines
    ADD CONSTRAINT vou_sale_signoff_lines_source_order_line_id_fkey FOREIGN KEY (source_order_line_id) REFERENCES public.vou_product_lines(id) ON DELETE RESTRICT;


--
-- Name: vou_sale_signoff_lines vou_sale_signoff_lines_source_outbound_line_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vou_sale_signoff_lines
    ADD CONSTRAINT vou_sale_signoff_lines_source_outbound_line_id_fkey FOREIGN KEY (source_outbound_line_id) REFERENCES public.vou_sale_outbound_lines(id) ON DELETE RESTRICT;


--
-- Name: vou_service_acceptance_details vou_service_acceptance_details_contract_document_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vou_service_acceptance_details
    ADD CONSTRAINT vou_service_acceptance_details_contract_document_id_fkey FOREIGN KEY (contract_document_id) REFERENCES public.vou_service_contract_details(document_id) ON DELETE RESTRICT;


--
-- Name: vou_service_acceptance_details vou_service_acceptance_details_document_id_entity_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vou_service_acceptance_details
    ADD CONSTRAINT vou_service_acceptance_details_document_id_entity_fkey FOREIGN KEY (document_id, entity) REFERENCES public.vou_documents(id, entity) ON DELETE RESTRICT;


--
-- Name: vou_service_acceptance_details vou_service_acceptance_details_document_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vou_service_acceptance_details
    ADD CONSTRAINT vou_service_acceptance_details_document_id_fkey FOREIGN KEY (document_id) REFERENCES public.vou_documents(id) ON DELETE RESTRICT;


--
-- Name: vou_service_contract_details vou_service_contract_details_document_id_entity_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vou_service_contract_details
    ADD CONSTRAINT vou_service_contract_details_document_id_entity_fkey FOREIGN KEY (document_id, entity) REFERENCES public.vou_documents(id, entity) ON DELETE RESTRICT;


--
-- Name: vou_service_contract_details vou_service_contract_details_document_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vou_service_contract_details
    ADD CONSTRAINT vou_service_contract_details_document_id_fkey FOREIGN KEY (document_id) REFERENCES public.vou_documents(id) ON DELETE RESTRICT;


--
-- Name: wfl_action_executions wfl_action_executions_process_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wfl_action_executions
    ADD CONSTRAINT wfl_action_executions_process_id_fkey FOREIGN KEY (process_id) REFERENCES public.wfl_definition_instances(id) ON DELETE RESTRICT;


--
-- Name: wfl_action_executions wfl_action_executions_source_node_instance_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wfl_action_executions
    ADD CONSTRAINT wfl_action_executions_source_node_instance_id_fkey FOREIGN KEY (source_node_instance_id) REFERENCES public.wfl_node_instances(id) ON DELETE RESTRICT;


--
-- Name: wfl_action_executions wfl_action_executions_target_node_instance_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wfl_action_executions
    ADD CONSTRAINT wfl_action_executions_target_node_instance_id_fkey FOREIGN KEY (target_node_instance_id) REFERENCES public.wfl_node_instances(id) ON DELETE SET NULL;


--
-- Name: wfl_create_child_requests wfl_create_child_requests_action_execution_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wfl_create_child_requests
    ADD CONSTRAINT wfl_create_child_requests_action_execution_id_fkey FOREIGN KEY (action_execution_id) REFERENCES public.wfl_action_executions(id) ON DELETE SET NULL;


--
-- Name: wfl_create_child_requests wfl_create_child_requests_definition_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wfl_create_child_requests
    ADD CONSTRAINT wfl_create_child_requests_definition_id_fkey FOREIGN KEY (definition_id) REFERENCES public.wfl_process_definitions(id) ON DELETE RESTRICT;


--
-- Name: wfl_create_child_requests wfl_create_child_requests_parent_node_instance_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wfl_create_child_requests
    ADD CONSTRAINT wfl_create_child_requests_parent_node_instance_id_fkey FOREIGN KEY (parent_node_instance_id) REFERENCES public.wfl_node_instances(id) ON DELETE RESTRICT;


--
-- Name: wfl_create_child_requests wfl_create_child_requests_process_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wfl_create_child_requests
    ADD CONSTRAINT wfl_create_child_requests_process_id_fkey FOREIGN KEY (process_id) REFERENCES public.wfl_definition_instances(id) ON DELETE RESTRICT;


--
-- Name: wfl_definition_instances wfl_definition_instances_definition_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wfl_definition_instances
    ADD CONSTRAINT wfl_definition_instances_definition_id_fkey FOREIGN KEY (definition_id) REFERENCES public.wfl_process_definitions(id) ON DELETE RESTRICT;


--
-- Name: wfl_definition_instances wfl_definition_instances_root_document_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wfl_definition_instances
    ADD CONSTRAINT wfl_definition_instances_root_document_id_fkey FOREIGN KEY (root_document_id) REFERENCES public.vou_documents(id) ON DELETE SET NULL;


--
-- Name: wfl_definition_instances wfl_definition_instances_approval_entry_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wfl_definition_instances
    ADD CONSTRAINT wfl_definition_instances_approval_entry_id_fkey FOREIGN KEY (definition_approval_entry_id) REFERENCES public.dcl_wfl_process_definition_versions(approval_entry_id) ON DELETE RESTRICT;


--
-- Name: dcl_wfl_process_definition_versions dcl_wfl_process_definition_versions_definition_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dcl_wfl_process_definition_versions
    ADD CONSTRAINT dcl_wfl_process_definition_versions_definition_id_fkey FOREIGN KEY (definition_id) REFERENCES public.wfl_process_definitions(id) ON DELETE CASCADE;


--
--
-- Name: wfl_node_instances wfl_node_instances_document_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wfl_node_instances
    ADD CONSTRAINT wfl_node_instances_document_id_fkey FOREIGN KEY (document_id) REFERENCES public.vou_documents(id) ON DELETE SET NULL;


--
-- Name: wfl_node_instances wfl_node_instances_parent_node_instance_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wfl_node_instances
    ADD CONSTRAINT wfl_node_instances_parent_node_instance_id_fkey FOREIGN KEY (parent_node_instance_id) REFERENCES public.wfl_node_instances(id) ON DELETE SET NULL;


--
-- Name: wfl_node_instances wfl_node_instances_process_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wfl_node_instances
    ADD CONSTRAINT wfl_node_instances_process_id_fkey FOREIGN KEY (process_id) REFERENCES public.wfl_definition_instances(id) ON DELETE RESTRICT;


--
-- PostgreSQL database dump complete
--



-- RPT baseline payloads are trusted system V1 approvals. Central Approval
-- owns the only lifecycle and version header; RPT owns the technical validity.

INSERT INTO public.approval_entries (
    id, domain, entity, subject_id, version_no, status, revision,
    created_by, created_at, updated_by, updated_at,
    submitted_by, submitted_at, approved_by, approved_at
)
SELECT
    payload.approval_entry_id, 'dcl', 'rpt-definition', subject.id, 1, 'APPROVED', 3,
    '01JAPPSYST3MACTR0000000000', payload.created_at,
    '01JAPPSYST3MACTR0000000000', payload.updated_at,
    '00000000000000000000000000', payload.created_at,
    '01JAPPSYST3MACTR0000000000', payload.created_at
FROM public.dcl_rpt_definition_versions AS payload
JOIN public.dcl_subjects AS subject
  ON subject.id = 'RPD' || substr(payload.approval_entry_id, 4)
 AND subject.entity = 'rpt-definition';

ALTER TABLE ONLY public.dcl_rpt_definition_versions
    ADD CONSTRAINT dcl_rpt_definition_versions_approval_entry_id_fkey
    FOREIGN KEY (approval_entry_id) REFERENCES public.approval_entries(id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.rpt_definition_validities
    ADD CONSTRAINT rpt_definition_validities_approval_entry_id_fkey
    FOREIGN KEY (approval_entry_id) REFERENCES public.approval_entries(id) ON DELETE CASCADE;

INSERT INTO public.approval_events (
    id, entry_id, domain, entity, subject_id, version_no, action,
    from_status, to_status, from_revision, to_revision, actor_id, reason, request_id, created_at
)
SELECT substr(md5(payload.approval_entry_id || ':CREATED'), 1, 26), payload.approval_entry_id,
       'dcl', 'rpt-definition', subject.id, 1, 'CREATED',
       NULL, 'DRAFT', NULL, 1, '01JAPPSYST3MACTR0000000000', NULL, 'baseline-rpt-v1', payload.created_at
FROM public.dcl_rpt_definition_versions AS payload
JOIN public.dcl_subjects AS subject
  ON subject.id = 'RPD' || substr(payload.approval_entry_id, 4)
 AND subject.entity = 'rpt-definition'
UNION ALL
SELECT substr(md5(payload.approval_entry_id || ':SUBMITTED'), 1, 26), payload.approval_entry_id,
       'dcl', 'rpt-definition', subject.id, 1, 'SUBMITTED',
       'DRAFT', 'PENDING', 1, 2, '00000000000000000000000000', NULL, 'baseline-rpt-v1', payload.created_at
FROM public.dcl_rpt_definition_versions AS payload
JOIN public.dcl_subjects AS subject
  ON subject.id = 'RPD' || substr(payload.approval_entry_id, 4)
 AND subject.entity = 'rpt-definition'
UNION ALL
SELECT substr(md5(payload.approval_entry_id || ':APPROVED'), 1, 26), payload.approval_entry_id,
       'dcl', 'rpt-definition', subject.id, 1, 'APPROVED',
       'PENDING', 'APPROVED', 2, 3, '01JAPPSYST3MACTR0000000000', NULL, 'baseline-rpt-v1', payload.created_at
FROM public.dcl_rpt_definition_versions AS payload
JOIN public.dcl_subjects AS subject
  ON subject.id = 'RPD' || substr(payload.approval_entry_id, 4)
 AND subject.entity = 'rpt-definition';

-- WFL process definitions are DCL-owned. Baseline seeds use domain='dcl',
-- entity='wfl-process-definition'. They are not enabled and are not treated
-- differently from definitions created through the public service.
INSERT INTO public.dcl_subjects (id, entity, created_at, created_by)
SELECT id, 'wfl-process-definition', created_at, created_by
FROM public.wfl_process_definitions;

INSERT INTO public.approval_entries (
    id, domain, entity, subject_id, version_no, status, revision,
    created_by, created_at, updated_by, updated_at
)
SELECT
    payload.approval_entry_id, 'dcl', 'wfl-process-definition', payload.definition_id, 1, 'DRAFT', 1,
    '01JAPPSYST3MACTR0000000000', payload.created_at,
    '01JAPPSYST3MACTR0000000000', payload.updated_at
FROM public.dcl_wfl_process_definition_versions AS payload;

INSERT INTO public.approval_events (
    id, entry_id, domain, entity, subject_id, version_no, action,
    from_status, to_status, from_revision, to_revision, actor_id, reason, request_id, created_at
)
SELECT substr(md5(payload.approval_entry_id || ':CREATED'), 1, 26), payload.approval_entry_id,
       'dcl', 'wfl-process-definition', payload.definition_id, 1, 'CREATED',
       NULL, 'DRAFT', NULL, 1, '01JAPPSYST3MACTR0000000000', NULL, 'baseline-wfl-v1', payload.created_at
FROM public.dcl_wfl_process_definition_versions AS payload;

ALTER TABLE ONLY public.dcl_wfl_process_definition_versions
    ADD CONSTRAINT dcl_wfl_process_definition_versions_approval_entry_id_fkey
    FOREIGN KEY (approval_entry_id) REFERENCES public.approval_entries(id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.dcl_employee_versions
    ADD CONSTRAINT dcl_employee_versions_approval_entry_id_fkey
    FOREIGN KEY (approval_entry_id) REFERENCES public.approval_entries(id) ON DELETE RESTRICT;
ALTER TABLE ONLY public.dcl_employee_versions
    ADD CONSTRAINT dcl_employee_versions_employee_category_id_fkey
    FOREIGN KEY (employee_category_id) REFERENCES public.aux_objects(id) ON DELETE RESTRICT;
ALTER TABLE ONLY public.dcl_employee_versions
    ADD CONSTRAINT dcl_employee_versions_department_id_fkey
    FOREIGN KEY (department_id) REFERENCES public.aux_objects(id) ON DELETE RESTRICT;
ALTER TABLE ONLY public.dcl_employee_versions
    ADD CONSTRAINT dcl_employee_versions_position_id_fkey
    FOREIGN KEY (position_id) REFERENCES public.aux_objects(id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.dcl_other_unit_versions
    ADD CONSTRAINT dcl_other_unit_versions_approval_entry_id_fkey
    FOREIGN KEY (approval_entry_id) REFERENCES public.approval_entries(id) ON DELETE RESTRICT;
ALTER TABLE ONLY public.dcl_other_unit_versions
    ADD CONSTRAINT dcl_other_unit_versions_settlement_method_id_fkey
    FOREIGN KEY (settlement_method_id) REFERENCES public.aux_objects(id) ON DELETE RESTRICT;
ALTER TABLE ONLY public.dcl_supplier_versions
    ADD CONSTRAINT dcl_supplier_versions_approval_entry_id_fkey
    FOREIGN KEY (approval_entry_id) REFERENCES public.approval_entries(id) ON DELETE RESTRICT;
ALTER TABLE ONLY public.dcl_supplier_versions
    ADD CONSTRAINT dcl_supplier_versions_settlement_method_id_fkey
    FOREIGN KEY (settlement_method_id) REFERENCES public.aux_objects(id) ON DELETE RESTRICT;
ALTER TABLE ONLY public.dcl_supplier_versions
    ADD CONSTRAINT dcl_supplier_versions_default_purchaser_id_fkey
    FOREIGN KEY (default_purchaser_employee_id, default_purchaser_employee_entity) REFERENCES public.dcl_subjects(id, entity) ON DELETE RESTRICT;
ALTER TABLE ONLY public.dcl_supplier_versions
    ADD CONSTRAINT dcl_supplier_versions_default_purchaser_entry_id_fkey
    FOREIGN KEY (default_purchaser_employee_approval_entry_id) REFERENCES public.approval_entries(id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.dcl_customer_versions
    ADD CONSTRAINT dcl_customer_versions_approval_entry_id_fkey
    FOREIGN KEY (approval_entry_id) REFERENCES public.approval_entries(id) ON DELETE RESTRICT;
ALTER TABLE ONLY public.dcl_customer_versions
    ADD CONSTRAINT dcl_customer_versions_operating_entity_entry_id_fkey
    FOREIGN KEY (operating_entity_approval_entry_id) REFERENCES public.approval_entries(id) ON DELETE RESTRICT;
ALTER TABLE ONLY public.dcl_customer_account_versions
    ADD CONSTRAINT dcl_customer_account_versions_approval_entry_id_fkey
    FOREIGN KEY (approval_entry_id) REFERENCES public.approval_entries(id) ON DELETE RESTRICT;
ALTER TABLE ONLY public.dcl_customer_account_versions
    ADD CONSTRAINT dcl_customer_account_versions_settlement_method_id_fkey
    FOREIGN KEY (settlement_method_id) REFERENCES public.aux_objects(id) ON DELETE RESTRICT;
ALTER TABLE ONLY public.dcl_customer_account_versions
    ADD CONSTRAINT dcl_customer_account_versions_payment_method_id_fkey
    FOREIGN KEY (payment_method_id) REFERENCES public.aux_objects(id) ON DELETE RESTRICT;
ALTER TABLE ONLY public.dcl_customer_account_versions
    ADD CONSTRAINT dcl_customer_account_versions_operating_entity_entry_id_fkey
    FOREIGN KEY (operating_entity_approval_entry_id) REFERENCES public.approval_entries(id) ON DELETE RESTRICT;
ALTER TABLE ONLY public.dcl_customer_account_versions
    ADD CONSTRAINT dcl_customer_account_versions_primary_sales_entry_id_fkey
    FOREIGN KEY (primary_sales_subject_approval_entry_id) REFERENCES public.approval_entries(id) ON DELETE RESTRICT;
ALTER TABLE ONLY public.dcl_customer_account_credit_limits
    ADD CONSTRAINT dcl_customer_account_credit_limits_approval_entry_id_fkey
    FOREIGN KEY (approval_entry_id) REFERENCES public.dcl_customer_account_versions(approval_entry_id) ON DELETE RESTRICT;
ALTER TABLE ONLY public.dcl_customer_attachments
    ADD CONSTRAINT dcl_customer_attachments_approval_entry_id_fkey
    FOREIGN KEY (approval_entry_id) REFERENCES public.dcl_customer_versions(approval_entry_id) ON DELETE CASCADE;
ALTER TABLE ONLY public.dcl_customer_attachments
    ADD CONSTRAINT dcl_customer_attachments_file_id_fkey
    FOREIGN KEY (file_id) REFERENCES public.dcl_customer_files(id) ON DELETE RESTRICT;
ALTER TABLE ONLY public.dcl_customer_account_attachments
    ADD CONSTRAINT dcl_customer_account_attachments_approval_entry_id_fkey
    FOREIGN KEY (approval_entry_id) REFERENCES public.dcl_customer_account_versions(approval_entry_id) ON DELETE CASCADE;
ALTER TABLE ONLY public.dcl_customer_account_attachments
    ADD CONSTRAINT dcl_customer_account_attachments_file_id_fkey
    FOREIGN KEY (file_id) REFERENCES public.dcl_customer_files(id) ON DELETE RESTRICT;
ALTER TABLE ONLY public.dcl_sales_partner_versions
    ADD CONSTRAINT dcl_sales_partner_versions_approval_entry_id_fkey
    FOREIGN KEY (approval_entry_id) REFERENCES public.approval_entries(id) ON DELETE RESTRICT;

CREATE INDEX dcl_employee_versions_employee_category_idx
    ON public.dcl_employee_versions USING btree (employee_category_id);
CREATE INDEX dcl_employee_versions_department_idx
    ON public.dcl_employee_versions USING btree (department_id);
CREATE INDEX dcl_employee_versions_position_idx
    ON public.dcl_employee_versions USING btree (position_id);
CREATE INDEX dcl_other_unit_versions_settlement_method_idx
    ON public.dcl_other_unit_versions USING btree (settlement_method_id);
CREATE INDEX dcl_supplier_versions_settlement_method_idx
    ON public.dcl_supplier_versions USING btree (settlement_method_id);
CREATE INDEX dcl_supplier_versions_default_purchaser_idx
    ON public.dcl_supplier_versions USING btree (default_purchaser_employee_id);
CREATE INDEX dcl_customer_account_versions_settlement_method_idx
    ON public.dcl_customer_account_versions USING btree (settlement_method_id);
CREATE INDEX dcl_customer_account_versions_payment_method_idx
    ON public.dcl_customer_account_versions USING btree (payment_method_id);
CREATE INDEX dcl_customer_account_versions_primary_sales_subject_idx
    ON public.dcl_customer_account_versions USING btree (primary_sales_subject_id);
CREATE INDEX dcl_customer_accounts_relationship_idx
    ON public.dcl_customer_accounts USING btree (customer_relationship_id, object_id);
CREATE UNIQUE INDEX dcl_customer_relationships_active_party_operating_key
    ON public.dcl_customer_relationships USING btree (party_id, operating_entity_id) WHERE merged_into_object_id IS NULL;
CREATE UNIQUE INDEX dcl_employment_relationships_active_party_operating_key
    ON public.dcl_employment_relationships USING btree (party_id, operating_entity_id) WHERE merged_into_object_id IS NULL;
CREATE UNIQUE INDEX dcl_supplier_relationships_active_party_operating_key
    ON public.dcl_supplier_relationships USING btree (party_id, operating_entity_id) WHERE merged_into_object_id IS NULL;
CREATE UNIQUE INDEX dcl_service_relationships_active_party_operating_key
    ON public.dcl_service_relationships USING btree (party_id, operating_entity_id) WHERE merged_into_object_id IS NULL;
CREATE UNIQUE INDEX dcl_sales_relationships_active_party_operating_key
    ON public.dcl_sales_relationships USING btree (party_id, operating_entity_id) WHERE merged_into_object_id IS NULL;


GRANT SELECT ON ALL TABLES IN SCHEMA public TO zerp_report_reader;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO zerp_report_reader;
SET search_path = public, pg_catalog;
SELECT rpt_validate_current_reports();

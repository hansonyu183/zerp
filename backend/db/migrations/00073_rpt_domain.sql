-- +goose Up

-- The role is cluster-scoped while migrations are database-scoped. Test and
-- preview clusters legitimately apply this migration to multiple databases.
-- +goose StatementBegin
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='zerp_report_reader') THEN
        CREATE ROLE zerp_report_reader NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
    END IF;
END $$;
-- +goose StatementEnd
GRANT zerp_report_reader TO CURRENT_USER;
GRANT USAGE ON SCHEMA public TO zerp_report_reader;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO zerp_report_reader;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO zerp_report_reader;

CREATE TABLE rpt_definitions (
    id varchar(26) PRIMARY KEY,
    code varchar(64) NOT NULL UNIQUE CHECK (code ~ '^[a-z][a-z0-9-]{1,62}[a-z0-9]$' AND code NOT IN ('definition','directory')),
    name varchar(200) NOT NULL CHECK (btrim(name) <> ''),
    description varchar(1000) NOT NULL DEFAULT '',
    enabled boolean NOT NULL DEFAULT true,
    ever_approved boolean NOT NULL DEFAULT false,
    current_version_id varchar(26),
    next_version_no integer NOT NULL DEFAULT 2 CHECK (next_version_no >= 2),
    revision bigint NOT NULL DEFAULT 1 CHECK (revision >= 1),
    created_at timestamptz NOT NULL DEFAULT now(),
    created_by varchar(26) NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now(),
    updated_by varchar(26) NOT NULL
);

CREATE TABLE rpt_versions (
    id varchar(26) PRIMARY KEY,
    definition_id varchar(26) NOT NULL REFERENCES rpt_definitions(id) ON DELETE CASCADE,
    version_no integer NOT NULL CHECK (version_no >= 1),
    status varchar(16) NOT NULL CHECK (status IN ('DRAFT','APPROVED')),
    validity varchar(16) NOT NULL CHECK (validity IN ('VALID','INVALID')),
    sql_text text NOT NULL CHECK (btrim(sql_text) <> ''),
    parameters jsonb NOT NULL CHECK (jsonb_typeof(parameters)='array'),
    columns jsonb NOT NULL CHECK (jsonb_typeof(columns)='array'),
    revision bigint NOT NULL DEFAULT 1 CHECK (revision >= 1),
    approved_at timestamptz,
    approved_by varchar(26),
    invalidated_at timestamptz,
    invalid_reason varchar(200),
    created_at timestamptz NOT NULL DEFAULT now(),
    created_by varchar(26) NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now(),
    updated_by varchar(26) NOT NULL,
    UNIQUE(definition_id,version_no)
);
ALTER TABLE rpt_definitions ADD CONSTRAINT rpt_definitions_current_version_fk
    FOREIGN KEY(current_version_id) REFERENCES rpt_versions(id) DEFERRABLE INITIALLY DEFERRED;
CREATE UNIQUE INDEX rpt_versions_one_draft_uq ON rpt_versions(definition_id) WHERE status='DRAFT';

CREATE TABLE rpt_audit_events (
    id varchar(26) PRIMARY KEY,
    definition_id varchar(26) REFERENCES rpt_definitions(id) ON DELETE SET NULL,
    report_code varchar(64) NOT NULL,
    version_id varchar(26),
    event_type varchar(32) NOT NULL,
    actor_id varchar(26) NOT NULL,
    request_id varchar(128) NOT NULL,
    occurred_at timestamptz NOT NULL DEFAULT now(),
    summary jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX rpt_audit_events_report_idx ON rpt_audit_events(report_code,occurred_at DESC,id DESC);

-- Every schema migration after this one calls this function as its final
-- statement. Goose runs migrations in a transaction, so a broken current
-- report aborts the same migration and rolls back its schema/data changes.
-- +goose StatementBegin
CREATE FUNCTION rpt_validate_current_reports() RETURNS void AS $$
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
        FROM rpt_definitions d
        JOIN rpt_versions v ON v.id=d.current_version_id
        WHERE d.enabled AND v.validity='VALID'
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
$$ LANGUAGE plpgsql;
-- +goose StatementEnd

INSERT INTO app_permissions(id,path,domain,entity,action,description,status,menu_order) VALUES
('01KRPT00000000000000000001','/rpt/definition/query','rpt','definition','query','查询报表定义','ENABLED',10),
('01KRPT00000000000000000002','/rpt/definition/get','rpt','definition','get','读取报表定义','ENABLED',NULL),
('01KRPT00000000000000000003','/rpt/definition/create','rpt','definition','create','创建报表定义','ENABLED',NULL),
('01KRPT00000000000000000004','/rpt/definition/create-version','rpt','definition','create-version','创建报表版本','ENABLED',NULL),
('01KRPT00000000000000000005','/rpt/definition/save','rpt','definition','save','保存报表版本','ENABLED',NULL),
('01KRPT00000000000000000006','/rpt/definition/approve','rpt','definition','approve','批准报表版本','ENABLED',NULL),
('01KRPT00000000000000000007','/rpt/definition/unapprove','rpt','definition','unapprove','反批准报表版本','ENABLED',NULL),
('01KRPT00000000000000000008','/rpt/definition/enable','rpt','definition','enable','启用报表','ENABLED',NULL),
('01KRPT00000000000000000009','/rpt/definition/disable','rpt','definition','disable','停用报表','ENABLED',NULL),
('01KRPT00000000000000000010','/rpt/definition/delete','rpt','definition','delete','删除未批准报表','ENABLED',NULL);

-- System reports are ordinary approved definitions. They use the same version,
-- permission, validation, execution and export paths as user-created reports.
-- +goose StatementBegin
CREATE FUNCTION rpt_seed_builtin(
    report_code text,
    report_name text,
    report_sql text,
    report_parameters jsonb,
    report_columns jsonb
) RETURNS void AS $$
DECLARE
    definition_id varchar(26) := 'RPD'||substring(md5(report_code),1,23);
    version_id varchar(26) := 'RPV'||substring(md5(report_code),1,23);
    action_name text;
BEGIN
    INSERT INTO rpt_definitions(id,code,name,description,ever_approved,current_version_id,created_by,updated_by)
    VALUES(definition_id,report_code,report_name,'系统预置报表',true,NULL,'SYSTEM','SYSTEM');
    INSERT INTO rpt_versions(id,definition_id,version_no,status,validity,sql_text,parameters,columns,
        approved_at,approved_by,created_by,updated_by)
    VALUES(version_id,definition_id,1,'APPROVED','VALID',report_sql,report_parameters,report_columns,
        now(),'SYSTEM','SYSTEM','SYSTEM');
    UPDATE rpt_definitions SET current_version_id=version_id WHERE id=definition_id;
    FOREACH action_name IN ARRAY ARRAY['query','export'] LOOP
        INSERT INTO app_permissions(id,path,domain,entity,action,description,status)
        VALUES(
            'RPP'||substring(md5('/rpt/'||report_code||'/'||action_name),1,23),
            '/rpt/'||report_code||'/'||action_name,'rpt',report_code,action_name,
            CASE action_name WHEN 'query' THEN '查询' ELSE '导出' END||report_name,'ENABLED'
        );
    END LOOP;
END;
$$ LANGUAGE plpgsql;
-- +goose StatementEnd

SELECT rpt_seed_builtin(
    'account-journal','科目流水',
    $report$
    SELECT b.code::text AS book_code,s.code::text AS subject_code,v.business_date::date AS business_date,
        v.id::text AS voucher_id,v.source_document_no::text AS source_document_no,e.currency::text AS currency,
        CASE WHEN e.debit_minor>0 THEN 'DEBIT' ELSE 'CREDIT' END::text AS direction,
        (greatest(e.debit_minor,e.credit_minor)::numeric/100) AS amount,
        coalesce(v.source_entity,v.source_type)::text AS source_entity,v.source_id::text AS source_document_id
    FROM acc_voucher_lines e
    JOIN acc_vouchers v ON v.id=e.voucher_id
    JOIN acc_books b ON b.id=e.book_id
    JOIN acc_subjects s ON s.id=e.subject_id AND s.book_id=e.book_id
    WHERE ($1::text='' OR b.id=$1) AND ($2::text='' OR s.id=$2)
      AND ($3::text='' OR e.currency=$3) AND v.business_date <@ $4::daterange
    ORDER BY v.business_date,v.id,e.line_order
    $report$,
    $json$[
      {"key":"bookId","name":"会计账簿","type":"REFERENCE","required":false,"defaultValue":"","referenceType":"ACCOUNTING_BOOK"},
      {"key":"subjectId","name":"会计科目","type":"REFERENCE","required":false,"defaultValue":"","referenceType":"ACCOUNT_SUBJECT"},
      {"key":"currency","name":"币种","type":"TEXT","required":false,"defaultValue":""},
      {"key":"dateRange","name":"日期范围","type":"DATE_RANGE","required":false,"defaultValue":["1900-01-01","9999-12-31"]}
    ]$json$,
    $json$[
      {"alias":"book_code","name":"账簿","order":1,"type":"TEXT","width":100,"visible":true},
      {"alias":"subject_code","name":"科目","order":2,"type":"TEXT","width":100,"visible":true},
      {"alias":"business_date","name":"日期","order":3,"type":"DATE","width":110,"visible":true,"format":"date"},
      {"alias":"voucher_id","name":"凭证","order":4,"type":"ID","width":180,"visible":false},
      {"alias":"source_document_no","name":"来源单号","order":5,"type":"TEXT","width":150,"visible":true},
      {"alias":"currency","name":"币种","order":6,"type":"TEXT","width":80,"visible":true},
      {"alias":"direction","name":"方向","order":7,"type":"TEXT","width":80,"visible":true},
      {"alias":"amount","name":"金额","order":8,"type":"DECIMAL","width":120,"visible":true,"format":"money"},
      {"alias":"source_entity","name":"来源类型","order":9,"type":"TEXT","width":130,"visible":true},
      {"alias":"source_document_id","name":"来源单据","order":10,"type":"ID","width":100,"visible":true,"drilldownEntity":"VOU"}
    ]$json$
);

SELECT rpt_seed_builtin(
    'subject-balance','科目余额',
    $report$
    SELECT b.code::text AS book_code,s.code::text AS subject_code,e.currency::text AS currency,
      (sum(CASE WHEN v.business_date<lower($4::daterange) THEN e.debit_minor-e.credit_minor ELSE 0 END)::numeric/100) AS opening_balance,
      (sum(CASE WHEN v.business_date <@ $4::daterange THEN e.debit_minor ELSE 0 END)::numeric/100) AS debit_amount,
      (sum(CASE WHEN v.business_date <@ $4::daterange THEN e.credit_minor ELSE 0 END)::numeric/100) AS credit_amount,
      (sum(CASE WHEN v.business_date<upper($4::daterange) THEN e.debit_minor-e.credit_minor ELSE 0 END)::numeric/100) AS ending_balance,
      (CASE WHEN sum(CASE WHEN v.business_date<upper($4::daterange) THEN e.debit_minor-e.credit_minor ELSE 0 END)>=0 THEN 'DEBIT' ELSE 'CREDIT' END)::text AS balance_direction
    FROM acc_voucher_lines e JOIN acc_vouchers v ON v.id=e.voucher_id
    JOIN acc_books b ON b.id=e.book_id JOIN acc_subjects s ON s.id=e.subject_id AND s.book_id=e.book_id
    WHERE ($1::text='' OR b.id=$1) AND ($2::text='' OR s.id=$2) AND ($3::text='' OR e.currency=$3)
      AND v.business_date<upper($4::daterange)
    GROUP BY b.code,s.code,e.currency ORDER BY b.code,s.code,e.currency
    $report$,
    $json$[
      {"key":"bookId","name":"会计账簿","type":"REFERENCE","required":false,"defaultValue":"","referenceType":"ACCOUNTING_BOOK"},
      {"key":"subjectId","name":"会计科目","type":"REFERENCE","required":false,"defaultValue":"","referenceType":"ACCOUNT_SUBJECT"},
      {"key":"currency","name":"币种","type":"TEXT","required":false,"defaultValue":""},
      {"key":"dateRange","name":"期间","type":"DATE_RANGE","required":false,"defaultValue":["1900-01-01","9999-12-31"]}
    ]$json$,
    $json$[
      {"alias":"book_code","name":"账簿","order":1,"type":"TEXT","width":100,"visible":true},
      {"alias":"subject_code","name":"科目","order":2,"type":"TEXT","width":100,"visible":true},
      {"alias":"currency","name":"币种","order":3,"type":"TEXT","width":80,"visible":true},
      {"alias":"opening_balance","name":"期初余额","order":4,"type":"DECIMAL","width":130,"visible":true,"format":"money"},
      {"alias":"debit_amount","name":"借方发生","order":5,"type":"DECIMAL","width":130,"visible":true,"format":"money"},
      {"alias":"credit_amount","name":"贷方发生","order":6,"type":"DECIMAL","width":130,"visible":true,"format":"money"},
      {"alias":"ending_balance","name":"期末余额","order":7,"type":"DECIMAL","width":130,"visible":true,"format":"money"},
      {"alias":"balance_direction","name":"余额方向","order":8,"type":"TEXT","width":90,"visible":true}
    ]$json$
);

SELECT rpt_seed_builtin(
    'customer-aging','客户应收预收账龄',
    $report$
    WITH facts AS (
      SELECT e.id,e.voucher_id,e.line_order,e.book_id,e.currency,e.dimensions->>'CUSTOMER' AS party_id,v.business_date,
        coalesce(d.due_date,v.business_date) AS due_date,s.settlement_purpose,
        (e.debit_minor-e.credit_minor) AS signed_minor
      FROM acc_voucher_lines e JOIN acc_vouchers v ON v.id=e.voucher_id
      JOIN acc_subjects s ON s.id=e.subject_id AND s.book_id=e.book_id
      LEFT JOIN vou_documents d ON v.source_type='VOU' AND d.id=v.source_id
      WHERE s.settlement_purpose IN ('RECEIVABLE','ADVANCE_RECEIPT') AND e.dimensions ? 'CUSTOMER'
        AND ($1::text='' OR e.book_id=$1) AND ($2::text='' OR e.dimensions->>'CUSTOMER'=$2)
        AND ($3::text='' OR e.currency=$3) AND v.business_date<=$4::date
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
        sum(CASE WHEN r.settlement_purpose='RECEIVABLE' AND r.signed_minor>0 THEN r.signed_minor ELSE 0 END) AS receivable_minor,
        sum(CASE WHEN r.settlement_purpose='ADVANCE_RECEIPT' AND r.signed_minor<0 THEN -r.signed_minor ELSE 0 END) AS advance_minor,
        sum(r.signed_minor) AS net_minor,min(r.due_date) FILTER (WHERE r.residual_minor>0) AS oldest_due_date
      FROM residuals r GROUP BY r.book_id,r.party_id,r.currency HAVING sum(r.signed_minor)<>0
    )
    SELECT b.code::text AS book_code,x.party_id::text AS customer_id,coalesce(p.code,x.party_id)::text AS customer_code,
      coalesce(p.name,x.party_id)::text AS customer_name,x.currency::text AS currency,
      (x.receivable_minor::numeric/100) AS receivable_amount,(x.advance_minor::numeric/100) AS advance_amount,
      (x.net_minor::numeric/100) AS net_amount,(abs(x.net_minor)::numeric/100) AS unsettled_amount,
      greatest(($4::date-x.oldest_due_date)::bigint,0::bigint) AS oldest_age_days
    FROM balances x JOIN acc_books b ON b.id=x.book_id
    LEFT JOIN bob_version_views p ON p.object_id=x.party_id AND p.entity='customer' AND p.version_id=p.effective_version_id
    WHERE greatest(($4::date-x.oldest_due_date)::bigint,0::bigint)>=$5::bigint
    ORDER BY b.code,customer_code,x.currency
    $report$,
    $json$[
      {"key":"bookId","name":"会计账簿","type":"REFERENCE","required":false,"defaultValue":"","referenceType":"ACCOUNTING_BOOK"},
      {"key":"customerId","name":"客户","type":"REFERENCE","required":false,"defaultValue":"","referenceType":"CUSTOMER"},
      {"key":"currency","name":"币种","type":"TEXT","required":false,"defaultValue":""},
      {"key":"asOfDate","name":"截止日","type":"DATE","required":false,"defaultValue":"9999-12-31"},
      {"key":"minAgeDays","name":"最小账龄天数","type":"INTEGER","required":false,"defaultValue":0}
    ]$json$,
    $json$[
      {"alias":"book_code","name":"账簿","order":1,"type":"TEXT","width":100,"visible":true},
      {"alias":"customer_id","name":"客户ID","order":2,"type":"ID","width":180,"visible":false},
      {"alias":"customer_code","name":"客户编码","order":3,"type":"TEXT","width":120,"visible":true},
      {"alias":"customer_name","name":"客户名称","order":4,"type":"TEXT","width":180,"visible":true},
      {"alias":"currency","name":"币种","order":5,"type":"TEXT","width":80,"visible":true},
      {"alias":"receivable_amount","name":"应收原额","order":6,"type":"DECIMAL","width":130,"visible":true,"format":"money"},
      {"alias":"advance_amount","name":"预收原额","order":7,"type":"DECIMAL","width":130,"visible":true,"format":"money"},
      {"alias":"net_amount","name":"净额","order":8,"type":"DECIMAL","width":130,"visible":true,"format":"money"},
      {"alias":"unsettled_amount","name":"未结金额","order":9,"type":"DECIMAL","width":130,"visible":true,"format":"money"},
      {"alias":"oldest_age_days","name":"最长账龄天数","order":10,"type":"INTEGER","width":120,"visible":true}
    ]$json$
);

SELECT rpt_seed_builtin(
    'supplier-aging','供应商应付预付账龄',
    $report$
    WITH facts AS (
      SELECT e.id,e.voucher_id,e.line_order,e.book_id,e.currency,e.dimensions->>'SUPPLIER' AS party_id,v.business_date,
        coalesce(d.due_date,v.business_date) AS due_date,s.settlement_purpose,
        (e.credit_minor-e.debit_minor) AS signed_minor
      FROM acc_voucher_lines e JOIN acc_vouchers v ON v.id=e.voucher_id
      JOIN acc_subjects s ON s.id=e.subject_id AND s.book_id=e.book_id
      LEFT JOIN vou_documents d ON v.source_type='VOU' AND d.id=v.source_id
      WHERE s.settlement_purpose IN ('PAYABLE','PREPAID') AND e.dimensions ? 'SUPPLIER'
        AND ($1::text='' OR e.book_id=$1) AND ($2::text='' OR e.dimensions->>'SUPPLIER'=$2)
        AND ($3::text='' OR e.currency=$3) AND v.business_date<=$4::date
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
        sum(CASE WHEN r.settlement_purpose='PAYABLE' AND r.signed_minor>0 THEN r.signed_minor ELSE 0 END) AS payable_minor,
        sum(CASE WHEN r.settlement_purpose='PREPAID' AND r.signed_minor<0 THEN -r.signed_minor ELSE 0 END) AS advance_minor,
        sum(r.signed_minor) AS net_minor,min(r.due_date) FILTER (WHERE r.residual_minor>0) AS oldest_due_date
      FROM residuals r GROUP BY r.book_id,r.party_id,r.currency HAVING sum(r.signed_minor)<>0
    )
    SELECT b.code::text AS book_code,x.party_id::text AS supplier_id,coalesce(p.code,x.party_id)::text AS supplier_code,
      coalesce(p.name,x.party_id)::text AS supplier_name,x.currency::text AS currency,
      (x.payable_minor::numeric/100) AS payable_amount,(x.advance_minor::numeric/100) AS advance_amount,
      (x.net_minor::numeric/100) AS net_amount,(abs(x.net_minor)::numeric/100) AS unsettled_amount,
      greatest(($4::date-x.oldest_due_date)::bigint,0::bigint) AS oldest_age_days
    FROM balances x JOIN acc_books b ON b.id=x.book_id
    LEFT JOIN bob_version_views p ON p.object_id=x.party_id AND p.entity='supplier' AND p.version_id=p.effective_version_id
    WHERE greatest(($4::date-x.oldest_due_date)::bigint,0::bigint)>=$5::bigint
    ORDER BY b.code,supplier_code,x.currency
    $report$,
    $json$[
      {"key":"bookId","name":"会计账簿","type":"REFERENCE","required":false,"defaultValue":"","referenceType":"ACCOUNTING_BOOK"},
      {"key":"supplierId","name":"供应商","type":"REFERENCE","required":false,"defaultValue":"","referenceType":"SUPPLIER"},
      {"key":"currency","name":"币种","type":"TEXT","required":false,"defaultValue":""},
      {"key":"asOfDate","name":"截止日","type":"DATE","required":false,"defaultValue":"9999-12-31"},
      {"key":"minAgeDays","name":"最小账龄天数","type":"INTEGER","required":false,"defaultValue":0}
    ]$json$,
    $json$[
      {"alias":"book_code","name":"账簿","order":1,"type":"TEXT","width":100,"visible":true},
      {"alias":"supplier_id","name":"供应商ID","order":2,"type":"ID","width":180,"visible":false},
      {"alias":"supplier_code","name":"供应商编码","order":3,"type":"TEXT","width":120,"visible":true},
      {"alias":"supplier_name","name":"供应商名称","order":4,"type":"TEXT","width":180,"visible":true},
      {"alias":"currency","name":"币种","order":5,"type":"TEXT","width":80,"visible":true},
      {"alias":"payable_amount","name":"应付原额","order":6,"type":"DECIMAL","width":130,"visible":true,"format":"money"},
      {"alias":"advance_amount","name":"预付原额","order":7,"type":"DECIMAL","width":130,"visible":true,"format":"money"},
      {"alias":"net_amount","name":"净额","order":8,"type":"DECIMAL","width":130,"visible":true,"format":"money"},
      {"alias":"unsettled_amount","name":"未结金额","order":9,"type":"DECIMAL","width":130,"visible":true,"format":"money"},
      {"alias":"oldest_age_days","name":"最长账龄天数","order":10,"type":"INTEGER","width":120,"visible":true}
    ]$json$
);

SELECT rpt_seed_builtin(
    'inventory-movement','库存收发存',
    $report$
    SELECT b.code::text AS book_code,s.code::text AS subject_code,i.warehouse_id::text AS warehouse_id,
      i.product_id::text AS product_id,
      (sum(CASE WHEN i.business_date<date_trunc('month',$5::date)::date THEN i.quantity_delta_micros ELSE 0 END)::numeric/1000000) AS opening_quantity,
      (sum(CASE WHEN i.business_date>=date_trunc('month',$5::date)::date AND i.business_date<=$5::date AND i.quantity_delta_micros>0 THEN i.quantity_delta_micros ELSE 0 END)::numeric/1000000) AS inbound_quantity,
      (sum(CASE WHEN i.business_date>=date_trunc('month',$5::date)::date AND i.business_date<=$5::date AND i.quantity_delta_micros<0 THEN -i.quantity_delta_micros ELSE 0 END)::numeric/1000000) AS outbound_quantity,
      (sum(CASE WHEN i.business_date<=$5::date THEN i.quantity_delta_micros ELSE 0 END)::numeric/1000000) AS ending_quantity,
      CASE WHEN sum(CASE WHEN i.business_date<=$5::date THEN i.quantity_delta_micros ELSE 0 END)=0 THEN NULL
        ELSE (sum(CASE WHEN i.business_date<=$5::date THEN CASE WHEN i.quantity_delta_micros>0 THEN greatest(vl.debit_minor,vl.credit_minor) ELSE -coalesce(c.cost_minor,0) END ELSE 0 END)::numeric/100)
          /(sum(CASE WHEN i.business_date<=$5::date THEN i.quantity_delta_micros ELSE 0 END)::numeric/1000000) END AS average_unit_cost,
      (sum(CASE WHEN i.business_date<=$5::date THEN CASE WHEN i.quantity_delta_micros>0 THEN greatest(vl.debit_minor,vl.credit_minor) ELSE -coalesce(c.cost_minor,0) END ELSE 0 END)::numeric/100) AS ending_amount,
      CASE WHEN count(DISTINCT v.source_id)=1 THEN min(coalesce(v.source_entity,v.source_type)) ELSE '' END::text AS source_entity,
      CASE WHEN count(DISTINCT v.source_id)=1 THEN min(v.source_id) ELSE '' END::text AS source_document_id
    FROM acc_inventory_entries i JOIN acc_books b ON b.id=i.book_id
    JOIN acc_subjects s ON s.id=i.subject_id AND s.book_id=i.book_id
    JOIN acc_voucher_lines vl ON vl.id=i.voucher_line_id
    JOIN acc_vouchers v ON v.id=i.voucher_id
    LEFT JOIN acc_inventory_cost_allocations c ON c.entry_id=i.id
    WHERE ($1::text='' OR i.book_id=$1) AND ($2::text='' OR i.subject_id=$2)
      AND ($3::text='' OR i.warehouse_id=$3) AND ($4::text='' OR i.product_id=$4) AND i.business_date<=$5::date
    GROUP BY b.code,s.code,i.warehouse_id,i.product_id ORDER BY b.code,s.code,i.warehouse_id,i.product_id
    $report$,
    $json$[
      {"key":"bookId","name":"会计账簿","type":"REFERENCE","required":false,"defaultValue":"","referenceType":"ACCOUNTING_BOOK"},
      {"key":"subjectId","name":"库存科目","type":"REFERENCE","required":false,"defaultValue":"","referenceType":"ACCOUNT_SUBJECT"},
      {"key":"warehouseId","name":"仓库","type":"REFERENCE","required":false,"defaultValue":"","referenceType":"WAREHOUSE"},
      {"key":"productId","name":"产品","type":"REFERENCE","required":false,"defaultValue":"","referenceType":"PRODUCT"},
      {"key":"asOfDate","name":"截止日","type":"DATE","required":false,"defaultValue":"9999-12-31"}
    ]$json$,
    $json$[
      {"alias":"book_code","name":"账簿","order":1,"type":"TEXT","width":100,"visible":true},
      {"alias":"subject_code","name":"库存科目","order":2,"type":"TEXT","width":100,"visible":true},
      {"alias":"warehouse_id","name":"仓库","order":3,"type":"ID","width":180,"visible":true},
      {"alias":"product_id","name":"产品","order":4,"type":"ID","width":180,"visible":true},
      {"alias":"opening_quantity","name":"期初数量","order":5,"type":"DECIMAL","width":120,"visible":true,"format":"quantity"},
      {"alias":"inbound_quantity","name":"入库数量","order":6,"type":"DECIMAL","width":120,"visible":true,"format":"quantity"},
      {"alias":"outbound_quantity","name":"出库数量","order":7,"type":"DECIMAL","width":120,"visible":true,"format":"quantity"},
      {"alias":"ending_quantity","name":"期末数量","order":8,"type":"DECIMAL","width":120,"visible":true,"format":"quantity"},
      {"alias":"average_unit_cost","name":"移动平均单价","order":9,"type":"DECIMAL","width":140,"visible":true,"format":"money"},
      {"alias":"ending_amount","name":"期末金额","order":10,"type":"DECIMAL","width":130,"visible":true,"format":"money"},
      {"alias":"source_entity","name":"来源类型","order":11,"type":"TEXT","width":130,"visible":false},
      {"alias":"source_document_id","name":"来源单据","order":12,"type":"ID","width":100,"visible":true,"drilldownEntity":"VOU"}
    ]$json$
);

SELECT rpt_seed_builtin(
    'bills','票据',
    $report$
    SELECT book.code::text AS book_code,bill.id::text AS bill_id,bill.bill_no::text AS bill_no,
      CASE WHEN settled.business_date IS NOT NULL AND settled.business_date<=$6::date THEN 'SETTLED' ELSE 'AVAILABLE' END::text AS business_status,
      bill.position_type::text AS position_type,bill.currency::text AS currency,
      (bill.face_amount_minor::numeric/100) AS original_amount,
      (value.value_minor::numeric/100) AS carrying_amount,bill.maturity_date::date AS maturity_date,
      coalesce(bill.origin_party_object_id,'')::text AS party_id,
      coalesce(source.entity,'OPENING')::text AS source_entity,bill.source_document_id::text AS source_document_id
    FROM acc_bills bill
    JOIN acc_bill_book_values value ON value.bill_id=bill.id
    JOIN acc_books book ON book.id=value.book_id
    LEFT JOIN vou_documents source ON source.id=bill.source_document_id
    LEFT JOIN vou_documents settled ON settled.id=bill.settled_by_document_id
    WHERE ($1::text='' OR value.book_id=$1) AND ($2::text='' OR bill.id=$2)
      AND ($3::text='' OR bill.origin_party_object_id=$3)
      AND ($4::text='' OR CASE WHEN settled.business_date IS NOT NULL AND settled.business_date<=$6::date THEN 'SETTLED' ELSE 'AVAILABLE' END=$4)
      AND bill.maturity_date <@ $5::daterange AND bill.issue_date<=$6::date
    ORDER BY book.code,bill.bill_no,bill.id
    $report$,
    $json$[
      {"key":"bookId","name":"会计账簿","type":"REFERENCE","required":false,"defaultValue":"","referenceType":"ACCOUNTING_BOOK"},
      {"key":"billId","name":"票据","type":"REFERENCE","required":false,"defaultValue":"","referenceType":"BILL"},
      {"key":"partyId","name":"往来方","type":"REFERENCE","required":false,"defaultValue":"","referenceType":"OTHER_PARTY"},
      {"key":"status","name":"状态","type":"ENUM","required":false,"defaultValue":"","enumValues":["","AVAILABLE","SETTLED"]},
      {"key":"maturityRange","name":"到期日范围","type":"DATE_RANGE","required":false,"defaultValue":["1900-01-01","9999-12-31"]},
      {"key":"asOfDate","name":"截止日","type":"DATE","required":false,"defaultValue":"9999-12-31"}
    ]$json$,
    $json$[
      {"alias":"book_code","name":"账簿","order":1,"type":"TEXT","width":100,"visible":true},
      {"alias":"bill_id","name":"票据ID","order":2,"type":"ID","width":180,"visible":false},
      {"alias":"bill_no","name":"票据号","order":3,"type":"TEXT","width":160,"visible":true},
      {"alias":"business_status","name":"业务状态","order":4,"type":"TEXT","width":110,"visible":true},
      {"alias":"position_type","name":"账簿方向","order":5,"type":"TEXT","width":100,"visible":true},
      {"alias":"currency","name":"币种","order":6,"type":"TEXT","width":80,"visible":true},
      {"alias":"original_amount","name":"原值","order":7,"type":"DECIMAL","width":130,"visible":true,"format":"money"},
      {"alias":"carrying_amount","name":"账面金额","order":8,"type":"DECIMAL","width":130,"visible":true,"format":"money"},
      {"alias":"maturity_date","name":"到期日","order":9,"type":"DATE","width":110,"visible":true,"format":"date"},
      {"alias":"party_id","name":"往来方","order":10,"type":"ID","width":180,"visible":false},
      {"alias":"source_entity","name":"来源类型","order":11,"type":"TEXT","width":130,"visible":false},
      {"alias":"source_document_id","name":"来源单据","order":12,"type":"ID","width":100,"visible":true,"drilldownEntity":"VOU"}
    ]$json$
);

SELECT rpt_seed_builtin(
    'containers','空桶',
    $report$
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
      WHERE ($1::text='' OR book.id=$1) AND ($2::text='' OR e.customer_id=$2)
        AND ($3::text='' OR e.container_type=$3)
        AND coalesce(source.business_date,book.start_month)<=$4::date
    ), movements AS (
      SELECT book_id,code,customer_id,container_type,
        sum(CASE WHEN business_date<date_trunc('month',$4::date)::date THEN quantity_delta ELSE 0 END) AS opening_quantity,
        sum(CASE WHEN business_date>=date_trunc('month',$4::date)::date AND quantity_delta>0 THEN quantity_delta ELSE 0 END) AS issued_quantity,
        sum(CASE WHEN business_date>=date_trunc('month',$4::date)::date AND quantity_delta<0 THEN -quantity_delta ELSE 0 END) AS returned_quantity,
        0::bigint AS adjusted_quantity,sum(quantity_delta) AS balance_quantity
      FROM facts GROUP BY book_id,code,customer_id,container_type
    )
    SELECT m.code::text AS book_code,m.customer_id::text AS customer_id,
      coalesce(customer.code,m.customer_id)::text AS customer_code,
      coalesce(customer.name,m.customer_id)::text AS customer_name,m.container_type::text AS container_type,
      m.opening_quantity::numeric AS opening_quantity,m.issued_quantity::numeric AS issued_quantity,
      m.returned_quantity::numeric AS returned_quantity,m.adjusted_quantity::numeric AS adjusted_quantity,
      m.balance_quantity::numeric AS balance_quantity,NULL::numeric AS amount
    FROM movements m
    LEFT JOIN bob_version_views customer ON customer.object_id=m.customer_id AND customer.entity='customer'
      AND customer.version_id=customer.effective_version_id
    ORDER BY m.code,customer_code,m.container_type
    $report$,
    $json$[
      {"key":"bookId","name":"会计账簿","type":"REFERENCE","required":false,"defaultValue":"","referenceType":"ACCOUNTING_BOOK"},
      {"key":"customerId","name":"客户","type":"REFERENCE","required":false,"defaultValue":"","referenceType":"CUSTOMER"},
      {"key":"containerType","name":"桶型","type":"ENUM","required":false,"defaultValue":"","enumValues":["","SOLVENT","RESIN"]},
      {"key":"asOfDate","name":"截止日","type":"DATE","required":false,"defaultValue":"9999-12-31"}
    ]$json$,
    $json$[
      {"alias":"book_code","name":"账簿","order":1,"type":"TEXT","width":100,"visible":true},
      {"alias":"customer_id","name":"客户ID","order":2,"type":"ID","width":180,"visible":false},
      {"alias":"customer_code","name":"客户编码","order":3,"type":"TEXT","width":120,"visible":true},
      {"alias":"customer_name","name":"客户名称","order":4,"type":"TEXT","width":180,"visible":true},
      {"alias":"container_type","name":"桶型","order":5,"type":"TEXT","width":100,"visible":true},
      {"alias":"opening_quantity","name":"期初","order":6,"type":"DECIMAL","width":110,"visible":true,"format":"quantity"},
      {"alias":"issued_quantity","name":"发出","order":7,"type":"DECIMAL","width":110,"visible":true,"format":"quantity"},
      {"alias":"returned_quantity","name":"收回","order":8,"type":"DECIMAL","width":110,"visible":true,"format":"quantity"},
      {"alias":"adjusted_quantity","name":"调整","order":9,"type":"DECIMAL","width":110,"visible":true,"format":"quantity"},
      {"alias":"balance_quantity","name":"欠桶余额","order":10,"type":"DECIMAL","width":120,"visible":true,"format":"quantity"},
      {"alias":"amount","name":"核算金额","order":11,"type":"DECIMAL","width":130,"visible":true,"format":"money"}
    ]$json$
);

SELECT rpt_seed_builtin(
    'employee-loans','员工借款',
    $report$
    WITH facts AS (
      SELECT e.id,e.voucher_id,e.line_order,e.book_id,e.currency,e.dimensions->>'EMPLOYEE' AS employee_id,v.business_date,v.source_entity,
        (e.debit_minor-e.credit_minor) AS signed_minor
      FROM acc_voucher_lines e JOIN acc_vouchers v ON v.id=e.voucher_id
      WHERE e.dimensions ? 'EMPLOYEE' AND v.source_entity IN ('employee-loan','employee-repayment','employee-loan-writeoff')
        AND ($1::text='' OR e.book_id=$1) AND ($2::text='' OR e.dimensions->>'EMPLOYEE'=$2)
        AND ($3::text='' OR e.currency=$3) AND v.business_date<=$4::date
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
        sum(CASE WHEN r.source_entity='employee-loan' AND r.signed_minor>0 THEN r.signed_minor ELSE 0 END) AS loan_minor,
        sum(CASE WHEN r.source_entity='employee-repayment' THEN abs(r.signed_minor) ELSE 0 END) AS repayment_minor,
        sum(CASE WHEN r.source_entity='employee-loan-writeoff' THEN abs(r.signed_minor) ELSE 0 END) AS writeoff_minor,
        sum(r.signed_minor) AS balance_minor,min(r.business_date) FILTER (WHERE r.residual_minor>0) AS oldest_date
      FROM residuals r GROUP BY r.book_id,r.employee_id,r.currency HAVING sum(r.signed_minor)<>0
    )
    SELECT b.code::text AS book_code,x.employee_id::text AS employee_id,coalesce(p.code,x.employee_id)::text AS employee_code,
      coalesce(p.name,x.employee_id)::text AS employee_name,x.currency::text AS currency,
      (x.loan_minor::numeric/100) AS loan_amount,(x.repayment_minor::numeric/100) AS repayment_amount,
      (x.writeoff_minor::numeric/100) AS writeoff_amount,(x.balance_minor::numeric/100) AS balance,
      (abs(x.balance_minor)::numeric/100) AS unsettled_amount,greatest(($4::date-x.oldest_date)::bigint,0::bigint) AS oldest_age_days,
      (CASE WHEN x.balance_minor<0 THEN 'PAYABLE_TO_EMPLOYEE' ELSE 'RECEIVABLE_FROM_EMPLOYEE' END)::text AS balance_meaning
    FROM balances x JOIN acc_books b ON b.id=x.book_id
    LEFT JOIN bob_version_views p ON p.object_id=x.employee_id AND p.entity='employee' AND p.version_id=p.effective_version_id
    ORDER BY b.code,employee_code,x.currency
    $report$,
    $json$[
      {"key":"bookId","name":"会计账簿","type":"REFERENCE","required":false,"defaultValue":"","referenceType":"ACCOUNTING_BOOK"},
      {"key":"employeeId","name":"员工","type":"REFERENCE","required":false,"defaultValue":"","referenceType":"EMPLOYEE"},
      {"key":"currency","name":"币种","type":"TEXT","required":false,"defaultValue":""},
      {"key":"asOfDate","name":"截止日","type":"DATE","required":false,"defaultValue":"9999-12-31"}
    ]$json$,
    $json$[
      {"alias":"book_code","name":"账簿","order":1,"type":"TEXT","width":100,"visible":true},
      {"alias":"employee_id","name":"员工ID","order":2,"type":"ID","width":180,"visible":false},
      {"alias":"employee_code","name":"员工编码","order":3,"type":"TEXT","width":120,"visible":true},
      {"alias":"employee_name","name":"员工姓名","order":4,"type":"TEXT","width":150,"visible":true},
      {"alias":"currency","name":"币种","order":5,"type":"TEXT","width":80,"visible":true},
      {"alias":"loan_amount","name":"借款","order":6,"type":"DECIMAL","width":120,"visible":true,"format":"money"},
      {"alias":"repayment_amount","name":"还款","order":7,"type":"DECIMAL","width":120,"visible":true,"format":"money"},
      {"alias":"writeoff_amount","name":"费用核销","order":8,"type":"DECIMAL","width":120,"visible":true,"format":"money"},
      {"alias":"balance","name":"余额","order":9,"type":"DECIMAL","width":120,"visible":true,"format":"money"},
      {"alias":"unsettled_amount","name":"未结金额","order":10,"type":"DECIMAL","width":120,"visible":true,"format":"money"},
      {"alias":"oldest_age_days","name":"最长账龄天数","order":11,"type":"INTEGER","width":120,"visible":true},
      {"alias":"balance_meaning","name":"余额含义","order":12,"type":"TEXT","width":170,"visible":true}
    ]$json$
);

DROP FUNCTION rpt_seed_builtin(text,text,text,jsonb,jsonb);

SELECT rpt_validate_current_reports();

-- +goose Down
DROP TABLE rpt_audit_events;
DROP FUNCTION rpt_validate_current_reports();
ALTER TABLE rpt_definitions DROP CONSTRAINT rpt_definitions_current_version_fk;
DROP TABLE rpt_versions;
DROP TABLE rpt_definitions;
DELETE FROM app_role_permissions WHERE permission_id IN (SELECT id FROM app_permissions WHERE domain='rpt');
DELETE FROM app_permissions WHERE domain='rpt';

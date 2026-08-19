-- +goose Up

ALTER TABLE bob_objects
    DROP CONSTRAINT bob_objects_entity_check,
    ADD CONSTRAINT bob_objects_entity_check CHECK (entity IN (
        'customer','supplier','other-party','employee','product','service','warehouse',
        'vehicle','fund-account','category','department','position','settlement-method',
        'operating-entity'
    ));

CREATE TABLE bob_operating_entity_versions (
    version_id varchar(26) PRIMARY KEY,
    entity varchar(32) NOT NULL DEFAULT 'operating-entity' CHECK (entity='operating-entity'),
    legal_name varchar(200) NOT NULL CHECK (length(btrim(legal_name)) BETWEEN 1 AND 200),
    short_name varchar(100),
    tax_number varchar(100),
    address varchar(500),
    phone varchar(100),
    remark varchar(1000),
    FOREIGN KEY(version_id,entity) REFERENCES bob_versions(id,entity)
        ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED
);
CREATE INDEX bob_operating_entity_versions_tax_idx
    ON bob_operating_entity_versions(upper(btrim(tax_number)))
    WHERE tax_number IS NOT NULL AND btrim(tax_number)<>'';

CREATE TABLE bob_customer_groups (
    id varchar(26) PRIMARY KEY,
    code varchar(16) NOT NULL UNIQUE CHECK (code ~ '^CGR-[0-9]{4}$'),
    company_name varchar(200) NOT NULL CHECK (length(btrim(company_name)) BETWEEN 1 AND 200),
    short_name varchar(100),
    tax_number varchar(100),
    invoice_title varchar(200),
    invoice_address varchar(500),
    invoice_phone varchar(100),
    revision bigint NOT NULL DEFAULT 1 CHECK (revision>=1),
    created_at timestamptz NOT NULL DEFAULT now(),
    created_by varchar(26) NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now(),
    updated_by varchar(26) NOT NULL
);
CREATE UNIQUE INDEX bob_customer_groups_tax_uq
    ON bob_customer_groups(upper(btrim(tax_number)))
    WHERE tax_number IS NOT NULL AND btrim(tax_number)<>'';

CREATE TABLE bob_customer_group_bank_accounts (
    group_id varchar(26) NOT NULL REFERENCES bob_customer_groups(id) ON DELETE RESTRICT,
    line_no integer NOT NULL CHECK (line_no>=1),
    account_name varchar(200) NOT NULL,
    bank_name varchar(200) NOT NULL,
    bank_branch varchar(200) NOT NULL DEFAULT '',
    account_number varchar(100) NOT NULL,
    PRIMARY KEY(group_id,line_no)
);

CREATE TABLE bob_customer_group_audit_events (
    id varchar(26) PRIMARY KEY,
    group_id varchar(26) NOT NULL REFERENCES bob_customer_groups(id) ON DELETE RESTRICT,
    event_type varchar(16) NOT NULL CHECK (event_type IN ('CREATED','SAVED','ATTACHED','DETACHED')),
    actor_id varchar(26) NOT NULL,
    occurred_at timestamptz NOT NULL DEFAULT now(),
    request_id varchar(128) NOT NULL,
    summary jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(summary)='object')
);
CREATE INDEX bob_customer_group_audit_history_idx
    ON bob_customer_group_audit_events(group_id,occurred_at DESC,id DESC);

-- Customer document categories are ordinary AUX dictionary entries.  The
-- relation tables below snapshot the selected entry so later renames or
-- disablement never rewrite historical customer files.
WITH seed(entity, object_id, version_id, code, data) AS (
    VALUES
        ('dictionary-type', '01JCDT00000000000000000001', '01JCDT00000000000000000002',
         'DCT-0003', '{"name":"客户资料类别","description":"客户集团与结算子账户附件分类"}'::jsonb),
        ('dictionary-item', '01JCDT00000000000000000003', '01JCDT00000000000000000004',
         'DIT-0004', '{"name":"营业执照","dictionaryTypeCode":"DCT-0003","sortOrder":10}'::jsonb),
        ('dictionary-item', '01JCDT00000000000000000005', '01JCDT00000000000000000006',
         'DIT-0005', '{"name":"税务资料","dictionaryTypeCode":"DCT-0003","sortOrder":20}'::jsonb),
        ('dictionary-item', '01JCDT00000000000000000007', '01JCDT00000000000000000008',
         'DIT-0006', '{"name":"开票资料","dictionaryTypeCode":"DCT-0003","sortOrder":30}'::jsonb),
        ('dictionary-item', '01JCDT00000000000000000009', '01JCDT00000000000000000010',
         'DIT-0007', '{"name":"合同","dictionaryTypeCode":"DCT-0003","sortOrder":40}'::jsonb),
        ('dictionary-item', '01JCDT00000000000000000011', '01JCDT00000000000000000012',
         'DIT-0008', '{"name":"价格约定","dictionaryTypeCode":"DCT-0003","sortOrder":50}'::jsonb),
        ('dictionary-item', '01JCDT00000000000000000013', '01JCDT00000000000000000014',
         'DIT-0009', '{"name":"交付约定","dictionaryTypeCode":"DCT-0003","sortOrder":60}'::jsonb),
        ('dictionary-item', '01JCDT00000000000000000015', '01JCDT00000000000000000016',
         'DIT-0010', '{"name":"其他","dictionaryTypeCode":"DCT-0003","sortOrder":70}'::jsonb)
)
INSERT INTO aux_objects(id,entity,code,current_version_id,enabled,next_version_no,revision,created_by,updated_by)
SELECT object_id,entity,code,version_id,true,2,1,'00000000000000000000000000','00000000000000000000000000'
FROM seed;

WITH seed(entity, object_id, version_id, data) AS (
    VALUES
        ('dictionary-type', '01JCDT00000000000000000001', '01JCDT00000000000000000002',
         '{"name":"客户资料类别","description":"客户集团与结算子账户附件分类"}'::jsonb),
        ('dictionary-item', '01JCDT00000000000000000003', '01JCDT00000000000000000004',
         '{"name":"营业执照","dictionaryTypeCode":"DCT-0003","sortOrder":10}'::jsonb),
        ('dictionary-item', '01JCDT00000000000000000005', '01JCDT00000000000000000006',
         '{"name":"税务资料","dictionaryTypeCode":"DCT-0003","sortOrder":20}'::jsonb),
        ('dictionary-item', '01JCDT00000000000000000007', '01JCDT00000000000000000008',
         '{"name":"开票资料","dictionaryTypeCode":"DCT-0003","sortOrder":30}'::jsonb),
        ('dictionary-item', '01JCDT00000000000000000009', '01JCDT00000000000000000010',
         '{"name":"合同","dictionaryTypeCode":"DCT-0003","sortOrder":40}'::jsonb),
        ('dictionary-item', '01JCDT00000000000000000011', '01JCDT00000000000000000012',
         '{"name":"价格约定","dictionaryTypeCode":"DCT-0003","sortOrder":50}'::jsonb),
        ('dictionary-item', '01JCDT00000000000000000013', '01JCDT00000000000000000014',
         '{"name":"交付约定","dictionaryTypeCode":"DCT-0003","sortOrder":60}'::jsonb),
        ('dictionary-item', '01JCDT00000000000000000015', '01JCDT00000000000000000016',
         '{"name":"其他","dictionaryTypeCode":"DCT-0003","sortOrder":70}'::jsonb)
)
INSERT INTO aux_versions(id,object_id,entity,version_no,data,created_by)
SELECT version_id,object_id,entity,1,data,'00000000000000000000000000' FROM seed;

INSERT INTO object_number_counters(domain,entity,last_value)
VALUES ('aux','dictionary-type',3),('aux','dictionary-item',10)
ON CONFLICT(domain,entity) DO UPDATE
SET last_value=GREATEST(object_number_counters.last_value,EXCLUDED.last_value);

CREATE TABLE bob_customer_files (
    id varchar(26) PRIMARY KEY,
    storage_key varchar(255) NOT NULL UNIQUE,
    original_name varchar(255) NOT NULL,
    content_type varchar(32) NOT NULL CHECK (content_type IN ('application/pdf','image/jpeg','image/png')),
    declared_size bigint NOT NULL CHECK (declared_size BETWEEN 1 AND 10485760),
    sha256_hex char(64) NOT NULL CHECK (sha256_hex ~ '^[0-9a-f]{64}$'),
    status varchar(16) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','READY')),
    upload_token_hash char(64) NOT NULL UNIQUE CHECK (upload_token_hash ~ '^[0-9a-f]{64}$'),
    upload_expires_at timestamptz NOT NULL,
    stored_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    created_by varchar(26) NOT NULL,
    CONSTRAINT bob_customer_files_status_ck CHECK (
        (status='PENDING' AND stored_at IS NULL) OR (status='READY' AND stored_at IS NOT NULL)
    )
);
CREATE INDEX bob_customer_files_pending_idx ON bob_customer_files(upload_expires_at) WHERE status='PENDING';

CREATE TABLE bob_customer_group_attachments (
    group_id varchar(26) NOT NULL REFERENCES bob_customer_groups(id) ON DELETE RESTRICT,
    file_id varchar(26) NOT NULL UNIQUE REFERENCES bob_customer_files(id) ON DELETE RESTRICT,
    category_object_id varchar(26) NOT NULL,
    category_version_id varchar(26) NOT NULL,
    category_code varchar(16) NOT NULL,
    category_name varchar(100) NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    created_by varchar(26) NOT NULL,
    PRIMARY KEY(group_id,file_id)
);

CREATE TABLE bob_customer_version_attachments (
    version_id varchar(26) NOT NULL REFERENCES bob_versions(id) ON DELETE CASCADE,
    file_id varchar(26) NOT NULL REFERENCES bob_customer_files(id) ON DELETE RESTRICT,
    category_object_id varchar(26) NOT NULL,
    category_version_id varchar(26) NOT NULL,
    category_code varchar(16) NOT NULL,
    category_name varchar(100) NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    created_by varchar(26) NOT NULL,
    PRIMARY KEY(version_id,file_id)
);

CREATE TABLE bob_customer_download_tokens (
    token_hash char(64) PRIMARY KEY CHECK (token_hash ~ '^[0-9a-f]{64}$'),
    file_id varchar(26) NOT NULL REFERENCES bob_customer_files(id) ON DELETE CASCADE,
    expires_at timestamptz NOT NULL,
    used_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    created_by varchar(26) NOT NULL
);
CREATE INDEX bob_customer_download_tokens_expiry_idx ON bob_customer_download_tokens(expires_at);

-- Candidate deletion cascades its relations.  Remove file metadata only when
-- no historical version or group still shares the same immutable file.
-- +goose StatementBegin
CREATE OR REPLACE FUNCTION bob_delete_unreferenced_customer_file() RETURNS trigger AS $$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM bob_customer_group_attachments WHERE file_id=OLD.file_id)
       AND NOT EXISTS(SELECT 1 FROM bob_customer_version_attachments WHERE file_id=OLD.file_id) THEN
        DELETE FROM bob_customer_files WHERE id=OLD.file_id;
    END IF;
    RETURN OLD;
END;
$$ LANGUAGE plpgsql;
-- +goose StatementEnd
CREATE TRIGGER bob_customer_version_attachment_orphan_cleanup
    AFTER DELETE ON bob_customer_version_attachments
    FOR EACH ROW EXECUTE FUNCTION bob_delete_unreferenced_customer_file();
CREATE TRIGGER bob_customer_group_attachment_orphan_cleanup
    AFTER DELETE ON bob_customer_group_attachments
    FOR EACH ROW EXECUTE FUNCTION bob_delete_unreferenced_customer_file();

CREATE TABLE bob_customer_accounts (
    object_id varchar(26) PRIMARY KEY,
    group_id varchar(26) NOT NULL REFERENCES bob_customer_groups(id) ON DELETE RESTRICT,
    entity varchar(16) NOT NULL DEFAULT 'customer' CHECK (entity='customer'),
    FOREIGN KEY(object_id,entity) REFERENCES bob_objects(id,entity) ON DELETE RESTRICT
);
CREATE INDEX bob_customer_accounts_group_idx ON bob_customer_accounts(group_id,object_id);

ALTER TABLE bob_customer_versions
    ALTER COLUMN monthly_closing_day DROP DEFAULT,
    ALTER COLUMN monthly_closing_day DROP NOT NULL,
    ADD COLUMN operating_entity_id varchar(26),
    ADD COLUMN operating_entity_code varchar(16),
    ADD COLUMN operating_entity_name varchar(200),
    ADD COLUMN operating_entity_tax_number varchar(100),
    ADD COLUMN operating_entity_address varchar(500),
    ADD COLUMN operating_entity_phone varchar(100),
    ADD COLUMN settlement_method_code varchar(32),
    ADD COLUMN settlement_method_name varchar(200),
    ADD COLUMN settlement_term_code varchar(32),
    ADD COLUMN settlement_rule_type varchar(32),
    ADD COLUMN settlement_due_days integer NOT NULL DEFAULT 0 CHECK (settlement_due_days>=0),
    ADD COLUMN settlement_month_offset integer NOT NULL DEFAULT 0 CHECK (settlement_month_offset>=0),
    ADD COLUMN settlement_cutoff_day integer NOT NULL DEFAULT 0 CHECK (settlement_cutoff_day BETWEEN 0 AND 31),
    ADD COLUMN settlement_sales_surcharge_cents bigint NOT NULL DEFAULT 0 CHECK (settlement_sales_surcharge_cents>=0),
    ADD COLUMN payment_method_id varchar(26),
    ADD COLUMN payment_method_code varchar(32),
    ADD COLUMN payment_method_name varchar(200),
    ADD COLUMN payment_sales_surcharge_cents bigint NOT NULL DEFAULT 0 CHECK (payment_sales_surcharge_cents>=0),
    ADD COLUMN default_transport_method_code varchar(32),
    ADD COLUMN default_transport_method_name varchar(100),
    ADD COLUMN transport_surcharge_cents bigint NOT NULL DEFAULT 0 CHECK (transport_surcharge_cents>=0),
    ADD COLUMN pricing_policy jsonb NOT NULL DEFAULT '{
        "defaultPremiumUnitPrice":"0.00",
        "defaultDiscountUnitPrice":"0.00",
        "costItems":[],
        "thirdPartyIntermediaryFixedUnitCost":"0.00",
        "thirdPartyIntermediaryVariableUnitCost":"0.00"
    }'::jsonb,
    ADD COLUMN primary_sales_attribution_type varchar(32),
    ADD COLUMN primary_sales_subject_id varchar(26),
    ADD COLUMN primary_sales_subject_version_id varchar(26),
    ADD COLUMN primary_sales_subject_code varchar(32),
    ADD COLUMN primary_sales_subject_name varchar(200),
    ADD COLUMN internal_reminder varchar(1000),
    ADD COLUMN default_sales_order_remark varchar(1000),
    ADD CONSTRAINT bob_customer_versions_pricing_policy_ck CHECK (
        jsonb_typeof(pricing_policy)='object'
        AND pricing_policy ?& ARRAY[
            'defaultPremiumUnitPrice','defaultDiscountUnitPrice','costItems',
            'thirdPartyIntermediaryFixedUnitCost','thirdPartyIntermediaryVariableUnitCost'
        ]
        AND pricing_policy - ARRAY[
            'defaultPremiumUnitPrice','defaultDiscountUnitPrice','costItems',
            'thirdPartyIntermediaryFixedUnitCost','thirdPartyIntermediaryVariableUnitCost'
        ] = '{}'::jsonb
        AND jsonb_typeof(pricing_policy->'costItems')='array'
        AND jsonb_typeof(pricing_policy->'defaultPremiumUnitPrice')='string'
        AND jsonb_typeof(pricing_policy->'defaultDiscountUnitPrice')='string'
        AND jsonb_typeof(pricing_policy->'thirdPartyIntermediaryFixedUnitCost')='string'
        AND jsonb_typeof(pricing_policy->'thirdPartyIntermediaryVariableUnitCost')='string'
    ),
    ADD CONSTRAINT bob_customer_versions_primary_attribution_ck CHECK (
        (entity='other-party' AND primary_sales_attribution_type IS NULL
            AND primary_sales_subject_id IS NULL AND primary_sales_subject_version_id IS NULL)
        OR
        (entity='customer' AND primary_sales_attribution_type IN (
            'INTERNAL_EMPLOYEE','EXTERNAL_PART_TIME','DEALER'
        ) AND primary_sales_subject_id IS NOT NULL
          AND primary_sales_subject_version_id IS NOT NULL
          AND primary_sales_subject_code IS NOT NULL
          AND primary_sales_subject_name IS NOT NULL)
    );

CREATE INDEX bob_customer_versions_operating_entity_idx ON bob_customer_versions(operating_entity_id);
CREATE INDEX bob_customer_versions_primary_sales_subject_idx ON bob_customer_versions(primary_sales_subject_id);
CREATE INDEX bob_customer_versions_payment_method_idx ON bob_customer_versions(payment_method_id);

ALTER TABLE bob_audit_events
    DROP CONSTRAINT bob_audit_events_event_type_check,
    ADD CONSTRAINT bob_audit_events_event_type_check CHECK (event_type IN (
        'CREATED','EDIT_STARTED','SAVED','SUBMITTED','UNSUBMITTED','APPROVED','UNAPPROVED',
        'REJECTED','INVALIDATED','ENABLED','DISABLED','ATTACHED','DETACHED','BULK_BOB_REFERENCE_TRANSFERRED'
    ));

CREATE TABLE bob_customer_credit_limits (
    version_id varchar(26) NOT NULL,
    currency varchar(3) NOT NULL CHECK (currency='CNY'),
    amount_cents bigint NOT NULL CHECK (amount_cents>=0),
    PRIMARY KEY(version_id,currency),
    FOREIGN KEY(version_id) REFERENCES bob_customer_versions(version_id) ON DELETE RESTRICT
);

ALTER TABLE bob_fund_account_versions
    ADD COLUMN operating_entity_id varchar(26),
    ADD COLUMN operating_entity_version_id varchar(26),
    ADD COLUMN operating_entity_code varchar(16),
    ADD COLUMN operating_entity_name varchar(200),
    ADD CONSTRAINT bob_fund_account_operating_object_fk FOREIGN KEY(operating_entity_id) REFERENCES bob_objects(id) ON DELETE RESTRICT,
    ADD CONSTRAINT bob_fund_account_operating_version_fk FOREIGN KEY(operating_entity_version_id) REFERENCES bob_versions(id) ON DELETE RESTRICT;

-- Include Operating Entity in the one-detail-row aggregate invariant.
-- +goose StatementBegin
CREATE OR REPLACE FUNCTION bob_validate_version_detail() RETURNS trigger AS $$
DECLARE
    target_id varchar(26);
    expected_entity varchar(32);
    detail_count integer;
BEGIN
    IF TG_TABLE_NAME='bob_versions' THEN
        IF TG_OP='DELETE' THEN target_id:=OLD.id; ELSE target_id:=NEW.id; END IF;
    ELSE
        IF TG_OP='DELETE' THEN target_id:=OLD.version_id; ELSE target_id:=NEW.version_id; END IF;
    END IF;
    SELECT entity INTO expected_entity FROM bob_versions WHERE id=target_id;
    IF NOT FOUND THEN
        IF TG_OP='DELETE' THEN RETURN OLD; END IF;
        RETURN NEW;
    END IF;
    SELECT
        (SELECT count(*) FROM bob_customer_versions WHERE version_id=target_id)+
        (SELECT count(*) FROM bob_supplier_versions WHERE version_id=target_id)+
        (SELECT count(*) FROM bob_employee_versions WHERE version_id=target_id)+
        (SELECT count(*) FROM bob_product_versions WHERE version_id=target_id)+
        (SELECT count(*) FROM bob_service_versions WHERE version_id=target_id)+
        (SELECT count(*) FROM bob_warehouse_versions WHERE version_id=target_id)+
        (SELECT count(*) FROM bob_vehicle_versions WHERE version_id=target_id)+
        (SELECT count(*) FROM bob_fund_account_versions WHERE version_id=target_id)+
        (SELECT count(*) FROM bob_category_versions WHERE version_id=target_id)+
        (SELECT count(*) FROM bob_department_versions WHERE version_id=target_id)+
        (SELECT count(*) FROM bob_position_versions WHERE version_id=target_id)+
        (SELECT count(*) FROM bob_settlement_method_versions WHERE version_id=target_id)+
        (SELECT count(*) FROM bob_operating_entity_versions WHERE version_id=target_id)
    INTO detail_count;
    IF detail_count<>1 THEN
        RAISE EXCEPTION 'BOB version must have exactly one detail row' USING ERRCODE='23514';
    END IF;
    IF TG_OP='DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
-- +goose StatementEnd

CREATE CONSTRAINT TRIGGER bob_operating_entity_versions_detail_ck
    AFTER INSERT OR UPDATE OR DELETE ON bob_operating_entity_versions
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION bob_validate_version_detail();

WITH actions(action,description) AS (
    VALUES ('query','查询经营主体'),('get','查看经营主体'),('create','创建经营主体'),
           ('save','保存经营主体'),('delete','删除经营主体'),('submit','提交经营主体'),
           ('unsubmit','撤回经营主体'),('approve','审核经营主体'),('unapprove','反审核经营主体'),
           ('reject','驳回经营主体'),('enable','启用经营主体'),('disable','停用经营主体'),
           ('versions','查看经营主体版本'),('audit-history','查看经营主体审计')
)
INSERT INTO app_permissions(id,path,domain,entity,action,description,status)
SELECT '01JBOB83' || lpad(row_number() OVER (ORDER BY action)::text,18,'0'),
       '/bob/operating-entity/' || action,'bob','operating-entity',action,description,'ENABLED'
FROM actions
ON CONFLICT(path) DO NOTHING;

WITH actions(action,description,ordinal) AS (
    VALUES ('attachment-initiate','上传客户附件',1),('attachment-download','下载客户附件',2),
           ('attachment-remove','移除客户附件',3)
)
INSERT INTO app_permissions(id,path,domain,entity,action,description,status)
SELECT '01JBOB83ATT' || lpad(ordinal::text,15,'0'),'/bob/customer/' || action,
       'bob','customer',action,description,'ENABLED'
FROM actions
ON CONFLICT(path) DO NOTHING;

WITH permissions(id,path,entity,action,description) AS (
    VALUES
        ('01JBOB83REF000000000000001','/bob/reference/transfer','reference','transfer','批量转移业务对象引用'),
        ('01JBOB83GRP000000000000001','/bob/customer-group/get','customer-group','get','查看客户集团'),
        ('01JBOB83GRP000000000000002','/bob/customer-group/save','customer-group','save','保存客户集团'),
        ('01JBOB83GRP000000000000003','/bob/customer-group/audit-history','customer-group','audit-history','查看客户集团审计')
)
INSERT INTO app_permissions(id,path,domain,entity,action,description,status)
SELECT id,path,'bob',entity,action,description,'ENABLED' FROM permissions
ON CONFLICT(path) DO NOTHING;

INSERT INTO app_role_permissions(role_id,permission_id,created_by)
SELECT role.id,permission.id,role.updated_by
FROM app_roles role CROSS JOIN app_permissions permission
WHERE role.code='superadmin'
  AND ((permission.domain='bob' AND permission.entity='operating-entity')
       OR permission.path IN (
           '/bob/customer/attachment-initiate','/bob/customer/attachment-download','/bob/customer/attachment-remove',
           '/bob/reference/transfer','/bob/customer-group/get','/bob/customer-group/save','/bob/customer-group/audit-history'
       ))
ON CONFLICT DO NOTHING;

SELECT rpt_validate_current_reports();

-- +goose Down

DELETE FROM app_role_permissions WHERE permission_id IN (
    SELECT id FROM app_permissions WHERE entity='operating-entity'
       OR path IN ('/bob/customer/attachment-initiate','/bob/customer/attachment-download','/bob/customer/attachment-remove',
                   '/bob/reference/transfer','/bob/customer-group/get','/bob/customer-group/save','/bob/customer-group/audit-history')
);
DELETE FROM app_permissions WHERE entity='operating-entity'
   OR path IN ('/bob/customer/attachment-initiate','/bob/customer/attachment-download','/bob/customer/attachment-remove',
               '/bob/reference/transfer','/bob/customer-group/get','/bob/customer-group/save','/bob/customer-group/audit-history');
DROP TRIGGER bob_operating_entity_versions_detail_ck ON bob_operating_entity_versions;
ALTER TABLE bob_audit_events
    DROP CONSTRAINT bob_audit_events_event_type_check,
    ADD CONSTRAINT bob_audit_events_event_type_check CHECK (event_type IN (
        'CREATED','EDIT_STARTED','SAVED','SUBMITTED','UNSUBMITTED','APPROVED','UNAPPROVED',
        'REJECTED','INVALIDATED','ENABLED','DISABLED'
    ));
DROP TABLE bob_customer_credit_limits;
DROP TRIGGER bob_customer_group_attachment_orphan_cleanup ON bob_customer_group_attachments;
DROP TRIGGER bob_customer_version_attachment_orphan_cleanup ON bob_customer_version_attachments;
DROP FUNCTION bob_delete_unreferenced_customer_file();
DROP TABLE bob_customer_download_tokens;
DROP TABLE bob_customer_version_attachments;
DROP TABLE bob_customer_group_attachments;
DROP TABLE bob_customer_files;
DELETE FROM aux_versions WHERE object_id IN (
    '01JCDT00000000000000000001','01JCDT00000000000000000003','01JCDT00000000000000000005',
    '01JCDT00000000000000000007','01JCDT00000000000000000009','01JCDT00000000000000000011',
    '01JCDT00000000000000000013','01JCDT00000000000000000015'
);
DELETE FROM aux_objects WHERE id IN (
    '01JCDT00000000000000000001','01JCDT00000000000000000003','01JCDT00000000000000000005',
    '01JCDT00000000000000000007','01JCDT00000000000000000009','01JCDT00000000000000000011',
    '01JCDT00000000000000000013','01JCDT00000000000000000015'
);
ALTER TABLE bob_fund_account_versions
    DROP COLUMN operating_entity_name,
    DROP COLUMN operating_entity_code,
    DROP COLUMN operating_entity_version_id,
    DROP COLUMN operating_entity_id;
ALTER TABLE bob_customer_versions
    DROP CONSTRAINT bob_customer_versions_primary_attribution_ck,
    DROP CONSTRAINT bob_customer_versions_pricing_policy_ck,
    DROP COLUMN default_sales_order_remark,
    DROP COLUMN internal_reminder,
    DROP COLUMN primary_sales_subject_name,
    DROP COLUMN primary_sales_subject_code,
    DROP COLUMN primary_sales_subject_version_id,
    DROP COLUMN primary_sales_subject_id,
    DROP COLUMN primary_sales_attribution_type,
    DROP COLUMN pricing_policy,
    DROP COLUMN transport_surcharge_cents,
    DROP COLUMN default_transport_method_name,
    DROP COLUMN default_transport_method_code,
    DROP COLUMN payment_sales_surcharge_cents,
    DROP COLUMN payment_method_name,
    DROP COLUMN payment_method_code,
    DROP COLUMN payment_method_id,
    DROP COLUMN settlement_sales_surcharge_cents,
    DROP COLUMN settlement_cutoff_day,
    DROP COLUMN settlement_month_offset,
    DROP COLUMN settlement_due_days,
    DROP COLUMN settlement_rule_type,
    DROP COLUMN settlement_term_code,
    DROP COLUMN settlement_method_name,
    DROP COLUMN settlement_method_code,
    DROP COLUMN operating_entity_phone,
    DROP COLUMN operating_entity_address,
    DROP COLUMN operating_entity_tax_number,
    DROP COLUMN operating_entity_name,
    DROP COLUMN operating_entity_code,
    DROP COLUMN operating_entity_id;
UPDATE bob_customer_versions SET monthly_closing_day=31 WHERE monthly_closing_day IS NULL;
ALTER TABLE bob_customer_versions
    ALTER COLUMN monthly_closing_day SET DEFAULT 31,
    ALTER COLUMN monthly_closing_day SET NOT NULL;
DROP TABLE bob_customer_accounts;
DROP TABLE bob_customer_group_audit_events;
DROP TABLE bob_customer_group_bank_accounts;
DROP TABLE bob_customer_groups;
DROP TABLE bob_operating_entity_versions;
-- +goose StatementBegin
CREATE OR REPLACE FUNCTION bob_validate_version_detail() RETURNS trigger AS $$
DECLARE
    target_id varchar(26);
    expected_entity varchar(32);
    detail_count integer;
BEGIN
    IF TG_TABLE_NAME='bob_versions' THEN
        IF TG_OP='DELETE' THEN target_id:=OLD.id; ELSE target_id:=NEW.id; END IF;
    ELSE
        IF TG_OP='DELETE' THEN target_id:=OLD.version_id; ELSE target_id:=NEW.version_id; END IF;
    END IF;
    SELECT entity INTO expected_entity FROM bob_versions WHERE id=target_id;
    IF NOT FOUND THEN
        IF TG_OP='DELETE' THEN RETURN OLD; END IF;
        RETURN NEW;
    END IF;
    SELECT
        (SELECT count(*) FROM bob_customer_versions WHERE version_id=target_id)+
        (SELECT count(*) FROM bob_supplier_versions WHERE version_id=target_id)+
        (SELECT count(*) FROM bob_employee_versions WHERE version_id=target_id)+
        (SELECT count(*) FROM bob_product_versions WHERE version_id=target_id)+
        (SELECT count(*) FROM bob_service_versions WHERE version_id=target_id)+
        (SELECT count(*) FROM bob_warehouse_versions WHERE version_id=target_id)+
        (SELECT count(*) FROM bob_vehicle_versions WHERE version_id=target_id)+
        (SELECT count(*) FROM bob_fund_account_versions WHERE version_id=target_id)+
        (SELECT count(*) FROM bob_category_versions WHERE version_id=target_id)+
        (SELECT count(*) FROM bob_department_versions WHERE version_id=target_id)+
        (SELECT count(*) FROM bob_position_versions WHERE version_id=target_id)+
        (SELECT count(*) FROM bob_settlement_method_versions WHERE version_id=target_id)
    INTO detail_count;
    IF detail_count<>1 THEN
        RAISE EXCEPTION 'BOB version must have exactly one detail row' USING ERRCODE='23514';
    END IF;
    IF TG_OP='DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
-- +goose StatementEnd
ALTER TABLE bob_objects
    DROP CONSTRAINT bob_objects_entity_check,
    ADD CONSTRAINT bob_objects_entity_check CHECK (entity IN (
        'customer','supplier','other-party','employee','product','service','warehouse',
        'vehicle','fund-account','category','department','position','settlement-method'
    ));

-- +goose Up

-- Customer is a Party + operating-entity relationship.  Customer accounts are
-- the separately versioned, transactional identities below that relationship.
-- This is a direct cutover: the former customer-as-account / customer-group
-- model has no runtime or data compatibility path.

ALTER TABLE bob_objects
    DROP CONSTRAINT bob_objects_entity_check,
    ADD CONSTRAINT bob_objects_entity_check CHECK (entity IN (
        'customer','customer-account','supplier','other-unit','employee','sales-partner','product','service','warehouse',
        'vehicle','fund-account','category','department','position','settlement-method','operating-entity'
    ));

ALTER TABLE bob_customer_versions
    DROP CONSTRAINT bob_customer_versions_entity_check,
    ADD CONSTRAINT bob_customer_versions_entity_check CHECK (entity = 'customer-account'),
    ALTER COLUMN salesperson_employee_id DROP NOT NULL,
    DROP CONSTRAINT bob_customer_versions_primary_attribution_ck,
    ADD CONSTRAINT bob_customer_versions_primary_attribution_ck CHECK (
        primary_sales_attribution_type IN ('INTERNAL_EMPLOYEE','EXTERNAL_PART_TIME','CHANNEL_PARTNER')
        AND primary_sales_subject_id IS NOT NULL
        AND primary_sales_subject_version_id IS NOT NULL
        AND primary_sales_subject_code IS NOT NULL
        AND primary_sales_subject_name IS NOT NULL
    );

CREATE TABLE bob_customer_relationship_versions (
    version_id varchar(26) PRIMARY KEY,
    entity varchar(16) NOT NULL DEFAULT 'customer' CHECK (entity='customer'),
    FOREIGN KEY(version_id,entity) REFERENCES bob_versions(id,entity)
        ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED
);

-- Old group-owned attachment/file rows are not meaningful once the owning group
-- disappears.  The old customer-account table is empty after 00086's direct
-- fixture cutover; still drop it before recreating the relation-owned table.
DROP TABLE IF EXISTS bob_customer_group_audit_events CASCADE;
DROP TABLE IF EXISTS bob_customer_group_bank_accounts CASCADE;
DROP TABLE IF EXISTS bob_customer_group_attachments CASCADE;
DROP TABLE IF EXISTS bob_customer_groups CASCADE;
DROP TABLE IF EXISTS bob_customer_accounts CASCADE;

-- Recreate after removing the legacy table (kept above in migration order so
-- this migration also rejects accidental non-empty legacy fixtures).
CREATE TABLE bob_customer_accounts (
    object_id varchar(26) PRIMARY KEY,
    object_entity varchar(16) NOT NULL DEFAULT 'customer-account' CHECK (object_entity='customer-account'),
    customer_relationship_id varchar(26) NOT NULL REFERENCES bob_customer_relationships(object_id) ON DELETE RESTRICT,
    created_at timestamptz NOT NULL DEFAULT now(),
    created_by varchar(26) NOT NULL,
    FOREIGN KEY(object_id,object_entity) REFERENCES bob_objects(id,entity)
        ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED
);
CREATE INDEX bob_customer_accounts_relationship_idx ON bob_customer_accounts(customer_relationship_id,object_id);

CREATE TABLE bob_customer_relationship_attachments (
    customer_relationship_id varchar(26) NOT NULL REFERENCES bob_customer_relationships(object_id) ON DELETE RESTRICT,
    file_id varchar(26) NOT NULL UNIQUE REFERENCES bob_customer_files(id) ON DELETE RESTRICT,
    category_object_id varchar(26) NOT NULL,
    category_version_id varchar(26) NOT NULL,
    category_code varchar(16) NOT NULL,
    category_name varchar(100) NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    created_by varchar(26) NOT NULL,
    PRIMARY KEY(customer_relationship_id,file_id)
);

-- Reinstall the single-detail invariant now that customer and customer-account
-- use distinct detail tables.
-- +goose StatementBegin
CREATE OR REPLACE FUNCTION bob_validate_version_detail() RETURNS trigger AS $$
DECLARE target_id varchar(26); detail_count integer;
BEGIN
    IF TG_TABLE_NAME='bob_versions' THEN
        IF TG_OP='DELETE' THEN target_id:=OLD.id; ELSE target_id:=NEW.id; END IF;
    ELSE
        IF TG_OP='DELETE' THEN target_id:=OLD.version_id; ELSE target_id:=NEW.version_id; END IF;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM bob_versions WHERE id=target_id) THEN
        IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
    END IF;
    SELECT (SELECT count(*) FROM bob_customer_relationship_versions WHERE version_id=target_id)+
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
           (SELECT count(*) FROM bob_operating_entity_versions WHERE version_id=target_id)+
           (SELECT count(*) FROM bob_service_relationship_versions WHERE version_id=target_id)+
           (SELECT count(*) FROM bob_sales_partner_versions WHERE version_id=target_id)
    INTO detail_count;
    IF detail_count<>1 THEN RAISE EXCEPTION 'BOB version must have exactly one detail row' USING ERRCODE='23514'; END IF;
    IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END; $$ LANGUAGE plpgsql;
-- +goose StatementEnd
CREATE CONSTRAINT TRIGGER bob_customer_relationship_versions_detail_ck
    AFTER INSERT OR UPDATE OR DELETE ON bob_customer_relationship_versions
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION bob_validate_version_detail();

DELETE FROM app_role_permissions WHERE permission_id IN (SELECT id FROM app_permissions WHERE domain='bob' AND entity='customer-group');
DELETE FROM app_permissions WHERE domain='bob' AND entity='customer-group';

WITH actions(action,description,ordinal) AS (
 VALUES ('query','查询客户账户',1),('get','查看客户账户',2),('create','创建客户关系',3),('save','保存客户账户',4),
 ('delete','删除客户账户草稿',5),('submit','提交客户账户',6),('unsubmit','撤回客户账户',7),('approve','审核客户账户',8),
 ('reject','驳回客户账户',9),('enable','启用客户账户',10),('disable','停用客户账户',11),('versions','查看客户账户版本',12),('audit-history','查看客户账户审计',13)
)
INSERT INTO app_permissions(id,path,domain,entity,action,description,status)
SELECT '01JBOB89CAC'||lpad(ordinal::text,15,'0'),'/bob/customer-account/'||action,'bob','customer-account',action,description,'ENABLED'
FROM actions ON CONFLICT(path) DO NOTHING;
INSERT INTO app_role_permissions(role_id,permission_id,created_by)
SELECT r.id,p.id,r.updated_by FROM app_roles r JOIN app_permissions p ON p.domain='bob' AND p.entity='customer-account'
WHERE r.code='superadmin' ON CONFLICT DO NOTHING;

SELECT rpt_validate_current_reports();

-- +goose Down
-- +goose StatementBegin
DO $$ BEGIN RAISE EXCEPTION '00089 customer relationship/account cutover is irreversible'; END $$;
-- +goose StatementEnd

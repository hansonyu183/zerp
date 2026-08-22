-- +goose Up

-- Party/relationship is a direct cutover. The integration branch is not
-- allowed to keep writable other-party aggregates beside other-unit.
-- +goose StatementBegin
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM bob_objects WHERE entity='other-party')
       OR EXISTS (SELECT 1 FROM vou_receipt_details WHERE counterparty_entity='other-party')
       OR EXISTS (SELECT 1 FROM vou_payment_details WHERE counterparty_entity='other-party')
       OR EXISTS (SELECT 1 FROM vou_asset_sale_details WHERE counterparty_entity='other-party')
       OR EXISTS (SELECT 1 FROM vou_bill_details WHERE counterparty_entity='other-party' OR interest_party_entity='other-party')
       OR EXISTS (SELECT 1 FROM vou_intermediary_calculation_summaries WHERE payee_entity='other-party') THEN
        RAISE EXCEPTION 'party cutover requires other-party fixtures to be rebuilt'
            USING ERRCODE='P0001';
    END IF;
END
$$;
-- +goose StatementEnd

ALTER TABLE bob_objects
    DROP CONSTRAINT bob_objects_entity_check,
    ADD CONSTRAINT bob_objects_entity_check CHECK (entity IN (
        'customer','supplier','other-unit','employee','product','service','warehouse',
        'vehicle','fund-account','category','department','position','settlement-method',
        'operating-entity'
    ));

ALTER TABLE bob_customer_versions
    DROP CONSTRAINT bob_customer_versions_entity_check,
    DROP CONSTRAINT bob_customer_versions_primary_attribution_ck,
    ADD CONSTRAINT bob_customer_versions_entity_check CHECK (entity='customer'),
    ADD CONSTRAINT bob_customer_versions_primary_attribution_ck CHECK (
        primary_sales_attribution_type IN ('INTERNAL_EMPLOYEE','EXTERNAL_PART_TIME','DEALER')
        AND primary_sales_subject_id IS NOT NULL
        AND primary_sales_subject_version_id IS NOT NULL
        AND primary_sales_subject_code IS NOT NULL
        AND primary_sales_subject_name IS NOT NULL
    );

ALTER TABLE vou_receipt_details
    DROP CONSTRAINT vou_receipt_details_counterparty_entity_check,
    DROP CONSTRAINT vou_receipt_details_entity_party_check,
    ADD CONSTRAINT vou_receipt_details_counterparty_entity_check
        CHECK (counterparty_entity IN ('customer','supplier','other-unit','employee')),
    ADD CONSTRAINT vou_receipt_details_entity_party_check CHECK (
        (entity='sales-receipt' AND counterparty_entity='customer') OR
        (entity='purchase-refund' AND counterparty_entity='supplier') OR
        (entity='other-receipt' AND counterparty_entity IN ('customer','supplier','other-unit','employee')) OR
        (entity='employee-repayment' AND counterparty_entity='employee')
    );
ALTER TABLE vou_payment_details
    DROP CONSTRAINT vou_payment_details_counterparty_entity_check,
    DROP CONSTRAINT vou_payment_details_entity_party_check,
    ADD CONSTRAINT vou_payment_details_counterparty_entity_check
        CHECK (counterparty_entity IN ('customer','supplier','other-unit','employee')),
    ADD CONSTRAINT vou_payment_details_entity_party_check CHECK (
        (entity='sales-refund' AND counterparty_entity='customer') OR
        (entity='purchase-payment' AND counterparty_entity='supplier') OR
        (entity='other-payment' AND counterparty_entity IN ('customer','supplier','other-unit','employee')) OR
        (entity='employee-loan' AND counterparty_entity='employee')
    );
ALTER TABLE vou_asset_sale_details
    DROP CONSTRAINT vou_asset_sale_details_counterparty_entity_check,
    ADD CONSTRAINT vou_asset_sale_details_counterparty_entity_check
        CHECK (counterparty_entity IN ('customer','other-unit'));
ALTER TABLE vou_bill_details
    DROP CONSTRAINT vou_bill_details_counterparty_entity_check,
    DROP CONSTRAINT vou_bill_details_interest_party_entity_check,
    DROP CONSTRAINT vou_bill_details_check2,
    DROP CONSTRAINT vou_bill_details_check3,
    ADD CONSTRAINT vou_bill_details_counterparty_entity_check
        CHECK (counterparty_entity IN ('customer','supplier','other-unit')),
    ADD CONSTRAINT vou_bill_details_interest_party_entity_check
        CHECK (interest_party_entity='other-unit'),
    ADD CONSTRAINT vou_bill_details_interest_party_reference_ck CHECK (
        (interest_party_entity IS NULL AND interest_party_object_id IS NULL
            AND interest_party_version_id IS NULL AND interest_party_code IS NULL
            AND interest_party_name IS NULL)
        OR
        (interest_party_entity='other-unit' AND interest_party_object_id IS NOT NULL
            AND interest_party_version_id IS NOT NULL AND interest_party_code IS NOT NULL
            AND interest_party_name IS NOT NULL)
    ),
    ADD CONSTRAINT vou_bill_details_interest_mode_party_ck CHECK (
        (interest_mode='THIRD_PARTY_PAYABLE' AND interest_party_entity='other-unit')
        OR (interest_mode<>'THIRD_PARTY_PAYABLE' AND interest_party_entity IS NULL)
    );
ALTER TABLE vou_intermediary_calculation_summaries
    DROP CONSTRAINT vou_intermediary_calculation_summaries_payee_entity_check,
    ADD CONSTRAINT vou_intermediary_calculation_summaries_payee_entity_check
        CHECK (payee_entity IN ('customer','employee','other-unit'));

CREATE TABLE bob_parties (
    id varchar(26) PRIMARY KEY,
    kind varchar(16) NOT NULL CHECK (kind IN ('PERSON','ORGANIZATION')),
    legal_name varchar(200) NOT NULL CHECK (length(btrim(legal_name)) BETWEEN 1 AND 200),
    display_name varchar(200) NOT NULL CHECK (length(btrim(display_name)) BETWEEN 1 AND 200),
    tax_number varchar(100),
    phone varchar(32),
    email varchar(254),
    address varchar(500),
    revision bigint NOT NULL DEFAULT 1 CHECK (revision>=1),
    created_at timestamptz NOT NULL DEFAULT now(),
    created_by varchar(26) NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now(),
    updated_by varchar(26) NOT NULL
);
CREATE INDEX bob_parties_name_idx ON bob_parties(upper(display_name),id);

CREATE TABLE bob_party_identifiers (
    party_id varchar(26) NOT NULL REFERENCES bob_parties(id) ON DELETE RESTRICT,
    identifier_type varchar(40) NOT NULL CHECK (identifier_type IN (
        'PERSON_ID','UNIFIED_SOCIAL_CREDIT_CODE','TAX_NUMBER'
    )),
    value varchar(100) NOT NULL CHECK (length(btrim(value)) BETWEEN 1 AND 100),
    normalized_value varchar(100) NOT NULL CHECK (length(btrim(normalized_value)) BETWEEN 1 AND 100),
    PRIMARY KEY(party_id,identifier_type,normalized_value),
    UNIQUE(identifier_type,normalized_value)
);

CREATE TABLE bob_party_audit_events (
    id varchar(26) PRIMARY KEY,
    party_id varchar(26) NOT NULL REFERENCES bob_parties(id) ON DELETE RESTRICT,
    event_type varchar(16) NOT NULL CHECK (event_type IN ('CREATED','SAVED')),
    revision bigint NOT NULL CHECK (revision>=1),
    actor_id varchar(26) NOT NULL,
    occurred_at timestamptz NOT NULL DEFAULT now(),
    request_id varchar(128) NOT NULL,
    summary jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(summary)='object')
);
CREATE INDEX bob_party_audit_history_idx
    ON bob_party_audit_events(party_id,occurred_at DESC,id DESC);

CREATE TABLE bob_service_relationships (
    object_id varchar(26) PRIMARY KEY,
    object_entity varchar(16) NOT NULL DEFAULT 'other-unit' CHECK (object_entity='other-unit'),
    party_id varchar(26) NOT NULL REFERENCES bob_parties(id) ON DELETE RESTRICT,
    operating_entity_id varchar(26) NOT NULL,
    operating_entity_entity varchar(32) NOT NULL DEFAULT 'operating-entity'
        CHECK (operating_entity_entity='operating-entity'),
    created_at timestamptz NOT NULL DEFAULT now(),
    created_by varchar(26) NOT NULL,
    UNIQUE(party_id,operating_entity_id),
    FOREIGN KEY(object_id,object_entity) REFERENCES bob_objects(id,entity)
        ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
    FOREIGN KEY(operating_entity_id,operating_entity_entity) REFERENCES bob_objects(id,entity)
        ON DELETE RESTRICT
);

CREATE TABLE bob_service_relationship_versions (
    version_id varchar(26) PRIMARY KEY,
    entity varchar(16) NOT NULL DEFAULT 'other-unit' CHECK (entity='other-unit'),
    contact_name varchar(100),
    contact_phone varchar(32),
    email varchar(254),
    address varchar(500),
    settlement_method_id varchar(26),
    settlement_method_code varchar(32),
    settlement_method_name varchar(200),
    settlement_term_code varchar(32),
    settlement_rule_type varchar(32),
    settlement_month_offset integer NOT NULL DEFAULT 0 CHECK (settlement_month_offset>=0),
    settlement_day_of_month integer NOT NULL DEFAULT 0 CHECK (settlement_day_of_month BETWEEN 0 AND 31),
    settlement_day_offset integer NOT NULL DEFAULT 0 CHECK (settlement_day_offset>=0),
    remark varchar(1000),
    FOREIGN KEY(version_id,entity) REFERENCES bob_versions(id,entity)
        ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
    CONSTRAINT bob_service_relationship_settlement_ck CHECK (
        (settlement_method_id IS NULL AND settlement_method_code IS NULL
            AND settlement_method_name IS NULL AND settlement_term_code IS NULL
            AND settlement_rule_type IS NULL AND settlement_month_offset=0
            AND settlement_day_of_month=0 AND settlement_day_offset=0)
        OR
        (settlement_method_id IS NOT NULL AND settlement_method_code IS NOT NULL
            AND settlement_method_name IS NOT NULL AND settlement_term_code IS NOT NULL
            AND settlement_rule_type IS NOT NULL)
    )
);

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
        (SELECT count(*) FROM bob_operating_entity_versions WHERE version_id=target_id)+
        (SELECT count(*) FROM bob_service_relationship_versions WHERE version_id=target_id)
    INTO detail_count;
    IF detail_count<>1 THEN
        RAISE EXCEPTION 'BOB version must have exactly one detail row' USING ERRCODE='23514';
    END IF;
    IF TG_OP='DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
-- +goose StatementEnd

CREATE CONSTRAINT TRIGGER bob_service_relationship_versions_detail_ck
    AFTER INSERT OR UPDATE OR DELETE ON bob_service_relationship_versions
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION bob_validate_version_detail();

DELETE FROM app_role_permissions
WHERE permission_id IN (SELECT id FROM app_permissions WHERE domain='bob' AND entity='other-party');
DELETE FROM app_permissions WHERE domain='bob' AND entity='other-party';

WITH permissions(entity,action,description,ordinal) AS (
    VALUES
        ('party','query','查询主体',1),
        ('party','get','查看主体',2),
        ('party','create','随首条关系创建主体',3),
        ('party','save','保存主体资料',4),
        ('party','audit-history','查看主体审计',5),
        ('other-unit','query','查询其他单位',6),
        ('other-unit','get','查看其他单位',7),
        ('other-unit','create','创建其他单位',8),
        ('other-unit','save','保存其他单位',9),
        ('other-unit','delete','删除其他单位草稿',10),
        ('other-unit','submit','提交其他单位',11),
        ('other-unit','unsubmit','撤回其他单位',12),
        ('other-unit','approve','审核其他单位',13),
        ('other-unit','reject','驳回其他单位',14),
        ('other-unit','enable','启用其他单位',15),
        ('other-unit','disable','停用其他单位',16),
        ('other-unit','versions','查看其他单位版本',17),
        ('other-unit','audit-history','查看其他单位审计',18)
)
INSERT INTO app_permissions(id,path,domain,entity,action,description,status)
SELECT '01JBOB85'||lpad(ordinal::text,18,'0'),'/bob/'||entity||'/'||action,
       'bob',entity,action,description,'ENABLED'
FROM permissions;

INSERT INTO app_role_permissions(role_id,permission_id,created_by)
SELECT role.id,permission.id,role.updated_by
FROM app_roles role
JOIN app_permissions permission ON permission.domain='bob'
    AND permission.entity IN ('party','other-unit')
WHERE role.code='superadmin'
ON CONFLICT DO NOTHING;

SELECT rpt_validate_current_reports();

-- +goose Down

-- This direct cutover intentionally deletes the legacy authorization model and is irreversible.
-- +goose StatementBegin
DO $$
BEGIN
    RAISE EXCEPTION '00085 Party cutover is irreversible';
END
$$;
-- +goose StatementEnd

DELETE FROM app_role_permissions
WHERE permission_id IN (
    SELECT id FROM app_permissions WHERE domain='bob' AND entity IN ('party','other-unit')
);
DELETE FROM app_permissions WHERE domain='bob' AND entity IN ('party','other-unit');

DROP TRIGGER bob_service_relationship_versions_detail_ck ON bob_service_relationship_versions;
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
DROP TABLE bob_service_relationship_versions;
DROP TABLE bob_service_relationships;
DROP TABLE bob_party_audit_events;
DROP TABLE bob_party_identifiers;
DROP TABLE bob_parties;

ALTER TABLE vou_intermediary_calculation_summaries
    DROP CONSTRAINT vou_intermediary_calculation_summaries_payee_entity_check,
    ADD CONSTRAINT vou_intermediary_calculation_summaries_payee_entity_check
        CHECK (payee_entity IN ('customer','employee','other-party'));
ALTER TABLE vou_bill_details
    DROP CONSTRAINT vou_bill_details_counterparty_entity_check,
    DROP CONSTRAINT vou_bill_details_interest_party_entity_check,
    DROP CONSTRAINT vou_bill_details_interest_party_reference_ck,
    DROP CONSTRAINT vou_bill_details_interest_mode_party_ck,
    ADD CONSTRAINT vou_bill_details_counterparty_entity_check
        CHECK (counterparty_entity IN ('customer','supplier','other-party')),
    ADD CONSTRAINT vou_bill_details_interest_party_entity_check
        CHECK (interest_party_entity='other-party'),
    ADD CONSTRAINT vou_bill_details_check2 CHECK (
        (interest_party_entity IS NULL AND interest_party_object_id IS NULL
            AND interest_party_version_id IS NULL AND interest_party_code IS NULL
            AND interest_party_name IS NULL)
        OR
        (interest_party_entity='other-party' AND interest_party_object_id IS NOT NULL
            AND interest_party_version_id IS NOT NULL AND interest_party_code IS NOT NULL
            AND interest_party_name IS NOT NULL)
    ),
    ADD CONSTRAINT vou_bill_details_check3 CHECK (
        (interest_mode='THIRD_PARTY_PAYABLE' AND interest_party_entity='other-party')
        OR (interest_mode<>'THIRD_PARTY_PAYABLE' AND interest_party_entity IS NULL)
    );
ALTER TABLE vou_asset_sale_details
    DROP CONSTRAINT vou_asset_sale_details_counterparty_entity_check,
    ADD CONSTRAINT vou_asset_sale_details_counterparty_entity_check
        CHECK (counterparty_entity IN ('customer','other-party'));
ALTER TABLE vou_payment_details
    DROP CONSTRAINT vou_payment_details_counterparty_entity_check,
    DROP CONSTRAINT vou_payment_details_entity_party_check,
    ADD CONSTRAINT vou_payment_details_counterparty_entity_check
        CHECK (counterparty_entity IN ('customer','supplier','other-party','employee')),
    ADD CONSTRAINT vou_payment_details_entity_party_check CHECK (
        (entity='sales-refund' AND counterparty_entity='customer') OR
        (entity='purchase-payment' AND counterparty_entity='supplier') OR
        (entity='other-payment' AND counterparty_entity IN ('customer','supplier','other-party','employee')) OR
        (entity='employee-loan' AND counterparty_entity='employee')
    );
ALTER TABLE vou_receipt_details
    DROP CONSTRAINT vou_receipt_details_counterparty_entity_check,
    DROP CONSTRAINT vou_receipt_details_entity_party_check,
    ADD CONSTRAINT vou_receipt_details_counterparty_entity_check
        CHECK (counterparty_entity IN ('customer','supplier','other-party','employee')),
    ADD CONSTRAINT vou_receipt_details_entity_party_check CHECK (
        (entity='sales-receipt' AND counterparty_entity='customer') OR
        (entity='purchase-refund' AND counterparty_entity='supplier') OR
        (entity='other-receipt' AND counterparty_entity IN ('customer','supplier','other-party','employee')) OR
        (entity='employee-repayment' AND counterparty_entity='employee')
    );
ALTER TABLE bob_customer_versions
    DROP CONSTRAINT bob_customer_versions_entity_check,
    DROP CONSTRAINT bob_customer_versions_primary_attribution_ck,
    ADD CONSTRAINT bob_customer_versions_entity_check CHECK (entity IN ('customer','other-party')),
    ADD CONSTRAINT bob_customer_versions_primary_attribution_ck CHECK (
        (entity='other-party' AND primary_sales_attribution_type IS NULL
            AND primary_sales_subject_id IS NULL AND primary_sales_subject_version_id IS NULL)
        OR
        (entity='customer' AND primary_sales_attribution_type IN ('INTERNAL_EMPLOYEE','EXTERNAL_PART_TIME','DEALER')
            AND primary_sales_subject_id IS NOT NULL AND primary_sales_subject_version_id IS NOT NULL
            AND primary_sales_subject_code IS NOT NULL AND primary_sales_subject_name IS NOT NULL)
    );

ALTER TABLE bob_objects
    DROP CONSTRAINT bob_objects_entity_check,
    ADD CONSTRAINT bob_objects_entity_check CHECK (entity IN (
        'customer','supplier','other-party','employee','product','service','warehouse',
        'vehicle','fund-account','category','department','position','settlement-method',
        'operating-entity'
    ));

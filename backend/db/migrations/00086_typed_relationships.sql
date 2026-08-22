-- +goose Up

-- This branch is the direct Party/relationship cutover. Existing development,
-- preview, and test fixtures using the former naked customer, supplier, or
-- employee aggregates must be rebuilt; the application never dual-reads them.
-- +goose StatementBegin
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM bob_objects WHERE entity IN ('customer','supplier','employee')) THEN
        RAISE EXCEPTION 'typed relationship cutover requires customer, supplier, and employee fixtures to be rebuilt'
            USING ERRCODE='P0001';
    END IF;
END
$$;
-- +goose StatementEnd

ALTER TABLE bob_objects
    DROP CONSTRAINT bob_objects_entity_check,
    ADD CONSTRAINT bob_objects_entity_check CHECK (entity IN (
        'customer','supplier','other-unit','employee','sales-partner','product','service','warehouse',
        'vehicle','fund-account','category','department','position','settlement-method','operating-entity'
    ));

ALTER TABLE bob_parties
    ADD COLUMN merged_into_party_id varchar(26),
    ADD COLUMN merged_at timestamptz,
    ADD CONSTRAINT bob_parties_merge_state_ck CHECK (
        (merged_into_party_id IS NULL AND merged_at IS NULL)
        OR (merged_into_party_id IS NOT NULL AND merged_at IS NOT NULL AND merged_into_party_id<>id)
    ),
    ADD CONSTRAINT bob_parties_merged_into_fk FOREIGN KEY(merged_into_party_id)
        REFERENCES bob_parties(id) ON DELETE RESTRICT;

CREATE TABLE bob_customer_relationships (
    object_id varchar(26) PRIMARY KEY,
    object_entity varchar(16) NOT NULL DEFAULT 'customer' CHECK (object_entity='customer'),
    party_id varchar(26) NOT NULL REFERENCES bob_parties(id) ON DELETE RESTRICT,
    operating_entity_id varchar(26) NOT NULL,
    operating_entity_entity varchar(32) NOT NULL DEFAULT 'operating-entity'
        CHECK (operating_entity_entity='operating-entity'),
    merged_into_object_id varchar(26),
    merged_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    created_by varchar(26) NOT NULL,
    UNIQUE(party_id,operating_entity_id),
    FOREIGN KEY(object_id,object_entity) REFERENCES bob_objects(id,entity)
        ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
    FOREIGN KEY(operating_entity_id,operating_entity_entity) REFERENCES bob_objects(id,entity)
        ON DELETE RESTRICT,
    FOREIGN KEY(merged_into_object_id) REFERENCES bob_customer_relationships(object_id) ON DELETE RESTRICT,
    CONSTRAINT bob_customer_relationship_merge_ck CHECK (
        (merged_into_object_id IS NULL AND merged_at IS NULL)
        OR (merged_into_object_id IS NOT NULL AND merged_at IS NOT NULL AND merged_into_object_id<>object_id)
    )
);

CREATE TABLE bob_supplier_relationships (
    object_id varchar(26) PRIMARY KEY,
    object_entity varchar(16) NOT NULL DEFAULT 'supplier' CHECK (object_entity='supplier'),
    party_id varchar(26) NOT NULL REFERENCES bob_parties(id) ON DELETE RESTRICT,
    operating_entity_id varchar(26) NOT NULL,
    operating_entity_entity varchar(32) NOT NULL DEFAULT 'operating-entity'
        CHECK (operating_entity_entity='operating-entity'),
    merged_into_object_id varchar(26),
    merged_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    created_by varchar(26) NOT NULL,
    UNIQUE(party_id,operating_entity_id),
    FOREIGN KEY(object_id,object_entity) REFERENCES bob_objects(id,entity)
        ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
    FOREIGN KEY(operating_entity_id,operating_entity_entity) REFERENCES bob_objects(id,entity)
        ON DELETE RESTRICT,
    FOREIGN KEY(merged_into_object_id) REFERENCES bob_supplier_relationships(object_id) ON DELETE RESTRICT,
    CONSTRAINT bob_supplier_relationship_merge_ck CHECK (
        (merged_into_object_id IS NULL AND merged_at IS NULL)
        OR (merged_into_object_id IS NOT NULL AND merged_at IS NOT NULL AND merged_into_object_id<>object_id)
    )
);

CREATE TABLE bob_employment_relationships (
    object_id varchar(26) PRIMARY KEY,
    object_entity varchar(16) NOT NULL DEFAULT 'employee' CHECK (object_entity='employee'),
    party_id varchar(26) NOT NULL REFERENCES bob_parties(id) ON DELETE RESTRICT,
    operating_entity_id varchar(26) NOT NULL,
    operating_entity_entity varchar(32) NOT NULL DEFAULT 'operating-entity'
        CHECK (operating_entity_entity='operating-entity'),
    merged_into_object_id varchar(26),
    merged_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    created_by varchar(26) NOT NULL,
    UNIQUE(party_id,operating_entity_id),
    FOREIGN KEY(object_id,object_entity) REFERENCES bob_objects(id,entity)
        ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
    FOREIGN KEY(operating_entity_id,operating_entity_entity) REFERENCES bob_objects(id,entity)
        ON DELETE RESTRICT,
    FOREIGN KEY(merged_into_object_id) REFERENCES bob_employment_relationships(object_id) ON DELETE RESTRICT,
    CONSTRAINT bob_employment_relationship_merge_ck CHECK (
        (merged_into_object_id IS NULL AND merged_at IS NULL)
        OR (merged_into_object_id IS NOT NULL AND merged_at IS NOT NULL AND merged_into_object_id<>object_id)
    )
);

CREATE TABLE bob_sales_relationships (
    object_id varchar(26) PRIMARY KEY,
    object_entity varchar(16) NOT NULL DEFAULT 'sales-partner' CHECK (object_entity='sales-partner'),
    party_id varchar(26) NOT NULL REFERENCES bob_parties(id) ON DELETE RESTRICT,
    operating_entity_id varchar(26) NOT NULL,
    operating_entity_entity varchar(32) NOT NULL DEFAULT 'operating-entity'
        CHECK (operating_entity_entity='operating-entity'),
    merged_into_object_id varchar(26),
    merged_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    created_by varchar(26) NOT NULL,
    UNIQUE(party_id,operating_entity_id),
    FOREIGN KEY(object_id,object_entity) REFERENCES bob_objects(id,entity)
        ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
    FOREIGN KEY(operating_entity_id,operating_entity_entity) REFERENCES bob_objects(id,entity)
        ON DELETE RESTRICT,
    FOREIGN KEY(merged_into_object_id) REFERENCES bob_sales_relationships(object_id) ON DELETE RESTRICT,
    CONSTRAINT bob_sales_relationship_merge_ck CHECK (
        (merged_into_object_id IS NULL AND merged_at IS NULL)
        OR (merged_into_object_id IS NOT NULL AND merged_at IS NOT NULL AND merged_into_object_id<>object_id)
    )
);

ALTER TABLE bob_service_relationships
    ADD COLUMN merged_into_object_id varchar(26),
    ADD COLUMN merged_at timestamptz,
    ADD CONSTRAINT bob_service_relationship_merged_into_fk FOREIGN KEY(merged_into_object_id)
        REFERENCES bob_service_relationships(object_id) ON DELETE RESTRICT,
    ADD CONSTRAINT bob_service_relationship_merge_ck CHECK (
        (merged_into_object_id IS NULL AND merged_at IS NULL)
        OR (merged_into_object_id IS NOT NULL AND merged_at IS NOT NULL AND merged_into_object_id<>object_id)
    );

CREATE VIEW bob_party_relationship_endpoints AS
SELECT object_id,party_id,operating_entity_id,merged_into_object_id FROM bob_customer_relationships
UNION ALL SELECT object_id,party_id,operating_entity_id,merged_into_object_id FROM bob_supplier_relationships
UNION ALL SELECT object_id,party_id,operating_entity_id,merged_into_object_id FROM bob_employment_relationships
UNION ALL SELECT object_id,party_id,operating_entity_id,merged_into_object_id FROM bob_service_relationships
UNION ALL SELECT object_id,party_id,operating_entity_id,merged_into_object_id FROM bob_sales_relationships;

DROP TRIGGER bob_supplier_versions_platform_type_ck ON bob_supplier_versions;
DROP FUNCTION bob_prevent_platform_type_downgrade();
ALTER TABLE bob_vehicle_versions
    ALTER COLUMN platform_entity DROP DEFAULT,
    DROP CONSTRAINT bob_vehicle_versions_platform_entity_check,
    ADD CONSTRAINT bob_vehicle_versions_platform_entity_check CHECK (platform_entity='other-unit'),
    ALTER COLUMN platform_entity SET DEFAULT 'other-unit';

CREATE TABLE bob_sales_partner_versions (
    version_id varchar(26) PRIMARY KEY,
    entity varchar(16) NOT NULL DEFAULT 'sales-partner' CHECK (entity='sales-partner'),
    capabilities varchar(32)[] NOT NULL DEFAULT '{}',
    contact_name varchar(100),
    contact_phone varchar(32),
    email varchar(254),
    address varchar(500),
    remark varchar(1000),
    FOREIGN KEY(version_id,entity) REFERENCES bob_versions(id,entity)
        ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
    CONSTRAINT bob_sales_partner_capabilities_ck CHECK (
        capabilities <@ ARRAY['EXTERNAL_PART_TIME','CHANNEL_PARTNER']::varchar(32)[]
        AND cardinality(capabilities)<=2
        AND (cardinality(capabilities)<2 OR capabilities[1]<>capabilities[2])
    )
);

-- +goose StatementBegin
CREATE OR REPLACE FUNCTION bob_validate_version_detail() RETURNS trigger AS $$
DECLARE
    target_id varchar(26);
    detail_count integer;
BEGIN
    IF TG_TABLE_NAME='bob_versions' THEN
        IF TG_OP='DELETE' THEN target_id:=OLD.id; ELSE target_id:=NEW.id; END IF;
    ELSE
        IF TG_OP='DELETE' THEN target_id:=OLD.version_id; ELSE target_id:=NEW.version_id; END IF;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM bob_versions WHERE id=target_id) THEN
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
        (SELECT count(*) FROM bob_service_relationship_versions WHERE version_id=target_id)+
        (SELECT count(*) FROM bob_sales_partner_versions WHERE version_id=target_id)
    INTO detail_count;
    IF detail_count<>1 THEN
        RAISE EXCEPTION 'BOB version must have exactly one detail row' USING ERRCODE='23514';
    END IF;
    IF TG_OP='DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
-- +goose StatementEnd

CREATE CONSTRAINT TRIGGER bob_sales_partner_versions_detail_ck
    AFTER INSERT OR UPDATE OR DELETE ON bob_sales_partner_versions
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION bob_validate_version_detail();

WITH actions(action,description,ordinal) AS (
    VALUES ('query','查询销售合作方',1),('get','查看销售合作方',2),('create','创建销售合作方',3),
           ('save','保存销售合作方',4),('delete','删除销售合作方草稿',5),('submit','提交销售合作方',6),
           ('unsubmit','撤回销售合作方',7),('approve','审核销售合作方',8),('reject','驳回销售合作方',9),
           ('enable','启用销售合作方',10),('disable','停用销售合作方',11),
           ('versions','查看销售合作方版本',12),('audit-history','查看销售合作方审计',13)
)
INSERT INTO app_permissions(id,path,domain,entity,action,description,status)
SELECT '01JBOB86SLP'||lpad(ordinal::text,15,'0'),'/bob/sales-partner/'||action,
       'bob','sales-partner',action,description,'ENABLED'
FROM actions ON CONFLICT(path) DO NOTHING;

INSERT INTO app_role_permissions(role_id,permission_id,created_by)
SELECT role.id,permission.id,role.updated_by
FROM app_roles role JOIN app_permissions permission
  ON permission.domain='bob' AND permission.entity='sales-partner'
WHERE role.code='superadmin' ON CONFLICT DO NOTHING;

SELECT rpt_validate_current_reports();

-- +goose Down
-- +goose StatementBegin
DO $$ BEGIN RAISE EXCEPTION '00086 typed relationship cutover is irreversible'; END $$;
-- +goose StatementEnd

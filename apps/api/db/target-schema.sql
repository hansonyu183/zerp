CREATE TABLE app_users (
    id varchar(26) PRIMARY KEY,
    username varchar(64) NOT NULL,
    display_name varchar(128) NOT NULL,
    password_hash text NOT NULL,
    status varchar(16) NOT NULL CHECK (status IN ('ENABLED', 'DISABLED')),
    failed_signin_count integer NOT NULL DEFAULT 0 CHECK (failed_signin_count >= 0),
    locked_until timestamptz,
    password_changed_at timestamptz NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    created_by varchar(26),
    updated_at timestamptz NOT NULL DEFAULT now(),
    updated_by varchar(26),
    revision bigint NOT NULL DEFAULT 1 CHECK (revision >= 1),
    password_change_required boolean NOT NULL DEFAULT true
);
CREATE UNIQUE INDEX app_users_username_unique ON app_users(lower(username));

CREATE TABLE app_user_profiles (
    user_id varchar(26) PRIMARY KEY REFERENCES app_users(id) ON DELETE CASCADE,
    avatar_url varchar(500) NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    updated_by varchar(26)
);

CREATE TABLE app_permissions (
    id varchar(26) PRIMARY KEY,
    path varchar(255) NOT NULL UNIQUE,
    domain varchar(64) NOT NULL,
    entity varchar(64) NOT NULL,
    action varchar(64) NOT NULL,
    description text,
    status varchar(16) NOT NULL CHECK (status IN ('ENABLED', 'DISABLED')),
    created_at timestamptz NOT NULL DEFAULT now(),
    created_by varchar(26),
    updated_at timestamptz NOT NULL DEFAULT now(),
    updated_by varchar(26),
    revision bigint NOT NULL DEFAULT 1 CHECK (revision >= 1),
    menu_group varchar(128),
    menu_order integer,
    CHECK (path = '/' || domain || '/' || entity || '/' || action),
    CHECK (
        (menu_order IS NULL AND menu_group IS NULL)
        OR (menu_order IS NOT NULL AND menu_group IS NOT NULL AND action = 'query')
    )
);

CREATE TABLE app_roles (
    id varchar(26) PRIMARY KEY,
    code varchar(64) NOT NULL UNIQUE,
    name varchar(128) NOT NULL,
    description text,
    status varchar(16) NOT NULL CHECK (status IN ('ENABLED', 'DISABLED')),
    created_at timestamptz NOT NULL DEFAULT now(),
    created_by varchar(26),
    updated_at timestamptz NOT NULL DEFAULT now(),
    updated_by varchar(26),
    revision bigint NOT NULL DEFAULT 1 CHECK (revision >= 1)
);

CREATE TABLE app_role_permissions (
    role_id varchar(26) NOT NULL REFERENCES app_roles(id) ON DELETE CASCADE,
    permission_id varchar(26) NOT NULL REFERENCES app_permissions(id) ON DELETE RESTRICT,
    created_at timestamptz NOT NULL DEFAULT now(),
    created_by varchar(26),
    PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE app_user_roles (
    user_id varchar(26) NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
    role_id varchar(26) NOT NULL REFERENCES app_roles(id) ON DELETE RESTRICT,
    created_at timestamptz NOT NULL DEFAULT now(),
    created_by varchar(26),
    PRIMARY KEY (user_id, role_id)
);

CREATE TABLE app_sessions (
    id varchar(26) PRIMARY KEY,
    user_id varchar(26) NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
    token_hash bytea NOT NULL UNIQUE CHECK (octet_length(token_hash) = 32),
    csrf_token_hash bytea NOT NULL CHECK (octet_length(csrf_token_hash) = 32),
    created_at timestamptz NOT NULL DEFAULT now(),
    last_seen_at timestamptz NOT NULL,
    idle_expires_at timestamptz NOT NULL,
    absolute_expires_at timestamptz NOT NULL,
    revoked_at timestamptz,
    revoked_reason varchar(64),
    CHECK (idle_expires_at <= absolute_expires_at)
);

CREATE TABLE app_audit_events (
    id varchar(26) PRIMARY KEY,
    event_type varchar(64) NOT NULL,
    actor_user_id varchar(26) REFERENCES app_users(id),
    target_type varchar(64),
    target_id varchar(26),
    result varchar(16) NOT NULL CHECK (result IN ('SUCCESS', 'FAILURE')),
    request_id varchar(128),
    summary jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(summary) = 'object'),
    created_at timestamptz NOT NULL DEFAULT now(),
    created_by varchar(26)
);

CREATE TABLE app_role_code_counters (
    counter_key text PRIMARY KEY,
    next_value integer NOT NULL CHECK (next_value BETWEEN 0 AND 9999)
);
INSERT INTO app_role_code_counters(counter_key, next_value) VALUES ('role', 1);

CREATE TABLE app_system_parameters (
    parameter_key varchar(128) PRIMARY KEY,
    name varchar(128) NOT NULL,
    description text,
    value_type varchar(16) NOT NULL CHECK (value_type IN ('STRING', 'INTEGER', 'DECIMAL', 'BOOLEAN')),
    configured_value text NOT NULL,
    default_value text NOT NULL,
    editable boolean NOT NULL DEFAULT true,
    revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
    constraints jsonb,
    CHECK (constraints IS NULL OR jsonb_typeof(constraints) = 'object'),
    CHECK (NOT editable OR constraints IS NOT NULL),
    CHECK (parameter_key ~ '^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)+$')
);
INSERT INTO app_system_parameters(
    parameter_key, name, description, value_type, configured_value,
    default_value, editable, constraints
) VALUES
    ('app.enterprise-name', '企业名称', '登录页和登录后顶栏显示的当前使用单位名称', 'STRING', 'ZERP 演示企业', 'ZERP 演示企业', true, '{"required":true,"minLength":1,"maxLength":128,"minimum":null,"maximum":null,"allowedValues":[]}');

CREATE TABLE app_menu_settings (
    id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    menu_mode varchar(16) NOT NULL DEFAULT 'DEFAULT' CHECK (menu_mode IN ('DEFAULT', 'BUSINESS')),
    revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
    updated_at timestamptz NOT NULL DEFAULT now(),
    updated_by varchar(26) REFERENCES app_users(id)
);
INSERT INTO app_menu_settings(id) VALUES (1);

CREATE TABLE app_business_menu_items (
    id varchar(64) PRIMARY KEY,
    parent_id varchar(64) REFERENCES app_business_menu_items(id) ON DELETE CASCADE,
    item_type varchar(8) NOT NULL CHECK (item_type IN ('GROUP', 'ROUTE')),
    item_level smallint NOT NULL CHECK (item_level IN (1, 2)),
    sort_order integer NOT NULL CHECK (sort_order >= 0),
    display_name varchar(128) NOT NULL CHECK (btrim(display_name) <> ''),
    icon varchar(128),
    enabled boolean NOT NULL DEFAULT true,
    route_key varchar(128),
    permission_code varchar(256),
    created_at timestamptz NOT NULL DEFAULT now(),
    created_by varchar(26) REFERENCES app_users(id),
    updated_at timestamptz NOT NULL DEFAULT now(),
    updated_by varchar(26) REFERENCES app_users(id),
    CHECK (
        (item_type = 'GROUP' AND item_level = 1 AND parent_id IS NULL AND route_key IS NULL AND permission_code IS NULL)
        OR (item_type = 'ROUTE' AND item_level = 1 AND parent_id IS NULL AND route_key IS NOT NULL AND permission_code IS NOT NULL)
        OR (item_type = 'ROUTE' AND item_level = 2 AND parent_id IS NOT NULL AND route_key IS NOT NULL AND permission_code IS NOT NULL)
    )
);

CREATE TABLE object_number_counters (
    domain varchar(32) NOT NULL,
    entity varchar(64) NOT NULL,
    last_value integer NOT NULL DEFAULT 0 CHECK (last_value BETWEEN 0 AND 9999),
    PRIMARY KEY (domain, entity)
);

CREATE TABLE aux_objects (
    id varchar(26) PRIMARY KEY,
    entity varchar(32) NOT NULL CHECK (entity IN (
        'product-category', 'product-type', 'employee-category', 'department',
        'position', 'settlement-method', 'payment-method', 'dictionary-type',
        'dictionary-item', 'measurement-unit', 'income-expense-type', 'asset-category'
    )),
    code varchar(64) NOT NULL CHECK (code ~ '^[A-Z]{3}-[0-9]{4}$'),
    data jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(data) = 'object'),
    enabled boolean NOT NULL DEFAULT true,
    revision bigint NOT NULL DEFAULT 1 CHECK (revision >= 1),
    created_at timestamptz NOT NULL DEFAULT now(),
    created_by varchar(26) NOT NULL REFERENCES app_users(id),
    updated_at timestamptz NOT NULL DEFAULT now(),
    updated_by varchar(26) NOT NULL REFERENCES app_users(id),
    UNIQUE (entity, code)
);

CREATE TABLE aux_reference_facts (
    id varchar(26) PRIMARY KEY,
    aux_object_id varchar(26) NOT NULL REFERENCES aux_objects(id) ON DELETE CASCADE,
    source varchar(128) NOT NULL CHECK (btrim(source) <> '')
);
CREATE INDEX aux_reference_facts_object_idx ON aux_reference_facts(aux_object_id);

CREATE TABLE dcl_code_counters (
    entity varchar(64) PRIMARY KEY,
    next_value integer NOT NULL CHECK (next_value BETWEEN 1 AND 9999)
);
INSERT INTO dcl_code_counters(entity, next_value) VALUES ('warehouse', 1);

CREATE TABLE dcl_subjects (
    id varchar(26) PRIMARY KEY,
    entity varchar(64) NOT NULL CHECK (entity IN (
        'customer', 'supplier', 'other-unit', 'employee', 'sales-partner',
        'product', 'warehouse', 'vehicle', 'fund-account', 'operating-entity'
    )),
    code varchar(64) NOT NULL CONSTRAINT dcl_subjects_entity_code_ck CHECK (
        (entity = 'customer' AND code ~ '^CUS-[0-9]{4}$')
        OR (entity = 'supplier' AND code ~ '^SUP-[0-9]{4}$')
        OR (entity = 'other-unit' AND code ~ '^OTU-[0-9]{4}$')
        OR (entity = 'employee' AND code ~ '^EMP-[0-9]{4}$')
        OR (entity = 'sales-partner' AND code ~ '^SLP-[0-9]{4}$')
        OR (entity = 'product' AND code ~ '^PRD-[0-9]{4}$')
        OR (entity = 'warehouse' AND code ~ '^WHS-[0-9]{4}$')
        OR (entity = 'vehicle' AND code ~ '^VEH-[0-9]{4}$')
        OR (entity = 'fund-account' AND code ~ '^FAC-[0-9]{4}$')
        OR (entity = 'operating-entity' AND code ~ '^OPE-[0-9]{4}$')
    ),
    created_at timestamptz NOT NULL,
    created_by varchar(26) NOT NULL REFERENCES app_users(id)
);
CREATE UNIQUE INDEX dcl_subjects_entity_code_unique
    ON dcl_subjects(entity, upper(code));

CREATE TABLE approval_entries (
    id varchar(26) PRIMARY KEY,
    domain varchar(32) NOT NULL CHECK (domain = 'dcl'),
    entity varchar(64) NOT NULL CHECK (entity IN (
        'customer', 'supplier', 'other-unit', 'employee', 'sales-partner',
        'product', 'warehouse', 'vehicle', 'fund-account', 'operating-entity'
    )),
    subject_id varchar(26) NOT NULL REFERENCES dcl_subjects(id) ON DELETE CASCADE,
    version_no integer NOT NULL CHECK (version_no > 0),
    status varchar(16) NOT NULL CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED')),
    revision bigint NOT NULL CHECK (revision > 0),
    submitted_by varchar(26) NOT NULL REFERENCES app_users(id),
    submitted_at timestamptz NOT NULL,
    approved_by varchar(26) REFERENCES app_users(id),
    approved_at timestamptz,
    rejected_by varchar(26) REFERENCES app_users(id),
    rejected_at timestamptz,
    rejection_reason varchar(1000),
    updated_by varchar(26) NOT NULL REFERENCES app_users(id),
    updated_at timestamptz NOT NULL,
    UNIQUE (domain, entity, subject_id, version_no)
);

CREATE UNIQUE INDEX approval_entries_open_version_unique
    ON approval_entries(domain, entity, subject_id)
    WHERE status IN ('PENDING', 'REJECTED');
CREATE INDEX approval_entries_latest_approved_idx
    ON approval_entries(domain, entity, subject_id, version_no DESC)
    WHERE status = 'APPROVED';

-- BOB reads these owner tables directly.  The DCL typed snapshot is the only
-- current-data source: subject + highest APPROVED entry + matching snapshot.
CREATE TABLE dcl_customer_versions (
    approval_entry_id varchar(26) PRIMARY KEY REFERENCES approval_entries(id) ON DELETE CASCADE,
    kind varchar(32) NOT NULL,
    legal_identifier varchar(128),
    display_name varchar(200) NOT NULL,
    default_operating_entity_id varchar(26),
    enabled boolean NOT NULL
);

CREATE TABLE dcl_customer_subunit_roots (
    subunit_id varchar(26) PRIMARY KEY,
    customer_id varchar(26) NOT NULL REFERENCES dcl_subjects(id) ON DELETE CASCADE,
    code varchar(64) NOT NULL CHECK (btrim(code) <> ''),
    UNIQUE (customer_id, code)
);

CREATE TABLE dcl_customer_version_subunits (
    customer_approval_entry_id varchar(26) NOT NULL REFERENCES approval_entries(id) ON DELETE CASCADE,
    subunit_id varchar(26) NOT NULL REFERENCES dcl_customer_subunit_roots(subunit_id) ON DELETE RESTRICT,
    name varchar(200) NOT NULL,
    customer_type_id varchar(26),
    settlement_method_id varchar(26),
    primary_sales_attribution_type varchar(32),
    primary_sales_attribution_object_id varchar(26),
    enabled boolean NOT NULL,
    PRIMARY KEY (customer_approval_entry_id, subunit_id)
);

CREATE TABLE dcl_supplier_versions (
    approval_entry_id varchar(26) PRIMARY KEY REFERENCES approval_entries(id) ON DELETE CASCADE,
    kind varchar(32) NOT NULL,
    legal_name varchar(200) NOT NULL,
    display_name varchar(200) NOT NULL,
    legal_identifier varchar(128),
    default_operating_entity_id varchar(26),
    default_purchaser_employee_id varchar(26),
    enabled boolean NOT NULL
);
CREATE TABLE dcl_supplier_version_operating_entities (
    approval_entry_id varchar(26) NOT NULL REFERENCES dcl_supplier_versions(approval_entry_id) ON DELETE CASCADE,
    operating_entity_id varchar(26) NOT NULL,
    PRIMARY KEY (approval_entry_id, operating_entity_id)
);

CREATE TABLE dcl_other_unit_versions (
    approval_entry_id varchar(26) PRIMARY KEY REFERENCES approval_entries(id) ON DELETE CASCADE,
    kind varchar(32) NOT NULL,
    legal_name varchar(200) NOT NULL,
    display_name varchar(200) NOT NULL,
    legal_identifier varchar(128),
    default_operating_entity_id varchar(26),
    enabled boolean NOT NULL
);
CREATE TABLE dcl_other_unit_version_operating_entities (
    approval_entry_id varchar(26) NOT NULL REFERENCES dcl_other_unit_versions(approval_entry_id) ON DELETE CASCADE,
    operating_entity_id varchar(26) NOT NULL,
    PRIMARY KEY (approval_entry_id, operating_entity_id)
);

CREATE TABLE dcl_employee_versions (
    approval_entry_id varchar(26) PRIMARY KEY REFERENCES approval_entries(id) ON DELETE CASCADE,
    display_name varchar(200) NOT NULL,
    employee_category_id varchar(26),
    department_id varchar(26),
    position_id varchar(26),
    operating_entity_id varchar(26),
    enabled boolean NOT NULL
);

CREATE TABLE dcl_sales_partner_versions (
    approval_entry_id varchar(26) PRIMARY KEY REFERENCES approval_entries(id) ON DELETE CASCADE,
    kind varchar(32) NOT NULL,
    legal_name varchar(200) NOT NULL,
    display_name varchar(200) NOT NULL,
    legal_identifier varchar(128),
    default_operating_entity_id varchar(26),
    enabled boolean NOT NULL
);
CREATE TABLE dcl_sales_partner_version_operating_entities (
    approval_entry_id varchar(26) NOT NULL REFERENCES dcl_sales_partner_versions(approval_entry_id) ON DELETE CASCADE,
    operating_entity_id varchar(26) NOT NULL,
    PRIMARY KEY (approval_entry_id, operating_entity_id)
);

CREATE TABLE dcl_product_versions (
    approval_entry_id varchar(26) PRIMARY KEY REFERENCES approval_entries(id) ON DELETE CASCADE,
    name varchar(200) NOT NULL,
    category_id varchar(26),
    product_type_id varchar(26),
    behavior_profile varchar(32),
    default_input_unit_id varchar(26),
    pricing_unit_id varchar(26),
    enabled boolean NOT NULL
);

CREATE TABLE dcl_warehouse_versions (
    approval_entry_id varchar(26) PRIMARY KEY REFERENCES approval_entries(id) ON DELETE CASCADE,
    name varchar(200) NOT NULL,
    address varchar(500),
    contact_name varchar(100),
    contact_phone varchar(32),
    manager_employee_id varchar(26),
    manager_employee_approval_entry_id varchar(26),
    manager_employee_code varchar(64),
    manager_employee_name varchar(200),
    remark varchar(1000),
    enabled boolean NOT NULL
);

CREATE TABLE dcl_vehicle_versions (
    approval_entry_id varchar(26) PRIMARY KEY REFERENCES approval_entries(id) ON DELETE CASCADE,
    name varchar(200) NOT NULL,
    plate_number varchar(64),
    vehicle_type_object_id varchar(26),
    carrier_affiliation_type varchar(16),
    carrier_operating_entity_id varchar(26),
    carrier_other_unit_object_id varchar(26),
    bulk_liquid_capable boolean NOT NULL DEFAULT false,
    enabled boolean NOT NULL
);

CREATE TABLE dcl_fund_account_versions (
    approval_entry_id varchar(26) PRIMARY KEY REFERENCES approval_entries(id) ON DELETE CASCADE,
    name varchar(200) NOT NULL,
    currency varchar(16),
    account_name varchar(200),
    account_number varchar(128),
    bank_name varchar(200),
    operating_entity_id varchar(26),
    enabled boolean NOT NULL
);

CREATE TABLE dcl_operating_entity_versions (
    approval_entry_id varchar(26) PRIMARY KEY REFERENCES approval_entries(id) ON DELETE CASCADE,
    legal_name varchar(200) NOT NULL,
    legal_identifier varchar(128),
    enabled boolean NOT NULL
);

CREATE TABLE approval_events (
    id varchar(26) PRIMARY KEY,
    entry_id varchar(26) NOT NULL,
    domain varchar(32) NOT NULL,
    entity varchar(64) NOT NULL,
    subject_id varchar(26) NOT NULL,
    version_no integer NOT NULL,
    action varchar(16) NOT NULL CHECK (
        action IN ('SUBMITTED', 'APPROVED', 'REJECTED', 'UNREJECTED', 'UNAPPROVED', 'DELETED')
    ),
    from_status varchar(16),
    to_status varchar(16),
    from_revision bigint,
    to_revision bigint,
    actor_id varchar(26) NOT NULL REFERENCES app_users(id),
    reason varchar(1000),
    request_id varchar(128) NOT NULL,
    created_at timestamptz NOT NULL
);
CREATE INDEX approval_events_entry_created_idx
    ON approval_events(entry_id, created_at, id);

CREATE TABLE dcl_warehouse_idempotency (
    idempotency_key varchar(128) PRIMARY KEY,
    request_hash varchar(64) NOT NULL,
    subject_id varchar(26) NOT NULL,
    submission_id varchar(26) NOT NULL,
    response jsonb NOT NULL,
    created_at timestamptz NOT NULL
);

CREATE TABLE dcl_warehouse_manager_reference_facts (
    employee_id varchar(26) PRIMARY KEY,
    latest_approved_entry_id varchar(26) NOT NULL,
    code varchar(64) NOT NULL,
    name varchar(200) NOT NULL,
    enabled boolean NOT NULL
);

-- These tables are the isolated Warehouse slice's typed input facts. Later
-- slices replace their fixture writers with their owning transaction-connected
-- domains; the Warehouse service only reads them.
CREATE TABLE dcl_warehouse_reference_facts (
    id varchar(26) PRIMARY KEY,
    warehouse_id varchar(26) NOT NULL,
    approval_entry_id varchar(26) NOT NULL,
    domain varchar(32) NOT NULL,
    entity varchar(64) NOT NULL,
    business_id varchar(26) NOT NULL,
    business_code varchar(64) NOT NULL
);
CREATE INDEX dcl_warehouse_reference_facts_entry_idx
    ON dcl_warehouse_reference_facts(approval_entry_id);

CREATE TABLE dcl_warehouse_usage_facts (
    id varchar(26) PRIMARY KEY,
    warehouse_id varchar(26) NOT NULL,
    kind varchar(16) NOT NULL CHECK (kind IN ('INVENTORY', 'DOCUMENT', 'SOURCE', 'REFERENCE')),
    entity varchar(64) NOT NULL,
    business_id varchar(26) NOT NULL,
    business_code varchar(64) NOT NULL,
    quantity_micros bigint,
    created_at timestamptz NOT NULL
);
CREATE INDEX dcl_warehouse_usage_facts_warehouse_idx
    ON dcl_warehouse_usage_facts(warehouse_id);

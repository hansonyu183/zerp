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
INSERT INTO dcl_code_counters(entity, next_value) VALUES
    ('customer', 1),
    ('supplier', 1),
    ('other-unit', 1),
    ('employee', 1),
    ('sales-partner', 1),
    ('product', 1),
    ('warehouse', 1),
    ('vehicle', 1),
    ('fund-account', 1),
    ('operating-entity', 1),
    ('rpt-definition', 1),
    ('wfl-process-definition', 1);

CREATE TABLE dcl_subjects (
    id varchar(26) PRIMARY KEY,
    entity varchar(64) NOT NULL CHECK (entity IN (
        'customer', 'supplier', 'other-unit', 'employee', 'sales-partner',
        'product', 'warehouse', 'vehicle', 'fund-account', 'operating-entity',
        'acc-mapping', 'rpt-definition', 'wfl-process-definition'
    )),
    code varchar(64) CONSTRAINT dcl_subjects_entity_code_ck CHECK (
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
        OR (entity = 'acc-mapping' AND code IS NULL)
        OR (entity = 'rpt-definition' AND code ~ '^rpt-[0-9]{6}$')
        OR (entity = 'wfl-process-definition' AND code ~ '^wfl-[0-9]{6}$')
    ),
    created_at timestamptz NOT NULL,
    created_by varchar(26) NOT NULL REFERENCES app_users(id)
);
CREATE UNIQUE INDEX dcl_subjects_entity_code_unique
    ON dcl_subjects(entity, upper(code));

CREATE TABLE approval_entries (
    id varchar(26) PRIMARY KEY,
    domain varchar(32) NOT NULL,
    entity varchar(64) NOT NULL,
    subject_id varchar(26) NOT NULL,
    version_no integer CHECK (version_no IS NULL OR version_no > 0),
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
CREATE UNIQUE INDEX approval_entries_unversioned_subject_unique
    ON approval_entries(domain, entity, subject_id)
    WHERE version_no IS NULL;
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
    legal_name varchar(200),
    default_operating_entity_id varchar(26),
    default_operating_entity_approval_entry_id varchar(26),
    default_operating_entity_code varchar(64),
    default_operating_entity_name varchar(200),
    phone varchar(32),
    email varchar(320),
    address varchar(500),
    invoice_title varchar(200),
    invoice_address varchar(500),
    invoice_phone varchar(32),
    invoice_bank varchar(200),
    invoice_account varchar(128),
    remittance_profiles jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(remittance_profiles) = 'array'),
    tax_attachments jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(tax_attachments) = 'array'),
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
    contact_name varchar(100),
    contact_phone varchar(32),
    business_address varchar(500),
    customer_type_id varchar(26),
    settlement_method_id varchar(26),
    primary_sales_attribution_type varchar(32),
    primary_sales_attribution_object_id varchar(26),
    primary_sales_attribution_approval_entry_id varchar(26),
    primary_sales_attribution_code varchar(64),
    primary_sales_attribution_name varchar(200),
    sales_attribution_snapshot jsonb,
    settlement_snapshot jsonb,
    payment_snapshot jsonb,
    transport_snapshot jsonb,
    pricing_snapshot jsonb,
    credit_limits jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(credit_limits) = 'array'),
    internal_reminder varchar(1000),
    default_order_remark varchar(1000),
    business_attachments jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(business_attachments) = 'array'),
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
    default_purchaser_approval_entry_id varchar(26),
    default_purchaser_code varchar(64),
    default_purchaser_name varchar(200),
    contact_name varchar(100),
    contact_phone varchar(32),
    address varchar(500),
    remark varchar(1000),
    default_operating_entity_reference jsonb,
    settlement_method_snapshot jsonb,
    default_purchaser_snapshot jsonb,
    enabled boolean NOT NULL
);
CREATE TABLE dcl_supplier_version_operating_entities (
    approval_entry_id varchar(26) NOT NULL REFERENCES dcl_supplier_versions(approval_entry_id) ON DELETE CASCADE,
    operating_entity_id varchar(26) NOT NULL,
    operating_entity_approval_entry_id varchar(26) NOT NULL,
    operating_entity_code varchar(64) NOT NULL,
    operating_entity_name varchar(200) NOT NULL,
    PRIMARY KEY (approval_entry_id, operating_entity_id)
);

CREATE TABLE dcl_other_unit_versions (
    approval_entry_id varchar(26) PRIMARY KEY REFERENCES approval_entries(id) ON DELETE CASCADE,
    kind varchar(32) NOT NULL,
    legal_name varchar(200) NOT NULL,
    display_name varchar(200) NOT NULL,
    legal_identifier varchar(128),
    default_operating_entity_id varchar(26),
    contact_name varchar(100),
    contact_phone varchar(32),
    address varchar(500),
    remark varchar(1000),
    default_operating_entity_reference jsonb,
    settlement_method_snapshot jsonb,
    enabled boolean NOT NULL
);
CREATE TABLE dcl_other_unit_version_operating_entities (
    approval_entry_id varchar(26) NOT NULL REFERENCES dcl_other_unit_versions(approval_entry_id) ON DELETE CASCADE,
    operating_entity_id varchar(26) NOT NULL,
    operating_entity_approval_entry_id varchar(26) NOT NULL,
    operating_entity_code varchar(64) NOT NULL,
    operating_entity_name varchar(200) NOT NULL,
    PRIMARY KEY (approval_entry_id, operating_entity_id)
);

CREATE TABLE dcl_employee_versions (
    approval_entry_id varchar(26) PRIMARY KEY REFERENCES approval_entries(id) ON DELETE CASCADE,
    display_name varchar(200) NOT NULL,
    legal_name varchar(200),
    legal_identifier varchar(128),
    employee_category_id varchar(26),
    department_id varchar(26),
    position_id varchar(26),
    operating_entity_id varchar(26),
    operating_entity_approval_entry_id varchar(26),
    operating_entity_code varchar(64),
    operating_entity_name varchar(200),
    work_phone varchar(32),
    work_email varchar(320),
    hired_on date,
    remark varchar(1000),
    source_snapshots jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(source_snapshots) = 'object'),
    enabled boolean NOT NULL
);

CREATE TABLE dcl_sales_partner_versions (
    approval_entry_id varchar(26) PRIMARY KEY REFERENCES approval_entries(id) ON DELETE CASCADE,
    kind varchar(32) NOT NULL,
    legal_name varchar(200) NOT NULL,
    display_name varchar(200) NOT NULL,
    legal_identifier varchar(128),
    default_operating_entity_id varchar(26),
    capabilities jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(capabilities) = 'array'),
    contact_name varchar(100),
    contact_phone varchar(32),
    address varchar(500),
    remark varchar(1000),
    default_operating_entity_reference jsonb,
    enabled boolean NOT NULL
);
CREATE TABLE dcl_sales_partner_version_operating_entities (
    approval_entry_id varchar(26) NOT NULL REFERENCES dcl_sales_partner_versions(approval_entry_id) ON DELETE CASCADE,
    operating_entity_id varchar(26) NOT NULL,
    operating_entity_approval_entry_id varchar(26) NOT NULL,
    operating_entity_code varchar(64) NOT NULL,
    operating_entity_name varchar(200) NOT NULL,
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
    specification varchar(200),
    model varchar(200),
    barcode varchar(128),
    source_snapshots jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(source_snapshots) = 'object'),
    unit_conversions jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(unit_conversions) = 'array'),
    default_packaging_snapshot jsonb,
    recyclable boolean NOT NULL DEFAULT false,
    fixed_formula jsonb,
    remark varchar(1000),
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
    vehicle_type_snapshot jsonb,
    carrier_affiliation_type varchar(16),
    carrier_operating_entity_id varchar(26),
    carrier_operating_entity_approval_entry_id varchar(26),
    carrier_operating_entity_code varchar(64),
    carrier_operating_entity_name varchar(200),
    carrier_other_unit_object_id varchar(26),
    carrier_other_unit_approval_entry_id varchar(26),
    carrier_other_unit_code varchar(64),
    carrier_other_unit_name varchar(200),
    carrier_snapshot jsonb,
    vin varchar(64),
    engine_number varchar(64),
    rated_load_micros bigint,
    bulk_liquid_capable boolean NOT NULL DEFAULT false,
    remark varchar(1000),
    enabled boolean NOT NULL
);

CREATE TABLE dcl_fund_account_versions (
    approval_entry_id varchar(26) PRIMARY KEY REFERENCES approval_entries(id) ON DELETE CASCADE,
    name varchar(200) NOT NULL,
    currency varchar(16),
    account_name varchar(200),
    account_number varchar(128),
    bank_name varchar(200),
    branch_name varchar(200),
    operating_entity_id varchar(26),
    operating_entity_approval_entry_id varchar(26),
    operating_entity_code varchar(64),
    operating_entity_name varchar(200),
    operating_entity_snapshot jsonb,
    remark varchar(1000),
    enabled boolean NOT NULL
);

CREATE TABLE dcl_operating_entity_versions (
    approval_entry_id varchar(26) PRIMARY KEY REFERENCES approval_entries(id) ON DELETE CASCADE,
    legal_name varchar(200) NOT NULL,
    legal_identifier varchar(128),
    registered_address varchar(500) NOT NULL,
    contact_name varchar(100) NOT NULL,
    contact_phone varchar(32) NOT NULL,
    invoice_title varchar(200) NOT NULL,
    invoice_address varchar(500) NOT NULL,
    invoice_phone varchar(32) NOT NULL,
    invoice_bank varchar(200) NOT NULL,
    invoice_account varchar(128) NOT NULL,
    remark varchar(1000),
    enabled boolean NOT NULL
);

CREATE TABLE dcl_acc_mapping_versions (
    approval_entry_id varchar(26) PRIMARY KEY REFERENCES approval_entries(id) ON DELETE CASCADE,
    book_id varchar(26) NOT NULL,
    vou_entity_id varchar(26) NOT NULL,
    book_snapshot jsonb NOT NULL CHECK (jsonb_typeof(book_snapshot) = 'object'),
    vou_entity_snapshot jsonb NOT NULL CHECK (jsonb_typeof(vou_entity_snapshot) = 'object'),
    default_result varchar(16) NOT NULL CHECK (default_result IN ('POST', 'UN_POST')),
    mapping_definition jsonb NOT NULL CHECK (jsonb_typeof(mapping_definition) = 'object')
);

CREATE TABLE dcl_rpt_definition_versions (
    approval_entry_id varchar(26) PRIMARY KEY REFERENCES approval_entries(id) ON DELETE CASCADE,
    name varchar(200) NOT NULL,
    description varchar(1000) NOT NULL,
    enabled boolean NOT NULL,
    sql_text text NOT NULL,
    parameters jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(parameters) = 'array'),
    columns jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(columns) = 'array')
);

CREATE TABLE rpt_definition_validities (
    approval_entry_id varchar(26) PRIMARY KEY REFERENCES approval_entries(id) ON DELETE CASCADE,
    status varchar(16) NOT NULL CHECK (status IN ('VALID', 'INVALID')),
    diagnostic text,
    validated_at timestamptz NOT NULL,
    validated_by varchar(26) NOT NULL REFERENCES app_users(id)
);

-- ACC owns these typed reference facts in the next cutover slice. DCL only
-- revalidates them while accepting an ACC mapping definition.
CREATE TABLE dcl_acc_book_facts (
    id varchar(26) PRIMARY KEY,
    code varchar(64) NOT NULL,
    name varchar(200) NOT NULL,
    enabled boolean NOT NULL
);

CREATE TABLE dcl_acc_vou_entity_facts (
    id varchar(26) PRIMARY KEY,
    code varchar(64) NOT NULL,
    name varchar(200) NOT NULL,
    field_catalog jsonb NOT NULL DEFAULT '{"headerFields":[],"lineFields":[]}'::jsonb
        CHECK (
            jsonb_typeof(field_catalog) = 'object'
            AND field_catalog ? 'headerFields'
            AND field_catalog ? 'lineFields'
            AND jsonb_typeof(field_catalog->'headerFields') = 'array'
            AND jsonb_typeof(field_catalog->'lineFields') = 'array'
        ),
    enabled boolean NOT NULL
);

-- Narrow ACC catalog facts used only to validate a submitted MappingDefinition.
-- They are not ACC postings, current mappings, or a transactional #365 surface.
CREATE TABLE dcl_acc_subject_facts (
    id varchar(26) PRIMARY KEY,
    book_id varchar(26) NOT NULL REFERENCES dcl_acc_book_facts(id) ON DELETE RESTRICT,
    code varchar(64) NOT NULL,
    name varchar(200) NOT NULL,
    leaf boolean NOT NULL,
    enabled boolean NOT NULL,
    required_dimensions jsonb NOT NULL DEFAULT '[]'::jsonb
        CHECK (jsonb_typeof(required_dimensions) = 'array')
);

CREATE TABLE dcl_acc_mapping_subject_usages (
    approval_entry_id varchar(26) NOT NULL REFERENCES approval_entries(id) ON DELETE CASCADE,
    subject_id varchar(26) NOT NULL REFERENCES dcl_acc_subject_facts(id),
    PRIMARY KEY (approval_entry_id, subject_id)
);

-- #365-owned VOU/document writers persist exact mapping-version consumption
-- here. DCL only reads this typed fact before unapproving a mapping version.
CREATE TABLE dcl_acc_mapping_reference_facts (
    mapping_approval_entry_id varchar(26) NOT NULL REFERENCES approval_entries(id) ON DELETE CASCADE,
    document_type varchar(64) NOT NULL,
    document_id varchar(64) NOT NULL,
    PRIMARY KEY (mapping_approval_entry_id, document_type, document_id)
);

CREATE TABLE approval_events (
    id varchar(26) PRIMARY KEY,
    entry_id varchar(26) NOT NULL,
    domain varchar(32) NOT NULL,
    entity varchar(64) NOT NULL,
    subject_id varchar(26) NOT NULL,
    version_no integer,
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

CREATE TABLE dcl_archive_idempotency (
    entity varchar(64) NOT NULL,
    idempotency_key varchar(128) NOT NULL,
    request_hash varchar(64) NOT NULL,
    subject_id varchar(26) NOT NULL,
    submission_id varchar(26) NOT NULL,
    response jsonb NOT NULL,
    created_at timestamptz NOT NULL,
    PRIMARY KEY (entity, idempotency_key)
);

CREATE TABLE dcl_customer_attachment_staging (
    id varchar(26) PRIMARY KEY,
    file_id varchar(26) NOT NULL,
    owner_user_id varchar(26) NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
    file_name varchar(255) NOT NULL,
    mime_type varchar(128) NOT NULL,
    size_bytes integer NOT NULL CHECK (size_bytes BETWEEN 1 AND 10485760),
    digest varchar(64) NOT NULL CHECK (digest ~ '^[0-9a-f]{64}$'),
    storage_key varchar(512) NOT NULL UNIQUE,
    created_at timestamptz NOT NULL,
    expires_at timestamptz NOT NULL,
    CHECK (expires_at > created_at)
);

CREATE TABLE dcl_customer_attachments (
    approval_entry_id varchar(26) NOT NULL REFERENCES approval_entries(id) ON DELETE CASCADE,
    file_id varchar(26) NOT NULL,
    file_name varchar(255) NOT NULL,
    mime_type varchar(128) NOT NULL,
    size_bytes integer NOT NULL CHECK (size_bytes BETWEEN 1 AND 10485760),
    digest varchar(64) NOT NULL CHECK (digest ~ '^[0-9a-f]{64}$'),
    storage_key varchar(512) NOT NULL,
    created_at timestamptz NOT NULL,
    PRIMARY KEY (approval_entry_id, file_id)
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

-- #365 transactional cores. Business decisions stay in TypeScript Domain
-- Services; these tables preserve facts, identities, CAS revisions and locks.
CREATE TABLE acc_books (
    id varchar(26) PRIMARY KEY,
    code varchar(16) NOT NULL UNIQUE CHECK (code ~ '^ACC-[0-9]{4}$'),
    name varchar(200) NOT NULL CHECK (btrim(name) <> ''),
    description varchar(1000) NOT NULL DEFAULT '',
    start_month varchar(7) NOT NULL CHECK (start_month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
    base_currency varchar(3) NOT NULL CHECK (base_currency ~ '^[A-Z]{3}$'),
    control_book boolean NOT NULL,
    revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
    created_at timestamptz NOT NULL,
    created_by varchar(26) NOT NULL REFERENCES app_users(id),
    updated_at timestamptz NOT NULL,
    updated_by varchar(26) NOT NULL REFERENCES app_users(id)
);
CREATE UNIQUE INDEX acc_books_single_control_book ON acc_books(control_book)
    WHERE control_book;

CREATE TABLE acc_book_access (
    book_id varchar(26) NOT NULL REFERENCES acc_books(id) ON DELETE CASCADE,
    user_id varchar(26) NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
    can_query boolean NOT NULL,
    can_operate boolean NOT NULL,
    PRIMARY KEY (book_id, user_id),
    CHECK (can_query OR can_operate)
);

CREATE TABLE acc_subjects (
    id varchar(26) PRIMARY KEY,
    book_id varchar(26) NOT NULL REFERENCES acc_books(id) ON DELETE RESTRICT,
    code varchar(64) NOT NULL,
    name varchar(200) NOT NULL CHECK (btrim(name) <> ''),
    parent_id varchar(26) REFERENCES acc_subjects(id) ON DELETE RESTRICT,
    balance_direction varchar(8) NOT NULL CHECK (balance_direction IN ('DEBIT', 'CREDIT')),
    enabled boolean NOT NULL,
    required_dimensions jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(required_dimensions) = 'array'),
    inventory_quantity boolean NOT NULL DEFAULT false,
    settlement_purpose varchar(32) NOT NULL DEFAULT 'NONE',
    revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
    created_at timestamptz NOT NULL,
    created_by varchar(26) NOT NULL REFERENCES app_users(id),
    updated_at timestamptz NOT NULL,
    updated_by varchar(26) NOT NULL REFERENCES app_users(id),
    UNIQUE (book_id, code)
);

CREATE TABLE acc_opening_snapshots (
    approval_entry_id varchar(26) PRIMARY KEY REFERENCES approval_entries(id) ON DELETE CASCADE,
    book_id varchar(26) NOT NULL REFERENCES acc_books(id) ON DELETE RESTRICT,
    payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object')
);

CREATE TABLE acc_periods (
    book_id varchar(26) NOT NULL REFERENCES acc_books(id) ON DELETE CASCADE,
    period_month varchar(7) NOT NULL CHECK (period_month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
    locked boolean NOT NULL DEFAULT false,
    revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
    updated_at timestamptz NOT NULL,
    updated_by varchar(26) NOT NULL REFERENCES app_users(id),
    PRIMARY KEY (book_id, period_month)
);

CREATE TABLE acc_period_balances (
    book_id varchar(26) NOT NULL REFERENCES acc_books(id) ON DELETE CASCADE,
    period_month varchar(7) NOT NULL CHECK (period_month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
    subject_id varchar(26) NOT NULL REFERENCES acc_subjects(id) ON DELETE RESTRICT,
    currency varchar(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
    dimensions jsonb NOT NULL CHECK (jsonb_typeof(dimensions) = 'object'),
    dimension_key text NOT NULL,
    opening_balance numeric(24, 8) NOT NULL,
    debit_amount numeric(24, 8) NOT NULL,
    credit_amount numeric(24, 8) NOT NULL,
    closing_balance numeric(24, 8) NOT NULL,
    created_at timestamptz NOT NULL,
    PRIMARY KEY (book_id, period_month, subject_id, currency, dimension_key)
);

CREATE TABLE vou_documents (
    id varchar(26) PRIMARY KEY,
    entity varchar(64) NOT NULL,
    document_no varchar(32) NOT NULL UNIQUE,
    stable_revision bigint NOT NULL DEFAULT 1 CHECK (stable_revision > 0),
    created_at timestamptz NOT NULL,
    created_by varchar(26) NOT NULL REFERENCES app_users(id)
);
CREATE INDEX vou_documents_entity_number_idx ON vou_documents(entity, document_no);

-- Each VOU entity owns a distinct header.  Rich wire data is decomposed into
-- typed business-family child relations below; VOU has no JSON payload store.
CREATE TABLE vou_sale_pricing_details (
    approval_entry_id varchar(26) PRIMARY KEY REFERENCES approval_entries(id) ON DELETE CASCADE,
    document_id varchar(26) NOT NULL UNIQUE REFERENCES vou_documents(id) ON DELETE RESTRICT,
    business_date date NOT NULL,
    currency varchar(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
    total_amount_minor bigint NOT NULL,
    parent_entity varchar(64),
    parent_document_id varchar(26) REFERENCES vou_documents(id) ON DELETE RESTRICT,
    CHECK ((parent_entity IS NULL) = (parent_document_id IS NULL))
);

CREATE TABLE vou_sale_order_details (
    approval_entry_id varchar(26) PRIMARY KEY REFERENCES approval_entries(id) ON DELETE CASCADE,
    document_id varchar(26) NOT NULL UNIQUE REFERENCES vou_documents(id) ON DELETE RESTRICT,
    business_date date NOT NULL,
    currency varchar(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
    total_amount_minor bigint NOT NULL,
    credit_limit numeric(24, 8),
    credit_occupancy_before numeric(24, 8),
    credit_order_amount numeric(24, 8),
    credit_over_amount numeric(24, 8),
    credit_override_reason text,
    credit_override_actor_id varchar(26) REFERENCES app_users(id),
    parent_entity varchar(64),
    parent_document_id varchar(26) REFERENCES vou_documents(id) ON DELETE RESTRICT,
    CHECK ((parent_entity IS NULL) = (parent_document_id IS NULL))
);

CREATE TABLE vou_sale_outbound_details (
    approval_entry_id varchar(26) PRIMARY KEY REFERENCES approval_entries(id) ON DELETE CASCADE,
    document_id varchar(26) NOT NULL UNIQUE REFERENCES vou_documents(id) ON DELETE RESTRICT,
    business_date date NOT NULL,
    currency varchar(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
    total_amount_minor bigint NOT NULL,
    parent_entity varchar(64),
    parent_document_id varchar(26) REFERENCES vou_documents(id) ON DELETE RESTRICT,
    CHECK ((parent_entity IS NULL) = (parent_document_id IS NULL))
);

CREATE TABLE vou_sale_delivery_details (
    approval_entry_id varchar(26) PRIMARY KEY REFERENCES approval_entries(id) ON DELETE CASCADE,
    document_id varchar(26) NOT NULL UNIQUE REFERENCES vou_documents(id) ON DELETE RESTRICT,
    business_date date NOT NULL,
    currency varchar(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
    total_amount_minor bigint NOT NULL,
    parent_entity varchar(64),
    parent_document_id varchar(26) REFERENCES vou_documents(id) ON DELETE RESTRICT,
    CHECK ((parent_entity IS NULL) = (parent_document_id IS NULL))
);

CREATE TABLE vou_sale_signoff_details (
    approval_entry_id varchar(26) PRIMARY KEY REFERENCES approval_entries(id) ON DELETE CASCADE,
    document_id varchar(26) NOT NULL UNIQUE REFERENCES vou_documents(id) ON DELETE RESTRICT,
    business_date date NOT NULL,
    currency varchar(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
    total_amount_minor bigint NOT NULL,
    expected_solvent_containers integer NOT NULL DEFAULT 0 CHECK (expected_solvent_containers >= 0),
    expected_resin_containers integer NOT NULL DEFAULT 0 CHECK (expected_resin_containers >= 0),
    returned_solvent_containers integer NOT NULL DEFAULT 0 CHECK (returned_solvent_containers >= 0),
    returned_resin_containers integer NOT NULL DEFAULT 0 CHECK (returned_resin_containers >= 0),
    container_difference_reason text,
    parent_entity varchar(64),
    parent_document_id varchar(26) REFERENCES vou_documents(id) ON DELETE RESTRICT,
    CHECK ((parent_entity IS NULL) = (parent_document_id IS NULL))
);

CREATE TABLE vou_sale_return_details (
    approval_entry_id varchar(26) PRIMARY KEY REFERENCES approval_entries(id) ON DELETE CASCADE,
    document_id varchar(26) NOT NULL UNIQUE REFERENCES vou_documents(id) ON DELETE RESTRICT,
    business_date date NOT NULL,
    currency varchar(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
    total_amount_minor bigint NOT NULL,
    parent_entity varchar(64),
    parent_document_id varchar(26) REFERENCES vou_documents(id) ON DELETE RESTRICT,
    CHECK ((parent_entity IS NULL) = (parent_document_id IS NULL))
);

CREATE TABLE vou_purchase_order_details (
    approval_entry_id varchar(26) PRIMARY KEY REFERENCES approval_entries(id) ON DELETE CASCADE,
    document_id varchar(26) NOT NULL UNIQUE REFERENCES vou_documents(id) ON DELETE RESTRICT,
    business_date date NOT NULL,
    currency varchar(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
    total_amount_minor bigint NOT NULL,
    parent_entity varchar(64),
    parent_document_id varchar(26) REFERENCES vou_documents(id) ON DELETE RESTRICT,
    CHECK ((parent_entity IS NULL) = (parent_document_id IS NULL))
);

CREATE TABLE vou_purchase_inbound_details (
    approval_entry_id varchar(26) PRIMARY KEY REFERENCES approval_entries(id) ON DELETE CASCADE,
    document_id varchar(26) NOT NULL UNIQUE REFERENCES vou_documents(id) ON DELETE RESTRICT,
    business_date date NOT NULL,
    currency varchar(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
    total_amount_minor bigint NOT NULL,
    parent_entity varchar(64),
    parent_document_id varchar(26) REFERENCES vou_documents(id) ON DELETE RESTRICT,
    CHECK ((parent_entity IS NULL) = (parent_document_id IS NULL))
);

CREATE TABLE vou_purchase_return_details (
    approval_entry_id varchar(26) PRIMARY KEY REFERENCES approval_entries(id) ON DELETE CASCADE,
    document_id varchar(26) NOT NULL UNIQUE REFERENCES vou_documents(id) ON DELETE RESTRICT,
    business_date date NOT NULL,
    currency varchar(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
    total_amount_minor bigint NOT NULL,
    parent_entity varchar(64),
    parent_document_id varchar(26) REFERENCES vou_documents(id) ON DELETE RESTRICT,
    CHECK ((parent_entity IS NULL) = (parent_document_id IS NULL))
);

CREATE TABLE vou_purchase_inquiry_details (
    approval_entry_id varchar(26) PRIMARY KEY REFERENCES approval_entries(id) ON DELETE CASCADE,
    document_id varchar(26) NOT NULL UNIQUE REFERENCES vou_documents(id) ON DELETE RESTRICT,
    business_date date NOT NULL,
    currency varchar(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
    total_amount_minor bigint NOT NULL,
    parent_entity varchar(64),
    parent_document_id varchar(26) REFERENCES vou_documents(id) ON DELETE RESTRICT,
    CHECK ((parent_entity IS NULL) = (parent_document_id IS NULL))
);

CREATE TABLE vou_order_production_details (
    approval_entry_id varchar(26) PRIMARY KEY REFERENCES approval_entries(id) ON DELETE CASCADE,
    document_id varchar(26) NOT NULL UNIQUE REFERENCES vou_documents(id) ON DELETE RESTRICT,
    business_date date NOT NULL,
    currency varchar(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
    total_amount_minor bigint NOT NULL,
    parent_entity varchar(64),
    parent_document_id varchar(26) REFERENCES vou_documents(id) ON DELETE RESTRICT,
    CHECK ((parent_entity IS NULL) = (parent_document_id IS NULL))
);

CREATE TABLE vou_self_production_details (
    approval_entry_id varchar(26) PRIMARY KEY REFERENCES approval_entries(id) ON DELETE CASCADE,
    document_id varchar(26) NOT NULL UNIQUE REFERENCES vou_documents(id) ON DELETE RESTRICT,
    business_date date NOT NULL,
    currency varchar(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
    total_amount_minor bigint NOT NULL,
    parent_entity varchar(64),
    parent_document_id varchar(26) REFERENCES vou_documents(id) ON DELETE RESTRICT,
    CHECK ((parent_entity IS NULL) = (parent_document_id IS NULL))
);

CREATE TABLE vou_inventory_count_details (
    approval_entry_id varchar(26) PRIMARY KEY REFERENCES approval_entries(id) ON DELETE CASCADE,
    document_id varchar(26) NOT NULL UNIQUE REFERENCES vou_documents(id) ON DELETE RESTRICT,
    business_date date NOT NULL,
    currency varchar(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
    total_amount_minor bigint NOT NULL,
    parent_entity varchar(64),
    parent_document_id varchar(26) REFERENCES vou_documents(id) ON DELETE RESTRICT,
    CHECK ((parent_entity IS NULL) = (parent_document_id IS NULL))
);

CREATE TABLE vou_sales_receipt_details (
    approval_entry_id varchar(26) PRIMARY KEY REFERENCES approval_entries(id) ON DELETE CASCADE,
    document_id varchar(26) NOT NULL UNIQUE REFERENCES vou_documents(id) ON DELETE RESTRICT,
    business_date date NOT NULL,
    currency varchar(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
    total_amount_minor bigint NOT NULL,
    parent_entity varchar(64),
    parent_document_id varchar(26) REFERENCES vou_documents(id) ON DELETE RESTRICT,
    CHECK ((parent_entity IS NULL) = (parent_document_id IS NULL))
);

CREATE TABLE vou_purchase_refund_details (
    approval_entry_id varchar(26) PRIMARY KEY REFERENCES approval_entries(id) ON DELETE CASCADE,
    document_id varchar(26) NOT NULL UNIQUE REFERENCES vou_documents(id) ON DELETE RESTRICT,
    business_date date NOT NULL,
    currency varchar(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
    total_amount_minor bigint NOT NULL,
    parent_entity varchar(64),
    parent_document_id varchar(26) REFERENCES vou_documents(id) ON DELETE RESTRICT,
    CHECK ((parent_entity IS NULL) = (parent_document_id IS NULL))
);

CREATE TABLE vou_other_receipt_details (
    approval_entry_id varchar(26) PRIMARY KEY REFERENCES approval_entries(id) ON DELETE CASCADE,
    document_id varchar(26) NOT NULL UNIQUE REFERENCES vou_documents(id) ON DELETE RESTRICT,
    business_date date NOT NULL,
    currency varchar(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
    total_amount_minor bigint NOT NULL,
    parent_entity varchar(64),
    parent_document_id varchar(26) REFERENCES vou_documents(id) ON DELETE RESTRICT,
    CHECK ((parent_entity IS NULL) = (parent_document_id IS NULL))
);

CREATE TABLE vou_sales_refund_details (
    approval_entry_id varchar(26) PRIMARY KEY REFERENCES approval_entries(id) ON DELETE CASCADE,
    document_id varchar(26) NOT NULL UNIQUE REFERENCES vou_documents(id) ON DELETE RESTRICT,
    business_date date NOT NULL,
    currency varchar(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
    total_amount_minor bigint NOT NULL,
    parent_entity varchar(64),
    parent_document_id varchar(26) REFERENCES vou_documents(id) ON DELETE RESTRICT,
    CHECK ((parent_entity IS NULL) = (parent_document_id IS NULL))
);

CREATE TABLE vou_purchase_payment_details (
    approval_entry_id varchar(26) PRIMARY KEY REFERENCES approval_entries(id) ON DELETE CASCADE,
    document_id varchar(26) NOT NULL UNIQUE REFERENCES vou_documents(id) ON DELETE RESTRICT,
    business_date date NOT NULL,
    currency varchar(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
    total_amount_minor bigint NOT NULL,
    parent_entity varchar(64),
    parent_document_id varchar(26) REFERENCES vou_documents(id) ON DELETE RESTRICT,
    CHECK ((parent_entity IS NULL) = (parent_document_id IS NULL))
);

CREATE TABLE vou_other_payment_details (
    approval_entry_id varchar(26) PRIMARY KEY REFERENCES approval_entries(id) ON DELETE CASCADE,
    document_id varchar(26) NOT NULL UNIQUE REFERENCES vou_documents(id) ON DELETE RESTRICT,
    business_date date NOT NULL,
    currency varchar(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
    total_amount_minor bigint NOT NULL,
    parent_entity varchar(64),
    parent_document_id varchar(26) REFERENCES vou_documents(id) ON DELETE RESTRICT,
    CHECK ((parent_entity IS NULL) = (parent_document_id IS NULL))
);

CREATE TABLE vou_employee_loan_details (
    approval_entry_id varchar(26) PRIMARY KEY REFERENCES approval_entries(id) ON DELETE CASCADE,
    document_id varchar(26) NOT NULL UNIQUE REFERENCES vou_documents(id) ON DELETE RESTRICT,
    business_date date NOT NULL,
    currency varchar(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
    total_amount_minor bigint NOT NULL,
    parent_entity varchar(64),
    parent_document_id varchar(26) REFERENCES vou_documents(id) ON DELETE RESTRICT,
    CHECK ((parent_entity IS NULL) = (parent_document_id IS NULL))
);

CREATE TABLE vou_employee_repayment_details (
    approval_entry_id varchar(26) PRIMARY KEY REFERENCES approval_entries(id) ON DELETE CASCADE,
    document_id varchar(26) NOT NULL UNIQUE REFERENCES vou_documents(id) ON DELETE RESTRICT,
    business_date date NOT NULL,
    currency varchar(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
    total_amount_minor bigint NOT NULL,
    parent_entity varchar(64),
    parent_document_id varchar(26) REFERENCES vou_documents(id) ON DELETE RESTRICT,
    CHECK ((parent_entity IS NULL) = (parent_document_id IS NULL))
);

CREATE TABLE vou_employee_loan_writeoff_details (
    approval_entry_id varchar(26) PRIMARY KEY REFERENCES approval_entries(id) ON DELETE CASCADE,
    document_id varchar(26) NOT NULL UNIQUE REFERENCES vou_documents(id) ON DELETE RESTRICT,
    business_date date NOT NULL,
    currency varchar(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
    total_amount_minor bigint NOT NULL,
    parent_entity varchar(64),
    parent_document_id varchar(26) REFERENCES vou_documents(id) ON DELETE RESTRICT,
    CHECK ((parent_entity IS NULL) = (parent_document_id IS NULL))
);

CREATE TABLE vou_expense_reimbursement_details (
    approval_entry_id varchar(26) PRIMARY KEY REFERENCES approval_entries(id) ON DELETE CASCADE,
    document_id varchar(26) NOT NULL UNIQUE REFERENCES vou_documents(id) ON DELETE RESTRICT,
    business_date date NOT NULL,
    currency varchar(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
    total_amount_minor bigint NOT NULL,
    parent_entity varchar(64),
    parent_document_id varchar(26) REFERENCES vou_documents(id) ON DELETE RESTRICT,
    CHECK ((parent_entity IS NULL) = (parent_document_id IS NULL))
);

CREATE TABLE vou_expense_payment_details (
    approval_entry_id varchar(26) PRIMARY KEY REFERENCES approval_entries(id) ON DELETE CASCADE,
    document_id varchar(26) NOT NULL UNIQUE REFERENCES vou_documents(id) ON DELETE RESTRICT,
    business_date date NOT NULL,
    currency varchar(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
    total_amount_minor bigint NOT NULL,
    parent_entity varchar(64),
    parent_document_id varchar(26) REFERENCES vou_documents(id) ON DELETE RESTRICT,
    CHECK ((parent_entity IS NULL) = (parent_document_id IS NULL))
);

CREATE TABLE vou_other_income_details (
    approval_entry_id varchar(26) PRIMARY KEY REFERENCES approval_entries(id) ON DELETE CASCADE,
    document_id varchar(26) NOT NULL UNIQUE REFERENCES vou_documents(id) ON DELETE RESTRICT,
    business_date date NOT NULL,
    currency varchar(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
    total_amount_minor bigint NOT NULL,
    parent_entity varchar(64),
    parent_document_id varchar(26) REFERENCES vou_documents(id) ON DELETE RESTRICT,
    CHECK ((parent_entity IS NULL) = (parent_document_id IS NULL))
);

CREATE TABLE vou_asset_acquisition_details (
    approval_entry_id varchar(26) PRIMARY KEY REFERENCES approval_entries(id) ON DELETE CASCADE,
    document_id varchar(26) NOT NULL UNIQUE REFERENCES vou_documents(id) ON DELETE RESTRICT,
    business_date date NOT NULL,
    currency varchar(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
    total_amount_minor bigint NOT NULL,
    parent_entity varchar(64),
    parent_document_id varchar(26) REFERENCES vou_documents(id) ON DELETE RESTRICT,
    CHECK ((parent_entity IS NULL) = (parent_document_id IS NULL))
);

CREATE TABLE vou_asset_sale_details (
    approval_entry_id varchar(26) PRIMARY KEY REFERENCES approval_entries(id) ON DELETE CASCADE,
    document_id varchar(26) NOT NULL UNIQUE REFERENCES vou_documents(id) ON DELETE RESTRICT,
    business_date date NOT NULL,
    currency varchar(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
    total_amount_minor bigint NOT NULL,
    parent_entity varchar(64),
    parent_document_id varchar(26) REFERENCES vou_documents(id) ON DELETE RESTRICT,
    CHECK ((parent_entity IS NULL) = (parent_document_id IS NULL))
);

CREATE TABLE vou_asset_liquidation_details (
    approval_entry_id varchar(26) PRIMARY KEY REFERENCES approval_entries(id) ON DELETE CASCADE,
    document_id varchar(26) NOT NULL UNIQUE REFERENCES vou_documents(id) ON DELETE RESTRICT,
    business_date date NOT NULL,
    currency varchar(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
    total_amount_minor bigint NOT NULL,
    parent_entity varchar(64),
    parent_document_id varchar(26) REFERENCES vou_documents(id) ON DELETE RESTRICT,
    CHECK ((parent_entity IS NULL) = (parent_document_id IS NULL))
);

CREATE TABLE vou_bill_receipt_details (
    approval_entry_id varchar(26) PRIMARY KEY REFERENCES approval_entries(id) ON DELETE CASCADE,
    document_id varchar(26) NOT NULL UNIQUE REFERENCES vou_documents(id) ON DELETE RESTRICT,
    business_date date NOT NULL,
    currency varchar(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
    total_amount_minor bigint NOT NULL,
    parent_entity varchar(64),
    parent_document_id varchar(26) REFERENCES vou_documents(id) ON DELETE RESTRICT,
    CHECK ((parent_entity IS NULL) = (parent_document_id IS NULL))
);

CREATE TABLE vou_bill_payment_details (
    approval_entry_id varchar(26) PRIMARY KEY REFERENCES approval_entries(id) ON DELETE CASCADE,
    document_id varchar(26) NOT NULL UNIQUE REFERENCES vou_documents(id) ON DELETE RESTRICT,
    business_date date NOT NULL,
    currency varchar(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
    total_amount_minor bigint NOT NULL,
    parent_entity varchar(64),
    parent_document_id varchar(26) REFERENCES vou_documents(id) ON DELETE RESTRICT,
    CHECK ((parent_entity IS NULL) = (parent_document_id IS NULL))
);

CREATE TABLE vou_bill_issue_details (
    approval_entry_id varchar(26) PRIMARY KEY REFERENCES approval_entries(id) ON DELETE CASCADE,
    document_id varchar(26) NOT NULL UNIQUE REFERENCES vou_documents(id) ON DELETE RESTRICT,
    business_date date NOT NULL,
    currency varchar(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
    total_amount_minor bigint NOT NULL,
    parent_entity varchar(64),
    parent_document_id varchar(26) REFERENCES vou_documents(id) ON DELETE RESTRICT,
    CHECK ((parent_entity IS NULL) = (parent_document_id IS NULL))
);

CREATE TABLE vou_bill_discount_details (
    approval_entry_id varchar(26) PRIMARY KEY REFERENCES approval_entries(id) ON DELETE CASCADE,
    document_id varchar(26) NOT NULL UNIQUE REFERENCES vou_documents(id) ON DELETE RESTRICT,
    business_date date NOT NULL,
    currency varchar(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
    total_amount_minor bigint NOT NULL,
    parent_entity varchar(64),
    parent_document_id varchar(26) REFERENCES vou_documents(id) ON DELETE RESTRICT,
    CHECK ((parent_entity IS NULL) = (parent_document_id IS NULL))
);

CREATE TABLE vou_bill_maturity_details (
    approval_entry_id varchar(26) PRIMARY KEY REFERENCES approval_entries(id) ON DELETE CASCADE,
    document_id varchar(26) NOT NULL UNIQUE REFERENCES vou_documents(id) ON DELETE RESTRICT,
    business_date date NOT NULL,
    currency varchar(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
    total_amount_minor bigint NOT NULL,
    parent_entity varchar(64),
    parent_document_id varchar(26) REFERENCES vou_documents(id) ON DELETE RESTRICT,
    CHECK ((parent_entity IS NULL) = (parent_document_id IS NULL))
);

CREATE TABLE vou_intermediary_calculation_details (
    approval_entry_id varchar(26) PRIMARY KEY REFERENCES approval_entries(id) ON DELETE CASCADE,
    document_id varchar(26) NOT NULL UNIQUE REFERENCES vou_documents(id) ON DELETE RESTRICT,
    business_date date NOT NULL,
    currency varchar(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
    total_amount_minor bigint NOT NULL,
    parent_entity varchar(64),
    parent_document_id varchar(26) REFERENCES vou_documents(id) ON DELETE RESTRICT,
    CHECK ((parent_entity IS NULL) = (parent_document_id IS NULL))
);

CREATE TABLE vou_service_contract_details (
    approval_entry_id varchar(26) PRIMARY KEY REFERENCES approval_entries(id) ON DELETE CASCADE,
    document_id varchar(26) NOT NULL UNIQUE REFERENCES vou_documents(id) ON DELETE RESTRICT,
    business_date date NOT NULL,
    currency varchar(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
    total_amount_minor bigint NOT NULL,
    parent_entity varchar(64),
    parent_document_id varchar(26) REFERENCES vou_documents(id) ON DELETE RESTRICT,
    CHECK ((parent_entity IS NULL) = (parent_document_id IS NULL))
);

CREATE TABLE vou_service_acceptance_details (
    approval_entry_id varchar(26) PRIMARY KEY REFERENCES approval_entries(id) ON DELETE CASCADE,
    document_id varchar(26) NOT NULL UNIQUE REFERENCES vou_documents(id) ON DELETE RESTRICT,
    business_date date NOT NULL,
    currency varchar(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
    total_amount_minor bigint NOT NULL,
    parent_entity varchar(64),
    parent_document_id varchar(26) REFERENCES vou_documents(id) ON DELETE RESTRICT,
    CHECK ((parent_entity IS NULL) = (parent_document_id IS NULL))
);

ALTER TABLE vou_sale_pricing_details ADD COLUMN remark text;
ALTER TABLE vou_sale_order_details ADD COLUMN remark text, ADD COLUMN special_approval boolean;
ALTER TABLE vou_sale_outbound_details ADD COLUMN remark text;
ALTER TABLE vou_sale_delivery_details ADD COLUMN remark text;
ALTER TABLE vou_sale_signoff_details ADD COLUMN remark text;
ALTER TABLE vou_sale_return_details ADD COLUMN remark text, ADD COLUMN return_reason text;
ALTER TABLE vou_purchase_inquiry_details ADD COLUMN remark text;
ALTER TABLE vou_purchase_order_details ADD COLUMN remark text, ADD COLUMN settlement_method_id varchar(26);
ALTER TABLE vou_purchase_inbound_details ADD COLUMN remark text;
ALTER TABLE vou_purchase_return_details ADD COLUMN remark text, ADD COLUMN return_reason text;
ALTER TABLE vou_order_production_details ADD COLUMN remark text;
ALTER TABLE vou_self_production_details ADD COLUMN remark text;
ALTER TABLE vou_inventory_count_details ADD COLUMN remark text;
ALTER TABLE vou_sales_receipt_details ADD COLUMN remark text;
ALTER TABLE vou_purchase_refund_details ADD COLUMN remark text;
ALTER TABLE vou_other_receipt_details ADD COLUMN remark text, ADD COLUMN counterparty_type varchar(32), ADD COLUMN other_category varchar(32);
ALTER TABLE vou_sales_refund_details ADD COLUMN remark text;
ALTER TABLE vou_purchase_payment_details ADD COLUMN remark text;
ALTER TABLE vou_other_payment_details ADD COLUMN remark text, ADD COLUMN counterparty_type varchar(32), ADD COLUMN other_category varchar(32);
ALTER TABLE vou_employee_loan_details ADD COLUMN remark text;
ALTER TABLE vou_employee_repayment_details ADD COLUMN remark text;
ALTER TABLE vou_employee_loan_writeoff_details ADD COLUMN remark text;
ALTER TABLE vou_expense_reimbursement_details ADD COLUMN remark text;
ALTER TABLE vou_expense_payment_details ADD COLUMN remark text;
ALTER TABLE vou_other_income_details ADD COLUMN remark text, ADD COLUMN source_name varchar(200), ADD COLUMN counterparty_type varchar(32);
ALTER TABLE vou_asset_acquisition_details ADD COLUMN remark text;
ALTER TABLE vou_asset_sale_details ADD COLUMN remark text;
ALTER TABLE vou_asset_liquidation_details ADD COLUMN remark text;
ALTER TABLE vou_bill_receipt_details ADD COLUMN remark text, ADD COLUMN internal_cost_rate_bps integer;
ALTER TABLE vou_bill_payment_details ADD COLUMN remark text;
ALTER TABLE vou_bill_issue_details ADD COLUMN remark text, ADD COLUMN interest_mode varchar(32);
ALTER TABLE vou_bill_discount_details ADD COLUMN remark text, ADD COLUMN interest_mode varchar(32), ADD COLUMN with_recourse boolean;
ALTER TABLE vou_bill_maturity_details ADD COLUMN remark text, ADD COLUMN maturity_type varchar(16);
ALTER TABLE vou_intermediary_calculation_details ADD COLUMN remark text, ADD COLUMN period_start date, ADD COLUMN period_end date, ADD COLUMN source_hash varchar(64), ADD COLUMN script_id varchar(128), ADD COLUMN script_revision integer, ADD COLUMN script_name varchar(200), ADD COLUMN script_source text, ADD COLUMN script_hash varchar(64);
ALTER TABLE vou_service_contract_details ADD COLUMN remark text, ADD COLUMN capabilities varchar(32)[], ADD COLUMN applicable_from date, ADD COLUMN applicable_to date, ADD COLUMN terms text;
ALTER TABLE vou_service_acceptance_details ADD COLUMN remark text, ADD COLUMN contract_document_id varchar(26), ADD COLUMN service_date date, ADD COLUMN acceptance_date date, ADD COLUMN settlement_direction varchar(16), ADD COLUMN fulfillment_fact text, ADD COLUMN acceptance_fact text;

CREATE TABLE vou_reference_snapshots (
    approval_entry_id varchar(26) NOT NULL REFERENCES approval_entries(id) ON DELETE CASCADE,
    field varchar(64) NOT NULL,
    line_no integer NOT NULL DEFAULT 0 CHECK (line_no BETWEEN 0 AND 200),
    item_no integer NOT NULL DEFAULT 0 CHECK (item_no BETWEEN 0 AND 200),
    object_id varchar(26) NOT NULL,
    approval_reference_id varchar(26) REFERENCES approval_entries(id) ON DELETE RESTRICT,
    selection_origin varchar(16) CHECK (selection_origin IN ('CURRENT', 'HISTORICAL')),
    reference_entity varchar(64),
    reference_code varchar(64),
    reference_name varchar(200),
    PRIMARY KEY (approval_entry_id, field, line_no, item_no),
    CHECK ((approval_reference_id IS NULL) = (selection_origin IS NULL))
);

CREATE TABLE vou_price_line_snapshots (
    approval_entry_id varchar(26) NOT NULL REFERENCES approval_entries(id) ON DELETE CASCADE,
    line_no integer NOT NULL CHECK (line_no BETWEEN 1 AND 200),
    unit_price_minor bigint NOT NULL,
    remark text,
    PRIMARY KEY (approval_entry_id, line_no)
);

CREATE TABLE vou_product_line_snapshots (
    approval_entry_id varchar(26) NOT NULL REFERENCES approval_entries(id) ON DELETE CASCADE,
    line_no integer NOT NULL CHECK (line_no BETWEEN 1 AND 200),
    line_id varchar(26) NOT NULL CHECK (line_id ~ '^[0-9A-HJKMNP-TV-Z]{26}$'),
    entered_quantity_micros bigint NOT NULL,
    entered_unit_id varchar(26) NOT NULL,
    base_quantity_micros bigint NOT NULL,
    unit_price_minor bigint NOT NULL,
    settlement_surcharge_minor bigint,
    purchase_unit_price_minor bigint,
    remark text,
    delivery_specification_type varchar(32),
    container_type text,
    quantity_per_container_micros bigint,
    formula_source_type varchar(32),
    formula_source_document_id varchar(26),
    formula_source_document_no varchar(32),
    formula_output_entered_quantity_micros bigint,
    formula_output_entered_unit_id varchar(26),
    formula_output_base_quantity_micros bigint,
    PRIMARY KEY (approval_entry_id, line_no),
    UNIQUE (approval_entry_id, line_id)
);

CREATE TABLE vou_formula_component_snapshots (
    approval_entry_id varchar(26) NOT NULL,
    line_no integer NOT NULL CHECK (line_no BETWEEN 1 AND 200),
    component_no integer NOT NULL CHECK (component_no BETWEEN 1 AND 200),
    material_id varchar(26) NOT NULL,
    entered_quantity_micros bigint NOT NULL,
    entered_unit_id varchar(26) NOT NULL,
    base_quantity_micros bigint NOT NULL,
    PRIMARY KEY (approval_entry_id, line_no, component_no),
    FOREIGN KEY (approval_entry_id, line_no) REFERENCES vou_product_line_snapshots(approval_entry_id, line_no) ON DELETE CASCADE
);

CREATE TABLE vou_source_line_snapshots (
    approval_entry_id varchar(26) NOT NULL REFERENCES approval_entries(id) ON DELETE CASCADE,
    line_no integer NOT NULL CHECK (line_no BETWEEN 1 AND 200),
    source_line_id varchar(128) NOT NULL,
    base_quantity_micros bigint NOT NULL,
    remark text,
    PRIMARY KEY (approval_entry_id, line_no)
);

CREATE TABLE vou_signoff_line_snapshots (
    approval_entry_id varchar(26) NOT NULL REFERENCES approval_entries(id) ON DELETE CASCADE,
    line_no integer NOT NULL CHECK (line_no BETWEEN 1 AND 200),
    source_line_id varchar(128) NOT NULL,
    signed_quantity_micros bigint NOT NULL,
    rejected_quantity_micros bigint NOT NULL,
    remark text,
    PRIMARY KEY (approval_entry_id, line_no)
);

CREATE TABLE vou_return_line_snapshots (
    approval_entry_id varchar(26) NOT NULL REFERENCES approval_entries(id) ON DELETE CASCADE,
    line_no integer NOT NULL CHECK (line_no BETWEEN 1 AND 200),
    source_line_id varchar(128) NOT NULL,
    base_quantity_micros bigint NOT NULL,
    remark text,
    PRIMARY KEY (approval_entry_id, line_no)
);

CREATE TABLE vou_expense_line_snapshots (
    approval_entry_id varchar(26) NOT NULL REFERENCES approval_entries(id) ON DELETE CASCADE,
    line_no integer NOT NULL CHECK (line_no BETWEEN 1 AND 200),
    category varchar(200) NOT NULL,
    description text NOT NULL,
    amount_minor bigint NOT NULL,
    remark text,
    PRIMARY KEY (approval_entry_id, line_no)
);

CREATE TABLE vou_amount_allocation_snapshots (
    approval_entry_id varchar(26) NOT NULL REFERENCES approval_entries(id) ON DELETE CASCADE,
    line_no integer NOT NULL CHECK (line_no BETWEEN 1 AND 200),
    amount_minor bigint NOT NULL,
    PRIMARY KEY (approval_entry_id, line_no)
);

CREATE TABLE vou_inventory_count_line_snapshots (
    approval_entry_id varchar(26) NOT NULL REFERENCES approval_entries(id) ON DELETE CASCADE,
    line_no integer NOT NULL CHECK (line_no BETWEEN 1 AND 200),
    entered_quantity_micros bigint NOT NULL,
    entered_unit_id varchar(26) NOT NULL,
    base_quantity_micros bigint NOT NULL,
    remark text,
    PRIMARY KEY (approval_entry_id, line_no)
);

CREATE TABLE vou_production_line_snapshots (
    approval_entry_id varchar(26) NOT NULL REFERENCES approval_entries(id) ON DELETE CASCADE,
    line_no integer NOT NULL CHECK (line_no BETWEEN 1 AND 200),
    source_order_line_id varchar(128),
    entered_quantity_micros bigint NOT NULL,
    entered_unit_id varchar(26) NOT NULL,
    base_quantity_micros bigint NOT NULL,
    loss_rate_micros bigint NOT NULL,
    remark text,
    PRIMARY KEY (approval_entry_id, line_no)
);

CREATE TABLE vou_production_material_snapshots (
    approval_entry_id varchar(26) NOT NULL,
    line_no integer NOT NULL CHECK (line_no BETWEEN 1 AND 200),
    material_no integer NOT NULL CHECK (material_no BETWEEN 1 AND 200),
    formula_line_no integer NOT NULL,
    material_id varchar(26) NOT NULL,
    entered_quantity_micros bigint NOT NULL,
    entered_unit_id varchar(26) NOT NULL,
    base_quantity_micros bigint NOT NULL,
    adjustment_reason text,
    PRIMARY KEY (approval_entry_id, line_no, material_no),
    FOREIGN KEY (approval_entry_id, line_no) REFERENCES vou_production_line_snapshots(approval_entry_id, line_no) ON DELETE CASCADE
);

CREATE TABLE vou_asset_acquisition_line_snapshots (
    approval_entry_id varchar(26) NOT NULL REFERENCES approval_entries(id) ON DELETE CASCADE,
    line_no integer NOT NULL CHECK (line_no BETWEEN 1 AND 200),
    asset_name varchar(200) NOT NULL,
    specification varchar(200),
    original_value_minor bigint NOT NULL,
    useful_life_months integer NOT NULL,
    residual_rate_micros bigint NOT NULL,
    location varchar(200),
    remark text,
    PRIMARY KEY (approval_entry_id, line_no)
);

CREATE TABLE vou_asset_disposal_line_snapshots (
    approval_entry_id varchar(26) NOT NULL REFERENCES approval_entries(id) ON DELETE CASCADE,
    line_no integer NOT NULL CHECK (line_no BETWEEN 1 AND 200),
    asset_id varchar(128) NOT NULL,
    sale_amount_minor bigint,
    reason text,
    salvage_income_minor bigint,
    disposal_expense_minor bigint,
    remark text,
    PRIMARY KEY (approval_entry_id, line_no)
);

CREATE TABLE vou_bill_line_snapshots (
    approval_entry_id varchar(26) NOT NULL REFERENCES approval_entries(id) ON DELETE CASCADE,
    line_no integer NOT NULL CHECK (line_no BETWEEN 1 AND 20),
    bill_id varchar(128),
    position_type varchar(16),
    direction varchar(8),
    purpose varchar(16) NOT NULL,
    bill_type varchar(32),
    bill_no varchar(200),
    medium varchar(16),
    currency varchar(3),
    face_amount_minor bigint,
    issue_date date,
    maturity_date date,
    drawer varchar(200),
    acceptor varchar(200),
    payee varchar(200),
    annual_rate_bps integer,
    remark text,
    PRIMARY KEY (approval_entry_id, line_no)
);

CREATE TABLE vou_bill_cash_line_snapshots (
    approval_entry_id varchar(26) NOT NULL REFERENCES approval_entries(id) ON DELETE CASCADE,
    line_no integer NOT NULL CHECK (line_no BETWEEN 1 AND 20),
    bill_line_id varchar(128),
    direction varchar(8) NOT NULL,
    amount_type varchar(16) NOT NULL,
    amount_minor bigint NOT NULL,
    remark text,
    PRIMARY KEY (approval_entry_id, line_no)
);

CREATE TABLE vou_intermediary_source_line_snapshots (
    approval_entry_id varchar(26) NOT NULL REFERENCES approval_entries(id) ON DELETE CASCADE,
    line_no integer NOT NULL CHECK (line_no BETWEEN 1 AND 200),
    source_signoff_line_id varchar(128) NOT NULL,
    source_kind varchar(32) NOT NULL,
    signoff_document_id varchar(26) NOT NULL,
    signoff_document_no varchar(32) NOT NULL,
    signoff_date date NOT NULL,
    order_document_id varchar(26) NOT NULL,
    order_document_no varchar(32) NOT NULL,
    order_date date NOT NULL,
    due_date date NOT NULL,
    collection_date date NOT NULL,
    collection_delay_days integer NOT NULL,
    sales_attribution_type varchar(32) NOT NULL,
    sales_contract_status varchar(32) NOT NULL,
    sales_contract_document_id varchar(26),
    sales_contract_revision integer,
    sales_contract_applicable_from date,
    sales_contract_applicable_to date,
    sales_contract_terms text,
    behavior_profile varchar(32) NOT NULL,
    signed_quantity_micros bigint NOT NULL,
    pricing_quantity_micros bigint NOT NULL,
    standard_piece_quantity_micros bigint NOT NULL,
    unit_price_minor bigint NOT NULL,
    reference_unit_price_minor bigint NOT NULL,
    settlement_surcharge_minor bigint NOT NULL,
    line_amount_minor bigint NOT NULL,
    settlement_term_code varchar(64) NOT NULL,
    special_approval boolean NOT NULL,
    return_document_nos varchar(32)[] NOT NULL DEFAULT '{}',
    adjustment_employee_amount_minor bigint NOT NULL,
    adjustment_intermediary_amount_minor bigint NOT NULL,
    PRIMARY KEY (approval_entry_id, line_no)
);

CREATE TABLE vou_intermediary_result_line_snapshots (
    approval_entry_id varchar(26) NOT NULL REFERENCES approval_entries(id) ON DELETE CASCADE,
    line_no integer NOT NULL CHECK (line_no BETWEEN 1 AND 200),
    source_signoff_line_id varchar(128) NOT NULL,
    premium_unit_price_minor bigint NOT NULL,
    standard_piece_quantity_micros bigint NOT NULL,
    base_commission_minor bigint NOT NULL,
    premium_commission_minor bigint NOT NULL,
    low_price_commission_minor bigint NOT NULL,
    market_maintenance_subsidy_minor bigint NOT NULL,
    market_development_subsidy_minor bigint NOT NULL,
    bill_cost_minor bigint NOT NULL,
    bill_line_ids varchar(128)[] NOT NULL,
    employee_amount_minor bigint NOT NULL,
    intermediary_amount_minor bigint NOT NULL,
    note text,
    PRIMARY KEY (approval_entry_id, line_no)
);

CREATE TABLE vou_intermediary_bill_snapshots (
    approval_entry_id varchar(26) NOT NULL REFERENCES approval_entries(id) ON DELETE CASCADE,
    line_no integer NOT NULL CHECK (line_no BETWEEN 1 AND 200),
    bill_line_id varchar(128) NOT NULL,
    receipt_document_id varchar(26) NOT NULL,
    receipt_document_no varchar(32) NOT NULL,
    receipt_date date NOT NULL,
    bill_type varchar(32) NOT NULL,
    face_amount_minor bigint NOT NULL,
    issue_date date NOT NULL,
    maturity_date date NOT NULL,
    cost_days integer NOT NULL,
    PRIMARY KEY (approval_entry_id, line_no)
);

CREATE TABLE vou_intermediary_summary_snapshots (
    approval_entry_id varchar(26) NOT NULL REFERENCES approval_entries(id) ON DELETE CASCADE,
    line_no integer NOT NULL CHECK (line_no BETWEEN 1 AND 200),
    category varchar(32) NOT NULL,
    amount_minor bigint NOT NULL,
    PRIMARY KEY (approval_entry_id, line_no)
);

CREATE TABLE vou_document_counters (
    entity varchar(64) NOT NULL CHECK (entity IN (
        'sale-pricing', 'sale-order', 'sale-outbound', 'sale-delivery', 'sale-signoff', 'sale-return',
        'purchase-order', 'purchase-inbound', 'purchase-return', 'purchase-inquiry', 'order-production',
        'self-production', 'inventory-count', 'sales-receipt', 'purchase-refund', 'other-receipt',
        'sales-refund', 'purchase-payment', 'other-payment', 'employee-loan', 'employee-repayment',
        'employee-loan-writeoff', 'expense-reimbursement', 'expense-payment', 'other-income',
        'asset-acquisition', 'asset-sale', 'asset-liquidation', 'bill-receipt', 'bill-payment',
        'bill-issue', 'bill-discount', 'bill-maturity', 'intermediary-calculation', 'service-contract',
        'service-acceptance'
    )),
    business_date date NOT NULL,
    last_value integer NOT NULL CHECK (last_value BETWEEN 0 AND 9999),
    PRIMARY KEY (entity, business_date)
);

CREATE TABLE vou_idempotency (
    entity varchar(64) NOT NULL,
    idempotency_key varchar(128) NOT NULL,
    request_hash varchar(64) NOT NULL,
    document_id varchar(26) NOT NULL,
    submission_id varchar(26) NOT NULL,
    response jsonb NOT NULL CHECK (jsonb_typeof(response) = 'object'),
    created_at timestamptz NOT NULL,
    PRIMARY KEY (entity, idempotency_key)
);

CREATE TABLE vou_attachment_staging (
    id varchar(26) PRIMARY KEY,
    file_id varchar(26) NOT NULL,
    owner_user_id varchar(26) NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
    file_name varchar(255) NOT NULL,
    mime_type varchar(128) NOT NULL CHECK (mime_type IN ('application/pdf', 'image/jpeg', 'image/png')),
    size_bytes integer NOT NULL CHECK (size_bytes BETWEEN 1 AND 10485760),
    digest varchar(64) NOT NULL CHECK (digest ~ '^[0-9a-f]{64}$'),
    storage_key varchar(512) NOT NULL UNIQUE,
    created_at timestamptz NOT NULL,
    expires_at timestamptz NOT NULL,
    CHECK (expires_at > created_at),
    UNIQUE (owner_user_id, file_id)
);

CREATE TABLE vou_attachments (
    approval_entry_id varchar(26) NOT NULL REFERENCES approval_entries(id) ON DELETE CASCADE,
    file_id varchar(26) NOT NULL,
    staging_id varchar(26) NOT NULL,
    file_name varchar(255) NOT NULL,
    mime_type varchar(128) NOT NULL,
    size_bytes integer NOT NULL CHECK (size_bytes BETWEEN 1 AND 10485760),
    digest varchar(64) NOT NULL CHECK (digest ~ '^[0-9a-f]{64}$'),
    storage_key varchar(512) NOT NULL,
    created_at timestamptz NOT NULL,
    PRIMARY KEY (approval_entry_id, file_id)
);

CREATE TABLE acc_journal_entries (
    id varchar(26) PRIMARY KEY,
    book_id varchar(26) NOT NULL REFERENCES acc_books(id) ON DELETE RESTRICT,
    source_kind varchar(32) NOT NULL DEFAULT 'VOU' CHECK (source_kind IN ('VOU', 'OPENING', 'COST_SETTLEMENT', 'DEPRECIATION')),
    vou_document_id varchar(26) REFERENCES vou_documents(id) ON DELETE RESTRICT,
    vou_approval_entry_id varchar(26) REFERENCES approval_entries(id) ON DELETE RESTRICT,
    opening_approval_entry_id varchar(26) REFERENCES approval_entries(id) ON DELETE RESTRICT,
    business_date date NOT NULL,
    currency varchar(3) NOT NULL,
    reversed_at timestamptz,
    created_at timestamptz NOT NULL,
    CHECK (
        (source_kind = 'VOU' AND vou_document_id IS NOT NULL AND vou_approval_entry_id IS NOT NULL AND opening_approval_entry_id IS NULL)
        OR (source_kind = 'OPENING' AND vou_document_id IS NULL AND vou_approval_entry_id IS NULL AND opening_approval_entry_id IS NOT NULL)
        OR (source_kind IN ('COST_SETTLEMENT', 'DEPRECIATION') AND vou_document_id IS NULL AND vou_approval_entry_id IS NULL AND opening_approval_entry_id IS NULL)
    )
);
CREATE UNIQUE INDEX acc_journal_entries_vou_source_unique
    ON acc_journal_entries(book_id, vou_approval_entry_id)
    WHERE source_kind = 'VOU';
CREATE UNIQUE INDEX acc_journal_entries_opening_source_unique
    ON acc_journal_entries(book_id, opening_approval_entry_id, currency)
    WHERE source_kind = 'OPENING';

CREATE TABLE acc_journal_lines (
    id varchar(26) PRIMARY KEY,
    journal_entry_id varchar(26) NOT NULL REFERENCES acc_journal_entries(id) ON DELETE CASCADE,
    subject_id varchar(26) NOT NULL REFERENCES acc_subjects(id) ON DELETE RESTRICT,
    direction varchar(8) NOT NULL CHECK (direction IN ('DEBIT', 'CREDIT')),
    amount numeric(24, 8) NOT NULL CHECK (amount >= 0),
    dimensions jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(dimensions) = 'object')
);

CREATE TABLE acc_inventory_entries (
    id varchar(26) PRIMARY KEY,
    vou_approval_entry_id varchar(26) REFERENCES approval_entries(id) ON DELETE RESTRICT,
    document_id varchar(26) REFERENCES vou_documents(id) ON DELETE RESTRICT,
    opening_approval_entry_id varchar(26) REFERENCES approval_entries(id) ON DELETE RESTRICT,
    book_id varchar(26) NOT NULL REFERENCES acc_books(id) ON DELETE RESTRICT,
    subject_id varchar(26) NOT NULL REFERENCES acc_subjects(id) ON DELETE RESTRICT,
    journal_entry_id varchar(26) NOT NULL REFERENCES acc_journal_entries(id) ON DELETE CASCADE,
    line_id varchar(26) NOT NULL,
    warehouse_id varchar(26) NOT NULL,
    product_id varchar(26) NOT NULL,
    business_date date NOT NULL,
    quantity numeric(24, 8) NOT NULL,
    reversed_at timestamptz,
    created_at timestamptz NOT NULL,
    UNIQUE (vou_approval_entry_id, book_id, line_id),
    CHECK (
        (vou_approval_entry_id IS NOT NULL AND document_id IS NOT NULL AND opening_approval_entry_id IS NULL)
        OR (vou_approval_entry_id IS NULL AND document_id IS NULL AND opening_approval_entry_id IS NOT NULL)
    )
);
CREATE INDEX acc_inventory_entries_control_balance_idx
    ON acc_inventory_entries(book_id, warehouse_id, product_id, business_date, created_at, id);

CREATE TABLE acc_container_entries (
    id varchar(26) PRIMARY KEY,
    customer_subunit_id varchar(26) NOT NULL REFERENCES dcl_customer_subunit_roots(subunit_id) ON DELETE RESTRICT,
    customer_id varchar(26) NOT NULL REFERENCES dcl_subjects(id) ON DELETE RESTRICT,
    customer_approval_entry_id varchar(26) NOT NULL REFERENCES approval_entries(id) ON DELETE RESTRICT,
    container_type varchar(16) NOT NULL CHECK (container_type IN ('SOLVENT', 'RESIN')),
    quantity_delta bigint NOT NULL,
    business_date date NOT NULL,
    vou_approval_entry_id varchar(26) NOT NULL REFERENCES approval_entries(id) ON DELETE RESTRICT,
    source_document_id varchar(26) NOT NULL REFERENCES vou_documents(id) ON DELETE RESTRICT,
    source_revision bigint NOT NULL CHECK (source_revision > 0),
    created_at timestamptz NOT NULL,
    UNIQUE (vou_approval_entry_id, container_type),
    UNIQUE (source_document_id, source_revision, container_type)
);
CREATE INDEX acc_container_entries_balance_idx
    ON acc_container_entries(customer_subunit_id, container_type, business_date, created_at, id);

CREATE TABLE acc_asset_registers (
    id varchar(26) PRIMARY KEY,
    asset_no varchar(64) NOT NULL UNIQUE,
    name varchar(200) NOT NULL,
    status varchar(16) NOT NULL CHECK (status IN ('ACTIVE', 'SOLD', 'RETIRED')),
    acquisition_vou_approval_entry_id varchar(26) REFERENCES approval_entries(id) ON DELETE RESTRICT,
    acquisition_opening_approval_entry_id varchar(26) REFERENCES approval_entries(id) ON DELETE RESTRICT,
    state_vou_approval_entry_id varchar(26) REFERENCES approval_entries(id) ON DELETE RESTRICT,
    state_opening_approval_entry_id varchar(26) REFERENCES approval_entries(id) ON DELETE RESTRICT,
    payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
    created_at timestamptz NOT NULL,
    CHECK ((acquisition_vou_approval_entry_id IS NOT NULL) <> (acquisition_opening_approval_entry_id IS NOT NULL)),
    CHECK ((state_vou_approval_entry_id IS NOT NULL) <> (state_opening_approval_entry_id IS NOT NULL))
);
CREATE INDEX acc_asset_registers_acquisition_source_idx ON acc_asset_registers(acquisition_vou_approval_entry_id);

CREATE TABLE acc_asset_book_values (
    asset_id varchar(26) NOT NULL REFERENCES acc_asset_registers(id) ON DELETE CASCADE,
    book_id varchar(26) NOT NULL REFERENCES acc_books(id) ON DELETE RESTRICT,
    acquisition_vou_approval_entry_id varchar(26) REFERENCES approval_entries(id) ON DELETE RESTRICT,
    acquisition_opening_approval_entry_id varchar(26) REFERENCES approval_entries(id) ON DELETE RESTRICT,
    original_value numeric(24, 8) NOT NULL CHECK (original_value >= 0),
    created_at timestamptz NOT NULL,
    PRIMARY KEY (asset_id, book_id),
    CHECK ((acquisition_vou_approval_entry_id IS NOT NULL) <> (acquisition_opening_approval_entry_id IS NOT NULL))
);

CREATE TABLE acc_bill_registers (
    id varchar(26) PRIMARY KEY,
    bill_no varchar(200) NOT NULL,
    position_type varchar(16) NOT NULL CHECK (position_type IN ('ASSET', 'LIABILITY')),
    status varchar(16) NOT NULL CHECK (status IN ('AVAILABLE', 'REPLACED', 'PAID', 'DISCOUNTED', 'MATURED')),
    created_vou_approval_entry_id varchar(26) REFERENCES approval_entries(id) ON DELETE RESTRICT,
    created_opening_approval_entry_id varchar(26) REFERENCES approval_entries(id) ON DELETE RESTRICT,
    state_vou_approval_entry_id varchar(26) REFERENCES approval_entries(id) ON DELETE RESTRICT,
    state_opening_approval_entry_id varchar(26) REFERENCES approval_entries(id) ON DELETE RESTRICT,
    payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
    created_at timestamptz NOT NULL,
    CHECK ((created_vou_approval_entry_id IS NOT NULL) <> (created_opening_approval_entry_id IS NOT NULL)),
    CHECK ((state_vou_approval_entry_id IS NOT NULL) <> (state_opening_approval_entry_id IS NOT NULL))
);
CREATE UNIQUE INDEX acc_bill_registers_identity_unique
    ON acc_bill_registers (
        (payload->>'billType'), bill_no, (payload->>'acceptor'), (payload->>'faceAmount'), (payload->>'maturityDate')
    );

CREATE TABLE acc_bill_book_values (
    bill_id varchar(26) NOT NULL REFERENCES acc_bill_registers(id) ON DELETE CASCADE,
    book_id varchar(26) NOT NULL REFERENCES acc_books(id) ON DELETE RESTRICT,
    opening_approval_entry_id varchar(26) NOT NULL REFERENCES approval_entries(id) ON DELETE RESTRICT,
    value_amount numeric(24, 8) NOT NULL CHECK (value_amount > 0),
    created_at timestamptz NOT NULL,
    PRIMARY KEY (bill_id, book_id)
);

CREATE TABLE acc_register_entries (
    id varchar(26) PRIMARY KEY,
    register_kind varchar(32) NOT NULL CHECK (register_kind IN ('ASSET', 'BILL', 'CONTAINER', 'EMPLOYEE_LOAN')),
    object_id varchar(26) NOT NULL,
    source_kind varchar(32) NOT NULL DEFAULT 'VOU' CHECK (source_kind IN ('VOU', 'OPENING')),
    vou_approval_entry_id varchar(26) REFERENCES approval_entries(id) ON DELETE RESTRICT,
    opening_approval_entry_id varchar(26) REFERENCES approval_entries(id) ON DELETE RESTRICT,
    payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
    reversed_at timestamptz,
    created_at timestamptz NOT NULL,
    CHECK (
        (source_kind = 'VOU' AND vou_approval_entry_id IS NOT NULL AND opening_approval_entry_id IS NULL)
        OR (source_kind = 'OPENING' AND vou_approval_entry_id IS NULL AND opening_approval_entry_id IS NOT NULL)
    )
);
CREATE UNIQUE INDEX acc_register_entries_vou_source_unique
    ON acc_register_entries(register_kind, object_id, vou_approval_entry_id)
    WHERE source_kind = 'VOU';
CREATE UNIQUE INDEX acc_register_entries_opening_source_unique
    ON acc_register_entries(register_kind, object_id, opening_approval_entry_id)
    WHERE source_kind = 'OPENING';

CREATE TABLE acc_opening_container_balances (
    opening_approval_entry_id varchar(26) NOT NULL REFERENCES approval_entries(id) ON DELETE CASCADE,
    customer_subunit_id varchar(26) NOT NULL REFERENCES dcl_customer_subunit_roots(subunit_id) ON DELETE RESTRICT,
    customer_id varchar(26) NOT NULL REFERENCES dcl_subjects(id) ON DELETE RESTRICT,
    customer_approval_entry_id varchar(26) NOT NULL REFERENCES approval_entries(id) ON DELETE RESTRICT,
    customer_subunit_code varchar(64) NOT NULL,
    customer_subunit_name varchar(200) NOT NULL,
    container_type varchar(16) NOT NULL CHECK (container_type IN ('SOLVENT', 'RESIN')),
    quantity bigint NOT NULL CHECK (quantity <> 0),
    created_at timestamptz NOT NULL,
    PRIMARY KEY (opening_approval_entry_id, customer_subunit_id, container_type)
);

CREATE TABLE wfl_definition_versions (
    approval_entry_id varchar(26) PRIMARY KEY REFERENCES approval_entries(id) ON DELETE CASCADE,
    script text NOT NULL CHECK (btrim(script) <> ''),
    compiled_graph jsonb NOT NULL CHECK (jsonb_typeof(compiled_graph) = 'object')
);

CREATE TABLE wfl_definition_runtime_states (
    subject_id varchar(26) PRIMARY KEY REFERENCES dcl_subjects(id) ON DELETE CASCADE,
    enabled boolean NOT NULL,
    revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
    updated_at timestamptz NOT NULL,
    updated_by varchar(26) NOT NULL REFERENCES app_users(id)
);

CREATE TABLE wfl_trials (
    approval_entry_id varchar(26) NOT NULL REFERENCES approval_entries(id) ON DELETE CASCADE,
    document_id varchar(26) NOT NULL REFERENCES vou_documents(id) ON DELETE RESTRICT,
    payload_digest varchar(64) NOT NULL CHECK (payload_digest ~ '^[0-9a-f]{64}$'),
    result jsonb NOT NULL CHECK (jsonb_typeof(result) = 'object'),
    created_at timestamptz NOT NULL,
    created_by varchar(26) NOT NULL REFERENCES app_users(id),
    PRIMARY KEY (approval_entry_id, document_id, payload_digest)
);

CREATE TABLE wfl_instances (
    id varchar(26) PRIMARY KEY,
    definition_subject_id varchar(26) NOT NULL REFERENCES dcl_subjects(id) ON DELETE RESTRICT,
    approval_entry_id varchar(26) NOT NULL REFERENCES approval_entries(id) ON DELETE RESTRICT,
    definition_code varchar(64) NOT NULL,
    definition_name varchar(200) NOT NULL,
    root_document_id varchar(26) NOT NULL REFERENCES vou_documents(id) ON DELETE RESTRICT,
    created_at timestamptz NOT NULL,
    UNIQUE (definition_subject_id, root_document_id)
);

CREATE TABLE wfl_instance_nodes (
    id varchar(26) PRIMARY KEY,
    instance_id varchar(26) NOT NULL REFERENCES wfl_instances(id) ON DELETE CASCADE,
    node_key varchar(64) NOT NULL,
    document_id varchar(26) REFERENCES vou_documents(id) ON DELETE RESTRICT,
    parent_node_id varchar(26) REFERENCES wfl_instance_nodes(id) ON DELETE RESTRICT,
    relation varchar(64),
    created_at timestamptz NOT NULL,
    UNIQUE (instance_id, node_key, document_id)
);

CREATE TABLE wfl_action_results (
    id varchar(26) PRIMARY KEY,
    instance_id varchar(26) NOT NULL REFERENCES wfl_instances(id) ON DELETE CASCADE,
    source_node_id varchar(26) NOT NULL REFERENCES wfl_instance_nodes(id) ON DELETE RESTRICT,
    script_position varchar(128) NOT NULL,
    fingerprint varchar(64) NOT NULL CHECK (fingerprint ~ '^[0-9a-f]{64}$'),
    target_document_id varchar(26) REFERENCES vou_documents(id) ON DELETE RESTRICT,
    active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL,
    UNIQUE (instance_id, source_node_id, script_position)
);

CREATE TABLE wfl_runtime_audits (
    id varchar(26) PRIMARY KEY,
    instance_id varchar(26) NOT NULL REFERENCES wfl_instances(id) ON DELETE CASCADE,
    action varchar(64) NOT NULL,
    actor_id varchar(26) NOT NULL REFERENCES app_users(id),
    details jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(details) = 'object'),
    created_at timestamptz NOT NULL
);

CREATE TABLE rpt_execution_audits (
    id varchar(26) PRIMARY KEY,
    definition_subject_id varchar(26) NOT NULL REFERENCES dcl_subjects(id) ON DELETE RESTRICT,
    approval_entry_id varchar(26) NOT NULL REFERENCES approval_entries(id) ON DELETE RESTRICT,
    actor_id varchar(26) NOT NULL REFERENCES app_users(id),
    action varchar(16) NOT NULL CHECK (action IN ('QUERY', 'EXPORT', 'VALIDATE')),
    parameters jsonb NOT NULL CHECK (jsonb_typeof(parameters) = 'object'),
    row_count integer CHECK (row_count IS NULL OR row_count >= 0),
    request_id varchar(128) NOT NULL,
    created_at timestamptz NOT NULL
);

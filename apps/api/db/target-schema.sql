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
    menu_order integer,
    CHECK (path = '/' || domain || '/' || entity || '/' || action),
    CHECK (menu_order IS NULL OR action = 'query')
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

CREATE TABLE dcl_code_counters (
    entity varchar(64) PRIMARY KEY,
    next_value integer NOT NULL CHECK (next_value BETWEEN 1 AND 9999)
);
INSERT INTO dcl_code_counters(entity, next_value) VALUES ('warehouse', 1);

CREATE TABLE dcl_subjects (
    id varchar(26) PRIMARY KEY,
    entity varchar(64) NOT NULL CHECK (entity = 'warehouse'),
    code varchar(64) NOT NULL CHECK (code ~ '^WHS-[0-9]{4}$'),
    created_at timestamptz NOT NULL,
    created_by varchar(26) NOT NULL REFERENCES app_users(id)
);
CREATE UNIQUE INDEX dcl_subjects_entity_code_unique
    ON dcl_subjects(entity, upper(code));

CREATE TABLE approval_entries (
    id varchar(26) PRIMARY KEY,
    domain varchar(32) NOT NULL CHECK (domain = 'dcl'),
    entity varchar(64) NOT NULL CHECK (entity = 'warehouse'),
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

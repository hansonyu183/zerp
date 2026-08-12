-- +goose Up

ALTER TABLE acc_books
    ADD COLUMN subject_template varchar(20) NOT NULL DEFAULT 'EMPTY'
        CHECK (subject_template IN ('ENTERPRISE', 'SMALL_BUSINESS', 'EMPTY'));

CREATE TABLE acc_subjects (
    id varchar(26) PRIMARY KEY,
    book_id varchar(26) NOT NULL REFERENCES acc_books(id) ON DELETE CASCADE,
    code varchar(32) NOT NULL CHECK (code ~ '^[A-Z0-9][A-Z0-9.-]{0,31}$'),
    name varchar(200) NOT NULL CHECK (btrim(name) <> ''),
    parent_subject_id varchar(26),
    balance_direction varchar(6) NOT NULL CHECK (balance_direction IN ('DEBIT', 'CREDIT')),
    enabled boolean NOT NULL DEFAULT true,
    inventory_quantity boolean NOT NULL DEFAULT false,
    settlement_purpose varchar(20) NOT NULL DEFAULT 'NONE'
        CHECK (settlement_purpose IN (
            'NONE', 'RECEIVABLE', 'PREPAID', 'PAYABLE', 'ADVANCE_RECEIPT', 'OTHER'
        )),
    revision bigint NOT NULL DEFAULT 1 CHECK (revision >= 1),
    created_at timestamptz NOT NULL DEFAULT now(),
    created_by varchar(26) NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
    updated_at timestamptz NOT NULL DEFAULT now(),
    updated_by varchar(26) NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
    UNIQUE (book_id, code),
    UNIQUE (book_id, id),
    FOREIGN KEY (book_id, parent_subject_id)
        REFERENCES acc_subjects(book_id, id) ON DELETE RESTRICT
);
CREATE INDEX acc_subjects_parent_idx ON acc_subjects (book_id, parent_subject_id, code);

CREATE TABLE acc_subject_dimensions (
    subject_id varchar(26) NOT NULL REFERENCES acc_subjects(id) ON DELETE CASCADE,
    dimension varchar(20) NOT NULL CHECK (dimension IN (
        'CUSTOMER', 'SUPPLIER', 'OTHER_PARTY', 'EMPLOYEE', 'DEPARTMENT',
        'PRODUCT', 'WAREHOUSE', 'FUND_ACCOUNT', 'ASSET', 'BILL'
    )),
    PRIMARY KEY (subject_id, dimension)
);

CREATE TABLE acc_subject_usages (
    subject_id varchar(26) NOT NULL REFERENCES acc_subjects(id) ON DELETE RESTRICT,
    usage_type varchar(32) NOT NULL CHECK (usage_type ~ '^[A-Z][A-Z0-9_]{0,31}$'),
    usage_id varchar(64) NOT NULL CHECK (btrim(usage_id) <> ''),
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (subject_id, usage_type, usage_id)
);

INSERT INTO app_permissions (
    id, path, domain, entity, action, description, status, menu_order
) VALUES
    ('01JACC00000000000000000101', '/acc/subject/query', 'acc', 'subject', 'query', '查询会计科目', 'ENABLED', 20),
    ('01JACC00000000000000000102', '/acc/subject/get', 'acc', 'subject', 'get', '查看会计科目', 'ENABLED', NULL),
    ('01JACC00000000000000000103', '/acc/subject/create', 'acc', 'subject', 'create', '创建会计科目', 'ENABLED', NULL),
    ('01JACC00000000000000000104', '/acc/subject/save', 'acc', 'subject', 'save', '修改会计科目', 'ENABLED', NULL),
    ('01JACC00000000000000000105', '/acc/subject/delete', 'acc', 'subject', 'delete', '删除会计科目', 'ENABLED', NULL);

-- +goose Down

DELETE FROM app_permissions WHERE domain = 'acc' AND entity = 'subject';
DROP TABLE acc_subject_usages;
DROP TABLE acc_subject_dimensions;
DROP TABLE acc_subjects;
ALTER TABLE acc_books DROP COLUMN subject_template;

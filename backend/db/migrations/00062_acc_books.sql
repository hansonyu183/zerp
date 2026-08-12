-- +goose Up

ALTER TABLE object_number_counters
    DROP CONSTRAINT object_number_counters_domain_check,
    ADD CONSTRAINT object_number_counters_domain_check
        CHECK (domain IN ('bob', 'aux', 'acc'));

CREATE TABLE acc_books (
    id varchar(26) PRIMARY KEY,
    code varchar(64) NOT NULL UNIQUE CHECK (code ~ '^[A-Z0-9][A-Z0-9._-]{0,63}$'),
    name varchar(200) NOT NULL CHECK (btrim(name) <> ''),
    description varchar(1000) NOT NULL DEFAULT '',
    start_month date NOT NULL CHECK (start_month = date_trunc('month', start_month)::date),
    base_currency varchar(3) NOT NULL CHECK (base_currency ~ '^[A-Z]{3}$'),
    control_book boolean NOT NULL DEFAULT false,
    revision bigint NOT NULL DEFAULT 1 CHECK (revision >= 1),
    created_at timestamptz NOT NULL DEFAULT now(),
    created_by varchar(26) NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
    updated_at timestamptz NOT NULL DEFAULT now(),
    updated_by varchar(26) NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX acc_books_single_control_uq ON acc_books (control_book) WHERE control_book;

CREATE TABLE acc_book_user_scopes (
    book_id varchar(26) NOT NULL REFERENCES acc_books(id) ON DELETE CASCADE,
    user_id varchar(26) NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
    query_access boolean NOT NULL DEFAULT false,
    operate_access boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now(),
    created_by varchar(26) NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
    PRIMARY KEY (book_id, user_id),
    CHECK (query_access OR operate_access)
);
CREATE INDEX acc_book_user_scopes_user_idx
    ON acc_book_user_scopes (user_id, book_id);

INSERT INTO app_permissions (
    id, path, domain, entity, action, description, status, menu_order
) VALUES
    ('01JACCBOOK0000000000000001', '/acc/book/query', 'acc', 'book', 'query', '查询会计账簿', 'ENABLED', 10),
    ('01JACCBOOK0000000000000002', '/acc/book/get', 'acc', 'book', 'get', '查看会计账簿', 'ENABLED', NULL),
    ('01JACCBOOK0000000000000003', '/acc/book/create', 'acc', 'book', 'create', '创建会计账簿', 'ENABLED', NULL),
    ('01JACCBOOK0000000000000004', '/acc/book/save', 'acc', 'book', 'save', '修改会计账簿', 'ENABLED', NULL),
    ('01JACCBOOK0000000000000005', '/acc/book/delete', 'acc', 'book', 'delete', '删除会计账簿', 'ENABLED', NULL);

-- +goose Down

DELETE FROM app_permissions WHERE domain = 'acc' AND entity = 'book';
DROP TABLE acc_book_user_scopes;
DROP TABLE acc_books;
DELETE FROM object_number_counters WHERE domain = 'acc';
ALTER TABLE object_number_counters
    DROP CONSTRAINT object_number_counters_domain_check,
    ADD CONSTRAINT object_number_counters_domain_check
        CHECK (domain IN ('bob', 'aux'));

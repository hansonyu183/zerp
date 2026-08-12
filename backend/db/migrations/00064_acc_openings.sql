-- +goose Up

CREATE TABLE acc_vouchers (
    id varchar(26) PRIMARY KEY,
    book_id varchar(26) NOT NULL REFERENCES acc_books(id) ON DELETE RESTRICT,
    source_type varchar(24) NOT NULL CHECK (source_type IN ('OPENING', 'VOU', 'COST_SETTLEMENT', 'DEPRECIATION')),
    source_id varchar(64) NOT NULL CHECK (btrim(source_id) <> ''),
    business_date date NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    created_by varchar(26) NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
    UNIQUE (book_id, source_type, source_id),
    UNIQUE (book_id, id)
);

CREATE TABLE acc_openings (
    book_id varchar(26) PRIMARY KEY REFERENCES acc_books(id) ON DELETE CASCADE,
    state varchar(10) NOT NULL DEFAULT 'DRAFT' CHECK (state IN ('DRAFT', 'APPROVED')),
    voucher_id varchar(26),
    revision bigint NOT NULL DEFAULT 1 CHECK (revision >= 1),
    approved_at timestamptz,
    approved_by varchar(26) REFERENCES app_users(id) ON DELETE RESTRICT,
    created_at timestamptz NOT NULL DEFAULT now(),
    created_by varchar(26) NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
    updated_at timestamptz NOT NULL DEFAULT now(),
    updated_by varchar(26) NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
    FOREIGN KEY (book_id, voucher_id) REFERENCES acc_vouchers(book_id, id) ON DELETE SET NULL,
    CHECK (
        (state = 'DRAFT' AND voucher_id IS NULL AND approved_at IS NULL AND approved_by IS NULL)
        OR (state = 'APPROVED' AND voucher_id IS NOT NULL AND approved_at IS NOT NULL AND approved_by IS NOT NULL)
    )
);

CREATE TABLE acc_opening_lines (
    id varchar(26) PRIMARY KEY,
    book_id varchar(26) NOT NULL REFERENCES acc_openings(book_id) ON DELETE CASCADE,
    subject_id varchar(26) NOT NULL,
    currency varchar(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
    debit_minor bigint NOT NULL DEFAULT 0 CHECK (debit_minor >= 0),
    credit_minor bigint NOT NULL DEFAULT 0 CHECK (credit_minor >= 0),
    quantity_micros bigint CHECK (quantity_micros > 0),
    dimensions jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(dimensions) = 'object'),
    line_order integer NOT NULL CHECK (line_order >= 0),
    FOREIGN KEY (book_id, subject_id) REFERENCES acc_subjects(book_id, id) ON DELETE RESTRICT,
    CHECK ((debit_minor > 0 AND credit_minor = 0) OR (credit_minor > 0 AND debit_minor = 0)),
    UNIQUE (book_id, line_order)
);

CREATE TABLE acc_voucher_lines (
    id varchar(26) PRIMARY KEY,
	book_id varchar(26) NOT NULL,
	voucher_id varchar(26) NOT NULL,
	subject_id varchar(26) NOT NULL,
    currency varchar(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
    debit_minor bigint NOT NULL DEFAULT 0 CHECK (debit_minor >= 0),
    credit_minor bigint NOT NULL DEFAULT 0 CHECK (credit_minor >= 0),
    quantity_micros bigint CHECK (quantity_micros > 0),
    dimensions jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(dimensions) = 'object'),
    source_line_id varchar(64) NOT NULL CHECK (btrim(source_line_id) <> ''),
    line_order integer NOT NULL CHECK (line_order >= 0),
    CHECK ((debit_minor > 0 AND credit_minor = 0) OR (credit_minor > 0 AND debit_minor = 0)),
	FOREIGN KEY (book_id, voucher_id) REFERENCES acc_vouchers(book_id, id) ON DELETE CASCADE,
	FOREIGN KEY (book_id, subject_id) REFERENCES acc_subjects(book_id, id) ON DELETE RESTRICT,
    UNIQUE (voucher_id, line_order)
);

INSERT INTO app_permissions (
    id, path, domain, entity, action, description, status, menu_order
) VALUES
	('01JACC00000000000000000106', '/acc/opening/query', 'acc', 'opening', 'query', '查看账簿期初', 'ENABLED', 30),
    ('01JACC00000000000000000107', '/acc/opening/save', 'acc', 'opening', 'save', '保存账簿期初', 'ENABLED', NULL),
    ('01JACC00000000000000000108', '/acc/opening/approve', 'acc', 'opening', 'approve', '批准账簿期初', 'ENABLED', NULL),
    ('01JACC00000000000000000109', '/acc/opening/unapprove', 'acc', 'opening', 'unapprove', '反批准账簿期初', 'ENABLED', NULL);

-- +goose Down

DELETE FROM app_permissions WHERE domain = 'acc' AND entity = 'opening';
DROP TABLE acc_voucher_lines;
DROP TABLE acc_opening_lines;
DROP TABLE acc_openings;
DROP TABLE acc_vouchers;

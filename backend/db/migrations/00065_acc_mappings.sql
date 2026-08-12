-- +goose Up

CREATE TABLE acc_mapping_versions (
    id varchar(26) PRIMARY KEY,
    book_id varchar(26) NOT NULL REFERENCES acc_books(id) ON DELETE CASCADE,
    vou_entity varchar(64) NOT NULL CHECK (vou_entity ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
    version integer NOT NULL CHECK (version >= 1),
    state varchar(10) NOT NULL DEFAULT 'DRAFT' CHECK (state IN ('DRAFT', 'APPROVED')),
    default_result varchar(7) NOT NULL CHECK (default_result IN ('POST', 'UN_POST')),
    definition jsonb NOT NULL CHECK (jsonb_typeof(definition) = 'object'),
    revision bigint NOT NULL DEFAULT 1 CHECK (revision >= 1),
    approved_at timestamptz,
    approved_by varchar(26) REFERENCES app_users(id) ON DELETE RESTRICT,
    created_at timestamptz NOT NULL DEFAULT now(),
    created_by varchar(26) NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
    updated_at timestamptz NOT NULL DEFAULT now(),
    updated_by varchar(26) NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
    UNIQUE (book_id, id),
    UNIQUE (book_id, vou_entity, version),
    CHECK (
        (state = 'DRAFT' AND approved_at IS NULL AND approved_by IS NULL)
        OR (state = 'APPROVED' AND approved_at IS NOT NULL AND approved_by IS NOT NULL)
    )
);
CREATE UNIQUE INDEX acc_mapping_versions_one_draft_idx
    ON acc_mapping_versions (book_id, vou_entity) WHERE state = 'DRAFT';

ALTER TABLE acc_vouchers
	ADD COLUMN mapping_version_id varchar(26),
	ADD CONSTRAINT acc_vouchers_mapping_version_fk
		FOREIGN KEY (book_id, mapping_version_id)
		REFERENCES acc_mapping_versions(book_id, id) ON DELETE RESTRICT;

INSERT INTO app_permissions (
    id, path, domain, entity, action, description, status, menu_order
) VALUES
    ('01JACC00000000000000000110', '/acc/mapping/query', 'acc', 'mapping', 'query', '查询会计映射', 'ENABLED', 40),
    ('01JACC00000000000000000111', '/acc/mapping/get', 'acc', 'mapping', 'get', '查看会计映射', 'ENABLED', NULL),
    ('01JACC00000000000000000112', '/acc/mapping/create', 'acc', 'mapping', 'create', '创建会计映射版本', 'ENABLED', NULL),
    ('01JACC00000000000000000113', '/acc/mapping/save', 'acc', 'mapping', 'save', '保存会计映射版本', 'ENABLED', NULL),
    ('01JACC00000000000000000114', '/acc/mapping/approve', 'acc', 'mapping', 'approve', '批准会计映射版本', 'ENABLED', NULL),
    ('01JACC00000000000000000115', '/acc/mapping/unapprove', 'acc', 'mapping', 'unapprove', '反批准会计映射版本', 'ENABLED', NULL),
    ('01JACC00000000000000000116', '/acc/mapping/catalog', 'acc', 'mapping', 'catalog', '查看 VOU 映射字段目录', 'ENABLED', NULL);

-- +goose Down

DELETE FROM app_permissions WHERE domain = 'acc' AND entity = 'mapping';
ALTER TABLE acc_vouchers DROP COLUMN mapping_version_id;
DROP TABLE acc_mapping_versions;

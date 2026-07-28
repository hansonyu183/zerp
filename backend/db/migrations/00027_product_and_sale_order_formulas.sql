-- +goose Up

CREATE TABLE bob_product_formulas (
    product_version_id varchar(26) PRIMARY KEY
        REFERENCES bob_product_versions(version_id) ON DELETE RESTRICT,
    base_output_quantity_micros bigint NOT NULL
        CHECK (base_output_quantity_micros > 0)
);

CREATE TABLE bob_product_formula_lines (
    product_version_id varchar(26) NOT NULL
        REFERENCES bob_product_formulas(product_version_id) ON DELETE CASCADE,
    line_no integer NOT NULL CHECK (line_no >= 1),
    material_object_id varchar(26) NOT NULL
        REFERENCES bob_objects(id) ON DELETE RESTRICT,
    material_version_id varchar(26) NOT NULL
        REFERENCES bob_versions(id) ON DELETE RESTRICT,
    quantity_micros bigint NOT NULL CHECK (quantity_micros > 0),
    PRIMARY KEY (product_version_id, line_no),
    UNIQUE (product_version_id, material_object_id)
);

CREATE TABLE vou_sale_order_formulas (
    product_line_id varchar(26) PRIMARY KEY
        REFERENCES vou_product_lines(id) ON DELETE CASCADE,
    source_type varchar(32) NOT NULL
        CHECK (source_type IN ('RAW_SELF', 'PRODUCT_FIXED', 'CUSTOMER_LATEST', 'MANUAL')),
    source_document_id varchar(26)
        REFERENCES vou_documents(id) ON DELETE RESTRICT,
    source_document_no varchar(64),
    base_output_quantity_micros bigint NOT NULL
        CHECK (base_output_quantity_micros > 0),
    CONSTRAINT vou_sale_order_formula_source_ck CHECK (
        (source_type = 'CUSTOMER_LATEST'
            AND source_document_id IS NOT NULL AND source_document_no IS NOT NULL)
        OR
        (source_type <> 'CUSTOMER_LATEST'
            AND source_document_id IS NULL AND source_document_no IS NULL)
    )
);

CREATE TABLE vou_sale_order_formula_lines (
    product_line_id varchar(26) NOT NULL
        REFERENCES vou_sale_order_formulas(product_line_id) ON DELETE CASCADE,
    line_no integer NOT NULL CHECK (line_no >= 1),
    material_object_id varchar(26) NOT NULL,
    material_version_id varchar(26) NOT NULL,
    material_code varchar(64) NOT NULL,
    material_name varchar(200) NOT NULL,
    material_unit varchar(32) NOT NULL,
    quantity_micros bigint NOT NULL CHECK (quantity_micros > 0),
    PRIMARY KEY (product_line_id, line_no),
    UNIQUE (product_line_id, material_object_id)
);

CREATE INDEX vou_sale_order_formula_material_idx
    ON vou_sale_order_formula_lines(material_object_id, material_version_id);

INSERT INTO app_permissions (
    id, path, domain, entity, action, description, status
) VALUES (
    '01JVOU00000000000000000149', '/vou/sale-order/formula-default',
    'vou', 'sale-order', 'formula-default', '解析销售订单默认配方', 'ENABLED'
);

INSERT INTO app_role_permissions (role_id, permission_id, created_by)
SELECT role.id, '01JVOU00000000000000000149', role.updated_by
FROM app_roles role
WHERE role.code = 'superadmin'
ON CONFLICT DO NOTHING;

INSERT INTO app_role_permissions (role_id, permission_id, created_by)
SELECT DISTINCT role_permission.role_id, '01JVOU00000000000000000149',
       role_permission.created_by
FROM app_role_permissions role_permission
JOIN app_permissions permission ON permission.id = role_permission.permission_id
WHERE permission.path IN (
    '/vou/sale-order/create',
    '/vou/sale-order/save'
)
ON CONFLICT DO NOTHING;

-- +goose Down

DELETE FROM app_role_permissions
WHERE permission_id = '01JVOU00000000000000000149';
DELETE FROM app_permissions
WHERE id = '01JVOU00000000000000000149';
DROP TABLE vou_sale_order_formula_lines;
DROP TABLE vou_sale_order_formulas;
DROP TABLE bob_product_formula_lines;
DROP TABLE bob_product_formulas;

-- +goose Up

ALTER TABLE app_permissions
    ADD COLUMN menu_order integer CHECK (menu_order IS NULL OR action = 'query');

UPDATE app_permissions AS permission
SET menu_order = registered.menu_order
FROM (VALUES
    ('bob', 'customer', 10),
    ('bob', 'supplier', 20),
    ('bob', 'other-party', 25),
    ('bob', 'employee', 30),
    ('bob', 'product', 40),
    ('bob', 'service', 50),
    ('bob', 'warehouse', 60),
    ('bob', 'vehicle', 70),
    ('bob', 'fund-account', 80),
    ('bob', 'settlement-method', 90),
    ('aux', 'asset-category', 5),
    ('aux', 'product-category', 10),
    ('aux', 'product-type', 15),
    ('aux', 'department', 20),
    ('aux', 'position', 30),
    ('aux', 'measurement-unit', 50),
    ('aux', 'dictionary-type', 60),
    ('aux', 'dictionary-item', 70),
    ('aux', 'income-expense-type', 80),
    ('aux', 'account-subject', 90),
    ('vou', 'sale-pricing', 5),
    ('vou', 'sale-order', 10),
    ('vou', 'sale-outbound', 20),
    ('vou', 'sale-delivery', 30),
    ('vou', 'sale-signoff', 40),
    ('vou', 'sale-return', 50),
    ('vou', 'order-production', 55),
    ('vou', 'self-production', 56),
    ('vou', 'inventory-count', 57),
    ('vou', 'purchase-inquiry', 58),
    ('vou', 'purchase-order', 60),
    ('vou', 'purchase-inbound', 70),
    ('vou', 'purchase-return', 75),
    ('vou', 'customer-receipt', 80),
    ('vou', 'supplier-receipt', 81),
    ('vou', 'other-receipt', 82),
    ('vou', 'customer-payment', 90),
    ('vou', 'supplier-payment', 91),
    ('vou', 'other-payment', 92),
    ('vou', 'employee-loan', 95),
    ('vou', 'employee-repayment', 96),
    ('vou', 'employee-loan-writeoff', 97),
    ('vou', 'expense-reimbursement', 100),
    ('vou', 'expense-payment', 105),
    ('vou', 'other-income', 110),
    ('vou', 'asset-acquisition', 120),
    ('vou', 'asset-depreciation', 121),
    ('vou', 'asset-sale', 122),
    ('vou', 'asset-liquidation', 123),
    ('vou', 'bill-receipt', 130),
    ('vou', 'bill-payment', 131),
    ('vou', 'bill-issue', 132),
    ('vou', 'bill-discount', 133),
    ('vou', 'bill-maturity', 134),
    ('wfl', 'process-definition', 10),
    ('wfl', 'process-instance', 20),
    ('led', 'closing', 10),
    ('led', 'inventory', 20),
    ('led', 'fund', 30),
    ('led', 'customer', 40),
    ('led', 'supplier', 41),
    ('led', 'other', 42),
    ('led', 'employee', 43),
    ('led', 'container', 50),
    ('led', 'asset', 60),
    ('led', 'bill', 70)
) AS registered(domain, entity, menu_order)
WHERE permission.domain = registered.domain
  AND permission.entity = registered.entity
  AND permission.action = 'query';

CREATE TABLE app_business_menu_items (
    id varchar(64) PRIMARY KEY,
    parent_id varchar(64),
    item_type varchar(8) NOT NULL CHECK (item_type IN ('GROUP', 'ROUTE')),
    item_level smallint NOT NULL CHECK (item_level IN (1, 2)),
    sort_order integer NOT NULL CHECK (sort_order >= 0),
    display_name varchar(128) NOT NULL CHECK (btrim(display_name) <> ''),
    icon varchar(128),
    enabled boolean NOT NULL DEFAULT true,
    route_key varchar(128),
    permission_code varchar(256),
    revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
    created_at timestamptz NOT NULL DEFAULT now(),
    created_by varchar(26) REFERENCES app_users(id) ON DELETE RESTRICT,
    updated_at timestamptz NOT NULL DEFAULT now(),
    updated_by varchar(26) REFERENCES app_users(id) ON DELETE RESTRICT,
    CONSTRAINT app_business_menu_items_parent_fk
        FOREIGN KEY (parent_id) REFERENCES app_business_menu_items(id)
        ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED,
    CONSTRAINT app_business_menu_items_shape CHECK (
        (item_type = 'GROUP' AND item_level = 1 AND parent_id IS NULL
            AND route_key IS NULL AND permission_code IS NULL)
        OR
        (item_type = 'ROUTE' AND item_level = 2 AND parent_id IS NOT NULL
            AND route_key IS NOT NULL AND permission_code IS NOT NULL)
    )
);

CREATE INDEX app_business_menu_items_parent_order_idx
    ON app_business_menu_items(parent_id, sort_order, id);
CREATE INDEX app_business_menu_items_route_key_idx
    ON app_business_menu_items(route_key) WHERE item_type = 'ROUTE';

INSERT INTO app_business_menu_items (
    id, item_type, item_level, sort_order, display_name, icon, enabled,
    revision, created_by, updated_by
) VALUES
('menu-group-workbench', 'GROUP', 1, 10, '工作台', 'mdi-view-dashboard-outline', true, 1, '01JAPPSYST3MACTR0000000000', '01JAPPSYST3MACTR0000000000'),
('menu-group-sales', 'GROUP', 1, 20, '销售', 'mdi-cart-arrow-up', true, 1, '01JAPPSYST3MACTR0000000000', '01JAPPSYST3MACTR0000000000'),
('menu-group-purchase', 'GROUP', 1, 30, '采购', 'mdi-cart-arrow-down', true, 1, '01JAPPSYST3MACTR0000000000', '01JAPPSYST3MACTR0000000000'),
('menu-group-production', 'GROUP', 1, 40, '生产', 'mdi-factory', true, 1, '01JAPPSYST3MACTR0000000000', '01JAPPSYST3MACTR0000000000'),
('menu-group-inventory', 'GROUP', 1, 50, '库存', 'mdi-warehouse', true, 1, '01JAPPSYST3MACTR0000000000', '01JAPPSYST3MACTR0000000000'),
('menu-group-cash', 'GROUP', 1, 60, '出纳', 'mdi-cash-register', true, 1, '01JAPPSYST3MACTR0000000000', '01JAPPSYST3MACTR0000000000'),
('menu-group-assets', 'GROUP', 1, 70, '资产', 'mdi-office-building-cog-outline', true, 1, '01JAPPSYST3MACTR0000000000', '01JAPPSYST3MACTR0000000000'),
('menu-group-people', 'GROUP', 1, 80, '人事', 'mdi-account-group-outline', true, 1, '01JAPPSYST3MACTR0000000000', '01JAPPSYST3MACTR0000000000'),
('menu-group-accounting', 'GROUP', 1, 90, '会计', 'mdi-calculator-variant-outline', true, 1, '01JAPPSYST3MACTR0000000000', '01JAPPSYST3MACTR0000000000'),
('menu-group-master-data', 'GROUP', 1, 100, '基础资料', 'mdi-database-outline', true, 1, '01JAPPSYST3MACTR0000000000', '01JAPPSYST3MACTR0000000000'),
('menu-group-auxiliary-data', 'GROUP', 1, 110, '辅助资料', 'mdi-shape-plus-outline', true, 1, '01JAPPSYST3MACTR0000000000', '01JAPPSYST3MACTR0000000000'),
('menu-group-workflow', 'GROUP', 1, 120, '业务流程', 'mdi-transit-connection-variant', true, 1, '01JAPPSYST3MACTR0000000000', '01JAPPSYST3MACTR0000000000'),
('menu-group-system', 'GROUP', 1, 130, '系统管理', 'mdi-cog-outline', true, 1, '01JAPPSYST3MACTR0000000000', '01JAPPSYST3MACTR0000000000'),
('menu-group-other', 'GROUP', 1, 140, '其他/待归类', 'mdi-folder-question-outline', true, 1, '01JAPPSYST3MACTR0000000000', '01JAPPSYST3MACTR0000000000');

WITH permission_routes AS (
    SELECT
        domain || '/' || entity AS route_key,
        '/' || domain || '/' || entity AS route_path,
        (array_agg(path ORDER BY
            CASE action WHEN 'query' THEN 0 WHEN 'get' THEN 1 ELSE 2 END,
            path
        ))[1] AS permission_code,
        (array_agg(description ORDER BY
            CASE action WHEN 'query' THEN 0 WHEN 'get' THEN 1 ELSE 2 END,
            path
        ))[1] AS permission_description,
        min(menu_order) FILTER (WHERE action = 'query') AS menu_order,
        domain,
        entity
    FROM app_permissions
    WHERE status = 'ENABLED' AND domain <> 'app'
    GROUP BY domain, entity
), classified AS (
    SELECT *,
        CASE
            WHEN domain = 'vou' AND entity LIKE 'sale-%' THEN 'menu-group-sales'
            WHEN domain = 'bob' AND entity = 'customer' THEN 'menu-group-sales'
            WHEN domain = 'vou' AND entity LIKE 'purchase-%' THEN 'menu-group-purchase'
            WHEN domain = 'bob' AND entity = 'supplier' THEN 'menu-group-purchase'
            WHEN domain = 'vou' AND entity IN ('order-production', 'self-production') THEN 'menu-group-production'
            WHEN (domain = 'vou' AND entity = 'inventory-count')
              OR (domain = 'bob' AND entity IN ('product', 'warehouse'))
              OR (domain = 'led' AND entity = 'inventory') THEN 'menu-group-inventory'
            WHEN (domain = 'vou' AND (
                    entity LIKE '%-receipt' OR entity LIKE '%-payment'
                    OR entity LIKE 'bill-%' OR entity IN (
                        'expense-reimbursement', 'employee-loan', 'employee-repayment',
                        'employee-loan-writeoff', 'expense-payment', 'other-income'
                    )
                ))
              OR (domain = 'bob' AND entity = 'fund-account')
              OR (domain = 'led' AND entity IN ('fund', 'party', 'customer', 'supplier', 'other', 'employee', 'container', 'bill'))
                THEN 'menu-group-cash'
            WHEN (domain = 'vou' AND entity LIKE 'asset-%')
              OR (domain = 'aux' AND entity = 'asset-category')
              OR (domain = 'led' AND entity = 'asset') THEN 'menu-group-assets'
            WHEN (domain = 'bob' AND entity = 'employee')
              OR (domain = 'aux' AND entity IN ('department', 'position')) THEN 'menu-group-people'
            WHEN domain = 'led' AND entity = 'closing' THEN 'menu-group-accounting'
            WHEN domain = 'bob' THEN 'menu-group-master-data'
            WHEN domain = 'aux' THEN 'menu-group-auxiliary-data'
            WHEN domain = 'wfl' THEN 'menu-group-workflow'
            ELSE 'menu-group-other'
        END AS parent_id
    FROM permission_routes
), numbered AS (
    SELECT *, row_number() OVER (
        PARTITION BY parent_id
        ORDER BY menu_order NULLS LAST, route_key
    ) * 10 AS route_order
    FROM classified
)
INSERT INTO app_business_menu_items (
    id, parent_id, item_type, item_level, sort_order, display_name, enabled,
    route_key, permission_code, revision, created_by, updated_by
)
SELECT
    'route-' || md5(route_key), parent_id, 'ROUTE', 2, route_order,
    COALESCE(
        NULLIF(regexp_replace(permission_description,
            '^(查询|查看|读取|创建|新增|修改|保存|启用|停用|删除|提交|审核|批准|驳回|核对|完成)', ''), ''),
        initcap(replace(entity, '-', ' '))
    ),
    true, route_key, permission_code, 1,
    '01JAPPSYST3MACTR0000000000', '01JAPPSYST3MACTR0000000000'
FROM numbered;

INSERT INTO app_business_menu_items (
    id, parent_id, item_type, item_level, sort_order, display_name, icon,
    enabled, route_key, permission_code, revision, created_by, updated_by
) VALUES
('menu-route-workbench', 'menu-group-workbench', 'ROUTE', 2, 10, '工作台', 'mdi-view-dashboard-outline', true, 'home/dashboard', '/app/workbench/query', 1, '01JAPPSYST3MACTR0000000000', '01JAPPSYST3MACTR0000000000'),
('menu-route-admin-user', 'menu-group-system', 'ROUTE', 2, 10, '用户管理', 'mdi-account-multiple-outline', true, 'admin/user', '/app/user/query', 1, '01JAPPSYST3MACTR0000000000', '01JAPPSYST3MACTR0000000000'),
('menu-route-admin-role', 'menu-group-system', 'ROUTE', 2, 20, '角色管理', 'mdi-account-key-outline', true, 'admin/role', '/app/role/query', 1, '01JAPPSYST3MACTR0000000000', '01JAPPSYST3MACTR0000000000'),
('menu-route-admin-permission', 'menu-group-system', 'ROUTE', 2, 30, '权限管理', 'mdi-shield-key-outline', true, 'admin/permission', '/app/permission/query', 1, '01JAPPSYST3MACTR0000000000', '01JAPPSYST3MACTR0000000000'),
('menu-route-admin-system-parameter', 'menu-group-system', 'ROUTE', 2, 40, '系统参数', 'mdi-tune-variant', true, 'admin/system-parameter', '/app/system-parameter/query', 1, '01JAPPSYST3MACTR0000000000', '01JAPPSYST3MACTR0000000000'),
('menu-route-admin-menu', 'menu-group-system', 'ROUTE', 2, 50, '菜单管理', 'mdi-menu-open', true, 'admin/menu', '/app/menu/save-business-template', 1, '01JAPPSYST3MACTR0000000000', '01JAPPSYST3MACTR0000000000');

INSERT INTO app_permissions (id, path, domain, entity, action, description, status) VALUES
('01JAPPMENU0000000000000001', '/app/menu/save-business-template', 'app', 'menu', 'save-business-template', '保存业务菜单模板', 'ENABLED'),
('01JAPPMENU0000000000000002', '/app/menu/activate', 'app', 'menu', 'activate', '切换菜单模式', 'ENABLED'),
('01JAPPMENU0000000000000003', '/app/menu/reset-business-template', 'app', 'menu', 'reset-business-template', '恢复初始业务菜单模板', 'ENABLED');

-- +goose Down

DELETE FROM app_role_permissions
WHERE permission_id IN (
    SELECT id FROM app_permissions WHERE domain = 'app' AND entity = 'menu'
);
DELETE FROM app_permissions WHERE domain = 'app' AND entity = 'menu';
DROP TABLE app_business_menu_items;
ALTER TABLE app_permissions DROP COLUMN menu_order;

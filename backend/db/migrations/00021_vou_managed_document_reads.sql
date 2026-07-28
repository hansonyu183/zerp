-- +goose Up
WITH entities(entity, description, attachment_action) AS (
    VALUES
        ('customer-order', '客户订单', false),
        ('procurement-order', '居间采购', true),
        ('goods-receipt', '分批收货', true),
        ('delivery-note', '分批送货', true),
        ('signoff-note', '客户签收', true)
), actions(action, description) AS (
    VALUES
        ('query', '查询'),
        ('get', '查看'),
        ('audit-history', '查看审计'),
        ('attachment-download', '下载附件')
), permissions AS (
    SELECT e.entity, a.action, a.description || e.description AS description
    FROM entities e
    CROSS JOIN actions a
    WHERE a.action <> 'attachment-download' OR e.attachment_action
)
INSERT INTO app_permissions(id, path, domain, entity, action, description, status)
SELECT 'VR' || substring(md5('/vou/' || entity || '/' || action), 1, 24),
       '/vou/' || entity || '/' || action,
       'vou', entity, action, description, 'ENABLED'
FROM permissions
ON CONFLICT (path) DO NOTHING;

-- Customer-order list/detail access follows the existing root process read permissions.
WITH mapping(source_path, entity, action) AS (
    VALUES
        ('/wfl/intermediary-trade/query', 'customer-order', 'query'),
        ('/wfl/intermediary-trade/get', 'customer-order', 'get')
)
INSERT INTO app_role_permissions(role_id, permission_id, created_by)
SELECT DISTINCT rp.role_id, target.id, rp.created_by
FROM mapping m
JOIN app_permissions source ON source.path = m.source_path
JOIN app_role_permissions rp ON rp.permission_id = source.id
JOIN app_permissions target ON target.path = '/vou/' || m.entity || '/' || m.action
ON CONFLICT DO NOTHING;

-- A stage-level get permission grants both list and detail access to the same atomic documents.
WITH mapping(source_action, entity) AS (
    VALUES
        ('procurement-get', 'procurement-order'),
        ('receipt-get', 'goods-receipt'),
        ('delivery-get', 'delivery-note'),
        ('signoff-get', 'signoff-note')
), target_actions(action) AS (
    VALUES ('query'), ('get')
)
INSERT INTO app_role_permissions(role_id, permission_id, created_by)
SELECT DISTINCT rp.role_id, target.id, rp.created_by
FROM mapping m
CROSS JOIN target_actions a
JOIN app_permissions source
  ON source.path = '/wfl/intermediary-trade/' || m.source_action
JOIN app_role_permissions rp ON rp.permission_id = source.id
JOIN app_permissions target
  ON target.path = '/vou/' || m.entity || '/' || a.action
ON CONFLICT DO NOTHING;

-- Existing workflow audit access grants the narrower per-document audit views.
INSERT INTO app_role_permissions(role_id, permission_id, created_by)
SELECT DISTINCT rp.role_id, target.id, rp.created_by
FROM app_permissions source
JOIN app_role_permissions rp ON rp.permission_id = source.id
CROSS JOIN (VALUES
    ('customer-order'),
    ('procurement-order'),
    ('goods-receipt'),
    ('delivery-note'),
    ('signoff-note')
) AS entity(value)
JOIN app_permissions target_query
  ON target_query.path = '/vou/' || entity.value || '/query'
JOIN app_role_permissions query_grant
  ON query_grant.role_id = rp.role_id AND query_grant.permission_id = target_query.id
JOIN app_permissions target
  ON target.path = '/vou/' || entity.value || '/audit-history'
WHERE source.path = '/wfl/intermediary-trade/audit-history'
ON CONFLICT DO NOTHING;

-- Attachment visibility remains stage-specific.
WITH mapping(source_action, entity) AS (
    VALUES
        ('procurement-attachment-download', 'procurement-order'),
        ('receipt-attachment-download', 'goods-receipt'),
        ('delivery-attachment-download', 'delivery-note'),
        ('signoff-attachment-download', 'signoff-note')
)
INSERT INTO app_role_permissions(role_id, permission_id, created_by)
SELECT DISTINCT rp.role_id, target.id, rp.created_by
FROM mapping m
JOIN app_permissions source
  ON source.path = '/wfl/intermediary-trade/' || m.source_action
JOIN app_role_permissions rp ON rp.permission_id = source.id
JOIN app_permissions target_query
  ON target_query.path = '/vou/' || m.entity || '/query'
JOIN app_role_permissions query_grant
  ON query_grant.role_id = rp.role_id AND query_grant.permission_id = target_query.id
JOIN app_permissions target
  ON target.path = '/vou/' || m.entity || '/attachment-download'
ON CONFLICT DO NOTHING;

INSERT INTO app_role_permissions(role_id, permission_id, created_by)
SELECT r.id, p.id, r.updated_by
FROM app_roles r
CROSS JOIN app_permissions p
WHERE r.code = 'superadmin'
  AND p.domain = 'vou'
  AND p.entity IN (
      'customer-order', 'procurement-order', 'goods-receipt',
      'delivery-note', 'signoff-note'
  )
ON CONFLICT DO NOTHING;

-- +goose Down
DELETE FROM app_role_permissions
WHERE permission_id IN (
    SELECT id
    FROM app_permissions
    WHERE domain = 'vou'
      AND entity IN (
          'customer-order', 'procurement-order', 'goods-receipt',
          'delivery-note', 'signoff-note'
      )
);

DELETE FROM app_permissions
WHERE domain = 'vou'
  AND entity IN (
      'customer-order', 'procurement-order', 'goods-receipt',
      'delivery-note', 'signoff-note'
  );

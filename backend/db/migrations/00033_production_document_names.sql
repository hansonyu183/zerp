-- +goose Up

UPDATE app_permissions
SET description = replace(description, '订单生产', '生产配货')
WHERE domain = 'vou'
  AND entity = 'order-production';

UPDATE app_permissions
SET description = replace(description, '自制品生产', '生产自制品')
WHERE domain = 'vou'
  AND entity = 'self-production';

UPDATE app_permissions
SET description = '解析生产自制品默认配方'
WHERE domain = 'vou'
  AND entity = 'self-production'
  AND action = 'formula-default';

-- +goose Down

UPDATE app_permissions
SET description = '解析自制品默认配方'
WHERE domain = 'vou'
  AND entity = 'self-production'
  AND action = 'formula-default';

UPDATE app_permissions
SET description = replace(description, '生产配货', '订单生产')
WHERE domain = 'vou'
  AND entity = 'order-production';

UPDATE app_permissions
SET description = replace(description, '生产自制品', '自制品生产')
WHERE domain = 'vou'
  AND entity = 'self-production';

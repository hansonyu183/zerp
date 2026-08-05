-- +goose Up
INSERT INTO app_permissions(id,path,domain,entity,action,description,status)
SELECT 'BLP'||substring(md5('/vou/bill-payment/'||action),1,23),'/vou/bill-payment/'||action,'vou','bill-payment',action,description,'ENABLED'
FROM (VALUES
  ('query','查询付票单'),('get','查看付票单'),('create','创建付票单'),('save','保存付票单'),
  ('check','检查付票单'),('uncheck','反检查付票单'),('approve','批准付票单'),('unapprove','反批准付票单'),
  ('finalize','完成付票单'),('unfinalize','反完成付票单'),('delete','删除付票单'),
  ('audit-history','查看付票单审计'),('attachment-initiate','上传付票单附件'),
  ('attachment-download','下载付票单附件'),('attachment-remove','删除付票单附件')
) AS x(action,description)
ON CONFLICT(path) DO NOTHING;

INSERT INTO app_role_permissions(role_id,permission_id,created_by)
SELECT role.id,permission.id,role.updated_by
FROM app_roles role CROSS JOIN app_permissions permission
WHERE role.code='superadmin' AND permission.domain='vou' AND permission.entity='bill-payment'
ON CONFLICT DO NOTHING;

-- +goose Down
DELETE FROM app_role_permissions
WHERE permission_id IN (SELECT id FROM app_permissions WHERE domain='vou' AND entity='bill-payment');
DELETE FROM app_permissions WHERE domain='vou' AND entity='bill-payment';

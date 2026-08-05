-- +goose Up
INSERT INTO app_permissions(id,path,domain,entity,action,description,status)
SELECT 'BLI'||substring(md5('/vou/bill-issue/'||action),1,23),'/vou/bill-issue/'||action,'vou','bill-issue',action,description,'ENABLED'
FROM (VALUES
  ('query','查询开票单'),('get','查看开票单'),('create','创建开票单'),('save','保存开票单'),
  ('check','检查开票单'),('uncheck','反检查开票单'),('approve','批准开票单'),('unapprove','反批准开票单'),
  ('finalize','完成开票单'),('unfinalize','反完成开票单'),('delete','删除开票单'),
  ('audit-history','查看开票单审计'),('attachment-initiate','上传开票单附件'),
  ('attachment-download','下载开票单附件'),('attachment-remove','删除开票单附件')
) AS x(action,description)
ON CONFLICT(path) DO NOTHING;

INSERT INTO app_role_permissions(role_id,permission_id,created_by)
SELECT role.id,permission.id,role.updated_by
FROM app_roles role CROSS JOIN app_permissions permission
WHERE role.code='superadmin' AND permission.domain='vou' AND permission.entity='bill-issue'
ON CONFLICT DO NOTHING;

-- +goose Down
DELETE FROM app_role_permissions
WHERE permission_id IN (SELECT id FROM app_permissions WHERE domain='vou' AND entity='bill-issue');
DELETE FROM app_permissions WHERE domain='vou' AND entity='bill-issue';

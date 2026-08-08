-- +goose Up
INSERT INTO app_permissions(id,path,domain,entity,action,description,status)
SELECT 'BLM'||substring(md5('/vou/bill-maturity/'||action),1,23),'/vou/bill-maturity/'||action,'vou','bill-maturity',action,description,'ENABLED'
FROM (VALUES ('query','查询到期单'),('get','查看到期单'),('create','创建到期单'),('save','保存到期单'),('check','检查到期单'),('uncheck','反检查到期单'),('approve','批准到期单'),('unapprove','反批准到期单'),('finalize','完成到期单'),('unfinalize','反完成到期单'),('delete','删除到期单'),('audit-history','查看到期单审计'),('attachment-initiate','上传到期单附件'),('attachment-download','下载到期单附件'),('attachment-remove','删除到期单附件')) AS x(action,description)
ON CONFLICT(path) DO NOTHING;
INSERT INTO app_role_permissions(role_id,permission_id,created_by)
SELECT role.id,permission.id,role.updated_by FROM app_roles role CROSS JOIN app_permissions permission
WHERE role.code='superadmin' AND permission.domain='vou' AND permission.entity='bill-maturity' ON CONFLICT DO NOTHING;
-- +goose Down
DELETE FROM app_role_permissions WHERE permission_id IN (SELECT id FROM app_permissions WHERE domain='vou' AND entity='bill-maturity');
DELETE FROM app_permissions WHERE domain='vou' AND entity='bill-maturity';

-- +goose Up
INSERT INTO app_permissions(id,path,domain,entity,action,description,status)
SELECT 'BLD'||substring(md5('/vou/bill-discount/'||action),1,23),'/vou/bill-discount/'||action,'vou','bill-discount',action,description,'ENABLED'
FROM (VALUES ('query','查询贴现单'),('get','查看贴现单'),('create','创建贴现单'),('save','保存贴现单'),('check','检查贴现单'),('uncheck','反检查贴现单'),('approve','批准贴现单'),('unapprove','反批准贴现单'),('finalize','完成贴现单'),('unfinalize','反完成贴现单'),('delete','删除贴现单'),('audit-history','查看贴现单审计'),('attachment-initiate','上传贴现单附件'),('attachment-download','下载贴现单附件'),('attachment-remove','删除贴现单附件')) AS x(action,description)
ON CONFLICT(path) DO NOTHING;
INSERT INTO app_role_permissions(role_id,permission_id,created_by)
SELECT role.id,permission.id,role.updated_by FROM app_roles role CROSS JOIN app_permissions permission
WHERE role.code='superadmin' AND permission.domain='vou' AND permission.entity='bill-discount' ON CONFLICT DO NOTHING;
-- +goose Down
DELETE FROM app_role_permissions WHERE permission_id IN (SELECT id FROM app_permissions WHERE domain='vou' AND entity='bill-discount');
DELETE FROM app_permissions WHERE domain='vou' AND entity='bill-discount';

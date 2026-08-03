INSERT INTO app_roles(id,code,name,status,created_by,updated_by)
VALUES('01J0000000000000000000044R','migration-00044-role','迁移 00044 权限验证','ENABLED',
       '01JAPPSYST3MACTR0000000000','01JAPPSYST3MACTR0000000000');

INSERT INTO app_role_permissions(role_id,permission_id,created_by)
SELECT '01J0000000000000000000044R',id,'01JAPPSYST3MACTR0000000000'
FROM app_permissions
WHERE (domain='vou' AND entity IN ('other-payment','other-receipt','expense-reimbursement'))
   OR (domain='led' AND entity='other');

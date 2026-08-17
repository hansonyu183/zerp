-- name: GetAppUserByUsername :one
SELECT * FROM app_users WHERE lower(username) = lower(sqlc.arg(username)) LIMIT 1;

-- name: AcquireAppAuthorizationLock :exec
SELECT pg_advisory_xact_lock(74155001);

-- name: GetAppUserByID :one
SELECT * FROM app_users WHERE id = sqlc.arg(id) LIMIT 1;

-- name: FindEnabledAppUserIDExcludingID :one
SELECT id
FROM app_users
WHERE status = 'ENABLED' AND id <> sqlc.arg(excluded_user_id)
ORDER BY created_at, id
LIMIT 1;

-- name: GetAppUserByIDForUpdate :one
SELECT * FROM app_users WHERE id = sqlc.arg(id) LIMIT 1 FOR UPDATE;

-- name: GetAppUserAvatarURL :one
SELECT p.avatar_url
FROM (VALUES (sqlc.arg(user_id)::varchar(26))) AS requested(user_id)
LEFT JOIN app_user_profiles p ON p.user_id = requested.user_id;

-- name: RecordSigninFailure :one
UPDATE app_users SET
  failed_signin_count = failed_signin_count + 1,
  locked_until = CASE WHEN failed_signin_count + 1 >= sqlc.arg(lock_threshold) THEN now() + sqlc.arg(lock_duration)::interval ELSE locked_until END,
  updated_at = now(), revision = revision + 1
WHERE id = sqlc.arg(id)
RETURNING *;

-- name: ResetSigninFailures :exec
UPDATE app_users SET failed_signin_count = 0, locked_until = NULL, updated_at = now(), revision = revision + 1
WHERE id = sqlc.arg(id) AND (failed_signin_count <> 0 OR locked_until IS NOT NULL);

-- name: CreateAppSession :exec
INSERT INTO app_sessions (id, user_id, token_hash, csrf_token_hash, last_seen_at, idle_expires_at, absolute_expires_at)
VALUES (sqlc.arg(id), sqlc.arg(user_id), sqlc.arg(token_hash), sqlc.arg(csrf_token_hash), now(), sqlc.arg(idle_expires_at), sqlc.arg(absolute_expires_at));

-- name: GetAppSessionByTokenHash :one
SELECT s.*, u.username, u.display_name, u.status AS user_status, u.password_change_required, p.avatar_url
FROM app_sessions s
JOIN app_users u ON u.id = s.user_id
LEFT JOIN app_user_profiles p ON p.user_id = u.id
WHERE s.token_hash = sqlc.arg(token_hash) LIMIT 1;

-- name: RotateAppSessionCSRF :execrows
UPDATE app_sessions SET csrf_token_hash = sqlc.arg(csrf_token_hash), last_seen_at = now(),
  idle_expires_at = LEAST(sqlc.arg(idle_expires_at), absolute_expires_at)
WHERE id = sqlc.arg(id) AND revoked_at IS NULL AND idle_expires_at > now() AND absolute_expires_at > now();

-- name: TouchAppSession :exec
UPDATE app_sessions SET last_seen_at = now(), idle_expires_at = LEAST(sqlc.arg(idle_expires_at), absolute_expires_at)
WHERE id = sqlc.arg(id) AND revoked_at IS NULL;

-- name: RevokeAppSession :exec
UPDATE app_sessions SET revoked_at = COALESCE(revoked_at, now()), revoked_reason = COALESCE(revoked_reason, sqlc.arg(reason))
WHERE id = sqlc.arg(id);

-- name: RevokeAppUserSessions :exec
UPDATE app_sessions SET revoked_at = COALESCE(revoked_at, now()), revoked_reason = COALESCE(revoked_reason, sqlc.arg(reason))
WHERE user_id = sqlc.arg(user_id) AND revoked_at IS NULL;

-- name: GetAppUserPermissions :many
SELECT p.path AS permission_path
FROM app_permissions p
WHERE p.status = 'ENABLED'
  AND (
    EXISTS (
      SELECT 1
      FROM app_user_roles ur
      JOIN app_roles r ON r.id = ur.role_id AND r.status = 'ENABLED'
      WHERE ur.user_id = sqlc.arg(user_id) AND r.code = 'superadmin'
    )
    OR EXISTS (
      SELECT 1
      FROM app_user_roles ur
      JOIN app_roles r ON r.id = ur.role_id AND r.status = 'ENABLED'
      JOIN app_role_permissions rp ON rp.role_id = r.id
      WHERE ur.user_id = sqlc.arg(user_id) AND rp.permission_id = p.id
    )
  )
ORDER BY p.path;

-- name: CreateAppAuditEvent :exec
INSERT INTO app_audit_events (id, event_type, actor_user_id, target_type, target_id, result, request_id, summary, created_by)
VALUES (sqlc.arg(id), sqlc.arg(event_type), sqlc.narg(actor_user_id), sqlc.narg(target_type), sqlc.narg(target_id), sqlc.arg(result), sqlc.narg(request_id), sqlc.arg(summary), sqlc.narg(created_by));

-- name: CountAppUsers :one
SELECT count(*) FROM app_users
WHERE (sqlc.narg(status)::text IS NULL OR status = sqlc.narg(status))
  AND (sqlc.narg(search)::text IS NULL OR username ILIKE '%' || sqlc.narg(search) || '%' OR display_name ILIKE '%' || sqlc.narg(search) || '%');

-- name: CountAppUsersExcept :one
SELECT count(*) FROM app_users WHERE id <> sqlc.arg(excluded_user_id);

-- name: ListAppUsers :many
SELECT id, username, display_name, status, failed_signin_count, locked_until, password_changed_at,
       created_at, created_by, updated_at, updated_by, revision
FROM app_users
WHERE (sqlc.narg(status)::text IS NULL OR status = sqlc.narg(status))
  AND (sqlc.narg(search)::text IS NULL OR username ILIKE '%' || sqlc.narg(search) || '%' OR display_name ILIKE '%' || sqlc.narg(search) || '%')
ORDER BY
  CASE WHEN sqlc.arg(sort_field)::text = 'username' AND sqlc.arg(sort_order)::text = 'asc' THEN username END ASC,
  CASE WHEN sqlc.arg(sort_field)::text = 'username' AND sqlc.arg(sort_order)::text = 'desc' THEN username END DESC,
  CASE WHEN sqlc.arg(sort_field)::text = 'displayName' AND sqlc.arg(sort_order)::text = 'asc' THEN display_name END ASC,
  CASE WHEN sqlc.arg(sort_field)::text = 'displayName' AND sqlc.arg(sort_order)::text = 'desc' THEN display_name END DESC,
  CASE WHEN sqlc.arg(sort_field)::text = 'createdAt' AND sqlc.arg(sort_order)::text = 'asc' THEN created_at END ASC,
  created_at DESC, id ASC
LIMIT sqlc.arg(page_size) OFFSET sqlc.arg(page_offset);

-- name: GetAppUserRoleIDs :many
SELECT role_id FROM app_user_roles WHERE user_id = sqlc.arg(user_id) ORDER BY role_id;

-- name: CountEnabledAppRolesByIDs :one
SELECT count(*) FROM app_roles WHERE status = 'ENABLED' AND id = ANY(sqlc.arg(ids)::text[]);

-- name: CountOtherEnabledUsersWithPermission :one
SELECT count(*)
FROM app_users u
WHERE u.status = 'ENABLED'
  AND u.id <> sqlc.arg(excluded_user_id)
  AND EXISTS (
    SELECT 1
    FROM app_user_roles ur
    JOIN app_roles r ON r.id = ur.role_id AND r.status = 'ENABLED'
    WHERE ur.user_id = u.id
      AND (
        (
          r.code = 'superadmin'
          AND EXISTS (
            SELECT 1 FROM app_permissions p
            WHERE p.path = sqlc.arg(path) AND p.status = 'ENABLED'
          )
        )
        OR EXISTS (
          SELECT 1
          FROM app_role_permissions rp
          JOIN app_permissions p ON p.id = rp.permission_id AND p.status = 'ENABLED'
          WHERE rp.role_id = r.id AND p.path = sqlc.arg(path)
        )
      )
  );

-- name: CountEnabledUsersWithPermissionExcludingRole :one
SELECT count(*)
FROM app_users u
WHERE u.status = 'ENABLED'
  AND EXISTS (
    SELECT 1
    FROM app_user_roles ur
    JOIN app_roles r ON r.id = ur.role_id AND r.status = 'ENABLED' AND r.id <> sqlc.arg(excluded_role_id)
    WHERE ur.user_id = u.id
      AND (
        (
          r.code = 'superadmin'
          AND EXISTS (
            SELECT 1 FROM app_permissions p
            WHERE p.path = sqlc.arg(path) AND p.status = 'ENABLED'
          )
        )
        OR EXISTS (
          SELECT 1
          FROM app_role_permissions rp
          JOIN app_permissions p ON p.id = rp.permission_id AND p.status = 'ENABLED'
          WHERE rp.role_id = r.id AND p.path = sqlc.arg(path)
        )
      )
  );

-- name: CountEnabledUsersWithPermission :one
SELECT count(*)
FROM app_users u
WHERE u.status = 'ENABLED'
  AND EXISTS (
    SELECT 1
    FROM app_user_roles ur
    JOIN app_roles r ON r.id = ur.role_id AND r.status = 'ENABLED'
    WHERE ur.user_id = u.id
      AND (
        (
          r.code = 'superadmin'
          AND EXISTS (
            SELECT 1 FROM app_permissions p
            WHERE p.path = sqlc.arg(path) AND p.status = 'ENABLED'
          )
        )
        OR EXISTS (
          SELECT 1
          FROM app_role_permissions rp
          JOIN app_permissions p ON p.id = rp.permission_id AND p.status = 'ENABLED'
          WHERE rp.role_id = r.id AND p.path = sqlc.arg(path)
        )
      )
  );

-- name: InsertAppUser :exec
INSERT INTO app_users (id, username, display_name, password_hash, status, password_change_required, password_changed_at, created_by, updated_by)
VALUES (sqlc.arg(id), sqlc.arg(username), sqlc.arg(display_name), sqlc.arg(password_hash), 'ENABLED', true, now(), sqlc.narg(actor_id), sqlc.narg(actor_id));

-- name: InsertAppBootstrapUser :exec
INSERT INTO app_users (id, username, display_name, password_hash, status, password_change_required, password_changed_at, created_by, updated_by)
VALUES (sqlc.arg(id), sqlc.arg(username), sqlc.arg(display_name), sqlc.arg(password_hash), 'ENABLED', false, now(), sqlc.narg(actor_id), sqlc.narg(actor_id));

-- name: DeleteAppUserRoles :exec
DELETE FROM app_user_roles WHERE user_id = sqlc.arg(user_id);

-- name: InsertAppUserRole :exec
INSERT INTO app_user_roles (user_id, role_id, created_by) VALUES (sqlc.arg(user_id), sqlc.arg(role_id), sqlc.narg(actor_id));

-- name: UpdateAppUser :execrows
UPDATE app_users SET display_name = sqlc.arg(display_name), updated_at = now(), updated_by = sqlc.narg(actor_id), revision = revision + 1
WHERE id = sqlc.arg(id) AND revision = sqlc.arg(revision);

-- name: UpdateCurrentAppUserProfile :one
UPDATE app_users
SET display_name = sqlc.arg(display_name),
    updated_at = now(),
    updated_by = sqlc.arg(actor_id),
    revision = revision + 1
WHERE id = sqlc.arg(id) AND status = 'ENABLED'
RETURNING *;

-- name: UpsertAppUserProfileAvatar :exec
INSERT INTO app_user_profiles (user_id, avatar_url, updated_by)
VALUES (sqlc.arg(user_id), sqlc.arg(avatar_url), sqlc.arg(actor_id))
ON CONFLICT (user_id) DO UPDATE
SET avatar_url = EXCLUDED.avatar_url,
    updated_at = now(),
    updated_by = EXCLUDED.updated_by;

-- name: DeleteAppUserProfileAvatar :exec
DELETE FROM app_user_profiles WHERE user_id = sqlc.arg(user_id);

-- name: UpdateAppUserPassword :execrows
UPDATE app_users SET
  password_hash = sqlc.arg(password_hash),
  password_changed_at = now(),
  password_change_required = false,
  failed_signin_count = 0,
  locked_until = NULL,
  updated_at = now(),
  updated_by = sqlc.narg(actor_id),
  revision = revision + 1
WHERE id = sqlc.arg(id) AND revision = sqlc.arg(revision);

-- name: ListAppUserRoleSummaries :many
SELECT r.id, r.code, r.name, r.status
FROM app_user_roles ur
JOIN app_roles r ON r.id = ur.role_id
WHERE ur.user_id = sqlc.arg(user_id)
ORDER BY r.code, r.id;

-- name: ResetAppUserPassword :execrows
UPDATE app_users SET
  password_hash = sqlc.arg(password_hash),
  password_change_required = true,
  password_changed_at = now(),
  failed_signin_count = 0,
  locked_until = NULL,
  updated_at = now(),
  updated_by = sqlc.narg(actor_id),
  revision = revision + 1
WHERE id = sqlc.arg(id) AND revision = sqlc.arg(revision) AND status = 'ENABLED';

-- name: SetAppUserStatus :execrows
UPDATE app_users SET status = sqlc.arg(status), updated_at = now(), updated_by = sqlc.narg(actor_id), revision = revision + 1
WHERE id = sqlc.arg(id) AND revision = sqlc.arg(revision) AND status <> sqlc.arg(status);

-- name: CountAppRoles :one
SELECT count(*) FROM app_roles
WHERE (sqlc.narg(status)::text IS NULL OR status = sqlc.narg(status))
  AND (sqlc.narg(search)::text IS NULL OR code ILIKE '%' || sqlc.narg(search) || '%' OR name ILIKE '%' || sqlc.narg(search) || '%');

-- name: ListAppRoles :many
SELECT * FROM app_roles
WHERE (sqlc.narg(status)::text IS NULL OR status = sqlc.narg(status))
  AND (sqlc.narg(search)::text IS NULL OR code ILIKE '%' || sqlc.narg(search) || '%' OR name ILIKE '%' || sqlc.narg(search) || '%')
ORDER BY
  CASE WHEN sqlc.arg(sort_field)::text = 'code' AND sqlc.arg(sort_order)::text = 'asc' THEN code END ASC,
  id ASC
LIMIT sqlc.arg(page_size) OFFSET sqlc.arg(page_offset);

-- name: GetAppRoleByID :one
SELECT * FROM app_roles WHERE id = sqlc.arg(id) LIMIT 1;

-- name: GetAppRolePermissionIDs :many
SELECT rp.permission_id
FROM app_role_permissions rp
JOIN app_permissions p ON p.id = rp.permission_id
WHERE rp.role_id = sqlc.arg(role_id)
ORDER BY p.path;

-- name: CountEnabledAppPermissionsByIDs :one
SELECT count(*) FROM app_permissions WHERE status = 'ENABLED' AND id = ANY(sqlc.arg(ids)::text[]);

-- name: ListAppPermissionPathsByIDs :many
SELECT path FROM app_permissions WHERE status = 'ENABLED' AND id = ANY(sqlc.arg(ids)::text[]) ORDER BY path;

-- name: ListAllEnabledAppPermissionIDs :many
SELECT id FROM app_permissions WHERE status = 'ENABLED' ORDER BY path;

-- name: CountAppSystemParameters :one
SELECT count(*)
FROM app_system_parameters
WHERE (sqlc.narg(value_type)::text IS NULL OR value_type = sqlc.narg(value_type))
  AND (sqlc.narg(editable)::boolean IS NULL OR editable = sqlc.narg(editable))
  AND (
    sqlc.narg(search)::text IS NULL
    OR parameter_key ILIKE '%' || sqlc.narg(search) || '%'
    OR name ILIKE '%' || sqlc.narg(search) || '%'
  );

-- name: ListAppSystemParameters :many
SELECT *
FROM app_system_parameters
WHERE (sqlc.narg(value_type)::text IS NULL OR value_type = sqlc.narg(value_type))
  AND (sqlc.narg(editable)::boolean IS NULL OR editable = sqlc.narg(editable))
  AND (
    sqlc.narg(search)::text IS NULL
    OR parameter_key ILIKE '%' || sqlc.narg(search) || '%'
    OR name ILIKE '%' || sqlc.narg(search) || '%'
  )
ORDER BY
  CASE WHEN sqlc.arg(sort_field)::text = 'key' AND sqlc.arg(sort_order)::text = 'asc' THEN parameter_key END ASC,
  CASE WHEN sqlc.arg(sort_field)::text = 'key' AND sqlc.arg(sort_order)::text = 'desc' THEN parameter_key END DESC,
  CASE WHEN sqlc.arg(sort_field)::text = 'name' AND sqlc.arg(sort_order)::text = 'asc' THEN name END ASC,
  CASE WHEN sqlc.arg(sort_field)::text = 'name' AND sqlc.arg(sort_order)::text = 'desc' THEN name END DESC,
  CASE WHEN sqlc.arg(sort_field)::text = 'updatedAt' AND sqlc.arg(sort_order)::text = 'asc' THEN updated_at END ASC,
  CASE WHEN sqlc.arg(sort_field)::text = 'updatedAt' AND sqlc.arg(sort_order)::text = 'desc' THEN updated_at END DESC,
  parameter_key ASC
LIMIT sqlc.arg(page_size) OFFSET sqlc.arg(page_offset);

-- name: GetAppSystemParameter :one
SELECT * FROM app_system_parameters WHERE parameter_key = sqlc.arg(parameter_key) LIMIT 1;

-- name: GetAppSystemParameterForUpdate :one
SELECT * FROM app_system_parameters
WHERE parameter_key = sqlc.arg(parameter_key)
LIMIT 1 FOR UPDATE;

-- name: UpdateAppSystemParameterValue :one
UPDATE app_system_parameters
SET current_value = sqlc.arg(current_value),
    revision = revision + 1,
    updated_at = now(),
    updated_by = sqlc.arg(actor_id)
WHERE parameter_key = sqlc.arg(parameter_key)
  AND revision = sqlc.arg(revision)
  AND editable = true
RETURNING *;

-- name: ResetAppSystemParameterValue :one
UPDATE app_system_parameters
SET current_value = default_value,
    revision = revision + 1,
    updated_at = now(),
    updated_by = sqlc.arg(actor_id)
WHERE parameter_key = sqlc.arg(parameter_key)
  AND revision = sqlc.arg(revision)
  AND editable = true
RETURNING *;

-- name: AcquireAppMenuLock :exec
SELECT pg_advisory_xact_lock(74155002);

-- name: ListAppBusinessMenuItems :many
SELECT *
FROM app_business_menu_items
ORDER BY item_level, sort_order, id;

-- name: GetAppBusinessMenuRevision :one
SELECT COALESCE(max(revision), 1)::bigint
FROM app_business_menu_items;

-- name: DeleteAppBusinessMenuItems :exec
DELETE FROM app_business_menu_items;

-- name: InsertAppBusinessMenuItem :exec
INSERT INTO app_business_menu_items (
  id, parent_id, item_type, item_level, sort_order, display_name, icon,
  enabled, route_key, permission_code, revision, created_by, updated_by
) VALUES (
  sqlc.arg(id), sqlc.narg(parent_id), sqlc.arg(item_type), sqlc.arg(item_level),
  sqlc.arg(sort_order), sqlc.arg(display_name), sqlc.narg(icon), sqlc.arg(enabled),
  sqlc.narg(route_key), sqlc.narg(permission_code), sqlc.arg(revision),
  sqlc.narg(actor_id), sqlc.narg(actor_id)
);

-- name: ListAppMenuPermissionRoutes :many
SELECT
  domain,
  entity,
  (array_agg(path ORDER BY CASE action WHEN 'query' THEN 0 WHEN 'get' THEN 1 ELSE 2 END, path))[1]::text AS permission_code,
  COALESCE(min(menu_order) FILTER (WHERE action = 'query'), 2147483647)::integer AS menu_order,
  COALESCE(
    max(description) FILTER (WHERE action = 'query'),
    max(description) FILTER (WHERE action = 'get'),
    min(description),
    ''
  )::text AS description
FROM app_permissions
WHERE status = 'ENABLED' AND domain <> 'app'
GROUP BY domain, entity
ORDER BY domain, min(menu_order) FILTER (WHERE action = 'query') NULLS LAST, entity;

-- name: UpdateAppMenuMode :one
UPDATE app_system_parameters
SET current_value = sqlc.arg(mode),
    revision = revision + 1,
    updated_at = now(),
    updated_by = sqlc.arg(actor_id)
WHERE parameter_key = 'app.menu.mode'
  AND revision = sqlc.arg(revision)
RETURNING *;

-- name: InsertAppRole :exec
INSERT INTO app_roles (id, code, name, description, status, created_by, updated_by)
VALUES (sqlc.arg(id), sqlc.arg(code), sqlc.arg(name), sqlc.narg(description), 'ENABLED', sqlc.narg(actor_id), sqlc.narg(actor_id));

-- name: DeleteAppRolePermissions :exec
DELETE FROM app_role_permissions WHERE role_id = sqlc.arg(role_id);

-- name: InsertAppRolePermission :exec
INSERT INTO app_role_permissions (role_id, permission_id, created_by) VALUES (sqlc.arg(role_id), sqlc.arg(permission_id), sqlc.narg(actor_id));

-- name: UpdateAppRole :execrows
UPDATE app_roles SET name = sqlc.arg(name), description = sqlc.narg(description), updated_at = now(), updated_by = sqlc.narg(actor_id), revision = revision + 1
WHERE id = sqlc.arg(id) AND revision = sqlc.arg(revision);

-- name: SetAppRoleStatus :execrows
UPDATE app_roles SET status = sqlc.arg(status), updated_at = now(), updated_by = sqlc.narg(actor_id), revision = revision + 1
WHERE id = sqlc.arg(id) AND revision = sqlc.arg(revision) AND status <> sqlc.arg(status);

-- name: CountAppPermissions :one
SELECT count(*) FROM app_permissions
WHERE (sqlc.narg(domain)::text IS NULL OR domain = sqlc.narg(domain))
  AND (sqlc.narg(entity)::text IS NULL OR entity = sqlc.narg(entity))
  AND (sqlc.narg(status)::text IS NULL OR status = sqlc.narg(status));

-- name: ListAppPermissions :many
SELECT * FROM app_permissions
WHERE (sqlc.narg(domain)::text IS NULL OR domain = sqlc.narg(domain))
  AND (sqlc.narg(entity)::text IS NULL OR entity = sqlc.narg(entity))
  AND (sqlc.narg(status)::text IS NULL OR status = sqlc.narg(status))
ORDER BY
  CASE WHEN sqlc.arg(sort_order)::text = 'asc' THEN path END ASC,
  path DESC
LIMIT sqlc.arg(page_size) OFFSET sqlc.arg(page_offset);

-- name: GetAppPermissionByID :one
SELECT * FROM app_permissions WHERE id = sqlc.arg(id) LIMIT 1;

-- name: CountAppRolesUsingPermission :one
SELECT count(*) FROM app_role_permissions WHERE permission_id = sqlc.arg(permission_id);

-- name: GetAppRoleByIDForUpdate :one
SELECT * FROM app_roles WHERE id = sqlc.arg(id) LIMIT 1 FOR UPDATE;

-- name: FindAppRoleIDByNormalizedNameExcludingID :one
SELECT id
FROM app_roles
WHERE lower(btrim(name)) = lower(btrim(sqlc.arg(name)))
  AND id <> sqlc.arg(excluded_id)
LIMIT 1;

-- name: NextAppRoleCode :one
UPDATE app_role_code_counters
SET next_value = next_value + 1
WHERE counter_key = 'default' AND next_value < 9999
RETURNING ('ROL-' || lpad(next_value::text, 4, '0'))::text;

-- name: ActorHasEnabledSuperadminRole :one
SELECT EXISTS (
  SELECT 1
  FROM app_user_roles ur
  JOIN app_roles r ON r.id = ur.role_id
  WHERE ur.user_id = sqlc.arg(user_id)
    AND r.status = 'ENABLED'
    AND r.code = 'superadmin'
);

-- name: ListEnabledAppPermissionIDsForUser :many
SELECT DISTINCT p.id
FROM app_permissions p
WHERE p.status = 'ENABLED'
  AND (
    EXISTS (
      SELECT 1
      FROM app_user_roles ur
      JOIN app_roles r ON r.id = ur.role_id
      WHERE ur.user_id = sqlc.arg(user_id)
        AND r.status = 'ENABLED'
        AND r.code = 'superadmin'
    )
    OR EXISTS (
      SELECT 1
      FROM app_user_roles ur
      JOIN app_roles r ON r.id = ur.role_id AND r.status = 'ENABLED'
      JOIN app_role_permissions rp ON rp.role_id = r.id
      WHERE ur.user_id = sqlc.arg(user_id) AND rp.permission_id = p.id
    )
  )
ORDER BY p.id;

-- name: ActorHoldsAppRole :one
SELECT EXISTS (
  SELECT 1 FROM app_user_roles
  WHERE user_id = sqlc.arg(user_id) AND role_id = sqlc.arg(role_id)
);

-- name: GetAppRolePermissionDetails :many
SELECT p.id, p.path, p.domain, p.entity, p.action, p.description, p.status, p.revision
FROM app_role_permissions rp
JOIN app_permissions p ON p.id = rp.permission_id
WHERE rp.role_id = sqlc.arg(role_id)
ORDER BY p.path, p.id;

-- name: ListAllEnabledAppPermissionDetails :many
SELECT id, path, domain, entity, action, description, status, revision
FROM app_permissions
WHERE status = 'ENABLED'
ORDER BY path, id;

-- name: GetAppSessionAuthorizationState :one
SELECT id, user_id, csrf_token_hash, idle_expires_at, absolute_expires_at, revoked_at
FROM app_sessions
WHERE id = sqlc.arg(id)
LIMIT 1;

-- name: ListEnabledAppRolePermissionIDs :many
SELECT rp.permission_id
FROM app_role_permissions rp
JOIN app_permissions p ON p.id = rp.permission_id AND p.status = 'ENABLED'
WHERE rp.role_id = sqlc.arg(role_id)
ORDER BY p.id;

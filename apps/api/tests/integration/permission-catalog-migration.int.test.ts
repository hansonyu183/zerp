import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import test from 'node:test'

import { TargetBootstrapService } from '../../src/app/bootstrap.ts'
import { createDatabase } from '../../src/db/database.ts'
import { readTargetPermissionCatalog } from '../../scripts/target-artifacts.ts'

const databaseUrl = process.env.TARGET_TEST_DATABASE_URL

async function effectiveAuthoritySnapshot(
  db: ReturnType<typeof createDatabase>,
) {
  const [permissions, roles, grants, users, userRoles] = await Promise.all([
    db.selectFrom('app_permissions').select(['id', 'path', 'status']).execute(),
    db.selectFrom('app_roles').select(['id', 'code', 'status']).execute(),
    db
      .selectFrom('app_role_permissions')
      .select(['role_id', 'permission_id'])
      .execute(),
    db.selectFrom('app_users').select(['id', 'status']).execute(),
    db.selectFrom('app_user_roles').select(['user_id', 'role_id']).execute(),
  ])
  const permissionById = new Map(
    permissions.map((permission) => [permission.id, permission]),
  )
  const roleAuthorities = new Map(
    roles.map((role) => {
      const wildcard = role.status === 'ENABLED' && role.code === 'superadmin'
      const paths =
        role.status !== 'ENABLED' || wildcard
          ? []
          : grants
              .filter((grant) => grant.role_id === role.id)
              .flatMap((grant) => {
                const permission = permissionById.get(grant.permission_id)
                return permission?.status === 'ENABLED' ? [permission.path] : []
              })
              .sort()
      return [role.id, { wildcard, paths: [...new Set(paths)] }] as const
    }),
  )
  return {
    roles: Object.fromEntries(
      [...roleAuthorities].sort(([left], [right]) => left.localeCompare(right)),
    ),
    users: Object.fromEntries(
      users
        .sort((left, right) => left.id.localeCompare(right.id))
        .map((user) => [
          user.id,
          (() => {
            if (user.status !== 'ENABLED') return { wildcard: false, paths: [] }
            const authorities = userRoles
              .filter((assignment) => assignment.user_id === user.id)
              .flatMap((assignment) => {
                const authority = roleAuthorities.get(assignment.role_id)
                return authority ? [authority] : []
              })
            const wildcard = authorities.some((authority) => authority.wildcard)
            return {
              wildcard,
              paths: wildcard
                ? []
                : [
                    ...new Set(
                      authorities.flatMap((authority) => authority.paths),
                    ),
                  ].sort(),
            }
          })(),
        ]),
    ),
  }
}

test('one-time target permission migration preserves every effective authority by exact path', async (context) => {
  assert.ok(databaseUrl, 'TARGET_TEST_DATABASE_URL is required')
  const db = createDatabase(databaseUrl)
  const suffix = randomBytes(8).toString('hex').toUpperCase()
  const roleId = `M${suffix}`.padEnd(26, '0')
  const userId = `U${suffix}`.padEnd(26, '0')
  const superadminRoleId = `R${suffix}`.padEnd(26, '0')
  const superadminUserId = `V${suffix}`.padEnd(26, '0')
  const desired = await readTargetPermissionCatalog()
  const migratedPath = '/aux/department/query'
  const baselinePaths = new Set(['/app/user/query', migratedPath])
  const baseline = desired
    .filter((permission) => baselinePaths.has(permission.path))
    .map((permission, index) => ({
      ...permission,
      id: `${index === 0 ? 'A' : 'B'}${suffix}`.padEnd(26, '0'),
    }))
  const bootstrap = new TargetBootstrapService(db)
  context.after(async () => {
    try {
      await db
        .deleteFrom('app_user_roles')
        .where('user_id', 'in', [userId, superadminUserId])
        .execute()
      await db
        .deleteFrom('app_users')
        .where('id', 'in', [userId, superadminUserId])
        .execute()
      await db
        .deleteFrom('app_role_permissions')
        .where('role_id', 'in', [roleId, superadminRoleId])
        .execute()
      await db
        .deleteFrom('app_roles')
        .where('id', 'in', [roleId, superadminRoleId])
        .execute()
      await bootstrap.migratePermissionCatalog(desired)
    } finally {
      await db.destroy()
    }
  })

  assert.equal(baseline.length, 2)
  await bootstrap.migratePermissionCatalog(baseline)

  await db
    .insertInto('app_users')
    .values([
      {
        id: userId,
        username: `migration-${suffix.toLowerCase()}`,
        display_name: 'Migration User',
        password_hash: 'not-used',
        status: 'ENABLED',
        password_changed_at: new Date(),
      },
      {
        id: superadminUserId,
        username: `migration-super-${suffix.toLowerCase()}`,
        display_name: 'Migration Superadmin',
        password_hash: 'not-used',
        status: 'ENABLED',
        password_changed_at: new Date(),
      },
    ])
    .execute()
  await db
    .insertInto('app_roles')
    .values([
      {
        id: roleId,
        code: `migration-${suffix.toLowerCase()}`,
        name: 'Migration Role',
        status: 'ENABLED',
      },
      {
        id: superadminRoleId,
        code: 'superadmin',
        name: 'Migration Superadmin Role',
        status: 'ENABLED',
      },
    ])
    .execute()
  await db
    .insertInto('app_user_roles')
    .values([
      { user_id: userId, role_id: roleId },
      { user_id: superadminUserId, role_id: superadminRoleId },
    ])
    .execute()
  const grants = await db
    .selectFrom('app_permissions')
    .select(['id', 'path'])
    .where('path', 'in', ['/app/user/query', migratedPath])
    .execute()
  await db
    .insertInto('app_role_permissions')
    .values(
      grants.map((permission) => ({
        role_id: roleId,
        permission_id: permission.id,
      })),
    )
    .execute()

  const before = await effectiveAuthoritySnapshot(db)
  const expectedPreservedRoleGrants = await db
    .selectFrom('app_role_permissions')
    .select((builder) => builder.fn.countAll<string>().as('count'))
    .executeTakeFirstOrThrow()
  const report = await bootstrap.migratePermissionCatalog(desired)
  assert.deepEqual(await effectiveAuthoritySnapshot(db), before)
  assert.ok(desired.length > baseline.length)
  assert.equal(
    await db
      .selectFrom('app_role_permissions')
      .select('permission_id')
      .where('role_id', '=', superadminRoleId)
      .execute()
      .then((rows) => rows.length),
    0,
  )
  const preserved = await db
    .selectFrom('app_role_permissions as rp')
    .innerJoin('app_permissions as p', 'p.id', 'rp.permission_id')
    .select('p.path')
    .where('rp.role_id', '=', roleId)
    .orderBy('p.path')
    .execute()
  assert.deepEqual(
    preserved.map((row) => row.path),
    ['/app/user/query', migratedPath],
  )
  assert.equal(
    report.preservedRoleGrants,
    Number(expectedPreservedRoleGrants.count),
  )
  assert.equal(report.droppedStaleRoleGrants, 0)
  assert.equal(report.orphanedRoleGrants, 0)
  assert.equal(report.duplicateRoleGrants, 0)
})

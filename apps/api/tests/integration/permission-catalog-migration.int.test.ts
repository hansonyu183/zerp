import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import test from 'node:test'

import { TargetBootstrapService } from '../../src/app/bootstrap.ts'
import { auxPeoplePermissionMappings } from '../../src/aux/migration.ts'
import { searchPinyin } from '../../src/platform/pinyin.ts'
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
  const superadminRole = await db
    .selectFrom('app_roles')
    .select('id')
    .where('code', '=', 'superadmin')
    .executeTakeFirstOrThrow()
  const superadminRoleId = superadminRole.id
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
        .where('role_id', '=', roleId)
        .execute()
      await db.deleteFrom('app_roles').where('id', '=', roleId).execute()
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
        py: searchPinyin('Migration User'),
        password_hash: 'not-used',
        status: 'ENABLED',
        password_changed_at: new Date(),
      },
      {
        id: superadminUserId,
        username: `migration-super-${suffix.toLowerCase()}`,
        display_name: 'Migration Superadmin',
        py: searchPinyin('Migration Superadmin'),
        password_hash: 'not-used',
        status: 'ENABLED',
        password_changed_at: new Date(),
      },
    ])
    .execute()
  await db
    .insertInto('app_roles')
    .values({
      id: roleId,
      code: `migration-${suffix.toLowerCase()}`,
      name: 'Migration Role',
      status: 'ENABLED',
    })
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

test('one-time AUX people permission migration replaces enabled authority without activating disabled source grants', async (context) => {
  assert.ok(databaseUrl, 'TARGET_TEST_DATABASE_URL is required')
  const db = createDatabase(databaseUrl)
  const suffix = randomBytes(8).toString('hex').toUpperCase()
  const roleId = `M${suffix}`.padEnd(26, '0')
  const disabledRoleId = `D${suffix}`.padEnd(26, '0')
  const enabledQueryRoleId = `Q${suffix}`.padEnd(26, '0')
  const legacyPermissionId = `P${suffix}`.padEnd(26, '0')
  const disabledPermissionId = `X${suffix}`.padEnd(26, '0')
  const enabledQueryPermissionId = `Y${suffix}`.padEnd(26, '0')
  const legacyPath = '/dcl/employee/submit-change'
  const mapping = auxPeoplePermissionMappings.find(
    (candidate) => candidate.from === legacyPath,
  )
  assert.ok(mapping)
  const desired = await readTargetPermissionCatalog()
  const bootstrap = new TargetBootstrapService(db)
  context.after(async () => {
    try {
      await db
        .deleteFrom('app_roles')
        .where('id', 'in', [roleId, disabledRoleId, enabledQueryRoleId])
        .execute()
      await bootstrap.migratePermissionCatalog(desired)
    } finally {
      await db.destroy()
    }
  })

  await db
    .insertInto('app_permissions')
    .values([
      {
        id: legacyPermissionId,
        path: legacyPath,
        domain: 'dcl',
        entity: 'employee',
        action: 'submit-change',
        description: '旧员工变更',
        status: 'ENABLED',
      },
      {
        id: disabledPermissionId,
        path: '/bob/employee/query',
        domain: 'bob',
        entity: 'employee',
        action: 'query',
        description: '旧停用员工查询',
        status: 'DISABLED',
      },
      {
        id: enabledQueryPermissionId,
        path: '/dcl/employee/query',
        domain: 'dcl',
        entity: 'employee',
        action: 'query',
        description: '旧启用员工查询',
        status: 'ENABLED',
      },
    ])
    .execute()
  await db
    .insertInto('app_roles')
    .values([
      {
        id: roleId,
        code: `aux-migration-${suffix.toLowerCase()}`,
        name: 'AUX Migration Role',
        status: 'ENABLED',
      },
      {
        id: disabledRoleId,
        code: `aux-disabled-${suffix.toLowerCase()}`,
        name: 'AUX Disabled Source Role',
        status: 'ENABLED',
      },
      {
        id: enabledQueryRoleId,
        code: `aux-query-${suffix.toLowerCase()}`,
        name: 'AUX Enabled Query Role',
        status: 'ENABLED',
      },
    ])
    .execute()
  await db
    .insertInto('app_role_permissions')
    .values([
      { role_id: roleId, permission_id: legacyPermissionId },
      { role_id: disabledRoleId, permission_id: disabledPermissionId },
      {
        role_id: enabledQueryRoleId,
        permission_id: enabledQueryPermissionId,
      },
    ])
    .execute()

  const report = await bootstrap.migratePermissionCatalog(
    desired,
    auxPeoplePermissionMappings,
  )
  const migrated = await db
    .selectFrom('app_role_permissions as rp')
    .innerJoin('app_permissions as p', 'p.id', 'rp.permission_id')
    .select('p.path')
    .where('rp.role_id', '=', roleId)
    .orderBy('p.path')
    .execute()
  assert.deepEqual(
    migrated.map((permission) => permission.path),
    [...mapping.to].sort(),
  )
  const mappedQueryRoles = await db
    .selectFrom('app_role_permissions as rp')
    .innerJoin('app_permissions as p', 'p.id', 'rp.permission_id')
    .select('rp.role_id')
    .where('p.path', '=', '/aux/employee/query')
    .where('rp.role_id', 'in', [disabledRoleId, enabledQueryRoleId])
    .orderBy('rp.role_id')
    .execute()
  assert.deepEqual(mappedQueryRoles, [{ role_id: enabledQueryRoleId }])
  assert.equal(
    await db
      .selectFrom('app_permissions')
      .select('id')
      .where('path', '=', legacyPath)
      .executeTakeFirst(),
    undefined,
  )
  assert.equal(report.orphanedRoleGrants, 0)
  assert.equal(report.duplicateRoleGrants, 0)
})

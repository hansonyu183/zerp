import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import test from 'node:test'

import { hashPassword, SessionService } from '../../src/app/session.ts'
import { loadConfig } from '../../src/platform/config.ts'

import { TargetBootstrapService } from '../../src/app/bootstrap.ts'
import { searchPinyin } from '../../src/platform/pinyin.ts'
import { createDatabase } from '../../src/db/database.ts'
import { readTargetPermissionCatalog } from '../../scripts/target-artifacts.ts'

const databaseUrl = process.env.TARGET_TEST_DATABASE_URL

test('catalog synchronization preserves every effective authority by exact path', async (context) => {
  assert.ok(databaseUrl, 'TARGET_TEST_DATABASE_URL is required')
  const db = createDatabase(databaseUrl)
  const suffix = randomBytes(8).toString('hex').toUpperCase()
  const roleId = `M${suffix}`.padEnd(26, '0')
  const userId = `U${suffix}`.padEnd(26, '0')
  const superadminUserId = `V${suffix}`.padEnd(26, '0')
  const desired = await readTargetPermissionCatalog()
  const password = randomBytes(24).toString('base64url')
  const passwordHash = await hashPassword(password)
  const session = new SessionService(
    db,
    loadConfig({
      DATABASE_URL: databaseUrl,
      TARGET_DATABASE_SCOPE: 'isolated',
    }),
  )
  const authority = async () =>
    (
      await session.signin(`catalog-${suffix.toLowerCase()}`, password)
    ).principal.apiPaths
      .slice()
      .sort()
  const migratedPath = '/aux/department/query'
  const baselinePaths = new Set(['/app/user/query', migratedPath])
  const baseline = desired
    .filter((permission) => baselinePaths.has(permission.path))
    .map((permission, index) => ({
      ...permission,
      id: `${index === 0 ? 'A' : 'B'}${suffix}`.padEnd(26, '0'),
    }))
  const bootstrap = new TargetBootstrapService(db)
  const superadminRoleId = `S${suffix}`.padEnd(26, '0')
  context.after(async () => {
    try {
      await db
        .deleteFrom('app_sessions')
        .where('user_id', 'in', [userId, superadminUserId])
        .execute()
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
      await db
        .deleteFrom('app_roles')
        .where('id', 'in', [roleId, superadminRoleId])
        .execute()
      await db
        .updateTable('app_permissions')
        .set({ status: 'ENABLED' })
        .where('path', '=', migratedPath)
        .execute()
      await bootstrap.syncPermissionCatalog(desired)
    } finally {
      await db.destroy()
    }
  })

  await db
    .insertInto('app_roles')
    .values({
      id: superadminRoleId,
      code: 'superadmin',
      name: 'Catalog Superadmin',
      status: 'ENABLED',
    })
    .execute()

  assert.equal(baseline.length, 2)
  await bootstrap.syncPermissionCatalog(baseline)

  await db
    .insertInto('app_users')
    .values([
      {
        id: userId,
        username: `catalog-${suffix.toLowerCase()}`,
        display_name: 'Catalog User',
        py: searchPinyin('Catalog User'),
        password_hash: passwordHash,
        status: 'ENABLED',
        password_changed_at: new Date(),
      },
      {
        id: superadminUserId,
        username: `catalog-super-${suffix.toLowerCase()}`,
        display_name: 'Catalog Superadmin',
        py: searchPinyin('Catalog Superadmin'),
        password_hash: passwordHash,
        status: 'ENABLED',
        password_changed_at: new Date(),
      },
    ])
    .execute()
  await db
    .insertInto('app_roles')
    .values({
      id: roleId,
      code: `catalog-${suffix.toLowerCase()}`,
      name: 'Catalog Role',
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

  await db
    .updateTable('app_permissions')
    .set({ status: 'DISABLED' })
    .where('path', '=', migratedPath)
    .execute()
  const before = await authority()
  assert.deepEqual(before, ['/app/user/query'])
  const expectedPreservedRoleGrants = await db
    .selectFrom('app_role_permissions')
    .select((builder) => builder.fn.countAll<string>().as('count'))
    .executeTakeFirstOrThrow()
  const report = await bootstrap.syncPermissionCatalog(desired)
  assert.deepEqual(await authority(), before)
  await bootstrap.syncPermissionCatalog(desired)
  assert.deepEqual(await authority(), before)
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

test('removing catalog authority preserves unrelated IDs, advances affected roles and invalidates old sessions only once', async (context) => {
  assert.ok(databaseUrl)
  const db = createDatabase(databaseUrl)
  const bootstrap = new TargetBootstrapService(db)
  const desired = await readTargetPermissionCatalog()
  const suffix = randomBytes(8).toString('hex').toUpperCase()
  const roleId = `R${suffix}`.padEnd(26, '0')
  const userId = `U${suffix}`.padEnd(26, '0')
  const onlyRoleId = `O${suffix}`.padEnd(26, '0')
  const onlyUserId = `P${suffix}`.padEnd(26, '0')
  const password = randomBytes(24).toString('base64url')
  const session = new SessionService(
    db,
    loadConfig({
      DATABASE_URL: databaseUrl,
      TARGET_DATABASE_SCOPE: 'isolated',
    }),
  )
  const legacy = {
    id: `L${suffix}`.padEnd(26, '0'),
    path: '/acc/mapping/catalog',
    domain: 'acc',
    entity: 'mapping',
    action: 'catalog',
    title: '会计映射目录',
  }
  const removedReferences = ['aux', 'bob', 'vou'].map((domain, index) => ({
    id: `${index}${suffix}`.padEnd(26, '0'),
    path: `/${domain}/reference/query`,
    domain,
    entity: 'reference',
    action: 'query',
    title: '旧引用候选',
  }))
  const removed = [legacy, ...removedReferences]
  const unrelated = desired.find((entry) => entry.path === '/app/user/query')!
  const beforeId = (
    await db
      .selectFrom('app_permissions')
      .select('id')
      .where('path', '=', unrelated.path)
      .executeTakeFirstOrThrow()
  ).id
  context.after(async () => {
    try {
      await db
        .deleteFrom('app_users')
        .where('id', 'in', [userId, onlyUserId])
        .execute()
      await db
        .deleteFrom('app_roles')
        .where('id', 'in', [roleId, onlyRoleId])
        .execute()
      await bootstrap.syncPermissionCatalog(desired)
    } finally {
      await db.destroy()
    }
  })
  await bootstrap.syncPermissionCatalog([...desired, ...removed])
  await bootstrap.createE2EPrincipal(
    {
      userId,
      roleId,
      username: `catalog-remove-${suffix}`,
      passwordHash: await hashPassword(password),
    },
    false,
    [...removed.map((item) => item.path), unrelated.path],
  )
  await bootstrap.createE2EPrincipal(
    {
      userId: onlyUserId,
      roleId: onlyRoleId,
      username: `catalog-only-${suffix}`,
      passwordHash: await hashPassword(password),
    },
    false,
    removed.map((item) => item.path),
  )
  const onlyLogin = await session.signin(`catalog-only-${suffix}`, password)
  assert.deepEqual(
    [...onlyLogin.principal.apiPaths].sort(),
    removed.map((item) => item.path).sort(),
  )
  const login = await session.signin(`catalog-remove-${suffix}`, password)
  assert.ok(login.principal.apiPaths.includes(legacy.path))
  const before = await db
    .selectFrom('app_roles')
    .select('revision')
    .where('id', '=', roleId)
    .executeTakeFirstOrThrow()
  const result = await bootstrap.syncPermissionCatalog(
    desired.map((entry) =>
      entry.path === unrelated.path
        ? { ...entry, id: `N${suffix}`.padEnd(26, '0') }
        : entry,
    ),
  )
  assert.equal(result.droppedStaleRoleGrants, removed.length * 2)
  assert.equal(
    (
      await db
        .selectFrom('app_permissions')
        .select('id')
        .where('path', '=', unrelated.path)
        .executeTakeFirstOrThrow()
    ).id,
    beforeId,
  )
  const after = await db
    .selectFrom('app_roles')
    .select('revision')
    .where('id', '=', roleId)
    .executeTakeFirstOrThrow()
  assert.equal(BigInt(after.revision), BigInt(before.revision) + 1n)
  await assert.rejects(
    session.authenticate(login.token, undefined, false, '/acc/mapping/catalog'),
    /unauthenticated/,
  )
  await assert.rejects(
    session.authenticate(
      onlyLogin.token,
      undefined,
      false,
      '/acc/mapping/catalog',
    ),
    /unauthenticated/,
  )
  assert.deepEqual(
    (await session.signin(`catalog-only-${suffix}`, password)).principal
      .apiPaths,
    [],
  )
  const renewed = await session.signin(`catalog-remove-${suffix}`, password)
  assert.deepEqual(renewed.principal.apiPaths, [unrelated.path])
  await bootstrap.syncPermissionCatalog(desired)
  assert.equal(
    (
      await db
        .selectFrom('app_roles')
        .select('revision')
        .where('id', '=', roleId)
        .executeTakeFirstOrThrow()
    ).revision,
    after.revision,
  )
  assert.deepEqual(
    (
      await session.authenticate(
        renewed.token,
        undefined,
        false,
        '/acc/mapping/catalog',
      )
    ).apiPaths,
    [unrelated.path],
  )
})

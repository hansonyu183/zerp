import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import test from 'node:test'

import {
  type TargetInitialAdministratorReport,
  TargetBootstrapService,
} from '../../src/app/bootstrap.ts'
import { hashPassword, SessionService } from '../../src/app/session.ts'
import { createDatabase } from '../../src/db/database.ts'
import { loadConfig } from '../../src/platform/config.ts'
import { readTargetPermissionCatalog } from '../../scripts/target-artifacts.ts'

const databaseUrl = process.env.TARGET_TEST_DATABASE_URL

test('target initial administrator bootstrap is atomic and fails closed after the first user', async (context) => {
  assert.ok(databaseUrl, 'TARGET_TEST_DATABASE_URL is required')
  const db = createDatabase(databaseUrl)
  const bootstrap = new TargetBootstrapService(db)
  const suffix = randomBytes(8).toString('hex')
  const password = 'Target!Password366'
  const first = {
    username: `bootstrap-${suffix}-one`,
    displayName: 'Initial Administrator One',
    passwordHash: await hashPassword(password),
  }
  const second = {
    username: `bootstrap-${suffix}-two`,
    displayName: 'Initial Administrator Two',
    passwordHash: await hashPassword(password),
  }

  context.after(async () => {
    try {
      const users = await db
        .selectFrom('app_users')
        .select('id')
        .where('username', 'in', [first.username, second.username])
        .execute()
      const userIds = users.map((user) => user.id)
      if (userIds.length > 0) {
        const roleIds = await db
          .selectFrom('app_user_roles')
          .select('role_id')
          .where('user_id', 'in', userIds)
          .execute()
          .then((rows) => rows.map((row) => row.role_id))
        await db
          .deleteFrom('app_sessions')
          .where('user_id', 'in', userIds)
          .execute()
        await db
          .deleteFrom('app_user_roles')
          .where('user_id', 'in', userIds)
          .execute()
        await db.deleteFrom('app_users').where('id', 'in', userIds).execute()
        if (roleIds.length > 0)
          await db.deleteFrom('app_roles').where('id', 'in', roleIds).execute()
      }
    } finally {
      await db.destroy()
    }
  })

  const priorUsers = await db.selectFrom('app_users').select('id').execute()
  assert.equal(
    priorUsers.length,
    0,
    'target bootstrap test needs an empty user table',
  )
  const catalog = await readTargetPermissionCatalog()

  const results = await Promise.allSettled([
    bootstrap.bootstrapInitialAdministrator(catalog, first),
    bootstrap.bootstrapInitialAdministrator(catalog, second),
  ])
  const created = results.filter(
    (
      result,
    ): result is PromiseFulfilledResult<TargetInitialAdministratorReport> =>
      result.status === 'fulfilled',
  )
  const rejected = results.filter(
    (result): result is PromiseRejectedResult => result.status === 'rejected',
  )
  assert.equal(created.length, 1)
  assert.equal(rejected.length, 1)
  assert.match(String(rejected[0]?.reason), /empty app_users table/)

  const administrator = await db
    .selectFrom('app_users')
    .select([
      'id',
      'username',
      'display_name',
      'status',
      'password_change_required',
    ])
    .where('id', '=', created[0]!.value.userId)
    .executeTakeFirstOrThrow()
  assert.equal(administrator.status, 'ENABLED')
  assert.equal(administrator.password_change_required, true)
  assert.ok([first.username, second.username].includes(administrator.username))
  const role = await db
    .selectFrom('app_roles')
    .select(['id', 'code', 'status'])
    .where('id', '=', created[0]!.value.roleId)
    .executeTakeFirstOrThrow()
  assert.deepEqual(role, {
    id: created[0]!.value.roleId,
    code: 'superadmin',
    status: 'ENABLED',
  })
  assert.deepEqual(
    await db
      .selectFrom('app_user_roles')
      .select(['user_id', 'role_id'])
      .where('user_id', '=', administrator.id)
      .execute(),
    [{ user_id: administrator.id, role_id: role.id }],
  )
  assert.deepEqual(
    await db
      .selectFrom('app_role_permissions')
      .select('permission_id')
      .where('role_id', '=', role.id)
      .execute(),
    [],
  )

  const config = loadConfig({
    DATABASE_URL: databaseUrl,
    APP_SESSION_COOKIE_SECURE: 'false',
  })
  const selected = administrator.username === first.username ? first : second
  const signin = await new SessionService(db, config).signin(
    selected.username,
    password,
  )
  assert.ok(signin.principal.permissions.length > 0)
  assert.ok(signin.principal.permissions.includes('/app/user/query'))

  const catalogBeforeRetry = await db
    .selectFrom('app_permissions')
    .select(['id', 'path', 'status'])
    .orderBy('path')
    .execute()
  await assert.rejects(
    () => bootstrap.bootstrapInitialAdministrator(catalog, first),
    /empty app_users table/,
  )
  assert.deepEqual(
    await db
      .selectFrom('app_permissions')
      .select(['id', 'path', 'status'])
      .orderBy('path')
      .execute(),
    catalogBeforeRetry,
  )
})

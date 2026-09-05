import assert from 'node:assert/strict'
import test from 'node:test'

import {
  TargetBootstrapService,
  type TargetOnlineTestUserSeedReport,
} from '../../src/app/bootstrap.ts'
import { SessionService } from '../../src/app/session.ts'
import { createDatabase } from '../../src/db/database.ts'
import { loadConfig } from '../../src/platform/config.ts'

const databaseUrl = process.env.TARGET_TEST_DATABASE_URL

test('online-test seed creates both fixed users and reconciles their credentials', async (context) => {
  assert.ok(databaseUrl, 'TARGET_TEST_DATABASE_URL is required')
  const db = createDatabase(databaseUrl)
  const bootstrap = new TargetBootstrapService(db)
  const firstPassword = 'Online!SeedPassword1'
  const rotatedPassword = 'Online!SeedPassword2'
  const users = [
    {
      username: 'test-admin',
      displayName: '测试管理员',
      password: firstPassword,
    },
    {
      username: 'tester',
      displayName: '测试用户',
      password: firstPassword,
    },
  ]

  context.after(async () => {
    try {
      const seededUsers = await db
        .selectFrom('app_users')
        .select('id')
        .where(
          'username',
          'in',
          users.map((user) => user.username),
        )
        .execute()
      const userIds = seededUsers.map((user) => user.id)
      if (userIds.length > 0) {
        const roleIds = await db
          .selectFrom('app_user_roles')
          .select('role_id')
          .where('user_id', 'in', userIds)
          .execute()
          .then((rows) => [...new Set(rows.map((row) => row.role_id))])
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

  assert.equal(
    await db
      .selectFrom('app_users')
      .select((builder) => builder.fn.countAll<number>().as('count'))
      .executeTakeFirstOrThrow()
      .then((row) => Number(row.count)),
    0,
    'online-test seed needs an empty user table in this integration test',
  )

  const first: TargetOnlineTestUserSeedReport =
    await bootstrap.seedOnlineTestUsers(users)
  assert.equal(first.createdUsers, 2)
  assert.equal(first.updatedUsers, 0)

  const config = loadConfig({
    DATABASE_URL: databaseUrl,
    APP_SESSION_COOKIE_SECURE: 'false',
  })
  const sessions = new SessionService(db, config)
  for (const user of users) {
    const signin = await sessions.signin(user.username, firstPassword)
    assert.equal(signin.principal.user.username, user.username)
    assert.equal(signin.principal.passwordChangeRequired, false)
    assert.ok(signin.principal.permissions.includes('/app/user/query'))
  }

  const assignments = await db
    .selectFrom('app_users as u')
    .innerJoin('app_user_roles as ur', 'ur.user_id', 'u.id')
    .innerJoin('app_roles as r', 'r.id', 'ur.role_id')
    .select(['u.username', 'r.code'])
    .where(
      'u.username',
      'in',
      users.map((user) => user.username),
    )
    .orderBy('u.username')
    .execute()
  assert.deepEqual(assignments, [
    { username: 'test-admin', code: 'superadmin' },
    { username: 'tester', code: 'superadmin' },
  ])

  const sessionsBeforeRepeat = await db
    .selectFrom('app_sessions')
    .select((builder) => builder.fn.countAll<number>().as('count'))
    .executeTakeFirstOrThrow()
    .then((row) => Number(row.count))
  const repeated = await bootstrap.seedOnlineTestUsers(users)
  assert.equal(repeated.createdUsers, 0)
  assert.equal(repeated.updatedUsers, 0)
  assert.equal(
    await db
      .selectFrom('app_sessions')
      .select((builder) => builder.fn.countAll<number>().as('count'))
      .executeTakeFirstOrThrow()
      .then((row) => Number(row.count)),
    sessionsBeforeRepeat,
  )

  const rotatedUsers = users.map((user) => ({
    ...user,
    password: rotatedPassword,
  }))
  const second = await bootstrap.seedOnlineTestUsers(rotatedUsers)
  assert.equal(second.createdUsers, 0)
  assert.equal(second.updatedUsers, 2)
  for (const user of users) {
    await assert.rejects(() => sessions.signin(user.username, firstPassword))
    const signin = await sessions.signin(user.username, rotatedPassword)
    assert.equal(signin.principal.user.username, user.username)
  }
})

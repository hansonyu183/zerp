import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { promisify } from 'node:util'
import test from 'node:test'
import { sql } from 'kysely'

import { AccService } from '../../src/acc/service.ts'
import { TargetBootstrapService } from '../../src/app/bootstrap.ts'
import { ManagementService } from '../../src/app/management.ts'
import { SessionService } from '../../src/app/session.ts'
import { createDatabase } from '../../src/db/database.ts'
import {
  loadConfig,
  assertTargetDatabaseBoundary,
} from '../../src/platform/config.ts'
import { readTargetPermissionCatalog } from '../../scripts/target-artifacts.ts'

test('formal initialization creates two administrators and preserves changed credentials on restart', async (context) => {
  const source = process.env.TARGET_TEST_DATABASE_URL
  assert.ok(source, 'TARGET_TEST_DATABASE_URL is required')
  assertTargetDatabaseBoundary(source, 'isolated')
  const suffix = randomBytes(6).toString('hex')
  const databaseName = `initialization_${suffix}_test`
  const owner = createDatabase(source)
  const url = new URL(source)
  url.pathname = `/${databaseName}`
  const db = createDatabase(url.toString())
  const directory = new URL(
    `../../../../.scratch/initialization-${suffix}/`,
    import.meta.url,
  )
  const passwordFile = new URL('password', directory)
  const secondPasswordFile = new URL('second-password', directory)
  context.after(async () => {
    await db.destroy()
    await sql
      .raw(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`)
      .execute(owner)
    await owner.destroy()
    await rm(directory, { recursive: true, force: true })
  })
  await sql.raw(`CREATE DATABASE "${databaseName}"`).execute(owner)
  await sql
    .raw(
      await readFile(
        new URL('../../db/target-schema.sql', import.meta.url),
        'utf8',
      ),
    )
    .execute(db)
  await new TargetBootstrapService(db).syncPermissionCatalog(
    await readTargetPermissionCatalog(),
  )
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const password = `Initial!Aa1${suffix}`
  await writeFile(passwordFile, password, { mode: 0o600 })
  const secondPassword = `Second!Aa2${suffix}`
  await writeFile(secondPasswordFile, secondPassword, { mode: 0o600 })
  const initialize = (overrides: Record<string, string> = {}) =>
    promisify(execFile)(
      process.execPath,
      [new URL('../../scripts/initialize-admin.ts', import.meta.url).pathname],
      {
        env: {
          ...process.env,
          TARGET_DATABASE_URL: url.toString(),
          TARGET_DATABASE_SCOPE: 'isolated',
          APP_ADMIN_1_USERNAME: 'formal-admin',
          APP_ADMIN_1_DISPLAY_NAME: '正式管理员',
          APP_ADMIN_1_PASSWORD_FILE: passwordFile.pathname,
          APP_ADMIN_2_USERNAME: 'second-admin',
          APP_ADMIN_2_DISPLAY_NAME: '第二管理员',
          APP_ADMIN_2_PASSWORD_FILE: secondPasswordFile.pathname,
          ...overrides,
        },
      },
    )
  const initializations = await Promise.all([initialize(), initialize()])
  assert.deepEqual(
    initializations.map((result) => result.stdout.trim()).sort(),
    ['formal administrator created', 'formal administrator unchanged'],
  )
  const sessions = new SessionService(
    db,
    loadConfig({
      DATABASE_URL: url.toString(),
      APP_SESSION_COOKIE_SECURE: 'false',
    }),
  )
  const signedIn = await sessions.signin('formal-admin', password)
  assert.equal(signedIn.principal.passwordChangeRequired, false)
  assert.ok(signedIn.principal.apiPaths.includes('/app/user/create'))
  const second = await sessions.signin('second-admin', secondPassword)
  assert.equal(second.principal.passwordChangeRequired, false)
  assert.equal(second.principal.user.name, '第二管理员')
  assert.deepEqual(second.principal.apiPaths, signedIn.principal.apiPaths)
  await assert.rejects(sessions.signin('second-admin', password))
  const nextPassword = `Changed!Aa2${suffix}`
  await sessions.changePassword(
    signedIn.principal,
    { currentPassword: password, newPassword: nextPassword },
    'initialization-test',
  )
  await assert.rejects(sessions.authenticate(signedIn.token, undefined, false))
  const current = await sessions.signin('formal-admin', nextPassword)
  const repeated = await initialize()
  assert.match(repeated.stdout, /unchanged/)
  assert.equal(
    (await sessions.signin('second-admin', secondPassword)).principal
      .passwordChangeRequired,
    false,
  )
  assert.equal(
    (await sessions.authenticate(current.token, undefined, false))
      .passwordChangeRequired,
    false,
  )
  await assert.rejects(sessions.signin('formal-admin', password))
  for (const username of ['test-admin', 'tester'])
    await assert.rejects(sessions.signin(username, password))

  const management = new ManagementService(db, { passwordMinLength: 12 })
  const query = { keyword: '', page: 1, pageSize: 20 } as const
  assert.equal((await management.queryUsers(query, current.principal)).total, 2)
  const roles = await management.queryRoles(query, current.principal)
  const administrator = roles.items.find((role) => role.code === 'superadmin')!
  const successor = await management.createUser(
    {
      code: 'successor',
      name: '接任管理员',
      password,
      roleIds: [administrator.id],
    },
    current.principal,
    'init-successor',
  )
  const successorSession = await sessions.signin('successor', password)
  await sessions.changePassword(
    successorSession.principal,
    { currentPassword: password, newPassword: nextPassword },
    'init-successor-password',
  )
  const successorCurrent = await sessions.signin('successor', nextPassword)
  const permissions = await management.queryPermissions(
    {
      page: 1,
      pageSize: 20,
      filters: { domain: 'app', entity: 'user', action: 'query' },
    },
    successorCurrent.principal,
  )
  const readPermission = permissions.items.find(
    (permission) => permission.path === '/app/user/query',
  )!
  const reader = await management.createRole(
    { name: '只读角色', permissionIds: [readPermission.id] },
    successorCurrent.principal,
    'init-reader',
  )
  const original = await management.getUser(
    current.principal.user.id,
    successorCurrent.principal,
  )
  await management.saveUser(
    {
      id: original.id,
      name: '已移交管理权',
      revision: original.revision,
      roleIds: [reader.id],
    },
    successorCurrent.principal,
    'init-transfer',
  )
  await initialize()
  const afterRestart = await sessions.signin('formal-admin', nextPassword)
  assert.deepEqual(afterRestart.principal.apiPaths, ['/app/user/query'])
  assert.equal(afterRestart.principal.user.name, '已移交管理权')
  assert.equal(
    (await management.getUser(successor.id, successorCurrent.principal))
      .enabled,
    true,
  )
  await assert.rejects(initialize({ APP_ADMIN_1_USERNAME: 'another-admin' }))
  assert.equal(
    (await management.queryUsers(query, successorCurrent.principal)).total,
    3,
  )

  // The operation under test is an explicit database reset, on this owned database only.
  const schema = await readFile(
    new URL('../../db/target-schema.sql', import.meta.url),
    'utf8',
  )
  await db.transaction().execute(async (tx) => {
    await sql
      .raw('DROP SCHEMA public CASCADE; CREATE SCHEMA public;')
      .execute(tx)
    await sql.raw(schema).execute(tx)
  })
  await new TargetBootstrapService(db).syncPermissionCatalog(
    await readTargetPermissionCatalog(),
  )
  await new AccService(db).syncVouEntityCatalog()
  await initialize()
  await assert.rejects(sessions.authenticate(current.token, undefined, false))
  await assert.rejects(
    sessions.authenticate(successorCurrent.token, undefined, false),
  )
  await assert.rejects(sessions.signin('successor', nextPassword))
  const reset = await sessions.signin('formal-admin', password)
  assert.equal(reset.principal.passwordChangeRequired, false)
  assert.equal((await management.queryUsers(query, reset.principal)).total, 2)
  const tables = await sql<{
    tablename: string
  }>`SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename ~ '^(dcl_|vou_|acc_|aux_|approval_|wfl_|rpt_)'`.execute(
    db,
  )
  for (const { tablename } of tables.rows) {
    if (['rpt_code_counter', 'acc_mapping_vou_entities'].includes(tablename))
      continue
    const result = await sql<{
      count: string
    }>`SELECT count(*) AS count FROM ${sql.table(tablename)}`.execute(db)
    assert.equal(
      result.rows[0]?.count,
      '0',
      `${tablename} must have no business data`,
    )
  }
})

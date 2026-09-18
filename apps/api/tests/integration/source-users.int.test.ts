import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { promisify } from 'node:util'
import test from 'node:test'
import { sql } from 'kysely'
import { modelBuildId } from '@zerp/model'

import { createApp } from '../../src/app.ts'
import { TargetBootstrapService } from '../../src/app/bootstrap.ts'
import { ManagementService } from '../../src/app/management.ts'
import { SessionService } from '../../src/app/session.ts'
import type { SourceUserPlan } from '../../src/app/source-users.ts'
import { createDatabase } from '../../src/db/database.ts'
import {
  loadConfig,
  assertTargetDatabaseBoundary,
} from '../../src/platform/config.ts'
import { readTargetPermissionCatalog } from '../../scripts/target-artifacts.ts'

test('source user CLI creates an identity once and preserves changed credentials on replay', async (context) => {
  const base = process.env.TARGET_TEST_DATABASE_URL
  assert.ok(base)
  assertTargetDatabaseBoundary(base, 'isolated')
  const suffix = randomBytes(6).toString('hex')
  const name = `source_users_${suffix}_test`
  const owner = createDatabase(base)
  const url = new URL(base)
  url.pathname = `/${name}`
  const db = createDatabase(url.toString())
  const directory = new URL(
    `../../../../.scratch/source-users-${suffix}/`,
    import.meta.url,
  )
  context.after(async () => {
    await db.destroy()
    await sql
      .raw(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`)
      .execute(owner)
    await owner.destroy()
    await rm(directory, { recursive: true, force: true })
  })
  await sql.raw(`CREATE DATABASE "${name}"`).execute(owner)
  await sql
    .raw(
      await readFile(
        new URL('../../db/target-schema.sql', import.meta.url),
        'utf8',
      ),
    )
    .execute(db)
  const bootstrap = new TargetBootstrapService(db)
  await bootstrap.syncPermissionCatalog(await readTargetPermissionCatalog())
  const adminPassword = `Admin!Aa1-${suffix}`
  await bootstrap.initializeAdministrators(
    [
      {
        username: 'migration-admin',
        displayName: '迁移管理员',
        password: adminPassword,
      },
      {
        username: 'other-admin',
        displayName: '其他管理员',
        password: adminPassword,
      },
    ],
    12,
  )
  const config = loadConfig({
    DATABASE_URL: url.toString(),
    TARGET_DATABASE_SCOPE: 'isolated',
  })
  const sessions = new SessionService(db, config)
  const management = new ManagementService(db, { passwordMinLength: 12 })
  const admin = await sessions.signin('migration-admin', adminPassword)
  const permission = await db
    .selectFrom('app_permissions')
    .select('id')
    .where('path', '=', '/app/user/query')
    .executeTakeFirstOrThrow()
  const role = await management.createRole(
    { name: '查询', permissionIds: [permission.id] },
    admin.principal,
    'fixture-role',
  )
  const app = createApp({ session: sessions, management, config })
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const command = async (args: string[]) => {
    const result = await promisify(execFile)(
      process.execPath,
      [
        new URL('../../scripts/migrate-source-users.ts', import.meta.url)
          .pathname,
        ...args,
        '--actor',
        'migration-admin',
      ],
      {
        env: {
          ...process.env,
          TARGET_DATABASE_URL: url.toString(),
          TARGET_DATABASE_SCOPE: 'isolated',
        },
      },
    )
    return JSON.parse(result.stdout)
  }
  // Simulate the previous deployed schema; the public preparation command owns DDL.
  await sql`DROP TABLE app_source_user_roles, app_source_users`.execute(db)
  assert.deepEqual(await command(['prepare']), { schema: 'created' })
  assert.deepEqual(await command(['prepare']), { schema: 'unchanged' })
  const catalog = await command(['inspect', '--source', 'fixture/users'])
  const plan: SourceUserPlan = {
    source: 'fixture/users',
    sourceRevision: '100',
    databaseName: name,
    roles: catalog.roles
      .filter((item: { code: string }) => item.code === role.code)
      .map((item: { code: string; fingerprint: string }) => ({
        code: item.code,
        fingerprint: item.fingerprint,
      })),
    users: [
      {
        sourceKey: 'EMP001',
        code: 'imported-user',
        name: '迁入用户',
        sourceEnabled: true,
        sourceEmployeeKey: 'EMP001',
        roleCodes: [role.code],
        blockedReasons: [],
        expectedRevision: '0',
        deleted: false,
      },
    ],
  }
  const planFile = new URL('plan.json', directory)
  const credentials = new URL('credentials/', directory)
  await writeFile(planFile, JSON.stringify(plan), { mode: 0o600 })
  const apply = () =>
    command([
      'apply',
      '--plan',
      planFile.pathname,
      '--credentials-dir',
      credentials.pathname,
    ])
  const first = await apply()
  assert.equal(first.users[0].outcome, 'created')
  const password = (
    await readFile(new URL('imported-user', credentials), 'utf8')
  ).trim()
  const signInResponse = await app.request('/session/auth/signin', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-zerp-model-build': modelBuildId,
    },
    body: JSON.stringify({ code: 'imported-user', password }),
  })
  const signIn = await signInResponse.json()
  assert.equal(signIn.code, 0)
  assert.equal(signIn.data.passwordChangeRequired, true)
  const imported = await sessions.signin('imported-user', password)
  const changedPassword = `Changed!Bb2-${suffix}`
  await sessions.changePassword(
    imported.principal,
    { currentPassword: password, newPassword: changedPassword },
    'fixture-password',
  )
  const authenticated = await sessions.signin('imported-user', changedPassword)
  assert.equal(authenticated.principal.passwordChangeRequired, false)
  const beforeReplay = await management.getUser(
    first.users[0].id,
    admin.principal,
  )
  const second = await apply()
  assert.equal(second.users[0].outcome, 'unchanged')
  assert.equal(second.users[0].id, first.users[0].id)
  assert.equal(second.users[0].revision, beforeReplay.revision)
  await sessions.authenticate(
    authenticated.token,
    undefined,
    false,
    '/session/auth/restore',
  )
  assert.equal(
    (await sessions.signin('imported-user', changedPassword)).principal
      .passwordChangeRequired,
    false,
  )
  const result = await app.request('/app/user/query', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-zerp-model-build': modelBuildId,
      cookie: `${config.sessionCookieName}=${authenticated.token}`,
      'x-csrf-token': authenticated.principal.csrfToken,
    },
    body: JSON.stringify({ keyword: 'imported-user', page: 1, pageSize: 20 }),
  })
  const payload = await result.json()
  assert.equal(payload.code, 0)
  assert.equal(payload.data.total, 1)

  await context.test(
    'source role removal preserves separately granted manual roles',
    async () => {
      const getPermission = await db
        .selectFrom('app_permissions')
        .select('id')
        .where('path', '=', '/app/user/get')
        .executeTakeFirstOrThrow()
      const manual = await management.createRole(
        { name: '人工保留', permissionIds: [getPermission.id] },
        admin.principal,
        'fixture-manual-role',
      )
      const detail = await management.getUser(
        first.users[0].id,
        admin.principal,
      )
      await management.saveUser(
        {
          id: detail.id,
          name: detail.name,
          roleIds: [role.id, manual.id],
          revision: detail.revision,
        },
        admin.principal,
        'fixture-manual-grant',
      )
      const current = await command(['inspect', '--source', plan.source])
      plan.sourceRevision = '101'
      plan.roles = []
      plan.users[0].expectedRevision = current.users[0].revision
      plan.users[0].roleCodes = []
      plan.users[0].blockedReasons = ['来源角色映射已撤销']
      await writeFile(planFile, JSON.stringify(plan), { mode: 0o600 })
      const updated = await apply()
      assert.equal(updated.users[0].enabled, true)
      const after = await management.getUser(detail.id, admin.principal)
      assert.deepEqual(
        after.roles.map((item) => item.id),
        [manual.id],
      )
      await assert.rejects(
        sessions.authenticate(
          authenticated.token,
          undefined,
          false,
          '/session/auth/restore',
        ),
      )
      const signed = await sessions.signin('imported-user', changedPassword)
      assert.deepEqual(signed.principal.apiPaths, ['/app/user/get'])
    },
  )

  const failure = (reason: string) => (error: unknown) =>
    error instanceof Error &&
    'stderr' in error &&
    JSON.parse(String(error.stderr)).reason === reason
  const refreshRevision = async () => {
    const inventory = await command(['inspect', '--source', plan.source])
    for (const user of plan.users)
      user.expectedRevision =
        inventory.users.find(
          (item: { sourceKey: string }) => item.sourceKey === user.sourceKey,
        )?.revision ?? '0'
  }

  await context.test(
    'source disable invalidates sessions while preserving the historical identity',
    async () => {
      const active = await sessions.signin('imported-user', changedPassword)
      await refreshRevision()
      plan.sourceRevision = '102'
      plan.users[0].sourceEnabled = false
      await writeFile(planFile, JSON.stringify(plan), { mode: 0o600 })
      const disabled = await apply()
      assert.equal(disabled.users[0].id, first.users[0].id)
      assert.equal(disabled.users[0].enabled, false)
      const detail = await management.getUser(
        first.users[0].id,
        admin.principal,
      )
      assert.equal(detail.enabled, false)
      assert.equal(detail.name, '迁入用户')
      await assert.rejects(sessions.signin('imported-user', changedPassword))
      await assert.rejects(
        sessions.authenticate(
          active.token,
          undefined,
          false,
          '/session/auth/restore',
        ),
      )
      plan.sourceRevision = '101'
      await writeFile(planFile, JSON.stringify(plan), { mode: 0o600 })
      await assert.rejects(apply(), failure('stale_source_revision'))
    },
  )

  await context.test(
    'a later identity conflict rolls back every earlier mutation in the batch',
    async () => {
      await refreshRevision()
      plan.sourceRevision = '103'
      plan.users[0].name = '不能留下的更改'
      plan.users.push({
        sourceKey: 'collision',
        code: 'other-admin',
        name: '不能认领管理员',
        sourceEnabled: false,
        sourceEmployeeKey: '',
        roleCodes: [],
        blockedReasons: [],
        expectedRevision: '0',
        deleted: false,
      })
      await writeFile(planFile, JSON.stringify(plan), { mode: 0o600 })
      await assert.rejects(apply(), failure('username_conflict'))
      const detail = await management.getUser(
        first.users[0].id,
        admin.principal,
      )
      assert.equal(detail.name, '迁入用户')
      const inventory = await command(['inspect', '--source', plan.source])
      assert.equal(inventory.users.length, 1)
      assert.equal(inventory.users[0].sourceRevision, '102')
      plan.users.pop()
      plan.users[0].name = '迁入用户'
    },
  )

  await context.test(
    'unmapped active sources are retained disabled and a committed response can be replayed',
    async () => {
      await refreshRevision()
      plan.users.push({
        sourceKey: 'pending',
        code: 'pending-user',
        name: '待授权身份',
        sourceEnabled: true,
        sourceEmployeeKey: '',
        roleCodes: [],
        blockedReasons: ['没有安全的目标角色'],
        expectedRevision: '0',
        deleted: false,
      })
      await writeFile(planFile, JSON.stringify(plan), { mode: 0o600 })
      const created = await apply()
      const pending = created.users.find(
        (item: { sourceKey: string }) => item.sourceKey === 'pending',
      )
      assert.equal(pending.enabled, false)
      const password = (
        await readFile(new URL('pending-user', credentials), 'utf8')
      ).trim()
      await assert.rejects(sessions.signin('pending-user', password))
      const replay = await apply()
      assert.ok(
        replay.users.every(
          (item: { outcome: string }) => item.outcome === 'unchanged',
        ),
      )
      assert.equal(replay.users[1].id, pending.id)
      plan.users.pop()
    },
  )

  await context.test(
    'role changes after planning and target identity mismatch fail before writes',
    async () => {
      await refreshRevision()
      const currentRole = await management.getRole(role.id, admin.principal)
      const getPermission = await db
        .selectFrom('app_permissions')
        .select('id')
        .where('path', '=', '/app/user/get')
        .executeTakeFirstOrThrow()
      await management.saveRole(
        {
          id: role.id,
          name: currentRole.name,
          revision: currentRole.revision,
          permissionIds: [permission.id, getPermission.id],
        },
        admin.principal,
        'fixture-change-authority',
      )
      plan.roles = catalog.roles
        .filter((item: { code: string }) => item.code === role.code)
        .map((item: { code: string; fingerprint: string }) => ({
          code: item.code,
          fingerprint: item.fingerprint,
        }))
      plan.users[0].roleCodes = [role.code]
      plan.sourceRevision = '104'
      await writeFile(planFile, JSON.stringify(plan), { mode: 0o600 })
      await assert.rejects(apply(), failure('role_baseline_changed'))
      plan.databaseName = 'another_target_test'
      await writeFile(planFile, JSON.stringify(plan), { mode: 0o600 })
      await assert.rejects(apply(), failure('target_database_mismatch'))
      plan.databaseName = name
      plan.roles = []
      plan.users[0].roleCodes = []
    },
  )

  await context.test(
    'manual removal and regrant ends source ownership',
    async () => {
      await refreshRevision()
      const inventory = await command(['inspect', '--source', plan.source])
      plan.roles = inventory.roles
        .filter((item: { code: string }) => item.code === role.code)
        .map((item: { code: string; fingerprint: string }) => ({
          code: item.code,
          fingerprint: item.fingerprint,
        }))
      plan.users[0].roleCodes = [role.code]
      plan.users[0].sourceEnabled = true
      plan.users[0].blockedReasons = []
      await writeFile(planFile, JSON.stringify(plan), { mode: 0o600 })
      await apply()
      let detail = await management.getUser(first.users[0].id, admin.principal)
      const manualIds = detail.roles
        .map((item) => item.id)
        .filter((id) => id !== role.id)
      await management.saveUser(
        {
          id: detail.id,
          name: detail.name,
          roleIds: manualIds,
          revision: detail.revision,
        },
        admin.principal,
        'manual-remove',
      )
      detail = await management.getUser(detail.id, admin.principal)
      await management.saveUser(
        {
          id: detail.id,
          name: detail.name,
          roleIds: [...manualIds, role.id],
          revision: detail.revision,
        },
        admin.principal,
        'manual-regrant',
      )
      await refreshRevision()
      plan.sourceRevision = '105'
      plan.users[0].blockedReasons = ['来源撤销角色']
      plan.roles = []
      plan.users[0].roleCodes = []
      await writeFile(planFile, JSON.stringify(plan), { mode: 0o600 })
      await apply()
      detail = await management.getUser(detail.id, admin.principal)
      assert.deepEqual(
        detail.roles.map((item) => item.id).sort(),
        [...manualIds, role.id].sort(),
      )
      plan.sourceRevision = '106'
    },
  )

  await context.test(
    'source deletion retains the target identity and rejects source-key reuse',
    async () => {
      await refreshRevision()
      plan.users[0].sourceEnabled = false
      plan.users[0].deleted = true
      await writeFile(planFile, JSON.stringify(plan), { mode: 0o600 })
      const deleted = await apply()
      assert.equal(deleted.users[0].id, first.users[0].id)
      assert.equal(deleted.users[0].enabled, false)
      plan.sourceRevision = '107'
      plan.users[0].deleted = false
      await refreshRevision()
      await writeFile(planFile, JSON.stringify(plan), { mode: 0o600 })
      await assert.rejects(apply(), failure('deleted_source_identity_reused'))
    },
  )
})

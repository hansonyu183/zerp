import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import test, { type TestContext } from 'node:test'

import { serve } from '@hono/node-server'
import { modelBuildId } from '@zerp/model'
import { ulid } from 'ulid'

import { createApp } from '../../src/app.ts'
import { ManagementService } from '../../src/app/management.ts'
import { hashPassword, SessionService } from '../../src/app/session.ts'
import { searchPinyin } from '../../src/platform/pinyin.ts'
import { createDatabase } from '../../src/db/database.ts'
import { loadConfig } from '../../src/platform/config.ts'

const databaseUrl = process.env.TARGET_TEST_DATABASE_URL
const systemUserId = '01JAPPSYST3MACTR0000000000'
const protectedPaths = [
  '/app/user/query',
  '/app/user/get',
  '/app/role/query',
  '/app/role/get',
] as const
const actorPaths = [
  ...protectedPaths,
  '/app/user/create',
  '/app/user/save',
  '/app/user/enable',
  '/app/user/disable',
  '/app/role/create',
  '/app/role/save',
  '/app/role/enable',
  '/app/role/disable',
  '/app/permission/query',
] as const
const foreignPath = '/aux/department/query'

type HttpSession = { cookie: string; csrfToken: string }
type Envelope = { code: number; errorKey: string; data: any }

async function createHarness(context: TestContext) {
  assert.ok(databaseUrl, 'TARGET_TEST_DATABASE_URL is required')
  const config = loadConfig({
    DATABASE_URL: databaseUrl,
    TARGET_DATABASE_SCOPE: process.env.TARGET_DATABASE_SCOPE,
    APP_SESSION_COOKIE_SECURE: 'false',
  })
  const db = createDatabase(databaseUrl)
  const suffix = randomBytes(8).toString('hex')
  const password = `Tdd!${suffix}Aa1`
  const ids = {
    actor: ulid(),
    actorRole: ulid(),
    lowRole: ulid(),
    highRole: ulid(),
    protectedRole: ulid(),
    disabledRole: ulid(),
    lowTarget: ulid(),
    highTarget: ulid(),
    peerAdmin: ulid(),
    sessionTarget: ulid(),
    concurrentTarget: ulid(),
    superActor: ulid(),
  }
  const codes = {
    actor: `tdd-actor-${suffix}`,
    lowTarget: `tdd-low-user-${suffix}`,
    highTarget: `tdd-high-user-${suffix}`,
    peerAdmin: `tdd-peer-admin-${suffix}`,
    sessionTarget: `tdd-session-user-${suffix}`,
    concurrentTarget: `tdd-concurrent-user-${suffix}`,
    superActor: `tdd-super-actor-${suffix}`,
  }
  const fixtureUserIds = [
    ids.actor,
    ids.lowTarget,
    ids.highTarget,
    ids.peerAdmin,
    ids.sessionTarget,
    ids.concurrentTarget,
    ids.superActor,
  ]
  const fixtureRoleIds = [
    ids.actorRole,
    ids.lowRole,
    ids.highRole,
    ids.protectedRole,
    ids.disabledRole,
  ]
  const fixturePermissionIds: string[] = []
  const roleCodes = {
    actor: `tdd-actor-${suffix}`,
    low: `tdd-low-${suffix}`,
    high: `tdd-high-${suffix}`,
    protected: `tdd-protected-${suffix}`,
    disabled: `tdd-disabled-${suffix}`,
  }

  const permissions = await db
    .selectFrom('app_permissions')
    .select(['id', 'path'])
    .where('path', 'in', [...new Set([...actorPaths, foreignPath])])
    .execute()
  const permissionId = new Map(
    permissions.map((permission) => [permission.path, permission.id]),
  )
  for (const path of [...actorPaths, foreignPath])
    assert.ok(permissionId.has(path), `target catalog must contain ${path}`)

  async function addRole(
    id: string,
    code: string,
    paths: readonly string[],
    status: 'ENABLED' | 'DISABLED' = 'ENABLED',
  ) {
    await db
      .insertInto('app_roles')
      .values({ id, code, name: code, status })
      .execute()
    if (paths.length > 0)
      await db
        .insertInto('app_role_permissions')
        .values(
          paths.map((path) => ({
            role_id: id,
            permission_id: permissionId.get(path)!,
          })),
        )
        .execute()
  }

  async function addUser(
    id: string,
    code: string,
    name: string,
    roleIds: readonly string[],
  ) {
    await db
      .insertInto('app_users')
      .values({
        id,
        username: code,
        display_name: name,
        py: searchPinyin(name),
        password_hash: await hashPassword(password),
        status: 'ENABLED',
        password_changed_at: new Date(),
        password_change_required: false,
      })
      .execute()
    if (roleIds.length > 0)
      await db
        .insertInto('app_user_roles')
        .values(roleIds.map((role_id) => ({ user_id: id, role_id })))
        .execute()
  }

  await addRole(ids.actorRole, roleCodes.actor, actorPaths)
  await addRole(ids.lowRole, roleCodes.low, ['/app/user/query'])
  await addRole(ids.highRole, roleCodes.high, [foreignPath])
  await addRole(ids.protectedRole, roleCodes.protected, protectedPaths)
  await addRole(
    ids.disabledRole,
    roleCodes.disabled,
    ['/app/user/query'],
    'DISABLED',
  )
  await addUser(ids.actor, codes.actor, 'Test administrator', [ids.actorRole])
  await addUser(ids.lowTarget, codes.lowTarget, 'Low authority user', [
    ids.lowRole,
    ids.disabledRole,
  ])
  await addUser(ids.highTarget, codes.highTarget, 'High authority user', [
    ids.highRole,
  ])
  await addUser(ids.peerAdmin, codes.peerAdmin, 'Peer administrator', [
    ids.protectedRole,
  ])
  await addUser(ids.sessionTarget, codes.sessionTarget, 'Session target', [
    ids.lowRole,
  ])
  await addUser(
    ids.concurrentTarget,
    codes.concurrentTarget,
    'Concurrent target',
    [ids.lowRole],
  )

  let systemRoleId: string
  const existingSystemRole = await db
    .selectFrom('app_roles')
    .select('id')
    .where('code', '=', 'system')
    .executeTakeFirst()
  if (existingSystemRole) {
    systemRoleId = existingSystemRole.id
  } else {
    systemRoleId = ulid()
    fixtureRoleIds.push(systemRoleId)
    await addRole(systemRoleId, 'system', [])
  }

  let superadminRoleId: string
  const existingSuperadminRole = await db
    .selectFrom('app_roles')
    .select(['id', 'status'])
    .where('code', '=', 'superadmin')
    .executeTakeFirst()
  if (existingSuperadminRole) {
    assert.equal(existingSuperadminRole.status, 'ENABLED')
    superadminRoleId = existingSuperadminRole.id
  } else {
    superadminRoleId = ulid()
    fixtureRoleIds.push(superadminRoleId)
    await addRole(superadminRoleId, 'superadmin', [])
  }
  await addUser(ids.superActor, codes.superActor, 'Super administrator', [
    superadminRoleId,
  ])

  const existingSystem = await db
    .selectFrom('app_users')
    .select('id')
    .where('id', '=', systemUserId)
    .executeTakeFirst()
  if (!existingSystem) {
    await addUser(systemUserId, `tdd-system-${suffix}`, 'System identity', [])
    fixtureUserIds.push(systemUserId)
  }

  const sessionService = new SessionService(db, config)
  const management = new ManagementService(db, config)
  const app = createApp({
    database: { ping: async () => undefined },
    session: sessionService,
    management,
    config,
  })
  let listening: (() => void) | undefined
  const started = new Promise<void>((resolve) => {
    listening = resolve
  })
  const server = serve(
    { fetch: app.fetch, hostname: '127.0.0.1', port: 0 },
    () => listening?.(),
  )
  await started
  const address = server.address()
  assert.ok(address && typeof address !== 'string')
  const origin = `http://127.0.0.1:${address.port}`
  const headers = {
    'content-type': 'application/json',
    'x-zerp-model-build': modelBuildId,
    connection: 'close',
  }

  async function signIn(code: string): Promise<HttpSession> {
    const response = await fetch(`${origin}/session/auth/signin`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ code, password }),
    })
    assert.equal(response.status, 200)
    const payload = (await response.json()) as Envelope
    assert.equal(payload.code, 0)
    const cookie = response.headers.getSetCookie()[0]
    assert.ok(cookie)
    return { cookie, csrfToken: payload.data.csrfToken }
  }

  async function post(session: HttpSession, path: string, body: unknown) {
    const response = await fetch(`${origin}${path}`, {
      method: 'POST',
      headers: {
        ...headers,
        cookie: session.cookie,
        'x-csrf-token': session.csrfToken,
      },
      body: JSON.stringify(body),
    })
    assert.equal(response.status, 200)
    return response.json() as Promise<Envelope>
  }

  async function restore(cookie: string) {
    const response = await fetch(`${origin}/session/auth/restore`, {
      method: 'POST',
      headers: { ...headers, cookie },
      body: '{}',
    })
    assert.equal(response.status, 200)
    return response.json() as Promise<Envelope>
  }

  async function principalFor(session: HttpSession) {
    const token = new RegExp(`${config.sessionCookieName}=([^;]+)`).exec(
      session.cookie,
    )?.[1]
    return sessionService.authenticate(token, session.csrfToken, true)
  }

  async function userFact(id: string) {
    return db
      .selectFrom('app_users')
      .select([
        'display_name',
        'py',
        'password_hash',
        'status',
        'password_change_required',
        'revision',
      ])
      .where('id', '=', id)
      .executeTakeFirstOrThrow()
  }

  async function roleFacts(id: string) {
    return db
      .selectFrom('app_user_roles')
      .select('role_id')
      .where('user_id', '=', id)
      .orderBy('role_id')
      .execute()
  }

  async function roleFact(id: string) {
    return db
      .selectFrom('app_roles')
      .select(['status', 'revision'])
      .where('id', '=', id)
      .executeTakeFirstOrThrow()
  }

  async function auditCount(id: string) {
    return db
      .selectFrom('app_audit_events')
      .select((builder) => builder.fn.countAll<number>().as('count'))
      .where('target_id', '=', id)
      .executeTakeFirstOrThrow()
      .then((row) => Number(row.count))
  }

  async function latestAudit(id: string) {
    return db
      .selectFrom('app_audit_events')
      .select(['event_type', 'summary'])
      .where('target_id', '=', id)
      .orderBy('created_at', 'desc')
      .orderBy('id', 'desc')
      .executeTakeFirstOrThrow()
  }

  async function externalAuthorizationAdminIds() {
    const externalUsers = await db
      .selectFrom('app_users')
      .select('id')
      .where('status', '=', 'ENABLED')
      .where('id', 'not in', fixtureUserIds)
      .execute()
    const externalIds = externalUsers.map((user) => user.id)
    if (externalIds.length === 0) return []
    const roles = await db
      .selectFrom('app_user_roles as ur')
      .innerJoin('app_roles as r', 'r.id', 'ur.role_id')
      .select(['ur.user_id', 'r.code'])
      .where('ur.user_id', 'in', externalIds)
      .where('r.status', '=', 'ENABLED')
      .execute()
    const paths = await db
      .selectFrom('app_user_roles as ur')
      .innerJoin('app_roles as r', 'r.id', 'ur.role_id')
      .innerJoin('app_role_permissions as rp', 'rp.role_id', 'r.id')
      .innerJoin('app_permissions as p', 'p.id', 'rp.permission_id')
      .select(['ur.user_id', 'p.path'])
      .where('ur.user_id', 'in', externalIds)
      .where('r.status', '=', 'ENABLED')
      .where('p.status', '=', 'ENABLED')
      .execute()
    const pathsByUser = new Map<string, Set<string>>()
    for (const row of paths) {
      const set = pathsByUser.get(row.user_id) ?? new Set<string>()
      set.add(row.path)
      pathsByUser.set(row.user_id, set)
    }
    const superadminUsers = new Set(
      roles
        .filter((role) => role.code === 'superadmin')
        .map((role) => role.user_id),
    )
    return externalIds.filter(
      (id) =>
        superadminUsers.has(id) ||
        protectedPaths.every((path) => pathsByUser.get(id)?.has(path)),
    )
  }

  context.after(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()))
    })
    try {
      await db
        .deleteFrom('app_audit_events')
        .where((builder) =>
          builder.or([
            builder('actor_user_id', 'in', fixtureUserIds),
            builder('target_id', 'in', fixtureUserIds),
          ]),
        )
        .execute()
      await db
        .deleteFrom('app_sessions')
        .where('user_id', 'in', fixtureUserIds)
        .execute()
      await db
        .deleteFrom('app_user_roles')
        .where('user_id', 'in', fixtureUserIds)
        .execute()
      await db
        .deleteFrom('app_role_permissions')
        .where('role_id', 'in', fixtureRoleIds)
        .execute()
      if (fixturePermissionIds.length > 0)
        await db
          .deleteFrom('app_permissions')
          .where('id', 'in', fixturePermissionIds)
          .execute()
      await db
        .deleteFrom('app_users')
        .where('id', 'in', fixtureUserIds)
        .execute()
      await db
        .deleteFrom('app_roles')
        .where('id', 'in', fixtureRoleIds)
        .execute()
    } finally {
      await db.destroy()
    }
  })

  return {
    db,
    ids,
    codes,
    roleCodes,
    systemRoleId,
    superadminRoleId,
    password,
    management,
    signIn,
    post,
    restore,
    principalFor,
    userFact,
    roleFacts,
    roleFact,
    auditCount,
    latestAudit,
    externalAuthorizationAdminIds,
    trackUser: (id: string) => fixtureUserIds.push(id),
    trackRole: (id: string) => fixtureRoleIds.push(id),
    trackPermission: (id: string) => fixturePermissionIds.push(id),
  }
}

test('real HTTP rejects user creation and maintenance above the authorization ceiling without persistent residue', async (context) => {
  const harness = await createHarness(context)
  const actor = await harness.signIn(harness.codes.actor)
  const highBefore = await harness.userFact(harness.ids.highTarget)
  const highRolesBefore = await harness.roleFacts(harness.ids.highTarget)
  const highAuditsBefore = await harness.auditCount(harness.ids.highTarget)

  const rejectedCreate = await harness.post(actor, '/app/user/create', {
    code: `tdd-over-ceiling-${harness.ids.actor.slice(-8).toLowerCase()}`,
    name: 'Over ceiling user',
    password: harness.password,
    roleIds: [harness.ids.highRole],
  })
  assert.equal(rejectedCreate.errorKey, 'forbidden')

  const rejectedSave = await harness.post(actor, '/app/user/save', {
    id: harness.ids.highTarget,
    name: 'Attempted higher authority update',
    roleIds: [harness.ids.lowRole],
    revision: String(highBefore.revision),
  })
  assert.equal(rejectedSave.errorKey, 'forbidden')
  assert.deepEqual(await harness.userFact(harness.ids.highTarget), highBefore)
  assert.deepEqual(
    await harness.roleFacts(harness.ids.highTarget),
    highRolesBefore,
  )
  assert.equal(
    await harness.auditCount(harness.ids.highTarget),
    highAuditsBefore,
  )
})

test('real HTTP rejects a user-management attempt to change the actor own roles without persistent residue', async (context) => {
  const harness = await createHarness(context)
  const actor = await harness.signIn(harness.codes.actor)
  const before = await harness.userFact(harness.ids.actor)
  const rolesBefore = await harness.roleFacts(harness.ids.actor)
  const auditsBefore = await harness.auditCount(harness.ids.actor)

  const rejected = await harness.post(actor, '/app/user/save', {
    id: harness.ids.actor,
    name: 'Attempted role escalation',
    roleIds: [harness.ids.lowRole],
    revision: String(before.revision),
  })

  assert.equal(rejected.errorKey, 'forbidden')
  assert.deepEqual(await harness.userFact(harness.ids.actor), before)
  assert.deepEqual(await harness.roleFacts(harness.ids.actor), rolesBefore)
  assert.equal(await harness.auditCount(harness.ids.actor), auditsBefore)
})

test('real HTTP keeps the system identity readable but rejects every user-management mutation', async (context) => {
  const harness = await createHarness(context)
  const actor = await harness.signIn(harness.codes.actor)
  const before = await harness.userFact(systemUserId)
  const rolesBefore = await harness.roleFacts(systemUserId)
  const auditsBefore = await harness.auditCount(systemUserId)

  const detail = await harness.post(actor, '/app/user/get', {
    id: systemUserId,
  })
  assert.equal(detail.code, 0)
  assert.equal(detail.data.id, systemUserId)

  for (const [path, body] of [
    [
      '/app/user/save',
      {
        id: systemUserId,
        name: 'Attempted system edit',
        roleIds: [harness.ids.lowRole],
        revision: String(before.revision),
      },
    ],
    [
      '/app/user/enable',
      { id: systemUserId, revision: String(before.revision) },
    ],
    [
      '/app/user/disable',
      { id: systemUserId, revision: String(before.revision) },
    ],
  ] as const) {
    const rejected = await harness.post(actor, path, body)
    assert.equal(rejected.errorKey, 'conflict')
  }

  assert.deepEqual(await harness.userFact(systemUserId), before)
  assert.deepEqual(await harness.roleFacts(systemUserId), rolesBefore)
  assert.equal(await harness.auditCount(systemUserId), auditsBefore)
})

test('real HTTP preserves an authorization administrator while allowing another administrator to be disabled', async (context) => {
  const harness = await createHarness(context)
  const actor = await harness.signIn(harness.codes.actor)
  const peerBefore = await harness.userFact(harness.ids.peerAdmin)

  const disabledPeer = await harness.post(actor, '/app/user/disable', {
    id: harness.ids.peerAdmin,
    revision: String(peerBefore.revision),
  })
  assert.equal(disabledPeer.code, 0)
  assert.equal(
    (await harness.userFact(harness.ids.peerAdmin)).status,
    'DISABLED',
  )

  const restoredActor = await harness.restore(actor.cookie)
  assert.equal(restoredActor.code, 0)
  for (const path of protectedPaths)
    assert.ok(
      restoredActor.data.apiPaths.includes(path),
      `actor retains ${path}`,
    )

  const actorBefore = await harness.userFact(harness.ids.actor)
  const actorRolesBefore = await harness.roleFacts(harness.ids.actor)
  const selfDisable = await harness.post(actor, '/app/user/disable', {
    id: harness.ids.actor,
    revision: String(actorBefore.revision),
  })
  assert.equal(selfDisable.errorKey, 'conflict')
  assert.deepEqual(await harness.userFact(harness.ids.actor), actorBefore)
  assert.deepEqual(await harness.roleFacts(harness.ids.actor), actorRolesBefore)
})

test('real HTTP disable revokes every target session and enable does not revive sessions or reset the password', async (context) => {
  const harness = await createHarness(context)
  const actor = await harness.signIn(harness.codes.actor)
  const firstTargetSession = await harness.signIn(harness.codes.sessionTarget)
  const secondTargetSession = await harness.signIn(harness.codes.sessionTarget)
  await harness.db
    .updateTable('app_users')
    .set({ revision: '9007199254740993' })
    .where('id', '=', harness.ids.sessionTarget)
    .execute()
  const before = await harness.userFact(harness.ids.sessionTarget)
  assert.equal(String(before.revision), '9007199254740993')
  const auditsBefore = await harness.auditCount(harness.ids.sessionTarget)
  const sessionsBefore = await harness.db
    .selectFrom('app_sessions')
    .select('id')
    .where('user_id', '=', harness.ids.sessionTarget)
    .where('revoked_at', 'is', null)
    .execute()
  assert.equal(sessionsBefore.length, 2)

  const disabled = await harness.post(actor, '/app/user/disable', {
    id: harness.ids.sessionTarget,
    revision: String(before.revision),
  })
  assert.equal(disabled.code, 0)
  assert.equal(disabled.data.revision, '9007199254740994')
  const revoked = await harness.db
    .selectFrom('app_sessions')
    .select(['id', 'revoked_at', 'revoked_reason'])
    .where(
      'id',
      'in',
      sessionsBefore.map((session) => session.id),
    )
    .execute()
  assert.deepEqual(
    revoked.map((session) => ({
      id: session.id,
      reason: session.revoked_reason,
      revoked: Boolean(session.revoked_at),
    })),
    sessionsBefore.map((session) => ({
      id: session.id,
      reason: 'user_disabled',
      revoked: true,
    })),
  )
  for (const session of [firstTargetSession, secondTargetSession])
    assert.equal(
      (await harness.restore(session.cookie)).errorKey,
      'unauthenticated',
    )
  const disabledAudit = await harness.latestAudit(harness.ids.sessionTarget)
  assert.equal(disabledAudit.event_type, 'USER_DISABLED')
  assert.deepEqual(
    typeof disabledAudit.summary === 'string'
      ? JSON.parse(disabledAudit.summary)
      : disabledAudit.summary,
    {
      domain: 'app',
      entity: 'user',
      beforeEnabled: true,
      afterEnabled: false,
      beforeRevision: '9007199254740993',
      revision: '9007199254740994',
    },
  )

  const stale = await harness.post(actor, '/app/user/disable', {
    id: harness.ids.sessionTarget,
    revision: '9007199254740993',
  })
  assert.equal(stale.errorKey, 'user_changed')
  const sameState = await harness.post(actor, '/app/user/disable', {
    id: harness.ids.sessionTarget,
    revision: disabled.data.revision,
  })
  assert.equal(sameState.errorKey, 'conflict')
  assert.equal(
    (await harness.userFact(harness.ids.sessionTarget)).revision,
    '9007199254740994',
  )
  assert.equal(
    await harness.auditCount(harness.ids.sessionTarget),
    auditsBefore + 1,
  )

  const enabled = await harness.post(actor, '/app/user/enable', {
    id: harness.ids.sessionTarget,
    revision: disabled.data.revision,
  })
  assert.equal(enabled.code, 0)
  const after = await harness.userFact(harness.ids.sessionTarget)
  assert.equal(after.status, 'ENABLED')
  assert.equal(after.password_hash, before.password_hash)
  assert.equal(after.password_change_required, before.password_change_required)
  for (const session of [firstTargetSession, secondTargetSession])
    assert.equal(
      (await harness.restore(session.cookie)).errorKey,
      'unauthenticated',
    )

  await harness.signIn(harness.codes.sessionTarget)
  const activeAfterNewSignin = await harness.db
    .selectFrom('app_sessions')
    .select((builder) => builder.fn.countAll<number>().as('count'))
    .where('user_id', '=', harness.ids.sessionTarget)
    .where('revoked_at', 'is', null)
    .executeTakeFirstOrThrow()
  assert.equal(Number(activeAfterNewSignin.count), 1)
})

test('real ManagementService rolls back user and role enablement when audit persistence fails', async (context) => {
  const harness = await createHarness(context)
  const actorSession = await harness.signIn(harness.codes.actor)
  const actor = await harness.principalFor(actorSession)
  const targetSession = await harness.signIn(harness.codes.sessionTarget)
  const oversizedRequestId = 'x'.repeat(129)

  const userBefore = await harness.userFact(harness.ids.sessionTarget)
  const userAuditsBefore = await harness.auditCount(harness.ids.sessionTarget)
  const sessionsBefore = await harness.db
    .selectFrom('app_sessions')
    .select(['id', 'revoked_at', 'revoked_reason'])
    .where('user_id', '=', harness.ids.sessionTarget)
    .orderBy('id', 'asc')
    .execute()
  assert.equal((await harness.restore(targetSession.cookie)).code, 0)

  await assert.rejects(
    () =>
      harness.management.setUserStatus(
        {
          id: harness.ids.sessionTarget,
          revision: String(userBefore.revision),
        },
        'DISABLED',
        actor,
        oversizedRequestId,
      ),
    { code: '22001' },
  )
  assert.deepEqual(
    await harness.userFact(harness.ids.sessionTarget),
    userBefore,
  )
  assert.equal(
    await harness.auditCount(harness.ids.sessionTarget),
    userAuditsBefore,
  )
  assert.deepEqual(
    await harness.db
      .selectFrom('app_sessions')
      .select(['id', 'revoked_at', 'revoked_reason'])
      .where('user_id', '=', harness.ids.sessionTarget)
      .orderBy('id', 'asc')
      .execute(),
    sessionsBefore,
  )
  assert.equal((await harness.restore(targetSession.cookie)).code, 0)

  const roleBefore = await harness.roleFact(harness.ids.lowRole)
  const roleLinksBefore = await harness.db
    .selectFrom('app_role_permissions')
    .select('permission_id')
    .where('role_id', '=', harness.ids.lowRole)
    .orderBy('permission_id', 'asc')
    .execute()
  const roleAuditsBefore = await harness.auditCount(harness.ids.lowRole)
  assert.equal(
    (
      await harness.post(targetSession, '/app/user/query', {
        keyword: '',
        page: 1,
        pageSize: 20,
      })
    ).code,
    0,
  )

  await assert.rejects(
    () =>
      harness.management.setRoleStatus(
        { id: harness.ids.lowRole, revision: String(roleBefore.revision) },
        'DISABLED',
        actor,
        oversizedRequestId,
      ),
    { code: '22001' },
  )
  assert.deepEqual(await harness.roleFact(harness.ids.lowRole), roleBefore)
  assert.deepEqual(
    await harness.db
      .selectFrom('app_role_permissions')
      .select('permission_id')
      .where('role_id', '=', harness.ids.lowRole)
      .orderBy('permission_id', 'asc')
      .execute(),
    roleLinksBefore,
  )
  assert.equal(await harness.auditCount(harness.ids.lowRole), roleAuditsBefore)
  assert.equal(
    (
      await harness.post(targetSession, '/app/user/query', {
        keyword: '',
        page: 1,
        pageSize: 20,
      })
    ).code,
    0,
  )
})

test('real HTTP concurrent same-revision saves commit one result and roll back the loser', async (context) => {
  const harness = await createHarness(context)
  const actor = await harness.signIn(harness.codes.actor)
  const before = await harness.userFact(harness.ids.concurrentTarget)
  const rolesBefore = await harness.roleFacts(harness.ids.concurrentTarget)
  const auditsBefore = await harness.auditCount(harness.ids.concurrentTarget)
  const names = ['Concurrent update one', 'Concurrent update two']

  const results = await Promise.all(
    names.map((name) =>
      harness.post(actor, '/app/user/save', {
        id: harness.ids.concurrentTarget,
        name,
        roleIds: [harness.ids.lowRole],
        revision: String(before.revision),
      }),
    ),
  )

  assert.equal(results.filter((result) => result.code === 0).length, 1)
  assert.equal(
    results.filter((result) => result.errorKey === 'user_changed').length,
    1,
  )
  const after = await harness.userFact(harness.ids.concurrentTarget)
  assert.ok(names.includes(after.display_name))
  assert.equal(BigInt(after.revision), BigInt(before.revision) + 1n)
  assert.deepEqual(
    await harness.roleFacts(harness.ids.concurrentTarget),
    rolesBefore,
  )
  assert.equal(
    await harness.auditCount(harness.ids.concurrentTarget),
    auditsBefore + 1,
  )
})

test('real HTTP user creation and rename persist one searchable pinyin fact', async (context) => {
  const harness = await createHarness(context)
  const actor = await harness.signIn(harness.codes.actor)
  const created = await harness.post(actor, '/app/user/create', {
    code: `tdd-pinyin-${harness.ids.actor.slice(-8).toLowerCase()}`,
    name: '张三',
    password: harness.password,
    roleIds: [harness.ids.lowRole],
  })
  assert.equal(created.code, 0)
  harness.trackUser(created.data.id)
  assert.equal(created.data.py, 'zhangsan')
  assert.equal((await harness.userFact(created.data.id)).py, 'zhangsan')

  const saved = await harness.post(actor, '/app/user/save', {
    id: created.data.id,
    name: '李四',
    roleIds: [harness.ids.lowRole],
    revision: created.data.revision,
  })
  assert.equal(saved.code, 0)
  assert.equal(saved.data.py, 'lisi')
  assert.equal((await harness.userFact(created.data.id)).py, 'lisi')
  for (const [keyword, expected] of [
    ['zhangsan', false],
    ['lisi', true],
  ] as const) {
    const page = await harness.post(actor, '/app/user/query', {
      keyword,
      page: 1,
      pageSize: 20,
    })
    assert.equal(
      page.data.items.some(
        (item: { id: string }) => item.id === created.data.id,
      ),
      expected,
    )
  }
})

test('real HTTP publishes assignable roles separately from role-maintenance eligibility', async (context) => {
  const harness = await createHarness(context)
  const actor = await harness.signIn(harness.codes.actor)
  const superActor = await harness.signIn(harness.codes.superActor)

  async function queriedRole(session: HttpSession, code: string) {
    const page = await harness.post(session, '/app/role/query', {
      keyword: code,
      page: 1,
      pageSize: 20,
    })
    assert.equal(page.code, 0)
    const role = page.data.items.find(
      (item: { code: string }) => item.code === code,
    )
    assert.ok(role, `role ${code} must be visible to the role query`)
    return role as { id: string; assignable: boolean }
  }

  assert.equal(
    (await queriedRole(actor, harness.roleCodes.actor)).assignable,
    true,
  )
  assert.equal(
    (await queriedRole(actor, harness.roleCodes.low)).assignable,
    true,
  )
  assert.equal(
    (await queriedRole(actor, harness.roleCodes.high)).assignable,
    false,
  )
  assert.equal(
    (await queriedRole(actor, harness.roleCodes.disabled)).assignable,
    false,
  )
  assert.equal((await queriedRole(actor, 'system')).assignable, false)
  assert.equal((await queriedRole(actor, 'superadmin')).assignable, false)
  assert.equal((await queriedRole(superActor, 'superadmin')).assignable, true)

  const assignedDetail = await harness.post(actor, '/app/user/get', {
    id: harness.ids.lowTarget,
  })
  assert.equal(assignedDetail.code, 0)
  assert.deepEqual(
    assignedDetail.data.roles.find(
      (role: { id: string }) => role.id === harness.ids.disabledRole,
    ),
    {
      id: harness.ids.disabledRole,
      code: harness.roleCodes.disabled,
      name: harness.roleCodes.disabled,
      enabled: false,
      type: 'NORMAL',
      assignable: false,
    },
  )

  const ordinarySelfRoleAssignment = await harness.post(
    actor,
    '/app/user/create',
    {
      code: `tdd-self-role-${harness.ids.actor.slice(-8).toLowerCase()}`,
      name: 'Ordinary assigned role user',
      password: harness.password,
      roleIds: [harness.ids.actorRole],
    },
  )
  assert.equal(ordinarySelfRoleAssignment.code, 0)
  harness.trackUser(ordinarySelfRoleAssignment.data.id)

  const disabledRoleAssignment = await harness.post(actor, '/app/user/create', {
    code: `tdd-disabled-role-${harness.ids.actor.slice(-8).toLowerCase()}`,
    name: 'Disabled role user',
    password: harness.password,
    roleIds: [harness.ids.disabledRole],
  })
  assert.equal(disabledRoleAssignment.errorKey, 'validation_failed')

  const ordinarySuperadminAssignment = await harness.post(
    actor,
    '/app/user/create',
    {
      code: `tdd-ordinary-super-${harness.ids.actor.slice(-8).toLowerCase()}`,
      name: 'Ordinary superadmin attempt',
      password: harness.password,
      roleIds: [harness.superadminRoleId],
    },
  )
  assert.equal(ordinarySuperadminAssignment.errorKey, 'forbidden')

  const superadminAssignment = await harness.post(
    superActor,
    '/app/user/create',
    {
      code: `tdd-super-assigned-${harness.ids.actor.slice(-8).toLowerCase()}`,
      name: 'Superadmin assigned user',
      password: harness.password,
      roleIds: [harness.superadminRoleId],
    },
  )
  assert.equal(superadminAssignment.code, 0)
  harness.trackUser(superadminAssignment.data.id)
})

test('real HTTP role create and save require only their exact write permissions', async (context) => {
  const harness = await createHarness(context)
  const actionOnlyUserId = ulid()
  const actionOnlyRoleId = ulid()
  const actionOnlyCode = `tdd-role-write-${actionOnlyRoleId.slice(-8).toLowerCase()}`
  const actionPaths = ['/app/role/create', '/app/role/save']
  const permissions = await harness.db
    .selectFrom('app_permissions')
    .select(['id', 'path'])
    .where('path', 'in', actionPaths)
    .execute()
  assert.equal(permissions.length, actionPaths.length)
  const permissionId = new Map(permissions.map((row) => [row.path, row.id]))

  await harness.db
    .insertInto('app_roles')
    .values({
      id: actionOnlyRoleId,
      code: actionOnlyCode,
      name: 'Role write only actor',
      status: 'ENABLED',
    })
    .execute()
  await harness.db
    .insertInto('app_role_permissions')
    .values(
      actionPaths.map((path) => ({
        role_id: actionOnlyRoleId,
        permission_id: permissionId.get(path)!,
      })),
    )
    .execute()
  await harness.db
    .insertInto('app_users')
    .values({
      id: actionOnlyUserId,
      username: actionOnlyCode,
      display_name: 'Role write only actor',
      py: searchPinyin('Role write only actor'),
      password_hash: await hashPassword(harness.password),
      status: 'ENABLED',
      password_changed_at: new Date(),
      password_change_required: false,
    })
    .execute()
  await harness.db
    .insertInto('app_user_roles')
    .values({ user_id: actionOnlyUserId, role_id: actionOnlyRoleId })
    .execute()
  harness.trackRole(actionOnlyRoleId)
  harness.trackUser(actionOnlyUserId)

  const actionOnly = await harness.signIn(actionOnlyCode)
  const created = await harness.post(actionOnly, '/app/role/create', {
    name: '仅写角色',
    description: null,
    permissionIds: [permissionId.get('/app/role/create')!],
  })
  assert.equal(created.code, 0)
  harness.trackRole(created.data.id)
  assert.equal(created.data.name, '仅写角色')
  assert.equal(created.data.permissions[0].path, '/app/role/create')

  const saved = await harness.post(actionOnly, '/app/role/save', {
    id: created.data.id,
    name: '仅写角色已修改',
    description: '无需详情或权限目录读取权限',
    permissionIds: [permissionId.get('/app/role/create')!],
    revision: created.data.revision,
  })
  assert.equal(saved.code, 0)
  assert.equal(saved.data.name, '仅写角色已修改')
  assert.equal(saved.data.permissions[0].path, '/app/role/create')
})

test('real HTTP rejects trimmed case-insensitive role name collisions without changing either role', async (context) => {
  const harness = await createHarness(context)
  const actor = await harness.signIn(harness.codes.actor)
  const existing = await harness.post(actor, '/app/role/get', {
    id: harness.ids.lowRole,
  })
  assert.equal(existing.code, 0)
  const permissionIds = existing.data.permissions.map(
    (permission: { id: string }) => permission.id,
  )
  const collisionName = `  ${existing.data.name.toUpperCase()}  `
  const beforeQuery = await harness.post(actor, '/app/role/query', {
    keyword: existing.data.name,
    page: 1,
    pageSize: 20,
  })
  const rejectedCreate = await harness.post(actor, '/app/role/create', {
    name: collisionName,
    description: 'must not persist',
    permissionIds,
  })
  assert.equal(rejectedCreate.errorKey, 'role_name_exists')
  const afterQuery = await harness.post(actor, '/app/role/query', {
    keyword: existing.data.name,
    page: 1,
    pageSize: 20,
  })
  assert.deepEqual(afterQuery.data, beforeQuery.data)

  const created = await harness.post(actor, '/app/role/create', {
    name: `Collision candidate ${harness.ids.lowRole}`,
    description: 'original description',
    permissionIds,
  })
  assert.equal(created.code, 0)
  harness.trackRole(created.data.id)
  const rejectedSave = await harness.post(actor, '/app/role/save', {
    id: created.data.id,
    revision: created.data.revision,
    name: collisionName,
    description: 'must not replace the original description',
    permissionIds,
  })
  assert.equal(rejectedSave.errorKey, 'role_name_exists')
  const preserved = await harness.post(actor, '/app/role/get', {
    id: created.data.id,
  })
  assert.equal(preserved.code, 0)
  assert.deepEqual(preserved.data, created.data)
  const stillExisting = await harness.post(actor, '/app/role/get', {
    id: harness.ids.lowRole,
  })
  assert.deepEqual(stillExisting.data, existing.data)
})

test('real HTTP rejects disabled role permissions without removing existing detail references', async (context) => {
  const harness = await createHarness(context)
  const actor = await harness.signIn(harness.codes.actor)
  const disabledPermissionId = ulid()
  const disabledEntity = `tdd-disabled-${disabledPermissionId.slice(-8).toLowerCase()}`
  const activePermission = await harness.db
    .selectFrom('app_permissions')
    .select('id')
    .where('path', '=', '/app/user/query')
    .executeTakeFirstOrThrow()
  await harness.db
    .insertInto('app_permissions')
    .values({
      id: disabledPermissionId,
      path: `/app/${disabledEntity}/read`,
      domain: 'app',
      entity: disabledEntity,
      action: 'read',
      description: 'disabled test permission',
      status: 'DISABLED',
    })
    .execute()
  await harness.db
    .insertInto('app_role_permissions')
    .values({
      role_id: harness.ids.lowRole,
      permission_id: disabledPermissionId,
    })
    .execute()
  harness.trackPermission(disabledPermissionId)

  const before = await harness.roleFact(harness.ids.lowRole)
  const linksBefore = await harness.db
    .selectFrom('app_role_permissions')
    .select('permission_id')
    .where('role_id', '=', harness.ids.lowRole)
    .orderBy('permission_id', 'asc')
    .execute()
  const auditsBefore = await harness.auditCount(harness.ids.lowRole)
  const detail = await harness.post(actor, '/app/role/get', {
    id: harness.ids.lowRole,
  })
  assert.equal(detail.code, 0)
  assert.deepEqual(
    detail.data.permissions.find(
      (permission: { id: string }) => permission.id === disabledPermissionId,
    ),
    {
      id: disabledPermissionId,
      path: `/app/${disabledEntity}/read`,
      domain: 'app',
      entity: disabledEntity,
      action: 'read',
      description: 'disabled test permission',
      status: 'DISABLED',
    },
  )

  const rejected = await harness.post(actor, '/app/role/save', {
    id: harness.ids.lowRole,
    name: 'must not persist',
    description: null,
    permissionIds: [activePermission.id, disabledPermissionId],
    revision: String(before.revision),
  })
  assert.equal(rejected.errorKey, 'validation_failed')
  assert.deepEqual(await harness.roleFact(harness.ids.lowRole), before)
  assert.deepEqual(
    await harness.db
      .selectFrom('app_role_permissions')
      .select('permission_id')
      .where('role_id', '=', harness.ids.lowRole)
      .orderBy('permission_id', 'asc')
      .execute(),
    linksBefore,
  )
  assert.equal(await harness.auditCount(harness.ids.lowRole), auditsBefore)
})

test('real HTTP rolls back system, own-role, and over-ceiling role enablement attempts', async (context) => {
  const harness = await createHarness(context)
  const actor = await harness.signIn(harness.codes.actor)

  for (const [label, id] of [
    ['system', harness.systemRoleId],
    ['superadmin', harness.superadminRoleId],
    ['own', harness.ids.actorRole],
    ['over-ceiling', harness.ids.highRole],
  ] as const) {
    const before = await harness.roleFact(id)
    const auditsBefore = await harness.auditCount(id)
    const rejected = await harness.post(actor, '/app/role/disable', {
      id,
      revision: String(before.revision),
    })
    assert.equal(rejected.errorKey, 'forbidden', label)
    assert.deepEqual(await harness.roleFact(id), before, label)
    assert.equal(await harness.auditCount(id), auditsBefore, label)
  }
})

test('real HTTP rolls back role disable that would remove the final authorization administrator', async (context) => {
  const harness = await createHarness(context)
  const externalAdmins = await harness.externalAuthorizationAdminIds()
  if (externalAdmins.length > 0) {
    context.skip(
      `dedicated test runner has external authorization administrators: ${externalAdmins.join(',')}`,
    )
    return
  }
  const permissionRows = await harness.db
    .selectFrom('app_permissions')
    .select(['id', 'path'])
    .where('path', 'in', [...new Set([...protectedPaths, '/app/role/disable'])])
    .execute()
  const permissionId = new Map(permissionRows.map((row) => [row.path, row.id]))
  for (const path of [...protectedPaths, '/app/role/disable'])
    assert.ok(permissionId.has(path), `target catalog must contain ${path}`)

  await harness.db
    .deleteFrom('app_role_permissions')
    .where('role_id', '=', harness.ids.actorRole)
    .execute()
  await harness.db
    .insertInto('app_role_permissions')
    .values(
      ['/app/user/query', '/app/role/disable'].map((path) => ({
        role_id: harness.ids.actorRole,
        permission_id: permissionId.get(path)!,
      })),
    )
    .execute()
  await harness.db
    .deleteFrom('app_role_permissions')
    .where('role_id', '=', harness.ids.protectedRole)
    .execute()
  await harness.db
    .insertInto('app_role_permissions')
    .values(
      protectedPaths.slice(1).map((path) => ({
        role_id: harness.ids.protectedRole,
        permission_id: permissionId.get(path)!,
      })),
    )
    .execute()
  await harness.db
    .insertInto('app_user_roles')
    .values({ user_id: harness.ids.peerAdmin, role_id: harness.ids.lowRole })
    .execute()
  await harness.db
    .updateTable('app_users')
    .set({ status: 'DISABLED' })
    .where('id', '=', harness.ids.superActor)
    .execute()

  const peer = await harness.signIn(harness.codes.peerAdmin)
  const peerBefore = await harness.restore(peer.cookie)
  assert.equal(peerBefore.code, 0)
  for (const path of protectedPaths)
    assert.ok(peerBefore.data.apiPaths.includes(path), `peer has ${path}`)
  const actor = await harness.signIn(harness.codes.actor)
  const roleBefore = await harness.roleFact(harness.ids.lowRole)
  const roleReferencesBefore = await harness.db
    .selectFrom('app_user_roles')
    .select(['user_id', 'role_id'])
    .where('role_id', '=', harness.ids.lowRole)
    .orderBy('user_id', 'asc')
    .execute()
  const auditsBefore = await harness.auditCount(harness.ids.lowRole)

  const rejected = await harness.post(actor, '/app/role/disable', {
    id: harness.ids.lowRole,
    revision: String(roleBefore.revision),
  })
  assert.equal(rejected.errorKey, 'conflict')
  assert.deepEqual(await harness.roleFact(harness.ids.lowRole), roleBefore)
  assert.deepEqual(
    await harness.db
      .selectFrom('app_user_roles')
      .select(['user_id', 'role_id'])
      .where('role_id', '=', harness.ids.lowRole)
      .orderBy('user_id', 'asc')
      .execute(),
    roleReferencesBefore,
  )
  assert.equal(await harness.auditCount(harness.ids.lowRole), auditsBefore)
  assert.equal(
    (
      await harness.post(peer, '/app/user/query', {
        keyword: '',
        page: 1,
        pageSize: 20,
      })
    ).code,
    0,
  )
})

test('real HTTP role query matches Chinese pinyin before fixed pagination and reflects a rename immediately', async (context) => {
  const harness = await createHarness(context)
  const actor = await harness.signIn(harness.codes.actor)
  const suffix = randomBytes(6).toString('hex')
  const sharedName = `财务分页测试${suffix}`
  const matchingRoles = Array.from({ length: 23 }, (_, index) => ({
    id: ulid(),
    code: `tdd-role-page-${suffix}-${String(23 - index).padStart(2, '0')}`,
    name: `${sharedName}${index}`,
  }))
  const activePermission = await harness.db
    .selectFrom('app_permissions')
    .select('id')
    .where('path', '=', '/app/user/query')
    .executeTakeFirstOrThrow()
  await harness.db
    .insertInto('app_roles')
    .values(
      matchingRoles.map((role, index) => ({
        ...role,
        status: index === 22 ? ('DISABLED' as const) : ('ENABLED' as const),
      })),
    )
    .execute()
  await harness.db
    .insertInto('app_role_permissions')
    .values(
      matchingRoles.map((role) => ({
        role_id: role.id,
        permission_id: activePermission.id,
      })),
    )
    .execute()
  for (const role of matchingRoles) harness.trackRole(role.id)

  const keyword = searchPinyin(sharedName)
  const first = await harness.post(actor, '/app/role/query', {
    keyword,
    page: 1,
    pageSize: 20,
  })
  const second = await harness.post(actor, '/app/role/query', {
    keyword,
    page: 2,
    pageSize: 20,
  })
  assert.equal(first.code, 0)
  assert.equal(second.code, 0)
  assert.equal(first.data.total, 23)
  assert.equal(first.data.items.length, 20)
  assert.equal(second.data.items.length, 3)
  const listed = [...first.data.items, ...second.data.items]
  assert.deepEqual(
    listed.map((role: { code: string }) => role.code),
    matchingRoles.map((role) => role.code).sort(),
  )
  assert.ok(
    listed.every((role: { availableActions: string[] }) =>
      role.availableActions.every((action) =>
        ['edit', 'enable', 'disable'].includes(action),
      ),
    ),
  )
  assert.equal(
    listed.find((role: { id: string }) => role.id === matchingRoles[22]!.id)
      .enabled,
    false,
  )

  const renamed = matchingRoles[0]!
  const renamedName = `改名后${suffix}`
  const saved = await harness.post(actor, '/app/role/save', {
    id: renamed.id,
    name: renamedName,
    description: null,
    permissionIds: [activePermission.id],
    revision: '1',
  })
  assert.equal(saved.code, 0)
  assert.equal(saved.data.py, searchPinyin(renamedName))
  const oldQuery = await harness.post(actor, '/app/role/query', {
    keyword,
    page: 1,
    pageSize: 20,
  })
  const newQuery = await harness.post(actor, '/app/role/query', {
    keyword: searchPinyin(renamedName),
    page: 1,
    pageSize: 20,
  })
  assert.equal(oldQuery.data.total, 22)
  assert.deepEqual(
    newQuery.data.items.map((role: { id: string }) => role.id),
    [renamed.id],
  )
})

test('real HTTP role enablement keeps user role references and sessions while CAS, audit, and authorization stay atomic', async (context) => {
  const harness = await createHarness(context)
  const actor = await harness.signIn(harness.codes.actor)
  const targetSession = await harness.signIn(harness.codes.sessionTarget)
  const referencesBefore = await harness.roleFacts(harness.ids.sessionTarget)
  const sessionsBefore = await harness.db
    .selectFrom('app_sessions')
    .select('id')
    .where('user_id', '=', harness.ids.sessionTarget)
    .where('revoked_at', 'is', null)
    .execute()
  const auditsBefore = await harness.auditCount(harness.ids.lowRole)

  assert.equal(
    (
      await harness.post(targetSession, '/app/user/query', {
        keyword: '',
        page: 1,
        pageSize: 20,
      })
    ).code,
    0,
  )

  await harness.db
    .updateTable('app_roles')
    .set({ revision: '9007199254740993' })
    .where('id', '=', harness.ids.lowRole)
    .execute()
  const before = await harness.roleFact(harness.ids.lowRole)
  assert.equal(String(before.revision), '9007199254740993')

  const disabled = await harness.post(actor, '/app/role/disable', {
    id: harness.ids.lowRole,
    revision: String(before.revision),
  })
  assert.equal(disabled.code, 0)
  assert.equal(disabled.data.enabled, false)
  assert.equal(disabled.data.revision, '9007199254740994')
  assert.deepEqual(await harness.roleFact(harness.ids.lowRole), {
    status: 'DISABLED',
    revision: '9007199254740994',
  })
  assert.deepEqual(
    await harness.roleFacts(harness.ids.sessionTarget),
    referencesBefore,
  )
  assert.equal(
    Number(
      await harness.db
        .selectFrom('app_sessions')
        .select((builder) => builder.fn.countAll<number>().as('count'))
        .where('user_id', '=', harness.ids.sessionTarget)
        .where('revoked_at', 'is', null)
        .executeTakeFirstOrThrow()
        .then((row) => row.count),
    ),
    sessionsBefore.length,
  )
  assert.equal((await harness.restore(targetSession.cookie)).code, 0)
  assert.equal(
    (
      await harness.post(targetSession, '/app/user/query', {
        keyword: '',
        page: 1,
        pageSize: 20,
      })
    ).errorKey,
    'forbidden',
  )
  assert.equal(await harness.auditCount(harness.ids.lowRole), auditsBefore + 1)
  const audit = await harness.latestAudit(harness.ids.lowRole)
  assert.equal(audit.event_type, 'ROLE_DISABLED')
  assert.deepEqual(
    typeof audit.summary === 'string'
      ? JSON.parse(audit.summary)
      : audit.summary,
    {
      domain: 'app',
      entity: 'role',
      beforeEnabled: true,
      afterEnabled: false,
      beforeRevision: '9007199254740993',
      revision: '9007199254740994',
    },
  )

  const stale = await harness.post(actor, '/app/role/disable', {
    id: harness.ids.lowRole,
    revision: '9007199254740993',
  })
  assert.equal(stale.errorKey, 'role_changed')
  const sameState = await harness.post(actor, '/app/role/disable', {
    id: harness.ids.lowRole,
    revision: disabled.data.revision,
  })
  assert.equal(sameState.errorKey, 'conflict')
  assert.deepEqual(await harness.roleFact(harness.ids.lowRole), {
    status: 'DISABLED',
    revision: '9007199254740994',
  })
  assert.equal(await harness.auditCount(harness.ids.lowRole), auditsBefore + 1)

  const enabled = await harness.post(actor, '/app/role/enable', {
    id: harness.ids.lowRole,
    revision: disabled.data.revision,
  })
  assert.equal(enabled.code, 0)
  assert.equal(enabled.data.enabled, true)
  assert.equal(
    (
      await harness.post(targetSession, '/app/user/query', {
        keyword: '',
        page: 1,
        pageSize: 20,
      })
    ).code,
    0,
  )
})

test('real HTTP concurrent same-revision role disable commits one transition and rolls back the other', async (context) => {
  const harness = await createHarness(context)
  const actor = await harness.signIn(harness.codes.actor)
  const before = await harness.roleFact(harness.ids.lowRole)
  const referencesBefore = await harness.roleFacts(harness.ids.sessionTarget)
  const auditsBefore = await harness.auditCount(harness.ids.lowRole)

  const results = await Promise.all(
    [0, 1].map(() =>
      harness.post(actor, '/app/role/disable', {
        id: harness.ids.lowRole,
        revision: String(before.revision),
      }),
    ),
  )

  assert.equal(results.filter((result) => result.code === 0).length, 1)
  assert.equal(
    results.filter((result) => result.errorKey === 'role_changed').length,
    1,
  )
  const after = await harness.roleFact(harness.ids.lowRole)
  assert.equal(after.status, 'DISABLED')
  assert.equal(BigInt(after.revision), BigInt(before.revision) + 1n)
  assert.deepEqual(
    await harness.roleFacts(harness.ids.sessionTarget),
    referencesBefore,
  )
  assert.equal(await harness.auditCount(harness.ids.lowRole), auditsBefore + 1)
})

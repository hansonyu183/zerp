import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import test, { type TestContext } from 'node:test'

import { serve } from '@hono/node-server'
import { modelBuildId } from '@zerp/model'
import { ulid } from 'ulid'

import { createApp } from '../../src/app.ts'
import { ManagementService } from '../../src/app/management.ts'
import { hashPassword, SessionService } from '../../src/app/session.ts'
import { userPinyin } from '../../src/app/user-pinyin.ts'
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
] as const
const foreignPath = '/aux/department/query'

type HttpSession = { cookie: string; csrfToken: string }
type Envelope = { code: number; errorKey: string; data: any }

async function createHarness(context: TestContext) {
  assert.ok(databaseUrl, 'TARGET_TEST_DATABASE_URL is required')
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
        py: userPinyin(name),
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

  const config = loadConfig({
    DATABASE_URL: databaseUrl,
    APP_SESSION_COOKIE_SECURE: 'false',
  })
  const app = createApp({
    database: { ping: async () => undefined },
    session: new SessionService(db, config),
    management: new ManagementService(db, config),
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

  async function auditCount(id: string) {
    return db
      .selectFrom('app_audit_events')
      .select((builder) => builder.fn.countAll<number>().as('count'))
      .where('target_id', '=', id)
      .executeTakeFirstOrThrow()
      .then((row) => Number(row.count))
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
    signIn,
    post,
    restore,
    userFact,
    roleFacts,
    auditCount,
    trackUser: (id: string) => fixtureUserIds.push(id),
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
  const before = await harness.userFact(harness.ids.sessionTarget)
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
      status: 'DISABLED',
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

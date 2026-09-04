import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import test from 'node:test'

import { serve } from '@hono/node-server'
import { modelBuildId } from '@zerp/model'

import { createApp } from '../../src/app.ts'
import { TargetBootstrapService } from '../../src/app/bootstrap.ts'
import { ManagementService } from '../../src/app/management.ts'
import { hashPassword, SessionService } from '../../src/app/session.ts'
import { AuxApplicationError, AuxService } from '../../src/aux/service.ts'
import { BobService } from '../../src/bob/service.ts'
import { createDatabase } from '../../src/db/database.ts'
import { loadConfig } from '../../src/platform/config.ts'

const databaseUrl = process.env.TARGET_TEST_DATABASE_URL

test('APP management, AUX CRUD, and BOB reads run through real HTTP and PostgreSQL', async (context) => {
  assert.ok(databaseUrl, 'TARGET_TEST_DATABASE_URL is required')
  const db = createDatabase(databaseUrl)
  const suffix = randomBytes(8).toString('hex').toUpperCase()
  const codeSuffix = String(
    Number.parseInt(suffix.slice(0, 4), 16) % 10_000,
  ).padStart(4, '0')
  const principal = {
    userId: `I${suffix}`.padEnd(26, '0'),
    roleId: `R${suffix}`.padEnd(26, '0'),
    username: `issue363-${suffix.toLowerCase()}`,
    passwordHash: await hashPassword('Target!Password363'),
  }
  const bobId = `B${suffix}`.padEnd(26, '0')
  const bobEntryId = `E${suffix}`.padEnd(26, '0')
  const bobPreviousEntryId = `V${suffix}`.padEnd(26, '0')
  const customerId = `C${suffix}`.padEnd(26, '0')
  const customerEntryId = `Q${suffix}`.padEnd(26, '0')
  const subunitId = `S${suffix}`.padEnd(26, '0')
  const createdUserIds: string[] = []
  const createdRoleIds: string[] = []
  const createdAuxIds: string[] = []
  const createdParameterKeys = Array.from(
    { length: 21 },
    (_, index) =>
      `issue363-${suffix.toLowerCase()}.parameter-${String(index).padStart(2, '0')}`,
  )
  const bootstrap = new TargetBootstrapService(db)
  const config = loadConfig({
    DATABASE_URL: databaseUrl,
    APP_SESSION_COOKIE_SECURE: 'false',
  })

  await bootstrap.createE2EPrincipal(principal)
  await db
    .updateTable('app_users')
    .set({ password_change_required: false })
    .where('id', '=', principal.userId)
    .execute()
  const approvedAt = new Date()
  await db
    .insertInto('dcl_subjects')
    .values([
      {
        id: bobId,
        entity: 'employee',
        code: `EMP-${codeSuffix}`,
        created_at: approvedAt,
        created_by: principal.userId,
      },
      {
        id: customerId,
        entity: 'customer',
        code: `CUS-${codeSuffix}`,
        created_at: approvedAt,
        created_by: principal.userId,
      },
    ])
    .execute()
  await db
    .insertInto('approval_entries')
    .values([
      {
        id: bobPreviousEntryId,
        domain: 'dcl',
        entity: 'employee',
        subject_id: bobId,
        version_no: 2,
        status: 'APPROVED',
        revision: 1,
        submitted_by: principal.userId,
        submitted_at: approvedAt,
        approved_by: principal.userId,
        approved_at: approvedAt,
        updated_by: principal.userId,
        updated_at: approvedAt,
      },
      {
        id: bobEntryId,
        domain: 'dcl',
        entity: 'employee',
        subject_id: bobId,
        version_no: 3,
        status: 'APPROVED',
        revision: 1,
        submitted_by: principal.userId,
        submitted_at: approvedAt,
        approved_by: principal.userId,
        approved_at: approvedAt,
        updated_by: principal.userId,
        updated_at: approvedAt,
      },
      {
        id: customerEntryId,
        domain: 'dcl',
        entity: 'customer',
        subject_id: customerId,
        version_no: 2,
        status: 'APPROVED',
        revision: 1,
        submitted_by: principal.userId,
        submitted_at: approvedAt,
        approved_by: principal.userId,
        approved_at: approvedAt,
        updated_by: principal.userId,
        updated_at: approvedAt,
      },
    ])
    .execute()
  await db
    .insertInto('dcl_employee_versions')
    .values([
      {
        approval_entry_id: bobPreviousEntryId,
        display_name: `Previous Employee ${suffix}`,
        enabled: true,
      },
      {
        approval_entry_id: bobEntryId,
        display_name: `Target Employee ${suffix}`,
        enabled: true,
      },
    ])
    .execute()
  await db
    .insertInto('dcl_customer_versions')
    .values({
      approval_entry_id: customerEntryId,
      kind: 'MAINLAND_ENTERPRISE',
      display_name: `Target Customer ${suffix}`,
      enabled: true,
    })
    .execute()
  await db
    .insertInto('dcl_customer_subunit_roots')
    .values({
      subunit_id: subunitId,
      customer_id: customerId,
      code: `SUB-${suffix}`,
    })
    .execute()
  await db
    .insertInto('dcl_customer_version_subunits')
    .values({
      customer_approval_entry_id: customerEntryId,
      subunit_id: subunitId,
      name: `Target Customer East ${suffix}`,
      enabled: true,
    })
    .execute()
  await db
    .insertInto('app_system_parameters')
    .values(
      createdParameterKeys.map((parameterKey) => ({
        parameter_key: parameterKey,
        name: parameterKey,
        value_type: 'STRING' as const,
        configured_value: 'test',
        default_value: 'test',
        editable: false,
      })),
    )
    .execute()

  const app = createApp({
    database: { ping: async () => undefined },
    session: new SessionService(db, config),
    management: new ManagementService(db, config),
    aux: new AuxService(db),
    bob: new BobService(db),
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
  const baseHeaders = {
    'content-type': 'application/json',
    'x-zerp-model-build': modelBuildId,
    connection: 'close',
  }
  let cookie = ''
  let csrf = ''

  context.after(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()))
    })
    try {
      await db
        .deleteFrom('app_system_parameters')
        .where('parameter_key', 'in', createdParameterKeys)
        .execute()
      await db
        .deleteFrom('aux_reference_facts')
        .where('aux_object_id', 'in', createdAuxIds)
        .execute()
      await db
        .deleteFrom('aux_objects')
        .where('id', 'in', createdAuxIds)
        .execute()
      await db
        .deleteFrom('dcl_customer_version_subunits')
        .where('subunit_id', '=', subunitId)
        .execute()
      await db
        .deleteFrom('dcl_customer_subunit_roots')
        .where('subunit_id', '=', subunitId)
        .execute()
      await db
        .deleteFrom('approval_entries')
        .where('id', 'in', [bobPreviousEntryId, bobEntryId, customerEntryId])
        .execute()
      await db
        .deleteFrom('dcl_subjects')
        .where('id', 'in', [bobId, customerId])
        .execute()
      await db
        .deleteFrom('app_audit_events')
        .where('actor_user_id', 'in', [principal.userId, ...createdUserIds])
        .execute()
      await db
        .deleteFrom('app_sessions')
        .where('user_id', 'in', [principal.userId, ...createdUserIds])
        .execute()
      await db
        .deleteFrom('app_user_roles')
        .where('user_id', 'in', createdUserIds)
        .execute()
      await db
        .deleteFrom('app_users')
        .where('id', 'in', createdUserIds)
        .execute()
      await db
        .deleteFrom('app_role_permissions')
        .where('role_id', 'in', createdRoleIds)
        .execute()
      await db
        .deleteFrom('app_roles')
        .where('id', 'in', createdRoleIds)
        .execute()
      await bootstrap.deleteE2EPrincipal(principal)
    } finally {
      await db.destroy()
    }
  })

  await assert.rejects(
    () =>
      db
        .insertInto('dcl_subjects')
        .values({
          id: `X${suffix}`.padEnd(26, '0'),
          entity: 'customer',
          code: 'OPE-0001',
          created_at: new Date(),
          created_by: principal.userId,
        })
        .execute(),
    /dcl_subjects_entity_code_ck/,
  )

  async function postResponse(
    path: string,
    body: unknown,
    authenticated = true,
  ) {
    const response = await fetch(`${origin}${path}`, {
      method: 'POST',
      headers: authenticated
        ? { ...baseHeaders, cookie, 'x-csrf-token': csrf }
        : baseHeaders,
      body: JSON.stringify(body),
    })
    assert.equal(response.status, 200)
    return response
  }

  async function post(path: string, body: unknown, authenticated = true) {
    const response = await postResponse(path, body, authenticated)
    return response.json() as Promise<{
      code: number
      errorKey: string
      data: any
    }>
  }

  const branding = await post('/app/branding/get', {}, false)
  assert.equal(branding.code, 0)
  assert.equal(branding.data.enterpriseName, 'ZERP 演示企业')

  const signin = await fetch(`${origin}/app/user/signin`, {
    method: 'POST',
    headers: baseHeaders,
    body: JSON.stringify({
      username: principal.username,
      password: 'Target!Password363',
    }),
  })
  const signinPayload = (await signin.json()) as {
    code: number
    data: { csrfToken: string }
  }
  assert.equal(signinPayload.code, 0)
  cookie = signin.headers.getSetCookie()[0] ?? ''
  csrf = signinPayload.data.csrfToken

  const parameterPage = await post('/app/system-parameter/query', {
    page: 1,
    pageSize: 20,
    filters: { search: `issue363-${suffix.toLowerCase()}` },
    sort: [{ field: 'parameterKey', order: 'asc' }],
  })
  assert.equal(parameterPage.code, 0)
  assert.equal(parameterPage.data.items.length, 20)
  assert.equal(parameterPage.data.total, 21)

  const menu = await post('/app/menu/get', {})
  assert.equal(menu.code, 0)
  assert.equal(menu.data.mode, 'DEFAULT')
  assert.ok(Array.isArray(menu.data.defaultMenu.items))
  assert.ok(Array.isArray(menu.data.businessMenu.items))
  assert.ok(Array.isArray(menu.data.navigation.items))
  assert.ok(Array.isArray(menu.data.availableRoutes))
  assert.ok(
    menu.data.availableRoutes.some(
      (route: { routeKey: string }) => route.routeKey === 'aux/department',
    ),
  )
  assert.equal(
    menu.data.availableRoutes.some(
      (route: { routeKey: string }) => route.routeKey === 'home/dashboard',
    ),
    false,
  )

  const permissionPage = await post('/app/permission/query', {
    page: 1,
    pageSize: 20,
    filters: { domain: 'aux' },
    sort: [{ field: 'path', order: 'asc' }],
  })
  assert.equal(permissionPage.code, 0)
  assert.ok(permissionPage.data.total > permissionPage.data.items.length)
  const departmentQueryPermission = permissionPage.data.items.find(
    (item: { path: string }) => item.path === '/aux/department/query',
  )
  assert.ok(departmentQueryPermission)

  const role = await post('/app/role/create', {
    name: `Issue 363 role ${suffix}`,
    description: 'target integration role',
    permissionIds: [departmentQueryPermission.id],
  })
  assert.equal(role.code, 0)
  createdRoleIds.push(role.data.id)

  const user = await post('/app/user/create', {
    username: `managed-${suffix.toLowerCase()}`,
    displayName: 'Managed User',
    password: 'Managed!Password363',
    roleIds: [role.data.id],
  })
  assert.equal(user.code, 0)
  createdUserIds.push(user.data.id)
  const staleUser = await post('/app/user/save', {
    id: user.data.id,
    displayName: 'Stale Update',
    roleIds: [role.data.id],
    revision: Number(user.data.revision) + 1,
  })
  assert.equal(staleUser.errorKey, 'user_changed')

  const created = await post('/aux/department/create', {
    data: { name: '研发部', parentId: '', description: 'Issue 363' },
  })
  assert.equal(created.code, 0)
  createdAuxIds.push(created.data.objectId)
  const queried = await post('/aux/department/query', {
    page: 1,
    pageSize: 20,
    filters: { keyword: '研发' },
    sort: [{ field: 'code', order: 'asc' }],
  })
  assert.equal(queried.data.items[0].data.name, '研发部')
  const staleAux = await post('/aux/department/save', {
    objectId: created.data.objectId,
    objectRevision: Number(created.data.objectRevision) + 1,
    data: { name: '研发二部', parentId: '', description: 'Issue 363' },
  })
  assert.equal(staleAux.errorKey, 'conflict')
  await db
    .insertInto('aux_reference_facts')
    .values({
      id: `F${suffix}`.padEnd(26, '0'),
      aux_object_id: created.data.objectId,
      source: 'dcl_employee_versions',
    })
    .execute()
  const blockedDelete = await post('/aux/department/delete', {
    objectId: created.data.objectId,
    objectRevision: Number(created.data.objectRevision),
  })
  assert.equal(blockedDelete.errorKey, 'conflict')
  assert.deepEqual(blockedDelete.data.blockers, [
    { source: 'dcl_employee_versions', count: 1 },
  ])

  const settlementMethod = {
    name: `E2E 月结 ${suffix}`,
    termCode: 'MONTHLY_30',
    ruleType: 'MONTH_END',
    monthOffset: 1,
    dayOfMonth: 0,
    dayOffset: 0,
    defaultSalesSurcharge: '0.00',
    description: '',
  }
  const auxService = new AuxService(db)
  await assert.rejects(
    () =>
      auxService.create('settlement-method', settlementMethod, {
        id: principal.userId,
        permissions: ['/aux/settlement-method/create'],
      }),
    (error) =>
      error instanceof AuxApplicationError &&
      error.errorKey === 'validation_failed',
  )
  await assert.rejects(
    () =>
      auxService.ensureE2ESettlementMethod(settlementMethod, {
        id: principal.userId,
        permissions: [],
      }),
    (error) =>
      error instanceof AuxApplicationError && error.errorKey === 'forbidden',
  )
  const seededSettlementMethod = await auxService.ensureE2ESettlementMethod(
    settlementMethod,
    { id: principal.userId, permissions: [], trusted: true },
  )
  createdAuxIds.push(seededSettlementMethod.objectId)
  const repeatedSettlementMethod = await auxService.ensureE2ESettlementMethod(
    settlementMethod,
    { id: principal.userId, permissions: [], trusted: true },
  )
  assert.equal(
    repeatedSettlementMethod.objectId,
    seededSettlementMethod.objectId,
  )

  const bobQuery = await post('/bob/employee/query', {
    page: 1,
    pageSize: 20,
    filters: { keyword: suffix, enabled: true },
    sort: [{ field: 'code', order: 'asc' }],
  })
  assert.equal(bobQuery.code, 0)
  assert.equal(bobQuery.data.items[0].sourceApprovalEntryId, bobEntryId)
  const bobGet = await post('/bob/employee/get', { objectId: bobId })
  assert.equal(bobGet.data.sourceVersionNo, 3)
  await db
    .updateTable('approval_entries')
    .set({ status: 'PENDING', updated_at: new Date() })
    .where('id', '=', bobEntryId)
    .execute()
  const rolledBackBob = await post('/bob/employee/get', { objectId: bobId })
  assert.equal(rolledBackBob.data.sourceApprovalEntryId, bobPreviousEntryId)
  assert.equal(rolledBackBob.data.sourceVersionNo, 2)
  const customerQueryPermission = await db
    .selectFrom('app_permissions')
    .select('id')
    .where('path', '=', '/bob/customer/query')
    .executeTakeFirstOrThrow()
  await db
    .deleteFrom('app_role_permissions')
    .where('role_id', '=', principal.roleId)
    .where('permission_id', '=', customerQueryPermission.id)
    .execute()
  const subunits = await post('/bob/reference/query', {
    entity: 'customer-subunit',
    keyword: suffix,
  })
  assert.equal(subunits.data[0].objectId, subunitId)

  const signoutResponse = await postResponse('/app/user/signout', {})
  const signout = (await signoutResponse.json()) as { code: number }
  assert.equal(signout.code, 0)
  assert.match(signoutResponse.headers.getSetCookie()[0] ?? '', /Max-Age=0/)
  const afterSignout = await post('/app/menu/get', {})
  assert.equal(afterSignout.errorKey, 'unauthenticated')
})

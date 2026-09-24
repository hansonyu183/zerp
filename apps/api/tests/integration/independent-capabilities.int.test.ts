import { insertArchiveObjects } from '../fixtures/archive-objects.ts'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import test from 'node:test'

import { serve } from '@hono/node-server'
import { modelBuildId } from '@zerp/model'
import { ulid } from 'ulid'
import { createTargetApiClient } from '../../../../packages/api-client/src/index.ts'

import { createApp } from '../../src/app.ts'
import { TargetBootstrapService } from '../../src/app/bootstrap.ts'
import { ManagementService } from '../../src/app/management.ts'
import { hashPassword, SessionService } from '../../src/app/session.ts'
import { AuxApplicationError, AuxService } from '../../src/aux/service.ts'
import { BobService } from '../../src/bob/service.ts'
import { createDatabase } from '../../src/db/database.ts'
import { loadConfig } from '../../src/platform/config.ts'

const databaseUrl = process.env.TARGET_TEST_DATABASE_URL
const customerTypeId = '01J00000000000000000000102'

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
  const customerId = `C${suffix}`.padEnd(26, '0')
  const customerEntryId = `Q${suffix}`.padEnd(26, '0')
  const subunitId = customerId
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
    TARGET_DATABASE_SCOPE: process.env.TARGET_DATABASE_SCOPE,
    APP_SESSION_COOKIE_SECURE: 'false',
  })

  await bootstrap.createE2EPrincipal(principal)
  await db
    .updateTable('app_users')
    .set({ password_change_required: false })
    .where('id', '=', principal.userId)
    .execute()
  const approvedAt = new Date()
  await insertArchiveObjects(db, [
    {
      id: customerId,
      entity: 'customer',
      code: `CUS-${codeSuffix}`,
      created_at: approvedAt,
      created_by: principal.userId,
    },
  ])
  await db
    .insertInto('approval_entries')
    .values([
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
    .insertInto('dcl_customer_versions')
    .values({
      approval_entry_id: customerEntryId,
      display_name: `Target Customer ${suffix}`,
      customer_type_id: customerTypeId,
      customer_type_snapshot: JSON.stringify({
        id: customerTypeId,
        code: 'CUSTOMER-TYPE-TEST',
        name: '测试客户类型',
      }),
      credit_limits: JSON.stringify([]),
      attachments: JSON.stringify([]),
      remittance_profiles: JSON.stringify([]),
      tax_information: JSON.stringify([]),
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
  const sessionClient = createTargetApiClient({
    baseUrl: origin,
    modelBuildId,
    fetch: (input, init) => {
      const headers = new Headers(init?.headers)
      headers.set('connection', 'close')
      if (cookie) headers.set('cookie', cookie)
      return fetch(input, { ...init, headers })
    },
  })

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
        .deleteFrom('approval_entries')
        .where('id', 'in', [customerEntryId])
        .execute()
      await db
        .deleteFrom('dcl_subjects')
        .where('id', 'in', [customerId])
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
        .deleteFrom('aux_objects')
        .where('id', 'in', createdAuxIds)
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

  async function get(path: string, query: Record<string, string> = {}) {
    const response = await fetch(
      `${origin}${path}?${new URLSearchParams({ page: '1', pageSize: '20', enabled: 'true', ...query })}`,
      { headers: { ...baseHeaders, cookie } },
    )
    return response.json() as Promise<{
      code: number
      errorKey: string
      data: any
    }>
  }

  async function post(path: string, body: unknown, authenticated = true) {
    const response = await postResponse(path, body, authenticated)
    return response.json() as Promise<{
      code: number
      errorKey: string
      data: any
    }>
  }

  const branding = await (
    await sessionClient.session.app.get.$post({ json: {} })
  ).json()
  assert.equal(branding.code, 0)
  assert.equal(branding.data.enterpriseName, 'ZERP 演示企业')

  const signin = await sessionClient.session.auth.signin.$post({
    json: { code: principal.username, password: 'Target!Password363' },
  })
  const signinPayload = await signin.json()
  assert.equal(signinPayload.code, 0)
  cookie = signin.headers.getSetCookie()[0] ?? ''
  csrf = signinPayload.data.csrfToken
  assert.match(signinPayload.data.targetId, /^[0-9a-f-]{36}$/)
  const restored = await post('/session/auth/restore', {})
  assert.equal(restored.code, 0)
  assert.equal(restored.data.targetId, signinPayload.data.targetId)

  const parameterPage = await post('/app/system-parameter/query', {
    page: 1,
    pageSize: 20,
    filters: { search: `issue363-${suffix.toLowerCase()}` },
    sort: [{ field: 'parameterKey', order: 'asc' }],
  })
  assert.equal(parameterPage.code, 0)
  assert.equal(parameterPage.data.items.length, 20)
  assert.equal(parameterPage.data.total, 21)

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

  const stableRoleId = ulid()
  const role = await post('/app/role/create', {
    id: stableRoleId,
    name: `Issue 363 role ${suffix}`,
    description: 'target integration role',
    permissionIds: [departmentQueryPermission.id],
  })
  assert.equal(role.code, 0)
  assert.equal(role.data.id, stableRoleId)
  createdRoleIds.push(role.data.id)
  const recoveredRole = await post('/app/role/get', { id: stableRoleId })
  assert.equal(recoveredRole.code, 0)
  assert.deepEqual(
    recoveredRole.data.permissions.map((permission: { id: string }) =>
      permission.id,
    ),
    [departmentQueryPermission.id],
  )
  const repeatedRole = await post('/app/role/create', {
    id: stableRoleId,
    name: `Another role ${suffix}`,
    description: null,
    permissionIds: [departmentQueryPermission.id],
  })
  assert.equal(repeatedRole.errorKey, 'conflict')

  const user = await post('/app/user/create', {
    code: `managed-${suffix.toLowerCase()}`,
    name: 'Managed User',
    password: 'Managed!Password363',
    roleIds: [role.data.id],
  })
  assert.equal(user.code, 0)
  createdUserIds.push(user.data.id)
  const staleUser = await post('/app/user/save', {
    id: user.data.id,
    name: 'Stale Update',
    roleIds: [role.data.id],
    revision: String(BigInt(user.data.revision) + 1n),
  })
  assert.equal(staleUser.errorKey, 'user_changed')

  const stableDepartmentId = ulid()
  const created = await post('/aux/department/create', {
    id: stableDepartmentId,
    name: '研发部',
    parentId: '',
    description: 'Issue 363',
  })
  assert.equal(created.code, 0)
  assert.equal(created.data.id, stableDepartmentId)
  createdAuxIds.push(created.data.id)
  const recovered = await post('/aux/department/get', {
    id: stableDepartmentId,
  })
  assert.equal(recovered.code, 0)
  assert.equal(recovered.data.name, '研发部')
  const repeated = await post('/aux/department/create', {
    id: stableDepartmentId,
    name: '另一部门',
    parentId: '',
    description: '',
  })
  assert.equal(repeated.errorKey, 'conflict')
  const stableEmployeeId = ulid()
  const disabledEmployee = await post('/aux/employee/create', {
    id: stableEmployeeId,
    enabled: false,
    identityKind: 'PERSON',
    legalName: `待承接员工 ${suffix}`,
    displayName: `待承接员工 ${suffix}`,
    legalIdentifier: '',
    contactName: '',
    phone: '',
    address: '',
    employeeCategoryId: null,
    departmentId: null,
    positionId: null,
    employmentDate: '',
    workPhone: '',
    workEmail: '',
    operatingEntityId: null,
    remark: '',
  })
  assert.equal(disabledEmployee.code, 0)
  assert.deepEqual(
    { id: disabledEmployee.data.id, enabled: disabledEmployee.data.enabled },
    { id: stableEmployeeId, enabled: false },
  )
  createdAuxIds.push(stableEmployeeId)
  const recoveredEmployee = await post('/aux/employee/get', {
    id: stableEmployeeId,
  })
  assert.equal(recoveredEmployee.code, 0)
  assert.equal(recoveredEmployee.data.enabled, false)
  assert.equal(recoveredEmployee.data.department, null)
  const linked = await post('/app/user/save', {
    id: user.data.id,
    name: user.data.name,
    employeeId: stableEmployeeId,
    roleIds: [role.data.id],
    revision: user.data.revision,
  })
  assert.equal(linked.code, 0, linked.errorKey)
  assert.equal(linked.data.employeeId, stableEmployeeId)
  const enabledEmployee = await post('/aux/employee/enable', {
    id: stableEmployeeId,
    revision: disabledEmployee.data.revision,
  })
  assert.equal(enabledEmployee.code, 0)
  assert.equal(enabledEmployee.data.enabled, true)
  const disabledAgain = await post('/aux/employee/disable', {
    id: stableEmployeeId,
    revision: enabledEmployee.data.revision,
  })
  assert.equal(disabledAgain.code, 0)
  assert.equal(disabledAgain.data.enabled, false)
  const userAfterEmployeeDisable = await post('/app/user/get', {
    id: user.data.id,
  })
  assert.equal(userAfterEmployeeDisable.data.employeeId, stableEmployeeId)
  const queried = await post('/aux/department/query', {
    keyword: '研发',
    page: 1,
    pageSize: 20,
  })
  assert.equal(queried.data.items[0].name, '研发部')
  const staleAux = await post('/aux/department/save', {
    id: created.data.id,
    revision: String(BigInt(created.data.revision) + 1n),
    name: '研发二部',
    parentId: '',
    description: 'Issue 363',
  })
  assert.equal(staleAux.errorKey, 'conflict')
  await db
    .insertInto('aux_reference_facts')
    .values({
      id: `F${suffix}`.padEnd(26, '0'),
      aux_object_id: created.data.id,
      source: 'test:independent-capabilities:department',
    })
    .execute()
  const blockedDelete = await post('/aux/department/delete', {
    id: created.data.id,
    revision: created.data.revision,
  })
  assert.equal(blockedDelete.errorKey, 'conflict')
  assert.deepEqual(blockedDelete.data.blockers, [
    { source: 'test:independent-capabilities:department', count: 1 },
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
  } as const
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
  createdAuxIds.push(seededSettlementMethod.id)
  const repeatedSettlementMethod = await auxService.ensureE2ESettlementMethod(
    settlementMethod,
    { id: principal.userId, permissions: [], trusted: true },
  )
  assert.equal(repeatedSettlementMethod.id, seededSettlementMethod.id)
  const defaultPaymentMethod = await auxService.create(
    'payment-method',
    {
      name: `默认附加费 ${suffix}`,
      description: '',
    },
    {
      id: principal.userId,
      permissions: ['/aux/payment-method/create'],
    },
  )
  const paymentMethod = await auxService.create(
    'payment-method',
    {
      name: `E2E 银行转账 ${suffix}`,
      defaultSalesSurcharge: '0.05',
      description: '',
    },
    { id: principal.userId, permissions: ['/aux/payment-method/create'] },
  )
  const measurementUnit = await auxService.create(
    'measurement-unit',
    { name: `E2E 千克 ${suffix}`, fixedFactor: null },
    { id: principal.userId, permissions: ['/aux/measurement-unit/create'] },
  )
  const dictionaryType = await auxService.create(
    'dictionary-type',
    { name: `E2E 字典类型 ${suffix}`, description: '' },
    { id: principal.userId, permissions: ['/aux/dictionary-type/create'] },
  )
  const dictionaryItem = await auxService.create(
    'dictionary-item',
    {
      name: `E2E 字典项 ${suffix}`,
      dictionaryTypeId: dictionaryType.id,
      sortOrder: 1,
    },
    { id: principal.userId, permissions: ['/aux/dictionary-item/create'] },
  )
  createdAuxIds.push(
    defaultPaymentMethod.id,
    paymentMethod.id,
    measurementUnit.id,
    dictionaryType.id,
    dictionaryItem.id,
  )
  const settlementReferences = await get('/aux/settlement-method/options', {
    keyword: suffix,
  })
  assert.equal(
    settlementReferences.data.items[0].objectId,
    seededSettlementMethod.id,
  )
  assert.equal(settlementReferences.data.items[0].name, settlementMethod.name)
  assert.equal(settlementReferences.data.items[0].termCode, 'MONTHLY_30')
  assert.equal(settlementReferences.data.items[0].ruleType, 'MONTH_END')
  assert.equal(settlementReferences.data.items[0].monthOffset, 1)
  assert.equal(settlementReferences.data.items[0].dayOfMonth, 0)
  assert.equal(settlementReferences.data.items[0].dayOffset, 0)
  assert.equal(settlementReferences.data.items[0].defaultSalesSurcharge, '0.00')
  const paymentReferences = await get('/aux/payment-method/options', {
    keyword: `E2E 银行转账 ${suffix}`,
  })
  assert.equal(paymentReferences.data.items[0].objectId, paymentMethod.id)
  assert.equal(paymentReferences.data.items[0].name, `E2E 银行转账 ${suffix}`)
  assert.equal(paymentReferences.data.items[0].defaultSalesSurcharge, '0.05')
  const defaultPaymentReferences = await get('/aux/payment-method/options', {
    keyword: `默认附加费 ${suffix}`,
  })
  assert.equal(
    defaultPaymentReferences.data.items[0].objectId,
    defaultPaymentMethod.id,
  )
  assert.equal(
    defaultPaymentReferences.data.items[0].defaultSalesSurcharge,
    '0.00',
  )
  const unitReferences = await get('/aux/measurement-unit/options', {
    keyword: suffix,
  })
  assert.equal(unitReferences.data.items[0].objectId, measurementUnit.id)
  assert.equal(unitReferences.data.items[0].name, `E2E 千克 ${suffix}`)
  assert.equal(unitReferences.data.items[0].fixedFactor, null)
  const dictionaryItemReferences = await get('/aux/dictionary-item/options', {})
  assert.equal(dictionaryItemReferences.code, 0)
  assert.ok(
    dictionaryItemReferences.data.items.some(
      (candidate: { objectId: string; name: string }) =>
        candidate.objectId === dictionaryItem.id &&
        candidate.name === `E2E 字典项 ${suffix}`,
    ),
  )
  await db
    .updateTable('aux_objects')
    .set({
      data: JSON.stringify({
        name: `E2E 银行转账 ${suffix}`,
        description: '',
      }),
    })
    .where('id', '=', paymentMethod.id)
    .execute()
  const malformedPaymentReferences = await get('/aux/payment-method/options', {
    keyword: suffix,
  })
  assert.equal(malformedPaymentReferences.errorKey, 'validation_failed')

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
  const subunits = await get('/bob/customer/options', {
    keyword: suffix,
  })
  assert.equal(subunits.data.items[0].objectId, subunitId)

  const signoutResponse = await sessionClient.session.auth.signout.$post(
    { json: {} },
    { headers: { 'X-CSRF-Token': csrf } },
  )
  const signout = await signoutResponse.json()
  assert.equal(signout.code, 0)
  assert.match(signoutResponse.headers.getSetCookie()[0] ?? '', /Max-Age=0/)
})

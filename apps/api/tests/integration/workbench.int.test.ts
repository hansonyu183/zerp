import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import test from 'node:test'

import { serve } from '@hono/node-server'
import { modelBuildId } from '@zerp/model'
import { ulid } from 'ulid'

import { createApp } from '../../src/app.ts'
import { hashPassword, SessionService } from '../../src/app/session.ts'
import { WorkbenchService } from '../../src/app/workbench.ts'
import { createDatabase } from '../../src/db/database.ts'
import { loadConfig } from '../../src/platform/config.ts'

const databaseUrl = process.env.TARGET_TEST_DATABASE_URL

type HttpSession = { cookie: string; csrfToken: string }

function permissionParts(path: string) {
  const match = path.match(/^\/([^/]+)\/([^/]+)\/([^/]+)$/)
  assert.ok(match, `invalid permission path ${path}`)
  return { domain: match[1]!, entity: match[2]!, action: match[3]! }
}

async function signIn(
  origin: string,
  username: string,
  password: string,
): Promise<HttpSession> {
  const response = await fetch(`${origin}/app/user/signin`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-zerp-model-build': modelBuildId,
      connection: 'close',
    },
    body: JSON.stringify({ username, password }),
  })
  const payload = (await response.json()) as {
    code: number
    data: { csrfToken: string }
  }
  assert.equal(payload.code, 0)
  return {
    cookie: response.headers.getSetCookie()[0] ?? '',
    csrfToken: payload.data.csrfToken,
  }
}

test('real HTTP workbench returns only actionable DCL and VOU submissions', async (context) => {
  assert.ok(databaseUrl, 'TARGET_TEST_DATABASE_URL is required')
  const db = createDatabase(databaseUrl)
  const reviewerId = ulid()
  const submitterId = ulid()
  const roleId = ulid()
  const productId = ulid()
  const productSubmissionId = ulid()
  const vehicleId = ulid()
  const vehicleSubmissionId = ulid()
  const warehouseId = ulid()
  const warehouseSubmissionId = ulid()
  const wflDefinitionId = ulid()
  const wflDefinitionSubmissionId = ulid()
  const documentId = ulid()
  const vouSubmissionId = ulid()
  const approvedDocumentId = ulid()
  const approvedSubmissionId = ulid()
  const username = `workbench-${randomBytes(8).toString('hex')}`
  const password = `Target!${randomBytes(18).toString('base64url')}`
  const codeSuffix = String(randomBytes(2).readUInt16BE() % 10_000).padStart(
    4,
    '0',
  )
  const productCode = `PRD-${codeSuffix}`
  const vehicleCode = `VEH-${codeSuffix}`
  const warehouseCode = `WHS-${codeSuffix}`
  const wflDefinitionCode = `wfl-00${codeSuffix}`
  const permissionPaths = [
    '/dcl/product/query',
    '/dcl/product/get',
    '/dcl/product/approve',
    '/dcl/vehicle/query',
    '/dcl/warehouse/query',
    '/dcl/warehouse/get',
    '/dcl/warehouse/approve',
    '/dcl/wfl-process-definition/query',
    '/dcl/wfl-process-definition/get',
    '/dcl/wfl-process-definition/approve',
    '/vou/sale-pricing/query',
    '/vou/sale-pricing/get',
    '/vou/sale-pricing/submit-change',
    '/vou/sale-pricing/unreject',
  ]
  const permissionIds = new Map<string, string>()
  const createdPermissionIds: string[] = []

  context.after(async () => {
    try {
      await db
        .deleteFrom('approval_entries')
        .where('id', 'in', [
          productSubmissionId,
          vehicleSubmissionId,
          warehouseSubmissionId,
          wflDefinitionSubmissionId,
          vouSubmissionId,
          approvedSubmissionId,
        ])
        .execute()
      await db
        .deleteFrom('vou_documents')
        .where('id', 'in', [documentId, approvedDocumentId])
        .execute()
      await db
        .deleteFrom('dcl_subjects')
        .where('id', 'in', [productId, vehicleId, warehouseId, wflDefinitionId])
        .execute()
      await db
        .deleteFrom('app_sessions')
        .where('user_id', '=', reviewerId)
        .execute()
      await db
        .deleteFrom('app_user_roles')
        .where('user_id', '=', reviewerId)
        .execute()
      await db
        .deleteFrom('app_role_permissions')
        .where('role_id', '=', roleId)
        .execute()
      await db.deleteFrom('app_roles').where('id', '=', roleId).execute()
      if (createdPermissionIds.length > 0)
        await db
          .deleteFrom('app_permissions')
          .where('id', 'in', createdPermissionIds)
          .execute()
      await db
        .deleteFrom('app_users')
        .where('id', 'in', [reviewerId, submitterId])
        .execute()
    } finally {
      await db.destroy()
    }
  })

  const now = new Date('2026-09-05T00:00:00.000Z')
  await db
    .insertInto('app_users')
    .values([
      {
        id: reviewerId,
        username,
        display_name: '工作台审批人',
        password_hash: await hashPassword(password),
        status: 'ENABLED',
        password_changed_at: now,
        password_change_required: false,
      },
      {
        id: submitterId,
        username: `submitter-${randomBytes(8).toString('hex')}`,
        display_name: '工作台提交人',
        password_hash: 'unused',
        status: 'ENABLED',
        password_changed_at: now,
        password_change_required: false,
      },
    ])
    .execute()
  const existingPermissions = await db
    .selectFrom('app_permissions')
    .select(['id', 'path'])
    .where('path', 'in', permissionPaths)
    .execute()
  const existingPermissionIds = new Map(
    existingPermissions.map((permission) => [permission.path, permission.id]),
  )
  const newPermissions = permissionPaths.flatMap((path) => {
    const existing = existingPermissionIds.get(path)
    if (existing) {
      permissionIds.set(path, existing)
      return []
    }
    const id = ulid()
    permissionIds.set(path, id)
    createdPermissionIds.push(id)
    return [
      {
        id,
        path,
        ...permissionParts(path),
        description: path,
        status: 'ENABLED' as const,
        menu_group: null,
        menu_order: null,
      },
    ]
  })
  if (newPermissions.length > 0)
    await db.insertInto('app_permissions').values(newPermissions).execute()
  await db
    .insertInto('app_roles')
    .values({
      id: roleId,
      code: `WB-${roleId.slice(-8)}`,
      name: `工作台角色 ${roleId.slice(-6)}`,
      description: null,
      status: 'ENABLED',
      created_by: reviewerId,
      updated_by: reviewerId,
    })
    .execute()
  await db
    .insertInto('app_role_permissions')
    .values(
      permissionPaths.map((path) => ({
        role_id: roleId,
        permission_id: permissionIds.get(path)!,
        created_by: reviewerId,
      })),
    )
    .execute()
  await db
    .insertInto('app_user_roles')
    .values({ user_id: reviewerId, role_id: roleId, created_by: reviewerId })
    .execute()
  await db
    .insertInto('dcl_subjects')
    .values([
      {
        id: productId,
        entity: 'product',
        code: productCode,
        created_at: now,
        created_by: submitterId,
      },
      {
        id: vehicleId,
        entity: 'vehicle',
        code: vehicleCode,
        created_at: now,
        created_by: submitterId,
      },
      {
        id: warehouseId,
        entity: 'warehouse',
        code: warehouseCode,
        created_at: now,
        created_by: submitterId,
      },
      {
        id: wflDefinitionId,
        entity: 'wfl-process-definition',
        code: wflDefinitionCode,
        created_at: now,
        created_by: submitterId,
      },
    ])
    .execute()
  await db
    .insertInto('approval_entries')
    .values([
      {
        id: productSubmissionId,
        domain: 'dcl',
        entity: 'product',
        subject_id: productId,
        version_no: 1,
        status: 'PENDING',
        revision: 1,
        submitted_by: submitterId,
        submitted_at: now,
        approved_by: null,
        approved_at: null,
        rejected_by: null,
        rejected_at: null,
        rejection_reason: null,
        updated_by: submitterId,
        updated_at: new Date('2026-09-05T02:00:00.000Z'),
      },
      {
        id: vehicleSubmissionId,
        domain: 'dcl',
        entity: 'vehicle',
        subject_id: vehicleId,
        version_no: 1,
        status: 'PENDING',
        revision: 1,
        submitted_by: submitterId,
        submitted_at: now,
        approved_by: null,
        approved_at: null,
        rejected_by: null,
        rejected_at: null,
        rejection_reason: null,
        updated_by: submitterId,
        updated_at: new Date('2026-09-05T03:00:00.000Z'),
      },
      {
        id: warehouseSubmissionId,
        domain: 'dcl',
        entity: 'warehouse',
        subject_id: warehouseId,
        version_no: 1,
        status: 'PENDING',
        revision: 1,
        submitted_by: submitterId,
        submitted_at: now,
        approved_by: null,
        approved_at: null,
        rejected_by: null,
        rejected_at: null,
        rejection_reason: null,
        updated_by: submitterId,
        updated_at: new Date('2026-09-05T05:00:00.000Z'),
      },
      {
        id: wflDefinitionSubmissionId,
        domain: 'dcl',
        entity: 'wfl-process-definition',
        subject_id: wflDefinitionId,
        version_no: 1,
        status: 'PENDING',
        revision: 1,
        submitted_by: submitterId,
        submitted_at: now,
        approved_by: null,
        approved_at: null,
        rejected_by: null,
        rejected_at: null,
        rejection_reason: null,
        updated_by: submitterId,
        updated_at: new Date('2026-09-05T04:00:00.000Z'),
      },
      {
        id: vouSubmissionId,
        domain: 'vou',
        entity: 'sale-pricing',
        subject_id: documentId,
        version_no: null,
        status: 'REJECTED',
        revision: 2,
        submitted_by: submitterId,
        submitted_at: now,
        approved_by: null,
        approved_at: null,
        rejected_by: reviewerId,
        rejected_at: new Date('2026-09-05T01:00:00.000Z'),
        rejection_reason: '需要补充定价依据',
        updated_by: reviewerId,
        updated_at: new Date('2026-09-05T01:00:00.000Z'),
      },
      {
        id: approvedSubmissionId,
        domain: 'vou',
        entity: 'sale-pricing',
        subject_id: approvedDocumentId,
        version_no: null,
        status: 'APPROVED',
        revision: 2,
        submitted_by: submitterId,
        submitted_at: now,
        approved_by: reviewerId,
        approved_at: now,
        rejected_by: null,
        rejected_at: null,
        rejection_reason: null,
        updated_by: reviewerId,
        updated_at: new Date('2026-09-05T04:00:00.000Z'),
      },
    ])
    .execute()
  await db
    .insertInto('dcl_product_versions')
    .values({
      approval_entry_id: productSubmissionId,
      name: '工作台产品',
      source_snapshots: {},
      unit_conversions: JSON.stringify([]),
      recyclable: false,
      enabled: true,
    })
    .execute()
  await db
    .insertInto('dcl_vehicle_versions')
    .values({
      approval_entry_id: vehicleSubmissionId,
      name: '不应出现的车辆',
      bulk_liquid_capable: false,
      enabled: true,
    })
    .execute()
  await db
    .insertInto('dcl_warehouse_versions')
    .values({
      approval_entry_id: warehouseSubmissionId,
      name: '工作台仓库',
      enabled: true,
    })
    .execute()
  await db
    .insertInto('wfl_definition_versions')
    .values({
      approval_entry_id: wflDefinitionSubmissionId,
      script:
        'root = node(key="root", name="工作台流程", entity="sale-pricing")\nworkflow(code="workbench-flow", name="工作台流程", root=root, edges=[])',
      compiled_graph: JSON.stringify({
        code: 'workbench-flow',
        name: '工作台流程',
        rootKey: 'root',
        nodes: [],
        edges: [],
      }),
    })
    .execute()
  await db
    .insertInto('vou_documents')
    .values([
      {
        id: documentId,
        entity: 'sale-pricing',
        document_no: 'SPR-WORKBENCH',
        stable_revision: 1,
        created_at: now,
        created_by: submitterId,
      },
      {
        id: approvedDocumentId,
        entity: 'sale-pricing',
        document_no: 'SPR-APPROVED',
        stable_revision: 1,
        created_at: now,
        created_by: submitterId,
      },
    ])
    .execute()
  await db
    .insertInto('vou_reference_snapshots')
    .values({
      approval_entry_id: vouSubmissionId,
      field: 'customer',
      line_no: 0,
      item_no: 0,
      object_id: productId,
      approval_reference_id: null,
      selection_origin: null,
      reference_entity: 'customer',
      reference_code: 'CUS-WORKBENCH',
      reference_name: '工作台客户',
    })
    .execute()

  const submitterPage = await new WorkbenchService(db).query(
    {
      page: 1,
      pageSize: 20,
      filters: { kind: 'ARCHIVE', entity: 'warehouse' },
    },
    {
      id: submitterId,
      permissions: [
        '/dcl/warehouse/query',
        '/dcl/warehouse/get',
        '/dcl/warehouse/delete',
      ],
    },
  )
  assert.equal(submitterPage.total, 1)
  assert.deepEqual(submitterPage.items[0]?.availableActions, ['view', 'delete'])

  const config = loadConfig({
    DATABASE_URL: databaseUrl,
    APP_SESSION_COOKIE_SECURE: 'false',
  })
  const app = createApp({
    session: new SessionService(db, config),
    workbench: new WorkbenchService(db),
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
  context.after(
    async () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  )
  await started
  const address = server.address()
  assert.ok(address && typeof address !== 'string')
  const origin = `http://127.0.0.1:${address.port}`
  const session = await signIn(origin, username, password)

  const response = await fetch(`${origin}/app/workbench/query`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-zerp-model-build': modelBuildId,
      'x-csrf-token': session.csrfToken,
      cookie: session.cookie,
      connection: 'close',
    },
    body: JSON.stringify({ page: 1, pageSize: 20 }),
  })
  assert.equal(response.status, 200)
  const payload = (await response.json()) as {
    code: number
    data: {
      items: Array<Record<string, unknown>>
      total: number
      page: number
      pageSize: number
    }
  }
  assert.equal(payload.code, 0, JSON.stringify(payload))
  assert.equal(payload.data.total, 4)
  assert.deepEqual(payload.data.items, [
    {
      domain: 'dcl',
      entity: 'warehouse',
      subjectOrDocumentId: warehouseId,
      submissionId: warehouseSubmissionId,
      code: warehouseCode,
      name: '工作台仓库',
      status: 'PENDING',
      revision: '1',
      availableActions: ['view', 'approve'],
      updatedAt: '2026-09-05T05:00:00.000Z',
    },
    {
      domain: 'dcl',
      entity: 'wfl-process-definition',
      subjectOrDocumentId: wflDefinitionId,
      submissionId: wflDefinitionSubmissionId,
      code: wflDefinitionCode,
      name: '工作台流程',
      status: 'PENDING',
      revision: '1',
      availableActions: ['view', 'approve'],
      updatedAt: '2026-09-05T04:00:00.000Z',
    },
    {
      domain: 'dcl',
      entity: 'product',
      subjectOrDocumentId: productId,
      submissionId: productSubmissionId,
      code: productCode,
      name: '工作台产品',
      status: 'PENDING',
      revision: '1',
      availableActions: ['view', 'approve'],
      updatedAt: '2026-09-05T02:00:00.000Z',
    },
    {
      domain: 'vou',
      entity: 'sale-pricing',
      subjectOrDocumentId: documentId,
      submissionId: vouSubmissionId,
      code: 'SPR-WORKBENCH',
      name: '工作台客户',
      status: 'REJECTED',
      revision: '2',
      availableActions: ['view', 'unreject'],
      updatedAt: '2026-09-05T01:00:00.000Z',
    },
  ])

  const filtered = await fetch(`${origin}/app/workbench/query`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-zerp-model-build': modelBuildId,
      'x-csrf-token': session.csrfToken,
      cookie: session.cookie,
      connection: 'close',
    },
    body: JSON.stringify({
      page: 1,
      pageSize: 20,
      filters: {
        kind: 'DOCUMENT',
        entity: 'sale-pricing',
        status: 'REJECTED',
        keyword: '工作台客户',
      },
    }),
  })
  const filteredPayload = (await filtered.json()) as {
    code: number
    data: { items: Array<{ submissionId: string }>; total: number }
  }
  assert.equal(filteredPayload.code, 0, JSON.stringify(filteredPayload))
  assert.equal(filteredPayload.data.total, 1)
  assert.deepEqual(
    filteredPayload.data.items.map((item) => item.submissionId),
    [vouSubmissionId],
  )
})

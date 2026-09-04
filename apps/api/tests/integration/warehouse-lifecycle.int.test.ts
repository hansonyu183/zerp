import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import test from 'node:test'

import { serve } from '@hono/node-server'
import { argon2idAsync } from '@noble/hashes/argon2.js'
import { modelBuildId } from '@zerp/model'
import { ulid } from 'ulid'

import { createApp } from '../../src/app.ts'
import { SessionService } from '../../src/app/session.ts'
import { createDatabase } from '../../src/db/database.ts'
import { WarehouseService } from '../../src/dcl/warehouse.ts'
import { loadConfig } from '../../src/platform/config.ts'

const databaseUrl = process.env.TARGET_TEST_DATABASE_URL

interface SignedIn {
  cookie: string
  csrfToken: string
}

async function passwordHash(password: string): Promise<string> {
  const salt = randomBytes(16)
  const hash = Buffer.from(
    await argon2idAsync(password, salt, {
      m: 64 * 1024,
      t: 3,
      p: 2,
      dkLen: 32,
    }),
  ).toString('base64url')
  return `$argon2id$v=19$m=65536,t=3,p=2$${salt.toString('base64url')}$${hash}`
}

test('Warehouse runs local-Draft submission and the complete target lifecycle through real HTTP and PostgreSQL', async (context) => {
  assert.ok(databaseUrl, 'TARGET_TEST_DATABASE_URL is required')
  const db = createDatabase(databaseUrl)
  const submitterId = ulid()
  const reviewerId = ulid()
  const submitterRoleId = ulid()
  const reviewerRoleId = ulid()
  const managerEmployeeId = ulid()
  const managerApprovalEntryId = ulid()
  const submitterUsername = `warehouse-submitter-${randomBytes(5).toString('hex')}`
  const reviewerUsername = `warehouse-reviewer-${randomBytes(5).toString('hex')}`
  const submitterPassword = randomBytes(18).toString('base64url')
  const reviewerPassword = randomBytes(18).toString('base64url')

  context.after(async () => {
    try {
      await db.deleteFrom('dcl_warehouse_reference_facts').execute()
      await db.deleteFrom('dcl_warehouse_usage_facts').execute()
      await db
        .deleteFrom('dcl_warehouse_manager_reference_facts')
        .where('employee_id', '=', managerEmployeeId)
        .execute()
      await db.deleteFrom('dcl_warehouse_idempotency').execute()
      await db
        .deleteFrom('approval_events')
        .where('actor_id', 'in', [submitterId, reviewerId])
        .execute()
      await db
        .deleteFrom('approval_entries')
        .where('submitted_by', 'in', [submitterId, reviewerId])
        .execute()
      await db
        .deleteFrom('dcl_subjects')
        .where('created_by', '=', submitterId)
        .execute()
      await db
        .deleteFrom('app_sessions')
        .where('user_id', 'in', [submitterId, reviewerId])
        .execute()
      await db
        .deleteFrom('app_user_roles')
        .where('user_id', 'in', [submitterId, reviewerId])
        .execute()
      await db
        .deleteFrom('app_role_permissions')
        .where('role_id', 'in', [submitterRoleId, reviewerRoleId])
        .execute()
      await db
        .deleteFrom('app_roles')
        .where('id', 'in', [submitterRoleId, reviewerRoleId])
        .execute()
      await db
        .deleteFrom('app_users')
        .where('id', 'in', [submitterId, reviewerId])
        .execute()
    } finally {
      await db.destroy()
    }
  })

  await db
    .insertInto('app_users')
    .values([
      {
        id: submitterId,
        username: submitterUsername,
        display_name: 'Warehouse Submitter',
        password_hash: await passwordHash(submitterPassword),
        status: 'ENABLED',
        password_changed_at: new Date(),
        password_change_required: false,
      },
      {
        id: reviewerId,
        username: reviewerUsername,
        display_name: 'Warehouse Reviewer',
        password_hash: await passwordHash(reviewerPassword),
        status: 'ENABLED',
        password_changed_at: new Date(),
        password_change_required: false,
      },
    ])
    .execute()
  await db
    .insertInto('app_roles')
    .values([
      {
        id: submitterRoleId,
        code: submitterUsername,
        name: 'Warehouse Submitter',
        status: 'ENABLED',
      },
      {
        id: reviewerRoleId,
        code: reviewerUsername,
        name: 'Warehouse Reviewer',
        status: 'ENABLED',
      },
    ])
    .execute()
  const allWarehousePermissions = await db
    .selectFrom('app_permissions')
    .select(['id', 'path'])
    .where((builder) =>
      builder.or([
        builder('path', 'like', '/dcl/warehouse/%'),
        builder('path', '=', '/bob/warehouse/reference'),
      ]),
    )
    .execute()
  await db
    .insertInto('app_role_permissions')
    .values(
      [submitterRoleId, reviewerRoleId].flatMap((roleId) =>
        allWarehousePermissions.map((permission) => ({
          role_id: roleId,
          permission_id: permission.id,
        })),
      ),
    )
    .execute()
  await db
    .insertInto('app_user_roles')
    .values([
      { user_id: submitterId, role_id: submitterRoleId },
      { user_id: reviewerId, role_id: reviewerRoleId },
    ])
    .execute()

  const config = loadConfig({
    DATABASE_URL: databaseUrl,
    APP_SESSION_COOKIE_SECURE: 'false',
  })
  const app = createApp({
    database: { ping: async () => undefined },
    session: new SessionService(db, config),
    warehouse: new WarehouseService(db),
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
  context.after(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()))
    })
  })
  await started
  const address = server.address()
  assert.ok(address && typeof address !== 'string')
  const origin = `http://127.0.0.1:${address.port}`

  async function signIn(username: string, password: string): Promise<SignedIn> {
    const response = await fetch(origin + '/app/user/signin', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-zerp-model-build': modelBuildId,
        connection: 'close',
      },
      body: JSON.stringify({ username, password }),
    })
    const payload = await response.json()
    assert.equal(payload.code, 0)
    return {
      cookie: response.headers.getSetCookie()[0]!,
      csrfToken: payload.data.csrfToken,
    }
  }

  async function post(
    path: string,
    body: Record<string, unknown>,
    session: SignedIn,
  ) {
    const response = await fetch(origin + path, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-zerp-model-build': modelBuildId,
        'x-csrf-token': session.csrfToken,
        cookie: session.cookie,
        connection: 'close',
      },
      body: JSON.stringify(body),
    })
    assert.equal(response.status, 200)
    return response.json()
  }

  const submitter = await signIn(submitterUsername, submitterPassword)
  const reviewer = await signIn(reviewerUsername, reviewerPassword)
  const subjectId = ulid()
  const submissionId = ulid()
  const input = {
    subjectId,
    submissionId,
    idempotencyKey: `  ${submissionId}  `,
    expectedLatestApprovedSubmissionId: null,
    expectedLatestApprovedRevision: null,
    snapshot: {
      name: '  一号仓  ',
      address: null,
      contactName: null,
      contactPhone: null,
      managerEmployeeId,
      managerEmployeeApprovalEntryId: managerApprovalEntryId,
      managerEmployeeCode: 'FORGED-CODE',
      managerEmployeeName: '伪造负责人',
      remark: null,
      enabled: true,
    },
  }

  const malicious = await post(
    '/dcl/warehouse/submit-new',
    { ...input, clientDecision: { versionNo: 99, status: 'APPROVED' } },
    submitter,
  )
  assert.equal(malicious.errorKey, 'validation_failed')

  const partialManager = await post(
    '/dcl/warehouse/submit-new',
    {
      ...input,
      subjectId: ulid(),
      submissionId: ulid(),
      idempotencyKey: ulid(),
      snapshot: {
        ...input.snapshot,
        managerEmployeeApprovalEntryId: null,
        managerEmployeeCode: null,
        managerEmployeeName: null,
      },
    },
    submitter,
  )
  assert.equal(partialManager.errorKey, 'validation_failed')

  await db
    .insertInto('dcl_warehouse_manager_reference_facts')
    .values({
      employee_id: managerEmployeeId,
      latest_approved_entry_id: managerApprovalEntryId,
      code: 'EMP-0001',
      name: '权威负责人',
      enabled: true,
    })
    .execute()

  const submitNewPermission = allWarehousePermissions.find(
    (permission) => permission.path === '/dcl/warehouse/submit-new',
  )
  assert.ok(submitNewPermission)
  await db
    .deleteFrom('app_role_permissions')
    .where('role_id', '=', submitterRoleId)
    .execute()
  await db
    .insertInto('app_role_permissions')
    .values({
      role_id: submitterRoleId,
      permission_id: submitNewPermission.id,
    })
    .execute()
  const managerFactWithSubmitPermission = await post(
    '/dcl/warehouse/manager-reference',
    { employeeId: managerEmployeeId, action: 'submit-new' },
    submitter,
  )
  assert.equal(managerFactWithSubmitPermission.code, 0)
  assert.equal(
    managerFactWithSubmitPermission.data.latestApprovedEntryId,
    managerApprovalEntryId,
  )
  const wrongSubmitPermission = await post(
    '/dcl/warehouse/manager-reference',
    { employeeId: managerEmployeeId, action: 'submit-change' },
    submitter,
  )
  assert.equal(wrongSubmitPermission.errorKey, 'forbidden')
  await db
    .deleteFrom('app_role_permissions')
    .where('role_id', '=', submitterRoleId)
    .execute()
  await db
    .insertInto('app_role_permissions')
    .values(
      allWarehousePermissions.map((permission) => ({
        role_id: submitterRoleId,
        permission_id: permission.id,
      })),
    )
    .execute()

  const submitted = await post('/dcl/warehouse/submit-new', input, submitter)
  assert.equal(submitted.code, 0)
  assert.equal(submitted.data.status, 'PENDING')
  assert.equal(submitted.data.versionNo, 1)
  assert.equal(submitted.data.snapshot.name, '一号仓')
  assert.equal(submitted.data.snapshot.managerEmployeeCode, 'EMP-0001')
  assert.equal(submitted.data.snapshot.managerEmployeeName, '权威负责人')
  assert.equal(
    await db
      .selectFrom('dcl_subjects')
      .select((builder) => builder.fn.countAll<string>().as('count'))
      .where('id', '=', subjectId)
      .executeTakeFirstOrThrow()
      .then((row) => Number(row.count)),
    1,
  )
  assert.equal(
    await db
      .selectFrom('approval_events')
      .select((builder) => builder.fn.countAll<string>().as('count'))
      .where('entry_id', '=', submissionId)
      .executeTakeFirstOrThrow()
      .then((row) => Number(row.count)),
    1,
  )

  const retried = await post(
    '/dcl/warehouse/submit-new',
    {
      ...input,
      idempotencyKey: submissionId,
      snapshot: {
        ...input.snapshot,
        name: '一号仓',
        managerEmployeeCode: 'EMP-0001',
        managerEmployeeName: '权威负责人',
      },
    },
    submitter,
  )
  assert.deepEqual(retried.data, submitted.data)
  const conflictingRetry = await post(
    '/dcl/warehouse/submit-new',
    { ...input, snapshot: { ...input.snapshot, name: '不同仓库' } },
    submitter,
  )
  assert.equal(conflictingRetry.errorKey, 'warehouse_idempotency_conflict')

  const approvePermission = allWarehousePermissions.find(
    (permission) => permission.path === '/dcl/warehouse/approve',
  )
  assert.ok(approvePermission)
  await db
    .deleteFrom('app_role_permissions')
    .where('role_id', '=', reviewerRoleId)
    .where('permission_id', '=', approvePermission.id)
    .execute()
  const forbidden = await post(
    '/dcl/warehouse/approve',
    { subjectId, submissionId, expectedRevision: '1' },
    reviewer,
  )
  assert.equal(forbidden.errorKey, 'forbidden')
  await db
    .insertInto('app_role_permissions')
    .values({
      role_id: reviewerRoleId,
      permission_id: approvePermission.id,
    })
    .execute()

  const selfApproved = await post(
    '/dcl/warehouse/approve',
    {
      subjectId,
      submissionId,
      expectedRevision: '1',
    },
    submitter,
  )
  assert.equal(selfApproved.errorKey, 'approval_self_review_forbidden')

  const missingReason = await post(
    '/dcl/warehouse/reject',
    {
      subjectId,
      submissionId,
      expectedRevision: '1',
      reason: '   ',
    },
    reviewer,
  )
  assert.equal(missingReason.errorKey, 'approval_reason_required')

  const rejected = await post(
    '/dcl/warehouse/reject',
    {
      subjectId,
      submissionId,
      expectedRevision: '1',
      reason: '  地址待确认  ',
    },
    reviewer,
  )
  assert.equal(rejected.data.status, 'REJECTED')
  assert.equal(rejected.data.revision, '2')
  assert.equal(rejected.data.rejectionReason, '地址待确认')
  const rejectedQuery = await post('/dcl/warehouse/query', {}, reviewer)
  assert.ok(
    rejectedQuery.data.items.some(
      (item: { submissionId: string; status: string }) =>
        item.submissionId === submissionId && item.status === 'REJECTED',
    ),
  )

  const stale = await post(
    '/dcl/warehouse/unreject',
    { subjectId, submissionId, expectedRevision: '1' },
    reviewer,
  )
  assert.equal(stale.errorKey, 'approval_stale_revision')
  const pending = await post(
    '/dcl/warehouse/unreject',
    { subjectId, submissionId, expectedRevision: '2' },
    reviewer,
  )
  assert.equal(pending.data.status, 'PENDING')
  assert.equal(pending.data.revision, '3')
  const approvedV1 = await post(
    '/dcl/warehouse/approve',
    { subjectId, submissionId, expectedRevision: '3' },
    reviewer,
  )
  assert.equal(approvedV1.data.status, 'APPROVED')
  assert.equal(approvedV1.data.revision, '4')

  const referenceV1 = await post(
    '/bob/warehouse/reference',
    { search: '一号' },
    reviewer,
  )
  assert.deepEqual(
    referenceV1.data.map(
      (item: { approvalEntryId: string }) => item.approvalEntryId,
    ),
    [submissionId],
  )

  const v2Id = ulid()
  const v2Input = {
    ...input,
    submissionId: v2Id,
    idempotencyKey: v2Id,
    expectedLatestApprovedSubmissionId: submissionId,
    expectedLatestApprovedRevision: '4',
    snapshot: { ...input.snapshot, name: '二号仓' },
  }
  const v2 = await post('/dcl/warehouse/submit-change', v2Input, submitter)
  assert.equal(v2.data.versionNo, 2)
  const openBlocked = await post(
    '/dcl/warehouse/unapprove',
    {
      subjectId,
      submissionId,
      expectedRevision: '4',
      reason: '回落',
    },
    reviewer,
  )
  assert.equal(openBlocked.errorKey, 'approval_open_version_exists')

  const deletedV2 = await post(
    '/dcl/warehouse/delete',
    { subjectId, submissionId: v2Id, expectedRevision: '1' },
    submitter,
  )
  assert.deepEqual(deletedV2.data, { submissionId: v2Id, deleted: true })
  const replacementV2Id = ulid()
  const replacement = await post(
    '/dcl/warehouse/submit-change',
    {
      ...v2Input,
      submissionId: replacementV2Id,
      idempotencyKey: replacementV2Id,
    },
    submitter,
  )
  assert.equal(replacement.data.versionNo, 2)
  const approvedV2 = await post(
    '/dcl/warehouse/approve',
    {
      subjectId,
      submissionId: replacementV2Id,
      expectedRevision: '1',
    },
    reviewer,
  )
  assert.equal(approvedV2.data.status, 'APPROVED')

  await db
    .insertInto('dcl_warehouse_reference_facts')
    .values({
      id: ulid(),
      warehouse_id: subjectId,
      approval_entry_id: replacementV2Id,
      domain: 'vou',
      entity: 'sale-order',
      business_id: ulid(),
      business_code: 'SO-0001',
    })
    .execute()
  const referenced = await post(
    '/dcl/warehouse/unapprove',
    {
      subjectId,
      submissionId: replacementV2Id,
      expectedRevision: '2',
      reason: '引用阻断',
    },
    reviewer,
  )
  assert.equal(referenced.errorKey, 'warehouse_unapprove_blocked')
  assert.equal(referenced.data.references[0].businessCode, 'SO-0001')
  await db
    .deleteFrom('dcl_warehouse_reference_facts')
    .where('approval_entry_id', '=', replacementV2Id)
    .execute()
  const unapprovedV2 = await post(
    '/dcl/warehouse/unapprove',
    {
      subjectId,
      submissionId: replacementV2Id,
      expectedRevision: '2',
      reason: '回落 V1',
    },
    reviewer,
  )
  assert.equal(unapprovedV2.data.status, 'PENDING')
  const referenceFallback = await post(
    '/bob/warehouse/reference',
    { search: '一号' },
    reviewer,
  )
  assert.deepEqual(
    referenceFallback.data.map(
      (item: { approvalEntryId: string }) => item.approvalEntryId,
    ),
    [submissionId],
  )
  await post(
    '/dcl/warehouse/delete',
    {
      subjectId,
      submissionId: replacementV2Id,
      expectedRevision: '3',
    },
    submitter,
  )
  const concurrentInputs = [ulid(), ulid()].map((candidateId) => ({
    ...v2Input,
    submissionId: candidateId,
    idempotencyKey: candidateId,
    snapshot: { ...v2Input.snapshot, enabled: false },
  }))
  const concurrent = await Promise.all(
    concurrentInputs.map((candidate) =>
      post('/dcl/warehouse/submit-change', candidate, submitter),
    ),
  )
  assert.deepEqual(concurrent.map((payload) => payload.code === 0).sort(), [
    false,
    true,
  ])
  assert.ok(
    concurrent.some(
      (payload) => payload.errorKey === 'approval_open_version_exists',
    ),
  )
  assert.equal(
    await db
      .selectFrom('approval_entries')
      .select((builder) => builder.fn.countAll<string>().as('count'))
      .where('subject_id', '=', subjectId)
      .where('status', 'in', ['PENDING', 'REJECTED'])
      .executeTakeFirstOrThrow()
      .then((row) => Number(row.count)),
    1,
  )
  const disabledCandidate = concurrent.find((payload) => payload.code === 0)
  assert.ok(disabledCandidate)
  const zeroUsageId = ulid()
  await db
    .insertInto('dcl_warehouse_usage_facts')
    .values({
      id: zeroUsageId,
      warehouse_id: subjectId,
      kind: 'INVENTORY',
      entity: 'inventory-balance',
      business_id: ulid(),
      business_code: 'INV-ZERO',
      quantity_micros: '0',
      created_at: new Date(),
    })
    .execute()
  const zeroInventoryApproved = await post(
    '/dcl/warehouse/approve',
    {
      subjectId,
      submissionId: disabledCandidate.data.submissionId,
      expectedRevision: disabledCandidate.data.revision,
    },
    reviewer,
  )
  assert.equal(zeroInventoryApproved.data.status, 'APPROVED')
  const zeroInventoryUnapproved = await post(
    '/dcl/warehouse/unapprove',
    {
      subjectId,
      submissionId: disabledCandidate.data.submissionId,
      expectedRevision: zeroInventoryApproved.data.revision,
      reason: '验证零库存不阻塞停用',
    },
    reviewer,
  )
  assert.equal(zeroInventoryUnapproved.data.status, 'PENDING')
  await db
    .deleteFrom('dcl_warehouse_usage_facts')
    .where('id', '=', zeroUsageId)
    .execute()
  await db
    .insertInto('dcl_warehouse_usage_facts')
    .values({
      id: ulid(),
      warehouse_id: subjectId,
      kind: 'INVENTORY',
      entity: 'inventory-balance',
      business_id: ulid(),
      business_code: 'INV-0001',
      quantity_micros: '1250000',
      created_at: new Date(),
    })
    .execute()
  const disableBlocked = await post(
    '/dcl/warehouse/approve',
    {
      subjectId,
      submissionId: disabledCandidate.data.submissionId,
      expectedRevision: zeroInventoryUnapproved.data.revision,
    },
    reviewer,
  )
  assert.equal(disableBlocked.errorKey, 'warehouse_disable_blocked')
  assert.deepEqual(disableBlocked.data.inventory, [
    {
      entity: 'inventory-balance',
      businessId: disableBlocked.data.inventory[0].businessId,
      businessCode: 'INV-0001',
      quantityMicros: '1250000',
    },
  ])
  await db
    .deleteFrom('dcl_warehouse_usage_facts')
    .where('warehouse_id', '=', subjectId)
    .execute()
  const disabledApproved = await post(
    '/dcl/warehouse/approve',
    {
      subjectId,
      submissionId: disabledCandidate.data.submissionId,
      expectedRevision: zeroInventoryUnapproved.data.revision,
    },
    reviewer,
  )
  assert.equal(disabledApproved.data.status, 'APPROVED')
  const events = await post(
    '/dcl/warehouse/audit-history',
    { subjectId },
    reviewer,
  )
  assert.ok(
    events.data.some((event: { action: string }) => event.action === 'DELETED'),
  )
  assert.ok(
    events.data.some(
      (event: { action: string }) => event.action === 'UNAPPROVED',
    ),
  )
})

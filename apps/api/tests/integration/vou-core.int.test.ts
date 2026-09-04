import assert from 'node:assert/strict'
import { createHash, randomBytes } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { serve } from '@hono/node-server'
import { modelBuildId } from '@zerp/model'
import { sql } from 'kysely'
import { ulid } from 'ulid'

import { createApp } from '../../src/app.ts'
import { hashPassword, SessionService } from '../../src/app/session.ts'
import { createDatabase } from '../../src/db/database.ts'
import { loadConfig } from '../../src/platform/config.ts'
import { AttachmentStore } from '../../src/platform/attachment-store.ts'
import {
  readVouPersistence,
  VouApplicationError,
  VouService,
} from '../../src/vou/service.ts'

const databaseUrl = process.env.TARGET_TEST_DATABASE_URL

type HttpSession = { cookie: string; csrfToken: string }

function permissionParts(path: string) {
  const match = path.match(/^\/([^/]+)\/([^/]+)\/([^/]+)$/)
  assert.ok(match, `invalid permission path ${path}`)
  return { domain: match[1]!, entity: match[2]!, action: match[3]! }
}

async function signin(
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
  assert.equal(response.status, 200)
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

async function post(origin: string, session: HttpSession, body: unknown) {
  const response = await fetch(`${origin}/vou/reference/query`, {
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
  return response.json() as Promise<{
    code: number
    errorKey: string
    data: {
      items: Array<{
        objectId: string
        approvalEntryId?: string
        code: string
        name: string
      }>
    }
  }>
}

test('VOU persists typed price snapshots and rolls back a failed submission', async (context) => {
  assert.ok(databaseUrl, 'TARGET_TEST_DATABASE_URL is required')
  const db = createDatabase(databaseUrl)
  const service = new VouService(db, {
    acc: { async apply() {} },
    wfl: { async apply() {} },
  })
  const actorId = ulid()
  const reviewerId = ulid()
  const actor = { id: actorId, permissions: [] as string[], trusted: true }
  const reviewer = {
    id: reviewerId,
    permissions: [] as string[],
    trusted: true,
  }
  const documentId = ulid()
  const submissionId = ulid()
  const productId = ulid()
  const productApprovalId = ulid()
  const supplierId = ulid()
  const supplierApprovalId = ulid()
  const customerId = ulid()
  const customerApprovalId = ulid()
  const customerSubunitId = ulid()
  const employeeId = ulid()
  const employeeApprovalId = ulid()
  const productCode = `PRD-${Math.floor(Math.random() * 10_000)
    .toString()
    .padStart(4, '0')}`

  context.after(async () => {
    await sql`DELETE FROM approval_events WHERE entry_id = ${submissionId} OR actor_id IN (${actorId}, ${reviewerId})`.execute(
      db,
    )
    await sql`DELETE FROM approval_entries WHERE domain = 'vou' AND submitted_by = ${actorId}`.execute(
      db,
    )
    await sql`DELETE FROM vou_documents WHERE created_by = ${actorId}`.execute(
      db,
    )
    await sql`DELETE FROM approval_entries WHERE id IN (${productApprovalId}, ${supplierApprovalId}, ${customerApprovalId}, ${employeeApprovalId})`.execute(
      db,
    )
    await sql`DELETE FROM dcl_subjects WHERE id IN (${productId}, ${supplierId}, ${customerId}, ${employeeId})`.execute(
      db,
    )
    await sql`DELETE FROM app_users WHERE id IN (${actorId}, ${reviewerId})`.execute(
      db,
    )
    await db.destroy()
  })
  await db
    .insertInto('app_users')
    .values([
      {
        id: actorId,
        username: `vou-${actorId}`,
        display_name: 'VOU test actor',
        password_hash: 'unused',
        status: 'ENABLED' as const,
        password_changed_at: new Date(),
        password_change_required: false,
      },
      {
        id: reviewerId,
        username: `vou-${reviewerId}`,
        display_name: 'VOU test reviewer',
        password_hash: 'unused',
        status: 'ENABLED' as const,
        password_changed_at: new Date(),
        password_change_required: false,
      },
    ])
    .execute()
  const now = new Date()
  await db
    .insertInto('dcl_subjects')
    .values({
      id: productId,
      entity: 'product',
      code: productCode,
      created_at: now,
      created_by: actorId,
    })
    .execute()
  await db
    .insertInto('approval_entries')
    .values({
      id: productApprovalId,
      domain: 'dcl',
      entity: 'product',
      subject_id: productId,
      version_no: 1,
      status: 'APPROVED',
      revision: 1,
      submitted_by: actorId,
      submitted_at: now,
      approved_by: actorId,
      approved_at: now,
      updated_by: actorId,
      updated_at: now,
    })
    .execute()
  await db
    .insertInto('dcl_subjects')
    .values([
      {
        id: customerId,
        entity: 'customer',
        code: `CUS-${productCode.slice(4)}`,
        created_at: now,
        created_by: actorId,
      },
      {
        id: employeeId,
        entity: 'employee',
        code: `EMP-${productCode.slice(4)}`,
        created_at: now,
        created_by: actorId,
      },
    ])
    .execute()
  await db
    .insertInto('approval_entries')
    .values([
      {
        id: customerApprovalId,
        domain: 'dcl',
        entity: 'customer',
        subject_id: customerId,
        version_no: 1,
        status: 'APPROVED',
        revision: 1,
        submitted_by: actorId,
        submitted_at: now,
        approved_by: actorId,
        approved_at: now,
        updated_by: actorId,
        updated_at: now,
      },
      {
        id: employeeApprovalId,
        domain: 'dcl',
        entity: 'employee',
        subject_id: employeeId,
        version_no: 1,
        status: 'APPROVED',
        revision: 1,
        submitted_by: actorId,
        submitted_at: now,
        approved_by: actorId,
        approved_at: now,
        updated_by: actorId,
        updated_at: now,
      },
    ])
    .execute()
  await db
    .insertInto('dcl_customer_versions')
    .values({
      approval_entry_id: customerApprovalId,
      kind: 'ENTERPRISE',
      display_name: '历史客户',
      enabled: true,
    })
    .execute()
  await db
    .insertInto('dcl_customer_subunit_roots')
    .values({
      subunit_id: customerSubunitId,
      customer_id: customerId,
      code: 'SNAP-1',
    })
    .execute()
  await db
    .insertInto('dcl_customer_version_subunits')
    .values({
      customer_approval_entry_id: customerApprovalId,
      subunit_id: customerSubunitId,
      name: '历史子单位',
      enabled: true,
    })
    .execute()
  await db
    .insertInto('dcl_product_versions')
    .values({
      approval_entry_id: productApprovalId,
      name: 'typed product',
      source_snapshots: {},
      unit_conversions: JSON.stringify([]),
      recyclable: false,
      enabled: true,
    })
    .execute()
  await db
    .insertInto('dcl_subjects')
    .values({
      id: supplierId,
      entity: 'supplier',
      code: `SUP-${productCode.slice(4)}`,
      created_at: now,
      created_by: actorId,
    })
    .execute()
  await db
    .insertInto('approval_entries')
    .values({
      id: supplierApprovalId,
      domain: 'dcl',
      entity: 'supplier',
      subject_id: supplierId,
      version_no: 1,
      status: 'APPROVED',
      revision: 1,
      submitted_by: actorId,
      submitted_at: now,
      approved_by: actorId,
      approved_at: now,
      updated_by: actorId,
      updated_at: now,
    })
    .execute()

  const payload = {
    businessDate: '2026-09-04',
    currency: 'CNY',
    remark: 'typed persistence',
    attachments: [],
    priceLines: [
      {
        product: {
          objectId: productId,
          approvalEntryId: productApprovalId,
          selectionOrigin: 'HISTORICAL' as const,
        },
        unitPrice: '10.00',
        remark: 'price line',
      },
    ],
  }
  const view = await service.submit(
    'sale-pricing',
    'submit-new',
    {
      documentId,
      submissionId,
      idempotencyKey: submissionId,
      expectedRevision: null,
      payload,
    },
    actor,
    'typed-roundtrip',
  )
  assert.deepEqual(view.payload, payload)
  assert.deepEqual(
    (await service.get('sale-pricing', documentId, actor)).payload,
    payload,
  )
  assert.deepEqual(
    (await readVouPersistence(db, { approvalEntryId: submissionId })).payload,
    payload,
  )
  const snapshots = await sql<{
    count: string
  }>`SELECT count(*)::text AS count FROM vou_price_line_snapshots WHERE approval_entry_id = ${submissionId}`.execute(
    db,
  )
  assert.equal(snapshots.rows[0]?.count, '1')
  const payloadTables = await sql<{
    count: string
  }>`SELECT count(*)::text AS count FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'vou_document_payloads'`.execute(
    db,
  )
  assert.equal(payloadTables.rows[0]?.count, '0')

  const signoffSubmissionId = ulid()
  const signoffPayload = {
    businessDate: '2026-09-04',
    currency: 'CNY',
    attachments: [],
    customerSubunit: {
      objectId: customerSubunitId,
      approvalEntryId: customerApprovalId,
      selectionOrigin: 'CURRENT' as const,
    },
    expectedSolventContainers: 5,
    expectedResinContainers: 3,
    returnedSolventContainers: 2,
    returnedResinContainers: 4,
    containerDifferenceReason: '现场盘点差异',
    signoffLines: [
      {
        sourceLineId: 'sale-line-1',
        signedBaseQuantity: '1.000000',
        rejectedBaseQuantity: '0.000000',
      },
    ],
  }
  const untrustedSubmissionId = ulid()
  await assert.rejects(
    Reflect.apply(service.submit, service, [
      'sale-signoff',
      'submit-new',
      {
        documentId: ulid(),
        submissionId: untrustedSubmissionId,
        idempotencyKey: untrustedSubmissionId,
        expectedRevision: null,
        payload: signoffPayload,
      },
      {
        id: actorId,
        permissions: ['/vou/sale-signoff/submit-new'],
      },
      'untrusted-system-submit',
      true,
    ]),
    (error: unknown) =>
      error instanceof VouApplicationError &&
      error.errorKey === 'vou_trusted_actor_required',
  )
  const signoff = await service.submit(
    'sale-signoff',
    'submit-new',
    {
      documentId: ulid(),
      submissionId: signoffSubmissionId,
      idempotencyKey: signoffSubmissionId,
      expectedRevision: null,
      payload: signoffPayload,
    },
    actor,
    'sale-signoff-roundtrip',
  )
  assert.deepEqual(signoff.payload, signoffPayload)
  assert.deepEqual(
    (await readVouPersistence(db, { approvalEntryId: signoffSubmissionId }))
      .payload,
    signoffPayload,
  )
  assert.deepEqual(
    (
      await sql<{
        expected_solvent_containers: number
        expected_resin_containers: number
        returned_solvent_containers: number
        returned_resin_containers: number
        container_difference_reason: string | null
      }>`
        SELECT expected_solvent_containers, expected_resin_containers,
          returned_solvent_containers, returned_resin_containers,
          container_difference_reason
        FROM vou_sale_signoff_details
        WHERE approval_entry_id = ${signoffSubmissionId}
      `.execute(db)
    ).rows,
    [
      {
        expected_solvent_containers: 5,
        expected_resin_containers: 3,
        returned_solvent_containers: 2,
        returned_resin_containers: 4,
        container_difference_reason: '现场盘点差异',
      },
    ],
  )

  const badSubmissionId = ulid()
  await assert.rejects(
    service.submit(
      'sale-pricing',
      'submit-new',
      {
        documentId: ulid(),
        submissionId: badSubmissionId,
        idempotencyKey: badSubmissionId,
        expectedRevision: null,
        payload: {
          ...payload,
          attachments: [
            {
              id: ulid(),
              stagingId: ulid(),
              fileName: 'missing.pdf',
              contentType: 'application/pdf',
              sizeBytes: 1,
              sha256: '0'.repeat(64),
            },
          ],
        },
      },
      actor,
      'typed-rollback',
    ),
    (error: unknown) =>
      error instanceof VouApplicationError &&
      error.errorKey === 'vou_attachment_staging_invalid',
  )
  const rolledBack = await sql<{
    count: string
  }>`SELECT count(*)::text AS count FROM approval_entries WHERE id = ${badSubmissionId}`.execute(
    db,
  )
  assert.equal(rolledBack.rows[0]?.count, '0')

  const assetSubmissionId = ulid()
  const asset = await service.submit(
    'asset-acquisition',
    'submit-new',
    {
      documentId: ulid(),
      submissionId: assetSubmissionId,
      idempotencyKey: assetSubmissionId,
      expectedRevision: null,
      payload: {
        businessDate: '2026-09-04',
        currency: 'CNY',
        attachments: [],
        supplier: {
          objectId: supplierId,
          approvalEntryId: supplierApprovalId,
          selectionOrigin: 'HISTORICAL',
        },
        assetAcquisitionLines: [
          {
            assetName: '泵',
            category: { objectId: ulid() },
            originalValue: '100.00',
            usefulLifeMonths: 24,
            residualRate: '0.050000',
            department: { objectId: ulid() },
          },
        ],
      },
    },
    actor,
    'asset-roundtrip',
  )
  assert.deepEqual(
    (await service.get('asset-acquisition', asset.documentId, actor)).payload,
    asset.payload,
  )

  const billSubmissionId = ulid()
  const bill = await service.submit(
    'bill-issue',
    'submit-new',
    {
      documentId: ulid(),
      submissionId: billSubmissionId,
      idempotencyKey: billSubmissionId,
      expectedRevision: null,
      payload: {
        businessDate: '2026-09-04',
        currency: 'CNY',
        attachments: [],
        supplier: { objectId: ulid() },
        interestMode: 'BANK_DEDUCTED',
        billLines: [
          {
            positionType: 'ASSET',
            direction: 'IN',
            purpose: 'PRIMARY',
            billType: 'CHECK',
            billNo: 'B-1',
            medium: 'PAPER',
            currency: 'CNY',
            faceAmount: '100.00',
            issueDate: '2026-09-04',
            maturityDate: '2026-10-04',
            drawer: 'A',
            acceptor: 'B',
            payee: 'C',
            annualRateBps: 0,
          },
        ],
      },
    },
    actor,
    'bill-roundtrip',
  )
  assert.deepEqual(
    (await service.get('bill-issue', bill.documentId, actor)).payload,
    bill.payload,
  )

  const intermediaryReference = (
    entity: 'customer-subunit' | 'employee' | 'product',
  ) => {
    if (entity === 'customer-subunit')
      return {
        objectId: customerSubunitId,
        approvalEntryId: customerApprovalId,
        entity,
        code: 'SNAP-1',
        name: '历史子单位',
      }
    if (entity === 'employee')
      return {
        objectId: employeeId,
        approvalEntryId: employeeApprovalId,
        entity,
        code: `EMP-${productCode.slice(4)}`,
        name: '历史员工',
      }
    return {
      objectId: productId,
      approvalEntryId: productApprovalId,
      entity,
      code: productCode,
      name: '历史产品',
    }
  }
  const intermediarySubmissionId = ulid()
  const intermediary = await service.submit(
    'intermediary-calculation',
    'submit-new',
    {
      documentId: ulid(),
      submissionId: intermediarySubmissionId,
      idempotencyKey: intermediarySubmissionId,
      expectedRevision: null,
      payload: {
        businessDate: '2026-09-04',
        currency: 'CNY',
        attachments: [],
        intermediaryCalculation: {
          source: {
            periodStart: '2026-09-01',
            periodEnd: '2026-09-30',
            currency: 'CNY',
            bills: [],
            lines: [
              {
                sourceSignoffLineId: 'signoff-1',
                sourceKind: 'SALE',
                signoffDocumentId: ulid(),
                signoffDocumentNo: 'SSF-1',
                signoffDate: '2026-09-04',
                orderDocumentId: ulid(),
                orderDocumentNo: 'SOR-1',
                orderDate: '2026-09-01',
                dueDate: '2026-09-04',
                collectionDate: '2026-09-04',
                collectionDelayDays: 0,
                customer: intermediaryReference('customer-subunit'),
                salesperson: intermediaryReference('employee'),
                salesAttributionType: 'INTERNAL_EMPLOYEE',
                salesContractStatus: 'NOT_REQUIRED',
                product: intermediaryReference('product'),
                behaviorProfile: 'RAW_MATERIAL',
                signedBaseQuantity: '1.000000',
                pricingQuantity: '1.000000',
                standardPieceQuantity: '1.000000',
                unitPrice: '10.00',
                referenceUnitPrice: '10.00',
                settlementSurcharge: '0.00',
                lineAmount: '10.00',
                settlementTermCode: 'NOW',
                specialApproval: false,
                adjustmentEmployeeAmount: '0.00',
                adjustmentIntermediaryAmount: '0.00',
              },
            ],
          },
          sourceHash: 'a'.repeat(64),
          script: {
            scriptId: 'script-1',
            revision: 1,
            name: '佣金',
            source: 'return 1',
            hash: 'b'.repeat(64),
          },
          result: {
            lines: [
              {
                sourceSignoffLineId: 'signoff-1',
                premiumUnitPrice: '0.00',
                standardPieceQuantity: '1.000000',
                baseCommission: '0.00',
                premiumCommission: '0.00',
                lowPriceCommission: '0.00',
                marketMaintenanceSubsidy: '0.00',
                marketDevelopmentSubsidy: '0.00',
                billCost: '0.00',
                billLineIds: [],
                employeeAmount: '0.00',
                intermediaryAmount: '0.00',
              },
            ],
            summaries: [],
          },
        },
      },
    },
    actor,
    'intermediary-roundtrip',
  )
  assert.deepEqual(
    (
      await service.get(
        'intermediary-calculation',
        intermediary.documentId,
        actor,
      )
    ).payload,
    intermediary.payload,
  )

  const tooLongRequestId = 'forced-rollback-'.padEnd(129, 'x')
  const failedDocumentId = ulid(),
    failedSubmissionId = ulid()
  await assert.rejects(
    service.submit(
      'sale-pricing',
      'submit-new',
      {
        documentId: failedDocumentId,
        submissionId: failedSubmissionId,
        idempotencyKey: failedSubmissionId,
        expectedRevision: null,
        payload,
      },
      actor,
      tooLongRequestId,
    ),
    /value too long/,
  )
  assert.equal(
    await db
      .selectFrom('vou_documents')
      .select('id')
      .where('id', '=', failedDocumentId)
      .executeTakeFirst(),
    undefined,
  )
  assert.equal(
    await db
      .selectFrom('approval_entries')
      .select('id')
      .where('id', '=', failedSubmissionId)
      .executeTakeFirst(),
    undefined,
  )

  let lifecycle = view
  await assert.rejects(
    service.review(
      'sale-pricing',
      'reject',
      {
        documentId,
        submissionId,
        expectedRevision: lifecycle.revision,
        reason: 'forced reject',
      },
      reviewer,
      tooLongRequestId,
    ),
    /value too long/,
  )
  assert.equal(
    (await service.get('sale-pricing', documentId, actor)).status,
    'PENDING',
  )
  lifecycle = await service.review(
    'sale-pricing',
    'reject',
    {
      documentId,
      submissionId,
      expectedRevision: lifecycle.revision,
      reason: 'review required',
    },
    reviewer,
    'atomic-reject',
  )
  await assert.rejects(
    service.review(
      'sale-pricing',
      'unreject',
      {
        documentId,
        submissionId,
        expectedRevision: lifecycle.revision,
      },
      reviewer,
      tooLongRequestId,
    ),
    /value too long/,
  )
  assert.equal(
    (await service.get('sale-pricing', documentId, actor)).status,
    'REJECTED',
  )
  lifecycle = await service.review(
    'sale-pricing',
    'unreject',
    {
      documentId,
      submissionId,
      expectedRevision: lifecycle.revision,
    },
    reviewer,
    'atomic-unreject',
  )
  await assert.rejects(
    service.review(
      'sale-pricing',
      'approve',
      {
        documentId,
        submissionId,
        expectedRevision: lifecycle.revision,
      },
      reviewer,
      tooLongRequestId,
    ),
    /value too long/,
  )
  assert.equal(
    (await service.get('sale-pricing', documentId, actor)).status,
    'PENDING',
  )
  lifecycle = await service.review(
    'sale-pricing',
    'approve',
    {
      documentId,
      submissionId,
      expectedRevision: lifecycle.revision,
    },
    reviewer,
    'atomic-approve',
  )
  await assert.rejects(
    service.review(
      'sale-pricing',
      'unapprove',
      {
        documentId,
        submissionId,
        expectedRevision: lifecycle.revision,
        reason: 'forced unapprove',
      },
      reviewer,
      tooLongRequestId,
    ),
    /value too long/,
  )
  assert.equal(
    (await service.get('sale-pricing', documentId, actor)).status,
    'APPROVED',
  )
  lifecycle = await service.review(
    'sale-pricing',
    'unapprove',
    {
      documentId,
      submissionId,
      expectedRevision: lifecycle.revision,
      reason: 'return to pending',
    },
    reviewer,
    'atomic-unapprove',
  )
  await db
    .updateTable('vou_documents')
    .set({ stable_revision: 9_223_372_036_854_775_807n })
    .where('id', '=', documentId)
    .execute()
  await assert.rejects(
    service.delete(
      'sale-pricing',
      {
        documentId,
        submissionId,
        expectedRevision: lifecycle.revision,
      },
      actor,
      'atomic-delete-overflow',
    ),
    /bigint out of range/,
  )
  assert.equal(
    (await service.get('sale-pricing', documentId, actor)).status,
    'PENDING',
  )
  assert.equal(
    (
      await db
        .selectFrom('approval_events')
        .select('id')
        .where('entry_id', '=', submissionId)
        .where('action', '=', 'DELETED')
        .execute()
    ).length,
    0,
  )
  await db
    .updateTable('vou_documents')
    .set({ stable_revision: 1n })
    .where('id', '=', documentId)
    .execute()
  await service.delete(
    'sale-pricing',
    {
      documentId,
      submissionId,
      expectedRevision: lifecycle.revision,
    },
    actor,
    'atomic-delete',
  )
  assert.equal(
    await db
      .selectFrom('approval_entries')
      .select('id')
      .where('id', '=', submissionId)
      .executeTakeFirst(),
    undefined,
  )
  assert.equal(
    (await service.query('sale-pricing', actor)).some(
      (item) => item.documentId === documentId,
    ),
    false,
  )
})

test('VOU attachment staging validates ownership, promotion, retry and cleanup', async (context) => {
  assert.ok(databaseUrl, 'TARGET_TEST_DATABASE_URL is required')
  const db = createDatabase(databaseUrl)
  const attachmentRoot = await mkdtemp(join(tmpdir(), 'zerp-vou-attachments-'))
  const attachmentStore = new AttachmentStore(attachmentRoot, {
    orphanGraceMs: 0,
  })
  const service = new VouService(
    db,
    { acc: { async apply() {} }, wfl: { async apply() {} } },
    { attachmentStore },
  )
  const ownerId = ulid(),
    otherId = ulid(),
    productId = ulid(),
    productApprovalId = ulid(),
    currentProductApprovalId = ulid()
  const owner = { id: ownerId, permissions: [] as string[], trusted: true }
  const other = { id: otherId, permissions: [] as string[], trusted: true }
  const now = new Date()
  context.after(async () => {
    await sql`DELETE FROM approval_events WHERE actor_id IN (${ownerId}, ${otherId})`.execute(
      db,
    )
    await sql`DELETE FROM approval_entries WHERE domain = 'vou' AND submitted_by = ${ownerId}`.execute(
      db,
    )
    await sql`DELETE FROM vou_documents WHERE created_by = ${ownerId}`.execute(
      db,
    )
    await sql`DELETE FROM approval_entries WHERE domain = 'dcl' AND submitted_by = ${ownerId}`.execute(
      db,
    )
    await sql`DELETE FROM dcl_subjects WHERE created_by = ${ownerId}`.execute(
      db,
    )
    await sql`DELETE FROM app_users WHERE id IN (${ownerId}, ${otherId})`.execute(
      db,
    )
    await db.destroy()
    await rm(attachmentRoot, { recursive: true, force: true })
  })
  await db
    .insertInto('app_users')
    .values([
      {
        id: ownerId,
        username: `vou-attachment-${ownerId}`,
        display_name: 'attachment owner',
        password_hash: 'unused',
        status: 'ENABLED',
        password_changed_at: now,
        password_change_required: false,
      },
      {
        id: otherId,
        username: `vou-attachment-other-${otherId}`,
        display_name: 'attachment other',
        password_hash: 'unused',
        status: 'ENABLED',
        password_changed_at: now,
        password_change_required: false,
      },
    ])
    .execute()
  const attachmentProductCode = `PRD-${Math.floor(Math.random() * 10_000)
    .toString()
    .padStart(4, '0')}`
  await db
    .insertInto('dcl_subjects')
    .values({
      id: productId,
      entity: 'product',
      code: attachmentProductCode,
      created_at: now,
      created_by: ownerId,
    })
    .execute()
  await db
    .insertInto('approval_entries')
    .values([
      {
        id: productApprovalId,
        domain: 'dcl',
        entity: 'product',
        subject_id: productId,
        version_no: 1,
        status: 'APPROVED',
        revision: 1,
        submitted_by: ownerId,
        submitted_at: now,
        approved_by: ownerId,
        approved_at: now,
        updated_by: ownerId,
        updated_at: now,
      },
      {
        id: currentProductApprovalId,
        domain: 'dcl',
        entity: 'product',
        subject_id: productId,
        version_no: 2,
        status: 'APPROVED',
        revision: 1,
        submitted_by: ownerId,
        submitted_at: now,
        approved_by: ownerId,
        approved_at: now,
        updated_by: ownerId,
        updated_at: now,
      },
    ])
    .execute()
  await db
    .insertInto('dcl_product_versions')
    .values([
      {
        approval_entry_id: productApprovalId,
        name: '历史产品',
        source_snapshots: {},
        unit_conversions: JSON.stringify([]),
        recyclable: false,
        enabled: true,
      },
      {
        approval_entry_id: currentProductApprovalId,
        name: '当前产品',
        source_snapshots: {},
        unit_conversions: JSON.stringify([]),
        recyclable: false,
        enabled: true,
      },
    ])
    .execute()
  const content = Buffer.from('%PDF-1.7 attachment fixture')
  const digest = createHash('sha256').update(content).digest('hex')
  const stage = (stagingId: string, fileId: string) => ({
    stagingId,
    fileId,
    fileName: 'fixture.pdf',
    mimeType: 'application/pdf' as const,
    size: content.length,
    digest,
    contentBase64: content.toString('base64'),
  })
  await assert.rejects(
    service.stageAttachment('sale-pricing', stage(ulid(), ulid()), {
      id: ownerId,
      permissions: [],
    }),
    (error: unknown) =>
      error instanceof VouApplicationError &&
      error.errorKey === 'approval_invalid_action',
  )
  await assert.rejects(
    service.stageAttachment(
      'sale-pricing',
      { ...stage(ulid(), ulid()), digest: '0'.repeat(64) },
      owner,
    ),
    (error: unknown) =>
      error instanceof VouApplicationError &&
      error.errorKey === 'vou_attachment_digest_invalid',
  )
  await assert.rejects(
    service.stageAttachment(
      'sale-pricing',
      { ...stage(ulid(), ulid()), mimeType: 'image/png' },
      owner,
    ),
    (error: unknown) =>
      error instanceof VouApplicationError &&
      error.errorKey === 'vou_attachment_type_invalid',
  )
  await assert.rejects(
    service.stageAttachment(
      'sale-pricing',
      { ...stage(ulid(), ulid()), size: content.length + 1 },
      owner,
    ),
    (error: unknown) =>
      error instanceof VouApplicationError &&
      error.errorKey === 'vou_attachment_size_invalid',
  )
  const foreign = stage(ulid(), ulid())
  await service.stageAttachment('sale-pricing', foreign, other)
  await assert.rejects(
    service.stageAttachment(
      'sale-pricing',
      { ...foreign, fileId: ulid() },
      owner,
    ),
    (error: unknown) =>
      error instanceof VouApplicationError &&
      error.errorKey === 'vou_attachment_staging_conflict',
  )
  await assert.rejects(
    attachmentStore.read(`staging/${ownerId}/${foreign.stagingId}`),
    /attachment_not_found/,
  )
  assert.deepEqual(
    await attachmentStore.read(`staging/${otherId}/${foreign.stagingId}`),
    content,
  )
  const attachment = (item: ReturnType<typeof stage>) => ({
    id: item.fileId,
    stagingId: item.stagingId,
    fileName: item.fileName,
    contentType: item.mimeType,
    sizeBytes: item.size,
    sha256: item.digest,
  })
  const payload = (
    attachments: readonly ReturnType<typeof attachment>[],
    approvalEntryId = productApprovalId,
  ) => ({
    businessDate: '2026-09-04',
    currency: 'CNY',
    attachments,
    priceLines: [
      {
        product: {
          objectId: productId,
          approvalEntryId,
          selectionOrigin: 'HISTORICAL' as const,
        },
        unitPrice: '1.00',
      },
    ],
  })
  const foreignSubmissionId = ulid()
  await assert.rejects(
    service.submit(
      'sale-pricing',
      'submit-new',
      {
        documentId: ulid(),
        submissionId: foreignSubmissionId,
        idempotencyKey: foreignSubmissionId,
        expectedRevision: null,
        payload: payload([attachment(foreign)]),
      },
      owner,
      'attachment-foreign',
    ),
    (error: unknown) =>
      error instanceof VouApplicationError &&
      error.errorKey === 'vou_attachment_staging_invalid',
  )
  assert.equal(
    (
      await db
        .selectFrom('vou_attachment_staging')
        .select('id')
        .where('id', '=', foreign.stagingId)
        .execute()
    ).length,
    1,
  )
  const failed = stage(ulid(), ulid())
  await service.stageAttachment('sale-pricing', failed, owner)
  const failedSubmissionId = ulid()
  await assert.rejects(
    service.submit(
      'sale-pricing',
      'submit-new',
      {
        documentId: ulid(),
        submissionId: failedSubmissionId,
        idempotencyKey: failedSubmissionId,
        expectedRevision: null,
        payload: payload([attachment(failed)], ulid()),
      },
      owner,
      'attachment-reference-failure',
    ),
    (error: unknown) =>
      error instanceof VouApplicationError &&
      error.errorKey === 'vou_reference_unavailable',
  )
  assert.equal(
    (
      await db
        .selectFrom('vou_attachment_staging')
        .select('id')
        .where('id', '=', failed.stagingId)
        .execute()
    ).length,
    1,
  )
  const rollback = stage(ulid(), ulid())
  await service.stageAttachment('sale-pricing', rollback, owner)
  const rollbackSubmissionId = ulid()
  await assert.rejects(
    service.submit(
      'sale-pricing',
      'submit-new',
      {
        documentId: ulid(),
        submissionId: rollbackSubmissionId,
        idempotencyKey: rollbackSubmissionId,
        expectedRevision: null,
        // The first attachment reaches physical promotion; the duplicated
        // staging id makes the later DB work fail and roll the transaction back.
        payload: payload([attachment(rollback), attachment(rollback)]),
      },
      owner,
      'attachment-rollback-after-promote',
    ),
  )
  const rollbackStaging = await sql<{ storage_key: string }>`
    SELECT storage_key FROM vou_attachment_staging WHERE id = ${rollback.stagingId}
  `.execute(db)
  assert.deepEqual(
    await attachmentStore.read(rollbackStaging.rows[0]!.storage_key),
    content,
  )
  await assert.rejects(
    attachmentStore.read(
      `permanent/vou/sale-pricing/${rollbackSubmissionId}/${rollback.fileId}`,
    ),
    /attachment_not_found/,
  )
  await service.submit(
    'sale-pricing',
    'submit-new',
    {
      documentId: ulid(),
      submissionId: rollbackSubmissionId,
      idempotencyKey: rollbackSubmissionId,
      expectedRevision: null,
      payload: payload([attachment(rollback)]),
    },
    owner,
    'attachment-retry-after-rollback',
  )
  await assert.rejects(
    attachmentStore.read(rollbackStaging.rows[0]!.storage_key),
    /attachment_not_found/,
  )
  const mismatchSubmissionId = ulid()
  await assert.rejects(
    service.submit(
      'asset-acquisition',
      'submit-new',
      {
        documentId: ulid(),
        submissionId: mismatchSubmissionId,
        idempotencyKey: mismatchSubmissionId,
        expectedRevision: null,
        payload: {
          businessDate: '2026-09-04',
          currency: 'CNY',
          attachments: [],
          supplier: {
            objectId: productId,
            approvalEntryId: productApprovalId,
            selectionOrigin: 'HISTORICAL',
          },
          assetAcquisitionLines: [
            {
              assetName: '错误供应商',
              category: { objectId: ulid() },
              originalValue: '1.00',
              usefulLifeMonths: 1,
              residualRate: '0.000000',
              department: { objectId: ulid() },
            },
          ],
        },
      },
      owner,
      'reference-entity-mismatch',
    ),
    (error: unknown) =>
      error instanceof VouApplicationError &&
      error.errorKey === 'vou_reference_unavailable',
  )
  const customerId = ulid(),
    subunitId = ulid(),
    customerOldApprovalId = ulid(),
    customerCurrentApprovalId = ulid()
  const employeeId = ulid(),
    employeeApprovalId = ulid(),
    fundAccountId = ulid(),
    fundAccountApprovalId = ulid()
  const code = (prefix: string) =>
    `${prefix}-${Math.floor(Math.random() * 10_000)
      .toString()
      .padStart(4, '0')}`
  await db
    .insertInto('dcl_subjects')
    .values([
      {
        id: customerId,
        entity: 'customer',
        code: code('CUS'),
        created_at: now,
        created_by: ownerId,
      },
      {
        id: employeeId,
        entity: 'employee',
        code: code('EMP'),
        created_at: now,
        created_by: ownerId,
      },
      {
        id: fundAccountId,
        entity: 'fund-account',
        code: code('FAC'),
        created_at: now,
        created_by: ownerId,
      },
    ])
    .execute()
  await db
    .insertInto('approval_entries')
    .values([
      {
        id: customerOldApprovalId,
        domain: 'dcl',
        entity: 'customer',
        subject_id: customerId,
        version_no: 1,
        status: 'APPROVED',
        revision: 1,
        submitted_by: ownerId,
        submitted_at: now,
        approved_by: ownerId,
        approved_at: now,
        updated_by: ownerId,
        updated_at: now,
      },
      {
        id: customerCurrentApprovalId,
        domain: 'dcl',
        entity: 'customer',
        subject_id: customerId,
        version_no: 2,
        status: 'APPROVED',
        revision: 1,
        submitted_by: ownerId,
        submitted_at: now,
        approved_by: ownerId,
        approved_at: now,
        updated_by: ownerId,
        updated_at: now,
      },
      {
        id: employeeApprovalId,
        domain: 'dcl',
        entity: 'employee',
        subject_id: employeeId,
        version_no: 1,
        status: 'APPROVED',
        revision: 1,
        submitted_by: ownerId,
        submitted_at: now,
        approved_by: ownerId,
        approved_at: now,
        updated_by: ownerId,
        updated_at: now,
      },
      {
        id: fundAccountApprovalId,
        domain: 'dcl',
        entity: 'fund-account',
        subject_id: fundAccountId,
        version_no: 1,
        status: 'APPROVED',
        revision: 1,
        submitted_by: ownerId,
        submitted_at: now,
        approved_by: ownerId,
        approved_at: now,
        updated_by: ownerId,
        updated_at: now,
      },
    ])
    .execute()
  await db
    .insertInto('dcl_customer_versions')
    .values([
      {
        approval_entry_id: customerOldApprovalId,
        kind: 'ENTERPRISE',
        display_name: '历史客户',
        enabled: true,
      },
      {
        approval_entry_id: customerCurrentApprovalId,
        kind: 'ENTERPRISE',
        display_name: '当前客户',
        enabled: true,
      },
    ])
    .execute()
  await db
    .insertInto('dcl_customer_subunit_roots')
    .values({ subunit_id: subunitId, customer_id: customerId, code: 'S-1' })
    .execute()
  await db
    .insertInto('dcl_customer_version_subunits')
    .values([
      {
        customer_approval_entry_id: customerOldApprovalId,
        subunit_id: subunitId,
        name: '历史子单位',
        enabled: true,
      },
      {
        customer_approval_entry_id: customerCurrentApprovalId,
        subunit_id: subunitId,
        name: '当前子单位',
        enabled: true,
      },
    ])
    .execute()
  await db
    .insertInto('dcl_employee_versions')
    .values({
      approval_entry_id: employeeApprovalId,
      display_name: '经办人',
      source_snapshots: {},
      enabled: true,
    })
    .execute()
  await db
    .insertInto('dcl_fund_account_versions')
    .values({
      approval_entry_id: fundAccountApprovalId,
      name: '收款账户',
      enabled: true,
    })
    .execute()
  const receiptPayload = (
    approvalEntryId: string,
    selectionOrigin: 'CURRENT' | 'HISTORICAL',
  ) => ({
    businessDate: '2026-09-04',
    currency: 'CNY',
    attachments: [],
    amount: '1.00',
    counterpartyType: 'customer-subunit' as const,
    counterparty: { objectId: subunitId, approvalEntryId, selectionOrigin },
    fundAccount: {
      objectId: fundAccountId,
      approvalEntryId: fundAccountApprovalId,
      selectionOrigin: 'CURRENT' as const,
    },
    handler: {
      objectId: employeeId,
      approvalEntryId: employeeApprovalId,
      selectionOrigin: 'CURRENT' as const,
    },
  })
  const currentReceiptSubmissionId = ulid(),
    historicalReceiptSubmissionId = ulid()
  const currentReceipt = await service.submit(
    'other-receipt',
    'submit-new',
    {
      documentId: ulid(),
      submissionId: currentReceiptSubmissionId,
      idempotencyKey: currentReceiptSubmissionId,
      expectedRevision: null,
      payload: receiptPayload(customerCurrentApprovalId, 'CURRENT'),
    },
    owner,
    'subunit-current',
  )
  const historicalReceipt = await service.submit(
    'other-receipt',
    'submit-new',
    {
      documentId: ulid(),
      submissionId: historicalReceiptSubmissionId,
      idempotencyKey: historicalReceiptSubmissionId,
      expectedRevision: null,
      payload: receiptPayload(customerOldApprovalId, 'HISTORICAL'),
    },
    owner,
    'subunit-historical',
  )
  assert.equal(
    (currentReceipt.payload as { counterparty: { objectId: string } })
      .counterparty.objectId,
    subunitId,
  )
  assert.equal(
    (historicalReceipt.payload as { counterparty: { approvalEntryId: string } })
      .counterparty.approvalEntryId,
    customerOldApprovalId,
  )
  const promoted = stage(ulid(), ulid())
  await service.stageAttachment('sale-pricing', promoted, owner)
  const staged = await sql<{ storage_key: string }>`
    SELECT storage_key FROM vou_attachment_staging WHERE id = ${promoted.stagingId}
  `.execute(db)
  assert.deepEqual(
    await attachmentStore.read(staged.rows[0]!.storage_key),
    content,
  )
  const submissionId = ulid(),
    documentId = ulid()
  const input = {
    documentId,
    submissionId,
    idempotencyKey: submissionId,
    expectedRevision: null,
    payload: payload([attachment(promoted)]),
  }
  await service.submit(
    'sale-pricing',
    'submit-new',
    input,
    owner,
    'attachment-promote',
  )
  await service.submit(
    'sale-pricing',
    'submit-new',
    input,
    owner,
    'attachment-retry',
  )
  assert.equal(
    (
      await db
        .selectFrom('vou_attachments')
        .select('file_id')
        .where('approval_entry_id', '=', submissionId)
        .execute()
    ).length,
    1,
  )
  const permanent = await sql<{ storage_key: string }>`
    SELECT storage_key FROM vou_attachments WHERE approval_entry_id = ${submissionId}
  `.execute(db)
  assert.deepEqual(
    await attachmentStore.read(permanent.rows[0]!.storage_key),
    content,
  )
  await assert.rejects(
    service.submit(
      'sale-pricing',
      'submit-new',
      { ...input, expectedRevision: '1' },
      owner,
      'attachment-conflicting-retry',
    ),
    (error: unknown) =>
      error instanceof VouApplicationError &&
      error.errorKey === 'vou_idempotency_conflict',
  )
  assert.deepEqual(
    await attachmentStore.read(permanent.rows[0]!.storage_key),
    content,
  )
  assert.equal(
    (
      await db
        .selectFrom('vou_attachment_staging')
        .select('id')
        .where('id', '=', promoted.stagingId)
        .execute()
    ).length,
    0,
  )
  const permanentOrphans = await sql<{
    count: string
  }>`SELECT count(*)::text AS count FROM vou_attachments attachment LEFT JOIN approval_entries approval ON approval.id = attachment.approval_entry_id WHERE approval.id IS NULL`.execute(
    db,
  )
  assert.equal(permanentOrphans.rows[0]?.count, '0')
  await service.delete(
    'sale-pricing',
    {
      documentId,
      submissionId,
      expectedRevision: '1',
    },
    owner,
    'attachment-delete',
  )
  await assert.rejects(
    attachmentStore.read(permanent.rows[0]!.storage_key),
    /attachment_not_found/,
  )
  const expired = stage(ulid(), ulid())
  await service.stageAttachment('sale-pricing', expired, owner)
  const expiredAt = new Date(Date.now() - 1_000)
  await db
    .updateTable('vou_attachment_staging')
    .set({
      created_at: new Date(expiredAt.getTime() - 60_000),
      expires_at: expiredAt,
    })
    .where('id', '=', expired.stagingId)
    .execute()
  const ordinaryActor = { id: ownerId, permissions: [] as string[] }
  await assert.rejects(
    service.cleanupAttachments('sale-pricing', ordinaryActor),
    (error: unknown) =>
      error instanceof VouApplicationError &&
      error.errorKey === 'approval_invalid_action',
  )
  assert.equal(
    await service.cleanupAttachments('sale-pricing', {
      ...ordinaryActor,
      permissions: ['/vou/sale-pricing/attachment-cleanup'],
    }),
    1,
  )
  assert.equal(
    (
      await db
        .selectFrom('vou_attachment_staging')
        .select('id')
        .where('id', '=', expired.stagingId)
        .execute()
    ).length,
    0,
  )
  await assert.rejects(
    attachmentStore.read(`staging/${ownerId}/${expired.stagingId}`),
    /attachment_not_found/,
  )
  const referencedStaging = await db
    .selectFrom('vou_attachment_staging')
    .select('storage_key')
    .execute()
  assert.equal(
    await attachmentStore.cleanupStagingOrphans(
      new Set(referencedStaging.map((row) => row.storage_key)),
      { writersFrozen: true },
    ),
    0,
  )
  const physicalDeleteFailure = stage(ulid(), ulid())
  await service.stageAttachment('sale-pricing', physicalDeleteFailure, owner)
  await db
    .updateTable('vou_attachment_staging')
    .set({
      created_at: new Date(Date.now() - 61_000),
      expires_at: new Date(Date.now() - 1_000),
    })
    .where('id', '=', physicalDeleteFailure.stagingId)
    .execute()
  class FailingRemoveAttachmentStore extends AttachmentStore {
    override async remove(_key: string): Promise<void> {
      throw new Error('physical delete unavailable')
    }

    override async cleanupStagingOrphans(
      _referencedKeys: ReadonlySet<string>,
      _proof: { writersFrozen: true },
    ): Promise<number> {
      return 0
    }
  }
  const cleanupService = new VouService(
    db,
    { acc: { async apply() {} }, wfl: { async apply() {} } },
    { attachmentStore: new FailingRemoveAttachmentStore(attachmentRoot) },
  )
  assert.equal(
    await cleanupService.cleanupAttachments('sale-pricing', {
      ...ordinaryActor,
      permissions: ['/vou/sale-pricing/attachment-cleanup'],
    }),
    1,
  )
  assert.equal(
    await db
      .selectFrom('vou_attachment_staging')
      .select('id')
      .where('id', '=', physicalDeleteFailure.stagingId)
      .executeTakeFirst(),
    undefined,
  )
  assert.deepEqual(
    await attachmentStore.read(
      `staging/${ownerId}/${physicalDeleteFailure.stagingId}`,
    ),
    content,
  )
  assert.equal(
    await db
      .selectFrom('attachment_deletion_jobs')
      .select('storage_key')
      .where(
        'storage_key',
        '=',
        `staging/${ownerId}/${physicalDeleteFailure.stagingId}`,
      )
      .executeTakeFirstOrThrow()
      .then(() => 1),
    1,
  )
  await service.stageAttachment(
    'sale-pricing',
    physicalDeleteFailure,
    owner,
  )
  assert.equal(
    await service.cleanupAttachments('sale-pricing', {
      ...ordinaryActor,
      permissions: ['/vou/sale-pricing/attachment-cleanup'],
    }),
    0,
  )
  assert.deepEqual(
    await attachmentStore.read(
      `staging/${ownerId}/${physicalDeleteFailure.stagingId}`,
    ),
    content,
  )
  assert.equal(
    await db
      .selectFrom('attachment_deletion_jobs')
      .select('storage_key')
      .where(
        'storage_key',
        '=',
        `staging/${ownerId}/${physicalDeleteFailure.stagingId}`,
      )
      .executeTakeFirst(),
    undefined,
  )
})

test('VOU reference candidates use session, CSRF and current typed facts', async (context) => {
  assert.ok(databaseUrl, 'TARGET_TEST_DATABASE_URL is required')
  const db = createDatabase(databaseUrl)
  const config = loadConfig({ DATABASE_URL: databaseUrl })
  const vou = new VouService(db, {
    acc: { async apply() {} },
    wfl: { async apply() {} },
  })
  const app = createApp({
    database: { ping: async () => undefined },
    session: new SessionService(db, config),
    config,
    vou,
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
  const actorId = ulid(),
    actorRoleId = ulid(),
    deniedId = ulid()
  const allApprovalIds: string[] = []
  const subjectIds: string[] = []
  const documentIds: string[] = []
  const registerIds: string[] = []
  const assetIds: string[] = []
  const permissionPath = '/vou/reference/query'
  const existingPermission = await db
    .selectFrom('app_permissions')
    .select(['id'])
    .where('path', '=', permissionPath)
    .executeTakeFirst()
  const permissionId = existingPermission?.id ?? ulid()
  const createdPermission = !existingPermission
  const now = new Date()
  context.after(async () => {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    )
    try {
      if (assetIds.length > 0)
        await db
          .deleteFrom('acc_asset_registers')
          .where('id', 'in', assetIds)
          .execute()
      if (registerIds.length > 0)
        await db
          .deleteFrom('acc_register_entries')
          .where('id', 'in', registerIds)
          .execute()
      if (allApprovalIds.length > 0)
        await db
          .deleteFrom('approval_entries')
          .where('id', 'in', allApprovalIds)
          .execute()
      if (documentIds.length > 0)
        await db
          .deleteFrom('vou_documents')
          .where('id', 'in', documentIds)
          .execute()
      if (subjectIds.length > 0)
        await db
          .deleteFrom('dcl_subjects')
          .where('id', 'in', subjectIds)
          .execute()
      await db
        .deleteFrom('aux_objects')
        .where('created_by', '=', actorId)
        .execute()
      await db
        .deleteFrom('app_sessions')
        .where('user_id', 'in', [actorId, deniedId])
        .execute()
      await db
        .deleteFrom('app_user_roles')
        .where('user_id', '=', actorId)
        .execute()
      await db
        .deleteFrom('app_role_permissions')
        .where('role_id', '=', actorRoleId)
        .execute()
      await db.deleteFrom('app_roles').where('id', '=', actorRoleId).execute()
      await db
        .deleteFrom('app_users')
        .where('id', 'in', [actorId, deniedId])
        .execute()
      if (createdPermission)
        await db
          .deleteFrom('app_permissions')
          .where('id', '=', permissionId)
          .execute()
    } finally {
      await db.destroy()
    }
  })
  if (createdPermission)
    await db
      .insertInto('app_permissions')
      .values({
        id: permissionId,
        path: permissionPath,
        ...permissionParts(permissionPath),
        description: permissionPath,
        status: 'ENABLED',
        menu_group: null,
        menu_order: null,
      })
      .execute()
  const password = `Target!${randomBytes(18).toString('base64url')}`
  const username = `vou-reference-${randomBytes(8).toString('hex')}`
  await db
    .insertInto('app_users')
    .values([
      {
        id: actorId,
        username,
        display_name: 'VOU reference actor',
        password_hash: await hashPassword(password),
        status: 'ENABLED',
        password_changed_at: now,
        password_change_required: false,
      },
      {
        id: deniedId,
        username: `vou-denied-${randomBytes(8).toString('hex')}`,
        display_name: 'VOU denied actor',
        password_hash: await hashPassword(password),
        status: 'ENABLED',
        password_changed_at: now,
        password_change_required: false,
      },
    ])
    .execute()
  await db
    .insertInto('app_roles')
    .values({
      id: actorRoleId,
      code: `vou-reference-${actorId}`,
      name: 'VOU reference',
      status: 'ENABLED',
    })
    .execute()
  await db
    .insertInto('app_role_permissions')
    .values({ role_id: actorRoleId, permission_id: permissionId })
    .execute()
  await db
    .insertInto('app_user_roles')
    .values({ user_id: actorId, role_id: actorRoleId })
    .execute()

  const productId = ulid(),
    oldProductApprovalId = ulid(),
    currentProductApprovalId = ulid(),
    disabledProductId = ulid(),
    disabledProductApprovalId = ulid()
  const referenceProductCode = `PRD-${Math.floor(Math.random() * 10_000)
    .toString()
    .padStart(4, '0')}`
  const disabledProductCode = `PRD-${Math.floor(Math.random() * 10_000)
    .toString()
    .padStart(4, '0')}`
  const productKeyword = `当前产品-${productId.slice(-6)}`
  subjectIds.push(productId, disabledProductId)
  allApprovalIds.push(
    oldProductApprovalId,
    currentProductApprovalId,
    disabledProductApprovalId,
  )
  await db
    .insertInto('dcl_subjects')
    .values([
      {
        id: productId,
        entity: 'product',
        code: referenceProductCode,
        created_at: now,
        created_by: actorId,
      },
      {
        id: disabledProductId,
        entity: 'product',
        code: disabledProductCode,
        created_at: now,
        created_by: actorId,
      },
    ])
    .execute()
  await db
    .insertInto('approval_entries')
    .values([
      {
        id: oldProductApprovalId,
        domain: 'dcl',
        entity: 'product',
        subject_id: productId,
        version_no: 1,
        status: 'APPROVED',
        revision: 1,
        submitted_by: actorId,
        submitted_at: now,
        approved_by: actorId,
        approved_at: now,
        updated_by: actorId,
        updated_at: now,
      },
      {
        id: currentProductApprovalId,
        domain: 'dcl',
        entity: 'product',
        subject_id: productId,
        version_no: 2,
        status: 'APPROVED',
        revision: 1,
        submitted_by: actorId,
        submitted_at: now,
        approved_by: actorId,
        approved_at: now,
        updated_by: actorId,
        updated_at: now,
      },
      {
        id: disabledProductApprovalId,
        domain: 'dcl',
        entity: 'product',
        subject_id: disabledProductId,
        version_no: 1,
        status: 'APPROVED',
        revision: 1,
        submitted_by: actorId,
        submitted_at: now,
        approved_by: actorId,
        approved_at: now,
        updated_by: actorId,
        updated_at: now,
      },
    ])
    .execute()
  await db
    .insertInto('dcl_product_versions')
    .values([
      {
        approval_entry_id: oldProductApprovalId,
        name: '旧产品',
        source_snapshots: {},
        unit_conversions: JSON.stringify([]),
        recyclable: false,
        enabled: true,
      },
      {
        approval_entry_id: currentProductApprovalId,
        name: productKeyword,
        source_snapshots: {},
        unit_conversions: JSON.stringify([]),
        recyclable: false,
        enabled: true,
      },
      {
        approval_entry_id: disabledProductApprovalId,
        name: '停用产品',
        source_snapshots: {},
        unit_conversions: JSON.stringify([]),
        recyclable: false,
        enabled: false,
      },
    ])
    .execute()
  const unitId = ulid(),
    disabledUnitId = ulid()
  await db
    .insertInto('aux_objects')
    .values([
      {
        id: unitId,
        entity: 'measurement-unit',
        code: 'AUX-1001',
        data: { name: 'VOU 有效单位' },
        enabled: true,
        created_by: actorId,
        updated_by: actorId,
      },
      {
        id: disabledUnitId,
        entity: 'measurement-unit',
        code: 'AUX-1002',
        data: { name: 'VOU 停用单位' },
        enabled: false,
        created_by: actorId,
        updated_by: actorId,
      },
    ])
    .execute()
  const addRegisterSource = async (reversed: boolean, objectId = ulid()) => {
    const documentId = ulid(),
      approvalId = ulid(),
      registerId = ulid()
    documentIds.push(documentId)
    allApprovalIds.push(approvalId)
    registerIds.push(registerId)
    await db
      .insertInto('vou_documents')
      .values({
        id: documentId,
        entity: 'asset-acquisition',
        document_no: `VRA-${documentId.slice(-6)}`,
        created_at: now,
        created_by: actorId,
      })
      .execute()
    await db
      .insertInto('approval_entries')
      .values({
        id: approvalId,
        domain: 'vou',
        entity: 'asset-acquisition',
        subject_id: documentId,
        version_no: null,
        status: 'APPROVED',
        revision: 1,
        submitted_by: actorId,
        submitted_at: now,
        approved_by: actorId,
        approved_at: now,
        updated_by: actorId,
        updated_at: now,
      })
      .execute()
    await db
      .insertInto('acc_register_entries')
      .values({
        id: registerId,
        register_kind: 'ASSET',
        object_id: objectId,
        source_kind: 'VOU',
        vou_approval_entry_id: approvalId,
        opening_approval_entry_id: null,
        payload: {
          assetNo: reversed ? 'VOU-REF-REVERSED' : 'VOU-REF-ASSET',
          name: reversed ? '已冲销资产' : '有效资产',
        },
        reversed_at: reversed ? now : null,
        created_at: now,
      })
      .execute()
    const existingAsset = await db
      .selectFrom('acc_asset_registers')
      .select('id')
      .where('id', '=', objectId)
      .executeTakeFirst()
    if (!existingAsset) {
      assetIds.push(objectId)
      await db
        .insertInto('acc_asset_registers')
        .values({
          id: objectId,
          asset_no: reversed ? 'VOU-REF-REVERSED' : 'VOU-REF-ASSET',
          name: reversed ? '已冲销资产' : '有效资产',
          status: reversed ? 'RETIRED' : 'ACTIVE',
          acquisition_vou_approval_entry_id: approvalId,
          state_vou_approval_entry_id: approvalId,
          payload: { assetNo: reversed ? 'VOU-REF-REVERSED' : 'VOU-REF-ASSET' },
          created_at: now,
        })
        .execute()
    }
    return objectId
  }
  const activeAssetId = await addRegisterSource(false)
  const reversedAssetId = await addRegisterSource(true)
  const allowed = await signin(origin, username, password)
  const deniedUsername = (
    await db
      .selectFrom('app_users')
      .select('username')
      .where('id', '=', deniedId)
      .executeTakeFirstOrThrow()
  ).username
  const deniedSession = await signin(origin, deniedUsername, password)
  const forbidden = await post(origin, deniedSession, { entity: 'product' })
  assert.equal(forbidden.errorKey, 'approval_invalid_action')
  const products = await post(origin, allowed, {
    entity: 'product',
    keyword: productKeyword,
  })
  assert.equal(products.code, 0)
  assert.deepEqual(
    products.data.items.map((item) => item.objectId),
    [productId],
  )
  assert.equal(
    products.data.items[0]?.approvalEntryId,
    currentProductApprovalId,
  )
  assert.equal(
    products.data.items.some(
      (item) => item.approvalEntryId === oldProductApprovalId,
    ),
    false,
  )
  const units = await post(origin, allowed, {
    entity: 'measurement-unit',
    keyword: 'VOU',
  })
  assert.deepEqual(
    units.data.items.map((item) => item.objectId),
    [unitId],
  )
  assert.equal(units.data.items[0]?.approvalEntryId, undefined)
  const assets = await post(origin, allowed, {
    entity: 'asset',
    keyword: 'VOU-REF',
  })
  assert.deepEqual(
    assets.data.items.map((item) => item.objectId),
    [activeAssetId],
  )
  assert.equal(
    assets.data.items.some((item) => item.objectId === reversedAssetId),
    false,
  )
  await addRegisterSource(false, activeAssetId)
  const canonicalAssets = await post(origin, allowed, { entity: 'asset' })
  assert.equal(canonicalAssets.code, 0)
  assert.deepEqual(
    canonicalAssets.data.items.map((item) => item.objectId),
    [activeAssetId],
  )
})

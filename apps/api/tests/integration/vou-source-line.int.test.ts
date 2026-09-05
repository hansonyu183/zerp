import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import test from 'node:test'

import { serve } from '@hono/node-server'
import { modelBuildId, type VouPayloadFor } from '@zerp/model'
import { sql } from 'kysely'
import { ulid } from 'ulid'

import { createApp } from '../../src/app.ts'
import { hashPassword, SessionService } from '../../src/app/session.ts'
import { createDatabase } from '../../src/db/database.ts'
import { loadConfig } from '../../src/platform/config.ts'
import { VouApplicationError, VouService } from '../../src/vou/service.ts'

const databaseUrl = process.env.TARGET_TEST_DATABASE_URL
const permissionPath = '/vou/source-line/query'

function permissionParts(path: string) {
  const match = path.match(/^\/([^/]+)\/([^/]+)\/([^/]+)$/)
  assert.ok(match, `invalid permission path ${path}`)
  return { domain: match[1]!, entity: match[2]!, action: match[3]! }
}

test('VOU source-line HTTP query returns only server-eligible current quantities', async (context) => {
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

  const actorId = ulid()
  const deniedId = ulid()
  const roleId = ulid()
  const createdDocumentIds: string[] = []
  const createdApprovalIds: string[] = []
  const createdIdempotencyKeys: string[] = []
  const warehouseId = ulid()
  const now = new Date()
  const existingPermission = await db
    .selectFrom('app_permissions')
    .select('id')
    .where('path', '=', permissionPath)
    .executeTakeFirst()
  const permissionId = existingPermission?.id ?? ulid()
  const createdPermission = existingPermission === undefined

  context.after(async () => {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    )
    try {
      await db
        .deleteFrom('approval_events')
        .where('actor_id', 'in', [actorId, deniedId])
        .execute()
      if (createdIdempotencyKeys.length > 0)
        await db
          .deleteFrom('vou_idempotency')
          .where('entity', '=', 'sale-return')
          .where('idempotency_key', 'in', createdIdempotencyKeys)
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
        .where('role_id', '=', roleId)
        .execute()
      await db.deleteFrom('app_roles').where('id', '=', roleId).execute()
      await db
        .deleteFrom('approval_entries')
        .where(
          'id',
          'in',
          createdApprovalIds.filter((id) => id !== warehouseApprovalId),
        )
        .execute()
      await db
        .deleteFrom('approval_entries')
        .where('id', '=', warehouseApprovalId)
        .execute()
      await db
        .deleteFrom('vou_documents')
        .where('id', 'in', createdDocumentIds)
        .execute()
      await db
        .deleteFrom('dcl_subjects')
        .where('id', '=', warehouseId)
        .execute()
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
  const username = `vou-source-${randomBytes(8).toString('hex')}`
  const deniedUsername = `vou-source-denied-${randomBytes(8).toString('hex')}`
  await db
    .insertInto('app_users')
    .values([
      {
        id: actorId,
        username,
        display_name: 'VOU source-line actor',
        password_hash: await hashPassword(password),
        status: 'ENABLED',
        password_changed_at: now,
        password_change_required: false,
      },
      {
        id: deniedId,
        username: deniedUsername,
        display_name: 'VOU source-line denied',
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
      id: roleId,
      code: `vou-source-${roleId}`,
      name: 'VOU source line',
      status: 'ENABLED',
    })
    .execute()
  await db
    .insertInto('app_role_permissions')
    .values({ role_id: roleId, permission_id: permissionId })
    .execute()
  await db
    .insertInto('app_user_roles')
    .values({ user_id: actorId, role_id: roleId })
    .execute()

  const warehouseApprovalId = ulid()
  createdApprovalIds.push(warehouseApprovalId)
  await db
    .insertInto('dcl_subjects')
    .values({
      id: warehouseId,
      entity: 'warehouse',
      code: `WHS-${String(randomBytes(2).readUInt16BE() % 10_000).padStart(4, '0')}`,
      created_at: now,
      created_by: actorId,
    })
    .execute()
  await db
    .insertInto('approval_entries')
    .values({
      id: warehouseApprovalId,
      domain: 'dcl',
      entity: 'warehouse',
      subject_id: warehouseId,
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
    .insertInto('dcl_warehouse_versions')
    .values({
      approval_entry_id: warehouseApprovalId,
      name: '来源行测试仓库',
      enabled: true,
    })
    .execute()

  async function addDocument(input: {
    entity:
      | 'sale-order'
      | 'sale-outbound'
      | 'sale-delivery'
      | 'sale-signoff'
      | 'purchase-order'
      | 'purchase-inbound'
      | 'purchase-return'
    documentNo: string
    status: 'PENDING' | 'APPROVED'
    parent?: {
      entity:
        'sale-order' | 'sale-outbound' | 'sale-delivery' | 'purchase-order'
      documentId: string
    }
  }) {
    const documentId = ulid()
    const approvalEntryId = ulid()
    createdDocumentIds.push(documentId)
    createdApprovalIds.push(approvalEntryId)
    await db
      .insertInto('vou_documents')
      .values({
        id: documentId,
        entity: input.entity,
        document_no: input.documentNo,
        created_at: now,
        created_by: actorId,
      })
      .execute()
    await db
      .insertInto('approval_entries')
      .values({
        id: approvalEntryId,
        domain: 'vou',
        entity: input.entity,
        subject_id: documentId,
        version_no: 1,
        status: input.status,
        revision: 1,
        submitted_by: actorId,
        submitted_at: now,
        approved_by: input.status === 'APPROVED' ? actorId : null,
        approved_at: input.status === 'APPROVED' ? now : null,
        updated_by: actorId,
        updated_at: now,
      })
      .execute()
    await sql`
      INSERT INTO ${sql.raw(`vou_${input.entity.replaceAll('-', '_')}_details`)}
        (approval_entry_id, document_id, business_date, currency, total_amount_minor,
         parent_entity, parent_document_id)
      VALUES (${approvalEntryId}, ${documentId}, '2026-09-05', 'CNY', 0,
        ${input.parent?.entity ?? null}, ${input.parent?.documentId ?? null})
    `.execute(db)
    return { documentId, approvalEntryId }
  }

  const productId = ulid()
  const unitId = ulid()
  const sourceLineId = ulid()
  const source = await addDocument({
    entity: 'purchase-order',
    documentNo: 'CG-SOURCE-MATCH',
    status: 'APPROVED',
  })
  await db
    .insertInto('vou_product_line_snapshots')
    .values({
      approval_entry_id: source.approvalEntryId,
      line_no: 1,
      line_id: sourceLineId,
      entered_quantity_micros: 10_000_000,
      entered_unit_id: unitId,
      base_quantity_micros: 10_000_000,
      unit_price_minor: 100,
    })
    .execute()
  await db
    .insertInto('vou_reference_snapshots')
    .values({
      approval_entry_id: source.approvalEntryId,
      field: 'product',
      line_no: 1,
      item_no: 0,
      object_id: productId,
      reference_entity: 'product',
      reference_code: 'P-SOURCE',
      reference_name: '来源树脂',
    })
    .execute()

  const productionEligible = await addDocument({
    entity: 'sale-order',
    documentNo: 'SO-PRODUCTION-ELIGIBLE',
    status: 'APPROVED',
  })
  const productionExcluded = await addDocument({
    entity: 'sale-order',
    documentNo: 'SO-PRODUCTION-EXCLUDED',
    status: 'APPROVED',
  })
  const productionLineId = ulid()
  const resaleLineId = ulid()
  await db
    .insertInto('vou_product_line_snapshots')
    .values([
      {
        approval_entry_id: productionEligible.approvalEntryId,
        line_no: 1,
        line_id: productionLineId,
        entered_quantity_micros: 2_000_000,
        entered_unit_id: unitId,
        base_quantity_micros: 2_000_000,
        unit_price_minor: 100,
        formula_source_type: 'PRODUCT_FIXED',
      },
      {
        approval_entry_id: productionExcluded.approvalEntryId,
        line_no: 1,
        line_id: resaleLineId,
        entered_quantity_micros: 2_000_000,
        entered_unit_id: unitId,
        base_quantity_micros: 2_000_000,
        unit_price_minor: 100,
      },
    ])
    .execute()
  await db
    .insertInto('vou_reference_snapshots')
    .values([
      {
        approval_entry_id: productionEligible.approvalEntryId,
        field: 'product',
        line_no: 1,
        item_no: 0,
        object_id: productId,
        reference_entity: 'product',
        reference_code: 'P-SELF-MADE',
        reference_name: '自制成品',
      },
      {
        approval_entry_id: productionExcluded.approvalEntryId,
        field: 'product',
        line_no: 1,
        item_no: 0,
        object_id: productId,
        reference_entity: 'product',
        reference_code: 'P-RESALE',
        reference_name: '转售商品',
      },
    ])
    .execute()

  const occupied = await addDocument({
    entity: 'purchase-inbound',
    documentNo: 'RK-OCCUPIED',
    status: 'PENDING',
    parent: { entity: 'purchase-order', documentId: source.documentId },
  })
  await db
    .insertInto('vou_source_line_snapshots')
    .values({
      approval_entry_id: occupied.approvalEntryId,
      line_no: 1,
      source_line_id: sourceLineId,
      base_quantity_micros: 2_500_000,
    })
    .execute()
  const returnedInbound = await addDocument({
    entity: 'purchase-inbound',
    documentNo: 'RK-RETURNED',
    status: 'APPROVED',
    parent: { entity: 'purchase-order', documentId: source.documentId },
  })
  await db
    .insertInto('vou_source_line_snapshots')
    .values({
      approval_entry_id: returnedInbound.approvalEntryId,
      line_no: 1,
      source_line_id: sourceLineId,
      base_quantity_micros: 1_500_000,
    })
    .execute()
  const restored = await addDocument({
    entity: 'purchase-return',
    documentNo: 'CT-RESTORED',
    status: 'APPROVED',
    parent: { entity: 'purchase-order', documentId: source.documentId },
  })
  await db
    .insertInto('vou_return_line_snapshots')
    .values({
      approval_entry_id: restored.approvalEntryId,
      line_no: 1,
      source_document_id: returnedInbound.documentId,
      source_line_id: sourceLineId,
      base_quantity_micros: 1_500_000,
    })
    .execute()

  const supersededReturn = await addDocument({
    entity: 'purchase-return',
    documentNo: 'CT-OPEN-SUPERSEDES-APPROVED',
    status: 'APPROVED',
    parent: { entity: 'purchase-order', documentId: source.documentId },
  })
  await db
    .insertInto('vou_return_line_snapshots')
    .values({
      approval_entry_id: supersededReturn.approvalEntryId,
      line_no: 1,
      source_document_id: returnedInbound.documentId,
      source_line_id: sourceLineId,
      base_quantity_micros: 500_000,
    })
    .execute()
  const openReturnApprovalId = ulid()
  createdApprovalIds.push(openReturnApprovalId)
  await db
    .insertInto('approval_entries')
    .values({
      id: openReturnApprovalId,
      domain: 'vou',
      entity: 'purchase-return',
      subject_id: supersededReturn.documentId,
      version_no: null,
      status: 'PENDING',
      revision: 1,
      submitted_by: actorId,
      submitted_at: new Date(now.getTime() + 1_000),
      approved_by: null,
      approved_at: null,
      updated_by: actorId,
      updated_at: new Date(now.getTime() + 1_000),
    })
    .execute()
  await db
    .insertInto('vou_return_line_snapshots')
    .values({
      approval_entry_id: openReturnApprovalId,
      line_no: 1,
      source_document_id: returnedInbound.documentId,
      source_line_id: sourceLineId,
      base_quantity_micros: 500_000,
    })
    .execute()

  const openSource = await addDocument({
    entity: 'purchase-order',
    documentNo: 'CG-OPEN-EXCLUDED',
    status: 'PENDING',
  })
  const openLineId = ulid()
  await db
    .insertInto('vou_product_line_snapshots')
    .values({
      approval_entry_id: openSource.approvalEntryId,
      line_no: 1,
      line_id: openLineId,
      entered_quantity_micros: 1_000_000,
      entered_unit_id: unitId,
      base_quantity_micros: 1_000_000,
      unit_price_minor: 100,
    })
    .execute()
  await db
    .insertInto('vou_reference_snapshots')
    .values({
      approval_entry_id: openSource.approvalEntryId,
      field: 'product',
      line_no: 1,
      item_no: 0,
      object_id: productId,
      reference_entity: 'product',
      reference_code: 'P-OPEN',
      reference_name: '开放提交件产品',
    })
    .execute()

  for (let index = 0; index < 20; index += 1) {
    const filler = await addDocument({
      entity: 'purchase-order',
      documentNo: `CG-PAGE-${String(index).padStart(2, '0')}`,
      status: 'APPROVED',
    })
    const lineId = ulid()
    await db
      .insertInto('vou_product_line_snapshots')
      .values({
        approval_entry_id: filler.approvalEntryId,
        line_no: 1,
        line_id: lineId,
        entered_quantity_micros: 1_000_000,
        entered_unit_id: unitId,
        base_quantity_micros: 1_000_000,
        unit_price_minor: 100,
      })
      .execute()
    await db
      .insertInto('vou_reference_snapshots')
      .values({
        approval_entry_id: filler.approvalEntryId,
        field: 'product',
        line_no: 1,
        item_no: 0,
        object_id: productId,
        reference_entity: 'product',
        reference_code: `P-PAGE-${index}`,
        reference_name: `分页产品 ${index}`,
      })
      .execute()
  }

  const actor = { id: actorId, permissions: [permissionPath] }
  const direct = await vou.querySourceLineCandidates(
    {
      targetEntity: 'purchase-inbound',
      page: 1,
      pageSize: 20,
      keyword: 'SOURCE-MATCH',
      sourceDocumentId: source.documentId,
    },
    actor,
  )
  assert.equal(direct.total, 1)
  assert.deepEqual(direct.items[0], {
    sourceDocumentId: source.documentId,
    sourceDocumentNo: 'CG-SOURCE-MATCH',
    sourceEntity: 'purchase-order',
    rootDocumentId: source.documentId,
    rootEntity: 'purchase-order',
    businessDate: '2026-09-05',
    sourceLineId,
    product: { objectId: productId, code: 'P-SOURCE', name: '来源树脂' },
    availableBaseQuantity: '7.500000',
  })
  const [concurrentA, concurrentB] = await Promise.all([
    vou.querySourceLineCandidates(
      { targetEntity: 'purchase-inbound', page: 2, pageSize: 20 },
      actor,
    ),
    vou.querySourceLineCandidates(
      { targetEntity: 'purchase-inbound', page: 2, pageSize: 20 },
      actor,
    ),
  ])
  assert.equal(concurrentA.total, 21)
  assert.equal(concurrentA.items.length, 1)
  assert.deepEqual(concurrentB, concurrentA)
  assert.deepEqual(
    await vou.querySourceLineCandidates(
      { targetEntity: 'purchase-inbound', page: 3, pageSize: 20 },
      actor,
    ),
    { items: [], total: 21, page: 3, pageSize: 20 },
  )
  assert.equal(
    concurrentA.items.some((item) => item.sourceLineId === openLineId),
    false,
  )
  const production = await vou.querySourceLineCandidates(
    { targetEntity: 'order-production', page: 1, pageSize: 20 },
    actor,
  )
  assert.equal(
    production.items.some((item) => item.sourceLineId === productionLineId),
    true,
  )
  assert.equal(
    production.items.some((item) => item.sourceLineId === resaleLineId),
    false,
  )
  assert.equal(
    (
      await vou.querySourceLineCandidates(
        { targetEntity: 'sale-return', page: 1, pageSize: 20 },
        actor,
      )
    ).items.some((item) => item.sourceLineId === sourceLineId),
    false,
  )

  const saleLineId = ulid()
  const saleOrder = await addDocument({
    entity: 'sale-order',
    documentNo: 'SO-RETURN-ROOT',
    status: 'APPROVED',
  })
  await db
    .insertInto('vou_product_line_snapshots')
    .values({
      approval_entry_id: saleOrder.approvalEntryId,
      line_no: 1,
      line_id: saleLineId,
      entered_quantity_micros: 10_000_000,
      entered_unit_id: unitId,
      base_quantity_micros: 10_000_000,
      unit_price_minor: 100,
    })
    .execute()
  await db
    .insertInto('vou_reference_snapshots')
    .values({
      approval_entry_id: saleOrder.approvalEntryId,
      field: 'product',
      line_no: 1,
      item_no: 0,
      object_id: productId,
      reference_entity: 'product',
      reference_code: 'P-RETURN',
      reference_name: '精确来源产品',
    })
    .execute()
  const outbound = await addDocument({
    entity: 'sale-outbound',
    documentNo: 'CK-RETURN-SOURCE',
    status: 'APPROVED',
    parent: { entity: 'sale-order', documentId: saleOrder.documentId },
  })
  const delivery = await addDocument({
    entity: 'sale-delivery',
    documentNo: 'FH-RETURN-SOURCE',
    status: 'APPROVED',
    parent: { entity: 'sale-outbound', documentId: outbound.documentId },
  })
  const signoff = await addDocument({
    entity: 'sale-signoff',
    documentNo: 'QS-RETURN-SOURCE',
    status: 'APPROVED',
    parent: { entity: 'sale-delivery', documentId: delivery.documentId },
  })
  await db
    .insertInto('vou_signoff_line_snapshots')
    .values({
      approval_entry_id: signoff.approvalEntryId,
      line_no: 1,
      source_line_id: saleLineId,
      signed_quantity_micros: 10_000_000,
      rejected_quantity_micros: 0,
    })
    .execute()

  const saleReturnActor = {
    id: actorId,
    permissions: ['/vou/sale-return/submit-new', permissionPath],
  }
  function saleReturnInput(input: {
    documentId: string
    submissionId: string
    sourceDocumentId?: string
    sourceLineId?: string
    parentDocumentId?: string
    quantity: string
  }) {
    createdDocumentIds.push(input.documentId)
    createdApprovalIds.push(input.submissionId)
    createdIdempotencyKeys.push(input.submissionId)
    return {
      documentId: input.documentId,
      submissionId: input.submissionId,
      idempotencyKey: input.submissionId,
      expectedRevision: null,
      payload: {
        businessDate: '2026-09-05',
        currency: 'CNY',
        parentEntity: 'sale-order',
        parentDocumentId: input.parentDocumentId ?? saleOrder.documentId,
        warehouse: {
          objectId: warehouseId,
          approvalEntryId: warehouseApprovalId,
          selectionOrigin: 'CURRENT',
        },
        returnReason: '来源行精确校验',
        returnLines: [
          {
            sourceDocumentId: input.sourceDocumentId ?? signoff.documentId,
            sourceLineId: input.sourceLineId ?? saleLineId,
            baseQuantity: input.quantity,
          },
        ],
        attachments: [],
      } satisfies VouPayloadFor<'sale-return'>,
    }
  }

  await assert.rejects(
    vou.submit(
      'sale-return',
      'submit-new',
      saleReturnInput({
        documentId: ulid(),
        submissionId: ulid(),
        sourceLineId: ulid(),
        quantity: '1.000000',
      }),
      saleReturnActor,
      ulid(),
    ),
    (error) =>
      error instanceof VouApplicationError &&
      error.errorKey === 'vou_source_line_unavailable',
  )
  const differentRoot = await addDocument({
    entity: 'sale-order',
    documentNo: 'SO-WRONG-ROOT',
    status: 'APPROVED',
  })
  await assert.rejects(
    vou.submit(
      'sale-return',
      'submit-new',
      saleReturnInput({
        documentId: ulid(),
        submissionId: ulid(),
        parentDocumentId: differentRoot.documentId,
        quantity: '1.000000',
      }),
      saleReturnActor,
      ulid(),
    ),
    (error) =>
      error instanceof VouApplicationError &&
      error.errorKey === 'vou_parent_invalid',
  )

  const concurrentInputs = [0, 1].map(() => {
    const submissionId = ulid()
    return saleReturnInput({
      documentId: ulid(),
      submissionId,
      quantity: '6.000000',
    })
  })
  const concurrentReturns = await Promise.allSettled(
    concurrentInputs.map((input) =>
      vou.submit('sale-return', 'submit-new', input, saleReturnActor, ulid()),
    ),
  )
  const fulfilledReturns = concurrentReturns.filter(
    (result) => result.status === 'fulfilled',
  )
  const rejectedReturns = concurrentReturns.filter(
    (result) => result.status === 'rejected',
  )
  assert.equal(fulfilledReturns.length, 1)
  assert.equal(rejectedReturns.length, 1)
  const successfulReturn = fulfilledReturns[0]!
  assert.equal(successfulReturn.status, 'fulfilled')
  assert.ok('returnLines' in successfulReturn.value.payload)
  assert.deepEqual(successfulReturn.value.payload.returnLines, [
    {
      sourceDocumentId: signoff.documentId,
      sourceLineId: saleLineId,
      baseQuantity: '6.000000',
    },
  ])
  const failedReturn = rejectedReturns[0]!
  assert.equal(failedReturn.status, 'rejected')
  assert.equal(
    failedReturn.reason.errorKey,
    'vou_source_line_quantity_exceeded',
  )
  const remainingReturnSource = await vou.querySourceLineCandidates(
    {
      targetEntity: 'sale-return',
      page: 1,
      pageSize: 20,
      sourceDocumentId: signoff.documentId,
    },
    saleReturnActor,
  )
  assert.equal(remainingReturnSource.total, 1)
  assert.equal(
    remainingReturnSource.items[0]?.availableBaseQuantity,
    '4.000000',
  )
  assert.deepEqual(
    remainingReturnSource.items[0] && {
      rootEntity: remainingReturnSource.items[0].rootEntity,
      rootDocumentId: remainingReturnSource.items[0].rootDocumentId,
    },
    { rootEntity: 'sale-order', rootDocumentId: saleOrder.documentId },
  )

  async function signin(login: string) {
    const response = await fetch(`${origin}/app/user/signin`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-zerp-model-build': modelBuildId,
        connection: 'close',
      },
      body: JSON.stringify({ username: login, password }),
    })
    assert.equal(response.status, 200)
    const body = (await response.json()) as {
      code: number
      data: { csrfToken: string }
    }
    assert.equal(body.code, 0)
    return {
      cookie: response.headers.getSetCookie()[0] ?? '',
      csrfToken: body.data.csrfToken,
    }
  }
  async function post(
    session: { cookie: string; csrfToken: string },
    body: unknown,
  ) {
    return fetch(`${origin}/vou/source-line/query`, {
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
  }

  const session = await signin(username)
  const response = await post(session, {
    targetEntity: 'purchase-inbound',
    page: 1,
    pageSize: 20,
    keyword: 'P-SOURCE',
  })
  assert.equal(response.status, 200)
  const body = (await response.json()) as {
    code: number
    data: {
      items: Array<{ sourceLineId: string; availableBaseQuantity: string }>
    }
  }
  assert.equal(body.code, 0)
  assert.equal(body.data.items.length, 1)
  assert.equal(body.data.items[0]?.sourceLineId, sourceLineId)
  assert.equal(body.data.items[0]?.availableBaseQuantity, '7.500000')

  const invalid = await post(session, {
    targetEntity: 'sale-order',
    page: 1,
    pageSize: 20,
  })
  assert.equal(invalid.status, 200)
  const invalidBody = (await invalid.json()) as {
    code: number
    errorKey: string
  }
  assert.notEqual(invalidBody.code, 0)
  assert.equal(invalidBody.errorKey, 'validation_failed')

  const deniedSession = await signin(deniedUsername)
  const denied = await post(deniedSession, {
    targetEntity: 'purchase-inbound',
    page: 1,
    pageSize: 20,
  })
  assert.equal(denied.status, 200)
  const deniedBody = (await denied.json()) as {
    code: number
    errorKey: string
  }
  assert.notEqual(deniedBody.code, 0)
  assert.equal(deniedBody.errorKey, 'approval_invalid_action')
})

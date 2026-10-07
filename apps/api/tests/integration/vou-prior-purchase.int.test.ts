import assert from 'node:assert/strict'
import test from 'node:test'
import { ulid } from 'ulid'
import { sql } from 'kysely'
import {
  modelBuildId,
  type VouPayloadFor,
  type VouPriorFact,
} from '@zerp/model'
import { createApp } from '../../src/app.ts'
import { SessionService } from '../../src/app/session.ts'
import { loadConfig } from '../../src/platform/config.ts'
import { withWflDatabase } from './wfl-fixture.ts'
import { seedStockFixture } from '../fixtures/vou-stock.ts'

async function purchaseClients(
  db: Parameters<Parameters<typeof withWflDatabase>[0]>[0],
  fixture: Awaited<ReturnType<typeof seedStockFixture>>,
) {
  const config = loadConfig({
    DATABASE_URL: process.env.TARGET_TEST_DATABASE_URL!,
    APP_SESSION_COOKIE_SECURE: 'false',
  })
  const app = createApp({
    config,
    session: new SessionService(db, config),
    vou: fixture.vou,
    opening: fixture.openings,
  })
  async function client(user: typeof fixture.submitter) {
    const response = await app.request('/session/auth/signin', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-zerp-model-build': modelBuildId,
      },
      body: JSON.stringify({ code: user.username, password: user.password }),
    })
    const auth = await response.json()
    assert.equal(auth.code, 0)
    const headers = {
      'Content-Type': 'application/json',
      'x-zerp-model-build': modelBuildId,
      'x-csrf-token': auth.data.csrfToken,
      cookie: response.headers.getSetCookie()[0]!,
    }
    return async (path: string, input: unknown, method = 'POST') =>
      (
        await app.request(path, {
          method,
          headers,
          ...(method === 'POST' ? { body: JSON.stringify(input) } : {}),
        })
      ).json()
  }
  return {
    post: await client(fixture.submitter),
    review: await client(fixture.reviewer),
  }
}

// The stock opening is a synthetic fixture, never a claim about OIT balances.
test('public purchase carryover preserves 100/60/40, exact return batches and one future stock effect', async () => {
  await withWflDatabase(async (db) => {
    const fixture = await seedStockFixture(
      db,
      '2026-09',
      { quantity: '60', amount: '120.00' },
      false,
    )
    await fixture.quantityMapping('purchase-inbound')
    await fixture.quantityMapping('purchase-return')
    const { post, review } = await purchaseClients(db, fixture)
    const capture: VouPriorFact = {
      sourceInstanceId: 'fixture-oit',
      sourceSchema: 'fixture',
      sourceDocumentType: 'AA',
      sourceDocumentKey: 'order-100',
      sourceDocumentNo: 'AA-100',
      capturedAt: '2026-08-31T23:59:59.000Z',
      snapshotDigest: 'a'.repeat(64),
    }
    const original = fixture.purchase.payload as VouPayloadFor<'purchase-order'>
    const orderId = ulid(),
      orderEntry = ulid(),
      lineId = ulid()
    const orderInput = {
      documentId: orderId,
      submissionId: orderEntry,
      idempotencyKey: orderEntry,
      expectedRevision: null,
      payload: {
        ...original,
        businessDate: '2026-08-20',
        priorFact: capture,
        productLines: [
          {
            ...original.productLines[0]!,
            lineId,
            enteredQuantity: '100',
            baseQuantity: '100',
            unitPrice: '2.00',
          },
        ],
      },
    }
    const order = await post('/vou/purchase-order/submit-new', orderInput)
    assert.equal(order.code, 0, JSON.stringify(order))
    assert.deepEqual(
      (await post('/vou/purchase-order/submit-new', orderInput)).data,
      order.data,
    )
    const own = await post('/vou/purchase-order/approve', {
      documentId: orderId,
      submissionId: orderEntry,
      expectedRevision: order.data.revision,
    })
    assert.equal(own.errorKey, 'approval_self_review_forbidden')
    const approvedOrder = await review('/vou/purchase-order/approve', {
      documentId: orderId,
      submissionId: orderEntry,
      expectedRevision: order.data.revision,
    })
    assert.equal(approvedOrder.code, 0, JSON.stringify(approvedOrder))
    const duplicateBeforeEntry = ulid()
    const duplicateBefore = await post('/vou/purchase-order/submit-new', {
      ...orderInput,
      documentId: ulid(),
      submissionId: duplicateBeforeEntry,
      idempotencyKey: duplicateBeforeEntry,
    })
    assert.equal(duplicateBefore.errorKey, 'vou_prior_fact_source_conflict')
    const receiptId = ulid(),
      receiptEntry = ulid()
    const receiptPayload: VouPayloadFor<'purchase-inbound'> = {
      businessDate: '2026-08-25',
      currency: 'CNY',
      attachments: [],
      supplier: original.supplier,
      warehouse: original.warehouse,
      parentEntity: 'purchase-order',
      parentDocumentId: orderId,
      priorFact: {
        ...capture,
        sourceDocumentType: 'AB',
        sourceDocumentKey: 'receipt-60',
        sourceDocumentNo: 'AB-60',
      },
      sourceLines: [
        { sourceLineId: lineId, baseQuantity: '60', priorAmount: '101.01' },
      ],
    }
    const mismatchEntry = ulid()
    const mismatch = await post('/vou/purchase-inbound/submit-new', {
      documentId: ulid(),
      submissionId: mismatchEntry,
      idempotencyKey: mismatchEntry,
      expectedRevision: null,
      payload: {
        ...receiptPayload,
        priorFact: {
          ...receiptPayload.priorFact!,
          snapshotDigest: 'b'.repeat(64),
        },
      },
    })
    assert.equal(mismatch.errorKey, 'vou_prior_fact_invalid')
    const futureDatedEntry = ulid()
    const futureDated = await post('/vou/purchase-inbound/submit-new', {
      documentId: ulid(),
      submissionId: futureDatedEntry,
      idempotencyKey: futureDatedEntry,
      expectedRevision: null,
      payload: { ...receiptPayload, businessDate: '2026-09-01' },
    })
    assert.equal(futureDated.errorKey, 'vou_prior_fact_invalid')
    const receipt = await post('/vou/purchase-inbound/submit-new', {
      documentId: receiptId,
      submissionId: receiptEntry,
      idempotencyKey: receiptEntry,
      expectedRevision: null,
      payload: receiptPayload,
    })
    assert.equal(receipt.code, 0, JSON.stringify(receipt))
    const pendingOpening = await fixture.openings
      .reviewOpening(
        'approve',
        {
          bookId: fixture.book.id,
          submissionId: fixture.opening.submissionId,
          expectedRevision: fixture.opening.approval.revision,
        },
        fixture.reviewerActor,
        'prior-pending-opening',
      )
      .then(
        () => null,
        (e) => e.errorKey,
      )
    assert.equal(pendingOpening, 'vou_prior_fact_pending')
    const approvedReceipt = await review('/vou/purchase-inbound/approve', {
      documentId: receiptId,
      submissionId: receiptEntry,
      expectedRevision: receipt.data.revision,
    })
    assert.equal(approvedReceipt.code, 0, JSON.stringify(approvedReceipt))
    assert.equal(
      approvedReceipt.data.payload.sourceLines[0].priorAmount,
      '101.01',
    )
    const earlyReturnEntry = ulid()
    const earlyReturn = await post('/vou/purchase-return/submit-new', {
      documentId: ulid(),
      submissionId: earlyReturnEntry,
      idempotencyKey: earlyReturnEntry,
      expectedRevision: null,
      payload: {
        businessDate: '2026-08-26',
        currency: 'CNY',
        attachments: [],
        supplier: original.supplier,
        warehouse: original.warehouse,
        parentEntity: 'purchase-order',
        parentDocumentId: orderId,
        returnReason: '截止前不能重放',
        returnLines: [
          {
            sourceDocumentId: receiptId,
            sourceLineId: lineId,
            baseQuantity: '1',
          },
        ],
      },
    })
    assert.equal(earlyReturn.errorKey, 'vou_prior_fact_invalid')
    const dependentEntry = ulid(),
      dependentId = ulid()
    const dependent = await post('/vou/purchase-return/submit-new', {
      documentId: dependentId,
      submissionId: dependentEntry,
      idempotencyKey: dependentEntry,
      expectedRevision: null,
      payload: {
        businessDate: '2026-09-01',
        currency: 'CNY',
        attachments: [],
        supplier: original.supplier,
        warehouse: original.warehouse,
        parentEntity: 'purchase-order',
        parentDocumentId: orderId,
        returnReason: '精确批次引用',
        returnLines: [
          {
            sourceDocumentId: receiptId,
            sourceLineId: lineId,
            baseQuantity: '1',
          },
        ],
      },
    })
    assert.equal(dependent.code, 0, JSON.stringify(dependent))
    const dependencyBlock = await review('/vou/purchase-inbound/unapprove', {
      documentId: receiptId,
      submissionId: receiptEntry,
      expectedRevision: approvedReceipt.data.revision,
      reason: '不能撤销被采用原批次',
    })
    assert.equal(dependencyBlock.errorKey, 'vou_unapprove_blocked')
    assert.ok(
      dependencyBlock.data.blockers.some(
        (row: { id: string }) => row.id === dependentId,
      ),
    )
    await fixture.vou.delete(
      'purchase-return',
      {
        documentId: dependentId,
        submissionId: dependentEntry,
        expectedRevision: dependent.data.revision,
      },
      { ...fixture.actor, id: fixture.submitter.userId },
      'prior-dependent-cleanup',
    )
    const priorEntries = await db
      .selectFrom('acc_journal_entries')
      .select('id')
      .where('vou_approval_entry_id', 'in', [orderEntry, receiptEntry])
      .execute()
    assert.equal(priorEntries.length, 0)
    const options = await post(
      `/vou/purchase-inbound/source-lines?sourceDocumentId=${orderId}&page=1&pageSize=20`,
      {},
      'GET',
    )
    assert.equal(options.code, 0, JSON.stringify(options))
    assert.equal(options.data.items[0].availableBaseQuantity, '40.000000')
    const returnOptions = await post(
      `/vou/purchase-return/source-lines?sourceDocumentId=${receiptId}&page=1&pageSize=20`,
      {},
      'GET',
    )
    assert.equal(returnOptions.code, 0, JSON.stringify(returnOptions))
    assert.equal(returnOptions.data.items[0].sourceDocumentId, receiptId)
    assert.equal(returnOptions.data.items[0].availableBaseQuantity, '60.000000')
    await fixture.openings.reviewOpening(
      'approve',
      {
        bookId: fixture.book.id,
        submissionId: fixture.opening.submissionId,
        expectedRevision: fixture.opening.approval.revision,
      },
      fixture.reviewerActor,
      'prior-opening',
    )
    const frozen = await review('/vou/purchase-inbound/unapprove', {
      documentId: receiptId,
      submissionId: receiptEntry,
      expectedRevision: approvedReceipt.data.revision,
      reason: '历史事实已冻结',
    })
    assert.equal(frozen.errorKey, 'vou_prior_fact_frozen')
    const duplicateEntry = ulid()
    const duplicate = await post('/vou/purchase-order/submit-new', {
      ...orderInput,
      documentId: ulid(),
      submissionId: duplicateEntry,
      idempotencyKey: duplicateEntry,
    })
    assert.equal(duplicate.errorKey, 'vou_prior_fact_frozen')
    const { priorFact: _prior, ...futurePayload } = receiptPayload
    const futureId = ulid(),
      futureEntry = ulid()
    const futureInput = {
      documentId: futureId,
      submissionId: futureEntry,
      idempotencyKey: futureEntry,
      expectedRevision: null,
      payload: {
        ...futurePayload,
        businessDate: '2026-09-01',
        sourceLines: [{ sourceLineId: lineId, baseQuantity: '40' }],
      },
    }
    const excessEntry = ulid()
    const excess = await post('/vou/purchase-inbound/submit-new', {
      ...futureInput,
      documentId: ulid(),
      submissionId: excessEntry,
      idempotencyKey: excessEntry,
      payload: {
        ...futureInput.payload,
        sourceLines: [{ sourceLineId: lineId, baseQuantity: '41' }],
      },
    })
    assert.equal(excess.errorKey, 'vou_source_line_quantity_exceeded')
    const future = await post('/vou/purchase-inbound/submit-new', futureInput)
    assert.equal(future.code, 0, JSON.stringify(future))
    const futureApproved = await review('/vou/purchase-inbound/approve', {
      documentId: futureId,
      submissionId: futureEntry,
      expectedRevision: future.data.revision,
    })
    assert.equal(futureApproved.code, 0, JSON.stringify(futureApproved))
    const stock = await sql<{
      quantity: string
    }>`SELECT SUM(quantity)::text AS quantity FROM acc_inventory_entries WHERE book_id=${fixture.book.id} AND product_id=${fixture.rawId}`.execute(
      db,
    )
    assert.equal(stock.rows[0]?.quantity, '100.00000000')
    const onlyFuture = await db
      .selectFrom('acc_journal_entries')
      .select('id')
      .where('vou_approval_entry_id', '=', futureEntry)
      .execute()
    assert.equal(onlyFuture.length, 1)
    const orderAfter = await post('/vou/purchase-order/get', {
      documentId: orderId,
    })
    assert.deepEqual(orderAfter.data.payload, approvedOrder.data.payload)
    const returnedId = ulid(),
      returnedEntry = ulid()
    const returned = await post('/vou/purchase-return/submit-new', {
      documentId: returnedId,
      submissionId: returnedEntry,
      idempotencyKey: returnedEntry,
      expectedRevision: null,
      payload: {
        businessDate: '2026-09-02',
        currency: 'CNY',
        attachments: [],
        supplier: original.supplier,
        warehouse: original.warehouse,
        parentEntity: 'purchase-order',
        parentDocumentId: orderId,
        returnReason: '退回此前实际批次',
        returnLines: [
          {
            sourceDocumentId: receiptId,
            sourceLineId: lineId,
            baseQuantity: '10',
          },
        ],
      },
    })
    assert.equal(returned.code, 0, JSON.stringify(returned))
    const returnedApproved = await review('/vou/purchase-return/approve', {
      documentId: returnedId,
      submissionId: returnedEntry,
      expectedRevision: returned.data.revision,
    })
    assert.equal(returnedApproved.code, 0, JSON.stringify(returnedApproved))
    const invoiceOptions = await fixture.vou.invoiceSourceOptions(
      'purchase-invoice',
      {
        objectId: original.supplier.objectId,
        operatingEntityId: '',
        businessDate: '2026-09-02',
        currency: 'CNY',
      },
      fixture.actor,
    )
    assert.equal(
      invoiceOptions.items.find((row) => row.sourceDocumentId === receiptId)
        ?.availableAmount,
      '84.18',
    )
    const restored = await post(
      `/vou/purchase-inbound/source-lines?sourceDocumentId=${orderId}&page=1&pageSize=20`,
      {},
      'GET',
    )
    assert.equal(restored.data.items[0].availableBaseQuantity, '10.000000')
  })
})

test('prior refund keeps its actual amount and future refunds consume the exact residual batch amount', async () => {
  await withWflDatabase(async (db) => {
    const fixture = await seedStockFixture(
      db,
      '2026-09',
      { quantity: '50', amount: '100.00' },
      false,
    )
    const refundMapping = await fixture.quantityMapping('purchase-return')
    const { post, review } = await purchaseClients(db, fixture)
    const original = fixture.purchase.payload as VouPayloadFor<'purchase-order'>
    const lineId = ulid()
    const capture: VouPriorFact = {
      sourceInstanceId: 'fixture',
      sourceSchema: 'fixture',
      sourceDocumentType: 'AA',
      sourceDocumentKey: 'original',
      sourceDocumentNo: 'AA-1',
      capturedAt: '2026-08-31T23:59:59.000Z',
      snapshotDigest: 'c'.repeat(64),
    }
    async function save(
      entity: 'purchase-order' | 'purchase-inbound' | 'purchase-return',
      payload: unknown,
    ) {
      const documentId = ulid(),
        submissionId = ulid()
      const saved = await post(`/vou/${entity}/submit-new`, {
        documentId,
        submissionId,
        idempotencyKey: submissionId,
        expectedRevision: null,
        payload,
      })
      assert.equal(saved.code, 0, JSON.stringify(saved))
      const approved = await review(`/vou/${entity}/approve`, {
        documentId,
        submissionId,
        expectedRevision: saved.data.revision,
      })
      assert.equal(approved.code, 0, JSON.stringify(approved))
      return approved.data
    }
    const order = await save('purchase-order', {
      ...original,
      businessDate: '2026-08-20',
      priorFact: capture,
      productLines: [
        {
          ...original.productLines[0]!,
          lineId,
          enteredQuantity: '100',
          baseQuantity: '100',
          unitPrice: '2.00',
        },
      ],
    })
    const base = {
      currency: 'CNY',
      attachments: [],
      supplier: original.supplier,
      warehouse: original.warehouse,
      parentEntity: 'purchase-order',
      parentDocumentId: order.documentId,
    }
    const receipt = await save('purchase-inbound', {
      ...base,
      businessDate: '2026-08-21',
      priorFact: {
        ...capture,
        sourceDocumentType: 'AB',
        sourceDocumentKey: 'receipt',
        sourceDocumentNo: 'AB-1',
      },
      sourceLines: [
        { sourceLineId: lineId, baseQuantity: '60', priorAmount: '101.01' },
      ],
    })
    const priorReturn = await save('purchase-return', {
      ...base,
      businessDate: '2026-08-22',
      priorFact: {
        ...capture,
        sourceDocumentType: 'AF',
        sourceDocumentKey: 'return',
        sourceDocumentNo: 'AF-1',
      },
      returnReason: '历史实际退货',
      returnLines: [
        {
          sourceDocumentId: receipt.documentId,
          sourceLineId: lineId,
          baseQuantity: '10',
          priorAmount: '20.00',
        },
      ],
    })
    assert.equal(priorReturn.payload.returnLines[0].priorAmount, '20.00')
    const entries = await db
      .selectFrom('acc_journal_entries')
      .select('id')
      .where('vou_approval_entry_id', 'in', [
        receipt.submissionId,
        priorReturn.submissionId,
      ])
      .execute()
    assert.equal(entries.length, 0)
    const before = await fixture.vou.invoiceSourceOptions(
      'purchase-invoice',
      {
        objectId: original.supplier.objectId,
        operatingEntityId: '',
        businessDate: '2026-09-30',
        currency: 'CNY',
      },
      fixture.actor,
    )
    assert.equal(
      before.items.find((row) => row.sourceDocumentId === receipt.documentId)
        ?.availableAmount,
      '81.01',
    )
    const payable = await fixture.acc.createSubject(
      {
        id: ulid(),
        bookId: fixture.book.id,
        code: '2202',
        name: '测试供应商应付',
        parentId: null,
        balanceDirection: 'CREDIT',
        enabled: true,
        requiredDimensions: ['SUPPLIER'],
        inventoryQuantity: false,
        settlementPurpose: 'PAYABLE',
      },
      fixture.actor,
    )
    await fixture.openings.deleteOpening(
      {
        bookId: fixture.book.id,
        submissionId: fixture.opening.submissionId,
        expectedRevision: fixture.opening.approval.revision,
      },
      fixture.actor,
      'replace-synthetic-opening',
    )
    const openingId = ulid()
    const financialOpening = await fixture.openings.submitOpening(
      {
        ...fixture.opening.payload,
        submissionId: openingId,
        idempotencyKey: openingId,
        lines: [
          ...fixture.opening.payload.lines.map((line) =>
            line.direction === 'CREDIT' ? { ...line, amount: '18.99' } : line,
          ),
          {
            subjectId: payable.id,
            currency: 'CNY',
            direction: 'CREDIT',
            amount: '81.01',
            dimensions: { SUPPLIER: original.supplier.objectId },
          },
        ],
      },
      fixture.actor,
      'synthetic-payable-opening',
    )
    const counterpart = refundMapping.definition.templates[0]!.lines[1]!
    await fixture.mappings.save(
      {
        bookId: fixture.book.id,
        vouEntity: 'purchase-return',
        expectedRevision: refundMapping.revision,
        defaultResult: refundMapping.defaultResult,
        definition: {
          ...refundMapping.definition,
          templates: refundMapping.definition.templates.map((template) => ({
            ...template,
            lines: [
              ...template.lines,
              {
                ...counterpart,
                collection: 'settlementMovements',
                subjectValue: payable.id,
                direction: 'DEBIT',
                dimensions: { SUPPLIER: 'line.counterpartyId' },
              },
              { ...counterpart, collection: 'settlementMovements' },
            ],
          })),
        },
      },
      fixture.actor,
    )
    await fixture.openings.reviewOpening(
      'approve',
      {
        bookId: fixture.book.id,
        submissionId: financialOpening.submissionId,
        expectedRevision: financialOpening.approval.revision,
      },
      fixture.reviewerActor,
      'residual-opening',
    )
    const firstRefund = await save('purchase-return', {
      ...base,
      businessDate: '2026-09-01',
      returnReason: '截止后部分退货',
      returnLines: [
        {
          sourceDocumentId: receipt.documentId,
          sourceLineId: lineId,
          baseQuantity: '25',
        },
      ],
    })
    const halfway = await fixture.vou.invoiceSourceOptions(
      'purchase-invoice',
      {
        objectId: original.supplier.objectId,
        operatingEntityId: '',
        businessDate: '2026-09-30',
        currency: 'CNY',
      },
      fixture.actor,
    )
    assert.equal(
      halfway.items.find((row) => row.sourceDocumentId === receipt.documentId)
        ?.availableAmount,
      '40.51',
    )
    const lastRefund = await save('purchase-return', {
      ...base,
      businessDate: '2026-09-02',
      returnReason: '退完剩余真实批次',
      returnLines: [
        {
          sourceDocumentId: receipt.documentId,
          sourceLineId: lineId,
          baseQuantity: '25',
        },
      ],
    })
    const posted = await sql<{ amount: string }>`
      SELECT line.amount::text FROM acc_journal_lines line JOIN acc_journal_entries entry ON entry.id=line.journal_entry_id
      WHERE line.subject_id=${payable.id} AND entry.vou_approval_entry_id IN (${firstRefund.submissionId},${lastRefund.submissionId}) ORDER BY line.amount
    `.execute(db)
    assert.deepEqual(
      posted.rows.map((row) => row.amount),
      ['40.50000000', '40.51000000'],
    )
    const balance = await fixture.acc.partyBalance(
      db as unknown as import('kysely').Transaction<
        import('../../src/db/generated.ts').DB
      >,
      {
        counterpartyDimension: 'SUPPLIER',
        counterpartyObjectId: original.supplier.objectId,
        currency: 'CNY',
        settlementPurpose: 'PAYABLE',
        asOfDate: '2026-09-30',
      },
    )
    assert.equal(balance, 0n)
    const final = await fixture.vou.invoiceSourceOptions(
      'purchase-invoice',
      {
        objectId: original.supplier.objectId,
        operatingEntityId: '',
        businessDate: '2026-09-30',
        currency: 'CNY',
      },
      fixture.actor,
    )
    assert.equal(
      final.items.find((row) => row.sourceDocumentId === receipt.documentId),
      undefined,
    )
  })
})

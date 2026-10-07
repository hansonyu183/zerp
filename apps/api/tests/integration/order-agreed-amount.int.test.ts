import assert from 'node:assert/strict'
import test from 'node:test'
import { ulid } from 'ulid'
import { sql, type Transaction } from 'kysely'
import {
  modelBuildId,
  intermediaryUnits,
  type VouPayloadFor,
  type VouEntity,
} from '@zerp/model'
import { withWflDatabase } from './wfl-fixture.ts'
import { seedOrderListFixture } from '../fixtures/vou-orders.ts'
import { createApp } from '../../src/app.ts'
import { SessionService } from '../../src/app/session.ts'
import { loadConfig } from '../../src/platform/config.ts'
import { invoiceSources } from '../../src/vou/invoice.ts'
import { sourceInventoryMovements } from '../../src/acc/inventory-source.ts'
import { sourceSettlementMovements } from '../../src/acc/settlement-source.ts'
import { AccService } from '../../src/acc/service.ts'
import { AccMappingCatalogService } from '../../src/acc/mapping-catalog.ts'
import { VouOpeningService } from '../../src/vou/opening-service.ts'
import type { DB } from '../../src/db/generated.ts'

test('ordinary HTTP users preserve exact agreements through partial fulfillment, invoice returns and real posting', async () => {
  await withWflDatabase(async (db) => {
    const types: VouEntity[] = [
      'sale-order',
      'purchase-order',
      'sale-outbound',
      'sale-delivery',
      'sale-signoff',
      'purchase-inbound',
      'sale-return',
      'purchase-return',
    ]
    const f = await seedOrderListFixture(db, 0, types)
    const purchasePayload = f.purchase
      .payload as VouPayloadFor<'purchase-order'>
    const config = loadConfig({
      DATABASE_URL: process.env.TARGET_TEST_DATABASE_URL!,
      TARGET_DATABASE_SCOPE: process.env.TARGET_DATABASE_SCOPE,
      APP_SESSION_COOKIE_SECURE: 'false',
    })
    const app = createApp({
      config,
      session: new SessionService(db, config),
      vou: f.vou,
    })
    async function client(user: typeof f.submitter) {
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
      return async (path: string, input: unknown) => {
        const r = await app.request(path, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-zerp-model-build': modelBuildId,
            'x-csrf-token': auth.data.csrfToken,
            cookie: response.headers.getSetCookie()[0]!,
          },
          body: JSON.stringify(input),
        })
        const body = await r.json()
        assert.equal(
          body.code,
          0,
          JSON.stringify({
            path,
            errorKey: body.errorKey,
            message: body.message,
          }),
        )
        return body.data
      }
    }
    const submit = await client(f.submitter),
      review = await client(f.reviewer)
    async function approved(entity: VouEntity, payload: unknown) {
      const submissionId = ulid()
      const input = {
        documentId: ulid(),
        submissionId,
        idempotencyKey: submissionId,
        expectedRevision: null,
        payload,
      }
      const generated = [
        'sale-outbound',
        'sale-delivery',
        'sale-signoff',
      ].includes(entity)
      const create = () =>
        generated
          ? f.vou.submit(
              entity,
              'submit-new',
              input as Parameters<typeof f.vou.submit>[2],
              { id: f.submitter.userId, trusted: true, permissions: [] },
              'workflow-fixture',
            )
          : submit(`/vou/${entity}/submit-new`, input)
      const pending = await create()
      const repeat = await create()
      assert.deepEqual(repeat, pending)
      const result = await review(`/vou/${entity}/approve`, {
        documentId: input.documentId,
        submissionId: input.submissionId,
        expectedRevision: pending.revision,
      })
      return { ...result, input }
    }
    const line = {
      ...f.salePayload.productLines[0]!,
      lineId: ulid(),
      enteredQuantity: '1360',
      baseQuantity: '1360',
      unitPrice: '5.430123',
      agreedAmount: '7379.88',
    }
    const sale = await approved('sale-order', {
      ...f.salePayload,
      productLines: [line],
    })
    const read = await submit('/vou/sale-order/get', {
      documentId: sale.documentId,
    })
    assert.equal(read.payload.productLines[0].unitPrice, '5.430123')
    assert.equal(read.payload.productLines[0].agreedAmount, '7379.88')
    const list = await submit('/vou/sale-order/query', {
      page: 1,
      pageSize: 20,
      filters: {},
    })
    assert.equal(
      list.items.find(
        (r: { documentId: string }) => r.documentId === sale.documentId,
      ).amount,
      '7379.88',
    )
    const sourceLines = [{ sourceLineId: line.lineId, baseQuantity: '680' }]
    const base = {
      businessDate: f.salePayload.businessDate,
      currency: 'CNY',
      attachments: [],
    }
    const out = await approved('sale-outbound', {
      ...base,
      parentEntity: 'sale-order',
      parentDocumentId: sale.documentId,
      sourceLines,
    })
    const delivery = await approved('sale-delivery', {
      ...base,
      parentEntity: 'sale-outbound',
      parentDocumentId: out.documentId,
      sourceLines,
    })
    const sign = await approved('sale-signoff', {
      ...base,
      parentEntity: 'sale-delivery',
      parentDocumentId: delivery.documentId,
      customer: f.salePayload.customer,
      expectedSolventContainers: 0,
      expectedResinContainers: 0,
      returnedSolventContainers: 0,
      returnedResinContainers: 0,
      signoffLines: [
        {
          sourceLineId: line.lineId,
          signedBaseQuantity: '680',
          rejectedBaseQuantity: '0',
        },
      ],
    })
    const purchase = await approved('purchase-order', {
      ...purchasePayload,
      productLines: [{ ...line, lineId: ulid() }],
    })
    const purchaseLine = purchase.payload.productLines[0].lineId
    const inbound = await approved('purchase-inbound', {
      ...base,
      parentEntity: 'purchase-order',
      parentDocumentId: purchase.documentId,
      supplier: purchasePayload.supplier,
      warehouse: purchasePayload.warehouse,
      sourceLines: [{ sourceLineId: purchaseLine, baseQuantity: '680' }],
    })
    for (const [entity, id] of [
      ['sale-invoice', sign.documentId],
      ['purchase-invoice', inbound.documentId],
    ] as const) {
      const sources = await invoiceSources(db, entity, '9999-12-31')
      const source = sources.find((row) => row.sourceDocumentId === id)!
      assert.equal(source.amount, '3689.94')
      assert.equal(source.availableAmount, '3689.94')
      assert.ok(!('pricing' in source))
    }
    const tx = db as unknown as Transaction<DB>
    assert.equal(
      (
        await sourceInventoryMovements(tx, 'purchase-inbound', inbound.payload)
      )[0]!.amount,
      '3689.94',
    )
    assert.equal(
      (
        await sourceSettlementMovements(
          tx,
          'sale-signoff',
          sign.payload,
          sign.documentId,
        )
      )[0]!.amount,
      '3689.94',
    )
    await approved('purchase-return', {
      ...base,
      parentEntity: 'purchase-order',
      parentDocumentId: purchase.documentId,
      supplier: purchasePayload.supplier,
      warehouse: purchasePayload.warehouse,
      returnReason: '部分退货',
      returnLines: [
        {
          sourceDocumentId: inbound.documentId,
          sourceLineId: purchaseLine,
          baseQuantity: '340',
        },
      ],
    })
    assert.equal(
      (await invoiceSources(db, 'purchase-invoice', '9999-12-31')).find(
        (row) => row.sourceDocumentId === inbound.documentId,
      )!.availableAmount,
      '1844.97',
    )
    const acc = new AccService(db),
      actor = {
        id: f.submitter.userId,
        trusted: true,
        permissions: ['/acc/mapping/save'],
      },
      other = { ...actor, id: f.reviewer.userId }
    const book = await acc.createBook(
      {
        id: ulid(),
        name: '约定金额实际记账',
        description: '独占功能测试',
        startMonth: '2026-09',
        baseCurrency: 'CNY',
        subjectTemplate: 'EMPTY',
        queryUserIds: [actor.id, other.id],
        operateUserIds: [actor.id, other.id],
      },
      actor,
    )
    const opening = new VouOpeningService(db, acc)
    const empty = await opening.submitOpening(
      {
        bookId: book.id,
        submissionId: ulid(),
        idempotencyKey: ulid(),
        lines: [],
        assets: [],
        bills: [],
        containers: [],
      },
      actor,
      'amount-fixture',
    )
    await opening.reviewOpening(
      'approve',
      {
        bookId: book.id,
        submissionId: empty.submissionId,
        expectedRevision: empty.revision,
      },
      other,
      'amount-fixture',
    )
    const common = {
      bookId: book.id,
      parentId: null,
      enabled: true,
      inventoryQuantity: false,
    }
    const ar = await acc.createSubject(
      {
        ...common,
        id: ulid(),
        code: 'AR',
        name: '应收',
        balanceDirection: 'DEBIT',
        requiredDimensions: ['CUSTOMER'],
        settlementPurpose: 'RECEIVABLE',
      },
      actor,
    )
    const income = await acc.createSubject(
      {
        ...common,
        id: ulid(),
        code: 'REV',
        name: '收入',
        balanceDirection: 'CREDIT',
        requiredDimensions: [],
        settlementPurpose: 'NONE',
      },
      actor,
    )
    await new AccMappingCatalogService(db).save(
      {
        bookId: book.id,
        vouEntity: 'sale-signoff',
        expectedRevision: null,
        defaultResult: 'POST',
        definition: {
          defaultTemplateId: 'income',
          rules: [],
          assetConfiguration: null,
          templates: [
            {
              templateId: 'income',
              collection: 'settlementMovements',
              lines: [
                {
                  subjectSource: 'FIXED',
                  subjectValue: ar.id,
                  direction: 'DEBIT',
                  amountField: 'line.amount',
                  currencyField: 'line.currency',
                  dimensions: { CUSTOMER: 'line.counterpartyId' },
                  quantityField: null,
                  costCounterpartSubjectId: null,
                  costCounterpartDimensions: {},
                },
                {
                  subjectSource: 'FIXED',
                  subjectValue: income.id,
                  direction: 'CREDIT',
                  amountField: 'line.amount',
                  currencyField: 'line.currency',
                  dimensions: {},
                  quantityField: null,
                  costCounterpartSubjectId: null,
                  costCounterpartDimensions: {},
                },
              ],
            },
          ],
        },
      },
      actor,
    )
    await acc.apply(tx, {
      kind: 'acc',
      action: 'approve',
      entity: 'sale-signoff',
      documentId: sign.documentId,
      documentNo: sign.documentNo,
      approvalEntryId: sign.submissionId,
      approvalRevision: sign.revision,
      payload: sign.payload,
      occurredAt: new Date().toISOString(),
    })
    const posted = await sql<{
      amount: string
    }>`SELECT amount::text AS amount FROM acc_journal_lines line JOIN acc_journal_entries v ON v.id=line.journal_entry_id WHERE v.book_id=${book.id} AND v.vou_document_id=${sign.documentId}`.execute(
      db,
    )
    assert.equal(posted.rows.length, 2)
    assert.ok(
      posted.rows.every(
        (row) => intermediaryUnits(row.amount, 8) === 368994000000n,
      ),
    )
  })
})

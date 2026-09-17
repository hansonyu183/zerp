import assert from 'node:assert/strict'
import test from 'node:test'
import { ulid } from 'ulid'
import type {
  ApprovalAction,
  VouEntity,
  VouPayload,
  VouPayloadFor,
} from '@zerp/model'
import { withWflDatabase } from './wfl-fixture.ts'
import { seedVouCatalogFixture } from '../fixtures/vou-catalog.ts'
import { VouService, type VouView } from '../../src/vou/service.ts'
import { AccService } from '../../src/acc/service.ts'

async function invoiceFixture(
  db: Parameters<Parameters<typeof withWflDatabase>[0]>[0],
) {
  const fixture = await seedVouCatalogFixture(db)
  const vou = new VouService(db, {
    acc: new AccService(db),
    wfl: { async apply() {} },
  })
  async function submit(entity: VouEntity, payload: VouPayload) {
    const submissionId = ulid()
    return vou.submit(
      entity,
      'submit-new',
      {
        documentId: ulid(),
        submissionId,
        idempotencyKey: submissionId,
        expectedRevision: null,
        payload,
      },
      fixture.actor,
      'invoice-amount-regression',
    )
  }
  async function review(
    entity: VouEntity,
    action: ApprovalAction,
    document: VouView,
  ) {
    return vou.review(
      entity,
      action,
      {
        documentId: document.documentId,
        submissionId: document.submissionId,
        expectedRevision: document.revision,
        ...(action === 'reject' || action === 'unapprove'
          ? { reason: '金额占用验收' }
          : {}),
      },
      fixture.reviewerActor,
      'invoice-amount-regression',
    )
  }
  const approve = (entity: VouEntity, document: VouView) =>
    review(entity, 'approve', document)
  async function saleSource(quantity: string) {
    const original = fixture.documents['sale-order']
      .payload as VouPayloadFor<'sale-order'>
    const order = await approve(
      'sale-order',
      await submit('sale-order', {
        ...original,
        productLines: original.productLines.map((line) => ({
          ...line,
          unitPrice: '0.01',
          baseQuantity: '1.000000',
          enteredQuantity: '1.000000',
        })),
      }),
    )
    const source = await approve(
      'sale-signoff',
      await submit('sale-signoff', {
        ...(fixture.documents['sale-signoff']
          .payload as VouPayloadFor<'sale-signoff'>),
        parentDocumentId: order.documentId,
        signoffLines: [
          {
            sourceLineId: original.productLines[0]!.lineId,
            signedBaseQuantity: quantity,
            rejectedBaseQuantity: '0.000000',
          },
        ],
      }),
    )
    return {
      order,
      source,
      lineId: original.productLines[0]!.lineId,
      options: () =>
        vou.invoiceSourceOptions(
          'sale-invoice',
          {
            objectId: original.customer.objectId,
            operatingEntityId: original.operatingEntity.objectId,
            businessDate: original.businessDate,
            currency: original.currency,
          },
          fixture.actor,
        ),
    }
  }
  return { ...fixture, vou, submit, review, approve, saleSource }
}

test('invoice sources round a half-cent signoff to one cent', async () => {
  await withWflDatabase(async (db) => {
    const fixture = await invoiceFixture(db)
    const source = await fixture.saleSource('0.500000')
    const result = await source.options()
    assert.equal(
      result.items.find(
        (item) => item.sourceDocumentId === source.source.documentId,
      )?.availableAmount,
      '0.01',
    )
  })
})

test('two half-unit returns consume one cent once and leave no invoiceable amount', async () => {
  await withWflDatabase(async (db) => {
    const fixture = await invoiceFixture(db)
    const source = await fixture.saleSource('1.000000')
    for (let index = 0; index < 2; index++) {
      const returned = await fixture.approve(
        'sale-return',
        await fixture.submit('sale-return', {
          ...(fixture.documents['sale-return']
            .payload as VouPayloadFor<'sale-return'>),
          parentDocumentId: source.order.documentId,
          returnLines: [
            {
              sourceDocumentId: source.source.documentId,
              sourceLineId: source.lineId,
              baseQuantity: '0.500000',
            },
          ],
        }),
      )
      assert.equal(returned.status, 'APPROVED')
    }
    assert.equal(
      (await source.options()).items.some(
        (item) => item.sourceDocumentId === source.source.documentId,
      ),
      false,
    )
    await assert.rejects(
      fixture.submit('sale-invoice', {
        ...(fixture.documents['sale-invoice']
          .payload as VouPayloadFor<'sale-invoice'>),
        invoiceLines: [
          {
            sourceDocumentId: source.source.documentId,
            sourceApprovalEntryId: source.source.submissionId,
            sourceLineId: source.lineId,
            amount: '0.01',
          },
        ],
      }),
      /vou_invoice_source_unavailable/,
    )
  })
})

test('restoring rejected sales and purchase invoices rechecks occupied source amounts atomically', async () => {
  await withWflDatabase(async (db) => {
    const fixture = await invoiceFixture(db)
    for (const entity of ['sale-invoice', 'purchase-invoice'] as const) {
      const base = fixture.documents[entity].payload as VouPayloadFor<
        typeof entity
      >
      const party = 'customer' in base ? base.customer : base.supplier
      const options = await fixture.vou.invoiceSourceOptions(
        entity,
        {
          objectId: party.objectId,
          operatingEntityId: base.operatingEntity.objectId,
          businessDate: base.businessDate,
          currency: base.currency,
        },
        fixture.actor,
      )
      const source = options.items.find(
        (item) =>
          item.sourceDocumentId === base.invoiceLines[0]!.sourceDocumentId &&
          item.sourceLineId === base.invoiceLines[0]!.sourceLineId,
      )!
      assert.ok(source)
      const payload = {
        ...base,
        invoiceLines: [
          { ...base.invoiceLines[0]!, amount: source.availableAmount },
        ],
      }
      const first = await fixture.submit(entity, payload)
      const rejected = await fixture.review(entity, 'reject', first)
      const second = await fixture.submit(entity, payload)
      await assert.rejects(
        fixture.review(entity, 'unreject', rejected),
        /vou_invoice_source_unavailable/,
      )
      const unchanged = await fixture.vou.get(
        entity,
        rejected.documentId,
        fixture.actor,
      )
      assert.equal(unchanged.status, 'REJECTED')
      assert.equal(unchanged.revision, rejected.revision)
      await fixture.review(entity, 'reject', second)
      const restored = await fixture.review(entity, 'unreject', rejected)
      assert.equal(restored.status, 'PENDING')
      assert.equal((await fixture.approve(entity, restored)).status, 'APPROVED')
    }
  })
})

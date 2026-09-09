import assert from 'node:assert/strict'
import test from 'node:test'
import { ulid } from 'ulid'
import type { VouPayloadFor } from '@zerp/model'
import { withWflDatabase } from './wfl-fixture.ts'
import { seedVouCatalogFixture } from '../fixtures/vou-catalog.ts'
import { VouService } from '../../src/vou/service.ts'
import { AccService } from '../../src/acc/service.ts'

test('bill entry validates current bill position, dates and actual cash before saving', async () => {
  await withWflDatabase(async (db) => {
    const f = await seedVouCatalogFixture(db)
    const payload = f.documents['bill-payment']
      .payload as VouPayloadFor<'bill-payment'>
    const id = ulid()
    await assert.rejects(
      f.vou.submit(
        'bill-payment',
        'submit-new',
        {
          documentId: ulid(),
          submissionId: id,
          idempotencyKey: id,
          expectedRevision: null,
          payload: {
            ...payload,
            billLines: [{ billId: ulid(), purpose: 'PRIMARY' }],
          },
        },
        f.actor,
        'bill-missing',
      ),
      /vou_reference_unavailable/,
    )
    const vou = new VouService(db, {
      acc: new AccService(db),
      wfl: { async apply() {} },
    })
    const sourcePayload = f.documents['bill-issue']
      .payload as VouPayloadFor<'bill-issue'>
    const sourceId = ulid()
    const source = await vou.submit(
      'bill-issue',
      'submit-new',
      {
        documentId: ulid(),
        submissionId: sourceId,
        idempotencyKey: sourceId,
        expectedRevision: null,
        payload: sourcePayload,
      },
      f.actor,
      'bill-source',
    )
    await vou.review(
      'bill-issue',
      'approve',
      {
        documentId: source.documentId,
        submissionId: source.submissionId,
        expectedRevision: source.revision,
      },
      f.reviewerActor,
      'bill-source',
    )
    const bill = await db
      .selectFrom('acc_bill_registers')
      .select('id')
      .where('created_vou_approval_entry_id', '=', sourceId)
      .executeTakeFirstOrThrow()
    const wrongId = ulid()
    await assert.rejects(
      f.vou.submit(
        'bill-payment',
        'submit-new',
        {
          documentId: ulid(),
          submissionId: wrongId,
          idempotencyKey: wrongId,
          expectedRevision: null,
          payload: {
            ...payload,
            billLines: [{ billId: bill.id, purpose: 'PRIMARY' }],
          },
        },
        f.actor,
        'bill-wrong-position',
      ),
      /vou_reference_unavailable/,
    )
  })
})

test('bill payment, discount and maturity adopt fixed facts and preserve register reversal blockers', async () => {
  await withWflDatabase(async (db) => {
    const f = await seedVouCatalogFixture(db)
    const vou = new VouService(db, {
      acc: new AccService(db),
      wfl: { async apply() {} },
    })
    const receiptPayload = f.documents['bill-receipt']
      .payload as VouPayloadFor<'bill-receipt'>
    const sourceId = ulid()
    let source = await vou.submit(
      'bill-receipt',
      'submit-new',
      {
        documentId: ulid(),
        submissionId: sourceId,
        idempotencyKey: sourceId,
        expectedRevision: null,
        payload: receiptPayload,
      },
      f.actor,
      'bill-source',
    )
    source = await vou.review(
      'bill-receipt',
      'approve',
      {
        documentId: source.documentId,
        submissionId: source.submissionId,
        expectedRevision: source.revision,
      },
      f.reviewerActor,
      'bill-source',
    )
    const bill = await db
      .selectFrom('acc_bill_registers')
      .select('id')
      .where('created_vou_approval_entry_id', '=', sourceId)
      .executeTakeFirstOrThrow()
    for (const entity of [
      'bill-payment',
      'bill-discount',
      'bill-maturity',
    ] as const) {
      const payload = f.documents[entity].payload as VouPayloadFor<
        typeof entity
      >
      const id = ulid()
      const input = {
        documentId: ulid(),
        submissionId: id,
        idempotencyKey: id,
        expectedRevision: null,
        payload: {
          ...payload,
          businessDate:
            entity === 'bill-maturity' ? '2026-12-04' : '2026-09-09',
          billLines: [
            {
              billId: bill.id,
              purpose: 'PRIMARY' as const,
              ...(entity === 'bill-discount' ? { annualRateBps: 300 } : {}),
            },
          ],
        },
      }
      if (entity === 'bill-maturity')
        await assert.rejects(
          vou.submit(
            entity,
            'submit-new',
            {
              ...input,
              payload: { ...input.payload, businessDate: '2026-09-09' },
            },
            f.actor,
            'bill-too-early',
          ),
          /vou_reference_unavailable/,
        )
      if (entity === 'bill-discount')
        await assert.rejects(
          vou.submit(
            entity,
            'submit-new',
            { ...input, payload: { ...input.payload, billCashLines: [] } },
            f.actor,
            'bill-no-cash',
          ),
          /vou_invalid_payload/,
        )
      let document = await vou.submit(
        entity,
        'submit-new',
        input,
        f.actor,
        'bill-use',
      )
      const adopted = (document.payload as VouPayloadFor<typeof entity>)
        .billLines[0]!
      assert.ok(!('positionType' in adopted))
      assert.equal(adopted.snapshot?.faceAmount, '12.30')
      assert.equal(adopted.snapshot?.direction, 'OUT')
      assert.equal(
        adopted.snapshot?.annualRateBps,
        entity === 'bill-discount' ? 300 : 0,
      )
      document = await vou.review(
        entity,
        'approve',
        {
          documentId: document.documentId,
          submissionId: document.submissionId,
          expectedRevision: document.revision,
        },
        f.reviewerActor,
        'bill-use',
      )
      assert.equal(
        (
          await db
            .selectFrom('acc_bill_registers')
            .select('status')
            .where('id', '=', bill.id)
            .executeTakeFirstOrThrow()
        ).status,
        entity === 'bill-payment'
          ? 'PAID'
          : entity === 'bill-discount'
            ? 'DISCOUNTED'
            : 'MATURED',
      )
      await assert.rejects(
        vou.review(
          'bill-receipt',
          'unapprove',
          {
            documentId: source.documentId,
            submissionId: source.submissionId,
            expectedRevision: source.revision,
            reason: '测试撤回',
          },
          f.reviewerActor,
          'bill-blocker',
        ),
        /acc_register_unapprove_blocked/,
      )
      const retryId = ulid()
      await assert.rejects(
        vou.submit(
          entity,
          'submit-new',
          {
            ...input,
            documentId: ulid(),
            submissionId: retryId,
            idempotencyKey: retryId,
          },
          f.actor,
          'bill-used',
        ),
        /vou_reference_unavailable/,
      )
      await vou.review(
        entity,
        'unapprove',
        {
          documentId: document.documentId,
          submissionId: document.submissionId,
          expectedRevision: document.revision,
          reason: '测试恢复',
        },
        f.reviewerActor,
        'bill-reverse',
      )
      assert.equal(
        (
          await db
            .selectFrom('acc_bill_registers')
            .select('status')
            .where('id', '=', bill.id)
            .executeTakeFirstOrThrow()
        ).status,
        'AVAILABLE',
      )
    }
  })
})

test('separate pending receipts cannot approve duplicate bill identities', async () => {
  await withWflDatabase(async (db) => {
    const f = await seedVouCatalogFixture(db)
    const vou = new VouService(db, {
      acc: new AccService(db),
      wfl: { async apply() {} },
    })
    const payload = f.documents['bill-receipt']
      .payload as VouPayloadFor<'bill-receipt'>
    const documents = []
    for (let index = 0; index < 2; index++) {
      const id = ulid()
      documents.push(
        await vou.submit(
          'bill-receipt',
          'submit-new',
          {
            documentId: ulid(),
            submissionId: id,
            idempotencyKey: id,
            expectedRevision: null,
            payload,
          },
          f.actor,
          'duplicate-bill',
        ),
      )
    }
    for (const [index, document] of documents.entries()) {
      const command = () =>
        vou.review(
          'bill-receipt',
          'approve',
          {
            documentId: document.documentId,
            submissionId: document.submissionId,
            expectedRevision: document.revision,
          },
          f.reviewerActor,
          'duplicate-bill',
        )
      if (index === 0) await command()
      else await assert.rejects(command(), /vou_reference_unavailable/)
    }
  })
})

test('receipt uses 365-day annual interest and a one-time internal customer cost in its immutable snapshot', async () => {
  await withWflDatabase(async (db) => {
    const f = await seedVouCatalogFixture(db)
    const payload = f.documents['bill-receipt']
      .payload as VouPayloadFor<'bill-receipt'>
    const first = payload.billLines[0]!
    assert.ok('billNo' in first)
    const id = ulid()
    const saved = await f.vou.submit(
      'bill-receipt',
      'submit-new',
      {
        documentId: ulid(),
        submissionId: id,
        idempotencyKey: id,
        expectedRevision: null,
        payload: {
          ...payload,
          businessDate: '2026-09-01',
          internalCostRateBps: 125,
          billLines: [
            {
              ...first,
              billNo: ulid(),
              faceAmount: '10000.01',
              issueDate: '2026-09-01',
              maturityDate: '2026-12-02',
              annualRateBps: 300,
            },
          ],
        },
      },
      f.actor,
      'bill-interest',
    )
    assert.partialDeepStrictEqual(saved.payload, {
      billLines: [
        {
          calculation: {
            interestDays: 92,
            interestAmount: '75.62',
            customerCostAmount: '125.00',
          },
        },
      ],
    })
    assert.deepEqual(
      (await f.vou.get('bill-receipt', saved.documentId, f.actor)).payload,
      saved.payload,
    )
  })
})

test('bill outflow only adopts bills carried by an active control book', async () => {
  await withWflDatabase(async (db) => {
    const f = await seedVouCatalogFixture(db)
    const vou = new VouService(db, {
      acc: new AccService(db),
      wfl: { async apply() {} },
    })
    const payload = f.documents['bill-receipt']
      .payload as VouPayloadFor<'bill-receipt'>
    const first = payload.billLines[0]!
    assert.ok('positionType' in first)
    const id = ulid()
    const document = await vou.submit(
      'bill-receipt',
      'submit-new',
      {
        documentId: ulid(),
        submissionId: id,
        idempotencyKey: id,
        expectedRevision: null,
        payload: {
          ...payload,
          businessDate: '2026-08-01',
          billLines: [{ ...first, billNo: ulid(), issueDate: '2026-08-01' }],
        },
      },
      f.actor,
      'before-book',
    )
    const approved = await vou.review(
      'bill-receipt',
      'approve',
      {
        documentId: document.documentId,
        submissionId: id,
        expectedRevision: document.revision,
      },
      f.reviewerActor,
      'before-book',
    )
    const billId = (approved.payload as VouPayloadFor<'bill-receipt'>)
      .billLines[0]!.billId!
    const payment = f.documents['bill-payment']
      .payload as VouPayloadFor<'bill-payment'>
    const paymentId = ulid()
    await assert.rejects(
      vou.submit(
        'bill-payment',
        'submit-new',
        {
          documentId: ulid(),
          submissionId: paymentId,
          idempotencyKey: paymentId,
          expectedRevision: null,
          payload: { ...payment, billLines: [{ billId, purpose: 'PRIMARY' }] },
        },
        f.actor,
        'not-carried',
      ),
      /vou_reference_unavailable/,
    )
  })
})

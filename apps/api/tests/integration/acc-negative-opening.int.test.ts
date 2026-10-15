import assert from 'node:assert/strict'
import test from 'node:test'
import { ulid } from 'ulid'
import { sql } from 'kysely'
import { modelBuildId, type VouPayloadFor } from '@zerp/model'
import { createApp } from '../../src/app.ts'
import { SessionService } from '../../src/app/session.ts'
import { loadConfig } from '../../src/platform/config.ts'
import { withWflDatabase } from './wfl-fixture.ts'
import { seedStockFixture } from '../fixtures/vou-stock.ts'
import { approveEmptyIntermediaryMonth } from '../fixtures/vou-intermediary.ts'

test('normal HTTP carries a negative opening, allows staged replenishment and rejects new deficits and unsafe reversal', async () => {
  await withWflDatabase(async (db) => {
    const f = await seedStockFixture(
      db,
      '2026-09',
      { quantity: '6', amount: '12.00' },
      false,
    )
    const extra = await db
      .selectFrom('app_permissions')
      .select('id')
      .where('path', 'in', [
        '/vou/opening/submit-new',
        '/vou/opening/delete',
        '/vou/opening/approve',
        '/vou/opening/get',
        '/acc/period/lock',
        '/vou/purchase-return/delete',
        '/vou/purchase-order/delete',
      ])
      .execute()
    assert.equal(extra.length, 7)
    await db
      .insertInto('app_role_permissions')
      .values(
        [f.submitter.roleId, f.reviewer.roleId].flatMap((roleId) =>
          extra.map((p) => ({
            role_id: roleId,
            permission_id: p.id,
            purchase_inbound_scope: 'ALL',
            service_contexts: [],
          })),
        ),
      )
      .onConflict((c) => c.doNothing())
      .execute()
    await f.mappings.save(
      {
        bookId: f.book.id,
        vouEntity: 'purchase-order',
        expectedRevision: null,
        defaultResult: 'UN_POST',
        definition: {
          defaultTemplateId: null,
          rules: [],
          templates: [],
          assetConfiguration: null,
        },
      },
      f.actor,
    )
    await f.quantityMapping('purchase-inbound')
    await f.quantityMapping('purchase-return', f.equity.id)
    const config = loadConfig({
      DATABASE_URL: process.env.TARGET_TEST_DATABASE_URL!,
      APP_SESSION_COOKIE_SECURE: 'false',
    })
    const app = createApp({
      config,
      session: new SessionService(db, config),
      vou: f.vou,
      opening: f.openings,
      acc: f.acc,
    })
    async function client(principal: typeof f.submitter) {
      const response = await app.request('/session/auth/signin', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-zerp-model-build': modelBuildId,
        },
        body: JSON.stringify({
          code: principal.username,
          password: principal.password,
        }),
      })
      const auth = await response.json()
      assert.equal(auth.code, 0)
      return async (path: string, input: unknown) => {
        const result = await app.request(path, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-zerp-model-build': modelBuildId,
            'x-csrf-token': auth.data.csrfToken,
            cookie: response.headers.getSetCookie()[0]!,
          },
          body: JSON.stringify(input),
        })
        return result.json()
      }
    }
    const post = await client(f.submitter),
      review = await client(f.reviewer)
    const original = f.purchase.payload as VouPayloadFor<'purchase-order'>
    const balance = async () =>
      (
        await sql<{
          quantity: string
        }>`SELECT COALESCE(SUM(quantity),0)::text AS quantity FROM acc_inventory_entries WHERE book_id=${f.book.id} AND warehouse_id=${original.warehouse.objectId} AND product_id=${f.rawId}`.execute(
          db,
        )
      ).rows[0]!.quantity
    assert.equal(
      (
        await post('/vou/opening/delete', {
          bookId: f.book.id,
          submissionId: f.opening.submissionId,
          expectedRevision: f.opening.approval.revision,
        })
      ).code,
      0,
    )
    assert.equal(
      (
        await post('/vou/purchase-order/delete', {
          documentId: f.purchase.documentId,
          submissionId: f.purchase.submissionId,
          expectedRevision: f.purchase.revision,
        })
      ).code,
      0,
    )
    const openingId = ulid()
    const openingInput = {
      bookId: f.book.id,
      submissionId: openingId,
      idempotencyKey: openingId,
      assets: [],
      bills: [],
      containers: [],
      lines: [
        {
          subjectId: f.subject.id,
          currency: 'CNY',
          direction: 'CREDIT',
          amount: '12.00',
          quantity: '6.000001',
          dimensions: {
            PRODUCT: f.rawId,
            WAREHOUSE: original.warehouse.objectId,
          },
        },
        {
          subjectId: f.equity.id,
          currency: 'CNY',
          direction: 'DEBIT',
          amount: '12.00',
          dimensions: {},
        },
      ],
    }
    const rejectedId = ulid()
    const zeroValue = await post('/vou/opening/submit-new', {
      ...openingInput,
      submissionId: rejectedId,
      idempotencyKey: rejectedId,
      lines: openingInput.lines.map((line) => ({ ...line, amount: '0.00' })),
    })
    assert.equal(zeroValue.errorKey, 'acc_inventory_quantity_invalid')
    const saved = await post('/vou/opening/submit-new', openingInput)
    assert.equal(saved.code, 0, JSON.stringify(saved))
    assert.equal(
      (await post('/vou/opening/submit-new', openingInput)).data.submissionId,
      openingId,
    )
    const approved = await review('/vou/opening/approve', {
      bookId: f.book.id,
      submissionId: openingId,
      expectedRevision: saved.data.approval.revision,
    })
    assert.equal(approved.code, 0, JSON.stringify(approved))
    assert.equal(await balance(), '-6.00000100')
    const got = await post('/vou/opening/get', { bookId: f.book.id })
    assert.equal(got.data.payload.lines[0].direction, 'CREDIT')
    assert.equal(got.data.payload.lines[0].quantity, '6.000001')

    const orderId = ulid(),
      orderEntry = ulid(),
      lineId = ulid()
    const order = await post('/vou/purchase-order/submit-new', {
      documentId: orderId,
      submissionId: orderEntry,
      idempotencyKey: orderEntry,
      expectedRevision: null,
      payload: {
        ...original,
        businessDate: '2026-09-01',
        productLines: [
          {
            ...original.productLines[0]!,
            lineId,
            enteredQuantity: '9',
            baseQuantity: '9',
            unitPrice: '2.00',
          },
        ],
      },
    })
    assert.equal(order.code, 0, JSON.stringify(order))
    const orderApproved = await review('/vou/purchase-order/approve', {
      documentId: orderId,
      submissionId: orderEntry,
      expectedRevision: order.data.revision,
    })
    assert.equal(orderApproved.code, 0, JSON.stringify(orderApproved))
    async function inbound(quantity: string, businessDate: string) {
      const documentId = ulid(),
        submissionId = ulid()
      const input = {
        documentId,
        submissionId,
        idempotencyKey: submissionId,
        expectedRevision: null,
        payload: {
          businessDate,
          currency: 'CNY',
          attachments: [],
          supplier: original.supplier,
          warehouse: original.warehouse,
          parentEntity: 'purchase-order',
          parentDocumentId: orderId,
          sourceLines: [{ sourceLineId: lineId, baseQuantity: quantity }],
        },
      }
      const saved = await post('/vou/purchase-inbound/submit-new', input)
      assert.equal(saved.code, 0, JSON.stringify(saved))
      const approved = await review('/vou/purchase-inbound/approve', {
        documentId,
        submissionId,
        expectedRevision: saved.data.revision,
      })
      assert.equal(approved.code, 0, JSON.stringify(approved))
      const repeated = await post('/vou/purchase-inbound/submit-new', input)
      assert.deepEqual(repeated.data, saved.data)
      return { documentId, submissionId, revision: approved.data.revision }
    }
    async function returnOne(
      source: Awaited<ReturnType<typeof inbound>>,
      businessDate = '2026-09-06',
    ) {
      const documentId = ulid(),
        submissionId = ulid()
      const pending = await post('/vou/purchase-return/submit-new', {
        documentId,
        submissionId,
        idempotencyKey: submissionId,
        expectedRevision: null,
        payload: {
          businessDate,
          currency: 'CNY',
          attachments: [],
          supplier: original.supplier,
          warehouse: original.warehouse,
          parentEntity: 'purchase-order',
          parentDocumentId: orderId,
          returnReason: '库存缺口控制回归',
          returnLines: [
            {
              sourceDocumentId: source.documentId,
              sourceLineId: lineId,
              baseQuantity: '1',
            },
          ],
        },
      })
      assert.equal(pending.code, 0, JSON.stringify(pending))
      const approved = await review('/vou/purchase-return/approve', {
        documentId,
        submissionId,
        expectedRevision: pending.data.revision,
      })
      return {
        documentId,
        submissionId,
        pending: pending.data,
        result: approved,
      }
    }
    const first = await inbound('3.000001', '2026-09-02')
    assert.equal(await balance(), '-3.00000000')
    const worsening = await returnOne(first)
    assert.equal(worsening.result.errorKey, 'acc_negative_inventory')
    assert.equal(await balance(), '-3.00000000')
    assert.equal(
      (
        await post('/vou/purchase-return/get', {
          documentId: worsening.documentId,
        })
      ).data.status,
      'PENDING',
    )
    assert.equal(
      (
        await sql<{
          n: string
        }>`SELECT count(*)::text AS n FROM acc_journal_entries WHERE vou_approval_entry_id=${worsening.submissionId}`.execute(
          db,
        )
      ).rows[0]!.n,
      '0',
    )
    assert.equal(
      (
        await post('/vou/purchase-return/delete', {
          documentId: worsening.documentId,
          submissionId: worsening.submissionId,
          expectedRevision: worsening.pending.revision,
        })
      ).code,
      0,
    )
    await approveEmptyIntermediaryMonth(
      db,
      f.vou,
      '2026-09-30',
      f.actor,
      f.reviewerActor,
    )
    const lock = await review('/acc/period/lock', {
      bookId: f.book.id,
      month: '2026-09',
      expectedRevision: null,
    })
    assert.equal(lock.errorKey, 'acc_period_negative_inventory')
    const second = await inbound('3', '2026-09-03')
    assert.equal(await balance(), '0.00000000')
    const unsafeReverse = await review('/vou/purchase-inbound/unapprove', {
      documentId: second.documentId,
      submissionId: second.submissionId,
      expectedRevision: second.revision,
      reason: '不能重新造成缺口',
    })
    assert.equal(unsafeReverse.errorKey, 'acc_negative_inventory')
    assert.equal(await balance(), '0.00000000')
    const third = await inbound('2', '2026-09-04')
    assert.equal(await balance(), '2.00000000')
    const backdated = await returnOne(first, '2026-09-02')
    assert.equal(backdated.result.errorKey, 'acc_negative_inventory')
    assert.equal(await balance(), '2.00000000')
    assert.equal(
      (
        await post('/vou/purchase-return/delete', {
          documentId: backdated.documentId,
          submissionId: backdated.submissionId,
          expectedRevision: backdated.pending.revision,
        })
      ).code,
      0,
    )
    const ordinary = await returnOne(third)
    assert.equal(ordinary.result.code, 0, JSON.stringify(ordinary.result))
    assert.equal(await balance(), '1.00000000')
    assert.equal(
      (
        await post('/vou/purchase-inbound/get', {
          documentId: second.documentId,
        })
      ).data.status,
      'APPROVED',
    )
    const closed = await review('/acc/period/lock', {
      bookId: f.book.id,
      month: '2026-09',
      expectedRevision: null,
    })
    assert.equal(closed.code, 0, JSON.stringify(closed))
    assert.equal(closed.data.locked, true)
    assert.deepEqual(
      (
        await sql<{
          cost: string
          adjustment: string
        }>`SELECT allocation.cost_amount::text AS cost, allocation.adjustment_amount::text AS adjustment FROM acc_inventory_cost_allocations allocation JOIN acc_inventory_entries inventory ON inventory.id=allocation.inventory_entry_id WHERE inventory.document_id=${ordinary.documentId}`.execute(
          db,
        )
      ).rows,
      [{ cost: '-2.00000000', adjustment: '-2.00000000' }],
    )
    assert.equal(
      (
        await sql<{
          balance: string
        }>`SELECT closing_balance::text AS balance FROM acc_period_balances WHERE book_id=${f.book.id} AND subject_id=${f.subject.id}`.execute(
          db,
        )
      ).rows[0]!.balance,
      '2.00000000',
    )
  })
})

for (const scenario of [
  {
    name: 'positive net opening',
    quantity: '8',
    amount: '16.00',
    equityDirection: 'CREDIT',
    equityAmount: '4.00',
    errorKey: null,
  },
  {
    name: 'fully offset opening',
    quantity: '6',
    amount: '12.00',
    equityDirection: 'CREDIT',
    equityAmount: '0.00',
    errorKey: null,
  },
  {
    name: 'negative net value',
    quantity: '8',
    amount: '4.00',
    equityDirection: 'DEBIT',
    equityAmount: '8.00',
    errorKey: 'acc_period_cost_basis_missing',
  },
  {
    name: 'zero quantity with remaining value',
    quantity: '6',
    amount: '14.00',
    equityDirection: 'CREDIT',
    equityAmount: '2.00',
    errorKey: 'acc_period_cost_basis_missing',
  },
] as const) {
  test(`month-end uses atomic mixed opening basis: ${scenario.name}`, async () => {
    await withWflDatabase(async (db) => {
      const f = await seedStockFixture(
        db,
        '2026-09',
        { quantity: '6', amount: '12.00' },
        false,
      )
      const actor = {
        ...f.actor,
        permissions: [
          ...f.actor.permissions,
          '/vou/opening/delete',
          '/vou/purchase-order/delete',
        ],
      }
      await f.openings.deleteOpening(
        {
          bookId: f.book.id,
          submissionId: f.opening.submissionId,
          expectedRevision: f.opening.approval.revision,
        },
        actor,
        'mixed-opening',
      )
      const submissionId = ulid()
      const dimensions = {
        PRODUCT: f.rawId,
        WAREHOUSE: f.salePayload.warehouse.objectId,
      }
      const opening = await f.openings.submitOpening(
        {
          bookId: f.book.id,
          submissionId,
          idempotencyKey: submissionId,
          assets: [],
          bills: [],
          containers: [],
          lines: [
            {
              subjectId: f.subject.id,
              currency: 'CNY',
              direction: 'CREDIT',
              amount: '12.00',
              quantity: '6',
              dimensions,
            },
            {
              subjectId: f.subject.id,
              currency: 'CNY',
              direction: 'DEBIT',
              amount: scenario.amount,
              quantity: scenario.quantity,
              dimensions,
            },
            {
              subjectId: f.equity.id,
              currency: 'CNY',
              direction: scenario.equityDirection,
              amount: scenario.equityAmount,
              dimensions: {},
            },
          ],
        },
        f.actor,
        'mixed-opening',
      )
      await f.openings.reviewOpening(
        'approve',
        {
          bookId: f.book.id,
          submissionId,
          expectedRevision: opening.approval.revision,
        },
        f.reviewerActor,
        'mixed-opening',
      )
      await f.vou.delete(
        'purchase-order',
        {
          documentId: f.purchase.documentId,
          submissionId: f.purchase.submissionId,
          expectedRevision: f.purchase.revision,
        },
        actor,
        'mixed-opening',
      )
      if (scenario.name === 'negative net value') {
        await f.quantityMapping('inventory-count', f.equity.id)
        const documentId = ulid(),
          entryId = ulid()
        const counted = await f.vou.submit(
          'inventory-count',
          'submit-new',
          {
            documentId,
            submissionId: entryId,
            idempotencyKey: entryId,
            expectedRevision: null,
            payload: {
              businessDate: '2026-09-09',
              currency: 'CNY',
              attachments: [],
              warehouse: f.salePayload.warehouse,
              inventoryCountLines: [
                {
                  product: { objectId: f.rawId },
                  enteredQuantity: '0',
                  enteredUnit: f.references.unitSnapshot,
                  baseQuantity: '0',
                },
              ],
            },
          },
          f.actor,
          'negative-cost-basis',
        )
        await f.vou.review(
          'inventory-count',
          'approve',
          {
            documentId,
            submissionId: entryId,
            expectedRevision: counted.revision,
          },
          f.reviewerActor,
          'negative-cost-basis',
        )
      }
      await approveEmptyIntermediaryMonth(
        db,
        f.vou,
        '2026-09-30',
        f.actor,
        f.reviewerActor,
      )
      if (scenario.errorKey) {
        await assert.rejects(
          f.acc.setPeriod(
            { bookId: f.book.id, month: '2026-09', expectedRevision: null },
            true,
            f.actor,
          ),
          { errorKey: scenario.errorKey },
        )
        assert.deepEqual(
          await db
            .selectFrom('acc_inventory_cost_allocations')
            .selectAll()
            .where('book_id', '=', f.book.id)
            .execute(),
          [],
        )
        assert.deepEqual(
          await db
            .selectFrom('acc_periods')
            .selectAll()
            .where('book_id', '=', f.book.id)
            .execute(),
          [],
        )
        return
      }
      const locked = await f.acc.setPeriod(
        { bookId: f.book.id, month: '2026-09', expectedRevision: null },
        true,
        f.actor,
      )
      assert.equal(locked.locked, true)
      assert.deepEqual(
        (
          await sql<{
            cost: string
            adjustment: string
          }>`SELECT cost_amount::text AS cost, adjustment_amount::text AS adjustment FROM acc_inventory_cost_allocations WHERE book_id=${f.book.id} ORDER BY cost_amount`.execute(
            db,
          )
        ).rows,
        [
          { cost: '-12.00000000', adjustment: '0.00000000' },
          { cost: `${scenario.amount}000000`, adjustment: '0.00000000' },
        ],
      )
    })
  })
}

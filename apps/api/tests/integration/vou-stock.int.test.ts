import assert from 'node:assert/strict'
import test from 'node:test'
import { ulid } from 'ulid'
import { sql } from 'kysely'
import { modelBuildId } from '@zerp/model'
import { createApp } from '../../src/app.ts'
import { SessionService } from '../../src/app/session.ts'
import { loadConfig } from '../../src/platform/config.ts'
import { withWflDatabase } from './wfl-fixture.ts'
import { seedStockFixture } from '../fixtures/vou-stock.ts'

test('production posts actual material OUT and finished IN through a quantity-only mapping, and reverses both', async () => {
  await withWflDatabase(async (db) => {
    const fixture = await seedStockFixture(db)
    assert.ok(
      fixture.catalog.vouEntities
        .find((row) => row.code === 'self-production')!
        .fieldCatalog.collections.includes('inventoryMovements'),
    )
    await fixture.quantityMapping('self-production')
    const documentId = ulid(),
      submissionId = ulid()
    const saved = await fixture.vou.submit(
      'self-production',
      'submit-new',
      {
        documentId,
        submissionId,
        idempotencyKey: submissionId,
        expectedRevision: null,
        payload: fixture.productionPayload,
      },
      fixture.actor,
      'stock-production',
    )
    const config = loadConfig({
      DATABASE_URL: process.env.TARGET_TEST_DATABASE_URL!,
      APP_SESSION_COOKIE_SECURE: 'false',
    })
    const app = createApp({
      config,
      session: new SessionService(db, config),
      vou: fixture.vou,
    })
    const signin = await app.request('/session/auth/signin', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-zerp-model-build': modelBuildId,
      },
      body: JSON.stringify({
        code: fixture.reviewer.username,
        password: fixture.reviewer.password,
      }),
    })
    const session = await signin.json()
    assert.equal(session.code, 0)
    const response = await app.request('/vou/self-production/approve', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-zerp-model-build': modelBuildId,
        'x-csrf-token': session.data.csrfToken,
        cookie: signin.headers.getSetCookie()[0]!,
      },
      body: JSON.stringify({
        documentId,
        submissionId,
        expectedRevision: saved.revision,
      }),
    })
    const result = await response.json()
    assert.equal(result.code, 0, JSON.stringify(result))
    const approved = result.data
    const rows = await sql<{
      product_id: string
      quantity: string
    }>`SELECT product_id, quantity::text FROM acc_inventory_entries WHERE vou_approval_entry_id = ${submissionId} ORDER BY quantity`.execute(
      db,
    )
    assert.deepEqual(rows.rows, [
      { product_id: fixture.rawId, quantity: '-2.00000000' },
      { product_id: fixture.productId, quantity: '2.00000000' },
    ])
    const amounts = await sql<{
      amount: string
    }>`SELECT amount::text FROM acc_journal_lines WHERE journal_entry_id IN (SELECT id FROM acc_journal_entries WHERE vou_approval_entry_id = ${submissionId})`.execute(
      db,
    )
    assert.ok(amounts.rows.every((row) => Number(row.amount) === 0))
    await fixture.vou.review(
      'self-production',
      'unapprove',
      {
        documentId,
        submissionId,
        expectedRevision: approved.revision,
        reason: '测试反批准',
      },
      fixture.reviewerActor,
      'stock-production',
    )
    const after = await db
      .selectFrom('acc_inventory_entries')
      .select('id')
      .where('vou_approval_entry_id', '=', submissionId)
      .execute()
    assert.equal(after.length, 0)
  })
})

test('count freezes approval-time quantities and blocks reversing stock already consumed', async () => {
  await withWflDatabase(async (db) => {
    const fixture = await seedStockFixture(db)
    await fixture.quantityMapping('inventory-count')
    await fixture.quantityMapping('self-production')
    const documentId = ulid(),
      submissionId = ulid()
    const count = await fixture.vou.submit(
      'inventory-count',
      'submit-new',
      {
        documentId,
        submissionId,
        idempotencyKey: submissionId,
        expectedRevision: null,
        payload: {
          businessDate: '2026-09-09',
          currency: 'CNY',
          attachments: [],
          warehouse: fixture.salePayload.warehouse,
          inventoryCountLines: [
            {
              product: { objectId: fixture.rawId },
              enteredQuantity: '12',
              enteredUnit: fixture.references.unitSnapshot,
              baseQuantity: '12',
              countResult: {
                bookQuantity: '999',
                actualQuantity: '999',
                differenceQuantity: '999',
              },
            },
          ],
        },
      },
      fixture.actor,
      'count-test',
    )
    assert.ok('inventoryCountLines' in count.payload)
    assert.equal(count.payload.inventoryCountLines[0]!.countResult, undefined)
    const approved = await fixture.vou.review(
      'inventory-count',
      'approve',
      { documentId, submissionId, expectedRevision: count.revision },
      fixture.reviewerActor,
      'count-test',
    )
    assert.ok('inventoryCountLines' in approved.payload)
    assert.deepEqual(approved.payload.inventoryCountLines[0]!.countResult, {
      bookQuantity: '10.000000',
      actualQuantity: '12.000000',
      differenceQuantity: '2.000000',
    })
    const productionPayload = structuredClone(fixture.productionPayload)
    Object.assign(productionPayload.productionLines[0]!, {
      enteredQuantity: '11',
      baseQuantity: '11',
    })
    Object.assign(productionPayload.productionLines[0]!.materials[0]!, {
      actualEnteredQuantity: '11',
      actualBaseQuantity: '11',
    })
    const productionId = ulid(),
      productionEntryId = ulid()
    const production = await fixture.vou.submit(
      'self-production',
      'submit-new',
      {
        documentId: productionId,
        submissionId: productionEntryId,
        idempotencyKey: productionEntryId,
        expectedRevision: null,
        payload: productionPayload,
      },
      fixture.actor,
      'count-consume',
    )
    const produced = await fixture.vou.review(
      'self-production',
      'approve',
      {
        documentId: productionId,
        submissionId: productionEntryId,
        expectedRevision: production.revision,
      },
      fixture.reviewerActor,
      'count-consume',
    )
    await assert.rejects(
      fixture.vou.review(
        'inventory-count',
        'unapprove',
        {
          documentId,
          submissionId,
          expectedRevision: approved.revision,
          reason: '测试反批准',
        },
        fixture.reviewerActor,
        'count-reverse',
      ),
      (error: unknown) =>
        Boolean(
          error &&
          typeof error === 'object' &&
          'errorKey' in error &&
          error.errorKey === 'acc_negative_inventory',
        ),
    )
    await fixture.vou.review(
      'self-production',
      'unapprove',
      {
        documentId: productionId,
        submissionId: productionEntryId,
        expectedRevision: produced.revision,
        reason: '测试反批准',
      },
      fixture.reviewerActor,
      'count-release',
    )
    const reversed = await fixture.vou.review(
      'inventory-count',
      'unapprove',
      {
        documentId,
        submissionId,
        expectedRevision: approved.revision,
        reason: '测试反批准',
      },
      fixture.reviewerActor,
      'count-reverse',
    )
    assert.ok('inventoryCountLines' in reversed.payload)
    assert.equal(
      reversed.payload.inventoryCountLines[0]!.countResult,
      undefined,
    )
  })
})

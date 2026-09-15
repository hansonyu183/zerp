import assert from 'node:assert/strict'
import test from 'node:test'
import { ulid } from 'ulid'
import { sql } from 'kysely'
import { withWflDatabase } from './wfl-fixture.ts'
import { seedOrderListFixture } from '../fixtures/vou-orders.ts'
import { VouApplicationError } from '../../src/vou/service.ts'

test('production rejects missing order sources and raw products through the domain service', async () => {
  await withWflDatabase(async (db) => {
    const fixture = await seedOrderListFixture(db, 0)
    const product = fixture.salePayload.productLines[0]!
    const actor = {
      id: fixture.submitter.userId,
      permissions: [],
      trusted: true,
    }
    for (const entity of ['order-production', 'self-production'] as const) {
      const documentId = ulid(),
        submissionId = ulid()
      await assert.rejects(
        fixture.vou.submit(
          entity,
          'submit-new',
          {
            documentId,
            submissionId,
            idempotencyKey: submissionId,
            expectedRevision: null,
            payload: {
              businessDate: '2026-09-09',
              currency: '',
              attachments: [],
              materialWarehouse: fixture.salePayload.warehouse,
              finishedWarehouse: fixture.salePayload.warehouse,
              productionLines: [
                {
                  product: product.product,
                  enteredQuantity: '1',
                  enteredUnit: product.enteredUnit,
                  baseQuantity: '1',
                  lossRate: '0',
                  materials: [
                    {
                      formulaLineNo: 1,
                      actualMaterial: product.product,
                      actualEnteredQuantity: '1',
                      actualEnteredUnit: product.enteredUnit,
                      actualBaseQuantity: '1',
                    },
                  ],
                },
              ],
            },
          },
          actor,
          'production-validation',
        ),
        (error) =>
          error instanceof VouApplicationError &&
          error.errorKey ===
            (entity === 'order-production'
              ? 'vou_source_line_unavailable'
              : 'vou_reference_unavailable'),
      )
    }
  })
})

test('production freezes server formula and calculated amounts, requires adjustment reasons, and reserves order quantity', async () => {
  await withWflDatabase(async (db) => {
    const { seedProductionFixture } =
      await import('../fixtures/vou-production.ts')
    const fixture = await seedProductionFixture(db)
    const submit = async (
      entity: 'self-production' | 'order-production',
      payload: typeof fixture.productionPayload,
    ) => {
      const documentId = ulid(),
        submissionId = ulid()
      return fixture.vou.submit(
        entity,
        'submit-new',
        {
          documentId,
          submissionId,
          idempotencyKey: submissionId,
          expectedRevision: null,
          payload,
        },
        fixture.actor,
        'production-test',
      )
    }
    const altered = structuredClone(fixture.productionPayload)
    altered.productionLines[0]!.materials[0]!.actualBaseQuantity = '1'
    await assert.rejects(
      submit('self-production', altered),
      (error) =>
        error instanceof VouApplicationError &&
        error.errorKey === 'vou_invalid_payload',
    )
    altered.productionLines[0]!.materials[0]!.adjustmentReason = '实际节约'
    const saved = await submit('self-production', altered)
    const read = await fixture.vou.get(
      'self-production',
      saved.documentId,
      fixture.actor,
    )
    assert.equal(read.payload.currency, '')
    assert.ok('productionLines' in read.payload)
    assert.deepEqual(
      read.payload.productionLines[0]!.formulaSnapshot,
      fixture.formula,
    )
    assert.equal(
      read.payload.productionLines[0]!.materials[0]!.suggestedBaseQuantity,
      '2.000000',
    )
    assert.equal(
      read.payload.productionLines[0]!.materials[0]!.actualBaseQuantity,
      '1.000000',
    )
    const calculated = structuredClone(fixture.productionPayload)
    calculated.productionLines[0]!.lossRate = '0.01'
    calculated.productionLines[0]!.materials[0]!.actualEnteredQuantity =
      '2.0002'
    calculated.productionLines[0]!.materials[0]!.actualBaseQuantity = '2.0002'
    const precise = await submit('self-production', calculated)
    assert.ok('productionLines' in precise.payload)
    assert.equal(
      precise.payload.productionLines[0]!.materials[0]!.actualEnteredQuantity,
      '2.000200',
    )
    calculated.productionLines[0]!.materials[0]!.actualEnteredQuantity =
      '2.0003'
    calculated.productionLines[0]!.materials[0]!.adjustmentReason = '手工修改'
    await assert.rejects(
      submit('self-production', calculated),
      (error) =>
        error instanceof VouApplicationError &&
        error.errorKey === 'vou_reference_unavailable',
    )
    const orderId = ulid(),
      orderEntry = ulid(),
      lineId = ulid()
    const order = await fixture.vou.submit(
      'sale-order',
      'submit-new',
      {
        documentId: orderId,
        submissionId: orderEntry,
        idempotencyKey: orderEntry,
        expectedRevision: null,
        payload: {
          ...fixture.salePayload,
          productLines: [
            {
              ...fixture.salePayload.productLines[0]!,
              lineId,
              product: { objectId: fixture.productId },
              baseQuantity: '2',
              enteredQuantity: '2',
              formula: fixture.formula,
            },
          ],
        },
      },
      fixture.actor,
      'production-order',
    )
    const approved = await fixture.vou.review(
      'sale-order',
      'approve',
      {
        documentId: orderId,
        submissionId: orderEntry,
        expectedRevision: order.revision,
      },
      fixture.reviewerActor,
      'production-order',
    )
    // Simulate an already approved pre-cutover order; no application write changes this historical fact.
    await sql`UPDATE vou_product_line_snapshots SET entered_quantity_micros=2123456 WHERE approval_entry_id=${orderEntry}`.execute(
      db,
    )
    const orderProduction = structuredClone(fixture.productionPayload)
    orderProduction.productionLines[0]!.enteredQuantity = '2.123456'
    orderProduction.parentEntity = 'sale-order'
    orderProduction.parentDocumentId = orderId
    orderProduction.productionLines[0]!.sourceOrderLineId = lineId
    const production = await submit('order-production', orderProduction)
    assert.ok('productionLines' in production.payload)
    assert.equal(
      production.payload.productionLines[0]!.enteredQuantity,
      '2.123456',
    )
    await assert.rejects(
      submit('order-production', orderProduction),
      (error) =>
        error instanceof VouApplicationError &&
        error.errorKey === 'vou_source_line_unavailable',
    )
    await assert.rejects(
      fixture.vou.review(
        'sale-order',
        'unapprove',
        {
          documentId: orderId,
          submissionId: orderEntry,
          expectedRevision: approved.revision,
          reason: '测试反批准',
        },
        fixture.reviewerActor,
        'production-blocker',
      ),
      (error) =>
        error instanceof VouApplicationError &&
        Boolean(error.data?.blockers.length),
    )
    await fixture.vou.delete(
      'order-production',
      {
        documentId: production.documentId,
        submissionId: production.submissionId,
        expectedRevision: production.revision,
      },
      fixture.actor,
      'production-release',
    )
    const changed = structuredClone(orderProduction)
    changed.productionLines[0]!.enteredQuantity = '2.123457'
    await assert.rejects(
      submit('order-production', changed),
      (error) =>
        error instanceof VouApplicationError &&
        error.errorKey === 'vou_invalid_payload',
    )
    await submit('order-production', orderProduction)
  })
})

test('orders adopt exact historical product and customer formulas without permitting new high precision input', async () => {
  await withWflDatabase(async (db) => {
    const { seedProductionFixture } =
      await import('../fixtures/vou-production.ts')
    const fixture = await seedProductionFixture(db)
    const version = await db
      .selectFrom('dcl_product_versions')
      .select('fixed_formula')
      .where('approval_entry_id', '=', fixture.approvalEntryId)
      .executeTakeFirstOrThrow()
    const historical = structuredClone(version.fixed_formula) as {
      output: { enteredQuantity: string }
      components: { quantity: { enteredQuantity: string } }[]
    }
    historical.output.enteredQuantity = '1.234567'
    historical.components[0]!.quantity.enteredQuantity = '2.123456'
    await db
      .updateTable('dcl_product_versions')
      .set({ fixed_formula: JSON.stringify(historical) })
      .where('approval_entry_id', '=', fixture.approvalEntryId)
      .execute()
    const formula = structuredClone(fixture.formula)
    formula.output.enteredQuantity = '1.234567'
    formula.components[0]!.quantity.enteredQuantity = '2.123456'
    const submit = async (adopted: import('@zerp/model').VouFormulaInput) => {
      const submissionId = ulid()
      return fixture.vou.submit(
        'sale-order',
        'submit-new',
        {
          documentId: ulid(),
          submissionId,
          idempotencyKey: submissionId,
          expectedRevision: null,
          payload: {
            ...fixture.salePayload,
            productLines: [
              {
                ...fixture.salePayload.productLines[0]!,
                lineId: ulid(),
                product: { objectId: fixture.productId },
                enteredQuantity: '1.23',
                formula: adopted,
              },
            ],
          },
        },
        fixture.actor,
        'historical-formula',
      )
    }
    const first = await submit(formula)
    assert.ok('productLines' in first.payload)
    assert.equal(
      first.payload.productLines[0]!.formula!.output.enteredQuantity,
      '1.234567',
    )
    const copied = {
      ...formula,
      sourceType: 'CUSTOMER_LATEST' as const,
      sourceDocumentId: first.documentId,
      sourceDocumentNo: first.documentNo,
    }
    await submit(copied)
    for (const source of [formula, copied]) {
      const changed = structuredClone(source)
      changed.components[0]!.quantity.enteredQuantity = '2.123457'
      await assert.rejects(
        submit(changed),
        (error) =>
          error instanceof VouApplicationError &&
          error.errorKey === 'vou_invalid_payload',
      )
    }
    await assert.rejects(
      submit({ ...formula, sourceType: 'MANUAL' }),
      (error) =>
        error instanceof VouApplicationError &&
        error.errorKey === 'vou_invalid_payload',
    )
  })
})

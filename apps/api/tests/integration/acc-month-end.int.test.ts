import assert from 'node:assert/strict'
import test from 'node:test'
import { sql } from 'kysely'
import { ulid } from 'ulid'
import { withWflDatabase } from './wfl-fixture.ts'
import { seedStockFixture } from '../fixtures/vou-stock.ts'
import { approveEmptyIntermediaryMonth } from '../fixtures/vou-intermediary.ts'

async function approveCount(
  fixture: Awaited<ReturnType<typeof seedStockFixture>>,
  date: string,
  quantity: string,
  productId = fixture.rawId,
) {
  const documentId = ulid(),
    submissionId = ulid()
  const pending = await fixture.vou.submit(
    'inventory-count',
    'submit-new',
    {
      documentId,
      submissionId,
      idempotencyKey: submissionId,
      expectedRevision: null,
      payload: {
        businessDate: date,
        currency: 'CNY',
        attachments: [],
        warehouse: fixture.salePayload.warehouse,
        inventoryCountLines: [
          {
            product: { objectId: productId },
            enteredQuantity: quantity,
            enteredUnit: fixture.references.unitSnapshot,
            baseQuantity: quantity,
          },
        ],
      },
    },
    fixture.actor,
    'month-end-count',
  )
  return fixture.vou.review(
    'inventory-count',
    'approve',
    { documentId, submissionId, expectedRevision: pending.revision },
    fixture.reviewerActor,
    'month-end-count',
  )
}

test('ACC locks count gains at inventory cost and unlocks/relocks without changing source facts', async () => {
  await withWflDatabase(async (db) => {
    const fixture = await seedStockFixture(db, '2026-08')
    await fixture.quantityMapping('inventory-count', fixture.equity.id)
    const documentId = ulid(),
      submissionId = ulid()
    const pending = await fixture.vou.submit(
      'inventory-count',
      'submit-new',
      {
        documentId,
        submissionId,
        idempotencyKey: submissionId,
        expectedRevision: null,
        payload: {
          businessDate: '2026-08-09',
          currency: 'CNY',
          attachments: [],
          warehouse: fixture.salePayload.warehouse,
          inventoryCountLines: [
            {
              product: { objectId: fixture.rawId },
              enteredQuantity: '12',
              enteredUnit: fixture.references.unitSnapshot,
              baseQuantity: '12',
            },
          ],
        },
      },
      fixture.actor,
      'month-end-count',
    )
    await fixture.vou.review(
      'inventory-count',
      'approve',
      {
        documentId,
        submissionId,
        expectedRevision: pending.revision,
      },
      fixture.reviewerActor,
      'month-end-count',
    )
    await approveEmptyIntermediaryMonth(
      db,
      fixture.vou,
      '2026-08-31',
      fixture.actor,
      fixture.reviewerActor,
    )
    const sourceFacts = () =>
      db
        .selectFrom('acc_inventory_entries')
        .selectAll()
        .where('book_id', '=', fixture.book.id)
        .orderBy('id')
        .execute()
    const original = await sourceFacts()
    const closing = () =>
      sql<{
        balance: string
      }>`SELECT closing_balance::text AS balance FROM acc_period_balances WHERE book_id = ${fixture.book.id} AND subject_id = ${fixture.subject.id} AND period_month = '2026-08'`.execute(
        db,
      )
    // Fail after costs have been persisted, while writing the balance snapshot.
    await sql`ALTER TABLE acc_period_balances ADD CONSTRAINT month_end_failure CHECK (closing_balance < 11)`.execute(
      db,
    )
    await assert.rejects(
      fixture.acc.setPeriod(
        { bookId: fixture.book.id, month: '2026-08', expectedRevision: null },
        true,
        fixture.actor,
      ),
      { code: '23514' },
    )
    await sql`ALTER TABLE acc_period_balances DROP CONSTRAINT month_end_failure`.execute(
      db,
    )
    assert.deepEqual(
      await db
        .selectFrom('acc_inventory_cost_allocations')
        .selectAll()
        .where('book_id', '=', fixture.book.id)
        .execute(),
      [],
    )
    assert.deepEqual(
      await db
        .selectFrom('acc_journal_entries')
        .selectAll()
        .where('book_id', '=', fixture.book.id)
        .where('source_kind', '=', 'COST_SETTLEMENT')
        .execute(),
      [],
    )
    assert.deepEqual((await closing()).rows, [])
    assert.equal(
      (await fixture.acc.queryPeriods(fixture.book.id, fixture.actor))[0]!
        .revision,
      null,
    )
    assert.deepEqual(await sourceFacts(), original)
    const locked = await fixture.acc.setPeriod(
      { bookId: fixture.book.id, month: '2026-08', expectedRevision: null },
      true,
      fixture.actor,
    )
    assert.equal(locked.locked, true)
    assert.deepEqual((await closing()).rows, [{ balance: '12.00000000' }])
    const journals = () =>
      sql<{
        direction: string
        amount: string
      }>`SELECT line.direction, line.amount::text FROM acc_journal_lines line JOIN acc_journal_entries journal ON journal.id = line.journal_entry_id WHERE journal.book_id = ${fixture.book.id} AND journal.source_kind = 'COST_SETTLEMENT' ORDER BY line.direction`.execute(
        db,
      )
    assert.deepEqual((await journals()).rows, [
      { direction: 'CREDIT', amount: '2.00000000' },
      { direction: 'DEBIT', amount: '2.00000000' },
    ])
    const unlocked = await fixture.acc.setPeriod(
      {
        bookId: fixture.book.id,
        month: '2026-08',
        expectedRevision: locked.revision,
      },
      false,
      fixture.actor,
    )
    assert.deepEqual((await journals()).rows, [])
    assert.deepEqual((await closing()).rows, [])
    assert.deepEqual(await sourceFacts(), original)
    await fixture.acc.setPeriod(
      {
        bookId: fixture.book.id,
        month: '2026-08',
        expectedRevision: unlocked.revision,
      },
      true,
      fixture.actor,
    )
    assert.deepEqual((await closing()).rows, [{ balance: '12.00000000' }])
    assert.deepEqual(await sourceFacts(), original)
  })
})

test('ACC costs each depletion in cents and absorbs the remaining cent only on final depletion', async () => {
  await withWflDatabase(async (db) => {
    const fixture = await seedStockFixture(db, '2026-08', {
      quantity: '3',
      amount: '1.00',
    })
    await fixture.quantityMapping('inventory-count', fixture.equity.id)
    for (const [date, quantity] of [
      ['2026-08-09', '2'],
      ['2026-08-10', '1'],
      ['2026-08-11', '0'],
    ]) {
      const documentId = ulid(),
        submissionId = ulid()
      const pending = await fixture.vou.submit(
        'inventory-count',
        'submit-new',
        {
          documentId,
          submissionId,
          idempotencyKey: submissionId,
          expectedRevision: null,
          payload: {
            businessDate: date!,
            currency: 'CNY',
            attachments: [],
            warehouse: fixture.salePayload.warehouse,
            inventoryCountLines: [
              {
                product: { objectId: fixture.rawId },
                enteredQuantity: quantity!,
                enteredUnit: fixture.references.unitSnapshot,
                baseQuantity: quantity!,
              },
            ],
          },
        },
        fixture.actor,
        'cost-rounding',
      )
      await fixture.vou.review(
        'inventory-count',
        'approve',
        { documentId, submissionId, expectedRevision: pending.revision },
        fixture.reviewerActor,
        'cost-rounding',
      )
    }
    await approveEmptyIntermediaryMonth(
      db,
      fixture.vou,
      '2026-08-31',
      fixture.actor,
      fixture.reviewerActor,
    )
    await fixture.acc.setPeriod(
      { bookId: fixture.book.id, month: '2026-08', expectedRevision: null },
      true,
      fixture.actor,
    )
    const costs = await sql<{
      amount: string
    }>`SELECT allocation.cost_amount::text AS amount FROM acc_inventory_cost_allocations allocation JOIN acc_inventory_entries inventory ON inventory.id = allocation.inventory_entry_id WHERE allocation.book_id = ${fixture.book.id} AND inventory.vou_approval_entry_id IS NOT NULL ORDER BY inventory.business_date`.execute(
      db,
    )
    assert.deepEqual(costs.rows, [
      { amount: '-0.33000000' },
      { amount: '-0.33000000' },
      { amount: '-0.34000000' },
    ])
    assert.deepEqual(
      (
        await sql<{
          balance: string
        }>`SELECT closing_balance::text AS balance FROM acc_period_balances WHERE book_id = ${fixture.book.id} AND subject_id = ${fixture.subject.id}`.execute(
          db,
        )
      ).rows,
      [{ balance: '0.00000000' }],
    )
  })
})

test('ACC transfers each production output actual material cost without valuing it as a count gain', async () => {
  await withWflDatabase(async (db) => {
    const fixture = await seedStockFixture(db, '2026-08')
    await fixture.quantityMapping('self-production', fixture.equity.id)
    const secondProductId = ulid(),
      secondProductEntryId = ulid()
    const originalProduct = await fixture.bob.get(
      'product',
      fixture.productId,
      fixture.actor,
    )
    const secondPending = await fixture.bob.submit(
      'product',
      'submit-new',
      {
        subjectId: secondProductId,
        submissionId: secondProductEntryId,
        idempotencyKey: secondProductEntryId,
        expectedLatestApprovedSubmissionId: null,
        expectedLatestApprovedRevision: null,
        snapshot: { ...originalProduct.snapshot, name: '第二种成本成品' },
      },
      fixture.actor,
      'production-cost',
    )
    await fixture.bob.review(
      'product',
      'approve',
      {
        subjectId: secondProductId,
        submissionId: secondProductEntryId,
        expectedRevision: secondPending.revision,
      },
      fixture.reviewerActor,
      'production-cost',
    )
    const first = structuredClone(fixture.productionPayload.productionLines[0]!)
    const second = structuredClone(first)
    second.product = { objectId: secondProductId }
    second.materials[0]!.actualEnteredQuantity = '3'
    second.materials[0]!.actualBaseQuantity = '3'
    second.materials[0]!.adjustmentReason = '本行实际多耗一件'
    const documentId = ulid(),
      submissionId = ulid()
    const pending = await fixture.vou.submit(
      'self-production',
      'submit-new',
      {
        documentId,
        submissionId,
        idempotencyKey: submissionId,
        expectedRevision: null,
        payload: {
          ...fixture.productionPayload,
          businessDate: '2026-08-09',
          productionLines: [first, second],
        },
      },
      fixture.actor,
      'production-cost',
    )
    await fixture.vou.review(
      'self-production',
      'approve',
      { documentId, submissionId, expectedRevision: pending.revision },
      fixture.reviewerActor,
      'production-cost',
    )
    await approveEmptyIntermediaryMonth(
      db,
      fixture.vou,
      '2026-08-31',
      fixture.actor,
      fixture.reviewerActor,
    )
    await fixture.acc.setPeriod(
      { bookId: fixture.book.id, month: '2026-08', expectedRevision: null },
      true,
      fixture.actor,
    )
    const costs = await sql<{
      amount: string
    }>`SELECT allocation.cost_amount::text AS amount FROM acc_inventory_cost_allocations allocation JOIN acc_inventory_entries inventory ON inventory.id = allocation.inventory_entry_id WHERE allocation.book_id = ${fixture.book.id} AND inventory.vou_approval_entry_id = ${submissionId} AND inventory.quantity > 0 ORDER BY inventory.line_no`.execute(
      db,
    )
    assert.deepEqual(costs.rows, [
      { amount: '2.00000000' },
      { amount: '3.00000000' },
    ])
    const balances = await sql<{
      product: string
      amount: string
    }>`SELECT dimensions->>'PRODUCT' AS product, closing_balance::text AS amount FROM acc_period_balances WHERE book_id = ${fixture.book.id} AND subject_id = ${fixture.subject.id} ORDER BY dimensions->>'PRODUCT'`.execute(
      db,
    )
    assert.deepEqual(
      balances.rows,
      [
        { product: fixture.rawId, amount: '5.00000000' },
        { product: fixture.productId, amount: '2.00000000' },
        { product: secondProductId, amount: '3.00000000' },
      ].sort((a, b) => a.product.localeCompare(b.product)),
    )
  })
})

test('ACC restores original outbound cost for split sales returns after a differently priced receipt', async () => {
  await withWflDatabase(async (db) => {
    const fixture = await seedStockFixture(db, '2026-08', {
      quantity: '3',
      amount: '1.00',
    })
    for (const entity of [
      'sale-order',
      'sale-delivery',
      'sale-signoff',
      'purchase-order',
    ])
      await fixture.mappings.save(
        {
          bookId: fixture.book.id,
          vouEntity: entity,
          expectedRevision: null,
          defaultResult: 'UN_POST',
          definition: {
            defaultTemplateId: null,
            rules: [],
            templates: [],
            assetConfiguration: null,
          },
        },
        fixture.actor,
      )
    for (const entity of ['sale-outbound', 'sale-return', 'purchase-inbound'])
      await fixture.quantityMapping(entity, fixture.equity.id)
    const approve = async (
      entity: import('@zerp/model').VouEntity,
      payload: import('@zerp/model').VouPayload,
    ) => {
      const documentId = ulid(),
        submissionId = ulid()
      const pending = await fixture.vou.submit(
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
        'return-cost',
      )
      return fixture.vou.review(
        entity,
        'approve',
        { documentId, submissionId, expectedRevision: pending.revision },
        fixture.reviewerActor,
        'return-cost',
      )
    }
    const lineId = fixture.salePayload.productLines[0]!.lineId
    const order = await approve('sale-order', {
      ...fixture.salePayload,
      businessDate: '2026-08-02',
      productLines: [
        {
          ...fixture.salePayload.productLines[0]!,
          enteredQuantity: '3',
          baseQuantity: '3',
        },
      ],
    })
    const outbound = await approve('sale-outbound', {
      businessDate: '2026-08-03',
      currency: 'CNY',
      attachments: [],
      parentEntity: 'sale-order',
      parentDocumentId: order.documentId,
      sourceLines: [{ sourceLineId: lineId, baseQuantity: '3' }],
    })
    const delivery = await approve('sale-delivery', {
      businessDate: '2026-08-04',
      currency: 'CNY',
      attachments: [],
      parentEntity: 'sale-outbound',
      parentDocumentId: outbound.documentId,
      sourceLines: [{ sourceLineId: lineId, baseQuantity: '3' }],
    })
    const signoff = await approve('sale-signoff', {
      businessDate: '2026-08-05',
      currency: 'CNY',
      attachments: [],
      parentEntity: 'sale-delivery',
      parentDocumentId: delivery.documentId,
      customer: fixture.salePayload.customer,
      expectedSolventContainers: 0,
      expectedResinContainers: 0,
      returnedSolventContainers: 0,
      returnedResinContainers: 0,
      signoffLines: [
        {
          sourceLineId: lineId,
          signedBaseQuantity: '3',
          rejectedBaseQuantity: '0',
        },
      ],
    })
    const purchasePayload = fixture.purchase
      .payload as import('@zerp/model').VouPayloadFor<'purchase-order'>
    const purchase = await approve('purchase-order', {
      ...purchasePayload,
      businessDate: '2026-08-06',
      productLines: [
        {
          ...purchasePayload.productLines[0]!,
          enteredQuantity: '1',
          baseQuantity: '1',
          unitPrice: '10.00',
        },
      ],
    })
    await approve('purchase-inbound', {
      businessDate: '2026-08-07',
      currency: 'CNY',
      attachments: [],
      parentEntity: 'purchase-order',
      parentDocumentId: purchase.documentId,
      supplier: purchasePayload.supplier,
      warehouse: fixture.salePayload.warehouse,
      sourceLines: [
        {
          sourceLineId: purchasePayload.productLines[0]!.lineId,
          baseQuantity: '1',
        },
      ],
    })
    for (const date of ['2026-08-08', '2026-08-09', '2026-08-10'])
      await approve('sale-return', {
        businessDate: date,
        currency: 'CNY',
        attachments: [],
        parentEntity: 'sale-order',
        parentDocumentId: order.documentId,
        warehouse: fixture.salePayload.warehouse,
        returnReason: '原出库成本退回',
        returnLines: [
          {
            sourceDocumentId: signoff.documentId,
            sourceLineId: lineId,
            baseQuantity: '1',
          },
        ],
      })
    await approveEmptyIntermediaryMonth(
      db,
      fixture.vou,
      '2026-08-31',
      fixture.actor,
      fixture.reviewerActor,
    )
    await fixture.acc.setPeriod(
      { bookId: fixture.book.id, month: '2026-08', expectedRevision: null },
      true,
      fixture.actor,
    )
    const costs = await sql<{
      amount: string
    }>`SELECT allocation.cost_amount::text AS amount FROM acc_inventory_cost_allocations allocation JOIN acc_inventory_entries inventory ON inventory.id = allocation.inventory_entry_id JOIN vou_documents document ON document.id = inventory.document_id WHERE allocation.book_id = ${fixture.book.id} AND document.entity = 'sale-return' ORDER BY inventory.business_date`.execute(
      db,
    )
    assert.deepEqual(costs.rows, [
      { amount: '0.33000000' },
      { amount: '0.33000000' },
      { amount: '0.34000000' },
    ])
    assert.deepEqual(
      (
        await sql<{
          balance: string
        }>`SELECT closing_balance::text AS balance FROM acc_period_balances WHERE book_id = ${fixture.book.id} AND subject_id = ${fixture.subject.id}`.execute(
          db,
        )
      ).rows,
      [{ balance: '11.00000000' }],
    )
  })
})

test('ACC refuses unknown count-gain costs atomically', async () => {
  await withWflDatabase(async (db) => {
    const fixture = await seedStockFixture(db, '2026-08')
    await fixture.quantityMapping('inventory-count', fixture.equity.id)
    const documentId = ulid(),
      submissionId = ulid()
    const pending = await fixture.vou.submit(
      'inventory-count',
      'submit-new',
      {
        documentId,
        submissionId,
        idempotencyKey: submissionId,
        expectedRevision: null,
        payload: {
          businessDate: '2026-08-09',
          currency: 'CNY',
          attachments: [],
          warehouse: fixture.salePayload.warehouse,
          inventoryCountLines: [
            {
              product: { objectId: fixture.productId },
              enteredQuantity: '1',
              enteredUnit: fixture.references.unitSnapshot,
              baseQuantity: '1',
            },
          ],
        },
      },
      fixture.actor,
      'unknown-cost',
    )
    await fixture.vou.review(
      'inventory-count',
      'approve',
      { documentId, submissionId, expectedRevision: pending.revision },
      fixture.reviewerActor,
      'unknown-cost',
    )
    await approveEmptyIntermediaryMonth(
      db,
      fixture.vou,
      '2026-08-31',
      fixture.actor,
      fixture.reviewerActor,
    )
    await assert.rejects(
      fixture.acc.setPeriod(
        { bookId: fixture.book.id, month: '2026-08', expectedRevision: null },
        true,
        fixture.actor,
      ),
      (cause: unknown) => {
        assert.ok(
          cause instanceof Error && 'errorKey' in cause && 'data' in cause,
        )
        assert.equal(cause.errorKey, 'acc_period_cost_basis_missing')
        assert.equal(
          (cause.data as { blockers: { productId: string }[] }).blockers[0]!
            .productId,
          fixture.productId,
        )
        return true
      },
    )
    assert.deepEqual(
      await db
        .selectFrom('acc_inventory_cost_allocations')
        .selectAll()
        .where('book_id', '=', fixture.book.id)
        .execute(),
      [],
    )
    assert.deepEqual(
      await db
        .selectFrom('acc_period_balances')
        .selectAll()
        .where('book_id', '=', fixture.book.id)
        .execute(),
      [],
    )
    assert.equal(
      (await fixture.acc.queryPeriods(fixture.book.id, fixture.actor))[0]!
        .revision,
      null,
    )
  })
})

test('ACC retains and freezes the adopted cost counterpart after the mapping changes', async () => {
  await withWflDatabase(async (db) => {
    const fixture = await seedStockFixture(db, '2026-08')
    const subjectInput = {
      id: ulid(),
      bookId: fixture.book.id,
      code: '6601',
      name: '已采用成本对方',
      parentId: null,
      balanceDirection: 'DEBIT' as const,
      enabled: true,
      requiredDimensions: [],
      inventoryQuantity: false,
      settlementPurpose: 'NONE' as const,
    }
    const adopted = await fixture.acc.createSubject(subjectInput, fixture.actor)
    const mapping = await fixture.quantityMapping('inventory-count', adopted.id)
    await approveCount(fixture, '2026-08-09', '12')
    const definition = structuredClone(mapping.definition)
    definition.templates[0]!.lines[0]!.costCounterpartSubjectId =
      fixture.equity.id
    await fixture.mappings.save(
      {
        bookId: fixture.book.id,
        vouEntity: 'inventory-count',
        expectedRevision: mapping.revision,
        defaultResult: 'POST',
        definition,
      },
      fixture.actor,
    )
    assert.equal(
      (await fixture.acc.getSubject(adopted.id, fixture.actor)).frozen,
      true,
    )
    await assert.rejects(
      fixture.acc.saveSubject(
        {
          ...subjectInput,
          name: '改写采用名称',
          expectedRevision: adopted.revision,
        },
        fixture.actor,
      ),
      { errorKey: 'acc_subject_frozen' },
    )
    await assert.rejects(
      fixture.acc.deleteSubject(adopted.id, adopted.revision, fixture.actor),
      { errorKey: 'acc_subject_delete_blocked' },
    )
    await approveEmptyIntermediaryMonth(
      db,
      fixture.vou,
      '2026-08-31',
      fixture.actor,
      fixture.reviewerActor,
    )
    await fixture.acc.setPeriod(
      { bookId: fixture.book.id, month: '2026-08', expectedRevision: null },
      true,
      fixture.actor,
    )
    const result = await sql<{
      amount: string
    }>`SELECT line.amount::text FROM acc_journal_lines line JOIN acc_journal_entries journal ON journal.id = line.journal_entry_id WHERE journal.book_id = ${fixture.book.id} AND journal.source_kind = 'COST_SETTLEMENT' AND line.subject_id = ${adopted.id}`.execute(
      db,
    )
    assert.deepEqual(result.rows, [{ amount: '2.00000000' }])
  })
})

test('ACC closes a valid book independently and rejects another book negative inventory including its opening', async () => {
  await withWflDatabase(async (db) => {
    const fixture = await seedStockFixture(db, '2026-08')
    const mapping = await fixture.quantityMapping(
      'inventory-count',
      fixture.equity.id,
    )
    const other = await fixture.acc.createBook(
      {
        id: ulid(),
        name: '无期初库存的独立账簿',
        description: '',
        startMonth: '2026-08',
        baseCurrency: 'CNY',
        subjectTemplate: 'EMPTY',
        queryUserIds: [],
        operateUserIds: [],
      },
      fixture.actor,
    )
    const subject = await fixture.acc.createSubject(
      {
        id: ulid(),
        bookId: other.id,
        code: '1405',
        name: '独立库存',
        parentId: null,
        balanceDirection: 'DEBIT',
        enabled: true,
        requiredDimensions: ['PRODUCT', 'WAREHOUSE'],
        inventoryQuantity: true,
        settlementPurpose: 'NONE',
      },
      fixture.actor,
    )
    const equity = await fixture.acc.createSubject(
      {
        id: ulid(),
        bookId: other.id,
        code: '4001',
        name: '独立权益',
        parentId: null,
        balanceDirection: 'CREDIT',
        enabled: true,
        requiredDimensions: [],
        inventoryQuantity: false,
        settlementPurpose: 'NONE',
      },
      fixture.actor,
    )
    const { VouOpeningService } =
      await import('../../src/vou/opening-service.ts')
    const openings = new VouOpeningService(db, fixture.acc),
      openingId = ulid()
    const opening = await openings.submitOpening(
      {
        bookId: other.id,
        submissionId: openingId,
        idempotencyKey: openingId,
        lines: [],
        assets: [],
        bills: [],
        containers: [],
      },
      fixture.actor,
      'independent-cost',
    )
    await openings.reviewOpening(
      'approve',
      {
        bookId: other.id,
        submissionId: openingId,
        expectedRevision: opening.approval.revision,
      },
      fixture.reviewerActor,
      'independent-cost',
    )
    const definition = structuredClone(mapping.definition)
    definition.templates[0]!.lines[0]!.subjectValue = subject.id
    definition.templates[0]!.lines[0]!.costCounterpartSubjectId = equity.id
    definition.templates[0]!.lines[1]!.subjectValue = equity.id
    await fixture.mappings.save(
      {
        bookId: other.id,
        vouEntity: 'inventory-count',
        expectedRevision: null,
        defaultResult: 'POST',
        definition,
      },
      fixture.actor,
    )
    await approveCount(fixture, '2026-08-09', '9')
    await approveEmptyIntermediaryMonth(
      db,
      fixture.vou,
      '2026-08-31',
      fixture.actor,
      fixture.reviewerActor,
    )
    await fixture.acc.setPeriod(
      { bookId: fixture.book.id, month: '2026-08', expectedRevision: null },
      true,
      fixture.actor,
    )
    await assert.rejects(
      fixture.acc.setPeriod(
        { bookId: other.id, month: '2026-08', expectedRevision: null },
        true,
        fixture.actor,
      ),
      { errorKey: 'acc_period_negative_inventory' },
    )
    assert.deepEqual(
      (
        await sql<{
          balance: string
        }>`SELECT closing_balance::text AS balance FROM acc_period_balances WHERE book_id = ${fixture.book.id} AND subject_id = ${fixture.subject.id}`.execute(
          db,
        )
      ).rows,
      [{ balance: '9.00000000' }],
    )
    assert.deepEqual(
      await db
        .selectFrom('acc_inventory_cost_allocations')
        .selectAll()
        .where('book_id', '=', other.id)
        .execute(),
      [],
    )
    assert.equal(
      (await fixture.acc.queryPeriods(other.id, fixture.actor))[0]!.revision,
      null,
    )
  })
})

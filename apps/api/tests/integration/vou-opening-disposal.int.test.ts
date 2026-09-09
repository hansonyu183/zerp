import assert from 'node:assert/strict'
import test from 'node:test'
import { ulid } from 'ulid'
import type { VouPayloadFor } from '@zerp/model'
import { withWflDatabase } from './wfl-fixture.ts'
import { seedProductionFixture } from '../fixtures/vou-production.ts'
import { AccService } from '../../src/acc/service.ts'
import { AccMappingCatalogService } from '../../src/acc/mapping-catalog.ts'
import { VouOpeningService } from '../../src/vou/opening-service.ts'
import { VouService } from '../../src/vou/service.ts'

test('an opening bill can be paid and reversed back to its original opening state', async () => {
  await withWflDatabase(async (db) => {
    const f = await seedProductionFixture(db, 0, ['bill-payment'])
    const acc = new AccService(db),
      mappings = new AccMappingCatalogService(db),
      openings = new VouOpeningService(db, acc),
      vou = new VouService(db, { acc, wfl: { async apply() {} } })
    const book = await acc.createBook(
      {
        id: ulid(),
        name: '期初票据账簿',
        description: '',
        startMonth: '2026-09',
        baseCurrency: 'CNY',
        subjectTemplate: 'EMPTY',
        queryUserIds: [f.actor.id, f.reviewerActor.id],
        operateUserIds: [f.actor.id, f.reviewerActor.id],
      },
      f.actor,
    )
    const billSubject = await acc.createSubject(
      {
        id: ulid(),
        bookId: book.id,
        code: '1121',
        name: '应收票据',
        parentId: null,
        balanceDirection: 'DEBIT',
        enabled: true,
        requiredDimensions: ['BILL'],
        inventoryQuantity: false,
        settlementPurpose: 'NONE',
      },
      f.actor,
    )
    const equity = await acc.createSubject(
      {
        id: ulid(),
        bookId: book.id,
        code: '4001',
        name: '权益',
        parentId: null,
        balanceDirection: 'CREDIT',
        enabled: true,
        requiredDimensions: [],
        inventoryQuantity: false,
        settlementPurpose: 'NONE',
      },
      f.actor,
    )
    const supplier = (f.purchase.payload as VouPayloadFor<'purchase-order'>)
      .supplier
    const supplierView = await f.bob.get('supplier', supplier.objectId, f.actor)
    assert.ok(supplierView.code)
    const openingId = ulid(),
      billId = ulid()
    const opening = await openings.submitOpening(
      {
        bookId: book.id,
        submissionId: openingId,
        idempotencyKey: openingId,
        lines: [
          {
            subjectId: billSubject.id,
            currency: 'CNY',
            direction: 'DEBIT',
            amount: '50.00',
            dimensions: { BILL: billId },
          },
          {
            subjectId: equity.id,
            currency: 'CNY',
            direction: 'CREDIT',
            amount: '50.00',
            dimensions: {},
          },
        ],
        assets: [],
        containers: [],
        bills: [
          {
            billId,
            billNo: ulid(),
            billType: 'BANK_ACCEPTANCE',
            positionType: 'ASSET',
            medium: 'ELECTRONIC',
            currency: 'CNY',
            faceAmount: '50.00',
            issueDate: '2026-08-01',
            maturityDate: '2026-12-01',
            drawer: '出票人',
            acceptor: '承兑人',
            payee: '收款人',
            annualRateBps: 0,
            interestDays: 122,
            interestAmount: '0.00',
            customerCostAmount: '0.00',
            valueAmount: '50.00',
            originatingCounterparty: {
              entity: 'supplier',
              objectId: supplier.objectId,
              approvalEntryId: supplier.approvalEntryId,
              code: supplierView.code,
              name: String(supplierView.snapshot.displayName),
            },
          },
        ],
      },
      f.actor,
      'opening-bill',
    )
    await openings.reviewOpening(
      'approve',
      {
        bookId: book.id,
        submissionId: openingId,
        expectedRevision: opening.approval.revision,
      },
      f.reviewerActor,
      'opening-bill',
    )
    await acc.syncVouEntityCatalog()
    await mappings.save(
      {
        bookId: book.id,
        vouEntity: 'bill-payment',
        expectedRevision: null,
        defaultResult: 'UN_POST',
        definition: {
          defaultTemplateId: null,
          rules: [],
          templates: [],
          assetConfiguration: null,
        },
      },
      { ...f.actor, permissions: ['/acc/mapping/save'] },
    )
    const id = ulid()
    const saved = await vou.submit(
      'bill-payment',
      'submit-new',
      {
        documentId: ulid(),
        submissionId: id,
        idempotencyKey: id,
        expectedRevision: null,
        payload: {
          businessDate: '2026-09-09',
          currency: 'CNY',
          attachments: [],
          supplier,
          handler: f.salePayload.salesperson!,
          billLines: [{ billId, purpose: 'PRIMARY' }],
        },
      },
      f.actor,
      'opening-pay',
    )
    const paid = await vou.review(
      'bill-payment',
      'approve',
      {
        documentId: saved.documentId,
        submissionId: id,
        expectedRevision: saved.revision,
      },
      f.reviewerActor,
      'opening-pay',
    )
    assert.equal(
      (
        await db
          .selectFrom('acc_bill_registers')
          .select('status')
          .where('id', '=', billId)
          .executeTakeFirstOrThrow()
      ).status,
      'PAID',
    )
    await vou.review(
      'bill-payment',
      'unapprove',
      {
        documentId: saved.documentId,
        submissionId: id,
        expectedRevision: paid.revision,
        reason: '恢复',
      },
      f.reviewerActor,
      'opening-pay-reverse',
    )
    const restored = await db
      .selectFrom('acc_bill_registers')
      .select([
        'status',
        'state_vou_approval_entry_id',
        'state_opening_approval_entry_id',
      ])
      .where('id', '=', billId)
      .executeTakeFirstOrThrow()
    assert.deepEqual(restored, {
      status: 'AVAILABLE',
      state_vou_approval_entry_id: null,
      state_opening_approval_entry_id: openingId,
    })
    assert.equal(
      (
        await db
          .selectFrom('acc_register_entries')
          .select('reversed_at')
          .where('register_kind', '=', 'BILL')
          .where('object_id', '=', billId)
          .where('opening_approval_entry_id', '=', openingId)
          .executeTakeFirstOrThrow()
      ).reversed_at,
      null,
    )
  })
})

test('an opening asset can be liquidated and reversed using a public asset mapping', async () => {
  await withWflDatabase(async (db) => {
    const f = await seedProductionFixture(db, 0, ['asset-liquidation'])
    const acc = new AccService(db),
      mappings = new AccMappingCatalogService(db),
      openings = new VouOpeningService(db, acc),
      vou = new VouService(db, { acc, wfl: { async apply() {} } })
    const book = await acc.createBook(
      {
        id: ulid(),
        name: '期初资产账簿',
        description: '',
        startMonth: '2026-09',
        baseCurrency: 'CNY',
        subjectTemplate: 'EMPTY',
        queryUserIds: [f.actor.id, f.reviewerActor.id],
        operateUserIds: [f.actor.id, f.reviewerActor.id],
      },
      f.actor,
    )
    const assetSubject = await acc.createSubject(
      {
        id: ulid(),
        bookId: book.id,
        code: '1601',
        name: '资产',
        parentId: null,
        balanceDirection: 'DEBIT',
        enabled: true,
        requiredDimensions: ['ASSET'],
        inventoryQuantity: false,
        settlementPurpose: 'NONE',
      },
      f.actor,
    )
    const equity = await acc.createSubject(
      {
        id: ulid(),
        bookId: book.id,
        code: '4001',
        name: '权益',
        parentId: null,
        balanceDirection: 'CREDIT',
        enabled: true,
        requiredDimensions: [],
        inventoryQuantity: false,
        settlementPurpose: 'NONE',
      },
      f.actor,
    )
    await acc.syncVouEntityCatalog()
    await mappings.save(
      {
        bookId: book.id,
        vouEntity: 'asset-acquisition',
        expectedRevision: null,
        defaultResult: 'UN_POST',
        definition: {
          defaultTemplateId: null,
          rules: [],
          templates: [],
          assetConfiguration: {
            assetSubjectId: assetSubject.id,
            assetDimensions: { ASSET: 'line.assetId' },
            accumulatedDepreciationSubjectId: equity.id,
            accumulatedDepreciationDimensions: {},
            depreciationExpenseSubjectId: equity.id,
            depreciationExpenseDimensions: {},
          },
        },
      },
      { ...f.actor, permissions: ['/acc/mapping/save'] },
    )
    await mappings.save(
      {
        bookId: book.id,
        vouEntity: 'asset-liquidation',
        expectedRevision: null,
        defaultResult: 'UN_POST',
        definition: {
          defaultTemplateId: null,
          rules: [],
          templates: [],
          assetConfiguration: null,
        },
      },
      { ...f.actor, permissions: ['/acc/mapping/save'] },
    )
    const auxActor = {
      ...f.actor,
      permissions: ['/aux/asset-category/create', '/aux/department/create'],
    }
    const category = await f.aux.create(
      'asset-category',
      {
        name: '期初资产类别',
        defaultUsefulLifeMonths: 12,
        defaultResidualRate: '0.00',
      },
      auxActor,
    )
    const department = await f.aux.create(
      'department',
      { name: '期初资产部门' },
      auxActor,
    )
    const openingId = ulid(),
      assetId = ulid()
    const opening = await openings.submitOpening(
      {
        bookId: book.id,
        submissionId: openingId,
        idempotencyKey: openingId,
        lines: [
          {
            subjectId: assetSubject.id,
            currency: 'CNY',
            direction: 'DEBIT',
            amount: '100.00',
            dimensions: { ASSET: assetId },
          },
          {
            subjectId: equity.id,
            currency: 'CNY',
            direction: 'CREDIT',
            amount: '100.00',
            dimensions: {},
          },
        ],
        assets: [
          {
            assetId,
            assetNo: ulid(),
            name: '期初设备',
            categoryId: category.id,
            departmentId: department.id,
            usefulLifeMonths: 12,
            residualRate: '0.00',
            acquiredOn: '2026-08-01',
            currency: 'CNY',
            originalValue: '100.00',
            accumulatedDepreciation: '0.00',
          },
        ],
        bills: [],
        containers: [],
      },
      f.actor,
      'opening-asset',
    )
    await openings.reviewOpening(
      'approve',
      {
        bookId: book.id,
        submissionId: openingId,
        expectedRevision: opening.approval.revision,
      },
      f.reviewerActor,
      'opening-asset',
    )
    const id = ulid()
    const saved = await vou.submit(
      'asset-liquidation',
      'submit-new',
      {
        documentId: ulid(),
        submissionId: id,
        idempotencyKey: id,
        expectedRevision: null,
        payload: {
          businessDate: '2026-09-09',
          currency: 'CNY',
          attachments: [],
          assetLiquidationLines: [
            {
              assetId,
              reason: '报废',
              salvageIncome: '0.00',
              disposalExpense: '0.00',
            },
          ],
        },
      },
      f.actor,
      'opening-asset',
    )
    const retired = await vou.review(
      'asset-liquidation',
      'approve',
      {
        documentId: saved.documentId,
        submissionId: id,
        expectedRevision: saved.revision,
      },
      f.reviewerActor,
      'opening-asset',
    )
    assert.equal(
      (
        await db
          .selectFrom('acc_asset_registers')
          .select('status')
          .where('id', '=', assetId)
          .executeTakeFirstOrThrow()
      ).status,
      'RETIRED',
    )
    await vou.review(
      'asset-liquidation',
      'unapprove',
      {
        documentId: saved.documentId,
        submissionId: id,
        expectedRevision: retired.revision,
        reason: '恢复',
      },
      f.reviewerActor,
      'opening-asset',
    )
    assert.deepEqual(
      await db
        .selectFrom('acc_asset_registers')
        .select([
          'status',
          'state_vou_approval_entry_id',
          'state_opening_approval_entry_id',
        ])
        .where('id', '=', assetId)
        .executeTakeFirstOrThrow(),
      {
        status: 'ACTIVE',
        state_vou_approval_entry_id: null,
        state_opening_approval_entry_id: openingId,
      },
    )
  })
})

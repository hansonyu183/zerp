import assert from 'node:assert/strict'
import test from 'node:test'
import { ulid } from 'ulid'
import type { VouEntity, VouPayload, VouPayloadFor } from '@zerp/model'
import { withWflDatabase } from './wfl-fixture.ts'
import { seedVouCatalogFixture } from '../fixtures/vou-catalog.ts'
import { VouService } from '../../src/vou/service.ts'
import { AccService } from '../../src/acc/service.ts'

test('asset entry rejects missing assets and duplicate disposal lines before saving', async () => {
  await withWflDatabase(async (db) => {
    const f = await seedVouCatalogFixture(db)
    const payload = f.documents['asset-sale']
      .payload as VouPayloadFor<'asset-sale'>
    const id = ulid()
    await assert.rejects(
      f.vou.submit(
        'asset-sale',
        'submit-new',
        {
          documentId: ulid(),
          submissionId: id,
          idempotencyKey: id,
          expectedRevision: null,
          payload: {
            ...payload,
            assetSaleLines: [{ assetId: ulid(), saleAmount: '1.00' }],
          },
        },
        f.actor,
        'missing-asset',
      ),
      /vou_reference_unavailable/,
    )
  })
})

test('asset acquisition, sale and liquidation use the real register with downstream reversal blockers', async () => {
  await withWflDatabase(async (db) => {
    const f = await seedVouCatalogFixture(db)
    const vou = new VouService(db, {
      acc: new AccService(db),
      wfl: { async apply() {} },
    })
    async function submit(entity: VouEntity, payload: VouPayload) {
      const id = ulid()
      return vou.submit(
        entity,
        'submit-new',
        {
          documentId: ulid(),
          submissionId: id,
          idempotencyKey: id,
          expectedRevision: null,
          payload,
        },
        f.actor,
        'asset-lifecycle',
      )
    }
    async function review(
      document: Awaited<ReturnType<typeof submit>>,
      action: 'approve' | 'unapprove',
    ) {
      return vou.review(
        document.entity,
        action,
        {
          documentId: document.documentId,
          submissionId: document.submissionId,
          expectedRevision: document.revision,
          reason: action === 'unapprove' ? '测试撤回' : undefined,
        },
        f.reviewerActor,
        'asset-lifecycle',
      )
    }
    const acquisitionPayload = f.documents['asset-acquisition']
      .payload as VouPayloadFor<'asset-acquisition'>
    let acquisition = await review(
      await submit('asset-acquisition', {
        ...acquisitionPayload,
        assetAcquisitionLines: [
          acquisitionPayload.assetAcquisitionLines[0]!,
          {
            ...acquisitionPayload.assetAcquisitionLines[0]!,
            assetName: '第二资产',
          },
        ],
      }),
      'approve',
    )
    const assets = await db
      .selectFrom('acc_asset_registers')
      .select(['id', 'status'])
      .where('acquisition_vou_approval_entry_id', '=', acquisition.submissionId)
      .orderBy('asset_no')
      .execute()
    assert.equal(assets.length, 2)
    assert.deepEqual(
      await db
        .selectFrom('acc_asset_depreciation_basis')
        .select('asset_id')
        .where(
          'asset_id',
          'in',
          assets.map((a) => a.id),
        )
        .execute(),
      [],
    )
    const salePayload = f.documents['asset-sale']
      .payload as VouPayloadFor<'asset-sale'>
    const duplicate = [
      { assetId: assets[0]!.id, saleAmount: '1.00' },
      { assetId: assets[0]!.id, saleAmount: '2.00' },
    ]
    await assert.rejects(
      submit('asset-sale', { ...salePayload, assetSaleLines: duplicate }),
      /vou_reference_unavailable/,
    )
    let sale = await review(
      await submit('asset-sale', {
        ...salePayload,
        assetSaleLines: [duplicate[0]!],
      }),
      'approve',
    )
    assert.equal(
      (
        await db
          .selectFrom('acc_asset_registers')
          .select('status')
          .where('id', '=', assets[0]!.id)
          .executeTakeFirstOrThrow()
      ).status,
      'SOLD',
    )
    await assert.rejects(
      review(acquisition, 'unapprove'),
      /acc_register_unapprove_blocked/,
    )
    await assert.rejects(
      submit('asset-sale', { ...salePayload, assetSaleLines: [duplicate[0]!] }),
      /vou_reference_unavailable/,
    )
    sale = await review(sale, 'unapprove')
    const liquidationPayload = f.documents['asset-liquidation']
      .payload as VouPayloadFor<'asset-liquidation'>
    let liquidation = await review(
      await submit('asset-liquidation', {
        ...liquidationPayload,
        assetLiquidationLines: [
          {
            assetId: assets[1]!.id,
            reason: '报废',
            salvageIncome: '0.01',
            disposalExpense: '0.00',
          },
        ],
      }),
      'approve',
    )
    assert.equal(
      (
        await db
          .selectFrom('acc_asset_registers')
          .select('status')
          .where('id', '=', assets[1]!.id)
          .executeTakeFirstOrThrow()
      ).status,
      'RETIRED',
    )
    liquidation = await review(liquidation, 'unapprove')
    acquisition = await review(acquisition, 'unapprove')
    assert.equal(
      (
        await db
          .selectFrom('acc_asset_registers')
          .select('id')
          .where(
            'acquisition_vou_approval_entry_id',
            '=',
            acquisition.submissionId,
          )
          .execute()
      ).length,
      0,
    )
  })
})

test('asset acquisition journals use server-created asset identities and persist per-book values', async () => {
  await withWflDatabase(async (db) => {
    const f = await seedVouCatalogFixture(db),
      acc = new AccService(db)
    const vou = new VouService(db, { acc, wfl: { async apply() {} } })
    const asset = await acc.createSubject(
      {
        id: ulid(),
        bookId: f.book.id,
        code: '1601',
        name: '固定资产',
        parentId: null,
        balanceDirection: 'DEBIT',
        enabled: true,
        requiredDimensions: ['ASSET'],
        inventoryQuantity: false,
        settlementPurpose: 'NONE',
      },
      f.actor,
    )
    const supplier = await acc.createSubject(
      {
        id: ulid(),
        bookId: f.book.id,
        code: '2202',
        name: '供应商往来',
        parentId: null,
        balanceDirection: 'CREDIT',
        enabled: true,
        requiredDimensions: ['SUPPLIER'],
        inventoryQuantity: false,
        settlementPurpose: 'PAYABLE',
      },
      f.actor,
    )
    const accumulated = await acc.createSubject(
      {
        id: ulid(),
        bookId: f.book.id,
        code: '1602',
        name: '累计折旧',
        parentId: null,
        balanceDirection: 'CREDIT',
        enabled: true,
        requiredDimensions: ['ASSET'],
        inventoryQuantity: false,
        settlementPurpose: 'NONE',
      },
      f.actor,
    )
    const expense = await acc.createSubject(
      {
        id: ulid(),
        bookId: f.book.id,
        code: '6602',
        name: '折旧费用',
        parentId: null,
        balanceDirection: 'DEBIT',
        enabled: true,
        requiredDimensions: [],
        inventoryQuantity: false,
        settlementPurpose: 'NONE',
      },
      f.actor,
    )
    const actor = {
      ...f.actor,
      permissions: ['/acc/mapping/get', '/acc/mapping/save'],
    }
    const base = {
      subjectSource: 'FIXED' as const,
      amountField: 'line.originalValue',
      currencyField: 'currency',
      quantityField: null,
      costCounterpartSubjectId: null,
      costCounterpartDimensions: {},
    }
    await f.mappings.save(
      {
        bookId: f.book.id,
        vouEntity: 'asset-acquisition',
        expectedRevision: (
          await f.mappings.get(f.book.id, 'asset-acquisition', actor)
        ).revision,
        defaultResult: 'POST',
        definition: {
          defaultTemplateId: 'asset',
          rules: [],
          templates: [
            {
              templateId: 'asset',
              collection: 'assetAcquisitionLines',
              lines: [
                {
                  ...base,
                  subjectValue: asset.id,
                  direction: 'DEBIT',
                  dimensions: { ASSET: 'line.assetId' },
                },
                {
                  ...base,
                  subjectValue: supplier.id,
                  direction: 'CREDIT',
                  dimensions: { SUPPLIER: 'supplier.objectId' },
                },
              ],
            },
          ],
          assetConfiguration: {
            assetSubjectId: asset.id,
            assetDimensions: { ASSET: 'line.assetId' },
            accumulatedDepreciationSubjectId: accumulated.id,
            accumulatedDepreciationDimensions: { ASSET: 'line.assetId' },
            depreciationExpenseSubjectId: expense.id,
            depreciationExpenseDimensions: {},
          },
        },
      },
      actor,
    )
    const id = ulid()
    const saved = await vou.submit(
      'asset-acquisition',
      'submit-new',
      {
        documentId: ulid(),
        submissionId: id,
        idempotencyKey: id,
        expectedRevision: null,
        payload: f.documents['asset-acquisition'].payload,
      },
      f.actor,
      'asset-post',
    )
    const configured = await f.mappings.get(
      f.book.id,
      'asset-acquisition',
      actor,
    )
    const missing = await f.mappings.save(
      {
        bookId: f.book.id,
        vouEntity: 'asset-acquisition',
        expectedRevision: configured.revision,
        defaultResult: 'POST',
        definition: { ...configured.definition, assetConfiguration: null },
      },
      actor,
    )
    await assert.rejects(
      vou.review(
        'asset-acquisition',
        'approve',
        {
          documentId: saved.documentId,
          submissionId: id,
          expectedRevision: saved.revision,
        },
        f.reviewerActor,
        'asset-post',
      ),
      /acc_period_depreciation_mapping_invalid/,
    )
    assert.deepEqual(
      await db
        .selectFrom('acc_asset_registers')
        .select('id')
        .where('acquisition_vou_approval_entry_id', '=', id)
        .execute(),
      [],
    )
    assert.deepEqual(
      await db
        .selectFrom('acc_journal_entries')
        .select('id')
        .where('vou_approval_entry_id', '=', id)
        .execute(),
      [],
    )
    const disabledInput = {
      id: ulid(),
      bookId: f.book.id,
      code: '6603',
      name: '停用前采用的费用',
      parentId: null,
      balanceDirection: 'DEBIT' as const,
      enabled: true,
      requiredDimensions: [],
      inventoryQuantity: false,
      settlementPurpose: 'NONE' as const,
    }
    const disabledExpense = await acc.createSubject(disabledInput, f.actor)
    const obsolete = await f.mappings.save(
      {
        bookId: f.book.id,
        vouEntity: 'asset-acquisition',
        expectedRevision: missing.revision,
        defaultResult: 'POST',
        definition: {
          ...configured.definition,
          assetConfiguration: {
            ...configured.definition.assetConfiguration!,
            depreciationExpenseSubjectId: disabledExpense.id,
          },
        },
      },
      actor,
    )
    await acc.saveSubject(
      {
        ...disabledInput,
        enabled: false,
        expectedRevision: disabledExpense.revision,
      },
      f.actor,
    )
    await assert.rejects(
      vou.review(
        'asset-acquisition',
        'approve',
        {
          documentId: saved.documentId,
          submissionId: id,
          expectedRevision: saved.revision,
        },
        f.reviewerActor,
        'asset-post',
      ),
      /acc_period_depreciation_mapping_invalid/,
    )
    assert.deepEqual(
      await db
        .selectFrom('acc_asset_registers')
        .select('id')
        .where('acquisition_vou_approval_entry_id', '=', id)
        .execute(),
      [],
    )
    await f.mappings.save(
      {
        bookId: f.book.id,
        vouEntity: 'asset-acquisition',
        expectedRevision: obsolete.revision,
        defaultResult: 'POST',
        definition: configured.definition,
      },
      actor,
    )
    const approved = await vou.review(
      'asset-acquisition',
      'approve',
      {
        documentId: saved.documentId,
        submissionId: id,
        expectedRevision: saved.revision,
      },
      f.reviewerActor,
      'asset-post',
    )
    const card = await db
      .selectFrom('acc_asset_registers')
      .select('id')
      .where('acquisition_vou_approval_entry_id', '=', id)
      .executeTakeFirstOrThrow()
    assert.partialDeepStrictEqual(
      await db
        .selectFrom('acc_asset_depreciation_basis')
        .selectAll()
        .where('asset_id', '=', card.id)
        .where('book_id', '=', f.book.id)
        .executeTakeFirstOrThrow(),
      {
        accumulated_subject_id: accumulated.id,
        accumulated_dimensions: { ASSET: card.id },
        expense_subject_id: expense.id,
        expense_dimensions: {},
      },
    )
    const entries = await db
      .selectFrom('acc_journal_lines as l')
      .innerJoin('acc_journal_entries as j', 'j.id', 'l.journal_entry_id')
      .select(['l.subject_id', 'l.direction', 'l.amount', 'l.dimensions'])
      .where('j.vou_approval_entry_id', '=', id)
      .execute()
    assert.equal(entries.length, 2)
    assert.partialDeepStrictEqual(
      entries.find((row) => row.subject_id === asset.id),
      {
        direction: 'DEBIT',
        amount: '12.30000000',
        dimensions: { ASSET: card.id },
      },
    )
    assert.equal(
      (
        await db
          .selectFrom('acc_asset_book_values')
          .select('original_value')
          .where('asset_id', '=', card.id)
          .where('book_id', '=', f.book.id)
          .executeTakeFirstOrThrow()
      ).original_value,
      '12.30000000',
    )
    await vou.review(
      'asset-acquisition',
      'unapprove',
      {
        documentId: saved.documentId,
        submissionId: id,
        expectedRevision: approved.revision,
        reason: '撤回',
      },
      f.reviewerActor,
      'asset-reverse',
    )
    assert.equal(
      (
        await db
          .selectFrom('acc_journal_entries')
          .select('id')
          .where('vou_approval_entry_id', '=', id)
          .execute()
      ).length,
      0,
    )
  })
})

import assert from 'node:assert/strict'
import test from 'node:test'
import { sql } from 'kysely'
import { ulid } from 'ulid'
import { withWflDatabase } from './wfl-fixture.ts'
import { seedProductionFixture } from '../fixtures/vou-production.ts'
import { AccService } from '../../src/acc/service.ts'
import { AccMappingCatalogService } from '../../src/acc/mapping-catalog.ts'
import { VouOpeningService } from '../../src/vou/opening-service.ts'
import { VouService } from '../../src/vou/service.ts'

import { approveEmptyIntermediaryMonth } from '../fixtures/vou-intermediary.ts'

for (const scenario of [
  {
    name: 'three months with final tail',
    original: '1.00',
    accumulated: '0.00',
    residual: '0.00',
    life: 3,
    acquired: '2026-05-01',
    amount: '0.33000000',
    months: ['2026-06', '2026-07', '2026-08'],
    expected: ['0.33000000', '0.33000000', '0.34000000'],
  },
  {
    name: 'disposal month and subsequent month',
    original: '1.00',
    accumulated: '0.00',
    residual: '0.00',
    life: 3,
    acquired: '2026-06-01',
    amount: '0.33000000',
    months: ['2026-07', '2026-08'],
    expected: ['0.33000000', null],
    dispose: true,
  },
  {
    name: 'monthly cents',
    original: '1.00',
    accumulated: '0.00',
    residual: '0.00',
    life: 3,
    acquired: '2026-07-01',
    amount: '0.33000000',
  },
  {
    name: 'final cent',
    original: '1.00',
    accumulated: '0.66',
    residual: '0.00',
    life: 3,
    acquired: '2026-05-01',
    amount: '0.34000000',
  },
  {
    name: 'percentage residual',
    original: '100.00',
    accumulated: '0.00',
    residual: '5.00',
    life: 2,
    acquired: '2026-07-01',
    amount: '47.50000000',
  },
  {
    name: 'acquisition month',
    original: '1.00',
    accumulated: '0.00',
    residual: '0.00',
    life: 3,
    acquired: '2026-08-01',
    amount: null,
  },
  {
    name: 'residual reached',
    original: '100.00',
    accumulated: '95.00',
    residual: '5.00',
    life: 2,
    acquired: '2026-05-01',
    amount: null,
  },
])
  test(`ACC depreciation ${scenario.name} reverses and recomputes deterministically`, async () => {
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
          startMonth: scenario.months?.[0] ?? '2026-08',
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
      const accumulatedSubject = await acc.createSubject(
        {
          id: ulid(),
          bookId: book.id,
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
              accumulatedDepreciationSubjectId: accumulatedSubject.id,
              accumulatedDepreciationDimensions: { ASSET: 'line.assetId' },
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
              amount: scenario.original,
              dimensions: { ASSET: assetId },
            },
            {
              subjectId: equity.id,
              currency: 'CNY',
              direction: 'CREDIT',
              amount: (
                Number(scenario.original) - Number(scenario.accumulated)
              ).toFixed(2),
              dimensions: {},
            },
            ...(Number(scenario.accumulated) > 0
              ? [
                  {
                    subjectId: accumulatedSubject.id,
                    currency: 'CNY',
                    direction: 'CREDIT' as const,
                    amount: scenario.accumulated,
                    dimensions: { ASSET: assetId },
                  },
                ]
              : []),
          ],
          assets: [
            {
              assetId,
              assetNo: ulid(),
              name: '期初设备',
              categoryId: category.id,
              departmentId: department.id,
              usefulLifeMonths: scenario.life,
              residualRate: scenario.residual,
              acquiredOn: scenario.acquired,
              currency: 'CNY',
              originalValue: scenario.original,
              accumulatedDepreciation: scenario.accumulated,
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

      const months = scenario.months ?? ['2026-08']
      if (scenario.dispose) {
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
              businessDate: `${months[0]}-09`,
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
          'depreciation-disposal',
        )
        await vou.review(
          'asset-liquidation',
          'approve',
          {
            documentId: saved.documentId,
            submissionId: id,
            expectedRevision: saved.revision,
          },
          f.reviewerActor,
          'depreciation-disposal',
        )
      }
      const cumulative = async () =>
        (
          await db
            .selectFrom('acc_asset_book_values')
            .select('accumulated_depreciation')
            .where('book_id', '=', book.id)
            .where('asset_id', '=', assetId)
            .executeTakeFirstOrThrow()
        ).accumulated_depreciation
      let expectedCumulative = Number(scenario.accumulated)
      for (const [index, month] of months.entries()) {
        const expected = scenario.expected
          ? scenario.expected[index]
          : scenario.amount
        const date = new Date(
          Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0),
        )
          .toISOString()
          .slice(0, 10)
        await approveEmptyIntermediaryMonth(
          db,
          vou,
          date,
          f.actor,
          f.reviewerActor,
        )
        const amounts = async () =>
          (
            await sql<{
              amount: string
            }>`SELECT l.amount::text FROM acc_journal_lines l JOIN acc_journal_entries j ON j.id=l.journal_entry_id WHERE j.book_id=${book.id} AND j.business_date=${date}::date AND j.source_kind='DEPRECIATION' AND l.direction='DEBIT'`.execute(
              db,
            )
          ).rows.map((r) => r.amount)
        if (scenario.name === 'monthly cents') {
          await sql`ALTER TABLE acc_period_balances ADD CONSTRAINT depreciation_failure CHECK (subject_id <> ${sql.lit(equity.id)})`.execute(
            db,
          )
          await assert.rejects(
            acc.setPeriod(
              { bookId: book.id, month, expectedRevision: null },
              true,
              f.actor,
            ),
            /depreciation_failure/,
          )
          assert.deepEqual(await amounts(), [])
          assert.equal(Number(await cumulative()), expectedCumulative)
          await sql`ALTER TABLE acc_period_balances DROP CONSTRAINT depreciation_failure`.execute(
            db,
          )
        }
        const locked = await acc.setPeriod(
          { bookId: book.id, month, expectedRevision: null },
          true,
          f.actor,
        )
        assert.deepEqual(await amounts(), expected ? [expected] : [])
        assert.equal(
          Number(await cumulative()),
          Number((expectedCumulative + Number(expected ?? 0)).toFixed(2)),
        )
        const unlocked = await acc.setPeriod(
          { bookId: book.id, month, expectedRevision: locked.revision },
          false,
          f.actor,
        )
        assert.deepEqual(await amounts(), [])
        assert.equal(Number(await cumulative()), expectedCumulative)
        await acc.setPeriod(
          { bookId: book.id, month, expectedRevision: unlocked.revision },
          true,
          f.actor,
        )
        assert.deepEqual(await amounts(), expected ? [expected] : [])
        expectedCumulative = Number(
          (expectedCumulative + Number(expected ?? 0)).toFixed(2),
        )
        assert.equal(Number(await cumulative()), expectedCumulative)
      }
    })
  })

import assert from 'node:assert/strict'
import test from 'node:test'
import { ulid } from 'ulid'
import type { VouPayloadFor } from '@zerp/model'
import { withWflDatabase } from './wfl-fixture.ts'
import { seedVouCatalogFixture } from '../fixtures/vou-catalog.ts'

test('money submissions enforce receipt allocations and exact customer-subunit refund references', async () => {
  await withWflDatabase(async (db) => {
    const fixture = await seedVouCatalogFixture(db)
    const receipt = fixture.documents['sales-receipt']
      .payload as VouPayloadFor<'sales-receipt'>
    const input = (payload: VouPayloadFor<'sales-receipt'>) => {
      const id = ulid()
      return {
        documentId: ulid(),
        submissionId: id,
        idempotencyKey: id,
        expectedRevision: null,
        payload,
      }
    }
    await assert.rejects(
      fixture.vou.submit(
        'sales-receipt',
        'submit-new',
        input({ ...receipt, amount: '12.31' }),
        fixture.actor,
        'receipt-mismatch',
      ),
      (error: unknown) =>
        error instanceof Error &&
        error.message === 'vou_allocation_total_mismatch',
    )
    const { seedOrderListFixture } = await import('../fixtures/vou-orders.ts')
    const other = await seedOrderListFixture(db, 0)
    await assert.rejects(
      fixture.vou.submit(
        'sales-receipt',
        'submit-new',
        input({
          ...receipt,
          subunitAllocations: [
            {
              subunit: other.salePayload.customerSubunit,
              amount: receipt.amount,
            },
          ],
        }),
        fixture.actor,
        'receipt-other-customer',
      ),
      (error: unknown) =>
        error instanceof Error && error.message === 'vou_reference_unavailable',
    )
    const refund = fixture.documents['sales-refund']
      .payload as VouPayloadFor<'sales-refund'>
    assert.equal(
      refund.customer.objectId,
      fixture.salePayload.customerSubunit.objectId,
    )
    const wrongId = ulid()
    await assert.rejects(
      fixture.vou.submit(
        'sales-refund',
        'submit-new',
        {
          documentId: ulid(),
          submissionId: wrongId,
          idempotencyKey: wrongId,
          expectedRevision: null,
          payload: { ...refund, customer: receipt.customer },
        },
        fixture.actor,
        'refund-parent',
      ),
      (error: unknown) =>
        error instanceof Error && error.message === 'vou_reference_unavailable',
    )
    const wrongCurrency = ulid()
    await assert.rejects(
      fixture.vou.submit(
        'sales-refund',
        'submit-new',
        {
          documentId: ulid(),
          submissionId: wrongCurrency,
          idempotencyKey: wrongCurrency,
          expectedRevision: null,
          payload: { ...refund, currency: 'USD' },
        },
        fixture.actor,
        'refund-currency',
      ),
      (error: unknown) =>
        error instanceof Error && error.message === 'vou_reference_unavailable',
    )
  })
})

test('financial approval posts funds through Hono and blocks reversing a receipt already spent', async () => {
  await withWflDatabase(async (db) => {
    const [
      { AccService },
      { AccMappingCatalogService },
      { VouService },
      { createApp },
      { SessionService },
      { loadConfig },
      { modelBuildId },
    ] = await Promise.all([
      import('../../src/acc/service.ts'),
      import('../../src/acc/mapping-catalog.ts'),
      import('../../src/vou/service.ts'),
      import('../../src/app.ts'),
      import('../../src/app/session.ts'),
      import('../../src/platform/config.ts'),
      import('@zerp/model'),
    ])
    const fixture = await seedVouCatalogFixture(db)
    const acc = new AccService(db),
      mappings = new AccMappingCatalogService(db)
    await acc.syncVouEntityCatalog()
    const book = fixture.book
    const fund = await acc.createSubject(
      {
        id: ulid(),
        bookId: book.id,
        code: '1002',
        name: '银行资金',
        parentId: null,
        balanceDirection: 'DEBIT',
        enabled: true,
        requiredDimensions: ['FUND_ACCOUNT'],
        inventoryQuantity: false,
        settlementPurpose: 'NONE',
      },
      fixture.actor,
    )
    const equity = await acc.createSubject(
      {
        id: ulid(),
        bookId: book.id,
        code: '4001',
        name: '资金对应科目',
        parentId: null,
        balanceDirection: 'CREDIT',
        enabled: true,
        requiredDimensions: [],
        inventoryQuantity: false,
        settlementPurpose: 'NONE',
      },
      fixture.actor,
    )
    for (const entity of ['other-income', 'employee-loan'] as const) {
      const incoming = entity === 'other-income'
      await mappings.save(
        {
          bookId: book.id,
          vouEntity: entity,
          expectedRevision: (
            await mappings.get(book.id, entity, {
              ...fixture.actor,
              permissions: ['/acc/mapping/get'],
            })
          ).revision,
          defaultResult: 'POST',
          definition: {
            defaultTemplateId: 'fund',
            rules: [],
            templates: [
              {
                templateId: 'fund',
                collection: null,
                lines: [
                  {
                    subjectSource: 'FIXED',
                    subjectValue: fund.id,
                    direction: incoming ? 'DEBIT' : 'CREDIT',
                    amountField: 'amount',
                    currencyField: 'currency',
                    dimensions: { FUND_ACCOUNT: 'fundAccount.objectId' },
                    quantityField: null,
                    costCounterpartSubjectId: null,
                    costCounterpartDimensions: {},
                  },
                  {
                    subjectSource: 'FIXED',
                    subjectValue: equity.id,
                    direction: incoming ? 'CREDIT' : 'DEBIT',
                    amountField: 'amount',
                    currencyField: 'currency',
                    dimensions: {},
                    quantityField: null,
                    costCounterpartSubjectId: null,
                    costCounterpartDimensions: {},
                  },
                ],
              },
            ],
            assetConfiguration: null,
          },
        },
        {
          ...fixture.actor,
          permissions: [...fixture.actor.permissions, '/acc/mapping/save'],
        },
      )
    }
    const vou = new VouService(db, { acc, wfl: { async apply() {} } })
    const config = loadConfig({
      DATABASE_URL: process.env.TARGET_TEST_DATABASE_URL!,
      APP_SESSION_COOKIE_SECURE: 'false',
    })
    const app = createApp({
      config,
      session: new SessionService(db, config),
      vou,
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
    const post = async (entity: string, action: string, input: unknown) =>
      (
        await app.request(`/vou/${entity}/${action}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-zerp-model-build': modelBuildId,
            'x-csrf-token': session.data.csrfToken,
            cookie: signin.headers.getSetCookie()[0]!,
          },
          body: JSON.stringify(input),
        })
      ).json()
    const saved = []
    for (const entity of ['other-income', 'employee-loan'] as const) {
      const id = ulid()
      const result = await vou.submit(
        entity,
        'submit-new',
        {
          documentId: ulid(),
          submissionId: id,
          idempotencyKey: id,
          expectedRevision: null,
          payload: fixture.documents[entity].payload,
        },
        fixture.actor,
        'financial-submit',
      )
      const approved = await post(entity, 'approve', {
        documentId: result.documentId,
        submissionId: id,
        expectedRevision: result.revision,
      })
      assert.equal(approved.code, 0, JSON.stringify(approved))
      saved.push(approved.data)
    }
    const [income, loan] = saved
    const blocked = await post('other-income', 'unapprove', {
      documentId: income.documentId,
      submissionId: income.submissionId,
      expectedRevision: income.revision,
      reason: '原来款已支用',
    })
    assert.equal(blocked.errorKey, 'funds_insufficient')
    assert.ok(blocked.data.blockers.length)
    assert.equal(
      (await vou.get('other-income', income.documentId, fixture.reviewerActor))
        .status,
      'APPROVED',
    )
    assert.equal(
      (
        await post('employee-loan', 'unapprove', {
          documentId: loan.documentId,
          submissionId: loan.submissionId,
          expectedRevision: loan.revision,
          reason: '撤销支用',
        })
      ).code,
      0,
    )
    assert.equal(
      (
        await post('other-income', 'unapprove', {
          documentId: income.documentId,
          submissionId: income.submissionId,
          expectedRevision: income.revision,
          reason: '撤销来款',
        })
      ).code,
      0,
    )
    const entries = await db
      .selectFrom('acc_journal_entries')
      .select('id')
      .where('vou_approval_entry_id', 'in', [
        income.submissionId,
        loan.submissionId,
      ])
      .execute()
    assert.equal(entries.length, 0)
  })
})

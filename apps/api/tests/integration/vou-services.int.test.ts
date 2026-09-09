import assert from 'node:assert/strict'
import test from 'node:test'
import { ulid } from 'ulid'
import type { VouPayloadFor } from '@zerp/model'
import { withWflDatabase } from './wfl-fixture.ts'
import { seedVouCatalogFixture } from '../fixtures/vou-catalog.ts'

test('service acceptance requires an approved Other Unit contract and preserves its settlement facts', async () => {
  await withWflDatabase(async (db) => {
    const fixture = await seedVouCatalogFixture(db)
    const payload = fixture.documents['service-acceptance']
      .payload as VouPayloadFor<'service-acceptance'>
    const submit = (value: typeof payload) => {
      const id = ulid()
      return fixture.vou.submit(
        'service-acceptance',
        'submit-new',
        {
          documentId: ulid(),
          submissionId: id,
          idempotencyKey: id,
          expectedRevision: null,
          payload: value,
        },
        fixture.actor,
        'service-test',
      )
    }
    await assert.rejects(
      submit({
        ...payload,
        serviceAcceptance: {
          ...payload.serviceAcceptance,
          contractDocumentId: ulid(),
        },
      }),
      /vou_reference_unavailable/,
    )
    await assert.rejects(
      submit({ ...payload, currency: 'USD' }),
      /vou_invalid_payload/,
    )
    await assert.rejects(
      submit({ ...payload, amount: '0.00' }),
      /vou_invalid_payload/,
    )
    const saved = await submit({ ...payload, amount: '12.34' })
    assert.equal('amount' in saved.payload && saved.payload.amount, '12.34')
    assert.equal(
      saved.payload.parentDocumentId,
      payload.serviceAcceptance.contractDocumentId,
    )
    assert.deepEqual(
      'counterparty' in saved.payload && saved.payload.counterparty,
      'counterparty' in fixture.documents['service-contract'].payload && {
        ...fixture.documents['service-contract'].payload.counterparty,
        selectionOrigin: 'HISTORICAL',
      },
    )
    const contract = fixture.documents['service-contract']
    await assert.rejects(
      fixture.vou.review(
        'service-contract',
        'unapprove',
        {
          documentId: contract.documentId,
          submissionId: contract.submissionId,
          expectedRevision: contract.revision,
        },
        fixture.reviewerActor,
        'contract-blocked',
      ),
      /blocked/,
    )
  })
})

test('Hono approval posts service settlement to the adopted Other Unit and reverses it', async () => {
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
      mappings = new AccMappingCatalogService(db),
      book = fixture.book
    const other = await acc.createSubject(
      {
        id: ulid(),
        bookId: book.id,
        code: '2241',
        name: '服务其他往来',
        parentId: null,
        balanceDirection: 'CREDIT',
        enabled: true,
        requiredDimensions: ['OTHER_UNIT'],
        inventoryQuantity: false,
        settlementPurpose: 'OTHER',
      },
      fixture.actor,
    )
    const expense = await acc.createSubject(
      {
        id: ulid(),
        bookId: book.id,
        code: '6602',
        name: '服务费用',
        parentId: null,
        balanceDirection: 'DEBIT',
        enabled: true,
        requiredDimensions: [],
        inventoryQuantity: false,
        settlementPurpose: 'NONE',
      },
      fixture.actor,
    )
    const template = (
      id: string,
      payable: boolean,
    ): Parameters<
      InstanceType<typeof AccMappingCatalogService>['save']
    >[0]['definition']['templates'][number] => ({
      templateId: id,
      collection: null,
      lines: [
        {
          subjectSource: 'FIXED' as const,
          subjectValue: other.id,
          direction: payable ? ('CREDIT' as const) : ('DEBIT' as const),
          amountField: 'amount',
          currencyField: 'currency',
          dimensions: { OTHER_UNIT: 'counterparty.objectId' },
          quantityField: null,
          costCounterpartSubjectId: null,
          costCounterpartDimensions: {},
        },
        {
          subjectSource: 'FIXED' as const,
          subjectValue: expense.id,
          direction: payable ? ('DEBIT' as const) : ('CREDIT' as const),
          amountField: 'amount',
          currencyField: 'currency',
          dimensions: {},
          quantityField: null,
          costCounterpartSubjectId: null,
          costCounterpartDimensions: {},
        },
      ],
    })
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
    const post = async (action: string, body: unknown) =>
      (
        await app.request(`/vou/service-acceptance/${action}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-zerp-model-build': modelBuildId,
            'x-csrf-token': session.data.csrfToken,
            cookie: signin.headers.getSetCookie()[0]!,
          },
          body: JSON.stringify(body),
        })
      ).json()
    await mappings.save(
      {
        bookId: book.id,
        vouEntity: 'service-acceptance',
        expectedRevision: (
          await mappings.get(book.id, 'service-acceptance', {
            ...fixture.actor,
            permissions: ['/acc/mapping/get'],
          })
        ).revision,
        defaultResult: 'POST',
        definition: {
          defaultTemplateId: 'payable',
          rules: [
            {
              conditions: [
                {
                  field: 'serviceAcceptance.settlementDirection',
                  operator: 'EQ',
                  values: ['RECEIVABLE'],
                },
              ],
              result: 'POST',
              templateId: 'receivable',
            },
          ],
          templates: [template('payable', true), template('receivable', false)],
          assetConfiguration: null,
        },
      },
      { ...fixture.actor, permissions: ['/acc/mapping/save'] },
    )
    for (const direction of ['PAYABLE', 'RECEIVABLE'] as const) {
      const payload = fixture.documents['service-acceptance']
          .payload as VouPayloadFor<'service-acceptance'>,
        id = ulid()
      const saved = await vou.submit(
        'service-acceptance',
        'submit-new',
        {
          documentId: ulid(),
          submissionId: id,
          idempotencyKey: id,
          expectedRevision: null,
          payload: {
            ...payload,
            serviceAcceptance: {
              ...payload.serviceAcceptance,
              settlementDirection: direction,
            },
          },
        },
        fixture.actor,
        'service-posting',
      )
      const approved = await post('approve', {
        documentId: saved.documentId,
        submissionId: id,
        expectedRevision: saved.revision,
      })
      assert.equal(approved.code, 0, JSON.stringify(approved))
      const entries = await db
        .selectFrom('acc_journal_entries')
        .select('id')
        .where('vou_approval_entry_id', '=', id)
        .execute()
      assert.equal(entries.length, 1)
      const lines = await db
        .selectFrom('acc_journal_lines')
        .selectAll()
        .where('journal_entry_id', '=', entries[0]!.id)
        .where('subject_id', '=', other.id)
        .execute()
      assert.equal(lines.length, 1)
      assert.equal(lines[0]!.amount, '12.30000000')
      assert.equal(
        lines[0]!.direction,
        direction === 'PAYABLE' ? 'CREDIT' : 'DEBIT',
      )
      assert.deepEqual(lines[0]!.dimensions, {
        OTHER_UNIT: payload.counterparty!.objectId,
      })
      const reversed = await post('unapprove', {
        documentId: saved.documentId,
        submissionId: id,
        expectedRevision: approved.data.revision,
        reason: '撤销验收',
      })
      assert.equal(reversed.code, 0, JSON.stringify(reversed))
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
    }
  })
})

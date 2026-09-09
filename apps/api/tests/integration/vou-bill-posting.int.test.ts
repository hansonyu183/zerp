import assert from 'node:assert/strict'
import test from 'node:test'
import { ulid } from 'ulid'
import type {
  VouEntity,
  VouPayload,
  VouPayloadFor,
  AccSubjectDimension,
} from '@zerp/model'
import { modelBuildId } from '@zerp/model'
import { withWflDatabase } from './wfl-fixture.ts'
import { seedVouCatalogFixture } from '../fixtures/vou-catalog.ts'
import { AccService } from '../../src/acc/service.ts'
import type { AccMappingDefinition } from '../../src/acc/mapping-catalog.ts'
import { VouService } from '../../src/vou/service.ts'
import { createApp } from '../../src/app.ts'
import { SessionService } from '../../src/app/session.ts'
import { loadConfig } from '../../src/platform/config.ts'

test('bill issue posts two bills, two real cash accounts and 365-day third-party interest atomically through Hono', async () => {
  await withWflDatabase(async (db) => {
    const f = await seedVouCatalogFixture(db),
      acc = new AccService(db)
    const vou = new VouService(db, { acc, wfl: { async apply() {} } })
    const mappingActor = {
      ...f.actor,
      permissions: ['/acc/mapping/get', '/acc/mapping/save'],
    }
    const account = async (
      code: string,
      dimensions: AccSubjectDimension[],
      direction: 'DEBIT' | 'CREDIT' = 'DEBIT',
    ) =>
      acc.createSubject(
        {
          id: ulid(),
          bookId: f.book.id,
          code,
          name: code,
          parentId: null,
          balanceDirection: direction,
          enabled: true,
          requiredDimensions: dimensions,
          inventoryQuantity: false,
          settlementPurpose: 'NONE',
        },
        f.actor,
      )
    const fund = await account('1002', ['FUND_ACCOUNT'])
    const liability = await account('2201', ['BILL'], 'CREDIT')
    const supplier = await account('2202', ['SUPPLIER'], 'CREDIT')
    const other = await account('2241', ['OTHER_UNIT'], 'CREDIT')
    const expense = await account('6603', [])
    const equity = await account('4001', [], 'CREDIT')
    type Line = AccMappingDefinition['templates'][number]['lines'][number]
    const line = (
      subjectValue: string,
      direction: 'DEBIT' | 'CREDIT',
      amountField: string,
      collection: string | null,
      dimensions: Record<string, string> = {},
    ): Line => ({
      subjectSource: 'FIXED',
      subjectValue,
      direction,
      amountField,
      collection,
      currencyField: 'currency',
      dimensions,
      quantityField: null,
      costCounterpartSubjectId: null,
      costCounterpartDimensions: {},
    })
    const mapping = async (entity: VouEntity, lines: Line[]) =>
      f.mappings.save(
        {
          bookId: f.book.id,
          vouEntity: entity,
          expectedRevision: (
            await f.mappings.get(f.book.id, entity, mappingActor)
          ).revision,
          defaultResult: entity === 'bill-issue' ? 'UN_POST' : 'POST',
          definition: {
            defaultTemplateId: entity === 'bill-issue' ? null : 'bill',
            rules:
              entity === 'bill-issue'
                ? [
                    {
                      conditions: [
                        {
                          field: 'billTotals.interestAmount',
                          operator: 'EQ',
                          values: ['75.62'],
                        },
                      ],
                      result: 'POST',
                      templateId: 'bill',
                    },
                  ]
                : [],
            templates: [{ templateId: 'bill', collection: null, lines }],
            assetConfiguration: null,
          },
        },
        mappingActor,
      )
    await mapping('other-income', [
      line(fund.id, 'DEBIT', 'amount', null, {
        FUND_ACCOUNT: 'fundAccount.objectId',
      }),
      line(equity.id, 'CREDIT', 'amount', null),
    ])
    const income = f.documents['other-income']
      .payload as VouPayloadFor<'other-income'>
    const receipt = f.documents['sales-receipt']
      .payload as VouPayloadFor<'sales-receipt'>
    const secondFund = await f.aux.create(
      'fund-account',
      {
        name: '第二资金账户',
        currency: 'CNY',
        accountName: '第二账户',
        bank: '银行',
        branch: '支行',
        accountNumber: ulid(),
        operatingEntityId: receipt.operatingEntity.objectId,
        remark: '',
      },
      f.actor,
    )
    const submit = async (entity: VouEntity, payload: VouPayload) => {
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
        'bill-posting',
      )
    }
    for (const fundAccount of [
      income.fundAccount,
      { objectId: secondFund.id },
    ]) {
      const saved = await submit('other-income', {
        ...income,
        businessDate: '2026-09-01',
        amount: '200.00',
        fundAccount,
      })
      await vou.review(
        'other-income',
        'approve',
        {
          documentId: saved.documentId,
          submissionId: saved.submissionId,
          expectedRevision: saved.revision,
        },
        f.reviewerActor,
        'bill-funding',
      )
    }
    await mapping('bill-issue', [
      line(liability.id, 'CREDIT', 'line.faceAmount', 'incomingBills', {
        BILL: 'line.billId',
      }),
      line(supplier.id, 'DEBIT', 'billTotals.primaryAmount', null, {
        SUPPLIER: 'supplier.objectId',
      }),
      line(fund.id, 'CREDIT', 'line.amount', 'outgoingBillCash', {
        FUND_ACCOUNT: 'line.fundAccount.objectId',
      }),
      line(expense.id, 'DEBIT', 'line.amount', 'outgoingBillCash'),
      line(other.id, 'CREDIT', 'billTotals.interestAmount', null, {
        OTHER_UNIT: 'interestParty.objectId',
      }),
      line(expense.id, 'DEBIT', 'billTotals.interestAmount', null),
    ])
    const issue = f.documents['bill-issue']
      .payload as VouPayloadFor<'bill-issue'>
    const original = issue.billLines[0]!
    assert.ok('positionType' in original)
    const discount = f.documents['bill-discount']
      .payload as VouPayloadFor<'bill-discount'>
    const saved = await submit('bill-issue', {
      ...issue,
      businessDate: '2026-09-01',
      interestMode: 'THIRD_PARTY_PAYABLE',
      interestParty: discount.counterparty,
      billLines: [
        {
          ...original,
          billNo: ulid(),
          faceAmount: '5000.00',
          issueDate: '2026-09-01',
          maturityDate: '2026-12-02',
          annualRateBps: 300,
        },
        {
          ...original,
          billNo: ulid(),
          faceAmount: '5000.01',
          issueDate: '2026-09-01',
          maturityDate: '2026-12-02',
          annualRateBps: 300,
        },
      ],
      billCashLines: [
        {
          fundAccount: income.fundAccount,
          direction: 'OUT',
          amountType: 'FEE',
          amount: '10.00',
        },
        {
          fundAccount: { objectId: secondFund.id },
          direction: 'OUT',
          amountType: 'FEE',
          amount: '20.00',
        },
      ],
    })
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
        code: f.reviewer.username,
        password: f.reviewer.password,
      }),
    })
    const session = await signin.json()
    assert.equal(session.code, 0)
    const response = await app.request('/vou/bill-issue/approve', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-zerp-model-build': modelBuildId,
        'x-csrf-token': session.data.csrfToken,
        cookie: signin.headers.getSetCookie()[0]!,
      },
      body: JSON.stringify({
        documentId: saved.documentId,
        submissionId: saved.submissionId,
        expectedRevision: saved.revision,
      }),
    })
    const result = await response.json()
    assert.equal(result.code, 0, JSON.stringify(result))
    const rows = await db
      .selectFrom('acc_journal_lines as line')
      .innerJoin(
        'acc_journal_entries as journal',
        'journal.id',
        'line.journal_entry_id',
      )
      .select([
        'line.subject_id',
        'line.direction',
        'line.amount',
        'line.dimensions',
      ])
      .where('journal.vou_approval_entry_id', '=', saved.submissionId)
      .execute()
    assert.equal(rows.length, 9)
    assert.deepEqual(
      rows
        .filter((row) => row.subject_id === other.id)
        .map((row) => [row.direction, row.amount]),
      [['CREDIT', '75.62000000']],
    )
    assert.deepEqual(
      rows
        .filter((row) => row.subject_id === fund.id)
        .map((row) => row.amount)
        .sort(),
      ['10.00000000', '20.00000000'],
    )
    assert.equal(
      (
        await db
          .selectFrom('acc_bill_book_values')
          .select('bill_id')
          .where('created_vou_approval_entry_id', '=', saved.submissionId)
          .where('book_id', '=', f.book.id)
          .execute()
      ).length,
      2,
    )
    await vou.review(
      'bill-issue',
      'unapprove',
      {
        documentId: saved.documentId,
        submissionId: saved.submissionId,
        expectedRevision: result.data.revision,
        reason: '撤回测试',
      },
      f.reviewerActor,
      'bill-unapprove',
    )
    assert.equal(
      (
        await db
          .selectFrom('acc_journal_entries')
          .select('id')
          .where('vou_approval_entry_id', '=', saved.submissionId)
          .execute()
      ).length,
      0,
    )
    assert.equal(
      (
        await db
          .selectFrom('acc_bill_book_values')
          .select('bill_id')
          .where('created_vou_approval_entry_id', '=', saved.submissionId)
          .execute()
      ).length,
      0,
    )
  })
})

for (const mode of ['BANK_DEDUCTED', 'THIRD_PARTY_PAYABLE'] as const)
  test(`discount ${mode} posts only actual bank movement and the correct interest payable`, async () => {
    await withWflDatabase(async (db) => {
      const f = await seedVouCatalogFixture(db),
        acc = new AccService(db),
        vou = new VouService(db, {
          acc: new AccService(db),
          wfl: { async apply() {} },
        })
      const actor = {
        ...f.actor,
        permissions: ['/acc/mapping/get', '/acc/mapping/save'],
      }
      const subject = async (
        code: string,
        requiredDimensions: AccSubjectDimension[],
      ) =>
        acc.createSubject(
          {
            id: ulid(),
            bookId: f.book.id,
            code,
            name: code,
            parentId: null,
            balanceDirection: 'DEBIT',
            enabled: true,
            requiredDimensions,
            inventoryQuantity: false,
            settlementPurpose: 'NONE',
          },
          f.actor,
        )
      const fund = await subject('1002', ['FUND_ACCOUNT']),
        bill = await subject('1121', ['BILL']),
        expense = await subject('6603', []),
        other = await subject('2241', ['OTHER_UNIT'])
      type Line = AccMappingDefinition['templates'][number]['lines'][number]
      const line = (
        subjectValue: string,
        direction: 'DEBIT' | 'CREDIT',
        amountField: string,
        collection: string | null,
        dimensions: Record<string, string> = {},
      ): Line => ({
        subjectSource: 'FIXED',
        subjectValue,
        direction,
        amountField,
        collection,
        currencyField: 'currency',
        dimensions,
        quantityField: null,
        costCounterpartSubjectId: null,
        costCounterpartDimensions: {},
      })
      await f.mappings.save(
        {
          bookId: f.book.id,
          vouEntity: 'bill-discount',
          expectedRevision: (
            await f.mappings.get(f.book.id, 'bill-discount', actor)
          ).revision,
          defaultResult: 'POST',
          definition: {
            defaultTemplateId: 'discount',
            rules: [],
            assetConfiguration: null,
            templates: [
              {
                templateId: 'discount',
                collection: null,
                lines: [
                  line(bill.id, 'CREDIT', 'line.faceAmount', 'outgoingBills', {
                    BILL: 'line.billId',
                  }),
                  line(fund.id, 'DEBIT', 'line.amount', 'incomingBillCash', {
                    FUND_ACCOUNT: 'line.fundAccount.objectId',
                  }),
                  line(fund.id, 'CREDIT', 'line.amount', 'outgoingBillCash', {
                    FUND_ACCOUNT: 'line.fundAccount.objectId',
                  }),
                  line(
                    expense.id,
                    'DEBIT',
                    'billTotals.discountExpenseAmount',
                    null,
                  ),
                  line(
                    expense.id,
                    'CREDIT',
                    'billTotals.discountIncomeAmount',
                    null,
                  ),
                  line(other.id, 'CREDIT', 'billTotals.interestAmount', null, {
                    OTHER_UNIT: 'interestParty.objectId',
                  }),
                ],
              },
            ],
          },
        },
        actor,
      )
      const receipt = f.documents['bill-receipt']
          .payload as VouPayloadFor<'bill-receipt'>,
        original = receipt.billLines[0]!
      assert.ok('positionType' in original)
      const sourceId = ulid()
      let source = await vou.submit(
        'bill-receipt',
        'submit-new',
        {
          documentId: ulid(),
          submissionId: sourceId,
          idempotencyKey: sourceId,
          expectedRevision: null,
          payload: {
            ...receipt,
            businessDate: '2026-09-01',
            billLines: [
              {
                ...original,
                billNo: ulid(),
                faceAmount: '10000.01',
                issueDate: '2026-09-01',
                maturityDate: '2026-12-02',
              },
            ],
          },
        },
        f.actor,
        'discount-source',
      )
      source = await vou.review(
        'bill-receipt',
        'approve',
        {
          documentId: source.documentId,
          submissionId: sourceId,
          expectedRevision: source.revision,
        },
        f.reviewerActor,
        'discount-source',
      )
      const billId = (source.payload as VouPayloadFor<'bill-receipt'>)
        .billLines[0]!.billId!
      const payload = f.documents['bill-discount']
        .payload as VouPayloadFor<'bill-discount'>
      const cash = (
        f.documents['other-income'].payload as VouPayloadFor<'other-income'>
      ).fundAccount
      const id = ulid()
      let saved = await vou.submit(
        'bill-discount',
        'submit-new',
        {
          documentId: ulid(),
          submissionId: id,
          idempotencyKey: id,
          expectedRevision: null,
          payload: {
            ...payload,
            businessDate: '2026-09-01',
            interestMode: mode,
            ...(mode === 'THIRD_PARTY_PAYABLE'
              ? { interestParty: payload.counterparty }
              : {}),
            billLines: [{ billId, purpose: 'PRIMARY', annualRateBps: 300 }],
            billCashLines: [
              {
                fundAccount: cash,
                direction: 'IN',
                amountType: 'PRINCIPAL',
                amount: mode === 'BANK_DEDUCTED' ? '9924.39' : '10000.01',
              },
              {
                fundAccount: cash,
                direction: 'OUT',
                amountType: 'FEE',
                amount: '10.00',
              },
            ],
          },
        },
        f.actor,
        'discount-submit',
      )
      saved = await vou.review(
        'bill-discount',
        'approve',
        {
          documentId: saved.documentId,
          submissionId: id,
          expectedRevision: saved.revision,
        },
        f.reviewerActor,
        'discount-approve',
      )
      const rows = await db
        .selectFrom('acc_journal_lines as l')
        .innerJoin('acc_journal_entries as j', 'j.id', 'l.journal_entry_id')
        .select(['l.subject_id', 'l.direction', 'l.amount'])
        .where('j.vou_approval_entry_id', '=', id)
        .execute()
      assert.equal(rows.filter((row) => row.subject_id === fund.id).length, 2)
      assert.deepEqual(
        rows
          .filter((row) => row.subject_id === expense.id)
          .map((row) => [row.direction, row.amount]),
        [['DEBIT', '85.62000000']],
      )
      assert.deepEqual(
        rows
          .filter((row) => row.subject_id === other.id)
          .map((row) => row.amount),
        mode === 'BANK_DEDUCTED' ? [] : ['75.62000000'],
      )
      await assert.rejects(
        vou.review(
          'bill-receipt',
          'unapprove',
          {
            documentId: source.documentId,
            submissionId: sourceId,
            expectedRevision: source.revision,
            reason: '来源撤回',
          },
          f.reviewerActor,
          'discount-blocker',
        ),
        /acc_register_unapprove_blocked/,
      )
      await vou.review(
        'bill-discount',
        'unapprove',
        {
          documentId: saved.documentId,
          submissionId: id,
          expectedRevision: saved.revision,
          reason: '贴现撤回',
        },
        f.reviewerActor,
        'discount-reverse',
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

test('receipt credits its customer subunit for new bills plus cash minus change and reverses all effects', async () => {
  await withWflDatabase(async (db) => {
    const f = await seedVouCatalogFixture(db),
      acc = new AccService(db)
    const vou = new VouService(db, { acc, wfl: { async apply() {} } })
    const payload = f.documents['bill-receipt']
      .payload as VouPayloadFor<'bill-receipt'>
    const held = (
      f.documents['bill-payment'].payload as VouPayloadFor<'bill-payment'>
    ).billLines[0]!
    assert.ok(!('positionType' in held))
    const cash = (
      f.documents['other-income'].payload as VouPayloadFor<'other-income'>
    ).fundAccount
    const account = async (
      code: string,
      dimensions: AccSubjectDimension[],
      purpose: 'NONE' | 'RECEIVABLE' = 'NONE',
    ) =>
      acc.createSubject(
        {
          id: ulid(),
          bookId: f.book.id,
          code,
          name: code,
          parentId: null,
          balanceDirection: 'DEBIT',
          enabled: true,
          requiredDimensions: dimensions,
          inventoryQuantity: false,
          settlementPurpose: purpose,
        },
        f.actor,
      )
    const billAccount = await account('1121', ['BILL']),
      fund = await account('1002', ['FUND_ACCOUNT']),
      customer = await account('1122', ['CUSTOMER_SUBUNIT'], 'RECEIVABLE')
    type Line = AccMappingDefinition['templates'][number]['lines'][number]
    const line = (
      subjectValue: string,
      direction: 'DEBIT' | 'CREDIT',
      amountField: string,
      collection: string | null,
      dimensions: Record<string, string>,
    ): Line => ({
      subjectSource: 'FIXED',
      subjectValue,
      direction,
      amountField,
      collection,
      currencyField: 'currency',
      dimensions,
      quantityField: null,
      costCounterpartSubjectId: null,
      costCounterpartDimensions: {},
    })
    const actor = {
      ...f.actor,
      permissions: ['/acc/mapping/get', '/acc/mapping/save'],
    }
    await f.mappings.save(
      {
        bookId: f.book.id,
        vouEntity: 'bill-receipt',
        expectedRevision: (
          await f.mappings.get(f.book.id, 'bill-receipt', actor)
        ).revision,
        defaultResult: 'POST',
        definition: {
          defaultTemplateId: 'receipt',
          rules: [],
          templates: [
            {
              templateId: 'receipt',
              collection: null,
              lines: [
                line(
                  billAccount.id,
                  'DEBIT',
                  'line.faceAmount',
                  'incomingBills',
                  { BILL: 'line.billId' },
                ),
                line(
                  billAccount.id,
                  'CREDIT',
                  'line.faceAmount',
                  'outgoingBills',
                  { BILL: 'line.billId' },
                ),
                line(fund.id, 'DEBIT', 'line.amount', 'incomingBillCash', {
                  FUND_ACCOUNT: 'line.fundAccount.objectId',
                }),
                line(
                  customer.id,
                  'CREDIT',
                  'billTotals.netSettlementAmount',
                  null,
                  { CUSTOMER_SUBUNIT: 'customerSubunit.objectId' },
                ),
              ],
            },
          ],
          assetConfiguration: null,
        },
      },
      actor,
    )
    const newLine = payload.billLines[0]!
    assert.ok('positionType' in newLine)
    const id = ulid()
    const saved = await vou.submit(
      'bill-receipt',
      'submit-new',
      {
        documentId: ulid(),
        submissionId: id,
        idempotencyKey: id,
        expectedRevision: null,
        payload: {
          ...payload,
          billLines: [
            { ...newLine, billNo: ulid(), faceAmount: '100.00' },
            { billId: held.billId, purpose: 'CHANGE' },
          ],
          billCashLines: [
            {
              fundAccount: cash,
              direction: 'IN',
              amountType: 'PRINCIPAL',
              amount: '5.00',
            },
          ],
        },
      },
      f.actor,
      'receipt-posting',
    )
    assert.ok('customerSubunit' in saved.payload)
    assert.equal('customer' in saved.payload, false)
    const badId = ulid()
    const root = await db
      .selectFrom('bob_customer_subunit_roots')
      .select('customer_id')
      .where('subunit_id', '=', payload.customerSubunit.objectId)
      .executeTakeFirstOrThrow()
    await assert.rejects(
      vou.submit(
        'bill-receipt',
        'submit-new',
        {
          documentId: ulid(),
          submissionId: badId,
          idempotencyKey: badId,
          expectedRevision: null,
          payload: {
            ...payload,
            customerSubunit: {
              ...payload.customerSubunit,
              objectId: root.customer_id,
            },
          },
        },
        f.actor,
        'receipt-root-rejected',
      ),
      /vou_reference_unavailable/,
    )
    const approved = await vou.review(
      'bill-receipt',
      'approve',
      {
        documentId: saved.documentId,
        submissionId: id,
        expectedRevision: saved.revision,
      },
      f.reviewerActor,
      'receipt-posting',
    )
    const rows = await db
      .selectFrom('acc_journal_lines as l')
      .innerJoin('acc_journal_entries as e', 'e.id', 'l.journal_entry_id')
      .select(['l.subject_id', 'l.direction', 'l.amount', 'l.dimensions'])
      .where('e.vou_approval_entry_id', '=', id)
      .execute()
    assert.equal(rows.length, 4)
    assert.deepEqual(
      rows
        .filter((r) => r.subject_id === customer.id)
        .map((r) => ({
          direction: r.direction,
          amount: r.amount,
          dimensions: r.dimensions,
        })),
      [
        {
          direction: 'CREDIT',
          amount: '92.70000000',
          dimensions: { CUSTOMER_SUBUNIT: payload.customerSubunit.objectId },
        },
      ],
    )
    assert.equal(
      (
        await db
          .selectFrom('acc_bill_registers')
          .select('status')
          .where('id', '=', held.billId)
          .executeTakeFirstOrThrow()
      ).status,
      'REPLACED',
    )
    await vou.review(
      'bill-receipt',
      'unapprove',
      {
        documentId: saved.documentId,
        submissionId: id,
        expectedRevision: approved.revision,
        reason: '恢复收票前',
      },
      f.reviewerActor,
      'receipt-reverse',
    )
    assert.equal(
      (
        await db
          .selectFrom('acc_bill_registers')
          .select('status')
          .where('id', '=', held.billId)
          .executeTakeFirstOrThrow()
      ).status,
      'AVAILABLE',
    )
    assert.equal(
      (
        await db
          .selectFrom('acc_bill_registers')
          .select('id')
          .where('created_vou_approval_entry_id', '=', id)
          .execute()
      ).length,
      0,
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

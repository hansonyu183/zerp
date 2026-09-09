import { AccService } from '../../src/acc/service.ts'
import { VouService } from '../../src/vou/service.ts'
import assert from 'node:assert/strict'
import test from 'node:test'
import { ulid } from 'ulid'
import type { VouPayloadFor } from '@zerp/model'
import { withWflDatabase } from './wfl-fixture.ts'
import { seedVouCatalogFixture } from '../fixtures/vou-catalog.ts'
import { seedOrderListFixture } from '../fixtures/vou-orders.ts'

test('global script is absent until explicitly configured and uses optimistic revisions', async () => {
  await withWflDatabase(async (db) => {
    const fixture = await seedOrderListFixture(db, 0)
    const actor = {
      id: fixture.submitter.userId,
      permissions: [],
      trusted: true,
    }
    assert.equal(await fixture.vou.getIntermediaryScript(actor), null)
    await assert.rejects(
      fixture.vou.saveIntermediaryScript(
        {
          expectedRevision: null,
          name: '脚本',
          source: 'globalThis.calculate=()=>({lines:[],summaries:[]})',
        },
        { ...actor, trusted: false },
      ),
      /approval_invalid_action/,
    )
    const first = await fixture.vou.saveIntermediaryScript(
      {
        expectedRevision: null,
        name: '脚本',
        source: 'globalThis.calculate=()=>({lines:[],summaries:[]})',
      },
      actor,
    )
    assert.equal(first.scriptId, 'GLOBAL')
    assert.equal(first.revision, 1)
    assert.match(first.hash, /^[0-9a-f]{64}$/)
    await assert.rejects(
      fixture.vou.saveIntermediaryScript(
        { expectedRevision: null, name: '覆盖', source: 'anything' },
        actor,
      ),
      /vou_script_stale_revision/,
    )
    const second = await fixture.vou.saveIntermediaryScript(
      {
        expectedRevision: 1,
        name: '新脚本',
        source: 'globalThis.calculate=()=>({lines:[],summaries:[]});',
      },
      actor,
    )
    assert.equal(second.revision, 2)
    assert.notEqual(second.hash, first.hash)
    assert.deepEqual(await fixture.vou.getIntermediaryScript(actor), second)
  })
})

test('month source is server-owned, unique, and historical calculation snapshots survive script changes', async () => {
  await withWflDatabase(async (db) => {
    const fixture = await seedVouCatalogFixture(db)
    const document = fixture.documents['intermediary-calculation']
    const payload =
      document.payload as VouPayloadFor<'intermediary-calculation'>
    const source = await fixture.vou.getIntermediarySource(
      '2026-09-30',
      fixture.actor,
    )
    assert.deepEqual(source.source, payload.intermediaryCalculation.source)
    assert.equal(source.sourceHash, payload.intermediaryCalculation.sourceHash)
    const id = ulid()
    await assert.rejects(
      fixture.vou.submit(
        'intermediary-calculation',
        'submit-new',
        {
          documentId: ulid(),
          submissionId: id,
          idempotencyKey: id,
          expectedRevision: null,
          payload,
        },
        fixture.actor,
        'duplicate-month',
      ),
      /vou_intermediary_month_exists/,
    )
    const forgedId = ulid()
    await assert.rejects(
      fixture.vou.submit(
        'intermediary-calculation',
        'submit-new',
        {
          documentId: ulid(),
          submissionId: forgedId,
          idempotencyKey: forgedId,
          expectedRevision: null,
          payload: {
            ...payload,
            intermediaryCalculation: {
              ...payload.intermediaryCalculation,
              sourceHash: '0'.repeat(64),
            },
          },
        },
        fixture.actor,
        'forged-source',
      ),
      /vou_intermediary_source_changed/,
    )
    const approved = await fixture.vou.review(
      'intermediary-calculation',
      'approve',
      {
        documentId: document.documentId,
        submissionId: document.submissionId,
        expectedRevision: document.revision,
      },
      fixture.reviewerActor,
      'approve-calculation',
    )
    assert.equal(approved.status, 'APPROVED')
    await fixture.vou.saveIntermediaryScript(
      {
        expectedRevision: 1,
        name: '之后修改',
        source: 'globalThis.calculate=()=>({lines:[],summaries:[]});',
      },
      fixture.actor,
    )
    const historical = await fixture.vou.get(
      'intermediary-calculation',
      document.documentId,
      fixture.actor,
    )
    assert.deepEqual(historical.payload, payload)
  })
})

test('a draft must recalculate when approved receipt facts change', async () => {
  await withWflDatabase(async (db) => {
    const fixture = await seedVouCatalogFixture(db)
    const original = fixture.documents['intermediary-calculation'],
      receipt = fixture.documents['bill-receipt']
    await fixture.vou.review(
      'bill-receipt',
      'approve',
      {
        documentId: receipt.documentId,
        submissionId: receipt.submissionId,
        expectedRevision: receipt.revision,
      },
      fixture.reviewerActor,
      'new-receipt',
    )
    await assert.rejects(
      fixture.vou.review(
        'intermediary-calculation',
        'approve',
        {
          documentId: original.documentId,
          submissionId: original.submissionId,
          expectedRevision: original.revision,
        },
        fixture.reviewerActor,
        'stale-calculation',
      ),
      /vou_intermediary_source_changed/,
    )
    const unchanged = await fixture.vou.get(
      'intermediary-calculation',
      original.documentId,
      fixture.actor,
    )
    assert.equal(unchanged.status, 'PENDING')
  })
})

for (const unitPrice of ['0.00', '1.00'])
  test(`signed sales at ${unitPrice} use frozen pieces, FIFO collection and proportional posted reversals`, async (context) => {
    await withWflDatabase(async (db) => {
      const fixture = await seedVouCatalogFixture(db)
      const { BobArchiveService } = await import('../../src/bob/archives.ts')
      const bob = new BobArchiveService(db)
      const productId = fixture.salePayload.productLines[0]!.product.objectId
      const product = await bob.get('product', productId, fixture.actor)
      const versionId = ulid()
      const version = await bob.submit(
        'product',
        'submit-change',
        {
          subjectId: productId,
          submissionId: versionId,
          idempotencyKey: versionId,
          expectedLatestApprovedSubmissionId: product.submissionId,
          expectedLatestApprovedRevision: product.revision,
          snapshot: { ...product.snapshot, defaultPackagingSpec: '3' },
        },
        fixture.actor,
        'piece-basis',
      )
      await bob.review(
        'product',
        'approve',
        {
          subjectId: productId,
          submissionId: versionId,
          expectedRevision: version.revision,
        },
        fixture.reviewerActor,
        'piece-basis',
      )
      const methodCreated = await fixture.aux.ensureE2ESettlementMethod(
        {
          name: '来源现结',
          termCode: 'CASH_ON_DELIVERY',
          ruleType: 'RELATIVE_DAYS',
          monthOffset: 0,
          dayOfMonth: 0,
          dayOffset: 0,
          defaultSalesSurcharge: '0.00',
          description: '',
        },
        { ...fixture.actor, trusted: true },
      )
      const method = await fixture.aux.get(
        'settlement-method',
        { id: methodCreated.id },
        {
          ...fixture.actor,
          permissions: [
            ...fixture.actor.permissions,
            '/aux/settlement-method/get',
          ],
        },
      )
      const customerId = fixture.references.archiveSubjectIds[0]!
      const customer = await bob.get('customer', customerId, fixture.actor),
        customerVersionId = ulid()
      const customerVersion = await bob.submit(
        'customer',
        'submit-change',
        {
          subjectId: customerId,
          submissionId: customerVersionId,
          idempotencyKey: customerVersionId,
          expectedLatestApprovedSubmissionId: customer.submissionId,
          expectedLatestApprovedRevision: customer.revision,
          snapshot: {
            ...customer.snapshot,
            subunits: (
              customer.snapshot.subunits as Array<Record<string, unknown>>
            ).map((subunit) => ({
              ...subunit,
              intent: 'EXISTING',
              settlementMethod: {
                id: method.id,
                code: method.code,
                name: method.name,
                termCode: 'CASH_ON_DELIVERY',
                ruleType: 'RELATIVE_DAYS',
                monthOffset: 0,
                dayOfMonth: 0,
                dayOffset: 0,
                defaultSalesSurcharge: '0.00',
              },
            })),
          },
        },
        fixture.actor,
        'source-settlement',
      )
      await bob.review(
        'customer',
        'approve',
        {
          subjectId: customerId,
          submissionId: customerVersionId,
          expectedRevision: customerVersion.revision,
        },
        fixture.reviewerActor,
        'source-settlement',
      )
      const customerSubunit = {
        ...fixture.salePayload.customerSubunit,
        approvalEntryId: customerVersionId,
      }
      const lineId = ulid()
      const acc = new AccService(db)
      const accountingVou = new VouService(db, {
        acc,
        wfl: { async apply() {} },
      })
      if (unitPrice !== '0.00') {
        const receivable = await acc.createSubject(
          {
            id: ulid(),
            bookId: fixture.book.id,
            code: '1129',
            name: '来源应收',
            parentId: null,
            balanceDirection: 'DEBIT',
            enabled: true,
            requiredDimensions: ['CUSTOMER_SUBUNIT'],
            inventoryQuantity: false,
            settlementPurpose: 'RECEIVABLE',
          },
          fixture.actor,
        )
        const counterpart = await acc.createSubject(
          {
            id: ulid(),
            bookId: fixture.book.id,
            code: '6009',
            name: '来源对方',
            parentId: null,
            balanceDirection: 'CREDIT',
            enabled: true,
            requiredDimensions: [],
            inventoryQuantity: false,
            settlementPurpose: 'NONE',
          },
          fixture.actor,
        )
        for (const entity of ['sale-signoff', 'sales-receipt'] as const) {
          const currentMapping = await fixture.mappings.get(
            fixture.book.id,
            entity,
            {
              ...fixture.actor,
              permissions: [...fixture.actor.permissions, '/acc/mapping/get'],
            },
          )
          const collection =
            entity === 'sale-signoff' ? 'signoffLines' : 'subunitAllocations'
          const amountField =
            entity === 'sale-signoff'
              ? 'line.signedBaseQuantity'
              : 'line.amount'
          await fixture.mappings.save(
            {
              bookId: fixture.book.id,
              vouEntity: entity,
              expectedRevision: currentMapping.revision,
              defaultResult: 'POST',
              definition: {
                defaultTemplateId: 'source',
                rules: [],
                assetConfiguration: null,
                templates: [
                  {
                    templateId: 'source',
                    collection,
                    lines: [
                      {
                        subjectSource: 'FIXED',
                        subjectValue: receivable.id,
                        direction:
                          entity === 'sale-signoff' ? 'DEBIT' : 'CREDIT',
                        amountField,
                        currencyField: 'currency',
                        dimensions: {
                          CUSTOMER_SUBUNIT:
                            entity === 'sales-receipt'
                              ? 'line.subunit.objectId'
                              : 'customerSubunit.objectId',
                        },
                        quantityField: null,
                        costCounterpartSubjectId: null,
                        costCounterpartDimensions: {},
                      },
                      {
                        subjectSource: 'FIXED',
                        subjectValue: counterpart.id,
                        direction:
                          entity === 'sale-signoff' ? 'CREDIT' : 'DEBIT',
                        amountField,
                        currencyField: 'currency',
                        dimensions: {},
                        quantityField: null,
                        costCounterpartSubjectId: null,
                        costCounterpartDimensions: {},
                      },
                    ],
                  },
                ],
              },
            },
            {
              ...fixture.actor,
              permissions: [...fixture.actor.permissions, '/acc/mapping/save'],
            },
          )
        }
      }
      async function create<E extends import('@zerp/model').VouEntity>(
        entity: E,
        payload: VouPayloadFor<E>,
      ) {
        const id = ulid()
        const service =
          entity === 'intermediary-calculation' ||
          (unitPrice !== '0.00' &&
            ['sale-signoff', 'sales-receipt'].includes(entity))
            ? accountingVou
            : fixture.vou
        const draft = await service.submit(
          entity,
          'submit-new',
          {
            documentId: ulid(),
            submissionId: id,
            idempotencyKey: id,
            expectedRevision: null,
            payload,
          },
          fixture.actor,
          'source-fixture',
        )
        return service.review(
          entity,
          'approve',
          {
            documentId: draft.documentId,
            submissionId: draft.submissionId,
            expectedRevision: draft.revision,
          },
          fixture.reviewerActor,
          'source-fixture',
        )
      }
      const order = await create('sale-order', {
        ...fixture.salePayload,
        customerSubunit,
        specialApproval: true,
        productLines: [
          {
            ...fixture.salePayload.productLines[0]!,
            lineId,
            enteredQuantity: '10',
            baseQuantity: '10',
            unitPrice,
          },
        ],
      })
      const base = {
        businessDate: '2026-09-04',
        currency: 'CNY',
        attachments: [],
      }
      const outbound = await create('sale-outbound', {
        ...base,
        parentEntity: 'sale-order',
        parentDocumentId: order.documentId,
        sourceLines: [{ sourceLineId: lineId, baseQuantity: '10' }],
      })
      const delivery = await create('sale-delivery', {
        ...base,
        parentEntity: 'sale-outbound',
        parentDocumentId: outbound.documentId,
        sourceLines: [{ sourceLineId: lineId, baseQuantity: '10' }],
      })
      const signoff = await create('sale-signoff', {
        ...base,
        parentEntity: 'sale-delivery',
        parentDocumentId: delivery.documentId,
        customerSubunit,
        expectedSolventContainers: 0,
        expectedResinContainers: 0,
        returnedSolventContainers: 0,
        returnedResinContainers: 0,
        signoffLines: [
          {
            sourceLineId: lineId,
            signedBaseQuantity: '10',
            rejectedBaseQuantity: '0',
          },
        ],
      })
      if (unitPrice !== '0.00') {
        const unpaid = await fixture.vou.getIntermediarySource(
          '2026-09-30',
          fixture.actor,
        )
        assert.equal(
          unpaid.source.lines.some(
            (row) => row.signoffDocumentId === signoff.documentId,
          ),
          false,
        )
        await create('sales-receipt', {
          ...(fixture.documents['sales-receipt']
            .payload as VouPayloadFor<'sales-receipt'>),
          businessDate: '2026-09-05',
          customer: {
            ...(
              fixture.documents['sales-receipt']
                .payload as VouPayloadFor<'sales-receipt'>
            ).customer,
            approvalEntryId: customerVersionId,
          },
          subunitAllocations: [{ subunit: customerSubunit, amount: '10.00' }],
          amount: '10.00',
        })
      }
      const original = await fixture.vou.getIntermediarySource(
        '2026-09-30',
        fixture.actor,
      )
      const originalLine = original.source.lines.find(
        (row) => row.signoffDocumentId === signoff.documentId,
      )!
      assert.equal(
        originalLine.collectionDate,
        unitPrice === '0.00' ? '2026-09-04' : '2026-09-05',
      )
      assert.equal(originalLine.standardPieceQuantity, '3.333333')
      assert.equal(originalLine.specialApproval, true)
      assert.equal(
        originalLine.product.entity === 'product' &&
          originalLine.product.approvalEntryId,
        versionId,
      )
      await create('sale-return', {
        ...base,
        parentEntity: 'sale-order',
        parentDocumentId: order.documentId,
        warehouse: fixture.salePayload.warehouse,
        returnReason: '未计提退货',
        returnLines: [
          {
            sourceDocumentId: signoff.documentId,
            sourceLineId: lineId,
            baseQuantity: '1',
          },
        ],
      })
      const after = await fixture.vou.getIntermediarySource(
        '2026-09-30',
        fixture.actor,
      )
      const line = after.source.lines.find(
        (row) => row.signoffDocumentId === signoff.documentId,
      )!
      assert.equal(
        line.signedBaseQuantity,
        unitPrice === '0.00' ? '9.000000' : '10.000000',
      )
      assert.equal(
        line.standardPieceQuantity,
        unitPrice === '0.00' ? '3.000000' : '3.333333',
      )
      if (unitPrice === '0.00')
        assert.notEqual(after.sourceHash, original.sourceHash)
      else assert.equal(after.sourceHash, original.sourceHash)
      const current = await bob.get('product', productId, fixture.actor),
        nextId = ulid()
      const next = await bob.submit(
        'product',
        'submit-change',
        {
          subjectId: productId,
          submissionId: nextId,
          idempotencyKey: nextId,
          expectedLatestApprovedSubmissionId: current.submissionId,
          expectedLatestApprovedRevision: current.revision,
          snapshot: { ...current.snapshot, defaultPackagingSpec: '6' },
        },
        fixture.actor,
        'later-product',
      )
      await bob.review(
        'product',
        'approve',
        {
          subjectId: productId,
          submissionId: nextId,
          expectedRevision: next.revision,
        },
        fixture.reviewerActor,
        'later-product',
      )
      assert.deepEqual(
        await fixture.vou.getIntermediarySource('2026-09-30', fixture.actor),
        after,
      )
      assert.equal(line.salesperson.entity, 'employee')
      const employee = await fixture.aux.get(
        'employee',
        { id: line.salesperson.objectId },
        fixture.actor,
      )
      await fixture.aux.save(
        'employee',
        {
          id: employee.id,
          revision: employee.revision,
          identityKind: employee.identityKind,
          legalName: employee.legalName,
          displayName: '计提时已改名',
          legalIdentifier: employee.legalIdentifier,
          contactName: employee.contactName,
          phone: employee.phone,
          address: employee.address,
          employeeCategoryId: employee.employeeCategory.id,
          departmentId: employee.department?.id ?? null,
          positionId: employee.position?.id ?? null,
          operatingEntityId: employee.operatingEntity.id,
          employmentDate: employee.employmentDate,
          workPhone: employee.workPhone,
          workEmail: employee.workEmail,
          remark: employee.remark,
        },
        fixture.actor,
      )
      assert.deepEqual(
        await fixture.vou.getIntermediarySource('2026-09-30', fixture.actor),
        after,
      )
      const previousCalculation = fixture.documents['intermediary-calculation']
      await fixture.vou.delete(
        'intermediary-calculation',
        {
          documentId: previousCalculation.documentId,
          submissionId: previousCalculation.submissionId,
          expectedRevision: previousCalculation.revision,
        },
        fixture.actor,
        'replace-empty-calculation',
      )
      assert.equal(after.source.lines.length, 1)
      const script = await fixture.vou.getIntermediaryScript(fixture.actor)
      assert.ok(script)
      const result = {
        lines: [
          {
            sourceSignoffLineId: line.sourceSignoffLineId,
            premiumUnitPrice: '0.00',
            standardPieceQuantity: line.standardPieceQuantity,
            baseCommission: '3.00',
            premiumCommission: '0.00',
            lowPriceCommission: '0.00',
            marketMaintenanceSubsidy: '0.00',
            marketDevelopmentSubsidy: '0.00',
            billCost: '0.00',
            billLineIds: [],
            employeeAmount: '3.00',
            intermediaryAmount: '0.00',
          },
        ],
        summaries: [
          {
            category: 'COMMISSION' as const,
            payee: line.salesperson,
            amount: '3.00',
          },
        ],
      }
      const expense = await acc.createSubject(
        {
          id: ulid(),
          bookId: fixture.book.id,
          code: '6611',
          name: '销售收益费用',
          parentId: null,
          balanceDirection: 'DEBIT',
          enabled: true,
          requiredDimensions: [],
          inventoryQuantity: false,
          settlementPurpose: 'NONE',
        },
        fixture.actor,
      )
      const payable = await acc.createSubject(
        {
          id: ulid(),
          bookId: fixture.book.id,
          code: '2242',
          name: '业务员应付',
          parentId: null,
          balanceDirection: 'CREDIT',
          enabled: true,
          requiredDimensions: ['EMPLOYEE'],
          inventoryQuantity: false,
          settlementPurpose: 'OTHER',
        },
        fixture.actor,
      )
      await fixture.mappings.save(
        {
          bookId: fixture.book.id,
          vouEntity: 'intermediary-calculation',
          expectedRevision: (
            await fixture.mappings.get(
              fixture.book.id,
              'intermediary-calculation',
              {
                ...fixture.actor,
                permissions: [...fixture.actor.permissions, '/acc/mapping/get'],
              },
            )
          ).revision,
          defaultResult: 'POST',
          definition: {
            defaultTemplateId: 'commissions',
            rules: [],
            assetConfiguration: null,
            templates: [
              {
                templateId: 'commissions',
                collection: 'commissions',
                lines: [
                  ...(['accrualAmount', 'reversalAmount'] as const).flatMap(
                    (amountField) => [
                      {
                        subjectSource: 'FIXED' as const,
                        subjectValue: expense.id,
                        direction:
                          amountField === 'accrualAmount'
                            ? ('DEBIT' as const)
                            : ('CREDIT' as const),
                        amountField: `line.${amountField}`,
                        currencyField: 'line.currency',
                        dimensions: {} as Record<string, string>,
                        quantityField: null,
                        costCounterpartSubjectId: null,
                        costCounterpartDimensions: {},
                      },
                      {
                        subjectSource: 'FIXED' as const,
                        subjectValue: payable.id,
                        direction:
                          amountField === 'accrualAmount'
                            ? ('CREDIT' as const)
                            : ('DEBIT' as const),
                        amountField: `line.${amountField}`,
                        currencyField: 'line.currency',
                        dimensions: { EMPLOYEE: 'line.payeeId' } as Record<
                          string,
                          string
                        >,
                        quantityField: null,
                        costCounterpartSubjectId: null,
                        costCounterpartDimensions: {},
                      },
                    ],
                  ),
                ],
              },
            ],
          },
        },
        {
          ...fixture.actor,
          permissions: [...fixture.actor.permissions, '/acc/mapping/save'],
        },
      )
      const calculation = await create('intermediary-calculation', {
        businessDate: '2026-09-30',
        currency: 'CNY',
        attachments: [],
        intermediaryCalculation: { ...after, script, result },
      })
      const read = await fixture.vou.get(
        'intermediary-calculation',
        calculation.documentId,
        fixture.actor,
      )
      assert.ok('intermediaryCalculation' in read.payload)
      assert.deepEqual(
        JSON.parse(JSON.stringify(read.payload.intermediaryCalculation)),
        {
          ...after,
          script,
          result,
        },
      )

      const posted = async (submissionId: string) =>
        db
          .selectFrom('acc_journal_entries as entry')
          .innerJoin(
            'acc_journal_lines as line',
            'line.journal_entry_id',
            'entry.id',
          )
          .select([
            'line.subject_id',
            'line.direction',
            'line.amount',
            'line.dimensions',
          ])
          .where('entry.vou_approval_entry_id', '=', submissionId)
          .orderBy('line.subject_id')
          .execute()
      assert.deepEqual(
        (await posted(calculation.submissionId))
          .map((row) => ({
            subject: row.subject_id,
            direction: row.direction,
            amount: Number(row.amount),
          }))
          .sort((a, b) => a.subject.localeCompare(b.subject)),
        [
          { subject: expense.id, direction: 'DEBIT', amount: 3 },
          { subject: payable.id, direction: 'CREDIT', amount: 3 },
        ].sort((a, b) => a.subject.localeCompare(b.subject)),
      )
      if (unitPrice !== '0.00') return
      context.mock.timers.enable({
        apis: ['Date'],
        now: new Date('2026-10-09T04:00:00Z'),
      })
      try {
        await create('sale-return', {
          ...base,
          businessDate: '2026-10-09',
          parentEntity: 'sale-order',
          parentDocumentId: order.documentId,
          warehouse: fixture.salePayload.warehouse,
          returnReason: '跨月计提退货',
          returnLines: [
            {
              sourceDocumentId: signoff.documentId,
              sourceLineId: lineId,
              baseQuantity: '1',
            },
          ],
        })
        const october = await fixture.vou.getIntermediarySource(
          '2026-10-31',
          fixture.actor,
        )
        const adjustment = october.source.lines[0]!
        assert.equal(adjustment.sourceKind, 'RETURN_ADJUSTMENT')
        assert.equal(adjustment.adjustmentEmployeeAmount, '0.33')
        const reversed = await create('intermediary-calculation', {
          businessDate: '2026-10-31',
          currency: 'CNY',
          attachments: [],
          intermediaryCalculation: {
            ...october,
            script,
            result: {
              lines: [
                {
                  ...result.lines[0]!,
                  standardPieceQuantity: adjustment.standardPieceQuantity,
                  baseCommission: '0.00',
                  employeeAmount: '-0.33',
                },
              ],
              summaries: [
                {
                  category: 'COMMISSION',
                  payee: adjustment.salesperson,
                  amount: '-0.33',
                },
              ],
            },
          },
        })
        assert.deepEqual(
          (await posted(reversed.submissionId))
            .map((row) => ({
              subject: row.subject_id,
              direction: row.direction,
              amount: Number(row.amount),
            }))
            .sort((a, b) => a.subject.localeCompare(b.subject)),
          [
            { subject: expense.id, direction: 'CREDIT', amount: 0.33 },
            { subject: payable.id, direction: 'DEBIT', amount: 0.33 },
          ].sort((a, b) => a.subject.localeCompare(b.subject)),
        )
        await assert.rejects(
          accountingVou.review(
            'intermediary-calculation',
            'unapprove',
            {
              documentId: calculation.documentId,
              submissionId: calculation.submissionId,
              expectedRevision: calculation.revision,
              reason: '已有退货冲回',
            },
            fixture.reviewerActor,
            'dependent-reversal',
          ),
          /vou_unapprove_blocked/,
        )
      } finally {
        context.mock.timers.reset()
      }
    })
  })

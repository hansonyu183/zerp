import assert from 'node:assert/strict'
import test from 'node:test'
import { ulid } from 'ulid'
import {
  modelBuildId,
  type ServiceContexts,
  type PurchaseInboundScopes,
  type VouPayloadFor,
} from '@zerp/model'
import { sql } from 'kysely'
import { withWflDatabase } from './wfl-fixture.ts'
import { seedOrderListFixture } from '../fixtures/vou-orders.ts'
import { VouService } from '../../src/vou/service.ts'
import { AccService } from '../../src/acc/service.ts'
import { AccMappingCatalogService } from '../../src/acc/mapping-catalog.ts'
import { VouOpeningService } from '../../src/vou/opening-service.ts'
import { createApp } from '../../src/app.ts'
import { SessionService } from '../../src/app/session.ts'
import { loadConfig } from '../../src/platform/config.ts'
import { DclArchiveService } from '../../src/dcl/archives.ts'
import { TargetBootstrapService } from '../../src/app/bootstrap.ts'
import { ManagementService } from '../../src/app/management.ts'
import { invoiceSources, invoiceTaxOptions } from '../../src/vou/invoice.ts'
function command(payload: unknown) {
  const submissionId = ulid()
  return {
    documentId: ulid(),
    submissionId,
    idempotencyKey: submissionId,
    expectedRevision: null,
    payload,
  }
}
test('normal customer service preserves mixed BB/BA history, invoices actual consideration and posts future fulfillment once', async () => {
  await withWflDatabase(async (db) => {
    const f = await seedOrderListFixture(db, 0, [
      'sale-order',
      'service-contract',
      'service-acceptance',
      'sale-invoice',
    ])
    const actor = {
        id: f.submitter.userId,
        permissions: ['/acc/mapping/save'],
        trusted: true,
      },
      reviewer = { ...actor, id: f.reviewer.userId }
    const sale = f.salePayload as VouPayloadFor<'sale-order'>
    const dcl = new DclArchiveService(db),
      currentCustomer = await dcl.get(
        'customer',
        sale.customer.objectId,
        actor,
      ),
      customerEntry = ulid()
    const customer = await dcl.submit(
      'customer',
      'submit-change',
      {
        subjectId: sale.customer.objectId,
        submissionId: customerEntry,
        idempotencyKey: customerEntry,
        expectedLatestApprovedSubmissionId: currentCustomer.submissionId,
        expectedLatestApprovedRevision: currentCustomer.revision,
        snapshot: {
          ...currentCustomer.snapshot,
          creditLimits: [{ currency: 'CNY', amount: '100.00' }],
        },
      },
      actor,
      'customer-service-credit',
    )
    await dcl.review(
      'customer',
      'approve',
      {
        subjectId: sale.customer.objectId,
        submissionId: customerEntry,
        expectedRevision: customer.revision,
      },
      reviewer,
      'customer-service-credit',
    )
    sale.customer = {
      objectId: sale.customer.objectId,
      approvalEntryId: customerEntry,
      selectionOrigin: 'CURRENT',
    }
    const acc = new AccService(db),
      vou = new VouService(db, { acc, wfl: { async apply() {} } })
    const config = loadConfig({
      DATABASE_URL: process.env.TARGET_TEST_DATABASE_URL!,
      APP_SESSION_COOKIE_SECURE: 'false',
    })
    const app = createApp({
      config,
      session: new SessionService(db, config),
      vou,
    })
    async function client(user: typeof f.submitter) {
      const login = await app.request('/session/auth/signin', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-zerp-model-build': modelBuildId,
        },
        body: JSON.stringify({ code: user.username, password: user.password }),
      })
      const auth = await login.json()
      assert.equal(auth.code, 0)
      return async (path: string, body: unknown) =>
        (
          await app.request(path, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-zerp-model-build': modelBuildId,
              'x-csrf-token': auth.data.csrfToken,
              cookie: login.headers.getSetCookie()[0]!,
            },
            body: JSON.stringify(body),
          })
        ).json()
    }
    const post = await client(f.submitter),
      review = await client(f.reviewer)
    async function adopt(entity: string, input: ReturnType<typeof command>) {
      const saved = await post(`/vou/${entity}/submit-new`, input)
      assert.equal(saved.code, 0, saved.errorKey)
      const approved = await review(`/vou/${entity}/approve`, {
        documentId: input.documentId,
        submissionId: input.submissionId,
        expectedRevision: saved.data.revision,
      })
      assert.equal(approved.code, 0, approved.errorKey)
      return approved.data
    }
    const fact = {
      sourceClosed: false,
      sourceInstanceId: 'mixed-customer-fixture',
      sourceSchema: 'fixture',
      sourceDocumentType: 'BB',
      sourceDocumentKey: 'bb-mixed',
      sourceDocumentNo: 'BB-mixed',
      capturedAt: '2026-10-01T00:00:00.123456Z',
      snapshotDigest: 'd'.repeat(64),
    }
    const unit = f.references.unitSnapshot
    const paid = {
      lineId: ulid(),
      sourceLineKey: 'service-paid',
      serviceCode: 'TRANSPORT',
      serviceName: '运输服务',
      enteredQuantity: '11',
      baseQuantity: '11',
      enteredUnit: unit,
      baseUnit: unit,
      unitPrice: '9.123456',
      agreedAmount: '110.00',
    }
    const free = {
      ...paid,
      lineId: ulid(),
      sourceLineKey: 'service-free',
      serviceCode: 'FREE',
      enteredQuantity: '2',
      baseQuantity: '2',
      unitPrice: '0.000000',
      agreedAmount: '0.00',
    }
    const common = {
      businessDate: '2026-09-28',
      currency: 'CNY',
      attachments: [],
      employee: sale.salesperson!,
      operatingEntity: sale.operatingEntity,
      counterpartyType: 'customer',
      counterparty: sale.customer,
    }
    const goods = command({
      ...sale,
      businessDate: common.businessDate,
      priorFact: fact,
      productLines: sale.productLines.map((line) => ({
        ...line,
        agreedAmount: '10.00',
      })),
    })
    await adopt('sale-order', goods)
    const contract = command({
      ...common,
      priorFact: fact,
      serviceLines: [paid, free],
      serviceContract: { terms: '正常客户服务约定' },
    })
    await adopt('service-contract', contract)
    assert.deepEqual(
      (
        await db
          .selectFrom('vou_prior_facts')
          .select('source_component')
          .where('source_document_key', '=', fact.sourceDocumentKey)
          .orderBy('source_component')
          .execute()
      ).map((row) => row.source_component),
      ['SALE_ORDER', 'SERVICE'],
    )
    const priorLine = {
      ...paid,
      lineId: ulid(),
      sourceLineKey: 'ba-paid',
      enteredQuantity: '4',
      baseQuantity: '4',
      agreedAmount: '40.00',
      contractLineId: paid.lineId,
    }
    const prior = command({
      ...common,
      amount: '40.00',
      priorFact: {
        ...fact,
        sourceDocumentType: 'BA',
        sourceDocumentKey: 'ba-service',
        sourceDocumentNo: 'BA-service',
      },
      serviceLines: [priorLine],
      priorLineOrigins: [
        {
          lineId: priorLine.lineId,
          sourceDocumentType: 'BB',
          sourceDocumentKey: fact.sourceDocumentKey,
          sourceLineKey: paid.sourceLineKey,
        },
      ],
      serviceAcceptance: {
        contractDocumentId: contract.documentId,
        serviceDate: common.businessDate,
        acceptanceDate: common.businessDate,
        settlementDirection: 'RECEIVABLE',
      },
    })
    const historical = await adopt('service-acceptance', prior)
    assert.equal(historical.payload.serviceLines[0].agreedAmount, '40.00')
    assert.equal(historical.payload.serviceLines[0].unitPrice, '9.123456')
    for (const table of [
      'acc_journal_entries',
      'acc_inventory_entries',
    ] as const)
      assert.equal(
        (
          await db
            .selectFrom(table)
            .select((eb) => eb.fn.countAll<string>().as('count'))
            .executeTakeFirstOrThrow()
        ).count,
        '0',
      )
    const duplicate = await post(
      '/vou/service-contract/submit-new',
      command(contract.payload),
    )
    assert.equal(duplicate.errorKey, 'vou_prior_fact_source_conflict')
    const initialSources = await invoiceSources(
      db,
      'sale-invoice',
      '2026-10-12',
    )
    assert.equal(initialSources.length, 1)
    assert.equal(initialSources[0]!.amount, '40.00')
    assert.equal(initialSources[0]!.sourceEntity, 'service-acceptance')
    assert.equal(
      initialSources[0]!.operatingEntityId,
      sale.operatingEntity.objectId,
    )
    await acc.syncVouEntityCatalog()
    const book = await acc.createBook(
      {
        id: ulid(),
        name: '客户服务隔离控制账',
        description: '',
        startMonth: '2026-10',
        baseCurrency: 'CNY',
        subjectTemplate: 'EMPTY',
        queryUserIds: [actor.id, reviewer.id],
        operateUserIds: [actor.id, reviewer.id],
      },
      actor,
    )
    const receivable = await acc.createSubject(
      {
        id: ulid(),
        bookId: book.id,
        code: '1122',
        name: '服务应收',
        parentId: null,
        balanceDirection: 'DEBIT',
        enabled: true,
        requiredDimensions: ['CUSTOMER'],
        inventoryQuantity: false,
        settlementPurpose: 'RECEIVABLE',
      },
      actor,
    )
    const revenue = await acc.createSubject(
      {
        id: ulid(),
        bookId: book.id,
        code: '6001',
        name: '服务收入',
        parentId: null,
        balanceDirection: 'CREDIT',
        enabled: true,
        requiredDimensions: [],
        inventoryQuantity: false,
        settlementPurpose: 'NONE',
      },
      actor,
    )
    const openings = new VouOpeningService(db, acc),
      openingId = ulid()
    const opening = await openings.submitOpening(
      {
        bookId: book.id,
        submissionId: openingId,
        idempotencyKey: openingId,
        lines: [
          {
            subjectId: receivable.id,
            currency: 'CNY',
            direction: 'DEBIT',
            amount: '40.00',
            dimensions: { CUSTOMER: sale.customer.objectId },
          },
          {
            subjectId: revenue.id,
            currency: 'CNY',
            direction: 'CREDIT',
            amount: '40.00',
            dimensions: {},
          },
        ],
        assets: [],
        bills: [],
        containers: [],
      },
      actor,
      'customer-service-opening',
    )
    await openings.reviewOpening(
      'approve',
      {
        bookId: book.id,
        submissionId: openingId,
        expectedRevision: opening.approval.revision,
      },
      reviewer,
      'customer-service-opening',
    )
    const mappings = new AccMappingCatalogService(db)
    await mappings.save(
      {
        bookId: book.id,
        vouEntity: 'service-acceptance',
        expectedRevision: null,
        defaultResult: 'POST',
        definition: {
          defaultTemplateId: 'customer-service',
          rules: [],
          assetConfiguration: null,
          templates: [
            {
              templateId: 'customer-service',
              collection: null,
              lines: [
                {
                  subjectSource: 'FIXED',
                  subjectValue: receivable.id,
                  direction: 'DEBIT',
                  amountField: 'amount',
                  currencyField: 'currency',
                  dimensions: { CUSTOMER: 'counterparty.objectId' },
                  quantityField: null,
                  costCounterpartSubjectId: null,
                  costCounterpartDimensions: {},
                },
                {
                  subjectSource: 'FIXED',
                  subjectValue: revenue.id,
                  direction: 'CREDIT',
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
        },
      },
      actor,
    )
    function fulfillment(line: typeof paid, quantity: string, amount: string) {
      const { sourceLineKey: _source, ...current } = line
      return command({
        businessDate: '2026-10-12',
        currency: 'CNY',
        attachments: [],
        employee: sale.salesperson!,
        amount,
        counterpartyType: 'customer',
        serviceLines: [
          {
            ...current,
            lineId: ulid(),
            contractLineId: line.lineId,
            enteredQuantity: quantity,
            baseQuantity: quantity,
            agreedAmount: amount,
          },
        ],
        serviceAcceptance: {
          contractDocumentId: contract.documentId,
          serviceDate: '2026-10-12',
          acceptanceDate: '2026-10-12',
          settlementDirection: 'RECEIVABLE',
        },
      })
    }
    const zero = fulfillment(free, '2', '0.00')
    await adopt('service-acceptance', zero)
    assert.equal(
      (
        await db
          .selectFrom('acc_journal_entries')
          .select('id')
          .where('vou_approval_entry_id', '=', zero.submissionId)
          .execute()
      ).length,
      0,
    )
    const future = fulfillment(paid, '6', '60.00')
    const final = await adopt('service-acceptance', future)
    const replay = await post('/vou/service-acceptance/submit-new', future)
    assert.equal(replay.code, 0)
    assert.equal(replay.data.documentId, future.documentId)
    assert.equal(
      (
        await db
          .selectFrom('acc_journal_entries')
          .select('id')
          .where('vou_approval_entry_id', '=', future.submissionId)
          .execute()
      ).length,
      1,
    )
    const balances = await sql<{
      balance: string
    }>`SELECT SUM(CASE WHEN direction='DEBIT' THEN amount ELSE -amount END)::text AS balance FROM acc_journal_lines WHERE subject_id=${receivable.id}`.execute(
      db,
    )
    assert.equal(balances.rows[0]!.balance, '100.00000000')
    assert.equal(
      (await db.selectFrom('acc_inventory_entries').select('id').execute())
        .length,
      0,
    )
    const overCredit = fulfillment(paid, '1', '10.00')
    const savedOverCredit = await post(
      '/vou/service-acceptance/submit-new',
      overCredit,
    )
    assert.equal(savedOverCredit.code, 0)
    assert.equal(
      (
        await review('/vou/service-acceptance/approve', {
          documentId: overCredit.documentId,
          submissionId: overCredit.submissionId,
          expectedRevision: savedOverCredit.data.revision,
        })
      ).errorKey,
      'vou_credit_limit_exceeded',
    )
    assert.equal(
      (
        await db
          .selectFrom('acc_journal_entries')
          .select('id')
          .where('vou_approval_entry_id', '=', overCredit.submissionId)
          .execute()
      ).length,
      0,
    )
    const extra = await post(
      '/vou/service-acceptance/submit-new',
      fulfillment(paid, '2', '20.00'),
    )
    assert.equal(extra.errorKey, 'vou_service_contract_capacity_exceeded')
    const wrong = fulfillment(paid, '1', '10.00')
    ;(
      wrong.payload as { serviceAcceptance: { settlementDirection: string } }
    ).serviceAcceptance.settlementDirection = 'PAYABLE'
    assert.equal(
      (await post('/vou/service-acceptance/submit-new', wrong)).errorKey,
      'vou_invalid_payload',
    )
    const sources = await invoiceSources(db, 'sale-invoice', '2026-10-12')
    assert.deepEqual(sources.map((row) => row.amount).sort(), [
      '0.00',
      '40.00',
      '60.00',
    ])
    assert.equal(final.payload.counterparty.objectId, sale.customer.objectId)
    assert.equal(
      final.payload.operatingEntity.objectId,
      sale.operatingEntity.objectId,
    )
    const tax = await invoiceTaxOptions(
      db,
      'sale-invoice',
      sale.customer.objectId,
    )
    const invoice = command({
      businessDate: '2026-10-12',
      currency: 'CNY',
      attachments: [],
      customer: sale.customer,
      operatingEntity: sale.operatingEntity,
      taxInformation: tax.items[0]!,
      invoiceLines: [
        {
          sourceDocumentId: prior.documentId,
          sourceApprovalEntryId: prior.submissionId,
          sourceLineId: priorLine.lineId,
          amount: '20.00',
        },
      ],
    })
    await adopt('sale-invoice', invoice)
    const residual = (
      await invoiceSources(db, 'sale-invoice', '2026-10-12')
    ).find((row) => row.sourceDocumentId === prior.documentId)!
    assert.equal(residual.availableAmount, '20.00')
    const overInvoice = command({
      ...(invoice.payload as object),
      invoiceLines: [
        {
          sourceDocumentId: prior.documentId,
          sourceApprovalEntryId: prior.submissionId,
          sourceLineId: priorLine.lineId,
          amount: '20.01',
        },
      ],
    })
    assert.equal(
      (await post('/vou/sale-invoice/submit-new', overInvoice)).errorKey,
      'vou_invoice_source_unavailable',
    )
    assert.equal(
      (
        await db
          .selectFrom('acc_journal_entries')
          .select('id')
          .where('vou_approval_entry_id', '=', invoice.submissionId)
          .execute()
      ).length,
      0,
    )
    const admin = {
      ...f.submitter,
      userId: ulid(),
      roleId: ulid(),
      username: 'service-admin-' + ulid(),
    }
    await new TargetBootstrapService(db).createE2EPrincipal(admin, true)
    const { principal } = await new SessionService(db, config).signin(
      admin.username,
      admin.password,
    )
    const management = new ManagementService(db, { passwordMinLength: 12 })
    const role = await management.getRole(f.submitter.roleId, principal)
    const oldContexts = role.serviceContexts as ServiceContexts
    const narrowed = Object.fromEntries(
      Object.entries(oldContexts).map(([id, contexts]) => [
        id,
        contexts.filter(
          (value) =>
            !['CUSTOMER', 'CUSTOMER_CONTRACT', 'PRIOR_BB', 'PRIOR_BA'].includes(
              value,
            ),
        ),
      ]),
    )
    await management.saveRole(
      {
        id: role.id,
        name: role.name + ulid(),
        customerScope: role.customerScope,
        permissionIds: role.permissions.map((item) => item.id),
        purchaseInboundScopes:
          role.purchaseInboundScopes as PurchaseInboundScopes,
        serviceContexts: narrowed,
        revision: role.revision,
      },
      principal,
      'customer-service-scope',
    )
    const restricted = await client(f.submitter)
    const hiddenCustomer = fulfillment(paid, '1', '10.00')
    delete (hiddenCustomer.payload as { counterpartyType?: string })
      .counterpartyType
    assert.equal(
      (await restricted('/vou/service-acceptance/submit-new', hiddenCustomer))
        .errorKey,
      'forbidden',
    )
    assert.equal(
      (
        await db
          .selectFrom('vou_documents')
          .select('id')
          .where('id', '=', hiddenCustomer.documentId)
          .execute()
      ).length,
      0,
    )
    const nextRole = await management.getRole(f.submitter.roleId, principal)
    await management.saveRole(
      {
        id: role.id,
        name: role.name + ulid(),
        customerScope: 'NONE',
        permissionIds: role.permissions.map((item) => item.id),
        purchaseInboundScopes:
          role.purchaseInboundScopes as PurchaseInboundScopes,
        serviceContexts: oldContexts,
        revision: nextRole.revision,
      },
      principal,
      'customer-service-customer-scope',
    )
    const noCustomer = await client(f.submitter)
    assert.equal(
      (
        await noCustomer(
          '/vou/service-acceptance/submit-new',
          fulfillment(paid, '1', '10.00'),
        )
      ).errorKey,
      'forbidden',
    )
    const frozen = await review(
      '/vou/service-acceptance/submit-new',
      command(prior.payload),
    )
    assert.equal(frozen.errorKey, 'vou_prior_fact_frozen')
  })
})

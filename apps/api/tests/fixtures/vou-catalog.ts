import assert from 'node:assert/strict'
import type { Kysely } from 'kysely'
import { ulid } from 'ulid'
import {
  vouEntities,
  type VouEntity,
  type VouPayload,
  type VouPayloadShapes,
} from '@zerp/model'
import type { DB } from '../../src/db/generated.ts'
import type { VouView } from '../../src/vou/service.ts'
import { AccService } from '../../src/acc/service.ts'
import { AccMappingCatalogService } from '../../src/acc/mapping-catalog.ts'
import { VouOpeningService } from '../../src/vou/opening-service.ts'
import { VouService } from '../../src/vou/service.ts'
import { AuxService } from '../../src/aux/service.ts'
import { BobArchiveService } from '../../src/bob/archives.ts'
import { vouPayloadSchemaByEntity } from '../../src/vou/contract.ts'
import { seedProductionFixture } from './vou-production.ts'

/** Existing public domain commands inside the caller's rollback transaction. */
export async function seedVouCatalogFixture(db: Kysely<DB>) {
  const fixture = await seedProductionFixture(db, 1, vouEntities)
  const { vou, references } = fixture
  const actor = {
    id: fixture.submitter.userId,
    permissions: [
      '/aux/fund-account/create',
      '/aux/asset-category/create',
      '/aux/department/create',
      '/aux/asset-category/get',
      '/aux/employee/get',
      '/aux/employee/save',
    ],
    trusted: true,
  }
  const reviewer = { ...actor, id: fixture.reviewer.userId }
  const aux = new AuxService(db),
    bob = new BobArchiveService(db)
  const {
    warehouse,
    operatingEntity,
    salesperson: employee,
    customerSubunit,
  } = fixture.salePayload
  assert.ok(employee)
  const supplier = (
    fixture.purchase.payload as VouPayloadShapes['purchase-order']
  ).supplier
  const customer = {
    ...customerSubunit,
    objectId: references.archiveSubjectIds[0]!,
  }
  const product = {
    objectId: references.archiveSubjectIds[1]!,
    approvalEntryId: references.archiveApprovalEntryIds[1]!,
    selectionOrigin: 'CURRENT' as const,
  }
  const fund = await aux.create(
    'fund-account',
    {
      name: '目录采用时账户',
      currency: 'CNY',
      accountName: '目录户名',
      bank: '目录银行',
      branch: '目录支行',
      accountNumber: ulid(),
      operatingEntityId: operatingEntity.objectId,
      remark: '',
    },
    actor,
  )
  const categoryCreated = await aux.create(
    'asset-category',
    {
      name: '目录资产类别',
      defaultUsefulLifeMonths: 24,
      defaultResidualRate: '0.00',
    },
    actor,
  )
  const category = await aux.get(
    'asset-category',
    { id: categoryCreated.id },
    actor,
  )
  const department = await aux.create('department', { name: '目录部门' }, actor)
  const subjectId = ulid(),
    submissionId = ulid()
  const otherInput = {
    subjectId,
    submissionId,
    idempotencyKey: submissionId,
    expectedLatestApprovedSubmissionId: null,
    expectedLatestApprovedRevision: null,
    snapshot: {
      identityKind: 'ORGANIZATION',
      legalName: '目录历史往来',
      displayName: '目录历史往来',
      legalIdentifier: ulid(),
      contactName: '',
      phone: '',
      address: '',
      operatingEntities: [],
      defaultOperatingEntityId: null,
      remark: '',
      settlementMethod: null,
    },
  }
  const other = await bob.submit(
    'other-unit',
    'submit-new',
    otherInput,
    actor,
    'catalog-fixture',
  )
  await bob.review(
    'other-unit',
    'approve',
    { subjectId, submissionId, expectedRevision: other.revision },
    reviewer,
    'catalog-fixture',
  )
  const counterparty = {
    objectId: subjectId,
    approvalEntryId: submissionId,
    selectionOrigin: 'CURRENT' as const,
  }
  const base = {
    businessDate: '2026-09-04',
    currency: 'CNY',
    attachments: [],
    remark: '目录只读完整备注',
  } as const
  const amount = {
    fundAccount: { objectId: fund.id },
    handler: employee,
    amount: '12.30',
  }
  const priceLines = [{ product, unitPrice: '7.00' }]
  const quantity = {
    enteredQuantity: '1.000000',
    enteredUnit: { objectId: references.unitSnapshot.objectId },
    baseQuantity: '1.000000',
  }
  const expenseLines = [
    { category: '差旅', description: '目录费用', amount: '12.30' },
  ]
  const sourceLines = [
    {
      sourceLineId: fixture.salePayload.productLines[0]!.lineId,
      baseQuantity: '1.000000',
    },
  ]
  const purchaseSourceLines = [
    {
      sourceLineId: (
        fixture.purchase.payload as VouPayloadShapes['purchase-order']
      ).productLines[0]!.lineId,
      baseQuantity: '1.000000',
    },
  ]
  const productionLines = fixture.productionPayload.productionLines
  const productionOrderId = ulid(),
    productionEntryId = ulid(),
    productionSourceLineId = ulid()
  const productionOrder = await vou.submit(
    'sale-order',
    'submit-new',
    {
      documentId: productionOrderId,
      submissionId: productionEntryId,
      idempotencyKey: productionEntryId,
      expectedRevision: null,
      payload: {
        ...fixture.salePayload,
        productLines: [
          {
            ...fixture.salePayload.productLines[0]!,
            lineId: productionSourceLineId,
            product: { objectId: fixture.productId },
            enteredQuantity: '10',
            baseQuantity: '10',
            formula: fixture.formula,
          },
        ],
      },
    },
    actor,
    'catalog-production-source',
  )
  await vou.review(
    'sale-order',
    'approve',
    {
      documentId: productionOrderId,
      submissionId: productionEntryId,
      expectedRevision: productionOrder.revision,
    },
    reviewer,
    'catalog-production-source',
  )
  const bill = {
    positionType: 'ASSET',
    direction: 'IN',
    purpose: 'PRIMARY',
    billType: 'BANK_ACCEPTANCE',
    billNo: ulid(),
    medium: 'ELECTRONIC',
    currency: 'CNY',
    faceAmount: '12.30',
    issueDate: '2026-09-04',
    maturityDate: '2026-12-04',
    drawer: '出票企业',
    acceptor: '承兑企业',
    payee: '收款企业',
    annualRateBps: 0,
  } as const
  const billCashLines = [
    {
      fundAccount: { objectId: fund.id },
      direction: 'IN' as const,
      amountType: 'PRINCIPAL' as const,
      amount: '12.30',
    },
  ]
  const payloads = {
    'sale-pricing': { ...base, priceLines },
    'sale-outbound': {
      ...base,
      parentEntity: 'sale-order',
      parentDocumentId: fixture.sales[0]!.documentId,
      sourceLines,
    },
    'sale-delivery': {
      ...base,
      parentEntity: 'sale-order',
      parentDocumentId: fixture.sales[0]!.documentId,
      sourceLines,
    },
    'sale-signoff': {
      ...base,
      parentEntity: 'sale-order',
      parentDocumentId: fixture.sales[0]!.documentId,
      customerSubunit,
      expectedSolventContainers: 0,
      expectedResinContainers: 0,
      returnedSolventContainers: 0,
      returnedResinContainers: 0,
      signoffLines: [
        {
          sourceLineId: sourceLines[0]!.sourceLineId,
          signedBaseQuantity: '1.000000',
          rejectedBaseQuantity: '0.000000',
        },
      ],
    },
    'purchase-inquiry': { ...base, supplier, priceLines },
    'purchase-inbound': {
      ...base,
      parentEntity: 'purchase-order',
      parentDocumentId: fixture.purchase.documentId,
      supplier,
      warehouse,
      sourceLines: purchaseSourceLines,
    },
    'order-production': {
      ...base,
      currency: '',
      parentEntity: 'sale-order',
      parentDocumentId: productionOrderId,
      materialWarehouse: warehouse,
      finishedWarehouse: warehouse,
      productionLines: productionLines.map((line) => ({
        ...line,
        sourceOrderLineId: productionSourceLineId,
      })),
    },
    'self-production': {
      ...base,
      currency: '',
      materialWarehouse: warehouse,
      finishedWarehouse: warehouse,
      productionLines,
    },
    'inventory-count': {
      ...base,
      warehouse,
      inventoryCountLines: [
        { ...quantity, product: { objectId: product.objectId } },
      ],
    },
    'sales-receipt': {
      ...base,
      ...amount,
      customer,
      operatingEntity,
      subunitAllocations: [{ subunit: customerSubunit, amount: '12.30' }],
    },
    'sales-refund': { ...base, ...amount, customer: customerSubunit },
    'purchase-refund': { ...base, ...amount, supplier },
    'purchase-payment': { ...base, ...amount, supplier },
    'other-receipt': {
      ...base,
      ...amount,
      counterparty,
      counterpartyType: 'other-unit',
    },
    'other-payment': {
      ...base,
      ...amount,
      counterparty,
      counterpartyType: 'other-unit',
    },
    'employee-loan': { ...base, ...amount, employee },
    'employee-repayment': { ...base, ...amount, employee },
    'employee-loan-writeoff': { ...base, employee, expenseLines },
    'expense-reimbursement': { ...base, employee, expenseLines },
    'expense-payment': { ...base, ...amount, employee },
    'other-income': { ...base, ...amount, sourceName: '目录其他收入' },
    'asset-acquisition': {
      ...base,
      supplier,
      assetAcquisitionLines: [
        {
          assetName: '目录资产',
          category: {
            objectId: category.id,
            code: category.code,
            name: category.name,
            defaultUsefulLifeMonths: 24,
            defaultResidualRate: '0.00',
          },
          originalValue: '12.30',
          usefulLifeMonths: 24,
          residualRate: '0.000000',
          department: { objectId: department.id },
        },
      ],
    },
    'asset-sale': {
      ...base,
      counterparty,
      counterpartyType: 'other-unit',
      assetSaleLines: [{ assetId: ulid(), saleAmount: '12.30' }],
    },
    'asset-liquidation': {
      ...base,
      assetLiquidationLines: [
        {
          assetId: ulid(),
          reason: '报废',
          salvageIncome: '0.00',
          disposalExpense: '0.00',
        },
      ],
    },
    'bill-receipt': {
      ...base,
      customerSubunit,
      handler: employee,
      billLines: [bill],
    },
    'bill-payment': {
      ...base,
      supplier,
      handler: employee,
      billLines: [{ billId: ulid(), purpose: 'PRIMARY' }],
    },
    'bill-issue': {
      ...base,
      supplier: { objectId: supplier.objectId },
      interestMode: 'BANK_DEDUCTED',
      billLines: [{ ...bill, billNo: ulid(), positionType: 'LIABILITY' }],
    },
    'bill-discount': {
      ...base,
      counterparty,
      counterpartyType: 'other-unit',
      interestMode: 'BANK_DEDUCTED',
      withRecourse: false,
      billCashLines,
      billLines: [{ billId: ulid(), purpose: 'PRIMARY' }],
    },
    'bill-maturity': {
      ...base,
      maturityType: 'RECEIPT',
      billLines: [{ billId: ulid(), purpose: 'PRIMARY' }],
      billCashLines,
    },
    'intermediary-calculation': {
      ...base,
      intermediaryCalculation: {
        source: {
          periodStart: base.businessDate,
          periodEnd: base.businessDate,
          currency: 'CNY',
          lines: [],
          bills: [],
        },
        sourceHash: '0'.repeat(64),
        script: {
          scriptId: ulid(),
          revision: 1,
          name: '目录计算',
          source: '',
          hash: '0'.repeat(64),
        },
        result: { lines: [], summaries: [] },
      },
    },
    'service-contract': {
      ...base,
      counterparty,
      counterpartyType: 'other-unit',
      employee,
      serviceContract: {
        capabilities: ['CHANNEL_PARTNER'],
        applicableFrom: base.businessDate,
        terms: '目录服务条款',
      },
    },
    'service-acceptance': {
      ...base,
      amount: '12.30',
      employee,
      serviceAcceptance: {
        contractDocumentId: ulid(),
        serviceDate: base.businessDate,
        acceptanceDate: base.businessDate,
        settlementDirection: 'PAYABLE',
        fulfillmentFact: '已履约',
        acceptanceFact: '验收通过',
      },
    },
  } satisfies Partial<VouPayloadShapes>
  const documents: Partial<Record<VouEntity, VouView>> = {
    'sale-order': fixture.sales[0]!,
    'purchase-order': fixture.purchase,
  }
  async function submit(entity: VouEntity, payload: VouPayload) {
    const parsed = vouPayloadSchemaByEntity[entity].safeParse(payload)
    assert.ok(
      parsed.success,
      `invalid fixture ${entity}: ${parsed.success ? '' : parsed.error.message}`,
    )
    const submissionId = ulid()
    const document = await vou.submit(
      entity,
      'submit-new',
      {
        documentId: ulid(),
        submissionId,
        idempotencyKey: submissionId,
        expectedRevision: null,
        payload,
      },
      actor,
      'catalog-fixture',
    )
    documents[entity] = document
    return document
  }
  const acc = new AccService(db),
    mappings = new AccMappingCatalogService(db)
  await acc.syncVouEntityCatalog()
  const book = await acc.createBook(
    {
      id: ulid(),
      name: '目录控制账簿',
      description: '',
      startMonth: '2026-09',
      baseCurrency: 'CNY',
      subjectTemplate: 'EMPTY',
      queryUserIds: [actor.id, reviewer.id],
      operateUserIds: [actor.id, reviewer.id],
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
      lines: [],
      assets: [],
      bills: [],
      containers: [],
    },
    actor,
    'catalog-opening',
  )
  await openings.reviewOpening(
    'approve',
    {
      bookId: book.id,
      submissionId: openingId,
      expectedRevision: opening.approval.revision,
    },
    reviewer,
    'catalog-opening',
  )
  for (const entity of vouEntities)
    await mappings.save(
      {
        bookId: book.id,
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
      { ...actor, permissions: [...actor.permissions, '/acc/mapping/save'] },
    )
  const registers = new VouService(db, {
    acc: new AccService(db),
    wfl: { async apply() {} },
  })
  const assetSourceId = ulid()
  const assetSource = await registers.submit(
    'asset-acquisition',
    'submit-new',
    {
      documentId: ulid(),
      submissionId: assetSourceId,
      idempotencyKey: assetSourceId,
      expectedRevision: null,
      payload: payloads['asset-acquisition'],
    },
    actor,
    'catalog-source',
  )
  await registers.review(
    'asset-acquisition',
    'approve',
    {
      documentId: assetSource.documentId,
      submissionId: assetSource.submissionId,
      expectedRevision: assetSource.revision,
    },
    reviewer,
    'catalog-source',
  )
  const asset = await db
    .selectFrom('acc_asset_registers')
    .select('id')
    .where('acquisition_vou_approval_entry_id', '=', assetSourceId)
    .executeTakeFirstOrThrow()
  payloads['asset-sale'].assetSaleLines[0]!.assetId = asset.id
  payloads['asset-liquidation'].assetLiquidationLines[0]!.assetId = asset.id
  for (const matured of [false, true]) {
    const id = ulid()
    const source = await registers.submit(
      'bill-receipt',
      'submit-new',
      {
        documentId: ulid(),
        submissionId: id,
        idempotencyKey: id,
        expectedRevision: null,
        payload: {
          ...payloads['bill-receipt'],
          billLines: [
            {
              ...bill,
              billNo: ulid(),
              maturityDate: matured ? base.businessDate : bill.maturityDate,
            },
          ],
        },
      },
      actor,
      'catalog-bill-source',
    )
    await registers.review(
      'bill-receipt',
      'approve',
      {
        documentId: source.documentId,
        submissionId: source.submissionId,
        expectedRevision: source.revision,
      },
      reviewer,
      'catalog-bill-source',
    )
    const register = await db
      .selectFrom('acc_bill_registers')
      .select('id')
      .where('created_vou_approval_entry_id', '=', id)
      .executeTakeFirstOrThrow()
    if (matured) payloads['bill-maturity'].billLines[0]!.billId = register.id
    else {
      payloads['bill-payment'].billLines[0]!.billId = register.id
      payloads['bill-discount'].billLines[0]!.billId = register.id
    }
  }
  for (const [entity, payload] of Object.entries(payloads)) {
    if (entity === 'service-acceptance') {
      const contract = documents['service-contract']!
      documents['service-contract'] = await vou.review(
        'service-contract',
        'approve',
        {
          documentId: contract.documentId,
          submissionId: contract.submissionId,
          expectedRevision: contract.revision,
        },
        reviewer,
        'catalog-contract',
      )
      payloads['service-acceptance'].serviceAcceptance.contractDocumentId =
        contract.documentId
    }
    await submit(entity as VouEntity, payload)
  }
  for (const entity of [
    'sale-order',
    'purchase-order',
    'sale-outbound',
    'sale-delivery',
    'sale-signoff',
    'purchase-inbound',
  ] as const) {
    const document = documents[entity]!
    documents[entity] = await vou.review(
      entity,
      'approve',
      {
        documentId: document.documentId,
        submissionId: document.submissionId,
        expectedRevision: document.revision,
      },
      reviewer,
      'catalog-fixture',
    )
  }
  await submit('sale-return', {
    ...base,
    warehouse,
    returnReason: '目录退货',
    parentEntity: 'sale-order',
    parentDocumentId: fixture.sales[0]!.documentId,
    returnLines: [
      {
        sourceDocumentId: documents['sale-signoff']!.documentId,
        sourceLineId: sourceLines[0]!.sourceLineId,
        baseQuantity: '1.000000',
      },
    ],
  })
  await submit('purchase-return', {
    ...base,
    supplier,
    warehouse,
    returnReason: '目录退货',
    parentEntity: 'purchase-order',
    parentDocumentId: fixture.purchase.documentId,
    returnLines: [
      {
        sourceDocumentId: documents['purchase-inbound']!.documentId,
        sourceLineId: purchaseSourceLines[0]!.sourceLineId,
        baseQuantity: '1.000000',
      },
    ],
  })
  assert.equal(Object.keys(documents).length, vouEntities.length)
  return {
    ...fixture,
    documents: documents as Record<VouEntity, VouView>,
    productionOrder,
    book,
    mappings,
    actor,
    reviewerActor: reviewer,
    aux,
    bob,
    otherInput,
  }
}

import assert from 'node:assert/strict'
import test from 'node:test'

import {
  prepareVouApproval,
  prepareVouSubmission,
  createVouDraftPayload,
  systemGeneratedVouEntities,
  userCreatableVouEntities,
  vouEntityFieldDescriptors,
  vouEntityInputDescriptors,
  vouEntities,
  vouLineFieldDescriptors,
  vouPayloadReferences,
  vouSourceLineSourceEntities,
  vouSourceLineTargetEntities,
  type ApprovalActor,
  type ApprovalEntry,
  type VouInputFieldDescriptor,
  type VouSourceLineCandidate,
  type VouSubmissionCommand,
} from '../src/index.ts'
import { vouSubmitRequestSchema } from '../../../apps/api/src/vou/contract.ts'
import { vouPayloadSchemaByEntity } from '../../../apps/api/src/vou/contract.ts'

const submitter: ApprovalActor = {
  id: '01J00000000000000000000001',
  permissions: userCreatableVouEntities.flatMap((entity) => [
    `/vou/${entity}/submit-new`,
    `/vou/${entity}/submit-change`,
  ]),
}

const reviewer: ApprovalActor = {
  id: '01J00000000000000000000002',
  permissions: vouEntities.flatMap((entity) => [
    `/vou/${entity}/approve`,
    `/vou/${entity}/unapprove`,
    `/vou/${entity}/reject`,
    `/vou/${entity}/unreject`,
  ]),
}

const id = '01J00000000000000000000001'
const reference = {
  objectId: id,
  approvalEntryId: '01J00000000000000000000002',
  selectionOrigin: 'CURRENT' as const,
}
const base = {
  documentId: '01J00000000000000000000003',
  submissionId: '01J00000000000000000000004',
  idempotencyKey: '01J00000000000000000000004',
  expectedRevision: null,
  payload: {
    businessDate: '2026-09-04',
    currency: 'CNY',
    customerSubunit: reference,
    operatingEntity: reference,
    salesperson: reference,
    warehouse: reference,
    productLines: [
      {
        lineId: '01J00000000000000000000005',
        product: { objectId: id },
        enteredQuantity: '1.000000',
        enteredUnit: { objectId: id },
        baseQuantity: '1.000000',
        unitPrice: '10.00',
      },
    ],
    attachments: [],
  },
}

test('VOU wire owns 36 entity-discriminated payloads and explicit system writers', () => {
  assert.equal(vouEntities.length, 36)
  assert.equal(userCreatableVouEntities.length, 32)
  assert.deepEqual(systemGeneratedVouEntities, [
    'sale-outbound',
    'sale-delivery',
    'sale-signoff',
    'expense-payment',
  ])
  assert.deepEqual(vouSourceLineTargetEntities, [
    'sale-return',
    'purchase-inbound',
    'purchase-return',
    'order-production',
  ])
  assert.deepEqual(vouSourceLineSourceEntities, [
    'sale-signoff',
    'purchase-order',
    'purchase-inbound',
    'sale-order',
  ])
  const sourceCandidate: VouSourceLineCandidate = {
    sourceDocumentId: id,
    sourceDocumentNo: 'XSQS2026090001',
    sourceEntity: 'sale-signoff',
    rootDocumentId: '01J00000000000000000000003',
    rootEntity: 'sale-order',
    businessDate: '2026-09-05',
    sourceLineId: '01J00000000000000000000004',
    product: { objectId: '01J00000000000000000000005', code: 'P-01', name: '树脂' },
    availableBaseQuantity: '1.000000',
  }
  assert.equal(sourceCandidate.rootEntity, 'sale-order')
  assert.deepEqual(vouEntityFieldDescriptors['sale-order'].collections, [
    { key: 'productLines', lineKind: 'product' },
  ])
  assert.deepEqual(vouEntityFieldDescriptors['sale-signoff'].headerReferences, [
    {
      key: 'customerSubunit',
      reference: 'versioned',
      required: true,
      referenceEntity: 'customer-subunit',
      allowedEntities: ['customer-subunit'],
    },
  ])
  assert.deepEqual(vouLineFieldDescriptors.product.slice(0, 5), [
    {
      key: 'product',
      required: true,
      reference: 'object',
      referenceEntity: 'product',
      allowedEntities: ['product'],
    },
    { key: 'enteredQuantity', required: true },
    {
      key: 'enteredUnit',
      required: true,
      reference: 'object',
      referenceEntity: 'measurement-unit',
      allowedEntities: ['measurement-unit'],
    },
    { key: 'baseQuantity', required: true },
    { key: 'unitPrice', required: true },
  ])
  assert.deepEqual(
    vouEntityFieldDescriptors['purchase-inbound'].headerReferences.map(
      (reference) => reference.key,
    ),
    ['supplier', 'warehouse'],
  )
  const referenceLeaves: {
    path: string
    allowedEntities?: readonly string[]
  }[] = []
  const visit = (
    fields: readonly VouInputFieldDescriptor[],
    prefix: string,
  ): void => {
    for (const field of fields) {
      const path = prefix ? `${prefix}.${field.key}` : field.key
      const childKeys = new Set(field.fields?.map((child) => child.key))
      if (
        field.kind === 'object' &&
        childKeys.has('objectId') &&
        (childKeys.size === 1 || childKeys.has('approvalEntryId'))
      )
        referenceLeaves.push({ path, allowedEntities: field.allowedEntities })
      if (field.fields) visit(field.fields, path)
      if (field.item) visit(field.item, `${path}[]`)
    }
  }
  for (const [entity, fields] of Object.entries(vouEntityInputDescriptors))
    visit(fields, entity)
  assert.ok(referenceLeaves.length > 0)
  assert.ok(referenceLeaves.every((leaf) => leaf.allowedEntities?.length))
  assert.deepEqual(
    vouEntityInputDescriptors['sale-order']
      .find((field) => field.key === 'productLines')
      ?.item?.find((field) => field.key === 'product'),
    {
      key: 'product',
      kind: 'object',
      required: true,
      fields: [{ key: 'objectId', kind: 'text', required: true }],
      referenceEntity: 'product',
      allowedEntities: ['product'],
    },
  )
  assert.equal(
    vouEntityInputDescriptors['service-acceptance'].find(
      (field) => field.key === 'serviceAcceptance',
    )?.kind,
    'object',
  )
  const draft = createVouDraftPayload(
    'sale-order',
    () => '01J00000000000000000000005',
  )
  assert.deepEqual(draft.productLines[0], {
    lineId: '01J00000000000000000000005',
    product: { objectId: '' },
    enteredQuantity: '0.00',
    enteredUnit: { objectId: '' },
    baseQuantity: '0.00',
    unitPrice: '0.00',
  })

  const command: VouSubmissionCommand = {
    ...base,
    action: 'submit-new',
    entity: 'sale-order',
  }
  const decision = prepareVouSubmission(command, {
    actor: submitter,
    documentExists: false,
    currentSubmissionId: null,
    currentRevision: null,
    referencesValid: true,
    periodOpen: true,
    trustedSystemActor: false,
  })
  assert.equal(decision.ok, true)
})

test('recursive VOU reference facts preserve nested paths and strict reference shapes', () => {
  const historicalReference = {
    objectId: '01J00000000000000000000011',
    approvalEntryId: '01J00000000000000000000012',
    entity: 'product' as const,
    code: 'P-001',
    name: 'Product',
  }
  const facts = vouPayloadReferences({
    businessDate: '2026-09-04',
    currency: 'CNY',
    attachments: [],
    supplier: reference,
    counterparty: reference,
    counterpartyType: 'supplier',
    priceLines: [{ product: reference, unitPrice: '1.00' }],
    nested: {
      subunitAllocations: [
        { subunit: { ...reference, selectionOrigin: 'HISTORICAL' as const } },
      ],
      billCashLines: [{ fundAccount: reference }],
      intermediaryCalculation: {
        source: { lines: [{ product: historicalReference }] },
        result: { summaries: [{ payee: historicalReference }] },
      },
      malformed: {
        objectId: id,
        approvalEntryId: '01J00000000000000000000002',
        selectionOrigin: 'CURRENT',
        extra: true,
      },
    },
  } as unknown as import('../src/index.ts').VouPayload)

  assert.deepEqual(
    facts.map((fact) => [
      fact.field,
      fact.candidateEntity,
      fact.reference.selectionOrigin,
    ]),
    [
      ['supplier', 'supplier', 'CURRENT'],
      ['counterparty', 'supplier', 'CURRENT'],
      ['priceLines[0].product', 'product', 'CURRENT'],
      [
        'nested.subunitAllocations[0].subunit',
        'customer-subunit',
        'HISTORICAL',
      ],
      ['nested.billCashLines[0].fundAccount', 'fund-account', 'CURRENT'],
      [
        'nested.intermediaryCalculation.source.lines[0].product',
        'product',
        'HISTORICAL',
      ],
      [
        'nested.intermediaryCalculation.result.summaries[0].payee',
        'product',
        'HISTORICAL',
      ],
    ],
  )

  assert.throws(
    () =>
      vouPayloadReferences({
        unknown: reference,
      } as unknown as import('../src/index.ts').VouPayload),
    /not uniquely typed/,
  )
  assert.throws(
    () =>
      vouPayloadReferences({
        counterparty: reference,
      } as unknown as import('../src/index.ts').VouPayload),
    /counterpartyType is required/,
  )
  assert.deepEqual(
    vouPayloadReferences({
      businessDate: '2026-09-04',
      currency: 'CNY',
      attachments: [],
      counterparty: reference,
      counterpartyType: 'other-unit',
      interestMode: 'BANK_DEDUCTED',
      billLines: [],
    } as unknown as import('../src/index.ts').VouPayload).map((fact) => [
      fact.field,
      fact.candidateEntity,
    ]),
    [['counterparty', 'other-unit']],
  )
})

test('bill draft descriptors select a single entity-legal variant and parse after required values are supplied', () => {
  const expectedVariants = {
    'bill-receipt': 'asset-primary',
    'bill-payment': 'payment-primary',
    'bill-issue': 'liability-primary',
    'bill-discount': 'discount-primary',
    'bill-maturity': 'maturity-primary',
  } as const
  const fillText = (value: unknown): unknown => {
    if (value === '') return id
    if (Array.isArray(value)) return value.map(fillText)
    if (value && typeof value === 'object')
      return Object.fromEntries(
        Object.entries(value).flatMap(([key, nested]) =>
          key === 'parentEntity' || key === 'parentDocumentId'
            ? []
            : [[key, fillText(nested)]],
        ),
      )
    return value
  }

  for (const [entity, variantId] of Object.entries(expectedVariants) as [
    keyof typeof expectedVariants,
    (typeof expectedVariants)[keyof typeof expectedVariants],
  ][]) {
    const billLines = vouEntityInputDescriptors[entity].find(
      (field) => field.key === 'billLines',
    )
    assert.equal(billLines?.variants?.[0]?.id, variantId)
    assert.ok(
      billLines?.variants?.every((variant) => variant.fields.length > 0),
    )

    const draft = createVouDraftPayload(entity) as unknown as {
      billLines: readonly Record<string, unknown>[]
    }
    assert.deepEqual(
      Object.keys(draft.billLines[0]!).sort(),
      billLines?.variants?.[0]?.fields
        .filter((field) => field.required)
        .map((field) => field.key)
        .sort(),
    )
    assert.equal(
      vouPayloadSchemaByEntity[entity].safeParse(fillText(draft)).success,
      true,
    )
  }
})

test('local VOU drafts omit optional values until the user supplies them', () => {
  const draft = createVouDraftPayload('sale-order', () => id)
  assert.equal('remark' in draft, false)
  assert.equal('parentEntity' in draft, false)
  assert.equal('parentDocumentId' in draft, false)
  assert.equal('salesperson' in draft, false)
  assert.equal('creditOverrideReason' in draft, false)
  assert.equal('formula' in draft.productLines[0]!, false)
})

test('sale and purchase return lines require the exact source document and line pair', () => {
  const returnLine = {
    sourceDocumentId: id,
    sourceLineId: '01J00000000000000000000002',
    baseQuantity: '1.000000',
  }
  const common = {
    businessDate: '2026-09-04',
    currency: 'CNY',
    parentEntity: 'sale-order',
    parentDocumentId: '01J00000000000000000000003',
    warehouse: reference,
    returnReason: '精确来源回归',
    returnLines: [returnLine],
    attachments: [],
  }
  assert.equal(
    vouPayloadSchemaByEntity['sale-return'].safeParse(common).success,
    true,
  )
  assert.equal(
    vouPayloadSchemaByEntity['sale-return'].safeParse({
      ...common,
      returnLines: [
        { sourceLineId: returnLine.sourceLineId, baseQuantity: '1.000000' },
      ],
    }).success,
    false,
  )
  assert.equal(
    vouPayloadSchemaByEntity['purchase-return'].safeParse({
      ...common,
      parentEntity: 'purchase-order',
      supplier: reference,
    }).success,
    true,
  )
})

test('the target contract accepts rich sale-order facts and rejects the retired generic line bag', () => {
  const accepted = vouSubmitRequestSchema.safeParse(base)
  assert.equal(accepted.success, true)

  const retired = vouSubmitRequestSchema.safeParse({
    ...base,
    payload: {
      businessDate: '2026-09-04',
      currency: 'CNY',
      amount: '10.00',
      lines: [{ quantity: '1.000000', unitPrice: '10.00', amount: '10.00' }],
      attachments: [],
    },
  })
  assert.equal(retired.success, false)
})

test('sale orders and asset sales own their authoritative business counterparties', () => {
  const saleOrder = {
    ...base.payload,
    operatingEntity: reference,
  }
  assert.equal(
    vouPayloadSchemaByEntity['sale-order'].safeParse(saleOrder).success,
    true,
  )
  const { operatingEntity: _operatingEntity, ...missingOperatingEntity } =
    saleOrder
  assert.equal(
    vouPayloadSchemaByEntity['sale-order'].safeParse(missingOperatingEntity)
      .success,
    false,
  )

  const assetSale = {
    businessDate: '2026-09-04',
    currency: 'CNY',
    attachments: [],
    counterparty: reference,
    counterpartyType: 'other-unit' as const,
    assetSaleLines: [{ assetId: id, saleAmount: '10.00' }],
  }
  assert.equal(
    vouPayloadSchemaByEntity['asset-sale'].safeParse(assetSale).success,
    true,
  )
  assert.equal(
    vouPayloadSchemaByEntity['asset-sale'].safeParse({
      ...assetSale,
      counterpartyType: 'supplier',
    }).success,
    false,
  )
  assert.equal(
    vouPayloadSchemaByEntity['asset-sale'].safeParse({
      ...assetSale,
      counterparty: undefined,
      customer: reference,
    }).success,
    false,
  )

  const decision = prepareVouSubmission(
    {
      action: 'submit-new',
      entity: 'asset-sale',
      documentId: '01J00000000000000000000006',
      submissionId: '01J00000000000000000000007',
      idempotencyKey: '01J00000000000000000000007',
      expectedRevision: null,
      payload: { ...assetSale, counterpartyType: 'supplier' },
    } as unknown as VouSubmissionCommand,
    {
      actor: submitter,
      documentExists: false,
      currentSubmissionId: null,
      currentRevision: null,
      referencesValid: true,
      periodOpen: true,
      trustedSystemActor: false,
    },
  )
  assert.deepEqual(decision, { ok: false, errorKey: 'vou_invalid_payload' })
})

test('all four system-generated VOU entities reject an ordinary submitter', () => {
  for (const entity of systemGeneratedVouEntities) {
    const decision = prepareVouSubmission(
      {
        ...base,
        action: 'submit-new',
        entity,
      } as unknown as VouSubmissionCommand,
      {
        actor: submitter,
        documentExists: false,
        currentSubmissionId: null,
        currentRevision: null,
        referencesValid: true,
        periodOpen: true,
        trustedSystemActor: false,
      },
    )
    assert.deepEqual(decision, {
      ok: false,
      errorKey: 'vou_trusted_actor_required',
    })
  }
})

test('sale signoff owns an exact customer-subunit container fact', () => {
  const payload = {
    businessDate: '2026-09-04',
    currency: 'CNY',
    attachments: [],
    customerSubunit: reference,
    expectedSolventContainers: 5,
    expectedResinContainers: 3,
    returnedSolventContainers: 2,
    returnedResinContainers: 4,
    containerDifferenceReason: '现场盘点差异',
    signoffLines: [
      {
        sourceLineId: 'source-line-1',
        signedBaseQuantity: '1.000000',
        rejectedBaseQuantity: '0.000000',
      },
    ],
  }
  assert.equal(
    vouPayloadSchemaByEntity['sale-signoff'].safeParse(payload).success,
    true,
  )
  assert.deepEqual(vouPayloadReferences(payload), [
    {
      field: 'customerSubunit',
      candidateEntity: 'customer-subunit',
      reference,
    },
  ])
  assert.equal(
    vouPayloadSchemaByEntity['sale-signoff'].safeParse({
      ...payload,
      expectedSolventContainers: -1,
    }).success,
    false,
  )
  assert.equal(
    vouPayloadSchemaByEntity['sale-signoff'].safeParse({
      ...payload,
      returnedResinContainers: 1.5,
    }).success,
    false,
  )
})

test('the target contract rejects over-precision amount and base-quantity facts', () => {
  const invalidAmount = vouSubmitRequestSchema.safeParse({
    ...base,
    payload: {
      ...base.payload,
      productLines: [{ ...base.payload.productLines[0]!, unitPrice: '10.001' }],
    },
  })
  assert.equal(invalidAmount.success, false)

  const invalidQuantity = vouSubmitRequestSchema.safeParse({
    ...base,
    payload: {
      ...base.payload,
      productLines: [
        { ...base.payload.productLines[0]!, baseQuantity: '1.0000001' },
      ],
    },
  })
  assert.equal(invalidQuantity.success, false)
})

test('approve and unapprove retain typed transactional effects', () => {
  const pending: ApprovalEntry = {
    id: '01J10000000000000000000021',
    domain: 'vou',
    entity: 'purchase-inbound',
    subjectId: '01J00000000000000000000021',
    versionNo: null,
    status: 'PENDING',
    revision: '1',
    metadata: {
      submitted: {
        actorId: submitter.id,
        occurredAt: '2026-09-04T00:00:00.000Z',
      },
    },
  }
  const approved = prepareVouApproval(
    'approve',
    pending,
    reviewer,
    {
      irreversibleBlockers: [],
      accounting: { kind: 'POST', bookIds: ['book-1'] },
      inventory: { kind: 'INBOUND', lineCount: 2 },
      workflow: { kind: 'START_OR_CONTINUE' },
    },
    undefined,
    { occurredAt: '2026-09-04T01:00:00.000Z', requestId: 'vou-approve' },
  )
  assert.equal(approved.ok, true)
  if (!approved.ok) return
  assert.deepEqual(
    approved.plan.effects.map((effect) => effect.domain),
    ['acc', 'inventory', 'wfl'],
  )

  const blocked = prepareVouApproval(
    'unapprove',
    { ...pending, status: 'APPROVED', revision: '2' },
    reviewer,
    {
      irreversibleBlockers: [
        { kind: 'DOWNSTREAM_DOCUMENT', id: '01J30000000000000000000021' },
      ],
      accounting: { kind: 'REVERSE', bookIds: ['book-1'] },
      inventory: { kind: 'REVERSE', lineCount: 2 },
      workflow: { kind: 'REVERSE' },
    },
    'reverse',
    { occurredAt: '2026-09-04T02:00:00.000Z', requestId: 'vou-unapprove' },
  )
  assert.deepEqual(blocked, {
    ok: false,
    errorKey: 'vou_unapprove_blocked',
    blockers: [
      { kind: 'DOWNSTREAM_DOCUMENT', id: '01J30000000000000000000021' },
    ],
  })
})

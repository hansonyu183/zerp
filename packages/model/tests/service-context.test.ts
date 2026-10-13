import assert from 'node:assert/strict'
import test from 'node:test'
import {
  servicePermissionContexts,
  servicePayloadContext,
  mergeServiceContexts,
  prepareVouSubmission,
  type VouPayload,
  type VouServiceLineInput,
} from '../src/index.ts'
const id = '01J00000000000000000000001'
const unit = { objectId: id, code: 'D', name: '车', fixedFactor: null }
const line: VouServiceLineInput = {
  lineId: id,
  serviceName: '运输服务',
  enteredQuantity: '4',
  enteredUnit: unit,
  baseQuantity: '4',
  baseUnit: unit,
  unitPrice: '4741.500000',
  agreedAmount: '18966.00',
  sourceLineKey: 'original-1',
}
const prior = {
  sourceClosed: false,
  sourceInstanceId: 'oit-fixture',
  sourceSchema: 'fixture',
  sourceDocumentType: 'AD' as const,
  sourceDocumentKey: '458540',
  sourceDocumentNo: 'AD-250908-002',
  capturedAt: '2026-10-08T18:26:02.703071Z',
  snapshotDigest: 'a'.repeat(64),
}
const contract = {
  businessDate: '2025-09-08',
  currency: 'CNY',
  employee: { objectId: id },
  attachments: [],
  counterpartyType: 'other-unit' as const,
  counterparty: {
    objectId: id,
    approvalEntryId: id,
    selectionOrigin: 'CURRENT' as const,
  },
  priorFact: prior,
  serviceLines: [line],
  serviceContract: { requiresPrepayment: true },
}
function prepare(payload: unknown, entity = 'service-contract') {
  return prepareVouSubmission(
    {
      entity,
      action: 'submit-new',
      documentId: id,
      submissionId: id,
      idempotencyKey: id,
      expectedRevision: null,
      payload,
    } as Parameters<typeof prepareVouSubmission>[0],
    {
      actor: { id, permissions: [`/vou/${entity}/submit-new`] },
      documentExists: false,
      currentSubmissionId: null,
      currentRevision: null,
      referencesValid: true,
      periodOpen: true,
      trustedSystemActor: false,
    },
  )
}
test('supplier service agreements retain their type and historical identity without using another unit', () => {
  const supplier = { ...contract, counterpartyType: 'supplier' as const }
  assert.equal(prepare(supplier).ok, true)
  assert.equal(servicePayloadContext('service-contract', supplier), 'PRIOR_AD')
  const { priorFact: _fact, ...ordinary } = supplier
  const { sourceLineKey: _source, ...ordinaryLine } = line
  const current = { ...ordinary, serviceLines: [ordinaryLine] }
  assert.equal(prepare(current).ok, true)
  assert.equal(servicePayloadContext('service-contract', current), 'SUPPLIER')
  for (const counterpartyType of ['employee', 'product']) {
    assert.equal(prepare({ ...supplier, counterpartyType }).ok, false)
    assert.equal(prepare({ ...current, counterpartyType }).ok, false)
  }
  assert.equal(
    prepare({ ...supplier, counterpartyType: 'sales-partner' }).ok,
    false,
  )
})

test('standalone prior fulfillment requires an explicit original party type and cannot turn a partner into an ordinary service contract', () => {
  const { serviceContract: _contract, ...original } = contract
  const acceptance = {
    ...original,
    priorFact: { ...prior, sourceDocumentType: 'AB' },
    amount: '18966.00',
    serviceAcceptance: {
      serviceDate: '2025-09-08',
      acceptanceDate: '2025-09-08',
      settlementDirection: 'PAYABLE',
    },
  }
  for (const counterpartyType of ['supplier', 'other-unit', 'sales-partner'])
    assert.equal(
      prepare({ ...acceptance, counterpartyType }, 'service-acceptance').ok,
      true,
    )
  const { counterpartyType: _kind, ...missingType } = acceptance
  assert.equal(prepare(missingType, 'service-acceptance').ok, false)
  assert.equal(
    prepare(
      { ...acceptance, counterpartyType: 'customer' },
      'service-acceptance',
    ).ok,
    false,
  )
  assert.equal(
    prepare(
      {
        ...acceptance,
        counterpartyType: 'sales-partner',
        serviceAcceptance: {
          ...acceptance.serviceAcceptance,
          contractDocumentId: id,
        },
      },
      'service-acceptance',
    ).ok,
    false,
  )
})
test('service contexts are action and entity specific, with no wildcard or historical-to-partner inference', () => {
  assert.deepEqual(servicePermissionContexts('/vou/service-contract/approve'), [
    'OTHER_UNIT',
    'SUPPLIER',
    'SALES_PARTNER',
    'PRIOR_AA',
    'PRIOR_AD',
    'CUSTOMER',
    'PRIOR_BB',
  ])
  assert.deepEqual(
    servicePermissionContexts(
      '/wfl/process-instance/create-service-acceptance',
    ),
    [
      'CONTRACT',
      'PRIOR_AB',
      'PRIOR_AE',
      'PRIOR_AH',
      'PRIOR_BA',
      'CUSTOMER_CONTRACT',
    ],
  )
  assert.deepEqual(servicePermissionContexts('/vou/purchase-inbound/get'), [])
  assert.equal(servicePayloadContext('service-contract', contract), 'PRIOR_AD')
  assert.equal(
    servicePayloadContext(
      'service-acceptance',
      contract as unknown as VouPayload,
    ),
    undefined,
  )
  assert.deepEqual(
    mergeServiceContexts([['PRIOR_AH'], ['CONTRACT', 'PRIOR_AH']]),
    ['CONTRACT', 'PRIOR_AH'],
  )
})
test('prior prepaid service preserves the real quotation and two distinct unit snapshots', () => {
  const input = {
    ...contract,
    serviceLines: [
      {
        ...line,
        enteredUnit: { ...unit, code: 'A', name: '千克' },
        baseUnit: { ...unit, code: 'E', name: '次' },
        enteredQuantity: '0.000001',
        baseQuantity: '0',
      },
    ],
  }
  const result = prepare(input)
  assert.equal(result.ok, true)
  if (result.ok)
    assert.deepEqual(
      'serviceLines' in result.plan.payload && result.plan.payload.serviceLines,
      input.serviceLines,
    )
  assert.equal(
    prepare({ ...contract, serviceContract: { requiresPrepayment: false } }).ok,
    false,
  )
  assert.equal(
    prepare({ ...contract, counterpartyType: 'sales-partner' }).ok,
    false,
  )
  assert.equal(prepare({ ...contract, serviceLines: [] }).ok, false)
})
test('malformed service structures fail without exceptions and ordinary input cannot retain source identities', () => {
  for (const payload of [
    { ...contract, serviceContract: null },
    { ...contract, serviceLines: [null] },
    { ...contract, serviceLines: [{ ...line, baseUnit: null }] },
  ])
    assert.equal(prepare(payload).ok, false)
  const { priorFact: _prior, ...ordinary } = contract
  assert.equal(prepare(ordinary).ok, false)
  const { sourceLineKey: _source, ...newLine } = line
  assert.equal(prepare({ ...ordinary, serviceLines: [newLine] }).ok, true)
  assert.equal(
    prepare({
      ...ordinary,
      serviceLines: [{ ...newLine, enteredQuantity: '0.001' }],
    }).ok,
    false,
  )
  const acceptance = {
    ...contract,
    amount: '18966.00',
    priorFact: { ...prior, sourceDocumentType: 'AE' },
    serviceContract: undefined,
    serviceAcceptance: {
      serviceDate: '2025-09-08',
      acceptanceDate: '2025-09-08',
      settlementDirection: 'PAYABLE',
    },
  }
  delete (acceptance as Record<string, unknown>).serviceContract
  assert.equal(prepare(acceptance, 'service-acceptance').ok, true)
  assert.equal(
    prepare({ ...acceptance, priorLineOrigins: [null] }, 'service-acceptance')
      .ok,
    false,
  )
  assert.equal(
    prepare(
      {
        ...acceptance,
        priorLineOrigins: [
          {
            lineId: id,
            sourceDocumentType: 'BB',
            sourceDocumentKey: '100',
            sourceLineKey: '1',
            injected: true,
          },
        ],
      },
      'service-acceptance',
    ).ok,
    false,
  )
})

test('customer service preserves BB and BA origin without purchase permissions or invented consideration', () => {
  const customer = {
    ...contract,
    counterpartyType: 'customer' as const,
    operatingEntity: { objectId: id },
    priorFact: { ...prior, sourceDocumentType: 'BB' as const },
    serviceContract: { terms: '客户运输' },
  }
  assert.equal(prepare(customer).ok, true)
  assert.equal(servicePayloadContext('service-contract', customer), 'PRIOR_BB')
  assert.equal(prepare({ ...customer, priorFact: prior }).ok, false)
  assert.equal(prepare({ ...customer, operatingEntity: undefined }).ok, false)
  assert.equal(
    prepare({ ...customer, serviceContract: { requiresPrepayment: true } }).ok,
    false,
  )
  const { serviceContract: _contract, ...base } = customer
  const acceptance = {
    ...base,
    priorFact: { ...prior, sourceDocumentType: 'BA' as const },
    amount: '0.00',
    serviceLines: [{ ...line, agreedAmount: '0.00' }],
    serviceAcceptance: {
      serviceDate: '2025-09-08',
      acceptanceDate: '2025-09-08',
      settlementDirection: 'RECEIVABLE' as const,
    },
  }
  assert.equal(prepare(acceptance, 'service-acceptance').ok, true)
  assert.equal(
    servicePayloadContext('service-acceptance', acceptance),
    'PRIOR_BA',
  )
  assert.equal(
    prepare(
      {
        ...acceptance,
        serviceAcceptance: {
          ...acceptance.serviceAcceptance,
          settlementDirection: 'PAYABLE',
        },
      },
      'service-acceptance',
    ).ok,
    false,
  )
  assert.equal(
    prepare(
      { ...acceptance, priorFact: { ...prior, sourceDocumentType: 'AH' } },
      'service-acceptance',
    ).ok,
    false,
  )
})

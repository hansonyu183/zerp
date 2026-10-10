import { describe, it, expect } from 'vitest'
import {
  emptyService,
  setServiceContext,
  serviceDraftContext,
  servicePayload,
  cloneService,
} from '../../../src/target/components/document-page/service-data.ts'
import type { VouPayloadFor } from '@zerp/model'
const id = '01J00000000000000000000001',
  entry = '01J00000000000000000000002'
const unit = { objectId: id, code: 'D', name: '车', fixedFactor: null }
const fact = {
  sourceDocumentType: 'AD' as const,
  sourceClosed: false,
  sourceInstanceId: 'fixture',
  sourceSchema: 'fixture',
  sourceDocumentKey: '458540',
  sourceDocumentNo: 'AD-original',
  capturedAt: '2026-10-08T18:26:02.703071Z',
  snapshotDigest: 'a'.repeat(64),
}
const payload: VouPayloadFor<'service-contract'> = {
  businessDate: '2025-09-08',
  currency: 'CNY',
  attachments: [],
  employee: { objectId: id },
  counterpartyType: 'other-unit',
  counterparty: {
    objectId: id,
    approvalEntryId: entry,
    selectionOrigin: 'CURRENT',
  },
  priorFact: fact,
  serviceLines: [
    {
      lineId: id,
      serviceName: '运输服务',
      enteredQuantity: '4',
      enteredUnit: unit,
      baseQuantity: '4',
      baseUnit: unit,
      unitPrice: '4741.500000',
      agreedAmount: '18966.00',
      sourceLineKey: 'source-1',
    },
  ],
  serviceContract: { requiresPrepayment: true, terms: '原约定' },
}
describe('service carryover form orchestration', () => {
  it('explicit prior AD mode starts incomplete source identity and requires an actual closed-state decision', () => {
    const draft = setServiceContext(
      emptyService('service-contract'),
      'PRIOR_AD',
    )
    expect(serviceDraftContext(draft)).toBe('PRIOR_AD')
    expect(draft.requiresPrepayment).toBe(true)
    expect(draft.priorFact?.sourceDocumentKey).toBe('')
    expect(draft.priorFact?.sourceClosed).toBeNull()
    expect(() =>
      servicePayload({
        ...draft,
        employee: {
          entity: 'employee',
          objectId: id,
          code: 'EM1',
          name: '经办',
        },
      }),
    ).toThrow('请选择源单关闭状态')
  })
  it('Supplier context and cloning preserve the approved Supplier identity', () => {
    const initial = setServiceContext(
      emptyService('service-contract'),
      'SUPPLIER',
    )
    expect(initial.counterpartyType).toBe('supplier')
    expect(serviceDraftContext(initial)).toBe('SUPPLIER')
    const draft = cloneService('service-contract', {
      ...payload,
      counterpartyType: 'supplier',
    })
    expect(serviceDraftContext(draft)).toBe('SUPPLIER')
    expect(servicePayload(draft)).toMatchObject({
      counterpartyType: 'supplier',
      counterparty: { ...payload.counterparty, selectionOrigin: 'HISTORICAL' },
    })
    expect(servicePayload(draft)).not.toHaveProperty('priorFact')
  })
  it('cloning clears prior identity, original line keys and attachments while preserving precise quotation and both units', () => {
    const draft = cloneService('service-contract', {
      ...payload,
      attachments: [
        {
          id: id,
          fileName: 'source.pdf',
          contentType: 'application/pdf',
          sizeBytes: 1,
          sha256: 'a'.repeat(64),
          stagingId: id,
        },
      ],
    })
    expect(draft.priorFact).toBeUndefined()
    expect(draft.attachments).toEqual([])
    expect(draft.serviceLines[0]?.sourceLineKey).toBeUndefined()
    expect(draft.serviceLines[0]?.lineId).not.toBe(id)
    expect(draft.serviceLines[0]?.unitPrice).toBe('4741.500000')
    expect(draft.serviceLines[0]?.agreedAmount).toBe('18966.00')
    expect(draft.serviceLines[0]?.baseUnit).toEqual(unit)
    expect(serviceDraftContext(draft)).toBe('OTHER_UNIT')
    expect(servicePayload(draft)).not.toHaveProperty('priorFact')
  })
  it.each(['supplier', 'other-unit', 'sales-partner'] as const)(
    'a standalone %s prior acceptance becomes a new incomplete contract-based form when copied',
    (counterpartyType) => {
      const acceptance: VouPayloadFor<'service-acceptance'> = {
        businessDate: payload.businessDate,
        currency: 'CNY',
        employee: payload.employee,
        attachments: [],
        counterparty: payload.counterparty,
        counterpartyType,
        priorFact: { ...fact, sourceDocumentType: 'AE' },
        serviceLines: payload.serviceLines,
        amount: '18966.00',
        serviceAcceptance: {
          serviceDate: payload.businessDate,
          acceptanceDate: payload.businessDate,
          settlementDirection: 'PAYABLE',
        },
      }
      const draft = cloneService('service-acceptance', acceptance)
      expect(draft.contract).toBeNull()
      expect(draft.counterparty).toBeNull()
      expect(serviceDraftContext(draft)).toBe('CONTRACT')
      expect(draft.priorFact).toBeUndefined()
      expect(() => servicePayload(draft)).toThrow('请选择已批准的服务合同')
    },
  )
})

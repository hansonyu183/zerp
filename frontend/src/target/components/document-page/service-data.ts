import { businessDate } from './business-date.ts'
import type { VouAttachmentMetadata, VouPayloadFor } from '@zerp/model'
import type { VouCandidate } from './VouReference.vue'
import { snapshotEnums } from './snapshot-presentation.ts'
export const serviceEntities = [
  'service-contract',
  'service-acceptance',
] as const
export type ServiceEntity = (typeof serviceEntities)[number]
export type ServiceDraft = {
  entity: ServiceEntity
  businessDate: string
  currency: string
  remark: string
  employee: VouCandidate | null
  counterparty: VouCandidate | null
  counterpartyType: 'other-unit' | 'sales-partner'
  contract: VouCandidate | null
  origin: 'CURRENT' | 'HISTORICAL'
  capabilities: ('EXTERNAL_PART_TIME' | 'CHANNEL_PARTNER')[]
  applicableFrom: string
  applicableTo: string
  terms: string
  serviceDate: string
  acceptanceDate: string
  settlementDirection: 'PAYABLE' | 'RECEIVABLE'
  amount: string
  fulfillmentFact: string
  acceptanceFact: string
  attachments: VouAttachmentMetadata[]
}
export const servicePartyOptions = (
  ['other-unit', 'sales-partner'] as const
).map((value) => ({ value, caption: snapshotEnums.counterpartyType![value]! }))
export const serviceDirectionOptions = (['PAYABLE', 'RECEIVABLE'] as const).map(
  (value) => ({ value, caption: snapshotEnums.settlementDirection![value]! }),
)
export const serviceCapabilityOptions = (
  ['EXTERNAL_PART_TIME', 'CHANNEL_PARTNER'] as const
).map((value) => ({ value, caption: snapshotEnums.capabilities![value]! }))
export function emptyService(entity: ServiceEntity): ServiceDraft {
  const date = businessDate()
  return {
    entity,
    businessDate: date,
    currency: 'CNY',
    remark: '',
    employee: null,
    counterparty: null,
    counterpartyType: 'other-unit',
    contract: null,
    origin: 'CURRENT',
    capabilities: [],
    applicableFrom: '',
    applicableTo: '',
    terms: '',
    serviceDate: date,
    acceptanceDate: date,
    settlementDirection: 'PAYABLE',
    amount: '',
    fulfillmentFact: '',
    acceptanceFact: '',
    attachments: [],
  }
}
export function servicePayload(
  draft: ServiceDraft,
): VouPayloadFor<ServiceEntity> {
  if (!draft.employee) throw new Error('请选择经办员工。')
  const base = {
    businessDate: draft.businessDate,
    currency: draft.currency,
    remark: draft.remark,
    employee: { objectId: draft.employee.objectId },
    attachments: draft.attachments,
  }
  if (draft.entity === 'service-contract') {
    const party = draft.counterparty
    if (
      !party ||
      party.entity !== draft.counterpartyType ||
      !('approvalEntryId' in party) ||
      !party.approvalEntryId
    )
      throw new Error('请选择合同相对方。')
    if (
      draft.applicableFrom &&
      draft.applicableTo &&
      draft.applicableFrom > draft.applicableTo
    )
      throw new Error('合同结束日期不得早于开始日期。')
    return {
      ...base,
      counterparty: {
        objectId: party.objectId,
        approvalEntryId: party.approvalEntryId,
        selectionOrigin: draft.origin,
      },
      counterpartyType: draft.counterpartyType,
      serviceContract: {
        ...(draft.counterpartyType === 'sales-partner'
          ? { capabilities: draft.capabilities }
          : {}),
        ...(draft.applicableFrom
          ? { applicableFrom: draft.applicableFrom }
          : {}),
        ...(draft.applicableTo ? { applicableTo: draft.applicableTo } : {}),
        terms: draft.terms,
      },
    }
  }
  if (!draft.contract) throw new Error('请选择已批准的服务合同。')
  if (!/^\d+(?:\.\d{1,2})?$/.test(draft.amount) || !/[1-9]/.test(draft.amount))
    throw new Error('结算金额必须大于零，最多两位小数。')
  return {
    ...base,
    amount: draft.amount,
    serviceAcceptance: {
      contractDocumentId: draft.contract.objectId,
      serviceDate: draft.serviceDate,
      acceptanceDate: draft.acceptanceDate,
      settlementDirection: draft.settlementDirection,
      fulfillmentFact: draft.fulfillmentFact,
      acceptanceFact: draft.acceptanceFact,
    },
  }
}
export function cloneService(
  entity: ServiceEntity,
  payload: VouPayloadFor<ServiceEntity>,
): ServiceDraft {
  const draft = {
    ...emptyService(entity),
    businessDate: payload.businessDate,
    currency: payload.currency,
    remark: payload.remark ?? '',
    employee: {
      entity: 'employee' as const,
      objectId: payload.employee.objectId,
      code: payload.employee.code ?? '',
      name: payload.employee.name ?? '已采用员工',
    },
    origin: 'HISTORICAL' as const,
  }
  if ('serviceContract' in payload)
    return {
      ...draft,
      counterpartyType: payload.counterpartyType,
      counterparty: {
        entity: payload.counterpartyType,
        ...payload.counterparty,
        code: '',
        name: '已采用相对方',
      },
      capabilities: [...(payload.serviceContract.capabilities ?? [])],
      applicableFrom: payload.serviceContract.applicableFrom ?? '',
      applicableTo: payload.serviceContract.applicableTo ?? '',
      terms: payload.serviceContract.terms ?? '',
    }
  return {
    ...draft,
    ...payload.serviceAcceptance,
    amount: payload.amount,
    fulfillmentFact: payload.serviceAcceptance.fulfillmentFact ?? '',
    acceptanceFact: payload.serviceAcceptance.acceptanceFact ?? '',
    contract: {
      entity: 'service-contract',
      objectId: payload.serviceAcceptance.contractDocumentId,
      code: '',
      name: '已采用合同',
    },
  }
}

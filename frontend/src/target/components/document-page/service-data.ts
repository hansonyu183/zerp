import { businessDate } from './business-date.ts'
import {
  type VouAttachmentMetadata,
  type VouPayloadFor,
  type VouServiceLineInput,
  type ServiceContext,
  type VouPriorLineOrigin,
  vouServiceCounterpartyTypes,
  serviceCounterpartyContexts,
  type VouServiceCounterpartyType,
} from '@zerp/model'
import { priorFactPayload, type PriorFactDraft } from './prior-fact-data.ts'
import { ulid } from 'ulid'
import type { VouCandidate } from './VouReference.vue'
import { snapshotEnums } from './snapshot-presentation.ts'
export const serviceEntities = [
  'service-contract',
  'service-acceptance',
] as const
export type ServiceEntity = (typeof serviceEntities)[number]
export type ServiceLineDraft = Omit<
  VouServiceLineInput,
  'enteredUnit' | 'baseUnit'
> & {
  enteredUnit: VouServiceLineInput['enteredUnit'] | null
  baseUnit: VouServiceLineInput['baseUnit'] | null
  originalReference?: Omit<VouPriorLineOrigin, 'lineId'>
}
export function emptyServiceLine(): ServiceLineDraft {
  return {
    lineId: ulid(),
    serviceName: '',
    enteredQuantity: '',
    enteredUnit: null,
    baseQuantity: '',
    baseUnit: null,
    agreedAmount: '',
  }
}
export function serviceDraftContext(draft: ServiceDraft): ServiceContext {
  return draft.priorFact
    ? (`PRIOR_${draft.priorFact.sourceDocumentType}` as ServiceContext)
    : draft.entity === 'service-contract'
      ? serviceCounterpartyContexts[draft.counterpartyType]
      : 'CONTRACT'
}
export function setServiceContext(
  draft: ServiceDraft,
  context: ServiceContext,
): ServiceDraft {
  const historical = context.startsWith('PRIOR_')
  return {
    ...emptyService(draft.entity),
    businessDate: draft.businessDate,
    currency: draft.currency,
    remark: draft.remark,
    employee: draft.employee,
    attachments: draft.attachments,
    counterpartyType:
      (Object.entries(serviceCounterpartyContexts).find(
        ([, value]) => value === context,
      )?.[0] as VouServiceCounterpartyType | undefined) ?? 'other-unit',
    requiresPrepayment: context === 'PRIOR_AD',
    ...(historical
      ? {
          priorFact: {
            sourceDocumentType: context.slice(
              6,
            ) as PriorFactDraft['sourceDocumentType'],
            sourceClosed: null,
            sourceInstanceId: '',
            sourceSchema: '',
            sourceDocumentKey: '',
            sourceDocumentNo: '',
            capturedAt: '',
            snapshotDigest: '',
          },
        }
      : {}),
  }
}
export type ServiceDraft = {
  entity: ServiceEntity
  priorFact?: PriorFactDraft | null
  serviceLines: ServiceLineDraft[]
  requiresPrepayment: boolean
  businessDate: string
  currency: string
  remark: string
  employee: VouCandidate | null
  counterparty: VouCandidate | null
  counterpartyType: VouServiceCounterpartyType
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
export const servicePartyOptions = vouServiceCounterpartyTypes.map((value) => ({
  value,
  caption: snapshotEnums.counterpartyType![value]!,
}))
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
    serviceLines: [],
    requiresPrepayment: false,
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
    ...(draft.priorFact
      ? { priorFact: priorFactPayload(draft.priorFact) }
      : {}),
    ...(draft.serviceLines.length
      ? {
          serviceLines: draft.serviceLines.map((line): VouServiceLineInput => {
            if (!line.serviceName.trim() || !line.enteredUnit || !line.baseUnit)
              throw new Error('请填写服务名称并选择录入单位和基准单位。')
            if (draft.priorFact && !line.sourceLineKey?.trim())
              throw new Error('请填写真实原行键。')
            const {
              sourceLineKey,
              originalReference: _origin,
              unitPrice,
              serviceCode,
              ...value
            } = line
            return {
              ...value,
              ...(unitPrice?.trim() ? { unitPrice } : {}),
              ...(serviceCode?.trim() ? { serviceCode } : {}),
              enteredUnit: line.enteredUnit,
              baseUnit: line.baseUnit,
              ...(draft.priorFact ? { sourceLineKey } : {}),
            }
          }),
        }
      : {}),
  }
  if (draft.priorFact && !draft.serviceLines.length)
    throw new Error('此前服务必须填写真实服务明细。')
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
        ...(draft.counterpartyType !== 'sales-partner'
          ? { requiresPrepayment: draft.requiresPrepayment }
          : {}),
      },
    }
  }
  if (!draft.contract && !draft.priorFact)
    throw new Error('请选择已批准的服务合同。')
  const party = draft.counterparty
  if (
    !draft.contract &&
    (!party ||
      party.entity !== draft.counterpartyType ||
      !('approvalEntryId' in party) ||
      !party.approvalEntryId)
  )
    throw new Error('请选择此前服务的真实相对方。')
  if (
    !/^\d+(?:\.\d{1,2})?$/.test(draft.amount) ||
    (!draft.priorFact && !/[1-9]/.test(draft.amount))
  )
    throw new Error('结算金额必须大于零，最多两位小数。')
  return {
    ...base,
    amount: draft.amount,
    ...(draft.priorFact &&
    draft.serviceLines.some((line) => line.originalReference)
      ? {
          priorLineOrigins: draft.serviceLines.flatMap((line) =>
            line.originalReference
              ? [{ lineId: line.lineId, ...line.originalReference }]
              : [],
          ),
        }
      : {}),
    ...(!draft.contract && party && 'approvalEntryId' in party
      ? {
          counterpartyType: draft.counterpartyType,
          counterparty: {
            objectId: party.objectId,
            approvalEntryId: party.approvalEntryId!,
            selectionOrigin: draft.origin,
          },
        }
      : {}),
    serviceAcceptance: {
      ...(draft.contract
        ? { contractDocumentId: draft.contract.objectId }
        : {}),
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
    serviceLines: (payload.serviceLines ?? []).map(
      ({ sourceLineKey: _source, contractLineId: _contract, ...line }) => ({
        ...line,
        lineId: ulid(),
      }),
    ),
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
      requiresPrepayment: payload.serviceContract.requiresPrepayment ?? false,
    }
  return {
    ...draft,
    ...payload.serviceAcceptance,
    amount: payload.amount,
    fulfillmentFact: payload.serviceAcceptance.fulfillmentFact ?? '',
    acceptanceFact: payload.serviceAcceptance.acceptanceFact ?? '',
    contract: payload.serviceAcceptance.contractDocumentId
      ? {
          entity: 'service-contract',
          objectId: payload.serviceAcceptance.contractDocumentId,
          code: '',
          name: '已采用合同',
        }
      : null,
    serviceLines: (payload.serviceLines ?? []).map(
      ({ sourceLineKey: _source, ...line }) => ({ ...line, lineId: ulid() }),
    ),
  }
}

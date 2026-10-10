import type {
  VouEntity,
  VouPayload,
  VouServiceCounterpartyType,
} from './vou.ts'

export const serviceContextValues = [
  'OTHER_UNIT',
  'SUPPLIER',
  'SALES_PARTNER',
  'PRIOR_AA',
  'PRIOR_AD',
  'CONTRACT',
  'PRIOR_AB',
  'PRIOR_AE',
  'PRIOR_AH',
] as const
export type ServiceContext = (typeof serviceContextValues)[number]
export type ServiceContexts = Readonly<
  Record<string, readonly ServiceContext[]>
>
export const serviceContextPresentation: Readonly<
  Record<ServiceContext, { label: string }>
> = {
  OTHER_UNIT: { label: '其他单位服务合同' },
  SUPPLIER: { label: '供应商服务合同' },
  SALES_PARTNER: { label: '销售合作合同' },
  PRIOR_AA: { label: '此前采购服务约定' },
  PRIOR_AD: { label: '此前预付服务约定' },
  CONTRACT: { label: '合同履约验收' },
  PRIOR_AB: { label: '此前采购服务履约' },
  PRIOR_AE: { label: '此前其他采购服务履约' },
  PRIOR_AH: { label: '此前独立采购服务履约' },
}
export const serviceCounterpartyContexts = {
  'other-unit': 'OTHER_UNIT',
  supplier: 'SUPPLIER',
  'sales-partner': 'SALES_PARTNER',
} as const satisfies Record<VouServiceCounterpartyType, ServiceContext>
export function serviceCounterpartyContext(
  type: string | undefined,
): ServiceContext | undefined {
  return type !== undefined && Object.hasOwn(serviceCounterpartyContexts, type)
    ? serviceCounterpartyContexts[type as VouServiceCounterpartyType]
    : undefined
}
export function servicePermissionContexts(
  path: string,
): readonly ServiceContext[] {
  if (
    path.startsWith('/vou/service-contract/') ||
    path === '/wfl/process-instance/create-service-contract'
  )
    return ['OTHER_UNIT', 'SUPPLIER', 'SALES_PARTNER', 'PRIOR_AA', 'PRIOR_AD']
  if (
    path.startsWith('/vou/service-acceptance/') ||
    path === '/wfl/process-instance/create-service-acceptance'
  )
    return ['CONTRACT', 'PRIOR_AB', 'PRIOR_AE', 'PRIOR_AH']
  return []
}
export function servicePayloadContext(
  entity: VouEntity,
  payload: VouPayload,
): ServiceContext | undefined {
  if (entity !== 'service-contract' && entity !== 'service-acceptance')
    return undefined
  const prior = 'priorFact' in payload ? payload.priorFact : undefined
  if (prior) {
    const context = `PRIOR_${prior.sourceDocumentType}` as ServiceContext
    return servicePermissionContexts(`/vou/${entity}/get`).includes(context)
      ? context
      : undefined
  }
  if (entity === 'service-contract' && 'counterpartyType' in payload)
    return serviceCounterpartyContext(payload.counterpartyType)
  return 'CONTRACT'
}
export function mergeServiceContexts(
  values: readonly (readonly ServiceContext[])[],
): readonly ServiceContext[] {
  const present = new Set(values.flat())
  return serviceContextValues.filter((value) => present.has(value))
}

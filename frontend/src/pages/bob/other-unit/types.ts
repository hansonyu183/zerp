import type { components } from '@/api/generated/schema'

export type OtherUnitStatus = Exclude<
  components['schemas']['OtherUnitView']['status'],
  'REJECTED'
>

export interface OtherUnitData {
  operatingEntityId: string
  contactName?: string
  contactPhone?: string
  email?: string
  address?: string
  settlementMethodId?: string
  remark?: string
}

export type OtherUnitView = components['schemas']['OtherUnitView']

export type OtherUnitMutationResult =
  components['schemas']['OtherUnitMutationResult']

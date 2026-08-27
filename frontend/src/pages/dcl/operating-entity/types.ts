import type {
  BusinessObjectColumn,
  BusinessObjectField,
  BusinessObjectFieldOption,
} from '@/components/business-object'
import type { components } from '@/api/generated/schema'

export type DclOperatingEntityListItem =
  components['schemas']['DclOperatingEntityListItem']
export type DclOperatingEntityView =
  components['schemas']['DclOperatingEntityView']
export type DclOperatingEntityVersionView =
  components['schemas']['DclOperatingEntityVersionView']
export type DclOperatingEntityAuditEvent =
  components['schemas']['ApprovalEventView']

export type DclOperatingEntityForm = {
  code: string
  name: string
  shortName: string
  taxNumber: string
  address: string
  phone: string
  remark: string
}

export interface DclOperatingEntityEditContext {
  objectId: string
  approvalEntryId: string
  approvalRevision: number
}

export interface DclOperatingEntityFilter {
  key: 'status' | 'enabled'
  label: string
  type: 'select'
  options: readonly BusinessObjectFieldOption[]
  multiple?: boolean
}

export interface DclOperatingEntityConfig {
  title: string
  columns: readonly BusinessObjectColumn<DclOperatingEntityListItem>[]
  filters: readonly DclOperatingEntityFilter[]
  fields: readonly BusinessObjectField<DclOperatingEntityForm>[]
  emptyForm: () => DclOperatingEntityForm
}

export function dclOperatingEntityActiveVersion(
  item: Readonly<DclOperatingEntityListItem>,
): DclOperatingEntityVersionView {
  const version = item.openVersion ?? item.latestApproved
  if (!version) throw new Error('经营主体申报缺少已批准版本和开放候选版本。')
  return version
}

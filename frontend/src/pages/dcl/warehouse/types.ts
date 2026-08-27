import type {
  BusinessObjectColumn,
  BusinessObjectField,
  BusinessObjectFieldOption,
} from '@/components/business-object'
import type { components } from '@/api/generated/schema'

export type DclWarehouseListItem = components['schemas']['DclWarehouseListItem']
export type DclWarehouseView = components['schemas']['DclWarehouseView']
export type DclWarehouseVersionView =
  components['schemas']['DclWarehouseVersionView']
export type DclWarehouseAuditEvent = components['schemas']['ApprovalEventView']

export type DclWarehouseForm = {
  code: string
  name: string
  managerEmployeeId: string
  contactName: string
  address: string
  contactPhone: string
  remark: string
}

export interface DclWarehouseEditContext {
  objectId: string
  approvalEntryId: string
  approvalRevision: number
}

export interface DclWarehouseFilter {
  key: 'status' | 'enabled'
  label: string
  type: 'select'
  options: readonly BusinessObjectFieldOption[]
  multiple?: boolean
}

export interface DclWarehouseConfig {
  title: string
  columns: readonly BusinessObjectColumn<DclWarehouseListItem>[]
  filters: readonly DclWarehouseFilter[]
  fields: readonly BusinessObjectField<DclWarehouseForm>[]
  emptyForm: () => DclWarehouseForm
}

export function dclWarehouseActiveVersion(
  item: Readonly<DclWarehouseListItem>,
): DclWarehouseVersionView {
  const version = item.openVersion ?? item.latestApproved
  if (!version) throw new Error('仓库申报缺少已批准版本和开放候选版本。')
  return version
}

import type {
  BusinessObjectColumn,
  BusinessObjectField,
  BusinessObjectFieldOption,
} from '@/components/business-object'
import type { components } from '@/api/generated/schema'

export type DclVehicleListItem = components['schemas']['DclVehicleListItem']
export type DclVehicleView = components['schemas']['DclVehicleView']
export type DclVehicleVersionView =
  components['schemas']['DclVehicleVersionView']
export type DclVehicleAuditEvent = components['schemas']['ApprovalEventView']

export type DclVehicleForm = {
  code: string
  name: string
  plateNumber: string
  vehicleType: string
  carrierType: 'INTERNAL' | 'EXTERNAL'
  carrierOperatingEntityId: string
  carrierOtherUnitObjectId: string
  bulkLiquidCapable: boolean
  vin: string
  engineNumber: string
  loadCapacityKg: string
  remark: string
}

export type DclVehicleEditContext = {
  objectId: string
  approvalEntryId: string
  approvalRevision: number
}

export type DclVehicleFilter = {
  key: 'status' | 'enabled'
  label: string
  type: 'select'
  options: readonly BusinessObjectFieldOption[]
  multiple?: boolean
}

export type DclVehicleConfig = {
  title: string
  columns: readonly BusinessObjectColumn<DclVehicleListItem>[]
  filters: readonly DclVehicleFilter[]
  fields: readonly BusinessObjectField<DclVehicleForm>[]
  emptyForm: () => DclVehicleForm
}

export function dclVehicleActiveVersion(
  item: Readonly<DclVehicleListItem>,
): DclVehicleVersionView {
  const version = item.openVersion ?? item.latestApproved
  if (!version) throw new Error('车辆变更缺少已批准版本和开放候选版本。')
  return version
}

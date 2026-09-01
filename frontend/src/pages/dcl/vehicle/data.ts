import type { BusinessObjectSort } from '@/components/business-object'
import { apiClient, type ApiPostRequest } from '@/api/client'
import type {
  DclDeclarationHistoryPort,
  DclDeclarationWireAction,
} from '../shared/declaration'
import {
  dclVehicleActiveVersion,
  type DclVehicleForm,
  type DclVehicleListItem,
  type DclVehicleView,
} from './types'

type VehicleVersionRequest = ApiPostRequest<'dcl/vehicle/submit'>

export async function queryDclVehicles(request: {
  page: number
  pageSize: number
  filters: Record<string, unknown>
  sort: BusinessObjectSort[]
}) {
  const { data } = await apiClient.postContract('dcl/vehicle/query', request)
  return {
    items: data.items ?? [],
    total: data.total,
    page: data.page,
    pageSize: data.pageSize,
  }
}

export async function getDclVehicle(
  objectId: string,
  approvalEntryId?: string,
): Promise<DclVehicleView> {
  const { data } = await apiClient.postContract('dcl/vehicle/get', {
    objectId,
    ...(approvalEntryId ? { approvalEntryId } : {}),
  })
  return data
}

export async function runDclVehicleLifecycle(
  item: DclVehicleListItem,
  action: DclDeclarationWireAction,
  reason: string,
): Promise<void> {
  const approval = dclVehicleActiveVersion(item).approval
  return runDclVehicleAction(
    action,
    {
      objectId: item.objectId,
      approvalEntryId: approval.approvalEntryId,
      approvalRevision: approval.revision,
    },
    reason,
  )
}

export async function runDclVehicleAction(
  action: DclDeclarationWireAction,
  request: VehicleVersionRequest,
  reason: string,
): Promise<void> {
  if (action === 'reject' || action === 'unapprove')
    await apiClient.postContract(`dcl/vehicle/${action}`, {
      ...request,
      reason,
    })
  else await apiClient.postContract(`dcl/vehicle/${action}`, request)
}

export function dclVehicleFormFromView(view: DclVehicleView): DclVehicleForm {
  const affiliation = view.data.carrierAffiliation
  return {
    code: view.code,
    name: view.data.name,
    plateNumber: view.data.plateNumber,
    vehicleType: view.data.vehicleType,
    carrierType: affiliation.type,
    carrierOperatingEntityId:
      affiliation.type === 'INTERNAL' ? affiliation.operatingEntityId : '',
    carrierOtherUnitObjectId:
      affiliation.type === 'EXTERNAL' ? affiliation.otherUnitObjectId : '',
    bulkLiquidCapable: view.data.bulkLiquidCapable,
    vin: view.data.vin ?? '',
    engineNumber: view.data.engineNumber ?? '',
    loadCapacityKg: view.data.loadCapacityKg ?? '',
    remark: view.data.remark ?? '',
  }
}

export function dclVehicleData(form: DclVehicleForm) {
  return {
    name: form.name.trim(),
    plateNumber: form.plateNumber.trim().toUpperCase(),
    vehicleType: form.vehicleType.trim(),
    carrierAffiliation:
      form.carrierType === 'INTERNAL'
        ? {
            type: 'INTERNAL' as const,
            operatingEntityId: form.carrierOperatingEntityId.trim(),
          }
        : {
            type: 'EXTERNAL' as const,
            otherUnitObjectId: form.carrierOtherUnitObjectId.trim(),
          },
    bulkLiquidCapable: form.bulkLiquidCapable,
    ...(form.vin.trim() ? { vin: form.vin.trim().toUpperCase() } : {}),
    ...(form.engineNumber.trim()
      ? { engineNumber: form.engineNumber.trim() }
      : {}),
    ...(form.loadCapacityKg.trim()
      ? { loadCapacityKg: form.loadCapacityKg.trim() }
      : {}),
    ...(form.remark.trim() ? { remark: form.remark.trim() } : {}),
  }
}

export const dclVehicleHistoryPort: DclDeclarationHistoryPort<
  DclVehicleListItem,
  import('./types').DclVehicleVersionView,
  import('./types').DclVehicleAuditEvent
> = {
  async loadVersions(item, page, pageSize, update) {
    const { data } = await apiClient.postContract('dcl/vehicle/versions', {
      objectId: item.objectId,
      page,
      pageSize,
    })
    update(data.items ?? [], data.total, data.page, data.pageSize)
  },
  async loadAudit(item, page, pageSize, update) {
    const { data } = await apiClient.postContract('dcl/vehicle/audit-history', {
      objectId: item.objectId,
      page,
      pageSize,
    })
    update(data.items ?? [], data.total, data.page, data.pageSize)
  },
}

import type { BusinessObjectSort } from '@/components/business-object'
import { apiClient, type ApiPostRequest } from '@/api/client'
import type {
  DclDeclarationHistoryPort,
  DclDeclarationLifecyclePort,
  DclDeclarationWireAction,
} from '../shared/declaration'
import type {
  DclWarehouseAuditEvent,
  DclWarehouseForm,
  DclWarehouseListItem,
  DclWarehouseVersionView,
  DclWarehouseView,
} from './types'
import { dclWarehouseActiveVersion } from './types'

type WarehouseVersionRequest = ApiPostRequest<'dcl/warehouse/submit'>

export async function queryDclWarehouses(request: {
  page: number
  pageSize: number
  filters: Record<string, unknown>
  sort: BusinessObjectSort[]
}): Promise<{
  items: DclWarehouseListItem[]
  total: number
  page: number
  pageSize: number
}> {
  const { data } = await apiClient.postContract('dcl/warehouse/query', request)
  return {
    items: data.items ?? [],
    total: data.total,
    page: data.page,
    pageSize: data.pageSize,
  }
}

export async function getDclWarehouse(
  objectId: string,
  approvalEntryId?: string,
): Promise<DclWarehouseView> {
  const { data } = await apiClient.postContract('dcl/warehouse/get', {
    objectId,
    ...(approvalEntryId ? { approvalEntryId } : {}),
  })
  return data
}

export async function runDclWarehouseLifecycle(
  item: DclWarehouseListItem,
  action: DclDeclarationWireAction,
  reason: string,
): Promise<void> {
  const approval = dclWarehouseActiveVersion(item).approval
  const request: WarehouseVersionRequest = {
    objectId: item.objectId,
    approvalEntryId: approval.approvalEntryId,
    approvalRevision: approval.revision,
  }
  return runDclWarehouseAction(action, request, reason)
}

export async function runDclWarehouseAction(
  action: DclDeclarationWireAction,
  request: WarehouseVersionRequest,
  reason: string,
): Promise<void> {
  if (action === 'submit') {
    await apiClient.postContract('dcl/warehouse/submit', request)
  } else if (action === 'approve') {
    await apiClient.postContract('dcl/warehouse/approve', request)
  } else if (action === 'unsubmit') {
    await apiClient.postContract('dcl/warehouse/unsubmit', request)
  } else if (action === 'reject') {
    await apiClient.postContract('dcl/warehouse/reject', { ...request, reason })
  } else {
    await apiClient.postContract('dcl/warehouse/unapprove', {
      ...request,
      reason,
    })
  }
}

async function changeDclWarehouseEnabled(
  item: DclWarehouseListItem,
): Promise<void> {
  const approved = item.latestApproved
  if (!approved) throw new Error('没有可用于变更启停状态的已批准版本。')
  const view = await getDclWarehouse(
    item.objectId,
    approved.approval.approvalEntryId,
  )
  await apiClient.postContract('dcl/warehouse/save', {
    objectId: item.objectId,
    approvalEntryId: view.approval.approvalEntryId,
    approvalRevision: view.approval.revision,
    enabled: !item.enabled,
    data: view.data,
  })
}

export const dclWarehouseLifecyclePort: DclDeclarationLifecyclePort<DclWarehouseListItem> =
  {
    run: runDclWarehouseLifecycle,
    changeEnabled: changeDclWarehouseEnabled,
  }

export const dclWarehouseHistoryPort: DclDeclarationHistoryPort<
  DclWarehouseListItem,
  DclWarehouseVersionView,
  DclWarehouseAuditEvent
> = {
  async loadVersions(item, page, pageSize, update): Promise<void> {
    const { data } = await apiClient.postContract('dcl/warehouse/versions', {
      objectId: item.objectId,
      page,
      pageSize,
    })
    update(data.items ?? [], data.total, data.page, data.pageSize)
  },
  async loadAudit(item, page, pageSize, update): Promise<void> {
    const { data } = await apiClient.postContract(
      'dcl/warehouse/audit-history',
      {
        objectId: item.objectId,
        page,
        pageSize,
      },
    )
    update(data.items ?? [], data.total, data.page, data.pageSize)
  },
}

export function dclWarehouseFormFromView(
  view: DclWarehouseView,
): DclWarehouseForm {
  return {
    code: view.code,
    name: view.data.name,
    managerEmployeeId: view.data.managerEmployeeId ?? '',
    contactName: view.data.contactName ?? '',
    address: view.data.address ?? '',
    contactPhone: view.data.contactPhone ?? '',
    remark: view.data.remark ?? '',
  }
}

export function dclWarehouseData(data: Record<string, unknown>) {
  const optional = (key: string): string | undefined => {
    const value = data[key]
    return typeof value === 'string' && value !== '' ? value : undefined
  }
  return {
    name: String(data.name ?? ''),
    managerEmployeeId: optional('managerEmployeeId'),
    contactName: optional('contactName'),
    address: optional('address'),
    contactPhone: optional('contactPhone'),
    remark: optional('remark'),
  }
}

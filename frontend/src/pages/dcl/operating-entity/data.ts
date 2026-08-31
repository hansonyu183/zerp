import type { BusinessObjectSort } from '@/components/business-object'
import { apiClient, type ApiPostRequest } from '@/api/client'
import type {
  DclDeclarationHistoryPort,
  DclDeclarationLifecyclePort,
  DclDeclarationWireAction,
} from '../shared/declaration'
import type {
  DclOperatingEntityAuditEvent,
  DclOperatingEntityForm,
  DclOperatingEntityListItem,
  DclOperatingEntityVersionView,
  DclOperatingEntityView,
} from './types'
import { dclOperatingEntityActiveVersion } from './types'

type OperatingEntityVersionRequest =
  ApiPostRequest<'dcl/operating-entity/submit'>

export async function queryDclOperatingEntities(request: {
  page: number
  pageSize: number
  filters: Record<string, unknown>
  sort: BusinessObjectSort[]
}): Promise<{
  items: DclOperatingEntityListItem[]
  total: number
  page: number
  pageSize: number
}> {
  const { data } = await apiClient.postContract(
    'dcl/operating-entity/query',
    request,
  )
  return {
    items: data.items ?? [],
    total: data.total,
    page: data.page,
    pageSize: data.pageSize,
  }
}

export async function getDclOperatingEntity(
  objectId: string,
  approvalEntryId?: string,
): Promise<DclOperatingEntityView> {
  const { data } = await apiClient.postContract('dcl/operating-entity/get', {
    objectId,
    ...(approvalEntryId ? { approvalEntryId } : {}),
  })
  return data
}

export async function runDclOperatingEntityLifecycle(
  item: DclOperatingEntityListItem,
  action: DclDeclarationWireAction,
  reason: string,
): Promise<void> {
  const approval = dclOperatingEntityActiveVersion(item).approval
  const request: OperatingEntityVersionRequest = {
    objectId: item.objectId,
    approvalEntryId: approval.approvalEntryId,
    approvalRevision: approval.revision,
  }
  return runDclOperatingEntityAction(action, request, reason)
}

export async function runDclOperatingEntityAction(
  action: DclDeclarationWireAction,
  request: OperatingEntityVersionRequest,
  reason: string,
): Promise<void> {
  if (action === 'submit') {
    await apiClient.postContract('dcl/operating-entity/submit', request)
  } else if (action === 'approve') {
    await apiClient.postContract('dcl/operating-entity/approve', request)
  } else if (action === 'unsubmit') {
    await apiClient.postContract('dcl/operating-entity/unsubmit', request)
  } else if (action === 'reject') {
    await apiClient.postContract('dcl/operating-entity/reject', {
      ...request,
      reason,
    })
  } else {
    await apiClient.postContract('dcl/operating-entity/unapprove', {
      ...request,
      reason,
    })
  }
}

async function changeDclOperatingEntityEnabled(
  item: DclOperatingEntityListItem,
): Promise<void> {
  const approved = item.latestApproved
  if (!approved) throw new Error('没有可用于变更启停状态的已批准版本。')
  const view = await getDclOperatingEntity(
    item.objectId,
    approved.approval.approvalEntryId,
  )
  await apiClient.postContract('dcl/operating-entity/save', {
    objectId: item.objectId,
    approvalEntryId: view.approval.approvalEntryId,
    approvalRevision: view.approval.revision,
    enabled: !item.enabled,
    data: view.data,
  })
}

export const dclOperatingEntityLifecyclePort: DclDeclarationLifecyclePort<DclOperatingEntityListItem> =
  {
    run: runDclOperatingEntityLifecycle,
    changeEnabled: changeDclOperatingEntityEnabled,
  }

export const dclOperatingEntityHistoryPort: DclDeclarationHistoryPort<
  DclOperatingEntityListItem,
  DclOperatingEntityVersionView,
  DclOperatingEntityAuditEvent
> = {
  async loadVersions(item, page, pageSize, update): Promise<void> {
    const { data } = await apiClient.postContract(
      'dcl/operating-entity/versions',
      { objectId: item.objectId, page, pageSize },
    )
    update(data.items ?? [], data.total, data.page, data.pageSize)
  },
  async loadAudit(item, page, pageSize, update): Promise<void> {
    const { data } = await apiClient.postContract(
      'dcl/operating-entity/audit-history',
      { objectId: item.objectId, page, pageSize },
    )
    update(data.items ?? [], data.total, data.page, data.pageSize)
  },
}

export function dclOperatingEntityFormFromView(
  view: DclOperatingEntityView,
): DclOperatingEntityForm {
  return {
    code: view.code,
    name: view.data.name,
    shortName: view.data.shortName ?? '',
    taxNumber: view.data.taxNumber ?? '',
    address: view.data.address ?? '',
    phone: view.data.phone ?? '',
    remark: view.data.remark ?? '',
  }
}

export function dclOperatingEntityData(data: Record<string, unknown>) {
  const optional = (key: string): string | undefined => {
    const value = data[key]
    return typeof value === 'string' && value !== '' ? value : undefined
  }
  return {
    name: String(data.name ?? ''),
    shortName: optional('shortName'),
    taxNumber: optional('taxNumber'),
    address: optional('address'),
    phone: optional('phone'),
    remark: optional('remark'),
  }
}

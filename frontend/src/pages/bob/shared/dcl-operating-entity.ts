import type { BusinessObjectSort } from '@/components/business-object'
import { apiClient } from '@/api/client'
import type { BobListItem, BobObjectView } from './types'

export async function queryDclOperatingEntities(request: {
  page: number
  pageSize: number
  filters: Record<string, unknown>
  sort: BusinessObjectSort[]
}): Promise<{
  items: BobListItem[]
  total: number
  page: number
  pageSize: number
}> {
  const { data } = await apiClient.postContract(
    'dcl/operating-entity/query',
    request,
  )
  return {
    items: (data.items ?? []).map((item) => ({
      objectId: item.objectId,
      entity: item.entity,
      code: item.code,
      objectRevision: item.objectRevision,
      enabled: item.enabled,
      latestApproved: item.latestApproved
        ? {
            approval: item.latestApproved.approval,
            summary: item.latestApproved.data,
          }
        : null,
      openVersion: item.openVersion
        ? {
            approval: item.openVersion.approval,
            summary: item.openVersion.data,
          }
        : null,
      updatedAt: item.updatedAt,
    })),
    total: data.total,
    page: data.page,
    pageSize: data.pageSize,
  }
}

export async function getDclOperatingEntity(
  objectId: string,
  approvalEntryId?: string,
): Promise<BobObjectView> {
  const { data } = await apiClient.postContract('dcl/operating-entity/get', {
    objectId,
    ...(approvalEntryId ? { approvalEntryId } : {}),
  })
  return {
    objectId: data.objectId,
    entity: data.entity,
    code: data.code,
    objectRevision: data.objectRevision,
    enabled: data.enabled,
    approval: data.approval,
    data: data.data,
    updatedAt: data.updatedAt,
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

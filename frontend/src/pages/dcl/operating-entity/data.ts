import type { BusinessObjectSort } from '@/components/business-object'
import { apiClient } from '@/api/client'
import type {
  DclOperatingEntityForm,
  DclOperatingEntityListItem,
  DclOperatingEntityView,
} from './types'

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

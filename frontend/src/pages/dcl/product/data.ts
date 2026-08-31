import type { BusinessObjectSort } from '@/components/business-object'
import { apiClient, type ApiPostRequest } from '@/api/client'
import { type components } from '@/api/generated/schema'
import type {
  DclDeclarationHistoryPort,
  DclDeclarationLifecyclePort,
  DclDeclarationWireAction,
} from '../shared/declaration'
import { dclProductConfig } from './config'
import { dclProductFormFields, dclProductInput } from './product-data'
import { dclProductActiveVersion } from './types'
import type {
  DclProductAuditEvent,
  DclProductForm,
  DclProductInput,
  DclProductListItem,
  DclProductVersionView,
  DclProductView,
} from './types'

type ProductVersionRequest = ApiPostRequest<'dcl/product/submit'>

function listItem(
  item: components['schemas']['DclProductListItem'],
): DclProductListItem {
  const version = (
    value: components['schemas']['DclProductVersionView'] | null,
  ): NonNullable<DclProductListItem['openVersion']> | null =>
    value
      ? {
          approval: value.approval,
          summary: { ...value.data } as never,
          enabled: value.enabled,
        }
      : null
  return {
    ...item,
    latestApproved: version(item.latestApproved),
    openVersion: version(item.openVersion),
  } as unknown as DclProductListItem
}

function productView(
  value: components['schemas']['DclProductView'],
): DclProductView {
  return {
    ...value,
    data: { ...value.data } as DclProductView['data'],
  } as unknown as DclProductView
}

export async function queryDclProducts(request: {
  page: number
  pageSize: number
  filters: Record<string, unknown>
  sort: BusinessObjectSort[]
}): Promise<{
  items: DclProductListItem[]
  total: number
  page: number
  pageSize: number
}> {
  const { data } = await apiClient.postContract('dcl/product/query', request)
  return {
    items: (data.items ?? []).map(listItem),
    total: data.total,
    page: data.page,
    pageSize: data.pageSize,
  }
}

export async function getDclProduct(
  objectId: string,
  approvalEntryId?: string,
): Promise<DclProductView> {
  const { data } = await apiClient.postContract('dcl/product/get', {
    objectId,
    ...(approvalEntryId ? { approvalEntryId } : {}),
  })
  return productView(data)
}

export function dclProductFormFromView(view: DclProductView): DclProductForm {
  const form = dclProductConfig.emptyForm()
  form.code = view.code
  form.objectId = view.objectId
  form.approvalEntryId = view.approval.approvalEntryId
  const detail = Object.fromEntries(Object.entries(view.data))
  for (const key of dclProductConfig.detailKeys)
    form[key] = detail[key] ?? form[key] ?? ''
  Object.assign(form, dclProductFormFields(view.data))
  form.formulaDirty = false
  return form
}

function typedProductData(form: DclProductForm): DclProductInput {
  return dclProductInput(form, 'create')
}

export function dclProductCreateData(form: DclProductForm): DclProductInput {
  return typedProductData(form)
}

export function dclProductSaveData(form: DclProductForm): DclProductInput {
  return dclProductInput(form, 'save')
}

export async function runDclProductLifecycle(
  item: DclProductListItem,
  action: DclDeclarationWireAction,
  reason: string,
): Promise<void> {
  const approval = dclProductActiveVersion(item).approval
  return runDclProductAction(
    action,
    {
      objectId: item.objectId,
      approvalEntryId: approval.approvalEntryId,
      approvalRevision: approval.revision,
    },
    reason,
  )
}

export async function runDclProductAction(
  action: DclDeclarationWireAction,
  request: ProductVersionRequest,
  reason: string,
): Promise<void> {
  if (action === 'reject' || action === 'unapprove') {
    await apiClient.postContract(`dcl/product/${action}`, {
      ...request,
      reason,
    })
  } else await apiClient.postContract(`dcl/product/${action}`, request)
}

export async function createDclProduct(data: DclProductInput): Promise<void> {
  await apiClient.postContract('dcl/product/create', { data })
}

export async function saveDclProduct(request: {
  objectId: string
  approvalEntryId: string
  approvalRevision: number
  enabled: boolean
  data: DclProductInput
}): Promise<void> {
  await apiClient.postContract('dcl/product/save', request)
}

export async function deleteDclProduct(
  item: DclProductListItem,
): Promise<void> {
  const approval = dclProductActiveVersion(item).approval
  await apiClient.postContract('dcl/product/delete', {
    objectId: item.objectId,
    approvalEntryId: approval.approvalEntryId,
    approvalRevision: approval.revision,
  })
}

export const dclProductLifecyclePort: DclDeclarationLifecyclePort<DclProductListItem> =
  {
    run: runDclProductLifecycle,
    async changeEnabled(item) {
      const view = await getDclProduct(
        item.objectId,
        item.latestApproved?.approval.approvalEntryId,
      )
      await saveDclProduct({
        objectId: view.objectId,
        approvalEntryId: view.approval.approvalEntryId,
        approvalRevision: view.approval.revision,
        enabled: !item.enabled,
        data: dclProductSaveData(dclProductFormFromView(view)),
      })
    },
  }

export const dclProductHistoryPort: DclDeclarationHistoryPort<
  DclProductListItem,
  DclProductVersionView,
  DclProductAuditEvent
> = {
  async loadVersions(item, page, pageSize, update) {
    const { data } = await apiClient.postContract('dcl/product/versions', {
      objectId: item.objectId,
      page,
      pageSize,
    })
    update(
      (data.items ?? []).map((item) => ({
        ...item.approval,
        summary: { ...item.data },
      })),
      data.total,
      data.page,
      data.pageSize,
    )
  },
  async loadAudit(item, page, pageSize, update) {
    const { data } = await apiClient.postContract('dcl/product/audit-history', {
      objectId: item.objectId,
      page,
      pageSize,
    })
    update(data.items ?? [], data.total, data.page, data.pageSize)
  },
}

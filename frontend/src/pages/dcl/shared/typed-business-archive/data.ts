import type { BusinessObjectSort } from '@/components/business-object'
import { apiClient } from '@/api/client'
import type { components } from '@/api/generated/schema'
import type {
  DclDeclarationHistoryPort,
  DclDeclarationLifecyclePort,
  DclDeclarationWireAction,
} from '../declaration'
import {
  dclTypedArchiveActiveVersion,
  type DclTypedArchiveAuditEvent,
  type DclTypedArchiveEntity,
  type DclTypedArchiveForm,
  type DclTypedArchiveListItem,
  type DclTypedArchiveReferenceOption,
  type DclTypedArchiveVersionView,
  type DclTypedArchiveView,
} from './types'
const optional = (value: string): string | null => value.trim() || null
type OtherUnitInput = components['schemas']['DclOtherUnitInput']
type SalesPartnerInput = components['schemas']['DclSalesPartnerInput']
type ApprovalStatus = components['schemas']['ApprovalVersionMeta']['status']
export function dclTypedArchiveData(
  entity: DclTypedArchiveEntity,
  form: DclTypedArchiveForm,
): OtherUnitInput | SalesPartnerInput {
  const common = {
    kind: form.kind,
    legalName: form.legalName.trim(),
    ...(form.displayName.trim()
      ? { displayName: form.displayName.trim() }
      : {}),
    legalIdentifier: form.legalIdentifier.trim(),
    enabled: form.enabled,
    operatingEntityIds: form.operatingEntityIds,
    defaultOperatingEntityId: form.defaultOperatingEntityId,
    contactName: optional(form.contactName),
    contactPhone: optional(form.contactPhone),
    email: optional(form.email),
    address: optional(form.address),
    remark: optional(form.remark),
  }
  return entity === 'other-unit'
    ? { ...common, settlementMethodId: optional(form.settlementMethodId) }
    : { ...common, capabilities: form.capabilities }
}
export async function queryDclTypedArchives(
  entity: DclTypedArchiveEntity,
  request: {
    page: number
    pageSize: number
    filters: Record<string, unknown>
    sort: BusinessObjectSort[]
  },
) {
  const filters = {
    ...(typeof request.filters.keyword === 'string' && request.filters.keyword
      ? { keyword: request.filters.keyword }
      : {}),
    ...(Array.isArray(request.filters.status)
      ? {
          status: request.filters.status.filter(
            (value): value is ApprovalStatus =>
              value === 'DRAFT' || value === 'PENDING' || value === 'APPROVED',
          ),
        }
      : {}),
    ...(typeof request.filters.enabled === 'boolean'
      ? { enabled: request.filters.enabled }
      : {}),
  }
  const { data } =
    entity === 'other-unit'
      ? await apiClient.postContract('dcl/other-unit/query', {
          page: request.page,
          pageSize: 20,
          filters,
        })
      : await apiClient.postContract('dcl/sales-partner/query', {
          page: request.page,
          pageSize: 20,
          filters,
        })
  return data
}
export async function getDclTypedArchive(
  entity: DclTypedArchiveEntity,
  objectId: string,
  approvalEntryId?: string,
): Promise<DclTypedArchiveView> {
  const request = { objectId, ...(approvalEntryId ? { approvalEntryId } : {}) }
  const { data } =
    entity === 'other-unit'
      ? await apiClient.postContract('dcl/other-unit/get', request)
      : await apiClient.postContract('dcl/sales-partner/get', request)
  if (!data) throw new Error('业务档案变更不存在。')
  return data
}
export function dclTypedArchiveFormFromView(
  entity: DclTypedArchiveEntity,
  view: DclTypedArchiveView,
): DclTypedArchiveForm {
  const data = view.data
  return {
    code: view.code,
    kind: data.kind,
    legalName: data.legalName,
    displayName: data.displayName ?? '',
    legalIdentifier: data.legalIdentifier ?? '',
    enabled: data.enabled,
    operatingEntityIds: data.operatingEntityIds,
    defaultOperatingEntityId: data.defaultOperatingEntityId,
    contactName: data.contactName ?? '',
    contactPhone: data.contactPhone ?? '',
    email: data.email ?? '',
    address: data.address ?? '',
    settlementMethodId:
      entity === 'other-unit'
        ? ((data as OtherUnitInput).settlementMethodId ?? '')
        : '',
    capabilities:
      entity === 'sales-partner'
        ? [...((data as SalesPartnerInput).capabilities ?? [])]
        : [],
    remark: data.remark ?? '',
  }
}
export async function createDclTypedArchive(
  entity: DclTypedArchiveEntity,
  form: DclTypedArchiveForm,
) {
  const data = dclTypedArchiveData(entity, form)
  if (entity === 'other-unit')
    await apiClient.postContract('dcl/other-unit/create', {
      data: data as OtherUnitInput,
    })
  else
    await apiClient.postContract('dcl/sales-partner/create', {
      data: data as SalesPartnerInput,
    })
}
export async function saveDclTypedArchive(
  entity: DclTypedArchiveEntity,
  request: {
    objectId: string
    approvalEntryId: string
    approvalRevision: number
    data: OtherUnitInput | SalesPartnerInput
  },
) {
  if (entity === 'other-unit')
    await apiClient.postContract('dcl/other-unit/save', {
      ...request,
      data: request.data as OtherUnitInput,
    })
  else
    await apiClient.postContract('dcl/sales-partner/save', {
      ...request,
      data: request.data as SalesPartnerInput,
    })
}
export async function runDclTypedArchiveAction(
  entity: DclTypedArchiveEntity,
  action: DclDeclarationWireAction,
  request: {
    objectId: string
    approvalEntryId: string
    approvalRevision: number
  },
  reason: string,
) {
  if (entity === 'other-unit') {
    if (action === 'submit')
      await apiClient.postContract('dcl/other-unit/submit', request)
    else if (action === 'unsubmit')
      await apiClient.postContract('dcl/other-unit/unsubmit', request)
    else if (action === 'approve')
      await apiClient.postContract('dcl/other-unit/approve', request)
    else if (action === 'reject')
      await apiClient.postContract('dcl/other-unit/reject', {
        ...request,
        reason,
      })
    else
      await apiClient.postContract('dcl/other-unit/unapprove', {
        ...request,
        reason,
      })
    return
  }
  if (action === 'submit')
    await apiClient.postContract('dcl/sales-partner/submit', request)
  else if (action === 'unsubmit')
    await apiClient.postContract('dcl/sales-partner/unsubmit', request)
  else if (action === 'approve')
    await apiClient.postContract('dcl/sales-partner/approve', request)
  else if (action === 'reject')
    await apiClient.postContract('dcl/sales-partner/reject', {
      ...request,
      reason,
    })
  else
    await apiClient.postContract('dcl/sales-partner/unapprove', {
      ...request,
      reason,
    })
}
export function dclTypedArchiveLifecyclePort(
  entity: DclTypedArchiveEntity,
): DclDeclarationLifecyclePort<DclTypedArchiveListItem> {
  return {
    async run(item, action, reason) {
      const approval = dclTypedArchiveActiveVersion(item).approval
      await runDclTypedArchiveAction(
        entity,
        action,
        {
          objectId: item.objectId,
          approvalEntryId: approval.approvalEntryId,
          approvalRevision: approval.revision,
        },
        reason,
      )
    },
    async changeEnabled(item) {
      const view = await getDclTypedArchive(
        entity,
        item.objectId,
        item.latestApproved?.approval.approvalEntryId,
      )
      const form = dclTypedArchiveFormFromView(entity, view)
      form.enabled = !view.data.enabled
      await saveDclTypedArchive(entity, {
        objectId: view.objectId,
        approvalEntryId: view.approval.approvalEntryId,
        approvalRevision: view.approval.revision,
        data: dclTypedArchiveData(entity, form),
      })
    },
  }
}
export async function deleteDclTypedArchive(
  entity: DclTypedArchiveEntity,
  item: DclTypedArchiveListItem,
) {
  const approval = dclTypedArchiveActiveVersion(item).approval
  await apiClient.postContract(
    entity === 'other-unit'
      ? 'dcl/other-unit/delete'
      : 'dcl/sales-partner/delete',
    {
      objectId: item.objectId,
      approvalEntryId: approval.approvalEntryId,
      approvalRevision: approval.revision,
    },
  )
}
export function dclTypedArchiveHistoryPort(
  entity: DclTypedArchiveEntity,
): DclDeclarationHistoryPort<
  DclTypedArchiveListItem,
  DclTypedArchiveVersionView,
  DclTypedArchiveAuditEvent
> {
  return {
    async loadVersions(item, page, pageSize, update) {
      const { data } = await apiClient.postContract(
        entity === 'other-unit'
          ? 'dcl/other-unit/versions'
          : 'dcl/sales-partner/versions',
        { objectId: item.objectId, page, pageSize },
      )
      update(data.items, data.total, data.page, data.pageSize)
    },
    async loadAudit(item, page, pageSize, update) {
      const { data } = await apiClient.postContract(
        entity === 'other-unit'
          ? 'dcl/other-unit/audit-history'
          : 'dcl/sales-partner/audit-history',
        { objectId: item.objectId, page, pageSize },
      )
      update(data.items, data.total, data.page, data.pageSize)
    },
  }
}
export async function queryTypedArchiveReference(
  entity: 'operating-entity' | 'settlement-method',
  keyword: string,
): Promise<DclTypedArchiveReferenceOption[]> {
  if (entity === 'operating-entity') {
    const { data } = await apiClient.postContract(
      'bob/operating-entity/query',
      {
        page: 1,
        pageSize: 20,
        filters: { enabled: true, ...(keyword ? { keyword } : {}) },
        sort: [{ field: 'code', order: 'asc' }],
      },
    )
    return data.items.map((item) => ({
      value: item.objectId,
      title: `${item.code} · ${item.data.name ?? ''}`,
    }))
  }
  const { data } = await apiClient.postContract('aux/reference/query', {
    entity,
    ...(keyword ? { keyword } : {}),
  })
  return data.map((item) => ({
    value: item.objectId,
    title: `${item.code} · ${item.name}`,
  }))
}

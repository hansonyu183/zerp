import type { BusinessObjectSort } from '@/components/business-object'
import { apiClient } from '@/api/client'
import type {
  DclDeclarationHistoryPort,
  DclDeclarationLifecyclePort,
  DclDeclarationWireAction,
} from '../shared/declaration'
import { dclSupplierActiveVersion } from './types'
import type {
  DclSupplierAuditEvent,
  DclSupplierForm,
  DclSupplierListItem,
  DclSupplierReferenceOption,
  DclSupplierVersionView,
  DclSupplierView,
} from './types'

const optional = (value: string): string | null => value.trim() || null

export function dclSupplierData(form: DclSupplierForm) {
  return {
    shortName: optional(form.shortName),
    taxNumber: optional(form.taxNumber),
    contactName: optional(form.contactName),
    contactPhone: optional(form.contactPhone),
    email: optional(form.email),
    address: optional(form.address),
    remark: optional(form.remark),
    settlementMethodId: optional(form.settlementMethodId),
    defaultPurchaserEmployeeId: optional(form.defaultPurchaserEmployeeId),
  }
}

export async function queryDclSuppliers(request: {
  page: number
  pageSize: number
  filters: Record<string, unknown>
  sort: BusinessObjectSort[]
}) {
  const filters = request.filters
  const { data } = await apiClient.postContract('dcl/supplier/query', {
    page: request.page,
    pageSize: 20,
    filters: {
      ...(typeof filters.keyword === 'string' && filters.keyword
        ? { keyword: filters.keyword }
        : {}),
      ...(Array.isArray(filters.status)
        ? { status: filters.status.map(String) }
        : {}),
      ...(typeof filters.enabled === 'boolean'
        ? { enabled: filters.enabled }
        : {}),
    },
    sort: [{ field: 'code', order: 'asc' }],
  })
  return data
}

export async function getDclSupplier(
  objectId: string,
  approvalEntryId?: string,
): Promise<DclSupplierView> {
  const { data } = await apiClient.postContract('dcl/supplier/get', {
    objectId,
    ...(approvalEntryId ? { approvalEntryId } : {}),
  })
  if (!data) throw new Error('供应商申报不存在。')
  return data
}

export function dclSupplierFormFromView(
  view: DclSupplierView,
): DclSupplierForm {
  return {
    code: view.code,
    partyDisplayName: view.partyDisplayName,
    partyMode: 'EXISTING',
    partyId: view.partyId,
    partyKind: view.partyKind,
    legalName: '',
    displayName: view.partyDisplayName,
    partyTaxNumber: '',
    taxNumber: view.data.taxNumber ?? '',
    identifierType: 'UNIFIED_SOCIAL_CREDIT_CODE',
    identifierValue: '',
    operatingEntityId: view.operatingEntityId,
    shortName: view.data.shortName ?? '',
    contactName: view.data.contactName ?? '',
    contactPhone: view.data.contactPhone ?? '',
    email: view.data.email ?? '',
    address: view.data.address ?? '',
    remark: view.data.remark ?? '',
    settlementMethodId: view.data.settlementMethodId ?? '',
    defaultPurchaserEmployeeId: view.data.defaultPurchaserEmployeeId ?? '',
  }
}

export async function createDclSupplier(form: DclSupplierForm): Promise<void> {
  const party =
    form.partyMode === 'EXISTING'
      ? { partyId: form.partyId.trim() }
      : {
          newParty: {
            kind: form.partyKind,
            legalName: form.legalName.trim(),
            ...(form.displayName.trim()
              ? { displayName: form.displayName.trim() }
              : {}),
            ...(form.partyTaxNumber.trim()
              ? { taxNumber: form.partyTaxNumber.trim() }
              : {}),
            strongIdentifiers: form.identifierValue.trim()
              ? [
                  {
                    type: form.identifierType,
                    value: form.identifierValue.trim(),
                  },
                ]
              : [],
          },
        }
  await apiClient.postContract('dcl/supplier/create', {
    ...party,
    operatingEntityId: form.operatingEntityId.trim(),
    data: dclSupplierData(form),
  })
}

export async function saveDclSupplier(request: {
  objectId: string
  approvalEntryId: string
  approvalRevision: number
  enabled: boolean
  data: ReturnType<typeof dclSupplierData>
}): Promise<void> {
  await apiClient.postContract('dcl/supplier/save', request)
}

async function lifecycle(
  item: DclSupplierListItem,
  action: DclDeclarationWireAction,
  reason: string,
): Promise<void> {
  const approval = dclSupplierActiveVersion(item).approval
  const request = {
    objectId: item.objectId,
    approvalEntryId: approval.approvalEntryId,
    approvalRevision: approval.revision,
  }
  await runDclSupplierAction(action, request, reason)
}

export async function runDclSupplierAction(
  action: DclDeclarationWireAction,
  request: {
    objectId: string
    approvalEntryId: string
    approvalRevision: number
  },
  reason: string,
): Promise<void> {
  if (action === 'submit')
    await apiClient.postContract('dcl/supplier/submit', request)
  else if (action === 'unsubmit')
    await apiClient.postContract('dcl/supplier/unsubmit', request)
  else if (action === 'approve')
    await apiClient.postContract('dcl/supplier/approve', request)
  else if (action === 'reject')
    await apiClient.postContract('dcl/supplier/reject', { ...request, reason })
  else
    await apiClient.postContract('dcl/supplier/unapprove', {
      ...request,
      reason,
    })
}

export const dclSupplierLifecyclePort: DclDeclarationLifecyclePort<DclSupplierListItem> =
  {
    run: lifecycle,
    async changeEnabled(item) {
      const view = await getDclSupplier(
        item.objectId,
        item.latestApproved?.approval.approvalEntryId,
      )
      await saveDclSupplier({
        objectId: view.objectId,
        approvalEntryId: view.approval.approvalEntryId,
        approvalRevision: view.approval.revision,
        enabled: !item.enabled,
        data: {
          shortName: view.data.shortName ?? null,
          taxNumber: view.data.taxNumber ?? null,
          contactName: view.data.contactName ?? null,
          contactPhone: view.data.contactPhone ?? null,
          email: view.data.email ?? null,
          address: view.data.address ?? null,
          remark: view.data.remark ?? null,
          settlementMethodId: view.data.settlementMethodId ?? null,
          defaultPurchaserEmployeeId:
            view.data.defaultPurchaserEmployeeId ?? null,
        },
      })
    },
  }

export async function deleteDclSupplier(
  item: DclSupplierListItem,
): Promise<void> {
  const approval = dclSupplierActiveVersion(item).approval
  await apiClient.postContract('dcl/supplier/delete', {
    objectId: item.objectId,
    approvalEntryId: approval.approvalEntryId,
    approvalRevision: approval.revision,
  })
}

export const dclSupplierHistoryPort: DclDeclarationHistoryPort<
  DclSupplierListItem,
  DclSupplierVersionView,
  DclSupplierAuditEvent
> = {
  async loadVersions(item, page, pageSize, update) {
    const { data } = await apiClient.postContract('dcl/supplier/versions', {
      objectId: item.objectId,
      page,
      pageSize,
    })
    update(data.items, data.total, data.page, data.pageSize)
  },
  async loadAudit(item, page, pageSize, update) {
    const { data } = await apiClient.postContract(
      'dcl/supplier/audit-history',
      { objectId: item.objectId, page, pageSize },
    )
    update(data.items, data.total, data.page, data.pageSize)
  },
}

export async function querySupplierReference(
  entity: 'operating-entity' | 'settlement-method' | 'employee',
  keyword: string,
): Promise<DclSupplierReferenceOption[]> {
  if (entity === 'operating-entity') {
    const { data } = await apiClient.postContract(
      'bob/operating-entity/query',
      {
        page: 1,
        pageSize: 20,
        filters: {
          status: ['APPROVED'],
          enabled: true,
          ...(keyword ? { keyword } : {}),
        },
        sort: [{ field: 'code', order: 'asc' }],
      },
    )
    return data.items.map((item) => ({
      value: item.objectId,
      title: `${item.code} · ${item.data.name ?? ''}`,
    }))
  }
  if (entity === 'settlement-method') {
    const { data } = await apiClient.postContract('aux/reference/query', {
      entity: 'settlement-method',
      ...(keyword ? { keyword } : {}),
    })
    return data.map((item) => ({
      value: item.objectId,
      title: `${item.code} · ${item.name}`,
    }))
  }
  const { data } = await apiClient.postContract('bob/reference/query', {
    entity: 'employee',
    ...(keyword ? { keyword } : {}),
  })
  return data.map((item) => ({
    value: item.objectId,
    title: `${item.code} · ${item.name}`,
  }))
}

export async function querySupplierParties(
  keyword: string,
): Promise<DclSupplierReferenceOption[]> {
  const { data } = await apiClient.postContract('bob/party/query', {
    page: 1,
    pageSize: 20,
    filters: keyword ? { keyword } : {},
  })
  return data.items.map((item) => ({
    value: item.partyId,
    title: item.displayName,
  }))
}

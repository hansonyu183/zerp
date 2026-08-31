import type { BusinessObjectSort } from '@/components/business-object'
import { apiClient } from '@/api/client'
import type { components } from '@/api/generated/schema'
import type {
  DclDeclarationHistoryPort,
  DclDeclarationLifecyclePort,
  DclDeclarationWireAction,
} from '../shared/declaration'
import { dclRelationshipActiveVersion } from './types'
import type {
  DclRelationshipAuditEvent,
  DclRelationshipEntity,
  DclRelationshipForm,
  DclRelationshipListItem,
  DclRelationshipReferenceOption,
  DclRelationshipVersionView,
  DclRelationshipView,
} from './types'

type OtherUnitInput = components['schemas']['DclOtherUnitInput']
type SalesPartnerInput = components['schemas']['DclSalesPartnerInput']
type OtherUnitData = components['schemas']['DclOtherUnitData']
type SalesPartnerData = components['schemas']['DclSalesPartnerInput']
type ApprovalStatus = components['schemas']['ApprovalVersionMeta']['status']

const optional = (value: string): string | null => value.trim() || null

export function dclRelationshipData(
  entity: DclRelationshipEntity,
  form: DclRelationshipForm,
): OtherUnitInput | SalesPartnerInput {
  const common = {
    contactName: optional(form.contactName),
    contactPhone: optional(form.contactPhone),
    email: optional(form.email),
    address: optional(form.address),
    remark: optional(form.remark),
  }
  return entity === 'other-unit'
    ? { ...common, settlementMethodId: optional(form.settlementMethodId) }
    : { ...common, capabilities: [...form.capabilities] }
}

export async function queryDclRelationships(
  entity: DclRelationshipEntity,
  request: {
    page: number
    pageSize: number
    filters: Record<string, unknown>
    sort: BusinessObjectSort[]
  },
) {
  const statuses = Array.isArray(request.filters.status)
    ? request.filters.status.filter(
        (value): value is ApprovalStatus =>
          value === 'DRAFT' || value === 'PENDING' || value === 'APPROVED',
      )
    : undefined
  const filters = {
    ...(typeof request.filters.keyword === 'string' && request.filters.keyword
      ? { keyword: request.filters.keyword }
      : {}),
    ...(statuses ? { status: statuses } : {}),
    ...(typeof request.filters.enabled === 'boolean'
      ? { enabled: request.filters.enabled }
      : {}),
  }
  if (entity === 'other-unit') {
    const { data } = await apiClient.postContract('dcl/other-unit/query', {
      page: request.page,
      pageSize: 20,
      filters,
    })
    return data
  }
  const { data } = await apiClient.postContract('dcl/sales-partner/query', {
    page: request.page,
    pageSize: 20,
    filters,
  })
  return data
}

export async function getDclRelationship(
  entity: DclRelationshipEntity,
  objectId: string,
  approvalEntryId?: string,
): Promise<DclRelationshipView> {
  const request = {
    objectId,
    ...(approvalEntryId ? { approvalEntryId } : {}),
  }
  const response =
    entity === 'other-unit'
      ? await apiClient.postContract('dcl/other-unit/get', request)
      : await apiClient.postContract('dcl/sales-partner/get', request)
  if (!response.data) throw new Error('关系变更不存在。')
  return response.data
}

export function dclRelationshipFormFromView(
  entity: DclRelationshipEntity,
  view: DclRelationshipView,
): DclRelationshipForm {
  const common = {
    code: view.code,
    partyDisplayName: view.partyDisplayName,
    partyMode: 'EXISTING' as const,
    partyId: view.partyId,
    partyKind: view.partyKind,
    legalName: '',
    displayName: view.partyDisplayName,
    taxNumber: '',
    identifierType: 'UNIFIED_SOCIAL_CREDIT_CODE' as const,
    identifierValue: '',
    operatingEntityId: view.operatingEntityId,
    contactName: view.data.contactName ?? '',
    contactPhone: view.data.contactPhone ?? '',
    email: view.data.email ?? '',
    address: view.data.address ?? '',
    remark: view.data.remark ?? '',
  }
  if (entity === 'other-unit') {
    const data = view.data as OtherUnitData
    return {
      ...common,
      settlementMethodId: data.settlementMethodId ?? '',
      capabilities: [],
    }
  }
  const data = view.data as SalesPartnerData
  return {
    ...common,
    settlementMethodId: '',
    capabilities: [...(data.capabilities ?? [])],
  }
}

function createParty(form: DclRelationshipForm) {
  return form.partyMode === 'EXISTING'
    ? { partyId: form.partyId.trim() }
    : {
        newParty: {
          kind: form.partyKind,
          legalName: form.legalName.trim(),
          ...(form.displayName.trim()
            ? { displayName: form.displayName.trim() }
            : {}),
          ...(form.taxNumber.trim()
            ? { taxNumber: form.taxNumber.trim() }
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
}

export async function createDclRelationship(
  entity: DclRelationshipEntity,
  form: DclRelationshipForm,
): Promise<void> {
  const party = createParty(form)
  const operatingEntityId = form.operatingEntityId.trim()
  if (entity === 'other-unit') {
    await apiClient.postContract('dcl/other-unit/create', {
      ...party,
      operatingEntityId,
      data: dclRelationshipData(entity, form) as OtherUnitInput,
    })
  } else {
    await apiClient.postContract('dcl/sales-partner/create', {
      ...party,
      operatingEntityId,
      data: dclRelationshipData(entity, form) as SalesPartnerInput,
    })
  }
}

export async function saveDclRelationship(
  entity: DclRelationshipEntity,
  request: {
    objectId: string
    approvalEntryId: string
    approvalRevision: number
    enabled: boolean
    data: OtherUnitInput | SalesPartnerInput
  },
): Promise<void> {
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

export async function runDclRelationshipAction(
  entity: DclRelationshipEntity,
  action: DclDeclarationWireAction,
  request: {
    objectId: string
    approvalEntryId: string
    approvalRevision: number
  },
  reason: string,
): Promise<void> {
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

export function dclRelationshipLifecyclePort(
  entity: DclRelationshipEntity,
): DclDeclarationLifecyclePort<DclRelationshipListItem> {
  return {
    async run(item, action, reason) {
      const approval = dclRelationshipActiveVersion(item).approval
      await runDclRelationshipAction(
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
      const view = await getDclRelationship(
        entity,
        item.objectId,
        item.latestApproved?.approval.approvalEntryId,
      )
      const form = dclRelationshipFormFromView(entity, view)
      await saveDclRelationship(entity, {
        objectId: view.objectId,
        approvalEntryId: view.approval.approvalEntryId,
        approvalRevision: view.approval.revision,
        enabled: !item.enabled,
        data: dclRelationshipData(entity, form),
      })
    },
  }
}

export async function deleteDclRelationship(
  entity: DclRelationshipEntity,
  item: DclRelationshipListItem,
): Promise<void> {
  const approval = dclRelationshipActiveVersion(item).approval
  const request = {
    objectId: item.objectId,
    approvalEntryId: approval.approvalEntryId,
    approvalRevision: approval.revision,
  }
  if (entity === 'other-unit')
    await apiClient.postContract('dcl/other-unit/delete', request)
  else await apiClient.postContract('dcl/sales-partner/delete', request)
}

export function dclRelationshipHistoryPort(
  entity: DclRelationshipEntity,
): DclDeclarationHistoryPort<
  DclRelationshipListItem,
  DclRelationshipVersionView,
  DclRelationshipAuditEvent
> {
  return {
    async loadVersions(item, page, pageSize, update) {
      const request = { objectId: item.objectId, page, pageSize }
      const response =
        entity === 'other-unit'
          ? await apiClient.postContract('dcl/other-unit/versions', request)
          : await apiClient.postContract('dcl/sales-partner/versions', request)
      update(response.data.items, response.data.total, page, pageSize)
    },
    async loadAudit(item, page, pageSize, update) {
      const request = { objectId: item.objectId, page, pageSize }
      const response =
        entity === 'other-unit'
          ? await apiClient.postContract(
              'dcl/other-unit/audit-history',
              request,
            )
          : await apiClient.postContract(
              'dcl/sales-partner/audit-history',
              request,
            )
      update(response.data.items, response.data.total, page, pageSize)
    },
  }
}

export async function queryRelationshipReference(
  entity: 'operating-entity' | 'settlement-method',
  keyword: string,
): Promise<DclRelationshipReferenceOption[]> {
  if (entity === 'operating-entity') {
    const { data } = await apiClient.postContract(
      'bob/operating-entity/query',
      {
        page: 1,
        pageSize: 20,
        filters: {
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
  const { data } = await apiClient.postContract('aux/reference/query', {
    entity: 'settlement-method',
    ...(keyword ? { keyword } : {}),
  })
  return data.map((item) => ({
    value: item.objectId,
    title: `${item.code} · ${item.name}`,
  }))
}

export async function queryRelationshipParties(
  keyword: string,
): Promise<DclRelationshipReferenceOption[]> {
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

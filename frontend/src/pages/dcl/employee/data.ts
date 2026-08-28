import type { BusinessObjectSort } from '@/components/business-object'
import { apiClient } from '@/api/client'
import type {
  DclDeclarationHistoryPort,
  DclDeclarationLifecyclePort,
  DclDeclarationWireAction,
} from '../shared/declaration'
import { dclEmployeeActiveVersion } from './types'
import type {
  DclEmployeeAuditEvent,
  DclEmployeeForm,
  DclEmployeeListItem,
  DclEmployeeReferenceOption,
  DclEmployeeVersionView,
  DclEmployeeView,
} from './types'
import { formatReferenceLabel } from '@/utils/reference-label'

export async function queryDclEmployees(request: {
  page: number
  pageSize: number
  filters: Record<string, unknown>
  sort: BusinessObjectSort[]
}) {
  const { data } = await apiClient.postContract('dcl/employee/query', request)
  return data
}

export async function getDclEmployee(
  objectId: string,
  approvalEntryId?: string,
): Promise<DclEmployeeView> {
  const { data } = await apiClient.postContract('dcl/employee/get', {
    objectId,
    ...(approvalEntryId ? { approvalEntryId } : {}),
  })
  return data
}

export function dclEmployeeFormFromView(
  view: DclEmployeeView,
): DclEmployeeForm {
  return {
    code: view.code,
    partyDisplayName: view.partyDisplayName,
    partyMode: 'EXISTING',
    partyId: view.partyId,
    partyKind: view.partyKind,
    legalName: '',
    displayName: view.partyDisplayName,
    taxNumber: '',
    identifierType: 'PERSON_ID',
    identifierValue: '',
    operatingEntityId: view.operatingEntityId,
    employeeCategoryId: view.data.employeeCategoryId ?? '',
    departmentId: view.data.departmentId ?? '',
    positionId: view.data.positionId ?? '',
    phone: view.data.phone ?? '',
    email: view.data.email ?? '',
    hireDate: view.data.hireDate ?? '',
    remark: view.data.remark ?? '',
  }
}

export function dclEmployeeData(form: DclEmployeeForm) {
  const optional = (value: string): string | null => value.trim() || null
  return {
    employeeCategoryId: optional(form.employeeCategoryId),
    departmentId: optional(form.departmentId),
    positionId: optional(form.positionId),
    phone: optional(form.phone),
    email: optional(form.email),
    hireDate: optional(form.hireDate),
    remark: optional(form.remark),
  }
}

export async function createDclEmployee(form: DclEmployeeForm): Promise<void> {
  const data = dclEmployeeData(form)
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
  await apiClient.postContract('dcl/employee/create', {
    ...party,
    operatingEntityId: form.operatingEntityId.trim(),
    data,
  })
}

export async function saveDclEmployee(request: {
  objectId: string
  approvalEntryId: string
  approvalRevision: number
  enabled: boolean
  data: ReturnType<typeof dclEmployeeData>
}): Promise<void> {
  await apiClient.postContract('dcl/employee/save', request)
}

async function lifecycle(
  item: DclEmployeeListItem,
  action: DclDeclarationWireAction,
  reason: string,
): Promise<void> {
  const approval = dclEmployeeActiveVersion(item).approval
  const request = {
    objectId: item.objectId,
    approvalEntryId: approval.approvalEntryId,
    approvalRevision: approval.revision,
  }
  await runDclEmployeeAction(action, request, reason)
}

export async function runDclEmployeeAction(
  action: DclDeclarationWireAction,
  request: {
    objectId: string
    approvalEntryId: string
    approvalRevision: number
  },
  reason: string,
): Promise<void> {
  if (action === 'reject' || action === 'unapprove') {
    await apiClient.postContract(`dcl/employee/${action}`, {
      ...request,
      reason,
    })
  } else {
    await apiClient.postContract(`dcl/employee/${action}`, request)
  }
}

export const dclEmployeeLifecyclePort: DclDeclarationLifecyclePort<DclEmployeeListItem> =
  {
    run: lifecycle,
    async changeEnabled(item) {
      const view = await getDclEmployee(
        item.objectId,
        item.latestApproved?.approval.approvalEntryId,
      )
      await saveDclEmployee({
        objectId: view.objectId,
        approvalEntryId: view.approval.approvalEntryId,
        approvalRevision: view.approval.revision,
        enabled: !item.enabled,
        data: {
          employeeCategoryId: view.data.employeeCategoryId ?? null,
          departmentId: view.data.departmentId ?? null,
          positionId: view.data.positionId ?? null,
          phone: view.data.phone ?? null,
          email: view.data.email ?? null,
          hireDate: view.data.hireDate ?? null,
          remark: view.data.remark ?? null,
        },
      })
    },
  }

export async function deleteDclEmployee(
  item: DclEmployeeListItem,
): Promise<void> {
  const approval = dclEmployeeActiveVersion(item).approval
  await apiClient.postContract('dcl/employee/delete', {
    objectId: item.objectId,
    approvalEntryId: approval.approvalEntryId,
    approvalRevision: approval.revision,
  })
}

export const dclEmployeeHistoryPort: DclDeclarationHistoryPort<
  DclEmployeeListItem,
  DclEmployeeVersionView,
  DclEmployeeAuditEvent
> = {
  async loadVersions(item, page, pageSize, update) {
    const { data } = await apiClient.postContract('dcl/employee/versions', {
      objectId: item.objectId,
      page,
      pageSize,
    })
    update(data.items, data.total, data.page, data.pageSize)
  },
  async loadAudit(item, page, pageSize, update) {
    const { data } = await apiClient.postContract(
      'dcl/employee/audit-history',
      {
        objectId: item.objectId,
        page,
        pageSize,
      },
    )
    update(data.items, data.total, data.page, data.pageSize)
  },
}

type ReferenceEntity =
  'operating-entity' | 'employee-category' | 'department' | 'position'

export async function queryEmployeeReference(
  entity: ReferenceEntity,
  keyword: string,
): Promise<DclEmployeeReferenceOption[]> {
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
        sort: [{ field: 'name', order: 'asc' }],
      },
    )
    return data.items.map((item) => ({
      value: item.objectId,
      title: formatReferenceLabel({ code: item.code, name: String(item.data.name ?? '') }),
    }))
  }
  const { data } = await apiClient.postContract(`aux/${entity}/query`, {
    page: 1,
    pageSize: 20,
    filters: { enabled: true, ...(keyword ? { keyword } : {}) },
    sort: [{ field: 'code', order: 'asc' }],
  })
  return data.items.flatMap((item) => {
    const version = item.latestApproved
    return version
      ? [
          {
            value: item.objectId,
            title: formatReferenceLabel({
              code: item.code,
              name: version.data.name,
            }),
          },
        ]
      : []
  })
}

export async function queryEmployeeParties(
  keyword: string,
): Promise<DclEmployeeReferenceOption[]> {
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

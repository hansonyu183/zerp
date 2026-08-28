import { apiClient } from '@/api/client'
import type { components } from '@/api/generated/schema'
import type { ApprovalStatus } from '@/api/generated'

type DclMappingView = components['schemas']['DclAccMappingView']
type DclMappingListItem = components['schemas']['DclAccMappingListItem']

export type AccountingMappingDefinition =
  components['schemas']['MappingDefinition']
export type AccountingMappingCatalog = components['schemas']['MappingCatalog']
export type AccountingMappingAuditEvent = components['schemas']['ApprovalEventView']
export type AccountingMapping = Omit<DclMappingView, 'data'> &
  DclMappingView['data'] & {
    state: DclMappingView['approval']['status']
    version: number
  }
export type MappingContract = AccountingMapping
export type AccountingMappingCreate = {
  bookId: string
  vouEntity: string
  defaultResult: components['schemas']['MappingResult']
  definition: AccountingMappingDefinition
}
export type AccountingMappingSave = AccountingMappingCreate & {
  approvalEntryId: string
  approvalRevision: number
}

function projectMapping(
  mapping: DclMappingView | DclMappingListItem,
): AccountingMapping {
  return {
    ...mapping,
    ...mapping.data,
    state: mapping.approval.status,
    version: mapping.approval.versionNo,
  }
}

export async function queryAccountingMappings(input: {
  bookId: string
  vouEntity?: string
  status?: ApprovalStatus[]
  page: number
  pageSize: number
}) {
  const { data } = await apiClient.postContract('dcl/acc-mapping/query', {
    bookId: input.bookId,
    page: input.page,
    pageSize: input.pageSize,
    filters: {
      ...(input.vouEntity ? { vouEntity: input.vouEntity } : {}),
      ...(input.status?.length ? { status: input.status } : {}),
    },
    sort: [{ field: 'vouEntity', order: 'asc' }],
  })
  return { data: { ...data, items: (data.items ?? []).map(projectMapping) } }
}

export async function getAccountingMapping(
  bookId: string,
  vouEntity: string,
  approvalEntryId?: string,
) {
  const { data } = await apiClient.postContract('dcl/acc-mapping/get', {
    bookId,
    vouEntity,
    ...(approvalEntryId ? { approvalEntryId } : {}),
  })
  return { data: projectMapping(data) }
}

export function createAccountingMapping(input: AccountingMappingCreate) {
  return apiClient.postContract('dcl/acc-mapping/create', {
    bookId: input.bookId,
    vouEntity: input.vouEntity,
    data: { defaultResult: input.defaultResult, definition: input.definition },
  })
}

export function saveAccountingMapping(input: AccountingMappingSave) {
  return apiClient.postContract('dcl/acc-mapping/save', {
    bookId: input.bookId,
    vouEntity: input.vouEntity,
    approvalEntryId: input.approvalEntryId,
    approvalRevision: input.approvalRevision,
    data: { defaultResult: input.defaultResult, definition: input.definition },
  })
}

export function mappingApprovalAction(
  action: 'submit' | 'unsubmit' | 'approve' | 'delete-version',
  mapping: AccountingMapping,
) {
  const request = {
    bookId: mapping.bookId,
    vouEntity: mapping.vouEntity,
    approvalEntryId: mapping.approval.approvalEntryId,
    approvalRevision: mapping.approval.revision,
  }
  if (action === 'unsubmit') {
    return apiClient.postContract('dcl/acc-mapping/unsubmit', {
      ...request,
      reason: null,
    })
  }
  return apiClient.postContract(`dcl/acc-mapping/${action}`, request)
}

export function mappingReasonAction(
  action: 'reject' | 'unapprove',
  mapping: AccountingMapping,
  reason: string,
) {
  return apiClient.postContract(`dcl/acc-mapping/${action}`, {
    bookId: mapping.bookId,
    vouEntity: mapping.vouEntity,
    approvalEntryId: mapping.approval.approvalEntryId,
    approvalRevision: mapping.approval.revision,
    reason,
  })
}

export function createNextAccountingMapping(mapping: AccountingMapping) {
  return apiClient.postContract('dcl/acc-mapping/create-next', {
    bookId: mapping.bookId,
    vouEntity: mapping.vouEntity,
    approvalEntryId: mapping.approval.approvalEntryId,
    approvalRevision: mapping.approval.revision,
  })
}

export async function getAccountingMappingVersions(
  bookId: string,
  vouEntity: string,
) {
  const { data } = await apiClient.postContract('dcl/acc-mapping/versions', {
    bookId,
    vouEntity,
    page: 1,
    pageSize: 100,
  })
  return { data: { ...data, items: (data.items ?? []).map(projectMapping) } }
}

export function getAccountingMappingAuditHistory(
  bookId: string,
  vouEntity: string,
) {
  return apiClient.postContract('dcl/acc-mapping/audit-history', {
    bookId,
    vouEntity,
    page: 1,
    pageSize: 100,
  })
}

export function getAccountingMappingCatalog(vouEntity: string) {
  return apiClient.postContract('acc/mapping/catalog', { vouEntity })
}

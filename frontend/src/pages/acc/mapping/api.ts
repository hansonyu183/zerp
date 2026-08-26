import { apiClient } from '@/api/client'
import type { components } from '@/api/generated/schema'

export type MappingContract = components['schemas']['Mapping']
// List rows expose compact presentation fields derived from Approval meta.
export type AccountingMapping = MappingContract & {
  state: MappingContract['approval']['status']
  version: number
}
export type AccountingMappingDefinition =
  components['schemas']['MappingDefinition']
export type AccountingMappingCatalog = components['schemas']['MappingCatalog']
export type AccountingMappingCreate =
  components['schemas']['MappingCreateRequest']
export type AccountingMappingSave = components['schemas']['MappingSaveRequest']

export function queryAccountingMappings(input: {
  bookId: string
  vouEntity?: string
  page: number
  pageSize: number
}) {
  return apiClient.postContract(
    'acc/mapping/query',
    input,
  )
}

export function getAccountingMapping(
  bookId: string,
  vouEntity: string,
  approvalEntryId?: string,
) {
  return apiClient.postContract('acc/mapping/get', {
    bookId,
    vouEntity,
    ...(approvalEntryId ? { approvalEntryId } : {}),
  })
}

export function createAccountingMapping(input: AccountingMappingCreate) {
  return apiClient.postContract(
    'acc/mapping/create',
    input,
  )
}

export function saveAccountingMapping(input: AccountingMappingSave) {
  return apiClient.postContract(
    'acc/mapping/save',
    input,
  )
}

export function mappingApprovalAction(
  action: 'submit' | 'unsubmit' | 'approve' | 'delete-version',
  bookId: string,
  vouEntity: string,
  approvalEntryId: string,
  revision: number,
) {
  return apiClient.postContract(`acc/mapping/${action}`, { bookId, vouEntity, approvalEntryId, revision })
}

export function mappingReasonAction(
  action: 'reject' | 'unapprove',
  bookId: string,
  vouEntity: string,
  approvalEntryId: string,
  revision: number,
  reason: string,
) {
  return apiClient.postContract(`acc/mapping/${action}`, { bookId, vouEntity, approvalEntryId, revision, reason })
}

export function createNextAccountingMapping(bookId: string, vouEntity: string) {
  return apiClient.postContract('acc/mapping/create-next', { bookId, vouEntity })
}

export function getAccountingMappingVersions(bookId: string, vouEntity: string) {
  return apiClient.postContract('acc/mapping/versions', { bookId, vouEntity, page: 1, pageSize: 200 })
}

export function getAccountingMappingCatalog(vouEntity: string) {
  return apiClient.postContract(
    'acc/mapping/catalog',
    { vouEntity },
  )
}

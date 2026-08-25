import { apiClient } from '@/api/client'
import type { components } from '@/api/generated/schema'

export type AccountingMapping = components['schemas']['Mapping']
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

export function getAccountingMapping(bookId: string, mappingId: string) {
  return apiClient.postContract('acc/mapping/get', { bookId, mappingId })
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

export function approveAccountingMapping(
  bookId: string,
  mappingId: string,
  revision: number,
) {
  return apiClient.postContract('acc/mapping/approve', { bookId, mappingId, revision })
}

export function unapproveAccountingMapping(
  bookId: string,
  mappingId: string,
  revision: number,
) {
  return apiClient.postContract('acc/mapping/unapprove', { bookId, mappingId, revision })
}

export function getAccountingMappingCatalog(vouEntity: string) {
  return apiClient.postContract(
    'acc/mapping/catalog',
    { vouEntity },
  )
}

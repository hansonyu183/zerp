import { apiClient } from '@/api/client'
import type { components } from '@/api/generated/schema'

export type CurrentAccountingMapping = components['schemas']['Mapping']
export type AccountingMappingCatalog = components['schemas']['MappingCatalog']

export function queryCurrentAccountingMappings(input: {
  bookId: string
  vouEntity?: string
  page: number
  pageSize: number
}) {
  return apiClient.postContract('acc/mapping/query', input)
}

export function getCurrentAccountingMapping(
  bookId: string,
  vouEntity: string,
) {
  return apiClient.postContract('acc/mapping/get', { bookId, vouEntity })
}

export function getAccountingMappingCatalog(vouEntity: string) {
  return apiClient.postContract('acc/mapping/catalog', { vouEntity })
}

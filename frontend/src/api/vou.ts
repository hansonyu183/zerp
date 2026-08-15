import type { components } from '@/api/generated/schema'
import { apiClient, type VouApiEntity } from '@/api/client'

type DocumentRevisionRequest =
  components['schemas']['VouDocumentRevisionRequest']

export function checkVoucher(
  entity: VouApiEntity,
  request: DocumentRevisionRequest,
) {
  return apiClient.post<unknown, DocumentRevisionRequest>(
    `vou/${entity}/check`,
    request,
  )
}

export function uncheckVoucher(
  entity: VouApiEntity,
  request: DocumentRevisionRequest,
) {
  return apiClient.post<unknown, DocumentRevisionRequest>(
    `vou/${entity}/uncheck`,
    request,
  )
}

export function approveVoucher(
  entity: VouApiEntity,
  request: DocumentRevisionRequest,
) {
  return apiClient.post<unknown, DocumentRevisionRequest>(
    `vou/${entity}/approve`,
    request,
  )
}

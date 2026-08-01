import type { components } from '@/api/generated/schema'
import { apiClient, type VouApiEntity } from '@/api/client'

type DocumentRevisionRequest =
  components['schemas']['VouDocumentRevisionRequest']
type FinalizeRequest = components['schemas']['VouFinalizeRequest']

export function checkVoucher(
  entity: VouApiEntity,
  request: DocumentRevisionRequest,
) {
  return apiClient.post<unknown, DocumentRevisionRequest>(
    `vou/${entity}/check`,
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

export function finalizeVoucher(
  entity: VouApiEntity,
  request: FinalizeRequest,
) {
  return apiClient.post<unknown, FinalizeRequest>(
    `vou/${entity}/finalize`,
    request,
  )
}

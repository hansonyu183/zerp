import type { components } from '@/api/generated/schema'
import { apiClient, type VouApiEntity } from '@/api/client'

type DocumentRevisionRequest =
  components['schemas']['VouDocumentRevisionRequest']
type DocumentReverseRequest = components['schemas']['VouReverseRequest']

export function submitVoucher(
  entity: VouApiEntity,
  request: DocumentRevisionRequest,
) {
  return apiClient.postContract(
    `vou/${entity}/submit`,
    request,
  )
}

export function unsubmitVoucher(
  entity: VouApiEntity,
  request: DocumentRevisionRequest,
) {
  return apiClient.postContract(
    `vou/${entity}/unsubmit`,
    request,
  )
}

export function approveVoucher(
  entity: VouApiEntity,
  request: DocumentRevisionRequest,
) {
  return apiClient.postContract(
    `vou/${entity}/approve`,
    request,
  )
}

export function rejectVoucher(
  entity: VouApiEntity,
  request: DocumentReverseRequest,
) {
  return apiClient.postContract(`vou/${entity}/reject`, request)
}

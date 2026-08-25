import type { components } from '@/api/generated/schema'
import { apiClient, type BobApiEntity } from '@/api/client'

type VersionRevisionRequest =
  components['schemas']['BobVersionRevisionRequest']
type ReviewRequest = components['schemas']['BobReviewRequest']

export function submitBusinessObject(
  entity: BobApiEntity,
  request: VersionRevisionRequest,
) {
  return apiClient.postContract(
    `bob/${entity}/submit`,
    request,
  )
}

export function unsubmitBusinessObject(
  entity: BobApiEntity,
  request: VersionRevisionRequest,
) {
  return apiClient.postContract(
    `bob/${entity}/unsubmit`,
    request,
  )
}

export function approveBusinessObject(
  entity: BobApiEntity,
  request: VersionRevisionRequest,
) {
  return apiClient.postContract(
    `bob/${entity}/approve`,
    request,
  )
}

export function rejectBusinessObject(
  entity: BobApiEntity,
  request: ReviewRequest,
) {
  return apiClient.postContract(
    `bob/${entity}/reject`,
    request,
  )
}

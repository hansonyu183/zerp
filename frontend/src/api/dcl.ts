import { apiClient, type ApiPostRequest } from '@/api/client'

type VersionRequest = ApiPostRequest<'dcl/operating-entity/submit'>
type ReviewRequest = ApiPostRequest<'dcl/operating-entity/reject'>

export function submitOperatingEntity(request: VersionRequest) {
  return apiClient.postContract('dcl/operating-entity/submit', request)
}

export function unsubmitOperatingEntity(request: ReviewRequest) {
  return apiClient.postContract('dcl/operating-entity/unsubmit', request)
}

export function approveOperatingEntity(request: VersionRequest) {
  return apiClient.postContract('dcl/operating-entity/approve', request)
}

export function rejectOperatingEntity(request: ReviewRequest) {
  return apiClient.postContract('dcl/operating-entity/reject', request)
}

import { apiClient } from '@/api/client'
import type { components } from '@/api/generated/schema'

export type CustomerAttachmentInitiateRequest =
  components['schemas']['DclCustomerAttachmentInitiateRequest']
export type CustomerAttachmentRemoveRequest =
  components['schemas']['DclCustomerAttachmentRemoveRequest']
export type CustomerAttachmentDownloadRequest =
  components['schemas']['DclCustomerAttachmentDownloadRequest']

export function initiateCustomerAttachment(
  request: CustomerAttachmentInitiateRequest,
) {
  return apiClient.postContract('dcl/customer/attachment-initiate', request)
}

export function removeCustomerAttachment(
  request: CustomerAttachmentRemoveRequest,
) {
  return apiClient.postContract('dcl/customer/attachment-remove', request)
}

export function createCustomerAttachmentDownload(
  request: CustomerAttachmentDownloadRequest,
) {
  return apiClient.postContract('dcl/customer/attachment-download', request)
}

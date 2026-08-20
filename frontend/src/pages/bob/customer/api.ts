import { apiClient, type ApiPostRequest } from '@/api/client'

export type CustomerCreateRequest = ApiPostRequest<'bob/customer/create'>
export type CustomerSaveRequest = ApiPostRequest<'bob/customer/save'>

export const customerApi = {
  query: (input: ApiPostRequest<'bob/customer/query'>) =>
    apiClient.postContract('bob/customer/query', input),
  get: (input: ApiPostRequest<'bob/customer/get'>) =>
    apiClient.postContract('bob/customer/get', input),
  create: (input: CustomerCreateRequest) =>
    apiClient.postContract('bob/customer/create', input),
  taxMatch: (input: ApiPostRequest<'bob/customer/tax-match'>) =>
    apiClient.postContract('bob/customer/tax-match', input),
  save: (input: CustomerSaveRequest) =>
    apiClient.postContract('bob/customer/save', input),
  attachmentInitiate: (
    input: ApiPostRequest<'bob/customer/attachment-initiate'>,
  ) => apiClient.postContract('bob/customer/attachment-initiate', input),
  attachmentDownload: (
    input: ApiPostRequest<'bob/customer/attachment-download'>,
  ) => apiClient.postContract('bob/customer/attachment-download', input),
  attachmentRemove: (
    input: ApiPostRequest<'bob/customer/attachment-remove'>,
  ) => apiClient.postContract('bob/customer/attachment-remove', input),
  queryBobReferences: (input: ApiPostRequest<'bob/reference/query'>) =>
    apiClient.postContract('bob/reference/query', input),
  queryAuxReferences: (input: ApiPostRequest<'aux/reference/query'>) =>
    apiClient.postContract('aux/reference/query', input),
  submit: (input: ApiPostRequest<'bob/customer/submit'>) =>
    apiClient.postContract('bob/customer/submit', input),
  unsubmit: (input: ApiPostRequest<'bob/customer/unsubmit'>) =>
    apiClient.postContract('bob/customer/unsubmit', input),
  approve: (input: ApiPostRequest<'bob/customer/approve'>) =>
    apiClient.postContract('bob/customer/approve', input),
  reject: (input: ApiPostRequest<'bob/customer/reject'>) =>
    apiClient.postContract('bob/customer/reject', input),
  unapprove: (input: ApiPostRequest<'bob/customer/unapprove'>) =>
    apiClient.postContract('bob/customer/unapprove', input),
  enable: (input: ApiPostRequest<'bob/customer/enable'>) =>
    apiClient.postContract('bob/customer/enable', input),
  disable: (input: ApiPostRequest<'bob/customer/disable'>) =>
    apiClient.postContract('bob/customer/disable', input),
  delete: (input: ApiPostRequest<'bob/customer/delete'>) =>
    apiClient.post<null, ApiPostRequest<'bob/customer/delete'>>(
      'bob/customer/delete',
      input,
    ),
}

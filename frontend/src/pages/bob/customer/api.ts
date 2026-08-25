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
  accountAdd: (input: ApiPostRequest<'bob/customer/account-add'>) =>
    apiClient.postContract('bob/customer/account-add', input),
  accountDelete: (input: ApiPostRequest<'bob/customer/account-delete'>) =>
    apiClient.postContract('bob/customer/account-delete', input),
  save: (input: CustomerSaveRequest) =>
    apiClient.postContract('bob/customer/save', input),
  attachmentInitiate: (
    input: ApiPostRequest<'bob/customer/attachment-initiate'>,
  ) => apiClient.postContract('bob/customer/attachment-initiate', input),
  attachmentDownload: (
    input: ApiPostRequest<'bob/customer/attachment-download'>,
  ) => apiClient.postContract('bob/customer/attachment-download', input),
  attachmentRemove: (input: ApiPostRequest<'bob/customer/attachment-remove'>) =>
    apiClient.postContract('bob/customer/attachment-remove', input),
  queryBobReferences: (input: ApiPostRequest<'bob/reference/query'>) =>
    apiClient.postContract('bob/reference/query', input),
  queryAuxReferences: (input: ApiPostRequest<'aux/reference/query'>) =>
    apiClient.postContract('aux/reference/query', input),
  partyQuery: (input: ApiPostRequest<'bob/party/query'>) =>
    apiClient.postContract('bob/party/query', input),
  submit: (input: ApiPostRequest<'bob/customer-account/submit'>) =>
    apiClient.postContract('bob/customer-account/submit', input),
  unsubmit: (input: ApiPostRequest<'bob/customer-account/unsubmit'>) =>
    apiClient.postContract('bob/customer-account/unsubmit', input),
  approve: (input: ApiPostRequest<'bob/customer-account/approve'>) =>
    apiClient.postContract('bob/customer-account/approve', input),
  reject: (input: ApiPostRequest<'bob/customer-account/reject'>) =>
    apiClient.postContract('bob/customer-account/reject', input),
  unapprove: (input: ApiPostRequest<'bob/customer-account/unapprove'>) =>
    apiClient.postContract('bob/customer-account/unapprove', input),
  enable: (input: ApiPostRequest<'bob/customer-account/enable'>) =>
    apiClient.postContract('bob/customer-account/enable', input),
  disable: (input: ApiPostRequest<'bob/customer-account/disable'>) =>
    apiClient.postContract('bob/customer-account/disable', input),
}

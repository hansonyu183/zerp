import { apiClient, type ApiPostRequest } from '@/api/client'

export const otherUnitApi = {
  query: (input: ApiPostRequest<'bob/other-unit/query'>) =>
    apiClient.postContract('bob/other-unit/query', input),
  get: (input: ApiPostRequest<'bob/other-unit/get'>) =>
    apiClient.postContract('bob/other-unit/get', input),
  create: (input: ApiPostRequest<'bob/other-unit/create'>) =>
    apiClient.postContract('bob/other-unit/create', input),
  save: (input: ApiPostRequest<'bob/other-unit/save'>) =>
    apiClient.postContract('bob/other-unit/save', input),
  delete: (input: ApiPostRequest<'bob/other-unit/delete'>) =>
    apiClient.postContract('bob/other-unit/delete', input),
  submit: (input: ApiPostRequest<'bob/other-unit/submit'>) =>
    apiClient.postContract('bob/other-unit/submit', input),
  unsubmit: (input: ApiPostRequest<'bob/other-unit/unsubmit'>) =>
    apiClient.postContract('bob/other-unit/unsubmit', input),
  approve: (input: ApiPostRequest<'bob/other-unit/approve'>) =>
    apiClient.postContract('bob/other-unit/approve', input),
  reject: (input: ApiPostRequest<'bob/other-unit/reject'>) =>
    apiClient.postContract('bob/other-unit/reject', input),
  unapprove: (input: ApiPostRequest<'bob/other-unit/unapprove'>) =>
    apiClient.postContract('bob/other-unit/unapprove', input),
  enable: (input: ApiPostRequest<'bob/other-unit/enable'>) =>
    apiClient.postContract('bob/other-unit/enable', input),
  disable: (input: ApiPostRequest<'bob/other-unit/disable'>) =>
    apiClient.postContract('bob/other-unit/disable', input),
  partyQuery: (input: ApiPostRequest<'bob/party/query'>) =>
    apiClient.postContract('bob/party/query', input),
  operatingQuery: (input: ApiPostRequest<'bob/operating-entity/query'>) =>
    apiClient.postContract('bob/operating-entity/query', input),
  settlementQuery: (input: ApiPostRequest<'aux/reference/query'>) =>
    apiClient.postContract('aux/reference/query', input),
}

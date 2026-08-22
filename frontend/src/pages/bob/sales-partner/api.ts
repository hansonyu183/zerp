import { apiClient, type ApiPostRequest } from '@/api/client'

export const salesPartnerApi = {
  query: (input: ApiPostRequest<'bob/sales-partner/query'>) =>
    apiClient.postContract('bob/sales-partner/query', input),
  get: (input: ApiPostRequest<'bob/sales-partner/get'>) =>
    apiClient.postContract('bob/sales-partner/get', input),
  create: (input: ApiPostRequest<'bob/sales-partner/create'>) =>
    apiClient.postContract('bob/sales-partner/create', input),
  save: (input: ApiPostRequest<'bob/sales-partner/save'>) =>
    apiClient.postContract('bob/sales-partner/save', input),
  partyQuery: (input: ApiPostRequest<'bob/party/query'>) =>
    apiClient.postContract('bob/party/query', input),
  referenceQuery: (input: ApiPostRequest<'bob/reference/query'>) =>
    apiClient.postContract('bob/reference/query', input),
  submit: (input: ApiPostRequest<'bob/sales-partner/submit'>) =>
    apiClient.postContract('bob/sales-partner/submit', input),
  approve: (input: ApiPostRequest<'bob/sales-partner/approve'>) =>
    apiClient.postContract('bob/sales-partner/approve', input),
  enable: (input: ApiPostRequest<'bob/sales-partner/enable'>) =>
    apiClient.postContract('bob/sales-partner/enable', input),
  disable: (input: ApiPostRequest<'bob/sales-partner/disable'>) =>
    apiClient.postContract('bob/sales-partner/disable', input),
}

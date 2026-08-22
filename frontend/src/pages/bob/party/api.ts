import { apiClient, type ApiPostRequest } from '@/api/client'

export const partyApi = {
  query: (input: ApiPostRequest<'bob/party/query'>) =>
    apiClient.postContract('bob/party/query', input),
  get: (input: ApiPostRequest<'bob/party/get'>) =>
    apiClient.postContract('bob/party/get', input),
  save: (input: ApiPostRequest<'bob/party/save'>) =>
    apiClient.postContract('bob/party/save', input),
  mergePreflight: (input: ApiPostRequest<'bob/party/merge-preflight'>) =>
    apiClient.postContract('bob/party/merge-preflight', input),
  mergeConfirm: (input: ApiPostRequest<'bob/party/merge-confirm'>) =>
    apiClient.postContract('bob/party/merge-confirm', input),
}

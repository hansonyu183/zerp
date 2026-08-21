import { apiClient, type ApiPostRequest } from '@/api/client'

export const partyApi = {
  query: (input: ApiPostRequest<'bob/party/query'>) =>
    apiClient.postContract('bob/party/query', input),
  get: (input: ApiPostRequest<'bob/party/get'>) =>
    apiClient.postContract('bob/party/get', input),
  save: (input: ApiPostRequest<'bob/party/save'>) =>
    apiClient.postContract('bob/party/save', input),
}

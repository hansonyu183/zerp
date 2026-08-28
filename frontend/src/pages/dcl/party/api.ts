import { apiClient, type ApiPostRequest } from '@/api/client'

export const dclPartyApi = {
  query: (input: ApiPostRequest<'dcl/party/query'>) =>
    apiClient.postContract('dcl/party/query', input),
  get: (input: ApiPostRequest<'dcl/party/get'>) =>
    apiClient.postContract('dcl/party/get', input),
  save: (input: ApiPostRequest<'dcl/party/save'>) =>
    apiClient.postContract('dcl/party/save', input),
  submit: (input: ApiPostRequest<'dcl/party/submit'>) =>
    apiClient.postContract('dcl/party/submit', input),
  unsubmit: (input: ApiPostRequest<'dcl/party/unsubmit'>) =>
    apiClient.postContract('dcl/party/unsubmit', input),
  approve: (input: ApiPostRequest<'dcl/party/approve'>) =>
    apiClient.postContract('dcl/party/approve', input),
  reject: (input: ApiPostRequest<'dcl/party/reject'>) =>
    apiClient.postContract('dcl/party/reject', input),
  unapprove: (input: ApiPostRequest<'dcl/party/unapprove'>) =>
    apiClient.postContract('dcl/party/unapprove', input),
  delete: (input: ApiPostRequest<'dcl/party/delete'>) =>
    apiClient.postContract('dcl/party/delete', input),
  versions: (input: ApiPostRequest<'dcl/party/versions'>) =>
    apiClient.postContract('dcl/party/versions', input),
  audit: (input: ApiPostRequest<'dcl/party/audit-history'>) =>
    apiClient.postContract('dcl/party/audit-history', input),
  mergePreflight: (input: ApiPostRequest<'dcl/party/merge-preflight'>) =>
    apiClient.postContract('dcl/party/merge-preflight', input),
  mergeConfirm: (input: ApiPostRequest<'dcl/party/merge-confirm'>) =>
    apiClient.postContract('dcl/party/merge-confirm', input),
}

import { apiClient, type ApiPostRequest } from '@/api/client'
import type { PageResult } from '@/api/types'
import type {
  SupplierAuditEvent,
  SupplierMutationResult,
  SupplierVersionHistoryItem,
} from './types'

export type SupplierCreateRequest = ApiPostRequest<'bob/supplier/create'>
export type SupplierSaveRequest = ApiPostRequest<'bob/supplier/save'>
interface SupplierHistoryRequest {
  objectId: string
  page: number
  pageSize: number
}

export const supplierApi = {
  query: (input: ApiPostRequest<'bob/supplier/query'>) =>
    apiClient.postContract('bob/supplier/query', input),
  get: (input: ApiPostRequest<'bob/supplier/get'>) =>
    apiClient.postContract('bob/supplier/get', input),
  partyQuery: (input: ApiPostRequest<'bob/party/query'>) =>
    apiClient.postContract('bob/party/query', input),
  create: (input: SupplierCreateRequest) =>
    apiClient.post<SupplierMutationResult, SupplierCreateRequest>(
      'bob/supplier/create',
      input,
    ),
  save: (input: SupplierSaveRequest) =>
    apiClient.post<SupplierMutationResult, SupplierSaveRequest>(
      'bob/supplier/save',
      input,
    ),
  queryBobReferences: (input: ApiPostRequest<'bob/reference/query'>) =>
    apiClient.postContract('bob/reference/query', input),
  queryAuxReferences: (input: ApiPostRequest<'aux/reference/query'>) =>
    apiClient.postContract('aux/reference/query', input),
  submit: (input: ApiPostRequest<'bob/supplier/submit'>) =>
    apiClient.postContract('bob/supplier/submit', input),
  unsubmit: (input: ApiPostRequest<'bob/supplier/unsubmit'>) =>
    apiClient.postContract('bob/supplier/unsubmit', input),
  approve: (input: ApiPostRequest<'bob/supplier/approve'>) =>
    apiClient.postContract('bob/supplier/approve', input),
  reject: (input: ApiPostRequest<'bob/supplier/reject'>) =>
    apiClient.postContract('bob/supplier/reject', input),
  enable: (input: ApiPostRequest<'bob/supplier/enable'>) =>
    apiClient.postContract('bob/supplier/enable', input),
  disable: (input: ApiPostRequest<'bob/supplier/disable'>) =>
    apiClient.postContract('bob/supplier/disable', input),
  delete: (input: ApiPostRequest<'bob/supplier/delete'>) =>
    apiClient.post<null, ApiPostRequest<'bob/supplier/delete'>>(
      'bob/supplier/delete',
      input,
    ),
  versions: (input: SupplierHistoryRequest) =>
    apiClient.post<
      PageResult<SupplierVersionHistoryItem>,
      SupplierHistoryRequest
    >('bob/supplier/versions', input),
  auditHistory: (input: SupplierHistoryRequest) =>
    apiClient.post<PageResult<SupplierAuditEvent>, SupplierHistoryRequest>(
      'bob/supplier/audit-history',
      input,
    ),
}

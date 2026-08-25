import { apiClient, type ApiPostRequest } from '@/api/client'

export const employeeApi = {
  query: (input: ApiPostRequest<'bob/employee/query'>) =>
    apiClient.postContract('bob/employee/query', input),
  create: (input: ApiPostRequest<'bob/employee/create'>) =>
    apiClient.postContract('bob/employee/create', input),
  partyQuery: (input: ApiPostRequest<'bob/party/query'>) =>
    apiClient.postContract('bob/party/query', input),
  operatingQuery: (input: ApiPostRequest<'bob/operating-entity/query'>) =>
    apiClient.postContract('bob/operating-entity/query', input),
  departmentQuery: (input: ApiPostRequest<'aux/department/query'>) =>
    apiClient.postContract('aux/department/query', input),
  positionQuery: (input: ApiPostRequest<'aux/position/query'>) =>
    apiClient.postContract('aux/position/query', input),
}

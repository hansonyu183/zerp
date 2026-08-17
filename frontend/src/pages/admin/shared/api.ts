import { apiClient } from '@/api/client'
import type { components } from '@/api/generated/schema'
import type { PageRequest, PageResult } from '@/api/types'

export type { AdminStatus } from './labels'
export type AdminUser = components['schemas']['UserListItem']
export type AdminUserDetail = components['schemas']['UserDetail']
export type AdminRoleSummary = components['schemas']['UserRoleSummary']
export type AdminRole = components['schemas']['RoleListItem']
export type AdminRoleDetail = components['schemas']['RoleDetail']
export type AdminRolePermission = components['schemas']['RolePermission']

export type AdminPermission = components['schemas']['PermissionView']

export type SystemParameterValueType =
  'STRING' | 'INTEGER' | 'DECIMAL' | 'BOOLEAN'

export interface SystemParameter {
  key: string
  name: string
  description?: string | null
  valueType: SystemParameterValueType
  value: string
  defaultValue: string
  editable: boolean
  revision: number
  updatedAt: string
  updatedBy?: string | null
}

export function queryAdminUsers(request: PageRequest) {
  return apiClient.post<PageResult<AdminUser>, PageRequest>(
    'app/user/query',
    request,
  )
}

export function getAdminUser(id: string) {
  return apiClient.post<AdminUserDetail, { id: string }>('app/user/get', { id })
}

export function createAdminUser(input: {
  username: string
  displayName: string
  password: string
  roleIds: string[]
}) {
  return apiClient.post<AdminUser, typeof input>('app/user/create', input)
}

export function saveAdminUser(input: {
  id: string
  displayName: string
  roleIds: string[]
  revision: number
}) {
  return apiClient.post<AdminUser, typeof input>('app/user/save', input)
}

export function resetAdminUserPassword(input: {
  id: string
  revision: number
}) {
  return apiClient.post<{ temporaryPassword: string }, typeof input>(
    'app/user/reset-password',
    input,
  )
}

export function setAdminUserEnabled(user: AdminUser, enabled: boolean) {
  return apiClient.post<AdminUser, { id: string; revision: number }>(
    enabled ? 'app/user/enable' : 'app/user/disable',
    { id: user.id, revision: user.revision },
  )
}

export function queryAdminRoles(
  request: components['schemas']['RoleQueryRequest'],
) {
  return apiClient.postContract('app/role/query', request)
}

export function getAdminRole(id: string) {
  return apiClient.postContract('app/role/get', { id })
}

export function createAdminRole(
  input: components['schemas']['CreateRoleRequest'],
) {
  return apiClient.postContract('app/role/create', input)
}

export function saveAdminRole(input: components['schemas']['SaveRoleRequest']) {
  return apiClient.postContract('app/role/save', input)
}

export function setAdminRoleEnabled(role: AdminRole, enabled: boolean) {
  const input = { id: role.id, revision: role.revision }
  return enabled
    ? apiClient.postContract('app/role/enable', input)
    : apiClient.postContract('app/role/disable', input)
}

export function queryAdminPermissions(
  request: components['schemas']['PermissionQueryRequest'],
) {
  return apiClient.postContract('app/permission/query', request)
}

export function getAdminPermission(id: string) {
  return apiClient.postContract('app/permission/get', { id })
}

export function querySystemParameters(request: PageRequest) {
  return apiClient.post<PageResult<SystemParameter>, PageRequest>(
    'app/system-parameter/query',
    request,
  )
}

export function getSystemParameter(key: string) {
  return apiClient.post<SystemParameter, { key: string }>(
    'app/system-parameter/get',
    { key },
  )
}

export function saveSystemParameter(input: {
  key: string
  value: string
  revision: number
}) {
  return apiClient.post<SystemParameter, typeof input>(
    'app/system-parameter/save',
    input,
  )
}

export function resetSystemParameter(input: { key: string; revision: number }) {
  return apiClient.post<SystemParameter, typeof input>(
    'app/system-parameter/reset',
    input,
  )
}

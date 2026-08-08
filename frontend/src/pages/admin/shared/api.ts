import { apiClient } from '@/api/client'
import type { PageRequest, PageResult } from '@/api/types'

export type AdminStatus = 'ENABLED' | 'DISABLED'

export interface AdminUser {
  id: string
  username: string
  displayName: string
  status: AdminStatus
  failedSigninCount: number
  lockedUntil?: string | null
  passwordChangedAt: string
  createdAt: string
  updatedAt: string
  revision: number
  roleIds?: string[]
}

export interface AdminRole {
  id: string
  code: string
  name: string
  description?: string | null
  status: AdminStatus
  createdAt: string
  updatedAt: string
  revision: number
  permissionIds?: string[]
}

export interface AdminPermission {
  id: string
  path: string
  domain: string
  entity: string
  action: string
  description?: string | null
  status: AdminStatus
  revision: number
  roleCount?: number
}

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
  return apiClient.post<AdminUser, { id: string }>('app/user/get', { id })
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

export function setAdminUserEnabled(user: AdminUser, enabled: boolean) {
  return apiClient.post<AdminUser, { id: string; revision: number }>(
    enabled ? 'app/user/enable' : 'app/user/disable',
    { id: user.id, revision: user.revision },
  )
}

export function queryAdminRoles(request: PageRequest) {
  return apiClient.post<PageResult<AdminRole>, PageRequest>(
    'app/role/query',
    request,
  )
}

export function getAdminRole(id: string) {
  return apiClient.post<AdminRole, { id: string }>('app/role/get', { id })
}

export function createAdminRole(input: {
  code: string
  name: string
  description: string | null
  permissionIds: string[]
}) {
  return apiClient.post<AdminRole, typeof input>('app/role/create', input)
}

export function saveAdminRole(input: {
  id: string
  name: string
  description: string | null
  permissionIds: string[]
  revision: number
}) {
  return apiClient.post<AdminRole, typeof input>('app/role/save', input)
}

export function setAdminRoleEnabled(role: AdminRole, enabled: boolean) {
  return apiClient.post<AdminRole, { id: string; revision: number }>(
    enabled ? 'app/role/enable' : 'app/role/disable',
    { id: role.id, revision: role.revision },
  )
}

export function queryAdminPermissions(request: PageRequest) {
  return apiClient.post<PageResult<AdminPermission>, PageRequest>(
    'app/permission/query',
    request,
  )
}

export function getAdminPermission(id: string) {
  return apiClient.post<AdminPermission, { id: string }>('app/permission/get', {
    id,
  })
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

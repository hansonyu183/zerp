import { apiClient } from '@/api/client'
import type { components } from '@/api/generated/schema'

export type { AdminStatus } from './labels'
export type AdminUser = components['schemas']['UserListItem']
export type AdminUserDetail = components['schemas']['UserDetail']
export type AdminRoleSummary = components['schemas']['UserRoleSummary']
export type AdminRole = components['schemas']['RoleListItem']
export type AdminRoleDetail = components['schemas']['RoleDetail']
export type AdminRolePermission = components['schemas']['RolePermission']

export type AdminPermission = components['schemas']['PermissionView']
export type AdminPermissionDetail = components['schemas']['PermissionDetail']

export type SystemParameterValueType =
  components['schemas']['SystemParameterValueType']
export type SystemParameterEffectMode =
  components['schemas']['SystemParameterEffectMode']
export type SystemParameterConstraints =
  components['schemas']['SystemParameterConstraints']
export type SystemParameter = components['schemas']['SystemParameterView']

export function queryAdminUsers(
  request: components['schemas']['UserQueryRequest'],
) {
  return apiClient.postContract('app/user/query', request)
}

export function getAdminUser(id: string) {
  return apiClient.postContract('app/user/get', { id })
}

export function createAdminUser(
  input: components['schemas']['CreateUserRequest'],
) {
  return apiClient.postContract('app/user/create', input)
}

export function saveAdminUser(input: components['schemas']['SaveUserRequest']) {
  return apiClient.postContract('app/user/save', input)
}

export function resetAdminUserPassword(input: {
  id: string
  revision: number
}) {
  return apiClient.postContract('app/user/reset-password', input)
}

export function setAdminUserEnabled(user: AdminUser, enabled: boolean) {
  const input = { id: user.id, revision: user.revision }
  return enabled
    ? apiClient.postContract('app/user/enable', input)
    : apiClient.postContract('app/user/disable', input)
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

export function querySystemParameters(
  request: components['schemas']['SystemParameterQueryRequest'],
) {
  return apiClient.postContract('app/system-parameter/query', request)
}

export function getSystemParameter(key: string) {
  return apiClient.postContract('app/system-parameter/get', { key })
}

export function saveSystemParameter(
  input: components['schemas']['SaveSystemParameterRequest'],
) {
  return apiClient.postContract('app/system-parameter/save', input)
}

export function resetSystemParameter(
  input: components['schemas']['ResetSystemParameterRequest'],
) {
  return apiClient.postContract('app/system-parameter/reset', input)
}

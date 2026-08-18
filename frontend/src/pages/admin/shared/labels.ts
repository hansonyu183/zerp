import type { components } from '@/api/generated/schema'

export type AdminStatus = components['schemas']['UserStatus']
export type RoleAction = components['schemas']['RoleAction']
export type RoleType = components['schemas']['RoleType']

export const adminStatusLabels: Readonly<Record<AdminStatus, string>> = {
  ENABLED: '启用',
  DISABLED: '停用',
}

export const adminStatusOptions: readonly {
  title: string
  value: AdminStatus
}[] = Object.entries(adminStatusLabels).map(([value, title]) => ({
  title,
  value: value as AdminStatus,
}))

export const roleActionLabels: Readonly<Record<RoleAction, string>> = {
  VIEW: '查看',
  EDIT: '编辑',
  ENABLE: '启用',
  DISABLE: '停用',
}

export const roleTypeLabels: Readonly<Record<RoleType, string>> = {
  NORMAL: '普通角色',
  SYSTEM: '系统角色',
  SUPERADMIN: '超级管理员',
}

export const assignabilityLabels = {
  true: '可授予',
  false: '不可授予',
} as const

export function formatAdminStatus(status: AdminStatus): string {
  return adminStatusLabels[status]
}

export function formatRoleAction(action: RoleAction): string {
  return roleActionLabels[action]
}

export function formatRoleType(type: RoleType): string {
  return roleTypeLabels[type]
}

export function formatAssignability(assignable: boolean): string {
  return assignabilityLabels[String(assignable) as 'true' | 'false']
}

import * as api from '../../api.ts'
import { roleTypeLabels } from './role-presentation.ts'
import { permissionTitle } from './permission-presentation.ts'
import type { EditOption, EditReferenceSource } from './definition.ts'
export const referencePermissions = {
  roles: '/app/role/query',
  permissions: '/app/permission/query',
  'operating-entities': '/aux/operating-entity/query',
  'employee-categories': '/aux/employee-category/query',
  departments: '/aux/department/query',
  positions: '/aux/position/query',
  employees: '/aux/employee/query',
  'vehicle-types': '/aux/reference/query',
  'other-units': '/bob/reference/query',
} as const satisfies Record<EditReferenceSource, string>
export function roleOption(
  role: Pick<
    Awaited<ReturnType<typeof api.queryTargetRoles>>['items'][number],
    'id' | 'name' | 'code' | 'enabled' | 'type' | 'assignable'
  >,
): EditOption {
  return {
    id: role.id,
    name: `${role.code} · ${role.name}（${role.enabled ? '启用' : '停用'} · ${roleTypeLabels[role.type]}）`,
    disabled: !role.enabled || !role.assignable,
  }
}
export function permissionOption(
  permission: Parameters<typeof permissionTitle>[0],
): EditOption {
  return {
    id: permission.id,
    name: permissionTitle(permission),
    disabled: permission.status !== 'ENABLED',
    unavailable: permission.status !== 'ENABLED',
  }
}
export function summaryOption(item: {
  id: string
  code?: string
  name: string
  enabled?: boolean
}): EditOption {
  return {
    id: item.id,
    name: item.code ? `${item.code} · ${item.name}` : item.name,
    disabled: item.enabled === false,
  }
}
async function allPages<T>(
  query: (input: {
    keyword: string
    page: number
    pageSize: 20
  }) => Promise<{ items: readonly T[]; total: number }>,
): Promise<T[]> {
  const items: T[] = []
  for (let page = 1; ; page++) {
    const result = await query({ keyword: '', page, pageSize: 20 })
    items.push(...result.items)
    if (items.length >= result.total) return items
    if (!result.items.length) throw new Error('候选集合未完整加载，请重试。')
  }
}
export async function loadEditReferences(
  source: EditReferenceSource,
  token: () => string,
  can: (path: string) => boolean,
): Promise<EditOption[]> {
  switch (source) {
    case 'roles':
      return (
        await allPages((input) => api.queryTargetRoles(token(), input))
      ).map(roleOption)
    case 'permissions':
      return (
        await allPages((input) =>
          api.queryTargetPermissions(token(), {
            page: input.page,
            pageSize: input.pageSize,
          }),
        )
      ).map((item) => ({
        ...permissionOption(item),
        disabled: item.status !== 'ENABLED' || !can(item.path),
      }))
    case 'operating-entities':
      return (
        await allPages((input) =>
          api.queryTargetOperatingEntities(token(), input),
        )
      ).map(summaryOption)
    case 'employee-categories':
      return (
        await allPages((input) =>
          api.queryTargetEmployeeCategories(token(), input),
        )
      ).map(summaryOption)
    case 'departments':
      return (
        await allPages((input) => api.queryTargetDepartments(token(), input))
      ).map(summaryOption)
    case 'positions':
      return (
        await allPages((input) => api.queryTargetPositions(token(), input))
      ).map(summaryOption)
    case 'employees':
      return (
        await allPages((input) => api.queryTargetEmployees(token(), input))
      ).map(summaryOption)
    case 'vehicle-types':
      return (
        await api.queryTargetAuxReferences(token(), {
          entity: 'dictionary-item',
        })
      ).map((item) => ({ id: item.objectId, name: item.code }))
    case 'other-units':
      return (
        await api.queryTargetBobReferences(token(), { entity: 'other-unit' })
      ).map((item) => ({
        id: item.objectId,
        name: `${item.code} · ${item.name}`,
        approvalEntryId: item.sourceApprovalEntryId,
      }))
  }
}

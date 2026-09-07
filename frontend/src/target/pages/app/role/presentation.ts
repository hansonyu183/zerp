import type { queryTargetRoles } from '../../../api.ts'

type RoleType = Awaited<
  ReturnType<typeof queryTargetRoles>
>['items'][number]['type']

export const roleTypeLabels = {
  NORMAL: '普通角色',
  SYSTEM: '系统角色',
  SUPERADMIN: '超级管理员',
} as const satisfies Record<RoleType, string>

export const roleTypeOptions = Object.entries(roleTypeLabels).map(
  ([value, caption]) => ({ value, caption }),
)

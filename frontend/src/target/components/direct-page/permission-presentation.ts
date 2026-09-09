import {
  domainDisplayName,
  resourceDisplayName,
} from '../../navigation/resources.ts'
import type { queryTargetPermissions } from '../../api.ts'
type PermissionCandidate = Pick<
  Awaited<ReturnType<typeof queryTargetPermissions>>['items'][number],
  'id' | 'path' | 'domain' | 'entity' | 'action' | 'description' | 'status'
>
const permissionStatusLabels = { ENABLED: '启用', DISABLED: '停用' } as const
export const permissionActionLabels: Readonly<Record<string, string>> = {
  query: '查询',
  get: '查看',
  create: '新增',
  save: '保存',
  enable: '启用',
  disable: '停用',
  delete: '删除',
  reset: '重置',
  'reset-password': '重置密码',
  approve: '审批',
  'approve-child': '审批子单据',
  'approve-over-credit-limit': '超信用额度审批',
  reject: '驳回',
  'reject-child': '驳回子单据',
  'attachment-cleanup': '清理附件',
  'attachment-read': '读取附件',
  'attachment-stage': '暂存附件',
  'audit-history': '查看审核历史',
  'cancel-child': '取消子单据',
  catalog: '查看目录',
  source: '生成计算来源',
  'script-get': '读取计算脚本',
  'script-save': '维护计算脚本',
  'book-balance': '查询账面库存',
  'create-child': '创建子单据',
  lock: '锁定',
  'open-document': '打开单据',
  reference: '查询引用',
  'retry-child': '重试子单据',
  'save-subunits': '保存子项',
  'submit-change': '提交变更',
  'submit-new': '提交新建',
  trial: '试算',
  unapprove: '反审批',
  unlock: '解锁',
  unreject: '撤销驳回',
  versions: '查看版本',
  export: '导出',
}

export function permissionTitle(permission: PermissionCandidate): string {
  const action = permissionActionLabels[permission.action] ?? permission.action
  const description = permission.description
    ? `：${permission.description}`
    : ''
  return `${domainDisplayName(permission.domain)} · ${resourceDisplayName(permission.domain, permission.entity)} · ${action}（${permissionStatusLabels[permission.status]}）${description}`
}

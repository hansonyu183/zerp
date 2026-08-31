import type {
  ApprovalEventView,
  ApprovalLifecycleAction,
  ApprovalStatus,
  ApprovalVersionMeta,
} from '@/api/generated'

export type ApprovalAction = ApprovalLifecycleAction

export const approvalStatusPresentation = {
  DRAFT: { label: '草稿', color: 'warning', icon: 'mdi-file-edit-outline' },
  PENDING: { label: '待批准', color: 'info', icon: 'mdi-clock-check-outline' },
  APPROVED: {
    label: '已批准',
    color: 'success',
    icon: 'mdi-check-decagram-outline',
  },
} as const satisfies Record<
  ApprovalStatus,
  { label: string; color: string; icon: string }
>

export const approvalStatusOptions = Object.entries(
  approvalStatusPresentation,
).map(([value, presentation]) => ({
  title: presentation.label,
  value: value as ApprovalStatus,
}))

export const approvalActionPresentation = {
  submit: {
    label: '提交',
    icon: 'mdi-send-outline',
    color: 'primary',
    reasonRequired: false,
    successLabel: '已提交',
  },
  unsubmit: {
    label: '撤回',
    icon: 'mdi-undo-variant',
    color: 'warning',
    reasonRequired: false,
    successLabel: '已撤回',
  },
  reject: {
    label: '驳回',
    icon: 'mdi-close-octagon-outline',
    color: 'error',
    reasonRequired: true,
    successLabel: '已驳回',
  },
  approve: {
    label: '批准',
    icon: 'mdi-check-decagram-outline',
    color: 'success',
    reasonRequired: false,
    successLabel: '已批准',
  },
  unapprove: {
    label: '反批准',
    icon: 'mdi-undo-variant',
    color: 'warning',
    reasonRequired: true,
    successLabel: '已反批准',
  },
} as const satisfies Record<
  ApprovalLifecycleAction,
  {
    label: string
    icon: string
    color: string
    reasonRequired: boolean
    successLabel: string
  }
>

export const approvalEventActionLabels = {
  CREATED: '创建',
  SAVED: '保存',
  SUBMITTED: '提交',
  UNSUBMITTED: '撤回',
  REJECTED: '驳回',
  APPROVED: '批准',
  UNAPPROVED: '反批准',
  DELETED: '删除',
  MERGED: '合并',
} as const satisfies Record<ApprovalEventView['action'], string>

export function approvalStatusLabel(
  status: ApprovalStatus | null | undefined,
  emptyLabel = '—',
): string {
  return status ? approvalStatusPresentation[status].label : emptyLabel
}

export function approvalVersionHistoryMetadata(meta: ApprovalVersionMeta) {
  const status = approvalStatusPresentation[meta.status]
  return {
    key: meta.approvalEntryId,
    versionLabel: `V${meta.versionNo}`,
    statusLabel: approvalStatusLabel(meta.status),
    statusColor: status.color,
  }
}

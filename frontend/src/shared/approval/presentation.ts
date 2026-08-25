import type { ApprovalMeta, ApprovalStatus } from '@/api/generated'

export type ApprovalAction =
  'submit' | 'unsubmit' | 'reject' | 'approve' | 'unapprove'

export const approvalStatusPresentation = {
  DRAFT: { label: '草稿', color: 'warning' },
  PENDING: { label: '待批准', color: 'info' },
  APPROVED: { label: '已批准', color: 'success' },
} as const satisfies Record<ApprovalStatus, { label: string; color: string }>

export const approvalActionLabels = {
  submit: '提交',
  unsubmit: '撤回',
  reject: '驳回',
  approve: '批准',
  unapprove: '反批准',
} as const satisfies Record<ApprovalAction, string>

export function visibleApprovalActions(
  meta: ApprovalMeta,
  actorId: string,
  can: (action: ApprovalAction) => boolean,
): ApprovalAction[] {
  switch (meta.status) {
    case 'DRAFT':
      return can('submit') ? ['submit'] : []
    case 'PENDING':
      return [
        ...(can('unsubmit') ? (['unsubmit'] as const) : []),
        ...(can('reject') ? (['reject'] as const) : []),
        ...(meta.submittedBy !== actorId && can('approve')
          ? (['approve'] as const)
          : []),
      ]
    case 'APPROVED':
      return can('unapprove') ? ['unapprove'] : []
  }
}

import { actionIcons } from '../../presentation/action-icons.ts'
export const statuses = {
  PENDING: '待批准',
  APPROVED: '已批准',
  REJECTED: '已驳回',
} as const
export const nodeActions = {
  OPEN_DOCUMENT: '打开单据',
  CREATE_CHILD: '创建下级',
  APPROVE_CHILD: '批准下级',
  REJECT_CHILD: '驳回下级',
  RETRY_CHILD: '重试下级',
  CANCEL_CHILD: '取消下级',
} as const

export const auditActions = {
  ...nodeActions,
  ROOT_APPROVED: '根单据已批准',
  ROOT_UNAPPROVED: '根单据已反批准',
} as const

export const nodeActionIcons = {
  OPEN_DOCUMENT: actionIcons.view,
  CREATE_CHILD: actionIcons.create,
  APPROVE_CHILD: actionIcons.approve,
  REJECT_CHILD: actionIcons.reject,
  RETRY_CHILD: actionIcons.retry,
  CANCEL_CHILD: actionIcons.cancel,
} satisfies Record<keyof typeof nodeActions, string>

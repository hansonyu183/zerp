import {
  dclOperatingEntityActiveVersion,
  type DclOperatingEntityActionAvailability,
  type DclOperatingEntityListItem,
} from './types'

export function useDclOperatingEntityActionAvailability(
  userId: () => string | undefined,
  can: (path: string) => boolean,
) {
  const permission = (action: string): string =>
    `/dcl/operating-entity/${action}`

  function actionAvailability(
    row: Readonly<DclOperatingEntityListItem>,
  ): DclOperatingEntityActionAvailability {
    const version = dclOperatingEntityActiveVersion(row)
    const status = version.approval.status
    const selfReview =
      status === 'PENDING' && version.approval.submittedBy === userId()
    return {
      view: can(permission('get')),
      edit:
        (status === 'DRAFT' || status === 'APPROVED') &&
        can(permission('get')) &&
        can(permission('save')),
      delete:
        can(permission('delete')) &&
        status === 'DRAFT' &&
        version.approval.versionNo === 1 &&
        row.latestApproved === null,
      submit: can(permission('submit')) && status === 'DRAFT',
      unsubmit: can(permission('unsubmit')) && status === 'PENDING',
      approve:
        can(permission('approve')) && status === 'PENDING' && !selfReview,
      unapprove: can(permission('unapprove')) && status === 'APPROVED',
      reject: can(permission('reject')) && status === 'PENDING' && !selfReview,
      enable:
        can(permission('get')) &&
        can(permission('save')) &&
        row.openVersion === null &&
        row.latestApproved !== null &&
        !row.enabled,
      disable:
        can(permission('get')) &&
        can(permission('save')) &&
        row.openVersion === null &&
        row.latestApproved !== null &&
        row.enabled,
      versions: can(permission('versions')),
      audit: can(permission('audit-history')),
    }
  }

  function actionBlockedReason(
    row: Readonly<DclOperatingEntityListItem>,
    action: 'approve' | 'reject',
  ): string | null {
    const version = dclOperatingEntityActiveVersion(row)
    return version.approval.status === 'PENDING' &&
      version.approval.submittedBy === userId() &&
      can(permission(action))
      ? '提交人不能审核自己提交的版本，请由其他审核人处理。'
      : null
  }

  function hasAnyAction(row: Readonly<DclOperatingEntityListItem>): boolean {
    return Object.values(actionAvailability(row)).some(Boolean)
  }

  return { permission, actionAvailability, actionBlockedReason, hasAnyAction }
}

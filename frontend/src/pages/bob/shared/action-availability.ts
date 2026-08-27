import { bobActionBlockedReason } from './lifecycle'
import type {
  BobActionAvailability,
  BobEntityConfig,
  BobListItem,
} from './types'
import { bobEntityActionAvailability } from './product-approval'

export function useBobActionAvailability(
  config: BobEntityConfig,
  userId: () => string | undefined,
  can: (path: string) => boolean,
  canLoadEditorReferences: () => boolean,
) {
  const permission = (action: string): string =>
    `/bob/${config.entity}/${action}`

  function actionAvailability(
    row: Readonly<BobListItem>,
  ): BobActionAvailability {
    if (config.entity === 'operating-entity') {
      return {
        view: can(permission('get')),
        edit: false,
        delete: false,
        submit: false,
        unsubmit: false,
        approve: false,
        unapprove: false,
        reject: false,
        enable: false,
        disable: false,
        versions: false,
        audit: false,
      }
    }
    const availability = bobEntityActionAvailability(
      config.entity,
      row,
      userId(),
      (action) => can(permission(action)),
      canLoadEditorReferences(),
    )
    return availability
  }

  function actionBlockedReason(
    row: Readonly<BobListItem>,
    action: 'approve' | 'reject',
  ): string | null {
    return bobActionBlockedReason(row, userId(), can(permission(action)))
  }

  function hasAnyAction(row: Readonly<BobListItem>): boolean {
    return Object.values(actionAvailability(row)).some(Boolean)
  }

  return { permission, actionAvailability, actionBlockedReason, hasAnyAction }
}

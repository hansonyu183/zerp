import { bobActionBlockedReason } from './lifecycle'
import type {
  BobActionAvailability,
  BobEntityConfig,
  BobListItem,
} from './types'
import { bobApprovalDomain } from './types'
import { bobEntityActionAvailability } from './product-approval'

export function useBobActionAvailability(
  config: BobEntityConfig,
  userId: () => string | undefined,
  can: (path: string) => boolean,
  canLoadEditorReferences: () => boolean,
) {
  const permission = (action: string): string =>
    `/${bobApprovalDomain(config)}/${config.entity}/${action}`

  function actionAvailability(
    row: Readonly<BobListItem>,
  ): BobActionAvailability {
    const availability = bobEntityActionAvailability(
      config.entity,
      row,
      userId(),
      (action) =>
        can(
          permission(
            bobApprovalDomain(config) === 'dcl' &&
              (action === 'enable' || action === 'disable')
              ? 'save'
              : action,
          ),
        ),
      canLoadEditorReferences(),
    )
    if (bobApprovalDomain(config) === 'dcl' && row.openVersion !== null) {
      availability.enable = false
      availability.disable = false
    }
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

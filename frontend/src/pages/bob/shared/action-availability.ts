import { bobActionBlockedReason } from './lifecycle'
import type {
  BobActionAvailability,
  BobEntityConfig,
  BobListItem,
} from './types'
import { bobEntityActionAvailability } from './product-approval'

export function useBobActionAvailability(
  entity: BobEntityConfig['entity'],
  userId: () => string | undefined,
  can: (path: string) => boolean,
  canLoadEditorReferences: () => boolean,
) {
  const permission = (action: string): string => `/bob/${entity}/${action}`

  function actionAvailability(
    row: Readonly<BobListItem>,
  ): BobActionAvailability {
    return bobEntityActionAvailability(
      entity,
      row,
      userId(),
      (action) => can(permission(action)),
      canLoadEditorReferences(),
    )
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

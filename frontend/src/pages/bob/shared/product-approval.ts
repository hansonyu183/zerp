import type { Ref } from 'vue'
import { getErrorMessage } from '@/api/types'
import { bobActionAvailability } from './lifecycle'
import { validateProductConfiguration } from './product-data'
import type {
  BobActionAvailability,
  BobEntity,
  BobListItem,
  BobObjectView,
} from './types'

const productEditorReferencePermissions = [
  '/bob/product/query',
  '/aux/product-type/query',
  '/aux/measurement-unit/query',
  '/aux/product-category/query',
]

export function canLoadBobEditorReferences(
  entity: BobEntity,
  can: (path: string) => boolean,
): boolean {
  return (
    entity !== 'product' ||
    productEditorReferencePermissions.every((path) => can(path))
  )
}

function limitBobProductActions(
  entity: BobEntity,
  canGet: boolean,
  availability: BobActionAvailability,
): void {
  if (entity !== 'product' || canGet) return
  availability.submit = false
  availability.approve = false
}

export function bobEntityActionAvailability(
  entity: BobEntity,
  row: Readonly<BobListItem>,
  currentUserId: string | undefined,
  can: (action: string) => boolean,
  canLoadEditorReferences: boolean,
): BobActionAvailability {
  const availability = bobActionAvailability(row, currentUserId, can)
  if (!canLoadEditorReferences) availability.edit = false
  limitBobProductActions(entity, can('get'), availability)
  return availability
}

export function useBobProductApproval(
  entity: BobEntity,
  errorMessage: Ref<string | null>,
  getObject: (row: Pick<BobListItem, 'objectId'>) => Promise<BobObjectView>,
  runReview: (
    row: BobListItem,
    action: 'approve' | 'reject',
    comment: string,
  ) => Promise<boolean>,
) {
  async function checkProductCompleteness(row: BobListItem): Promise<boolean> {
    if (entity !== 'product') return true
    try {
      const issues = validateProductConfiguration((await getObject(row)).data)
      if (issues.length === 0) return true
      errorMessage.value = `产品资料检查未通过：${issues.join('；')}`
    } catch (error) {
      errorMessage.value = getErrorMessage(error)
    }
    return false
  }

  async function review(
    row: BobListItem,
    action: 'approve' | 'reject',
    comment: string,
  ): Promise<boolean> {
    if (entity !== 'product' || action !== 'approve') {
      return runReview(row, action, comment)
    }
    if (!(await checkProductCompleteness(row))) return false
    return runReview(row, action, comment)
  }

  return { checkProductCompleteness, review }
}

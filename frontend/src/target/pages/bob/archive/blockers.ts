import { TargetApiError } from '../../../api.ts'

type Blocker = {
  kind: string
  entity?: string
  objectId?: string
  domain?: string
  approvalEntryId?: string
}

function blockersOf(cause: unknown): readonly Blocker[] {
  if (!(cause instanceof TargetApiError) || !cause.data) return []
  if (typeof cause.data !== 'object' || !('blockers' in cause.data)) return []
  const blockers = (cause.data as { blockers?: unknown }).blockers
  return Array.isArray(blockers)
    ? blockers.filter(
        (item): item is Blocker =>
          Boolean(item) && typeof item === 'object' && 'kind' in item,
      )
    : []
}

export function describeBobEnablementFailure(cause: unknown): string | null {
  const blockers = blockersOf(cause)
  if (!blockers.length) return null
  const descriptions = blockers.map((blocker) => {
    if (
      blocker.kind === 'AUX_CURRENT_REFERENCE' &&
      blocker.entity === 'vehicle'
    )
      return `启用车辆（${blocker.objectId ?? '未知对象'}）`
    return blocker.objectId ? `引用对象（${blocker.objectId}）` : '引用对象'
  })
  return `无法变更启停状态，仍有${descriptions.join('、')}正在使用该档案。`
}

const productErrorLabels = {
  product_invalid_data: '产品资料不完整或数量、配方不符合规则。',
  product_reference_unavailable: '所选产品资料或原料当前不可用，请检查选择。',
  product_reference_stale: '原料已有新版本，请重新打开表单确认原料。',
  product_duplicate_barcode: '条码已被其他产品的正式版本或提交件占用。',
} as const

export function describeBobArchiveFailure(cause: unknown): string | null {
  if (!(cause instanceof TargetApiError)) return null
  if (cause.errorKey in productErrorLabels)
    return productErrorLabels[cause.errorKey as keyof typeof productErrorLabels]
  const products = blockersOf(cause).filter(
    (item) => item.kind === 'PRODUCT_REFERENCE',
  )
  if (products.length)
    return `无法反批准，仍被${products.map((item) => `${item.domain === 'bob' ? '产品配方' : '正式单据'}（${item.objectId}）`).join('、')}引用。`
  return null
}

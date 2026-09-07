import { TargetApiError } from '../../../api.ts'

type Blocker = {
  kind: string
  entity?: string
  objectId?: string
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

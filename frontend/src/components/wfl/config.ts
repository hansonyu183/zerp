import type { WflStageDefinition } from './types'

export function stagePrefix(stage: WflStageDefinition): string {
  return stage.prefix ?? stage.stage.toLowerCase().replace('_', '-')
}

export function statusText(
  statuses: Readonly<Record<string, string>>,
  value?: string,
): string {
  return value ? (statuses[value] ?? value) : '—'
}

export function stageStatusText(value: string): string {
  return {
    DRAFT: '草稿',
    CHECKED: '已核对',
    APPROVED: '已批准',
    ORDERED: '已下单',
    CONFIRMED: '已确认',
    EXECUTED: '已执行',
  }[value] ?? value
}

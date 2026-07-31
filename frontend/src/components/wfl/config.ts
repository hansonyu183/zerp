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
  return (
    {
      DRAFT: '草稿',
      CHECKED: '已核对',
      APPROVED: '已批准',
      ORDERED: '已下单',
      CONFIRMED: '已确认',
      EXECUTED: '已执行',
      FINALIZED: '已完成',
    }[value] ?? value
  )
}

export function workflowStatusText(value?: string): string {
  return statusText(
    {
      DRAFT: '草稿',
      CHECKED: '已核对',
      APPROVED: '已批准',
      COMPLETED: '已完成',
      SHORT_CLOSE_REQUESTED: '短结待确认',
      SHORT_CLOSED: '已短结',
      RETURNING: '退货处理中',
    },
    value,
  )
}

export function workflowStageText(value?: string): string {
  return statusText(
    {
      SALE_ORDER: '销售订单',
      PRODUCTION: '生产配货',
      OUTBOUND: '销售出库',
      DELIVERY: '销售送货',
      SIGNOFF: '销售签收',
      RETURN: '退货',
      PURCHASE_ORDER: '采购订单',
      PURCHASE_INBOUND: '采购入库',
      PURCHASE_RETURN: '采购退货',
    },
    value,
  )
}

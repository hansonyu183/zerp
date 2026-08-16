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
    }[value] ?? value
  )
}

const definitionStatusLabels = {
  DRAFT: '草稿',
  ENABLED: '已启用',
  DISABLED: '已停用',
} as const

export const definitionStatusOptions = Object.entries(
  definitionStatusLabels,
).map(([value, title]) => ({ value, title }))

export function definitionStatusText(value: string): string {
  return statusText(definitionStatusLabels, value)
}

export function documentEntityText(value: string): string {
  return (
    {
      'sale-order': '销售订单',
      'sale-outbound': '销售出库',
      'sale-delivery': '销售送货',
      'sale-signoff': '销售签收',
      'sale-return': '销售退货',
      'purchase-order': '采购订单',
      'purchase-inbound': '采购入库',
      'purchase-return': '采购退货',
      'inventory-count': '库存盘点',
      'order-production': '生产配货',
      'self-production': '生产自制品',
      'sales-receipt': '销售收款',
      'purchase-refund': '采购退款',
      'other-receipt': '其他往来收款',
      'sales-refund': '销售退款',
      'purchase-payment': '采购付款',
      'other-payment': '其他往来付款',
      'expense-reimbursement': '费用报销',
      'expense-payment': '费用付款',
    }[value] ?? value
  )
}

export function runtimeEventText(value: string): string {
  return (
    {
      STARTED: '流程已启动',
      ACTION_EXECUTED: '已执行流程动作',
    }[value] ?? value
  )
}

export function workflowActionText(value?: string): string {
  return statusText(
    {
      expense_payment: '创建费用付款',
      purchase_inbound: '创建采购入库',
      sale_outbound: '创建销售出库',
      sale_delivery: '创建销售送货',
      sale_signoff: '创建销售签收',
      sale_return: '创建销售退货',
    },
    value,
  )
}

export function workflowTriggerText(value?: string): string {
  return statusText(
    {
      APPROVED: '单据批准',
      ACTION: '流程动作',
    },
    value,
  )
}

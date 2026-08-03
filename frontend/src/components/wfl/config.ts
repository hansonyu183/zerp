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

export function definitionStatusText(value: string): string {
  return (
    {
      DRAFT: '草稿',
      ENABLED: '已启用',
      DISABLED: '已停用',
    }[value] ?? value
  )
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
      'customer-receipt': '往来收款-客户',
      'supplier-receipt': '往来收款-供应商',
      'other-receipt': '往来收款-其他',
      'customer-payment': '往来付款-客户',
      'supplier-payment': '往来付款-供应商',
      'other-payment': '往来付款-其他',
      'expense-reimbursement': '费用报销',
      'expense-payment': '费用付款',
    }[value] ?? value
  )
}

export function runtimeEventText(value: string): string {
  return (
    {
      STARTED: '流程已启动',
      CHILD_CREATED: '已创建下级单据',
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

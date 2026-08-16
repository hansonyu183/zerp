import { describe, expect, it } from 'vitest'
import {
  definitionStatusOptions,
  definitionStatusText,
  documentEntityText,
  runtimeEventText,
  workflowActionText,
  workflowTriggerText,
} from '@/components/wfl/config'

describe('workflow wire labels', () => {
  it('为用户可见的流程 wire 值提供中文业务文案', () => {
    expect(definitionStatusText('DRAFT')).toBe('草稿')
    expect(documentEntityText('expense-payment')).toBe('费用付款')
    expect(workflowActionText('expense_payment')).toBe('创建费用付款')
    expect(workflowActionText('purchase_inbound')).toBe('创建采购入库')
    expect(workflowActionText('sale_outbound')).toBe('创建销售出库')
    expect(workflowActionText('sale_delivery')).toBe('创建销售送货')
    expect(workflowActionText('sale_signoff')).toBe('创建销售签收')
    expect(workflowActionText('sale_return')).toBe('创建销售退货')
    expect(workflowTriggerText('APPROVED')).toBe('单据批准')
    expect(workflowTriggerText('ACTION')).toBe('流程动作')
    expect(runtimeEventText('ACTION_EXECUTED')).toBe('已执行流程动作')
  })

  it('从共享状态映射派生可选项', () => {
    expect(definitionStatusOptions).toEqual([
      { value: 'DRAFT', title: '草稿' },
      { value: 'ENABLED', title: '已启用' },
      { value: 'DISABLED', title: '已停用' },
    ])
  })
})

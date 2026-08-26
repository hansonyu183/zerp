import { describe, expect, it } from 'vitest'
import {
  documentEntityText,
  runtimeEventText,
  stageStatusText,
  workflowActionText,
  workflowTriggerText,
} from '@/components/wfl/config'
import {
  lifecycleLabels,
  voucherEntityConfigs,
} from '@/pages/vou/shared/config'

describe('WFL Chinese labels', () => {
  it('translates document status', () => {
    expect(['DRAFT', 'PENDING', 'APPROVED'].map(stageStatusText)).toEqual([
      '草稿',
      '待批准',
      '已批准',
    ])
  })

  it('translates definition-list and instance-list values', () => {
    expect(
      ['sale-order', 'purchase-inbound', 'expense-payment'].map(
        documentEntityText,
      ),
    ).toEqual(['销售订单', '采购入库', '费用付款'])
    expect(['STARTED', 'ACTION_EXECUTED'].map(runtimeEventText)).toEqual([
      '流程已启动',
      '已执行流程动作',
    ])
    expect(workflowActionText('sale_outbound')).toBe('创建销售出库')
    expect(workflowTriggerText('APPROVED')).toBe('单据批准')
    expect(documentEntityText('future-document')).toBe('future-document')
    expect(runtimeEventText('FUTURE_EVENT')).toBe('FUTURE_EVENT')
  })
})

describe('VOU approval labels', () => {
  it('uses approval wording with inventory count business labels', () => {
    for (const config of Object.values(voucherEntityConfigs)) {
      expect(lifecycleLabels(config)).toMatchObject(
        config.entity === 'inventory-count'
          ? {
              approved: '已盘点',
            }
          : {
              approved: '已批准',
            },
      )
    }
  })
})
